# syntax=docker/dockerfile:1

# SafeScribe API + static frontend. Build context is the REPOSITORY ROOT:
#   docker build -t safescribe-api:local --build-arg APP_VERSION=local .
# Base image is pinned to an exact version (never "latest") for reproducible builds.

# ---- Stage 1: production dependencies only (no test tooling) ----
FROM node:22.23.4-alpine3.24 AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- Stage 2: runtime ----
FROM node:22.23.4-alpine3.24 AS runtime
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="safescribe-api" \
      org.opencontainers.image.source="https://github.com/PRATHAM-GUPTA-6411/SafeScribe-DevOps" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"

# No secrets here: AWS credentials come from the EC2 instance role at runtime, and
# the Cognito identifiers are passed with -e / the launch template.
ENV NODE_ENV=production \
    PORT=8080 \
    METRICS_PORT=9464 \
    APP_VERSION=${APP_VERSION} \
    FRONTEND_DIR=/app/frontend

WORKDIR /app/backend
# Files stay owned by root: the app can read them but not modify itself at runtime.
COPY --from=deps /app/backend/node_modules ./node_modules
COPY backend/package.json ./package.json
COPY backend/src ./src
COPY frontend /app/frontend

USER 1000:1000
# 8080 = app (published through the ALB). 9464 = Prometheus metrics (internal only; never publish publicly).
EXPOSE 8080 9464

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health',{signal:AbortSignal.timeout(2500)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "src/server.js"]
