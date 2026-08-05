/**
 * Lotus — the product's ornament, and Sahayak's thinking state.
 *
 * ── WHAT THIS IS AND IS NOT ─────────────────────────────────────────────────
 *
 * The web's `frontend/src/components/brand/Lotus.jsx` is an SVG: four courses of
 * bezier petals, each stroke trimming itself on with `stroke-dashoffset`, on one
 * pen and one colour. THIS IS NOT THAT DRAWING, and pretending otherwise would
 * be the more expensive mistake — somebody would later find the two side by side
 * and have to work out which was authoritative.
 *
 * `react-native-svg` IS NOT INSTALLED. It is not a transitive dependency of
 * anything in `package.json` either (checked: `@expo/vector-icons` ships its own
 * font-based glyphs and pulls in no SVG runtime). Adding it is a dependency
 * decision, and the honest scope of that decision is not one package: without
 * SVG there are no bezier paths, and without paths there is no `stroke-dasharray`,
 * which is the mechanism the drawing IS. Reproducing Lotus.jsx properly on RN
 * means react-native-svg plus a path-length implementation, and both belong to
 * whoever owns the dependency list.
 *
 * So this is the same FIGURE built from the primitives that are actually here —
 * Views with a border radius, rotated about a centre. It keeps the three rules
 * the web drawing's header states, because those are the style rather than the
 * technique:
 *
 *   ONE PEN.     Every stroke is the same width. Uniform weight is what makes a
 *                drawing read as drawn rather than as designed.
 *   ONE COLOUR.  Full strength, no opacity ramp per course. Fading outer courses
 *                greys the figure and kills the crispness.
 *   IT DRAWS.    The figure assembles rather than appearing. A trim path is not
 *                available, so the analogue is a sweep: each petal comes up in
 *                turn around the ring, holds, and goes down. Same motion, drawn
 *                by a different instrument, and said out loud rather than
 *                claimed to be the original.
 *
 * The geometry IS the original's, transcribed from `COURSES` in Lotus.jsx and
 * scaled off the same 260-unit viewBox, so the proportions match the web mark
 * even though the strokes do not.
 *
 * ── Never announced ─────────────────────────────────────────────────────────
 *
 * It carries no information. The caller supplies the live-region text — in
 * SahayakScreen that is the word "Thinking…" beside it — and this is hidden from
 * the accessibility tree entirely, exactly as the web's `aria-hidden` does.
 */

import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useLoop, useReducedMotion, EASE } from '../theme/motion';

/**
 * How long one sweep takes.
 *
 * NOT in `theme/motion`'s `LOOP`, and deliberately: that object is documented as
 * the two durations the reference's `mobile.css` states as literals, and this is
 * neither of them. It is passed to `useLoop` as a raw constant for the same
 * reason those are — it must never pass through `duration()`, which collapses to
 * 0 and turns an infinite animation into a strobe. See the note at the top of
 * `motion.ts`; three sites on the web side were measured strobing at ~1250 Hz.
 *
 * 2600ms is slower than the web's draw. A phone shows this while an AI answer is
 * in flight, which is seconds rather than the few hundred milliseconds a page
 * loader gets, and a fast loop over that long reads as agitation.
 */
const SWEEP = 2600;

/**
 * The courses, as `[count, r0, r1, halfWidth, rotationOffset]` — the same five
 * numbers Lotus.jsx keeps, so a course retunes by editing one.
 *
 * TWO OF THE ORIGINAL'S FOUR COURSES, not four. The original's second and fourth
 * are a small lobe nesting in the gaps and a bead in each throat; at the 96px
 * this renders at on a phone they are 2–4 device pixels wide, which is below
 * what a border-radius View renders cleanly and reads as grit rather than as
 * ornament. Dropping them keeps the figure legible at the size it is actually
 * used, which is the same argument the original makes for dropping the rays.
 */
const COURSES: Array<[number, number, number, number, number]> = [
  [10, 34, 70, 12, 0],     // the rosette
  [20, 76, 120, 11.5, 0],  // the outer petals
];

/** The original's viewBox. Every radius above is in these units. */
const VIEW = 260;

