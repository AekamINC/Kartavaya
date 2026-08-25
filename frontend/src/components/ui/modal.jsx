import React, { useEffect } from "react";
import { Button } from "./Button";
import FocusTrap from "./FocusTrap";
import { useExitAnimation } from "../../hooks/useExitAnimation";

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
 *
 * THE EXIT. This ended `if (!open) return null` — an entrance of 262ms
 * (scrim 220ms, panel 220ms starting 42ms in) followed by a hard cut. The exit
 * now plays `.is-closing` on both layers and the node survives until
 * `animationend`; see `hooks/useExitAnimation.js` for why that is an event and
 * not a timer. `open` still means what it always meant to the caller — the hook
 * absorbs the difference between "the parent says closed" and "the pixels have
 * gone".
 */
export function Modal({ open, onOpenChange, title, children, footer, dataTestId, size = 'md' }) {
  const titleId = dataTestId ? `${dataTestId}-title` : "modal-title";
  const { alive, closing, onAnimationEnd } = useExitAnimation(open);

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
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // The scroll lock is keyed on `alive`, NOT on `open`. Releasing it the moment
  // the parent flips `open` would let the page scroll under a dialog that is
  // still on screen and still 98% opaque, and the content would jump behind the
  // panel it is fading out through. Sheet.jsx documents the mirror-image bug:
  // a lock that outlives its overlay.
  useEffect(() => {
    if (!alive) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [alive]);

  // Focus restore lives in <FocusTrap>, which captures the trigger before moving
  // focus inward and restores it in its own cleanup. A second copy here would
  // fire two restores on every close. `active={open}` and not `alive`: focus
  // goes back to the trigger when the user dismisses, not 140ms later once the
  // pixels have caught up.

  if (!alive) return null;

  return (
    <div
      data-testid={dataTestId}
      role="presentation"
      className={`modal__scrim ${closing ? 'is-closing' : ''}`.trim()}
      // A dialog on its way out is closed as far as the accessibility tree is
      // concerned. Without this the screen reader still sees an open modal for
      // the length of the exit, and focus has already left it.
      aria-hidden={closing || undefined}
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <FocusTrap active={open}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`modal__panel modal__panel--${size} ${closing ? 'is-closing' : ''}`.trim()}
          onAnimationEnd={onAnimationEnd}
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

/**
 * Modal · ModalHead · ModalBody · ModalFoot — the tree 02 §2 asks for.
 *
 * `<Modal>` composes all three from `title` / `children` / `footer`, which is
 * what every call site wants. These are the escape hatch for the dialog that
 * needs something else in its header — a status chip beside the title, a
 * back arrow in a two-step flow — without rebuilding the scrim, the focus trap
 * and the Escape handler around it, which is how the app ended up with a dozen
 * hand-rolled dialogs that have none of the three.
 */
export const ModalHead = ({ children, className = '' }) =>
  <div className={`modal__head ${className}`.trim()}>{children}</div>;

export const ModalBody = ({ children, className = '' }) =>
  <div className={`modal__body ${className}`.trim()}>{children}</div>;

export const ModalFoot = ({ children, className = '' }) =>
  <div className={`modal__foot ${className}`.trim()}>{children}</div>;

export default Modal;
