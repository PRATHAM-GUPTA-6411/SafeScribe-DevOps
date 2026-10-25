"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeJwt, loadScript } = require("./helpers");

const DOMAIN = "https://example.auth.us-east-1.amazoncognito.com";
const ORIGIN = "https://app.example.com";
const CONFIG = { cognitoDomain: DOMAIN, clientId: "client-abc" };
const ID_CLAIMS = { sub: "user-1", name: "Asha Rao", email: "asha@example.com", picture: "https://img.example/a.png" };

function setup({ config = CONFIG, search = "", fetchImpl } = {}) {
  const store = new Map();
  const calls = { assign: [], replaceState: [], fetch: [] };
  const sandbox = loadScript("auth.js", {
    SAFESCRIBE_CONFIG: config,
    location: { origin: ORIGIN, pathname: "/", search, assign: (url) => calls.assign.push(url) },
    history: { replaceState: (a, b, url) => calls.replaceState.push(url) },
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    fetch: async (url, init) => {
      calls.fetch.push({ url, init });
      return fetchImpl(url, init);
    },
  });
  return { sandbox, store, calls };
}

const tokenResponse = (over = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    access_token: "ACCESS-1",
    id_token: fakeJwt(ID_CLAIMS),
    refresh_token: "REFRESH-1",
    expires_in: 3600,
    ...over,
  }),
});
const firstCall = (sandbox) =>
  new Promise((resolve) => {
    sandbox.onAuthReady((user, error) => resolve({ user, error }));
  });

test("PKCE challenge matches the RFC 7636 appendix B test vector", async () => {
  const { sandbox } = setup();
  const challenge = await sandbox.SafeScribeAuth.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.equal(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("initAuth is false without Cognito settings and true with them", () => {
  assert.equal(setup({ config: null }).sandbox.initAuth(), false);
  assert.equal(setup({ config: { cognitoDomain: DOMAIN } }).sandbox.initAuth(), false);
  assert.equal(setup().sandbox.initAuth(), true);
});

test("sign-in redirects to Cognito with PKCE, state, Google and the right callback", async () => {
  const { sandbox, store, calls } = setup();
  await sandbox.signInWithGoogle();
  assert.equal(calls.assign.length, 1);
  const url = new URL(calls.assign[0]);
  assert.equal(url.origin + url.pathname, `${DOMAIN}/oauth2/authorize`);
  const p = url.searchParams;
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("client_id"), "client-abc");
  assert.equal(p.get("redirect_uri"), `${ORIGIN}/`);
  assert.equal(p.get("scope"), "openid email profile");
  assert.equal(p.get("code_challenge_method"), "S256");
  assert.equal(p.get("identity_provider"), "Google");

  const saved = JSON.parse(store.get("safescribe.pkce"));
  assert.equal(saved.state, p.get("state"));
  assert.ok(saved.verifier.length >= 43 && saved.verifier.length <= 128);
  assert.equal(p.get("code_challenge"), await sandbox.SafeScribeAuth.pkceChallenge(saved.verifier));
});

test("callback exchanges the code with the stored verifier, signs the user in, and tidies up", async () => {
  const { sandbox, store, calls } = setup({ fetchImpl: async () => tokenResponse() });
  await sandbox.signInWithGoogle();
  const { verifier, state } = JSON.parse(store.get("safescribe.pkce"));
  sandbox.location.search = `?code=AUTHCODE&state=${encodeURIComponent(state)}`;

  const { user, error } = await firstCall(sandbox);
  assert.equal(error, null);
  assert.deepEqual(JSON.parse(JSON.stringify(user)), {
    uid: "user-1",
    displayName: "Asha Rao",
    email: "asha@example.com",
    photoURL: "https://img.example/a.png",
  });

  const req = calls.fetch[0];
  assert.equal(req.url, `${DOMAIN}/oauth2/token`);
  const body = new URLSearchParams(req.init.body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "AUTHCODE");
  assert.equal(body.get("code_verifier"), verifier);
  assert.equal(body.get("redirect_uri"), `${ORIGIN}/`);
  assert.equal(body.get("client_id"), "client-abc");

  assert.deepEqual(calls.replaceState, ["/"], "the code must be removed from the address bar");
  assert.equal(store.size, 0, "PKCE data and tokens must not remain in browser storage");
  assert.equal(await sandbox.SafeScribeAuth.getAccessToken(), "ACCESS-1");
});

test("callback with a wrong state is rejected and no token request is made", async () => {
  const { sandbox, store, calls } = setup({ fetchImpl: async () => tokenResponse() });
  await sandbox.signInWithGoogle();
  assert.ok(store.get("safescribe.pkce"));
  sandbox.location.search = "?code=AUTHCODE&state=forged";
  const { user, error } = await firstCall(sandbox);
  assert.equal(user, null);
  assert.match(error.message, /could not be verified/);
  assert.equal(calls.fetch.length, 0);
  await assert.rejects(() => sandbox.SafeScribeAuth.getAccessToken());
});

test("callback without saved PKCE data is rejected", async () => {
  const { sandbox, calls } = setup({ fetchImpl: async () => tokenResponse() });
  sandbox.location.search = "?code=AUTHCODE&state=anything";
  const { user, error } = await firstCall(sandbox);
  assert.equal(user, null);
  assert.ok(error);
  assert.equal(calls.fetch.length, 0);
});

test("an error returned by Cognito/Google is surfaced to the UI", async () => {
  const { sandbox } = setup({ fetchImpl: async () => tokenResponse() });
  sandbox.location.search = "?error=access_denied&error_description=User+cancelled";
  const { user, error } = await firstCall(sandbox);
  assert.equal(user, null);
  assert.equal(error.message, "User cancelled");
});

test("a failed token exchange leaves the user signed out with a message", async () => {
  const { sandbox } = setup({
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) }),
  });
  await sandbox.signInWithGoogle();
  const state = JSON.parse(sandbox.sessionStorage.getItem("safescribe.pkce")).state;
  sandbox.location.search = `?code=BAD&state=${state}`;
  const { user, error } = await firstCall(sandbox);
  assert.equal(user, null);
  assert.equal(error.message, "invalid_grant");
});

