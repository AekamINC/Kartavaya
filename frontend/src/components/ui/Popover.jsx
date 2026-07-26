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
 * The close path is `setClosing(true)` → unmount after EXIT_MS, not a bare
 * `setOpen(false)`. `.pop.is-closing { animation: dmPopOut }` has been in
 * components.css since the overlays landed and nothing ever set the class:
 * Popover is the only consumer of `.pop`, and it unmounted on the spot, so the
 * exit keyframe never played once and the panel simply vanished while Picker —
 * built from the same keyframe pair — faded out. Same 130ms as Picker, so the
 * two overlays leave at the same speed.
 */
const EXIT_MS = 130;

export function Popover({ trigger, children, align = 'left', label, width }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const timer = useRef(null);

  const close = useCallback(() => {
    setClosing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setClosing(false); setOpen(false); }, EXIT_MS);
  }, []);

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
          style={{ ...pos, ...(width ? { width } : null) }}>
          {typeof children === 'function' ? children({ close }) : children}
        </div>,
        document.body,
      )}
    </span>
  );
}

export default Popover;
