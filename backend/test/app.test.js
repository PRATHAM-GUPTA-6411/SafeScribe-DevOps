"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, COGNITO_DOMAIN } = require("./helpers/testApp");

let t;
test.before(async () => {
  t = await startTestApp();
});
test.after(async () => {
  await t.close();
});

test("GET /health returns ok and the running version, without auth", async () => {
  const res = await t.call("GET", "/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.version, "test-1.2.3");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("API rejects missing, malformed and invalid tokens with 401", async () => {
  assert.equal((await t.call("GET", "/api/notes")).status, 401);
  const bad = await fetch(`${t.base}/api/notes`, { headers: { Authorization: "Basic abc" } });
  assert.equal(bad.status, 401);
  assert.equal((await t.call("GET", "/api/notes", { token: "garbage" })).status, 401);
  const res = await t.call("POST", "/api/notes", { body: { ciphertext: "x" } });
  assert.equal(res.status, 401);
});

test("full CRUD cycle for one user", async () => {
  const created = await t.call("POST", "/api/notes", { token: "carol-token", body: { ciphertext: "CT-1" } });
  assert.equal(created.status, 201);
  const note = await created.json();
  assert.match(note.id, /^[0-9a-f-]{36}$/);
  assert.equal(note.ciphertext, "CT-1");
  assert.ok(note.createdAt && note.updatedAt);

  const list = await (await t.call("GET", "/api/notes", { token: "carol-token" })).json();
  assert.deepEqual(list.notes.map((n) => n.id), [note.id]);

  const updated = await t.call("PUT", `/api/notes/${note.id}`, { token: "carol-token", body: { ciphertext: "CT-2" } });
  assert.equal(updated.status, 200);
  const upBody = await updated.json();
  assert.equal(upBody.ciphertext, "CT-2");
  assert.equal(upBody.createdAt, note.createdAt);
  assert.notEqual(upBody.updatedAt, note.updatedAt);

  const del = await t.call("DELETE", `/api/notes/${note.id}`, { token: "carol-token" });
  assert.equal(del.status, 204);
  const after = await (await t.call("GET", "/api/notes", { token: "carol-token" })).json();
  assert.deepEqual(after.notes, []);
});

test("list is ordered newest-updated first", async () => {
  const a = await (await t.call("POST", "/api/notes", { token: "dave-token", body: { ciphertext: "A" } })).json();
  const b = await (await t.call("POST", "/api/notes", { token: "dave-token", body: { ciphertext: "B" } })).json();
  await t.call("PUT", `/api/notes/${a.id}`, { token: "dave-token", body: { ciphertext: "A2" } });
  const list = await (await t.call("GET", "/api/notes", { token: "dave-token" })).json();
  assert.deepEqual(list.notes.map((n) => n.id), [a.id, b.id]);
});

test("a user can never read, change or delete another user's notes", async () => {
  const note = await (await t.call("POST", "/api/notes", { token: "alice-token", body: { ciphertext: "ALICE-SECRET" } })).json();

  const bobList = await (await t.call("GET", "/api/notes", { token: "bob-token" })).json();
  assert.deepEqual(bobList.notes, []);

  const put = await t.call("PUT", `/api/notes/${note.id}`, { token: "bob-token", body: { ciphertext: "HACK" } });
  assert.equal(put.status, 404);
  const del = await t.call("DELETE", `/api/notes/${note.id}`, { token: "bob-token" });
  assert.equal(del.status, 404);

  const aliceList = await (await t.call("GET", "/api/notes", { token: "alice-token" })).json();
  assert.equal(aliceList.notes.length, 1);
  assert.equal(aliceList.notes[0].ciphertext, "ALICE-SECRET");
});

test("owner comes from the token, not from the request body or query", async () => {
  await t.call("POST", "/api/notes?userId=alice", {
    token: "erin-token",
    body: { ciphertext: "ERIN-NOTE", userId: "alice", sub: "alice" },
  });
  const alice = await (await t.call("GET", "/api/notes", { token: "alice-token" })).json();
  assert.ok(!alice.notes.some((n) => n.ciphertext === "ERIN-NOTE"));
  const erin = await (await t.call("GET", "/api/notes", { token: "erin-token" })).json();
  assert.ok(erin.notes.some((n) => n.ciphertext === "ERIN-NOTE"));
});

test("input validation", async () => {
  const post = (body) => t.call("POST", "/api/notes", { token: "frank-token", body });
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ ciphertext: "" })).status, 400);
  assert.equal((await post({ ciphertext: 42 })).status, 400);
  assert.equal((await post({ ciphertext: "x".repeat(2000) })).status, 413); // over maxCiphertextBytes (1024 in tests)
  assert.equal((await t.call("POST", "/api/notes", { token: "frank-token", raw: "{not json" })).status, 400);
  assert.equal((await t.call("PUT", "/api/notes/not-a-uuid", { token: "frank-token", body: { ciphertext: "x" } })).status, 404);
  assert.equal((await t.call("DELETE", "/api/notes/../../etc", { token: "frank-token" })).status, 404);
  const big = await t.call("POST", "/api/notes", { token: "frank-token", body: { ciphertext: "y".repeat(500 * 1024) } });
  assert.equal(big.status, 413); // express body limit
});

