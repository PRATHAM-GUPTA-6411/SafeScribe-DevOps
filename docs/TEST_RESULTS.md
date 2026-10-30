# Test results

Only results that were actually executed are listed. Anything not run is listed under "Not verified".

## Phase 2: application migration (executed 25 Oct 2026, Node 22.22.2, sandbox)

| Suite | Command | Result |
|---|---|---|
| Backend (API, auth, DynamoDB repo, server boot, UI end-to-end) | `cd backend && npm test` | **37 passed, 0 failed** |
| Frontend (sign-in logic, service worker, CryptoJS vs OpenSSL) | `node --test "frontend/test/**/*.test.js"` | **22 passed, 0 failed** |
| Dependency audit (production) | `cd backend && npm audit --omit=dev` | 0 vulnerabilities |
| Syntax | `node --check` on every shipped JS file | OK |

### What the tests prove

- **Token verification** uses the real `aws-jwt-verify` code with a locally generated RSA key. Rejected: expired token, wrong app client, wrong issuer, ID token used as access token, wrong signing key, `alg=none`, tampered payload, garbage.
- **Ownership**: user B cannot list, update or delete user A's notes; the owner is the token's `sub` even if the body or query claims another user.
- **DynamoDB code** runs through the real AWS SDK against `dynalite` (a DynamoDB emulator): CRUD, conditional update/delete, ordering, per-user isolation, pagination beyond one 1 MB query page, a 300 KB note round trip.
- **Server process** (`src/server.js`) boots, serves `/health` and `/config.js`, keeps `/metrics` off the public port, exits 0 on SIGTERM, and refuses to start with missing configuration.
- **Logs and metrics** never contain tokens, query strings or ciphertext.
- **Service worker**: never handles `/api/*`, `/config.js`, `/health`, cross-origin or non-GET requests; every precache file exists.
- **CryptoJS 4.2.0 (vendored)** is byte-identical to the npm package, and ciphertext is decryptable by OpenSSL and vice versa, so the existing note format is unchanged.
- **End-to-end UI journey (jsdom)**: sign-in callback, unlock, create, debounced autosave, reload and decrypt, wrong vault password, delete, two users isolated, expired token. The server-side record is ciphertext only and decrypts with the vault password.

### Defects found by testing (and fixed)

1. **Original service worker caches API responses.** Proven by running the original `service-worker.js` against `/api/notes`: it cached the URL even when the response was `no-store`. Fixed in `frontend/service-worker.js`.
2. **Stale unlock screen after session expiry.** The end-to-end test showed that after a 401 the app signed the user out but then returned to the unlock screen. Fixed with a guard in `frontend/app.js`.

3. **A flaky test of mine (not an app bug).** The CryptoJS test assumed a wrong password always decrypts to an empty string. Measured over 4000 trials it returns `""` about 74% of the time, throws "Malformed UTF-8" about 26%, and returns non-empty garbage about 0.5%, depending on the random salt. The app handles all three the same way (all end in "could not decrypt"; 2000 trials never recovered the note). The test now asserts that a wrong password never recovers the text, and passed 60 consecutive runs.

4. **`icon.svg` altered by something outside the project.** Found by comparing against the original zip: an 8,372-byte file with an embedded C2PA metadata block instead of the original 598 bytes. Restored; `frontend/test/provenance.test.js` now checks the six unchanged original files by SHA-256 (and was confirmed to fail on the altered icon).

### Sanity check on the tests themselves

Two protections were deliberately broken to confirm the tests notice: trusting a `userId` from the request body (test "owner comes from the token" failed) and allowing API responses to be cached (test "API responses are never cacheable" failed). Both were reverted.

## Phase 3: Docker (executed 25 Oct 2026; Docker itself was NOT available)

| Check | Result |
|---|---|
| `hadolint` 2.15.1 on `Dockerfile` and `docker/dynalite/Dockerfile` | clean |
| `docker compose config` with all variables set / with `COGNITO_*` missing | succeeds / fails with a clear message |
| Node base image tag `22.23.4-alpine3.24` | exists in the official image manifest |
| Hand-built image layout (same COPY set, `.dockerignore` applied, `npm ci --omit=dev`), root-owned and read-only, run as uid 1000 | `/health` 200 with version, `/` and assets 200, tests and README 404, `/api/notes` 401, `/metrics` 404 on the public port and 200 on 9464, healthcheck command exit 0 while running and 1 after stop, SIGTERM exit 0, `dynalite` and `jsdom` absent |
| `docker/dynalite/server.js` | creates `SafeScribeNotes` with keys `userId`/`noteId`, repo create/list/delete works against it, SIGTERM exit 0 |

This is a simulation of the image, not the image. The real build is first exercised in Phase 4 CI.

## Phase 4: CI with GitHub Actions (executed 25 Oct 2026; the workflow has NOT yet run on GitHub)

