// Additional screens: Approvals, Activity, Automations, Time Report,
// Templates, Categories, Admin. All match the editorial-typographic system
// established in screens.jsx (Devanagari accents, Newsreader display font,
// muted paper canvas).

// ── Mock data shared across these screens ──────────────────────────────────

const APPROVALS = [
  { id: 'AP-021', task: 'KAR-502', title: 'Tata Steel — invoice formatting fix', requester: 'u1', client: 'Tata Steel',   amount: '₹ 84,500',  when: '15m ago',  kind: 'invoice',  priority: 'urgent' },
  { id: 'AP-020', task: 'KAR-411', title: 'Vendor agreement — Reliance Power',   requester: 'u3', client: 'Internal',     amount: '₹ 2,40,000', when: '2h ago',  kind: 'contract', priority: 'high' },
  { id: 'AP-019', task: 'KAR-202', title: 'Diwali campaign — Hindi creative brief', requester: 'u4', client: 'Saraswati Co.', amount: null,    when: 'Yesterday', kind: 'creative', priority: 'medium' },
];

const APPROVALS_HISTORY = [
  { id: 'AP-018', title: 'CA Sharma — Q4 working notes', verdict: 'approved', by: 'u1', when: '2d ago' },
  { id: 'AP-017', title: 'Borivali print run — final layout', verdict: 'approved', by: 'u1', when: '3d ago' },
  { id: 'AP-016', title: 'BBMP permit packet v2',  verdict: 'rejected', by: 'u5', when: '4d ago', reason: 'Missing landlord NOC scan' },
];

const ACTIVITY_FULL = [
  { day: 'Today', items: [
    { who: 'u5', verb: 'moved',     subj: 'KAR-301 Electrical contractor — site visit', to: 'In progress',  when: '12m ago' },
    { who: 'u2', verb: 'commented', subj: 'KAR-108 Reconcile input tax credit',          to: '"Got the March ledger from CA Sharma"', when: '1h ago' },
    { who: 'u4', verb: 'created',   subj: 'KAR-203 Vendor quote — Borivali print run',   to: 'Diwali campaign · To do', when: '2h ago' },
    { who: 'u1', verb: 'approved',  subj: 'KAR-503 Send revised SOW for May engagement', to: 'and marked Done', when: '3h ago' },
    { who: 'u6', verb: 'attached',  subj: 'BBMP_permit_v3.pdf',                          to: 'on KAR-308', when: '4h ago' },
  ]},
  { day: 'Yesterday', sans: 'कल', items: [
    { who: 'u3', verb: 'assigned',  subj: 'KAR-202 Hindi/Marathi creative brief',         to: 'to Priya Nair', when: '1d ago' },
    { who: 'u1', verb: 'changed',   subj: 'priority on KAR-104',                          to: 'from Medium to High', when: '1d ago' },
    { who: 'u2', verb: 'commented', subj: 'KAR-095',                                      to: '"Filed with GSTN at 4:12 PM"', when: '1d ago' },
  ]},
  { day: 'Earlier this week', sans: 'इस सप्ताह', items: [
    { who: 'u5', verb: 'created',   subj: 'KAR-308 BBMP permit — re-submission packet',   to: 'Bengaluru office fit-out', when: '3d ago' },
    { who: 'u1', verb: 'created',   subj: 'Q1 GST filing project',                        to: 'and added 12 columns', when: '4d ago' },
  ]},
];

const AUTOMATIONS = [
  { id: 'AU-1', name: 'Notify on done',
    when: 'Status changes to Done',     when_sans: 'सम्पन्न',
    then: 'Send in-app notification to all watchers',
    cond: 'Project is in Aekam workspace',
    runs: 84, active: true, owner: 'u1' },
  { id: 'AU-2', name: 'Auto-assign GST tasks',
    when: 'Task created in "Quarterly GST filing"', when_sans: 'राजस्व',
    then: 'Assign to Aanya Mehta and Vikram Joshi',
    cond: 'Priority is High or Urgent',
    runs: 26, active: true, owner: 'u1' },
  { id: 'AU-3', name: 'Overdue escalation',
    when: 'Task is 2 days overdue',     when_sans: 'विलंबित',
    then: 'Add @manager to watchers + raise priority to Urgent',
    cond: 'Assignee has not commented in 24h',
    runs: 11, active: true, owner: 'u5' },
  { id: 'AU-4', name: 'Client portal sync',
    when: 'Task tagged "client-visible"', when_sans: 'ग्राहक',
    then: 'Mirror to client portal',
    cond: 'Status is not "In review"',
    runs: 142, active: false, owner: 'u1' },
];

