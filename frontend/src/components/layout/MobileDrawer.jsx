/**
 * MobileDrawer.jsx — the overlay sidebar at ≤1023px. 01-navigation.md §3.
 *
 * This is the replacement the `.kv__side { display: none }` media query is
 * required to ship with. The rule has broken three times in this project
 * (`.side`, `.adm__side`, the onboarding mobile surface); each time it left a
 * screen with no way out.
 *
 * It renders a SECOND Sidebar rather than moving the first, which is why the
 * media query hides the slot (`.kv__side`) and never `.side` itself — hiding
 * `.side` is exactly what makes a burger open an empty scrim.
 */
import React from 'react';
import Sidebar from './Sidebar';
import FocusTrap from '../ui/FocusTrap';

export default function MobileDrawer({ open, onClose, inboxCount = 0, approvalsCount = 0 }) {
  // Escape closes, matching every other overlay in the product.
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="kv__scrim" onClick={onClose}>
      {/* Wrap the panel, not the scrim — FocusTrap's own contract. */}
      <FocusTrap>
        <div
          className="kv__drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          onClick={e => e.stopPropagation()}
        >
          {/* forceWide: a rail inside a narrow overlay is a column of
              unlabelled icons with no reason to be narrow. */}
          <Sidebar
            inboxCount={inboxCount}
            approvalsCount={approvalsCount}
            forceWide
            onNavigate={onClose}
          />
        </div>
      </FocusTrap>
    </div>
  );
}
