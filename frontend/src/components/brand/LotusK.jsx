import React from 'react';

/**
 * LotusK — the mark. A half lotus that reads as a K.
 *
 * ── The decision, and the one it reversed ───────────────────────────────────
 *
 * On 2026-08-07 the owner first asked for the loader's lotus to become the
 * logo, and it did. Then, having seen the alternatives side by side in
 * `docs/proposals/30-the-mark.html`, they chose C — "Half lotus for favicon and
 * rest".
 *
 * That reverses a property the previous mark had and this one cannot: the
 * lotus mark WAS the loader, the same `lobe()` and `COURSES` that `kamal.js`
 * draws the Sanvaad conversation ground from, so retuning a petal moved all
 * three together. This is a second figure. It is the right call anyway — the
 * lotus does not read as a K, and the brief was a K — but the cost is real and
 * is written here rather than discovered later: **the mark and the ornament are
 * now separate drawings and will not track each other.**
 *
 * `Lotus` is untouched and still animates the loader. That was the owner's
 * other instruction and it still holds.
 *
 * ── The figure ──────────────────────────────────────────────────────────────
 *
 * A K first, a lotus second. A straight spine and two straight arms at the true
 * angles of a K, each arm closing into a petal curve rather than a point. The
 * K is made of STROKES and not of gaps, which is why it survives 16px where the
 * negative-space alternative did not — the petals thicken into each other long
 * before the letter stops being legible.
 *
 * It keeps `Lotus`'s two rules so the two figures still look like one hand:
 * ONE PEN (every stroke the same width) and ONE COLOUR (no opacity ramp).
 *
 * ── The pen widens as the mark shrinks ──────────────────────────────────────
 *
 * A 1.9 pen in a 24 viewbox is right at 88px and hairline at 16. There is no
 * course-dropping here as there was for the lotus, because three strokes is
 * already the whole drawing — only the weight changes.
 */

/** Stroke width for a rendered size, in the 24-unit viewbox. */
export function penFor(size) {
  if (size >= 72) return 1.8;
  if (size >= 40) return 2.1;
  if (size >= 24) return 2.6;
  return 3.2;
}

/** The three paths, as data, so the favicon generator emits the same figure. */
export const PATHS = [
  // The spine — the K's upright, and the lotus's stem.
  { d: 'M6.5 3.5V20.5', cap: 'round' },
  // The upper arm, closing into a petal.
  { d: 'M6.5 12L13 5.5C15.5 3 18.5 4 18.5 4C18.5 4 19 8 16 10C13.5 11.6 6.5 12 6.5 12Z' },
  // The lower arm, its mirror.
  { d: 'M6.5 12L13 18.5C15.5 21 18.5 20 18.5 20C18.5 20 19 16 16 14C13.5 12.4 6.5 12 6.5 12Z' },
];

export default function LotusK({ size = 24, pen, className = '', style }) {
  const w = pen ?? penFor(size);
  return (
    <svg
      className={`lotusk${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS.map((p, i) => (
        <path
          key={i}
          d={p.d}
          stroke="currentColor"
          strokeWidth={w}
          strokeLinecap={p.cap || 'butt'}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
