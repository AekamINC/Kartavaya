/**
 * channelTone.ts — what colour a channel is, and what to do before there is one.
 *
 * ── The column does not exist yet ───────────────────────────────────────────
 *
 * `samvada_channels.color` arrives in migration 100, WHICH IS NOT APPLIED. Until
 * somebody runs it by hand against the shared Supabase database, every channel
 * this app sees carries `color: null` — the server guarantees the KEY is present
 * and null rather than absent (`_channel_row` in `routers/messaging.py` does
 * `d.setdefault("color", None)`, and its comment says why: "a row missing a key
 * the client spreads into a badge renders `undefined`, not zero").
 *
 * So this module has to be correct in three states, not one:
 *
 *   1. THE COLUMN IS MISSING (today). `color` is null on every row. The rail
 *      must still be navigable by colour, so the tone is derived from the
 *      channel id — stable, spread over the same eight, and identical on every
 *      device without a round trip.
 *   2. THE COLUMN EXISTS AND HOLDS A TONE. The stored value wins outright. It
 *      has to: the owner's requirement was "if i create an new channel it gets
 *      assinged a different random and it stays, no changes everytime", and the
 *      third clause of that — editable later — is the entire reason there is a
 *      column rather than a hash. A hash is stable and UNCHANGEABLE.
 *   3. THE COLUMN EXISTS AND HOLDS SOMETHING ELSE. A tone retired from the
 *      vocabulary, a hex somebody wrote by hand, an empty string. Falls through
 *      to the derived tone rather than painting nothing.
 *
 * The transition between 1 and 2 is visible — a channel's colour changes the day
 * the migration runs — and that is accepted rather than worked around. The
 * alternative is holding the rail colourless until a hand-applied migration
 * lands, and the whole point of the colour is that it is a navigation aid.
 *
 * ── IT IS A TONE KEY, NEVER A HEX ───────────────────────────────────────────
 *
 * The column stores `'graha'`, `'ganit'`, … — the id of a module tone, not
 * `#2F6690`. Migration 100 argues this at length and it is the same argument
 * `MODULE_TONES` makes: the two ramps are opposite temperatures rather than one
 * being a tint of the other, so a stored hex can only ever be right in one
 * theme. #2F6690 is the LIGHT graha; on the indigo ground it is not a dim
 * colour, it is an invisible one. The key resolves per theme for free.
 *
 * ── A DM HAS NO TONE, and null there is the right answer ────────────────────
 *
 * `find_or_create_dm` inserts `name = ''` and the rail renders a DM as the other
 * person, not as a `#glyph` — there is no tile to colour. Migration 100 skips
 * DMs in its backfill for a second reason worth restating: assigning them tones
 * would spend the rotation on tiles nobody can see it on, so an org with nine
 * DMs would have every named channel colliding while eight tones sat invisible
 * in private conversations. The derived fallback below skips them for the same
 * reason — deriving one would put back exactly what the server took out.
 */

import { MODULE_TONES, type ColorScheme } from './tokens';
import { CHANNEL_TONES, type Channel, type ChannelTone } from '../api/messages';

