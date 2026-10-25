/**
 * firebase.js — SafeScribe Firebase Auth + Firestore helpers
 *
 * ============================================================================
 * PRIVACY / ZERO-KNOWLEDGE (read this if you host or maintain this app)
 * ============================================================================
 * The person who created or hosts this app CANNOT read user notes.
 *
 * Why:
 * 1. Notes are encrypted in the browser with CryptoJS AES *before* any
 *    Firestore write. The database only stores ciphertext strings.
 * 2. The vault password never leaves the device. It is not sent to Firebase,
 *    not stored in Firestore, and not included in these config values.
 * 3. Firebase Authentication only identifies *whose* encrypted blobs belong
 *    to which Google account. It does not unlock those blobs.
 * 4. Opening firebase.js, Hosting files, or the Firestore console shows
 *    ciphertext (e.g. "U2FsdGVkX1...") — not titles or body text.
 *
 * If you are the developer: you still cannot decrypt a user's notes without
 * their vault password. Do not add logging of plaintext or passwords.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// 1. Firebase project config
//    Replace the placeholder strings with values from Firebase Console:
//    Project settings → Your apps → SDK setup and configuration
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyAxLl-z0vSSdHF4PL4KLIudd5Q46iynItM",
  authDomain: "safescribe-274bb.firebaseapp.com",
  projectId: "safescribe-274bb",
  storageBucket: "safescribe-274bb.firebasestorage.app",
  messagingSenderId: "362632932145",
  appId: "1:362632932145:web:1e81aadfa995cfdf109e10",
  measurementId: "G-9YT8Z103LE"
};

let auth = null;
let db = null;
let googleProvider = null;

function isFirebaseConfigured() {
  return firebaseConfig.apiKey !== "YOUR_API_KEY" && firebaseConfig.projectId !== "YOUR_PROJECT_ID";
}

function initFirebase() {
  if (!isFirebaseConfigured()) {
    return false;
  }
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  auth = firebase.auth();
  db = firebase.firestore();
  googleProvider = new firebase.auth.GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: "select_account" });
  return true;
}

function notesCollection(uid) {
  // Path: users/{googleUid}/notes/{noteId}
  // Each document is expected to contain `ciphertext` only (plus timestamps).
  return db.collection("users").doc(uid).collection("notes");
}

function signInWithGoogle() {
  return auth.signInWithPopup(googleProvider).catch((error) => {
    if (error.code === "auth/popup-blocked" || error.code === "auth/cancelled-popup-request") {
      return auth.signInWithRedirect(googleProvider);
    }
    throw error;
  });
}

function signOutUser() {
  return auth.signOut();
}

function onAuthReady(callback) {
  return auth.onAuthStateChanged(callback);
}

/**
 * CREATE — writes ciphertext only. Never pass plaintext into this function.
 */
function createEncryptedNote(uid, ciphertext) {
  const now = firebase.firestore.FieldValue.serverTimestamp();
  return notesCollection(uid).add({
    ciphertext,
    createdAt: now,
    updatedAt: now
  });
}

/**
 * READ — returns documents as stored (ciphertext + metadata). Decryption
 * happens later in app.js, only after the user enters the vault password.
 */
function listEncryptedNotes(uid) {
  return notesCollection(uid).orderBy("updatedAt", "desc").get();
}

/**
 * UPDATE — replaces the ciphertext blob. The previous plaintext is gone
 * from the client; the server never had it.
 */
function updateEncryptedNote(uid, noteId, ciphertext) {
  return notesCollection(uid).doc(noteId).update({
    ciphertext,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * DELETE — removes the encrypted document for this user only (see firestore.rules).
 */
function deleteEncryptedNote(uid, noteId) {
  return notesCollection(uid).doc(noteId).delete();
}
