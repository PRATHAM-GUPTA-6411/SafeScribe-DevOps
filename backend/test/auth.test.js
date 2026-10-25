"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTokenVerifier } = require("../src/auth");
const { makeKey, signJwt, b64u } = require("./helpers/jwt");

const POOL = "us-east-1_TestPool1";
const CLIENT = "client-abc";
const ISS = `https://cognito-idp.us-east-1.amazonaws.com/${POOL}`;
const now = () => Math.floor(Date.now() / 1000);

const goodClaims = (over = {}) => ({
  sub: "11111111-2222-3333-4444-555555555555",
  iss: ISS,
  client_id: CLIENT,
  token_use: "access",
  scope: "openid email profile",
  iat: now() - 10,
  exp: now() + 3600,
  jti: "jti-1",
  ...over,
});

const key = makeKey("kid-1");
const otherKey = makeKey("kid-1"); // same kid, different key material
const verifier = createTokenVerifier({ userPoolId: POOL, clientId: CLIENT });
verifier.verifier.cacheJwks(key.jwks);

const rejects = (token) => assert.rejects(() => verifier.verify(token));

test("accepts a valid Cognito access token and returns its claims", async () => {
  const payload = await verifier.verify(signJwt(key, goodClaims()));
  assert.equal(payload.sub, "11111111-2222-3333-4444-555555555555");
  assert.equal(payload.token_use, "access");
});

test("rejects an expired token", async () => {
  await rejects(signJwt(key, goodClaims({ iat: now() - 7200, exp: now() - 3600 })));
});

test("rejects a token for a different app client", async () => {
  await rejects(signJwt(key, goodClaims({ client_id: "someone-elses-client" })));
});

test("rejects a token from a different user pool (issuer)", async () => {
  await rejects(signJwt(key, goodClaims({ iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OtherPool" })));
});

test("rejects an ID token presented as an access token", async () => {
  await rejects(signJwt(key, goodClaims({ token_use: "id", aud: CLIENT })));
});

test("rejects a token signed with a different private key", async () => {
  await rejects(signJwt(otherKey, goodClaims()));
});

test("rejects alg=none and tampered payloads", async () => {
  const header = b64u(JSON.stringify({ alg: "none", typ: "JWT", kid: "kid-1" }));
  await rejects(`${header}.${b64u(JSON.stringify(goodClaims()))}.`);

  const valid = signJwt(key, goodClaims());
  const [h, , s] = valid.split(".");
  await rejects(`${h}.${b64u(JSON.stringify(goodClaims({ sub: "attacker" })))}.${s}`);
});

test("rejects garbage and empty tokens", async () => {
  await rejects("not-a-jwt");
  await rejects("");
  await rejects("a.b.c");
});
