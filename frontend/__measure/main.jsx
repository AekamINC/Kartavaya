/* __measure/main.jsx — renders the REAL build components (KanbanView, TaskCard,
 * ViewToolbar, TaskDrawer) with the REAL stylesheet graph, so getComputedStyle
 * reports the shipping values. Nothing here is imported by the app.
 *
 * The axios adapter on `api` is replaced before any component mounts, so no
 * request leaves the page and the shared database is never touched.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';

// Exactly App.jsx's import order (App.jsx lines 18-26).
import '../src/App.css';
import '../src/styles/index.css';
import '../src/styles/kartavaya-design.css';
import '../src/styles/editorial.css';
import '../src/styles/settings.css';

import { api } from '../src/lib/api';
import { ToastProvider } from '../src/components/ui/toast';
import KanbanView from '../src/components/views/KanbanView';
import TableView from '../src/components/views/TableView';
import ViewToolbar from '../src/components/views/ViewToolbar';
import { VIEWS } from '../src/components/views/viewDefs';
import PageHeader from '../src/components/editorial/PageHeader';
import TaskDrawer from '../src/components/TaskDrawer';

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const TASK = {
  task_id: 'kartavya-000411',
  title: 'Vendor agreement template — clause update',
  description: 'Update the indemnity clause and re-issue to the vendor.',
  status: 'todo',
  priority: 'low',
  column_id: 'c1',
  due_at: '2026-08-02T10:00:00Z',
  assignee_user_ids: ['u1'],
  assignee_names: ['Riya Iyer'],
  comment_count: 2,
  attachments: [],
  subtasks: [],
  team_id: 't1',
};

const mk = (id, title, prio, col, extra = {}) => ({
  ...TASK, task_id: id, title, priority: prio, column_id: col, ...extra,
});

const TASKS = [
  mk('kartavya-000411', 'Vendor agreement template — clause update', 'low', 'c1'),
  mk('kartavya-000090', 'Reconcile input tax credit for June', 'high', 'c1',
    { assignee_user_ids: ['u2'], assignee_names: ['Aarav Mehta'], comment_count: 1 }),
  mk('kartavya-000184', 'Compile Q1 GSTR-3B working notes', 'high', 'c2',
    { assignee_user_ids: ['u3', 'u1'], assignee_names: ['Keval Shah', 'Riya Iyer'], comment_count: 7 }),
  mk('kartavya-000112', 'Share Diwali campaign draft with CA Sharma', 'medium', 'c2',
    { assignee_user_ids: ['u4'], assignee_names: ['Priya Nair'], comment_count: 2 }),
  mk('kartavya-000582', 'Tata Steel — Mumbai office fit-out review', 'urgent', 'c3',
    { assignee_user_ids: ['u3', 'u2'], assignee_names: ['Keval Shah', 'Aarav Mehta'], comment_count: 4 }),
  mk('kartavya-000077', 'Bengaluru payroll run — March', 'medium', 'c4',
    { status: 'done', assignee_user_ids: ['u4'], assignee_names: ['Priya Nair'] }),
];

const COLUMNS = [
  { column_id: 'c1', name: 'To Do',       color: '#8b8f88', position: 0 },
  { column_id: 'c2', name: 'In Progress', color: '#04837A', position: 1 },
  { column_id: 'c3', name: 'In Review',   color: '#b9762a', position: 2 },
  { column_id: 'c4', name: 'Done',        color: '#3f7d3a', position: 3 },
];

const MEMBERS = [
  { user_id: 'u1', name: 'Riya Iyer',  email: 'riya@aekam.test',  role: 'member' },
  { user_id: 'u2', name: 'Aarav Mehta', email: 'aarav@aekam.test', role: 'member' },
  { user_id: 'u3', name: 'Keval Shah',  email: 'keval@aekam.test', role: 'owner'  },
  { user_id: 'u4', name: 'Priya Nair',  email: 'priya@aekam.test', role: 'member' },
];

/* ── Offline adapter: every request resolves locally ──────────────────── */

