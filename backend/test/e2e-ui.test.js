"use strict";
/**
 * End-to-end: the real index.html + app.js + auth.js + api.js, running in jsdom,
 * talking to the real Express API (fake token verifier, in-memory repo) and a
 * stand-in Cognito token endpoint. Not a real browser and not real Cognito/DynamoDB.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { webcrypto } = require("node:crypto");
const { JSDOM } = require("jsdom");
const { startTestApp, COGNITO_DOMAIN } = require("./helpers/testApp");
const { b64u } = require("./helpers/jwt");

const CryptoJS = require(path.resolve(__dirname, "../../frontend/vendor/crypto-js.js"));
const FRONTEND = path.resolve(__dirname, "../../frontend");
const VAULT = "vault-passphrase-1";

let t;
test.before(async () => {
  t = await startTestApp({ frontendDir: FRONTEND, maxCiphertextBytes: 300 * 1024 });
});
test.after(async () => {
  await t.close();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (fn()) return;
    } catch {
      /* keep waiting */
    }
    await sleep(25);
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

/** Opens the app as if Cognito had just redirected back with ?code=...&state=... */
async function openApp({ accessToken = "asha-token", claims = { sub: "asha", name: "Asha Rao", email: "asha@example.com" } } = {}) {
  const tokenCalls = [];
  const dom = await JSDOM.fromURL(`${t.base}/?code=AUTHCODE&state=XYZ`, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.confirm = () => true;
      window.sessionStorage.setItem("safescribe.pkce", JSON.stringify({ verifier: "v".repeat(64), state: "XYZ" }));
      window.fetch = async (url, init) => {
        const u = new URL(url, window.location.href);
        if (u.origin === COGNITO_DOMAIN) {
          tokenCalls.push({ path: u.pathname, body: new URLSearchParams(init.body) });
          const idToken = `${b64u(JSON.stringify({ alg: "none" }))}.${b64u(JSON.stringify(claims))}.sig`;
          return new Response(
            JSON.stringify({ access_token: accessToken, id_token: idToken, refresh_token: "R", expires_in: 3600 }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return fetch(u.href, init);
      };
    },
  });
  const win = dom.window;
  const doc = win.document;
  const $ = (id) => doc.getElementById(id);
  const visible = (id) => !$(id).hidden;
  const submit = (id) => $(id).dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  const type = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new win.Event("input", { bubbles: true }));
  };
  const unlock = async (password) => {
    $("vault-password").value = password;
    submit("form-unlock");
  };
  return { dom, win, doc, $, visible, submit, type, unlock, tokenCalls, close: () => dom.window.close() };
}

const serverNotes = async (token = "asha-token") => (await (await t.call("GET", "/api/notes", { token })).json()).notes;

test("sign-in callback, unlock, create, autosave, reload, wrong password, delete: full journey", async () => {
  // 1. Return from Cognito: code exchanged, user recognised, unlock screen shown.
  let app = await openApp();
  await waitFor(() => app.visible("screen-unlock"), "unlock screen after sign-in");
  assert.equal(app.$("unlock-name").textContent, "Asha Rao");
  assert.equal(app.$("unlock-email").textContent, "asha@example.com");
  assert.equal(app.tokenCalls.length, 1);
  assert.equal(app.tokenCalls[0].path, "/oauth2/token");
  assert.equal(app.tokenCalls[0].body.get("code"), "AUTHCODE");
  assert.equal(app.tokenCalls[0].body.get("code_verifier"), "v".repeat(64));
  assert.equal(app.win.location.search, "", "the one-time code must be removed from the address bar");
  assert.equal(app.win.sessionStorage.length, 0, "nothing may be left in sessionStorage");
  assert.equal(app.win.localStorage.length, 0);

  // 2. The vault password has a minimum length.
  await app.unlock("short");
  assert.match(app.$("unlock-error").textContent, /at least 8/);

  // 3. Unlock: no notes yet.
  await app.unlock(VAULT);
  await waitFor(() => app.visible("screen-app"), "main screen");
  await waitFor(() => /No notes yet/.test(app.$("list-status").textContent), "empty state");

  // 4. Create a note, type into it, wait for the debounced autosave.
  app.$("btn-new-note").click();
  await waitFor(() => app.$("note-list").children.length === 1 && !app.$("editor").hidden, "new note visible");
  app.type("note-title", "Shopping");
  app.type("note-body", "milk\nbread ✓");
  await waitFor(() => /^Saved/.test(app.$("save-status").textContent), "autosave", 6000);

  // 5. Zero-knowledge check on the server side.
  const stored = await serverNotes();
  assert.equal(stored.length, 1);
  assert.ok(stored[0].ciphertext.startsWith("U2FsdGVkX1"));
  assert.ok(!stored[0].ciphertext.includes("Shopping") && !stored[0].ciphertext.includes("milk"));
  const plain = JSON.parse(CryptoJS.AES.decrypt(stored[0].ciphertext, VAULT).toString(CryptoJS.enc.Utf8));
  assert.deepEqual(plain, { title: "Shopping", body: "milk\nbread ✓" });
  assert.ok(!t.logLines.join("").includes(stored[0].ciphertext), "ciphertext must not appear in server logs");
  app.close();

  // 6. New session (fresh page load + sign-in): the note comes back, decrypted.
  app = await openApp();
  await waitFor(() => app.visible("screen-unlock"), "unlock screen (session 2)");
  await app.unlock(VAULT);
  await waitFor(() => app.$("note-list").children.length === 1, "note listed after reload");
  assert.match(app.$("note-list").textContent, /Shopping/);
  assert.match(app.$("note-list").textContent, /milk bread ✓/);
  assert.equal(app.$("note-count").textContent, "1");
  app.close();

  // 7. Wrong vault password: nothing decrypts, user is sent back to unlock with a clear message.
  app = await openApp();
  await waitFor(() => app.visible("screen-unlock"), "unlock screen (session 3)");
  await app.unlock("not-the-right-password");
  await waitFor(() => /Could not decrypt any notes/.test(app.$("unlock-error").textContent), "wrong-password message");
  assert.ok(app.visible("screen-unlock"));
  app.close();

  // 8. Delete the note.
  app = await openApp();
  await waitFor(() => app.visible("screen-unlock"), "unlock screen (session 4)");
  await app.unlock(VAULT);
  await waitFor(() => app.$("note-list").children.length === 1, "note listed");
  app.$("note-list").querySelector("button").click();
  await waitFor(() => !app.$("editor").hidden, "editor open");
  app.$("btn-delete").click();
  await waitFor(() => app.$("note-list").children.length === 0, "note removed from list");
  assert.deepEqual(await serverNotes(), []);
  app.close();
});

