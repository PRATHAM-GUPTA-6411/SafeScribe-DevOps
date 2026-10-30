"use strict";
const js = require("@eslint/js");
const globals = require("globals");

// Shared between the browser scripts via window (defined in auth.js / api.js, used by app.js).
const sharedBrowserGlobals = {
  CryptoJS: "readonly",
  initAuth: "readonly",
  signInWithGoogle: "readonly",
  signOutUser: "readonly",
  onAuthReady: "readonly",
  listEncryptedNotes: "readonly",
  createEncryptedNote: "readonly",
  updateEncryptedNote: "readonly",
  deleteEncryptedNote: "readonly",
};

module.exports = [
  { ignores: ["**/node_modules/**", "frontend/vendor/**", "legacy/**", "docs/**"] },
  js.configs.recommended,
  {
    files: ["backend/**/*.js", "docker/**/*.js", "infrastructure/**/*.js", "eslint.config.js", "frontend/test/**/*.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  {
    files: ["frontend/*.js"],
    ignores: ["frontend/service-worker.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser, ...sharedBrowserGlobals } },
  },
  {
    files: ["frontend/service-worker.js"],
    languageOptions: { sourceType: "script", globals: globals.serviceworker },
  },
];
