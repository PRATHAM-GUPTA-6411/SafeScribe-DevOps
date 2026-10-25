# Legacy Firebase artefacts

Kept for reference only; nothing in the running application uses them.

- `firebase.js`: the original SafeScribe Firebase Auth + Firestore integration (byte-identical to the source).
  Replaced by `frontend/auth.js` (Cognito) and `frontend/api.js` (REST API).
- `firestore.rules`: the original per-user access rule. Replaced by token verification and
  per-user DynamoDB keys in `backend/src`.
