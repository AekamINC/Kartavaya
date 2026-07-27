/** Auth helpers, date utils, theme hook — shared across all pages */
import { useState, useEffect } from 'react';
import { api } from './api';

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function apiLogin(email, password) {
  const res = await api.post('/auth/login', { email, password });
  localStorage.setItem('Kartavaya_user', JSON.stringify(res.data.user));
  if (res.data.token) localStorage.setItem('auth_token', res.data.token);
  return res.data;
}

export async function apiAcceptInvite(token, name, password) {
  const res = await api.post('/auth/accept-invite', { token, name, password });
  localStorage.setItem('Kartavaya_user', JSON.stringify(res.data.user));
  if (res.data.token) localStorage.setItem('auth_token', res.data.token);
  return res.data;
}

/**
 * What the invite is for, before anyone types a password into it.
 *
 * `GET /api/auth/invite/:token` is unauthenticated and answers one 404 with one
 * string for every kind of dead token, so there is nothing here to branch on
 * beyond "it resolved or it did not".
 */
export async function apiInvitePreview(token) {
  const res = await api.get(`/auth/invite/${encodeURIComponent(token)}`);
  return res.data;
}

/** Turn the invitation down. Expires the row; idempotent on the server. */
export async function apiDeclineInvite(token) {
  const res = await api.post(`/auth/invite/${encodeURIComponent(token)}/decline`);
  return res.data;
}

/**
 * Slide the session's window forward and pick up any role change with it.
 *
 * This EXTENDS a live session; it cannot revive an expired one — the endpoint
 * is behind `require_user`, so an expired token is refused before the handler
 * runs. Callers must treat a rejection as "carry on with what you have", never
 * as "sign the user out": the token that failed to refresh may still be minutes
 * from valid, and `api.js`'s 401 branch already owns the case where it is not.
 */
export async function apiRefreshSession() {
  const res = await api.post('/auth/refresh');
  localStorage.setItem('Kartavaya_user', JSON.stringify(res.data.user));
  if (res.data.token) localStorage.setItem('auth_token', res.data.token);
  return res.data;
}

export async function apiForgotPassword(email) {
  const res = await api.post('/auth/forgot-password', { email });
  return res.data;
}

export async function apiResetPassword(token, password) {
  const res = await api.post('/auth/reset-password', { token, password });
  localStorage.setItem('Kartavaya_user', JSON.stringify(res.data.user));
  if (res.data.token) localStorage.setItem('auth_token', res.data.token);
  return res.data;
}

export async function apiLogout() {
  try { await api.post('/auth/logout'); } catch (_) { /* fire-and-forget: logout always proceeds */ }
  localStorage.removeItem('auth_token');
  localStorage.removeItem('Kartavaya_user');
  localStorage.removeItem('kv_teams_cache');

  // The notification cache is MODULE-LEVEL, not per-Provider — that is what
  // lets the bell, the Inbox and the badge share one array. It also means it
  // survives a logout, because nothing unmounted it. On a shared machine the
  // next person to sign in on the same tab saw the previous user's
  // notifications, with their titles and their message bodies, until the first
  // poll replaced them.
  //
  // Imported lazily so `lib/auth.js` — which `Sidebar`, `ClientShell` and every
  // page reach for `currentUser()` — does not pull the notification store, and
  // React with it, into modules that never render a notification.
  try {
    const { resetNotifications } = await import('../context/NotificationContext');
    resetNotifications();
  } catch (_) { /* the sign-out must complete even if the chunk fails to load */ }

  // Same reasoning, same tab: the onboarding wizard's resume state and the
  // "why are we asking" reason both belong to the person who just left.
  localStorage.removeItem('kv_onboarding');
  localStorage.removeItem('kv_notif_ask_reason');
}

export function currentUser() {
  try { return JSON.parse(localStorage.getItem('Kartavaya_user') || 'null'); } catch { return null; }
}

// ── Theme ─────────────────────────────────────────────────────────────────────
// A second, competing theme mechanism: this stored its own key and toggled a
// `.dark` class, while CustomizePanel stores `k_prefs` and sets [data-theme].
// 00-tokens.md standardises on data-theme, so the class toggle is gone — the
// `.dark` rules it drove were removed from dark-theme.css.
//
// Kept (rather than deleted) because callers still import it, but it now
// writes the same attribute as applyPrefs so the two cannot disagree.
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('Kartavaya_theme') || 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
    localStorage.setItem('Kartavaya_theme', theme);
  }, [theme]);
  return { theme, setTheme };
}

// ── Date utils ────────────────────────────────────────────────────────────────
export function formatDue(v) {
  if (!v) return '';
  return new Date(v).toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function toLocal(v) {
  if (!v) return '';
  const d = new Date(v), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocal(v) { return v ? new Date(v).toISOString() : null; }

// ── Approval badge ────────────────────────────────────────────────────────────
export function approvalBadgeStyle(status) {
  switch (status) {
    case 'pending':        return { label: 'Pending owner',  bg: 'rgba(245,158,11,0.15)',  color: '#f59e0b' };
    case 'pending_client': return { label: 'Pending client', bg: 'rgba(139,92,246,0.15)',  color: '#8b5cf6' };
    case 'approved':       return { label: 'Approved',       bg: 'rgba(16,185,129,0.15)',  color: '#10b981' };
    case 'rejected':       return { label: 'Rejected',       bg: 'rgba(239,68,68,0.15)',   color: '#ef4444' };
    default: return null;
  }
}
