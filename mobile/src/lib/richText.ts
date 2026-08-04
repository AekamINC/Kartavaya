/**
 * richText.ts — a colleague's message body, turned into a token tree.
 *
 * ── This is a PORT, not a rewrite ─────────────────────────────────────────────
 *
 * Every function below is `frontend/src/pages/sanvaad/messageUtils.js` lines
 * 237–525, typed and otherwise unchanged. The web file is plain JS with no DOM
 * dependency whatsoever — `parseRich` emits data and `Message.jsx` turns it into
 * elements — so the port is mechanical, and the comments came across with the
 * code because they are the reasons.
 *
 * A fresh parser would have missed four things this one already gets right, and
 * each has a test beside it in `__tests__/richText.test.ts`:
 *
 *  · Every marker regex is a negated character class under a single quantifier,
 *    never a lazy dot with a lookaround. A 4 000-character message is a linear
 *    parse; the alternative is a message that freezes the JS thread of everyone
 *    who scrolls past it.
 *  · `guardOk` refuses a marker that opens mid-word, which is what stops
 *    `2 * 3 * 4` rendering bold and `snake_case_name` rendering italic — the two
 *    false positives that make people stop trusting a formatter and start
 *    escaping everything.
 *  · `CLOSE_OK` carries `।` and `॥` beside the ASCII stops, so `*ज़रूरी*।` bolds.
 *    A closing set that only knows `.` breaks formatting for exactly the users
 *    the bilingual work is for.
 *  · Code is the FIRST inline rule, so `` `@Keval` `` is not a mention and
 *    `` `*x*` `` is not bold.
 *
 * ── What changes going from the browser to React Native, and what does not ────
 *
 * The injection class disappears entirely. There is no `innerHTML` here and no
 * `dangerouslySetInnerHTML`, so the web parser's central constraint — emit
 * tokens, never markup, because a string typed by one colleague renders inside
 * every other colleague's browser — is satisfied by the platform. That is NOT
 * permission to simplify: the four properties above are about correctness and
 * responsiveness, not injection, and they survive the platform change unchanged.
 *
 * One thing does not come free. `safeHref` stays an allowlist, because
 * `Linking.openURL('tel:…')` places a call and `Linking.openURL('itms-apps://…')`
 * opens the App Store. A blocklist loses to `java<TAB>script:` and to a
 * scheme-relative `//evil.tld`.
 *
 * ── Sharing ───────────────────────────────────────────────────────────────────
 *
 * `frontend/` and `mobile/` are separate packages with no shared module, so this
 * is a typed COPY and the two are shared in rules rather than in code. When one
 * changes the other must. `__tests__/richText.test.ts` pins the behaviours that
 * matter so a divergence fails a build rather than a reader.
 *
 * The supported subset is Slack's, not CommonMark's: `*bold*` with ONE asterisk,
 * `_italic_`, `~strike~`, `` `code` ``, ``` fences, `> quote`, `- item`,
 * `1. item`, bare URLs. Headings, tables, images, `**bold**` and `[text](url)`
 * are deliberately absent — anything not in that list renders as the literal
 * characters the author typed, which is the only rule a reader can predict
 * without being told.
 */

/* ── The token vocabulary ──────────────────────────────────────────────────── */

/** One inline run. A bare `string` is ordinary text. */
export type Leaf =
  | string
  | { k: 'code'; text: string }
  | { k: 'b' | 'i' | 's'; kids: Leaf[] }
  | { k: 'a'; href: string; text: string }
  | { k: 'mn'; mention: string; name: string; me: boolean };

/** One block. Only these four introduce a box; `p` deliberately does not. */
export type Block =
  | { k: 'p';     kids: Leaf[] }
  | { k: 'pre';   lang: string | null; text: string }
  | { k: 'quote'; kids: Leaf[] }
  | { k: 'ul';    items: Leaf[][] }
  | { k: 'ol';    start: number; items: Leaf[][] };

