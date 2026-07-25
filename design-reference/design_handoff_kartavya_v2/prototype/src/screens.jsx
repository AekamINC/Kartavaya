// All five screens: Today, Tasks, Boards, Project detail, Team.
// Pure-presentational React functions; data comes from window globals.

// ── Shared helpers ──────────────────────────────────────────────────────────

function projectOf(pid) { return PROJECTS.find(p => p.id === pid); }
function userOf(uid)    { return TEAM.find(u => u.id === uid); }
function colOf(cid)     { return COLUMNS.find(c => c.id === cid); }

const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
const PRIORITY_COLOR = { low: '#10b981', medium: '#f59e0b', high: '#ef4444', urgent: '#dc2626' };

function relDue(iso) {
  const d = new Date(iso + 'T00:00:00');
  const now = new Date('2026-05-14T00:00:00');
  const diff = Math.round((d - now) / 86400000);
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, tone: 'danger' };
  if (diff === 0) return { label: 'Today',     tone: 'warn' };
  if (diff === 1) return { label: 'Tomorrow',  tone: 'warn' };
  if (diff < 7)   return { label: `In ${diff}d`, tone: 'normal' };
  return { label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), tone: 'muted' };
}

function Avatar({ uid, size = 24, ring = false }) {
  const u = userOf(uid);
  if (!u) return null;
  return (
    <span
      className={'k-avatar' + (ring ? ' k-avatar--ring' : '')}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: u.color }}
      title={u.name}
    >{u.initials}</span>
  );
}

function AvatarStack({ ids, size = 22, max = 3 }) {
  const shown = ids.slice(0, max);
  const extra = ids.length - shown.length;
  return (
    <span className="k-avstack" style={{ '--av-size': size + 'px' }}>
      {shown.map((id) => <Avatar key={id} uid={id} size={size} ring />)}
      {extra > 0 && <span className="k-avstack__more" style={{ width: size, height: size }}>+{extra}</span>}
    </span>
  );
}

function PriorityDot({ p, size = 8 }) {
  return <span className="k-pdot" style={{ width: size, height: size, background: PRIORITY_COLOR[p] }} />;
}

function ProjectTag({ pid, dense }) {
  const p = projectOf(pid);
  if (!p) return null;
  return (
    <span className="k-ptag">
      <span className="k-ptag__dot" style={{ background: p.color }} />
      <span className="k-ptag__name">{p.name}</span>
      {!dense && <span className="k-ptag__sans">{p.sanskrit}</span>}
    </span>
  );
}

// ── Today (Dashboard) ───────────────────────────────────────────────────────