test("API responses are never cacheable; unknown API paths give JSON 404", async () => {
  const ok = await t.call("GET", "/api/notes", { token: "gina-token" });
  assert.equal(ok.headers.get("cache-control"), "no-store");
  const unauth = await t.call("GET", "/api/notes");
  assert.equal(unauth.headers.get("cache-control"), "no-store");
  const missing = await t.call("GET", "/api/nothing", { token: "gina-token" });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "not found" });
});

test("/config.js exposes only public Cognito settings", async () => {
  const res = await t.call("GET", "/config.js");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /javascript/);
  const text = await res.text();
  assert.ok(text.startsWith("window.SAFESCRIBE_CONFIG = "));
  assert.ok(text.includes(COGNITO_DOMAIN));
  assert.ok(text.includes("client-abc"));
  assert.ok(!/secret|password|userPoolId/i.test(text));
});

test("serves the static frontend with security headers and a CSP that allows only Cognito", async () => {
  const res = await t.call("GET", "/");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /SafeScribe test/);
  const csp = res.headers.get("content-security-policy");
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(csp.includes(`connect-src 'self' ${COGNITO_DOMAIN}`));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(!csp.includes("upgrade-insecure-requests"));
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-powered-by"), null);
  assert.ok(res.headers.get("x-request-id"));
  assert.equal((await t.call("GET", "/does-not-exist.html")).status, 404);
});

test("/metrics is not served by the public app", async () => {
  assert.equal((await t.call("GET", "/metrics")).status, 404);
});

test("metrics registry records requests by route template and status", async () => {
  await t.call("GET", "/health");
  const text = await t.metrics.registry.metrics();
  assert.match(text, /http_requests_total\{method="GET",route="\/health",status_code="200"\}/);
  assert.match(text, /http_requests_total\{method="PUT",route="\/api\/notes\/:id",status_code="404"\}/);
  assert.match(text, /safescribe_app_info\{version="test-1.2.3"\} 1/);
  assert.ok(!text.includes("ALICE-SECRET"));
});

test("logs contain request metadata only: no tokens, ciphertext or query strings", async () => {
  await t.call("POST", "/api/notes?secret=QUERYSECRET", { token: "hank-token", body: { ciphertext: "TOP-SECRET-CIPHERTEXT" } });
  const joined = t.logLines.join("");
  assert.ok(joined.includes('"msg":"request"'));
  for (const forbidden of ["hank-token", "TOP-SECRET-CIPHERTEXT", "QUERYSECRET", "ALICE-SECRET"]) {
    assert.ok(!joined.includes(forbidden), `log leaked ${forbidden}`);
  }
});
