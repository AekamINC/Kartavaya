/**
 * messageUtils.js — the pure parts of the message log.
 *
 * Kept out of the components so the grouping rules and the reaction shape are
 * stated once and can be read without a render tree around them.
 */

/**
 * `06-sanvaad-varta.md` §6: "The API returns reactions as either an array or a
 * JSON string. The component defends against two serializations because the
 * backend emits both. Fix it server-side and delete the branch."
 *
 * The claim holds, and the branch stays for now: `backend/routers/messaging.py`
 * builds `reactions` with `json_agg(...)`, and asyncpg hands a `json` column
 * back as `str` unless a codec is registered, so the field really can arrive
 * either way depending on pool configuration. The backend is not this module's
 * to edit — registering a jsonb codec on the pool is the one-line fix, and until
 * it lands removing this would be removing a load-bearing defence.
 */
export function parseReactions(raw) {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? v : [];
}

/**
 * `06` §5: "Only counts survive. Clicking an existing chip posts to the same
 * toggle endpoint, so the user cannot tell whether their click will add or
 * remove. Keep `user_ids` per emoji."
 *
 * The rows already carry `user_id` — `json_build_object('emoji', r.emoji,
 * 'user_id', r.user_id)` — so the information was being discarded client-side,
 * not missing from the API. Returns `[{emoji, count, userIds, mine}]` in first-
 * seen order, which is the order every chat product uses for reaction chips.
 */
export function groupReactions(raw, meId) {
  const order = [];
  const byEmoji = new Map();
  for (const r of parseReactions(raw)) {
    if (!r || !r.emoji) continue;
    if (!byEmoji.has(r.emoji)) {
      byEmoji.set(r.emoji, { emoji: r.emoji, count: 0, userIds: [], mine: false });
      order.push(r.emoji);
    }
    const g = byEmoji.get(r.emoji);
    g.count += 1;
    if (r.user_id != null) {
      g.userIds.push(r.user_id);
      if (meId != null && String(r.user_id) === String(meId)) g.mine = true;
    }
  }
  return order.map(e => byEmoji.get(e));
}

/** Toggle one emoji locally, so a reaction does not cost a history refetch. */
export function toggleReactionLocal(raw, emoji, meId) {
  const rows = parseReactions(raw);
  const has = rows.some(r => r.emoji === emoji && String(r.user_id) === String(meId));
  return has
    ? rows.filter(r => !(r.emoji === emoji && String(r.user_id) === String(meId)))
    : [...rows, { emoji, user_id: meId }];
}

/**
 * Union by id, oldest first.
 *
 * `06` §2b: "loadMessages opens with setLoading(true), so 'Loading messages…'
 * reappears every 5 seconds, and the entire message array is replaced —
 * discarding any optimistic local state."
 *
 * Replacing is what discards. Merging keeps a just-sent message that the poll's
 * page has not caught up with, and keeps the server row authoritative wherever
 * the two overlap.
 */
export function mergeById(local, incoming, { markFresh = false } = {}) {
  const byId = new Map();
  for (const m of local) if (m && m.id != null) byId.set(String(m.id), m);
  // A row is "fresh" only if the log already had content — otherwise the first
  // page of a channel would arrive with fifty rows all flagged, and the entrance
  // animation would play across the whole log instead of on the one message that
  // just landed. See `.msg--new` in sanvaad.css.
  const wasPopulated = byId.size > 0;
  for (const m of incoming) {
    if (!m || m.id == null) continue;
    const key = String(m.id);
    if (byId.has(key)) { byId.set(key, { ...byId.get(key), ...m }); continue; }
    byId.set(key, markFresh && wasPopulated ? { ...m, __fresh: true } : m);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
  );
}

/* ── Optimistic send ───────────────────────────────────────────────────────
 *
 * `MOTION-SPEC.md` §7.1: "Never lie about state. Optimistic UI renders at
 * `opacity .6` until acknowledged, then goes solid. A failed write restores the
 * old value and says so." `IxChat.jsx:48` is the reference implementation — the
 * row is pushed with `sending: true` in the same tick the composer clears, and
 * `.cd__m.sending { opacity: .6 }` (motion.css:517) is what renders it.
 *
 * The build awaited the POST before the row existed at all, so on a slow network
 * the message vanished from the composer and appeared nowhere for as long as the
 * round trip took.
 */

