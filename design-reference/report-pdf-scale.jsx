// Scale variants of the PDF — what happens when the workspace has more
// projects than the default page-2 layout can hold gracefully.

const PROJECTS_14 = [
  { name: 'Mumbai client review',       hi: 'मुंबई समीक्षा',          dot: '#ec4899', client: 'Tata Steel', done: 18, due: 9,  await_: 2, over: 1, pct: 88 },
  { name: 'Internal — GST automation',  hi: 'जीएसटी स्वचालन',         dot: '#0A7A6E', client: 'Internal',   done: 14, due: 6,  await_: 4, over: 0, pct: 62 },
  { name: 'Hyderabad client review',    hi: 'हैदराबाद समीक्षा',        dot: '#0082c6', client: 'Reliance',   done: 13, due: 8,  await_: 1, over: 0, pct: 71 },
  { name: 'Saraswati Co. onboarding',   hi: 'सरस्वती ऑनबोर्डिंग',    dot: '#6366f1', client: 'Saraswati',  done: 11, due: 14, await_: 1, over: 3, pct: 34 },
  { name: 'Diwali campaign',            hi: 'दीपावली विपणन',          dot: '#f59e0b', client: 'Saraswati',  done: 10, due: 7,  await_: 0, over: 1, pct: 44 },
  { name: 'Bengaluru office fit-out',   hi: 'कार्यालय सज्जा',         dot: '#10b981', client: 'Internal',   done: 9,  due: 11, await_: 1, over: 0, pct: 78 },
  { name: 'Q1 audit prep',              hi: 'त्रैमासिक लेखापरीक्षा',  dot: '#B06A00', client: 'Internal',   done: 7,  due: 12, await_: 2, over: 4, pct: 21 },
  { name: 'Chennai onboarding',         hi: 'चेन्नई ऑनबोर्डिंग',     dot: '#a855f7', client: 'Murugappa',  done: 6,  due: 9,  await_: 1, over: 1, pct: 40 },
  { name: 'Vendor onboarding v2',       hi: 'सहयोग v2',              dot: '#8b5cf6', client: 'Internal',   done: 5,  due: 4,  await_: 0, over: 0, pct: 58 },
  { name: 'Pune compliance retainer',   hi: 'पुणे अनुपालन',          dot: '#14b8a6', client: 'Bajaj',      done: 4,  due: 5,  await_: 1, over: 0, pct: 32 },
  { name: 'Delhi import licensing',     hi: 'दिल्ली आयात',           dot: '#d97706', client: 'Apollo',     done: 4,  due: 6,  await_: 0, over: 1, pct: 28 },
  { name: 'Singapore subsidiary setup', hi: 'सिंगापुर इकाई',         dot: '#06b6d4', client: 'Internal',   done: 3,  due: 3,  await_: 1, over: 0, pct: 18 },
  { name: 'Kolkata jute consortium',    hi: 'कोलकाता संघ',           dot: '#92400e', client: 'Birla',      done: 3,  due: 5,  await_: 0, over: 1, pct: 24 },
  { name: 'Q4 audit closure',           hi: 'त्रै4 समापन',            dot: '#475569', client: 'Infosys',    done: 2,  due: 4,  await_: 1, over: 0, pct: 92 },
];

function DenseRow({ r, rank }) {
  return (
    <tr>
      <td className="pdf-dense__rank">{rank}</td>
      <td>
        <div className="pdf-dense__proj">
          <i style={{ background: r.dot }} />
          <div>
            <div className="pdf-dense__name">{r.name}</div>
            <div className="pdf-dense__hi">{r.hi} <span>· {r.client}</span></div>
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
  );
}

// ── 14 projects fit on one page in dense mode ─────────────────────
function PdfProjectsDense() {
  const totals = PROJECTS_14.reduce((s, r) => ({
    done: s.done + r.done, due: s.due + r.due,
    await_: s.await_ + r.await_, over: s.over + r.over,
  }), { done: 0, due: 0, await_: 0, over: 0 });
  return (
    <PdfShell pageN={2} pageOf={6} title="Per-project breakdown · 14 projects">
      <div className="pdf__sec-h">
        <div>
          <h2>Per-project breakdown</h2>
          <span className="pdf__sec-hi">परियोजनावार · सघन</span>
        </div>
        <p>
          14 projects active in this period. Dense layout — full per-task
          detail is in the attached XLSX, sheet <code>Per-project</code>.
        </p>
      </div>

      <table className="pdf__table pdf-dense">
        <thead>
          <tr>
            <th>#</th>
            <th>Project</th>
            <th className="num">Done</th>
            <th className="num">Due</th>
            <th className="num">Appr.</th>
            <th className="num">Over.</th>
            <th>Progress</th>
          </tr>
        </thead>
        <tbody>
          {PROJECTS_14.map((r, i) => <DenseRow key={i} r={r} rank={i + 1} />)}
          <tr className="pdf__total">
            <td/>
            <td>Workspace total · 14 projects</td>
            <td className="num">{totals.done}</td>
            <td className="num">{totals.due}</td>
            <td className="num">{totals.await_}</td>
            <td className="num bad">{totals.over}</td>
            <td className="pct"><div className="pdf__pbar"><div style={{ width: '48%', background: 'var(--ink)' }} /></div><span>48%</span></td>
          </tr>
        </tbody>
      </table>

      <div className="pdf-dense__foot">
        Sorted by activity (completed tasks) within the reporting period.
        Progress is open-task completion across the project's full
        lifetime, not just this period.
      </div>
    </PdfShell>
  );
}

