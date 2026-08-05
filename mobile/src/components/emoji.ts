/**
 * emoji.ts — the reaction picker's catalogue, search and recents.
 *
 * DATA AND LOGIC ONLY. No JSX, on purpose: `node --test` cannot load a `.tsx`
 * file at all (Node's type-stripping does not transform JSX), so anything that
 * lives in `ChatScreen.tsx` is reachable by source-contract reading or not at
 * all. Keyword search and a most-recently-used list are exactly the kind of
 * thing that fails quietly and is worth testing for real, so they are here.
 *
 * ── Native glyphs, no sprite sheet ──────────────────────────────────────────
 *
 * Proposal 09: "Every target platform renders them. A sprite sheet is ~400 KB
 * and a licence question for nothing." Both platforms ship a colour emoji font,
 * and — unlike Devanagari, which is the reason `theme/fonts.ts` exists — nothing
 * in the app sets a `fontFamily` on these, so the system emoji face is used. See
 * the caveat below, which is real and is NOT the Devanagari problem in disguise.
 *
 * ── HOW BIG THIS LIST IS, AND WHY IT IS NOT 1,500 ───────────────────────────
 *
 * Proposal 09 costs a "curated ~1,500-emoji list with keywords" at ~40 KB and
 * says it must be lazy-loaded rather than sitting in the main bundle. That
 * reasoning is a web reasoning: it is about a network waterfall on first paint.
 * There is no waterfall here — Metro bundles this file into the app binary
 * whether it is imported lazily or not, and React Native has no dynamic `import()`
 * that removes anything from the download.
 *
 * So the trade is different on a phone and it is a memory-and-scroll trade
 * rather than a bytes-over-the-wire one. This is ~190 glyphs across eight
 * categories, which is one thumb-scroll per category and covers what people
 * actually react with in a work chat. A caller who wants a glyph that is not
 * here is not blocked: `samvada_message_reactions.emoji` is free text and the
 * server validates nothing, so the endpoint accepts anything — the picker is the
 * only thing that is curated.
 *
 * ── THE GLYPH CAVEAT, stated rather than discovered on a device ─────────────
 *
 * A few of these are sequences rather than single code points — ZWJ sequences
 * (👨‍💻) and variation selectors (❤️ is U+2764 U+FE0F). An OS whose emoji font
 * predates a sequence renders it as its parts: 👨‍💻 becomes 👨 💻 side by side, and
 * a bare ❤ can render as monochrome text rather than the red heart. That is a
 * platform-version question, not a bug in this file, and it degrades to
 * *something legible* rather than to a tofu box.
 *
 * NOTHING HERE HAS BEEN SEEN ON A DEVICE. This whole file was written against
 * a Windows workstation with no emulator; the list is deliberately confined to
 * long-standing, widely-supported glyphs for that reason, and the two sequence
 * forms above are the only riskier shapes in it.
 *
 * ── Skin tones are absent, deliberately ─────────────────────────────────────
 *
 * 👍 and not 👍🏽. A skin-tone modifier makes each glyph six rows, and — more to
 * the point — the server aggregates reactions BY THE EXACT STRING, so 👍 and 👍🏽
 * are two different reactions that tally separately. Five colleagues agreeing
 * would show as five separate pills reading "1". Slack solves that with a
 * per-user default applied at send time; that is a preference and a schema
 * decision, not a picker feature, and it is not built.
 */

import { storage } from '../lib/storage';

export interface EmojiCategory {
  /** Rendered as the section heading. */
  label: string;
  /** Ionicons glyph for the category strip. */
  icon:  string;
  glyphs: string[];
}

/**
 * The catalogue.
 *
 * Order is the order the picker renders. SMILEYS first because that is where
 * the eye goes and where the long tail of reactions actually lives; WORK second
 * because this is an accounting firm's chat and 📈 📄 ✅ carry more traffic here
 * than 🐶 does.
 */
