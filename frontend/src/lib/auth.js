/** Auth helpers, date utils, theme hook — shared across all pages */
import { useState, useEffect } from 'react';
import { api } from './api';

// ── Auth ──────────────────────────────────────────────────────────────────────
/**
 * `noRetry` on every one of these, and it is load-bearing rather than cautious.
 *
 * The response interceptor in `lib/api.js` retries any request that comes back
 * 502/503/504 — or with no response at all — up to three more times, 800ms /
 * 1600ms / 2400ms apart. It was written for the Railway restart window, where
 * the gateway answers before the app is up and a retried GET is free.
 *
 * None of these five is a GET, and measured in the browser each one put FOUR
 * identical requests on the wire against a single 503:
 *
 *   forgot-password  four reset emails from one press, and the 3/minute limiter
 *                    spent on the first one
 *   reset-password   the token is single-use. Attempt 1 succeeds server-side,
 *                    the gateway times out, attempts 2–4 come back "invalid or
 *                    expired" — so the password IS changed and the screen shakes
 *                    and says the link is dead. The worst kind of wrong: the UI
 *                    lies about a write that landed.
 *   accept-invite    a non-idempotent account create, retried
 *   login            four sessions minted, and the 5/minute limiter spent
 *   logout           holds the sign-out for 4.8s of retries before the local
 *                    keys are cleared
 *
 * A 502/504 does not mean the request was not processed — it means the answer
 * did not come back. That is exactly the case where a retry doubles a side
 * effect. `OnboardingPage.jsx` already opted its invite POST and `POST /teams`
 * out for the same reason; these five were the rest of the set.
 *
 * `apiInvitePreview` below is deliberately NOT in the set: it is a GET with no
 * side effect, which is the case the retry was written for.
 *
 * The user-visible motion consequence is separate and also real: without this,
 * the button sat in its pending state with the spinner running for ~4.8s before
 * the failure surfaced.
 */
const NO_RETRY = { noRetry: true };

export async function apiLogin(email, password) {
  const res = await api.post('/auth/login', { email, password }, NO_RETRY);
  localStorage.setItem('Kartavaya_user', JSON.stringify(res.data.user));
  if (res.data.token) localStorage.setItem('auth_token', res.data.token);
  return res.data;
}

export async function apiAcceptInvite(token, name, password) {
  const res = await api.post('/auth/accept-invite', { token, name, password }, NO_RETRY);
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

/**
 * Turn the invitation down. Expires the row; idempotent on the server.
 *
 * `NO_RETRY` for the motion reason rather than the correctness one — a second
 * decline is a 404 and changes nothing — but four attempts still hold the
 * button in its pending state for 4.8s before anything appears, on a press
 * whose whole meaning is "I am finished with this".
 */
export async function apiDeclineInvite(token) {
  const res = await api.post(`/auth/invite/${encodeURIComponent(token)}/decline`, null, NO_RETRY);
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
 *
 * `NO_RETRY`: this mints a JWT and sets a cookie. Four attempts mint four
 * tokens, and it runs on a six-hour timer where nobody is waiting — the next
 * tick is the retry.
 */
export async function apiRefreshSession() {
  const res = await api.post('/auth/refresh', null, NO_RETRY);
  localStorage.setItem('Kartavaya_user', JSON.stringify(res.data.user));
  if (res.data.token) localStorage.setItem('auth_token', res.data.token);
  return res.data;
}

export async function apiForgotPassword(email) {
  const res = await api.post('/auth/forgot-password', { email }, NO_RETRY);
  return res.data;
}

export async function apiResetPassword(token, password) {
  const res = await api.post('/auth/reset-password', { token, password }, NO_RETRY);
  localStorage.setItem('Kartavaya_user', JSON.stringify(res.data.user));
  if (res.data.token) localStorage.setItem('auth_token', res.data.token);
  return res.data;
}

export async function apiLogout() {
  // `null`, not `{}`: axios omits the body and the Content-Type header for null,
  // which is byte-for-byte the request this sent before the config argument was
  // added. `{}` would start posting a JSON body to an endpoint that declares none.
  try { await api.post('/auth/logout', null, NO_RETRY); } catch (_) { /* fire-and-forget: logout always proceeds */ }
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
