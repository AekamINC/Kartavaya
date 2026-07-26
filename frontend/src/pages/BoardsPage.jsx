/**
 * BoardsPage.jsx — dedicated Boards page with project switcher + view toggle.
 * Route: /boards
 */
import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { api }          from '../lib/api';
import { currentUser }  from '../lib/auth';
const KanbanView   = lazy(() => import('../components/views/KanbanView'));
const TableView    = lazy(() => import('../components/views/TableView'));
const CalendarView = lazy(() => import('../components/views/CalendarView'));
const TimelineView = lazy(() => import('../components/views/TimelineView'));
const WorkloadView = lazy(() => import('../components/views/WorkloadView'));
const PriorityView = lazy(() => import('../components/views/PriorityView'));
const MyTasksView  = lazy(() => import('../components/views/MyTasksView'));
import { useFields }    from '../hooks/useFields';
import { useRealtimeTasks } from '../hooks/useRealtimeTasks';
import { usePresence }  from '../hooks/usePresence';
import { PageHeader } from '../components/editorial';
import {
  AvatarStack, avatarBg, useToast,
  SkeletonBoard, SkeletonList, SkeletonRegion,
} from '../components/ui';
import ViewToolbar from '../components/views/ViewToolbar';
import AutomationsPage from './AutomationsPage';
import NewTaskModal from '../components/NewTaskModal';

