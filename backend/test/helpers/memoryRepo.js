"use strict";
const crypto = require("node:crypto");

/** In-memory stand-in with the same interface as notesRepo, used for HTTP-level tests. */
function createMemoryRepo() {
  const users = new Map(); // userId -> Map(noteId -> note)
  const bucket = (userId) => {
    if (!users.has(userId)) users.set(userId, new Map());
    return users.get(userId);
  };
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + clock++ * 1000).toISOString();

  return {
    async list(userId) {
      return [...bucket(userId).values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },
    async create(userId, ciphertext) {
      const now = stamp();
      const note = { id: crypto.randomUUID(), ciphertext, createdAt: now, updatedAt: now };
      bucket(userId).set(note.id, note);
      return note;
    },
    async update(userId, id, ciphertext) {
      const existing = bucket(userId).get(id);
      if (!existing) return null;
      const note = { ...existing, ciphertext, updatedAt: stamp() };
      bucket(userId).set(id, note);
      return note;
    },
    async remove(userId, id) {
      return bucket(userId).delete(id);
    },
  };
}

module.exports = { createMemoryRepo };
