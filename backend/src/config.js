"use strict";
const path = require("node:path");

/**
 * Reads configuration from environment variables. Nothing secret is needed:
 * AWS credentials come from the instance role (default credential chain), and the
 * Cognito pool/client/domain identifiers are public values.
 */
function loadConfig(env = process.env) {
  const required = (key) => {
    const value = env[key];
    if (!value || !value.trim()) throw new Error(`Missing required environment variable ${key}`);
    return value.trim();
  };

  const domain = required("COGNITO_DOMAIN").replace(/\/+$/, "");
  if (!/^https:\/\//.test(domain)) {
    throw new Error("COGNITO_DOMAIN must be a full https:// URL, e.g. https://example.auth.us-east-1.amazoncognito.com");
  }

  return {
    port: Number(env.PORT || 8080),
    metricsPort: Number(env.METRICS_PORT || 9464),
    appVersion: env.APP_VERSION || "dev",
    tableName: env.NOTES_TABLE || "SafeScribeNotes",
    awsRegion: env.AWS_REGION || "us-east-1",
    ddbEndpoint: env.DDB_ENDPOINT || undefined, // only for local testing
    frontendDir: env.FRONTEND_DIR || path.resolve(__dirname, "../../frontend"),
    maxCiphertextBytes: 300 * 1024, // DynamoDB items are limited to 400 KB
    cognito: {
      userPoolId: required("COGNITO_USER_POOL_ID"),
      clientId: required("COGNITO_CLIENT_ID"),
      domain,
    },
  };
}

module.exports = { loadConfig };
