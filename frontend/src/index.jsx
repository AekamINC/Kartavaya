import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { inject } from "@vercel/analytics";

inject();

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
