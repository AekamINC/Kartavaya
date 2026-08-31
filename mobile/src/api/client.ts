import axios from 'axios';
import Constants from 'expo-constants';

/**
 * Fallback is PRODUCTION, matching src/config.js.
 *
 * ⚠ THERE IS NO STAGING ENVIRONMENT. It was retired on 2026-08-30 and everything
 * moved to production. The host that used to be called "staging" reached the
 * SAME Supabase database, so defaulting to it never protected any data — it only
 * suppressed outbound mail, on a backend 30 commits stale. Pointing the fallback
 * at a name that no longer means anything is worse than pointing it at the one
 * host that is real.
 *
 * `api.kartavaya.com` is a name we own, so it does not move when Railway renames
 * a service — which has already happened once and shipped an APK aimed at a dead
 * host. Expo INLINES this at bundle time; no runtime setting can correct it.
 */
const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  'https://api.kartavaya.com';

/**
 * X-App-Version — the ONE version signal the owner approved for Pulse
 * (proposal 68, "App version adoption"). The backend reduces it to a single
 * row per user (latest version wins) at login and on the sync path; nothing
 * per-request is stored. Read from the same embedded expo config
 * SettingsScreen shows the user (`Constants.expoConfig?.version`), so the
 * header can never disagree with the About screen. When the version cannot
 * be read the header is OMITTED rather than sent as a made-up value — a
 * fake "unknown" row in the adoption table would be worse than no row.
 */
const APP_VERSION = Constants.expoConfig?.version;

export const apiClient = axios.create({
  baseURL:         `${BASE_URL}/api`,
  withCredentials: true,           // httpOnly cookie auth
  timeout:         15_000,
  headers: {
    'Content-Type': 'application/json',
    ...(APP_VERSION ? { 'X-App-Version': APP_VERSION } : {}),
  },
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
