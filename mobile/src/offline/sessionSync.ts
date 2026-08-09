/**
 * sessionSync — what happens every time the app is opened.
 *
 * Owner's decision, 2026-08-09: "everytime when user opens it gets sync … in
 * background, it actually [syncs] the data since last session."
 *
 * Three things, in this order, and the order matters:
 *
 *   1. **Refresh the token.** Cheapest, and everything after it needs a valid
 *      one. It is also what makes "Remember me" keep its promise: the server
 *      re-mints a year-long token on every open, so the deadline is always a
 *      year out rather than a year from the day the password was typed.
 *   2. **Send anything queued offline.** BEFORE pulling, always. Pull first and
 *      the server's version of a row overwrites the local edit that has not
 *      reached it yet — the user's own work, silently discarded, which is the
 *      worst outcome available to a sync routine.
 *   3. **Pull what changed**, using `?since=` against the timestamp the SERVER
 *      gave us last time, then apply deletions from `/v1/sync/tombstones`.
 *
 * ── THE TIMESTAMP IS ALWAYS THE SERVER'S ────────────────────────────────────
 *
 * Never `Date.now()`. Phone clocks are wrong — by minutes usually, by hours
 * when a timezone is mishandled — and a device whose clock runs fast asks for
 * changes since a moment in the future and is told, correctly and uselessly,
 * that nothing has changed. Every delta response carries `synced_at`; that is
 * what gets stored and sent back.
 *
 * ── A FAILED SYNC IS NOT AN ERROR THE USER NEEDS ────────────────────────────
 *
 * The app already works offline. If the sync cannot run, the cached data is
 * still there and still correct as of the last successful one — so this reports
 * its outcome to whoever asked and never throws into a screen. The one case
 * that IS surfaced is `resync_required`: the device has been away longer than
 * the server keeps deletion history, and continuing to trust the cache would
 * mean showing records that were deleted weeks ago.
 */
import { apiClient } from '../api/client';
import { apiRefresh } from '../api/auth';
import { storage } from '../lib/storage';
import { flushQueue, getQueueCount } from './mutationQueue';
import { queryClient } from './queryClient';

/** The server's `synced_at` from the last successful sync. */
const SINCE_KEY = 'sync_since';

export interface SyncOutcome {
  ran:      boolean;
  pushed:   number;
  changed:  number;
  removed:  number;
  /** The device has been away longer than the deletion history is kept. */
  resynced: boolean;
  error?:   string;
}

export function lastSyncedAt(): string | null {
  return storage.getString(SINCE_KEY) ?? null;
}

/** Only ever called with a value the SERVER produced. */
function rememberSyncedAt(iso: string | undefined | null): void {
  if (iso) storage.set(SINCE_KEY, iso);
}

/** Forget the delta cursor, so the next sync pulls everything. */
export function resetSyncCursor(): void {
  storage.delete(SINCE_KEY);
}

/** The three endpoints the app reads that support `?since=`. */
const DELTA_SOURCES: Array<{ url: string; keys: string[][] }> = [
  { url: '/tasks',          keys: [['tasks']] },
  { url: '/teams',          keys: [['projects']] },
  { url: '/v1/graha/deals', keys: [['graha', 'deals']] },
];

/**
 * Sync once. Safe to call on every foreground.
 *
 * Returns what happened rather than throwing — see the module docstring.
 */
export async function syncSession(): Promise<SyncOutcome> {
  const out: SyncOutcome = {
    ran: false, pushed: 0, changed: 0, removed: 0, resynced: false,
  };

  if (!(await apiRefresh())) {
    // The window has closed. Not this module's problem to report — the next
    // request 401s and the normal sign-out path handles it.
    out.error = 'session';
    return out;
  }

  // Push BEFORE pull. See the module docstring.
  const queued = getQueueCount();
  if (queued > 0) {
    try {
      await flushQueue();
      out.pushed = queued - getQueueCount();
    } catch {
      // A change that could not be sent stays queued and is tried again next
      // time. Pulling on top of it is still safe: the queue replays in order
      // and its writes win, because they happen after.
    }
  }

  const since = lastSyncedAt();

  // No cursor — a first run, or after a reset. Nothing to ask `since` about, so
  // just take the server's clock and let the screens load normally.
  if (!since) {
    try {
      const state = await apiClient.get('/v1/sync/state');
      rememberSyncedAt(state.data?.synced_at);
      await queryClient.invalidateQueries();
      out.ran = true;
    } catch (e) {
      out.error = 'network';
    }
    return out;
  }

  let newest = since;
  try {
    // Deletions FIRST. If the device has been away too long the server says so,
    // and there is no point pulling changes into a cache that has to be thrown
    // away regardless.
    const tomb = await apiClient.get('/v1/sync/tombstones', { params: { since } });
    if (tomb.data?.resync_required) {
      resetSyncCursor();
      queryClient.clear();
      rememberSyncedAt(tomb.data?.synced_at);
      out.ran = true;
      out.resynced = true;
      return out;
    }
    const gone: Array<{ entity: string; entity_id: string }> = tomb.data?.data ?? [];
    out.removed = gone.length;
    if (tomb.data?.synced_at && tomb.data.synced_at > newest) newest = tomb.data.synced_at;

    for (const src of DELTA_SOURCES) {
      const res = await apiClient.get(src.url, { params: { since } });
      const rows: unknown[] = res.data?.data ?? [];
      out.changed += rows.length;
      // `synced_at` is advanced to the OLDEST of the responses, not the newest:
      // if one source truncated, its window is not finished, and moving the
      // cursor past it would skip everything the next page would have held.
      const at: string | undefined = res.data?.synced_at;
      if (at && (!res.data?.truncated) && at > newest) newest = at;
      if (rows.length || gone.length) {
        for (const key of src.keys) queryClient.invalidateQueries({ queryKey: key });
      }
    }

    rememberSyncedAt(newest);
    out.ran = true;
  } catch {
    out.error = 'network';
  }
  return out;
}
