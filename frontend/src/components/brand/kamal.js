/**
 * kamal.js — the sixth conversation ground, drawn from the lotus.
 *
 * `28-messaging-v2.md` §6, "`kamal` — to be added, and the only thing on these
 * two surfaces that is". The other five patterns (jaali, patola, star, lines,
 * none) ship as drawn in `design-reference/Kartavaya Redesign/tokens.css` and
 * are transcribed byte-for-byte into `styles/kartavaya-design.css` § 10. This
 * one is an addition, so it is generated here rather than transcribed, and the
 * generator IS the source: `styles/sanvaad.css` carries the output of
 * `kamalTile()` and `src/__tests__/sanvaadV2Layer.test.jsx` regenerates it and
 * asserts the stylesheet still matches. Edit one without the other and the
 * suite goes red, which is the only way a baked data URI stays honest.
 *
 * ── What is drawn, and what is deliberately left out ────────────────────────
 *
 * THE ROSETTE COURSE ONLY. `COURSES[0]` — ten lobes at r34–r70, half-width 12 —
 * plus the `EYE_R` ring. Both come from `Lotus.jsx` by import; §6 says
 * "`lotusLobe()` gives the path verbatim; do not redraw it", and nothing here
 * redraws it. The outer twenty-petal course (r76–r120) is what makes the loader
 * read as a MARK, and a mark that repeats is a watermark rather than a ground.
 * It is left out on purpose.
 *
 * ONE PEN, ONE COLOUR. `stroke-width` is 1 on the wrapping `<g>` and nothing
 * inside overrides it; the ring and every lobe inherit the same stroke and the
 * same `stroke-opacity`. No opacity ramp inside the figure — the whole tile
 * sits at the ~10% the other five use, and the fade happens at the tile level.
 *
 * IT MUST NOT GRID UP. A ten-fold figure on a square lattice reads as a logo
 * laid out on a page. Two things stop that:
 *   · the rosettes are rotated off-axis, and the corner and centre rosettes are
 *     rotated by DIFFERENT amounts (`CORNER_ROT` / `CENTRE_ROT`), so a reader
 *     cannot lock onto a repeating orientation;
 *   · alternate rows are offset by half a tile. That is what the corner-plus-
 *     centre arrangement IS: the four corner quarters are one lattice point and
 *     the centre is another, half a tile away on both axes.
 * Neither rotation is a multiple of 36° (the lobe spacing) and neither puts a
 * lobe on 0/90/180/270, so no rosette has an axis-aligned petal.
 *
 * ── Why FOUR tiles and not two ──────────────────────────────────────────────
 *
 * §6 asks for "two tiles, light and dark" at "44px 44px small, 96px 96px at
 * --conv-motif-lg". Those two sentences cannot both hold with one drawing: a
 * 44-unit tile painted at 96px scales its 1px stroke to 2.18px, and every other
 * motif in the ramp renders a 1px line at every size — `--motif-lg` is itself a
 * SEPARATE 96-unit drawing for exactly this reason, not `--motif-jaali` scaled
 * up. A 2.18px line at 8% is no longer texture, which is §6's own first hard
 * rule. So the tile is authored twice, at 44 and at 96, each with a 1px pen —
 * two tiles per theme, four in all. The figure, its proportions and its two
 * rotations are identical; only the unit size and the ink opacity differ.
 *
 * ── Why the colour is baked ─────────────────────────────────────────────────
 *
 * A data URI cannot read a custom property. That is the same fact that makes
 * the tint axis move the GROUND rather than the line, and it is why there is
 * one tile per theme rather than one tile and a token.
 */
import { lobe, COURSES, EYE_R } from './Lotus';

/** The rosette: ten lobes, r34–r70, half-width 12. `COURSES[0]`, unmodified. */
const [LOBE_N, LOBE_R0, LOBE_R1, LOBE_W] = COURSES[0];

/**
 * The rosette's outer radius as a fraction of the tile.
 *
 * 14/44. Measured, not chosen by eye: the centre rosette sits at (22,22) and
 * the corner rosettes at (0,0), so their centres are 31.11 units apart. Two
 * radii of 14 sum to 28 and leave 3.11 units of daylight; at 15.5 they touch,
 * and a ground whose figures collide reads as a texture error rather than as a
 * texture.
 */
const REACH = 14 / 44;

/** Off-axis, and different from each other. See the docblock. */
const CORNER_ROT = 13;
const CENTRE_ROT = 31;

/** SVG numbers at two decimals, matching `lobe()`'s own `toFixed(2)`. */
const f = (n) => Number(n.toFixed(2)).toString();

