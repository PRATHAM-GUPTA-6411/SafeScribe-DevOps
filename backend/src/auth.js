"use strict";
const { CognitoJwtVerifier } = require("aws-jwt-verify");

/**
 * Verifies Cognito *access* tokens: signature (JWKS), issuer, expiry,
 * token_use === "access" and client_id. The JWKS is fetched from Cognito over
 * the internet, so instances need outbound access (public subnet, no NAT).
 */
function createTokenVerifier({ userPoolId, clientId }) {
  const verifier = CognitoJwtVerifier.create({ userPoolId, tokenUse: "access", clientId });
  return {
    verifier, // exposed so tests can preload a local JWKS
    async verify(token) {
      return verifier.verify(token);
    },
  };
}

/** Express middleware. The user id always comes from the verified token, never from the request. */
function requireAuth(verifyToken, logger) {
  return async (req, res, next) => {
    const header = req.get("authorization") || "";
    const match = /^Bearer ([^\s]+)$/i.exec(header);
    if (!match) {
      res.set("WWW-Authenticate", "Bearer");
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      const payload = await verifyToken(match[1]);
      if (!payload || typeof payload.sub !== "string" || !payload.sub) throw new Error("token has no subject");
      req.userId = payload.sub;
      return next();
    } catch (err) {
      // Log the failure class only, never the token.
      logger.warn("token rejected", { reason: err && err.name ? err.name : "Error", path: req.path });
      res.set("WWW-Authenticate", 'Bearer error="invalid_token"');
      return res.status(401).json({ error: "unauthorized" });
    }
  };
}

module.exports = { createTokenVerifier, requireAuth };
