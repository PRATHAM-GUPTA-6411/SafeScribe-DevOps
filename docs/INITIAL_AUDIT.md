# SafeScribe-DevOps: Initial Audit (Phase 0)

| | |
|---|---|
| Status | Phase 0 and Phase 1 complete. Revision 1 (lab-verified) added below. No data migrated, no AWS resource created. |
| Audited artefact | `SafeScribe-main.zip` supplied by the team (11 files, no `.git` directory) |
| Not audited | Live GitHub repository and its Git history (not available in this environment) |
| Audit date | 24 October 2026 |
| Evidence labels | **[Verified]** read directly from the source. **[Researched]** taken from public AWS documentation or pricing pages. **[Unverified]** needs a check in your actual Learner Lab account. |

---

## Revision 1 (24 Oct 2026): lab-verified changes. **Where this block conflicts with sections below, this block wins.**

**Evidence used:** the team's Learner Lab "Service usage and other restrictions" list, and live console tests in the team's lab (us-east-1).

| Finding | Evidence | Effect on plan |
|---|---|---|
| **CloudFront is blocked** | Console error: not authorized to perform `cloudfront:ListDistributions` | CloudFront and the S3+CloudFront hosting design are **removed**. |
| **Cognito works** | A test user pool and SPA app client were created. The managed login page loaded on a `*.auth.us-east-1.amazoncognito.com` domain. The Add Google provider form opened. | Cognito stays. **Not yet tested:** a full Google sign-in. The test pool is to be deleted by the team. |
| Cognito callback URLs must be HTTPS (except `localhost`) | Console text on the return-URL field | The ALB needs an HTTPS listener. |
| Lab budget is **$50**, sessions 4 h, EC2 stopped at session end, ELB keeps billing between sessions | Learner Lab home page | Delete stacks after each session. |
| Limits: max **9** running EC2, **32** vCPU. **20+ instances deactivates the account and deletes everything** | Service list | ASG max capped at 3, plus 1 monitoring instance (4 total). |
| Instance sizes nano to large; new public IP after restart | Service list | Prometheus uses EC2 service discovery. |
| ECR: LabRole is read-only, the console user can write | Service list | CD pushes with the team's lab credentials. EC2 pulls via `LabInstanceProfile`. **Unverified.** |
| No IAM role creation | Service list | Templates take `LabRole` / `LabInstanceProfile` as parameters. |
| Route 53 cannot register a domain; ACM is available | Service list | Real certificate only if the team brings an external domain. |

**Revised architecture (replaces the traffic flow in section 6):**

```
Browser --HTTPS--> ALB --> ASG instances (Docker: Node API + static frontend) --> DynamoDB
Browser --HTTPS--> Cognito managed login (Google federation) --> redirect to https://<ALB>/
Monitoring EC2: Prometheus (EC2 service discovery) + Grafana, not publicly exposed
```

- Frontend is served by the same container as the API (single origin, no CORS, no S3/CloudFront hosting). **S3 is now optional**, to be used only if the teacher requires it.
- **HTTPS without a domain:** import a self-signed certificate into ACM and attach it to the ALB. The browser shows a warning that the user clicks through. **Unverified:** that ACM import is permitted in the lab. With an external domain plus ACM, no warning.
- The Cognito app client is created in the same CloudFormation stack as the ALB so its callback URL follows the ALB address automatically. Exact structure to be validated in Phase 5.

**Decisions (defaults; the team may change any of them):**

| Id | Decision | Status |
|---|---|---|
| D1 | Add a small Node.js (current LTS) + Express API | Accepted by default |
| D2 | CloudFront front door replaced by ALB HTTPS (self-signed, or domain if available) | Resolved by lab test |
| D3 | Start with an empty database | Accepted by default |
| D4 | Tokens in memory only | Accepted by default |
| 7.4 | Sort in the API, no DynamoDB LSI | Accepted by default |
| New | Minimal scope: no React, no MongoDB, no NAT, no VPC endpoints, no JMeter, no SSH | Requested by the team |
| New | Monitoring is Prometheus + Grafana (not CloudWatch dashboards) | Teacher's instruction per the team |

**Still open:** the teacher has not given specific AWS requirements. The modules in the project specification are being treated as the requirements until she confirms. Team member names are still needed for `TEAM_CONTRIBUTIONS.md`.

