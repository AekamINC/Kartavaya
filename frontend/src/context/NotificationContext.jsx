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
 * Two things this file owns beyond that, both documented at the code:
 *   · WHOSE notifications the cache holds. A module-level cache lives as long
 *     as the tab, not as long as the session, so it is scoped to the signed-in
 *     user and drops itself the moment that changes. See "Whose notifications
 *     are these?" below — it is a privacy boundary, not an optimisation.
 *   · QUIET HOURS come from the server, not from `k_prefs`. See "Quiet hours".
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

/**
 * One page. `GET /notifications` still caps at 200 for a caller that sends no
 * paging params, but 200 rows is a 200-row DOM on first paint for anyone who
 * has been away a fortnight. 40 fills the viewport twice over.
 */
export const PAGE_SIZE = 40;

/** The server's documented quiet window, mirrored from `GET /me/notification_prefs`. */
const DEFAULT_QUIET = { start: '22:00', end: '07:00' };

const EMPTY = {
  items: [],
  loading: false,
  loaded: false,
  error: null,
  /**
   * Paging state. `hasMore` is inferred from a FULL page, not from a count the
   * endpoint does not return: a short page is the last page. `loadingMore` is
   * separate from `loading` so the "Load more" button can spin without the page
   * reverting to its skeleton — a list that becomes a skeleton when you ask for
   * more of it has thrown away what you were reading.
   * `pageError` is separate from `error` for the same reason: a failed page
   * must not raise the full-page error state over a list that is still good.
   */
  hasMore: false,
  loadingMore: false,
  pageError: null,
  /**
   * A mark-read that failed and was rolled back. Distinct from `error`, which
   * is the page-level fetch failure — see the rollback note at the mutations.
   */
  mutationError: null,
  /** Why we are about to ask for browser permission — see `askAfterAction`. */
  askReason: null,
  /**
   * The SERVER's quiet-hours window and per-kind delivery modes. Not read from
   * localStorage — see the quiet-hours section below.
   * `loaded` is false until `GET /me/notification_prefs` has answered; the
   * window still carries the server's defaults so the gate behaves like the
   * sender does, but no UI may CLAIM quiet hours are on until `loaded`.
   */
  quiet: { loaded: false, start: DEFAULT_QUIET.start, end: DEFAULT_QUIET.end, modes: null },
};

let state = { ...EMPTY };

let lastFetch = 0;
let inflight = null;
/** In-flight `loadMoreNotifications`, so a double click is one request. */
let morePending = null;
// Declared with the rest of the store rather than beside `refreshQuietHours`,
// because `purgeIfForeign` clears them and would otherwise touch a `let` in its
// temporal dead zone if anything ever called into the store during module init.
let quietFetch = 0;
let quietInflight = null;
const listeners = new Set();

function emit() { for (const fn of [...listeners]) fn(); }
function set(patch) { state = { ...state, ...patch }; emit(); }

