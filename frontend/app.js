/**
 * app.js — SafeScribe UI, vault password, CryptoJS AES, and note CRUD orchestration
 *
 * ============================================================================
 * THE APP CREATOR CANNOT READ YOUR NOTES
 * ============================================================================
 * Encryption happens here, in your browser, *before* firebase.js writes to
 * Firestore. Decryption happens here, *after* you type the vault password.
 *
 * - Vault password: kept in a local variable only (not localStorage, not
 *   Firestore, not the Firebase Auth profile).
 * - Payload: JSON { title, body } → CryptoJS.AES.encrypt(...) → ciphertext
 *   string stored in Firestore.
 * - Opening the database or this repo's hosted files reveals ciphertext,
 *   never the note text.
 * ============================================================================
 */

(function () {
  "use strict";

  // ----- State (in-memory only) -------------------------------------------
  let currentUser = null;
  let vaultPassword = ""; // never persist this
  let notesCache = []; // decrypted notes for this session
  let selectedId = null;
  let saveTimer = null;

  const screens = {
    login: document.getElementById("screen-login"),
    unlock: document.getElementById("screen-unlock"),
    app: document.getElementById("screen-app")
  };

  const els = {
    configWarning: document.getElementById("config-warning"),
    btnGoogle: document.getElementById("btn-google"),
    loginError: document.getElementById("login-error"),
    formUnlock: document.getElementById("form-unlock"),
    vaultPassword: document.getElementById("vault-password"),
    unlockError: document.getElementById("unlock-error"),
    unlockAvatar: document.getElementById("unlock-avatar"),
    unlockName: document.getElementById("unlock-name"),
    unlockEmail: document.getElementById("unlock-email"),
    btnSignoutUnlock: document.getElementById("btn-signout-unlock"),
    btnNew: document.getElementById("btn-new-note"),
    btnLock: document.getElementById("btn-lock"),
    btnSignout: document.getElementById("btn-signout"),
    noteList: document.getElementById("note-list"),
    noteCount: document.getElementById("note-count"),
    listStatus: document.getElementById("list-status"),
    editorEmpty: document.getElementById("editor-empty"),
    editor: document.getElementById("editor"),
    title: document.getElementById("note-title"),
    body: document.getElementById("note-body"),
    saveStatus: document.getElementById("save-status"),
    btnDelete: document.getElementById("btn-delete"),
    toast: document.getElementById("toast")
  };

  // ----- Encryption helpers (CryptoJS AES) --------------------------------
  // CryptoJS.AES.encrypt uses a random salt; the ciphertext string already
  // embeds salt + IV in OpenSSL-compatible format. Same password decrypts it.
  // Hosting this file does not help an attacker: they still need the password.

  function encryptNotePayload(title, body, password) {
    const plaintext = JSON.stringify({ title: title || "", body: body || "" });
    // AES encryption — result is ciphertext, safe to store in Firestore
    return CryptoJS.AES.encrypt(plaintext, password).toString();
  }

  function decryptNotePayload(ciphertext, password) {
    const bytes = CryptoJS.AES.decrypt(ciphertext, password);
    const plaintext = bytes.toString(CryptoJS.enc.Utf8);
    if (!plaintext) {
      throw new Error("Wrong vault password or corrupted note.");
    }
    const data = JSON.parse(plaintext);
    return {
      title: typeof data.title === "string" ? data.title : "",
      body: typeof data.body === "string" ? data.body : ""
    };
  }

  // ----- Screens ----------------------------------------------------------

  function showScreen(name) {
    Object.keys(screens).forEach((key) => {
      screens[key].hidden = key !== name;
    });
  }

  function showError(node, message) {
    if (!message) {
      node.hidden = true;
      node.textContent = "";
      return;
    }
    node.hidden = false;
    node.textContent = message;
  }

  function toast(message) {
    els.toast.hidden = false;
    els.toast.textContent = message;
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(() => {
      els.toast.hidden = true;
    }, 2400);
  }

  function lockVault() {
    vaultPassword = "";
    notesCache = [];
    selectedId = null;
    els.vaultPassword.value = "";
    els.title.value = "";
    els.body.value = "";
    if (currentUser) showScreen("unlock");
    else showScreen("login");
  }

  // ----- Notes UI ---------------------------------------------------------

  function renderList() {
    els.noteList.innerHTML = "";
    els.noteCount.textContent = String(notesCache.length);

    notesCache.forEach((note) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      if (note.id === selectedId) btn.classList.add("active");

      const title = document.createElement("span");
      title.className = "note-item-title";
      title.textContent = note.title.trim() || "Untitled";

      const preview = document.createElement("span");
      preview.className = "note-item-preview";
      preview.textContent = note.body.trim().replace(/\s+/g, " ").slice(0, 80) || "Empty note";

      btn.append(title, preview);
      btn.addEventListener("click", () => selectNote(note.id));
      li.appendChild(btn);
      els.noteList.appendChild(li);
    });
  }

  function selectNote(id) {
    selectedId = id;
    const note = notesCache.find((n) => n.id === id);
    renderList();
    if (!note) {
      els.editor.hidden = true;
      els.editorEmpty.hidden = false;
      return;
    }
    els.editorEmpty.hidden = true;
    els.editor.hidden = false;
    els.title.value = note.title;
    els.body.value = note.body;
    els.saveStatus.textContent = "";
  }

  async function loadNotes() {
    els.listStatus.textContent = "Loading encrypted notes…";
    const snap = await listEncryptedNotes(currentUser.uid);
    const decrypted = [];
    let failed = 0;

    snap.forEach((doc) => {
      const data = doc.data();
      try {
        const payload = decryptNotePayload(data.ciphertext, vaultPassword);
        decrypted.push({ id: doc.id, ...payload });
      } catch (err) {
        failed += 1;
      }
    });

    if (snap.size > 0 && decrypted.length === 0) {
      throw new Error("Could not decrypt any notes. Check your vault password.");
    }

    notesCache = decrypted;
    renderList();
    if (!selectedId && notesCache[0]) selectNote(notesCache[0].id);
    else selectNote(selectedId);

    els.listStatus.textContent = failed
      ? `${failed} note(s) could not be decrypted (wrong password or old data).`
      : notesCache.length
        ? ""
        : "No notes yet — tap New note.";
  }

  async function saveCurrentNote() {
    if (!selectedId) return;
    const title = els.title.value;
    const body = els.body.value;
    // Encrypt in the browser, then upload ciphertext only.
    const ciphertext = encryptNotePayload(title, body, vaultPassword);
    els.saveStatus.textContent = "Saving encrypted note…";
    await updateEncryptedNote(currentUser.uid, selectedId, ciphertext);
    const note = notesCache.find((n) => n.id === selectedId);
    if (note) {
      note.title = title;
      note.body = body;
    }
    notesCache.sort((a, b) => (a.id === selectedId ? -1 : b.id === selectedId ? 1 : 0));
    renderList();
    els.saveStatus.textContent = "Saved (ciphertext only in Firestore)";
  }

  function queueSave() {
    window.clearTimeout(saveTimer);
    els.saveStatus.textContent = "Unsaved changes";
    saveTimer = window.setTimeout(() => {
      saveCurrentNote().catch((err) => {
        els.saveStatus.textContent = err.message || "Save failed";
      });
    }, 700);
  }

  async function createNote() {
    const ciphertext = encryptNotePayload("Untitled", "", vaultPassword);
    const ref = await createEncryptedNote(currentUser.uid, ciphertext);
    notesCache.unshift({ id: ref.id, title: "Untitled", body: "" });
    renderList();
    selectNote(ref.id);
    els.title.focus();
    toast("New encrypted note created");
  }

  async function deleteCurrentNote() {
    if (!selectedId) return;
    if (!window.confirm("Delete this note? This cannot be undone.")) return;
    await deleteEncryptedNote(currentUser.uid, selectedId);
    notesCache = notesCache.filter((n) => n.id !== selectedId);
    selectedId = notesCache[0] ? notesCache[0].id : null;
    renderList();
    selectNote(selectedId);
    toast("Note deleted");
  }

  // ----- Auth flow --------------------------------------------------------

  function fillUnlockProfile(user) {
    els.unlockName.textContent = user.displayName || "Signed in";
    els.unlockEmail.textContent = user.email || user.uid;
    if (user.photoURL) {
      els.unlockAvatar.src = user.photoURL;
      els.unlockAvatar.hidden = false;
    } else {
      els.unlockAvatar.hidden = true;
    }
  }

  async function handleSignedIn(user) {
    currentUser = user;
    fillUnlockProfile(user);
    if (vaultPassword) {
      showScreen("app");
      try {
        await loadNotes();
      } catch (err) {
        lockVault();
        showError(els.unlockError, err.message);
      }
    } else {
      showScreen("unlock");
    }
  }

  function handleSignedOut() {
    currentUser = null;
    lockVault();
    showScreen("login");
  }

  // ----- PWA --------------------------------------------------------------

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const swUrl = new URL("service-worker.js", window.location.href);
    navigator.serviceWorker.register(swUrl.href).catch(() => {
      /* registration is optional; app still works */
    });
  }

  // ----- Wire events ------------------------------------------------------

  els.btnGoogle.addEventListener("click", async () => {
    showError(els.loginError, "");
    els.btnGoogle.disabled = true;
    try {
      await signInWithGoogle();
    } catch (err) {
      showError(els.loginError, err.message || "Google sign-in failed.");
    } finally {
      els.btnGoogle.disabled = false;
    }
  });

  els.formUnlock.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError(els.unlockError, "");
    const password = els.vaultPassword.value;
    if (password.length < 8) {
      showError(els.unlockError, "Use at least 8 characters.");
      return;
    }
    vaultPassword = password;
    showScreen("app");
    try {
      await loadNotes();
    } catch (err) {
      vaultPassword = "";
      showScreen("unlock");
      showError(els.unlockError, err.message);
    }
  });

  els.btnSignoutUnlock.addEventListener("click", () => signOutUser());
  els.btnSignout.addEventListener("click", () => signOutUser());
  els.btnLock.addEventListener("click", lockVault);
  els.btnNew.addEventListener("click", () => {
    createNote().catch((err) => toast(err.message || "Could not create note"));
  });
  els.editor.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(saveTimer);
    saveCurrentNote().catch((err) => {
      els.saveStatus.textContent = err.message || "Save failed";
    });
  });
  els.btnDelete.addEventListener("click", () => {
    deleteCurrentNote().catch((err) => toast(err.message || "Delete failed"));
  });
  els.title.addEventListener("input", queueSave);
  els.body.addEventListener("input", queueSave);

  // ----- Boot -------------------------------------------------------------

  registerServiceWorker();

  const configured = initFirebase();
  if (!configured) {
    els.configWarning.hidden = false;
    els.btnGoogle.disabled = true;
    showScreen("login");
    return;
  }

  onAuthReady((user) => {
    if (user) handleSignedIn(user);
    else handleSignedOut();
  });
})();