const VIEWS = [
  { id: 'kanban',   label: 'Board',
    icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="3" width="4" height="10" rx="1"/><rect x="6" y="3" width="4" height="10" rx="1"/><rect x="11" y="3" width="4" height="10" rx="1"/></svg> },
  { id: 'table',    label: 'List',
    icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h12M2 12h12"/></svg> },
  { id: 'calendar', label: 'Calendar',
    icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 2v2M11 2v2M2 7h12"/></svg> },
  { id: 'timeline', label: 'Timeline',
    icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 5h5M2 8h9M2 11h6"/><circle cx="9" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="13" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="11" r="1.5" fill="currentColor" stroke="none"/></svg> },
  { id: 'workload', label: 'Workload',
    icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="5" r="2.5"/><circle cx="11" cy="5" r="2"/><path d="M1 13c0-2.2 2-4 5-4s5 1.8 5 4"/><path d="M11 9c2 .5 3 1.8 3 3"/></svg> },
  { id: 'priority', label: 'Priority',
    icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3l12 0M2 7l8 0M2 11l5 0"/></svg> },
  { id: 'mytasks',  label: 'My Tasks',
    icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3 2.7-5 6-5s6 2 6 5"/><path d="M6 10.5l1.5 1.5 3-3" strokeWidth="1.8"/></svg> },
];

export default function BoardsPage() {
  const navigate  = useNavigate();
  const me        = currentUser();
  const isClient  = me?.role === 'client';

  const [projects,    setProjects]    = useState([]);
  const [activeId,    setActiveId]    = useState(null);
  const [project,     setProject]     = useState(null);
  const [columns,     setColumns]     = useState([]);
  const [rawTasks,    setRawTasks]    = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [view,        setView]        = useState('kanban');
  const [newTaskEditor, setNewTaskEditor] = useState({ open: false, columnId: null, dueAt: '' });

  const { defs: fieldDefs, createField, deleteField } = useFields(activeId);
  const { pushToast } = useToast();
  const [showFieldMgr,    setShowFieldMgr]    = useState(false);
  const [showAutomations, setShowAutomations] = useState(false);
  const [newFieldName,    setNewFieldName]    = useState('');
  const [newFieldType,    setNewFieldType]    = useState('text');
  const { tasks, setTasks } = useRealtimeTasks(activeId, rawTasks);
  const onlineUsers = usePresence(activeId, me);

  useEffect(() => {
    const endpoint = isClient ? '/client/projects' : '/teams';
    api.get(endpoint).then(r => {
      const list = Array.isArray(r.data) ? r.data : [];
      setProjects(list);
      if (list.length && !activeId) setActiveId(list[0].team_id);
    }).catch(() => {});
  }, []);

  const loadBoard = useCallback(async () => {
    if (!activeId) return;
    setLoading(true);
    try {
      const [projR, colR, taskR, membR] = await Promise.all([
        api.get(`/teams/${activeId}`),
        api.get(`/projects/${activeId}/columns`),
        api.get('/tasks', { params: { team_id: activeId } }),
        api.get(`/teams/${activeId}/members`).catch(() => ({ data: [] })),
      ]);
      setProject(projR.data);
      setColumns(colR.data || []);
      setRawTasks(taskR.data || []);
      setTeamMembers(membR.data || []);
    } catch (_) {}
    finally { setLoading(false); }
  }, [activeId]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  const handleTasksChange = useCallback((updatedTasks) => {
    setTasks(updatedTasks);
  }, [setTasks]);

  // Close panels when switching projects
  const switchProject = (id) => {
    setActiveId(id);
    setShowFieldMgr(false);
    setShowAutomations(false);
    setNewTaskEditor({ open: false, columnId: null, dueAt: '' });
  };

  const handleColumnChange = useCallback((action, payload) => {
    if (action === 'new_task') setNewTaskEditor({ open: true, columnId: payload, dueAt: '' });
  }, []);

  const addField = async () => {
    if (!newFieldName.trim()) return;
    try {
      await createField({ name: newFieldName.trim(), type: newFieldType, config: {} });
      setNewFieldName('');
      pushToast({ type: 'success', title: 'Field added' });
    } catch (e) {
      pushToast({ type: 'error', title: 'Could not add field', body: e?.response?.data?.detail || e?.message });
    }
  };

  const activeProject = projects.find(p => p.team_id === activeId);
  // `AVATAR_COLORS` is the legacy list and still carries the retired brand blue
  // `#0082c6` (00 §9). It also keyed off the array INDEX, so the same person
  // changed colour whenever someone else joined or left the presence channel.
  // `Avatar` hashes the name, which is stable and drawn from the palette.
  const onlineAvatars = onlineUsers.map(u => ({ name: u.name || u.email || '?' }));

  return (
    <div className="k-screen">

      <PageHeader
        kicker="AEKAM INC · फ़लक"
        title={project?.name || activeProject?.name || 'Select a project'}
        lede="Move work across the board. Click any card to open."
        right={
          <div className="k-headerright">
            {onlineAvatars.length > 0 && (
              <AvatarStack users={onlineAvatars} size={24} max={4} />
            )}
            <div className="k-projectpicker">
              {projects.map(p => (
                <button
                  key={p.team_id}
                  className={'k-projectpicker__chip' + (p.team_id === activeId ? ' is-active' : '')}
                  onClick={() => switchProject(p.team_id)}
                >
                  <span className="k-projectpicker__dot" style={{ background: avatarBg(p.name) }} />
                  {p.name}
                </button>
              ))}
            </div>
            <button
              className="k-btn k-btn--ghost k-btn--sm"
              onClick={() => { setShowFieldMgr(v => !v); setShowAutomations(false); }}
              style={showFieldMgr ? { background: 'var(--bg-soft)' } : {}}
            >
              ⚙ Fields
            </button>
            <button
              className="k-btn k-btn--ghost k-btn--sm"
              onClick={() => { setShowAutomations(v => !v); setShowFieldMgr(false); }}
              style={showAutomations ? { background: 'var(--bg-soft)' } : {}}
            >
              ⚡ Automations
            </button>
            <button className="k-link" onClick={() => activeId && navigate(`/projects/${activeId}`)}>
              Open project →
            </button>
          </div>
        }
      />

      {/* One toolbar, shared with every other view — 04 §2. The switcher was a
          hand-rolled `.k-segctrl` in an inline-styled flex row here, and again
          in ProjectBoardPage, which is why the two drifted. */}
      <ViewToolbar views={VIEWS} view={view} onView={setView} />

      {/* Field manager panel */}
      {showFieldMgr && (
        <section className="k-card">
          <header className="k-card__head">
            <div className="k-card__titles">
              <h3 className="k-card__title">Custom Fields</h3>
            </div>
            <button className="k-iconbtn" style={{ marginLeft: 'auto', opacity: 0.5 }} onClick={() => setShowFieldMgr(false)} title="Close" aria-label="Close custom fields panel">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l10 10M13 3L3 13"/></svg>
            </button>
          </header>
          <div className="k-card__body">
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'flex-end' }}>
              <input
                className="k-input"
                value={newFieldName}
                onChange={e => setNewFieldName(e.target.value)}
                placeholder="Field name"
                style={{ flex: 1 }}
                onKeyDown={e => e.key === 'Enter' && addField()}
              />
              <select className="k-select" value={newFieldType} onChange={e => setNewFieldType(e.target.value)}>
                {[
                  { v: 'text',     l: 'Text' },
                  { v: 'number',   l: 'Number' },
                  { v: 'date',     l: 'Date' },
                  { v: 'select',   l: 'Select / Dropdown' },
                  { v: 'checkbox', l: 'Checkbox' },
                  { v: 'url',      l: 'URL' },
                  { v: 'person',   l: 'Person' },
                ].map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
              <button className="k-btn k-btn--primary k-btn--sm" onClick={addField}>Add</button>
            </div>
            {(fieldDefs || []).length === 0 ? (
              <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No custom fields yet.</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(fieldDefs || []).map(f => (
                  <div key={f.field_id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-soft)', borderRadius: 'var(--r-sm)', padding: '4px 10px', fontSize: 13 }}>
                    <span style={{ fontWeight: 500 }}>{f.name}</span>
                    <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{f.type}</span>
                    <button onClick={() => deleteField(f.field_id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 14, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Automations panel */}
      {showAutomations && (
        <section className="k-card">
          <header className="k-card__head">
            <div className="k-card__titles">
              <h3 className="k-card__title">Automations</h3>
              <span className="k-card__sans">स्वचालन</span>
            </div>
            <button className="k-iconbtn" style={{ marginLeft: 'auto', opacity: 0.5 }} onClick={() => setShowAutomations(false)} title="Close" aria-label="Close automations panel">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l10 10M13 3L3 13"/></svg>
            </button>
          </header>
          <div className="k-card__body" style={{ paddingTop: 0 }}>
            <AutomationsPage teamId={activeId} embedded />
          </div>
        </section>
      )}

      {/* New task bar — shown on non-kanban views (kanban has per-column + Add task buttons) */}
      {!loading && view !== 'kanban' && activeId && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            className="k-btn k-btn--primary k-btn--sm"
            onClick={() => setNewTaskEditor({ open: true, columnId: null })}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10"/></svg>
            New task
          </button>
        </div>
      )}

      {/* Content. A skeleton is shaped like the content it replaces — 26 §9 —
          so the board gets columns of cards and the list gets rows. The
          italic "Loading…" line was a different shape from all seven views and
          produced a visible jump on every load. */}
      {loading ? (
        <SkeletonRegion label="Loading board…">
          {view === 'kanban' ? <SkeletonBoard columns={4} cards={3} /> : <SkeletonList rows={8} />}
        </SkeletonRegion>
      ) : (
        <Suspense fallback={<SkeletonRegion label="Loading view…"><SkeletonList rows={6} /></SkeletonRegion>}>
          {view === 'kanban' && (
            <KanbanView
              columns={columns}
              tasks={tasks}
              teamMembers={teamMembers}
              fieldDefs={fieldDefs}
              teamId={activeId}
              currentUserId={me?.user_id}
              currentUserRole={me?.role}
              showRequested={me?.role !== 'client'}
              showClientApproval
              onTasksChange={handleTasksChange}
              onColumnChange={handleColumnChange}
              onColumnsChange={setColumns}
            />
          )}
          {view === 'table' && (
            <TableView
              tasks={tasks}
              columns={columns}
              teamMembers={teamMembers}
              fieldDefs={fieldDefs}
              boardId={activeId}
              onTasksChange={handleTasksChange}
            />
          )}
          {view === 'calendar' && (
            <CalendarView
              tasks={tasks}
              teamMembers={teamMembers}
              onTasksChange={handleTasksChange}
              onDayClick={date => {
                const p = n => String(n).padStart(2, '0');
                setNewTaskEditor({ open: true, columnId: null, dueAt: `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}` });
              }}
            />
          )}
          {view === 'timeline' && (
            <TimelineView
              tasks={tasks}
              columns={columns}
              teamMembers={teamMembers}
              onTasksChange={handleTasksChange}
            />
          )}
          {view === 'workload' && (
            <WorkloadView
              tasks={tasks}
              teamMembers={teamMembers}
            />
          )}
          {view === 'priority' && (
            <PriorityView
              tasks={tasks}
              columns={columns}
              teamMembers={teamMembers}
              onTasksChange={handleTasksChange}
            />
          )}
          {view === 'mytasks' && (
            <MyTasksView
              tasks={tasks}
              teamMembers={teamMembers}
              onTasksChange={handleTasksChange}
            />
          )}
        </Suspense>
      )}

      <NewTaskModal
        open={newTaskEditor.open}
        onClose={() => setNewTaskEditor({ open: false, columnId: null, dueAt: '' })}
        onCreated={task => {
          if (task) setTasks(prev => [task, ...prev]);
          setNewTaskEditor({ open: false, columnId: null, dueAt: '' });
        }}
        defaultProjectId={activeId}
        defaultColumnId={newTaskEditor.columnId}
        defaultDueAt={newTaskEditor.dueAt}
      />
    </div>
  );
}
