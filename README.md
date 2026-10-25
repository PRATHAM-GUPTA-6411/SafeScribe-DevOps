# SafeScribe-DevOps

AWS cloud deployment, CI/CD automation, Auto Scaling and monitoring for **SafeScribe**,
a client-side-encrypted notes app. University project for *Essentials in Cloud and DevOps*.

> The original SafeScribe project is **not modified** by this repository. This is a separate
> copy used as the starting point. See `docs/PROVENANCE.md`.

## Status (honest)

| Phase | State |
|---|---|
| 0 Audit | Done: `docs/INITIAL_AUDIT.md` |
| 1 Isolated clone | Done |
| 2 Application migration (API, DynamoDB code, Cognito sign-in) | Done and tested locally: `docs/TEST_RESULTS.md`. Not yet run against real Cognito or DynamoDB. |
| 3 Docker | Files written and statically verified (`docs/DOCKER.md`). Real `docker build` not yet run. |
| 4 to 10 | Not started. Nothing is deployed. No AWS resources exist. |

## Layout

```
frontend/   SafeScribe UI. auth.js (Cognito) and api.js (REST) replaced the Firebase code; CryptoJS is vendored
backend/    Node.js API: token verification, DynamoDB access, metrics, tests
docker/      development-only local DynamoDB emulator image (used by docker-compose.yml)
legacy/     original Firebase artefacts, kept for reference only
docs/       audit, API, test results, provenance, original README
```

## Run the tests

```bash
cd backend && npm ci && npm test
cd .. && node --test "frontend/test/**/*.test.js"
```

Container: `docker build -t safescribe-api:local .` or `docker compose up --build` (see `docs/DOCKER.md`).

Running the app for real needs a Cognito user pool and a DynamoDB table (created in Phase 5); see `docs/API.md`.