function subscribe(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/* ── Whose notifications are these? ────────────────────────────────────────
   PRIVACY, not polish. The cache above is module-level, which is the whole
   point of this file — but a module lives as long as the TAB, not as long as
   the session. Sign out and sign back in as somebody else without reloading
   and the second user renders the first user's inbox: their titles, their
   client names, their approval requests. `resetNotifications()` exists for
   `apiLogout()` to call and `apiLogout()` does not call it, so the store
   defends itself instead of trusting a caller it does not control:

   every read and every write first checks WHO the cache belongs to, and a
   cache belonging to anybody else is dropped before it can be rendered. That
   also covers the cases a logout hook alone would miss — a token expiring and
   a different account signing in, a second tab logging out, a session restored
   from a stale localStorage. The logout hook is still worth wiring (it frees
   the memory a beat earlier and is the obvious place to look); it is no longer
   the only thing standing between two users and each other's mail. */

/** The key `lib/auth.js` writes on sign-in and clears on `apiLogout()`. */
const USER_KEY = 'Kartavaya_user';

let owner;      // `undefined` until the first check — never a valid id.
let ownerRaw;   // the raw record `owner` was derived from, so the hot path can
                // compare strings instead of parsing JSON on every render.

function rawUser() {
  try { return localStorage.getItem(USER_KEY); } catch (_) { return null; }
}

function idFrom(raw) {
  if (!raw) return null;
  try { const u = JSON.parse(raw); return u?.user_id || u?.id || u?.email || null; }
  catch (_) { return null; }
}

/**
 * Drop anything cached for a different signed-in user. Returns true if it did.
 *
 * Deliberately does NOT emit: it is called from `getSnapshot`, which React runs
 * during render, and an emit there would be a re-entrant store update. It
 * replaces `state` with a fresh empty object, so the very next `getSnapshot`
 * returns that same object and `useSyncExternalStore` settles in one step.
 */
function purgeIfForeign() {
  const raw = rawUser();
  if (raw === ownerRaw) return false;   // hot path: unchanged record, no parse.
  ownerRaw = raw;
  const id = idFrom(raw);
  // The record is rewritten on a profile edit, which is not a change of user.
  if (id === owner) return false;
  owner = id;
  lastFetch = 0;
  quietFetch = 0;
  inflight = null;
  morePending = null;
  quietInflight = null;
  state = { ...EMPTY, quiet: { ...EMPTY.quiet } };
  return true;
}

function getSnapshot() {
  purgeIfForeign();
  return state;
}

/** Logout hook and test seam — drops the cache without a network round trip. */
export function resetNotifications() {
  lastFetch = 0;
  quietFetch = 0;
  inflight = null;
  morePending = null;
  quietInflight = null;
  ownerRaw = rawUser();
  owner = idFrom(ownerRaw);
  state = { ...EMPTY, quiet: { ...EMPTY.quiet } };
  emit();
}

/* A logout in a second tab clears the record there; `storage` is how this tab
   hears about it. Without this the other tab's list stays in memory until
   something happens to call into the store. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key && e.key !== USER_KEY) return;
    if (purgeIfForeign()) emit();
  });
}

/**
 * Fetch the list. Deduplicated while in flight and served from cache inside
 * `STALE_MS`, so mounting the Inbox while the bell is open is one request.
 */
export function refreshNotifications({ force = false } = {}) {
  purgeIfForeign();
  if (inflight) return inflight;
  if (!force && state.loaded && Date.now() - lastFetch < STALE_MS) {
    return Promise.resolve(state.items);
  }
  set({ loading: true });
  inflight = api.get('/notifications', { params: { limit: PAGE_SIZE } })
    .then((r) => {
      const items = Array.isArray(r.data) ? r.data : [];
      lastFetch = Date.now();
      // A refresh RESETS paging. Anything the user had loaded past page one is
      // dropped along with the cursor, because keeping it would splice a fresh
      // page one onto stale pages two-and-after with an unknown gap between
      // them — every row in the gap silently missing from a list whose whole
      // job is not to lose things.
      set({
        items,
        loading: false,
        loaded: true,
        error: null,
        pageError: null,
        // A full page means there is probably another. A short one is the last
        // one — the endpoint returns no total, and asking for a count on every
        // poll to save one empty request at the very end is the wrong trade.
        hasMore: items.length >= PAGE_SIZE,
      });
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
 * The next page, keyset-anchored on the oldest row we hold.
 *
 * NOT an offset. Notifications are inserted at the HEAD of this list while the
 * user is reading it, so `OFFSET 40` after one arrival re-serves a row already
 * on screen and skips one that never was. The cursor is the `created_at` and
 * `notification_id` of the last row we have, and the server asks for strictly
 * older than that pair — an insert above the cursor cannot move it.
 *
 * `notification_id` is in the cursor because `created_at` alone is not unique:
 * `_notify_status_changed` and the reminder dispatch each insert a row per
 * recipient inside one loop, so a batch shares a timestamp to the microsecond.
 */
export function loadMoreNotifications() {
  purgeIfForeign();
  if (morePending || !state.hasMore || !state.items.length) {
    return Promise.resolve(state.items);
  }
  const last = state.items[state.items.length - 1];
  if (!last?.created_at || !last?.notification_id) {
    // No usable cursor — say so rather than looping on the same page forever.
    set({ hasMore: false });
    return Promise.resolve(state.items);
  }
  set({ loadingMore: true, pageError: null });
  morePending = api.get('/notifications', {
    params: { limit: PAGE_SIZE, before: last.created_at, before_id: last.notification_id },
  })
    .then((r) => {
      const page = Array.isArray(r.data) ? r.data : [];
      // Dedupe defensively. The cursor is exclusive server-side, but a row
      // ingested by the poll between the two requests could already be here,
      // and a duplicate key is a React warning plus a row the user reads twice.
      const seen = new Set(state.items.map((n) => n.notification_id));
      const added = page.filter((n) => n?.notification_id && !seen.has(n.notification_id));
      set({
        items: [...state.items, ...added],
        loadingMore: false,
        hasMore: page.length >= PAGE_SIZE,
      });
      return state.items;
    })
    .catch((err) => {
      // The page failed; the list did not. `pageError` is rendered beside the
      // button, not as the page-level error state, so nothing already loaded is
      // taken away and the user can simply press it again.
      set({ loadingMore: false, pageError: err });
      return state.items;
    })
    .finally(() => { morePending = null; });
  return morePending;
}

/* ── Optimistic reads ──────────────────────────────────────────────────────

   THE ROLLBACK IS SURGICAL, NOT A SNAPSHOT RESTORE. Both mutations used to
   revert with `set({ items: prev })`, replacing the whole array with the copy
   taken before the request. The poll runs on a 60-second interval and
   `ingestNotifications` prepends to that same array, so a notification arriving
   during the round trip was DELETED by the rollback of an unrelated failed
   click — the one failure mode this list must not have. The rollback now undoes
   exactly the `read_at` values this call set, on whatever the array is now, and
   leaves every other row alone.

   A SILENT REVERT IS ITS OWN LIE. If the write fails the row flips back to
   unread and, without `mutationError`, nothing tells the user why — they see a
   row they just read become unread again and conclude the product is broken.
   `error` is the page-level fetch failure and is NOT reused for this: raising
   the full-page error state over a list that is still perfectly good would take
   away more than it explains. */

/** Undo `read_at` for `ids` that this call was the one to set. */
function rollbackRead(ids, stamp) {
  const set_ = new Set(ids);
  return state.items.map((n) => (
    set_.has(n.notification_id) && n.read_at === stamp ? { ...n, read_at: null } : n
  ));
}

/**
 * Mark specific notifications read. Optimistic — the badge has to move on the
 * click, not on the response — with a rollback if the write fails.
 */
export async function markNotificationsRead(ids) {
  purgeIfForeign();
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return true;
  if (!state.items.some((n) => list.includes(n.notification_id) && !n.read_at)) return true;

  const now = new Date().toISOString();
  set({
    items: state.items.map((n) => (
      list.includes(n.notification_id) ? { ...n, read_at: n.read_at ?? now } : n
    )),
    mutationError: null,
  });
  try {
    await api.post('/notifications/mark-read', { notification_ids: list });
    return true;
  } catch (err) {
    set({ items: rollbackRead(list, now), mutationError: err });
    return false;
  }
}

/** Mark every unread notification read. Same optimistic contract. */
export async function markAllNotificationsRead() {
  purgeIfForeign();
  const unreadIds = state.items.filter((n) => !n.read_at).map((n) => n.notification_id);
  if (!unreadIds.length) return true;

  const now = new Date().toISOString();
  set({
    items: state.items.map((n) => ({ ...n, read_at: n.read_at ?? now })),
    mutationError: null,
  });
  try {
    await api.post('/notifications/mark-read', { mark_all: true });
    return true;
  } catch (err) {
    set({ items: rollbackRead(unreadIds, now), mutationError: err });
    return false;
  }
}

/** Dismiss the mark-read failure notice once the user has seen it. */
export function clearMutationError() {
  if (state.mutationError) set({ mutationError: null });
}

/**
 * Merge notifications the poll already delivered instead of refetching. This is
 * the hook `AppShell`'s poll should call in place of holding its own array —
 * `/notifications/poll` returns `fresh`, which is the same row shape as
 * `/notifications`.
 */
export function ingestNotifications(fresh) {
  purgeIfForeign();
  if (!Array.isArray(fresh) || !fresh.length) return;
  const seen = new Set(state.items.map((n) => n.notification_id));
  const added = fresh.filter((n) => n?.notification_id && !seen.has(n.notification_id));
  if (!added.length) return;
  set({ items: [...added, ...state.items], loaded: true });
}

/* ── Preferences ───────────────────────────────────────────────────────────
   `k_prefs` is the object CustomizePanel writes. It carries device-local taste
   — the notification SOUND — and nothing that decides delivery. Everything a
   sender consults lives on the server; see the next section. */

const PREFS_KEY = 'k_prefs';

export function readNotifPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) { return {}; }
}

/* ── Quiet hours — the SERVER's window, evaluated in IST ───────────────────

   THE CONTRADICTION THIS RESOLVES. The handover's `inDND()` read
   `prefs.dnd` / `dndFrom` / `dndTo` out of `k_prefs`. Those three keys do not
   exist in CustomizePanel's DEFAULTS and were deliberately never added, on the
   correct reasoning that quiet hours are enforced SERVER-side. The consequence
   was that `prefs.dnd` was always undefined, `inDND()` always returned false,
   and the banner could never show quiet-hours state at all — a schedule that
   silences nothing and a UI that can never say so.

   Adding the three keys would have been worse than leaving them out. NOTHING
   READS THEM: `services/push_service.py` decides delivery from the
   `notification_prefs` row — `_in_quiet_hours(quiet_start, quiet_end)`,
   midnight-wrapping, plus `_mode_allows(mode, is_mine)` per kind — and
   `GET/PUT /api/me/notification_prefs` is the only way to move those values.
   A localStorage window would have LOOKED set, on one device, and muted
   nothing anywhere.

   So this reads the server's window and mirrors the server's arithmetic.
   `components/customize/NotifyPrefs.jsx` is the UI that writes it; the shapes
   here match that contract exactly and this file never writes it.

   IST, NOT THE BROWSER CLOCK. `push_service.py` evaluates the window against
   `datetime.now(IST)`. A user in London reading `getHours()` would be told
   quiet hours end at 07:00 and see their toasts stop five and a half hours off
   what the server actually does. The window is a wall-clock time in one fixed
   zone, so it is computed from UTC plus a fixed offset, not from the device. */

export const IST_OFFSET_MIN = 5 * 60 + 30;

const QUIET_STALE_MS = 300_000;

const isHHMM = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? ''));

