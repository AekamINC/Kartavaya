import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismiss } from '../../hooks/useDismiss';

/**
 * Popover — arbitrary content anchored to a trigger (02-common-components.md §2).
 *
 * Distinct from Menu, which holds a list of actions, and from Picker, which
 * holds a list of values. This one takes whatever you give it: a colour grid, a
 * filter panel, a small form. Same portal, same z-index 340, same Escape and
 * outside-click contract, so the three behave identically from the keyboard.
 *
 * `dmPop` grows from `transform-origin`, which must match the placement or the
 * panel appears to unfold from the wrong corner — `--right` flips it.
 *
 * The close path is `setClosing(true)` → unmount when the exit animation ends,
 * not a bare `setOpen(false)`. `.pop.is-closing { animation: dmPopOut }` has
 * been in components.css since the overlays landed and nothing ever set the
 * class: Popover is the only consumer of `.pop`, and it unmounted on the spot,
 * so the exit keyframe never played once and the panel simply vanished while
 * Picker — built from the same keyframe pair — faded out.
 *
 * THE UNMOUNT IS DRIVEN BY `animationend`, NOT A CONSTANT. It was a hardcoded
 * 130ms, and there is no value that constant could have held that would have
 * been right, because the CSS side is `--dur-fast`, i.e.
 * `calc(140ms * var(--ix))` — a duration the user's own Animations preference
 * scales and this number did not:
 *
 *   anim full     CSS 140ms · JS 130ms → unmounted 10ms early, exit clipped
 *   anim reduced  CSS  70ms · JS 130ms → 60ms of nothing after the fade ended
 *   anim none     CSS ~0ms  · JS 130ms → a user who asked for NO animation
 *                                        waits 130ms staring at a dead panel
 *
 * `--ix: .001` rather than 0 is what makes this reliable: a zero-duration
 * animation never fires `animationend` at all, which CustomizePanel.jsx already
 * documents as the reason for the .001. The timer stays as a ceiling for the
 * case where the panel is display:none'd or the animation is interrupted and
 * the event never arrives — it must sit ABOVE the CSS duration to be a fallback
 * rather than a race, which is the bug it used to be.
 */
const EXIT_FALLBACK_MS = 400;

export function Popover({ trigger, children, align = 'left', label, width }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const timer = useRef(null);

  // A ref as well as state: the `animationend` handler has to know whether this
  // is the EXIT animation finishing or the ENTRANCE one, and reading `closing`
  // from the handler's closure would give it the value from the render that
  // installed it. Without the guard, `dmPop` completing on open would call
  // finish() and the popover would close itself the instant it appeared.
  const closingRef = useRef(false);

  const finish = useCallback(() => {
    clearTimeout(timer.current);
    closingRef.current = false;
    setClosing(false);
    setOpen(false);
  }, []);

  const close = useCallback(() => {
    closingRef.current = true;
    setClosing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(finish, EXIT_FALLBACK_MS);
  }, [finish]);

  // `e.target !== e.currentTarget` filters animations bubbling up from the
  // panel's children — arbitrary content goes in here, so a spinner or a
  // shimmer inside it must not be read as the panel's own exit.
  const onExitEnd = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    if (!closingRef.current) return;
    finish();
  }, [finish]);

  useEffect(() => () => clearTimeout(timer.current), []);
  // See Menu.jsx: useDismiss takes one ref, and a portalled panel has two roots.
  // Testing only the trigger would treat every click inside the panel as an
  // outside click and close it before the click could do anything.
  const bothRef = useRef(null);
  bothRef.current = {
    contains: (n) => !!(rootRef.current?.contains(n) || panelRef.current?.contains(n)),
  };
  useDismiss(open, bothRef, close);

  useLayoutEffect(() => {
    if (!open) return;
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos(align === 'right'
      ? { top: r.bottom + 5, right: window.innerWidth - r.right }
      : { top: r.bottom + 5, left: r.left });
  }, [open, align]);

  return (
    <span ref={rootRef} className="anchor">
      <span role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (open) close(); else setOpen(true); } }}
      >
        {trigger}
      </span>
      {open && pos && createPortal(
        <div ref={panelRef} role="dialog" aria-label={label}
          className={`pop ${closing ? 'is-closing' : ''}`.trim()}
          onAnimationEnd={onExitEnd}
          style={{ ...pos, ...(width ? { width } : null) }}>
          {typeof children === 'function' ? children({ close }) : children}
        </div>,
        document.body,
      )}
    </span>
  );
}

export default Popover;
