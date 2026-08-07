import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import Lotus, { KA_RATIO } from './Lotus';
import LotusK from './LotusK';
import { hindi } from '../../theme/fonts';
import { BRAND_GRADIENT } from '../../theme/tokens';

/**
 * The mark. TWO figures, chosen by how much room there is.
 *
 * A PORT of `KLogo` in `frontend/src/lib/brand.jsx`. Owner, settled 2026-08-07:
 * "lotus logo as logo and half lotus for favicon and small place but where
 * possible i loved to have full lotus." And, on the switch: "anything from 32px
 * onwards used lotus and under only 'k'."
 *
 * They then opened this app and said the sign-in mark "is not lotus at all its
 * 'k'" — mobile had never had the mark at all. This is the fix.
 *
 * ── THE THRESHOLD IS A FIGURE SIZE, NOT A CHIP SIZE ─────────────────────────
 *
 * What decides whether the lotus resolves is how many pixels the DRAWING gets,
 * so `LOTUS_MIN_FIGURE` is compared against `inner` — the chip minus its pad —
 * and the chip size that satisfies it falls out. Writing it the other way round
 * meant the threshold silently moved every time the inset changed.
 *
 * ── THE LOTUS TAKES THE WHOLE CHIP ──────────────────────────────────────────
 *
 * `PAD` is 0, and that is not the same as no breathing room: the lotus's outer
 * petals reach r120 of a 260 box, so the drawing carries about 8% of margin
 * INSIDE ITSELF. Adding padding on top of that is what made a 56px chip look
 * half empty on the web, twice. The K keeps 2 because its own box is tighter.
 *
 * ── ONE COLOUR, AND IT IS NOT WHITE ─────────────────────────────────────────
 *
 * Both figures paint `t.onPrimary`, not `#fff`: the accent gradient can be light
 * (Saffron, Amber) and a white mark on it is under 2:1. Mobile has no runtime
 * accent picker yet, so today this resolves to one value — but naming the token
 * means the day it does, the mark follows instead of needing to be found.
 */

const PAD = 0;             // the lotus's own ~8% petal margin IS the padding
const PAD_K = 2;           // the K's 24-box is tighter and wants a little
/* 32, on the owner's call after seeing the two drawn side by side at tab sizes.
   Measured, 32px is where a two-course rosette stops being a blob — below it the
   petals merge and the K, which is three strokes, stays legible. */
const LOTUS_MIN_FIGURE = 32;

/** Courses and pen for a lotus drawn at `px`, in its 260 viewbox. */
function lotusDetail(px: number): { courses: number; pen: number } {
  if (px >= 88) return { courses: 4, pen: 1.6 };
  if (px >= 64) return { courses: 3, pen: 2.4 };
  return { courses: 2, pen: 3.6 };
}

export interface KLogoProps {
  size?: number;
  /** Foreground for both figures. Defaults to the gradient's on-colour. */
  color?: string;
}

/**
 * The full figure with क in its eye, WITHOUT the chip.
 *
 * Owner: "'k' needs to be part of lotus same as loader." It is not decoration
 * on top of the drawing — Lotus's eye was opened from r11 to r32 FOR this
 * letter. A lotus without it is the ornament with a hole in the middle where
 * the mark should be.
 *
 * Exported because it has TWO grounds on this platform: `KLogo` puts it on a
 * gradient chip, and the sign-in crown puts it straight onto a band that is
 * already the gradient. Nesting a chip inside the crown would draw the accent
 * on the accent. One composition, two grounds — and only one place where the
 * letter's position can go wrong.
 */
export function LotusKa({ size, color }: { size: number; color: string }) {
  const { courses, pen } = lotusDetail(size);
  return (
    <View style={s.stack}>
      {/* No `still` prop, unlike the web: nothing in the mobile figure animates
          in the first place, so a flag to hold it would be a lie about what the
          component does. See Lotus.tsx. */}
      <Lotus tight size={size} courses={courses} pen={pen} color={color} />
      {/* Absolutely positioned and centred rather than laid out, because the
          letter has to land in the EYE of the drawing behind it, not beside it.
          `KA_RATIO` is derived from the eye's own radius, so it stays inside
          the ring at every size. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Text
          style={[
            s.ka,
            {
              color,
              fontSize: Math.round(size * KA_RATIO),
              lineHeight: size,
              // No `fontWeight`. Tiro Devanagari Hindi ships one weight, so a
              // '700' is a smeared fake bold on Android and a different
              // typeface on iOS. Three screens have hit this already.
              ...hindi(),
            },
          ]}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          क
        </Text>
      </View>
    </View>
  );
}

export default function KLogo({ size = 32, color = '#fff' }: KLogoProps) {
  const inner = Math.max(8, size - PAD * 2);
  const full = inner >= LOTUS_MIN_FIGURE;

  return (
    <LinearGradient
      colors={BRAND_GRADIENT}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[s.chip, { width: size, height: size, borderRadius: size * 0.26 }]}
    >
      {full
        ? <LotusKa size={inner} color={color} />
        : <LotusK tight size={Math.max(8, size - PAD_K * 2)} color={color} />}
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  chip:  { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stack: { alignItems: 'center', justifyContent: 'center' },
  ka:    { textAlign: 'center', textAlignVertical: 'center' },
});
