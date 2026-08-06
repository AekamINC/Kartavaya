import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FocusTrap from './FocusTrap';

/**
 * BottomSheet — the snap-point half of the mobile sheet.
 *
 * ── WHY THIS EXISTS ALONGSIDE `Sheet.jsx`, WHICH IS NOT A DUPLICATE ───────
 * `ui/Sheet.jsx` already ships and is correct: it rises with `dmSheetIn`,
 * leaves with `dmSheetOut`, traps focus, locks body scroll and defers its
 * unmount to `animationend`. What it does NOT have is the thing MOTION-SPEC §5
 * and IxDrawer.jsx:386-397 actually specify for the task drawer — **two snap
 * points, 58% peek and 94% full, a grab handle that taps OR drags between
 * them, and dismissal on a swipe down past 40%**. A sheet with one fixed height
 * is a modal that happens to be at the bottom.
 *
 * The snap machinery is a POINTER concern, not a portal concern, so it lives
 * here as a hook — `useSheetSnap` — and this component is the hook plus the
 * same scrim/trap/scroll-lock shell `Sheet.jsx` has. The task drawer imports
 * the HOOK and keeps its own markup, because `.dr` is a 560px right-anchored
 * panel on desktop and only becomes a sheet under 768px; rebuilding it as two
 * components would give the same task two DOM trees and two sets of bugs.
 *
 * ── NO GESTURE LIBRARY, AND THAT IS A DECISION RATHER THAN A COMPROMISE ───
 * Pointer Events are the native API for exactly this: one event stream for
 * mouse, touch and pen, with `setPointerCapture` so a drag that leaves the
 * element still delivers its `pointerup` — which is the single bug that makes
 * people reach for a library. The one real hazard is the browser's own scroll
 * stealing the gesture, and `touch-action: none` on the drag surface (the grab
 * handle and the header, never the scrolling body) settles it in CSS.
 * `@hello-pangea/dnd` is already in the bundle for kanban; adding a second
 * gesture runtime for a 40-line drag would be the third motion vocabulary this
 * pass exists to prevent.
 *
 * ── THE NUMBERS, AND WHERE EACH COMES FROM ────────────────────────────────
 *   58% / 94%   IxDrawer.jsx:386-397 ("two snap points — 58% peek and 94%
 *               full"), matching `design-reference/motion.css:98-99`
 *               `.dm-sheet[data-snap="1"|"2"]`. The attribute is 1-based
 *               because the reference's is; a 0-based one would silently
 *               match `[data-snap="1"]` for the peek.
 *   40%         IxDrawer.jsx:390 dismiss rule — "swipe down past 40% on touch".
 *               Measured against the sheet's own height, not the viewport's, so
 *               the gesture means the same thing from either snap point.
 *   300ms       The rise. `calc(var(--dur-slow) * .84)` is the reference's own
 *               arithmetic (motion.css:97) and resolves to 302ms — written as a
 *               fraction of the token so it still follows `--ix`.
 *   6px         Movement below this is a TAP, not a drag. Kanban uses 3px for
 *               the same distinction (MOTION-SPEC §8); a finger on a handle is
 *               less precise than a mouse on a card, so this is doubled.
 */

/** IxDrawer.jsx:386-397. 1-based on the wire — see the note above. */
export const SNAP_POINTS = [0.58, 0.94];
/** Fraction of the sheet's own height that a downward drag must cross. */
const DISMISS_FRACTION = 0.4;
/** Below this, the pointer gesture is a tap on the handle. */
const TAP_SLOP = 6;

/**
 * The gesture and snap state for a bottom sheet.
 *
 * Returns prop bags rather than refs so the caller can decide WHICH parts of
 * its own markup are draggable. That distinction is load-bearing: the grab
 * handle and the header drag the sheet, and the scrolling body must not, or a
 * user scrolling a long task description drags the drawer shut instead.
 *
 * @param enabled   false on desktop — every handler becomes undefined so the
 *                  desktop panel carries no pointer listeners at all, rather
 *                  than carrying live ones guarded by a media query.
 */
