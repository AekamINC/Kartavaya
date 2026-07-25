// Scale variants — what the report looks like when project count grows.
// Single rule: dense rows + roll-up + cross-reference to the attachment.

// ─── shared bigger dataset (14 projects) ──────────────────────────
const SCALE_PROJECTS = [
  { name: 'Mumbai client review',       hi: 'मुंबई समीक्षा',          dot: '#ec4899', done: 18, due: 9,  await_: 2, over: 1, client: 'Tata Steel' },
  { name: 'GST automation',             hi: 'जीएसटी स्वचालन',         dot: '#0A7A6E', done: 14, due: 6,  await_: 4, over: 0, client: 'Internal'   },
  { name: 'Hyderabad client review',    hi: 'हैदराबाद समीक्षा',        dot: '#0082c6', done: 13, due: 8,  await_: 1, over: 0, client: 'Reliance'   },
  { name: 'Saraswati onboarding',       hi: 'सरस्वती ऑनबोर्डिंग',    dot: '#6366f1', done: 11, due: 14, await_: 1, over: 3, client: 'Saraswati'  },
  { name: 'Diwali campaign',            hi: 'दीपावली विपणन',          dot: '#f59e0b', done: 10, due: 7,  await_: 0, over: 1, client: 'Saraswati'  },
  { name: 'Bengaluru office fit-out',   hi: 'कार्यालय सज्जा',         dot: '#10b981', done: 9,  due: 11, await_: 1, over: 0, client: 'Internal'   },
  { name: 'Q1 audit prep',              hi: 'त्रैमासिक लेखापरीक्षा',  dot: '#B06A00', done: 7,  due: 12, await_: 2, over: 4, client: 'Internal'   },
  { name: 'Chennai onboarding',         hi: 'चेन्नई ऑनबोर्डिंग',     dot: '#a855f7', done: 6,  due: 9,  await_: 1, over: 1, client: 'Murugappa'  },
  // — rolled-up below the fold (6 smaller projects) —
  { name: 'Vendor onboarding v2',       hi: 'सहयोग v2',              dot: '#8b5cf6', done: 5,  due: 4,  await_: 0, over: 0, client: 'Internal'   },
  { name: 'Pune compliance retainer',   hi: 'पुणे अनुपालन',          dot: '#14b8a6', done: 4,  due: 5,  await_: 1, over: 0, client: 'Bajaj'      },
  { name: 'Delhi import licensing',     hi: 'दिल्ली आयात',           dot: '#d97706', done: 4,  due: 6,  await_: 0, over: 1, client: 'Apollo'     },
  { name: 'Singapore subsidiary setup', hi: 'सिंगापुर इकाई',         dot: '#06b6d4', done: 3,  due: 3,  await_: 1, over: 0, client: 'Internal'   },
  { name: 'Kolkata jute consortium',    hi: 'कोलकाता संघ',           dot: '#92400e', done: 3,  due: 5,  await_: 0, over: 1, client: 'Birla'      },
  { name: 'Q4 audit closure',           hi: 'त्रै4 समापन',            dot: '#475569', done: 2,  due: 4,  await_: 1, over: 0, client: 'Infosys'    },
];

// ─── EMAIL — scaled weekly (14 projects → top 8 + roll-up) ─────────
function EmailWeeklyReportScaled() {
  const top    = SCALE_PROJECTS.slice(0, 8);
  const rolled = SCALE_PROJECTS.slice(8);
  const rolledSum = rolled.reduce((s, r) => ({
    done:   s.done   + r.done,
    due:    s.due    + r.due,
    await_: s.await_ + r.await_,
    over:   s.over   + r.over,
  }), { done: 0, due: 0, await_: 0, over: 0 });

  return (
    <EmailShell
      kicker="WEEKLY REPORT · WK 20 (11–17 MAY)"
      h1="Aekam closed 112 tasks across 14 projects."
      hi="साप्ताहिक प्रतिवेदन"
    >
      <p className="em__lede">
        <b>14 active projects</b> in scope this week — the table below
        shows the top 8 by activity, the rest are rolled up. The
        attached Excel has every project with full per-task detail.
      </p>

      <div className="rp__stats">
        <Stat k="Completed (wk)"    v="112" hint="↑ 22% vs WK 19" tone="ok" />
        <Stat k="Due this week"     v="103" hint="across 14 projects" />
        <Stat k="Awaiting approval" v="15"  hint="oldest: 5d" tone="warn" />
        <Stat k="Overdue"           v="12"  hint="↓ 3 vs WK 19" tone="bad" />
      </div>

      <div className="rp__section-h">
        Top 8 projects by activity
        <span className="rp__section-h-hi">शीर्ष 8</span>
      </div>
      <table className="rp__table rp__table--dense">
        <thead>
          <tr>
            <th>Project</th>
            <th>Done</th>
            <th>Due</th>
            <th>Appr.</th>
            <th>Over.</th>
          </tr>
        </thead>
        <tbody>
          {top.map((r, i) => (
            <tr key={i}>
              <td>
                <div className="rp__proj rp__proj--dense">
                  <i style={{ background: r.dot }} />
                  <div>
                    <div className="rp__proj-name">{r.name}</div>
                    <div className="rp__proj-client">{r.client}</div>
                  </div>
                </div>
              </td>
              <td className="rp__td-num">{r.done}</td>
              <td className="rp__td-num">{r.due}</td>
              <td className="rp__td-num">{r.await_}</td>
              <td className={'rp__td-num ' + (r.over > 0 ? 'rp__td-num--bad' : '')}>{r.over}</td>
            </tr>
          ))}
          <tr className="rp__rollup">
            <td>
              <div className="rp__rollup-row">
                <span className="rp__rollup-bullets">
                  {rolled.slice(0, 6).map((r, i) => (
                    <i key={i} style={{ background: r.dot }} />
                  ))}
                </span>
                <div>
                  <div className="rp__rollup-name">+ 6 other projects</div>
                  <div className="rp__rollup-hint">Vendor v2, Pune, Delhi, Singapore, Kolkata, Q4 closure</div>
                </div>
              </div>
            </td>
            <td className="rp__td-num">{rolledSum.done}</td>
            <td className="rp__td-num">{rolledSum.due}</td>
            <td className="rp__td-num">{rolledSum.await_}</td>
            <td className={'rp__td-num ' + (rolledSum.over > 0 ? 'rp__td-num--bad' : '')}>{rolledSum.over}</td>
          </tr>
        </tbody>
      </table>

      <p className="em__small" style={{ marginTop: 4 }}>
        Full per-project + per-task detail is in the attached
        <code>aekam_weekly_wk20_2026.xlsx</code> — sheet <b>Per-project</b>.
      </p>

      <Champion
        label="CHAMPION OF THE WEEK"
        labelHi="सप्ताह का नायक"
        name="Priya Iyer"
        color="#0082c6"
        role="Compliance · across 4 projects"
        line1="18 tasks closed"
        line2="3 approvals on time"
      />

      <Attach
        file="aekam_weekly_wk20_2026.xlsx"
        size="284 KB"
        hint="14 projects · 112 tasks · 6 sheets"
      />

      <div className="em__cta-row">
        <a className="em__btn em__btn--primary" href="#">Open this week</a>
        <a className="em__btn em__btn--ghost" href="#">Download Excel</a>
      </div>

      <MetaLine />
    </EmailShell>
  );
}

Object.assign(window, { EmailWeeklyReportScaled });
