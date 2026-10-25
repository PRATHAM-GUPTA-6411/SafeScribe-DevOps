/**
 * auth.js — Cognito sign-in (hosted login, Authorization Code flow with PKCE).
 *
 * Replaces the Firebase Auth part of the original firebase.js.
 *
 * - Tokens are kept in memory only. After a page reload the user signs in again
 *   (Cognito's own session makes that one click). Nothing secret is persisted.
 * - Only the one-time PKCE verifier and state are kept in sessionStorage, because
 *   they must survive the redirect to Cognito and back; they are removed on return.
 * - The backend verifies the access token on every request; the browser never
 *   needs to (and cannot) be trusted to do so.
 * - Settings come from /config.js (window.SAFESCRIBE_CONFIG), served by the API.
 */
(function (global) {
  "use strict";

  const PKCE_KEY = "safescribe.pkce";
  const REFRESH_MARGIN_MS = 60 * 1000;

  let tokens = null; // { accessToken, idToken, refreshToken, expiresAt }
  let currentUser = null;
  let lastError = null;
  let started = null;
  let refreshing = null;
  const listeners = [];

  function config() {
    const c = global.SAFESCRIBE_CONFIG;
    return c && c.cognitoDomain && c.clientId ? c : null;
  }

  /** True when Cognito settings are present (mirrors the old initFirebase()). */
  function initAuth() {
    return config() !== null;
  }

  // ----- PKCE helpers -------------------------------------------------------

  function base64Url(bytes) {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return global.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomString(byteLength) {
    const bytes = new Uint8Array(byteLength);
    global.crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  async function pkceChallenge(verifier) {
    const digest = await global.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64Url(new Uint8Array(digest));
  }

  function redirectUri() {
    return global.location.origin + "/";
  }

  function decodeJwtPayload(jwt) {
    const part = String(jwt).split(".")[1];
    if (!part) throw new Error("Malformed token");
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(global.atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function userFromClaims(claims) {
    const fullName = [claims.given_name, claims.family_name].filter(Boolean).join(" ");
    return {
      uid: claims.sub,
      displayName: claims.name || fullName || claims.email || "",
      email: claims.email || "",
      photoURL: claims.picture || "",
    };
  }

  // ----- Sign in / token handling ------------------------------------------

  async function buildAuthorizeUrl() {
    const c = config();
    const verifier = randomString(64);
    const state = randomString(24);
    const challenge = await pkceChallenge(verifier);
    global.sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
    const params = new URLSearchParams({
      response_type: "code",
      client_id: c.clientId,
      redirect_uri: redirectUri(),
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      identity_provider: "Google",
    });
    return `${c.cognitoDomain}/oauth2/authorize?${params.toString()}`;
  }

  async function signInWithGoogle() {
    if (!config()) throw new Error("Sign-in is not configured.");
    global.location.assign(await buildAuthorizeUrl());
  }

  async function tokenRequest(params) {
    const c = config();
    const res = await global.fetch(`${c.cognitoDomain}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.clientId, ...params }).toString(),
    });
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      /* non-JSON error body */
    }
    if (!res.ok || !data.access_token) {
      throw new Error(data.error_description || data.error || "Sign-in failed. Please try again.");
    }
    return data;
  }

  function storeTokens(data) {
    tokens = {
      accessToken: data.access_token,
      idToken: data.id_token,
      // A refresh response does not include a new refresh token; keep the existing one.
      refreshToken: data.refresh_token || (tokens && tokens.refreshToken) || null,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
    if (data.id_token) currentUser = userFromClaims(decodeJwtPayload(data.id_token));
  }

  function takePkce() {
    const raw = global.sessionStorage.getItem(PKCE_KEY);
    global.sessionStorage.removeItem(PKCE_KEY);
    try {
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /** Completes the login if the page was opened by Cognito's redirect (?code=...&state=...). */
  async function processCallback() {
    const params = new URLSearchParams(global.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    if (!code && !error) return;

    const saved = takePkce();
    global.history.replaceState({}, "", global.location.pathname); // drop the code from the URL immediately
    if (error) throw new Error(params.get("error_description") || error);
    if (!saved || !state || state !== saved.state) {
      throw new Error("Sign-in could not be verified. Please try again.");
    }
    storeTokens(
      await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        code_verifier: saved.verifier,
      })
    );
  }

  function start() {
    if (!started) {
      started = (async () => {
        try {
          await processCallback();
        } catch (e) {
          lastError = e;
        }
      })();
    }
    return started;
  }

  function notify(error) {
    listeners.forEach((cb) => cb(currentUser, error || null));
  }

  /** Like Firebase's onAuthStateChanged: cb(user|null, error|null), now and on later changes. */
  function onAuthReady(cb) {
    listeners.push(cb);
    start().then(() => {
      const error = lastError;
      lastError = null;
      cb(currentUser, error);
    });
  }

  /** Returns a valid access token, refreshing it first if it is about to expire. */
  async function getAccessToken() {
    if (!tokens) throw new Error("Not signed in.");
    if (tokens.expiresAt - Date.now() > REFRESH_MARGIN_MS) return tokens.accessToken;

    if (!tokens.refreshToken) {
      expireSession("Your session expired. Please sign in again.");
      throw new Error("Your session expired. Please sign in again.");
    }
    if (!refreshing) {
      refreshing = tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refreshToken })
        .then(storeTokens)
        .catch((err) => {
          expireSession("Your session expired. Please sign in again.");
          throw err;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    await refreshing;
    return tokens.accessToken;
  }

  /** Forget the session locally (used on 401s and failed refreshes). */
  function expireSession(message) {
    tokens = null;
    currentUser = null;
    notify(message ? new Error(message) : null);
  }

  /** Ends the Cognito session too, then returns to the sign-in screen. */
  function signOutUser() {
    const c = config();
    tokens = null;
    currentUser = null;
    if (!c) return notify(null);
    const params = new URLSearchParams({ client_id: c.clientId, logout_uri: redirectUri() });
    global.location.assign(`${c.cognitoDomain}/logout?${params.toString()}`);
  }

  global.initAuth = initAuth;
  global.signInWithGoogle = signInWithGoogle;
  global.signOutUser = signOutUser;
  global.onAuthReady = onAuthReady;
  global.SafeScribeAuth = {
    getAccessToken,
    expireSession,
    // exposed for tests
    buildAuthorizeUrl,
    pkceChallenge,
    decodeJwtPayload,
  };
})(typeof window !== "undefined" ? window : globalThis);