**Phase 1 (done 24 Oct 2026):** isolated copy created, all 10 copied files verified byte-identical with `cmp`, original zip checksum unchanged before and after (`3215dc2a...09e5`), JS syntax check passed, static files served with HTTP 200. **Not tested:** real sign-in (needs a browser and the Firebase/Google flow).

---

## 1. Existing architecture [Verified]

SafeScribe is a **client-only single-page app with no backend of its own**. The browser talks directly to Firebase.

```
Browser (static files on GitHub Pages)
 ├─ CryptoJS 4.2.0 (cdnjs)       AES encrypt/decrypt of {title, body} with the vault password
 ├─ Firebase Auth (compat 10.13.2)  Google Sign-In (popup, redirect fallback)
 └─ Firestore (compat 10.13.2)      users/{uid}/notes/{noteId}  -> { ciphertext, createdAt, updatedAt }
```

- The vault password lives only in a JavaScript variable. It is never persisted or sent anywhere.
- Authorisation is enforced by `firestore.rules` (`request.auth.uid == userId`), not by any server code.
- Hosting is GitHub Pages under a sub-path. All asset paths are relative (`./`).

## 2. Technologies discovered [Verified]

| Item | Finding |
|---|---|
| Frontend framework | None. Vanilla HTML, CSS, JS (about 1,100 lines; `app.js` is a single IIFE). |
| Backend | None. |
| Package manager / lockfile | None. There is no `package.json`. |
| Build step | None. Files are served as written. |
| Tests / lint | None. |
| Runtime libraries | CryptoJS, `firebase-app-compat`, `firebase-auth-compat`, `firebase-firestore-compat`, all loaded from public CDNs (no SRI hashes). |
| PWA | `manifest.json` plus `service-worker.js` (cache `safescribe-v2`, app-shell caching). |
| Existing deployment config | None besides the README's GitHub Pages instructions. |
| File uploads / Firebase Storage | **None.** `storageBucket` appears in the config but no Storage API is used. |
| Environment variables | None. Firebase config is hardcoded in `firebase.js`. |

## 3. Features to preserve [Verified]

Google login, vault-password unlock/lock, note create/read/update/delete, 700 ms debounced autosave, note list with preview, sign out, installable PWA.

## 4. Firebase integration points [Verified]

| Location | Dependency | Replacement |
|---|---|---|
| `index.html` (3 `<script>` tags) | Firebase compat SDKs | Remove. Add a small local auth module. |
| `firebase.js` `firebaseConfig` | Project `safescribe-274bb` | Remove. Runtime `config.js` with Cognito and API settings. |
| `firebase.js` `initFirebase`, `isFirebaseConfigured` | Firebase init | Remove. |
| `firebase.js` `signInWithGoogle`, `signOutUser`, `onAuthReady` | Firebase Auth | Cognito hosted login (Authorization Code with PKCE). |
| `firebase.js` `createEncryptedNote`, `listEncryptedNotes`, `updateEncryptedNote`, `deleteEncryptedNote` | Firestore SDK | `fetch()` calls to a new REST API. |
| `app.js` boot block, `handleSignedIn`/`handleSignedOut`, `currentUser.uid`, `user.displayName/email/photoURL` | Firebase `User` object | Map from Cognito ID-token claims (`sub`, `name`, `email`, `picture`). |
| `service-worker.js` host bypass list | `googleapis`, `gstatic`, `firebaseio` | Replace with `/api/` and the Cognito domain (see risk R1). |
| `firestore.rules` | Authorisation | Moves into the backend (JWT verification plus per-user key condition). |

**Data model.** One item type: a note owned by a user. Access patterns: (1) list all of a user's notes ordered by `updatedAt` descending, (2) create, (3) update by id, (4) delete by id. There is no search, filter, sharing or cross-user query. Ciphertext is opaque to the server.

## 5. Files and modules requiring change

