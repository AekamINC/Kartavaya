// Kartavya — generated PDF report layout.
// Five letter-sized pages (816 × 1056) that match what the Generate Report
// screen produces when exported as PDF.

function PdfShell({ pageN, pageOf, children, title }) {
  return (
    <div className="pdf">
      <div className="pdf__head">
        <div className="pdf__brand">
          <span className="pdf__brand-main">Kartavya</span>
          <span className="pdf__brand-hi">कर्तव्य</span>
          <span className="pdf__brand-by">by Aekam Inc</span>
        </div>
        <div className="pdf__head-meta">
          <span>Weekly report · WK 20 (11–17 May 2026)</span>
          <span>{title}</span>
        </div>
      </div>
      <div className="pdf__body">{children}</div>
      <div className="pdf__foot">
        <span>Generated 18 May 2026 · 11:42 IST · by Keval Shah · Aekam Workspace</span>
        <span>Page {pageN} / {pageOf}</span>
      </div>
    </div>
  );
}

// ── Page 1 — Cover ─────────────────────────────────────────────────
function PdfCover() {
  return (
    <PdfShell pageN={1} pageOf={5} title="Cover">
      <div className="pdf__cover">
        <div className="pdf__cover-kicker">WEEKLY REPORT · WK 20</div>
        <h1 className="pdf__cover-h1">
          The week Aekam<br/>
          closed <em>50 tasks</em>.
        </h1>
        <div className="pdf__cover-hi">साप्ताहिक प्रतिवेदन</div>

        <div className="pdf__cover-meta">
          <div>
            <div className="pdf__meta-k">Workspace</div>
            <div className="pdf__meta-v">Aekam Inc</div>
          </div>
          <div>
            <div className="pdf__meta-k">Period</div>
            <div className="pdf__meta-v">11–17 May 2026</div>
          </div>
          <div>
            <div className="pdf__meta-k">Scope</div>
            <div className="pdf__meta-v">4 projects · 6 members</div>
          </div>
          <div>
            <div className="pdf__meta-k">Prepared for</div>
            <div className="pdf__meta-v">Admins & team owners</div>
          </div>
        </div>

        <div className="pdf__kpis">
          <div className="pdf__kpi pdf__kpi--ok">
            <div className="pdf__kpi-k">Completed</div>
            <div className="pdf__kpi-v">50</div>
            <div className="pdf__kpi-hint">↑ 14% vs WK 19</div>
          </div>
          <div className="pdf__kpi">
            <div className="pdf__kpi-k">Due this week</div>
            <div className="pdf__kpi-v">41</div>
            <div className="pdf__kpi-hint">closes Sun 24 May</div>
          </div>
          <div className="pdf__kpi pdf__kpi--warn">
            <div className="pdf__kpi-k">Awaiting approval</div>
            <div className="pdf__kpi-v">9</div>
            <div className="pdf__kpi-hint">oldest: 5d</div>
          </div>
          <div className="pdf__kpi pdf__kpi--bad">
            <div className="pdf__kpi-k">Overdue</div>
            <div className="pdf__kpi-v">8</div>
            <div className="pdf__kpi-hint">↓ 2 vs WK 19</div>
          </div>
        </div>

        <div className="pdf__exec">
          <div className="pdf__exec-h">Executive summary <span>सारांश</span></div>
          <p>
            <b>Net throughput is up 14% week-on-week</b>, with the
            <em> Mumbai client review </em>and<em> internal GST automation </em>
            tracks doing the heavy lifting. The audit-prep queue is the one
            to watch next week — overdue count rose from 2 to 4, all on a
            single workstream.
          </p>
          <p>
            <b>Approvals are healthy</b> at a 4-hour median turnaround.
            Vikram Joshi closed the most tasks (10), and Priya Iyer earns
            <em> Champion of the Week </em>for shipping 12 tasks while
            also clearing two long-pending approvals.
          </p>
        </div>

        <div className="pdf__cover-cite">
          कर्तव्ये अधिकारस्ते मा फलेषु कदाचन। — <em>Bhagavad Gita 2.47</em>
        </div>
      </div>
    </PdfShell>
  );
}