/** `tmp:` can never collide with a server id, which are integers. */
let tmpSeq = 0;
export const TMP_PREFIX = 'tmp:';
export const isPending = m => !!m && typeof m.id === 'string' && m.id.startsWith(TMP_PREFIX);

export function optimisticMessage(content, { meId, me } = {}) {
  tmpSeq += 1;
  return {
    id: `${TMP_PREFIX}${Date.now()}.${tmpSeq}`,
    content,
    sender_id: meId,
    sender_name: me?.full_name || me?.name || undefined,
    sender_avatar: me?.avatar_url || undefined,
    // Sorts last in `mergeById`, which is where it belongs: it is the newest
    // thing in the channel until the server disagrees.
    created_at: new Date().toISOString(),
    __pending: true,
    // Deliberately NOT `__fresh`. The placeholder is the acknowledgement of your
    // own keystroke and has to be there in the same frame; sliding it in would
    // delay the one row that must not be delayed. It is also replaced by a
    // differently-keyed element when the server answers, so an entrance here
    // would play twice for one message.
  };
}

/**
 * Drop pending rows the server has already echoed back.
 *
 * The 5s poll can land between the optimistic push and the POST's response. When
 * it does, the real row arrives while the placeholder is still on screen and
 * `mergeById` — a union — keeps both, so the sender sees their message twice.
 * Matching on sender + trimmed body is enough: a placeholder only lives for one
 * round trip, and two identical messages from the same person inside that window
 * are the same message.
 */
export function dropSettled(local, incoming) {
  const pending = local.filter(isPending);
  if (!pending.length) return local;
  const settled = new Set();
  for (const p of pending) {
    const hit = incoming.some(m => m
      && !isPending(m)
      && String(m.sender_id) === String(p.sender_id)
      && String(m.content || '').trim() === String(p.content || '').trim());
    if (hit) settled.add(p.id);
  }
  return settled.size ? local.filter(m => !settled.has(m.id)) : local;
}

const DAY_MS = 86400000;

/** Local calendar day, not UTC — a message at 01:00 IST belongs to that day. */
export function dayKey(iso) {
  const d = new Date(iso || 0);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * The Devanagari partner for a weekday, so a date separator reads the way every
 * other label in the product does — `24-bilingual-devanagari.md`, and
 * `ScreensSanvaad.jsx`, whose separators are "Today · आज", "Yesterday · कल" and
 * "Monday · सोमवार". `toLocaleDateString('hi-IN')` would produce these, but only
 * where the runtime ships the `hi` locale data, and it also returns the whole
 * date rather than the weekday alone. Seven strings are cheaper than that
 * dependency and cannot vary by machine.
 */
const HI_WEEKDAY = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];

/**
 * `{en, hi}` — `hi` is null when there is no sensible Devanagari partner, which
 * is any separator that is a bare numeric date. The caller renders `hi` in
 * `.sv__hi`, which carries `--font-indic`; putting Devanagari on the UI font is
 * the failure `00` §2 describes as "every Devanagari sub-label silently
 * rendered in the Latin fallback".
 */
export function dayLabel(iso) {
  const d = new Date(iso || 0);
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((midnight - that) / DAY_MS);
  if (diff === 0) return { en: 'Today', hi: 'आज' };
  if (diff === 1) return { en: 'Yesterday', hi: 'कल' };
  if (diff < 7 && diff > 0) {
    return { en: d.toLocaleDateString('en-IN', { weekday: 'long' }), hi: HI_WEEKDAY[d.getDay()] };
  }
  return {
    en: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    hi: null,
  };
}

/**
 * Consecutive-message grouping — 5 minutes, same sender, same day.
 *
 * `06` §1: "staging doesn't have this: every message there gets a 32px avatar, a
 * name and a timestamp, so a burst of five messages from one person costs five
 * avatars and five names."
 */
const GROUP_MS = 5 * 60 * 1000;