const TIME_ENTRIES = [
  { date: '2026-05-14', who: 'u1', task: 'KAR-104', hours: 2.5, note: 'GSTR-3B working notes' },
  { date: '2026-05-14', who: 'u2', task: 'KAR-108', hours: 3.0, note: 'ITC reconciliation Mar' },
  { date: '2026-05-14', who: 'u5', task: 'KAR-301', hours: 1.5, note: 'Site visit prep + travel' },
  { date: '2026-05-13', who: 'u1', task: 'KAR-104', hours: 4.0, note: 'Sales register pull' },
  { date: '2026-05-13', who: 'u4', task: 'KAR-202', hours: 5.5, note: 'Hindi headline drafts' },
  { date: '2026-05-13', who: 'u6', task: 'KAR-310', hours: 2.0, note: 'Furniture vendor calls' },
  { date: '2026-05-12', who: 'u2', task: 'KAR-095', hours: 6.0, note: 'GSTR-1 filing + checks' },
  { date: '2026-05-12', who: 'u3', task: 'KAR-203', hours: 1.5, note: 'Borivali quote chase' },
  { date: '2026-05-11', who: 'u5', task: 'KAR-308', hours: 4.5, note: 'BBMP packet v3 assembly' },
  { date: '2026-05-11', who: 'u1', task: 'KAR-502', hours: 1.0, note: 'Tata Steel invoice fix' },
  { date: '2026-05-10', who: 'u4', task: 'KAR-201', hours: 3.0, note: 'Landing copy direction' },
  { date: '2026-05-08', who: 'u1', task: 'KAR-411', hours: 2.0, note: 'Legal review notes' },
];

const TEMPLATES_PROJECT = [
  { id: 'TP-1', name: 'Quarterly GST filing',    sans: 'राजस्व',   columns: 5, fields: 8, useCount: 4, sub: 'Sales, ITC, GSTR-1, GSTR-3B, sign-off' },
  { id: 'TP-2', name: 'Client onboarding',        sans: 'स्वागत',   columns: 4, fields: 6, useCount: 11, sub: 'KYC, agreement, kick-off, first invoice' },
  { id: 'TP-3', name: 'Campaign launch',          sans: 'विपणन',    columns: 6, fields: 12, useCount: 7, sub: 'Brief → creatives → vendor → live' },
  { id: 'TP-4', name: 'Office fit-out',           sans: 'कार्यालय', columns: 5, fields: 9, useCount: 2, sub: 'Permits, vendors, install, sign-off' },
];

const TEMPLATES_TASK = [
  { id: 'TT-1', name: 'GST monthly close',  sans: 'मासिक',  sub: 'Standard checklist · 12 sub-tasks · est. 16h' },
  { id: 'TT-2', name: 'Invoice dispatch',   sans: 'चालान',  sub: 'Format → review → send · est. 1h' },
  { id: 'TT-3', name: 'Vendor follow-up',   sans: 'अनुगमन', sub: 'Email → call → escalate · est. 30m' },
];

const CATEGORIES = [
  { id: 'CT-1', name: 'GST',                color: '#0082c6', sans: 'राजस्व',   count: 24 },
  { id: 'CT-2', name: 'Client-visible',      color: '#05b7aa', sans: 'ग्राहक',   count: 18 },
  { id: 'CT-3', name: 'Internal',            color: '#94a3b8', sans: 'आंतरिक',   count: 31 },
  { id: 'CT-4', name: 'Compliance',          color: '#ef4444', sans: 'अनुपालन',  count: 9 },
  { id: 'CT-5', name: 'Marketing',           color: '#f59e0b', sans: 'विपणन',    count: 18 },
  { id: 'CT-6', name: 'Bengaluru office',    color: '#8b5cf6', sans: 'कार्यालय', count: 12 },
  { id: 'CT-7', name: 'Mumbai office',       color: '#ec4899', sans: 'मुम्बई',   count: 6 },
  { id: 'CT-8', name: 'High value',          color: '#dc2626', sans: 'महत्व',    count: 7 },
];