function ScreenToday({ lang, density, onOpenTask, onNav }) {
  const myTasks = TASKS.filter(t => t.assignees.includes('u1') && !t.done);
  const dueToday = TASKS.filter(t => t.due === '2026-05-14' && !t.done);
  const overdue  = TASKS.filter(t => new Date(t.due) < new Date('2026-05-14') && !t.done);
  const upcoming = TASKS.filter(t => !t.done && new Date(t.due) > new Date('2026-05-14'))
                        .sort((a,b) => a.due.localeCompare(b.due)).slice(0, 6);

  // Status breakdown across my work
  const byStatus = COLUMNS.map(c => ({ ...c, count: TASKS.filter(t => t.column === c.id).length }));
  const total = byStatus.reduce((s, r) => s + r.count, 0);

  // Mini week strip — May 14, 2026 is a Thursday (getDay() === 4).
  // Build local-date ISO strings to avoid the UTC-shift bug toISOString causes
  // when the user is east of GMT.
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = new Date('2026-05-14T00:00:00');
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const iso = fmt(d);
    const tcount = TASKS.filter(t => t.due === iso && !t.done).length;
    return { date: d, iso, tcount, isToday: iso === '2026-05-14' };
  });

  const greet = lang === 'hi' ? 'नमस्ते' : lang === 'mix' ? 'नमस्ते' : 'Good morning';

  return (
    <div className="k-screen">
      {/* Editorial hero */}
      <section className="k-hero">
        <div className="k-hero__watermark" aria-hidden="true">कर्तव्य</div>
        <div className="k-hero__inner">
          <div className="k-hero__meta">
            <span className="k-hero__date">Thursday · {HINDU_DATE.dayHi}</span>
            <span className="k-hero__sep">·</span>
            <span className="k-hero__date">14 May 2026</span>
            <span className="k-hero__sep">·</span>
            <span className="k-hero__samvat">{HINDU_DATE.samvat}</span>
          </div>
          <h1 className="k-hero__h1">
            <span className="k-hero__greet">{greet},</span>
            <span className="k-hero__name">Keval.</span>
          </h1>
          <p className="k-hero__lede">
            You have <b>{myTasks.length} open tasks</b>, {dueToday.length} due today, {overdue.length} running late.
            <span className="hi-mute"> करणीयं कुरु — </span>
            <em>Do what must be done.</em>
          </p>
          <div className="k-hero__weekstrip">
            {days.map((d, i) => (
              <div key={i} className={'k-week' + (d.isToday ? ' is-today' : '')}>
                <div className="k-week__hi">{WEEK_HI[i]}</div>
                <div className="k-week__num">{d.date.getDate()}</div>
                <div className="k-week__dots">
                  {Array.from({ length: Math.min(d.tcount, 4) }).map((_, j) => <i key={j} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stat row */}
      <section className="k-stats">
        <StatTile title="Open" sansTitle="कार्य" value={myTasks.length} sub="across 4 projects" tone="blue" />
        <StatTile title="Due today" sansTitle="आज" value={dueToday.length} sub="2 high priority" tone="amber" />
        <StatTile title="Overdue" sansTitle="विलंबित" value={overdue.length} sub="needs attention" tone="red" />
        <StatTile title="Completed this week" sansTitle="सम्पन्न" value={2} sub="↑ 18% vs last week" tone="teal" />
      </section>

      {/* Two-column body */}
      <section className="k-twocol">
        <div className="k-col k-col--main">
          <Card title="On your plate" sansTitle="आपके हाथ में" action={<a className="k-link" onClick={() => onNav('tasks')}>View all →</a>}>
            <div className="k-tasklist">
              {myTasks.slice(0, 6).map(t => (
                <button key={t.id} className="k-taskrow" onClick={() => onOpenTask(t)}>
                  <PriorityDot p={t.priority} />
                  <span className="k-taskrow__id">{t.id}</span>
                  <span className="k-taskrow__title">{t.title}</span>
                  <ProjectTag pid={t.project} dense />
                  <DueChip due={t.due} />
                  <AvatarStack ids={t.assignees} size={20} />
                </button>
              ))}
            </div>
          </Card>

          <Card title="Status breakdown" sansTitle="स्थिति विवरण" action={<a className="k-link" onClick={() => onNav('boards')}>Open board →</a>}>
            <div className="k-stackbar">
              {byStatus.map(s => (
                <div key={s.id} className="k-stackbar__seg"
                     style={{ flex: s.count, background: s.color }}
                     title={`${s.title}: ${s.count}`}/>
              ))}
            </div>
            <div className="k-statuslegend">
              {byStatus.map(s => (
                <div key={s.id} className="k-statuslegend__row">
                  <span className="k-statuslegend__dot" style={{ background: s.color }} />
                  <span className="k-statuslegend__lbl">{s.title}</span>
                  <span className="k-statuslegend__hi">{s.devanagari}</span>
                  <span className="k-statuslegend__count">{s.count}</span>
                </div>
              ))}
            </div>
            <div className="k-meter">
              <div className="k-meter__bar"><div className="k-meter__fill" style={{ width: Math.round(byStatus[3].count / total * 100) + '%' }} /></div>
              <div className="k-meter__lbl">{Math.round(byStatus[3].count / total * 100)}% complete · <span className="hi-mute">{Math.round(byStatus[3].count / total * 100)}% सम्पन्न</span></div>
            </div>
          </Card>
        </div>

        <div className="k-col k-col--side">
          <Card title="Upcoming" sansTitle="आगामी">
            <div className="k-upcoming">
              {upcoming.map(t => (
                <button key={t.id} className="k-upcoming__row" onClick={() => onOpenTask(t)}>
                  <DueChip due={t.due} flush />
                  <div className="k-upcoming__body">
                    <div className="k-upcoming__title">{t.title}</div>
                    <div className="k-upcoming__meta"><ProjectTag pid={t.project} dense /></div>
                  </div>
                  <AvatarStack ids={t.assignees} size={18} max={2} />
                </button>
              ))}
            </div>
          </Card>

          <Card title="Team pulse" sansTitle="दल की गतिविधि" action={<a className="k-link">All activity →</a>}>
            <div className="k-activity">
              {ACTIVITY.map((a, i) => {
                const u = userOf(a.who);
                return (
                  <div key={i} className="k-activity__row">
                    <Avatar uid={a.who} size={22} />
                    <div className="k-activity__body">
                      <div className="k-activity__line">
                        <b>{u.name.split(' ')[0]}</b> <span className="k-mute">{a.verb}</span> <span className="k-activity__what">{a.what}</span>
                        {a.to && <span className="k-mute"> {a.to}</span>}
                      </div>
                      <div className="k-activity__when">{a.when}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="k-citation">
            <div className="k-citation__sans">कर्मण्येवाधिकारस्ते मा फलेषु कदाचन</div>
            <div className="k-citation__src">— Bhagavad Gītā 2.47 · You have a right to action alone, never to its fruits.</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatTile({ title, sansTitle, value, sub, tone }) {
  return (
    <div className={'k-stat k-stat--' + tone}>
      <div className="k-stat__lbl">
        <span>{title}</span>
        <span className="k-stat__hi">{sansTitle}</span>
      </div>
      <div className="k-stat__val">{value}</div>
      <div className="k-stat__sub">{sub}</div>
    </div>
  );
}

function Card({ title, sansTitle, action, children }) {
  return (
    <section className="k-card">
      <header className="k-card__head">
        <div className="k-card__titles">
          <h3 className="k-card__title">{title}</h3>
          {sansTitle && <span className="k-card__sans">{sansTitle}</span>}
        </div>
        {action}
      </header>
      <div className="k-card__body">{children}</div>
    </section>
  );
}

function DueChip({ due, flush }) {
  const { label, tone } = relDue(due);
  return <span className={'k-due k-due--' + tone + (flush ? ' k-due--flush' : '')}>{label}</span>;
}

// ── Tasks (list view) ───────────────────────────────────────────────────────

function ScreenTasks({ lang, onOpenTask, search }) {
  const [filter, setFilter] = React.useState('mine');
  const [group, setGroup]   = React.useState('priority');

  let list = TASKS;
  if (filter === 'mine')   list = list.filter(t => t.assignees.includes('u1') && !t.done);
  if (filter === 'all')    list = list.filter(t => !t.done);
  if (filter === 'done')   list = list.filter(t => t.done);
  if (filter === 'overdue')list = list.filter(t => new Date(t.due) < new Date('2026-05-14') && !t.done);
  if (search) list = list.filter(t => (t.title + ' ' + t.id).toLowerCase().includes(search.toLowerCase()));

  // Group
  const groups = {};
  if (group === 'priority') {
    ['urgent', 'high', 'medium', 'low'].forEach(p => groups[p] = list.filter(t => t.priority === p));
  } else if (group === 'project') {
    PROJECTS.forEach(p => groups[p.id] = list.filter(t => t.project === p.id));
  } else {
    COLUMNS.forEach(c => groups[c.id] = list.filter(t => t.column === c.id));
  }

  const groupTitle = (key) => {
    if (group === 'priority') return { title: PRIORITY_LABEL[key], sans: { urgent: 'अत्यावश्यक', high: 'उच्च', medium: 'मध्यम', low: 'न्यून' }[key], color: PRIORITY_COLOR[key] };
    if (group === 'project')  { const p = projectOf(key); return { title: p.name, sans: p.sanskrit, color: p.color }; }
    const c = colOf(key); return { title: c.title, sans: c.devanagari, color: c.color };
  };

  return (
    <div className="k-screen">
      <PageHeader
        kicker="Workspace"
        title="Tasks"
        sansTitle="कर्तव्य"
        lede="The list of what's worth doing today."
      />

      {/* Filter rail */}
      <div className="k-filterbar">
        <div className="k-segctrl">
          {['mine','all','overdue','done'].map(f => (
            <button key={f} className={'k-segctrl__btn' + (filter === f ? ' is-active' : '')} onClick={() => setFilter(f)}>
              {{ mine: 'Mine', all: 'All open', overdue: 'Overdue', done: 'Done' }[f]}
              <span className="k-segctrl__count">{TASKS.filter(t => {
                if (f === 'mine') return t.assignees.includes('u1') && !t.done;
                if (f === 'all') return !t.done;
                if (f === 'overdue') return new Date(t.due) < new Date('2026-05-14') && !t.done;
                if (f === 'done') return t.done;
                return false;
              }).length}</span>
            </button>
          ))}
        </div>
        <div className="k-filterbar__right">
          <label className="k-fld">
            <span className="k-fld__lbl">Group by</span>
            <select value={group} onChange={(e) => setGroup(e.target.value)} className="k-fld__sel">
              <option value="priority">Priority</option>
              <option value="project">Project</option>
              <option value="status">Status</option>
            </select>
          </label>
        </div>
      </div>

      {/* Grouped table */}
      <div className="k-tablewrap">
        <div className="k-table__head">
          <div className="k-table__hcell k-c-task">Task</div>
          <div className="k-table__hcell k-c-project">Project</div>
          <div className="k-table__hcell k-c-assignees">Assignees</div>
          <div className="k-table__hcell k-c-due">Due</div>
          <div className="k-table__hcell k-c-status">Status</div>
        </div>
        {Object.entries(groups).map(([k, items]) => {
          if (items.length === 0) return null;
          const g = groupTitle(k);
          return (
            <div key={k} className="k-group">
              <div className="k-group__head" style={{ '--group-color': g.color }}>
                <span className="k-group__bar" />
                <span className="k-group__title">{g.title}</span>
                <span className="k-group__sans">{g.sans}</span>
                <span className="k-group__count">{items.length}</span>
              </div>
              {items.map(t => (
                <button key={t.id} className="k-trow" onClick={() => onOpenTask(t)}>
                  <div className="k-trow__cell k-c-task">
                    <PriorityDot p={t.priority} />
                    <span className="k-trow__id">{t.id}</span>
                    <span className="k-trow__title">{t.title}</span>
                  </div>
                  <div className="k-trow__cell k-c-project"><ProjectTag pid={t.project} dense /></div>
                  <div className="k-trow__cell k-c-assignees"><AvatarStack ids={t.assignees} size={20} /></div>
                  <div className="k-trow__cell k-c-due"><DueChip due={t.due} /></div>
                  <div className="k-trow__cell k-c-status"><StatusChip cid={t.column} /></div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusChip({ cid }) {
  const c = colOf(cid);
  return (
    <span className="k-statuschip" style={{ '--c': c.color }}>
      <span className="k-statuschip__dot" />
      {c.title}
    </span>
  );
}

function PageHeader({ kicker, title, sansTitle, lede, right }) {
  return (
    <header className="k-pageh">
      <div className="k-pageh__txt">
        <div className="k-pageh__kicker">{kicker}</div>
        <h1 className="k-pageh__h1">
          {title}
          {sansTitle && <span className="k-pageh__sans">{sansTitle}</span>}
        </h1>
        {lede && <p className="k-pageh__lede">{lede}</p>}
      </div>
      {right && <div className="k-pageh__right">{right}</div>}
    </header>
  );
}

// ── Boards (Kanban) ─────────────────────────────────────────────────────────

function ScreenBoards({ onOpenTask, onNav }) {
  const [project, setProject] = React.useState('p1');
  const tasks = TASKS.filter(t => t.project === project);

  return (
    <div className="k-screen">
      <PageHeader
        kicker={projectOf(project).client + ' · ' + projectOf(project).sanskrit}
        title={projectOf(project).name}
        lede="Move work across the board. Click any card to open."
        right={
          <div className="k-headerright">
            <div className="k-projectpicker">
              {PROJECTS.map(p => (
                <button key={p.id}
                        className={'k-projectpicker__chip' + (p.id === project ? ' is-active' : '')}
                        onClick={() => setProject(p.id)}>
                  <span className="k-projectpicker__dot" style={{ background: p.color }} />
                  {p.name}
                </button>
              ))}
            </div>
            <button className="k-link" onClick={() => onNav('projects')}>Open project →</button>
          </div>
        }
      />

      <div className="k-board">
        {COLUMNS.map(c => {
          const items = tasks.filter(t => t.column === c.id);
          return (
            <div key={c.id} className="k-bcol">
              <div className="k-bcol__head">
                <span className="k-bcol__bar" style={{ background: c.color }} />
                <span className="k-bcol__title">{c.title}</span>
                <span className="k-bcol__sans">{c.devanagari}</span>
                <span className="k-bcol__count">{items.length}</span>
                <button className="k-bcol__add" title="Add task">+</button>
              </div>
              <div className="k-bcol__body">
                {items.map(t => (
                  <button key={t.id} className="k-bcard" onClick={() => onOpenTask(t)}>
                    <div className="k-bcard__top">
                      <PriorityDot p={t.priority} />
                      <span className="k-bcard__id">{t.id}</span>
                      <span className="k-bcard__priolbl">{PRIORITY_LABEL[t.priority]}</span>
                    </div>
                    <div className="k-bcard__title">{t.title}</div>
                    <div className="k-bcard__foot">
                      <DueChip due={t.due} />
                      <span className="k-bcard__meta">
                        {t.comments > 0 && <span title="Comments">
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 4h12v7H6l-3 3v-3H2V4z"/></svg>
                          {t.comments}
                        </span>}
                        {t.attachments > 0 && <span title="Attachments">
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M10 3l-5 5a2.5 2.5 0 003.5 3.5l5-5a4 4 0 00-5.7-5.7L3 5.5"/></svg>
                          {t.attachments}
                        </span>}
                      </span>
                      <AvatarStack ids={t.assignees} size={20} max={3} />
                    </div>
                  </button>
                ))}
                {items.length === 0 && <div className="k-bcol__empty">Nothing here</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Projects list ───────────────────────────────────────────────────────────

function ScreenProjects({ onOpenProject, onNav }) {
  return (
    <div className="k-screen">
      <PageHeader
        kicker="Workspace"
        title="Projects"
        sansTitle="योजनाएँ"
        lede="Everything in flight at Aekam right now."
      />
      <div className="k-pgrid">
        {PROJECTS.map(p => {
          const tasks = TASKS.filter(t => t.project === p.id);
          const done = tasks.filter(t => t.done).length;
          const due = relDue(p.due);
          return (
            <button key={p.id} className="k-pcard" onClick={() => { onOpenProject(p.id); onNav('boards'); }}>
              <div className="k-pcard__head">
                <span className="k-pcard__bar" style={{ background: p.color }} />
                <div className="k-pcard__titles">
                  <div className="k-pcard__sans">{p.sanskrit}</div>
                  <div className="k-pcard__name">{p.name}</div>
                  <div className="k-pcard__client">{p.client}</div>
                </div>
              </div>
              <div className="k-pcard__body">
                <div className="k-pcard__stat"><b>{tasks.length}</b><span>tasks</span></div>
                <div className="k-pcard__stat"><b>{done}</b><span>done</span></div>
                <div className="k-pcard__stat"><b>{tasks.length - done}</b><span>open</span></div>
              </div>
              <div className="k-pcard__meter">
                <div className="k-pcard__bar2"><i style={{ width: Math.round(p.progress * 100) + '%', background: p.color }} /></div>
                <div className="k-pcard__meter-row">
                  <span>{Math.round(p.progress * 100)}% complete</span>
                  <span className={'k-due k-due--' + due.tone}>{due.label}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Team ────────────────────────────────────────────────────────────────────

function ScreenTeam() {
  return (
    <div className="k-screen">
      <PageHeader
        kicker="Workspace"
        title="Team"
        sansTitle="सहयोगी"
        lede="Aekam Inc · 7 members across Mumbai and Bengaluru."
      />
      <div className="k-teamgrid">
        {TEAM.map(u => {
          const mine = TASKS.filter(t => t.assignees.includes(u.id) && !t.done);
          const done = TASKS.filter(t => t.assignees.includes(u.id) && t.done);
          return (
            <div key={u.id} className="k-mcard">
              <div className="k-mcard__head">
                <Avatar uid={u.id} size={44} />
                <div>
                  <div className="k-mcard__name">{u.name}</div>
                  <div className="k-mcard__role">
                    <span className={'k-rolebadge k-rolebadge--' + u.role}>{u.role}</span>
                    <span className="k-mcard__tz">{u.tz}</span>
                  </div>
                </div>
              </div>
              <div className="k-mcard__stats">
                <div><b>{mine.length}</b><span>open</span></div>
                <div><b>{done.length}</b><span>done</span></div>
                <div><b>{mine.reduce((s,t) => s + t.est, 0)}h</b><span>est</span></div>
              </div>
              <div className="k-mcard__work">
                {mine.slice(0, 3).map(t => (
                  <div key={t.id} className="k-mcard__row">
                    <PriorityDot p={t.priority} size={6} />
                    <span className="k-mcard__tt">{t.title}</span>
                    <span className="k-mcard__id">{t.id}</span>
                  </div>
                ))}
                {mine.length === 0 && <div className="k-mcard__empty">No open work · रिक्त</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, {
  ScreenToday, ScreenTasks, ScreenBoards, ScreenProjects, ScreenTeam,
  Avatar, AvatarStack, PriorityDot, DueChip, ProjectTag, StatusChip,
  Card, PageHeader, StatTile,
  projectOf, userOf, colOf, relDue, PRIORITY_LABEL, PRIORITY_COLOR,
});
