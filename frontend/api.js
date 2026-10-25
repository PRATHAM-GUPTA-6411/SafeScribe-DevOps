/**
 * api.js — note storage through the SafeScribe API.
 *
 * Replaces the Firestore part of the original firebase.js. Callers pass ciphertext
 * only (encrypted in app.js); the API never sees note text or the vault password.
 * The signed-in user is identified by the access token, not by an id sent by the browser.
 */
(function (global) {
  "use strict";

  async function request(method, path, body) {
    const token = await global.SafeScribeAuth.getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await global.fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    if (res.status === 401) {
      const message = "Your session expired. Please sign in again.";
      global.SafeScribeAuth.expireSession(message);
      throw new Error(message);
    }
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const data = await res.json();
        if (data && data.error) message = data.error;
      } catch (e) {
        /* keep the generic message */
      }
      throw new Error(message);
    }
    return res.status === 204 ? null : res.json();
  }

  const noteUrl = (id) => `/api/notes/${encodeURIComponent(id)}`;

  /** -> [{ id, ciphertext, createdAt, updatedAt }] newest-updated first */
  global.listEncryptedNotes = async () => (await request("GET", "/api/notes")).notes;
  /** -> { id, ciphertext, createdAt, updatedAt } */
  global.createEncryptedNote = (ciphertext) => request("POST", "/api/notes", { ciphertext });
  global.updateEncryptedNote = (id, ciphertext) => request("PUT", noteUrl(id), { ciphertext });
  global.deleteEncryptedNote = (id) => request("DELETE", noteUrl(id));
})(typeof window !== "undefined" ? window : globalThis);
