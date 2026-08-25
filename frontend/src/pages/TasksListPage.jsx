/**
 * TasksListPage.jsx — editorial Tasks screen with resizable + toggleable columns.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSkeletonGate } from '../hooks/useSkeletonGate';
import { api } from '../lib/api';
import { currentUser } from '../lib/auth';
import { navContext } from '../components/layout/navConfig';
import { useToast } from '../components/ui/toast';
import TaskDrawer  from '../components/TaskDrawer';
import NewTaskModal from '../components/NewTaskModal';
import { PageHeader, DueChip, PriorityDot, StatusChip, ProjectTag } from '../components/editorial';
import { avatarBg } from '../components/ui/Avatar';
import { userInitials, relTime, logger } from '../lib/utils';
import {
  PRIORITY_COLORS, PRIORITY_LABELS, STATUS_COLORS, STATUS_LABELS, STATUS_LABELS_HI,
} from '../lib/statusColors';
import { SkeletonTable, SkeletonRegion } from '../components/ui/Skeleton';
import { EmptyState, ErrorState, errorKind } from '../components/ui';
import useColumnPrefs from '../hooks/useColumnPrefs';
import { ColumnsButton } from '../components/ui/CustomizeColumns';
import { ColumnResizer } from '../components/ui/Table';
import { useLanguage } from '../components/CustomizePanel';
import { secondaryOf } from '../lib/labels';
import { Secondary } from '../components/Bilingual';

const PRIORITY_ORDER = ['urgent','high','medium','low'];
const PRIORITY_HI    = { urgent:'अत्यावश्यक', high:'उच्च', medium:'मध्यम', low:'न्यून' };
const STATUS_ORDER   = ['todo','in_progress','in_review','done','requested'];

/**
 * THE DIV GRID JOINS THE ONE ARRANGEMENT MODEL.
 *
 * This table kept its own everything: a `visible` Set in React state (lost on
 * every reload), widths in `localStorage['kv.taskslist.widths']` (this device
 * only, so the layout a partner set up on a laptop did not exist on the
 * desktop next to it), and NO order at all — the seven columns were whatever
 * order this array happened to be in, for everyone, for ever. Three columns
 * arranged three ways on the most-visited page in the product.
 *
 * It is now `useColumnPrefs`, the same hook and the same server rows as every
 * `<table>`, reached through its div-grid half (`gridCells` / `gridTemplate`).
 * The declaration below is the only thing that had to be written: `key` became
 * `id`, `min` went (the shared MIN_WIDTH of 48 is the floor the API enforces,
 * and a per-column minimum the server does not know about is a rule that
 * survives exactly as long as nobody edits the width in the sheet), and the
 * two columns that used to be absent from `DEFAULT_VISIBLE` say
 * `defaultHidden` instead — which is the same shipped default expressed where
 * a saved arrangement can override it.
 *
 * `fixed` on Task for the reason every other table pins its identity column:
 * it is the only cell that says which task the row is.
 */
const TASK_COLUMNS = [
  { id: 'task',      label: 'Task',         width: 340, fixed: true, sortable: true },
  { id: 'priority',  label: 'Priority',     width: 120, sortable: true },
  { id: 'project',   label: 'Project',      width: 180, sortable: true },
  { id: 'assignees', label: 'Assignees',    width: 200 },
  { id: 'category',  label: 'Category',     width: 140, sortable: true },
  { id: 'due',       label: 'Due',          width: 150, sortable: true },
  { id: 'created',   label: 'Created',      width: 130, sortable: true },
  { id: 'createdBy', label: 'Created By',   width: 140, sortable: true },
  { id: 'updated',   label: 'Last Updated', width: 130, sortable: true },
  { id: 'status',    label: 'Status',       width: 130, sortable: true },
];

function taskSortVal(t, col, teams) {
  switch (col) {
    case 'task':      return (t.title || '').toLowerCase();
    case 'priority':  { const rank = { urgent: 0, high: 1, medium: 2, low: 3 }; return rank[t.priority] ?? 4; }
    case 'project':   { const tm = teams.find(x => x.team_id === t.team_id); return tm ? tm.name.toLowerCase() : 'zzz'; }
    case 'category':  return (t.category_id || 'zzz').toLowerCase();
    case 'due':       return t.due_at || '9999';
    case 'created':   return t.created_at || '';
    case 'createdBy': return (t.created_by_name || 'zzz').toLowerCase();
    case 'updated':   return t.updated_at || '';
    case 'status':    return t.status || '';
    default:          return '';
  }
}

