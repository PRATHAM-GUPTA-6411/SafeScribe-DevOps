"use strict";
const crypto = require("node:crypto");

const b64u = (value) => Buffer.from(value).toString("base64url");

/** Generates an RSA key pair plus the matching public JWKS. */
function makeKey(kid = "test-kid") {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  return { kid, privateKey, jwks: { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] } };
}

/** Signs a JWT (RS256). Pass header overrides to build deliberately broken tokens. */
function signJwt(key, payload, headerOverrides = {}) {
  const header = { alg: "RS256", typ: "JWT", kid: key.kid, ...headerOverrides };
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(input), key.privateKey);
  return `${input}.${b64u(signature)}`;
}

module.exports = { makeKey, signJwt, b64u };
