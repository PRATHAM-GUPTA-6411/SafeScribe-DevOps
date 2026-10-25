/**
 * Service worker — caches the app shell so SafeScribe can be installed as a PWA.
 *
 * Privacy: this cache only stores static files (HTML/CSS/JS/icons).
 * API traffic (/api/*), the per-deployment /config.js and /health are NEVER
 * handled or cached here, and neither is any cross-origin request (Cognito).
 * Encrypted notes live on the server and in memory after unlock.
 * The vault password and sign-in tokens are never written to Cache Storage.
 *
 * Assumes the app is served from the origin root (as the SafeScribe API does).
 */

const CACHE_NAME = "safescribe-v3";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./auth.js",
  "./api.js",
  "./vendor/crypto-js.js",
  "./manifest.json",
  "./icon.svg"
];

// Same-origin paths that must always go straight to the network.
const NEVER_HANDLE = (pathname) =>
  pathname === "/api" || pathname.startsWith("/api/") || pathname === "/config.js" || pathname === "/health";

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

  // Only our own static files are ever handled. Cross-origin traffic (Cognito) and
  // API/config/health requests fall through to the browser untouched.
  if (url.origin !== self.location.origin) return;
  if (NEVER_HANDLE(url.pathname)) return;

  // Always fetch JS from the network so a new deployment is picked up immediately.
  const isAppScript = url.pathname.endsWith(".js");

  event.respondWith(
    fetch(request)
      .then((response) => {
        const noStore = /no-store/i.test((response && response.headers && response.headers.get("Cache-Control")) || "");
        if (response && response.status === 200 && response.type !== "opaque" && !isAppScript && !noStore) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
  );
});
