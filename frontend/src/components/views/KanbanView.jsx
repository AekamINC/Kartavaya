import React, { useState, useRef, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

import { api } from '../../lib/api';
import { logger } from '../../lib/utils';
import { APPROVAL_COLORS, STATUS_COLORS } from '../../lib/statusColors';
import { playPraiseSound } from '../../lib/notifSound';

import TaskCard from './TaskCard';
import CardGhost from './CardGhost';
import TaskDrawer from '../TaskDrawer';
import { useToast, ConfirmDialog, EmptyState, Menu } from '../ui';

/**
 * KanbanView — columns, drag, and the drawer (04-boards-table-views.md §5).
 *
 * **On the "drag does not work on touch" finding.** It does not hold against
 * this file. 04 §3 reads the HTML5 attributes on the card — `draggable`,
 * `onDragStart`, `onDragEnd` — and concludes the board is desktop-only. Those
 * props existed on `KanbanCard` but this view never passed them: drag has been
 * `@hello-pangea/dnd` since the import at the top, with `dragHandleProps` on
 * the `<Draggable>` wrapper, so the card's HTML5 surface was inert and the
 * library's own touch sensor was already in force. The props are gone now so
 * the next reader cannot draw the same conclusion.
 *
 * What is true is narrower and worth keeping separate: pangea's touch sensor
 * requires a ~120ms long-press before a drag begins, which is deliberate — it
 * is how a drag is told apart from a scroll on a horizontally-scrolling board —
 * but it is not discoverable, and a user who swipes immediately scrolls the
 * board instead of moving the card. That is a real complaint about touch drag.
 * It is not "does not fire".
 *
 * The move is ONE call. `PATCH /tasks/:id/move` takes column and order
 * together; two calls leave a visible wrong-position frame if the second fails.
 * The optimistic write is rolled back to the whole previous task on failure,
 * not just its column — restoring `column_id` alone left the card in the right
 * column at the dragged position.
 */

// Synthetic column injected at position 0 for admins/owners.
const REQUESTED_COL = {
  column_id: '__requested__',
  name: 'Requested',
  color: STATUS_COLORS.requested,
  _synthetic: true,
  _hindi: 'अनुरोध',
};

// Synthetic column for tasks awaiting client approval. The colour was a literal
// `#7c3aed`, one of the eight competing status maps; `--ap-pending-client` is
// the token and it flips with the theme.
const CLIENT_APPROVAL_COL = {
  column_id: '__pending_client__',
  name: 'Awaiting Client Approval',
  color: APPROVAL_COLORS.pending_client,
  _synthetic: true,
  _hindi: 'क्लाइंट अनुमोदन',
};

const SYNTHETIC_IDS = new Set(['__requested__', '__pending_client__']);

export default function KanbanView({
  columns, tasks, teamMembers,
  // The board can now be searched and filtered from the shared toolbar, so
  // `tasks` is what is VISIBLE and `allTasks` is what is on the board. The two
  // are the same list until someone types in the search box; see `handleDragEnd`
  // for why the difference matters.
  allTasks,
  // `onColumnChange` is gone: its only action was `('new_task', columnId)`,
  // which opened the New Task modal from a column foot. IxViews 9.3 replaces
  // that with the inline composer below, so the callback had no remaining
  // caller. The modal is still reached from the toolbar's "New task".
  onTasksChange, onColumnsChange,
  teamId,
  // readOnly: disables ALL drag + hides "Add task" buttons
  readOnly = false,
  // currentUserId / currentUserRole: used to enforce client drag rules
  currentUserId,
  currentUserRole,
  // showRequested: inject "Requested" column (admins/owners on project board)
  showRequested = false,
  // showClientApproval: inject "Awaiting Client Approval" column
  showClientApproval = false,
}) {
  const { pushToast } = useToast();
  const [draggingId, setDraggingId] = useState(null);
  const [drawerTaskId, setDrawerTaskId] = useState(null);

  // ── Column rename ─────────────────────────────────────────────────────────
  const [renamingColId, setRenamingColId] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const renameRef = useRef(null);

  // ── Add column ────────────────────────────────────────────────────────────
  const [addingCol, setAddingCol] = useState(false);
  const [newColName, setNewColName] = useState('');
  // A literal, and it has to be: this is the seed value of an
  // `<input type="color">`, which only accepts a 7-character hex — a var()
  // reference is rejected by the control and it falls back to black. It is
  // also PERSISTED as the column's colour, so it must be a value and not a
  // reference to one that changes with the theme. `#6366f1` is the Indigo
  // preset from 00 §10, so a default column still lands inside the palette.
  const [newColColor, setNewColColor] = useState('#6366f1');
  const [newColDone, setNewColDone] = useState(false);
  const [confirmState, setConfirmState] = useState(null);

  // ── Inline add composer (IxViews 9.3) ─────────────────────────────────────
  // `composeCol` is the column whose composer is open, or null. The catalogue's
  // "today" note for 9.3 is "Add opens a full New Task modal, so adding six
  // cards means six modals" — this is that fix. The modal is still reachable
  // from the toolbar for a task that needs assignees, a due date or a
  // description; the composer is for the stand-up case, where the title IS the
  // task and six of them arrive in a row.
  const [composeCol, setComposeCol] = useState(null);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  // Cards that arrived or landed recently, for the one-shot entry and settle
  // animations. Keyed by task id; the class is dropped after the animation so
  // it can fire again next time.
  const [freshIds, setFreshIds] = useState(() => new Set());
  const [justIds, setJustIds] = useState(() => new Set());
  const [pendingIds, setPendingIds] = useState(() => new Set());
  // Separate from `justIds` on purpose. `just` is 9.1's settle and fires on a
  // DROP as well as a tick; the checkbox animation (9.4 → 2.2) must fire only
  // when a click completed the task, or dragging an already-done card would
  // spring its tick for no reason, and every done card on the board would
  // spring on mount. 2.2's exit — "unchecking reverses with no spring" — falls
  // out of the same gate, because uncompleting never enters this set.
  const [tickIds, setTickIds] = useState(() => new Set());

  const markTransient = useCallback((setter, id, ms) => {
    setter(prev => new Set(prev).add(id));
    setTimeout(() => setter(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    }), ms);
  }, []);

  const canManageCols = !readOnly && !!teamId && ['admin', 'owner'].includes(currentUserRole);

  const startRename = (col) => {
    if (!canManageCols || col._synthetic) return;
    setRenamingColId(col.column_id);
    setRenameVal(col.name);
    setTimeout(() => renameRef.current?.select(), 30);
  };

  const commitRename = async (col) => {
    const name = renameVal.trim();
    setRenamingColId(null);
    if (!name || name === col.name) return;
    try {
      await api.put(`/projects/${teamId}/columns/${col.column_id}`, { name });
      onColumnsChange?.(prev => prev.map(c => (c.column_id === col.column_id ? { ...c, name } : c)));
    } catch {
      pushToast({ type: 'error', title: 'Could not rename column' });
    }
  };

  const deleteCol = (col) => {
    setConfirmState({
      message: `Delete column "${col.name}"? Tasks will move to the next column.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await api.delete(`/projects/${teamId}/columns/${col.column_id}`);
          onColumnsChange?.(prev => prev.filter(c => c.column_id !== col.column_id));
          pushToast({ type: 'success', title: `"${col.name}" deleted` });
        } catch (e) {
          pushToast({ type: 'error', title: e?.response?.data?.detail || 'Could not delete column' });
        }
      },
    });
  };

  const commitAddCol = async () => {
    const name = newColName.trim();
    if (!name) { setAddingCol(false); return; }
    try {
      const res = await api.post(`/projects/${teamId}/columns`, { name, color: newColColor, is_done: newColDone });
      onColumnsChange?.(prev => [...prev, res.data]);
      pushToast({ type: 'success', title: `"${name}" column added` });
    } catch {
      pushToast({ type: 'error', title: 'Could not add column' });
    }
    setAddingCol(false);
    setNewColName('');
    setNewColColor('#6366f1');
    setNewColDone(false);
  };

  /**
   * Create one task from the composer. `POST /tasks` — the same endpoint the
   * modal uses, so a card added here is indistinguishable from one added there.
   *
   * Enter creates and CLEARS WITHOUT CLOSING (9.3): the composer stays focused
   * so a stand-up's worth of work is one continuous typing session. Shift+Enter
   * newlines. Esc, the Done link, or blurring while empty dismisses it.
   */
  const commitCompose = useCallback(async (colId) => {
    const title = draft.trim();
    if (!title || creating) return;
    setCreating(true);
    setDraft('');
    try {
      const status = columns.find(c => c.column_id === colId)?.is_done ? 'done' : 'todo';
      const res = await api.post('/tasks', { title, team_id: teamId, column_id: colId, status });
      const created = res.data;
      onTasksChange?.(prev => [...prev, created]);
      if (created?.task_id) markTransient(setFreshIds, created.task_id, 400);
    } catch (e) {
      logger.error('Inline task create failed', e);
      pushToast({ type: 'error', title: 'Could not add that task' });
      // The draft goes back in the box rather than being lost — the user typed
      // it and the failure was not theirs.
      setDraft(title);
    } finally {
      setCreating(false);
    }
  }, [draft, creating, columns, teamId, onTasksChange, markTransient, pushToast]);

  /**
   * The hover quick-complete tick (IxViews 9.4). Optimistic, at `opacity .6`
   * until acknowledged (MOTION-SPEC §7.1), rolled back to the whole previous
   * record on failure.
   */
  const toggleComplete = useCallback(async (task) => {
    if (readOnly) return;
    const next = task.status === 'done' ? 'todo' : 'done';
    const previous = task;
    setPendingIds(prev => new Set(prev).add(task.task_id));
    // Before the await, not after: 2.2 recomputes client-side first, and a
    // confirmation that waits for the round trip is not a confirmation of the
    // click. 600ms covers the longest of the two (`--dur-slow` box overshoot).
    if (next === 'done') markTransient(setTickIds, task.task_id, 600);
    onTasksChange?.(prev => prev.map(t => (t.task_id === task.task_id ? { ...t, status: next } : t)));
    try {
      const res = await api.patch(`/tasks/${task.task_id}`, { status: next });
      onTasksChange?.(prev => prev.map(t => (t.task_id === task.task_id ? res.data : t)));
      if (next === 'done') playPraiseSound();
      markTransient(setJustIds, task.task_id, 600);
    } catch (e) {
      logger.error('Complete toggle failed', e);
      pushToast({ type: 'error', title: 'Could not update that task' });
      onTasksChange?.(prev => prev.map(t => (t.task_id === task.task_id ? previous : t)));
    } finally {
      setPendingIds(prev => {
        const n = new Set(prev);
        n.delete(task.task_id);
        return n;
      });
    }
  }, [readOnly, onTasksChange, markTransient, pushToast]);

  const isClient = currentUserRole === 'client';

  // Columns to render — prepend/append synthetic cols when enabled.
  const visibleColumns = useMemo(() => {
    let cols = columns || [];
    if (showClientApproval) cols = [...cols, CLIENT_APPROVAL_COL];
    if (showRequested) cols = [REQUESTED_COL, ...cols];
    return cols;
  }, [columns, showRequested, showClientApproval]);

  // Status → column fallback for tasks with a missing or invalid column_id.
  const statusFallbackCol = useMemo(() => {
    const cols = visibleColumns.filter(c => !c._synthetic);
    const find = (names) => cols.find(c => names.includes(c.name?.toLowerCase()))?.column_id;
    return {
      done: find(['done', 'complete', 'completed']) || cols[cols.length - 1]?.column_id,
      in_progress: find(['in progress', 'in-progress', 'inprogress', 'doing', 'review', 'in review', 'approval']) || cols[1]?.column_id || cols[0]?.column_id,
      todo: find(['to do', 'todo', 'backlog', 'open', 'not started']) || cols[0]?.column_id,
    };
  }, [visibleColumns]);

  const bucket = useCallback((list) => {
    const validColIds = new Set(visibleColumns.map(c => c.column_id));
    const m = {};
    visibleColumns.forEach(c => { m[c.column_id] = []; });
    (list || []).forEach(t => {
      if (showRequested && t.status === 'requested') { m.__requested__.push(t); return; }
      if (showClientApproval && t.approval_status === 'pending_client') { m.__pending_client__.push(t); return; }
      const cid = (t.column_id && validColIds.has(t.column_id))
        ? t.column_id
        : (statusFallbackCol[t.status] || statusFallbackCol.todo);
      if (cid && m[cid]) m[cid].push(t);
    });
    Object.values(m).forEach(arr => arr.sort((a, b) => (a.order ?? a.sort_order ?? 0) - (b.order ?? b.sort_order ?? 0)));
    return m;
  }, [visibleColumns, showRequested, showClientApproval, statusFallbackCol]);

  const byCol = useMemo(() => bucket(tasks), [bucket, tasks]);
  // The same buckets over the UNFILTERED board. Identical objects when nothing
  // is filtered, so this costs one extra pass and nothing else.
  const byColAll = useMemo(
    () => (allTasks && allTasks !== tasks ? bucket(allTasks) : byCol),
    [bucket, allTasks, tasks, byCol],
  );

  // Can this task be dragged by the current user?
  const canDrag = (task) => {
    if (readOnly) return false;
    // Clients may drag only their own tasks, and only before work has started.
    if (isClient) return task.created_by === currentUserId && task.status !== 'in_progress';
    return true;
  };

  // Can a task be dropped into this column? Nobody drags INTO a synthetic
  // column — those are derived from status, and only the backend sets it.
  const canDrop = (col) => !readOnly && !col._synthetic;

  const handleDragEnd = useCallback(async (result) => {
    setDraggingId(null);
    const { draggableId: taskId, source, destination } = result;
    if (!destination) return;
    const srcColId = source.droppableId;
    const targetColId = destination.droppableId;
    if (SYNTHETIC_IDS.has(targetColId)) return;
    if (targetColId === srcColId && destination.index === source.index) return;

    /**
     * `destination.index` is an index into the list the user can SEE. Before
     * the toolbar's search and filter reached this view those were the same
     * list, so the index went straight to the server. They are not the same
     * list any more: drop a card second in a column showing 3 of 11 tasks and
     * `order: 1` puts it second among all eleven, which is not where it was
     * dropped and not where it appears once the filter is cleared.
     *
     * So the index is resolved through the card it lands ABOVE. Both lists are
     * taken without the dragged card, which is the frame pangea's index is
     * already expressed in for a same-column move; past the end of the visible
     * list means the end of the real one. With no filter active the visible
     * and real lists are identical and this returns `destination.index`
     * exactly, so the unfiltered path is unchanged.
     */
    const visible = (byCol[targetColId] || []).filter(t => t.task_id !== taskId);
    const full    = (byColAll[targetColId] || []).filter(t => t.task_id !== taskId);
    const anchor  = visible[destination.index];
    const newOrder = anchor
      ? Math.max(0, full.findIndex(t => t.task_id === anchor.task_id))
      : full.length;
    const previous = (allTasks || tasks || []).find(t => t.task_id === taskId);

    // flushSync: React 18+ batches state updates, but @hello-pangea/dnd needs
    // the DOM to reflect the move synchronously before its cleanup runs.
    flushSync(() => {
      onTasksChange?.(prev => prev.map(t =>
        t.task_id === taskId ? { ...t, column_id: targetColId, order: newOrder, sort_order: newOrder } : t
      ));
    });

    // MOTION-SPEC §7.1 — the card renders at `opacity .6` while the write is in
    // flight, so an optimistic move never claims to have succeeded before it
    // has. It goes solid, then flashes, on acknowledgement.
    setPendingIds(prev => new Set(prev).add(taskId));

    try {
      const res = await api.patch(`/tasks/${taskId}/move`, { column_id: targetColId, order: newOrder });
      onTasksChange?.(prev => prev.map(t => (t.task_id === taskId ? res.data : t)));
      if (res.data.status === 'done') playPraiseSound();
      // IxViews 9.1 exit — one --primary flash so the card is findable in the
      // column it landed in.
      markTransient(setJustIds, taskId, 600);
    } catch (e) {
      logger.error('Move failed', e);
      pushToast({ type: 'error', title: 'Could not move task' });
      // Restore the whole previous record. Putting back `column_id` alone left
      // the card in the right column at the position it was dragged to.
      if (previous) onTasksChange?.(prev => prev.map(t => (t.task_id === taskId ? previous : t)));
    } finally {
      setPendingIds(prev => {
        const n = new Set(prev);
        n.delete(taskId);
        return n;
      });
    }
  }, [tasks, allTasks, byCol, byColAll, onTasksChange, pushToast, markTransient]);

  // A board with no columns rendered as an empty flex row — nothing at all for
  // a member who cannot add one, and no explanation. `canManageCols` decides
  // which of the two sentences is true for this user, because "add a column" is
  // not an instruction you give someone who has no button for it.
  // `&& !addingCol` matters: pressing the CTA opens the add-column form, which
  // lives in the board below. Without it the empty state would swallow its own
  // action and the button would do nothing visible.
  if (visibleColumns.length === 0 && !addingCol) {
    return (
      <EmptyState
        illustration="tasks"
        title="This board has no columns yet"
        description={canManageCols
          ? 'Add a column to start moving work across the board.'
          : 'An admin or owner can add columns to this project.'}
        action={canManageCols ? 'Add column' : undefined}
        onAction={canManageCols ? () => setAddingCol(true) : undefined}
      />
    );
  }

  return (
    <>
      <DragDropContext
        onDragStart={start => setDraggingId(start.draggableId)}
        onDragEnd={handleDragEnd}
      >
        <div className="bd">
          {visibleColumns.map(col => {
            const colTasks = byCol[col.column_id] || [];
            const isSynth = col._synthetic;
            const droppable = canDrop(col);

            return (
              // The Droppable's render prop wraps the whole column, so `.over`
              // highlights the COLUMN — 04 §1 — rather than only the card list.
              // The library's own ref and props still go on the list itself; see
              // the note below.
              <Droppable key={col.column_id} droppableId={col.column_id} isDropDisabled={!droppable}>
                {(provided, snapshot) => (
                  <div className={['bd__col', snapshot.isDraggingOver && droppable && 'over'].filter(Boolean).join(' ')}>
                    <div className="bd__ch">
                      <span className="bd__cdot" style={{ '--c': col.color || 'var(--primary)' }} />
                      {renamingColId === col.column_id ? (
                        <input
                          ref={renameRef}
                          className="inp bd__cname"
                          value={renameVal}
                          onChange={e => setRenameVal(e.target.value)}
                          onBlur={() => commitRename(col)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitRename(col);
                            if (e.key === 'Escape') setRenamingColId(null);
                          }}
                          aria-label={`Rename ${col.name}`}
                          autoFocus
                        />
                      ) : (
                        <span
                          className="bd__cn"
                          onDoubleClick={() => startRename(col)}
                          title={canManageCols && !isSynth ? 'Double-click to rename' : undefined}
                        >
                          {col.name}
                          {isSynth && col._hindi && <span className="bd__cn-hi">{col._hindi}</span>}
                        </span>
                      )}
                      {/* IxViews 9.1 — "its count badge previews the new
                          total" while a card is held over the column. The
                          dragged card is still counted in its source column
                          until the drop commits, so the preview is +1 here and
                          the source is left alone: showing both moving at once
                          would double-count during the hover. */}
                      <span className="bd__cc">
                        {colTasks.length + (snapshot.isDraggingOver && droppable
                          && !colTasks.some(t => t.task_id === draggingId) ? 1 : 0)}
                      </span>
                      {/* 04 §2 gives the column header `dot · name · count · ⋯`
                          and IxViews 9.3 says the menu is "the shared ⋯
                          primitive from 5.1". It was a bare ✕ that could only
                          delete, with rename reachable ONLY by double-clicking
                          the name — an affordance that lives in a `title`
                          attribute, which a keyboard user cannot reach and a
                          touch user has no gesture for. `Menu` carries the
                          portal, the roving tabindex and the Escape-returns-
                          focus contract, so the two actions are now one
                          discoverable control. Double-click still renames;
                          it is a shortcut now rather than the only route. */}
                      {canManageCols && !isSynth && (
                        <Menu
                          align="right"
                          label={`Column actions for ${col.name}`}
                          trigger={
                            <span className="bd__cx" aria-hidden="true">
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" focusable="false">
                                <circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" />
                              </svg>
                            </span>
                          }
                          items={[
                            { id: 'rename', label: 'Rename column', onSelect: () => startRename(col) },
                            { id: 'add', label: 'Add task', onSelect: () => { setDraft(''); setComposeCol(col.column_id); } },
                            { sep: true },
                            { id: 'delete', label: 'Delete column', danger: true, onSelect: () => deleteCol(col) },
                          ]}
                        />
                      )}
                    </div>

                    {/* `innerRef` and `droppableProps` must land on the SAME
                        element — the library finds the droppable by the data
                        attributes in `droppableProps` and measures the node
                        `innerRef` gave it. Splitting them across the column and
                        its list makes the placeholder measure the wrong box.
                        The `.over` highlight still reaches the column because
                        the snapshot is in scope for the whole subtree. */}
                    <div className="bd__list" ref={provided.innerRef} {...provided.droppableProps}>
                      {colTasks.map((task, idx) => (
                        <Draggable
                          key={task.task_id}
                          draggableId={task.task_id}
                          index={idx}
                          isDragDisabled={!canDrag(task)}
                        >
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                            >
                              <TaskCard
                                task={task}
                                dragging={dragSnapshot.isDragging}
                                pending={pendingIds.has(task.task_id)}
                                just={justIds.has(task.task_id)}
                                fresh={freshIds.has(task.task_id)}
                                tickpop={tickIds.has(task.task_id)}
                                onComplete={readOnly || isSynth ? undefined : toggleComplete}
                                onClick={() => !draggingId && setDrawerTaskId(task.task_id)}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {colTasks.length === 0 && snapshot.isDraggingOver && droppable && <CardGhost />}
                    </div>

                    {/* IxViews 9.3 — the composer replaces the Add button in
                        place. It does NOT close on ⏎; that is the whole point,
                        and it is why the confirm is a "Done" link rather than a
                        Cancel. Blur closes only while the draft is empty, so
                        clicking the Add button below does not discard typing. */}
                    {!readOnly && !isSynth && (
                      composeCol === col.column_id ? (
                        <div className="bd__compose">
                          <textarea
                            className="bd__composein"
                            rows={2}
                            autoFocus
                            value={draft}
                            placeholder="Task title, ⏎ to add"
                            aria-label={`New task in ${col.name}`}
                            onChange={e => setDraft(e.target.value)}
                            onBlur={() => { if (!draft.trim()) setComposeCol(null); }}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                commitCompose(col.column_id);
                              }
                              if (e.key === 'Escape') { setDraft(''); setComposeCol(null); }
                            }}
                          />
                          <div className="bd__composerow">
                            <button
                              type="button"
                              className="btn btn--fill btn--sm"
                              disabled={!draft.trim() || creating}
                              onClick={() => commitCompose(col.column_id)}
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              className="btn btn--text btn--sm"
                              onClick={() => { setDraft(''); setComposeCol(null); }}
                            >
                              Done
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="bd__add"
                          onClick={() => { setDraft(''); setComposeCol(col.column_id); }}
                        >
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M8 3v10M3 8h10" />
                          </svg>
                          Add task
                        </button>
                      )
                    )}
                  </div>
                )}
              </Droppable>
            );
          })}

          {canManageCols && (
            <div className="bd__newcol">
              {addingCol ? (
                <div className="bd__form">
                  <input
                    className="inp"
                    value={newColName}
                    onChange={e => setNewColName(e.target.value)}
                    placeholder="Column name…"
                    aria-label="New column name"
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitAddCol();
                      if (e.key === 'Escape') { setAddingCol(false); setNewColName(''); }
                    }}
                    autoFocus
                  />
                  <div className="bd__formrow">
                    <input
                      type="color"
                      className="bd__swatch"
                      value={newColColor}
                      onChange={e => setNewColColor(e.target.value)}
                      title="Column colour"
                      aria-label="Column colour"
                    />
                    <label className="bd__chk">
                      <input type="checkbox" checked={newColDone} onChange={e => setNewColDone(e.target.checked)} />
                      Mark as Done
                    </label>
                  </div>
                  <div className="bd__formrow">
                    <button type="button" className="btn btn--fill btn--sm" onClick={commitAddCol}>Add</button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setAddingCol(false); setNewColName(''); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="bd__newbtn" onClick={() => setAddingCol(true)}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                  Add column
                </button>
              )}
            </div>
          )}
        </div>
      </DragDropContext>

      <TaskDrawer
        taskId={drawerTaskId}
        open={!!drawerTaskId}
        onClose={() => setDrawerTaskId(null)}
        teamMembers={teamMembers}
        onSaved={u => {
          if (!u) { setDrawerTaskId(null); return; }
          onTasksChange?.(p => p.map(t => {
            if (t.task_id !== u.task_id) return t;
            return {
              ...t, ...u,
              column_name: u.column_name ?? t.column_name,
              column_color: u.column_color ?? t.column_color,
              assignee_names: u.assignee_names?.length ? u.assignee_names : (t.assignee_names || []),
            };
          }));
        }}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </>
  );
}
