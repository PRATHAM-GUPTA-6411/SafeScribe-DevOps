"use strict";
const express = require("express");
const { loadConfig } = require("./config");
const { createLogger } = require("./logger");
const { createTokenVerifier } = require("./auth");
const { createNotesRepo } = require("./notesRepo");
const { createMetrics } = require("./metrics");
const { createApp } = require("./app");

const logger = createLogger();

function main() {
  const config = loadConfig();
  const metrics = createMetrics(config.appVersion);
  const tokenVerifier = createTokenVerifier(config.cognito);
  const repo = createNotesRepo({
    tableName: config.tableName,
    region: config.awsRegion,
    endpoint: config.ddbEndpoint,
  });

  const app = createApp({
    config,
    verifyToken: (token) => tokenVerifier.verify(token),
    repo,
    logger,
    metrics,
  });
  const server = app.listen(config.port, () =>
    logger.info("api listening", { port: config.port, version: config.appVersion })
  );

  // Metrics live on their own port so the public ALB route can never expose them.
  const metricsApp = express();
  metricsApp.get("/metrics", async (req, res) => {
    res.set("Content-Type", metrics.registry.contentType).send(await metrics.registry.metrics());
  });
  const metricsServer = metricsApp.listen(config.metricsPort, () =>
    logger.info("metrics listening", { port: config.metricsPort })
  );

  // Graceful shutdown so the ASG / deployments never cut requests mid-flight.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down", { signal });
    const force = setTimeout(() => process.exit(1), 10000);
    force.unref();
    metricsServer.close();
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

try {
  main();
} catch (err) {
  logger.error("startup failed", { message: err.message });
  process.exit(1);
}