function minutesOf(hhmm, fallback) {
  const [h, m] = String(hhmm ?? '').split(':').map(Number);
  if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  return fallback;
}

/** Minutes past midnight IST, wherever the device thinks it is. */
export function istMinutes(now = new Date()) {
  return (now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MIN + 1440) % 1440;
}

/**
 * Load the server's quiet window and per-kind modes.
 *
 * Cached for five minutes: a schedule changes about once, and `NotifyPrefs`
 * is the only writer. Call with `{ force: true }` after a save there.
 */
export function refreshQuietHours({ force = false } = {}) {
  purgeIfForeign();
  if (quietInflight) return quietInflight;
  if (!force && state.quiet.loaded && Date.now() - quietFetch < QUIET_STALE_MS) {
    return Promise.resolve(state.quiet);
  }
  quietInflight = api.get('/me/notification_prefs')
    .then((r) => {
      const d = r?.data || {};
      quietFetch = Date.now();
      const quiet = {
        loaded: true,
        // The endpoint's own fallbacks, restated because a row written before
        // the columns had defaults can still answer with null.
        start: isHHMM(d.quiet_start) ? d.quiet_start : DEFAULT_QUIET.start,
        end: isHHMM(d.quiet_end) ? d.quiet_end : DEFAULT_QUIET.end,
        // GET merges DEFAULT_PREFS server-side, so this is complete and there
        // is no need for a fourth copy of that table on the client.
        modes: d.prefs && typeof d.prefs === 'object' ? d.prefs : {},
      };
      set({ quiet });
      return quiet;
    })
    .catch(() => {
      // A window we could not read is not a window we may announce. The gate
      // keeps the server's defaults so it behaves like the sender; `loaded`
      // stays false so no banner claims quiet hours are on.
      set({ quiet: { ...state.quiet, loaded: false } });
      return state.quiet;
    })
    .finally(() => { quietInflight = null; });
  return quietInflight;
}