/** The two rings: the eye, and the collar the outer course hangs off. */
const RINGS = [32, 74];

export interface LotusProps {
  /** Rendered size in points. The geometry scales off `VIEW`. */
  size?: number;
  /** Stroke colour. ONE colour for the whole figure — pass a token. */
  color: string;
  /** Stroke width in points, before scaling. */
  weight?: number;
}

export default function Lotus({ size = 96, color, weight = 1 }: LotusProps) {
  const reduced = useReducedMotion();
  const loop = useLoop(SWEEP, reduced, { easing: EASE.standard });

  const k = size / VIEW;

  /**
   * Every petal, with the phase at which it comes up.
   *
   * Phase is spread across the first 60% of the cycle so the whole figure is up
   * and holding for the last 40% — "trims itself on, holds, then trims off" in
   * the original. Ordered rings-then-courses, so the eye and the collar are
   * there before anything hangs off them.
   */
  const petals: Array<{ rot: number; r0: number; r1: number; w: number; phase: number }> = [];
  const total = COURSES.reduce((n, [count]) => n + count, 0);
  let ordinal = 0;
  for (const [count, r0, r1, w, off] of COURSES) {
    for (let i = 0; i < count; i++) {
      petals.push({
        rot: off + (360 / count) * i,
        r0, r1, w,
        phase: (ordinal++ / total) * 0.6,
      });
    }
  }

  /**
   * The opacity of a stroke whose sweep begins at `phase`.
   *
   * UNDER REDUCED MOTION THIS RETURNS THE NUMBER 1, not an Animated value, and
   * the whole figure renders solid and still. That is `useLoop`'s stated
   * contract — it never starts the animation and parks the driver at 0 — but the
   * driver's 0 is only the resting frame for a loop whose phases are all zero,
   * and these are deliberately not. Interpolating anyway would leave two thirds
   * of the petals faded out permanently: a broken ornament rather than a still
   * one.
   */
  const strokeOpacity = (phase: number) => {
    if (reduced) return 1;
    return loop.interpolate({
      inputRange:  [0, phase, Math.min(phase + 0.18, 1), 0.92, 1],
      outputRange: [0.12, 0.12, 1, 1, 0.12],
      extrapolate: 'clamp',
    });
  };

  return (
    <View
      style={[s.root, { width: size, height: size }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      // The web sets aria-hidden. This is the RN pair that means the same thing
      // on the two platforms; neither flag alone covers both.
      accessible={false}
    >
      {RINGS.map(r => (
        <Animated.View
          key={`ring-${r}`}
          style={{
            position: 'absolute',
            width:  r * 2 * k,
            height: r * 2 * k,
            borderRadius: r * k,
            borderWidth: weight,
            borderColor: color,
            opacity: strokeOpacity(r === RINGS[0] ? 0 : 0.08),
          }}
        />
      ))}

      {petals.map((p, i) => {
        const len = (p.r1 - p.r0) * k;
        const wid = p.w * 2 * k;
        // The petal's centre sits halfway along its own span, pushed out from
        // the figure's centre. `rotate` first and `translateY` second, which is
        // CSS ordering and is what React Native implements: the rotation turns
        // the coordinate frame, and the translation then runs along the turned
        // axis. Reversing the two puts every petal in the same place, rotated.
        const mid = (p.r0 + p.r1) / 2 * k;
        return (
          <Animated.View
            key={`p-${i}`}
            style={{
              position: 'absolute',
              width:  wid,
              height: len,
              // A capsule: fully rounded at both ends, which is the closest a
              // border-radius gets to the original's rounded lobe.
              borderRadius: wid / 2,
              borderWidth: weight,
              borderColor: color,
              opacity: strokeOpacity(p.phase),
              transform: [{ rotate: `${p.rot}deg` }, { translateY: -mid }],
            }}
          />
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  // Every stroke inside is `position: 'absolute'` with NO top/left/right/bottom,
  // and Yoga lays such a child out against the parent's alignment rather than
  // pinning it to the top-left corner — which is where CSS would put it. That
  // difference is the whole reason this works without arithmetic at each stroke:
  // these two rules are what put all thirty of them on one origin.
  root: { alignItems: 'center', justifyContent: 'center' },
});
