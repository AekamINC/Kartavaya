import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { inject } from "@vercel/analytics";

/* Vercel Web Analytics reports `location.pathname` verbatim. Two public routes
   carry a BEARER TOKEN in that path — `/sign/:token` (SigningPage) and the
   invite/reset links — and `/sign/:token` is the whole authority to apply a
   legally binding signature under the IT Act, 2000. Sending it here would hand
   every signing link to a third party and park it in the analytics dashboard,
   where it is readable by anyone with project access and outlives the document.
   Aggregate page counts are the only thing this call is for, so the token is
   replaced before the event leaves the browser rather than the route being
   dropped: `/sign/[token]` still counts as a pageview.

   `beforeSend` runs on every event; returning the event unchanged is the
   no-op path, so an unrecognised route is unaffected. */
const TOKEN_ROUTES = /^\/(sign|approve|accept-invite|reset-password)\/[^/]+/;

inject({
  beforeSend: (event) => {
    try {
      const u = new URL(event.url);
      if (TOKEN_ROUTES.test(u.pathname)) {
        u.pathname = u.pathname.replace(TOKEN_ROUTES, '/$1/[token]');
      }
      // A token can also arrive as ?token=… on the invite/reset links.
      if (u.searchParams.has('token')) u.searchParams.set('token', '[redacted]');
      return { ...event, url: u.toString() };
    } catch {
      // A URL we cannot parse is a URL we cannot prove is safe to send.
      return null;
    }
  },
});

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

// Warm the Railway connection before React boots — establishes TCP+TLS so the
// first real API call (login / teams fetch) doesn't pay the handshake cost.
const _backendUrl = import.meta.env.VITE_BACKEND_URL;
if (_backendUrl) {
  fetch(`${_backendUrl}/api/health`, { method: 'GET', cache: 'no-store' }).catch(() => {});
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
