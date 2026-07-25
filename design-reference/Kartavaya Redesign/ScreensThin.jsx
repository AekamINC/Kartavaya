// Second screens for the thin modules — the tab each module is actually judged on.
// Dristi pivot · Manav leaves · Vetana statutory · Prachar templates ·
// Srijan credits · Hub publish · eSign create.

// ── Dristi → Pivot ─────────────────────────────────────────────────────
function DristiPivot() {
  const [mea, setMea] = React.useState('inv');
  const COLS = ['Q1', 'Q2', 'Q3', 'Q4'];
  const ROWS = [
    ['Tata Steel', [1240000, 1810000, 501500, 0]],
    ['Wipro Consumer', [680000, 420000, 890000, 0]],
    ['Nirmal Exports', [0, 310000, 275000, 0]],
    ['Saraswati Textiles', [180000, 180000, 180000, 0]],
    ['Godrej Interio', [0, 0, 640000, 0]],
  ];
  const tot = i => ROWS.reduce((a, r) => a + r[1][i], 0);
  const grand = ROWS.reduce((a, r) => a + r[1].reduce((x, y) => x + y, 0), 0);
  return (
    <>
      <div className="two two--wide">
        <Card title="Invoiced by client and quarter" hi="सारणी" flush right={<span className="mute mono" style={{ fontSize: 11 }}>FY 2026-27</span>}>
          <div className="tbl__scroll">
            <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.4fr) repeat(5, 108px)' }}>
              <span>Client</span>{COLS.map(c => <span key={c} style={{ textAlign: 'right' }}>{c}</span>)}<span style={{ textAlign: 'right' }}>Total</span>
            </div>
            {ROWS.map(([n, vals]) => (
              <div key={n} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.4fr) repeat(5, 108px)' }}>
                <span className="tbl__c"><span className="tbl__t">{n}</span></span>
                {vals.map((v, i) => (
                  <span key={i} className="tbl__c tbl__c--num" style={{ color: v ? undefined : 'var(--on-surface-faint)' }}>
                    {v ? inr(v) : '—'}
                  </span>
                ))}
                <span className="tbl__c tbl__c--num"><b>{inr(vals.reduce((a, b) => a + b, 0))}</b></span>
              </div>
            ))}
            <div className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.4fr) repeat(5, 108px)', background: 'var(--s-container)', fontWeight: 600 }}>
              <span className="tbl__c"><span className="tbl__t">Total</span></span>
              {COLS.map((_, i) => <span key={i} className="tbl__c tbl__c--num">{tot(i) ? inr(tot(i)) : '—'}</span>)}
              <span className="tbl__c tbl__c--num" style={{ color: 'var(--primary)' }}><b>{inr(grand)}</b></span>
            </div>
          </div>
        </Card>
        <Card title="Build" hi="रचना">
          <div className="col" style={{ gap: 13 }}>
            <div className="fld"><span className="fld__l">Rows</span><div className="chips"><span className="chip on">Client</span><button className="chip">{I.plus} Add</button></div></div>
            <div className="fld"><span className="fld__l">Columns</span><div className="chips"><span className="chip on">Quarter</span><button className="chip">{I.plus} Add</button></div></div>
            <div className="fld"><span className="fld__l">Measure</span>
              <div className="seg" style={{ width: '100%' }}>
                {[['inv', 'Invoiced'], ['coll', 'Collected'], ['due', 'Outstanding']].map(([k, l]) => (
                  <button key={k} className={'seg__b' + (mea === k ? ' on' : '')} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setMea(k)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="divider" />
            <div className="note note--info">
              <span style={{ color: 'var(--primary)' }}>{I.check}</span>
              <span>A pivot only aggregates rows you can already open. Two clients are excluded from your total because Ganit is set to <b>own records</b> for your role.</span>
            </div>
            <button className="btn btn--tonal" style={{ width: '100%' }}>Save as report</button>
            <button className="btn btn--out" style={{ width: '100%' }}>{I.doc} Export to Excel</button>
          </div>
        </Card>
      </div>
    </>
  );
}

// ── Manav → Leaves ─────────────────────────────────────────────────────
function ManavLeaves() {
  const [done, setDone] = React.useState({});
  const REQ = [
    { n: 'Rohan Desai', hi: 'रोहन', kind: 'Sick', hiK: 'रुग्ण', from: '24 Jul', to: '26 Jul', days: 3, note: 'Fever — will share certificate on return.', clash: false },
    { n: 'Priya Nair', hi: 'प्रिया', kind: 'Casual', hiK: 'आकस्मिक', from: '29 Jul', to: '31 Jul', days: 3, note: 'Family function in Kochi.', clash: true },
    { n: 'Fatima Sheikh', hi: 'फ़ातिमा', kind: 'Earned', hiK: 'अर्जित', from: '11 Aug', to: '16 Aug', days: 5, note: 'Annual leave, planned in April.', clash: false },
  ];
  const BAL = [
    ['Casual', 'आकस्मिक', 12, 7], ['Sick', 'रुग्ण', 12, 9], ['Earned', 'अर्जित', 18, 11], ['Comp-off', 'प्रतिकर', 4, 4],
  ];
  return (
    <div className="two">
      <div className="col">
        {REQ.map(r => {
          const st = done[r.n];
          return (
            <Card key={r.n} flush>
              <div style={{ padding: 'var(--pad-card)' }}>
                <div className="between">
                  <span className="rowflex" style={{ gap: 10 }}>
                    <Av n={r.n} s={34} />
                    <span>
                      <b style={{ fontSize: 13.5, display: 'block' }}>{r.n} <span className="hi mute" style={{ fontSize: 12 }}>{r.hi}</span></b>
                      <span className="mute" style={{ fontSize: 11.5 }}>{r.kind} leave <span className="hi">{r.hiK}</span> · {r.days} day{r.days > 1 ? 's' : ''}</span>
                    </span>
                  </span>
                  <span className="mono" style={{ fontSize: 12 }}>{r.from} → {r.to}</span>
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--on-surface-2)', margin: '11px 0 0', lineHeight: 1.55 }}>{r.note}</p>
                {r.clash && (
                  <div className="note note--warn" style={{ marginTop: 11 }}>
                    <span style={{ color: 'var(--warn)' }}>{I.check}</span>
                    <span>These dates cross the <b>31 July payroll cut-off</b>. Approving now moves 1 unpaid day into the July run; approving after the run pushes it to August.</span>
                  </div>
                )}
                {st ? (
                  <div className="rowflex" style={{ gap: 9, marginTop: 13 }}>
                    <Tag c={st === 'ok' ? '#04837A' : '#B3261E'}>{st === 'ok' ? 'Approved' : 'Declined'}</Tag>
                    <span className="mute" style={{ fontSize: 11.5 }}>Rohan notified on WhatsApp · balance updated</span>
                    <button className="btn btn--ghost btn--sm" style={{ marginLeft: 'auto' }} onClick={() => setDone(d => ({ ...d, [r.n]: null }))}>Undo</button>
                  </div>
                ) : (
                  <div className="rowflex" style={{ gap: 8, marginTop: 13 }}>
                    <button className="btn btn--fill btn--sm" onClick={() => setDone(d => ({ ...d, [r.n]: 'ok' }))}>Approve</button>
                    <button className="btn btn--out btn--sm" onClick={() => setDone(d => ({ ...d, [r.n]: 'no' }))}>Decline</button>
                    <button className="btn btn--ghost btn--sm">Ask a question</button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <div className="col">
        <Card title="Balance — Rohan Desai" hi="शेष" flush>
          {BAL.map(([l, hi, ent, left], i) => (
            <div key={l} style={{ padding: '11px var(--pad-card)', borderBottom: i < 3 ? '1px solid var(--outline-variant)' : 0 }}>
              <div className="between" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 12.5 }}>{l} <span className="hi mute" style={{ fontSize: 11.5 }}>{hi}</span></span>
                <span className="mono" style={{ fontSize: 12 }}><b>{left}</b><span className="mute"> / {ent}</span></span>
              </div>
              <span className="meter"><span className="meter__f" style={{ width: (left / ent * 100) + '%', display: 'block', background: left / ent < .3 ? 'var(--warn)' : undefined }} /></span>
            </div>
          ))}
        </Card>
        <Card title="Policy" hi="नीति">
          <div className="col" style={{ gap: 9, fontSize: 12.5, color: 'var(--on-surface-2)' }}>
            <div className="between"><span>Approver</span><span className="mute">Reporting manager</span></div>
            <div className="between"><span>Sick leave without certificate</span><span className="mute">up to 2 days</span></div>
            <div className="between"><span>Earned leave carry-forward</span><span className="mute">30 days max</span></div>
            <div className="between"><span>Encashment</span><span className="mute">at exit only</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Vetana → Statutory ─────────────────────────────────────────────────
function VetanaStatutory() {
  const ITEMS = [
    { t: 'PF — ECR upload', hi: 'भविष्य निधि', form: 'ECR', due: '15 Aug 2026', amt: 61200, st: 'due', note: 'Employee 12% + employer 12% on ₹2,55,000 of PF wages.' },
    { t: 'ESI — monthly contribution', hi: 'राज्य बीमा', form: 'ESIC', due: '15 Aug 2026', amt: 8940, st: 'due', note: '0.75% employee + 3.25% employer. Two employees above the ₹21,000 ceiling are excluded.' },
    { t: 'Professional tax — Maharashtra', hi: 'व्यवसाय कर', form: 'MTR-6', due: '31 Aug 2026', amt: 1400, st: 'due', note: '₹200 per employee per month, ₹300 in February.' },
    { t: 'TDS on salary — Q1', hi: 'स्रोत कर', form: '24Q', due: '31 Jul 2026', amt: 148500, st: 'overdue', note: 'Quarterly return. Challan already paid on 7 Jul — only the return is pending.' },
    { t: 'PF — ECR upload', hi: 'भविष्य निधि', form: 'ECR', due: '15 Jul 2026', amt: 59800, st: 'filed', note: 'Filed 14 Jul · TRRN 2607140001234.' },
  ];
  const ST = { due: ['Due', '#A66207'], overdue: ['Overdue', '#B3261E'], filed: ['Filed', '#04837A'] };
  return (
    <div className="two">
      <Card title="Compliance calendar" hi="अनुपालन" flush right={<span className="mute" style={{ fontSize: 11.5 }}>July 2026 run</span>}>
        {ITEMS.map((x, i) => {
          const [lbl, c] = ST[x.st];
          return (
            <div key={i} style={{ padding: 'var(--pad-card)', borderBottom: i < ITEMS.length - 1 ? '1px solid var(--outline-variant)' : 0, background: x.st === 'overdue' ? 'color-mix(in srgb, var(--danger) 5%, transparent)' : undefined }}>
              <div className="between">
                <span className="rowflex" style={{ gap: 9, minWidth: 0 }}>
                  <span className="tbl__id" style={{ flexShrink: 0 }}>{x.form}</span>
                  <span style={{ minWidth: 0 }}>
                    <b style={{ fontSize: 13, display: 'block' }}>{x.t}</b>
                    <span className="hi mute" style={{ fontSize: 11.5 }}>{x.hi}</span>
                  </span>
                </span>
                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="mono" style={{ fontSize: 13 }}>{inr(x.amt)}</div>
                  <div className="mute mono" style={{ fontSize: 10.5 }}>due {x.due}</div>
                </span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: '9px 0 0', lineHeight: 1.5 }}>{x.note}</p>
              <div className="rowflex" style={{ gap: 8, marginTop: 11 }}>
                <Tag c={c}>{lbl}</Tag>
                {x.st === 'filed'
                  ? <button className="btn btn--out btn--sm" style={{ marginLeft: 'auto' }}>{I.doc} Receipt</button>
                  : <><button className="btn btn--out btn--sm" style={{ marginLeft: 'auto' }}>{I.doc} Challan</button><button className="btn btn--fill btn--sm">Mark filed</button></>}
              </div>
            </div>
          );
        })}
      </Card>
      <div className="col">
        <Card title="This month" hi="इस माह">
          <div className="col" style={{ gap: 11 }}>
            {[['PF', 61200, .42], ['ESI', 8940, .06], ['PT', 1400, .01], ['TDS', 148500, .51]].map(([l, v, f]) => (
              <div key={l}>
                <div className="between" style={{ marginBottom: 5 }}><span style={{ fontSize: 12.5 }}>{l}</span><span className="mono" style={{ fontSize: 12 }}>{inr(v)}</span></div>
                <span className="meter"><span className="meter__f" style={{ width: (f * 100) + '%', display: 'block' }} /></span>
              </div>
            ))}
            <div className="divider" />
            <div className="between"><span style={{ fontSize: 13, fontWeight: 600 }}>Total statutory</span><b className="mono" style={{ fontSize: 15 }}>{inr(220040)}</b></div>
          </div>
        </Card>
        <Card title="Registrations" hi="पंजीकरण">
          <div className="col" style={{ gap: 9, fontSize: 12.5 }}>
            {[['PF code', 'MH/BAN/0045612'], ['ESIC code', '31000456120000999'], ['PT (EC)', '27123456789P'], ['TAN', 'MUMA12345B']].map(([l, v]) => (
              <div key={l} className="between"><span className="mute">{l}</span><span className="mono">{v}</span></div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Prachar → Templates ────────────────────────────────────────────────
function PracharTemplates() {
  const T = [
    { n: 'payment_reminder_msme', cat: 'Utility', lang: 'EN · HI', st: 'ok', used: 84, body: 'Namaste {{1}}, invoice {{2}} for ₹{{3}} is {{4}} days past the agreed 45-day MSME term. Reply here or pay by UPI: {{5}}' },
    { n: 'quotation_sent', cat: 'Utility', lang: 'EN', st: 'ok', used: 41, body: 'Hello {{1}}, your quotation {{2}} is ready. Total ₹{{3}}, valid until {{4}}.' },
    { n: 'diwali_offer_2026', cat: 'Marketing', lang: 'EN · HI · GU', st: 'pending', used: 0, body: 'Diwali offer — 15% off all fit-out packages booked before {{1}}. Reply STOP to opt out.' },
    { n: 'festive_blast_v1', cat: 'Marketing', lang: 'EN', st: 'no', used: 0, body: 'Biggest sale ever!! Click now!!! {{1}}', why: 'Rejected by Meta — promotional language without an opt-out line, and a URL in a variable.' },
  ];
  const ST = { ok: ['Approved', '#04837A'], pending: ['In review', '#A66207'], no: ['Rejected', '#B3261E'] };
  return (
    <>
      <div className="note note--info" style={{ marginBottom: 'var(--gap-section)' }}>
        <span style={{ color: 'var(--primary)' }}>{I.check}</span>
        <span>Templates are approved by Meta, not by us — review takes minutes to a day. <b>Utility</b> templates can be sent to any contact with a prior conversation; <b>Marketing</b> templates need recorded opt-in and are blocked without it.</span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px,1fr))' }}>
        {T.map(t => {
          const [lbl, c] = ST[t.st];
          return (
            <Card key={t.n} flush>
              <div style={{ padding: 'var(--pad-card)' }}>
                <div className="between">
                  <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{t.n}</span>
                  <Tag c={c}>{lbl}</Tag>
                </div>
                <div className="rowflex" style={{ gap: 7, marginTop: 8 }}>
                  <Tag c={t.cat === 'Marketing' ? '#7c5cbf' : '#0082c6'}>{t.cat}</Tag>
                  <span className="mute mono" style={{ fontSize: 11 }}>{t.lang}</span>
                  <span className="mute" style={{ fontSize: 11, marginLeft: 'auto' }}>{t.used} sent</span>
                </div>
                <div style={{ marginTop: 11, padding: '10px 12px', background: 'var(--s-container)', borderRadius: 'var(--r-sm)', fontSize: 12, lineHeight: 1.55, color: 'var(--on-surface-2)' }}>{t.body}</div>
                {t.why && <div className="note note--danger" style={{ marginTop: 10 }}><span style={{ color: 'var(--danger)' }}>{I.check}</span><span>{t.why}</span></div>}
                <div className="rowflex" style={{ gap: 8, marginTop: 12 }}>
                  {t.st === 'ok' && <button className="btn btn--fill btn--sm">Use in campaign</button>}
                  {t.st === 'no' && <button className="btn btn--fill btn--sm">Edit and resubmit</button>}
                  {t.st === 'pending' && <button className="btn btn--out btn--sm" disabled>Awaiting Meta</button>}
                  <button className="btn btn--ghost btn--sm">Duplicate</button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ── Srijan → Credits ───────────────────────────────────────────────────
function SrijanCredits() {
  const used = 634, cap = 1000;
  const BY = [['Invoice OCR', 'पठन', 212], ['Contact enricher', 'संवर्धन', 148], ['Payment reminder writer', 'लेखक', 96], ['Meeting note taker', 'टिप्पणी', 88], ['Proposal drafter', 'प्रस्ताव', 62], ['GST notice explainer', 'व्याख्या', 28]];
  const LEDGER = [
    ['25 Jul · 11:04', 'Invoice OCR', 'Read 4 purchase bills into Ganit', 8],
    ['25 Jul · 09:52', 'Payment reminder writer', 'Drafted reminder for INV-2607', 2],
    ['24 Jul · 17:20', 'Meeting note taker', 'Tata Steel site review → 6 tasks', 5],
    ['24 Jul · 15:11', 'Contact enricher', 'Enriched 12 contacts from Nirmal import', 12],
    ['23 Jul · 10:40', 'Proposal drafter', 'Quote for Godrej Interio fit-out', 6],
  ];
  return (
    <div className="two">
      <div className="col">
        <Card title="This month" hi="इस माह" right={<Tag c="#04837A">Growth · वृद्धि</Tag>}>
          <div className="between" style={{ alignItems: 'flex-end', marginBottom: 11 }}>
            <span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 38, letterSpacing: '-.03em' }}>{used}</span>
              <span className="mute" style={{ fontSize: 13 }}> / {cap.toLocaleString('en-IN')} credits</span>
            </span>
            <span className="mute mono" style={{ fontSize: 11.5 }}>resets 1 Aug</span>
          </div>
          <span className="meter" style={{ height: 8 }}><span className="meter__f" style={{ width: (used / cap * 100) + '%', display: 'block' }} /></span>
          <div className="between" style={{ marginTop: 9 }}>
            <span className="mute" style={{ fontSize: 12 }}>{cap - used} left · about 9 days at this rate</span>
            <button className="btn btn--out btn--sm">Buy top-up</button>
          </div>
          <div className="note note--info" style={{ marginTop: 13 }}>
            <span style={{ color: 'var(--primary)' }}>{I.check}</span>
            <span>Unused credits do not carry over. Top-ups do, and are billed in rupees on your next invoice — you will see the amount here before it appears on the invoice.</span>
          </div>
        </Card>
        <Card title="Recent runs" hi="प्रयोग" flush>
          {LEDGER.map(([when, skill, what, n], i) => (
            <div key={i} className="between" style={{ padding: '12px var(--pad-card)', borderBottom: i < LEDGER.length - 1 ? '1px solid var(--outline-variant)' : 0 }}>
              <span className="rowflex" style={{ gap: 10, minWidth: 0 }}>
                <span style={{ color: 'var(--primary)', flexShrink: 0 }}>{I.ai}</span>
                <span style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 12.5, display: 'block' }}>{skill}</b>
                  <span className="mute" style={{ fontSize: 11.5 }}>{what}</span>
                </span>
              </span>
              <span style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="mono" style={{ fontSize: 12.5 }}>−{n}</div>
                <div className="mute mono" style={{ fontSize: 10.5 }}>{when}</div>
              </span>
            </div>
          ))}
        </Card>
      </div>
      <Card title="By skill" hi="कौशल अनुसार">
        <div className="col" style={{ gap: 12 }}>
          {BY.map(([n, hi, v]) => (
            <div key={n}>
              <div className="between" style={{ marginBottom: 5 }}>
                <span style={{ fontSize: 12.5 }}>{n} <span className="hi mute" style={{ fontSize: 11.5 }}>{hi}</span></span>
                <span className="mono" style={{ fontSize: 12 }}>{v}</span>
              </div>
              <span className="meter"><span className="meter__f" style={{ width: (v / 212 * 100) + '%', display: 'block' }} /></span>
            </div>
          ))}
          <div className="divider" />
          <div className="col" style={{ gap: 8, fontSize: 12.5, color: 'var(--on-surface-2)' }}>
            <div className="between"><span>Cheapest run</span><span className="mono mute">1 credit</span></div>
            <div className="between"><span>Most expensive</span><span className="mono mute">12 credits</span></div>
            <div className="between"><span>Average</span><span className="mono mute">4.2 credits</span></div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Hub → Publish ──────────────────────────────────────────────────────
function HubPublish() {
  const [on, setOn] = React.useState({ status: true, docs: true, inv: true, tasks: false, time: false, team: true });
  const ROWS = [
    ['status', 'Project status and milestones', 'Progress bar, milestone list and dates. No internal notes.', true],
    ['docs', 'Signed documents', 'Agreements and quotes the client has already signed or received.', true],
    ['inv', 'Invoices and payments', 'Invoice PDFs, amounts due and the UPI pay button.', true],
    ['tasks', 'Task board', 'Every task, including ones assigned to your own team.', false],
    ['time', 'Time entries', 'Hours logged against the project, per person.', false],
    ['team', 'Who is working on this', 'Names and roles of assigned members. Not their contact details.', true],
  ];
  return (
    <div className="two">
      <Card title="What Tata Steel can see" hi="दृश्यता" flush right={<button className="btn btn--out btn--sm">Preview as client</button>}>
        {ROWS.map(([k, t, d, safe], i) => (
          <div key={k} className="between" style={{ padding: 'var(--pad-card)', borderBottom: i < ROWS.length - 1 ? '1px solid var(--outline-variant)' : 0, alignItems: 'flex-start', gap: 16 }}>
            <span style={{ minWidth: 0 }}>
              <b style={{ fontSize: 13, display: 'block' }}>{t}</b>
              <span className="mute" style={{ fontSize: 12, lineHeight: 1.5, display: 'block', marginTop: 3 }}>{d}</span>
              {!safe && <span style={{ display: 'inline-flex', marginTop: 7 }}><Tag c="#A66207">Off by default</Tag></span>}
            </span>
            <button className={'sw' + (on[k] ? ' on' : '')} onClick={() => setOn(o => ({ ...o, [k]: !o[k] }))} aria-label={t}><i /></button>
          </div>
        ))}
      </Card>
      <div className="col">
        <Card title="Never shared" hi="कभी नहीं">
          <div className="col" style={{ gap: 10, fontSize: 12.5, color: 'var(--on-surface-2)' }}>
            {['Internal comments and mentions', 'Your cost, margin or supplier pricing', 'Other clients’ names anywhere in the portal', 'Attachments marked internal', 'Team salaries or attendance'].map(t => (
              <div key={t} className="rowflex" style={{ gap: 9 }}><span style={{ color: 'var(--danger)', flexShrink: 0 }}>{I.check}</span><span>{t}</span></div>
            ))}
          </div>
          <div className="note note--info" style={{ marginTop: 13 }}>
            <span style={{ color: 'var(--primary)' }}>{I.check}</span>
            <span>This list is enforced in the API, not in the portal UI — a client token cannot request these fields even directly.</span>
          </div>
        </Card>
        <Card title="Access" hi="पहुँच">
          <div className="col" style={{ gap: 11 }}>
            {[['Meera Joshi', 'meera@tatasteel.com', 'Active'], ['Sanjay Rao', 'sanjay@tatasteel.com', 'Invited']].map(([n, e, st]) => (
              <div key={n} className="between">
                <span className="rowflex" style={{ gap: 9, minWidth: 0 }}>
                  <Av n={n} s={28} />
                  <span style={{ minWidth: 0 }}><b style={{ fontSize: 12.5, display: 'block' }}>{n}</b><span className="mute mono" style={{ fontSize: 11 }}>{e}</span></span>
                </span>
                <Tag c={st === 'Active' ? '#04837A' : '#A66207'}>{st}</Tag>
              </div>
            ))}
            <button className="btn btn--tonal btn--sm" style={{ width: '100%' }}>{I.plus} Invite client user</button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── eSign → Create ─────────────────────────────────────────────────────
function EsignCreate() {
  const [sel, setSel] = React.useState('sig1');
  const FIELDS = [
    { id: 'sig1', kind: 'Signature', who: 'Meera Joshi', page: 2, top: 62, left: 8, w: 40 },
    { id: 'dt1', kind: 'Date', who: 'Meera Joshi', page: 2, top: 62, left: 56, w: 26 },
    { id: 'ini1', kind: 'Initials', who: 'Meera Joshi', page: 1, top: 88, left: 74, w: 16 },
    { id: 'sig2', kind: 'Signature', who: 'Keval Shah', page: 2, top: 78, left: 8, w: 40 },
  ];
  return (
    <div className="two">
      <Card title="Fit-out agreement — Phase 2" hi="क्षेत्र" flush right={<span className="mute mono" style={{ fontSize: 11 }}>page 2 of 2</span>}>
        <div style={{ padding: 'var(--pad-card)', background: 'var(--s-container)' }}>
          <div style={{ position: 'relative', aspectRatio: '1 / 1.294', background: '#fff', borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-2)', overflow: 'hidden', padding: '7% 8%' }}>
            {[96, 88, 92, 76, 0, 94, 90, 84, 62, 0, 88, 91].map((w, i) => (
              w ? <div key={i} style={{ height: 5, width: w + '%', background: 'var(--outline-variant)', borderRadius: 2, marginBottom: 9 }} />
                : <div key={i} style={{ height: 14 }} />
            ))}
            {FIELDS.filter(f => f.page === 2).map(f => (
              <button key={f.id} onClick={() => setSel(f.id)}
                style={{
                  position: 'absolute', top: f.top + '%', left: f.left + '%', width: f.w + '%', height: '9%',
                  border: '1.5px dashed ' + (sel === f.id ? 'var(--primary)' : 'var(--outline)'),
                  background: sel === f.id ? 'color-mix(in srgb, var(--primary) 12%, transparent)' : 'color-mix(in srgb, var(--outline) 8%, transparent)',
                  borderRadius: 4, display: 'grid', placeItems: 'center', cursor: 'grab',
                }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.04em', color: sel === f.id ? 'var(--primary)' : 'var(--on-surface-3)' }}>{f.kind.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="rowflex" style={{ gap: 8, padding: 'var(--pad-card)', borderTop: '1px solid var(--outline-variant)', flexWrap: 'wrap' }}>
          {['Signature', 'Initials', 'Date', 'Text', 'Checkbox'].map(k => <button key={k} className="chip">{I.plus} {k}</button>)}
        </div>
      </Card>
      <div className="col">
        <Card title="Signing order" hi="क्रम">
          <div className="col" style={{ gap: 0 }}>
            {[['Meera Joshi', 'Tata Steel · client', 'meera@tatasteel.com', 1], ['Keval Shah', 'Aekam Inc · internal', 'keval@aekam.co', 2]].map(([n, r, e, i], j) => (
              <div key={n} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, paddingBottom: j === 0 ? 14 : 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span className="mono" style={{ width: 22, height: 22, borderRadius: 11, background: 'var(--primary-container)', color: 'var(--on-primary-container)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i}</span>
                  {j === 0 && <span style={{ flex: 1, width: 1, background: 'var(--outline-variant)', marginTop: 4 }} />}
                </div>
                <div>
                  <b style={{ fontSize: 13 }}>{n}</b>
                  <div className="mute" style={{ fontSize: 11.5, marginTop: 1 }}>{r}</div>
                  <div className="mute mono" style={{ fontSize: 11 }}>{e}</div>
                </div>
              </div>
            ))}
          </div>
          <button className="btn btn--ghost btn--sm" style={{ marginTop: 12 }}>{I.plus} Add signer</button>
        </Card>
        <Card title="Send" hi="भेजें">
          <div className="col" style={{ gap: 12 }}>
            <div className="fld"><span className="fld__l">Deliver by</span>
              <div className="seg" style={{ width: '100%' }}>
                {['WhatsApp', 'Email', 'Both'].map((t, i) => <button key={t} className={'seg__b' + (i === 2 ? ' on' : '')} style={{ flex: 1, justifyContent: 'center' }}>{t}</button>)}
              </div>
            </div>
            <div className="between"><span style={{ fontSize: 12.5 }}>Verify signer by OTP</span><button className="sw on" aria-label="OTP"><i /></button></div>
            <div className="between"><span style={{ fontSize: 12.5 }}>Remind every 3 days</span><button className="sw on" aria-label="Remind"><i /></button></div>
            <div className="between"><span style={{ fontSize: 12.5 }}>Expire after 30 days</span><button className="sw" aria-label="Expire"><i /></button></div>
            <div className="note note--info">
              <span style={{ color: 'var(--primary)' }}>{I.check}</span>
              <span>An OTP-verified signature with the audit trail is accepted under section 10A of the IT Act. It is not a digital signature certificate — a few registrars still insist on DSC.</span>
            </div>
            <button className="btn btn--fill" style={{ width: '100%' }}>Send for signature</button>
          </div>
        </Card>
      </div>
    </div>
  );
}

Object.assign(window, { DristiPivot, ManavLeaves, VetanaStatutory, PracharTemplates, SrijanCredits, HubPublish, EsignCreate });
