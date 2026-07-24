/**
 * TasksListPage.jsx — editorial Tasks screen with resizable + toggleable columns.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { currentUser } from '../lib/auth';
import { useToast } from '../components/ui/toast';
import TaskDrawer  from '../components/TaskDrawer';
import NewTaskModal from '../components/NewTaskModal';
import { PageHeader, DueChip, PriorityDot, StatusChip, ProjectTag } from '../components/editorial';
import { AVATAR_COLORS, avatarColor, priorityColor, userInitials, relTime } from '../lib/utils';
import { PRIORITY_LABELS, STATUS_LABELS, STATUS_COLORS } from '../components/drawer/constants';
import { SkeletonTable, SkeletonRegion } from '../components/ui/Skeleton';

const PRIORITY_ORDER = ['urgent','high','medium','low'];
const PRIORITY_HI    = { urgent:'अत्यावश्यक', high:'उच्च', medium:'मध्यम', low:'न्यून' };
const STATUS_ORDER   = ['todo','in_progress','in_review','done','requested'];
const STATUS_HI      = { todo:'कार्य', in_progress:'चालू', in_review:'समीक्षा', done:'सम्पन्न', requested:'अनुरोध' };

// All available columns. 'task' is always visible and cannot be hidden.
const ALL_COLS = [
  { key: 'task',       label: 'Task',         defaultW: 340, min: 180, fixed: true  },
  { key: 'project',    label: 'Project',      defaultW: 180, min: 100, fixed: false },
  { key: 'assignees',  label: 'Assignees',    defaultW: 200, min: 120, fixed: false },
  { key: 'category',   label: 'Category',     defaultW: 140, min: 90,  fixed: false },
  { key: 'due',        label: 'Due',          defaultW: 150, min: 120, fixed: false },
  { key: 'updated',    label: 'Last Updated', defaultW: 130, min: 100, fixed: false },
  { key: 'status',     label: 'Status',       defaultW: 130, min: 90,  fixed: false },
];

const DEFAULT_VISIBLE = new Set(['task','project','assignees','due','status']);


function useResizableCols(cols) {
  const [widths, setWidths] = useState(() => Object.fromEntries(cols.map(c => [c.key, c.defaultW])));
  const dragging = useRef(null);

  const onMouseDown = useCallback((e, key, min) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widths[key];
    dragging.current = { key, startX, startW, min };
    function onMove(ev) {
      if (!dragging.current) return;
      const { key, startX, startW, min } = dragging.current;
      setWidths(prev => ({ ...prev, [key]: Math.max(min, startW + ev.clientX - startX) }));
    }
    function onUp() {
      dragging.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [widths]);

  return { widths, onMouseDown };
}

function ColumnsPopover({ visible, onToggle, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="k-col-popover">
      <div className="k-col-popover__head">Columns</div>
      {ALL_COLS.filter(c => !c.fixed).map(col => (
        <label key={col.key} className="k-col-popover__row">
          <span className="k-col-popover__check">
            <input
              type="checkbox"
              checked={visible.has(col.key)}
              onChange={() => onToggle(col.key)}
            />
            <span className="k-col-popover__box" />
          </span>
          <span className="k-col-popover__name">{col.label}</span>
        </label>
      ))}
    </div>
  );
}

export default function TasksListPage() {
  const { pushToast } = useToast();
  const user     = currentUser();
  const isClient = user?.role === 'client';

  const [tasks,        setTasks]        = useState([]);
  const [teams,        setTeams]        = useState([]);
  const [categories,   setCategories]   = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [filter,       setFilter]       = useState('all');
  const [group,        setGroup]        = useState('priority');
  const [drawerTaskId, setDrawerTaskId] = useState(null);
  const [newTaskOpen,  setNewTaskOpen]  = useState(false);
  const [colsOpen,     setColsOpen]     = useState(false);
  const [visible,      setVisible]      = useState(DEFAULT_VISIBLE);
  const [showArchived, setShowArchived] = useState(false);

  const activeCols = ALL_COLS.filter(c => c.fixed || visible.has(c.key));
  const { widths, onMouseDown } = useResizableCols(ALL_COLS);

  const gridTemplate = activeCols.map(c => `${widths[c.key]}px`).join(' ');
  const rowStyle = { gridTemplateColumns: gridTemplate };

  const toggleCol = useCallback(key => {
    setVisible(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const load = useCallback(async (archived = false) => {
    setLoading(true);
    try {
      const endpoint = isClient
        ? '/client/tasks'
        : `/tasks${archived ? '?archived=true' : ''}`;
      const reqs = [
        api.get(endpoint),
        isClient ? api.get('/client/projects') : api.get('/teams'),
      ];
      if (!isClient) reqs.push(api.get('/categories'));
      const [tRes, pRes, cRes] = await Promise.all(reqs);
      setTasks(Array.isArray(tRes.data) ? tRes.data : []);
      setTeams((Array.isArray(pRes.data) ? pRes.data : []).map(t => ({ team_id: t.team_id, name: t.name })));
      if (cRes) setCategories(Array.isArray(cRes.data) ? cRes.data : []);
    } catch (_) { pushToast({ type: 'error', title: 'Could not load tasks' }); }
    finally { setLoading(false); }
  }, [isClient, pushToast]);

  // On mount: load tasks and trigger auto-archive in background
  useEffect(() => {
    load(false);
    if (!isClient) api.post('/tasks/auto-archive').catch(() => {});
  }, [load, isClient]);

  // Reload when switching archived view
  useEffect(() => { load(showArchived); }, [showArchived]); // eslint-disable-line react-hooks/exhaustive-deps

  const archiveTask = useCallback(async (taskId, e) => {
    e.stopPropagation();
    try {
      await api.patch(`/tasks/${taskId}/archive`);
      setTasks(prev => prev.filter(t => t.task_id !== taskId));
      pushToast({ type: 'success', title: 'Task archived' });
    } catch { pushToast({ type: 'error', title: 'Could not archive task' }); }
  }, [pushToast]);

  const unarchiveTask = useCallback(async (taskId, e) => {
    e.stopPropagation();
    try {
      await api.patch(`/tasks/${taskId}/unarchive`);
      setTasks(prev => prev.filter(t => t.task_id !== taskId));
      pushToast({ type: 'success', title: 'Task restored' });
    } catch { pushToast({ type: 'error', title: 'Could not restore task' }); }
  }, [pushToast]);

  const myId = user?.user_id;
  const filtered = tasks.filter(t => {
    const matchSearch = !search || t.title.toLowerCase().includes(search.toLowerCase());
    if (showArchived) return matchSearch;
    let matchFilter = true;
    if (filter === 'mine')    matchFilter = (t.user_id === myId || t.assignee_user_ids?.includes(myId)) && t.status !== 'done';
    if (filter === 'all')     matchFilter = t.status !== 'done';
    if (filter === 'overdue') matchFilter = t.due_at && new Date(t.due_at) < new Date() && t.status !== 'done';
    if (filter === 'done')    matchFilter = t.status === 'done';
    return matchSearch && matchFilter;
  });

  const groups = [];
  if (group === 'priority') {
    PRIORITY_ORDER.forEach(p => {
      const items = filtered.filter(t => t.priority === p);
      if (items.length) groups.push({ key: p, title: PRIORITY_LABELS[p], sans: PRIORITY_HI[p], color: priorityColor(p), items });
    });
    const rest = filtered.filter(t => !PRIORITY_ORDER.includes(t.priority));
    if (rest.length) groups.push({ key: 'other', title: 'Other', sans: 'अन्य', color: '#94a3b8', items: rest });
  } else if (group === 'project') {
    teams.forEach(team => {
      const items = filtered.filter(t => t.team_id === team.team_id);
      if (items.length) groups.push({ key: team.team_id, title: team.name, sans: '', color: AVATAR_COLORS[groups.length % AVATAR_COLORS.length], items });
    });
    const orphans = filtered.filter(t => !teams.find(tm => tm.team_id === t.team_id));
    if (orphans.length) groups.push({ key: 'none', title: 'No project', sans: 'अन्य', color: '#94a3b8', items: orphans });
  } else {
    STATUS_ORDER.forEach(s => {
      const items = filtered.filter(t => t.status === s);
      if (items.length) groups.push({ key: s, title: STATUS_LABELS[s], sans: STATUS_HI[s], color: STATUS_COLORS[s], items });
    });
  }

  const filterCounts = {
    mine:    tasks.filter(t => (t.user_id === myId || t.assignee_user_ids?.includes(myId)) && t.status !== 'done').length,
    all:     tasks.filter(t => t.status !== 'done').length,
    overdue: tasks.filter(t => t.due_at && new Date(t.due_at) < new Date() && t.status !== 'done').length,
    done:    tasks.filter(t => t.status === 'done').length,
  };

  const hiddenCount = ALL_COLS.filter(c => !c.fixed && !visible.has(c.key)).length;

  return (
    <div className="k-screen">
      <PageHeader
        kicker="WORKSPACE"
        title={isClient ? 'My Tasks' : 'Tasks'}
        sanskrit="कर्तव्य"
        lede="The list of what's worth doing today."
        right={
          !isClient && (
            <button className="k-btn k-btn--primary k-btn--sm" onClick={() => setNewTaskOpen(true)}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10"/></svg>
              New task
            </button>
          )
        }
      />

      {/* Filter bar */}
      <div className="k-filterbar">
        <div className="k-segctrl">
          {[
            { key: 'mine',    label: 'Mine' },
            { key: 'all',     label: 'All open' },
            { key: 'overdue', label: 'Overdue' },
            { key: 'done',    label: 'Done' },
          ].map(f => (
            <button
              key={f.key}
              className={'k-segctrl__btn' + (!showArchived && filter === f.key ? ' is-active' : '')}
              onClick={() => { setShowArchived(false); setFilter(f.key); }}
            >
              {f.label}
              <span className="k-segctrl__count">{filterCounts[f.key]}</span>
            </button>
          ))}
          <button
            className={'k-segctrl__btn k-segctrl__btn--archive' + (showArchived ? ' is-active' : '')}
            onClick={() => setShowArchived(v => !v)}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="4" width="14" height="3" rx="1"/><path d="M2 7v6a1 1 0 001 1h10a1 1 0 001-1V7"/><path d="M6 10h4"/></svg>
            Archived
          </button>
        </div>
        <div className="k-filterbar__right">
          {/* Columns toggle */}
          <div style={{ position: 'relative' }}>
            <button
              className={'k-btn k-btn--ghost k-btn--sm' + (colsOpen ? ' is-active' : '')}
              onClick={() => setColsOpen(v => !v)}
              style={{ gap: 6 }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="1" y="3" width="4" height="10" rx="1"/><rect x="6" y="3" width="4" height="10" rx="1"/><rect x="11" y="3" width="4" height="10" rx="1"/>
              </svg>
              Columns
              {hiddenCount > 0 && <span className="k-badge">{hiddenCount} hidden</span>}
            </button>
            {colsOpen && (
              <ColumnsPopover
                visible={visible}
                onToggle={toggleCol}
                onClose={() => setColsOpen(false)}
              />
            )}
          </div>

          <label className="k-fld">
            <span className="k-fld__lbl">Group by</span>
            <select value={group} onChange={e => setGroup(e.target.value)} className="k-fld__sel">
              <option value="priority">Priority</option>
              <option value="project">Project</option>
              <option value="status">Status</option>
            </select>
          </label>
          <div className="k-topbar__search" style={{ maxWidth: 220 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" />
          </div>
        </div>
      </div>

      {loading ? (
        <SkeletonRegion label="Loading tasks…">
          <SkeletonTable rows={8} columns={activeCols.length} />
        </SkeletonRegion>
      ) : (
        <div className="k-tablewrap" style={{ overflowX: 'auto' }}>
          {/* Header */}
          <div className="k-table__head k-trow--resizable" style={rowStyle}>
            {activeCols.map((col, idx) => (
              <div key={col.key} className={`k-table__hcell k-c-${col.key}`} style={{ position: 'relative', userSelect: 'none' }}>
                {col.label}
                {idx < activeCols.length - 1 && (
                  <span className="k-col-resize" onMouseDown={e => onMouseDown(e, col.key, col.min)} />
                )}
              </div>
            ))}
          </div>

          {groups.length === 0 && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-3)', fontStyle: 'italic' }}>
              No tasks match this filter.
            </div>
          )}

          {groups.map(g => (
            <div key={g.key} className="k-group">
              <div className="k-group__head" style={{ '--group-color': g.color }}>
                <span className="k-group__bar" />
                <span className="k-group__title">{g.title}</span>
                {g.sans && <span className="k-group__sans">{g.sans}</span>}
                <span className="k-group__count">{g.items.length}</span>
              </div>
              {g.items.map((t, idx) => {
                const team      = teams.find(tm => tm.team_id === t.team_id);
                const cat       = categories.find(c => c.category_id === t.category_id);
                const assignees = (t.assignee_names || []).map(name => ({ name, color: avatarColor(name) }));
                return (
                  <button
                    key={t.task_id}
                    className={'k-trow k-trow--resizable' + (t.archived_at ? ' k-trow--archived' : '')}
                    style={rowStyle}
                    onClick={() => setDrawerTaskId(t.task_id)}
                  >
                    {activeCols.map(col => {
                      switch (col.key) {
                        case 'task':
                          return (
                            <div key="task" className="k-trow__cell k-c-task">
                              <PriorityDot priority={t.priority} />
                              <span className="k-trow__id">KAR-{String(idx + 100)}</span>
                              <span className="k-trow__title">{t.title}</span>
                              {t.attachments?.length > 0 && (
                                <span className="k-trow__attach" title={`${t.attachments.length} attachment${t.attachments.length > 1 ? 's' : ''}`}>
                                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M10 3l-5 5a2.5 2.5 0 003.5 3.5l5-5a4 4 0 00-5.7-5.7L3 5.5"/></svg>
                                  {t.attachments.length}
                                </span>
                              )}
                              {showArchived ? (
                                <button
                                  className="k-row-action k-row-action--unarchive"
                                  onClick={e => unarchiveTask(t.task_id, e)}
                                  title="Restore task"
                                >
                                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 12V6M5 9l3-3 3 3"/><rect x="1" y="4" width="14" height="3" rx="1"/></svg>
                                  Restore
                                </button>
                              ) : (
                                <button
                                  className="k-row-action k-row-action--archive"
                                  onClick={e => archiveTask(t.task_id, e)}
                                  title="Archive task"
                                >
                                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="4" width="14" height="3" rx="1"/><path d="M2 7v6a1 1 0 001 1h10a1 1 0 001-1V7"/><path d="M6 10h4"/></svg>
                                </button>
                              )}
                            </div>
                          );
                        case 'project':
                          return (
                            <div key="project" className="k-trow__cell k-c-project">
                              {team ? <ProjectTag name={team.name} dense /> : <span className="k-trow__empty">—</span>}
                            </div>
                          );
                        case 'assignees':
                          return (
                            <div key="assignees" className="k-trow__cell k-c-assignees">
                              {assignees.length === 0
                                ? <span className="k-trow__empty">—</span>
                                : assignees.slice(0, 3).map((a, j) => (
                                    <span key={j} className="k-assignee-pill" style={{ '--av-c': a.color }}>
                                      <span className="k-assignee-pill__avatar">{userInitials(a.name)}</span>
                                      <span className="k-assignee-pill__name">{a.name}</span>
                                    </span>
                                  ))
                              }
                              {assignees.length > 3 && <span className="k-assignee-pill__more">+{assignees.length - 3}</span>}
                            </div>
                          );
                        case 'category':
                          return (
                            <div key="category" className="k-trow__cell k-c-category">
                              {cat
                                ? <span className="k-cat-chip" style={{ '--cat-c': cat.color }}>
                                    <span className="k-cat-chip__dot" />
                                    {cat.name}
                                  </span>
                                : <span className="k-trow__empty">—</span>
                              }
                            </div>
                          );
                        case 'due':
                          return (
                            <div key="due" className="k-trow__cell k-c-due">
                              <DueChip date={t.due_at} status={t.status} completedAt={t.completed_at} />
                            </div>
                          );
                        case 'updated':
                          return (
                            <div key="updated" className="k-trow__cell k-c-updated">
                              <span className="k-trow__meta">{relTime(t.updated_at) || '—'}</span>
                            </div>
                          );
                        case 'status':
                          return (
                            <div key="status" className="k-trow__cell k-c-status">
                              <StatusChip status={t.status} approvalStatus={t.approval_status} columnName={t.column_name} columnColor={t.column_color} />
                            </div>
                          );
                        default: return null;
                      }
                    })}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <TaskDrawer
        taskId={drawerTaskId}
        open={!!drawerTaskId}
        onClose={() => setDrawerTaskId(null)}
        onSaved={updated => {
          if (!updated) { setDrawerTaskId(null); return; }
          setTasks(prev => prev.map(t => {
            if (t.task_id !== updated.task_id) return t;
            return {
              ...t, ...updated,
              column_name:    updated.column_name    ?? t.column_name,
              column_color:   updated.column_color   ?? t.column_color,
              assignee_names: updated.assignee_names?.length ? updated.assignee_names : (t.assignee_names || []),
            };
          }));
        }}
      />

      <NewTaskModal
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        onCreated={() => { setNewTaskOpen(false); load(); }}
      />
    </div>
  );
}
