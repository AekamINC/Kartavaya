/**
 * The reaction picker's catalogue, search and recents.
 *
 * These are real tests, not source-contract reads: `components/emoji.ts` is a
 * `.ts` module with no JSX, which is exactly why the data and the two functions
 * live there rather than inside `ChatScreen.tsx`. The PANEL that renders them is
 * a local sub-component of a `.tsx` file and is unreachable here — see
 * `test/source.ts` for why nothing in this repo can render a screen.
 *
 * The recents run against the in-memory MMKV stub, so `lib/storage`'s real JSON
 * round-trip is exercised — including the `try/catch` that has to survive a
 * value written by an older build.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { storage } from '../../lib/storage.ts';
import {
  ALL_EMOJI, EMOJI_CATEGORIES, EMOJI_KEYWORDS, RECENT_LIMIT,
  noteEmojiUsed, recentEmoji, searchEmoji,
} from '../emoji.ts';

/** The key `emoji.ts` writes. Named here so a rename breaks a test loudly. */
const RECENT_KEY = 'sanvaad_recent_emoji';
const wipe = () => storage.delete(RECENT_KEY);

// ── The catalogue ─────────────────────────────────────────────────────────────

test('every category has a label, an icon and glyphs', () => {
  assert.ok(EMOJI_CATEGORIES.length >= 5, 'expected several categories');
  for (const c of EMOJI_CATEGORIES) {
    assert.ok(c.label.trim(), 'a category has no label');
    assert.ok(c.icon.trim(), `${c.label} has no icon`);
    assert.ok(c.glyphs.length >= 8, `${c.label} has only ${c.glyphs.length} glyphs`);
  }
});

test('no glyph is repeated inside a category', () => {
  // Across categories is fine and deliberate — 👍 belongs in Gestures and 🔥 in
  // Symbols even though both are reactions. Inside one, a repeat is a typo that
  // renders as two identical cells one row apart.
  for (const c of EMOJI_CATEGORIES) {
    assert.equal(
      new Set(c.glyphs).size, c.glyphs.length,
      `${c.label} repeats a glyph`,
    );
  }
});

test('ALL_EMOJI is deduplicated', () => {
  // The grid keys cells on the glyph. A duplicate is a React key collision, and
  // React's response to that is to drop one silently.
  assert.equal(new Set(ALL_EMOJI).size, ALL_EMOJI.length);
});

test('NO SKIN-TONE MODIFIERS — the server tallies by the exact string', () => {
  // 👍 and 👍🏽 are two different reactions to `samvada_message_reactions`, which
  // aggregates on the emoji column. Five colleagues agreeing with five different
  // default tones would show as five separate pills all reading "1", which
  // destroys the one thing a reaction count is for.
  const MODIFIERS = /[\u{1F3FB}-\u{1F3FF}]/u;
  for (const g of ALL_EMOJI) {
    assert.doesNotMatch(g, MODIFIERS, `"${g}" carries a skin-tone modifier`);
  }
});

test('every keyword entry names a glyph that is actually in the catalogue', () => {
  // A keyword pointing at a glyph the grid does not contain is a search result
  // the user cannot find any other way — and, worse, one they cannot check
  // against a category when they wonder where it came from.
  const known = new Set(ALL_EMOJI);
  for (const glyph of Object.keys(EMOJI_KEYWORDS)) {
    assert.ok(known.has(glyph), `EMOJI_KEYWORDS has "${glyph}", which is in no category`);
  }
});

test('keywords are lowercase — search lowercases the query, not the index', () => {
  for (const [glyph, words] of Object.entries(EMOJI_KEYWORDS)) {
    for (const w of words) {
      assert.equal(w, w.toLowerCase(), `"${glyph}" has the keyword "${w}"`);
      assert.ok(w.trim() === w && w.length > 0, `"${glyph}" has a padded or empty keyword`);
    }
  }
});

test('the five quick reactions are all searchable', () => {
  // They are the five the action sheet offers before the picker opens. Somebody
  // who has learned them and then opens the picker will type for them.
  for (const g of ['👍', '✅', '🙏', '👀', '🎉']) {
    assert.ok(EMOJI_KEYWORDS[g], `the quick reaction "${g}" has no keywords`);
  }
});

// ── Search ────────────────────────────────────────────────────────────────────

test('a query under two characters returns nothing at all', () => {
  // NOT "everything". A picker that dumps the whole catalogue the moment the
  // field is touched has thrown away the categories the user was about to
  // scroll. The caller distinguishes "no query" from "no match" on the string
  // itself, so this returning [] is unambiguous.
  assert.deepEqual(searchEmoji(''), []);
  assert.deepEqual(searchEmoji(' '), []);
  assert.deepEqual(searchEmoji('t'), []);
});

