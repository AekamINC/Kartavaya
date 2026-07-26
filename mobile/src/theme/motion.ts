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
 * The web SPEC reduces motion by scaling durations to a thousandth. That works
 * for a one-shot: a 220ms fade becomes 0.22ms, i.e. instant. It is WRONG for
 * anything that repeats. A 1.7s shimmer scaled to 1.7ms does not stop — it
 * becomes a ~588Hz flicker, which is a strobe, and strobing is precisely what
 * reduced-motion exists to prevent.
 *
 * This is not hypothetical and it is not merely a build bug: **the spec mandates
 * it.** `16-animations.md:44` gives `animation: dmSpin calc(.7s * var(--ix))
 * linear infinite` as its worked example, and reference `motion.css:117`
 * implements it — a 0.7ms spinner for the user who just asked for less motion.
 * Three live sites on the web side were measured strobing at 2.000ms, 1.5ms and
 * 0.8ms (~1250Hz) before they were fixed. **Do not port that pattern here.**
 *
 * ── Mirror the BUILD's two-scalar split, not the spec's one ───────────────────
 *
 * `frontend/src/styles/animations.css` solved this with a split the reference
 * does not have, and it is the better design:
 *
 *   · `--ix`           scales DURATION.  Bottoms out at `.001`.
 *   · `--motion-scale` scales DISTANCE.  Bottoms out at **`0`**.
 *
 * Infinite animations there keep a FIXED duration and put their amplitude on
 * `--motion-scale`, so at scale 0 the 50% keyframe equals the 0%/100% keyframe
 * and the loop is visually inert instead of fast. That is the insight worth
 * carrying over, so this file exposes both scalars rather than one:
 * `duration()` and `amplitude()`.
 *
 * Two deliberate divergences from the web, because RN is not CSS:
 *
 *   · `duration()` returns **0**, not `ms * .001`. The `.001` on the web is a
 *     workaround for CSS engines that treat `0s` inconsistently across the three
 *     spec files that disagree about it. RN's `Animated.timing` with
 *     `duration: 0` applies the end value on the next frame, exactly and
 *     without a rounding argument.
 *   · A repeating animation is **not started at all**, rather than run inert.
 *     CSS keeps the inert loop because stopping it would mean a second rule; RN
 *     would be burning a JS-thread or native-driver animation forever to render
 *     a frame that never changes. `shouldLoop()` returns false and the caller
 *     renders the static frame.
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
 * The `--ix` half of the build's split. 0 rather than the web's `.001` scalar:
 * `Animated.timing` with `duration: 0` applies the end value on the next frame,
 * which is the intended "no transition, correct final state", with none of the
 * ambiguity CSS has about `0s`.
 *
 * NEVER pass the result to a looping animation. See `shouldLoop`.
 */
export function duration(ms: number, reduced: boolean): number {
  return reduced ? 0 : ms;
}

/**
 * A travel distance, collapsed to 0 under reduced motion.
 *
 * The `--motion-scale` half of the build's split, which the reference does not
 * have. Use it for anything measured in pixels — a slide-in offset, a shake
 * amplitude, a scale delta — so that reduced motion removes the MOVEMENT while
 * leaving the opacity or colour change that carried the actual information.
 *
 * This is what makes the split worth having. Collapsing only duration gives you
 * a 0ms jump across the full distance, which is a teleport; collapsing only
 * distance gives you a slow fade in place. Both together give you the thing that
 * appears where it belongs, immediately, which is what was asked for.
 */
export function amplitude(px: number, reduced: boolean): number {
  return reduced ? 0 : px;
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
