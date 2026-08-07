import React, { useMemo } from 'react';
import '../../styles/components.css';

/**
 * Lotus — the product's ornament, and the figure the loader is built on.
 *
 * ── Where it came from ──────────────────────────────────────────────────────
 *
 * A long search that went through padma, yantra, kolam, jali, patola, ajrakh,
 * charbagh and the Jantar Mantar instruments before landing on a Lottie
 * reference the owner picked out — IconScout's Meditation Mandala 8972474.
 *
 * Three rules came out of that reference and they are the whole style:
 *
 *   ONE PEN.     Every stroke is the same width. Weight hierarchy is standard
 *                ornament advice and it is wrong here — uniform weight is what
 *                makes a drawing read as drawn rather than as designed.
 *   ONE COLOUR.  Full strength, no opacity ramp. Fading outer courses greys
 *                the figure and kills the crispness.
 *   IT DRAWS.    Every stroke trims itself on, holds, then trims off. In Lottie
 *                that is a trim path; in CSS it is stroke-dashoffset. Same
 *                mechanism, so this is the motion itself, not an impression.
 *
 * ── Why there are no rays ───────────────────────────────────────────────────
 *
 * The source has long curved rays sweeping out of the centre, and they were
 * built and then removed. A ray sweeping 18 degrees crosses its neighbouring
 * petal's edge on the way out, so the two courses collide however they are
 * phased — putting the rays in the gaps only moved where it happened. The
 * petals are the flower.
 *
 * Nothing replaced them at the rim and nothing is needed: twenty petals at
 * 76-120 sit 7.8 units apart on a 30.8-unit spacing, so they are a quarter open
 * and their tips read as a scalloped boundary. An ornament that stops on a hard
 * circle looks cut off; one that stops on petal tips looks finished.
 *
 * ── The eye is sized for the letter ─────────────────────────────────────────
 *
 * r32, not the r11 it started at. क is the mark on the launcher icon and it was
 * reading as a caption inside its own ornament. The letter is sized first and
 * the drawing makes room, rather than the other way round.
 *
 * ── Never announced ─────────────────────────────────────────────────────────
 *
 * `aria-hidden` always. It carries no information. BrandLoader supplies the
 * live-region text that a screen reader actually needs.
 */

/**
 * A rounded petal. `w` is the half-width at its widest.
 *
 * EXPORTED, not because the loader needs it to be, but because `kamal.js` draws
 * the conversation ground from the SAME rosette and `28-messaging-v2.md` §6 is
 * explicit that it must not be redrawn: "`lotusLobe()` gives the path verbatim;
 * do not redraw it." A second copy of these two cubics would drift the first
 * time either is retuned, and the whole point of the ground is that it shares a
 * hand with the mark.
 */
export function lobe(r0, r1, w) {
  const s = r1 - r0;
  const f = n => n.toFixed(2);
  return `M0,${f(-r0)}`
    + `C${f(w)},${f(-r0 - s * 0.30)} ${f(w)},${f(-r1 + s * 0.26)} 0,${f(-r1)}`
    + `C${f(-w)},${f(-r1 + s * 0.26)} ${f(-w)},${f(-r0 - s * 0.30)} 0,${f(-r0)}Z`;
}

/**
 * The courses, as data.
 *
 * Each entry is [count, r0, r1, halfWidth, rotationOffset]. Kept as numbers so
 * a course retunes by editing one, rather than by rewriting path data.
 */
export const COURSES = [
  [10, 34, 70, 12, 0],      // the rosette
  [10, 35, 56, 7, 18],      // smaller lobes nesting in its gaps
  [20, 76, 120, 11.5, 0],   // the outer petals
  [20, 82, 96, 4.2, 0],     // a bead in each throat
];

/**
 * The eye — the ring the letter क sits inside, and the innermost stroke of the
 * figure. r32, not the r11 it started at; see the docblock above. Named because
 * `kamal.js` needs the same number, and a `32` typed twice is a number that
 * only stays equal by luck.
 */
export const EYE_R = 32;

/** Approximate path length, for the trim. Close enough to pace the draw. */
const lobeLen = (r0, r1, w) => 2 * Math.hypot(r1 - r0, w) * 1.06;

/**
 * `still` — the same figure, held at full and never animating.
 *
 * The owner's instruction, 2026-08-07: make the loader's fully-loaded lotus the
 * logo, and leave the loader animating as it is. So this is one component with
 * two states rather than two drawings — `KLogo` renders `still`, `BrandLoader`
 * does not, and `lobe()` / `COURSES` / `EYE_R` are shared by both exactly as
 * `kamal.js` already shares them.
 *
 * `courses` caps how many of the four are drawn. The full figure is sixty
 * petals and four rings in a 260 viewbox; at a 16px favicon that is a smudge,
 * so the mark drops the outer courses rather than shrinking an unreadable one.
 * It is the same drawing with fewer courses, which the "one pen" rule supports
 * — every course is the same stroke, so a subset still reads as the whole.
 *
 * `pen` scales the stroke. 1.6 in a 260 viewbox rendered at 28px is a fifth of
 * a pixel and disappears; the mark asks for a wider pen at small sizes.
 */
export default function Lotus({ size = 168, className = '', style, still = false, courses, pen }) {
  const parts = useMemo(() => {
    const out = [];
    let step = 0;
    // Rings first, so the eye and the collar draw before what hangs off them.
    out.push({ kind: 'ring', r: EYE_R, len: 2 * Math.PI * EYE_R, d: 0 });
    const drawn = typeof courses === 'number' ? COURSES.slice(0, courses) : COURSES;
    drawn.forEach(([n, r0, r1, w, off], ci) => {
      if (ci === 2) {
        out.push({ kind: 'ring', r: 74, len: 2 * Math.PI * 74, d: (step += 2) * 0.035 });
      }
      const d = lobe(r0, r1, w);
      const len = lobeLen(r0, r1, w);
      for (let i = 0; i < n; i++) {
        out.push({ kind: 'petal', d, len, rot: off + (360 / n) * i, delay: (step++) * 0.035 });
      }
    });
    return out;
  }, [courses]);

  return (
    <svg
      className={`lotus${still ? ' lotus--still' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 260 260"
      style={pen ? { ...style, '--pen': pen } : style}
      aria-hidden="true"
      focusable="false"
    >
      {/* The slow counter-turn under the draw, so the figure is never wholly
          still even while it holds at full. */}
      <g className="lotus__turn" transform="translate(130,130)">
        {parts.map((p, i) => (p.kind === 'ring' ? (
          <circle
            key={i}
            className="lotus__s"
            r={p.r}
            fill="none"
            /* Each stroke carries its OWN length. A large petal and a throat
               bead differ by three times; one shared dasharray would draw them
               at different rates and the figure would assemble raggedly. */
            style={{ '--len': Math.round(p.len), '--d': `${(p.d || 0).toFixed(2)}s` }}
          />
        ) : (
          <path
            key={i}
            className="lotus__s"
            d={p.d}
            fill="none"
            transform={`rotate(${p.rot.toFixed(2)})`}
            style={{ '--len': Math.round(p.len), '--d': `${p.delay.toFixed(2)}s` }}
          />
        )))}
      </g>
    </svg>
  );
}