test('search matches a keyword PREFIX, not a substring', () => {
  // Substring was the first version and it made two-letter queries useless: "in"
  // matched "pending", "thinking" and "hundred". Prefix is predictable — it is
  // what the user is typing towards.
  assert.ok(searchEmoji('thank').includes('🙏'));
  assert.ok(searchEmoji('deadline').includes('⏰'));
  assert.ok(searchEmoji('chart').includes('📊'));

  // "ing" is a suffix of "thinking" and "pending" and a prefix of neither.
  assert.deepEqual(searchEmoji('ing'), []);
});

test('search is case- and whitespace-insensitive', () => {
  assert.deepEqual(searchEmoji('THANKS'), searchEmoji('thanks'));
  assert.deepEqual(searchEmoji('  thanks  '), searchEmoji('thanks'));
});

test('search returns catalogue order, and only real glyphs', () => {
  const hits = searchEmoji('ca');   // calendar, card, cash, cancel, cry…
  assert.ok(hits.length > 1, 'expected several hits for "ca"');
  const known = new Set(ALL_EMOJI);
  for (const g of hits) assert.ok(known.has(g), `"${g}" is not in the catalogue`);
  // Order is ALL_EMOJI's, which is category order. A search that reordered would
  // put a glyph in a different place each time the query grew by a letter.
  const positions = hits.map(g => ALL_EMOJI.indexOf(g));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('a query that matches nothing returns an empty array, not everything', () => {
  assert.deepEqual(searchEmoji('zzzzqqq'), []);
});

// ── Recents ───────────────────────────────────────────────────────────────────

test('recents start empty', () => {
  wipe();
  assert.deepEqual(recentEmoji(), []);
});

test('a use goes to the FRONT and is not duplicated', () => {
  wipe();
  noteEmojiUsed('👍');
  noteEmojiUsed('🎉');
  assert.deepEqual(recentEmoji(), ['🎉', '👍']);

  // Most-recently-used, not most-frequently-used. Re-using an older one moves it
  // rather than adding a second copy — a frequency count needs a decay policy
  // nobody has decided, and without one the emoji used forty times last quarter
  // outranks the one used every day this week, forever.
  noteEmojiUsed('👍');
  assert.deepEqual(recentEmoji(), ['👍', '🎉']);
});

test('recents are capped at one row', () => {
  wipe();
  const glyphs = ALL_EMOJI.slice(0, RECENT_LIMIT + 5);
  for (const g of glyphs) noteEmojiUsed(g);
  const got = recentEmoji();
  assert.equal(got.length, RECENT_LIMIT);
  // The newest survive, newest first — the oldest are what fall off.
  assert.deepEqual(got, glyphs.slice(-RECENT_LIMIT).reverse());
});

test('noteEmojiUsed returns the same list a fresh read would', () => {
  wipe();
  const returned = noteEmojiUsed('🔥');
  assert.deepEqual(returned, recentEmoji());
});

test('an empty glyph is ignored rather than stored', () => {
  wipe();
  noteEmojiUsed('👍');
  assert.deepEqual(noteEmojiUsed(''), ['👍']);
  assert.deepEqual(recentEmoji(), ['👍']);
});

test('a corrupted or foreign stored value degrades to an empty row', () => {
  // MMKV SURVIVES AN APP UPGRADE. A build that stored something else under this
  // key, or a half-written value, must not crash the first render of the picker
  // — which is a panel the user opened deliberately and is watching.
  for (const bad of ['not json', '{"a":1}', '"a string"', '42', 'null', '[]']) {
    storage.set(RECENT_KEY, bad);
    assert.deepEqual(recentEmoji(), [], `stored value ${bad} did not degrade cleanly`);
  }
});

test('a stored array with junk in it keeps only the strings', () => {
  storage.set(RECENT_KEY, JSON.stringify(['👍', null, 42, '', '🎉', { a: 1 }]));
  assert.deepEqual(recentEmoji(), ['👍', '🎉']);
});

test('an over-long stored array is trimmed on the way out, not only on write', () => {
  // A list written by a build with a bigger limit would otherwise render a
  // three-row "recent" block above the categories.
  storage.set(RECENT_KEY, JSON.stringify(ALL_EMOJI.slice(0, 40)));
  assert.equal(recentEmoji().length, RECENT_LIMIT);
});