| File | Change |
|---|---|
| `index.html` | Drop Firebase scripts and CDN dependence. Load vendored CryptoJS and `config.js`. |
| `firebase.js` | Replace with `auth.js` and `api.js` (same function names where practical, so `app.js` changes stay small). |
| `app.js` | Minimal: auth wiring and the `.uid` and profile fields. Encryption and UI logic stay. |
| `service-worker.js` | Bypass `/api/*` and the Cognito domain. Bump cache version. |
| `firestore.rules` | Not carried over. Documented as superseded. |
| `README.md` | Rewrite for the DevOps edition. |
| New | `backend/`, `docker/`, `infrastructure/cloudformation/`, `monitoring/`, `.github/workflows/`, `scripts/`, `docs/` |

## 6. Proposed AWS replacements

> **Partly superseded by Revision 1:** CloudFront and the S3-hosted frontend are removed; HTTPS is on the ALB. Rows below that mention them are the original proposal.

| Spec item | Proposal | Notes |
|---|---|---|
| Frontend hosting | S3 (private) + CloudFront with Origin Access Control | Static files only. No framework build, so the "build" is an assemble-and-inject-config step. |
| Auth | Cognito User Pool + Google IdP + managed login, Authorization Code + PKCE | Cognito prefix domain gives HTTPS without owning a domain. |
| Backend | **New** small Node.js REST API in Docker on EC2 behind an ALB | Needed because no backend exists (see D1). |
| Database | DynamoDB, on-demand | PK `userId` (Cognito `sub`), SK `noteId`, plus an LSI on `updatedAt` (see 7.4). |
| File storage | **No uploads exist, so no upload subsystem will be invented.** S3 is used for frontend hosting. | Matches the spec's own instruction on this case. |
| Registry | ECR, tags = Git short SHA (and release tags) | No `latest` in deployments. |
| Network | VPC, 2 public subnets in 2 AZs, IGW, no NAT | Public subnets with SG restricted to the ALB. Documented as a compromise. |
| Load balancing | ALB, target group, `/health` check | HTTP behind CloudFront (see D2). |
| Scaling | Launch template + ASG, target-tracking on CPU | Initial values 1 / 1 / 3 (min/desired/max), to be confirmed against quotas and budget. |
| IaC | CloudFormation, several stacks | Reference `LabRole`/`LabInstanceProfile` instead of creating IAM (see 7.7). |
| Monitoring | Prometheus + Grafana in Docker on one small EC2, EC2 service discovery | Node Exporter on app instances, `/metrics` from the API. |
| Load test | k6 (single binary, scriptable, easy in CI) | JMeter is the alternative. |

### Target traffic flow (original proposal, superseded by Revision 1)

```
Browser --HTTPS--> CloudFront --+-- default  -> S3 (OAC, private)
                                +-- /api/*   -> ALB (HTTP, custom-header secret) -> ASG instances (Docker API) -> DynamoDB
Browser --HTTPS--> Cognito managed login (Google federation) -> redirect to CloudFront URL
Monitoring EC2: Prometheus (EC2 SD) scrapes instances on private/VPC-only ports; Grafana reached via SSM port-forward or IP-restricted SG
```

CloudFront serving both the site and `/api/*` makes the app same-origin over HTTPS. That avoids mixed-content blocking (an HTTPS page cannot call an HTTP ALB) and avoids needing CORS.

## 7. Potential migration problems

### 7.1 Blockers and decisions required before Phase 2
- **D1. A backend must be created.** The spec's Docker/ALB/ASG/Prometheus work needs a server process. The smallest reasonable choice is **Node.js (current LTS) + Express**, with `@aws-sdk/lib-dynamodb`, `aws-jwt-verify` and `prom-client`. This is a new component, not a rewrite of existing code. **Needs your approval.**
- **D2. (Resolved by Revision 1: CloudFront is blocked, so ALB HTTPS is used instead.) HTTPS for the API without a domain.** Browsers block an HTTPS page from calling a plain-HTTP ALB. Proposed fix: CloudFront as a single front door with `/api/*` routed to the ALB. Trade-off: the CloudFront-to-ALB hop is HTTP. Mitigation: ALB security group allows only the CloudFront origin-facing managed prefix list, plus a secret custom header checked at the API. A domain plus ACM certificate would remove this compromise. **Needs your confirmation that no domain is available.**
- **D3. Existing notes.** Do real users' notes in the original Firebase project need to be migrated? Ciphertext could be copied byte-for-byte, but it would need a read-only export from the original project (the only way to read other users' Firestore data is an admin credential for it, which conflicts with your "never touch the original" rule). **Recommendation: start empty in the DevOps edition.** **Needs your decision.**
- **D4. Token storage in the browser.** Today a page reload loses the vault password anyway. Proposal: keep tokens in memory only, accepting a re-login on reload. The alternative (refresh token in `sessionStorage`) is more convenient but weaker against XSS. **Needs your decision.**

