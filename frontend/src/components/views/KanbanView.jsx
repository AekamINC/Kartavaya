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
import { useToast, ConfirmDialog } from '../ui';

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
  onTasksChange, onColumnChange, onColumnsChange,
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
  const [newColColor, setNewColColor] = useState('#6366f1');
  const [newColDone, setNewColDone] = useState(false);
  const [confirmState, setConfirmState] = useState(null);

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

  const byCol = useMemo(() => {
    const validColIds = new Set(visibleColumns.map(c => c.column_id));
    const m = {};
    visibleColumns.forEach(c => { m[c.column_id] = []; });
    (tasks || []).forEach(t => {
      if (showRequested && t.status === 'requested') { m.__requested__.push(t); return; }
      if (showClientApproval && t.approval_status === 'pending_client') { m.__pending_client__.push(t); return; }
      const cid = (t.column_id && validColIds.has(t.column_id))
        ? t.column_id
        : (statusFallbackCol[t.status] || statusFallbackCol.todo);
      if (cid && m[cid]) m[cid].push(t);
    });
    Object.values(m).forEach(arr => arr.sort((a, b) => (a.order ?? a.sort_order ?? 0) - (b.order ?? b.sort_order ?? 0)));
    return m;
  }, [visibleColumns, tasks, showRequested, showClientApproval, statusFallbackCol]);

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

    const newOrder = destination.index;
    const previous = (tasks || []).find(t => t.task_id === taskId);

    // flushSync: React 18+ batches state updates, but @hello-pangea/dnd needs
    // the DOM to reflect the move synchronously before its cleanup runs.
    flushSync(() => {
      onTasksChange?.(prev => prev.map(t =>
        t.task_id === taskId ? { ...t, column_id: targetColId, order: newOrder, sort_order: newOrder } : t
      ));
    });

    try {
      const res = await api.patch(`/tasks/${taskId}/move`, { column_id: targetColId, order: newOrder });
      onTasksChange?.(prev => prev.map(t => (t.task_id === taskId ? res.data : t)));
      if (res.data.status === 'done') playPraiseSound();
    } catch (e) {
      logger.error('Move failed', e);
      pushToast({ type: 'error', title: 'Could not move task' });
      // Restore the whole previous record. Putting back `column_id` alone left
      // the card in the right column at the position it was dragged to.
      if (previous) onTasksChange?.(prev => prev.map(t => (t.task_id === taskId ? previous : t)));
    }
  }, [tasks, onTasksChange, pushToast]);

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
                          className="k-input bd__cname"
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
                      <span className="bd__cc">{colTasks.length}</span>
                      {canManageCols && !isSynth && (
                        <button
                          type="button"
                          className="bd__cx"
                          onClick={() => deleteCol(col)}
                          title="Delete column"
                          aria-label={`Delete column ${col.name}`}
                        >
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M3 3l10 10M13 3L3 13" />
                          </svg>
                        </button>
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
                                onClick={() => !draggingId && setDrawerTaskId(task.task_id)}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {colTasks.length === 0 && snapshot.isDraggingOver && droppable && <CardGhost />}
                    </div>

                    {!readOnly && !isSynth && (
                      <button
                        type="button"
                        className="bd__add"
                        onClick={() => onColumnChange?.('new_task', col.column_id)}
                      >
                        + Add task
                      </button>
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
                    className="k-input"
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
