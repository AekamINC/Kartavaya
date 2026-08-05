/**
 * channelTone.js — which of the eight tones a channel wears, and what to do
 * when the server has not told us.
 *
 * `docs/proposals/09-sanvaad-design-system.html` §3: eight tones, assigned at
 * creation and STORED, "so it never changes — and because it is stored, it can
 * also be edited, which a hash could never allow". Migration 100 adds the
 * column, `routers/messaging.CHANNEL_TONES` assigns from it, and this file is
 * the client's half.
 *
 * THREE THINGS THIS FILE IS DELIBERATELY NOT.
 *
 *  · IT IS NOT A SECOND COLOUR SET. The stored value is a MODULE TONE KEY —
 *    'graha', 'ganit', 'manav' … — and `lib/moduleColors.moduleColor()` already
 *    maps every one of those to `var(--m-<key>)`, declared twice in
 *    `styles/module.css` (light and dark). Proposal 09 declares its palette as
 *    `--sv-ch-1 … 8` with literal hexes and those eight hexes are byte for byte
 *    the first eight `--m-*` values, so naming them by module id is the same
 *    palette under a name that already exists in both themes. A hex stored in
 *    the database could only ever be right in one theme; the two ramps are
 *    opposite temperatures, not one a tint of the other.
 *  · IT IS NOT THE ASSIGNER. The server picks the tone at creation
 *    (`pick_channel_tone` takes the least-used tone rather than a modulo, so
 *    deleting the fifth of six channels cannot reissue a colour that is still on
 *    the rail). Nothing here writes.
 *  · IT IS NOT A FALLBACK COLOUR SCHEME THAT COMPETES WITH THE STORED ONE. See
 *    below — the derived answer exists so a channel with no colour RENDERS, and
 *    it is thrown away the moment the column arrives.
 *
 * WHY THERE IS A FALLBACK AT ALL, since a stored column is the whole point.
 *
 * Migration 100 is applied BY HAND against a database staging and production
 * share, and the deploy is a separate act — the migration's own header spells
 * out that both orders happen. Until it is applied, `_channel_row` fills `color`
 * in as `null` on every channel it hands back, deliberately, because a key that
 * is ABSENT renders `undefined` in a client that spreads the row. So `null` is
 * the value this client will see for some window of unknown length, on every
 * channel at once, and a rail that renders every tile in the same grey for that
 * window is the feature not existing yet.
 *
 * DERIVED FROM THE CHANNEL ID, NOT RANDOM AND NOT POSITIONAL. The requirement
 * the owner stated is "it gets assigned a different random and it STAYS, no
 * changes everytime" — so the fallback has to be stable across renders, across
 * reloads, across the poll reordering the rail, and across two people looking at
 * the same channel. A hash of the id is all three for free; `Math.random()` and
 * an index into the rendered list are none of them.
 *
 * NULL IS A REAL ANSWER AND IS NOT REPLACED. Every DM has no tone — the rail
 * renders a DM as the other person, not as a `#` tile, so there is nothing to
 * colour, and migration 100's backfill skips `type = 'dm'` for the same reason.
 * `channelTone` returns null there rather than hashing, because a DM given a
 * tone would spend the rotation on tiles nobody can see.
 */
import { moduleColor } from '../../lib/moduleColors';

/**
 * The eight, in the order migration 100's backfill and
 * `routers/messaging.CHANNEL_TONES` both use.
 *
 * This is a FOURTH copy of one vocabulary — the migration's CHECK, the
 * migration's backfill array, the router's tuple, and this. The first three are
 * held together by `backend/tests/test_channel_colour.py`, which reads all of
 * them and fails if any moves alone; `sanvaadChannelTone.test.js` is this one's
 * half of that, and it asserts against the same eight names.
 *
 * It is written out rather than derived from `MODULES` in `lib/moduleColors`,
 * even though every key is a module id and the order matches that file's first
 * eight. Deriving it would make the rail's palette a consequence of the order
 * somebody happened to list the modules in — add a sixteenth module at the top
 * of that object and every existing channel silently changes colour.
 */
export const CHANNEL_TONES = Object.freeze([
  'graha', 'ganit', 'manav', 'vikray',
  'vetana', 'dristi', 'prachar', 'sanvaad',
]);

const TONE_SET = new Set(CHANNEL_TONES);

/**
 * FNV-1a, 32-bit, over the id's UTF-16 code units.
 *
 * Chosen over `id.length % 8` or a sum of char codes because a channel id is a
 * UUID: every one is 36 characters, so length carries nothing, and a plain sum
 * over hex digits clusters hard. FNV avalanches, which is the only property
 * needed here — this is a bucket chooser, not a checksum, and nothing about it
 * has to be secure or portable.
 *
 * `>>> 0` after each round keeps the value an unsigned 32-bit integer.
 * JavaScript's `*` on two 32-bit values goes through a double and loses the low
 * bits above 2^53, so the multiply is done as two 16-bit halves — the standard
 * form, and the reason this is not the obvious one-liner.
 */
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * The tone key for a channel row, or null when it should have none.
 *
 * Order of preference:
 *   1. `ch.color`, when it is one of the eight. An UNRECOGNISED value is
 *      discarded rather than passed through: `var(--m-nonsense)` with no
 *      fallback resolves to nothing and the tile draws in whatever colour it
 *      inherits, which is usually the ground — an invisible channel that still
 *      occupies a row, with no console warning and no way to tell it apart from
 *      one whose colour was never set. Migration 100's CHECK is supposed to make
 *      this unreachable; this is the second lock, because a client that trusts
 *      the wire is one deploy away from a blank rail.
 *   2. A hash of the id, for the window before 100 is applied.
 *   3. Null, for a DM and for a row with no id at all.
 *
 * `failureStates.test.jsx` mounts `ChannelList` with `channels={[]}`, and
 * proposal 09 names the same requirement from the other side: "colour lookup
 * must tolerate a missing id rather than throw". Everything below is guarded for
 * `null`, `undefined` and a row that is not an object.
 */
export function channelTone(ch) {
  if (!ch || typeof ch !== 'object') return null;
  // A DM has no tile. See the header.
  if (ch.type === 'dm') return null;

  const stored = typeof ch.color === 'string' ? ch.color.trim() : '';
  if (TONE_SET.has(stored)) return stored;

  const id = ch.id == null ? '' : String(ch.id);
  if (!id) return null;
  return CHANNEL_TONES[hash32(id) % CHANNEL_TONES.length];
}

/**
 * The CSS value for a tone key — `var(--m-graha)` and the other seven.
 *
 * Straight through `moduleColor`, which is the product's existing one-source map
 * from module id to accent and already returns `var(--primary)` for anything it
 * does not know. Returns null for a null key so the caller can omit the inline
 * property entirely rather than setting `--ch-c` to the string "null", which
 * would make the tile draw in the accent of whatever the user has chosen.
 */
export function toneVar(key) {
  return key ? moduleColor(key) : null;
}

/**
 * `style` for a channel row, or `undefined`.
 *
 * `undefined` rather than `{}`: React skips the attribute entirely, so a DM row
 * carries no inline style at all and `.ch`'s own `--ch-c` default (the muted
 * glyph colour every channel row had before this feature) applies untouched.
 */
export function toneStyle(ch) {
  const v = toneVar(channelTone(ch));
  return v ? { '--ch-c': v } : undefined;
}