export interface RichOpts {
  /** Display names known on this surface — the senders in the loaded page. */
  names?: string[];
  /** The reader's own display name; their mention renders in the "me" tone. */
  meName?: string | null;
}

/** What `splitMentions` hands back: strings and mention markers, in order. */
export type MentionPart = string | { mention: string; name: string; me: boolean };

/* ── Mentions ──────────────────────────────────────────────────────────────── */

/** Longest name first, so a member called "Keval" cannot shadow "Keval Shah". */
const escapeRe = (s: unknown): string => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Split `body` into strings and `{mention, name, me}` markers.
 *
 * `names` are the display names known on this surface — the senders in the
 * loaded page, which needs no extra request. A bare `@handle` still matches so
 * that a mention of somebody who has not posted yet is not silently plain, but
 * only when it does not follow a word character, which is what keeps
 * `user@example.com` from lighting up its domain.
 *
 * Returns parts rather than elements so the parsing stays testable without a
 * render tree, and so the caller owns the styling.
 */
export function splitMentions(
  body: string | null | undefined,
  names: string[] = [],
  meName: string | null = null,
): MentionPart[] {
  if (!body) return [String(body ?? '')];
  const known = [...new Set(names.filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe);
  const alt = known.length ? `(?:${known.join('|')})|[\\w.-]+` : '[\\w.-]+';
  const re = new RegExp(`(^|[^\\w@])(@(?:${alt}))`, 'gi');

  const out: MentionPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const start = m.index + m[1].length;
    if (start > last) out.push(body.slice(last, start));
    const name = m[2].slice(1);
    out.push({
      mention: m[2],
      name,
      me: !!meName && name.toLowerCase() === String(meName).toLowerCase(),
    });
    last = start + m[2].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

/* ── Blocks ────────────────────────────────────────────────────────────────── */

/** A fence opens or closes a block; the language tag is accepted and dropped. */
const FENCE_RE = /^\s{0,3}```([A-Za-z0-9_+#.-]*)\s*$/;
/** `>` or `> `, up to three leading spaces. Consecutive lines merge (see below). */
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
/** The space after the marker is required, which is what keeps `*bold*` on its
 *  own line from being read as a one-item bullet list. */
const UL_RE = /^\s{0,3}[-*]\s+(.+)$/;
/** `1.` only — `1)` is not in the supported table, so it stays literal text. */
const OL_RE = /^\s{0,3}(\d{1,9})\.\s+(.+)$/;

const isBlockStart = (l: string): boolean =>
  FENCE_RE.test(l) || QUOTE_RE.test(l) || OL_RE.test(l) || UL_RE.test(l);

/* ── Inline ────────────────────────────────────────────────────────────────── */

/**
 * A marker only opens where a word cannot continue into it, and only closes
 * where one does not continue out of it. Without this `2 * 3 * 4` is bold and
 * `snake_case_name` is italic.
 *
 * `।` and `॥` are in the closing set beside the ASCII stops for the same reason
 * every label in this product has a Devanagari half: `*ज़रूरी*।` is how a Hindi
 * sentence ends, and a closing set that only knows `.` would render the whole
 * thing as literal asterisks for exactly the users the bilingual work is for.
 */
const OPEN_OK = /[\s([{<"']/;
const CLOSE_OK = /[\s)\]}>.,!?;:"'।॥]/;

function guardOk(text: string, start: number, end: number, inner: string): boolean {
  if (!inner || /^\s|\s$/.test(inner) || inner.includes('\n')) return false;
  const before = start > 0 ? text[start - 1] : '';
  if (before && !OPEN_OK.test(before)) return false;
  const after = end < text.length ? text[end] : '';
  if (after && !CLOSE_OK.test(after)) return false;
  return true;
}

interface InlineRule {
  k: 'code' | 'b' | 'i' | 's';
  mark: string;
  re: RegExp;
  verbatim?: boolean;
}

/**
 * Ordered, and the order is the whole point of doing code first: text captured
 * inside a code span is emitted verbatim as a single leaf and NO later rule
 * touches it, so `` `@Keval` `` is not a mention and `` `*x*` `` is not bold.
 * Each rule scans the string once; whatever it does not consume falls through
 * to the next one, so a rule can nest the rules below it (`*bold _and_ both*`)
 * and can never nest itself.
 */
const INLINE: InlineRule[] = [
  { k: 'code', mark: '`', re: /`([^`\n]+)`/g, verbatim: true },
  { k: 'b', mark: '*', re: /\*([^*\n]+)\*/g },
  { k: 'i', mark: '_', re: /_([^_\n]+)_/g },
  { k: 's', mark: '~', re: /~([^~\n]+)~/g },
];