export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    label: 'Smileys',
    icon:  'happy-outline',
    glyphs: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
      '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '😘',
      '😋', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳',
      '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣',
      '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠',
      '😡', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰',
      '😥', '😓', '🤗', '🤔', '🤭', '🤫', '😐', '😑',
      '😬', '🙄', '😯', '😴', '🤤', '😪', '🤢', '🤮',
      '🤧', '😷', '🤒', '🤕',
    ],
  },
  {
    label: 'Work',
    icon:  'briefcase-outline',
    glyphs: [
      '✅', '☑️', '❌', '⚠️', '❗', '❓', '📌', '📍',
      '📄', '📃', '📑', '📊', '📈', '📉', '🗂️', '📁',
      '📅', '📆', '🗓️', '⏰', '⏳', '⌛', '🔔', '🔕',
      '💰', '💵', '🧾', '💳', '🏦', '⚖️', '🔖', '🖊️',
      '✏️', '📝', '📋', '🔍', '🔎', '🔒', '🔓', '🔑',
      '💼', '🏢', '📞', '📧', '💻', '🖥️', '⌨️', '🖨️',
    ],
  },
  {
    label: 'Gestures',
    icon:  'hand-left-outline',
    glyphs: [
      '👍', '👎', '👌', '🤌', '✌️', '🤞', '🤝', '🙏',
      '👏', '🙌', '👋', '🤙', '💪', '🫡', '🤷', '🤦',
      '☝️', '👆', '👇', '👉', '👈', '✋', '🖐️', '👊',
      // 👀 IS ONE OF THE FIVE QUICK REACTIONS and was in no category at all, so
      // the picker that opens behind `+` could not reach the most-used "I am
      // looking at this" glyph in the product. Caught by
      // `__tests__/emoji.test.ts`, which is why that test exists: a keyword
      // index and a catalogue that disagree fail silently in the one direction
      // nobody checks. It sits here rather than in Smileys because it is a body
      // part, which is what this category is.
      '👀',
    ],
  },
  {
    label: 'People',
    icon:  'people-outline',
    glyphs: [
      '👤', '👥', '🧑', '👩', '👨', '🧓', '👶', '🧑‍💼',
      '👩‍💻', '👨‍💻', '👮', '🕵️', '🧑‍⚖️', '🧑‍🏫', '🤵', '👰',
    ],
  },
  {
    label: 'Symbols',
    icon:  'heart-outline',
    glyphs: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '💔', '💯', '🔥', '⭐', '🌟', '✨', '⚡', '💥',
      '💡', '🎯', '🏆', '🥇', '🎉', '🎊', '🎁', '🔴',
      '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '♻️',
    ],
  },
  {
    label: 'Objects',
    icon:  'cube-outline',
    glyphs: [
      '☕', '🍵', '🍰', '🍕', '🍔', '🥗', '🍚', '🍛',
      '🚀', '✈️', '🚗', '🚌', '🏠', '🏥', '🏫', '🌍',
      '☀️', '🌧️', '❄️', '🌈', '🌙', '🎵', '📷', '🎬',
    ],
  },
];

/** Every glyph in the catalogue, flat. Deduplicated — the categories overlap. */
export const ALL_EMOJI: string[] = [
  ...new Set(EMOJI_CATEGORIES.flatMap(c => c.glyphs)),
];

/**
 * Keyword index for search.
 *
 * KEYWORD, NOT FUZZY — proposal 09 says so and the reason is that a fuzzy match
 * over 190 glyphs returns everything for a two-letter query, which is worse than
 * returning nothing. A prefix match on a word is predictable: "th" finds
 * "thanks", "thinking" and nothing else.
 *
 * Only the glyphs somebody would plausibly search for are listed. An unindexed
 * glyph is still reachable by scrolling to its category, which is how a picker
 * is used most of the time; an index that tried to be complete would be a second
 * list to keep in step with the first.
 *
 * English only. The composer accepts Hindi and Gujarati (see the Sahayak
 * placeholder) and this search does not, which is a real gap and is reported
 * rather than half-filled — transliterated keys ("khushi", "dhanyavaad") are a
 * guess about how somebody types, and a wrong guess is worse here than an
 * absence, because an absence sends you to the categories.
 */
