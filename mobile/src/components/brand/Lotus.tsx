import React from 'react';
import Svg, { Circle, Path, G } from 'react-native-svg';

/**
 * Lotus — the product's ornament, held still as the logo.
 *
 * A PORT of `frontend/src/components/brand/Lotus.jsx`, not a second drawing.
 * `brandMark.test.ts` reads the web file and compares every number, because a
 * course that drifts by one unit is a different flower and nothing on either
 * platform would say so.
 *
 * The web docblock carries the reasoning and is not repeated here. Three rules
 * from it govern this file:
 *
 *   ONE PEN.     Every stroke the same width. Uniform weight is what makes a
 *                drawing read as drawn rather than as designed.
 *   ONE COLOUR.  Full strength, no opacity ramp.
 *   NEVER ANNOUNCED. It carries no information.
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
 *
 * The web's third rule is IT DRAWS — every stroke trims itself on via
 * `stroke-dashoffset`. Nothing here animates, and that is not an omission:
 * `KLogo` renders the web component with `still`, so the LOGO does not draw on
 * either platform. Mobile's animated loader is `components/Lotus.tsx`, a
 * separate and older thing built from border-radius Views, and it is untouched.
 *
 * Two files now called Lotus is a real cost. Renaming the loader would touch
 * Sahayak and Sanvaad, which are mid-conversion — see `sanvaad_conversion_parked`
 * — so it is left for that pass rather than done half way here.
 */

/**
 * A rounded petal. `w` is the half-width at its widest.
 *
 * The same two cubics as the web, kept as a function rather than as baked path
 * strings so a retune moves one place.
 */
export function lobe(r0: number, r1: number, w: number): string {
  const s = r1 - r0;
  const f = (n: number) => n.toFixed(2);
  return `M0,${f(-r0)}`
    + `C${f(w)},${f(-r0 - s * 0.30)} ${f(w)},${f(-r1 + s * 0.26)} 0,${f(-r1)}`
    + `C${f(-w)},${f(-r1 + s * 0.26)} ${f(-w)},${f(-r0 - s * 0.30)} 0,${f(-r0)}Z`;
}

/**
 * The courses, as data: [count, r0, r1, halfWidth, rotationOffset].
 *
 * Identical to the web table, and a test asserts that number for number.
 */
export const COURSES: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [10, 34, 70, 12, 0],      // the rosette
  [10, 35, 56, 7, 18],      // smaller lobes nesting in its gaps
  [20, 76, 120, 11.5, 0],   // the outer petals
  [20, 82, 96, 4.2, 0],     // a bead in each throat
];

/**
 * The eye — the ring क sits inside, and the innermost stroke. r32, not the r11
 * it started at: the letter is sized first and the drawing makes room.
 */
export const EYE_R = 32;

/**
 * क's font-size as a fraction of the rendered figure. DERIVED on the web, not
 * chosen — the eye's inner diameter is 64/260 = 0.246 of the figure, a
 * Devanagari glyph stands about 0.72 of its font-size, and a letter filling
 * ~0.82 of the eye therefore needs 0.246 * 0.82 / 0.72 ≈ 0.28.
 */
export const KA_RATIO = 0.28;

export interface LotusProps {
  size?: number;
  color?: string;
  /** Caps how many of the four courses are drawn. */
  courses?: number;
  /** Stroke width in the 260 viewbox. */
  pen?: number;
  /** Crop the viewBox to the drawing — see below. */
  tight?: boolean;
}

export default function Lotus({
  size = 168, color = '#fff', courses, pen = 1.6, tight = false,
}: LotusProps) {
  const parts = React.useMemo(() => {
    const out: Array<
      | { kind: 'ring'; r: number }
      | { kind: 'petal'; d: string; rot: number }
    > = [];
    // Rings first, so the eye and the collar sit under what hangs off them.
    out.push({ kind: 'ring', r: EYE_R });
    const drawn = typeof courses === 'number' ? COURSES.slice(0, courses) : COURSES;
    drawn.forEach(([n, r0, r1, w, off], ci) => {
      if (ci === 2) out.push({ kind: 'ring', r: 74 });
      const d = lobe(r0, r1, w);
      for (let i = 0; i < n; i++) out.push({ kind: 'petal', d, rot: off + (360 / n) * i });
    });
    return out;
  }, [courses]);

  /* `tight` CROPS THE VIEWBOX TO THE DRAWING.
     The figure is centred at 130,130 and its outermost course reaches r120, so
     about 8% of the 260 box is empty by construction at every edge. The loader
     wants that air; the MARK does not — no amount of scaling the <Svg> fills a
     chip when the emptiness is inside the coordinate space, which is why "make
     it bigger" kept not working on the web.
     Courses 1-2 stop at r70, 3-4 at r120. Half the pen is added so a stroke on
     the outer edge is not clipped. */
  const box = React.useMemo(() => {
    if (!tight) return '0 0 260 260';
    const n = typeof courses === 'number' ? courses : COURSES.length;
    const r = (n <= 2 ? 70 : 120) + (pen || 1.6) / 2;
    return `${130 - r} ${130 - r} ${2 * r} ${2 * r}`;
  }, [tight, courses, pen]);

  return (
    <Svg
      width={size}
      height={size}
      viewBox={box}
      // Never announced. An SVG with no label still lands in the Android
      // accessibility tree and reads as an unlabelled control.
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <G x={130} y={130}>
        {parts.map((p, i) => (p.kind === 'ring' ? (
          <Circle key={i} r={p.r} fill="none" stroke={color} strokeWidth={pen} />
        ) : (
          <Path
            key={i}
            d={p.d}
            fill="none"
            stroke={color}
            strokeWidth={pen}
            strokeLinejoin="round"
            transform={`rotate(${p.rot.toFixed(2)})`}
          />
        )))}
      </G>
    </Svg>
  );
}
