import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../lib/api';
import { logger } from '../../lib/utils';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../lib/statusColors';

import TaskDrawer from '../TaskDrawer';
import FieldRenderer from '../fields/FieldRenderer';
import {
  AvatarStack, Checkbox, DueChip, EmptyState, nextSort, useToast,
} from '../ui';

import BulkBar from './BulkBar';
import { groupTasks, PRIORITY_RANK } from './grouping';
import { useColumnResize, useTableSelection } from './tableHooks';

/**
 * TableView — sortable, filterable, groupable, selectable task table
 * (04-boards-table-views.md §5).
 *
 * The five defects 04 names, and what each is now:
 *
 *  1 · **Sort was two-state and reflowed the header.** It appended `' ↑'` to
 *      the label text, so toggling sort widened the cell and every column
 *      beside it shifted. It is now the `.tbl__sort` button from
 *      `ui/Table.jsx`: a 12px SVG slot that holds its space and fades in, and
 *      `nextSort` — ascending → descending → **none**. The third state matters
 *      because none is `sort_order`, the board's manual sequence, and a
 *      two-state sort gives a user no way back to it.
 *  2 · **`:hover` was an inline style.** `onMouseEnter` wrote
 *      `e.currentTarget.style.background`, an inline declaration that then
 *      outranks any selection or focus styling added later — which is exactly
 *      what happened the moment rows became selectable. It is CSS now.
 *  3 · **Grouping was insertion-ordered.** `Object.entries` listed priority
 *      groups in whatever order rows arrived, so adding one task could
 *      reshuffle the page. `grouping.js` emits declared order.
 *  4 · **The field-visibility reset.** `useEffect(… , [fieldDefs?.length])`
 *      rebuilt the visible list from scratch whenever a field was added or
 *      removed, discarding every column the user had hidden. Visibility is
 *      persisted per board and reconciled **by id** — a new field appears, an
 *      existing choice is left alone — and now lives in `useBoardView` with the
 *      control that sets it. This file takes `shownFields`.
 *  5 · **The `<details>` field menu.** It did not close on outside click, did
 *      not close on Escape, and announced as a disclosure. It is a `Popover`
 *      in `BoardToolbar`, which owns all three. 04 names `Menu`; `Menu` closes
 *      on select, and this is a multi-toggle list where that turns hiding three
 *      columns into six round trips. `Popover` is the same portal, the same
 *      z-index, the same Escape and outside-click contract — it just does not
 *      dismiss on pick.
 *
 * `--danger` for overdue, not `--k-danger`: the two were used in sibling files
 * for the same colour and one of them is undefined. Both are gone from here —
 * overdue tone belongs to `DueChip`.
 *
 * **The toolbar is not here any more.** This file used to render its own
 * `ViewToolbar` — search, group, field visibility and the `FilterBuilder` —
 * inside a page that had already rendered one, so Table view showed two stacked
 * `.vtb` bars and every control moved to a different row when you switched
 * view. Worse, it meant search and filter reached the table and nothing else:
 * the other six views, Kanban included, had no way to narrow anything. That
 * state is `useBoardView` now, the bar is `BoardToolbar`, and this component
 * receives the already-filtered set. It renders a table.
 */

/**
 * The reference's task table (`ScreensWork.jsx:63`) is
 * `Task · Project · Assignees · Due · Status`. This build shipped
 * `Title · Column · Priority · Created by · Due`.
 *
 * Two of those differences are deliberate and stay: `Column` IS the status here
 * (the board's columns are user-defined, so there is no fixed Status
 * vocabulary to render), and `Priority` is a column rather than the reference's
 * row-group dot because grouping is a toolbar choice in this build, not a fixed
 * layout.
 *
 * `Created by` is not deliberate. No prototype table anywhere carries it, and
 * it took the slot the one column every prototype table has — who is on this.
 * "Whose is this" is the question a task list is scanned for; "who typed it in"
 * is a provenance field, and provenance belongs in the drawer, which shows it.
 *
 * No backend change: `assignee_names` and `assignee_user_ids` are already on
 * these exact objects — `TaskCard.jsx:52-53` reads them off the same payload.
 * Sorting is by the first assignee's name, which is what a reader of a sorted
 * column expects; unassigned sorts last in both directions the same way an
 * undated task does, and for the same reason.
 */
