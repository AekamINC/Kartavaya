/**
 * cachePurge — the three-day 22:00 rule, and the three things it must not take.
 *
 * Owner's decision, 2026-08-09. The schedule is easy to get subtly wrong in
 * ways nobody notices for weeks (purging nightly, purging at whatever time the
 * app happened to open, drifting an hour at the DST change), and the exclusion
 * list is the difference between a cache purge and destroying somebody's
 * unsent attendance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROTECTED_KEYS, PURGE_EVERY_DAYS, PURGE_HOUR, lastBoundaryBefore, purgeDue,
} from '../cachePurge.ts';

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0);
const DAY = 86_400_000;

test('the owner asked for three days, not two', () => {
  assert.equal(PURGE_EVERY_DAYS, 3);
  assert.equal(PURGE_HOUR, 22);
});

test('the boundary is tonight 22:00 once it has passed', () => {
  assert.deepEqual(lastBoundaryBefore(at(2026, 8, 9, 23, 30)), at(2026, 8, 9, 22));
});

test('before 22:00 the boundary is YESTERDAY 22:00', () => {
  // Getting this backwards purges a day early, every time.
  assert.deepEqual(lastBoundaryBefore(at(2026, 8, 9, 9, 0)), at(2026, 8, 8, 22));
});

test('the boundary is built from calendar parts, so DST cannot shift it', () => {
  // Subtracting 24h across a DST change lands on 21:00 or 23:00. Asking the
  // platform for "10pm on that day" is what was actually meant.
  for (const d of [1, 2, 3, 4]) {
    const b = lastBoundaryBefore(at(2026, 3, d, 12, 0));
    assert.equal(b.getHours(), 22, `hour drifted on 2026-03-0${d}`);
  }
});

test('a device that has never purged does not purge on first launch', () => {
  // That would throw away the cache the user just waited to download.
  assert.equal(purgeDue(at(2026, 8, 9, 23, 0), null), false);
});

test('not due until BOTH three days have passed and a 22:00 has gone by', () => {
  const last = at(2026, 8, 6, 22).getTime();
  // Two days later, after 22:00 — the boundary passed but three days have not.
  assert.equal(purgeDue(at(2026, 8, 8, 23, 0), last), false);
  // Lunchtime on the third day. The boundary (8 Aug 22:00) IS after the purge,
  // but only 2.6 days have elapsed — the elapsed-days test is what holds it.
  // This case is why the rule is BOTH conditions and not either: the boundary
  // alone would have purged here, a day and a half early.
  assert.equal(purgeDue(at(2026, 8, 9, 12, 0), last), false);
  // And it becomes due at 22:00 that night, which is exactly three days on.
  assert.equal(purgeDue(at(2026, 8, 9, 22, 1), last), true);
});

test('due three days later once 22:00 has passed', () => {
  const last = at(2026, 8, 6, 22).getTime();
  assert.equal(purgeDue(at(2026, 8, 9, 22, 1), last), true);
});

test('it does not purge twice in one night', () => {
  const justPurged = at(2026, 8, 9, 22, 0).getTime();
  assert.equal(purgeDue(at(2026, 8, 9, 22, 30), justPurged), false);
  assert.equal(purgeDue(at(2026, 8, 10, 8, 0), justPurged), false);
});

test('the unsent mutation queue is protected', () => {
  // Dumping these destroys the user's work with no trace and no recovery.
  assert.ok(PROTECTED_KEYS.includes('mutation_queue'));
});

test('unsent attendance punches are protected', () => {
  // Punches buffer for 72 hours by design and a three-day purge lands INSIDE
  // that window. This one is a payroll problem, not a cache problem.
  assert.ok(PROTECTED_KEYS.includes('punch_queue'));
});

test('the token and the remember-me choice are protected', () => {
  // Taking either signs the user out every third night at ten — precisely what
  // "Remember me" promises not to do.
  assert.ok(PROTECTED_KEYS.includes('auth_token'));
  assert.ok(PROTECTED_KEYS.includes('auth_remember'));
});

test('the delta cursor is protected', () => {
  // Losing it is not data loss, but it forces a full resync on the next open —
  // the exact download the delta exists to avoid.
  assert.ok(PROTECTED_KEYS.includes('sync_since'));
});

test('the purge bookkeeping survives its own purge', () => {
  // Otherwise `lastPurge` reads null afterwards, the "never purged" branch
  // takes over, and the schedule silently stops for ever.
  assert.ok(PROTECTED_KEYS.includes('cache_last_purge'));
});

test('a fresh purge is due again exactly three days on', () => {
  const first = at(2026, 8, 9, 22, 0).getTime();
  assert.equal(purgeDue(new Date(first + 3 * DAY + 60_000), first), true);
  assert.equal(purgeDue(new Date(first + 2 * DAY + 60_000), first), false);
});
