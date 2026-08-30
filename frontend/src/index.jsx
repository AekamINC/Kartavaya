import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

// No web analytics is loaded here. `@vercel/analytics` used to be injected at
// this point; the site is served from Cloudflare Pages, whose SPA fallback
// answers /_vercel/insights/script.js with index.html and Content-Type
// text/html, so every page load logged a refused-to-execute console error and
// nothing was ever recorded. It also had to redact bearer tokens out of
// `/sign/:token` before events left the browser. Dropped 2026-08-30.

// Auto-reload on stale chunks after deploy — lazy imports fail with
// "Failed to fetch dynamically imported module" when old chunk hashes
// are gone from the server. One reload fixes it; the flag prevents loops.
// IMPORTANT: only match dynamic-import-specific errors, NOT general fetch failures.
window.addEventListener('error', (e) => {
  if (
    e.message?.includes('dynamically imported module') ||
    e.message?.includes('Loading chunk') ||
    (e.message?.includes('MIME type') && e.message?.includes('module script'))
  ) {
    const key = 'kartavya_chunk_reload';
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      window.location.reload();
    }
  }
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || '';
  if (msg.includes('dynamically imported module') || msg.includes('Loading chunk')) {
    const key = 'kartavya_chunk_reload';
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      window.location.reload();
    }
  }
});

// The connection warm-up is `<link rel="preconnect">` in index.html, not a
// request from here.
//
// This used to fetch `/api/health` to establish TCP+TLS before the first real
// call. It raced the thing it was warming: measured on staging 2026-07-31, the
// health fetch started at 873ms and `auth/me` at 927ms — 54ms later, while
// health itself took 534ms. The handshake it was meant to prepay had not
// finished, so `auth/me` opened its own connection anyway and the warm-up
// bought nothing but an extra request on the critical path.
//
// `preconnect` is the purpose-built mechanism: the browser opens the socket
// during HTML parse, before any script runs, and it costs no request at all.
// It now carries `%VITE_BACKEND_URL%`, so it points at the API this build
// actually talks to.

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
