/**
 * sessionSync — the cursor arithmetic, which is where a delta fails silently.
 *
 * Neither failure mode here produces an error. A cursor that advances too far
 * skips rows that nothing will ever ask for again — the phone simply shows a
 * figure that stopped being true. A cursor that never advances leaves the
 * device permanently one page behind, opening the app again and again and
 * catching up on nothing. Both look like a working sync from the outside.
 *
 * Only the PURE parts are exercised: the rest of the module needs a network
 * client and MMKV. That is why `pagePlan` was pulled out of the loop.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { coveredFloor, lastStamp, pagePlan } from '../deltaCursor.ts';

const T1 = '2026-08-01T10:00:00+00:00';
const T2 = '2026-08-05T10:00:00+00:00';
const T3 = '2026-08-09T10:00:00+00:00';

test('a complete window finishes at the server clock, never the device one', () => {
  const p = pagePlan({ data: [], synced_at: T3, truncated: false }, T1);
  assert.equal(p.finished, true);
  assert.equal(p.cursor, T3);
});

test('an empty complete window still advances the cursor', () => {
  // The usual case — nothing changed. If this did not advance, every sync
  // would re-ask about the same widening window for ever.
  assert.equal(pagePlan({ data: [], synced_at: T3, truncated: false }, T1).cursor, T3);
});

test('a truncated page resumes from the LAST row, not from synced_at', () => {
  // Taking `synced_at` on a truncated page is THE bug this guards: it declares
  // the whole window covered while the rows past the cap were never sent.
  const p = pagePlan({
    data: [{ updated_at: T1 }, { updated_at: T2 }],
    synced_at: T3,
    truncated: true,
  }, T1);
  assert.equal(p.finished, false);
  assert.equal(p.cursor, T2);
});

test('a truncated page never moves the cursor backwards', () => {
  const p = pagePlan({ data: [{ updated_at: T1 }], synced_at: T3, truncated: true }, T2);
  assert.equal(p.cursor, T2);
  assert.equal(p.finished, false);
});

test('a full page all sharing one timestamp does not loop', () => {
  // 200 rows written in the same transaction all carry the same `updated_at`.
  // Resuming from it would ask for the identical page for ever.
  const rows = Array.from({ length: 200 }, () => ({ updated_at: T2 }));
  const p = pagePlan({ data: rows, synced_at: T3, truncated: true }, T2);
  assert.equal(p.cursor, T2, 'the cursor must stay put rather than spin');
  assert.equal(p.finished, false);
});

test('a truncated page whose rows carry no updated_at stays put', () => {
  // The endpoint forgot the column. Guessing forward here would skip the whole
  // remainder of the window silently — staying put costs a retry and loses
  // nothing.
  const p = pagePlan({ data: [{ id: 'x' }], synced_at: T3, truncated: true }, T1);
  assert.equal(p.cursor, T1);
  assert.equal(p.finished, false);
});

test('a response missing `truncated` altogether is treated as complete', () => {
  // Every endpoint that can truncate reports it. An older one that does not
  // send the field is not truncating, and must not be paged for ever.
  assert.equal(pagePlan({ data: [], synced_at: T3 }, T1).finished, true);
});

test('lastStamp ignores a non-string stamp', () => {
  assert.equal(lastStamp([{ updated_at: 12345 }]), null);
  assert.equal(lastStamp([]), null);
  assert.equal(lastStamp([{ updated_at: T1 }, { updated_at: T2 }]), T2);
});

test('the shared cursor is the SMALLEST covered point, not the largest', () => {
  // The rule the loop applies. One source left mid-window holds all of them
  // back — taking the max would move the cursor past rows nobody fetched, and
  // those rows are then invisible for ever.
  assert.equal(coveredFloor([T3, T1, T2]), T1);
  assert.equal(coveredFloor([]), null);
});
