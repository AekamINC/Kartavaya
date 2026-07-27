import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import FocusTrap from '../../components/ui/FocusTrap';
import { useExitAnimation } from '../../hooks/useExitAnimation';

/**
 * SlideOver — one right-side detail panel for the console.
 *
 * `Modal` is centred and `Sheet` is a bottom sheet for mobile; neither is a
 * right-side panel, so `AdminPage.jsx` and `AdminOrgsPage.jsx` each hand-rolled
 * one out of inline styles. Between them: two scrim colours, two widths, two
 * shadows, `role="dialog"` on one and nothing on the other, no focus trap in
 * either, and no Escape key in either — so a keyboard user could open the org
 * detail panel and then tab straight out of it into the page underneath.
 *
 * Focus is trapped and restored by the same <FocusTrap> that Modal and
 * ConfirmDialog use, which is careful about the case that matters here: the row
 * that opened the panel can be gone by the time the panel closes (you just
 * removed that member), and FocusTrap checks `isConnected` before restoring.
 */
export default function SlideOver({ open, onClose, title, subtitle, children, footer }) {
  // It slid in over 220ms and then ceased to exist — `if (!open) return null`,
  // the same defect Modal, ConfirmDialog and the command palette carried. See
  // hooks/useExitAnimation.js for why the unmount waits on `animationend`.
  const { alive, closing, onAnimationEnd } = useExitAnimation(open);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Keyed on `alive`, not `open`: releasing the lock the moment the parent flips
  // `open` lets the console scroll under a panel that is still on screen.
  useEffect(() => {
    if (!alive) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [alive]);

  if (!alive) return null;

  return createPortal(
    <>
      {/* A real button, so the scrim is reachable and announced rather than
          being a div that happens to have an onClick. */}
      <button
        type="button"
        className={`aso__scrim ${closing ? 'is-closing' : ''}`.trim()}
        aria-label="Close panel"
        aria-hidden={closing || undefined}
        onClick={onClose}
      />
      <FocusTrap active={open}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          aria-hidden={closing || undefined}
          className={`aso ${closing ? 'is-closing' : ''}`.trim()}
          onAnimationEnd={onAnimationEnd}
        >
          <header className="aso__head">
            <div className="aso__titles">
              <h2 className="aso__t">{title}</h2>
              {subtitle && <p className="aso__sub">{subtitle}</p>}
            </div>
            <button type="button" className="aso__x" aria-label="Close" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="M2 2l10 10M12 2L2 12" />
              </svg>
            </button>
          </header>
          <div className="aso__body">{children}</div>
          {footer && <div className="aso__foot">{footer}</div>}
        </div>
      </FocusTrap>
    </>,
    document.body,
  );
}
