/**
 * Service worker — caches the app shell so SafeScribe can be installed as a PWA.
 *
 * Privacy: this cache only stores static files (HTML/CSS/JS/icons).
 * Encrypted notes live in Firestore and in memory after unlock.
 * The vault password is never written to Cache Storage.
 */

const CACHE_NAME = "safescribe-v2";

// Relative paths so GitHub Pages works at /SafeScribe/
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase.js",
  "./manifest.json",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache Firebase / CDN auth traffic — always hit the network.
  if (url.hostname.includes("googleapis.com") || url.hostname.includes("gstatic.com") || url.hostname.includes("firebaseio.com")) {
    return;
  }

  // Always fetch JS from the network so firebase.js config updates are not stuck.
  const isAppScript = url.pathname.endsWith(".js");

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type !== "opaque" && !isAppScript) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
  );
});
