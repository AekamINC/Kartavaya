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

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, type EasingFunction } from 'react-native';

/**
 * MOTION-SPEC §1. The same five numbers as `--dur-instant` … `--dur-xslow`.
 *
 * `EXIT` is not in the token list but is in §3 and §7.3 — "exits are faster than
 * entrances, decisive out, gentle in" — and the table gives 180ms for it
 * repeatedly. It is a token here so that rule survives the next call site.
 *
 * `SHEET` is §3's bottom-sheet entrance. It is its own number rather than
 * `slow`, and the reference disagrees with itself about which:
 *
 *   · MOTION-SPEC §3           `300ms` `--ease-emph-in`
 *   · motion.css:97  `.dm-sheet`  `calc(--dur-slow * .84)` = 302.4ms `--ease-emph-in`
 *   · mobile.css:279 `.msheet`    the same 302.4ms `--ease-emph-in`
 *   · mobile.css:431 `.msheet`    `--dur-slow` (360ms) `--ease-emph`   ← outlier
 *
 * The last one is a second `.msheet` block later in the same file, so it SHADOWS
 * the first and is what the rendered `Mobile App.html` actually plays — measured
 * at `animationDuration: 0.36s`, `animationTimingFunction: cubic-bezier(.2,0,0,1)`.
 * Three sources to one, and `--ease-emph-in`'s own token comment reads "bottom
 * sheets rising", so the shadowing rule is taken as the defect and 300 / emphIn
 * as the intent.
 */
export const DUR = {
  instant: 90,
  fast:    140,
  base:    220,
  slow:    360,
  xslow:   520,
  exit:    180,
  sheet:   300,
} as const;

/**
 * Durations for animations that REPEAT, kept apart from `DUR` on purpose.
 *
 * Nothing in this object may ever be passed through `duration()`. That is the
 * whole point of the separation: `duration()` collapses to 0, and a 0ms loop is
 * an infinite loop running as fast as the display can composite. The measured
 * consequence of doing this on the web side is recorded at the top of this file.
 *
 * Both numbers are literals in `mobile.css` rather than `--dur-*` tokens, which
 * is why they are the two animations on the mobile reference that do NOT strobe
 * under `--ix: .001` — measured, they stay at 2s and 1.4s. They also therefore do
 * not STOP, which contradicts MOTION-SPEC §4's own "disabled under reduced
 * motion" for the shimmer. `useLoop` fixes that half here.
 */
