/**
 * motion.ts — the durations, easings and the reduced-motion signal.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────
 *
 * MOTION-SPEC §1 opens with "never write a literal duration", and the web layer
 * honours that with `--dur-*` custom properties scaled by a single `--ix`
 * multiplier. React Native has no custom properties and no cascade, so every
 * duration in this app was a literal at its call site and no two agreed.
 *
 * Worse, the web's reduced-motion switch is a MEDIA QUERY —
 * `@media (prefers-reduced-motion: reduce) { --ix: .001 }` — which does not exist
 * on React Native. The RN signal is `AccessibilityInfo.isReduceMotionEnabled()`
 * plus the `reduceMotionChanged` event, and it has to be read imperatively by
 * every component that animates. Exactly one component was doing that
 * (`SwipeRow`); the auth form shake and the notification banner were not.
 *
 * ── The `--ix: .001` trap, and why this file does NOT copy it ─────────────────
 *
 * The web spec reduces motion by scaling durations to a thousandth. That works
 * for a one-shot: a 220ms fade becomes 0.22ms, i.e. instant. It is WRONG for
 * anything that repeats. A 1.7s shimmer scaled to 1.7ms does not stop — it
 * becomes a 588Hz flicker, which is a strobe, and strobing is precisely what
 * reduced-motion exists to prevent. That was a real defect on the web side.
 *
 * So the rule here is a hard split, not a multiplier:
 *
 *   · A ONE-SHOT under reduced motion jumps to its end state. `duration()`
 *     returns 0 and the value is set, not animated.
 *   · A REPEATING animation under reduced motion DOES NOT RUN AT ALL. There is
 *     no "faster" version of an infinite loop that is safe. `shouldLoop()`
 *     returns false and the caller renders the static frame.
 *
 * `shouldLoop` is deliberately a separate call from `duration` so that a caller
 * cannot express "loop, but shortened" without writing that phrase out.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing, type EasingFunction } from 'react-native';

/**
 * MOTION-SPEC §1. The same five numbers as `--dur-instant` … `--dur-xslow`.
 *
 * `EXIT` is not in the token list but is in §3 and §7.3 — "exits are faster than
 * entrances, decisive out, gentle in" — and the table gives 180ms for it
 * repeatedly. It is a token here so that rule survives the next call site.
 */
export const DUR = {
  instant: 90,
  fast:    140,
  base:    220,
  slow:    360,
  xslow:   520,
  exit:    180,
} as const;

/**
 * MOTION-SPEC §2, as RN easing functions.
 *
 * `Easing.bezier` takes the same four control points as the CSS cubic-bezier, so
 * these are transcriptions rather than approximations.
 */
export const EASE: Record<string, EasingFunction> = {
  /** Default. M3 emphasised. */
  emph:     Easing.bezier(0.2, 0, 0, 1),
  /** Decelerate — things arriving. */
  enter:    Easing.bezier(0, 0, 0.2, 1),
  /** Accelerate — things leaving. */
  exit:     Easing.bezier(0.4, 0, 1, 1),
  /** Bottom sheets rising. */
  emphIn:   Easing.bezier(0.05, 0.7, 0.1, 1),
  /** Overshoot: checks, pops, settles. Confirmation only — never a panel. */
  spring:   Easing.bezier(0.34, 1.36, 0.64, 1),
  /** Pulses, shimmer. */
  standard: Easing.bezier(0.2, 0, 0, 1),
  /** MOTION-SPEC §4, the auth form shake. Its own curve, used nowhere else. */
  shake:    Easing.bezier(0.36, 0.07, 0.19, 0.97),
};

/** MOTION-SPEC §4: the form shake is 420ms at ±4px. Both were wrong in the build. */
export const SHAKE = { duration: 420, amplitude: 4 } as const;

/**
 * Live reduced-motion state.
 *
 * Reads the current value once and then follows `reduceMotionChanged`, so
 * toggling the OS setting while the app is foregrounded takes effect without a
 * relaunch. The `alive` flag matters: `isReduceMotionEnabled()` is a promise and
 * a fast unmount would otherwise set state on a dead component.
 *
 * Defaults to `false` — motion allowed — because the promise has not resolved on
 * the very first frame. Defaulting to `true` would make every animation in the
 * app skip its first run on a device that does NOT want reduced motion, which is
 * the more common case and the more visible wrong answer.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(on => { if (alive) setReduced(on); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  return reduced;
}

/**
 * A one-shot duration, collapsed to 0 under reduced motion.
 *
 * 0 rather than 1: `Animated.timing` with `duration: 0` applies the end value on
 * the next frame, which is the intended "no transition, correct final state".
 */
export function duration(ms: number, reduced: boolean): number {
  return reduced ? 0 : ms;
}

/**
 * Whether a REPEATING animation may run.
 *
 * Always consult this instead of shortening the loop. See the note at the top:
 * a shortened infinite animation is a strobe, not a reduced one.
 */
export function shouldLoop(reduced: boolean): boolean {
  return !reduced;
}
