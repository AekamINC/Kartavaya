import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * Tooltip — 300ms delay in, INSTANT out (26-component-inventory.md §6).
 *
 * Converted off Tailwind. It was `bg-gray-900 dark:bg-gray-100` with
 * `text-[11px]` and `animate-in fade-in-0 zoom-in-95` — a palette outside the
 * token system entirely, so it neither followed the theme nor the user's
 * motion preference, and at 11px white-on-#111 it was the one piece of chrome
 * nobody could restyle from `00-tokens.md`.
 *
 * The asymmetry is the point: `dmTip` has an entrance and no exit. A tooltip
 * that fades out follows the cursor to the next control and reads as lag — so
 * it is unmounted on the spot, and the timer is cleared rather than left to
 * fire over a control the pointer has already left.
 *
 * ── THE TWO GAPS MOTION-SPEC §9 NAMES BY NAME ────────────────────────────
 * "`Tooltip.jsx` has the 300ms delay but no edge auto-flip, so tooltips on the
 * rightmost toolbar buttons render off-screen" and, from IxOverlays.jsx:373,
 * "plus a shared timer so the swap is instant". Both are below, and both are
 * one behaviour rather than four:
 *
 *   1. EDGE HANDLING. `position` was a static prop rendered straight into
 *      `tip--${position}` with no measurement anywhere in the file. The tip is
 *      `position: absolute` inside a `position: relative` wrapper, so it is
 *      laid out relative to the trigger and nothing stops it leaving the
 *      viewport. Two corrections, in this order, after paint:
 *        · FLIP on the axis the placement travels on — a `top` tip whose top
 *          edge is within 8px of the viewport goes to `bottom`, a `right` tip
 *          that overruns the right edge goes to `left`, and so on. If the
 *          flipped side has even less room than the original, the flip is
 *          abandoned: moving a tooltip from one clipped edge to a worse one is
 *          not an improvement.
 *        · SHIFT on the cross axis, which is the case the spec's own example
 *          is actually about. A `top` tooltip is centred on its trigger with
 *          `translate(-50%, …)`, so on the RIGHTMOST toolbar button it hangs
 *          half its width past the edge and no amount of flipping top/bottom
 *          helps. `--tip-dx` slides it back inside, so the tip stays attached
 *          to the button it names instead of jumping to the other side of it.
 *
 *   2. A SHARED TIMER. `timeoutRef` was a per-instance `useRef`, so crossing a
 *      toolbar of eight icon buttons started and cancelled eight independent
 *      300ms dwells and showed nothing until the pointer stopped. The dwell
 *      exists to stop tooltips firing as the cursor PASSES OVER a toolbar; it
 *      is not meant to charge the user again for each button once they have
 *      already asked for one. The timer and the "some tooltip is currently
 *      open" flag are therefore module-level, shared by every instance on the
 *      page: the first tooltip waits 300ms, and while one is open the next
 *      swaps on the spot. Leaving the group entirely clears the flag, so the
 *      dwell is charged again next time — the grace is for a swap, not
 *      permanent.
 *
 * The shared state is deliberately module scope and not a context. A tooltip
 * group is "whatever the pointer is crossing right now", which is a property of
 * the pointer and not of the React tree — two adjacent toolbars from different
 * providers should still hand off instantly, and wrapping the app in yet
 * another provider to achieve that would be the wrong shape.
 */

/** The one dwell timer for the whole page. See §2 above. */
let sharedTimer = null;
/** How many tooltips are currently mounted-and-visible. */
let openCount = 0;
/**
 * "The pointer is inside a tooltip group." TRUE while any tooltip is open, and
 * for one macrotask after the last one closes.
 *
 * The grace window is the whole mechanism, and it is separate from `openCount`
 * for a reason worth stating: crossing from one toolbar button to the next
 * fires `mouseleave` on the first BEFORE `mouseenter` on the second, so there
 * is an instant with nothing open. Reading `openCount > 0` at that instant
 * says "not in a group" and charges a second 300ms dwell — which is the exact
 * behaviour this was meant to remove. The flag survives the gap; a real
 * departure (no `mouseenter` follows) lets the queued timeout clear it.
 */
let groupActive = false;
let graceTimer = null;

/** Test seam: a suite that renders two Tooltips in sequence would otherwise
 *  inherit the previous test's group flag and see no dwell at all. */
export function __resetTooltipTimers() {
  clearTimeout(sharedTimer); clearTimeout(graceTimer);
  sharedTimer = null; graceTimer = null; openCount = 0; groupActive = false;
}

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
/** IxOverlays.jsx:368 — "Auto-flips when within 8px of a viewport edge." */
const EDGE = 8;

/** Room between the trigger and each viewport edge, in CSS px. */
function roomAround(rect) {
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  return { top: rect.top, bottom: vh - rect.bottom, left: rect.left, right: vw - rect.right };
}