export const EMOJI_KEYWORDS: Record<string, string[]> = {
  '👍': ['thumbs', 'up', 'yes', 'ok', 'agree', 'good', 'like'],
  '👎': ['thumbs', 'down', 'no', 'disagree', 'bad'],
  '✅': ['check', 'tick', 'done', 'yes', 'complete', 'approved'],
  '☑️': ['check', 'box', 'tick', 'done'],
  '❌': ['cross', 'no', 'wrong', 'cancel', 'reject'],
  '⚠️': ['warning', 'caution', 'alert', 'risk'],
  '❗': ['exclamation', 'important', 'urgent'],
  '❓': ['question', 'ask', 'unclear'],
  '🙏': ['thanks', 'please', 'pray', 'namaste', 'grateful'],
  '👏': ['clap', 'applause', 'well', 'done', 'praise'],
  '🙌': ['celebrate', 'hands', 'praise', 'yay'],
  '👌': ['ok', 'perfect', 'fine', 'good'],
  '🤝': ['handshake', 'deal', 'agree', 'partner'],
  '💪': ['strong', 'muscle', 'effort'],
  '🫡': ['salute', 'yes', 'acknowledged'],
  '🤷': ['shrug', 'unsure', 'dunno'],
  '👀': ['eyes', 'looking', 'watching', 'review'],
  '🤔': ['thinking', 'hmm', 'unsure', 'consider'],
  '🎉': ['party', 'celebrate', 'congrats', 'launch'],
  '🎊': ['party', 'celebrate', 'confetti'],
  '🔥': ['fire', 'hot', 'great', 'urgent'],
  '💯': ['hundred', 'perfect', 'agree', 'exactly'],
  '⭐': ['star', 'favourite', 'favorite', 'good'],
  '💡': ['idea', 'suggestion', 'lightbulb', 'insight'],
  '🎯': ['target', 'goal', 'exact', 'aim'],
  '🏆': ['trophy', 'win', 'award', 'best'],
  '❤️': ['heart', 'love', 'like'],
  '💔': ['broken', 'heart', 'sad'],
  '😂': ['laugh', 'funny', 'lol', 'joy'],
  '🤣': ['laugh', 'rolling', 'funny', 'lol'],
  '😅': ['sweat', 'laugh', 'nervous', 'phew'],
  '🙂': ['smile', 'happy', 'fine'],
  '😊': ['smile', 'happy', 'pleased'],
  '😍': ['love', 'heart', 'eyes', 'adore'],
  '😎': ['cool', 'sunglasses', 'confident'],
  '😢': ['cry', 'sad', 'tear'],
  '😭': ['cry', 'sobbing', 'sad'],
  '😡': ['angry', 'mad', 'furious'],
  '😱': ['shock', 'scream', 'surprised'],
  '😴': ['sleep', 'tired', 'bored'],
  '🙄': ['eyeroll', 'roll', 'eyes', 'annoyed'],
  '😬': ['grimace', 'awkward', 'yikes'],
  '📌': ['pin', 'pinned', 'important', 'stick'],
  '📅': ['calendar', 'date', 'deadline', 'schedule'],
  '📆': ['calendar', 'date', 'schedule'],
  '⏰': ['alarm', 'clock', 'time', 'deadline', 'reminder'],
  '⏳': ['hourglass', 'waiting', 'time', 'pending'],
  '📈': ['chart', 'up', 'growth', 'increase', 'revenue'],
  '📉': ['chart', 'down', 'decrease', 'loss'],
  '📊': ['chart', 'bar', 'report', 'data', 'analytics'],
  '📄': ['document', 'file', 'page', 'paper'],
  '📝': ['note', 'write', 'memo', 'draft'],
  '📋': ['clipboard', 'list', 'tasks'],
  '🧾': ['receipt', 'invoice', 'bill', 'gst'],
  '💰': ['money', 'cash', 'payment', 'rupees'],
  '💵': ['money', 'cash', 'note'],
  '💳': ['card', 'payment', 'credit'],
  '🏦': ['bank', 'account'],
  '⚖️': ['law', 'legal', 'balance', 'justice', 'compliance'],
  '🔍': ['search', 'find', 'look', 'audit'],
  '🔒': ['lock', 'locked', 'private', 'secure'],
  '🔓': ['unlock', 'open', 'public'],
  '💼': ['work', 'business', 'briefcase', 'client'],
  '📞': ['phone', 'call', 'ring'],
  '📧': ['email', 'mail', 'message'],
  '💻': ['laptop', 'computer', 'work'],
  '🚀': ['rocket', 'launch', 'ship', 'fast'],
  '☕': ['coffee', 'tea', 'break'],
  '🎁': ['gift', 'present', 'bonus'],
  '♻️': ['recycle', 'repeat', 'again', 'retry'],
  '🔔': ['bell', 'notify', 'reminder', 'alert'],
  '🔕': ['mute', 'silent', 'muted'],
  '🌍': ['world', 'globe', 'earth', 'global'],
};

