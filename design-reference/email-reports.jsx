// Kartavya — automated report emails.
// Three transactional templates sent to admins + team owners on a cron:
//   • Daily   — every weekday morning
//   • Weekly  — Monday morning
//   • Monthly — first of the month
//
// Each report:
//   • per-project breakdown (completed today, due, awaiting approval, overdue)
//   • a "Champion" call-out (top contributor by completed weighted tasks)
//   • an Excel attachment row — generated server-side, uploaded to R2,
//     attached to the SES/Resend send, and also kept as a 30-day download link.

// ─── shared report bits ────────────────────────────────────────────
function Stat({ k, v, hint, tone }) {
  return (
    <div className={`rp__stat rp__stat--${tone || 'neutral'}`}>
      <div className="rp__stat-k">{k}</div>
      <div className="rp__stat-v">{v}</div>
      {hint && <div className="rp__stat-hint">{hint}</div>}
    </div>
  );
}

function ProjectRow({ name, hi, dot, done, due, await_, over }) {
  return (
    <tr>
      <td>
        <div className="rp__proj">
          <i style={{ background: dot }} />
          <div>
            <div className="rp__proj-name">{name}</div>
            <div className="rp__proj-hi">{hi}</div>
          </div>
        </div>
      </td>
      <td className="rp__td-num">{done}</td>
      <td className="rp__td-num">{due}</td>
      <td className="rp__td-num">{await_}</td>
      <td className={`rp__td-num ${over > 0 ? 'rp__td-num--bad' : ''}`}>{over}</td>
    </tr>
  );
}

function ProjectsTable({ rows }) {
  return (
    <table className="rp__table">
      <thead>
        <tr>
          <th>Project</th>
          <th>Done</th>
          <th>Due</th>
          <th>Approve</th>
          <th>Overdue</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => <ProjectRow key={i} {...r} />)}
      </tbody>
    </table>
  );
}

function Champion({ name, color, role, line1, line2, label, labelHi }) {
  const init = name.split(' ').map(s => s[0]).slice(0, 2).join('');
  return (
    <div className="rp__champ">
      <div className="rp__champ-label">
        {label}<span className="rp__champ-label-hi">{labelHi}</span>
      </div>
      <div className="rp__champ-row">
        <div className="rp__champ-av" style={{ background: color }}>{init}</div>
        <div>
          <div className="rp__champ-name">{name}</div>
          <div className="rp__champ-role">{role}</div>
        </div>
        <div className="rp__champ-stats">
          <div>{line1}</div>
          <div className="rp__champ-stats-2">{line2}</div>
        </div>
      </div>
    </div>
  );
}

function Attach({ file, size, hint }) {
  return (
    <div className="rp__attach">
      <div className="rp__attach-icon">
        <span>XLS</span>
      </div>
      <div className="rp__attach-meta">
        <div className="rp__attach-name">{file}</div>
        <div className="rp__attach-hint">{hint || 'Attached to this email · also downloadable for 30 days'}</div>
      </div>
      <div className="rp__attach-size">{size}</div>
    </div>
  );
}

function MetaLine() {
  return (
    <p className="em__small rp__meta-line">
      You're getting this because you're an <b>admin</b> or <b>team owner</b> on
      Aekam Workspace. <a href="#">Change report cadence</a> · <a href="#">Pause reports</a>
    </p>
  );
}