export function isContinuation(msg, prev) {
  if (!prev || !msg) return false;
  // A module event is never part of a run. `type='system'` rows carry the
  // sender_id of whoever triggered them, so without this a task update from
  // Kartavya would group under the human message that caused it and lose the
  // header that names the module.
  if (msg.type === 'system' || prev.type === 'system') return false;
  if (prev.sender_id !== msg.sender_id) return false;
  if (dayKey(prev.created_at) !== dayKey(msg.created_at)) return false;
  const gap = new Date(msg.created_at || 0) - new Date(prev.created_at || 0);
  return gap >= 0 && gap < GROUP_MS;
}

/* ── Mentions ──────────────────────────────────────────────────────────────
 *
 * `06` §2 puts `MentionAutocomplete` under the composer and `ScreensSanvaad.jsx`
 * renders mentions in the body through `MTxt` → `.mnt`. Nothing rendered them
 * here, so "@Aanya Mehta, can you check this" arrived as flat body text and the
 * one span a reader scans a channel for was invisible.
 *
 * Insertion is the other half and is NOT here: `components/MentionTextarea.jsx`
 * owns it, belongs to `03-task-drawer.md`, hardcodes `className="inp"` and takes
 * no class of its own — so it cannot render as `.cmp__ta` without an edit to a
 * file this module does not own. Reported rather than half-built.
 */

/** Longest name first, so a member called "Keval" cannot shadow "Keval Shah". */
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
 * render tree, and so the caller owns the class names.
 */
