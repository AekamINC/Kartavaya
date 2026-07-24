import axios from "axios";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
if (!BACKEND_URL) {
  // Guard: only touch DOM in a real browser context (not SSR / test / Storybook)
  if (typeof document !== 'undefined' && document.body) {
    document.body.innerHTML =
      '<div style="display:flex;height:100vh;align-items:center;justify-content:center;font-family:sans-serif;flex-direction:column;gap:12px">' +
      '<h2 style="color:#dc2626">Configuration Error</h2>' +
      '<p style="color:#555">VITE_BACKEND_URL is not set. Please check your deployment environment.</p>' +
      '</div>';
  }
  throw new Error('VITE_BACKEND_URL is not set');
}
const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true, // send httpOnly session_token cookie
});

// Attach JWT from localStorage as Bearer fallback (migration period)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Retry on network errors / 502-504 (Railway restart window) — up to 3 attempts
// noRetry: true skips retries (used for file uploads to avoid double-sending)
api.interceptors.response.use(undefined, async (error) => {
  const config = error.config;
  if (!config || config.noRetry) return Promise.reject(error);
  config._retryCount = config._retryCount ?? 0;
  const isRetryable =
    !error.response ||                          // network error
    [502, 503, 504].includes(error.response?.status);
  if (isRetryable && config._retryCount < 3) {
    config._retryCount += 1;
    await new Promise(r => setTimeout(r, config._retryCount * 800));
    return api(config);
  }
  return Promise.reject(error);
});

export { BACKEND_URL, API };
