import { useEffect, useRef } from 'react';

/**
 * Restores focus to the element that was active when `active` became true.
 *
 * For overlays that manage their own focus and so cannot use <FocusTrap>.
 * If you are already wrapping in FocusTrap you do not need this — it does the
 * same restore in its own cleanup.
 *
 * The capture must happen before the overlay moves focus inward. This hook runs
 * its capture in a layout-ordered effect and reads `document.activeElement`
 * once, on the transition into `active`, for that reason.
 */
export default function useRestoreFocus(active) {
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      triggerRef.current?.focus?.({ preventScroll: true });
      triggerRef.current = null;
    };
  }, [active]);

  return triggerRef;
}
