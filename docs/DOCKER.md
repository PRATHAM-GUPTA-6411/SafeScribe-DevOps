# Docker (Phase 3)

One image contains the Node.js API **and** the static frontend (same origin, no CORS). The ALB forwards to it; Cognito and DynamoDB are external services.

## Image design

| Choice | Detail |
|---|---|
| Base | `node:22.23.4-alpine3.24`, pinned to an exact version (checked against the official image manifest), never `latest` |
| Build | Multi-stage: production dependencies only (`npm ci --omit=dev`); no test tools, tests or docs in the image |
| User | Non-root, numeric `1000:1000` |
| Filesystem | App files owned by root and not writable. Compose also runs it with `read_only: true`, `cap_drop: ALL`, `no-new-privileges` |
| Secrets | None in the image. Cognito identifiers come from environment variables, AWS credentials from the EC2 instance role |
| Version | `--build-arg APP_VERSION=<git sha>` is baked in and reported by `/health`; also set as OCI labels |
| Health | `HEALTHCHECK` calls `/health` with Node (no curl in the image) |
| Ports | 8080 app (published via the ALB). 9464 metrics (internal only: restrict in the security group, never publish) |
| Shutdown | SIGTERM handled; exits 0 within 10 s. Use `docker run --init` or compose `init: true` |

## Build and run one container

```bash
docker build -t safescribe-api:local --build-arg APP_VERSION=local .
docker run -d --name ss-test -p 8080:8080 \
  -e COGNITO_USER_POOL_ID=us-east-1_Abc123 -e COGNITO_CLIENT_ID=abc \
  -e COGNITO_DOMAIN=https://x.auth.us-east-1.amazoncognito.com \
  safescribe-api:local
```

The three Cognito values above are placeholders, enough to start and check the container. Real sign-in needs your real user pool (Phase 5).

## Local stack with docker compose

```bash
cp .env.example .env        # fill in the three COGNITO_* values from a real user pool
docker compose up --build   # API on http://localhost:8080, in-memory DynamoDB emulator behind it
```

`docker/dynalite/` is a **development-only** in-memory DynamoDB emulator that pre-creates the `SafeScribeNotes` table. It is never deployed to AWS.
For local sign-in, add `http://localhost:8080/` as both a callback URL and a sign-out URL on the Cognito app client (Cognito allows plain `http` for `localhost` only).

## Verification status

| Check | Status |
|---|---|
| Dockerfile and emulator Dockerfile pass `hadolint` 2.15.1 | **Verified** (clean) |
| `docker compose config` accepts the file and refuses to start when a `COGNITO_*` value is missing | **Verified** (compose v5.6.1) |
| Base image tag exists | **Verified** against the official `docker-library` manifest |
| Image layout simulated by hand (same COPY set, `.dockerignore` applied, `npm ci --omit=dev`), made read-only and run as uid 1000 with the image's environment: `/health`, static files, `/config.js`, `401` without a token, tests absent, `/metrics` only on the internal port, healthcheck command returns 0 then 1, SIGTERM exit 0 | **Verified in a simulation, not in Docker** |
| Emulator script creates the correct table; the API's DynamoDB code works against it | **Verified** (run with Node, not in Docker) |
| `docker build`, `docker run`, `docker compose up`, real HEALTHCHECK status, image size | **NOT verified.** Docker is not available where this was built. CI (Phase 4) builds the image on a Linux runner, which will be the first real proof |

## Prove it yourself on Windows (needs Docker Desktop)

```powershell
docker build -t safescribe-api:local --build-arg APP_VERSION=local .
docker run -d --name ss-test -p 8080:8080 `
  -e COGNITO_USER_POOL_ID=us-east-1_Abc123 -e COGNITO_CLIENT_ID=abc `
  -e COGNITO_DOMAIN=https://x.auth.us-east-1.amazoncognito.com safescribe-api:local
Start-Sleep 15
docker ps --filter name=ss-test          # STATUS should contain (healthy)
curl.exe http://localhost:8080/health    # {"status":"ok","version":"local",...}
docker exec ss-test id                   # uid=1000(node)
docker images safescribe-api:local       # note the SIZE
docker stop ss-test
docker inspect ss-test --format "{{.State.ExitCode}}"   # 0 means clean SIGTERM shutdown
docker rm ss-test
```
