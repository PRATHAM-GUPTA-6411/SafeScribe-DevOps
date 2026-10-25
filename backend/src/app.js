"use strict";
const crypto = require("node:crypto");
const express = require("express");
const helmet = require("helmet");
const { requireAuth } = require("./auth");

const NOTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns { ciphertext } or { status, error }. */
function readCiphertext(body, maxBytes) {
  if (!body || typeof body !== "object" || typeof body.ciphertext !== "string" || body.ciphertext.length === 0) {
    return { status: 400, error: "ciphertext must be a non-empty string" };
  }
  if (Buffer.byteLength(body.ciphertext, "utf8") > maxBytes) {
    return { status: 413, error: "note is too large" };
  }
  return { ciphertext: body.ciphertext };
}

/**
 * Builds the Express app. Everything environment-specific is injected so the same
 * code runs in production (Cognito + DynamoDB) and in tests (fakes).
 */
function createApp({ config, verifyToken, repo, logger, metrics }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind the ALB

  // Request id + metadata-only access log (never bodies, tokens, or query strings).
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    const requestId = crypto.randomUUID();
    res.set("X-Request-Id", requestId);
    res.on("finish", () => {
      logger.info("request", {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      });
    });
    next();
  });
  if (metrics) app.use(metrics.middleware);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", config.cognito.domain],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      strictTransportSecurity: { maxAge: 15552000 },
    })
  );

  // Liveness/readiness for the ALB target group. Deliberately does not call DynamoDB,
  // so a database hiccup cannot make the load balancer drain every instance.
  app.get("/health", (req, res) => {
    res.set("Cache-Control", "no-store").json({
      status: "ok",
      version: config.appVersion,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // Public, non-secret settings for the browser (Cognito domain and app client id).
  app.get("/config.js", (req, res) => {
    const publicConfig = {
      cognitoDomain: config.cognito.domain,
      clientId: config.cognito.clientId,
      appVersion: config.appVersion,
    };
    res
      .type("application/javascript")
      .set("Cache-Control", "no-store")
      .send(`window.SAFESCRIBE_CONFIG = ${JSON.stringify(publicConfig).replace(/</g, "\\u003c")};\n`);
  });

  // ---- API ----
  const api = express.Router();
  api.use((req, res, next) => {
    res.set("Cache-Control", "no-store"); // encrypted notes must never be cached anywhere
    next();
  });
  api.use(requireAuth(verifyToken, logger));
  api.use(express.json({ limit: "400kb" }));

  api.get("/notes", async (req, res) => {
    res.json({ notes: await repo.list(req.userId) });
  });

  api.post("/notes", async (req, res) => {
    const parsed = readCiphertext(req.body, config.maxCiphertextBytes);
    if (parsed.error) return res.status(parsed.status).json({ error: parsed.error });
    res.status(201).json(await repo.create(req.userId, parsed.ciphertext));
  });

  api.put("/notes/:id", async (req, res) => {
    if (!NOTE_ID.test(req.params.id)) return res.status(404).json({ error: "not found" });
    const parsed = readCiphertext(req.body, config.maxCiphertextBytes);
    if (parsed.error) return res.status(parsed.status).json({ error: parsed.error });
    const note = await repo.update(req.userId, req.params.id, parsed.ciphertext);
    if (!note) return res.status(404).json({ error: "not found" });
    res.json(note);
  });

  api.delete("/notes/:id", async (req, res) => {
    if (!NOTE_ID.test(req.params.id)) return res.status(404).json({ error: "not found" });
    const removed = await repo.remove(req.userId, req.params.id);
    if (!removed) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  });

  api.use((req, res) => res.status(404).json({ error: "not found" }));
  app.use("/api", api);

  // ---- Static frontend (same origin as the API, so no CORS) ----
  app.use(express.static(config.frontendDir));
  app.use((req, res) => res.status(404).type("text/plain").send("Not found"));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode;
    if (status && status >= 400 && status < 500) {
      const message = err.type === "entity.too.large" ? "payload too large" : "bad request";
      return res.status(status).json({ error: message });
    }
    logger.error("unhandled error", { name: err.name, message: err.message, path: req.path });
    res.status(500).json({ error: "internal error" });
  });

  return app;
}

module.exports = { createApp };
