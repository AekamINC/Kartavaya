/**
 * cachePurge — the local cache is emptied every third night at 22:00.
 *
 * Owner's decision, 2026-08-09: "app local data and caches gets dumped every
 * [3] days on device local time 10pm."
 *
 * ── THREE THINGS SURVIVE, AND EACH ONE FOR ITS OWN REASON ───────────────────
 *
 * MMKV holds more than the query cache, and a naive "clear everything" would
 * take all of it. Confirmed with the owner before this was written:
 *
 *   · **The unsent mutation queue.** Edits made offline that have not reached
 *     the server. Dumping these destroys the user's work with no trace and no
 *     way to recover it. This is not a cache; it is the only copy.
 *   · **Unsent attendance punches.** Pahchan clock-ins are buffered for 72
 *     hours by design, and a three-day purge lands INSIDE that window. Erasing
 *     them is a payroll problem, not a cache problem.
 *   · **The login token and the "Remember me" choice.** Kept in SecureStore and
 *     MMKV respectively. Taking either would sign the user out every third
 *     night at ten, which is precisely the thing "Remember me" promises not to
 *     do.
 *
 * ── 22:00 LOCAL, AND WHAT HAPPENS IF THE APP IS ASLEEP THEN ─────────────────
 *
 * Nothing runs at 22:00 — a backgrounded React Native app has no timer anyone
 * should trust, and a purge that fires while the app is in the user's hands
 * would blank the screen they are reading. So the RULE is evaluated on
 * foreground: "has a 22:00 boundary passed since the last purge, and is the
 * gap at least three days?" That is the same outcome, decided at a moment when
 * acting on it is safe.
 *
 * `new Date()` throughout, deliberately: the owner asked for DEVICE local time,
 * so the device's own idea of 22:00 is the right one even when its clock is
 * off. That is the opposite of the rule for sync timestamps, where the server's
 * clock is the only one trusted — the difference is that this is a housekeeping
 * schedule and that is a correctness boundary.
 */
import { storage } from '../lib/storage';
import { queryClient } from './queryClient';

/** When the cache was last emptied, as an epoch millisecond stamp. */
const LAST_PURGE_KEY = 'cache_last_purge';

/** Owner's decision, 2026-08-09 — raised from two days to three. */
export const PURGE_EVERY_DAYS = 3;
export const PURGE_HOUR = 22;

/** MMKV keys that are NOT cache and must never be purged. See the docstring. */
export const PROTECTED_KEYS = [
  'mutation_queue',   // unsent edits — the only copy
  'punch_queue',      // unsent attendance — a payroll record
  'auth_token',       // the MMKV shadow of the SecureStore token
  'auth_remember',    // the "Remember me" choice
  'auth_user',        // avoids a blank shell before /auth/me answers
  'cache_last_purge', // this module's own bookkeeping
  'sync_since',       // the delta cursor — losing it forces a full resync
];

/**
 * The most recent 22:00 at or before `now`, in DEVICE local time.
 *
 * Written out rather than done with arithmetic on hours because the arithmetic
 * is wrong twice a year: adding or subtracting 24h across a DST boundary lands
 * on 21:00 or 23:00. Constructing the date from its parts asks the platform for
 * "10pm on that calendar day", which is what was actually meant.
 */
export function lastBoundaryBefore(now: Date): Date {
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), PURGE_HOUR, 0, 0, 0);
  if (at > now) at.setDate(at.getDate() - 1);
  return at;
}

/**
 * Is a purge due?
 *
 * Due when the last 22:00 boundary is later than the last purge AND at least
 * `PURGE_EVERY_DAYS` have passed since that purge. Both conditions, not either:
 * the boundary alone would purge nightly, and the elapsed days alone would
 * purge at whatever time the app happened to be opened.
 */
export function purgeDue(now: Date = new Date(), lastPurge: number | null = readLast()): boolean {
  const boundary = lastBoundaryBefore(now);
  if (lastPurge == null) {
    // A device that has never purged does NOT purge on first launch — that
    // would throw away the cache the user just waited for. The clock starts now.
    return false;
  }
  const daysSince = (now.getTime() - lastPurge) / 86_400_000;
  return boundary.getTime() > lastPurge && daysSince >= PURGE_EVERY_DAYS;
}

function readLast(): number | null {
  const raw = storage.getString(LAST_PURGE_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Start the clock without purging. Called once, after a successful sign-in. */
export function armPurgeClock(now: Date = new Date()): void {
  if (readLast() == null) storage.set(LAST_PURGE_KEY, String(now.getTime()));
}

/**
 * Empty the cache, keeping what must survive.
 *
 * Enumerates MMKV and deletes by exclusion rather than deleting a known list of
 * cache keys: a new cache key added next month would be missed by a list, and
 * the failure mode of missing one is a cache that never clears — invisible.
 * The failure mode of the exclusion approach is deleting something new that
 * should have been protected, which is loud and is what `PROTECTED_KEYS` and
 * its test exist to prevent.
 */
export function purgeNow(now: Date = new Date()): number {
  let removed = 0;
  for (const key of storage.getAllKeys()) {
    if (PROTECTED_KEYS.includes(key)) continue;
    storage.delete(key);
    removed += 1;
  }
  // The in-memory copy as well — deleting MMKV alone leaves the running app
  // showing everything it had, and the purge would appear not to have happened
  // until the next cold start.
  queryClient.clear();
  storage.set(LAST_PURGE_KEY, String(now.getTime()));
  return removed;
}

/** Purge if due. Called on app foreground. Returns whether it ran. */
export function purgeIfDue(now: Date = new Date()): boolean {
  if (!purgeDue(now)) return false;
  purgeNow(now);
  return true;
}
