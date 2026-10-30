# Team workflow and CI

## Branches and pull requests

1. Never commit straight to `main`. Create a branch: `git checkout -b feature/<short-name>`.
2. Commit small, with a message that says what and why. Commits carry your own name, so the history shows who did the work.
3. Push the branch and open a pull request. CI starts automatically.
4. Merge only when CI is green and a teammate has looked at it.

## What CI checks (`.github/workflows/ci.yml`)

| Job | What it does |
|---|---|
| **Lint and test** | ESLint, frontend tests, infrastructure template tests, backend tests (API, token checks, DynamoDB code, server boot, UI end-to-end), `npm audit` on production dependencies |
| **Docker build and smoke test** | `hadolint`, `docker compose config`, builds the API image with the commit SHA as its version, starts it read-only and non-root, and checks health, version, 401 without a token, `/metrics` not public, no tests or dev packages in the image, clean shutdown |
| **Secret scan** | `gitleaks` over the whole Git history (`.gitleaks.toml` holds the one documented exception) |
| **Validate workflows and CloudFormation** | `actionlint` on the workflows, `shellcheck` on all scripts, the AWS deploy-script tests, `cfn-lint` on `infrastructure/**/*.yaml` |

Properties of the pipeline: read-only token (`contents: read`), no secrets, no AWS access, third-party actions pinned to commit SHAs, downloaded tools pinned to a version and a SHA-256, one run per branch at a time.

## Reproduce CI locally

```bash
npm ci && npm ci --prefix backend
npm run lint
npm test                      # frontend, then backend
```

## Branch protection (set once, after the first CI run has appeared)

GitHub, repository **Settings, Branches, Add branch ruleset** for `main`:

- Require a pull request before merging
- Require status checks to pass: `Lint and test`, `Docker build and smoke test`, `Secret scan`, `Validate workflows and CloudFormation`
- Block force pushes
- Once teammates have joined: require 1 approval

## If CI fails

Open the failed job, read the first red step, fix on your branch, push again. Do not weaken or delete a check to get a green tick. If a check looks wrong, say so in the pull request.
