/**
 * useColumnResize · useTableSelection (04-boards-table-views.md §3).
 *
 * 04 lists these under `hooks/`. They live beside the views because the table
 * is their only consumer and this batch owns `components/views/**` — move them
 * to `hooks/` when a second view needs them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Column widths, dragged by a grip in the header.
 *
 * **Pointer events, not mouse events.** The list page's `useResizableCols` binds
 * `mousemove`/`mouseup`, which do not fire from a touch or a pen, so the grip is
 * dead on the devices most likely to need a narrower column. Pointer events
 * cover all three inputs with one listener, and `setPointerCapture` keeps the
 * drag alive when the pointer leaves the 7px grip — which it does immediately,
 * because a 7px target is narrower than a hand can hold still.
 */
export function useColumnResize(columns, storageKey) {
  const [widths, setWidths] = useState(() => {
    const base = Object.fromEntries(columns.map(c => [c.key, c.width]));
    if (!storageKey) return base;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      for (const [k, v] of Object.entries(saved)) {
        if (typeof v === 'number' && k in base) base[k] = v;
      }
    } catch { /* corrupt entry — the defaults are a fine answer */ }
    return base;
  });
  const [activeKey, setActiveKey] = useState(null);
  const drag = useRef(null);

  // Columns can appear after mount — showing a hidden custom field adds one. A
  // column with no entry here gets `width: undefined`, and under
  // `table-layout: fixed` that collapses the cell to nothing. Reconcile by key:
  // add what is new, leave what the user has already dragged.
  const signature = columns.map(c => c.key).join('|');
  useEffect(() => {
    setWidths(prev => {
      const missing = columns.filter(c => !(c.key in prev));
      if (!missing.length) return prev;
      const next = { ...prev };
      for (const c of missing) next[c.key] = c.width;
      return next;
    });
    // `signature` stands in for `columns`, which is a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Persist on settle, not on every frame: a resize is ~60 writes a second and
  // localStorage is synchronous.
  useEffect(() => {
    if (!storageKey || activeKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch { /* quota or private mode */ }
  }, [widths, activeKey, storageKey]);

  const onPointerDown = useCallback((e, key, min = 80) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { key, startX: e.clientX, startW: widths[key], min, node: e.currentTarget };
    setActiveKey(key);
  }, [widths]);

  const onPointerMove = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    setWidths(prev => ({ ...prev, [d.key]: Math.max(d.min, d.startW + e.clientX - d.startX) }));
  }, []);

  const onPointerUp = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    d.node?.releasePointerCapture?.(e.pointerId);
    drag.current = null;
    setActiveKey(null);
  }, []);

  return { widths, activeKey, onPointerDown, onPointerMove, onPointerUp };
}

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