/**
 * Glyphs matching `query`, in catalogue order.
 *
 * Empty or one-character queries return `[]` rather than everything. A picker
 * that dumps 190 glyphs the moment somebody touches the search field has thrown
 * away the categories they were about to scroll — the caller renders the
 * categories when this is empty, so "no query" and "no match" have to be
 * distinguishable, and they are: `hasQuery` is the caller's own test on the
 * string, not this function's return.
 *
 * A term matches if any of a glyph's keywords STARTS WITH it. Prefix rather than
 * substring so "in" does not match "pending" and "thinking"; substring was the
 * first version and it made two-letter queries useless.
 */
export function searchEmoji(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return ALL_EMOJI.filter(glyph => {
    const words = EMOJI_KEYWORDS[glyph];
    return !!words && words.some(w => w.startsWith(q));
  });
}

/**
 * MMKV key for the per-person recents.
 *
 * "Frequently-used is per person, stored locally — no schema, no request"
 * (proposal 09). It is per DEVICE rather than per account, which is the honest
 * description: `lib/storage` is one MMKV instance for the app and is not cleared
 * on logout, so a shared phone shares its recents. That is a privacy question
 * about which emoji somebody reacts with, which is not a question worth a schema
 * — but it is not nothing, and it is written down here rather than implied.
 */
const RECENT_KEY = 'sanvaad_recent_emoji';

/** How many recents are kept. One row of eight, which is what the grid draws. */
export const RECENT_LIMIT = 8;

/**
 * The recents, newest first.
 *
 * Everything is validated on the way OUT rather than trusted, because MMKV
 * survives an app upgrade: a build that stored something else under this key, or
 * a partially-written value, must degrade to an empty row and not to a crash on
 * the first render of the picker.
 */
export function recentEmoji(): string[] {
  const raw = storage.getString(RECENT_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Record a use, and return the new list.
 *
 * MOST-RECENTLY-USED, NOT MOST-FREQUENTLY-USED, though the design calls the row
 * "frequently used". A frequency count needs a decay or it ossifies — the emoji
 * somebody used forty times last quarter outranks the one they have used every
 * day this week, forever — and a decay needs a timestamp per glyph and a policy
 * nobody has decided. Recency gets the same row right for the same reason it
 * gets it right in every keyboard.
 *
 * Returned rather than only stored so the caller can set state from it without a
 * second read; MMKV is synchronous, so this is a convenience and not a race fix.
 */
export function noteEmojiUsed(glyph: string): string[] {
  if (!glyph) return recentEmoji();
  const next = [glyph, ...recentEmoji().filter(g => g !== glyph)].slice(0, RECENT_LIMIT);
  storage.set(RECENT_KEY, JSON.stringify(next));
  return next;
}
