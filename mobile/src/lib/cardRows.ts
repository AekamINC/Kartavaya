/**
 * Flowing a VIRTUALISED list into columns — 31-tablet.md §3.
 *
 * "A single column of cards across 700dp is a phone layout that happens to be
 * wide — the most common way a tablet build looks unfinished."
 *
 * `CardList` solves that for lists small enough to render whole. This solves it
 * for the three that are not: Boards, Mentions and the client portal are
 * `FlatList`s, and flowing their children would mean rendering every item to
 * distribute it.
 *
 * ── WHY NOT `numColumns` ────────────────────────────────────────────────────
 *
 * It is the obvious answer and it is wrong here. Changing `numColumns` on a
 * mounted FlatList throws unless `key` changes too, so a rotation between one
 * and two columns either crashes or remounts the list and loses the scroll
 * position. §6: "It is a resize, not a remount."
 *
 * ── WHAT THIS DOES INSTEAD ──────────────────────────────────────────────────
 *
 * Keeps ONE column, of rows, and puts N cards in each row. The list stays
 * virtualised — it renders the rows near the viewport and no more — `numColumns`
 * is never touched, and a rotation changes the CONTENTS of the rows rather than
 * the identity of the list.
 *
 * The cost, stated plainly: virtualisation now works in units of N cards rather
 * than one, so at three columns the list renders up to two cards more than it
 * strictly needs at each end. That is the trade, and it is a much smaller one
 * than either rendering everything or remounting on rotation.
 *
 * Pure on purpose — no React, no React Native — so `node --test` can import it
 * and test the transform for real rather than reading it as text.
 */

/**
 * Split a list into rows of `columns`.
 *
 * The last row is SHORT rather than padded. Padding with placeholders means
 * every renderer has to know about them, and the one that forgets draws an empty
 * card; layout handles the gap instead — see `CardRow`.
 */
export function chunkRows<T>(items: readonly T[], columns: number): T[][] {
  // A 0 would loop forever and a NaN would produce one enormous row. Neither is
  // reachable from `gridColumns`, but a caller doing its own arithmetic on a
  // pane width can produce both, and a phone layout is a better failure than a
  // hang.
  const n = Number.isFinite(columns) && columns >= 1 ? Math.floor(columns) : 1;
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n) as T[]);
  return out;
}

/**
 * A stable key for a row — its FIRST item's key.
 *
 * Not the index. An index key means inserting one item at the top re-keys every
 * row beneath it, so FlatList discards and rebuilds the whole viewport. On a
 * list that polls, that is every poll.
 */
export function rowKey<T>(row: readonly T[], keyOf: (item: T) => string): string {
  return row.length > 0 ? keyOf(row[0]) : '';
}
