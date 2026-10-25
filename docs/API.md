# SafeScribe API (Phase 2)

Node.js (>= 22) + Express 5. It serves the static frontend and the JSON API from one origin, so no CORS is needed.
The server only ever stores and returns **ciphertext** produced in the browser.

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | none | `{status, version, uptimeSeconds}`. Used by the ALB. Does not call DynamoDB on purpose. |
| GET | `/config.js` | none | `window.SAFESCRIBE_CONFIG = {cognitoDomain, clientId, appVersion}` (public values only). |
| GET | `/api/notes` | Bearer | `{notes: [{id, ciphertext, createdAt, updatedAt}]}` newest-updated first. |
| POST | `/api/notes` | Bearer | body `{ciphertext}` -> `201` note. |
| PUT | `/api/notes/:id` | Bearer | body `{ciphertext}` -> `200` note, `404` if not the caller's. |
| DELETE | `/api/notes/:id` | Bearer | `204`, `404` if not the caller's. |
| GET | `/*` | none | Static frontend. |

Metrics are exposed on a **separate internal port** (`METRICS_PORT`, default 9464) at `/metrics`, never through the public port.

Errors: `401` missing/invalid token, `400` bad body, `404` unknown or not owned, `413` note larger than 300 KB, `500` generic (no internals leaked).

## Security properties (each covered by a test)

- Access token verified on every API call (signature via Cognito JWKS, issuer, expiry, `token_use=access`, `client_id`).
- The user id is the token's `sub`; it is never taken from the body, query or path.
- `Cache-Control: no-store` on all API responses; the service worker never handles `/api/*`.
- Logs contain method, path (no query string), status, timing and a request id only: no tokens, no ciphertext.
- Strict CSP (`default-src 'self'`; `connect-src` adds only the Cognito domain), `frame-ancestors 'none'`, nosniff, no `X-Powered-By`.
- Graceful shutdown on SIGTERM (10 s limit).

## DynamoDB table (created by CloudFormation in Phase 5)

| | |
|---|---|
| Name | `SafeScribeNotes` (env `NOTES_TABLE`) |
| Partition key | `userId` (S) = Cognito `sub` |
| Sort key | `noteId` (S) = random UUID |
| Attributes | `ciphertext` (S), `createdAt`, `updatedAt` (ISO-8601 strings) |
| Billing | on-demand |
| Indexes | none; the API sorts by `updatedAt` |
| Item limit | 400 KB, so the API rejects ciphertext over 300 KB |

## Configuration (environment variables)

See `backend/.env.example`. Required: `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN` (https URL). Optional: `PORT`, `METRICS_PORT`, `APP_VERSION` (set to the Git SHA by CI/CD), `NOTES_TABLE`, `AWS_REGION`, `FRONTEND_DIR`.
AWS credentials come from the EC2 instance role; none are configured here.

## Run the tests

```bash
cd backend && npm ci && npm test                 # API, auth, DynamoDB repo, server boot, UI end-to-end
cd .. && node --test "frontend/test/**/*.test.js"  # sign-in logic, service worker, CryptoJS/OpenSSL compatibility
```

## Browser sign-in flow

Cognito managed login with Google, Authorization Code + PKCE. Tokens are kept in memory only. The Cognito app client
must allow callback URL `https://<host>/` and sign-out URL `https://<host>/`, scopes `openid email profile`, and the
Google provider must map `email`, `name` and `picture`. Phase 5 creates this in CloudFormation.
