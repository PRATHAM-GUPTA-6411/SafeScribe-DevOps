# SafeScribe

SafeScribe keeps notes encrypted **in your browser** with CryptoJS AES, then synced to Firebase Firestore. Google Sign-In identifies *which encrypted blobs are yours*. The vault password never leaves the device.

**The app creator / host / Firebase admin cannot read user notes.** Firestore and GitHub Pages only ever see ciphertext.

Live URL shape after GitHub Pages deploy:

`https://<username>.github.io/SafeScribe/`

---

## What you get

| File | Role |
| --- | --- |
| `index.html` | Login, vault unlock, notes UI |
| `style.css` | Responsive layout (phone + desktop) |
| `app.js` | AES encrypt/decrypt, UI, CRUD |
| `firebase.js` | Firebase config, Auth, Firestore helpers |
| `manifest.json` + `service-worker.js` | Installable PWA |
| `firestore.rules` | Per-user access rules (ciphertext only) |
| `icon.svg` | App / PWA icon |

---

## 1. Create the Firebase project (free Spark plan)

1. Open [Firebase Console](https://console.firebase.google.com/) and create a project (Google Analytics optional).
2. **Authentication** → Get started → **Sign-in method** → enable **Google** → set a support email → Save.
3. **Firestore Database** → Create database → start in **production mode** → pick a region.
4. Firestore → **Rules** → paste the contents of `firestore.rules` from this repo → Publish.
5. Project **Settings** (gear) → **General** → **Your apps** → add a **Web** app.
6. Copy the `firebaseConfig` object.

### Authorized domains (required for GitHub Pages)

Authentication → Settings → **Authorized domains** → add:

- `localhost` (usually already there)
- `<username>.github.io`

Replace `<username>` with your GitHub username.

---

## 2. Paste your Firebase config

Open `firebase.js` and replace the placeholders:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc"
};
```

These web config values are **expected to be public** in a client app. Security comes from:

- Firestore rules (only the signed-in user can read/write their notes)
- Client-side AES (you still cannot read the note text without the vault password)

Never put a Firebase **Admin / service account** key in this repo.

---

## 3. Run locally

Any static server from the project folder works. Examples:

```bash
# Python
python -m http.server 8080

# Node (if you have npx)
npx --yes serve .
```

Open `http://localhost:8080`. Sign in with Google, then set a vault password (8+ characters). That password encrypts every note on this device and is **not** stored in Firebase.

If you forget the vault password, those notes cannot be recovered. That is by design.

---

## 4. Push to GitHub and host on GitHub Pages

This repo is already a git repository. From the project folder:

```bash
git add .
git commit -m "Add SafeScribe"
git branch -M main
git remote add origin https://github.com/<username>/SafeScribe.git
git push -u origin main
```

Create the empty GitHub repo `SafeScribe` first (no README, so you do not get a merge conflict).

### GitHub Pages

1. Repo → **Settings** → **Pages**
2. **Build and deployment** → Source: **Deploy from a branch**
3. Branch: `main` / folder: `/ (root)` → Save
4. After a minute, open:

`https://<username>.github.io/SafeScribe/`

Paths in `manifest.json` and the service worker are **relative** (`./`), so the app works under that subpath.

If Google sign-in fails on the live site, you forgot to add `<username>.github.io` as an authorized domain in Firebase.

---

## 5. Install as a PWA

On HTTPS (GitHub Pages) or localhost:

- Chrome / Edge: install icon in the address bar, or menu → **Install SafeScribe**
- Android Chrome: **Add to Home screen**
- iPhone Safari: Share → **Add to Home Screen**

The service worker caches the app shell only. Notes still come from Firestore after you unlock.

---

## How encryption works

```
[You type a note]
        │
        ▼
JSON { title, body }  ── CryptoJS.AES.encrypt(plaintext, vaultPassword)
        │
        ▼
ciphertext string  ── Firestore  users/{googleUid}/notes/{id}
```

On load, documents are fetched as ciphertext and decrypted only after the correct vault password is entered. Wrong password → decrypt yields empty UTF-8 → the UI refuses to unlock if nothing can be decrypted.

### What an attacker (or you, as the host) would see

A Firestore document looks like:

```json
{
  "ciphertext": "U2FsdGVkX1...",
  "createdAt": "...",
  "updatedAt": "..."
}
```

No title. No body. No vault password.

---

## Firestore data shape

```
users/{uid}/notes/{noteId}
  ciphertext: string   // AES output from CryptoJS
  createdAt: timestamp
  updatedAt: timestamp
```

`uid` is the Firebase Auth user id from Google Sign-In.

---

## Privacy checklist for maintainers

Do **not**:

- Log `vaultPassword`, plaintext titles, or note bodies
- Store the vault password in Firestore, cookies, or `localStorage`
- Add a “recover notes” backdoor (that would mean you could read notes)

The comments in `firebase.js` and `app.js` repeat this so it stays obvious in the source.

---

## License

Use and modify freely for your own deployment.
