import React, { useCallback, useMemo, useState } from 'react';

import { api } from '../../lib/api';
import { logger } from '../../lib/utils';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../lib/statusColors';

import TaskDrawer from '../TaskDrawer';
import FieldRenderer from '../fields/FieldRenderer';
import {
  Checkbox, DueChip, EmptyState, nextSort, useToast,
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

const BASE_COLS = [
  { key: 'title', label: 'Title', sortKey: 'title', width: 320, min: 160 },
  { key: 'column_id', label: 'Column', sortKey: 'column_id', width: 150, min: 110 },
  { key: 'priority', label: 'Priority', sortKey: 'priority', width: 120, min: 100 },
  { key: 'created_by', label: 'Created by', sortKey: 'created_by_name', width: 150, min: 110 },
  { key: 'due_at', label: 'Due', sortKey: 'due_at', width: 150, min: 120 },
];

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
      else if (sort.key === 'due_at') {
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
                            <span>{task.title}</span>
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

                        <td>
                          {col ? (
                            <span className="tb__col">
                              <span className="tb__coldot" style={{ '--c': col.color || 'var(--on-surface-3)' }} />
                              {col.name}
                            </span>
                          ) : <span className="tb__none">—</span>}
                        </td>

                        {/* A colour dot is never the only carrier of meaning —
                            26 §8. The label rides beside it. */}
                        <td>
                          <span className="tb__prio" style={{ '--c': PRIORITY_COLORS[priority] || 'var(--on-surface-3)' }}>
                            <span className="tb__coldot" />
                            {PRIORITY_LABELS[priority] || '—'}
                          </span>
                        </td>

                        <td>{task.created_by_name || <span className="tb__none">—</span>}</td>

                        <td>
                          <DueChip date={task.due_at} status={task.status} completedAt={task.completed_at} flush />
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
