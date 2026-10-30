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
| 4 CI | Workflow written and its parts tested locally (`docs/WORKFLOW.md`). Not yet run on GitHub. |
| 5 AWS foundation | Templates and deploy script written and tested locally (`docs/AWS_DEPLOY.md`). Not yet deployed. |
| 6 to 10 | Not started. No AWS resources exist yet. |

## Layout

```
frontend/   SafeScribe UI. auth.js (Cognito) and api.js (REST) replaced the Firebase code; CryptoJS is vendored
backend/    Node.js API: token verification, DynamoDB access, metrics, tests
docker/      development-only local DynamoDB emulator image (used by docker-compose.yml)
legacy/     original Firebase artefacts, kept for reference only
.github/    CI workflow and pull request template
infrastructure/  CloudFormation templates and their tests
scripts/    CI smoke test for the Docker image; scripts/aws/ deploys the foundation from CloudShell
docs/       audit, API, Docker, workflow, test results, provenance, original README
```

## Run the tests

```bash
npm ci && npm ci --prefix backend
npm run lint
npm test                  # frontend, infrastructure templates, backend
```

Container: `docker build -t safescribe-api:local .` or `docker compose up --build` (see `docs/DOCKER.md`).

Running the app for real needs a Cognito user pool and a DynamoDB table (created in Phase 5); see `docs/API.md`.