/**
 * Quiet hours, wrap-aware, in IST — the same arithmetic as
 * `push_service._in_quiet_hours`.
 *
 * The wrap case is the whole point: quiet hours nearly always cross midnight,
 * and a naive `from <= m && m < to` silences nothing at all for 22:00 → 07:00.
 * An empty window (`from === to`) silences nothing, which is what the server
 * returns for it too.
 */
export function inQuietHours(quiet = state.quiet, now = new Date()) {
  const from = minutesOf(quiet?.start, 22 * 60);
  const to = minutesOf(quiet?.end, 7 * 60);
  if (from === to) return false;
  const m = istMinutes(now);
  return from < to ? (m >= from && m < to) : (m >= from || m < to);
}

/**
 * One gate, three channels.
 *
 * Quiet hours suppress the toast, the sound and the push. They never suppress
 * the notification — it arrives in the Inbox with its real timestamp. The
 * record is when it happened, not when you saw it.
 *
 * `type` is the RAW backend type string (`approval_request`, `status_changed`,
 * …), not one of the eight display kinds, because that is the key the mode map
 * is stored under. `isMine` mirrors the server's argument of the same name:
 * `mine_only` delivers when the event is yours, `project` for anything in a
 * project you belong to.
 *
 * `support` ignores quiet hours and ignores the email preference. A customer
 * being asked to grant access to their own data is told immediately, at 3am,
 * whatever their settings say; `11-platform-admin.md` states support access is
 * never silent.
 *
 * This is the client half only — it governs the in-app toast and the sound.
 * Push is refused or allowed by `push_service.py` regardless of what this
 * returns; the `push` field is what this device would ADD to that, never a
 * licence to override it.
 */
