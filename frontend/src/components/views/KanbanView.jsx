import React, { useState, useRef, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

import { api } from '../../lib/api';

import KanbanCard from './KanbanCard';

import TaskDrawer from '../TaskDrawer';
import { playPraiseSound } from '../../lib/notifSound';

import { useToast } from '../ui/toast';

import { logger } from '../../lib/utils';

import ConfirmDialog from '../ui/ConfirmDialog';



// Synthetic column injected at position 0 for admins/owners

const REQUESTED_COL = {

  column_id: '__requested__',

  name: 'Requested',

  color: 'var(--st-requested)',

  _synthetic: true,

};



// Synthetic column for tasks awaiting client approval

const CLIENT_APPROVAL_COL = {

  column_id: '__pending_client__',

  name: 'Awaiting Client Approval',

  color: '#7c3aed',

  _synthetic: true,

  _hindi: 'क्लाइंट अनुमोदन',

};



export default function KanbanView({

  columns, tasks, fieldDefs, fieldValueMap, teamMembers,

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

  const [draggingId, setDraggingId]     = useState(null);

  const [drawerTaskId, setDrawerTaskId] = useState(null);



  // ── Column rename state ───────────────────────────────────────────────────

  const [renamingColId, setRenamingColId] = useState(null);

  const [renameVal,     setRenameVal]     = useState('');

  const renameRef = useRef(null);



  // ── Add column state ──────────────────────────────────────────────────────

  const [addingCol,   setAddingCol]   = useState(false);

  const [newColName,  setNewColName]  = useState('');

  const [newColColor, setNewColColor] = useState('#6366f1');

  const [newColDone,  setNewColDone]  = useState(false);

  const [confirmState, setConfirmState] = useState(null);

  const addColRef = useRef(null);



  const canManageCols = !readOnly && !!teamId && ['admin','owner'].includes(currentUserRole);



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

      onColumnsChange?.(prev => prev.map(c => c.column_id === col.column_id ? { ...c, name } : c));

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



  // Columns to render — prepend synthetic cols when enabled

  const visibleColumns = useMemo(() => {

    let cols = columns || [];

    if (showClientApproval) cols = [...cols, CLIENT_APPROVAL_COL];

    if (showRequested) cols = [REQUESTED_COL, ...cols];

    return cols;

  }, [columns, showRequested, showClientApproval]);



  // Status → column fallback for tasks with missing/invalid column_id

  const statusFallbackCol = useMemo(() => {

    const cols = visibleColumns.filter(c => !c._synthetic);

    const find = (names) => cols.find(c => names.includes(c.name?.toLowerCase()))?.column_id;

    return {

      done:        find(['done', 'complete', 'completed']) || cols[cols.length - 1]?.column_id,

      in_progress: find(['in progress', 'in-progress', 'inprogress', 'doing', 'review', 'in review', 'approval']) || cols[1]?.column_id || cols[0]?.column_id,

      todo:        find(['to do', 'todo', 'backlog', 'open', 'not started']) || cols[0]?.column_id,

    };

  }, [visibleColumns]);



  const byCol = useMemo(() => {

    const validColIds = new Set(visibleColumns.map(c => c.column_id));

    const m = {};

    visibleColumns.forEach(c => { m[c.column_id] = []; });

    (tasks || []).forEach(t => {

      if (showRequested && t.status === 'requested') {

        m['__requested__'].push(t);

        return;

      }

      if (showClientApproval && t.approval_status === 'pending_client') {

        m['__pending_client__'].push(t);

        return;

      }

      // Use column_id if valid; otherwise fall back to a column matching the task's status

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

    if (isClient) {

      // Clients can only drag their own tasks, and only if not yet in_progress

      return task.created_by === currentUserId && task.status !== 'in_progress';

    }

    return true;

  };



  // Can a task be dropped into this column by current user?

  const canDrop = (col) => {

    if (readOnly) return false;

    // Nobody can drag INTO the synthetic Requested column — only backend sets that

    if (col._synthetic) return false;

    return true;

  };



  const handleDragEnd = useCallback(async (result) => {
    setDraggingId(null);
    const { draggableId: taskId, source, destination } = result;
    if (!destination) return;
    const srcColId    = source.droppableId;
    const targetColId = destination.droppableId;
    if (targetColId === '__requested__' || targetColId === '__pending_client__') return;
    if (targetColId === srcColId && destination.index === source.index) return;

    const newOrder = destination.index;

    // flushSync: React 18+ batches state updates, but @hello-pangea/dnd
    // needs the DOM to reflect the move synchronously before its cleanup runs.
    flushSync(() => {
      onTasksChange?.(prev => prev.map(t =>
        t.task_id === taskId ? { ...t, column_id: targetColId, order: newOrder, sort_order: newOrder } : t
      ));
    });

    try {
      const res = await api.patch(`/tasks/${taskId}/move`, { column_id: targetColId, order: newOrder });
      onTasksChange?.(prev => prev.map(t => t.task_id === taskId ? res.data : t));
      if (res.data.status === 'done') playPraiseSound();
    } catch (e) {
      logger.error('Move failed', e);
      pushToast({ type: 'error', title: 'Could not move task' });
      onTasksChange?.(prev => prev.map(t =>
        t.task_id === taskId ? { ...t, column_id: srcColId } : t
      ));
    }
  }, [onTasksChange, pushToast]);



  return (

    <>

      <DragDropContext
        onDragStart={start => setDraggingId(start.draggableId)}
        onDragEnd={handleDragEnd}
      >

      <div className="k-board">

        {visibleColumns.map(col => {

          const colTasks = byCol[col.column_id] || [];

          const isSynth  = col._synthetic;

          const droppable = canDrop(col);

          return (

            <div key={col.column_id}

              className={`k-bcol${isSynth ? ' k-bcol--requested' : ''}`}

            >

              <div className="k-bcol__head">

                <span className="k-bcol__bar" style={{ background: col.color || 'var(--k-primary)' }} />

                {renamingColId === col.column_id ? (

                  <input

                    ref={renameRef}

                    className="k-input"

                    value={renameVal}

                    onChange={e => setRenameVal(e.target.value)}

                    onBlur={() => commitRename(col)}

                    onKeyDown={e => {

                      if (e.key === 'Enter') commitRename(col);

                      if (e.key === 'Escape') setRenamingColId(null);

                    }}

                    style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: '2px 6px', height: 26 }}

                    autoFocus

                  />

                ) : (

                  <span

                    className="k-bcol__title"

                    onDoubleClick={() => startRename(col)}

                    title={canManageCols && !isSynth ? 'Double-click to rename' : undefined}

                    style={canManageCols && !isSynth ? { cursor: 'text' } : undefined}

                  >

                    {col.name}

                    {isSynth && col._hindi && (

                      <span style={{ fontFamily: 'var(--font-hindi)', fontSize: 11, color: 'var(--ink-3)', marginLeft: 6 }}>{col._hindi}</span>

                    )}

                    {isSynth && !col._hindi && col.column_id === '__requested__' && (

                      <span style={{ fontFamily: 'var(--font-hindi)', fontSize: 11, color: 'var(--ink-3)', marginLeft: 6 }}>अनुरोध</span>

                    )}

                  </span>

                )}

                <span className="k-bcol__count">{colTasks.length}</span>

                {canManageCols && !isSynth && (

                  <button

                    title="Delete column"

                    onClick={() => deleteCol(col)}

                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: '2px 4px', fontSize: 15, lineHeight: 1, borderRadius: 4, opacity: 0.5, marginLeft: 2 }}

                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}

                    onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}

                  >×</button>

                )}

              </div>

              <Droppable droppableId={col.column_id} isDropDisabled={!droppable}>
                {(provided, snapshot) => (
                  <div
                    className={`k-bcol__body${snapshot.isDraggingOver && droppable ? ' is-over' : ''}`}
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                  >

                    {colTasks.map((task, idx) => {

                      const isDraggable = canDrag(task);

                      return (

                        <Draggable key={task.task_id} draggableId={task.task_id} index={idx} isDragDisabled={!isDraggable}>
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                            >
                              <KanbanCard task={task} fieldDefs={fieldDefs || []} fieldValues={fieldValueMap?.[task.task_id] || {}}

                                dragging={dragSnapshot.isDragging}

                                onClick={() => !draggingId && setDrawerTaskId(task.task_id)} />
                            </div>
                          )}
                        </Draggable>

                      );

                    })}

                    {provided.placeholder}

                    {!readOnly && !isSynth && (

                      <button

                        style={{ width: '100%', background: 'transparent', border: '1px dashed var(--rule)', borderRadius: 'var(--r-md)', padding: '7px 0', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 13, fontFamily: 'inherit', marginTop: 4 }}

                        onClick={() => onColumnChange?.('new_task', col.column_id)}

                      >+ Add task</button>

                    )}

                  </div>
                )}
              </Droppable>

            </div>

          );

        })}



        {/* Add column */}

        {canManageCols && (

          <div className="k-bcol k-bcol--add" style={{ minWidth: 220, maxWidth: 240, flexShrink: 0 }}>

            {addingCol ? (

              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>

                <input

                  ref={addColRef}

                  className="k-input"

                  value={newColName}

                  onChange={e => setNewColName(e.target.value)}

                  placeholder="Column name…"

                  onKeyDown={e => { if (e.key === 'Enter') commitAddCol(); if (e.key === 'Escape') { setAddingCol(false); setNewColName(''); } }}

                  autoFocus

                  style={{ fontSize: 13 }}

                />

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

                  <input type="color" value={newColColor} onChange={e => setNewColColor(e.target.value)}

                    style={{ width: 28, height: 28, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} title="Column colour" />

                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer' }}>

                    <input type="checkbox" checked={newColDone} onChange={e => setNewColDone(e.target.checked)} />

                    Mark as Done

                  </label>

                </div>

                <div style={{ display: 'flex', gap: 6 }}>

                  <button className="k-btn k-btn--primary k-btn--sm" onClick={commitAddCol} style={{ flex: 1 }}>Add</button>

                  <button className="k-btn k-btn--ghost k-btn--sm" onClick={() => { setAddingCol(false); setNewColName(''); }}>Cancel</button>

                </div>

              </div>

            ) : (

              <button

                onClick={() => setAddingCol(true)}

                style={{ width: '100%', height: '100%', minHeight: 80, background: 'transparent', border: '2px dashed var(--rule)', borderRadius: 'var(--r-md)', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 13, fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}

              >

                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10"/></svg>

                Add column

              </button>

            )}

          </div>

        )}

      </div>

      </DragDropContext>

      <TaskDrawer taskId={drawerTaskId} open={!!drawerTaskId} onClose={() => setDrawerTaskId(null)}
        teamMembers={teamMembers}
        onSaved={u => {
          if (!u) { setDrawerTaskId(null); return; }
          onTasksChange?.(p => p.map(t => {
            if (t.task_id !== u.task_id) return t;
            return {
              ...t, ...u,
              column_name:    u.column_name    ?? t.column_name,
              column_color:   u.column_color   ?? t.column_color,
              assignee_names: u.assignee_names?.length ? u.assignee_names : (t.assignee_names || []),
            };
          }));
        }} />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />

    </>

  );

}