export function splitMentions(body, names = [], meName = null) {
  if (!body) return [String(body ?? '')];
  const known = [...new Set(names.filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe);
  const alt = known.length ? `(?:${known.join('|')})|[\\w.-]+` : '[\\w.-]+';
  const re = new RegExp(`(^|[^\\w@])(@(?:${alt}))`, 'gi');

  const out = [];
  let last = 0;
  let m;
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

/* ── Rich text ─────────────────────────────────────────────────────────────
 *
 * A colleague's message body, turned into a token tree.
 *
 * TOKENS, NOT MARKUP, AND THE REASON IS NOT STYLE. Every other chat product
 * that renders formatting does it by producing an HTML string and handing it to
 * `innerHTML`. A Sanvaad channel is the one surface in this product where a
 * string typed by one colleague is rendered inside every other colleague's
 * browser, so an injected `<img onerror>` there runs for the whole channel, not
 * for its author. `parseRich` therefore emits plain data and `Message.jsx`
 * turns it into React elements — every leaf that came from `content` ends up as
 * a React child, which React escapes on insertion. There is no
 * `dangerouslySetInnerHTML` and no `innerHTML` assignment anywhere on this
 * path, and adding one would silently undo the whole defence.
 *
 * The two things the escaping does NOT give for free, both handled below:
 *
 *  · `href`. React will happily render `href="javascript:…"`. `safeHref` is an
 *    ALLOWLIST — only `http://` and `https://` survive — because a blocklist of
 *    `javascript:`/`data:`/`vbscript:` loses to `java\tscript:` and to a
 *    scheme-relative `//evil.tld`.
 *  · Backtracking. Every marker regex below is a negated character class under a
 *    single quantifier — see `INLINE` — never a lazy dot with a lookaround. A
 *    4 000-character message is a linear parse; the alternative is a message
 *    that locks the tab of everyone who scrolls past it.
 *
 * The supported subset is Slack's, not CommonMark's: `*bold*` with ONE
 * asterisk, `_italic_`, `~strike~`, `` `code` ``, ``` fences, `> quote`,
 * `- item`, `1. item`, bare URLs. Headings, tables, images, `**bold**` and
 * `[text](url)` are deliberately absent — anything not in that list renders as
 * the literal characters the author typed, which is the only rule a reader can
 * predict without being told.
 */

/** A fence opens or closes a block; the language tag is accepted and dropped. */
const FENCE_RE = /^\s{0,3}```([A-Za-z0-9_+#.-]*)\s*$/;
/** `>` or `> `, up to three leading spaces. Consecutive lines merge (see below). */
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
/** The space after the marker is required, which is what keeps `*bold*` on its
 *  own line from being read as a one-item bullet list. */
const UL_RE = /^\s{0,3}[-*]\s+(.+)$/;
/** `1.` only — `1)` is not in the supported table, so it stays literal text. */
const OL_RE = /^\s{0,3}(\d{1,9})\.\s+(.+)$/;

const isBlockStart = l =>
  FENCE_RE.test(l) || QUOTE_RE.test(l) || OL_RE.test(l) || UL_RE.test(l);

/**
 * A marker only opens where a word cannot continue into it, and only closes
 * where one does not continue out of it. Without this `2 * 3 * 4` is bold and
 * `snake_case_name` is italic — the two false positives that make people stop
 * trusting a formatter and start escaping everything.
 *
 * `।` and `॥` are in the closing set beside the ASCII stops for the same reason
 * every label in this product has a Devanagari half: `*ज़रूरी*।` is how a Hindi
 * sentence ends, and a closing set that only knows `.` would render the whole
 * thing as literal asterisks for exactly the users the bilingual work is for.
 */
const OPEN_OK = /[\s([{<"']/;
const CLOSE_OK = /[\s)\]}>.,!?;:"'।॥]/;

function guardOk(text, start, end, inner) {
  if (!inner || /^\s|\s$/.test(inner) || inner.includes('\n')) return false;
  const before = start > 0 ? text[start - 1] : '';
  if (before && !OPEN_OK.test(before)) return false;
  const after = end < text.length ? text[end] : '';
  if (after && !CLOSE_OK.test(after)) return false;
  return true;
}

/**
 * Ordered, and the order is the whole point of doing code first: text captured
 * inside a code span is emitted verbatim as a single leaf and NO later rule
 * touches it, so `` `@Keval` `` is not a mention and `` `*x*` `` is not bold.
 * Each rule scans the string once; whatever it does not consume falls through
 * to the next one, so a rule can nest the rules below it (`*bold _and_ both*`)
 * and can never nest itself.
 */
const INLINE = [
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
 */
export function safeHref(raw) {
  const u = String(raw == null ? '' : raw).trim().replace(/[\u0000-\u001f\u007f]/g, '');
  return /^https?:\/\//i.test(u) ? u : null;
}

/** URLs, then mentions — the last two passes, both of which produce leaves. */
function linksAndMentions(text, { names, meName }) {
  if (!text) return [];
  const out = [];
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    let raw = m[0].replace(URL_TRAIL_RE, '');
    // The strip can eat the entire match only if the match was punctuation,
    // which `https?://` makes impossible — but a URL that is nothing but the
    // scheme still deserves to stay text rather than become an empty link.
    const href = raw.length > 8 ? safeHref(raw) : null;
    if (!href) { URL_RE.lastIndex = m.index + m[0].length; continue; }
    if (m.index > last) out.push(...mentionLeaves(text.slice(last, m.index), names, meName));
    out.push({ k: 'a', href, text: raw });
    last = m.index + raw.length;
    URL_RE.lastIndex = last;
  }
  if (last < text.length) out.push(...mentionLeaves(text.slice(last), names, meName));
  return out;
}

/**
 * `splitMentions` unchanged, re-shaped into the token vocabulary. It stays the
 * single mention parser on this surface: two parsers that agree today are two
 * parsers that disagree after the next edit, which is the bug
 * `__tests__/renderMentions.test.jsx` exists to remember.
 */
function mentionLeaves(text, names, meName) {
  if (!text) return [];
  return splitMentions(text, names, meName)
    .filter(p => p !== '')
    .map(p => (typeof p === 'string' ? p : { k: 'mn', mention: p.mention, name: p.name, me: p.me }));
}

