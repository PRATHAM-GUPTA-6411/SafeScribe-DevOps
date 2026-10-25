"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FRONTEND, vm } = require("./helpers");

const ORIGIN = "https://app.example.com";
const tick = () => new Promise((r) => setTimeout(r, 5));

/** Loads a service-worker file into a sandbox and returns helpers to fire events at it. */
function loadWorker(file = "service-worker.js", { dir = FRONTEND, fetchImpl } = {}) {
  const handlers = {};
  const cached = []; // urls written to Cache Storage by cache.put
  const precached = [];
  const response = (headers = {}) => ({
    status: 200,
    type: "basic",
    headers: { get: (k) => headers[k] ?? null },
    clone() {
      return this;
    },
  });
  const sandbox = {
    self: {
      addEventListener: (type, fn) => (handlers[type] = fn),
      location: { origin: ORIGIN },
      skipWaiting: () => {},
      clients: { claim: () => {} },
    },
    caches: {
      open: async () => ({
        addAll: async (list) => precached.push(...list),
        put: async (req) => cached.push(req.url),
      }),
      match: async () => "CACHE-HIT",
      keys: async () => [],
      delete: async () => true,
    },
    fetch: fetchImpl || (async () => response()),
    URL,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(dir, file), "utf8"), sandbox, { filename: file });

  /** Fires a fetch event; resolves to { handled, result }. */
  async function fire(url, method = "GET") {
    let promise = null;
    handlers.fetch({ request: { method, url }, respondWith: (p) => (promise = p) });
    const result = promise ? await promise : undefined;
    await tick();
    return { handled: promise !== null, result };
  }
  return { fire, cached, precached, handlers, sandbox, response };
}

test("API, config and health requests are never handled or cached", async () => {
  const sw = loadWorker();
  for (const p of ["/api/notes", "/api/notes/123e4567-e89b-12d3-a456-426614174000", "/api", "/config.js", "/health"]) {
    const { handled } = await sw.fire(ORIGIN + p);
    assert.equal(handled, false, `${p} must bypass the service worker`);
  }
  assert.deepEqual(sw.cached, []);
});

test("cross-origin requests (Cognito, Google) and non-GET requests are ignored", async () => {
  const sw = loadWorker();
  assert.equal((await sw.fire("https://example.auth.us-east-1.amazoncognito.com/oauth2/token")).handled, false);
  assert.equal((await sw.fire("https://lh3.googleusercontent.com/a.png")).handled, false);
  assert.equal((await sw.fire(ORIGIN + "/index.html", "POST")).handled, false);
  assert.deepEqual(sw.cached, []);
});

test("static assets are cached; JavaScript is not (always network-first)", async () => {
  const sw = loadWorker();
  assert.equal((await sw.fire(ORIGIN + "/style.css")).handled, true);
  assert.equal((await sw.fire(ORIGIN + "/icon.svg")).handled, true);
  assert.equal((await sw.fire(ORIGIN + "/app.js")).handled, true);
  assert.deepEqual(sw.cached.sort(), [ORIGIN + "/icon.svg", ORIGIN + "/style.css"]);
});

test("responses marked Cache-Control: no-store are not cached", async () => {
  const sw = loadWorker("service-worker.js", {
    fetchImpl: async () => ({
      status: 200,
      type: "basic",
      headers: { get: (k) => (k === "Cache-Control" ? "no-store" : null) },
      clone() {
        return this;
      },
    }),
  });
  await sw.fire(ORIGIN + "/something.html");
  assert.deepEqual(sw.cached, []);
});

test("offline: falls back to the cached shell", async () => {
  const sw = loadWorker("service-worker.js", {
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.equal((await sw.fire(ORIGIN + "/index.html")).result, "CACHE-HIT");
});

test("every file in the precache list exists (a missing one would break install)", () => {
  const sw = loadWorker();
  const shell = vm.runInContext("APP_SHELL", sw.sandbox);
  assert.ok(shell.length >= 9);
  for (const entry of shell) {
    const rel = entry === "./" ? "index.html" : entry.replace(/^\.\//, "");
    assert.ok(fs.existsSync(path.join(FRONTEND, rel)), `missing precache file ${entry}`);
  }
  assert.ok(!shell.some((e) => /firebase/i.test(e)));
  assert.equal(vm.runInContext("CACHE_NAME", sw.sandbox), "safescribe-v3");
});
