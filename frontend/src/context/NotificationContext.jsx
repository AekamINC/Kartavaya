/**
 * NotificationContext — the one thing that talks to /notifications.
 *
 * `21-notifications-inbox.md` defect 1: three components owned the same data
 * independently. AppShell polled `/notifications/poll` and kept a count plus a
 * toast array; NotificationsModal fetched `/notifications` on open into its own
 * `items`; InboxPage fetched the same endpoint on mount into its own
 * `notifications`. Mark something read in the bell, open Inbox, and it is unread
 * again until Inbox refetches — both correct according to their own state and
 * disagreeing with each other.
 *
 * The handover writes the fix as a react-query hook. There is no react-query in
 * this build (`package.json` has axios, react-router and lucide — nothing else),
 * so the same contract is served by a module-level store read through
 * `useSyncExternalStore`. That choice buys one thing react-query would not: the
 * store works with or without a Provider mounted, so InboxPage can adopt it
 * today while the bell — which lives in `layout/`, outside this change — adopts
 * it later without a flag day. When it does, both read the same array and the
 * disagreement is structurally impossible rather than merely fixed.
 *
 * ONE REQUEST SHAPE PER CALL. `markRead` sends `{ notification_ids }` and never
 * `mark_all`; `markAll` sends `{ mark_all: true }` and never `notification_ids`.
 * Staging sent `{ mark_all: true, notification_ids: [] }` from two callers, which
 * works only because the endpoint tolerates both keys at once — the next change
 * to it breaks exactly one of them.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore,
} from 'react';
import { api } from '../lib/api';

/* ── Store ─────────────────────────────────────────────────────────────────
   Module-level, not per-Provider, so a second mount reads the same array
   instead of starting a second copy of the state this file exists to unify. */

const STALE_MS = 30_000;

let state = {
  items: [],
  loading: false,
  loaded: false,
  error: null,
  /** Why we are about to ask for browser permission — see `askAfterAction`. */
  askReason: null,
};

let lastFetch = 0;
let inflight = null;
const listeners = new Set();

function emit() { for (const fn of [...listeners]) fn(); }
function set(patch) { state = { ...state, ...patch }; emit(); }

