// Kartavya prototype — top-level App component.
// Hosts routing between screens, applies tweak values to CSS custom
// properties, owns the task drawer state, and mounts the TweaksPanel.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "accent": "teal",
  "density": "comfy",
  "font": "newsreader",
  "lang": "mix",
  "sidebarVariant": "wide"
}/*EDITMODE-END*/;

// Accent presets — each provides matching gradient stops + a luminance hint
// so we can tweak shadow tinting in CSS. All accents stay within the brand
// palette family (teal/blue/saffron/indigo).
const ACCENTS = {
  teal:    { primary: '#05b7aa', mid: '#03a1b6', deep: '#0082c6',
             grad: 'linear-gradient(90deg,#0082c6,#03a1b6,#05b7aa)',
             gradD: 'linear-gradient(135deg,#0082c6,#05b7aa)' },
  blue:    { primary: '#0082c6', mid: '#1d6fcf', deep: '#0a3d91',
             grad: 'linear-gradient(90deg,#0a3d91,#0082c6,#1d6fcf)',
             gradD: 'linear-gradient(135deg,#0a3d91,#1d6fcf)' },
  saffron: { primary: '#d97706', mid: '#ea580c', deep: '#9a3412',
             grad: 'linear-gradient(90deg,#9a3412,#d97706,#f59e0b)',
             gradD: 'linear-gradient(135deg,#9a3412,#f59e0b)' },
  indigo:  { primary: '#6366f1', mid: '#4f46e5', deep: '#3730a3',
             grad: 'linear-gradient(90deg,#3730a3,#4f46e5,#818cf8)',
             gradD: 'linear-gradient(135deg,#3730a3,#818cf8)' },
};

const FONTS = {
  newsreader: { display: '"Newsreader", "Source Serif 4", Georgia, serif',
                ui:      'Inter, ui-sans-serif, system-ui, sans-serif' },
  spectral:   { display: '"Spectral", "Source Serif 4", Georgia, serif',
                ui:      'Inter, ui-sans-serif, system-ui, sans-serif' },
  inter:      { display: 'Inter, ui-sans-serif, system-ui, sans-serif',
                ui:      'Inter, ui-sans-serif, system-ui, sans-serif' },
  geist:      { display: '"Instrument Serif", Georgia, serif',
                ui:      '"Geist", Inter, ui-sans-serif, system-ui, sans-serif' },
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [active, setActive] = React.useState('today');
  const [search, setSearch] = React.useState('');
  const [drawerTask, setDrawerTask] = React.useState(null);
  const [project, setProject] = React.useState('p1');
  const [extraTasks, setExtraTasks] = React.useState([]);
  const [newTaskOpen, setNewTaskOpen] = React.useState(false);

  // Push the user-created tasks into the global TASKS list so all screens see
  // them. The list reference is mutated in-place; rerender keys come from
  // setExtraTasks above.
  React.useEffect(() => {
    // Reset to base then re-append our extras to avoid drift on hot-edit.
    const base = window.__BASE_TASKS || (window.__BASE_TASKS = TASKS.slice());
    TASKS.length = 0; TASKS.push(...base, ...extraTasks);
  }, [extraTasks]);

  const createTask = (task) => setExtraTasks(prev => [task, ...prev]);

  // Push tweak-derived CSS variables to :root so any component can read them
  React.useEffect(() => {
    const r = document.documentElement;
    r.setAttribute('data-theme', t.theme);
    r.setAttribute('data-density', t.density);
    r.setAttribute('data-font', t.font);
    r.setAttribute('data-sidebar', t.sidebarVariant);
    const a = ACCENTS[t.accent] || ACCENTS.teal;
    r.style.setProperty('--k-primary', a.primary);
    r.style.setProperty('--k-mid', a.mid);
    r.style.setProperty('--k-deep', a.deep);
    r.style.setProperty('--k-grad', a.grad);
    r.style.setProperty('--k-gradD', a.gradD);
    const f = FONTS[t.font] || FONTS.newsreader;
    r.style.setProperty('--font-display', f.display);
    r.style.setProperty('--font-ui', f.ui);
  }, [t.theme, t.density, t.accent, t.font, t.sidebarVariant]);

  const openTask = (task) => setDrawerTask(task);
  const closeTask = () => setDrawerTask(null);
  const openProject = (pid) => setProject(pid);

  return (
    <div className="k-app">
      <Sidebar
        active={active}
        onNav={setActive}
        variant={t.sidebarVariant}
        lang={t.lang}
        density={t.density}
      />
      <main className="k-main">
        <Topbar active={active} lang={t.lang} search={search} onSearch={setSearch} onNewTask={() => setNewTaskOpen(true)} />
        <div className="k-content" data-screen-label={active}>
          {active === 'today'       && <ScreenToday  lang={t.lang} density={t.density} onOpenTask={openTask} onNav={setActive} />}
          {active === 'tasks'       && <ScreenTasks  lang={t.lang} onOpenTask={openTask} search={search} />}
          {active === 'boards'      && <ScreenBoards onOpenTask={openTask} onNav={setActive} />}
          {active === 'projects'    && <ScreenProjects onOpenProject={openProject} onNav={setActive} />}
          {active === 'team'        && <ScreenTeam />}
          {active === 'inbox'       && <ScreenInbox onOpenTask={openTask} />}
          {active === 'reports'     && <ScreenTimeReport />}
          {active === 'approvals'   && <ScreenApprovals />}
          {active === 'activity'    && <ScreenActivity onOpenTask={openTask} />}
          {active === 'automations' && <ScreenAutomations />}
          {active === 'templates'   && <ScreenTemplates />}
          {active === 'categories'  && <ScreenCategories />}
          {active === 'admin'       && <ScreenAdmin />}
        </div>
      </main>
      {drawerTask && <TaskDrawer task={drawerTask} onClose={closeTask} />}

      <NewTaskModal
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        onCreate={createTask}
        defaults={{ project: active === 'boards' ? project : 'p1' }}
      />

      <InlineTweaks t={t} setTweak={setTweak} />
    </div>
  );
}