/**
 * FNV-1a, 32-bit, over the id's UTF-16 code units.
 *
 * ── THIS IS THE WEB'S HASH, CHARACTER FOR CHARACTER, AND IT HAS TO BE ───────
 *
 * `frontend/src/pages/sanvaad/channelTone.js` derives the same fallback for the
 * same reason, and BOTH SURFACES SHOW THE SAME RAIL. Two different hashes would
 * mean #audit-fy2025-26 is amber on a laptop and violet on the phone for the
 * whole window between this shipping and migration 100 being applied by hand —
 * a window of unknown length, on every channel at once, which would destroy the
 * exact property the colour exists for. A colour you cannot carry between
 * screens is not an identity.
 *
 * So the implementation is copied rather than merely equivalent, including the
 * shift-based multiply: `h * 0x01000193` written as
 * `(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)`, because JavaScript's `*` on two 32-bit
 * values goes through a double and loses the low bits above 2^53. `>>> 0` after
 * each round keeps it an unsigned 32-bit integer, which is also what makes the
 * modulo below non-negative without a `Math.abs` — `%` in JavaScript keeps the
 * sign of its left operand, and a negative index yields `undefined`, i.e. a
 * channel with no colour and no error.
 *
 * ── NOT `projectColor`'s HASH, and the measurement that decided it ──────────
 *
 * The obvious move was to reuse `h * 31 + c` from `theme/tokens.ts`, which is
 * already this app's answer to "give me a stable colour for a uuid". It was, and
 * then it was measured against eight buckets rather than against ten and seven:
 * 31 ≡ -1 (mod 8), so `h * 31 + c` reduces mod 8 to an ALTERNATING SUM of
 * character codes, and the low three bits are all a power-of-two modulo can see.
 * Over real `gen_random_uuid()` ids it is fine — all eight buckets, within 5% of
 * even — but the margin is luck rather than design, and it evaporates for any
 * set of ids sharing a template.
 *
 * `projectColor` and `avatarColor` keep their hash. Their palettes are ten and
 * seven long, so the modulo mixes the whole word and the property above never
 * arises; changing them would also re-colour every project and every avatar in
 * the product for no benefit.
 *
 * ── ONLY THE LOW THREE BITS OF THIS EVER MATTER ─────────────────────────────
 *
 * Eight tones, so the caller takes `% 8`, and `<< 4`, `<< 7`, `<< 8` and `<< 24`
 * are all ≡ 0 (mod 8). Every high-order term in the multiply is therefore
 * invisible to the answer. Found by mutation: changing `<< 24` to `<< 23` — a
 * corruption of the FNV prime — left every derived tone identical, and the
 * cross-surface test in `__tests__/channelTone.test.ts` stayed green because
 * nothing had actually changed. The shifts are kept exactly as FNV specifies
 * regardless, because that is what makes this the SAME function as the web's,
 * and a ninth tone would put the modulo on a non-power of two and start reading
 * the rest of the word.
 *
 * The corollary is worth stating: this is not a distribution argument, it is a
 * measurement. Over 5,000 `gen_random_uuid()`-shaped ids the eight buckets come
 * out 576–673, which is even enough to navigate by. The web made the same
 * choice; matching it is what matters most.
 */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** A stable tone for a channel that has none stored. */
export function derivedChannelTone(channelId: string): ChannelTone {
  return CHANNEL_TONES[hash32(channelId) % CHANNEL_TONES.length];
}

/**
 * The tone key for a channel, or `null` when it must not have one.
 *
 * Takes the two fields rather than the whole `Channel` so a caller holding a
 * `PinnedMessage`, a search hit or a push payload can ask the same question —
 * and so this is reachable from a test, which cannot construct a `Channel`
 * without inventing eleven fields that have nothing to do with colour.
 */
export function channelToneKey(
  channelId: string,
  color: string | null | undefined,
  type: Channel['type'] | string | undefined,
): ChannelTone | null {
  if (type === 'dm') return null;
  // `as ChannelTone` only after the membership test — that test is what makes it
  // true, and it is also what makes a hex, an empty string and a retired tone
  // all fall through to the same safe branch rather than three different ones.
  if (typeof color === 'string' && (CHANNEL_TONES as readonly string[]).includes(color)) {
    return color as ChannelTone;
  }
  if (!channelId) return null;
  return derivedChannelTone(channelId);
}

/**
 * The tone key resolved to a colour for the current theme, or `null`.
 *
 * `MODULE_TONES[scheme]` is indexed rather than destructured so an unknown key
 * — which `channelToneKey` cannot produce, but a caller passing a raw string
 * could — reads as `undefined` and is normalised to null here. A `backgroundColor`
 * of `undefined` renders transparent in React Native, which is the invisible
 * channel migration 100 spends four paragraphs preventing.
 */
export function channelToneColor(
  scheme: ColorScheme,
  channelId: string,
  color: string | null | undefined,
  type: Channel['type'] | string | undefined,
): string | null {
  const key = channelToneKey(channelId, color, type);
  if (!key) return null;
  return MODULE_TONES[scheme][key] ?? null;
}