function subscribe(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function getSnapshot() { return state; }

/** Test seam and logout hook — drops the cache without a network round trip. */
export function resetNotifications() {
  lastFetch = 0;
  inflight = null;
  state = { items: [], loading: false, loaded: false, error: null, askReason: null };
  emit();
}

/**
 * Fetch the list. Deduplicated while in flight and served from cache inside
 * `STALE_MS`, so mounting the Inbox while the bell is open is one request.
 */
export function refreshNotifications({ force = false } = {}) {
  if (inflight) return inflight;
  if (!force && state.loaded && Date.now() - lastFetch < STALE_MS) {
    return Promise.resolve(state.items);
  }
  set({ loading: true });
  inflight = api.get('/notifications')
    .then((r) => {
      const items = Array.isArray(r.data) ? r.data : [];
      lastFetch = Date.now();
      set({ items, loading: false, loaded: true, error: null });
      return items;
    })
    .catch((err) => {
      // The list is kept. A failed refresh should not blank a list the user is
      // reading — `error` drives the banner, the items stay put.
      set({ loading: false, loaded: true, error: err });
      return state.items;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/**
 * Mark specific notifications read. Optimistic — the badge has to move on the
 * click, not on the response — with a full rollback if the write fails.
 */
export async function markNotificationsRead(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return true;
  const prev = state.items;
  if (!prev.some((n) => list.includes(n.notification_id) && !n.read_at)) return true;

  const now = new Date().toISOString();
  set({
    items: prev.map((n) => (list.includes(n.notification_id) ? { ...n, read_at: n.read_at ?? now } : n)),
  });
  try {
    await api.post('/notifications/mark-read', { notification_ids: list });
    return true;
  } catch (err) {
    set({ items: prev, error: err });
    return false;
  }
}

/** Mark every unread notification read. Same optimistic contract. */
export async function markAllNotificationsRead() {
  const prev = state.items;
  if (!prev.some((n) => !n.read_at)) return true;

  const now = new Date().toISOString();
  set({ items: prev.map((n) => ({ ...n, read_at: n.read_at ?? now })) });
  try {
    await api.post('/notifications/mark-read', { mark_all: true });
    return true;
  } catch (err) {
    set({ items: prev, error: err });
    return false;
  }
}

/**
 * Merge notifications the poll already delivered instead of refetching. This is
 * the hook `AppShell`'s poll should call in place of holding its own array —
 * `/notifications/poll` returns `fresh`, which is the same row shape as
 * `/notifications`.
 */
export function ingestNotifications(fresh) {
  if (!Array.isArray(fresh) || !fresh.length) return;
  const seen = new Set(state.items.map((n) => n.notification_id));
  const added = fresh.filter((n) => n?.notification_id && !seen.has(n.notification_id));
  if (!added.length) return;
  set({ items: [...added, ...state.items], loaded: true });
}

/* ── Preferences, quiet hours and the delivery gate ────────────────────────
   `k_prefs` is the object CustomizePanel writes. The handover asks for the
   notification preference to move into it rather than living alone in
   localStorage, so this reads from there and tolerates its absence — none of
   the DND keys exist in DEFAULTS yet, and a missing key must mean "not in DND"
   rather than throwing. */

const PREFS_KEY = 'k_prefs';

export function readNotifPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) { return {}; }
}

function minutesOf(hhmm, fallback) {
  const [h, m] = String(hhmm ?? '').split(':').map(Number);
  if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  return fallback;
}

/**
 * Quiet hours, wrap-aware.
 *
 * The wrap case is the whole point: quiet hours nearly always cross midnight,
 * and a naive `from <= m && m < to` silences nothing at all for 20:00 → 09:00.
 */
export function inDND(prefs, now = new Date()) {
  if (!prefs?.dnd) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  const from = minutesOf(prefs.dndFrom, 22 * 60);
  const to = minutesOf(prefs.dndTo, 7 * 60);
  return from <= to ? (m >= from && m < to) : (m >= from || m < to);
}

/**
 * One gate, three channels.
 *
 * DND suppresses the toast, the sound and the push. It never suppresses the
 * notification — it arrives in the Inbox with its real timestamp. The record is
 * when it happened, not when you saw it.
 *
 * `support` ignores DND and ignores the email preference. A customer being asked
 * to grant access to their own data is told immediately, at 3am, whatever their
 * settings say; `11-platform-admin.md` states support access is never silent.
 */
export function shouldDeliver(kind, prefs = readNotifPrefs(), now = new Date()) {
  if (kind === 'support') return { toast: true, sound: true, push: true, email: true };
  const quiet = inDND(prefs, now);
  return {
    toast: !quiet,
    sound: !quiet && prefs?.notifSound !== false,
    push: !quiet && prefs?.push !== false && notifPermission() === 'granted',
    email: prefs?.email?.[kind] !== false,
  };
}

/* ── Browser permission ────────────────────────────────────────────────────
   Never read `Notification.permission` without the guard. The API is absent in
   iOS Safari before 16.4, in embedded webviews, and on any page outside a
   secure context, where an unguarded read throws on mount and renders a blank
   screen. `unsupported` is its own state, not `denied` — the denied copy tells
   the user to change a browser setting that does not exist. */

export function notifPermission() {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  return supported ? Notification.permission : 'unsupported';
}

export function pushSupported() {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

const ASK_KEY = 'kv_notif_ask_reason';

/**
 * Defect 4 · the permission prompt must not fire on a timer.
 *
 * AppShell asks after a 4-second `setTimeout` on the first authenticated load —
 * four seconds into a user's first ever session, before they have created
 * anything. Deny once and the browser blocks it permanently; no code can ask
 * again. Gate on an event instead: call this after the first action that would
 * actually produce a notification — assigning a task, requesting an approval,
 * sending a message — and the prompt explains itself, because the user just did
 * the thing it is about.
 *
 * Persisted, so the reason survives the reload that follows the action.
 */
export function askAfterAction(reason) {
  if (!reason || notifPermission() !== 'default') return;
  try { localStorage.setItem(ASK_KEY, reason); } catch (_) {}
  set({ askReason: reason });
}

export function clearAskReason() {
  try { localStorage.removeItem(ASK_KEY); } catch (_) {}
  set({ askReason: null });
}

function storedAskReason() {
  try { return localStorage.getItem(ASK_KEY); } catch (_) { return null; }
}

/* ── Hook ──────────────────────────────────────────────────────────────────*/

/**
 * The only read path. Bell, Inbox and the unread count all call this, so there
 * is one array and one definition of unread.
 */
export function useNotifications({ autoLoad = true } = {}) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!autoLoad) return;
    refreshNotifications();
  }, [autoLoad]);

  // Hydrate the persisted ask reason once, so a reload after the triggering
  // action still explains itself.
  useEffect(() => {
    if (state.askReason) return;
    const stored = storedAskReason();
    if (stored && notifPermission() === 'default') set({ askReason: stored });
  }, []);

  const unread = useMemo(() => snap.items.filter((n) => !n.read_at).length, [snap.items]);

  const markRead = useCallback((ids) => markNotificationsRead(ids), []);
  const markAll = useCallback(() => markAllNotificationsRead(), []);
  const refresh = useCallback((opts) => refreshNotifications(opts), []);

  return {
    items: snap.items,
    unread,
    // Only the FIRST load is a loading state. A background revalidation must not
    // replace a list the user is already reading with a skeleton.
    isLoading: snap.loading && !snap.loaded,
    isRefreshing: snap.loading,
    error: snap.error,
    askReason: snap.askReason,
    refresh,
    markRead,
    markAll,
  };
}

/* ── Provider ──────────────────────────────────────────────────────────────*/

const NotificationCtx = createContext(null);

/**
 * Optional. `useNotifications()` reads the module store directly and does not
 * need this to be mounted — the Provider exists so the shell can move its poll
 * here in one edit instead of keeping a second copy of the count.
 *
 * When `AppShell` adopts it, delete its `unread`/`toasts` state and its
 * `/notifications/poll` effect; this owns both, and `onFresh` hands the shell
 * exactly the rows it needs to toast.
 */
export function NotificationProvider({ children, intervalMs = 60_000, onFresh }) {
  const bag = useNotifications();

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const r = await api.get('/notifications/poll');
        if (!live) return;
        const fresh = Array.isArray(r.data?.fresh) ? r.data.fresh : [];
        // The poll invalidates the cache rather than holding its own array.
        ingestNotifications(fresh);
        if (fresh.length) onFresh?.(fresh);
      } catch (_) { /* a failed poll is not a user-facing error */ }
    };
    tick();
    let id = setInterval(tick, intervalMs);
    const onVis = () => {
      clearInterval(id);
      id = setInterval(tick, document.hidden ? intervalMs * 5 : intervalMs);
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      live = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [intervalMs, onFresh]);

  return <NotificationCtx.Provider value={bag}>{children}</NotificationCtx.Provider>;
}

/** Present only when a Provider is mounted; prefer `useNotifications()`. */
export function useNotificationContext() {
  return useContext(NotificationCtx);
}

export default NotificationProvider;