// ── Light-weight stub screens for Inbox + Reports ──────────────────────────
function ScreenInbox({ onOpenTask }) {
  const mine = TASKS.filter(t => t.assignees.includes('u1') && !t.done);
  return (
    <div className="k-screen">
      <PageHeader kicker="Team" title="Inbox" sansTitle="सन्देश"
                  lede="Mentions, assignments, and approvals routed to you." />
      <div className="k-inbox">
        {[
          { who: 'u2', kind: 'mention',  task: mine[0], snippet: '@Keval can you confirm the Borivali rent entry is okay to flag for working notes?' },
          { who: 'u5', kind: 'assign',   task: mine[1], snippet: 'assigned KAR-108 to you · due in 2 days' },
          { who: 'u1', kind: 'approval', task: TASKS.find(t => t.id === 'KAR-502'), snippet: 'Tata Steel invoice fix needs your approval before sending' },
          { who: 'u4', kind: 'mention',  task: mine[0], snippet: 'Final copy direction is locked. @Keval reviewing tomorrow morning?' },
        ].map((m, i) => (
          <button key={i} className={'k-inboxrow k-inboxrow--' + m.kind} onClick={() => onOpenTask(m.task)}>
            <Avatar uid={m.who} size={28} />
            <div className="k-inboxrow__body">
              <div className="k-inboxrow__head">
                <b>{userOf(m.who).name}</b>
                <span className={'k-inboxkind k-inboxkind--' + m.kind}>{m.kind}</span>
                <span className="k-mute">· on {m.task.id}</span>
              </div>
              <div className="k-inboxrow__snip">{m.snippet}</div>
            </div>
            <DueChip due={m.task.due} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ScreenReports() {
  return (
    <div className="k-screen">
      <PageHeader kicker="Workspace" title="Reports" sansTitle="विवरण"
                  lede="Weekly snapshot of throughput, due dates, and team load." />
      <div className="k-twocol">
        <div className="k-col k-col--main">
          <Card title="Throughput · last 6 weeks" sansTitle="गति">
            <div className="k-bars">
              {[6, 9, 8, 11, 14, 17].map((n, i) => (
                <div key={i} className="k-bar">
                  <div className="k-bar__col" style={{ height: n * 7 + 'px' }} />
                  <div className="k-bar__lbl">W{i + 1}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="By project" sansTitle="परियोजना-वार">
            {PROJECTS.map(p => {
              const tasks = TASKS.filter(t => t.project === p.id);
              return (
                <div key={p.id} className="k-pbar">
                  <span className="k-pbar__name">{p.name}</span>
                  <div className="k-pbar__bar"><i style={{ width: Math.round(p.progress*100)+'%', background: p.color }} /></div>
                  <span className="k-pbar__count">{tasks.length} tasks</span>
                </div>
              );
            })}
          </Card>
        </div>
        <div className="k-col k-col--side">
          <Card title="Team load" sansTitle="भार">
            {TEAM.filter(u => u.role !== 'client').map(u => {
              const open = TASKS.filter(t => t.assignees.includes(u.id) && !t.done).length;
              return (
                <div key={u.id} className="k-load">
                  <Avatar uid={u.id} size={22} />
                  <span className="k-load__name">{u.name.split(' ')[0]}</span>
                  <div className="k-load__bar"><i style={{ width: Math.min(open*15, 100) + '%' }} /></div>
                  <span className="k-load__n">{open}</span>
                </div>
              );
            })}
          </Card>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { App, ScreenInbox, ScreenReports });

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