test("two different users never see each other's notes through the UI", async () => {
  const a = await openApp({ accessToken: "uma-token", claims: { sub: "uma", name: "Uma", email: "uma@example.com" } });
  await waitFor(() => a.visible("screen-unlock"), "uma unlock");
  await a.unlock(VAULT);
  await waitFor(() => a.visible("screen-app"), "uma app");
  a.$("btn-new-note").click();
  await waitFor(() => a.$("note-list").children.length === 1, "uma note");
  a.type("note-title", "UMA PRIVATE");
  await waitFor(() => /^Saved/.test(a.$("save-status").textContent), "uma saved", 6000);
  a.close();

  const v = await openApp({ accessToken: "victor-token", claims: { sub: "victor", name: "Victor", email: "v@example.com" } });
  await waitFor(() => v.visible("screen-unlock"), "victor unlock");
  await v.unlock(VAULT);
  await waitFor(() => /No notes yet/.test(v.$("list-status").textContent), "victor sees nothing");
  assert.equal(v.$("note-list").children.length, 0);
  v.close();
});

test("a rejected/expired token sends the user to the sign-in screen with a message", async () => {
  const app = await openApp({ accessToken: "not-a-valid-token" }); // backend will answer 401
  await waitFor(() => app.visible("screen-unlock"), "unlock screen");
  await app.unlock(VAULT);
  await waitFor(() => /session expired/i.test(app.$("login-error").textContent), "session-expired message");
  assert.ok(app.visible("screen-login"), "user must end up on the sign-in screen, not a stale unlock screen");
  app.close();
});

test("with Cognito settings served by the API the sign-in button is enabled and no warning shows", async () => {
  const dom = await JSDOM.fromURL(`${t.base}/`, {
    runScripts: "dangerously",
    resources: "usable",
    beforeParse(window) {
      Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
    },
  });
  const doc = dom.window.document;
  await waitFor(() => !doc.getElementById("screen-login").hidden, "login screen");
  assert.equal(doc.getElementById("config-warning").hidden, true);
  assert.equal(doc.getElementById("btn-google").disabled, false);
  dom.window.close();
});

test("without /config.js (plain static hosting) the UI warns that sign-in is not configured", async () => {
  const http = require("node:http");
  const fs = require("node:fs");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  const staticServer = http.createServer((req, res) => {
    const file = path.join(FRONTEND, req.url === "/" ? "index.html" : req.url.split("?")[0]);
    if (!file.startsWith(FRONTEND) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
  });
  await new Promise((r) => staticServer.listen(0, "127.0.0.1", r));
  try {
    const dom = await JSDOM.fromURL(`http://127.0.0.1:${staticServer.address().port}/`, {
      runScripts: "dangerously",
      resources: "usable",
      beforeParse(window) {
        Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });
        window.TextEncoder = TextEncoder;
        window.TextDecoder = TextDecoder;
      },
    });
    const doc = dom.window.document;
    await waitFor(() => doc.getElementById("config-warning").hidden === false, "configuration warning");
    assert.equal(doc.getElementById("btn-google").disabled, true);
    dom.window.close();
  } finally {
    await new Promise((r) => staticServer.close(r));
  }
});
