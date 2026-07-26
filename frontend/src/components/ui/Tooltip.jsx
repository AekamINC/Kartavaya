import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tooltip — 300ms delay in, INSTANT out (26-component-inventory.md §6).
 *
 * Converted off Tailwind. It was `bg-gray-900 dark:bg-gray-100` with
 * `text-[11px]` and `animate-in fade-in-0 zoom-in-95` — a palette outside the
 * token system entirely, so it neither followed the theme nor the user's
 * motion preference, and at 11px white-on-#111 it was the one piece of chrome
 * nobody could restyle from `00-tokens.md`.
 *
 * The asymmetry is the point: `dmTip` has an entrance and no exit. A tooltip
 * that fades out follows the cursor to the next control and reads as lag — so
 * it is unmounted on the spot, and the timer is cleared rather than left to
 * fire over a control the pointer has already left.
 */
export function Tooltip({ content, position = 'top', delay = 300, children, className = '' }) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef(null);

  const show = useCallback(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  }, []);

  // Escape dismisses a tooltip that was opened by keyboard focus, per WCAG
  // 1.4.13 — content on hover or focus must be dismissable without moving the
  // pointer, and a focused control cannot be blurred to get rid of its tooltip.
  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') hide(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, hide]);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  if (!content) return children;

  return (
    <span
      className={`tipw ${className}`.trim()}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && <span role="tooltip" className={`tip tip--${position}`}>{content}</span>}
    </span>
  );
}

export default Tooltip;
