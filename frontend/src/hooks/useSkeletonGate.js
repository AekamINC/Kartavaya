import { useEffect, useRef, useState } from 'react';

/**
 * MOTION-SPEC.md §7.4 — "Hold the previous page if the fetch resolves under
 * 120ms — a flashed skeleton is worse than none."
 *
 * Both surfaces this was written for re-fetch on a control, not only on mount:
 * TasksListPage reloads the whole list every time the Archived toggle flips,
 * and TodayPage reloads on Retry. Wired straight to `loading`, that replaces a
 * full table with a skeleton for the ~40ms a warm request takes and puts it
 * back — a flash with no information in it, on a control the user pressed
 * expecting a small change.
 *
 * TWO HALVES, and one without the other is worse than neither:
 *
 *  1. `DELAY` (120ms, the spec's number) — nothing is shown for the first
 *     120ms. A fast fetch resolves inside the window and the skeleton never
 *     mounts at all.
 *  2. `MIN_VISIBLE` (--dur-base, 220ms) — once it HAS mounted it stays for at
 *     least that long. Without this, a fetch landing at 125ms shows a 5ms
 *     skeleton, which is precisely the flash half 1 exists to prevent, merely
 *     moved five milliseconds later.
 *
 * `canHold` is what stops this from inventing a second empty-state lie. There
 * is nothing to hold on a first load — `tasks` is still `[]` — so holding
 * would render "no tasks match this filter" for 120ms before the skeleton
 * arrived. When there is no previous content the skeleton shows immediately
 * and only the min-visible half applies.
 *
 * Timings are literals rather than `var(--dur-*)` on purpose: these are JS
 * timers, not CSS, so they cannot ride `--ix`. They are also not *motion* —
 * nothing animates — so reduced motion has no opinion on them. Under
 * `Animations = None` a skeleton still needs to appear and still needs to not
 * flash.
 */
const DELAY = 120;
const MIN_VISIBLE = 220;

export function useSkeletonGate(loading, canHold = false) {
  const [visible, setVisible] = useState(() => loading && !canHold);
  const shownAt = useRef(visible ? Date.now() : 0);

  useEffect(() => {
    let timer;
    if (loading) {
      if (visible) return undefined;
      const wait = canHold ? DELAY : 0;
      timer = setTimeout(() => { shownAt.current = Date.now(); setVisible(true); }, wait);
    } else if (visible) {
      const held = Date.now() - shownAt.current;
      const remaining = Math.max(0, MIN_VISIBLE - held);
      if (remaining === 0) setVisible(false);
      else timer = setTimeout(() => setVisible(false), remaining);
    }
    return () => clearTimeout(timer);
  }, [loading, visible, canHold]);

  return visible;
}

export default useSkeletonGate;
