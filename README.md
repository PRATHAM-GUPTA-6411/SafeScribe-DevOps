# SafeScribe-DevOps

AWS cloud deployment, CI/CD automation, Auto Scaling and monitoring for **SafeScribe**,
a client-side-encrypted notes app. University project for *Essentials in Cloud and DevOps*.

> The original SafeScribe project is **not modified** by this repository. This is a separate
> copy used as the starting point. See `docs/PROVENANCE.md`.

## Status (honest)

| Phase | State |
|---|---|
| 0 Audit | Done: `docs/INITIAL_AUDIT.md` |
| 1 Isolated clone | Done: app copied unchanged into `frontend/` |
| 2 to 10 | Not started. Nothing is deployed. No AWS resources exist. |

## Layout

```
frontend/   the original SafeScribe app, byte-identical to the source for now (still uses Firebase)
legacy/     Firebase-only artefacts kept for reference (firestore.rules)
docs/       audit, provenance, original README
```

## Run the current (still Firebase-based) app locally

```bash
cd frontend
python3 -m http.server 8080      # then open http://localhost:8080
```

Sign-in will use the original project's Firebase configuration until Phase 2 replaces it.