export const LOOP = {
  /** `mobile.css:63` `.mpulse` — the clocked-in / running-timer dot. */
  pulse:   2000,
  /** `mobile.css:446` `.msk` — skeleton shimmer. §4: disabled under reduced motion. */
  shimmer: 1400,
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
 * Bottom-sheet presentation, as one object so a sheet cannot get half of it.
 *
 * Four values, and the pairing is the part that matters: §7.3 says exits are
 * faster than entrances, and the scrim's exit is faster still so the panel is
 * never left sliding over an already-clear background.
 *
 * `React Native's <Modal animationType="slide"> cannot express any of this.` It
 * is a fixed platform animation with no duration, no curve and — the reason it
 * had to go — no reduced-motion behaviour at all: it slides the full height of
 * the screen whatever the OS accessibility setting says. Every sheet in this app
 * used it. See `components/Sheet.tsx`.
 */
export const SHEET = {
  /** MOTION-SPEC §3, `translateY(100%) → 0`. */
  in:        DUR.sheet,
  inEase:    EASE.emphIn,
  /** §3, `translateY(100%)`. Decisive out. */
  out:       DUR.base,
  outEase:   EASE.exit,
  /** `mobile.css:278` `.msheet__scrim` — `dmFade --dur-base --ease-enter`, measured 0.22s. */
  scrimIn:      DUR.base,
  scrimInEase:  EASE.enter,
  /** `motion.css:89` `.dm-scrim.out` — the fade reversed at `--dur-fast`. */
  scrimOut:     DUR.fast,
  scrimOutEase: EASE.exit,
} as const;

/**
 * Tab-panel change. `motion.css:186` `.dm-tabs__p` / `@keyframes dmPanel`:
 * `opacity 0→1` plus `translateX(var(--dx))` over `--dur-base` `--ease-emph`,
 * with `IxDrawer.jsx:373` setting `--dx` to `±10px` from the direction of travel.
 *
 * The sign is the information. A panel that always enters from the same side
 * says nothing about which way you moved through the tabs.
 *
 * `indicator` is `motion.css:185` `.dm-tabs__ind`, which slides `left` and
 * `width` over the same `--dur-base` `--ease-emph`. `mobile.css:297`
 * `.mnav2__ind` — the 30×3px bar the mobile bar draws — has no transition at
 * all, so the reference's own mobile indicator jumps. The shared tabs primitive
 * is the one that got this right, so its numbers are the ones taken.
 */
export const TAB = {
  panel:     DUR.base,
  panelEase: EASE.emph,
  /** `IxDrawer.jsx:373`. Signed by the caller; this is the magnitude. */
  panelDx:   10,
  indicator:     DUR.base,
  indicatorEase: EASE.emph,
} as const;

/**
 * Press feedback. MOTION-SPEC §1 names `--dur-instant` for exactly this.
 *
 * The scale is per call site — `motion.css:424` `.kb__card.press` uses `.985`
 * for a dense kanban card, the camera shutter wants more — so only the TIME is
 * fixed here. Collapse the scale with `scaleTo`, never by shortening the press.
 */
export const PRESS = { duration: DUR.instant, ease: EASE.emph } as const;

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
 * A scale factor, collapsed to 1 under reduced motion.
 *
 * `amplitude()` for `transform: scale`. A scale is a distance measured from 1,
 * not from 0, so passing `0.96` to `amplitude()` would return 0 and shrink the
 * element to nothing. This does the arithmetic once, here, rather than leaving
 * `1 - amplitude(1 - x, reduced)` to be written correctly at every call site.
 *
 * Works in both directions: `scaleTo(1.22, r)` for an overshoot, `scaleTo(.96, r)`
 * for a press. Both land on 1 when reduced, which is the element not moving.
 */
export function scaleTo(target: number, reduced: boolean): number {
  return reduced ? 1 : target;
}

/**
 * Whether a REPEATING animation may run.
 *
 * Always consult this instead of shortening the loop. See the note at the top:
 * a shortened infinite animation is a strobe, not a reduced one.
 *
 * Prefer `useLoop`, which consults this for you and cannot be told to ignore it.
 */
export function shouldLoop(reduced: boolean): boolean {
  return !reduced;
}

/**
 * A 0→1 driver for a REPEATING animation, or a dead value if motion is reduced.
 *
 * This is the only place in the app that calls `Animated.loop`, and it exists so
 * that "loop, but shortened" is not merely discouraged but unreachable: the
 * duration goes in as a `LOOP` constant and never passes through `duration()`,
 * and when `useReducedMotion()` is true the loop is not started at all. The
 * caller gets a value pinned at 0 — the loop's own resting frame — and renders
 * the static appearance it would have had at t=0.
 *
 * Contrast with what the reference does, which is the defect this app is
 * deliberately not inheriting:
 *
 *   · `motion.css:117` `.dm-spin` — `calc(.7s * var(--ix)) linear infinite`.
 *     Measured in the rendered catalogue with `--ix: .001`: `animationDuration
 *     0.0007s`, `animationIterationCount infinite`. That is 0.7ms per rotation,
 *     ≈1429 Hz, for the user who asked for LESS motion. `16-animations.md:44`
 *     gives this as its worked example, so it is the spec and not a slip.
 *   · `mobile.css:63` `.mpulse` and `mobile.css:446` `.msk` — 2s and 1.4s
 *     literals, so they do not strobe, but they also do not stop. Measured at
 *     `--ix: .001` they are still `2s infinite` and `1.4s infinite`, which
 *     contradicts MOTION-SPEC §4's "disabled under reduced motion".
 *
 * Native-driven by default: every current caller drives opacity or transform, and
 * a loop on the JS thread is the one animation guaranteed to be running while
 * something else is trying to scroll. Pass `useNativeDriver: false` for a colour
 * or layout property.
 */
export function useLoop(
  durationMs: number,
  reduced: boolean,
  opts?: { useNativeDriver?: boolean; easing?: EasingFunction },
): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  const useNativeDriver = opts?.useNativeDriver ?? true;
  const easing = opts?.easing ?? EASE.standard;

  useEffect(() => {
    if (!shouldLoop(reduced)) {
      // Not "stopped after one frame" — never started, and parked on the frame
      // the keyframe list calls 0%. A running-but-invisible native animation
      // still wakes the compositor every frame for the life of the screen.
      value.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.timing(value, { toValue: 1, duration: durationMs, easing, useNativeDriver }),
    );
    anim.start();
    return () => { anim.stop(); value.setValue(0); };
  }, [durationMs, reduced, useNativeDriver, easing, value]);

  return value;
}

/**
 * The settle used by every gesture that springs back — swipe rows, sheets
 * dragged and released, a card returning to its column.
 *
 * A timing with `EASE.spring` rather than `Animated.spring`, because that is
 * what the reference is: `mobile.css:72/86/237` all read
 * `transition: transform var(--dur-base) var(--ease-spring)`, i.e. a 220ms
 * curve with an overshoot built into the bezier, not a physics simulation.
 *
 * `Animated.spring` was what the build used and it cannot express this. Its
 * `tension`/`friction` pair has no duration to collapse, so a spring is the one
 * animation shape that silently ignores reduced motion — which is exactly what
 * `SwipeRow` and `NotificationBanner` were each doing, with two different pairs
 * of magic numbers (`9/90` and `12/80`) that appear in no spec.
 */
export function settle(
  value: Animated.Value,
  toValue: number,
  reduced: boolean,
): Animated.CompositeAnimation {
  return Animated.timing(value, {
    toValue,
    duration: duration(DUR.base, reduced),
    easing: EASE.spring,
    useNativeDriver: true,
  });
}
