/**
 * mentionText.ts — the caret arithmetic behind the `@` picker.
 *
 * Pure, and in a `.ts` rather than inside `MentionInput.tsx`, because Node's
 * type-stripping does not transform JSX: a `.tsx` cannot be imported by
 * `npm test` at all, so anything that lives in one is reachable by reading the
 * source or not at all. The two functions here are exactly the part worth
 * proving, so they live where a test can call them.
 *
 * ── The rule these two share with the parser, and why it is not negotiable ────
 *
 * The inserter and the parser must agree on what a mention IS, or the product
 * grows a message that looks like it mentions somebody and notifies nobody.
 * `richText.ts`'s `splitMentions` opens a mention at `(^|[^\w@])@` and the
 * server's resolver reads the same literal text out of `content`, so:
 *
 *  · `mentionTokenAt` opens ONLY at the start of the string or after a
 *    non-word, non-`@` character. That is what keeps `user@example.com` from
 *    opening a member list on its domain — the web's `MentionTextarea` does
 *    open one there, and that disagreement is what
 *    `frontend/src/__tests__/renderMentions.test.jsx` was written about.
 *  · `insertMention` writes `@` + the member's FULL display name + one space.
 *    Never an id, never a `<@u_ab12>` sigil, never the first token of the name.
 *    Three independent readers parse that exact form: `splitMentions` here, the
 *    server-side resolver that writes `samvada_mentions` and the push, and
 *    `GET /search`, which runs over `content` — a sigil would make a message
 *    that mentions you unfindable by your own name.
 */

/** The `@…` run the caret is sitting inside. */
export interface MentionToken {
  /** Index of the `@`. */
  start: number;
  /** Index one past the last typed character — i.e. the caret. */
  end: number;
  /** What was typed after `@`, possibly `''`. */
  query: string;
}

/**
 * Past this many characters the run after an `@` is prose, not a name.
 *
 * Same number the web composer uses. It matters more here than there: every
 * distinct query mints a react-query cache entry, so an unbounded one would let
 * a paragraph beginning with `@` spawn one per keystroke.
 */
const MAX_QUERY = 30;

const clamp = (n: number, hi: number): number =>
  Math.max(0, Math.min(hi, Number.isFinite(n) ? Math.trunc(n) : 0));

/**
 * The `@`-token the caret is sitting inside, or `null`.
 *
 * Closes at whitespace, which is also why an already-inserted `@Keval Shah`
 * does not re-open the picker when the caret returns to the end of it: the run
 * back to the `@` contains a space, so there is no token. A range selection is
 * not typing, so `selEnd !== selStart` is `null` outright.
 */
export function mentionTokenAt(
  value: string,
  selStart: number,
  selEnd: number,
): MentionToken | null {
  if (typeof value !== 'string' || !value) return null;
  if (selStart !== selEnd) return null;

  const caret = clamp(selStart, value.length);
  const slice = value.slice(0, caret);
  const start = slice.lastIndexOf('@');
  if (start === -1) return null;

  // `[^\w@]` and not `\s`: `splitMentions` accepts a mention after a bracket or
  // a quote too, and an inserter that offered fewer places than the parser
  // renders is the same disagreement in the other direction.
  const before = start === 0 ? '' : slice[start - 1];
  if (before && /[\w@]/.test(before)) return null;

  const query = slice.slice(start + 1);
  if (/\s/.test(query)) return null;
  if (query.length > MAX_QUERY) return null;

  return { start, end: caret, query };
}

/**
 * Replace the token with `@Full Name ` and report where the caret goes.
 *
 * The display name goes in VERBATIM, spaces included — `splitMentions` sorts
 * the names it knows longest-first for exactly this case, so `@Keval Shah`
 * cannot be shadowed by a colleague called `@Keval`.
 *
 * A blank name is refused rather than written: `@ ` mentions nobody, and the
 * directory really can return a null `full_name` (it is nullable in
 * `public.users`). The value comes back unchanged and the caret stays put, so a
 * caller that ignores the distinction still does no damage.
 */
export function insertMention(
  value: string,
  tok: MentionToken,
  name: string,
): { value: string; caret: number } {
  const v = typeof value === 'string' ? value : '';
  const start = clamp(tok?.start ?? 0, v.length);
  const end = Math.max(start, clamp(tok?.end ?? start, v.length));

  if (typeof name !== 'string' || !name.trim()) return { value: v, caret: end };

  const token = `@${name} `;
  return { value: v.slice(0, start) + token + v.slice(end), caret: start + token.length };
}