// ── Page 2 — Per-project breakdown ─────────────────────────────────
function PdfProjects() {
  const rows = [
    { name: 'Mumbai client review',      hi: 'मुंबई समीक्षा',         dot: '#ec4899', open: 18, done: 18, due: 9,  await_: 2, over: 1, pct: 88 },
    { name: 'Saraswati Co. onboarding',  hi: 'सरस्वती ऑनबोर्डिंग',   dot: '#6366f1', open: 24, done: 11, due: 14, await_: 1, over: 3, pct: 34 },
    { name: 'Internal — GST automation', hi: 'जीएसटी स्वचालन',       dot: '#0A7A6E', open: 21, done: 14, await_: 4, due: 6,  over: 0, pct: 62 },
    { name: 'Q1 audit prep',             hi: 'त्रैमासिक लेखापरीक्षा', dot: '#B06A00', open: 28, done: 7,  due: 12, await_: 2, over: 4, pct: 21 },
  ];
  return (
    <PdfShell pageN={2} pageOf={5} title="Per-project breakdown">
      <div className="pdf__sec-h">
        <div>
          <h2>Per-project breakdown</h2>
          <span className="pdf__sec-hi">परियोजनावार</span>
        </div>
        <p>One row per active project. Counts are computed over the report period (11–17 May 2026) against the live state at 11:42 IST today.</p>
      </div>

      <table className="pdf__table">
        <thead>
          <tr>
            <th>Project</th>
            <th className="num">Completed</th>
            <th className="num">Due</th>
            <th className="num">Approve</th>
            <th className="num">Overdue</th>
            <th>Progress</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <div className="pdf__proj">
                  <i style={{ background: r.dot }} />
                  <div>
                    <div className="pdf__proj-name">{r.name}</div>
                    <div className="pdf__proj-hi">{r.hi}</div>
                  </div>
                </div>
              </td>
              <td className="num">{r.done}</td>
              <td className="num">{r.due}</td>
              <td className="num">{r.await_}</td>
              <td className={'num ' + (r.over > 0 ? 'bad' : '')}>{r.over}</td>
              <td className="pct">
                <div className="pdf__pbar"><div style={{ width: r.pct + '%', background: r.dot }} /></div>
                <span>{r.pct}%</span>
              </td>
            </tr>
          ))}
          <tr className="pdf__total">
            <td>Workspace total</td>
            <td className="num">50</td>
            <td className="num">41</td>
            <td className="num">9</td>
            <td className="num bad">8</td>
            <td className="pct"><div className="pdf__pbar"><div style={{ width: '52%', background: 'var(--ink)' }} /></div><span>52%</span></td>
          </tr>
        </tbody>
      </table>

      <div className="pdf__callouts">
        <div className="pdf__callout">
          <div className="pdf__callout-k">Most ground covered</div>
          <div className="pdf__callout-v">Mumbai client review</div>
          <p>18 tasks closed, only 1 overdue — on track to wrap by end of next week.</p>
        </div>
        <div className="pdf__callout pdf__callout--warn">
          <div className="pdf__callout-k">Needs attention</div>
          <div className="pdf__callout-v">Q1 audit prep</div>
          <p>Overdue count up to 4. Likely capacity issue — only 7 closed against 12 due this week.</p>
        </div>
      </div>
    </PdfShell>
  );
}

// ── Page 3 — Leaderboard + Champion ────────────────────────────────
function PdfTeam() {
  const board = [
    ['Priya Iyer',     12, '#0082c6', 'Compliance · GST automation'],
    ['Vikram Joshi',   10, '#f59e0b', 'Engineering · Mumbai review'],
    ['Aanya Mehta',     8, '#05b7aa', 'Compliance · Internal'],
    ['Rohit Kapoor',    7, '#8b5cf6', 'Design · Saraswati'],
    ['Devika Pillai',   6, '#10b981', 'Operations · Audit prep'],
    ['Keval Shah',      4, '#ec4899', 'Admin · cross-project'],
  ];
  const max = 12;
  return (
    <PdfShell pageN={3} pageOf={5} title="Team performance">
      <div className="pdf__champ">
        <div className="pdf__champ-l">CHAMPION OF THE WEEK <span>सप्ताह का नायक</span></div>
        <div className="pdf__champ-row">
          <div className="pdf__champ-av" style={{ background: '#0082c6' }}>PI</div>
          <div>
            <div className="pdf__champ-name">Priya Iyer</div>
            <div className="pdf__champ-role">Compliance · GST automation</div>
          </div>
          <div className="pdf__champ-stats">
            <div><b>12</b><span>tasks closed</span></div>
            <div><b>2</b><span>approvals</span></div>
            <div><b>18.5h</b><span>focus time</span></div>
          </div>
        </div>
        <p className="pdf__champ-note">
          Closed 12 tasks while also clearing two long-pending approvals on
          the Saraswati Co. workstream — both unblocking knock-on work for
          three other teammates.
        </p>
      </div>

      <div className="pdf__sec-h pdf__sec-h--tight">
        <div>
          <h2>Leaderboard</h2>
          <span className="pdf__sec-hi">वरीयता क्रम</span>
        </div>
        <p>Ranked by tasks completed in the period. Approval clearances and lead-time are tie-breakers.</p>
      </div>

      <div className="pdf__board">
        {board.map(([n, c, color, role], i) => (
          <div key={i} className="pdf__board-row">
            <span className="pdf__board-rank">{i + 1}</span>
            <span className="pdf__board-av" style={{ background: color }}>{n.split(' ').map(s => s[0]).join('')}</span>
            <div className="pdf__board-id">
              <div className="pdf__board-name">{n}</div>
              <div className="pdf__board-role">{role}</div>
            </div>
            <div className="pdf__board-bar"><div style={{ width: (c / max) * 100 + '%', background: color }} /></div>
            <span className="pdf__board-n">{c}</span>
          </div>
        ))}
      </div>

      <div className="pdf__split">
        <div className="pdf__split-card">
          <div className="pdf__split-h">Approvals cleared</div>
          <div className="pdf__split-n">38<small>this week</small></div>
          <p>Median turnaround <b>4h 12m</b>, down from 7h 30m last week. Tata Steel had two requests open the longest at 22h.</p>
        </div>
        <div className="pdf__split-card">
          <div className="pdf__split-h">Cycle time</div>
          <div className="pdf__split-n">2.4d<small>open → done</small></div>
          <p>Down 0.6d from WK 19. Best on Mumbai review (1.8d), worst on audit prep (4.7d, expected for prep work).</p>
        </div>
      </div>
    </PdfShell>
  );
}

