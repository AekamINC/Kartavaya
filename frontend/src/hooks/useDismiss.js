import { useEffect } from 'react';

/**
 * Dismiss an open popup on outside click or Escape.
 *
 * Four near-identical copies of the outside-click effect existed — TaskDrawer
 * (the assignee dropdown, whose handler lived two levels up from the component
 * that renders it), DrawerSubtasks, DropdownField and StatusField — and NONE of
 * them handled Escape. Every dropdown in the drawer could only be dismissed by
 * clicking elsewhere, which is a keyboard trap: a user who opens one with the
 * keyboard has no keyboard way to close it without committing a selection.
 *
 * Two details that the copies got right and are preserved:
 *  · `mousedown`, not `click`. A `click` listener fires after the target has
 *    already handled its own mousedown, so a control that re-renders on press
 *    can swallow the dismissal.
 *  · The listener is only attached while open, so a page of closed dropdowns
 *    costs nothing.
 *
 * Escape is bound on keydown at the document, and stops propagation so that
 * dismissing a dropdown inside the task drawer does not also close the drawer
 * behind it — closing two layers on one keypress is the usual bug here.
 */
export function useDismiss(open, ref, onDismiss) {
  useEffect(() => {
    if (!open) return undefined;

    const onPointer = e => {
      if (ref.current && !ref.current.contains(e.target)) onDismiss();
    };
    const onKey = e => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onDismiss();
    };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, ref, onDismiss]);
}

export default useDismiss;