/**
 * Bare URLs. Terminated by whitespace or a bracket/quote, then trailing
 * sentence punctuation is handed back to the sentence — "see https://x.com."
 * must not link a full stop, and "(https://x.com)" must not link the paren.
 */
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const URL_TRAIL_RE = /[.,;:!?)\]}'"]+$/;

/**
 * The allowlist. Control characters are stripped first, because a literal TAB
 * inside `java<TAB>script:` is how a scheme gets past a naive prefix test; after
 * that the string must literally begin `http://` or `https://` or it is not a
 * link at all and the caller renders it as the text the author typed.
 *
 * On this platform the consumer is `Linking.openURL`, which will place a phone
 * call for `tel:` and open the store for `itms-apps:`. The allowlist is the only
 * thing standing between a pasted string and either of those.
 */
export function safeHref(raw: unknown): string | null {
  const u = String(raw == null ? '' : raw).trim().replace(/[\u0000-\u001f\u007f]/g, '');
  return /^https?:\/\//i.test(u) ? u : null;
}

/** URLs, then mentions — the last two passes, both of which produce leaves. */
function linksAndMentions(text: string, opts: Required<RichOpts>): Leaf[] {
  if (!text) return [];
  const out: Leaf[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    const raw = m[0].replace(URL_TRAIL_RE, '');
    // The strip can eat the entire match only if the match was punctuation,
    // which `https?://` makes impossible — but a URL that is nothing but the
    // scheme still deserves to stay text rather than become an empty link.
    const href = raw.length > 8 ? safeHref(raw) : null;
    if (!href) { URL_RE.lastIndex = m.index + m[0].length; continue; }
    if (m.index > last) out.push(...mentionLeaves(text.slice(last, m.index), opts.names, opts.meName));
    out.push({ k: 'a', href, text: raw });
    last = m.index + raw.length;
    URL_RE.lastIndex = last;
  }
  if (last < text.length) out.push(...mentionLeaves(text.slice(last), opts.names, opts.meName));
  return out;
}

/**
 * `splitMentions` unchanged, re-shaped into the token vocabulary. It stays the
 * single mention parser on this surface: two parsers that agree today are two
 * parsers that disagree after the next edit, which is the bug the web's
 * `__tests__/renderMentions.test.jsx` exists to remember.
 */
function mentionLeaves(text: string, names: string[], meName: string | null): Leaf[] {
  if (!text) return [];
  return splitMentions(text, names, meName)
    .filter(p => p !== '')
    .map(p => (typeof p === 'string' ? p : { k: 'mn' as const, mention: p.mention, name: p.name, me: p.me }));
}

