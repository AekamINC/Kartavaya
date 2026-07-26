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
/**
 * A CEILING, not the exit duration — the unmount is driven by `animationend`.
 *
 * `.sheet.is-closing` is `dmSheetOut var(--dur-base)`, i.e.
 * `calc(220ms * var(--ix))`. The old constant was a flat 220, which matched only
 * when the user's Animations preference was `full`: at `reduced` the sheet had
 * finished leaving after 110ms and the route stayed blocked for another 110,
 * and at `none` the sheet was gone in under a millisecond while the app held
 * `overflow: hidden` on the body for the full 220 — a scroll lock outliving the
 * thing it was locking for, on the setting that asks for no animation at all.
 */
const EXIT_FALLBACK_MS = 600;

export function Sheet({ open, onClose, title, children, label }) {
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);
  // See Popover.jsx. `dmSheetIn` fires `animationend` too, so without this the
  // sheet would dismiss itself the moment it finished rising.
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

  // Bound to the panel, not the scrim: the two animate together but the panel
  // is the one whose travel has to complete before the route is released.
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
        <div role="dialog" aria-modal="true" aria-label={label || title} className={`sheet ${closing ? 'is-closing' : ''}`.trim()} onAnimationEnd={onExitEnd}>
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
