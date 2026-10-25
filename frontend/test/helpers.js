"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const FRONTEND = path.resolve(__dirname, "..");
const b64u = (value) => Buffer.from(value).toString("base64url");
const fakeJwt = (payload) => `${b64u(JSON.stringify({ alg: "none" }))}.${b64u(JSON.stringify(payload))}.sig`;

/** Loads frontend/<file> into a browser-like sandbox and returns the sandbox. */
function loadScript(file, extra = {}) {
  const sandbox = {
    console,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    Date,
    Promise,
    crypto: webcrypto,
    ...extra,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(FRONTEND, file), "utf8"), sandbox, { filename: file });
  return sandbox;
}

module.exports = { FRONTEND, b64u, fakeJwt, loadScript, vm };
