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
import { VIEWS, FIELD_TYPES, IcPlus } from '../components/views/viewDefs';
import AutomationsPage from './AutomationsPage';
import NewTaskModal from '../components/NewTaskModal';

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
            {/* `aria-pressed` drives the pressed treatment through
                `.pb__toggle[aria-pressed="true"]`. It was an inline
                `style={{ background }}` ternary, which is a state a screen
                reader could not perceive at all — and an inline declaration
                that would have outranked any later focus ring. */}
            <button
              type="button"
              className="k-btn k-btn--ghost k-btn--sm pb__toggle"
              aria-pressed={showFieldMgr}
              onClick={() => { setShowFieldMgr(v => !v); setShowAutomations(false); }}
            >
              Fields
            </button>
            <button
              type="button"
              className="k-btn k-btn--ghost k-btn--sm pb__toggle"
              aria-pressed={showAutomations}
              onClick={() => { setShowAutomations(v => !v); setShowFieldMgr(false); }}
            >
              Automations
            </button>
            <button type="button" className="k-link" onClick={() => activeId && navigate(`/projects/${activeId}`)}>
              Open project →
            </button>
          </div>
        }
      />

      {/* One toolbar, shared with every other view — 04 §2. The switcher was a
          hand-rolled `.k-segctrl` in an inline-styled flex row here, and again
          in ProjectBoardPage, which is why the two drifted. */}
      <ViewToolbar
        views={VIEWS}
        view={view}
        onView={setView}
        end={!loading && view !== 'kanban' && activeId && (
          <button
            type="button"
            className="btn btn--fill btn--sm vtb__ico"
            onClick={() => setNewTaskEditor({ open: true, columnId: null })}
          >
            {IcPlus}
            New task
          </button>
        )}
      />

      {/* Field manager panel */}
      {showFieldMgr && (
        <section className="k-card">
          <header className="k-card__head">
            <div className="k-card__titles">
              <h3 className="k-card__title">Custom Fields</h3>
            </div>
            <button type="button" className="k-iconbtn pb__panelx" onClick={() => setShowFieldMgr(false)} title="Close" aria-label="Close custom fields panel">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>
            </button>
          </header>
          {/* The same panel, the same classes, as ProjectBoardPage. It was
              written twice as inline style objects on `--ink-3` / `--bg-soft`
              and the two copies had already drifted — this one keyed Enter to
              submit, the other did not. `.pb__*` in boards.css is the object. */}
          <div className="k-card__body">
            <div className="pb__fieldadd">
              <input
                className="inp"
                value={newFieldName}
                aria-label="Field name"
                placeholder="Field name"
                onChange={e => setNewFieldName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addField()}
              />
              <select className="inp pb__fieldtype" aria-label="Field type" value={newFieldType} onChange={e => setNewFieldType(e.target.value)}>
                {FIELD_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
              <button type="button" className="btn btn--fill btn--sm" onClick={addField}>Add</button>
            </div>
            {(fieldDefs || []).length === 0 ? (
              <p className="pb__none">No custom fields yet.</p>
            ) : (
              <div className="pb__fields">
                {(fieldDefs || []).map(f => (
                  <span key={f.field_id} className="pb__field">
                    <span className="pb__fieldn">{f.name}</span>
                    <span className="pb__fieldt">{f.type}</span>
                    <button
                      type="button"
                      className="pb__fieldx"
                      aria-label={`Delete field ${f.name}`}
                      onClick={() => deleteField(f.field_id)}
                    >
                      <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>
                    </button>
                  </span>
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
            <button type="button" className="k-iconbtn pb__panelx" onClick={() => setShowAutomations(false)} title="Close" aria-label="Close automations panel">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>
            </button>
          </header>
          <div className="k-card__body pb__autobody">
            <AutomationsPage teamId={activeId} embedded />
          </div>
        </section>
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
