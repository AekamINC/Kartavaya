import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
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
 */
export function Popover({ trigger, children, align = 'left', label, width }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const panelRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);
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
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
      >
        {trigger}
      </span>
      {open && pos && createPortal(
        <div ref={panelRef} role="dialog" aria-label={label} className="pop"
          style={{ ...pos, ...(width ? { width } : null) }}>
          {typeof children === 'function' ? children({ close }) : children}
        </div>,
        document.body,
      )}
    </span>
  );
}

export default Popover;