| Check | Result |
|---|---|
| ESLint 10 on the whole repo | clean after fixing 7 findings (unused catch variables, two unused test arguments, one unused import) |
| All suites after the lint fixes | 37 backend and 29 frontend tests pass |
| `actionlint` 1.7.12 with `shellcheck` 0.11.0 on `ci.yml` | clean; also confirmed to fail on a deliberately broken copy |
| `shellcheck` on `scripts/ci-smoke-test.sh` | clean |
| Pinned tool checksums in the workflow (hadolint, gitleaks, actionlint) | match the files that were downloaded and run |
| Pinned action commits (`checkout` v7.0.1, `setup-node` v7.1.0) | commit SHAs read from the official repositories; the inputs used exist at those commits |
| `gitleaks` 8.30.1 on the project | clean with the narrow exception; fails without it (control). Planted AWS keys, a Google key and a generic key in other files are all caught, including one deleted in a later commit. Simulated real history (key at the old and new path) passes |
| `scripts/ci-smoke-test.sh` against a fake `docker` driving the real server in the simulated image | all checks pass; five deliberate breakages (wrong version, tests shipped, dev dependency shipped, unclean SIGTERM, crash on start) each fail the script; passes again once repaired |
| The workflow's real `cfn-lint` step (cfn-lint 1.58.0) | no templates: skips, exit 0. Valid nested template: exit 0. Broken template: exit non-zero with 3 errors |

### Decisions and corrections

- **Secret scan found the Firebase web API key** in the legacy `firebase.js`. It is a public identifier by design, already in the repository history, and the file is pinned by SHA-256. A single narrow exception was added (two rules, two paths) rather than disabling the scan. The key could additionally be restricted by HTTP referrer in the Google Cloud console.
- **Correction to my own earlier note:** gitleaks does auto-discover `.gitleaks.toml`; my first failed attempt was an incomplete rule list. The workflow still passes `--config` explicitly.

## Phase 5: AWS foundation templates (executed 25 Oct 2026; NOTHING has been deployed to AWS)

| Check | Result |
|---|---|
| `cfn-lint` 1.58.0 on `network.yaml`, `storage.yaml`, `auth.yaml` | clean |
| Template tests (`npm run test:infra`, 15 tests) | pass: no IAM resources, no secrets or account ids in templates, no SSH anywhere, only the load balancer group open to the internet (80/443), app instances reachable only from the load balancer and the monitoring group, no NAT gateway or Elastic IP, table keys and name match the application code, ECR scan-on-push and immutable tags, Google-only sign-in with no self-registration, public PKCE client with no password flows, scopes and claims match `frontend/auth.js`, the Google secret is masked and referenced once |
| Mutation check on the templates | six deliberate breaks (SSH opened, app port opened to the world, secret loses NoEcho, table name drift, password flow enabled, NAT gateway added), each caught by the matching test |
| `scripts/aws/foundation.sh` against a fake AWS CLI (37 checks) | pass: validates before deploying, correct stack order and parameters, secret never printed (also when typed interactively), region guard, prefix rules, failed first deployments cleaned up, a failing stack stops the run, `status` warnings and "could not check" honesty, `destroy` needs `DELETE` and deletes in reverse order |
| Mutation check on the script | eight deliberate breaks (secret printed, region guard removed, destroy order reversed, confirmation removed, "all clear" on failed checks, template validation skipped, failed-stack cleanup removed, prefix rules removed), each caught by the matching checks |
| `shellcheck` 0.11.0 on all scripts, ESLint, `actionlint` | clean |

### Defects found while testing (fixed)

- **Executable bits.** The deploy-script test copied its fake `aws` command and relied on it being executable. It passed in the working folder but failed 15 of 37 checks from a clean unzip, because zip files and Windows Git do not keep executable bits (CI would have hit the same). The test now sets the bit itself and was re-run with every executable bit stripped. All scripts are invoked as `bash script.sh`, never directly.
- **Test harness hang.** With the region guard deliberately removed, the script waited at a prompt and my mutation run timed out (and left the script mutated until I restored it). The harness now closes stdin and applies a time limit to every run.

## Not verified

- Real Cognito: token verification against live Cognito keys, Google sign-in, the managed login redirect. Only a local key and a stand-in token endpoint were used.
- Real DynamoDB (an emulator was used: no throttling, IAM or latency behaviour).
- A real browser: jsdom does not enforce the Content-Security-Policy, run the service worker, or show the layout. A static scan found nothing the CSP should block (no inline handlers/styles, no external URLs, system fonts only), but this is unconfirmed in a browser.
- A local `docker run` / `docker compose up` of the full stack with a real Cognito pool. The image itself was built and smoke-tested by CI on a real GitHub runner: the team reported all four Phase 4 jobs green on the first pull request (I did not see the logs, and the image size has not been recorded).
- **The Phase 5 additions to CI have not run on GitHub yet:** template tests, deploy-script tests, shellcheck, and `cfn-lint` on real templates (each was run locally). The next pull request is their first real run.
- **Everything on real AWS.** The templates were never deployed. Unknown until the first deploy: whether the Learner Lab permits every resource (Cognito domain and Google provider through CloudFormation, ECR with `EmptyOnDelete`, DynamoDB), whether the chosen hosted-login prefix is free, and whether Google sign-in completes through Cognito (the printed test address checks this).
- ALB, Auto Scaling, Prometheus/Grafana, load testing: later phases.