// ─── 1. DAILY REPORT ──────────────────────────────────────────────
function EmailDailyReport() {
  const rows = [
    { name: 'Mumbai client review',     hi: 'मुंबई समीक्षा',         dot: '#ec4899', done: 4, due: 2, await_: 1, over: 0 },
    { name: 'Saraswati Co. onboarding', hi: 'सरस्वती ऑनबोर्डिंग',   dot: '#6366f1', done: 2, due: 3, await_: 0, over: 1 },
    { name: 'Internal — GST automation', hi: 'जीएसटी स्वचालन',       dot: '#0A7A6E', done: 3, due: 1, await_: 2, over: 0 },
    { name: 'Q1 audit prep',            hi: 'त्रैमासिक लेखापरीक्षा', dot: '#B06A00', done: 1, due: 4, await_: 1, over: 2 },
  ];
  return (
    <EmailShell
      kicker="DAILY REPORT · MON 18 MAY"
      h1="Yesterday's pulse for Aekam."
      hi="दैनिक प्रतिवेदन"
    >
      <p className="em__lede">
        Hi Keval — here's the rollup across <b>4 active projects</b> and
        <b> 11 teammates</b> for the last 24 hours. The Excel below has
        per-task detail.
      </p>

      <div className="rp__stats">
        <Stat k="Completed" v="10" hint="↑ 2 vs Fri" tone="ok" />
        <Stat k="Due today" v="10" hint="across 4 projects" />
        <Stat k="Awaiting approval" v="4" hint="oldest: 2d" tone="warn" />
        <Stat k="Overdue" v="3" hint="needs nudges" tone="bad" />
      </div>

      <div className="rp__section-h">
        Per-project breakdown
        <span className="rp__section-h-hi">परियोजनावार</span>
      </div>
      <ProjectsTable rows={rows} />

      <Champion
        label="CHAMPION OF THE DAY"
        labelHi="दिन का नायक"
        name="Vikram Joshi"
        color="#0A7A6E"
        role="Engineering · Mumbai client review"
        line1="4 tasks closed"
        line2="3h 40m focused"
      />

      <Attach
        file="aekam_daily_2026-05-18.xlsx"
        size="42 KB"
        hint="Sheet 1: tasks · Sheet 2: per-person · Sheet 3: per-project"
      />

      <div className="em__cta-row">
        <a className="em__btn em__btn--primary" href="#">Open today's dashboard</a>
        <a className="em__btn em__btn--ghost" href="#">Download Excel</a>
      </div>

      <MetaLine />
    </EmailShell>
  );
}

// ─── 2. WEEKLY REPORT ─────────────────────────────────────────────
function EmailWeeklyReport() {
  const rows = [
    { name: 'Mumbai client review',      hi: 'मुंबई समीक्षा',         dot: '#ec4899', done: 18, due: 9,  await_: 2, over: 1 },
    { name: 'Saraswati Co. onboarding',  hi: 'सरस्वती ऑनबोर्डिंग',   dot: '#6366f1', done: 11, due: 14, await_: 1, over: 3 },
    { name: 'Internal — GST automation', hi: 'जीएसटी स्वचालन',       dot: '#0A7A6E', done: 14, due: 6,  await_: 4, over: 0 },
    { name: 'Q1 audit prep',             hi: 'त्रैमासिक लेखापरीक्षा', dot: '#B06A00', done: 7,  due: 12, await_: 2, over: 4 },
  ];
  return (
    <EmailShell
      kicker="WEEKLY REPORT · WK 20 (11–17 MAY)"
      h1="This week, Aekam closed 50 tasks."
      hi="साप्ताहिक प्रतिवेदन"
    >
      <p className="em__lede">
        Net throughput is up <b>14% week-on-week</b>. Two projects are
        running hot — Mumbai review and GST automation — and the audit-prep
        queue is the one to <em>watch</em> next week.
      </p>

      <div className="rp__stats">
        <Stat k="Completed (wk)"   v="50" hint="↑ 14% vs WK 19" tone="ok" />
        <Stat k="Due this week"    v="41" hint="closes Sun" />
        <Stat k="Awaiting approval" v="9" hint="oldest: 5d" tone="warn" />
        <Stat k="Overdue"          v="8"  hint="↓ 2 vs WK 19" tone="bad" />
      </div>

      <div className="rp__section-h">
        Per-project breakdown
        <span className="rp__section-h-hi">परियोजनावार</span>
      </div>
      <ProjectsTable rows={rows} />

      <div className="rp__section-h">
        Throughput trend
        <span className="rp__section-h-hi">गति</span>
      </div>
      <div className="rp__spark">
        {[6, 9, 7, 11, 8, 5, 4].map((n, i) => (
          <div key={i} className="rp__spark-col">
            <div className="rp__spark-bar" style={{ height: (n * 9) + 'px' }} />
            <div className="rp__spark-lbl">{['M','T','W','T','F','S','S'][i]}</div>
            <div className="rp__spark-num">{n}</div>
          </div>
        ))}
      </div>

      <Champion
        label="CHAMPION OF THE WEEK"
        labelHi="सप्ताह का नायक"
        name="Priya Iyer"
        color="#0082c6"
        role="Compliance · GST automation"
        line1="12 tasks closed"
        line2="2 approvals on time"
      />

      <p className="em__small" style={{ marginTop: -4 }}>
        Runners-up: Vikram Joshi (10) · Aanya Mehta (8) · Rohit Kapoor (7).
      </p>

      <Attach
        file="aekam_weekly_wk20_2026.xlsx"
        size="128 KB"
        hint="Sheets: tasks · per-person · per-project · approvals · overdue ageing"
      />

      <div className="em__cta-row">
        <a className="em__btn em__btn--primary" href="#">Open this week</a>
        <a className="em__btn em__btn--ghost" href="#">Download Excel</a>
      </div>

      <MetaLine />
    </EmailShell>
  );
}

