"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { loadConfig } = require("../src/config");

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("loadConfig requires the Cognito settings and an https domain", () => {
  assert.throws(() => loadConfig({}), /Missing required environment variable COGNITO_/);
  assert.throws(
    () => loadConfig({ COGNITO_DOMAIN: "https://x.auth.us-east-1.amazoncognito.com", COGNITO_CLIENT_ID: "c" }),
    /COGNITO_USER_POOL_ID/
  );
  assert.throws(
    () => loadConfig({ COGNITO_USER_POOL_ID: "p", COGNITO_CLIENT_ID: "c", COGNITO_DOMAIN: "http://insecure.example" }),
    /https/
  );
  const cfg = loadConfig({
    COGNITO_USER_POOL_ID: "p",
    COGNITO_CLIENT_ID: "c",
    COGNITO_DOMAIN: "https://x.auth.us-east-1.amazoncognito.com/",
    APP_VERSION: "abc123",
  });
  assert.equal(cfg.cognito.domain, "https://x.auth.us-east-1.amazoncognito.com");
  assert.equal(cfg.appVersion, "abc123");
  assert.equal(cfg.tableName, "SafeScribeNotes");
});

// Windows has no SIGTERM (kill() terminates the process abruptly), so this runs on Linux/macOS/CI only.
test("server.js boots, serves health/config, keeps /metrics internal, and exits 0 on SIGTERM", { skip: process.platform === "win32" && "no SIGTERM on Windows" }, async () => {
  const port = await freePort();
  const metricsPort = await freePort();
  const child = spawn(process.execPath, [path.resolve(__dirname, "../src/server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      METRICS_PORT: String(metricsPort),
      COGNITO_USER_POOL_ID: "us-east-1_TestPool1",
      COGNITO_CLIENT_ID: "client-abc",
      COGNITO_DOMAIN: "https://example.auth.us-east-1.amazoncognito.com",
      APP_VERSION: "boot-test",
      AWS_ACCESS_KEY_ID: "x",
      AWS_SECRET_ACCESS_KEY: "x",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));

  try {
    let health;
    for (let i = 0; i < 50 && !health; i++) {
      try {
        health = await fetch(`http://127.0.0.1:${port}/health`);
      } catch {
        await sleep(100);
      }
    }
    assert.ok(health, `server never became ready. Output: ${output}`);
    assert.equal((await health.json()).version, "boot-test");

    assert.equal((await fetch(`http://127.0.0.1:${port}/api/notes`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/metrics`)).status, 404);
    const metrics = await fetch(`http://127.0.0.1:${metricsPort}/metrics`);
    assert.equal(metrics.status, 200);
    assert.match(await metrics.text(), /http_requests_total/);

    child.kill("SIGTERM");
    const result = await Promise.race([exited, sleep(8000).then(() => "timeout")]);
    assert.notEqual(result, "timeout", "server did not exit after SIGTERM");
    assert.equal(result.code, 0, `expected clean exit, got ${JSON.stringify(result)}`);
    assert.ok(output.includes('"msg":"shutting down"'));
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});

test("server.js refuses to start without required configuration", async () => {
  const child = spawn(process.execPath, [path.resolve(__dirname, "../src/server.js")], {
    env: { PATH: process.env.PATH },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 1);
  assert.match(output, /Missing required environment variable/);
});
