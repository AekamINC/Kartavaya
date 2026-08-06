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
 * A SIXTH PATTERN, `kamal`, IS NOT HERE ON PURPOSE. 28 §6's prose lists six
 * values; `design-reference/Kartavaya Redesign/tokens.css` declares five, and
 * the stylesheet is the specification. 28 is explicit that kamal is "to be
 * added" and is not the default. It needs two hand-drawn tiles (44px and 96px,
 * warm and cool) before the name can mean anything, and a pattern option that
 * paints nothing is worse than an option that is absent.
 */

/** The five tiles. `size` mirrors the background-size the CSS variant sets, so
 *  a preview can paint the real tile at the real scale from one source. */
export const CONV_PATTERNS = [
  { id: 'none',   label: 'None',   size: null,       motif: null },
  { id: 'jaali',  label: 'Jaali',  size: '44px 44px', motif: 'var(--motif-jaali)' },
  { id: 'patola', label: 'Patola', size: '40px 40px', motif: 'var(--motif-patola)' },
  { id: 'star',   label: 'Star',   size: '60px 60px', motif: 'var(--motif-star)' },
  { id: 'lines',  label: 'Lines',  size: '16px 16px', motif: 'var(--motif-lines)' },
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

export function normalizeConvPattern(value) {
  return PATTERN_IDS.has(value) ? value : DEFAULT_CONV_PATTERN;
}

export function normalizeConvGround(value) {
  return GROUND_IDS.has(value) ? value : DEFAULT_CONV_GROUND;
}
