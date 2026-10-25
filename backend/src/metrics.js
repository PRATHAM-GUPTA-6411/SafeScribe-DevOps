"use strict";
const client = require("prom-client");

/**
 * Prometheus metrics. They are served on a separate internal port (see server.js),
 * never through the public load balancer.
 */
function createMetrics(version) {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const duration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  const total = new client.Counter({
    name: "http_requests_total",
    help: "Total HTTP requests",
    labelNames: ["method", "route", "status_code"],
    registers: [registry],
  });
  new client.Gauge({
    name: "safescribe_app_info",
    help: "Application version (value is always 1)",
    labelNames: ["version"],
    registers: [registry],
  }).set({ version }, 1);

  const middleware = (req, res, next) => {
    const end = duration.startTimer();
    res.on("finish", () => {
      // Route template (e.g. /api/notes/:id) keeps label cardinality bounded.
      const route = req.route ? `${req.baseUrl || ""}${req.route.path}` : "other";
      const labels = { method: req.method, route, status_code: String(res.statusCode) };
      total.inc(labels);
      end(labels);
    });
    next();
  };

  return { registry, middleware };
}

module.exports = { createMetrics };
