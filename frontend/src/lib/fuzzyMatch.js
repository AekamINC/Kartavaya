/**
 * fuzzyMatch — ranking for the command palette. `20-search-palette.md` §1.
 *
 * Score by WHERE the match lands and HOW early. Never rank a subsequence hit
 * above a substring hit.
 *
 * The bug this replaced ran ONE subsequence test over a 40-character
 * concatenation of `label + hi + keywords`, so almost any three-letter query
 * matched almost everything: type "ate" and most of the 30 items scored 1, then
 * sorted in source order because the comparator had nothing to break ties with.
 * The list barely changed as you typed, which reads as "search is broken".
 *
 * It lives in `lib/` rather than inside `CommandPalette.jsx` because it is a
 * pure function with its own test suite and two callers — the command list and
 * the client-side re-rank of anything the palette holds locally. A scoring
 * function exported from a React component is a component that cannot be
 * imported without pulling react-router in with it.
 *
 * The numbers are deliberately loose. `__tests__/fuzzyMatch.test.js` locks the
 * ORDERING guarantees, not the absolute values, so the curve can be retuned
 * without rewriting the suite.
 */

/**
 * @param {string} query        raw user input
 * @param {{label?:string, hi?:string, keywords?:string}} item
 * @returns {number} 0 = no match. Higher is better.
 */
export function fuzzyMatch(query, item) {
  const q = query.trim().toLowerCase();
  if (!q) return 100;

  const label = (item.label || '').toLowerCase();
  const hi = (item.hi || '').toLowerCase();
  const keywords = (item.keywords || '').toLowerCase();

  if (label.startsWith(q)) return 90 - Math.min(label.length - q.length, 20);
  if (hi.startsWith(q)) return 88;

  const at = label.indexOf(q);
  if (at > -1) {
    // Word-boundary hits beat mid-word ones: "inv" should find "New Invoice"
    // before it finds anything merely containing "inv".
    const boundary = at === 0 || label[at - 1] === ' ';
    return (boundary ? 75 : 60) - Math.min(at, 15);
  }
  if (hi.includes(q)) return 55;
  if (keywords.includes(q)) return 40;

  // Subsequence, last resort, and only over the label — running it across the
  // keyword blob is what made everything match.
  let qi = 0;
  for (let i = 0; i < label.length && qi < q.length; i++) {
    if (label[i] === q[qi]) qi++;
  }
  return qi === q.length ? 10 : 0;
}

export default fuzzyMatch;
