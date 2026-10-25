"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");
const CryptoJS = require(path.resolve(__dirname, "../vendor/crypto-js.js"));

const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;
const PASSWORD = "correct horse battery staple";
const payload = JSON.stringify({ title: "Gröceries ✓", body: "milk\nbread\n日本語" });

test("vendored CryptoJS is 4.2.0 and round-trips the app's note payload", () => {
  const ciphertext = CryptoJS.AES.encrypt(payload, PASSWORD).toString();
  assert.ok(ciphertext.startsWith("U2FsdGVkX1"), "OpenSSL 'Salted__' format");
  const plain = CryptoJS.AES.decrypt(ciphertext, PASSWORD).toString(CryptoJS.enc.Utf8);
  assert.equal(plain, payload);
  // A wrong password must never reveal the note. CryptoJS may return "", throw "Malformed UTF-8",
  // or (rarely) return garbage depending on the random salt, so assert the property, not one outcome.
  let recovered;
  try {
    recovered = CryptoJS.AES.decrypt(ciphertext, "wrong").toString(CryptoJS.enc.Utf8);
  } catch {
    recovered = null;
  }
  assert.notEqual(recovered, payload);
});

test("ciphertext format is the OpenSSL passphrase format (existing notes stay readable)", { skip: !hasOpenssl }, () => {
  const args = ["enc", "-d", "-aes-256-cbc", "-md", "md5", "-a", "-A", "-pass", `pass:${PASSWORD}`];
  const ciphertext = CryptoJS.AES.encrypt(payload, PASSWORD).toString();
  const out = execFileSync("openssl", args, { input: ciphertext }).toString("utf8");
  assert.equal(out, payload, "OpenSSL must decrypt what CryptoJS encrypted");
});

test("CryptoJS decrypts ciphertext produced independently by OpenSSL", { skip: !hasOpenssl }, () => {
  const args = ["enc", "-aes-256-cbc", "-md", "md5", "-salt", "-a", "-A", "-pass", `pass:${PASSWORD}`];
  const ciphertext = execFileSync("openssl", args, { input: payload }).toString("utf8").trim();
  assert.equal(CryptoJS.AES.decrypt(ciphertext, PASSWORD).toString(CryptoJS.enc.Utf8), payload);
});
