import React from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * LotusK — the mark. A half lotus that reads as a K.
 *
 * A PORT of `frontend/src/components/brand/LotusK.jsx`. The three paths are
 * copied verbatim and a test asserts that character for character: re-typing a
 * cubic by hand is how two figures start to differ in a way nobody can see and
 * nobody can bisect.
 *
 * The web docblock records the decision and the property it reversed — the mark
 * and the ornament are now separate drawings and will not track each other.
 * That cost applies here too, and this file inherits it rather than restating
 * it.
 *
 * A K first, a lotus second: a straight spine and two straight arms at the true
 * angles of a K, each arm closing into a petal curve. The K is made of STROKES
 * and not of gaps, which is why it survives 16px.
 */

/** Stroke width for a rendered size, in the 24-unit viewbox. */
export function penFor(size: number): number {
  if (size >= 72) return 1.8;
  if (size >= 40) return 2.1;
  if (size >= 24) return 2.6;
  return 3.2;
}

/** The three paths, as data. Copied from the web, character for character. */
export const PATHS: ReadonlyArray<{ d: string; cap?: 'round' }> = [
  // The spine — the K's upright, and the lotus's stem.
  { d: 'M6.5 3.5V20.5', cap: 'round' },
  // The upper arm, closing into a petal.
  { d: 'M6.5 12L13 5.5C15.5 3 18.5 4 18.5 4C18.5 4 19 8 16 10C13.5 11.6 6.5 12 6.5 12Z' },
  // The lower arm, its mirror.
  { d: 'M6.5 12L13 18.5C15.5 21 18.5 20 18.5 20C18.5 20 19 16 16 14C13.5 12.4 6.5 12 6.5 12Z' },
];

/* The drawing occupies x 6.5-19, y 3-21 of the 24 box — so a quarter of the
   width is empty by construction. `tight` crops to it, squarely so the figure
   is not distorted, which is what lets it fill a chip instead of floating. */
export const TIGHT_BOX = '3 2.5 19 19';

export interface LotusKProps {
  size?: number;
  color?: string;
  pen?: number;
  tight?: boolean;
}

export default function LotusK({ size = 24, color = '#fff', pen, tight = false }: LotusKProps) {
  const w = pen ?? penFor(size);
  return (
    <Svg
      width={size}
      height={size}
      viewBox={tight ? TIGHT_BOX : '0 0 24 24'}
      fill="none"
      // Never announced — see Lotus.tsx.
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {PATHS.map((p, i) => (
        <Path
          key={i}
          d={p.d}
          stroke={color}
          strokeWidth={w}
          strokeLinecap={p.cap || 'butt'}
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