export function shouldDeliver(type, {
  quiet = state.quiet, prefs = readNotifPrefs(), now = new Date(), isMine = true,
} = {}) {
  if (type === 'support') return { toast: true, sound: true, push: true, email: true };
  const quietNow = inQuietHours(quiet, now);
  const mode = quiet?.modes?.[type];
  // Unknown mode = not yet loaded, or a kind with no row in the preference
  // table. Both mean "the user has not switched this off".
  const allowed = mode === 'off' ? false : mode === 'mine_only' ? isMine : true;
  return {
    toast: !quietNow,
    sound: !quietNow && prefs?.notifSound !== false,
    push: !quietNow && allowed && notifPermission() === 'granted',
    email: allowed,
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
 * The reasons, as a closed set.
 *
 * The banner renders "You just {reason}." so the string has to be a past-tense
 * verb phrase that finishes that sentence. Exported as a table rather than left
 * to each call site because four call sites writing their own copy is four
 * chances to produce "You just Task assigned." — and this is the one prompt the
 * browser will let us show exactly once.
 */
export const ASK_REASONS = {
  assigned: 'assigned a task to someone',
  approval: 'requested an approval',
  mention: 'mentioned a teammate',
  comment: 'commented on a task',
  message: 'sent a message',
};

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
 * CALL IT WITH AN `ASK_REASONS` VALUE, from the success path of the action —
 * `askAfterAction(ASK_REASONS.assigned)` after the assign request resolves, not
 * before it is sent. An ask attached to an action that then failed is the timer
 * again, with extra steps.
 *
 * Silent unless the browser is still undecided: once permission is `granted`,
 * `denied` or `unsupported` there is nothing to ask for, and calling this from
 * a hot path costs nothing.
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
export function useNotifications({ autoLoad = true, quietHours = false } = {}) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!autoLoad) return;
    refreshNotifications();
  }, [autoLoad]);

  // Opt-in, so the bell popover does not fetch a schedule it never renders.
  // Anything that decides delivery — the banner, and the toast gate when
  // `layout/` adopts `shouldDeliver` — passes `{ quietHours: true }`.
  useEffect(() => {
    if (!quietHours) return;
    refreshQuietHours();
  }, [quietHours]);

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
  const loadMore = useCallback(() => loadMoreNotifications(), []);
  const dismissMutationError = useCallback(() => clearMutationError(), []);

  return {
    items: snap.items,
    unread,
    // "Has never finished a load", not "a request is in flight".
    //
    // `snap.loading && !snap.loaded` was false on the very first render — the
    // fetch starts in an effect, which runs AFTER that render — so the Inbox
    // painted its "You're all caught up" empty state for one frame, then the
    // skeleton, then the list. The first thing a user with 40 unread saw was a
    // claim that they had none. `loaded` turns true on success AND on failure,
    // so this is exactly the pre-first-answer window.
    isLoading: !snap.loaded,
    isRefreshing: snap.loading,
    error: snap.error,
    /** A mark-read that failed and was rolled back — never the fetch error. */
    mutationError: snap.mutationError,
    /** Paging. `hasMore` is a full last page, not a count the server never sent. */
    hasMore: snap.hasMore,
    loadingMore: snap.loadingMore,
    pageError: snap.pageError,
    askReason: snap.askReason,
    /** The server's window, plus whether it is open right now. */
    quiet: snap.quiet,
    inQuiet: snap.quiet.loaded && inQuietHours(snap.quiet),
    refresh,
    loadMore,
    markRead,
    markAll,
    dismissMutationError,
  };
}

