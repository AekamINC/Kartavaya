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

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import { api }         from '../lib/api';
import { currentUser } from '../lib/auth';
import { logger } from '../lib/utils';
import { avatarBg } from '../components/ui/Avatar';
import { useDocumentDownload } from '../lib/documents';
import DocumentError from '../components/ui/DocumentError';

import KanbanView   from '../components/views/KanbanView';
import TableView    from '../components/views/TableView';
import CalendarView from '../components/views/CalendarView';
import TimelineView from '../components/views/TimelineView';
import WorkloadView from '../components/views/WorkloadView';
import PriorityView from '../components/views/PriorityView';
import MyTasksView  from '../components/views/MyTasksView';
import BoardToolbar from '../components/views/BoardToolbar';
import useBoardView from '../components/views/useBoardView';
import { FIELD_TYPES, IcArchive, IcPlus } from '../components/views/viewDefs';
import NewTaskModal from '../components/NewTaskModal';

import { useFields, useFieldValueMap } from '../hooks/useFields';
import { useViews }         from '../hooks/useViews';
import { useRealtimeTasks } from '../hooks/useRealtimeTasks';
import { usePresence }      from '../hooks/usePresence';

import { PageHeader, AvatarStack } from '../components/editorial';
import { useToast } from '../components/ui/toast';
import {
  ErrorState, errorKind, SkeletonBoard, SkeletonList, SkeletonRegion,
} from '../components/ui';

import AutomationsPage from './AutomationsPage';
import { Secondary } from '../components/Bilingual';
import DateInput from '../components/ui/DateInput';

/** Month to date — the window a status report is usually asked for. */
function monthToDate(today = new Date()) {
  const iso = d => d.toISOString().slice(0, 10);
  return {
    start: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
    end: iso(today),
  };
}