### 7.2 Risks found in existing code that affect the migration
- **R1. Service worker will cache API responses.** The fetch handler caches every successful same-origin GET except `.js` and three Google hosts. Once `/api/notes` is same-origin, ciphertext responses would be written to Cache Storage and could be served as an offline fallback, including across users on one browser. Must be fixed before the API goes live.
- **R2. Unused UI code.** `btn-forgot`, `confirm-wrap`, `unlock-heading`, `unlock-lede` exist in HTML but are never referenced in JS. The "Forgot vault password?" button does nothing. Left as-is unless you ask (scope: DevOps, not UI).
- **R3. No vault-password verification.** A first-time user's typo silently becomes the key. Existing behaviour, flagged only. Fixing it changes data format, so not in scope.
- **R4. Weak key derivation.** CryptoJS `AES.encrypt(text, password)` uses a passphrase KDF with a single MD5 iteration. Flagged in `SECURITY.md` as a known limitation of the inherited app. Changing it would change the ciphertext format.
- **R5. CDN dependencies without SRI.** Firebase scripts go away. CryptoJS will be vendored into the build.
- **R6. Minor:** `notesCache.sort` in `saveCurrentNote` reorders by selected id, not `updatedAt`.

### 7.3 Auth migration
- Cognito `sub` replaces the Firebase `uid`. Any copied data would need re-keying.
- Google redirect URI registered in Google Cloud Console is the Cognito domain's `/oauth2/idpresponse`. The app callback and logout URLs registered in Cognito must be HTTPS (except `localhost`); the CloudFront default domain satisfies this.
- The Google OAuth client secret must be supplied at stack creation as a `NoEcho` parameter or created manually in the console. It is never committed.
- **Correction to my earlier informal note:** I previously said Google sign-in would need a custom domain or an HTTPS ALB. That was too strong. A Cognito prefix domain and the CloudFront domain are both HTTPS, so no custom domain is strictly needed for auth.

### 7.4 Data migration (Firestore to DynamoDB)
- Table `Notes`: PK `userId` (S), SK `noteId` (S, time-sortable ID such as ULID).
- The current query is "all notes, newest-updated first". An **LSI on `updatedAt`** reproduces that exactly. LSIs can only be created with the table, so this must be decided up front. A simpler alternative is to sort in the API, which is fine at this data volume. **Proposal: sort in the API and skip the LSI**, unless you want the index for the demonstration.
- DynamoDB items are limited to 400 KB (Firestore documents allow about 1 MiB). The API must validate ciphertext size and return a clear error.
- Server timestamps become API-set ISO-8601 strings.
- Ownership is enforced by always deriving `userId` from the verified token, never from the request.

### 7.4b No Firestore feature loss
Real-time listeners are not used, offline persistence is not enabled, and there are no transactions or queries beyond the four above. Nothing needs to be dropped.

### 7.5 Docker
Only the backend is containerised. The frontend is static. Base image `node:*-alpine`, non-root user, `.dockerignore`, `/health` (liveness and readiness), JSON logs without request bodies, SIGTERM handling.

### 7.6 Deployment to new instances
Launch template user data installs Docker, logs in to ECR via the instance profile, pulls a **pinned tag** and runs the container. CD updates the image-tag parameter on the CloudFormation stack, which creates a new launch-template version, then starts an ASG instance refresh. **[Unverified]** that the lab permits all of these calls.

