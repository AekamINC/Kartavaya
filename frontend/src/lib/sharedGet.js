/**
 * One network request when several components ask for the same thing at once.
 *
 * ── THE MEASUREMENT THAT PRODUCED THIS ──────────────────────────────────────
 *
 * Opening the tasks page fired EIGHT API calls for FIVE distinct endpoints
 * (Resource Timing, live, 2026-09-01):
 *
 *     /api/v1/me/column-prefs      1
 *     /api/tasks                   2   <-- twice
 *     /api/teams                   2   <-- twice
 *     /api/categories              2   <-- twice
 *     /api/tasks/auto-archive      1
 *
 * All eight started within 7ms of each other, so they were already parallel —
 * the waste was not ordering, it was asking twice. Each call cost between 1.6
 * and 3.0 seconds on that trace, against ~0.24s of round trip, so the
 * duplicates are not free: they contend for the same pool and the same worker.
 *
 * The cause is ordinary and not anybody's mistake. `/teams` is fetched by
 * `AppShell`, by `NewTaskModal` and by `OnboardingChecklist`; `/categories` by
 * `TaskDrawer`, by `TasksListPage` and by `CategoriesPage`. Each is correct on
 * its own and knows nothing about the others.
 *
 * ── IN-FLIGHT ONLY, AND THAT IS THE WHOLE DESIGN ────────────────────────────
 *
 * `useColumnPrefs` keeps a resolved `cache` alongside its `inflight`, and it is
 * right to: preferences change when the user changes them, so it owns an
 * `epoch` to invalidate. THIS DOES NOT CACHE. The promise is shared only while
 * it is still in the air, and the entry is dropped the moment it settles.
 *
 * That is deliberate. A resolved cache would need an invalidation story for
 * every endpoint it touched — and getting that wrong shows a customer a team
 * or a category that no longer exists, which is far worse than one extra
 * request. Sharing an in-flight promise cannot go stale, because the response
 * is the same response the duplicate call would have received microseconds
 * later. There is no window in which the two answers could differ.
 *
 * ⚠ EACH CALLER GETS ITS OWN COPY. Handing the same object to two components
 * means one of them mutating it — sorting a list in place, say — silently
 * changes what the other rendered. The clone is cheap next to the request it
 * replaces, and it keeps this a pure optimisation with no behavioural edge.
 */
import { api } from './api';

/** url -> the promise currently in the air for it. Never holds a settled one. */
const inflight = new Map();

/** Structured copy, so no two callers share a mutable reference. */
function copy(value) {
  if (value == null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    // Dates, Maps and DOM-ish values survive structuredClone; a value carrying
    // a function does not. JSON is the honest fallback and covers every API
    // payload this product returns.
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }
}

/**
 * `api.get(url)`, except that concurrent calls for the same url share one
 * request. Resolves to the same shape `api.get` does, so it is a drop-in.
 *
 * @param {string} url  The path, exactly as `api.get` would take it.
 */
export function sharedGet(url) {
  const pending = inflight.get(url);
  if (pending) return pending.then((r) => ({ ...r, data: copy(r.data) }));

  const p = api.get(url)
    .then((r) => { inflight.delete(url); return r; })
    // ⚠ Cleared on failure too. Leaving a rejected promise in the map would
    // make one dropped request poison every later attempt at that url for the
    // life of the tab — a far worse bug than the one this file fixes.
    .catch((e) => { inflight.delete(url); throw e; });

  inflight.set(url, p);
  return p.then((r) => ({ ...r, data: copy(r.data) }));
}

export default sharedGet;
