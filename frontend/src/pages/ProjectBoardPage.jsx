/**
 * ProjectBoardPage — the project workspace: seven views over one task set,
 * Supabase Realtime for live updates, and Presence for who else is looking.
 *
 * **The duplicate view switcher is gone (04 §2).** This page carried its own
 * `.k-segctrl` — its own icons, its own active treatment, its own scroll
 * wrapper — while `views/ViewToolbar.jsx` exists precisely because Board,
 * Table, Calendar, Timeline, Workload and Priority all need the same switch.
 * Two switchers for one board is how the same control ends up in a different
 * place on two views, and how "Group by column" in one reads "Column" in
 * another. The view SET moved out too, to `views/viewDefs.jsx` — BoardsPage
 * carried a byte-identical copy of the same seven entries and fourteen SVGs.
 *
 * The Archived toggle moved OUT of the segmented control. It sat inside
 * `.k-segctrl` beside the seven views, which made it read as an eighth view and
 * announce as an eighth tab — it is a filter over the current view, so it is a
 * pressed-state button in the toolbar's trailing slot.
 *
 * Realtime: `useRealtimeTasks` owns `tasks`. `rawTasks` from the initial API
 * load seeds it; from then on Supabase pushes INSERT/UPDATE/DELETE patches
 * straight into state for every user on the board. It needs
 * `REPLICA IDENTITY FULL` on `tasks` and `columns`, and both tables added to
 * the `supabase_realtime` publication.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import { api }         from '../lib/api';
import { currentUser } from '../lib/auth';
import { AVATAR_COLORS, logger } from '../lib/utils';

import KanbanView   from '../components/views/KanbanView';
import TableView    from '../components/views/TableView';
import CalendarView from '../components/views/CalendarView';
import TimelineView from '../components/views/TimelineView';
import WorkloadView from '../components/views/WorkloadView';
import PriorityView from '../components/views/PriorityView';
import MyTasksView  from '../components/views/MyTasksView';
import ViewToolbar  from '../components/views/ViewToolbar';
import { VIEWS, FIELD_TYPES, IcArchive, IcPlus } from '../components/views/viewDefs';
import NewTaskModal from '../components/NewTaskModal';

import { useFields }        from '../hooks/useFields';
import { useViews }         from '../hooks/useViews';
import { useRealtimeTasks } from '../hooks/useRealtimeTasks';
import { usePresence }      from '../hooks/usePresence';

import { PageHeader, AvatarStack } from '../components/editorial';
import { useToast } from '../components/ui/toast';

import AutomationsPage from './AutomationsPage';

export default function ProjectBoardPage() {
  const { projectId } = useParams();
  const navigate      = useNavigate();
  const me            = currentUser();

  const [project,       setProject]       = useState(null);
  const [columns,       setColumns]       = useState([]);
  const [rawTasks,      setRawTasks]      = useState([]);   // seeds useRealtimeTasks
  const [teamMembers,   setTeamMembers]   = useState([]);
  const [view,          setView]          = useState('kanban');
  const [fieldValueMap, setFieldValueMap] = useState({});
  const [loading,       setLoading]       = useState(true);
  const [showArchived,  setShowArchived]  = useState(false);
  const [showFieldMgr,  setShowFieldMgr]  = useState(false);
  const [showAutomations, setShowAutomations] = useState(false);
  const [newFieldName,  setNewFieldName]  = useState('');
  const [newFieldType,  setNewFieldType]  = useState('text');
  const [newTaskEditor, setNewTaskEditor] = useState({ open: false, columnId: null, dueAt: '' });

  const { defs: fieldDefs, createField, deleteField } = useFields(projectId);
  const { savedViews, saveView } = useViews(projectId);
  const { pushToast } = useToast();

  const { tasks, setTasks } = useRealtimeTasks(projectId, rawTasks);
  const onlineUsers = usePresence(projectId, me);

  // ── Initial data load ────────────────────────────────────────────────────
  const load = useCallback(async (archived = false) => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [projR, colR, taskR] = await Promise.all([
        api.get(`/teams/${projectId}`),
        api.get(`/projects/${projectId}/columns`),
        api.get('/tasks', { params: { team_id: projectId, ...(archived ? { archived: true } : {}) } }),
      ]);
      setProject(projR.data);
      setColumns(Array.isArray(colR.data) ? colR.data : []);
      setRawTasks(Array.isArray(taskR.data) ? taskR.data : []);
      setTeamMembers(projR.data.members || []);
    } catch (e) {
      logger.error('Board load failed', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load(false);
    api.post('/tasks/auto-archive').catch(() => {});
  }, [projectId]); // eslint-disable-line

  useEffect(() => { load(showArchived); }, [showArchived]); // eslint-disable-line

  // ── Field-value fetch (stable dep — only when task IDs change) ───────────
  const taskIds = useMemo(() => tasks.map(t => t.task_id).join(','), [tasks]);

  useEffect(() => {
    if (!tasks.length || !fieldDefs?.length) return;
    const map = {};
    Promise.all(
      tasks.map(async t => {
        try {
          const r = await api.get(`/fields/task/${t.task_id}/values`);
          map[t.task_id] = Object.fromEntries(r.data.map(v => [v.field_id, v.value]));
        } catch { /* one task's custom fields failing must not blank the rest */ }
      })
    ).then(() => setFieldValueMap({ ...map }));
  }, [taskIds, fieldDefs?.length]); // eslint-disable-line

  const handleColumnChange = (action, payload) => {
    if (action === 'new_task') setNewTaskEditor({ open: true, columnId: payload, dueAt: '' });
  };

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

  if (loading) return (
    <div className="k-screen">
      <p className="pb__loading">Loading board…</p>
    </div>
  );

  const projectName = project?.team?.name || project?.name || '…';
  const presenceUsers = onlineUsers.map((u, i) => ({
    name: u.name || u.email || '?',
    color: AVATAR_COLORS[i % AVATAR_COLORS.length],
  }));

  const viewProps = {
    tasks,
    columns,
    teamMembers,
    onTasksChange: setTasks,
  };

  return (
    <div className="k-screen">
      <PageHeader
        kicker="WORKSPACE"
        title={projectName}
        sanskrit={project?.sanskrit || ''}
        lede="Move work across the board. Click any card to open."
        right={
          <div className="k-headerright">
            {onlineUsers.length > 0 && <AvatarStack users={presenceUsers} size={24} max={4} />}
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
            <button
              type="button"
              className="k-btn k-btn--ghost k-btn--sm"
              onClick={() => saveView({ name: `View ${(savedViews?.length || 0) + 1}`, config: { viewType: view } })}
            >
              + Save view
            </button>
            <button type="button" className="k-link" onClick={() => navigate('/projects')}>
              ← Projects
            </button>
          </div>
        }
      />

      {/* One toolbar, shared with every other view surface (04 §2). */}
      <ViewToolbar
        views={VIEWS}
        view={view}
        onView={setView}
        end={
          <>
            <button
              type="button"
              className="btn btn--out btn--sm vtb__ico pb__toggle"
              aria-pressed={showArchived}
              onClick={() => setShowArchived(v => !v)}
            >
              {IcArchive}
              Archived
            </button>
            {/* Kanban has a composer per column, so the global button would be a
                second way to do the same thing with less context. */}
            {view !== 'kanban' && (
              <button
                type="button"
                className="btn btn--fill btn--sm vtb__ico"
                onClick={() => setNewTaskEditor({ open: true, columnId: null, dueAt: '' })}
              >
                {IcPlus}
                New task
              </button>
            )}
          </>
        }
      />

      {showFieldMgr && (
        <section className="k-card">
          <header className="k-card__head">
            <div className="k-card__titles">
              <h3 className="k-card__title">Custom Fields</h3>
              <span className="k-card__sans">क्षेत्र</span>
            </div>
          </header>
          <div className="k-card__body">
            <div className="pb__fieldadd">
              <input
                className="inp"
                value={newFieldName}
                aria-label="Field name"
                placeholder="Field name"
                onChange={e => setNewFieldName(e.target.value)}
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

      {showAutomations && (
        <section className="k-card">
          <header className="k-card__head">
            <div className="k-card__titles">
              <h3 className="k-card__title">Automations</h3>
              <span className="k-card__sans">स्वचालन</span>
            </div>
            <button
              type="button"
              className="k-iconbtn pb__panelx"
              onClick={() => setShowAutomations(false)}
              title="Close"
              aria-label="Close automations panel"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>
            </button>
          </header>
          <div className="k-card__body pb__autobody">
            <AutomationsPage teamId={projectId} embedded />
          </div>
        </section>
      )}

      {showArchived && (
        <div className="pb__archbanner" role="status">
          {IcArchive}
          Showing archived tasks — open any task to restore it.
          <button type="button" className="btn btn--text btn--sm pb__archback" onClick={() => setShowArchived(false)}>
            ← Back to active
          </button>
        </div>
      )}

      {view === 'kanban' && (
        <KanbanView
          {...viewProps}
          fieldDefs={fieldDefs}
          fieldValueMap={fieldValueMap}
          teamId={projectId}
          onColumnChange={handleColumnChange}
          onColumnsChange={setColumns}
          showRequested={me?.role === 'admin' || me?.role === 'owner'}
          showClientApproval
          currentUserId={me?.user_id}
          currentUserRole={me?.role}
        />
      )}

      {view === 'table' && (
        <TableView
          {...viewProps}
          boardId={projectId}
          fieldDefs={fieldDefs}
          fieldValueMap={fieldValueMap}
        />
      )}

      {view === 'calendar' && (
        <CalendarView
          tasks={tasks}
          teamMembers={teamMembers}
          onTasksChange={setTasks}
          onDayClick={date => {
            const p = n => String(n).padStart(2, '0');
            setNewTaskEditor({
              open: true,
              columnId: null,
              dueAt: `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`,
            });
          }}
        />
      )}

      {view === 'timeline' && <TimelineView {...viewProps} />}
      {view === 'workload' && <WorkloadView tasks={tasks} teamMembers={teamMembers} />}
      {view === 'priority' && <PriorityView {...viewProps} />}
      {view === 'mytasks'  && <MyTasksView tasks={tasks} teamMembers={teamMembers} onTasksChange={setTasks} />}

      <NewTaskModal
        open={newTaskEditor.open}
        onClose={() => setNewTaskEditor({ open: false, columnId: null, dueAt: '' })}
        onCreated={task => {
          if (task) setTasks(prev => [task, ...prev]);
          setNewTaskEditor({ open: false, columnId: null, dueAt: '' });
        }}
        defaultProjectId={projectId}
        defaultColumnId={newTaskEditor.columnId}
        defaultDueAt={newTaskEditor.dueAt}
      />
    </div>
  );
}
