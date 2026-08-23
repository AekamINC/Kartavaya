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
import { flushPunches, getPunchCount, retryPendingPhotoUploads } from './punchQueue';
import { queryClient } from './queryClient';
import { coveredFloor, pagePlan } from './deltaCursor';

/** The server's `synced_at` from the last successful sync. */
const SINCE_KEY = 'sync_since';

export interface SyncOutcome {
  ran:      boolean;
  pushed:   number;
  /** Punches sent. Own field: `pushed` is mutationQueue's count, and a
   *  dropped punch is an unpaid day — worth its own number, not folded in. */
  pushedPunches: number;
  changed:  number;
  removed:  number;
  /** The device has been away longer than the deletion history is kept. */
  resynced: boolean;
  /** A source still had more to send when the page budget ran out. */
  truncated: boolean;
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

/**
 * The endpoints THIS APP reads that support `?since=`.
 *
 * Nine lists on the server accept `?since=`; all nine are here now. The first
 * four were the ones a screen read when this file was written, and the note that
 * stood in this place said the other five were "deliberately absent … no mobile
 * screen reads them yet". That was true then and is not now: the CRM and Sales
 * surfaces read contacts, companies, activities, follow-ups and orders, and a
 * screen reading a list with no delta entry does a FULL refetch on every open —
 * which is the cost this whole module exists to remove.
 *
 * ── THE KEYS ARE PREFIXES, AND THAT IS THE POINT ─────────────────────────────
 *
 * `invalidateQueries({queryKey:['graha','follow-ups']})` matches
 * `['graha','follow-ups', dealId]` and `['graha','follow-ups','picker', …]`
 * too — react-query compares key prefixes. So one entry here reaches every
 * screen and every entity picker reading that list, and none of them has to be
 * enumerated. Keys were taken from what the screens already invalidate
 * (`screens/graha/DealDetailSheet.tsx`) rather than invented, because a key that
 * does not match is a screen that silently never refreshes.
 *
 * Activities carry `['graha','deal']`: there is no activities LIST screen — they
 * are rendered inside the deal detail, which fetches them with the deal. The
 * prefix covers every `['graha','deal', id]` at once.
 *
 * A note on what a delta buys for a filtered list like invoices, which the
 * screen fetches as `?invoice_type=tax_invoice`: the delta rows are not written
 * into the cache, they only decide WHETHER to invalidate. That is still most of
 * the value — the common case, where nothing changed, now costs one small
 * request instead of a full refetch.
 *
 * ── WHAT ADDING FIVE SOURCES COSTS ───────────────────────────────────────────
 *
 * The shared cursor is `coveredFloor()` — the SMALLEST covered point — so it now
 * moves at the pace of the LAGGIEST of nine lists rather than of four. That is
 * the design, not a regression: a source still mid-window after MAX_PAGES holds
 * the cursor back precisely so that no other source's rows are declared covered
 * when nobody fetched them. The visible effect is that a device returning after
 * a long absence re-asks a slightly wider window on the next open, and catches
 * up over a few launches. The alternative — a cursor per source — drops rows
 * silently and must not be introduced without saying so out loud first.
 *
 * The per-launch cost is nine small requests instead of four. Each is a
 * `WHERE updated_at > $n ORDER BY updated_at ASC LIMIT 200` on an indexed
 * column, and the common answer is zero rows.
 */
const DELTA_SOURCES: Array<{ url: string; keys: string[][] }> = [
  { url: '/tasks',            keys: [['tasks']] },
  { url: '/teams',            keys: [['projects']] },
  { url: '/v1/graha/deals',   keys: [['graha', 'deals'], ['graha', 'deal'], ['graha', 'pipeline-summary']] },
  { url: '/v1/ganit/invoices', keys: [['ganit', 'invoices'], ['ganit', 'stats']] },

  // ── CRM ───────────────────────────────────────────────────────────────────
  // The company — the customer. `routers/graha.py:201`. The delta drops
  // `is_active=TRUE` server-side, so a deactivated company arrives as a row
  // rather than as an absence; invalidating is enough for a screen that
  // refetches, which is all of them.
  { url: '/v1/graha/clients',    keys: [['graha', 'clients']] },
  // The people. `routers/graha.py:369`. Same `is_active` relaxation.
  { url: '/v1/graha/contacts',   keys: [['graha', 'contacts']] },
  // The log. `routers/graha.py:1308`. `updated_at` is maintained by
  // `trg_touch_activities` (migration 138), so completing one moves the stamp.
  // The `created_by` visibility filter is NOT relaxed for the delta — it is a
  // permission boundary — so this device sees only what it may see.
  { url: '/v1/graha/activities', keys: [['graha', 'deal'], ['graha', 'today']] },
  // The next thing. `routers/graha.py:1403`. The delta does NOT apply the
  // default `is_completed=FALSE`: a follow-up ticked off on the web is exactly
  // the change the phone needs, and hiding it leaves the item outstanding here
  // for ever. Hard deletes reach us separately via `/v1/sync/tombstones`.
  { url: '/v1/graha/follow-ups', keys: [['graha', 'follow-ups'], ['graha', 'today']] },

  // ── Sales ─────────────────────────────────────────────────────────────────
  // `routers/vikray.py:181`. Cancelling sets `is_active=FALSE` and the delta
  // does not filter it out, so a cancelled order is a change rather than a
  // disappearance — without this entry it stayed live on the phone.
  // Both spellings: `['vikray','orders']` is the list, `['vikray','order']` the
  // prefix of every `['vikray','order', id]` detail query
  // (`screens/vikray/OrderDetailSheet.tsx`). A prefix does not match its own
  // plural, so one key would leave an open order sheet stale.
  { url: '/v1/vikray/orders',    keys: [['vikray', 'orders'], ['vikray', 'order']] },
];

/**
 * How many times one source may be re-asked within a single sync.
 *
 * A delta that fills its row cap is not a finished delta. Without paging, a
 * device that has been away a fortnight advances no cursor at all and stays
 * permanently one truncated window behind, opening the app again and again and
 * never catching up. Bounded rather than `while (truncated)` because the loop
 * is driven by a server response: a bug at either end that always reported
 * truncation would otherwise spin forever on a user's data connection.
 */
const MAX_PAGES = 10;

/**
 * Sync once. Safe to call on every foreground.
 *
 * Returns what happened rather than throwing — see the module docstring.
 */
export async function syncSession(): Promise<SyncOutcome> {
  const out: SyncOutcome = {
    ran: false, pushed: 0, pushedPunches: 0, changed: 0, removed: 0, resynced: false,
    truncated: false,
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

  // Punches, on the owner's own "every open, in background" rule — inbox 9:
  // this call never existed before, so opening the app did nothing for a
  // punch that was stuck, no matter how many times someone tried. Its own
  // queue, its own retention, its own failure handling (never thrown) —
  // see punchQueue.ts's module header for why this is not mutationQueue.
  const queuedPunches = getPunchCount();
  if (queuedPunches > 0) {
    try {
      await retryPendingPhotoUploads();
      const result = await flushPunches();
      out.pushedPunches = result.sent;
    } catch {
      // Never thrown by flushPunches itself (see its own header), but a
      // punch that failed here stays queued and is tried on the next open,
      // the next reconnect, or the next capture — never lost.
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

  // How far each source is covered. The cursor moves to the SMALLEST of them —
  // see the loop below.
  const covered: string[] = [];
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
    // Deletions are a source like any other and join the coverage list. The
    // endpoint already reports a truncated page by returning the LAST row's
    // `deleted_at` as its `synced_at`, so taking the value as given is right in
    // both cases — and holds the whole cursor back when the page was full.
    if (typeof tomb.data?.synced_at === 'string') covered.push(tomb.data.synced_at);
    if (tomb.data?.truncated) out.truncated = true;

    for (const src of DELTA_SOURCES) {
      // Each source is paged from its OWN cursor, which starts at the shared
      // `since` and walks forward through a truncated window.
      let cursor = since;
      let touched = false;
      let finished = false;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const res = await apiClient.get(src.url, { params: { since: cursor } });
        const rows: Array<Record<string, unknown>> = res.data?.data ?? [];
        out.changed += rows.length;
        if (rows.length) touched = true;

        const plan = pagePlan(res.data ?? {}, cursor);
        const moved = plan.cursor !== cursor;
        cursor = plan.cursor;
        finished = plan.finished;
        // Finished, or stuck on a page that cannot be resumed. Either way there
        // is nothing to gain from asking again inside this sync.
        if (finished || !moved) break;
      }

      // How far THIS source is covered. The shared cursor becomes the smallest
      // of these — a source still mid-window after MAX_PAGES holds the whole
      // cursor back, because advancing past it would skip everything the next
      // page would have held.
      if (!finished) out.truncated = true;
      covered.push(cursor);

      if (touched || gone.length) {
        for (const key of src.keys) queryClient.invalidateQueries({ queryKey: key });
      }
    }

    // The SMALLEST covered point, not the largest. One source left mid-window
    // holds the cursor back for all of them — the alternative is a cursor that
    // moves past rows nobody fetched, and those rows are then invisible for
    // ever, with no error anywhere to say so.
    rememberSyncedAt(coveredFloor(covered));
    out.ran = true;
  } catch {
    out.error = 'network';
  }
  return out;
}