/**
 * Minimal URL encoding for an SVG data URI in CSS, matching the five tiles
 * already in `kartavaya-design.css` § 10 exactly: `<`, `>` and `#` escaped,
 * attributes single-quoted, everything else left literal. Encoding more is
 * valid and unreadable; encoding less breaks the `url()`.
 */
const enc = (svg) => svg.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23');

/**
 * One tile, as a CSS `url("data:…")` value.
 *
 * @param {object} o
 * @param {number} o.px    tile size in user units — 44 or 96.
 * @param {string} o.ink   stroke colour, `#rrggbb`. Baked; see the docblock.
 * @param {number|string} o.opacity  stroke-opacity for the whole figure.
 */
export function kamalTile({ px, ink, opacity }) {
  // Scale the rosette so its outer radius is REACH of the tile. `lobe()` is
  // called with the SCALED radii rather than being drawn at r70 and shrunk by
  // a transform, because a transform would scale the stroke with it and the pen
  // would stop being one pen.
  const k = (px * REACH) / LOBE_R1;
  const d = lobe(LOBE_R0 * k, LOBE_R1 * k, LOBE_W * k);
  const eye = f(EYE_R * k);
  const half = f(px / 2);
  const full = f(px);

  // The lobe is defined once and used ten times; the rosette is defined once
  // and used five times. Written out longhand this tile is ~7 kB of custom
  // property, which is a real cost on a token the browser resolves on every
  // repaint of the log.
  const uses = Array.from({ length: LOBE_N }, (_, i) => {
    const a = (360 / LOBE_N) * i;
    return i === 0 ? "<use href='#kl'/>" : `<use href='#kl' transform='rotate(${f(a)})'/>`;
  }).join('');

  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${full}' height='${full}'>` +
    `<defs><path id='kl' d='${d}'/>` +
    `<g id='kr'><circle r='${eye}'/>${uses}</g></defs>` +
    `<g fill='none' stroke='${ink}' stroke-opacity='${opacity}' stroke-width='1'>` +
    // The four corner quarters are ONE lattice point wearing one rotation; they
    // have to agree or the tile does not meet itself at the seam.
    `<use href='#kr' transform='rotate(${CORNER_ROT})'/>` +
    `<use href='#kr' transform='translate(${full},0) rotate(${CORNER_ROT})'/>` +
    `<use href='#kr' transform='translate(0,${full}) rotate(${CORNER_ROT})'/>` +
    `<use href='#kr' transform='translate(${full},${full}) rotate(${CORNER_ROT})'/>` +
    // The half-drop.
    `<use href='#kr' transform='translate(${half},${half}) rotate(${CENTRE_ROT})'/>` +
    `</g></svg>`;

  return `url("data:image/svg+xml,${enc(svg)}")`;
}

/**
 * The four shipped tiles, keyed exactly as the custom properties that carry
 * them. The inks are the two already in the ramp — warm `#8C7F63` in light,
 * cool `#9FB0C4` in dark — so kamal sits in the same family as the other five
 * rather than introducing a sixth stroke colour.
 *
 * THE OPACITIES ARE CALIBRATED, NOT CHOSEN. §6's rule is that the motif is
 * texture and never pattern, "held at ~10% stroke so it cannot compete with a
 * message" — but stroke-opacity is not what a reader sees. What they see is ink
 * per unit area, and this figure lays down eleven strokes where jaali lays down
 * three, with overlaps that compound alpha on top of that.
 *
 * So the tiles were rasterised in Chrome and weighed: mean alpha per pixel over
 * the whole tile, as a percentage of solid. The five shipped patterns span a
 * measured band —
 *
 *            light   dark        light   dark
 *   star      0.64   0.50        jaali    1.31   1.06
 *   motif-lg  0.65   0.47        patola   1.82   1.38
 *   lines     1.20   0.91
 *
 * — and at jaali's own stroke value kamal weighed 2.31 light / 1.82 dark, well
 * outside it and heavier than the densest thing that ships. These four numbers
 * put the small tile between jaali and patola and the large tile alongside
 * `--motif-lg`, which is the slot each one occupies. Re-measure before changing
 * them; the figure's density is not something the number tells you.
 */
export const KAMAL_TILES = {
  light: {
    '--motif-kamal': kamalTile({ px: 44, ink: '#8C7F63', opacity: '.07' }),
    '--motif-kamal-lg': kamalTile({ px: 96, ink: '#8C7F63', opacity: '.065' }),
  },
  dark: {
    '--motif-kamal': kamalTile({ px: 44, ink: '#9FB0C4', opacity: '.055' }),
    '--motif-kamal-lg': kamalTile({ px: 96, ink: '#9FB0C4', opacity: '.048' }),
  },
};

export default KAMAL_TILES;
