import { createContext, useContext } from 'react';

/**
 * columnsSlot — where a table's "Columns…" control goes when the table already
 * has a toolbar.
 *
 * ── The problem, and why it is not a prop ──────────────────────────────────
 *
 * `<DataTable arrange>` renders its own trailing-aligned bar, because the ~56
 * tables it reaches sit bare inside a Section or a Panel with nothing to hang
 * a control from. Four of them do NOT: `manav/NoticesTab` (twice),
 * `manav/DscTab` and `manav/UdinTab` render a `<TableToolbar>` immediately
 * above the table, so those pages grew a second toolbar line holding one
 * button — two rows of chrome for one table, which is the exact complaint that
 * got `ViewToolbar` removed from `views/TableView.jsx` in the first place.
 *
 * The obvious fix is `<TableToolbar cols={cols}>`. It does not work, and the
 * reason is worth writing down: the toolbar and the table are SIBLINGS, and
 * `cols` comes from a `useColumnPrefs` call that lives inside `DataTable`. To
 * pass it, every one of those pages would have to hoist the hook — which is
 * the seventy-file edit `arrangeDataTable.jsx` exists to avoid — and would
 * then have to keep its own copy in step with the table's.
 *
 * Lifting the hook to a second call site is worse still: two instances of the
 * same key share the module cache but not their local `saved` state, so a save
 * made through the toolbar's copy would not reach the table's until a refetch.
 * One table, two disagreeing opinions about its own columns.
 *
 * So the control stays with the ONE hook instance and moves through the DOM
 * instead. `TableToolbar` publishes an empty node; `ArrangedDataTable` renders
 * its button into that node with a portal when one is offered, and into its own
 * bar when none is. The page opts in by wrapping the pair — which is also the
 * honest signal, because "these two elements belong to the same table" is a
 * fact only the page knows.
 */

/** The toolbar's node, or null when there is no toolbar to render into. */
export const ColumnsSlotContext = createContext(null);

/** `[node, setNode]` — the provider is a plain state pair so the portal
 *  re-renders once the toolbar's element actually exists. A ref alone would
 *  land after the first paint and never trigger it. */
export const ColumnsSlotSetContext = createContext(null);

export const useColumnsSlot = () => useContext(ColumnsSlotContext);
export const useColumnsSlotSetter = () => useContext(ColumnsSlotSetContext);
