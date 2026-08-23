/**
 * useTableSelection (04-boards-table-views.md §3).
 *
 * 04 lists these under `hooks/`. They live beside the views because the table
 * is their only consumer and this batch owns `components/views/**` — move them
 * to `hooks/` when a second view needs them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/* `useColumnResize` DELETED — it was the widths model this workstream
   replaced, and by the end of it nothing imported it.

   It kept a board's column widths in `localStorage['kv.table.widths.<board>']`
   and the task list's in `kv.taskslist.widths`: one device each, so a width
   dragged on a laptop did not exist on the desktop beside it. Both callers now
   read `hooks/useColumnPrefs`, which stores order, visibility and width on the
   server under one key per table — and `views/TableView.jsx` migrates whatever
   was in the old localStorage entry before retiring it, so nobody loses a
   layout they had already sized by hand.

   Its pointer-events fix is not lost: `ui/Table.jsx`'s `ColumnResizer` is
   pointer-based with `setPointerCapture` for exactly the reason recorded
   here — mouse events do not fire from a touch or a pen — and adds the
   keyboard handling this never had.

   `useTableSelection` below is untouched and still the only export. */

/**
 * Row selection with a shift-range anchor.
 *
 * The anchor is the last row toggled *without* shift. Shift-clicking selects the
 * span between it and the row clicked, in the order the table is currently
 * showing — so a range follows the sort the user is looking at, not the order
 * the server sent. Without an anchor, shift-click has to guess a start and picks
 * the first selected row, which after two clicks is never the one the user
 * meant.
 */
export function useTableSelection(orderedIds) {
  const [selected, setSelected] = useState(() => new Set());
  const anchor = useRef(null);

  // Rows that leave the view — filtered out, deleted, moved to another board —
  // must leave the selection with them, or "3 selected" acts on a task the user
  // can no longer see.
  useEffect(() => {
    setSelected(prev => {
      if (!prev.size) return prev;
      const live = new Set(orderedIds);
      const next = new Set([...prev].filter(id => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [orderedIds]);

  const toggle = useCallback((id, shiftKey) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (shiftKey && anchor.current != null) {
        const a = orderedIds.indexOf(anchor.current);
        const b = orderedIds.indexOf(id);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(orderedIds[i]);
          return next;
        }
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      anchor.current = id;
      return next;
    });
  }, [orderedIds]);

  const clear = useCallback(() => { anchor.current = null; setSelected(new Set()); }, []);

  const toggleAll = useCallback(() => {
    setSelected(prev => (prev.size ? new Set() : new Set(orderedIds)));
    anchor.current = null;
  }, [orderedIds]);

  const allSelected = orderedIds.length > 0 && selected.size === orderedIds.length;
  const someSelected = selected.size > 0 && !allSelected;

  return { selected, toggle, toggleAll, clear, allSelected, someSelected };
}