function mockData(url = '') {
  // `/time/task/:id` returns an OBJECT. Returning [] here hands
  // `data?.entries` the Array.prototype.entries function, which React then
  // treats as a state updater — a harness bug, not a build one.
  if (/\/time\/task\//.test(url))               return { entries: [], active_entry: null };
  if (/\/tasks\/[^/]+\/[^/]+/.test(url))        return [];   // any task sub-collection
  if (/\/tasks\/[^/]+$/.test(url))              return TASK;
  if (/\/columns/.test(url))                    return COLUMNS;
  if (/\/members/.test(url))                    return MEMBERS;
  if (/\/fields/.test(url))                     return [];
  if (/\/categories/.test(url))                 return [];
  if (/\/tasks/.test(url))                      return TASKS;
  return [];
}
api.defaults.adapter = (config) =>
  Promise.resolve({
    data: mockData(config.url || ''), status: 200, statusText: 'OK',
    headers: {}, config,
  });

// currentUser() reads localStorage — seed a staff user so the client branch
// never runs. No network, no cookie, no session.
localStorage.setItem('Kartavaya_user', JSON.stringify({
  user_id: 'u3', name: 'Keval Shah', email: 'keval@aekam.test', role: 'owner',
}));

/* ── Harness ──────────────────────────────────────────────────────────── */

const ERRORS = [];
window.addEventListener('error', e => ERRORS.push(String(e.message)));
window.addEventListener('unhandledrejection', e => ERRORS.push('rej: ' + String(e.reason && e.reason.message || e.reason)));

class Guard extends React.Component {
  constructor(p) { super(p); this.state = { e: null }; }
  static getDerivedStateFromError(e) { return { e }; }
  componentDidCatch(e, info) {
    ERRORS.push(this.props.name + ': ' + String(e && e.message) +
      ' | stack: ' + String((e && e.stack) || '').split('\n').slice(0, 6).join(' >> ') +
      ' | comp: ' + String((info && info.componentStack) || '').split('\n').slice(0, 6).join(' >> '));
  }
  render() { return this.state.e ? null : this.props.children; }
}

function Board() {
  const [view, setView] = React.useState('kanban');
  return (
    <div className="k-screen" style={{ padding: 'var(--pad-page)' }}>
      <Guard name="PageHeader">
        {/* BoardsPage's own call, verbatim. */}
        <PageHeader
          kicker="AEKAM INC"
          sanskrit="फलक"
          title="Quarterly GST filing — Aekam Inc."
          lede="Move work across the board. Click any card to open."
        />
      </Guard>
      <Guard name="ViewToolbar">
        <ViewToolbar views={VIEWS} view={view} onView={setView} />
      </Guard>
      <Guard name="KanbanView">
        <KanbanView
          columns={COLUMNS}
          tasks={TASKS}
          teamMembers={MEMBERS}
          fieldDefs={[]}
          teamId="t1"
          currentUserId="u3"
          currentUserRole="owner"
          onTasksChange={() => {}}
          onColumnsChange={() => {}}
        />
      </Guard>
      <Guard name="TableView">
        <div id="tablehost">
          <TableView
            tasks={TASKS}
            columns={COLUMNS}
            teamMembers={MEMBERS}
            fieldDefs={[]}
            fieldValueMap={{}}
            boardId="t1"
            onTasksChange={() => {}}
          />
        </div>
      </Guard>
    </div>
  );
}

function Drawer() {
  return (
    <Guard name="TaskDrawer">
      <TaskDrawer taskId="kartavya-000411" open onClose={() => {}} teamMembers={MEMBERS} />
    </Guard>
  );
}

/* Baseline. `?density=` reproduces what the SHIPPING app puts on <html>
 * (applyPrefs writes DEFAULTS.density === 'comfy'); with no param the root
 * falls through to :root, which is the matched-baseline run. `?radius=`
 * likewise reproduces DEFAULTS.radius === 10. */
const q = new URLSearchParams(location.search);
if (q.get('density')) document.documentElement.setAttribute('data-density', q.get('density'));
if (q.get('radius'))  document.documentElement.style.setProperty('--radius-base', q.get('radius') + 'px');
if (q.get('display')) document.documentElement.setAttribute('data-display', q.get('display'));

ReactDOM.createRoot(document.getElementById('root')).render(
  <ToastProvider><Board /></ToastProvider>
);
const drawerHost = document.createElement('div');
document.body.appendChild(drawerHost);
ReactDOM.createRoot(drawerHost).render(
  <ToastProvider><Drawer /></ToastProvider>
);

/* ── Measure ──────────────────────────────────────────────────────────── */
import { probe, P, tokens, TOKEN_NAMES, rootAttrs, devanagari, classInventory } from './measure.js';

const out = document.getElementById('out');
const say = (o) => { out.textContent = JSON.stringify(o, null, 1); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 25000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = fn(); if (v) return v; } catch (e) { /* not ready */ }
    if (Date.now() - t0 > ms) return null;
    await sleep(100);
  }
}

