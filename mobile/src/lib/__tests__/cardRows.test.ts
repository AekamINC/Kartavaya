/**
 * Flowing a VIRTUALISED list into columns — 31-tablet.md §3.
 *
 * ── WHY THIS EXISTS RATHER THAN `numColumns` ────────────────────────────────
 *
 * `CardList` flows a list of children, and six module surfaces use it. It cannot
 * help Boards, Mentions or the client portal, because those are `FlatList`s and
 * flowing them means giving up virtualisation — you have to have rendered every
 * item to distribute it.
 *
 * `FlatList` has `numColumns`, which is the obvious answer and is wrong here:
 * changing it on a mounted list throws unless `key` changes too, so a rotation
 * between one and two columns either crashes or remounts the list and loses the
 * scroll position. §6 is explicit — "It is a resize, not a remount."
 *
 * The third option, and the one taken: keep ONE column of rows, and make each
 * row hold N cards. The list stays virtualised, `numColumns` is never touched,
 * and a rotation changes the contents of the rows rather than the identity of
 * the list. `chunkRows` is that transform, and it is pure so it can be tested
 * for real rather than read as text.
 *
 * ── THE TWO THINGS THAT GO WRONG ────────────────────────────────────────────
 *
 * A short last row, and keys. Both are silent: a lone card stretched to full
 * width looks like a layout bug, and a row keyed by index re-renders every row
 * below any insertion. Both are covered below.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkRows, rowKey } from '../cardRows.ts';

const seq = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }));

// ── The transform ────────────────────────────────────────────────────────────

test('one column is the identity, one item per row', () => {
  // The phone must be untouched. Not "one column looks the same" — the SAME
  // number of rows, so a screen that reads `rows.length` cannot drift.
  const rows = chunkRows(seq(5), 1);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(r => r.length), [1, 1, 1, 1, 1]);
});

test('two and three columns pack in order', () => {
  assert.deepEqual(
    chunkRows([1, 2, 3, 4, 5], 2),
    [[1, 2], [3, 4], [5]],
  );
  assert.deepEqual(
    chunkRows([1, 2, 3, 4, 5, 6, 7], 3),
    [[1, 2, 3], [4, 5, 6], [7]],
  );
});

test('reading order is preserved across the whole list', () => {
  // A grid that fills column-first reads down-then-across, which is wrong for a
  // list of tasks or channels sorted by anything at all.
  const items = seq(11);
  for (const cols of [1, 2, 3]) {
    assert.deepEqual(chunkRows(items, cols).flat(), items,
      `${cols} columns reordered the list`);
  }
});

test('the last row is SHORT, not padded with nulls', () => {
  // The alternative is padding to a full row with placeholders, and it is worse:
  // a `null` in the data is something every renderer then has to know about, and
  // the one that forgets renders an empty card. Layout handles the gap instead.
  const rows = chunkRows(seq(5), 3);
  assert.equal(rows.at(-1)!.length, 2);
  assert.ok(rows.flat().every(Boolean), 'a placeholder leaked into the data');
});

test('an empty list produces no rows at all', () => {
  // Not `[[]]`. One empty row renders as a blank band above the empty state,
  // and FlatList would not call `ListEmptyComponent` because the data is not
  // empty.
  assert.deepEqual(chunkRows([], 2), []);
  assert.deepEqual(chunkRows([], 1), []);
});

test('a nonsense column count falls back to one', () => {
  // `gridColumns` cannot return these, but a caller doing its own arithmetic on
  // a pane width can — and a 0 would loop forever, which is worse than a phone
  // layout.
  for (const cols of [0, -1, NaN]) {
    assert.deepEqual(chunkRows([1, 2, 3], cols), [[1], [2], [3]],
      `${cols} columns did not fall back`);
  }
});

// ── Keys ─────────────────────────────────────────────────────────────────────

test('a row is keyed by its FIRST item, not by its index', () => {
  // An index key means inserting one item at the top re-keys every row beneath
  // it, so FlatList discards and rebuilds the whole viewport — on a list that
  // polls, that is every poll.
  const rows = chunkRows(seq(4), 2);
  assert.equal(rowKey(rows[0], i => i.id), 'x0');
  assert.equal(rowKey(rows[1], i => i.id), 'x2');
});

test('row keys stay stable when an item is appended', () => {
  const key = (i: { id: string }) => i.id;
  const before = chunkRows(seq(4), 2).map(r => rowKey(r, key));
  const after  = chunkRows(seq(5), 2).map(r => rowKey(r, key));
  assert.deepEqual(after.slice(0, before.length), before,
    'appending re-keyed existing rows');
});

test('an empty row key is a defined string, not a crash', () => {
  // Defensive: `chunkRows` never emits one, but `rowKey` is exported and a
  // caller chunking its own data should not get a TypeError out of a key
  // function during a render.
  assert.equal(typeof rowKey([], (i: { id: string }) => i.id), 'string');
});
