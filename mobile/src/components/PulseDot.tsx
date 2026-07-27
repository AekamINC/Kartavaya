/**
 * PulseDot — the "this is live right now" indicator, and the one repeating
 * animation in this app.
 *
 * MOTION-SPEC §4: "Timer dot · opacity/scale pulse on a `2s` `--ease-standard`
 * loop." The reference draws it at `mobile.css:63`:
 *
 *     .mpulse { animation: mp 2s var(--ease-standard) infinite }
 *     @keyframes mp { 50% { opacity: .35; transform: scale(.78) } }
 *
 * It sits beside the elapsed figure on the clocked-in card (`Mobile.jsx:144`,
 * `:367`) and it is doing real work: an elapsed time that ticks and a static
 * elapsed time look identical in a screenshot and nearly identical in the hand.
 * The dot is what says the number is still moving.
 *
 * ── The reduced-motion behaviour, which the reference gets wrong ─────────────
 *
 * `.mpulse`'s 2s is a literal rather than an `--ix` multiple, so under
 * `prefers-reduced-motion` it does not strobe the way `.dm-spin` does — measured,
 * it stays at exactly `2s infinite`. It also therefore does not STOP, and §4
 * asks for repeating animation to be disabled under reduced motion.
 *
 * `useLoop` is the fix and it is structural rather than a conditional: the
 * duration is a `LOOP` constant that never passes through `duration()`, and when
 * reduced motion is on the loop is never started. The dot renders its 0% frame —
 * full opacity, full size — which is a solid dot, which is exactly what a live
 * indicator should look like when it cannot move. No information lost.
 */
import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useLoop, useReducedMotion, EASE, LOOP } from '../theme/motion';

export interface PulseDotProps {
  color: string;
  size?: number;
  /** Announced instead of the dot itself. Pass what the pulse MEANS. */
  label?: string;
}

export default function PulseDot({ color, size = 11, label }: PulseDotProps) {
  const reduced = useReducedMotion();
  // 0 -> 1 across the full 2s. The keyframe list has its extreme at 50%, so the
  // interpolation below is symmetric rather than a straight ramp.
  const loop = useLoop(LOOP.pulse, reduced, { easing: EASE.standard });

  return (
    <Animated.View
      accessible={!!label}
      accessibilityLabel={label}
      accessibilityRole={label ? 'text' : undefined}
      style={[
        s.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          // `@keyframes mp { 50% { opacity: .35; transform: scale(.78) } }`.
          // Both ends are the rest state, which is why 0 and 1 share a value —
          // and why a stopped loop parked at 0 is indistinguishable from the
          // resting frame of a running one.
          opacity: loop.interpolate({
            inputRange:  [0, 0.5, 1],
            outputRange: [1, 0.35, 1],
          }),
          transform: [{
            scale: loop.interpolate({
              inputRange:  [0, 0.5, 1],
              outputRange: [1, 0.78, 1],
            }),
          }],
        },
      ]}
    />
  );
}

const s = StyleSheet.create({
  dot: { flexShrink: 0 },
});