export function useSheetSnap({ enabled = true, onDismiss, snaps = SNAP_POINTS, initial = 0 } = {}) {
  const [snap, setSnap] = useState(initial);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(null);

  // Coming back to desktop, or reopening, must not inherit a half-dragged
  // sheet — the offset is a transient of one gesture, never persisted state.
  useEffect(() => { if (!enabled) { setOffset(0); setDragging(false); start.current = null; } }, [enabled]);

  const nudge = useCallback((dir) => {
    setSnap((s) => Math.min(snaps.length - 1, Math.max(0, s + dir)));
  }, [snaps.length]);

  const onPointerDown = useCallback((e) => {
    if (!enabled) return;
    // Primary button / any touch contact only. A right-click on the handle
    // should open the context menu, not start a drag that never ends.
    if (e.button != null && e.button !== 0) return;
    const host = e.currentTarget.closest('[data-sheet]') || e.currentTarget;
    start.current = { y: e.clientY, h: host.getBoundingClientRect().height || 0, moved: false };
    setDragging(true);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* jsdom, and Safari on a released pointer */ }
  }, [enabled]);

  const onPointerMove = useCallback((e) => {
    if (!enabled || !start.current) return;
    const dy = e.clientY - start.current.y;
    if (Math.abs(dy) > TAP_SLOP) start.current.moved = true;
    // Downward only. Dragging UP is a snap change, and translating the sheet
    // above its own top edge would reveal a strip of scrim underneath it —
    // the sheet would appear to detach from the bottom of the screen. The
    // upward intent is read on release instead.
    setOffset(dy > 0 ? dy : 0);
  }, [enabled]);

  const finish = useCallback((e) => {
    if (!enabled || !start.current) return;
    const { y, h, moved } = start.current;
    const dy = (e?.clientY ?? y) - y;
    start.current = null;
    setDragging(false);
    setOffset(0);
    try { e?.currentTarget?.releasePointerCapture?.(e.pointerId); } catch { /* see above */ }

    if (!moved) { nudge(snap >= snaps.length - 1 ? -1 : 1); return; }   // tap toggles
    if (h > 0 && dy > h * DISMISS_FRACTION) { onDismiss?.(); return; }  // swipe down past 40%
    if (dy > TAP_SLOP) nudge(-1);
    else if (dy < -TAP_SLOP) nudge(1);
  }, [enabled, nudge, onDismiss, snap, snaps.length]);

  const cancel = useCallback(() => {
    start.current = null;
    setDragging(false);
    setOffset(0);
  }, []);

  // Arrow keys move between snaps and Enter/Space toggles, so the handle is a
  // real control rather than a touch-only affordance with a role bolted on.
  const onKeyDown = useCallback((e) => {
    if (!enabled) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nudge(snap >= snaps.length - 1 ? -1 : 1); }
  }, [enabled, nudge, snap, snaps.length]);

  const dragProps = enabled
    ? { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: cancel }
    : {};

  return {
    snap,
    setSnap,
    dragging,
    offset,
    /** Spread on the sheet element itself. */
    sheetProps: enabled
      ? {
        'data-sheet': '',
        'data-snap': String(snap + 1),
        // `is-dragging` suppresses the height transition, so the sheet tracks
        // the finger 1:1 instead of easing towards it a frame behind.
        'data-dragging': dragging ? '' : undefined,
        style: offset ? { transform: `translateY(${offset}px)` } : undefined,
      }
      : {},
    /** Spread on the grab handle. */
    grabProps: enabled
      ? {
        ...dragProps,
        onKeyDown,
        role: 'slider',
        tabIndex: 0,
        'aria-label': 'Sheet height',
        'aria-valuemin': 1,
        'aria-valuemax': snaps.length,
        'aria-valuenow': snap + 1,
        'aria-valuetext': snap === 0 ? 'Peek' : 'Full height',
      }
      : {},
    /** Spread on any additional drag surface — a header, a title row. */
    dragProps,
  };
}

/**
 * The standalone component: scrim + focus trap + scroll lock + the hook.
 *
 * `EXIT_FALLBACK_MS` is a CEILING and not the exit duration, for the reason
 * `Sheet.jsx` documents at length: the real unmount is driven by
 * `animationend`, and a flat constant would out-live the animation at
 * Animations = None and cut it short at Reduced.
 */
const EXIT_FALLBACK_MS = 600;

export function BottomSheet({
  open, onClose, title, label, children,
  snaps = SNAP_POINTS, initialSnap = 0,
}) {
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);
  const closingRef = useRef(false);

  const finish = useCallback(() => {
    clearTimeout(timer.current);
    closingRef.current = false;
    setClosing(false);
    onClose?.();
  }, [onClose]);

  const close = useCallback(() => {
    closingRef.current = true;
    setClosing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(finish, EXIT_FALLBACK_MS);
  }, [finish]);

  const { snap, sheetProps, grabProps } = useSheetSnap({ enabled: open, onDismiss: close, snaps, initial: initialSnap });

  // Bound to the panel: `bshIn` fires `animationend` too, so without the ref
  // guard the sheet would dismiss itself the moment it finished rising.
  const onExitEnd = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    if (!closingRef.current) return;
    finish();
  }, [finish]);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  if (!open) return null;

  return createPortal(
    <>
      <div className={`bsh__scrim${closing ? ' is-closing' : ''}`} onClick={close} role="presentation" />
      <FocusTrap active={open}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label || title}
          className={`bsh${closing ? ' is-closing' : ''}`}
          onAnimationEnd={onExitEnd}
          {...sheetProps}
        >
          <div className="bsh__grab" {...grabProps}><i /></div>
          {title && (
            <div className="bsh__head">
              <h2 className="bsh__title">{title}</h2>
            </div>
          )}
          <div className="bsh__body" data-snap-body={String(snap + 1)}>{children}</div>
        </div>
      </FocusTrap>
    </>,
    document.body,
  );
}

export default BottomSheet;