function inlineFrom(text: string, idx: number, opts: Required<RichOpts>): Leaf[] {
  if (!text) return [];
  if (idx >= INLINE.length) return linksAndMentions(text, opts);
  const rule = INLINE[idx];
  // A fresh RegExp per call: the module-level literal carries `lastIndex`
  // across the recursion otherwise, and a shared cursor over different strings
  // drops tokens in a way that only shows up on the second message of a burst.
  const re = new RegExp(rule.re.source, 'g');
  const out: Leaf[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    if (!guardOk(text, m.index, end, m[1])) {
      // Not a pair. Resume ONE character on, not past the whole failed match,
      // so the closing marker of a rejected pair can still open a real one.
      re.lastIndex = m.index + 1;
      continue;
    }
    if (m.index > last) out.push(...inlineFrom(text.slice(last, m.index), idx + 1, opts));
    out.push(rule.verbatim
      ? { k: 'code', text: m[1] }
      : { k: rule.k as 'b' | 'i' | 's', kids: inlineFrom(m[1], idx + 1, opts) });
    last = end;
    re.lastIndex = end;
  }
  if (last < text.length) out.push(...inlineFrom(text.slice(last), idx + 1, opts));
  return out;
}

/**
 * `body` → an array of block tokens:
 *
 *   { k:'p',     kids }            a run of ordinary lines
 *   { k:'pre',   lang, text }      a fenced block, verbatim
 *   { k:'quote', kids }            consecutive `>` lines, merged
 *   { k:'ul',    items }           consecutive `-`/`*` lines, merged
 *   { k:'ol',    start, items }    consecutive `1.` lines, merged
 *
 * A `p` run keeps its newlines and is rendered with NO wrapper, so a message
 * with no formatting in it produces exactly the node `ChatScreen` produced
 * before rich text existed — React Native's `<Text>` lays out a `\n` literally,
 * which is the platform's own version of the `white-space: pre-wrap` the web
 * relied on. Only the four block kinds introduce a box, and each one owns its
 * own spacing, which is why the newline that separated a block from the text
 * above it is consumed rather than emitted.
 */
export function parseRich(body: string | null | undefined, opts: RichOpts = {}): Block[] {
  const src = body == null ? '' : String(body);
  if (!src) return [];
  const resolved: Required<RichOpts> = { names: opts.names ?? [], meName: opts.meName ?? null };
  const lines = src.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const fence = FENCE_RE.exec(lines[i]);
    if (fence) {
      const lang = fence[1] || null;
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) { buf.push(lines[i]); i += 1; }
      // An unclosed fence runs to the end of the message rather than collapsing
      // back to literal text. Someone pasting a stack trace and forgetting the
      // closing fence gets a code block; the alternative is three backticks and
      // a wall of unwrapped text, which looks like the parser broke.
      if (i < lines.length) i += 1;
      blocks.push({ k: 'pre', lang, text: buf.join('\n') });
      continue;
    }

    if (QUOTE_RE.test(lines[i])) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        buf.push(QUOTE_RE.exec(lines[i])![1]);
        i += 1;
      }
      blocks.push({ k: 'quote', kids: inlineFrom(buf.join('\n'), 0, resolved) });
      continue;
    }

    if (OL_RE.test(lines[i])) {
      // `start` from the FIRST number, so a list someone typed as 3./4./5.
      // renders as 3, 4, 5 rather than being silently renumbered from 1.
      const start = Number(OL_RE.exec(lines[i])![1]) || 1;
      const items: Leaf[][] = [];
      while (i < lines.length && OL_RE.test(lines[i])) {
        items.push(inlineFrom(OL_RE.exec(lines[i])![2], 0, resolved));
        i += 1;
      }
      blocks.push({ k: 'ol', start, items });
      continue;
    }

    if (UL_RE.test(lines[i])) {
      const items: Leaf[][] = [];
      while (i < lines.length && UL_RE.test(lines[i])) {
        items.push(inlineFrom(UL_RE.exec(lines[i])![1], 0, resolved));
        i += 1;
      }
      blocks.push({ k: 'ul', items });
      continue;
    }

    const buf: string[] = [];
    while (i < lines.length && !isBlockStart(lines[i])) { buf.push(lines[i]); i += 1; }
    blocks.push({ k: 'p', kids: inlineFrom(buf.join('\n'), 0, resolved) });
  }

  return blocks;
}