function inlineFrom(text, idx, opts) {
  if (!text) return [];
  if (idx >= INLINE.length) return linksAndMentions(text, opts);
  const rule = INLINE[idx];
  // A fresh RegExp per call: the module-level literal carries `lastIndex`
  // across the recursion otherwise, and a shared cursor over different strings
  // drops tokens in a way that only shows up on the second message of a burst.
  const re = new RegExp(rule.re.source, 'g');
  const out = [];
  let last = 0;
  let m;
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
      ? { k: rule.k, text: m[1] }
      : { k: rule.k, kids: inlineFrom(m[1], idx + 1, opts) });
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
 * A `p` run keeps its newlines and is rendered with NO wrapper element, so a
 * message with no formatting in it produces exactly the DOM this surface
 * produced before rich text existed — `.msg__b` is `white-space: pre-wrap` and
 * that is still what lays the lines out. Only the four block kinds introduce an
 * element, and each one owns its own spacing, which is why the newline that
 * separated a block from the text above it is consumed rather than emitted.
 */
export function parseRich(body, { names = [], meName = null } = {}) {
  const src = body == null ? '' : String(body);
  if (!src) return [];
  const opts = { names, meName };
  const lines = src.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const fence = FENCE_RE.exec(lines[i]);
    if (fence) {
      const lang = fence[1] || null;
      const buf = [];
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
      const buf = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        buf.push(QUOTE_RE.exec(lines[i])[1]);
        i += 1;
      }
      blocks.push({ k: 'quote', kids: inlineFrom(buf.join('\n'), 0, opts) });
      continue;
    }

    if (OL_RE.test(lines[i])) {
      // `start` from the FIRST number, so a list someone typed as 3./4./5.
      // renders as 3, 4, 5 rather than being silently renumbered from 1.
      const start = Number(OL_RE.exec(lines[i])[1]) || 1;
      const items = [];
      while (i < lines.length && OL_RE.test(lines[i])) {
        items.push(inlineFrom(OL_RE.exec(lines[i])[2], 0, opts));
        i += 1;
      }
      blocks.push({ k: 'ol', start, items });
      continue;
    }

    if (UL_RE.test(lines[i])) {
      const items = [];
      while (i < lines.length && UL_RE.test(lines[i])) {
        items.push(inlineFrom(UL_RE.exec(lines[i])[1], 0, opts));
        i += 1;
      }
      blocks.push({ k: 'ul', items });
      continue;
    }

    const buf = [];
    while (i < lines.length && !isBlockStart(lines[i])) { buf.push(lines[i]); i += 1; }
    blocks.push({ k: 'p', kids: inlineFrom(buf.join('\n'), 0, opts) });
  }

  return blocks;
}

/* ── The composer's half of the same subset ────────────────────────────────
 *
 * `parseRich` above is the reader; these two are the writer, and they sit
 * beside it because every rule they obey is one of its rules rather than
 * Slack's documentation:
 *
 *   · `guardOk` refuses an inner run that begins or ends with whitespace, so a
 *     selection is trimmed INWARD before the markers go on — `* text *` is not
 *     bold, it is four literal characters.
 *   · `guardOk` also refuses an inner run containing a newline, so a
 *     multi-line selection gets one pair PER LINE. One pair around three lines
 *     renders as three lines of literal asterisks.
 *   · `FENCE_RE` only recognises ``` alone on its line, so the fence extends
 *     the selection to whole lines before it wraps anything.
 *
 * A toolbar written from Slack's help page rather than from the parser twelve
 * lines up would have made all three of those mistakes, and a formatting button
 * that silently does nothing is worse than no button at all: the reader cannot
 * tell whether they mis-selected, or the feature is broken, or the product has
 * no bold.
 *
 * Both are pure and both return the whole new value plus the selection to
 * restore, so the rules live here where the parser can be read next to them and
 * the DOM work stays in `Composer`.
 *
 * WHAT THEY DELIBERATELY DO NOT DO: rescue a mid-word selection. `guardOk`
 * needs whitespace or an opening bracket before the marker, so bolding `orl`
 * inside `world` produces `w*orl*d`, which renders literally. Widening the
 * selection to the word would be the composer overruling what somebody
 * actually highlighted, which is the worse of the two surprises.
 */

/** The character each inline rule opens and closes with, read off the parser's
 *  own table so a button and its regex cannot drift apart. */
export const MARKERS = INLINE.reduce((o, r) => { o[r.k] = r.mark; return o; }, {});