const BASE_COLS = [
  { key: 'title', label: 'Title', sortKey: 'title', width: 320, min: 160 },
  { key: 'column_id', label: 'Column', sortKey: 'column_id', width: 150, min: 110 },
  { key: 'priority', label: 'Priority', sortKey: 'priority', width: 120, min: 100 },
  { key: 'assignees', label: 'Assignees', sortKey: 'assignees', width: 150, min: 110 },
  { key: 'due_at', label: 'Due', sortKey: 'due_at', width: 150, min: 120 },
];

/**
 * INLINE CELL EDIT — `IxViews.jsx` §10.3, whose "today" line reads: "Every edit
 * goes through the drawer. The table is read-only, which is why people export to
 * Excel." That was true of this file for every column except the custom fields.
 *
 * **What is editable, and why exactly these four.** 10.3 says "Status, priority
 * and assignee are single-click because they are pick-one fields. Text cells
 * need a double-click, so a click can still select the row."
 *
 *   · `column_id` — this build's Status (the header note above says why).
 *   · `priority`
 *   · `assignees`
 *   · `due_at` — not named in 10.3, but it is the same shape: one control, one
 *     commit, and `BulkBar` already writes it through the same field.
 *
 * `title` is NOT editable here and that is the deliberate half. 10.3 gives text
 * cells a double-click "so a click can still select the row" — but in this build
 * a click on the title already does something else: it is a real `<button>` that
 * opens the drawer, which is the ONLY keyboard route into a task from this
 * table. Layering dblclick-to-edit over click-to-open means the editor can only
 * be reached by first opening the drawer you were trying not to open. The
 * drawer's title field is one keystroke away and is not lying to anyone.
 *
 * **The write path is the one that already exists** — `PATCH /v1/tasks/bulk`
 * with a single id, the same route `BulkBar` in this directory uses, whose
 * `BulkTaskPatch` (`routers/tasks_bulk.py:170`) declares exactly
 * `status · column_id · priority · category_id · assignee_user_ids · tags ·
 * due_at`. Nothing here is a new endpoint and nothing here is a field the
 * server does not already accept. Using it rather than `PUT /tasks/{id}` buys
 * two things: the route answers the AUTHORITATIVE status (moving into a column
 * flagged `is_done` forces `done`, which a naive local merge would get wrong and
 * a hand-dragged card would then disagree with), and a refusal comes back as
 * `{ok: false, error}` on a 200 rather than as a thrown request, so "the server
 * said no" and "the network died" stay distinguishable.
 *
 * **What is deliberately not built.** An assignee cell on a row that already
 * has TWO OR MORE people stays a plain cell. `assignee_user_ids` is a list and
 * a one-pick `<select>` can only REPLACE it — a single click would silently drop
 * two people off a task, which is a write the user did not ask for. Those rows
 * route to the drawer, which has the multi-picker. Same rule for a board with no
 * columns loaded and for a page that passes no `teamMembers`: no options means
 * no editor, not an empty one.
 *
 * 10.3's handler line is "Optimistic PATCH per cell. On failure the old value
 * returns and the cell tints `--danger-container` for 1.6s" — both halves are
 * below, and the exit line's "one `--primary` flash to confirm the save" is
 * `.is-saved`.
 */
const SAVED_FLASH_MS = 620;
/** 10.3, handler: the failure tint holds for 1.6s. */
const FAILED_TINT_MS = 1600;

/**
 * `due_at` → the `YYYY-MM-DD` a `<input type="date">` wants, in LOCAL time.
 *
 * `toISOString().slice(0,10)` is the obvious version and it is off by a day for
 * half of every Indian evening: a task due 23:00 IST is 17:30 UTC the same day,
 * but one due 04:00 IST is 22:30 UTC the day BEFORE. `DueChip` renders the local
 * date, so an editor seeded from the UTC one would open showing a different day
 * than the cell it replaced.
 */