export default function ProjectBoardPage() {
  const { projectId } = useParams();
  const navigate      = useNavigate();
  const me            = currentUser();

  const [project,       setProject]       = useState(null);
  const [columns,       setColumns]       = useState([]);
  const [rawTasks,      setRawTasks]      = useState([]);   // seeds useRealtimeTasks
  const [teamMembers,   setTeamMembers]   = useState([]);
  const [view,          setView]          = useState('kanban');
  const [loading,       setLoading]       = useState(true);
  // A failed load left `columns` and `tasks` empty, which renders exactly like
  // a project nobody has put work in yet — and there was no way back short of a
  // full page reload. `BoardsPage` was fixed for this; this page is the other
  // half of the same defect.
  const [loadError,     setLoadError]     = useState(null);
  const [showArchived,  setShowArchived]  = useState(false);
  const [showFieldMgr,  setShowFieldMgr]  = useState(false);
  const [showAutomations, setShowAutomations] = useState(false);
  const [showReport,    setShowReport]    = useState(false);
  const report = useDocumentDownload();
  const [reportPeriod, setReportPeriod] = useState(monthToDate);
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
    setLoadError(null);
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
      setLoadError(e);
      setColumns([]);
      setRawTasks([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load(false);
    api.post('/tasks/auto-archive').catch(() => {});
  }, [projectId]); // eslint-disable-line

  useEffect(() => { load(showArchived); }, [showArchived]); // eslint-disable-line

  // ── Field values ─────────────────────────────────────────────────────────
  // One request for the whole board. This was a `Promise.all` over `tasks`
  // calling `GET /fields/task/:id/values` once PER TASK — a 200-task board
  // opened 200 connections, each re-running the same team-membership check, and
  // the map was only committed once the slowest settled, so the table painted
  // blank custom-field cells until then. `GET /fields/team/:id/values` returns
  // the same matrix in a single query, already keyed by task.
  const { map: fieldValueMap } = useFieldValueMap(projectId, (fieldDefs || []).length > 0);

  // Search, filter, group and sort — in the URL, so a narrowed board is a link
  // (IxViews 10.4). Every view renders `board.filtered`.
  const board = useBoardView({ tasks, columns, fieldDefs, boardKey: projectId });

  const addField = async () => {
    if (!newFieldName.trim()) return;
    try {
      await createField({ name: newFieldName.trim(), type: newFieldType, config: {} });
      setNewFieldName('');
      pushToast({ type: 'success', title: 'Field added' });
    } catch (e) {
      pushToast({ type: 'error', title: 'Could not add field', message: e?.response?.data?.detail || e?.message });
    }
  };

  // The old early return replaced the WHOLE page — header, toolbar and all —
  // with one italic line, so every load tore the chrome down and rebuilt it and
  // the view you were on was forgotten on screen while the request was open.
  // The header and toolbar are stable; only the content region below them
  // swaps, and its skeleton is shaped like the view it stands in for (26 §9).
  const projectName = project?.team?.name || project?.name || '…';
  const presenceUsers = onlineUsers.map((u, i) => ({
    name: u.name || u.email || '?',
    color: avatarBg(m.name || m.user_id || String(i)),
  }));

  const viewProps = {
    tasks: board.filtered,
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
              onClick={() => { setShowFieldMgr(v => !v); setShowAutomations(false); setShowReport(false); }}
            >
              Fields
            </button>
            <button
              type="button"
              className="k-btn k-btn--ghost k-btn--sm pb__toggle"
              aria-pressed={showAutomations}
              onClick={() => { setShowAutomations(v => !v); setShowFieldMgr(false); setShowReport(false); }}
            >
              Automations
            </button>
            <button
              type="button"
              className="k-btn k-btn--ghost k-btn--sm pb__toggle"
              aria-pressed={showReport}
              onClick={() => { setShowReport(v => !v); setShowFieldMgr(false); setShowAutomations(false); }}
            >
              Report
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

      {/* One toolbar, shared with every other view surface (04 §2) — and it
          now carries search, filter, group and fields, so Table view no longer
          stacks a second bar of its own beneath this one. */}
      <BoardToolbar
        view={view}
        onView={setView}
        board={board}
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

      {showReport && (
        <section className="k-card">
          <header className="k-card__head">
            <div className="k-card__titles">
              <h3 className="k-card__title">Status report</h3>
              <Secondary className="k-card__sans" value="प्रतिवेदन" />
            </div>
          </header>
          <div className="k-card__body">
            <p className="pb__none">
              Tasks, overdue tasks and hours logged are measured from this board over
              the period. Milestones, risks and the planned side of each measure are
              not stored anywhere yet, so the report prints actuals alone rather than
              a variance against a plan of zero — which would show every project as
              catastrophically over.
            </p>
            <div className="pb__fieldadd">
              <label className="fld">
                <span className="fld__l">From</span>
                <DateInput
                  className="inp" type="date" value={reportPeriod.start}
                  onChange={e => setReportPeriod({ ...reportPeriod, start: e.target.value })}
                />
              </label>
              <label className="fld">
                <span className="fld__l">To</span>
                <DateInput
                  className="inp" type="date" value={reportPeriod.end}
                  onChange={e => setReportPeriod({ ...reportPeriod, end: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn btn--fill btn--sm"
                disabled={report.busy === 'report' || reportPeriod.start > reportPeriod.end}
                onClick={() => report.run('report', {
                  method: 'post',
                  url: `/v1/documents/projects/${projectId}/report/pdf`,
                  params: { period_start: reportPeriod.start, period_end: reportPeriod.end },
                  // The plan side, milestones and risks have no store to read
                  // from. An empty body is the honest payload; the route reports
                  // actual-only rather than inventing a baseline.
                  data: {},
                  filename: `${projectName || 'project'}-report.pdf`,
                  fallback: 'Could not generate the report',
                })}
              >
                {report.busy === 'report' ? 'Generating…' : 'Download report'}
              </button>
            </div>
            {reportPeriod.start > reportPeriod.end && (
              <p className="pb__none">The start date is after the end date.</p>
            )}
            <DocumentError error={report.error} onDismiss={report.clear} />
          </div>
        </section>
      )}

      {showFieldMgr && (
        <section className="k-card">
          <header className="k-card__head">
            <div className="k-card__titles">
              <h3 className="k-card__title">Custom Fields</h3>
              <Secondary className="k-card__sans" value="क्षेत्र" />
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
              <Secondary className="k-card__sans" value="स्वचालन" />
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

      {loading ? (
        <SkeletonRegion label="Loading board…">
          {view === 'kanban' ? <SkeletonBoard columns={4} cards={3} /> : <SkeletonList rows={8} />}
        </SkeletonRegion>
      ) : loadError ? (
        // `errorKind` separates offline / 403 / 404 / 500 — a 403 on a project
        // board is a real answer and not the same instruction as "try again".
        <ErrorState kind={errorKind(loadError)} onRetry={() => load(showArchived)} />
      ) : (
        <>
      {view === 'kanban' && (
        <KanbanView
          {...viewProps}
          allTasks={tasks}
          fieldDefs={fieldDefs}
          fieldValueMap={fieldValueMap}
          teamId={projectId}
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
          sort={board.sort}
          onSort={board.setSort}
          groupBy={board.groupBy}
          shownFields={board.shownFields}
          isFiltered={board.isFiltered}
          onClearFilters={board.clearFilters}
        />
      )}

      {view === 'calendar' && (
        <CalendarView
          tasks={board.filtered}
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
      {view === 'workload' && <WorkloadView tasks={board.filtered} teamMembers={teamMembers} />}
      {view === 'priority' && <PriorityView {...viewProps} />}
      {view === 'mytasks'  && <MyTasksView tasks={board.filtered} teamMembers={teamMembers} onTasksChange={setTasks} />}
        </>
      )}

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