// ── First page of a 24-project paginated breakdown ────────────────
function PdfProjectsPaged1() {
  const half = PROJECTS_14.slice(0, 12);
  return (
    <PdfShell pageN={2} pageOf={7} title="Per-project breakdown · page 1 of 2">
      <div className="pdf__sec-h">
        <div>
          <h2>Per-project breakdown <span className="pdf-dense__pg">1 of 2</span></h2>
          <span className="pdf__sec-hi">परियोजनावार</span>
        </div>
        <p>
          24 projects active — showing projects 1–12, sorted by activity.
          Continues on the next page.
        </p>
      </div>

      <table className="pdf__table pdf-dense">
        <thead>
          <tr>
            <th>#</th>
            <th>Project</th>
            <th className="num">Done</th>
            <th className="num">Due</th>
            <th className="num">Appr.</th>
            <th className="num">Over.</th>
            <th>Progress</th>
          </tr>
        </thead>
        <tbody>
          {half.map((r, i) => <DenseRow key={i} r={r} rank={i + 1} />)}
        </tbody>
      </table>

      <div className="pdf-dense__pgfoot">
        <span>↳ Continued on page 3 (projects 13–24)</span>
        <span className="pdf-dense__pgfoot-cite">aekam_weekly_wk20_2026.pdf</span>
      </div>
    </PdfShell>
  );
}

// ── Movers snapshot — shown before the dense list when N ≥ 25 ─────
function PdfMovers() {
  return (
    <PdfShell pageN={2} pageOf={8} title="Movers — top gainers, watch-list">
      <div className="pdf__sec-h">
        <div>
          <h2>Movers this week</h2>
          <span className="pdf__sec-hi">गतिशील परियोजनाएँ</span>
        </div>
        <p>
          When the workspace has 25+ projects, this snapshot fronts the
          breakdown so the page-2 table doesn't bury the signal.
        </p>
      </div>

      <div className="pdf-movers">
        <div className="pdf-movers__col">
          <div className="pdf-movers__h">
            <span>TOP 3 BY ACTIVITY</span>
            <span className="pdf-movers__hi">सर्वाधिक सक्रिय</span>
          </div>
          {[
            ['Mumbai client review',      '#ec4899', 18, '+5 vs WK 19', 'Tata Steel'],
            ['Internal — GST automation', '#0A7A6E', 14, '+3 vs WK 19', 'Internal'],
            ['Hyderabad client review',   '#0082c6', 13, '+8 vs WK 19', 'Reliance'],
          ].map(([n, c, d, delta, client], i) => (
            <div key={i} className="pdf-movers__row">
              <span className="pdf-movers__rank">{i + 1}</span>
              <i className="pdf-movers__dot" style={{ background: c }} />
              <div className="pdf-movers__id">
                <div className="pdf-movers__name">{n}</div>
                <div className="pdf-movers__sub">{client}</div>
              </div>
              <div className="pdf-movers__n">
                <b>{d}</b>
                <small>{delta}</small>
              </div>
            </div>
          ))}
        </div>

        <div className="pdf-movers__col pdf-movers__col--warn">
          <div className="pdf-movers__h">
            <span>WATCH-LIST — OVERDUE OR STALLED</span>
            <span className="pdf-movers__hi">ध्यान दें</span>
          </div>
          {[
            ['Q1 audit prep',          '#B06A00', 4,  '4 overdue, +2 vs WK 19',     'Internal'],
            ['Saraswati onboarding',   '#6366f1', 3,  '3 overdue, brief sign-off blocked', 'Saraswati'],
            ['Q3 vendor reconciliation','#475569',0,  'No movement for 11 days',    'Birla'],
          ].map(([n, c, d, why, client], i) => (
            <div key={i} className="pdf-movers__row">
              <span className="pdf-movers__rank">{i + 1}</span>
              <i className="pdf-movers__dot" style={{ background: c }} />
              <div className="pdf-movers__id">
                <div className="pdf-movers__name">{n}</div>
                <div className="pdf-movers__sub">{client} · {why}</div>
              </div>
              <div className="pdf-movers__n pdf-movers__n--warn">
                <b>{d > 0 ? d : '—'}</b>
                <small>overdue</small>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pdf-movers__note">
        <b>Why this page exists.</b> Above 25 projects, a single per-project
        table is hard to read at a glance. This snapshot surfaces the
        signal first; full breakdown follows on pages 3–5 and in the
        attached XLSX, sheet <code>Per-project</code>.
      </div>
    </PdfShell>
  );
}

Object.assign(window, { PdfProjectsDense, PdfProjectsPaged1, PdfMovers });
