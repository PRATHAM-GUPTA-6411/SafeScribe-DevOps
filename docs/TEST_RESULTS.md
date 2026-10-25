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

## Not verified

- Real Cognito: token verification against live Cognito keys, Google sign-in, the managed login redirect. Only a local key and a stand-in token endpoint were used.
- Real DynamoDB (an emulator was used: no throttling, IAM or latency behaviour).
- A real browser: jsdom does not enforce the Content-Security-Policy, run the service worker, or show the layout. A static scan found nothing the CSP should block (no inline handlers/styles, no external URLs, system fonts only), but this is unconfirmed in a browser.
- A real `docker build` / `docker run` / `docker compose up`, the real HEALTHCHECK status and the image size (no Docker here; see `docs/DOCKER.md` for how to check on your machine).
- **The CI workflow itself has never run on GitHub.** Not verified: the `actions/checkout` and `actions/setup-node` steps (cache behaviour), `docker compose config` and the Docker build and smoke test on a real runner (the smoke script was tested against a fake `docker`), and `npm ci` timing. The first pull request will be the first real run.
- AWS deployment, ALB, Auto Scaling, Prometheus/Grafana, load testing: later phases.