/** The fenced block's delimiter — `FENCE_RE` is what has to accept it back.
 *  Not exported: `toggleFence` is the only thing that may write one, and a
 *  second writer somewhere else is how the two ends of this stop agreeing. */
const FENCE = '```';

/** The offsets of the run inside `s` that a marker may legally wrap. */
function core(s) {
  let i = 0;
  while (i < s.length && /\s/.test(s[i])) i += 1;
  let j = s.length;
  while (j > i && /\s/.test(s[j - 1])) j -= 1;
  return [i, j];
}

const clamp = (n, len) => Math.max(0, Math.min(len, Number.isFinite(n) ? n : 0));

/**
 * Put `mark` around the selection, or take it off if it is already there.
 *
 * `{value, start, end}` — the whole new draft and the selection that should be
 * showing afterwards, both absolute in the new string. An unchanged `value` is
 * how "there was nothing here to mark" is reported; the caller writes nothing.
 */
export function toggleInline(value, start, end, mark) {
  const v = value == null ? '' : String(value);
  const m = mark.length;
  const lo = Math.min(clamp(start, v.length), clamp(end, v.length));
  const hi = Math.max(clamp(start, v.length), clamp(end, v.length));

  // Nothing selected: the empty pair goes in and the caret lands between the
  // two markers, which is where the next keystroke belongs.
  if (lo === hi) {
    const at = lo + m;
    return { value: v.slice(0, lo) + mark + mark + v.slice(lo), start: at, end: at };
  }

  // The markers can sit just OUTSIDE the selection. Double-clicking `bold`
  // inside `*bold*` selects the word and not the asterisks, so a second press
  // has to take that pair off rather than add a second one inside it.
  if (lo >= m && v.slice(lo - m, lo) === mark && v.slice(hi, hi + m) === mark) {
    return {
      value: v.slice(0, lo - m) + v.slice(lo, hi) + v.slice(hi + m),
      start: lo - m,
      end: hi - m,
    };
  }

  // One decision for the whole selection, not one per line: a block where every
  // line is already marked comes off, and anything else goes on. Deciding per
  // line would make one unmarked line in a marked paragraph flip the other
  // three, which is a button that does two opposite things in one press.
  const lines = v.slice(lo, hi).split('\n');
  const marked = lines.every((l) => {
    const [i, j] = core(l);
    return j === i
      || (j - i > 2 * m && l.slice(i, i + m) === mark && l.slice(j - m, j) === mark);
  });
  const out = lines.map((l) => {
    const [i, j] = core(l);
    // A blank line keeps its whitespace and gets no marker. An empty inner run
    // is the one thing `guardOk` refuses outright.
    if (j === i) return l;
    const inner = l.slice(i, j);
    return l.slice(0, i)
      + (marked ? inner.slice(m, inner.length - m) : mark + inner + mark)
      + l.slice(j);
  }).join('\n');

  return { value: v.slice(0, lo) + out + v.slice(hi), start: lo, end: lo + out.length };
}

/**
 * Put the selection in a fenced block, or take the fences off.
 *
 * Line-aligned in both directions, because `FENCE_RE` is anchored: a fence with
 * anything else on its line is not a fence, it is three backticks. The
 * selection afterwards is the CODE, not the fences — the reader is about to
 * keep typing in the block, not next to it.
 */