### 7.7 AWS Academy constraints
- **IAM:** only `LabRole` and `LabInstanceProfile` can be used. Creating roles, users or OIDC providers is generally denied, so CloudFormation templates take the role ARN and instance profile as **parameters** and do not create IAM resources. Least-privilege per-service roles, which the spec asks for, are **not achievable**. This is a documented limitation.
- **GitHub OIDC is unlikely to work** (it needs an IAM OIDC provider plus a role). Lab-compatible alternative: CI runs with no AWS access; CD is a manually triggered workflow that reads short-lived lab credentials (key, secret, session token) from a GitHub **Environment** secret refreshed each session, plus a documented manual `scripts/deploy.sh` fallback.
- **Session limits:** sessions last about 4 hours and credentials rotate. Pipelines must fail clearly when credentials are expired, never report false success.
- **Regions:** use `us-east-1` (the `vockey` key pair exists only there, and AMIs are generally limited to `us-east-1`/`us-west-2`). Prefer Session Manager over SSH. No SSH ingress at all.
- **Instance types:** roughly nano to large only.
- **Prometheus EC2 service discovery** needs `ec2:DescribeInstances` through LabRole. **[Unverified]**.
- **Scaling policy:** target-tracking policies create CloudWatch alarms automatically. This is acceptable infrastructure plumbing and does not replace Prometheus/Grafana as the monitoring demonstration.
- **Behaviour when a session ends** (instances may be stopped; ASG may replace them) is **[Unverified]** and must be tested early.

## 8. AWS Academy compatibility and cost

**Services**

| Service | Evidence | Status |
|---|---|---|
| CloudFormation, ECR, S3, DynamoDB, EC2 Auto Scaling, Elastic Load Balancing, Systems Manager, ACM, CloudWatch | **Confirmed on the team's own lab service list (Revision 1)** | Listed; creation not yet tested per service |
| Cognito | Pool and app client created in the team's lab; hosted login loaded | **Verified (basic)** |
| CloudFront | Console access denied | **Blocked** |
| Google federation in Cognito | Standard Cognito feature. Not confirmed for Learner Lab. | **[Unverified]**, highest-risk item |
| GitHub OIDC | Requires IAM creation | Expected blocked |

**Budget:** commonly $50 or $100 per student, set by the institution [Researched]. Exceeding it disables the account and **destroys all resources**. **Please read yours from the lab dashboard.**

**Prices (us-east-1)**
- ALB: $0.0225/hour plus $0.008 per LCU-hour [Researched]. Roughly $0.03/hour, about $22/month if left on. Public IPv4 addresses on the ALB are billed separately [Researched; rate **[Unverified]**].
- Cognito: 10,000 monthly active users free for direct and social (Google) sign-in on Lite and Essentials [Researched]. Cost for this project is effectively zero.
- EC2 t3.micro/t3.small, public IPv4, CloudFront, DynamoDB, S3, ECR: small at this scale, but I did **not** retrieve live prices. **[Unverified]**. Exact figures will go in `COST_AND_CLEANUP.md` after checking the pricing pages.
- NAT Gateway: **not used**, as the spec requires.

**Rough planning estimate (assumptions, not quotes):** a short demo session with 1 ALB, 2 to 3 small app instances and 1 small monitoring instance should cost well under a few dollars. The danger is **leaving it running**: the always-on set (ALB, instances, public IPs) is on the order of a couple of dollars per day. Mitigation: every stack must be deletable in one command; end every session by scaling the ASG to zero or deleting stacks.

**Idle-cost resources to watch:** ALB, public IPv4 addresses, running EC2, any stray EBS volumes, ECR storage (small), CloudFront (negligible at demo traffic).

## 9. Build and test commands

| Purpose | Today | Planned |
|---|---|---|
| Run locally | `python -m http.server 8080` | Same for the static front end, plus `docker compose up` for backend and DynamoDB Local |
| Lint | none | ESLint (frontend and backend), `cfn-lint`, `hadolint`, `actionlint` |
| Unit tests | none | `node --test` or Jest for the backend (auth middleware, ownership, validation, DynamoDB access with a local or mocked client) |
| Build | none | `scripts/build-frontend.sh` (vendor CryptoJS, inject `config.js`, output `dist/`); `docker build` for the API |
| Template validation | n/a | `cfn-lint` locally and in CI. `aws cloudformation validate-template` when credentials are available |

## 10. Risks and assumptions

**Assumptions**
- The uploaded zip equals `main` of the original repository.
- Team uses one Learner Lab account (or each member has one) in `us-east-1`.
- No custom domain is available.
- Starting with an empty database is acceptable.