export function Tooltip({ content, position = 'top', delay = 300, children, className = '' }) {
  const [visible, setVisible] = useState(false);
  // The placement actually used. Starts at the requested one and is corrected
  // after measurement — never the other way round, so a tooltip that fits
  // renders exactly where the caller asked for it.
  const [place, setPlace] = useState(position);
  const [dx, setDx] = useState(0);
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const openRef = useRef(false);
  const tipId = useId();

  const markClosed = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) {
      clearTimeout(graceTimer);
      // One macrotask, not a duration: it only has to outlive the
      // mouseleave→mouseenter pair of a single pointer move, and anything
      // longer would start granting the exemption to a genuine return.
      graceTimer = setTimeout(() => { groupActive = false; }, 0);
    }
  }, []);

  const show = useCallback(() => {
    clearTimeout(sharedTimer);
    clearTimeout(graceTimer);
    const open = () => {
      setPlace(position);            // re-measure from the requested side
      setDx(0);
      if (!openRef.current) { openRef.current = true; openCount += 1; }
      groupActive = true;
      setVisible(true);
    };
    // Already inside a tooltip group: swap instantly, no second dwell.
    if (groupActive) open();
    else sharedTimer = setTimeout(open, delay);
  }, [delay, position]);

  /**
   * Focus opens with no dwell at all, and that is an accessibility fix rather
   * than a preference. `aria-describedby` can only point at the tip while the
   * tip is mounted, and a screen reader reads a control's description at the
   * moment focus lands on it — 300ms later there is nothing left listening.
   * The dwell exists to stop tooltips firing as a POINTER crosses a toolbar;
   * a keyboard user never crosses anything, so there is nothing to suppress.
   */
  const showNow = useCallback(() => {
    clearTimeout(sharedTimer);
    clearTimeout(graceTimer);
    setPlace(position);
    setDx(0);
    if (!openRef.current) { openRef.current = true; openCount += 1; }
    groupActive = true;
    setVisible(true);
  }, [position]);

  const hide = useCallback(() => {
    clearTimeout(sharedTimer);
    markClosed();
    setVisible(false);
  }, [markClosed]);

  // Escape dismisses a tooltip that was opened by keyboard focus, per WCAG
  // 1.4.13 — content on hover or focus must be dismissable without moving the
  // pointer, and a focused control cannot be blurred to get rid of its tooltip.
  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') hide(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, hide]);

  useEffect(() => () => { clearTimeout(sharedTimer); markClosed(); }, [markClosed]);

  /**
   * Measure once, after the tip is in the DOM and before the browser paints.
   * `useLayoutEffect` and not `useEffect`: a tooltip that paints off-screen for
   * one frame and then jumps is more distracting than one that was never
   * misplaced, and this is the frame the whole 300ms dwell was spent earning.
   *
   * Guarded for jsdom, where every rect is zeros — an unguarded reading there
   * makes every tooltip believe it is 8px from all four edges at once and flip
   * on principle.
   */
  useLayoutEffect(() => {
    if (!visible) return;
    const tip = tipRef.current;
    const wrap = wrapRef.current;
    if (!tip || !wrap || typeof tip.getBoundingClientRect !== 'function') return;
    const t = tip.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (!vw || !vh || (!t.width && !t.height)) return;   // jsdom / not laid out

    // ── 1 · Flip, on the axis this placement travels on ──────────────────
    const room = roomAround(w);
    const need = (place === 'top' || place === 'bottom') ? t.height + EDGE : t.width + EDGE;
    const overflows =
      (place === 'top' && t.top < EDGE) ||
      (place === 'bottom' && t.bottom > vh - EDGE) ||
      (place === 'left' && t.left < EDGE) ||
      (place === 'right' && t.right > vw - EDGE);
    let next = place;
    // Only flip if the far side can actually hold it. Otherwise stay put and
    // let the shift below do what it can.
    if (overflows && room[OPPOSITE[place]] >= need) next = OPPOSITE[place];
    if (next !== place) { setPlace(next); return; }      // re-measures on the next pass

    // ── 2 · Shift on the cross axis ──────────────────────────────────────
    // The rightmost-toolbar-button case. Only the horizontal one is corrected:
    // top/bottom tips are centred horizontally and are the placement that
    // overhangs; left/right tips are centred vertically against a control that
    // is a few px tall, which does not overhang a viewport in practice.
    if (place === 'top' || place === 'bottom') {
      let shift = 0;
      if (t.right > vw - EDGE) shift = -(t.right - (vw - EDGE));
      else if (t.left < EDGE) shift = EDGE - t.left;
      // `Math.round` because a fractional translate on text triggers subpixel
      // re-rasterisation, which is exactly the blur a tooltip cannot afford.
      if (Math.round(shift) !== Math.round(dx)) setDx(Math.round(shift));
    }
  }, [visible, place, dx]);

  if (!content) return children;

  /**
   * THE LINK. `role="tooltip"` on the bubble named the thing but connected it
   * to nothing: without `aria-describedby` on the control itself, a screen
   * reader has no reason to ever read this text, and every tooltip in the
   * build was decoration that only sighted users received.
   *
   * The attribute goes on the CHILD, not on this wrapper — the wrapper is a
   * plain span that never takes focus, and a description is announced for the
   * focused element. Cloning is the only way to reach a child the caller
   * owns; a non-element child (a bare string) has nowhere to put it, so it is
   * passed through untouched rather than wrapped in a tabbable div it never
   * asked for.
   */
  const described = React.isValidElement(children) && visible
    ? React.cloneElement(children, { 'aria-describedby': tipId })
    : children;

  return (
    <span
      ref={wrapRef}
      className={`tipw ${className}`.trim()}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={showNow}
      onBlur={hide}
    >
      {described}
      {visible && (
        <span
          ref={tipRef}
          id={tipId}
          role="tooltip"
          className={`tip tip--${place}`}
          style={dx ? { '--tip-dx': `${dx}px` } : undefined}
        >
          {content}
        </span>
      )}
    </span>
  );
}

export default Tooltip;