export default function TasksListPage() {
  const { pushToast } = useToast();
  // ONE LABEL SHAPE. `.k-group__sans` is not in `[data-language="en"]`'s
  // six-name list, so every group heading on the Tasks list — the product's
  // most-visited page — carried Devanagari under English. Read once because the
  // groups are mapped below.
  const lang = useLanguage();
  const user     = currentUser();
  // The SAME predicate as the route guard, not a second spelling of it.
  //
  // `Protected.jsx` confines `navContext().isClient` — `role === 'client'` AND
  // no org membership — to `/client/*`, so a portal client can never render
  // this page. This file used bare `role === 'client'`, which is a WIDER set:
  // it also catches staff who happen to carry the client flag alongside an org
  // role. The guard deliberately does not confine those people, so they reached
  // this page AND took the client branch below — fetching `/client/tasks`,
  // which is `List[ClientTaskOut]` (camelCase `taskId`, three-value `state`, no
  // `status`/`user_id`/`assignee_user_ids`/`due_at`) into a renderer that reads
  // every one of those keys. Two predicates, one guard: the mismatch was the
  // whole bug.
  const isClient = navContext(user).isClient;

  const [tasks,        setTasks]        = useState([]);
  const [teams,        setTeams]        = useState([]);
  const [categories,   setCategories]   = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [filter,       setFilter]       = useState('all');
  const [group,        setGroup]        = useState('priority');
  const [sortCol,      setSortCol]      = useState(null);
  const [sortDir,      setSortDir]      = useState('asc');
  const [drawerTaskId, setDrawerTaskId] = useState(null);
  const [newTaskOpen,  setNewTaskOpen]  = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [page,         setPage]         = useState(1);
  /* Persisted, because it is a workspace preference rather than a per-visit
     choice — the same reasoning as the stored column widths. */
  const [pageSize,     setPageSize]     = useState(() => {
    const n = Number(localStorage.getItem('kv.taskslist.pagesize'));
    return [25, 50, 100].includes(n) ? n : 25;
  });
  // A FAILED LOAD IS NOT AN EMPTY LIST. `/tasks` rejecting used to land in a
  // `catch` that pushed one toast and left `tasks` at `[]` — so the table drew
  // its own zero state, "No tasks match this filter", under four filter tabs
  // all reading 0. The toast is gone four seconds later; the lie stays on
  // screen. This is the defect TodayPage already fixed for the dashboard,
  // still live on the page next to it.
  const [error,  setError]  = useState(null);
  // Whether a load has ever SUCCEEDED. Two things need it: the skeleton gate
  // has no previous content to hold before the first one, and an empty table
  // is only honestly empty after one.
  const [loaded, setLoaded] = useState(false);
  // Rows with a write in flight (MOTION-SPEC §7.1 — optimistic UI renders at
  // opacity .6 until acknowledged) and rows that just changed (the one-shot
  // --primary flash, IxViews 9.1). Sets, not one id: two rows can be in flight
  // at once, and one can be flashing while another is pending.
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [justIds,    setJustIds]    = useState(() => new Set());

  // Same helper as KanbanView's, for the same reason: the class has to be
  // DROPPED after the animation ends or it can never fire again on that row.
  const markTransient = useCallback((setter, id, ms) => {
    setter(prev => new Set(prev).add(id));
    setTimeout(() => setter(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    }), ms);
  }, []);

  const cols = useColumnPrefs('tasks.list', TASK_COLUMNS);

  /* The live width while a divider is being dragged, as `{id, width}`.
     A `<table>` needs nothing like this — `ColumnResizer` writes `th.style.width`
     and the browser reflows the column. A GRID has no such lever: the track list
     lives on the ROW, so the only way to move one column mid-drag is to rewrite
     `grid-template-columns`, which means the preview has to be state here. It is
     one setState per pointermove on one string, and it ends at pointer-up — the
     PUT is still one write per gesture, which is `ColumnResizer`'s contract and
     the reason the divider is not doing the saving itself. */
  const [preview, setPreview] = useState(null);
  const gridTemplate = preview
    ? cols.columns.map(c => (
        c.id === preview.id ? `${preview.width}px`
          : c.width ? `${c.width}px` : 'minmax(0, 1fr)')).join(' ')
    : cols.gridTemplate;
  const rowStyle = { gridTemplateColumns: gridTemplate };

  const load = useCallback(async (archived = false) => {
    setLoading(true);
    setError(null);
    // Staff endpoints only. This page reads `status`, `user_id`,
    // `assignee_user_ids`, `due_at` and `task_id` off every row — the
    // internal `TaskOut` shape. It used to fall back to `/client/tasks` and
    // `/client/projects`, which return the deliberately reduced
    // `ClientTaskOut` / `ClientProjectOut` allow-lists and carry none of
    // those keys, so that branch could only ever render broken rows. It is
    // gone rather than repaired: a portal client cannot reach this page at
    // all (`Protected.jsx` allow-list), and their own screens are
    // `pages/client/`.
    //
    // All three are fired together and awaited APART. Only `/tasks` is fatal:
    // `/teams` and `/categories` decorate a row with a project chip and a
    // category chip, and their absence costs an em-dash in one cell. Inside one
    // `Promise.all` they were fatal together, so a `/categories` 500 blanked a
    // list of tasks that had arrived intact.
    const tasksReq = api.get(`/tasks${archived ? '?archived=true' : ''}`);
    const teamsReq = api.get('/teams').catch(() => null);
    const catsReq  = api.get('/categories').catch(() => null);
    try {
      const tRes = await tasksReq;
      setTasks(Array.isArray(tRes.data) ? tRes.data : []);
      setLoaded(true);
      const [pRes, cRes] = await Promise.all([teamsReq, catsReq]);
      if (pRes) setTeams((Array.isArray(pRes.data) ? pRes.data : []).map(t => ({ team_id: t.team_id, name: t.name })));
      if (cRes) setCategories(Array.isArray(cRes.data) ? cRes.data : []);
    } catch (err) {
      // No toast beside the panel. One failure gets one report, and the panel
      // is the one that names WHICH failure — `errorKind` separates offline
      // from 403 from 5xx, where the toast said "Could not load tasks" to a
      // user in a train tunnel and to a user without a grant alike.
      logger.error('Tasks load failed', err);
      setError(err);
    } finally { setLoading(false); }
  }, []);

  // On mount: load tasks and trigger auto-archive in background
  useEffect(() => {
    load(false);
    if (!isClient) api.post('/tasks/auto-archive').catch(() => {});
  }, [load, isClient]);

  // Reload when switching archived view
  useEffect(() => { load(showArchived); }, [showArchived]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Back to page 1 whenever the LIST ITSELF changes. Without this, narrowing a
     45-row list to 3 while sitting on page 2 shows an empty table over a pager
     that says there is nothing to page to — the classic "my search returned
     nothing" bug that is really "you are on page 2 of 1". */
  useEffect(() => { setPage(1); }, [search, filter, group, showArchived]);

  /**
   * Archive and restore both REMOVE the row from the view they were pressed in,
   * so the optimistic shape is the one MOTION-SPEC §7.1 describes rather than
   * the one it forbids: the row stays put and dims to `.6` while the write is
   * in flight, and only leaves once the server has agreed. Removing it first
   * and putting it back on a 4xx is the version that lies — the row is gone,
   * the list has closed the gap, and the failure arrives as a toast pointing at
   * something no longer on screen.
   *
   * `pressed` rather than a bare `e.stopPropagation()` at the call site: the
   * row is itself a button, so without it every quick action also opens the
   * drawer (IxViews 9.4's handler note).
   */
  const pressed = useCallback((taskId, e) => {
    e.stopPropagation();
    return pendingIds.has(taskId);
  }, [pendingIds]);

  const setArchived = useCallback(async (taskId, e, { path, ok, fail }) => {
    if (pressed(taskId, e)) return;
    setPendingIds(prev => new Set(prev).add(taskId));
    try {
      await api.patch(`/tasks/${taskId}/${path}`);
      setTasks(prev => prev.filter(t => t.task_id !== taskId));
      pushToast({ type: 'success', title: ok });
    } catch (err) {
      logger.error(`Task ${path} failed`, err);
      pushToast({ type: 'error', title: fail });
    } finally {
      setPendingIds(prev => { const n = new Set(prev); n.delete(taskId); return n; });
    }
  }, [pressed, pushToast]);

  const archiveTask   = useCallback((taskId, e) =>
    setArchived(taskId, e, { path: 'archive',   ok: 'Task archived', fail: 'Could not archive task' }), [setArchived]);
  const unarchiveTask = useCallback((taskId, e) =>
    setArchived(taskId, e, { path: 'unarchive', ok: 'Task restored',  fail: 'Could not restore task' }), [setArchived]);

  /**
   * Quick-complete — IxViews 9.4, the same interaction the board already
   * carries (`KanbanView.toggleComplete`) and the same contract, because a tick
   * that behaves differently on the list than on the board is two features.
   *
   * "One quick action, not five. A complete-tick is worth surfacing because it
   * is the most common single change; everything else is a click into the
   * drawer." Marking one task done was three clicks through the drawer.
   */
  const toggleComplete = useCallback(async (task, e) => {
    if (pressed(task.task_id, e) || showArchived) return;
    const next = task.status === 'done' ? 'todo' : 'done';
    const previous = task;
    setPendingIds(prev => new Set(prev).add(task.task_id));
    setTasks(prev => prev.map(t => (t.task_id === task.task_id ? { ...t, status: next } : t)));
    try {
      const res = await api.patch(`/tasks/${task.task_id}`, { status: next });
      setTasks(prev => prev.map(t => (t.task_id === task.task_id ? res.data : t)));
      // 600ms, matching the board: `--dur-slow * 1.5` is 540ms of animation
      // plus a frame's grace, so the class outlives the flash it triggers.
      markTransient(setJustIds, task.task_id, 600);
    } catch (err) {
      // The whole previous record, not a status flip back: the optimistic write
      // replaced one field, but the server may have been mid-update on others.
      logger.error('Complete toggle failed', err);
      pushToast({ type: 'error', title: 'Could not update that task' });
      setTasks(prev => prev.map(t => (t.task_id === task.task_id ? previous : t)));
    } finally {
      setPendingIds(prev => { const n = new Set(prev); n.delete(task.task_id); return n; });
    }
  }, [pressed, showArchived, markTransient, pushToast]);

  const myId = user?.user_id;
  const filtered = tasks.filter(t => {
    // A row that is mid-write, or that just finished one, STAYS — measured, and
    // it is the whole reason the optimistic feedback existed only on paper.
    // Under the default "All open" filter, ticking a task complete flips its
    // status to `done`, which the predicate below excludes, so the row was
    // unmounted in the same commit as the optimistic update: no `.6` pending
    // dim, no confirmation flash, and on a 4xx the row reappeared out of
    // nowhere. IxViews 9.4 is explicit that ticking runs the confirmation and
    // THEN the row moves. Held for the ~600ms the flash lasts, then it leaves
    // on the next render like anything else.
    if (pendingIds.has(t.task_id) || justIds.has(t.task_id)) return true;
    const matchSearch = !search || t.title.toLowerCase().includes(search.toLowerCase());
    if (showArchived) return matchSearch;
    let matchFilter = true;
    if (filter === 'mine')    matchFilter = (t.user_id === myId || t.assignee_user_ids?.includes(myId)) && t.status !== 'done';
    if (filter === 'all')     matchFilter = t.status !== 'done';
    if (filter === 'overdue') matchFilter = t.due_at && new Date(t.due_at) < new Date() && t.status !== 'done';
    if (filter === 'done')    matchFilter = t.status === 'done';
    return matchSearch && matchFilter;
  });

  if (sortCol) {
    filtered.sort((a, b) => {
      const av = taskSortVal(a, sortCol, teams);
      const bv = taskSortVal(b, sortCol, teams);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  // `#94a3b8` was the old `todo` grey, hardcoded here as a catch-all after the
  // map it came from moved to tokens; `--on-surface-3` is the token that
  // carries "no particular state" and it flips with the theme.
  const groups = [];
  if (group === 'priority') {
    PRIORITY_ORDER.forEach(p => {
      const items = filtered.filter(t => t.priority === p);
      if (items.length) groups.push({ key: p, title: PRIORITY_LABELS[p], sans: PRIORITY_HI[p], color: PRIORITY_COLORS[p], items });
    });
    const rest = filtered.filter(t => !PRIORITY_ORDER.includes(t.priority));
    if (rest.length) groups.push({ key: 'other', title: 'Other', sans: 'अन्य', color: 'var(--on-surface-3)', items: rest });
  } else if (group === 'project') {
    teams.forEach(team => {
      const items = filtered.filter(t => t.team_id === team.team_id);
      // Was `AVATAR_COLORS[groups.length % …]` — keyed off how many groups had
      // been pushed so far, so a project changed colour whenever a project
      // above it emptied out. `avatarBg` hashes the name and is stable.
      if (items.length) groups.push({ key: team.team_id, title: team.name, sans: '', color: avatarBg(team.name), items });
    });
    const orphans = filtered.filter(t => !teams.find(tm => tm.team_id === t.team_id));
    if (orphans.length) groups.push({ key: 'none', title: 'No project', sans: 'अन्य', color: 'var(--on-surface-3)', items: orphans });
  } else {
    STATUS_ORDER.forEach(s => {
      const items = filtered.filter(t => t.status === s);
      if (items.length) groups.push({ key: s, title: STATUS_LABELS[s], sans: STATUS_LABELS_HI[s], color: STATUS_COLORS[s], items });
    });
  }

  /* ── Pagination ───────────────────────────────────────────────────────────
     Ninety rows on one screen is the crowding, not the row height — 54px rows
     make a long list taller, not calmer. Scrolling a page is fine; scrolling
     the whole table is what stops anyone finding anything.

     Paginated over the FLAT order and then regrouped, NOT per group. Slicing
     each group independently would show "MEDIUM 47" above three rows on page 1
     and the same header again on pages 2 and 3 — three headers claiming the
     same 47. Flattening first means a page is a contiguous run of the list you
     are already looking at, and a group header appears on a page only if that
     page actually contains some of its rows.

     The header count stays the group's TOTAL. It answers "how many are
     MEDIUM", which does not change because you turned a page. */
  const flat = groups.flatMap(g => g.items.map(item => ({ gkey: g.key, item })));
  const totalRows = flat.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pageSlice = flat.slice(pageStart, pageStart + pageSize);

  const pagedGroups = groups
    .map(g => ({ ...g, total: g.items.length, items: pageSlice.filter(r => r.gkey === g.key).map(r => r.item) }))
    .filter(g => g.items.length > 0);

  const filterCounts = {
    mine:    tasks.filter(t => (t.user_id === myId || t.assignee_user_ids?.includes(myId)) && t.status !== 'done').length,
    all:     tasks.filter(t => t.status !== 'done').length,
    overdue: tasks.filter(t => t.due_at && new Date(t.due_at) < new Date() && t.status !== 'done').length,
    done:    tasks.filter(t => t.status === 'done').length,
  };

  // MOTION-SPEC §7.4 — the skeleton waits 120ms, so flipping Archived (which
  // re-runs the whole load) no longer replaces the table with a skeleton and
  // back inside one frame of a warm request. `loaded` is what stops it holding
  // an empty table on the very first load, which would show the zero state
  // before the skeleton.
  const showSkeleton = useSkeletonGate(loading, loaded);
  // "Nothing here" and "nothing MATCHES" are different sentences with different
  // exits. Narrowed is recoverable by clearing; genuinely empty is not.
  const narrowed = !!search || (!showArchived && filter !== 'all');

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
          {/* The popover this replaces could only TICK a column on and off, and
              its state died with the component. `ColumnsButton` opens the same
              sheet every other table in the product opens: order, visibility
              and width in one place, saved, and settable as the team default
              by an org admin. It also carries the hidden count, which the
              popover's caller computed by hand. */}
          <ColumnsButton cols={cols} />

          {/* Was `.k-topbar__search`, borrowed from the topbar. 01-navigation
              made that a <button> trigger for the palette, and this is a real
              text field, so it now has its own name. */}
          <div className="k-searchpill" style={{ maxWidth: 220 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" />
          </div>
        </div>
      </div>

      {showSkeleton ? (
        <SkeletonRegion label="Loading tasks…">
          <SkeletonTable rows={8} columns={cols.columns.length} />
        </SkeletonRegion>
      ) : error ? (
        <ErrorState kind={errorKind(error)} grant="access to these tasks" onRetry={() => load(showArchived)} />
      ) : (
        <div className="k-tablewrap" style={{ overflowX: 'auto' }}>
          {/* Header.
              `data-colhead` is what lets the SHARED `ColumnResizer` measure a
              column that has no `<th>` to sit in: it looks for
              `closest('th, [data-colhead]')`. The handle it replaces was a bare
              `<span onPointerDown>` — not focusable, no role, deaf to every key
              — so the one table on this page whose columns a user actually
              drags was the one place resizing could not be done from a
              keyboard. That was fixed by hand once already for the rest of the
              build (5cb76413, React Aria rejected); a second implementation
              here would have re-opened it.

              The divider is on EVERY header, including the last. It was
              suppressed on the last one because that grip had nothing to its
              right to push; with a stored width it does — the last column is
              as resizable as the others, and the row scrolls. */}
          <div className="k-table__head k-trow--resizable" style={rowStyle}>
            {cols.columns.map(col => {
              const def = TASK_COLUMNS.find(c => c.id === col.id);
              const canSort = def?.sortable;
              const active = sortCol === col.id;
              return (
              <div
                key={col.id}
                data-colhead
                className={`k-table__hcell k-c-${col.id}`}
                style={{ position: 'relative', userSelect: 'none', cursor: canSort ? 'pointer' : undefined }}
                onClick={canSort ? () => {
                  if (active) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
                  else { setSortCol(col.id); setSortDir('asc'); }
                  setPage(1);
                } : undefined}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {col.label}
                  {active && <span style={{ fontSize: 10, opacity: .7 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </span>
                <ColumnResizer
                  label={col.label}
                  width={col.width}
                  onPreview={w => setPreview(w == null ? null : { id: col.id, width: w })}
                  onCommit={w => cols.setWidth(col.id, w)}
                />
              </div>
              );
            })}
          </div>

          {/* Was a bare line of text in `.pb__loading` — the PROJECT BOARD's
              loading class, borrowed for an empty state on a different page, so
              the one moment the table has nothing to say was styled as though it
              were still fetching. `.ix-fade-up` gives it the entrance every
              other arriving surface has (--dur-base --ease-enter); with no
              entrance it replaced eight rows in a single frame. */}
          {groups.length === 0 && (
            <div className="ix-fade-up k-table__empty">
              {narrowed ? (
                <EmptyState
                  illustration="search"
                  title={{ en: 'No tasks match', hi: 'कोई कार्य नहीं मिला' }}
                  description="Every task is still here — this filter and search just do not reach any of them."
                  action="Clear filter and search"
                  onAction={() => { setSearch(''); setFilter('all'); setShowArchived(false); }}
                />
              ) : showArchived ? (
                <EmptyState
                  illustration="tasks"
                  title={{ en: 'Nothing archived', hi: 'कुछ संग्रहीत नहीं' }}
                  description="Archived tasks are kept here, out of the way but not deleted."
                />
              ) : (
                <EmptyState
                  illustration="tasks"
                  title={{ en: 'No tasks yet', hi: 'अभी कोई कार्य नहीं' }}
                  description="The first one is usually the hardest. Everything after it lands here."
                  action={isClient ? undefined : 'New task'}
                  onAction={() => setNewTaskOpen(true)}
                />
              )}
            </div>
          )}

          {pagedGroups.map(g => {
            const groupIn = secondaryOf(g.sans, lang);
            return (
            <div key={g.key} className="k-group">
              <div className="k-group__head" style={{ '--group-color': g.color }}>
                <span className="k-group__bar" />
                <span className="k-group__title">{g.title}</span>
                {/* lang="hi". The group header is uppercase and tracked (see
                    editorial.css), and tracking is exactly what breaks a
                    conjunct — अत्यावश्यक loses its क्ष. editorial.css guards
                    that with `[lang="hi"] { letter-spacing: 0 !important }`,
                    but the guard is keyed on the attribute and this span did
                    not carry it. */}
                {groupIn.secondary && (
                  <Secondary className="k-group__sans" value={groupIn.secondary} script={groupIn.script} />
                )}
                <span className="k-group__count">{g.total}</span>
              </div>
              {g.items.map(t => {
                const team      = teams.find(tm => tm.team_id === t.team_id);
                const cat       = categories.find(c => c.category_id === t.category_id);
                const assignees = (t.assignee_names || []).map(name => ({ name, color: avatarBg(name) }));
                /* Hoisted out of what used to be a block-scoped `case`. ONE
                   assignee gets a named pill; two or more collapse to initials
                   — see the note on the cell below. */
                const solo      = assignees.length === 1;
                return (
                  /* The row was a `<button>` with `<button>`s inside it —
                     archive, and now the quick-complete tick. React logs "In
                     HTML, <button> cannot be a descendant of <button>" for
                     every row, and it is not a style complaint: a nested button
                     is invalid, its activation behaviour is undefined, and with
                     the keyboard the inner controls were unreachable in the
                     order they appear. The reference row is a plain element
                     with real buttons in `.tv__acts` for exactly this reason
                     (IxViews §10).

                     `role="button"` + `tabIndex` + Enter/Space restores what the
                     element gave for free. `e.target === e.currentTarget` on the
                     key handler keeps Space on the tick from also opening the
                     drawer behind it. */
                  <div
                    key={t.task_id}
                    role="button"
                    tabIndex={0}
                    className={['k-trow', 'k-trow--resizable',
                      t.archived_at && 'k-trow--archived',
                      pendingIds.has(t.task_id) && 'is-pending',
                      justIds.has(t.task_id) && 'is-just',
                    ].filter(Boolean).join(' ')}
                    style={rowStyle}
                    onClick={() => setDrawerTaskId(t.task_id)}
                    onKeyDown={e => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      setDrawerTaskId(t.task_id);
                    }}
                  >
                    {/* One node per column, keyed by id — `gridCells` puts them
                        in the arranged order and drops the hidden ones, exactly
                        as `cells()` does for a `<table>`. It was a `switch` over
                        a filtered array, which meant this row's order was
                        whatever order `ALL_COLS` was written in and could not be
                        anything else. */}
                    {cols.gridCells({
                      task: (
                            <div key="task" className="k-trow__cell k-c-task">
                              <PriorityDot priority={t.priority} />
                              {/* `KAR-{idx + 100}` — the row's index WITHIN ITS
                                  GROUP — was rendered here as if it were the
                                  task's reference. Every group restarted at 100,
                                  so one screen showed KAR-100 three times, and
                                  the number a user copied into an email changed
                                  the moment anybody switched Group by, typed in
                                  the search box, or closed a task above it.
                                  A fabricated identifier that looks real is
                                  worse than none: it is the one thing a person
                                  quotes.
                                  `#${task_id.slice(-6)}` is the form
                                  `DrawerTitle.jsx`, `views/TaskCard.jsx` and
                                  `today/TaskListCard.jsx` already use — that
                                  sweep simply missed this file. It is stable and
                                  unique per task, so the four surfaces finally
                                  name a task the same way.
                                  A real per-org sequence is still the right
                                  answer; the `tasks` table has no
                                  `task_number` column and adding one is a
                                  migration. Filed in the report. */}
                              <span className="k-trow__id">#{t.task_id?.slice(-6) || '—'}</span>
                              <span className="k-trow__title">{t.title}</span>
                              {t.attachments?.length > 0 && (
                                <span className="k-trow__attach" title={`${t.attachments.length} attachment${t.attachments.length > 1 ? 's' : ''}`}>
                                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M10 3l-5 5a2.5 2.5 0 003.5 3.5l5-5a4 4 0 00-5.7-5.7L3 5.5"/></svg>
                                  {t.attachments.length}
                                </span>
                              )}
                              {t.comment_count > 0 && (
                                <span className="k-trow__attach" title={`${t.comment_count} comment${t.comment_count > 1 ? 's' : ''}`}>
                                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 3h12v8H5l-3 3V3z"/></svg>
                                  {t.comment_count}
                                </span>
                              )}
                            </div>
                          ),
                      priority: (
                            <div key="priority" className="k-trow__cell k-c-priority">
                              <span className="k-priority-pill" style={{ '--pri-c': PRIORITY_COLORS[t.priority] || 'var(--on-surface-3)' }}>
                                <span className="k-priority-pill__dot" />
                                {PRIORITY_LABELS[t.priority] || t.priority || '—'}
                              </span>
                            </div>
                          ),
                      project: (
                            <div key="project" className="k-trow__cell k-c-project">
                              {team ? <ProjectTag name={team.name} dense /> : <span className="k-trow__empty">—</span>}
                            </div>
                          ),
                        /* ONE assignee gets a named pill; TWO OR MORE collapse
                           to initials only.

                           Named pills do not fit side by side in this column,
                           so three of them wrapped onto three lines and took
                           the row to roughly four times the height of every
                           other row in the table — which is most of why a
                           uniform 44px list reads as ragged. Initials keep the
                           row at 44px and still name everyone on hover. */
                      assignees: (
                            <div key="assignees" className="k-trow__cell k-c-assignees">
                              {assignees.length === 0
                                ? <span className="k-trow__empty">—</span>
                                : assignees.slice(0, 3).map((a, j) => (
                                    <span
                                      key={j}
                                      className={solo ? 'k-assignee-pill' : 'k-assignee-pill k-assignee-pill--initial'}
                                      style={{ '--av-c': a.color }}
                                      title={solo ? undefined : a.name}
                                    >
                                      <span className="k-assignee-pill__avatar">{userInitials(a.name)}</span>
                                      {solo && <span className="k-assignee-pill__name">{a.name}</span>}
                                    </span>
                                  ))
                              }
                              {assignees.length > 3 && <span className="k-assignee-pill__more">+{assignees.length - 3}</span>}
                            </div>
                          ),
                      category: (
                            <div key="category" className="k-trow__cell k-c-category">
                              {cat
                                ? <span className="k-cat-chip" style={{ '--cat-c': cat.color }}>
                                    <span className="k-cat-chip__dot" />
                                    {cat.name}
                                  </span>
                                : <span className="k-trow__empty">—</span>
                              }
                            </div>
                          ),
                      due: (
                            <div key="due" className="k-trow__cell k-c-due">
                              <DueChip date={t.due_at} status={t.status} completedAt={t.completed_at} />
                            </div>
                          ),
                      created: (
                            <div key="created" className="k-trow__cell k-c-created">
                              <span className="k-trow__meta">{t.created_at ? new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span>
                            </div>
                          ),
                      createdBy: (
                            <div key="createdBy" className="k-trow__cell k-c-createdBy">
                              <span className="k-trow__meta">{t.created_by_name || '—'}</span>
                            </div>
                          ),
                      updated: (
                            <div key="updated" className="k-trow__cell k-c-updated">
                              <span className="k-trow__meta">{relTime(t.updated_at) || '—'}</span>
                            </div>
                          ),
                      status: (
                            <div key="status" className="k-trow__cell k-c-status">
                              <StatusChip status={t.status} approvalStatus={t.approval_status} columnName={t.column_name} columnColor={t.column_color} />
                            </div>
                          ),
                    })}

                    {/* ── Row actions, at the END of the row ────────────────
                        These sat inside the task cell, immediately after the
                        title — so the tick was directly in the path of anyone
                        reaching for the task name, and a miss marks the task
                        done. That is a destructive action sitting on top of the
                        most-clicked text on the page.

                        Now a tray pinned to the row's trailing edge, revealed on
                        hover, the way `.msg__acts` works in the reference. It is
                        absolutely positioned rather than given a grid track
                        because the column widths are user-resizable and stored
                        (`useColumnPrefs`, now on the server) — adding a track
                        would invalidate every saved layout and the header row's
                        template with it. */}
                    <div className="k-trow__actions">
                      {!showArchived && (
                        <button
                          type="button"
                          className={'k-trow__tick' + (t.status === 'done' ? ' on' : '')}
                          aria-pressed={t.status === 'done'}
                          aria-label={t.status === 'done' ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`}
                          title={t.status === 'done' ? 'Mark not done' : 'Mark done'}
                          onClick={e => toggleComplete(t, e)}
                        >
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3.5 8.4l3 3 6-6.6" />
                          </svg>
                        </button>
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
                  </div>
                );
              })}
            </div>
            );
          })}

          {/* The pager. Rendered only when there is more than one page — a
              control that can never do anything is noise, and on a 12-task
              workspace this table should look exactly as it did before. */}
          {totalRows > 0 && pageCount > 1 && (
            <div className="k-pager">
              <span className="k-pager__count">
                {pageStart + 1}–{Math.min(pageStart + pageSize, totalRows)}
                <span className="k-pager__of"> of </span>
                {totalRows}
              </span>
              <div className="k-pager__nav">
                <button
                  type="button" className="k-pager__b"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  aria-label="Previous page"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 12L6 8l4-4"/></svg>
                </button>
                {/* aria-live so a screen reader hears the page change; the
                    buttons themselves give no feedback once pressed. */}
                <span className="k-pager__pos" aria-live="polite">
                  {safePage} / {pageCount}
                </span>
                <button
                  type="button" className="k-pager__b"
                  onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                  disabled={safePage >= pageCount}
                  aria-label="Next page"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4l4 4-4 4"/></svg>
                </button>
              </div>
              <label className="k-pager__size">
                <span className="k-pager__size-l">Rows</span>
                <select
                  className="k-pager__sel"
                  value={pageSize}
                  onChange={e => {
                    const n = Number(e.target.value);
                    setPageSize(n);
                    try { localStorage.setItem('kv.taskslist.pagesize', String(n)); } catch (_) {}
                    setPage(1);
                  }}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>
          )}
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