Object.assign(window, { APPROVALS, APPROVALS_HISTORY, ACTIVITY_FULL, AUTOMATIONS, TIME_ENTRIES, TEMPLATES_PROJECT, TEMPLATES_TASK, CATEGORIES });

// ── Approvals screen ───────────────────────────────────────────────────────

function ScreenApprovals() {
  return (
    <div className="k-screen">
      <PageHeader
        kicker="Operations"
        title="Approvals"
        sansTitle="सम्मति"
        lede="What needs your signature, ranked by who's waiting longest."
        right={
          <div className="k-approvals__counter">
            <div className="k-approvals__counter-num">{APPROVALS.length}</div>
            <div className="k-approvals__counter-lbl">awaiting<br/>your nod</div>
          </div>
        }
      />

      <div className="k-approvals">
        {APPROVALS.map((a) => {
          const u = userOf(a.requester);
          return (
            <div key={a.id} className={'k-apcard k-apcard--' + a.kind}>
              <div className="k-apcard__rail" />
              <div className="k-apcard__body">
                <div className="k-apcard__meta">
                  <span className="k-apcard__id">{a.id}</span>
                  <span className="k-mute">·</span>
                  <span className={'k-apcard__kind k-apcard__kind--' + a.kind}>{a.kind}</span>
                  <span className="k-mute">·</span>
                  <span className="k-mute">requested {a.when}</span>
                  {a.priority === 'urgent' && <span className="k-apcard__urgent">URGENT · अत्यावश्यक</span>}
                </div>
                <h3 className="k-apcard__title">{a.title}</h3>
                <div className="k-apcard__sub">
                  <span className="k-apcard__from"><Avatar uid={a.requester} size={20} /> {u.name}</span>
                  <span className="k-mute">·</span>
                  <span>{a.client}</span>
                  {a.amount && <><span className="k-mute">·</span><span className="k-mono">{a.amount}</span></>}
                </div>
              </div>
              <div className="k-apcard__actions">
                <button className="k-btn k-btn--ghost">View detail</button>
                <button className="k-btn k-btn--reject">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l10 10M13 3L3 13"/></svg>
                  Reject
                </button>
                <button className="k-btn k-btn--primary">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8l3.5 3.5L13 5"/></svg>
                  Approve
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Card title="Decided" sansTitle="निर्णीत" action={<a className="k-link">Full history →</a>}>
        <div className="k-aphist">
          {APPROVALS_HISTORY.map(h => (
            <div key={h.id} className="k-aphist__row">
              <span className={'k-aphist__verdict k-aphist__verdict--' + h.verdict}>
                {h.verdict === 'approved' ? '✓' : '✕'} {h.verdict}
              </span>
              <span className="k-aphist__id">{h.id}</span>
              <span className="k-aphist__title">{h.title}</span>
              {h.reason && <span className="k-aphist__reason">"{h.reason}"</span>}
              <span className="k-aphist__by">
                <Avatar uid={h.by} size={18} /> {userOf(h.by).name.split(' ')[0]} · {h.when}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Activity Feed screen ───────────────────────────────────────────────────

function ScreenActivity({ onOpenTask }) {
  const [filter, setFilter] = React.useState('all');
  const [member, setMember] = React.useState('all');

  const filtered = ACTIVITY_FULL.map(group => ({
    ...group,
    items: group.items.filter(it => (member === 'all' || it.who === member) && (filter === 'all' || it.verb === filter)),
  })).filter(g => g.items.length > 0);

  return (
    <div className="k-screen">
      <PageHeader
        kicker="Operations"
        title="Activity"
        sansTitle="क्रिया"
        lede="Everything that happened in your workspace, in order."
      />

      <div className="k-filterbar">
        <div className="k-segctrl">
          {['all', 'created', 'moved', 'commented', 'approved', 'attached'].map(f => (
            <button key={f} className={'k-segctrl__btn' + (filter === f ? ' is-active' : '')} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All events' : f}
            </button>
          ))}
        </div>
        <div className="k-filterbar__right">
          <label className="k-fld">
            <span className="k-fld__lbl">Member</span>
            <select value={member} onChange={(e) => setMember(e.target.value)} className="k-fld__sel">
              <option value="all">Everyone</option>
              {TEAM.filter(u => u.role !== 'client').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <button className="k-btn k-btn--ghost k-btn--sm">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 8a5 5 0 109 0M11 5l2-2 2 2"/></svg>
            Refresh
          </button>
        </div>
      </div>

      <div className="k-actfeed">
        {filtered.map((group, gi) => (
          <div key={gi} className="k-actgroup">
            <div className="k-actgroup__head">
              <span className="k-actgroup__day">{group.day}</span>
              {group.sans && <span className="k-actgroup__sans">{group.sans}</span>}
              <span className="k-actgroup__rule" />
              <span className="k-actgroup__count">{group.items.length}</span>
            </div>
            <div className="k-actgroup__items">
              {group.items.map((it, i) => {
                const u = userOf(it.who);
                return (
                  <div key={i} className="k-actitem">
                    <span className="k-actitem__time">{it.when}</span>
                    <span className="k-actitem__dot" />
                    <Avatar uid={it.who} size={26} />
                    <div className="k-actitem__body">
                      <div className="k-actitem__line">
                        <b>{u.name}</b>
                        <span className={'k-actitem__verb k-actitem__verb--' + it.verb}>{it.verb}</span>
                        <span className="k-actitem__subj">{it.subj}</span>
                        {it.to && <span className="k-mute">{it.to}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Automations screen ─────────────────────────────────────────────────────

function ScreenAutomations() {
  const [showNew, setShowNew] = React.useState(false);

  return (
    <div className="k-screen">
      <PageHeader
        kicker="Operations"
        title="Automations"
        sansTitle="स्वचालन"
        lede='"When this happens, then do that." Rules run on every event in your workspace.'
        right={!showNew && (
          <button className="k-btn k-btn--primary" onClick={() => setShowNew(true)}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10"/></svg>
            New rule
          </button>
        )}
      />

      {showNew && (
        <div className="k-rule k-rule--new">
          <div className="k-rule__head">
            <h3>New automation</h3>
            <span className="k-rule__sans">नवीन नियम</span>
            <button className="k-iconbtn" onClick={() => setShowNew(false)}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3l10 10M13 3L3 13"/></svg>
            </button>
          </div>
          <div className="k-rule__grid">
            <div className="k-rule__field">
              <div className="k-rule__lbl">Name</div>
              <input className="k-input" placeholder="e.g. Notify on done" />
            </div>
            <div className="k-rule__field">
              <div className="k-rule__lbl">When · प्रसंग</div>
              <select className="k-input">
                <option>Status changes to…</option>
                <option>Task is created in…</option>
                <option>Due date arrives</option>
                <option>Task is overdue by N days</option>
                <option>Comment added with @mention</option>
              </select>
            </div>
            <div className="k-rule__field">
              <div className="k-rule__lbl">Then · क्रिया</div>
              <select className="k-input">
                <option>Send in-app notification</option>
                <option>Assign to…</option>
                <option>Change priority to…</option>
                <option>Add to watchers</option>
                <option>Move to column</option>
              </select>
            </div>
          </div>
          <div className="k-rule__conditions">
            <div className="k-rule__cond-head">
              <span>Conditions (AND)</span>
              <button className="k-btn k-btn--ghost k-btn--sm">+ Add condition</button>
            </div>
            <div className="k-rule__cond-empty">No conditions — rule fires on every trigger event.</div>
          </div>
          <div className="k-rule__foot">
            <button className="k-btn k-btn--primary">Create rule</button>
            <button className="k-btn k-btn--ghost" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="k-rules">
        {AUTOMATIONS.map(r => (
          <div key={r.id} className={'k-rule' + (!r.active ? ' is-paused' : '')}>
            <div className="k-rule__head">
              <span className="k-rule__id">{r.id}</span>
              <h3>{r.name}</h3>
              <span className={'k-rule__status k-rule__status--' + (r.active ? 'on' : 'off')}>
                <span className="k-rule__status-dot" />
                {r.active ? 'Active' : 'Paused'}
              </span>
              <span className="k-mute">{r.runs} runs · owned by {userOf(r.owner).name.split(' ')[0]}</span>
            </div>
            <div className="k-rule__flow">
              <div className="k-rule__step k-rule__step--when">
                <div className="k-rule__step-lbl">When · प्रसंग</div>
                <div className="k-rule__step-body">{r.when}</div>
                <div className="k-rule__step-sans">{r.when_sans}</div>
              </div>
              <div className="k-rule__arrow">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 10h16M14 5l5 5-5 5"/></svg>
              </div>
              <div className="k-rule__step k-rule__step--cond">
                <div className="k-rule__step-lbl">If · यदि</div>
                <div className="k-rule__step-body">{r.cond}</div>
              </div>
              <div className="k-rule__arrow">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 10h16M14 5l5 5-5 5"/></svg>
              </div>
              <div className="k-rule__step k-rule__step--then">
                <div className="k-rule__step-lbl">Then · क्रिया</div>
                <div className="k-rule__step-body">{r.then}</div>
              </div>
            </div>
            <div className="k-rule__foot">
              <button className="k-btn k-btn--ghost k-btn--sm">Edit</button>
              <button className="k-btn k-btn--ghost k-btn--sm">View runs</button>
              <button className="k-btn k-btn--ghost k-btn--sm">{r.active ? 'Pause' : 'Resume'}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Time Report screen ─────────────────────────────────────────────────────

function ScreenTimeReport() {
  const [from, setFrom] = React.useState('2026-05-08');
  const [to, setTo]     = React.useState('2026-05-14');
  const [member, setMember] = React.useState('all');

  const entries = TIME_ENTRIES.filter(e =>
    e.date >= from && e.date <= to && (member === 'all' || e.who === member)
  );
  const total = entries.reduce((s, e) => s + e.hours, 0);

  // by day for bar chart
  const days = [];
  for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate()+1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    days.push({ iso, label: d.getDate(), hours: entries.filter(e => e.date === iso).reduce((s,e)=>s+e.hours,0) });
  }
  const maxH = Math.max(8, ...days.map(d => d.hours));

  // by member
  const byMember = TEAM.filter(u => u.role !== 'client').map(u => ({
    user: u, hours: entries.filter(e => e.who === u.id).reduce((s,e)=>s+e.hours,0)
  })).filter(r => r.hours > 0);

  return (
    <div className="k-screen">
      <PageHeader
        kicker="Operations"
        title="Time Report"
        sansTitle="काल"
        lede="Hours logged across tasks and members. Filter to investigate."
        right={
          <div className="k-total">
            <div className="k-total__num">{total.toFixed(1)}<span>h</span></div>
            <div className="k-total__lbl">total · कुल</div>
          </div>
        }
      />

      <div className="k-tfilters">
        <div className="k-tfilters__field">
          <label className="k-fld__lbl">From · आरम्भ</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="k-input" />
        </div>
        <div className="k-tfilters__field">
          <label className="k-fld__lbl">To · अन्त</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="k-input" />
        </div>
        <div className="k-tfilters__field">
          <label className="k-fld__lbl">Member · सहयोगी</label>
          <select value={member} onChange={(e) => setMember(e.target.value)} className="k-input">
            <option value="all">All members</option>
            {TEAM.filter(u => u.role !== 'client').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <button className="k-btn k-btn--ghost" onClick={() => { setFrom('2026-05-08'); setTo('2026-05-14'); setMember('all'); }}>Reset</button>
        <button className="k-btn k-btn--ghost">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 2v8m-3-3l3 3 3-3M2.5 13h11"/></svg>
          CSV
        </button>
      </div>

      <div className="k-twocol">
        <div className="k-col k-col--main">
          <Card title="Daily distribution" sansTitle="दैनिक भार">
            <div className="k-tbars">
              {days.map(d => (
                <div key={d.iso} className="k-tbar">
                  <div className="k-tbar__col">
                    <div className="k-tbar__fill" style={{ height: (d.hours / maxH * 100) + '%' }} />
                  </div>
                  <div className="k-tbar__num">{d.hours > 0 ? d.hours.toFixed(1) : '—'}</div>
                  <div className="k-tbar__lbl">{d.label}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Entries" sansTitle="विवरण">
            <div className="k-tlog">
              <div className="k-tlog__head">
                <div>Date</div><div>Member</div><div>Task</div><div>Note</div><div>Hours</div>
              </div>
              {entries.map((e, i) => (
                <div key={i} className="k-tlog__row">
                  <div className="k-mono">{new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                  <div className="k-tlog__who"><Avatar uid={e.who} size={20} /> {userOf(e.who).name.split(' ')[0]}</div>
                  <div className="k-mono">{e.task}</div>
                  <div className="k-tlog__note">{e.note}</div>
                  <div className="k-mono k-tlog__h">{e.hours.toFixed(1)}h</div>
                </div>
              ))}
              {entries.length === 0 && <div className="k-tlog__empty">No time entries for this period.</div>}
            </div>
          </Card>
        </div>

        <div className="k-col k-col--side">
          <Card title="By member" sansTitle="सहयोगी-वार">
            <div className="k-tload">
              {byMember.map(r => (
                <div key={r.user.id} className="k-tload__row">
                  <Avatar uid={r.user.id} size={22} />
                  <div className="k-tload__name">{r.user.name.split(' ')[0]}</div>
                  <div className="k-tload__bar"><i style={{ width: Math.min(r.hours / Math.max(...byMember.map(x => x.hours)) * 100, 100) + '%' }} /></div>
                  <div className="k-tload__h k-mono">{r.hours.toFixed(1)}h</div>
                </div>
              ))}
            </div>
          </Card>

          <div className="k-citation">
            <div className="k-citation__sans">कालः सृजति भूतानि</div>
            <div className="k-citation__src">— "Time creates all things." Account for it carefully.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Templates screen ───────────────────────────────────────────────────────

function ScreenTemplates() {
  const [tab, setTab] = React.useState('project');
  const [showSave, setShowSave] = React.useState(false);

  return (
    <div className="k-screen">
      <PageHeader
        kicker="Operations"
        title="Templates"
        sansTitle="साँचा"
        lede="Bootstrap a new project or task from something that worked before."
      />

      <div className="k-tabs">
        <button className={'k-tab' + (tab === 'project' ? ' is-active' : '')} onClick={() => setTab('project')}>
          <span>Project templates</span>
          <span className="k-tab__sans">परियोजना</span>
          <span className="k-tab__count">{TEMPLATES_PROJECT.length}</span>
        </button>
        <button className={'k-tab' + (tab === 'task' ? ' is-active' : '')} onClick={() => setTab('task')}>
          <span>Task templates</span>
          <span className="k-tab__sans">कार्य</span>
          <span className="k-tab__count">{TEMPLATES_TASK.length}</span>
        </button>
      </div>

      {tab === 'project' && (
        <>
          <div className="k-tmplgrid">
            {TEMPLATES_PROJECT.map(t => (
              <div key={t.id} className="k-tmpl">
                <div className="k-tmpl__corner">{t.sans}</div>
                <div className="k-tmpl__name">{t.name}</div>
                <div className="k-tmpl__sub">{t.sub}</div>
                <div className="k-tmpl__stats">
                  <div><b>{t.columns}</b><span>columns</span></div>
                  <div><b>{t.fields}</b><span>fields</span></div>
                  <div><b>{t.useCount}</b><span>used</span></div>
                </div>
                <div className="k-tmpl__actions">
                  <button className="k-btn k-btn--primary k-btn--sm">Use template</button>
                  <button className="k-btn k-btn--ghost k-btn--sm">Preview</button>
                </div>
              </div>
            ))}
            <button className="k-tmpl k-tmpl--add" onClick={() => setShowSave(true)}>
              <div className="k-tmpl__add-icon">+</div>
              <div className="k-tmpl__add-title">Save current project as template</div>
              <div className="k-tmpl__add-sub">Captures columns and custom fields. Tasks are not copied.</div>
            </button>
          </div>

          {showSave && (
            <Card title="Save as template" sansTitle="संरक्षित">
              <div className="k-savetmpl">
                <div className="k-savetmpl__field">
                  <label className="k-fld__lbl">Source project</label>
                  <select className="k-input">
                    <option>Choose project…</option>
                    {PROJECTS.map(p => <option key={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="k-savetmpl__field">
                  <label className="k-fld__lbl">Template name</label>
                  <input className="k-input" placeholder="e.g. Quarterly client review" />
                </div>
                <div className="k-savetmpl__field k-savetmpl__field--full">
                  <label className="k-fld__lbl">Description (optional)</label>
                  <input className="k-input" placeholder="What is this template for?" />
                </div>
                <div className="k-savetmpl__actions">
                  <button className="k-btn k-btn--primary">Save template</button>
                  <button className="k-btn k-btn--ghost" onClick={() => setShowSave(false)}>Cancel</button>
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {tab === 'task' && (
        <div className="k-tmplgrid k-tmplgrid--task">
          {TEMPLATES_TASK.map(t => (
            <div key={t.id} className="k-tmpl k-tmpl--task">
              <div className="k-tmpl__corner">{t.sans}</div>
              <div className="k-tmpl__name">{t.name}</div>
              <div className="k-tmpl__sub">{t.sub}</div>
              <div className="k-tmpl__actions">
                <button className="k-btn k-btn--primary k-btn--sm">Use</button>
                <button className="k-btn k-btn--ghost k-btn--sm">Edit</button>
              </div>
            </div>
          ))}
          <button className="k-tmpl k-tmpl--add">
            <div className="k-tmpl__add-icon">+</div>
            <div className="k-tmpl__add-title">New task template</div>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Categories screen ──────────────────────────────────────────────────────

function ScreenCategories() {
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('#0082c6');

  return (
    <div className="k-screen">
      <PageHeader
        kicker="Settings"
        title="Categories"
        sansTitle="वर्ग"
        lede="Tags you can drop on any task. Used in filters, reports, and automations."
      />

      <Card title="New category" sansTitle="नई श्रेणी">
        <div className="k-newcat">
          <div className="k-newcat__sw">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
          <input className="k-input k-newcat__name" placeholder="Category name…" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="k-input k-newcat__sans" placeholder="संस्कृत (optional)" />
          <button className="k-btn k-btn--primary">Add</button>
        </div>
      </Card>

      <div className="k-catgrid">
        {CATEGORIES.map(c => (
          <div key={c.id} className="k-cat">
            <span className="k-cat__chip" style={{ background: c.color }} />
            <div className="k-cat__name">{c.name}</div>
            <div className="k-cat__sans">{c.sans}</div>
            <div className="k-cat__count k-mono">{c.count}</div>
            <div className="k-cat__actions">
              <button className="k-iconbtn" title="Edit">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 12l2-1L12 3l1 1-8 8-1 2 2-1z"/></svg>
              </button>
              <button className="k-iconbtn" title="Delete">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M4.5 4l.5 9a1 1 0 001 1h4a1 1 0 001-1l.5-9"/></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Admin screen ───────────────────────────────────────────────────────────

function ScreenAdmin() {
  return (
    <div className="k-screen">
      <PageHeader
        kicker="Settings · Admin only"
        title="Admin"
        sansTitle="प्रशासन"
        lede="Workspace settings, members, billing, and integrations."
      />

      <div className="k-twocol">
        <div className="k-col k-col--main">
          <Card title="Workspace" sansTitle="कार्यक्षेत्र">
            <div className="k-adm">
              <div className="k-adm__row">
                <div className="k-adm__lbl">Name</div>
                <input className="k-input" defaultValue="Aekam Inc" />
              </div>
              <div className="k-adm__row">
                <div className="k-adm__lbl">Domain</div>
                <input className="k-input" defaultValue="aekaminc.com" />
              </div>
              <div className="k-adm__row">
                <div className="k-adm__lbl">Locale</div>
                <select className="k-input">
                  <option>English (India) — en-IN</option>
                  <option>हिन्दी — hi-IN</option>
                  <option>English (US) — en-US</option>
                </select>
              </div>
              <div className="k-adm__row">
                <div className="k-adm__lbl">Timezone</div>
                <select className="k-input">
                  <option>Asia/Kolkata · IST (UTC+5:30)</option>
                  <option>Asia/Dubai · GST (UTC+4)</option>
                  <option>America/New_York · EST</option>
                </select>
              </div>
            </div>
          </Card>

          <Card title="Members" sansTitle="सदस्य" action={<button className="k-btn k-btn--primary k-btn--sm">+ Invite</button>}>
            <div className="k-memlist">
              {TEAM.map(u => (
                <div key={u.id} className="k-memlist__row">
                  <Avatar uid={u.id} size={28} />
                  <div className="k-memlist__name">
                    <div>{u.name}</div>
                    <div className="k-memlist__email">{u.name.toLowerCase().replace(' ', '.')}@aekaminc.com</div>
                  </div>
                  <span className={'k-rolebadge k-rolebadge--' + u.role}>{u.role}</span>
                  <select className="k-input k-memlist__sel" defaultValue={u.role}>
                    <option>admin</option>
                    <option>member</option>
                    <option>client</option>
                  </select>
                  <button className="k-iconbtn" title="Remove">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M4.5 4l.5 9a1 1 0 001 1h4a1 1 0 001-1l.5-9"/></svg>
                  </button>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="k-col k-col--side">
          <Card title="Plan" sansTitle="योजना">
            <div className="k-plan">
              <div className="k-plan__name">Business</div>
              <div className="k-plan__price">₹ 4,800<span>/ month</span></div>
              <div className="k-plan__detail">7 of 25 seats used · billed annually</div>
              <div className="k-plan__bar"><i style={{ width: '28%' }} /></div>
              <button className="k-btn k-btn--ghost k-btn--sm" style={{ marginTop: 12 }}>Manage billing</button>
            </div>
          </Card>

          <Card title="Integrations" sansTitle="जोड़">
            <div className="k-integ">
              {[
                { name: 'AWS SES',          on: true,  sub: 'Email delivery' },
                { name: 'Cloudflare R2',    on: true,  sub: 'File storage' },
                { name: 'Razorpay',         on: false, sub: 'Client invoices' },
                { name: 'Zoho Books',       on: false, sub: 'Accounting sync' },
                { name: 'Slack',            on: true,  sub: 'Notifications' },
              ].map(i => (
                <div key={i.name} className="k-integ__row">
                  <div>
                    <div className="k-integ__name">{i.name}</div>
                    <div className="k-integ__sub">{i.sub}</div>
                  </div>
                  <span className={'k-integ__dot k-integ__dot--' + (i.on ? 'on' : 'off')} />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Danger zone" sansTitle="सावधान">
            <div className="k-danger">
              <div className="k-danger__row">
                <div>
                  <div className="k-danger__title">Transfer workspace</div>
                  <div className="k-danger__sub">Move ownership to another admin.</div>
                </div>
                <button className="k-btn k-btn--ghost k-btn--sm">Transfer</button>
              </div>
              <div className="k-danger__row">
                <div>
                  <div className="k-danger__title">Delete workspace</div>
                  <div className="k-danger__sub">Cannot be undone. All data is purged.</div>
                </div>
                <button className="k-btn k-btn--reject k-btn--sm">Delete</button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  ScreenApprovals, ScreenActivity, ScreenAutomations, ScreenTimeReport,
  ScreenTemplates, ScreenCategories, ScreenAdmin,
});
