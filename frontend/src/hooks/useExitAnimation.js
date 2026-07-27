import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keep a CONTROLLED overlay mounted until its exit animation has finished.
 *
 * The problem it solves. `modal.jsx` and `ConfirmDialog.jsx` both ended with
 * `if (!open) return null`, so every dialog in the app faded and rose into
 * place over 262ms and then ceased to exist between two frames. MOTION-SPEC §7.3
 * says exits are FASTER than entrances; it does not say they are absent, and the
 * reference implements one for each of them (`.ov-modal.out`, `.ov-cd.out` in
 * motion.css). An overlay cannot play `.is-closing` if React has already removed
 * the node, so something has to hold it there — that is all this is.
 *
 * Why it is a hook and not four more copies. Popover, Picker, Sheet and Menu
 * each carry the same triple by hand: a `closing` state for the class, a
 * `closingRef` so the `animationend` handler can tell the exit from the
 * entrance, and a fallback timer. Those four own their open state, so they can
 * defer `setOpen(false)` themselves. Modal and ConfirmDialog cannot — `open`
 * comes from the parent and has already flipped by the time we hear about it —
 * which is the case this hook exists for. It is deliberately shaped like the
 * reference's own `useExit(open, ms)` helper.
 *
 * THE UNMOUNT IS DRIVEN BY `animationend`, NEVER A CONSTANT. The CSS side is
 * `var(--dur-fast)`, i.e. `calc(140ms * var(--ix))`, and `--ix` is scaled by the
 * user's Animations preference at runtime. No number written here could track
 * it: at "Reduced" a 140 would hold a dead panel for 70ms after it finished
 * leaving, and at "None" it would make somebody who asked for no animation wait
 * for one anyway. `--ix` bottoms out at `.001` rather than `0` precisely so the
 * event still fires — a zero-duration animation never dispatches `animationend`
 * and the node would leak.
 *
 * `fallbackMs` is a CEILING for the case where the event cannot arrive at all:
 * the node is display:none'd, the tab is backgrounded mid-exit, or the animation
 * is interrupted. It must sit well ABOVE the CSS duration or it stops being a
 * fallback and becomes a race that truncates the exit.
 *
 *   const { alive, closing, onAnimationEnd } = useExitAnimation(open);
 *   if (!alive) return null;
 *   <div className={closing ? 'x is-closing' : 'x'} onAnimationEnd={onAnimationEnd}>
 *
 * Bind `onAnimationEnd` to the element carrying the exit keyframe, and to only
 * one of them when a surface has two (a scrim and a panel leave together —
 * watch the panel, which is the thing whose travel has to complete).
 */
export function useExitAnimation(open, { fallbackMs = 600 } = {}) {
  const [alive, setAlive] = useState(open);
  const [closing, setClosing] = useState(false);

  // Refs, not state, for both flags the effects read back. `animationend` fires
  // from a listener installed on an earlier render, and a closure over `closing`
  // would give it that render's value — without the guard, the ENTRANCE
  // animation completing would be read as the exit and unmount the overlay the
  // instant it appeared.
  const closingRef = useRef(false);
  const aliveRef = useRef(open);
  const timer = useRef(null);

  const finish = useCallback(() => {
    clearTimeout(timer.current);
    closingRef.current = false;
    aliveRef.current = false;
    setClosing(false);
    setAlive(false);
  }, []);

  useEffect(() => {
    if (open) {
      // Reopening cancels a running exit rather than queueing behind it.
      clearTimeout(timer.current);
      closingRef.current = false;
      aliveRef.current = true;
      setClosing(false);
      setAlive(true);
      return;
    }
    // Nothing mounted — closing a closed overlay must not mount one to animate.
    if (!aliveRef.current || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(finish, fallbackMs);
  }, [open, finish, fallbackMs]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // `e.target !== e.currentTarget` filters animations bubbling up from the
  // content: a dialog body can hold a spinner, a skeleton or an `.ix-flash`, and
  // any of them finishing would otherwise be read as the panel's own exit.
  const onAnimationEnd = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    if (!closingRef.current) return;
    finish();
  }, [finish]);

  return { alive, closing, onAnimationEnd };
}

export default useExitAnimation;