**Top risks (in order)**
1. Cognito/Google federation or any required API is blocked in the lab. *Mitigation: spike this first (Phase 2a), with a documented fallback of Cognito username/password sign-in.*
2. Budget exhaustion from idle resources. *Mitigation: tag everything, one-command teardown, daily cleanup routine.*
3. Lab credentials expiring mid-deployment. *Mitigation: clear failure, manual fallback script.*
4. Instances stopped between sessions confusing the ASG. *Mitigation: test early; scale to zero when idle.*
5. Scaling demo does not trigger on HTTP traffic alone. *Mitigation: a deliberate CPU-bound `/api/load` test endpoint behind a flag, or `stress-ng`, chosen only after measuring.*
6. Service worker caching of API data (R1).

## 11. Staged implementation plan

Ownership follows the spec's suggestion: **M1** application and Docker, **M2** AWS networking, EC2, ALB, ASG, **M3** CI/CD, monitoring, test evidence.

| Phase | Work | Owner | Depends on | Acceptance criteria |
|---|---|---|---|---|
| **1 Isolated clone** | New repo `SafeScribe-DevOps` from a copy of the source. Provenance note. Checksum of original files before and after. Add `.gitignore`/`.dockerignore`. Branch protection. | M1 | D-decisions below | Original untouched (checksums equal). Copy runs with `python -m http.server`. |
| **2a Auth spike** | Hand-create a Cognito pool in the lab. Prove Google login returns a token. | M2 | Lab access | Token obtained, or documented block and fallback chosen. |
| **2 App migration** | Backend API, DynamoDB access, JWT verification, ownership checks; frontend auth/API modules; service-worker fix; tests. | M1 | D1 to D4, 2a | Create/read/update/delete works end to end locally. User A cannot read user B (tested). |
| **3 Docker** | Dockerfile, compose with DynamoDB Local, health check, SIGTERM handling. | M1 | 2 | Container starts, `/health` returns 200, data persists in DynamoDB Local across restarts. |
| **4 CI** | Lint, tests, frontend assemble, Docker build, `cfn-lint`/`hadolint`. PR-triggered. | M3 | 2, 3 | Green run on a PR. A deliberately broken PR fails visibly. |
| **5 AWS foundation** | VPC, subnets, IGW, route tables, SGs, DynamoDB table, S3, ECR, CloudFront, Cognito stacks. Change sets reviewed before execute. | M2 | 2a, lab budget confirmed | Templates validate. Stack create/delete cycle works. Cost noted. |
| **6 Deployment automation** | ECR push by SHA, parameterised deploy, instance refresh, health verification, version endpoint. Manual-trigger CD workflow plus `scripts/deploy.sh`. | M3 | 4, 5 | Deployed version reported by the API matches the Git SHA. Expired credentials fail clearly. |
| **7 Auto Scaling** | Launch template, ASG, ALB, target tracking. Calibrate load first. | M2 | 5, 6 | Scale-out and scale-in observed with captured ASG activity history. |
| **8 Monitoring** | Prometheus (EC2 SD), Grafana provisioning, dashboards. Not publicly reachable. | M3 | 7 | Targets `UP`. Dashboard shows real data. Unavailable panels labelled. |
| **9 Integration** | Code change to deployed app, full test pass, unhealthy-instance test, scaling plus metrics correlation. | All | 8 | `TEST_RESULTS.md` records only executed results. |
| **10 Packaging** | Remaining docs, diagrams, screenshots, demo script, review decks, report. | All | 9 | Documents match what was actually built. |

**Review 1 and before CT2:** Phases 1, 3, 4 need no AWS spend, so a working repo, Docker image and CI run can be shown first. The architecture deck should label AWS components as **proposed** until deployed.

## 12. Decisions needed from you

1. Approve the new Node.js API (D1).
2. Confirm there is no domain, and accept the CloudFront front-door design (D2).
3. Start with an empty database, or require migration of existing notes (D3).
4. Token storage: in-memory only, or `sessionStorage` (D4).
5. Your Learner Lab budget figure, and whether Cognito Google federation works there (Phase 2a will test this).
6. Whether to keep the LSI on `updatedAt` or sort in the API (7.4).
7. Names and Git handles of the three members, for `TEAM_CONTRIBUTIONS.md` (to be filled with real contributions only).
