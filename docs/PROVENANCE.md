# Provenance

- Source: `SafeScribe-main.zip` supplied by the team (11 files, no `.git` history included).
- SHA-256 of that zip: `3215dc2acbc4e8c5619fe447ff80854098436e75fcbda29d8029b2fab27409e5`
- Files in `frontend/` and `legacy/` were copied **byte-for-byte** and verified with `cmp`
  (index.html, app.js, firebase.js, style.css, service-worker.js, manifest.json, icon.svg, firestore.rules).
- Original README preserved as `docs/ORIGINAL_SAFESCRIBE_README.md`.
- Original GitHub repository (PRATHAM-GUPTA-6411/SafeScribe) was not accessed or changed.
- Not yet verified: that the zip equals `main` of the live repository.

## Changes after the Phase 1 snapshot

The Phase 1 commit contained byte-identical copies. Later changes are tracked in Git history:

- Modified: `frontend/index.html`, `frontend/app.js`, `frontend/service-worker.js`
- Added: `frontend/auth.js`, `frontend/api.js`, `frontend/vendor/` (CryptoJS 4.2.0 from npm), `backend/`
- Moved: `frontend/firebase.js` to `legacy/firebase/firebase.js` (content unchanged)
