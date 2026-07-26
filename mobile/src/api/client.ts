import axios from 'axios';

/**
 * Fallback is STAGING, matching src/config.js.
 *
 * This is only reached when EXPO_PUBLIC_API_URL is unset, which always means an
 * unverified configuration. Staging and production share a Supabase database, so
 * a client that silently defaults to production writes real rows against real
 * customer data. Production is reached only by being named — the eas.json
 * `production` profile sets it explicitly.
 *
 * The previous value also had a capitalised host (`Kartavaya-production`), which
 * only worked because DNS is case-insensitive.
 */
const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  'https://kartavya-staging.up.railway.app';

export const apiClient = axios.create({
  baseURL:         `${BASE_URL}/api`,
  withCredentials: true,           // httpOnly cookie auth
  timeout:         15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Response interceptor: surface friendly error messages
apiClient.interceptors.response.use(
  (r) => r,
  (err) => {
    const status  = err?.response?.status;
    const detail  = err?.response?.data?.detail;

    // Friendly per-error messages matching the UX spec
    if (typeof detail === 'string') {
      if (detail.includes('file size') || detail.includes('too large'))
        err.friendlyMessage = 'This file is too large. Maximum size is 5 MB.';
      else if (detail.includes('5 files') || detail.includes('max files') || detail.includes('slot'))
        err.friendlyMessage = 'You can attach up to 5 files per task.';
      else if (detail.includes('format') || detail.includes('type'))
        err.friendlyMessage = 'That file type isn\'t supported.';
      else
        err.friendlyMessage = detail;
    } else if (status === 401) {
      err.friendlyMessage = 'Your session expired. Please sign in again.';
    } else if (status === 403) {
      err.friendlyMessage = 'You don\'t have permission to do that.';
    } else if (status === 404) {
      err.friendlyMessage = 'That item no longer exists.';
    } else if (status === 409) {
      err.friendlyMessage = 'This already exists — try a different name or email.';
    } else if (status === 500) {
      err.friendlyMessage = 'Something went wrong on our end. Try again in a moment.';
    } else if (!err.response) {
      err.friendlyMessage = 'Can\'t reach the server. Check your connection.';
    } else {
      err.friendlyMessage = 'Something went wrong. Please try again.';
    }

    return Promise.reject(err);
  }
);