// ── Page 4 — Detailed task list ────────────────────────────────────
function PdfTasks() {
  const tasks = [
    ['KAR-104', 'Compile Q1 GSTR-3B working notes',         'GST automation', 'High',   'KS, AM', '15 May', 'Done',    '6h'],
    ['KAR-108', 'Reconcile input tax credit — March',       'GST automation', 'Medium', 'AM',     '16 May', 'Done',    '4h'],
    ['KAR-112', 'CA Sharma — share draft for review',       'GST automation', 'High',   'KS',     '17 May', 'Done',    '1h'],
    ['KAR-095', 'File GSTR-1 for Saraswati Co.',            'GST automation', 'High',   'VJ',     '10 May', 'Done',    '3h'],
    ['KAR-201', 'Diwali landing — copy direction',          'Diwali campaign','Medium', 'PN',     '20 May', 'In progress', '2h / 8h'],
    ['KAR-202', 'Hindi/Marathi creative brief sign-off',    'Diwali campaign','High',   'PN, RI', '20 May', 'In review', '5h'],
    ['KAR-203', 'Vendor quote — Borivali print run',        'Diwali campaign','Low',    'RI',     '02 Jun', 'To do',     '— / 2h'],
    ['KAR-301', 'Electrical contractor — site visit',       'BLR fit-out',    'Urgent', 'VJ, DP', '14 May', 'In progress','7h'],
    ['KAR-308', 'BBMP permit — re-submission packet',       'BLR fit-out',    'High',   'VJ',     '19 May', 'In progress','6h'],
    ['KAR-310', 'Furniture order — IndiaMART final list',   'BLR fit-out',    'Medium', 'DP',     '22 May', 'In review',  '3h'],
    ['KAR-411', 'Vendor agreement template — legal review', 'Vendor v2',      'Medium', 'KS',     '28 May', 'To do',      '— / 4h'],
    ['KAR-502', 'Tata Steel — invoice formatting fix',      'Mumbai review',  'Urgent', 'KS, AR', '15 May', 'In review',  '2h'],
    ['KAR-503', 'Send revised SOW for May engagement',      'Mumbai review',  'High',   'VJ',     '12 May', 'Done',       '1h'],
  ];
  const STATUS_TONE = { Done: 'ok', 'In review': 'mid', 'In progress': 'blue', 'To do': 'mute' };
  return (
    <PdfShell pageN={4} pageOf={5} title="Detailed task list">
      <div className="pdf__sec-h">
        <div>
          <h2>Detailed task list</h2>
          <span className="pdf__sec-hi">कार्य सूची</span>
        </div>
        <p>Every task touched in the period (50 rows · this page shows the first 13). Full list is in the attached CSV / XLSX.</p>
      </div>

      <table className="pdf__tasks">
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Project</th>
            <th>Pri.</th>
            <th>Owner</th>
            <th>Due</th>
            <th>Status</th>
            <th className="num">Time</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t, i) => (
            <tr key={i}>
              <td className="mono">{t[0]}</td>
              <td className="ttl">{t[1]}</td>
              <td>{t[2]}</td>
              <td><span className={'pdf__pri pdf__pri--' + t[3].toLowerCase()}>{t[3]}</span></td>
              <td className="mono">{t[4]}</td>
              <td>{t[5]}</td>
              <td><span className={'pdf__st pdf__st--' + STATUS_TONE[t[6]]}>{t[6]}</span></td>
              <td className="num">{t[7]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pdf__legend">
        <span><i style={{ background:'#dc2626' }}/>Urgent</span>
        <span><i style={{ background:'#ef4444' }}/>High</span>
        <span><i style={{ background:'#f59e0b' }}/>Medium</span>
        <span><i style={{ background:'#10b981' }}/>Low</span>
        <span className="pdf__legend-sep">·</span>
        <span>Time column: <b>actual</b> or <b>actual / estimate</b></span>
      </div>
    </PdfShell>
  );
}

// ── Page 5 — Throughput + colophon ─────────────────────────────────
function PdfTrend() {
  const days = [
    ['Mon 11', 6,  2],
    ['Tue 12', 9,  3],
    ['Wed 13', 7,  1],
    ['Thu 14', 11, 4],
    ['Fri 15', 8,  2],
    ['Sat 16', 5,  0],
    ['Sun 17', 4,  1],
  ];
  return (
    <PdfShell pageN={5} pageOf={5} title="Throughput trend & methodology">
      <div className="pdf__sec-h">
        <div>
          <h2>Throughput trend</h2>
          <span className="pdf__sec-hi">गति</span>
        </div>
        <p>Tasks closed each day this week, stacked with approvals cleared.</p>
      </div>

      <div className="pdf__chart">
        {days.map(([lbl, n, a], i) => (
          <div key={i} className="pdf__chart-col">
            <div className="pdf__chart-stack">
              <div className="pdf__chart-approve" style={{ height: a * 12 + 'px' }} />
              <div className="pdf__chart-done" style={{ height: n * 12 + 'px' }} />
            </div>
            <div className="pdf__chart-lbl">{lbl}</div>
            <div className="pdf__chart-n">{n}<small>+{a}</small></div>
          </div>
        ))}
      </div>
      <div className="pdf__chart-key">
        <span><i className="k1"/>Tasks completed</span>
        <span><i className="k2"/>Approvals cleared</span>
      </div>

      <div className="pdf__sec-h pdf__sec-h--tight">
        <div>
          <h2>Methodology &amp; data</h2>
          <span className="pdf__sec-hi">विधि</span>
        </div>
      </div>

      <div className="pdf__method">
        <div>
          <div className="pdf__method-k">Source</div>
          <p>All data is pulled directly from the Kartavya production database (Postgres · IST). No third-party aggregator is involved.</p>
        </div>
        <div>
          <div className="pdf__method-k">Counting rules</div>
          <p><b>Completed</b> = tasks marked Done within the period. <b>Due</b> = tasks with a target date in the period. <b>Overdue</b> = unfinished tasks past their target. <b>Approvals</b> = approve actions logged in the audit trail.</p>
        </div>
        <div>
          <div className="pdf__method-k">Champion</div>
          <p>Weighted score: completed (×1) + approvals (×1.5) + on-time delivery (×1.2). Ties broken by focus time.</p>
        </div>
        <div>
          <div className="pdf__method-k">Attached files</div>
          <p><code>aekam_weekly_wk20_2026.xlsx</code> — 5 sheets (tasks, per-person, per-project, approvals, overdue ageing). <code>aekam_weekly_wk20_2026.csv</code> — flat task list.</p>
        </div>
      </div>

      <div className="pdf__colophon">
        <div className="pdf__colophon-h">
          <span className="pdf__colophon-main">Kartavya</span>
          <span className="pdf__colophon-hi">कर्तव्य</span>
          <em>— do what must be done.</em>
        </div>
        <p>
          Aekam Inc · Ahmedabad, IN · हस्ताक्षरित: <b>Keval Shah</b>,
          Admin · 18 May 2026 · 11:42 IST. This report and its companion
          spreadsheets are confidential to admins and team owners of Aekam
          Workspace.
        </p>
        <p className="pdf__colophon-cite">
          कर्म एव अधिकारस्ते — <em>your right is to your work alone.</em>
        </p>
      </div>
    </PdfShell>
  );
}

Object.assign(window, { PdfCover, PdfProjects, PdfTeam, PdfTasks, PdfTrend });
