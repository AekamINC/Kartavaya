import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FocusTrap from './FocusTrap';

/**
 * Bottom sheet — the mobile form of a modal (02-common-components.md §2).
 *
 * `dmSheetIn` / `dmSheetOut` is the ONE symmetric keyframe pair in the system
 * (26 §6): every other exit travels less than its entrance, but a sheet that
 * exits partway looks stuck rather than gracious — it has to clear the
 * viewport. The exit therefore has to finish before unmount, which is what the
 * `closing` state buys.
 *
 * Focus is trapped and restored by <FocusTrap>, the same component Modal and
 * ConfirmDialog use, so a sheet is not a third place where Tab walks out into
 * the page behind the scrim.
 */
const EXIT_MS = 220;

export function Sheet({ open, onClose, title, children, label }) {
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);

  const close = useCallback(() => {
    setClosing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setClosing(false); onClose?.(); }, EXIT_MS);
  }, [onClose]);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();          // close the sheet, not the drawer behind it
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
      <div className={`sheet__scrim ${closing ? 'is-closing' : ''}`.trim()} onClick={close} />
      <FocusTrap active={open}>
        <div role="dialog" aria-modal="true" aria-label={label || title} className={`sheet ${closing ? 'is-closing' : ''}`.trim()}>
          <button type="button" className="sheet__grab" aria-label="Close" onClick={close}><i /></button>
          {title && (
            <div className="sheet__head">
              <h2 className="sheet__title">{title}</h2>
            </div>
          )}
          <div className="sheet__body">{children}</div>
        </div>
      </FocusTrap>
    </>,
    document.body,
  );
}

export default Sheet;