(async () => {
  const doc = document;
  if (!await until(() => doc.querySelector('.bc'))) { say({ ERROR: 'no .bc card rendered' }); return; }
  await until(() => doc.querySelector('.dr'));
  await sleep(900);

  const M = {};
  M._side = 'build';
  M.errors = ERRORS;
  M.rootAttrs = rootAttrs(doc);
  M.tokens = tokens(doc, TOKEN_NAMES);
  M.viewport = { w: innerWidth, h: innerHeight };
  M.boardClasses = classInventory(doc, '.bd');

  M.board       = probe(doc, '.bd', P.LAYOUT, 'board container');
  M.column      = probe(doc, '.bd__col', P.BOX.concat(['flex-direction']), 'column');
  M.columnHead  = probe(doc, '.bd__ch', P.BOX.concat(['border-bottom-width', 'border-bottom-color']), 'column head');
  M.phKick  = probe(doc, '.k-pageh__kicker', P.TYPE, 'page header kicker');
  M.phH1    = probe(doc, '.k-pageh__h1', P.TYPE, 'page header title');
  M.phHi    = probe(doc, '.k-pageh__sans', P.TYPE, 'page header (Devanagari)');
  M.phLede  = probe(doc, '.k-pageh__lede', P.TYPE, 'page header lede');
  M.columnBar   = probe(doc, '.bd__cdot', ['width', 'height', 'border-radius'], 'column colour dot');
  M.columnTitle = probe(doc, '.bd__cn', P.TYPE, 'column title');
  M.columnHi    = probe(doc, '.bd__cn-hi', P.TYPE, 'column title (Devanagari)');
  M.columnCount = probe(doc, '.bd__cc', P.TYPE.concat(['padding-left', 'padding-right', 'border-radius', 'background-color']), 'column count');
  M.columnList  = probe(doc, '.bd__list', ['gap', 'min-height'], 'column card list');
  M.card        = probe(doc, '.bc', P.BOX.concat(['transition']), 'card');
  M.cardTop     = probe(doc, '.bc__top', ['gap', 'align-items'], 'card top row');
  M.cardId      = probe(doc, '.bc__id', P.TYPE, 'card id');
  M.cardTitle   = probe(doc, '.bc__t', P.TYPE, 'card title');
  M.cardFoot    = probe(doc, '.bc__foot', ['gap', 'align-items', 'font-size'], 'card foot');
  M.cardPdot    = probe(doc, '.bc__pdot', ['width', 'height', 'border-radius', 'background-color'], 'card priority dot');
  M.cardPrio    = probe(doc, '.bc__prio', P.TYPE.concat(['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-radius', 'background-color', 'gap']), 'card priority chip');
  M.avatar      = probe(doc, '.bc .av', P.SIZE, 'card avatar');
  M.avatarStack = probe(doc, '.bc .avstack', ['display', 'align-items'], 'card avatar stack');
  M.avatarNth   = probe(doc, '.bc .avstack > * + *', ['margin-left', 'box-shadow', 'width', 'height'], 'avatar overlap');
  M.dueChip     = probe(doc, '.bc__foot .due, .bc__foot [class*="due"], .bc__foot span', P.TYPE.concat(['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-radius', 'background-color', 'gap']), 'card due chip');

  M.toolbar     = probe(doc, '.vtb', ['display', 'gap', 'border-bottom-width', 'border-bottom-color', 'background-color', 'align-items', 'min-height', 'padding-top', 'padding-bottom'], 'view toolbar');
  M.toolbarBar  = probe(doc, '.vtb__bar', ['display', 'gap', 'align-items', 'min-height', 'padding-top', 'padding-bottom', 'border-bottom-width', 'border-bottom-color'], 'view toolbar bar');
  M.toolbarSeg  = probe(doc, '.k-segctrl', ['display', 'gap', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'background-color', 'border-radius', 'border-top-width'], 'view toolbar segmented control');
  M.toolbarBtn  = probe(doc, '.k-segctrl__btn', P.TYPE.concat(['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap', 'min-height', 'border-bottom-width', 'border-radius']), 'toolbar button');
  M.toolbarBtnOn = probe(doc, '.k-segctrl__btn.is-active', ['color', 'background-color', 'border-bottom-color', 'box-shadow'], 'toolbar button (active)');
  M.toolbarHi   = probe(doc, '.vtb [class*="hi"]', P.TYPE, 'toolbar button (Devanagari)');
  M.toolbarClasses = classInventory(doc, '.vtb');

  M.tableClasses = classInventory(doc, '#tablehost');
  M.table     = probe(doc, '#tablehost .tbl__wrap', ['background-color', 'border-radius', 'border-top-width', 'border-top-color', 'overflow'], 'table shell');
  M.tableEl   = probe(doc, '#tablehost .tbl', ['border-collapse', 'font-size', 'table-layout'], 'table element');
  M.tableHead = probe(doc, '#tablehost .tbl th', P.TYPE.concat(['height', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'background-color', 'border-bottom-width', 'position']), 'table header cell');
  M.tableRow  = probe(doc, '#tablehost .tbl tbody tr', ['min-height', 'height', 'border-bottom-width', 'border-bottom-color', 'display', 'align-items', 'background-color'], 'table row');
  M.tableCell = probe(doc, '#tablehost .tbl tbody td', P.TYPE.concat(['height', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'border-bottom-width']), 'table body cell');
  M.tableTtl  = probe(doc, '#tablehost .tb__ttl', P.TYPE, 'table row title');
  const trb = doc.querySelector('#tablehost .tbl tbody tr');
  M.tableRowHeightRendered = trb ? +trb.getBoundingClientRect().height.toFixed(2) : null;

  M.drawerClasses = classInventory(doc, '.dr');
  M.drawer      = probe(doc, '.dr', ['width', 'max-width', 'box-shadow', 'background-color', 'border-left-width', 'border-left-color', 'border-radius', 'animation-duration', 'animation-timing-function', 'animation-name'], 'drawer shell');
  M.drawerHead  = probe(doc, '.dr__head', P.BOX, 'drawer head');
  M.drawerBody  = probe(doc, '.dr__body', P.BOX.concat(['overflow-y']), 'drawer body');
  M.drawerSec   = probe(doc, '.dr__sec', P.BOX, 'drawer section');
  M.drawerTitle = probe(doc, '.dr__title', P.TYPE, 'drawer title');
  M.drawerTitleRow = probe(doc, '.dr__titlerow', P.BOX, 'drawer title row');
  M.drawerCrumb = probe(doc, '.dr__crumb', P.TYPE, 'drawer breadcrumb');
  M.drawerId    = probe(doc, '.dr__id', P.TYPE, 'drawer task id');
  M.scrim       = probe(doc, '.dr__scrim', ['background-color', 'animation-duration', 'animation-timing-function'], 'drawer scrim');
  M.props       = probe(doc, '.dr__props', ['display', 'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'padding-top', 'padding-bottom'], 'drawer props grid');
  M.prop        = probe(doc, '.dr__prop', ['display', 'gap', 'align-items', 'padding-top', 'padding-bottom', 'min-height', 'flex-direction'], 'drawer prop row');
  M.propL       = probe(doc, '.dr__lbl', P.TYPE.concat(['width', 'min-width']), 'drawer prop label');
  M.propHi      = probe(doc, '.dr__lbl-hi', P.TYPE, 'drawer prop label (Devanagari)');
  M.drawerTabsBar = probe(doc, '.dr .tabs__bar, .tabs__bar', ['display', 'gap', 'border-bottom-width', 'min-height', 'padding-top', 'padding-bottom'], 'drawer tab bar');
  M.drawerTabsBtn = probe(doc, '.dr .tabs__b, .tabs__b', P.TYPE.concat(['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap', 'min-height']), 'drawer tab button');

  const dw = doc.querySelector('.dr');
  M.drawerTypeScale = dw ? [...dw.querySelectorAll('*')].filter(e => {
    const t = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    return t.length > 0 && t.length < 60;
  }).slice(0, 40).map(e => {
    const cs = getComputedStyle(e);
    return {
      cls: String(e.className), text: e.textContent.trim().slice(0, 22),
      fs: cs.fontSize, fw: cs.fontWeight, ls: cs.letterSpacing,
      ff: cs.fontFamily.split(',')[0], tt: cs.textTransform, color: cs.color,
    };
  }) : [];

  M.devanagari = devanagari(doc);

  say(M);
  document.title = 'DONE';
})().catch(e => say({ ERROR: String((e && e.stack) || e) }));