export function toggleFence(value, start, end) {
  const v = value == null ? '' : String(value);
  const lo = Math.min(clamp(start, v.length), clamp(end, v.length));
  const hi = Math.max(clamp(start, v.length), clamp(end, v.length));

  const a = lo === 0 ? 0 : v.lastIndexOf('\n', lo - 1) + 1;
  // A selection that ends ON a line break has already taken that whole line;
  // searching forward from there would swallow the next one as well.
  let b = hi > lo && v[hi - 1] === '\n' ? hi - 1 : v.indexOf('\n', hi);
  if (b < 0) b = v.length;

  const lines = v.slice(a, b).split('\n');
  // The fences inside the selection: somebody dragged across the whole block.
  if (lines.length >= 2 && FENCE_RE.test(lines[0]) && FENCE_RE.test(lines[lines.length - 1])) {
    const body = lines.slice(1, -1).join('\n');
    return { value: v.slice(0, a) + body + v.slice(b), start: a, end: a + body.length };
  }

  // The fences just OUTSIDE it, which is the common re-press: this function
  // leaves the caret on the CODE, so pressing the button a second time arrives
  // with the block's own body selected and the two fence lines out of range.
  // `toggleInline` has to look outside its selection for exactly the same
  // reason, and a toggle that only works from one of the two obvious starting
  // positions is a toggle people stop trusting.
  const preEnd = a - 1;
  const preStart = preEnd <= 0 ? 0 : v.lastIndexOf('\n', preEnd - 1) + 1;
  const postStart = b + 1;
  let postEnd = v.indexOf('\n', postStart);
  if (postEnd < 0) postEnd = v.length;
  if (a > 0 && b < v.length
    && FENCE_RE.test(v.slice(preStart, preEnd))
    && FENCE_RE.test(v.slice(postStart, postEnd))) {
    const body = v.slice(a, b);
    return {
      value: v.slice(0, preStart) + body + v.slice(postEnd),
      start: preStart,
      end: preStart + body.length,
    };
  }

  const body = lines.join('\n');
  const at = a + FENCE.length + 1;
  return {
    value: `${v.slice(0, a)}${FENCE}\n${body}\n${FENCE}${v.slice(b)}`,
    start: at,
    end: at + body.length,
  };
}

/* ── The link chip ──────────────────────────────────────────────────────────
 *
 * `.m2link` in the prototype has three lines: `__h` a host, `__t` a title and
 * `__d` a description. A title and a description can only come from FETCHING
 * the page and reading its Open Graph tags, and doing that means the server
 * requests an address a user typed — an SSRF surface that needs an allowlist, a
 * size cap, a timeout and a cache before it is safe to ship.
 *
 * So this is deliberately NOT that. It derives everything from the URL string
 * itself, makes no network request of any kind, and therefore emits `__h` and
 * `__t` and NEVER `__d`: a description is the one thing that cannot be honestly
 * inferred, and an invented one would be a claim about somebody else's page.
 * The real unfurl can replace `linkCard` without touching the markup.
 */

/** Words a path segment can end with that carry no meaning for a reader. */
const CHIP_NOISE = /\.(html?|php|aspx?|jsp|pdf|docx?|xlsx?|pptx?)$/i;

/**
 * The first link in a body, as {href, host, title}, or null.
 *
 * `null` for a message with no link, and null rather than a throw for a URL the
 * platform cannot parse — a chip is decoration, and decoration must never be
 * the thing that stops a message rendering.
 */
export function linkCard(body) {
  const text = String(body == null ? '' : body);
  URL_RE.lastIndex = 0;
  const m = URL_RE.exec(text);
  if (!m) return null;

  const raw = m[0].replace(URL_TRAIL_RE, '');
  const href = raw.length > 8 ? safeHref(raw) : null;
  if (!href) return null;

  let u;
  try { u = new URL(href); } catch { return null; }

  // `www.` is noise to a reader and the only prefix worth stripping — a real
  // subdomain like `docs.` or `staging.` is information about where the link
  // goes and removing it would be a small lie.
  const host = u.hostname.replace(/^www\./i, '');

  // The title, from the path. The last segment that says anything, with its
  // extension and separators removed. A bare domain has no path and gets the
  // host, which reads correctly: "figma.com".
  const seg = u.pathname.split('/').filter(Boolean).pop();
  let title = host;
  if (seg) {
    let t = seg;
    try { t = decodeURIComponent(seg); } catch { /* keep the raw segment */ }
    t = t.replace(CHIP_NOISE, '').replace(/[-_+]+/g, ' ').trim();
    // A segment that is only digits or a hash is an id, not a name — the host
    // is more use to a reader than "8f21ab".
    if (t && !/^[0-9a-f]{6,}$/i.test(t) && !/^\d+$/.test(t)) {
      title = t.charAt(0).toUpperCase() + t.slice(1);
    }
  }

  return { href, host, title };
}