test("plain page load without a callback reports signed out, no error", async () => {
  const { sandbox } = setup({ fetchImpl: async () => tokenResponse() });
  const { user, error } = await firstCall(sandbox);
  assert.equal(user, null);
  assert.equal(error, null);
});

test("an expiring access token is refreshed silently and the refresh token is kept", async () => {
  let n = 0;
  const { sandbox, store, calls } = setup({
    fetchImpl: async () => {
      n += 1;
      if (n === 1) return tokenResponse({ expires_in: 30 }); // already inside the 60 s refresh margin
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "ACCESS-2", id_token: fakeJwt(ID_CLAIMS), expires_in: 3600 }),
      };
    },
  });
  await sandbox.signInWithGoogle();
  sandbox.location.search = `?code=C&state=${JSON.parse(store.get("safescribe.pkce")).state}`;
  await firstCall(sandbox);

  const [a, b] = await Promise.all([sandbox.SafeScribeAuth.getAccessToken(), sandbox.SafeScribeAuth.getAccessToken()]);
  assert.equal(a, "ACCESS-2");
  assert.equal(b, "ACCESS-2");
  const refreshCalls = calls.fetch.filter((c) => new URLSearchParams(c.init.body).get("grant_type") === "refresh_token");
  assert.equal(refreshCalls.length, 1, "concurrent callers must share one refresh request");
  assert.equal(new URLSearchParams(refreshCalls[0].init.body).get("refresh_token"), "REFRESH-1");
  // After a refresh the old refresh token is still usable for the next one.
  assert.equal(await sandbox.SafeScribeAuth.getAccessToken(), "ACCESS-2");
});

test("an expired session that cannot be refreshed signs the user out and says why", async () => {
  const { sandbox, store } = setup({
    fetchImpl: async () => tokenResponse({ expires_in: 30, refresh_token: undefined }),
  });
  await sandbox.signInWithGoogle();
  sandbox.location.search = `?code=C&state=${JSON.parse(store.get("safescribe.pkce")).state}`;
  const events = [];
  sandbox.onAuthReady((user, error) => events.push({ user, error }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(events.at(-1).user.uid, "user-1");

  await assert.rejects(() => sandbox.SafeScribeAuth.getAccessToken(), /expired/);
  const last = events.at(-1);
  assert.equal(last.user, null);
  assert.match(last.error.message, /expired/);
});

test("sign-out forgets tokens and sends the browser to Cognito's logout", async () => {
  const { sandbox, store, calls } = setup({ fetchImpl: async () => tokenResponse() });
  await sandbox.signInWithGoogle();
  sandbox.location.search = `?code=C&state=${JSON.parse(store.get("safescribe.pkce")).state}`;
  await firstCall(sandbox);

  sandbox.signOutUser();
  const url = new URL(calls.assign.at(-1));
  assert.equal(url.origin + url.pathname, `${DOMAIN}/logout`);
  assert.equal(url.searchParams.get("client_id"), "client-abc");
  assert.equal(url.searchParams.get("logout_uri"), `${ORIGIN}/`);
  await assert.rejects(() => sandbox.SafeScribeAuth.getAccessToken(), /Not signed in/);
});

test("non-ASCII display names survive token decoding", async () => {
  const { sandbox } = setup();
  const payload = sandbox.SafeScribeAuth.decodeJwtPayload(fakeJwt({ name: "Zoë Ünal ✓" }));
  assert.equal(payload.name, "Zoë Ünal ✓");
});
