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
export function mergeById(local, incoming) {
  const byId = new Map();
  for (const m of local) if (m && m.id != null) byId.set(String(m.id), m);
  for (const m of incoming) {
    if (!m || m.id == null) continue;
    const key = String(m.id);
    byId.set(key, byId.has(key) ? { ...byId.get(key), ...m } : m);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
  );
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