// ─── 3. MONTHLY REPORT ────────────────────────────────────────────
function EmailMonthlyReport() {
  const rows = [
    { name: 'Mumbai client review',      hi: 'मुंबई समीक्षा',         dot: '#ec4899', done: 74, due: 12, await_: 3, over: 2 },
    { name: 'Saraswati Co. onboarding',  hi: 'सरस्वती ऑनबोर्डिंग',   dot: '#6366f1', done: 51, due: 18, await_: 2, over: 4 },
    { name: 'Internal — GST automation', hi: 'जीएसटी स्वचालन',       dot: '#0A7A6E', done: 62, due: 9,  await_: 5, over: 0 },
    { name: 'Q1 audit prep',             hi: 'त्रैमासिक लेखापरीक्षा', dot: '#B06A00', done: 32, due: 22, await_: 4, over: 6 },
  ];
  return (
    <EmailShell
      kicker="MONTHLY REPORT · APRIL 2026"
      h1="219 tasks shipped in April."
      hi="मासिक प्रतिवेदन"
    >
      <p className="em__lede">
        April was Aekam's strongest month so far this FY. <b>Throughput up
        22%</b> vs March, overdue down to <b>3.6%</b> of the active pile.
        Full per-task detail is in the attached Excel.
      </p>

      <div className="rp__stats">
        <Stat k="Completed (mo)"   v="219" hint="↑ 22% vs Mar" tone="ok" />
        <Stat k="Avg cycle time"   v="2.4d" hint="↓ 0.6d vs Mar" tone="ok" />
        <Stat k="Approvals" v="38" hint="median: 4h" />
        <Stat k="Overdue rate"     v="3.6%" hint="↓ from 5.8%" tone="warn" />
      </div>

      <div className="rp__section-h">
        Per-project breakdown
        <span className="rp__section-h-hi">परियोजनावार</span>
      </div>
      <ProjectsTable rows={rows} />

      <div className="rp__section-h">
        Weekly completion — April
        <span className="rp__section-h-hi">साप्ताहिक</span>
      </div>
      <div className="rp__spark">
        {[44, 58, 49, 68].map((n, i) => (
          <div key={i} className="rp__spark-col rp__spark-col--wide">
            <div className="rp__spark-bar" style={{ height: (n * 1.5) + 'px' }} />
            <div className="rp__spark-lbl">WK {14 + i}</div>
            <div className="rp__spark-num">{n}</div>
          </div>
        ))}
      </div>

      <Champion
        label="CHAMPION OF THE MONTH"
        labelHi="माह का नायक"
        name="Vikram Joshi"
        color="#0A7A6E"
        role="Engineering · across 3 projects"
        line1="41 tasks closed"
        line2="0 missed deadlines"
      />

      <div className="rp__board">
        <div className="rp__board-h">Leaderboard · April</div>
        {[
          ['Vikram Joshi',   41, '#0A7A6E'],
          ['Priya Iyer',     34, '#0082c6'],
          ['Aanya Mehta',    29, '#6366f1'],
          ['Rohit Kapoor',   24, '#ec4899'],
          ['Sneha Bansal',   19, '#B06A00'],
        ].map(([n, c, color], i) => (
          <div key={i} className="rp__board-row">
            <span className="rp__board-rank">{i + 1}</span>
            <span className="rp__board-name">{n}</span>
            <div className="rp__board-bar"><div style={{ width: ((c / 41) * 100) + '%', background: color }} /></div>
            <span className="rp__board-n">{c}</span>
          </div>
        ))}
      </div>

      <Attach
        file="aekam_monthly_2026-04.xlsx"
        size="412 KB"
        hint="9 sheets · tasks, per-person, per-project, approvals, overdue, time, cycle, churn, GST"
      />

      <div className="em__cta-row">
        <a className="em__btn em__btn--primary" href="#">Open Aekam dashboard</a>
        <a className="em__btn em__btn--ghost" href="#">Download Excel</a>
      </div>

      <div className="em__cite" style={{ marginTop: 8 }}>
        कर्म एव अधिकारस्ते — Bhagavad Gita 2.47
        <span className="em__cite-src">
          April's discipline shows up in the numbers. Onward to May.
        </span>
      </div>

      <MetaLine />
    </EmailShell>
  );
}

Object.assign(window, {
  EmailDailyReport, EmailWeeklyReport, EmailMonthlyReport,
});
