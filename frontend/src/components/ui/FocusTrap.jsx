import React, { useEffect, useRef } from 'react';

const SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Keeps Tab inside an overlay and restores focus to whatever opened it.
 *
 * Wrap the panel, not the scrim:
 *   <div className="scrim">
 *     <FocusTrap active={open}>
 *       <div role="dialog">…</div>
 *     </FocusTrap>
 *   </div>
 *
 * Three details that are easy to get wrong, all deliberate:
 *
 * - `preventScroll` on both focus calls. Without it, focusing inside a
 *   transformed drawer scrolls the page behind the scrim, and restoring on
 *   close jumps the board back to wherever the trigger was.
 * - The focusable list is rebuilt on every keypress, not cached at mount, and
 *   filtered on `offsetParent`. A drawer whose Comments tab is inactive still
 *   has focusable buttons in the DOM; tabbing to an invisible button is worse
 *   than not trapping at all.
 * - Focus is restored in the cleanup, to the element captured *before* anything
 *   inside received focus. Capturing it later returns focus to a child that is
 *   about to unmount, which drops the user at <body>.
 * - The captured element is checked for `isConnected` before being focused.
 *   Capturing the right element is not enough if that element is gone by the
 *   time the overlay closes: delete a task and the row holding the trigger
 *   unmounts, so `focus()` on it is a silent no-op and the user still lands at
 *   <body>. That is the destructive path, which is exactly where ConfirmDialog
 *   is used most. When the trigger has gone, focus falls back to the main
 *   landmark so a keyboard user resumes inside the content rather than at the
 *   top of the document.
 */
export default function FocusTrap({ children, active = true, initialFocus }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    const root = ref.current;

    // Captured before we move focus anywhere — see note above.
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const visible = () => [...root.querySelectorAll(SELECTOR)].filter((el) => el.offsetParent !== null);

    const first = initialFocus?.current ?? visible()[0] ?? root;
    first.focus({ preventScroll: true });

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const items = visible();
      if (!items.length) { e.preventDefault(); return; }
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        items[items.length - 1].focus({ preventScroll: true });
      } else if (!e.shiftKey && i === items.length - 1) {
        e.preventDefault();
        items[0].focus({ preventScroll: true });
      }
    };

    root.addEventListener('keydown', onKeyDown);
    return () => {
      root.removeEventListener('keydown', onKeyDown);

      if (previous?.isConnected) {
        previous.focus({ preventScroll: true });
        return;
      }

      // The trigger unmounted while the overlay was open — the destructive
      // case. Land on the main landmark instead of <body>. `tabindex="-1"` is
      // set only if absent, and left in place: it makes the element
      // programmatically focusable without adding it to the Tab order, so a
      // second restore behaves the same as the first.
      const fallback = document.querySelector('[data-focus-fallback]') || document.querySelector('main');
      if (!fallback) return;
      if (!fallback.hasAttribute('tabindex')) fallback.setAttribute('tabindex', '-1');
      fallback.focus({ preventScroll: true });
    };
  }, [active, initialFocus]);

  // display:contents keeps the wrapper out of layout, so adding a trap
  // cannot shift a pixel of the panel it wraps.
  return (
    <div ref={ref} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