/* ── Provider ──────────────────────────────────────────────────────────────*/

const NotificationCtx = createContext(null);

/**
 * Optional. `useNotifications()` reads the module store directly and does not
 * need this to be mounted — the Provider exists so the shell can move its poll
 * here in one edit instead of keeping a second copy of the count.
 *
 * `onFresh(rows)` gets the rows to toast. `onPoll(payload)` gets the WHOLE
 * `/notifications/poll` body, which is `{ unread, fresh, approvals }`.
 *
 * `onPoll` exists because the shell needed exactly one field this store does
 * not own — `approvals`, the pending-decision badge — and, lacking any way to
 * reach it, kept a SECOND `/notifications/poll` timer of its own purely to read
 * that integer. Two timers, one endpoint, and the reminder-processing side
 * effects in that handler running twice as often as intended. One poll now
 * serves both, and the shell subscribes to the payload instead of re-fetching
 * it. `01-navigation.md` §4 asks for one call returning `{ inbox, approvals }`;
 * this is that call.
 */
export function NotificationProvider({ children, intervalMs = 60_000, onFresh, onPoll }) {
  // The shell is where toasts and sounds fire, so the Provider is the one
  // consumer that always needs the quiet-hours window.
  const bag = useNotifications({ quietHours: true });

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const r = await api.get('/notifications/poll');
        if (!live) return;
        const fresh = Array.isArray(r.data?.fresh) ? r.data.fresh : [];
        // The poll invalidates the cache rather than holding its own array.
        ingestNotifications(fresh);
        onPoll?.(r.data || {});
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
  }, [intervalMs, onFresh, onPoll]);

  return <NotificationCtx.Provider value={bag}>{children}</NotificationCtx.Provider>;
}

/** Present only when a Provider is mounted; prefer `useNotifications()`. */
export function useNotificationContext() {
  return useContext(NotificationCtx);
}

export default NotificationProvider;
