import React, { useEffect } from "react";
import { Button } from "./Button";
import FocusTrap from "./FocusTrap";

/**
 * Modal — scrim, focus trap, Escape, scroll lock.
 *
 * Converted off the static Tailwind palette. It was styled with
 * `bg-bgDefault/90` (#F6F3EC, cream) and `border-borderDefault/60` (#e2e6ed,
 * near-white) and carried no `dark:` variants, so in dark mode it rendered a
 * cream panel with a near-white border floating over a near-black app. Same
 * defect as StatusBar and Tabs. Nobody had noticed because the component had
 * zero call sites — every dialog in the app was hand-rolled instead, and those
 * copies have no focus trap, no Escape handler and no role="dialog".
 *
 * Body scroll lock is new. Without it the page behind scrolls under the scrim
 * on wheel and on arrow keys, which makes the dialog feel detached and loses
 * the user's place in the list they were working from.
 */
export function Modal({ open, onOpenChange, title, children, footer, dataTestId, size = 'md' }) {
  const titleId = dataTestId ? `${dataTestId}-title` : "modal-title";

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        // Stop the key reaching a parent overlay — a dialog opened from inside
        // a drawer must close only itself, not both.
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKey);

    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onOpenChange]);

  // Focus restore lives in <FocusTrap>, which captures the trigger before moving
  // focus inward and restores it in its own cleanup. A second copy here would
  // fire two restores on every close.

  if (!open) return null;

  return (
    <div
      data-testid={dataTestId}
      role="presentation"
      className="modal__scrim"
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <FocusTrap active={open}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`modal__panel modal__panel--${size}`}
        >
          <div className="modal__head">
            <h2 id={titleId} data-testid={`${dataTestId}-title`} className="modal__title">
              {title}
            </h2>
            <Button
              data-testid={`${dataTestId}-close`}
              variant="ghost"
              size="sm"
              aria-label="Close dialog"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
          <div className="modal__body">{children}</div>
          {footer ? <div className="modal__foot">{footer}</div> : null}
        </div>
      </FocusTrap>
    </div>
  );
}

export default Modal;
