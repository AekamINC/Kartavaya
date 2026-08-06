/**
 * convGround.js — the two conversation-ground axes, as data rather than as
 * strings scattered across a panel, a preview and two consuming surfaces.
 *
 * 28-messaging-v2.md §6 and 29-sahayak.md §5. Sanvaad and Sahayak are the two
 * places in the product where you talk rather than work, and they are the two
 * that get a ground of their own. The CSS lives in
 * `styles/kartavaya-design.css` § 10; this file owns only the value sets and
 * the normalisers.
 *
 * WHY NORMALISERS AND NOT A BARE `prefs.convPattern || 'jaali'`:
 * `setPrefs` persists the whole prefs object, so a value written by an older
 * build survives forever. A stored value that matches no rule does not fall
 * back to the default — it writes `data-conv-pattern="kamal"` on <html>, no
 * attribute selector matches, and --conv-motif holds whatever the :root default
 * left there. That is the exact shape of the `data-language="hi"` bug
 * CustomizePanel documents: an attribute that matches no stylesheet rule reads
 * as a missing feature, not as a bad value. Everything unknown resolves to the
 * shipped default here, at one point.
 *
 * `kamal` WAS HELD BACK, AND THE REASON HAS SINCE BEEN MET. The guard removed
 * here read: 28 §6's prose lists six values, `design-reference/Kartavaya
 * Redesign/tokens.css` declares five, and "it needs two hand-drawn tiles (44px
 * and 96px, warm and cool) before the name can mean anything". That condition
 * was the whole of the objection and it is no longer true — the tiles exist,
 * four of them rather than two, and they are not hand-drawn but GENERATED:
 *
 *   · `components/brand/kamal.js` draws them from `Lotus.jsx`'s own `lobe()`
 *     and `COURSES[0]`, at 44 and at 96, warm `#8C7F63` and cool `#9FB0C4`;
 *   · `styles/sanvaad.css` § V2.1 carries the four baked declarations plus the
 *     `[data-conv-pattern="kamal"]` variant rule and its `44px 44px`;
 *   · `src/__tests__/sanvaadV2Layer.test.jsx` regenerates them and asserts the
 *     stylesheet still matches byte for byte.
 *
 * So the option no longer "paints nothing", which was the only thing that made
 * absence better than presence. Leaving the guard in place after its condition
 * is met is how a shipped feature stays invisible: a stylesheet rule that
 * nothing can ever select is dead code that reads as a bug in the CSS.
 *
 * `jaali` remains the default — sanvaad.css § V2.1 says so in as many words.
 * kamal is the one a person CHOOSES, not the one they are given.
 */

/** The six tiles. `size` mirrors the background-size the CSS variant sets, so
 *  a preview can paint the real tile at the real scale from one source.
 *
 *  `mandala` was called `star` until 2026-08-06; see LEGACY_PATTERN_IDS. */
export const CONV_PATTERNS = [
  { id: 'none',    label: 'None',    size: null,        motif: null },
  { id: 'jaali',   label: 'Jaali',   size: '44px 44px', motif: 'var(--motif-jaali)' },
  { id: 'patola',  label: 'Patola',  size: '40px 40px', motif: 'var(--motif-patola)' },
  // The `var(--motif-star)` fallback that stood here is gone: the declaration in
  // `styles/kartavaya-design.css` is now `--motif-mandala` in both theme blocks
  // and the variant rule is keyed `[data-conv-pattern="mandala"]`, so the
  // fallback could never be taken and a fallback that is never taken is a lie
  // about the token's name. `check-tokens` was failing the whole gate on it.
  { id: 'mandala', label: 'Mandala', size: '60px 60px', motif: 'var(--motif-mandala)' },
  { id: 'lines',   label: 'Lines',   size: '16px 16px', motif: 'var(--motif-lines)' },
  { id: 'kamal',   label: 'Kamal',   size: '44px 44px', motif: 'var(--motif-kamal)' },
];

/** The four tints. `ground` is the token the CSS variant resolves to; `accent`
 *  is a color-mix in CSS and is left to the stylesheet rather than restated. */
export const CONV_GROUNDS = [
  { id: 'warm',   label: 'Warm'   },
  { id: 'paper',  label: 'Paper'  },
  { id: 'deep',   label: 'Deep'   },
  { id: 'accent', label: 'Accent' },
];

/** What a user who never opens the setting gets — the prototype's own default. */
export const DEFAULT_CONV_PATTERN = 'jaali';
export const DEFAULT_CONV_GROUND = 'warm';

const PATTERN_IDS = new Set(CONV_PATTERNS.map((p) => p.id));
const GROUND_IDS = new Set(CONV_GROUNDS.map((g) => g.id));

/**
 * Renamed ids, old → new. `star` became `mandala` on 2026-08-06.
 *
 * THIS TABLE IS NOT OPTIONAL AND IT IS NOT TIDINESS. `setPrefs` persists the
 * whole prefs object, so every person who ever chose Star has `convPattern:
 * 'star'` in their storage and will have it forever. Without an entry here that
 * value stops matching PATTERN_IDS, falls through the normaliser and silently
 * becomes `jaali` — the user's chosen ground quietly replaced by the default,
 * with nothing on screen to say a rename happened. That is the same class of
 * failure the docblock above already documents for unknown values, arriving by
 * a different road: a rename is a value going unknown on purpose.
 *
 * An entry may be removed only once the stored value cannot plausibly exist,
 * which for a browser-persisted preference is effectively never.
 */
export const LEGACY_PATTERN_IDS = Object.freeze({ star: 'mandala' });

export function normalizeConvPattern(value) {
  const renamed = Object.prototype.hasOwnProperty.call(LEGACY_PATTERN_IDS, value)
    ? LEGACY_PATTERN_IDS[value]
    : value;
  return PATTERN_IDS.has(renamed) ? renamed : DEFAULT_CONV_PATTERN;
}

export function normalizeConvGround(value) {
  return GROUND_IDS.has(value) ? value : DEFAULT_CONV_GROUND;
}