function dateInputValue(due) {
  if (!due) return '';
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A cell that MIGHT be an editor.
 *
 * The `editable: false` branch returns the children BARE — no wrapper, no
 * disabled button. That is the whole reason this exists rather than a
 * `disabled` prop on a `<button>`: a disabled button swallows the click
 * entirely. It does not fire and it does not bubble, so the row's `onClick`
 * never runs and a cell that merely cannot be edited inline would ALSO stop
 * opening the task drawer — strictly worse than the read-only cell it replaced,
 * and the exact regression the first draft of this shipped.
 *
 * Three cells take that branch and each has a reason the user can act on:
 * a board whose columns have not loaded, a page that passes no roster, and a
 * task with two or more assignees. All three route to the drawer, as they did
 * before any of this existed.
 */
function CellTrigger({ editable, className, onClick, children }) {
  if (!editable) return children;
  return (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * A sortable, resizable header cell.
 *
 * `ui/Table.jsx`'s `HeadCell` renders the label inside the sort button, and the
 * resize grip has to live in the `<th>` but outside that button — a grip inside
 * a button is a grip that sorts the column every time you finish dragging it.
 * So this reuses the primitive's state machine (`nextSort`) and its class
 * (`.tbl__sort`, including the reserved-width chevron) rather than its markup.
 */
function Th({ col, sort, onSort, width, onGrip, gripActive }) {
  const dir = sort?.key === col.sortKey ? sort.dir : null;
  return (
    <th scope="col" style={{ width }} aria-sort={dir || 'none'}>
      {col.sortKey ? (
        <button
          type="button"
          className="tbl__sort"
          aria-sort={dir || 'none'}
          onClick={() => {
            const d = nextSort(dir);
            onSort(d ? { key: col.sortKey, dir: d } : null);
          }}
        >
          {col.label}
          <svg className="ch" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      ) : col.label}
      {onGrip && (
        <span
          className={['tb__grip', gripActive && 'on'].filter(Boolean).join(' ')}
          onPointerDown={e => onGrip(e, col.key, col.min)}
          onClick={e => e.stopPropagation()}
        />
      )}
    </th>
  );
}

export default function TableView({
  tasks, columns, fieldDefs, fieldValueMap, teamMembers, onTasksChange, boardId,
  // From `useBoardView`, via the page. `tasks` arrives already searched and
  // filtered; sort and grouping are the table's own but live in the URL so a
  // sorted, grouped, filtered table is one link.
  sort, onSort, groupBy = 'none', shownFields: shownFieldsProp,
  isFiltered = false, onClearFilters,
}) {
  const { pushToast } = useToast();
  const [drawer, setDrawer] = useState(null);
  const [valueEdits, setValueEdits] = useState({});

  const boardKey = boardId || columns?.[0]?.team_id || columns?.[0]?.project_id || 'default';
  const defs = useMemo(() => fieldDefs || [], [fieldDefs]);

  // Field visibility belongs to the toolbar, which is the page's. A table
  // rendered without one still shows every field rather than none.
  const shownFields = shownFieldsProp || defs;

  const allCols = useMemo(() => [
    ...BASE_COLS,
    ...shownFields.map(f => ({ key: `f:${f.field_id}`, label: f.name, sortKey: null, width: 140, min: 90 })),
  ], [shownFields]);

  const { widths, activeKey, onPointerDown, onPointerMove, onPointerUp } =
    useColumnResize(allCols, `kv.table.widths.${boardKey}`);

  // ── Sort · group ──────────────────────────────────────────────────────────
  const colMap = useMemo(
    () => Object.fromEntries((columns || []).map(c => [c.column_id, c])),
    [columns],
  );

  const filtered = useMemo(() => tasks || [], [tasks]);

  const sorted = useMemo(() => {
    if (!sort) {
      return [...filtered].sort((a, b) => (a.order ?? a.sort_order ?? 0) - (b.order ?? b.sort_order ?? 0));
    }
    const mul = sort.dir === 'ascending' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let av = a[sort.key];
      let bv = b[sort.key];
      if (sort.key === 'priority') { av = PRIORITY_RANK[av] ?? 99; bv = PRIORITY_RANK[bv] ?? 99; }
      else if (sort.key === 'assignees') {
        // Unassigned sorts last in BOTH directions, as undated does below: a
        // descending sort that opens with fifty blank cells has buried the
        // thing it was asked to surface.
        av = (a.assignee_names || [])[0] || '';
        bv = (b.assignee_names || [])[0] || '';
        if (!av || !bv) return av === bv ? 0 : (av ? -1 : 1);
        av = av.toLocaleLowerCase();
        bv = bv.toLocaleLowerCase();
      } else if (sort.key === 'due_at') {
        // Undated tasks sort last in BOTH directions. Treating "no due date" as
        // year zero puts every undated task at the top of an ascending sort,
        // which is the opposite of what "show me what is due soonest" means.
        av = av ? new Date(av).getTime() : Infinity;
        bv = bv ? new Date(bv).getTime() : Infinity;
        if (av === Infinity || bv === Infinity) return av === bv ? 0 : (av === Infinity ? 1 : -1);
      } else if (sort.key === 'column_id') {
        av = colMap[av]?.name ?? '';
        bv = colMap[bv]?.name ?? '';
      } else {
        av = av ?? '';
        bv = bv ?? '';
      }
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return 0;
    });
  }, [filtered, sort, colMap]);

  const grouped = useMemo(() => groupTasks(sorted, groupBy, columns), [sorted, groupBy, columns]);

  // ── Selection ─────────────────────────────────────────────────────────────
  const orderedIds = useMemo(() => sorted.map(t => t.task_id), [sorted]);
  const { selected, toggle, toggleAll, clear, allSelected, someSelected } = useTableSelection(orderedIds);

  // ── Inline custom-field editing ───────────────────────────────────────────
  // `FieldRenderer` has taken `onChange` and `readOnly` all along; the table was
  // the thing calling it with `readOnly` and `onChange={() => {}}`, which is why
  // custom-field cells were permanently read-only.
  const saveValue = useCallback(async (taskId, fieldId, value) => {
    setValueEdits(prev => ({ ...prev, [taskId]: { ...(prev[taskId] || {}), [fieldId]: value } }));
    try {
      await api.put(`/fields/task/${taskId}/values`, [{ field_id: fieldId, value }]);
    } catch (e) {
      logger.error('Field value save failed', e);
      pushToast({ type: 'error', title: 'Could not save that value' });
      setValueEdits(prev => {
        const next = { ...(prev[taskId] || {}) };
        delete next[fieldId];
        return { ...prev, [taskId]: next };
      });
    }
  }, [pushToast]);

  // ── Inline cell editing ───────────────────────────────────────────────────
  // See the block above `SAVED_FLASH_MS` for what is editable and why.
  //
  // `editing` is ONE key — `${task_id}:${field}` — not a per-row map: exactly
  // one cell can be open, which is what makes blur-commits-and-closes safe.
  const [editing, setEditing] = useState(null);
  const [flash, setFlash] = useState({});
  const flashTimers = useRef({});

  // A timer that outlives its row writes into a component that has unmounted —
  // and a page that switches from Table to Kanban mid-save does exactly that.
  useEffect(() => {
    const timers = flashTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  const runFlash = useCallback((key, kind, ms) => {
    clearTimeout(flashTimers.current[key]);
    setFlash(prev => ({ ...prev, [key]: kind }));
    flashTimers.current[key] = setTimeout(() => {
      delete flashTimers.current[key];
      setFlash(prev => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, ms);
  }, []);

  /**
   * One cell, one PATCH, optimistic — and a real revert when it is refused.
   *
   * `local` is what the TABLE should show and `patch` is what the SERVER is
   * told; they differ for assignees, where the wire field is
   * `assignee_user_ids` and the cell renders `assignee_names`. Sending the
   * display field would be rejected (`extra="forbid"` on `BulkTaskPatch`), and
   * patching only the wire field would leave the old name on screen next to the
   * new id.
   */
  const commitCell = useCallback(async (task, field, patch, local = null) => {
    const key = `${task.task_id}:${field}`;
    const shown = local || patch;
    setEditing(null);

    // Captured BEFORE the optimistic write, off the row we were handed — so a
    // refusal restores what was actually there rather than a re-read of state
    // the optimistic write has already changed.
    const before = Object.fromEntries(Object.keys(shown).map(k => [k, task[k]]));
    const apply = v => onTasksChange?.(prev =>
      prev.map(t => (t.task_id === task.task_id ? { ...t, ...v } : t)));

    apply(shown);
    try {
      const { data } = await api.patch('/v1/tasks/bulk', { task_ids: [task.task_id], patch });
      // 200 with `ok: false` is a REFUSAL, not a success — the route reports
      // per-id outcomes and answers 200 for a partially-applied batch. Reading
      // only the HTTP status here would have painted every denied edit green.
      const result = (Array.isArray(data?.results) ? data.results : [])[0];
      if (!result?.ok) {
        const err = new Error(result?.error || 'The server refused that change');
        err.serverDetail = result?.error;
        throw err;
      }
      // Same merge rule as `BulkBar`: the column can force the status.
      if (result.status && result.status !== task.status) apply({ status: result.status });
      runFlash(key, 'ok', SAVED_FLASH_MS);
    } catch (e) {
      logger.error('Inline cell save failed', e);
      apply(before);
      runFlash(key, 'err', FAILED_TINT_MS);
      pushToast({
        type: 'error',
        title: 'Could not save that change',
        body: e?.serverDetail || e?.response?.data?.detail,
      });
    }
  }, [onTasksChange, pushToast, runFlash]);

  /** `.tb__cell` plus whichever of the two one-shot tints is live. */
  const cellClass = useCallback((taskId, field) => {
    const f = flash[`${taskId}:${field}`];
    return ['tb__cell', f === 'ok' && 'is-saved', f === 'err' && 'is-failed']
      .filter(Boolean).join(' ');
  }, [flash]);

  /** Escape reverts (10.3, dismiss) — which here means closing without a write. */
  const onEditorKeyDown = useCallback(e => {
    if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
  }, []);

  const colCount = 1 + allCols.length;

  return (
    <>
      <div
        className="tbv"
        onPointerMove={activeKey ? onPointerMove : undefined}
        onPointerUp={activeKey ? onPointerUp : undefined}
      >
        <div className="tbl__wrap">
          <table className="tbl">
            <colgroup>
              <col style={{ width: 40 }} />
              {allCols.map(c => <col key={c.key} style={{ width: widths[c.key] }} />)}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="tb__sel">
                  <Checkbox
                    checked={allSelected}
                    mixed={someSelected}
                    onChange={toggleAll}
                    label={allSelected ? 'Clear selection' : 'Select all tasks'}
                  />
                </th>
                {allCols.map(c => (
                  <Th
                    key={c.key}
                    col={c}
                    sort={sort}
                    onSort={onSort}
                    width={widths[c.key]}
                    onGrip={onPointerDown}
                    gripActive={activeKey === c.key}
                  />
                ))}
              </tr>
            </thead>

            <tbody>
              {grouped.map(({ key, label, rows }) => (
                <React.Fragment key={key}>
                  {label && (
                    <tr className="tb__grp">
                      <td colSpan={colCount}>
                        {label}<span className="tb__grpn">{rows.length}</span>
                      </td>
                    </tr>
                  )}
                  {rows.map(task => {
                    const col = colMap[task.column_id];
                    const priority = task.priority || 'medium';
                    const values = { ...(fieldValueMap?.[task.task_id] || {}), ...(valueEdits[task.task_id] || {}) };
                    const isSel = selected.has(task.task_id);
                    const asgNames = task.assignee_names || [];
                    const people = (task.assignee_user_ids || [])
                      .map((id, i) => ({ id, name: asgNames[i] || id }));
                    // A one-pick control REPLACES the list, so it is offered
                    // only where replacing is what the user means: nobody or
                    // one person, and a roster to pick from.
                    const asgEditable = (teamMembers || []).length > 0 && people.length <= 1;
                    // No columns loaded is no options. `MyTasksView` and a
                    // board mid-fetch both reach here with an empty list.
                    const colEditable = (columns || []).length > 0;
                    // Which cell of THIS row is open, as a bare field name.
                    const edField = editing && editing.startsWith(`${task.task_id}:`)
                      ? editing.slice(task.task_id.length + 1)
                      : null;
                    // Resolved out here rather than as `cellClass(id, 'due_at')`
                    // inside `className={…}`: `check-classes` reads every quoted
                    // string in a className expression as a class name and would
                    // demand a `.due_at` rule that must never exist.
                    const cls = {
                      column_id: cellClass(task.task_id, 'column_id'),
                      priority: cellClass(task.task_id, 'priority'),
                      assignees: cellClass(task.task_id, 'assignees'),
                      due_at: cellClass(task.task_id, 'due_at'),
                    };

                    return (
                      <tr
                        key={task.task_id}
                        className={isSel ? 'on' : undefined}
                        onClick={() => setDrawer(task.task_id)}
                      >
                        {/* `onClick` rather than `onChange`, because the shift
                            key is on the event and a boolean callback drops it —
                            and shift-range is the whole point of the anchor. */}
                        <td className="tb__sel" onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={isSel}
                            label={`Select ${task.title}`}
                            onClick={e => toggle(task.task_id, e.shiftKey)}
                          />
                        </td>

                        <td>
                          <span className="tb__ttl">
                            {/* Both pending states, and the same two labels the
                                board card uses. The table tested `pending`
                                only, so a task waiting on the CLIENT carried a
                                chip on the board and nothing in the table —
                                the one state where "who are we waiting on"
                                is the whole question. */}
                            {(task.approval_status === 'pending' || task.approval_status === 'pending_client') && (
                              <span className="bc__appr">
                                {task.approval_status === 'pending_client' ? 'Client review' : 'Needs approval'}
                              </span>
                            )}
                            {/* The row's onClick was the ONLY way to open a
                                task from the table, and a <tr> is not
                                focusable — so the keyboard could tick the
                                checkbox and edit the custom fields but never
                                open the record. The title is the affordance
                                that already reads as the way in, so it is the
                                one that becomes the button. */}
                            <span>
                              <button
                                type="button"
                                className="tb__ttlbtn"
                                onClick={e => { e.stopPropagation(); setDrawer(task.task_id); }}
                              >
                                {task.title}
                              </button>
                            </span>
                            {task.attachments?.length > 0 && (
                              <span
                                className="tb__att"
                                title={`${task.attachments.length} attachment${task.attachments.length > 1 ? 's' : ''}`}
                              >
                                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                                  <path d="M10 3l-5 5a2.5 2.5 0 003.5 3.5l5-5a4 4 0 00-5.7-5.7L3 5.5" />
                                </svg>
                                {task.attachments.length}
                              </span>
                            )}
                          </span>
                        </td>

                        {/* `stopPropagation` on the cell, not on the control:
                            the row's own `onClick` opens the drawer, and a cell
                            whose whole job is now "click to edit" must not also
                            open the thing the edit is meant to avoid. The title
                            cell and the row's dead space still open it.
                            A cell with nothing to pick from keeps the old
                            behaviour and lets the click through — see below. */}
                        <td onClick={colEditable ? (e => e.stopPropagation()) : undefined}>
                          {edField === 'column_id' ? (
                            <select
                              className="inp tb__edit"
                              /* eslint-disable-next-line jsx-a11y/no-autofocus */
                              autoFocus
                              aria-label={`Column for ${task.title}`}
                              defaultValue={task.column_id || ''}
                              onBlur={() => setEditing(null)}
                              onKeyDown={onEditorKeyDown}
                              onChange={e => commitCell(task, 'column_id', { column_id: e.target.value })}
                            >
                              {(columns || []).map(c => (
                                <option key={c.column_id} value={c.column_id}>{c.name}</option>
                              ))}
                            </select>
                          ) : (
                            /* NOT a disabled button. A `disabled` <button> eats
                               the click outright — it does not fire and it does
                               not bubble — so a cell that cannot be edited
                               would also stop opening the drawer, which is
                               strictly worse than the read-only cell it
                               replaced. No options means no button at all, and
                               the click reaches the row exactly as it used to. */
                            <CellTrigger
                              editable={colEditable}
                              className={cls.column_id}
                              onClick={() => setEditing(`${task.task_id}:column_id`)}
                            >
                              {col ? (
                                <span className="tb__col">
                                  <span className="tb__coldot" style={{ '--c': col.color || 'var(--on-surface-3)' }} />
                                  {col.name}
                                </span>
                              ) : <span className="tb__none">—</span>}
                            </CellTrigger>
                          )}
                        </td>

                        {/* A colour dot is never the only carrier of meaning —
                            26 §8. The label rides beside it. */}
                        <td onClick={e => e.stopPropagation()}>
                          {edField === 'priority' ? (
                            <select
                              className="inp tb__edit"
                              /* eslint-disable-next-line jsx-a11y/no-autofocus */
                              autoFocus
                              aria-label={`Priority for ${task.title}`}
                              defaultValue={priority}
                              onBlur={() => setEditing(null)}
                              onKeyDown={onEditorKeyDown}
                              onChange={e => commitCell(task, 'priority', { priority: e.target.value })}
                            >
                              {Object.entries(PRIORITY_LABELS).map(([id, label]) => (
                                <option key={id} value={id}>{label}</option>
                              ))}
                            </select>
                          ) : (
                            <CellTrigger
                              editable
                              className={cls.priority}
                              onClick={() => setEditing(`${task.task_id}:priority`)}
                            >
                              <span className="tb__prio" style={{ '--c': PRIORITY_COLORS[priority] || 'var(--on-surface-3)' }}>
                                <span className="tb__coldot" />
                                {PRIORITY_LABELS[priority] || '—'}
                              </span>
                            </CellTrigger>
                          )}
                        </td>

                        {/* Faces AND a name. `AvatarStack` alone is a row of
                            two-letter monograms, which is a colour-only
                            carrier the moment two people share initials — 26
                            §8. One assignee names them; more than one is a
                            stack with the count, and every face carries the
                            full name in `title`. */}
                        <td onClick={asgEditable ? (e => e.stopPropagation()) : undefined}>
                          {edField === 'assignees' && asgEditable ? (
                            <select
                              className="inp tb__edit"
                              /* eslint-disable-next-line jsx-a11y/no-autofocus */
                              autoFocus
                              aria-label={`Assignee for ${task.title}`}
                              defaultValue={people[0]?.id || ''}
                              onBlur={() => setEditing(null)}
                              onKeyDown={onEditorKeyDown}
                              onChange={e => {
                                const uid = e.target.value;
                                const m = (teamMembers || []).find(x => x.user_id === uid);
                                commitCell(
                                  task,
                                  'assignees',
                                  { assignee_user_ids: uid ? [uid] : [] },
                                  {
                                    assignee_user_ids: uid ? [uid] : [],
                                    assignee_names: uid ? [m?.full_name || m?.name || m?.email || uid] : [],
                                  },
                                );
                              }}
                            >
                              <option value="">Unassigned</option>
                              {(teamMembers || []).map(m => (
                                <option key={m.user_id} value={m.user_id}>
                                  {m.full_name || m.name || m.email || m.user_id}
                                </option>
                              ))}
                            </select>
                          ) : (
                            /* Two or more people is a list a one-pick control
                               can only destroy, so that row is not an editor —
                               it is the cell it always was, and clicking it
                               opens the drawer, which has the multi-picker. */
                            <CellTrigger
                              editable={asgEditable}
                              className={cls.assignees}
                              onClick={() => setEditing(`${task.task_id}:assignees`)}
                            >
                              {people.length ? (
                                <span className="tb__asg">
                                  <AvatarStack users={people} max={3} size={22} ring="var(--surface)" />
                                  {people.length === 1 && <span className="tb__asgn">{people[0].name}</span>}
                                </span>
                              ) : <span className="tb__none">Unassigned</span>}
                            </CellTrigger>
                          )}
                        </td>

                        <td onClick={e => e.stopPropagation()}>
                          {edField === 'due_at' ? (
                            <input
                              className="inp tb__edit"
                              type="date"
                              /* eslint-disable-next-line jsx-a11y/no-autofocus */
                              autoFocus
                              aria-label={`Due date for ${task.title}`}
                              defaultValue={dateInputValue(task.due_at)}
                              onBlur={() => setEditing(null)}
                              onKeyDown={onEditorKeyDown}
                              onChange={e => commitCell(task, 'due_at', {
                                // Clearing the field is a real edit — `null`
                                // removes the date, which is why the model
                                // types it `Optional[str]` and why "absent" and
                                // `null` are different there.
                                due_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                              })}
                            />
                          ) : (
                            <CellTrigger
                              editable
                              className={cls.due_at}
                              onClick={() => setEditing(`${task.task_id}:due_at`)}
                            >
                              <DueChip date={task.due_at} status={task.status} completedAt={task.completed_at} flush />
                            </CellTrigger>
                          )}
                        </td>

                        {shownFields.map(f => (
                          <td key={f.field_id} onClick={e => e.stopPropagation()}>
                            <FieldRenderer
                              field={f}
                              value={values[f.field_id] ?? null}
                              onChange={v => saveValue(task.task_id, f.field_id, v)}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td className="tb__empty" colSpan={colCount}>
                    {/* A filtered list reaching zero is not the same state as a
                        list with nothing in it — 02, "Two empty states". One is
                        a filter to undo, the other is a board to fill. */}
                    {isFiltered ? (
                      <EmptyState
                        illustration="search"
                        title="No tasks match these filters"
                        description="The search or filters above are hiding everything on this board."
                        action={onClearFilters ? 'Clear all' : undefined}
                        onAction={onClearFilters}
                      />
                    ) : (
                      <EmptyState
                        illustration="tasks"
                        title="No tasks yet"
                        description="Tasks added to this board will appear here."
                      />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <BulkBar
          ids={[...selected]}
          columns={columns}
          teamMembers={teamMembers}
          onClear={clear}
          // MERGE, never replace. `PATCH /v1/tasks/bulk` answers
          // `{task_id, ok, status}` per row rather than the whole record, so
          // `BulkBar` hands up the patch it sent plus the server's status.
          // Substituting that for the task would blank every field the bar does
          // not set — title first.
          onPatched={updated => onTasksChange?.(prev => {
            const byId = Object.fromEntries(updated.map(u => [u.task_id, u]));
            return prev.map(t => (byId[t.task_id] ? { ...t, ...byId[t.task_id] } : t));
          })}
          onDeleted={gone => {
            const dead = new Set(gone);
            onTasksChange?.(prev => prev.filter(t => !dead.has(t.task_id)));
          }}
        />
      </div>

      <TaskDrawer
        taskId={drawer}
        open={!!drawer}
        onClose={() => setDrawer(null)}
        teamMembers={teamMembers}
        onSaved={u => {
          if (!u) { setDrawer(null); return; }
          onTasksChange?.(p => p.map(t => (t.task_id === u.task_id ? u : t)));
        }}
      />
    </>
  );
}
