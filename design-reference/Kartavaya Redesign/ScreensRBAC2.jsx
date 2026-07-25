// RBAC part two — role degradation study (Vetana), denied states, client portal
// role, module admin panels, and the support agent's request side.
const VET_TABS = ['dashboard', 'structures', 'payroll', 'payslips', 'statutory'];
const VET_ACCESS = {
  none: [],
  viewer: ['payslips'],
  editor: ['dashboard', 'payroll', 'payslips'],
  approver: ['dashboard', 'payroll', 'payslips'],
  admin: ['dashboard', 'structures', 'payroll', 'payslips', 'statutory'],
};
const PAYROLL = [
  ['Rohan Iyer', 'Legal', 118000, 17200, 100800],
  ['Keval Shah', 'Leadership', 285000, 42800, 242200],
  ['Aanya Mehta', 'Finance', 165000, 24900, 140100],
  ['Priya Nair', 'Marketing', 92000, 12400, 79600],
  ['Fatima Sheikh', 'Operations', 134000, 19800, 114200],
];
const SUBJ = 'Rohan Iyer';

const DEG = {
  none: {
    sees: ['Nothing. वेतन is absent from his sidebar — not greyed out, absent.'],
    cant: ['Any deep link to a payroll page returns a request-access screen, and the attempt is logged.', 'His own payslips reach him by email from Manav instead.'],
    note: 'None is the default for a new member on a sensitive module. Nobody gets payroll by accident.',
  },
  viewer: {
    sees: ['His own payslips, one row, full detail.', 'Net pay, deductions and PF for himself only.'],
    cant: ['Other people’s salaries are never sent to the browser. The query is filtered server-side — this is not a masked column.', 'No payroll run, no structures, no statutory settings.'],
    note: 'Viewer on Vetana means “my own record”, not “read everything”. It is the only module where viewer is scoped to self.',
  },
  editor: {
    sees: ['The full July run with every amount.', 'Adjustments, arrears, recompute, and the variance against June.'],
    cant: ['Approve the run.', 'Release payments to the bank.', 'Open or edit salary structures.'],
    note: 'Editor prepares. That is the whole job — the person who builds the run cannot be the person who releases the money.',
  },
  approver: {
    sees: ['Everything editor sees, plus the approval queue and the audit trail for each run.'],
    cant: ['Edit salary structures.', 'Change statutory configuration.'],
    note: 'Approver is depth, not breadth. One extra button, and it is the button that moves ₹6.7 L.',
  },
  admin: {
    sees: ['Salary structures, components, statutory configuration, PF and PT setup.'],
    cant: ['Approve a payroll run. Even as Admin.', 'Release payments.'],
    note: 'Admin and Approver are not a hierarchy. Whoever defines what people are paid must not also be the one who releases it.',
  },
};

function MockTabs({ level }) {
  const ok = VET_ACCESS[level];
  return (
    <div className="mockbar">
      {VET_TABS.map(t => (
        <span key={t} className={'mocktab' + (ok.includes(t) ? '' : ' off') + (ok[0] === t ? ' on' : '')}>
          {t}{!ok.includes(t) && <span className="mocktab__lk">{SI.lock}</span>}
        </span>
      ))}
    </div>
  );
}

function VetanaMock({ level }) {
  const ok = VET_ACCESS[level];
  const canApprove = level === 'approver';
  if (level === 'none') return (
    <div className="lvlmock">
      <div className="miniside">
        <div className="miniside__t">Rohan’s sidebar</div>
        {[['कर्तव्य', 'Tasks', true], ['ग्रह', 'CRM', true], ['गणित', 'Finance', true], ['वेतन', 'Payroll', false], ['दृष्टि', 'Reports', false]].map(([hi, en, on]) => (
          <div key={en} className={'miniside__i' + (on ? '' : ' gone')}>
            <span className="hi">{hi}</span><span className="miniside__en">{en}</span>
            {!on && <span className="miniside__x">not granted</span>}
          </div>
        ))}
      </div>
      <div className="dnybox">
        <span className="dnybox__ic">{SI.lock}</span>
        <b style={{ fontSize: 14 }}>No access to वेतन Payroll</b>
        <span className="mute" style={{ fontSize: 12.5, maxWidth: '40ch', textWrap: 'pretty' }}>Rohan opened a payroll link somebody pasted in Sanvaad. He gets this, not a 404 and not an empty table.</span>
        <div className="rowflex" style={{ gap: 7, marginTop: 4 }}>
          <button className="btn btn--fill btn--sm">Request access</button>
          <span className="mute" style={{ fontSize: 11.5 }}>Ask Keval Shah or Fatima Sheikh</span>
        </div>
      </div>
    </div>
  );
  return (
    <div className="lvlmock">
      <MockTabs level={level} />
      {level === 'viewer' ? (
        <>
          <div className="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <Stat lbl="My net pay" hi="मेरा वेतन" v={lakh(100800)} sub="July 2026" kind="p" />
            <Stat lbl="Deductions" hi="कटौती" v={inr(17200)} sub="PF, PT, TDS" />
            <Stat lbl="Payslips" hi="पर्ची" v="14" sub="available" />
          </div>
          <div className="tbl" style={{ marginTop: 12 }}>
            <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.4fr) .9fr .8fr .8fr .8fr' }}>
              <span>Employee</span><span>Dept</span><span>Gross</span><span>Deductions</span><span>Net</span>
            </div>
            <div className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.4fr) .9fr .8fr .8fr .8fr' }}>
              <span className="tbl__c"><Av n={SUBJ} s={24} /><span className="tbl__t">{SUBJ} <span className="mute" style={{ fontSize: 11 }}>(you)</span></span></span>
              <span className="tbl__c"><span className="tbl__s">Legal</span></span>
              <span className="tbl__c tbl__c--num">{inr(118000)}</span>
              <span className="tbl__c tbl__c--num">{inr(17200)}</span>
              <span className="tbl__c tbl__c--num" style={{ fontWeight: 600 }}>{inr(100800)}</span>
            </div>
          </div>
          <div className="redact">
            <span>{SI.eye}</span>
            <span>The other 5 employees are not in this response at all. Viewer on Vetana is scoped to <b>your own record</b> — there is no masked row to un-mask.</span>
          </div>
        </>
      ) : (
        <>
          <div className="between" style={{ marginTop: 2 }}>
            <span className="rowflex" style={{ gap: 9 }}>
              <b style={{ fontSize: 14 }}>July 2026 run</b>
              <Tag c={canApprove ? '#A66207' : '#0082c6'}>{canApprove ? 'Awaiting your approval' : 'Prepared · awaiting approver'}</Tag>
            </span>
            <span className="mono" style={{ fontSize: 12.5, color: 'var(--on-surface-3)' }}>5 employees · {lakh(676900)} net</span>
          </div>
          <div className="tbl">
            <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.4fr) .9fr .8fr .8fr .8fr' }}>
              <span>Employee</span><span>Dept</span><span>Gross</span><span>Deductions</span><span>Net</span>
            </div>
            {PAYROLL.map(([n, d, g, ded, net]) => (
              <div key={n} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.4fr) .9fr .8fr .8fr .8fr' }}>
                <span className="tbl__c"><Av n={n} s={24} /><span className="tbl__t">{n}{n === SUBJ && <span className="mute" style={{ fontSize: 11 }}> (you)</span>}</span></span>
                <span className="tbl__c"><span className="tbl__s">{d}</span></span>
                <span className="tbl__c tbl__c--num">{inr(g)}</span>
                <span className="tbl__c tbl__c--num">{inr(ded)}</span>
                <span className="tbl__c tbl__c--num" style={{ fontWeight: 600 }}>{inr(net)}</span>
              </div>
            ))}
          </div>
          {ok.includes('structures') && (
            <div className="mockcard">
              <b style={{ fontSize: 12.5 }}>Salary structures <span className="hi mute">संरचना</span></b>
              <div className="chips" style={{ marginTop: 8 }}>
                {['Leadership · 6 components', 'Staff · 5 components', 'Intern · 3 components'].map(s => <span key={s} className="chip" style={{ fontSize: 11.5 }}>{s}</span>)}
                <button className="chip" style={{ fontSize: 11.5 }}>{I.plus} New</button>
              </div>
            </div>
          )}
          <div className="mockfoot">
            <button className="btn btn--out btn--sm">Recompute</button>
            <button className="btn btn--out btn--sm">Add adjustment</button>
            <span style={{ flex: 1 }} />
            {canApprove ? (
              <>
                <button className="btn btn--out btn--sm">Send back</button>
                <button className="btn btn--fill btn--sm">Approve &amp; release {lakh(676900)}</button>
              </>
            ) : (
              <span className="lockbtn" title={'Requires Approver on वेतन — you are ' + LVL[level][0]}>
                {SI.lock} Approve &amp; release
                <span className="lockbtn__why">Approver only</span>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RolesDegradation() {
  const [level, setLevel] = React.useState('editor');
  const d = DEG[level];
  return (
    <div className="col">
      <div className="between">
        <span className="mute" style={{ fontSize: 12.5, maxWidth: '68ch', textWrap: 'pretty' }}>
          One module, five levels, one person. Payroll is where the level model has to be exactly right — so this is the screen the model gets tested against.
          Preview subject: <b style={{ color: 'var(--on-surface)' }}>{SUBJ}</b>, Member.
        </span>
        <div className="seg">
          {LEVELS.map(l => <button key={l} className={'seg__b' + (level === l ? ' on' : '')} onClick={() => setLevel(l)}>{l === 'none' ? 'None' : LVL[l][0]}</button>)}
        </div>
      </div>
      <div className="two">
        <div className="col">
          <div className="mocklbl">
            <span className="mocklbl__t">वेतन Payroll · as seen at {LVL[level][0]}</span>
            <span className="mocklbl__n">{VET_ACCESS[level].length} of {VET_TABS.length} tabs reachable</span>
          </div>
          <VetanaMock level={level} />
        </div>
        <div className="col">
          <Card title="What this level changes" hi="अंतर">
            <div className="col" style={{ gap: 13 }}>
              <div>
                <div className="degl degl--ok">{I.check} Sees</div>
                <ul className="degul">{d.sees.map(s => <li key={s}>{s}</li>)}</ul>
              </div>
              <div>
                <div className="degl degl--no">{SI.lock} Cannot</div>
                <ul className="degul">{d.cant.map(s => <li key={s}>{s}</li>)}</ul>
              </div>
            </div>
            <div className="degnote">{d.note}</div>
          </Card>
          <Card title="Server, not screen" hi="नियम" tonal>
            <div className="mute" style={{ fontSize: 12.5, lineHeight: 1.6, textWrap: 'pretty' }}>
              Every state above is enforced in the FastAPI layer and in the Postgres row policy. The interface only reflects it.
              A hidden button is a courtesy; the request would fail anyway.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ══ Denied states — five kinds, one rule each ══
function RolesDenied({ open }) {
  const [pop, setPop] = React.useState(false);
  return (
    <div className="col">
      <span className="mute" style={{ fontSize: 12.5, maxWidth: '68ch', textWrap: 'pretty' }}>
        Five ways a permission boundary shows itself. The rule under each one is what keeps them consistent across 15 modules.
      </span>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        <div className="dnycard">
          <div className="dnycard__h">1 · Absent from the sidebar</div>
          <div className="miniside" style={{ margin: 0 }}>
            {[['कर्तव्य', 'Tasks', true], ['ग्रह', 'CRM', true], ['वेतन', 'Payroll', false], ['विक्रय', 'Sales', false]].map(([hi, en, on]) => (
              <div key={en} className={'miniside__i' + (on ? '' : ' gone')}><span className="hi">{hi}</span><span className="miniside__en">{en}</span>{!on && <span className="miniside__x">hidden</span>}</div>
            ))}
          </div>
          <div className="dnycard__r">No access means the module is <b>not there</b>. Never a greyed-out row that advertises what someone is missing.</div>
        </div>

        <div className="dnycard">
          <div className="dnycard__h">2 · Field left out, not masked</div>
          <div className="tbl" style={{ borderRadius: 'var(--r-sm)' }}>
            <div className="tbl__head" style={{ gridTemplateColumns: '1.2fr .8fr .9fr' }}><span>Employee</span><span>Dept</span><span>CTC</span></div>
            {[['Priya Nair', 'Marketing'], ['Arjun Desai', 'Sales']].map(([n, d]) => (
              <div key={n} className="tbl__row" style={{ gridTemplateColumns: '1.2fr .8fr .9fr' }}>
                <span className="tbl__c"><Av n={n} s={22} /><span className="tbl__t">{n}</span></span>
                <span className="tbl__c"><span className="tbl__s">{d}</span></span>
                <span className="tbl__c"><span className="redact__v">not available</span></span>
              </div>
            ))}
          </div>
          <div className="dnycard__r">A dotted <span className="mono">••••</span> masked value tells you the number exists and tempts a screenshot. Send the column as <b>absent</b> and say so plainly.</div>
        </div>

        <div className="dnycard">
          <div className="dnycard__h">3 · Action locked, reason attached</div>
          <div className="mockfoot" style={{ margin: 0, border: 0, background: 'var(--s-low)', borderRadius: 'var(--r-sm)' }}>
            <button className="btn btn--out btn--sm">Save draft</button>
            <span style={{ flex: 1 }} />
            <span style={{ position: 'relative' }}>
              <button className="lockbtn" onClick={() => setPop(!pop)}>{SI.lock} Approve entry</button>
              {pop && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 110 }} onClick={() => setPop(false)} />
                  <div className="pop" style={{ bottom: 'calc(100% + 8px)', right: 0, width: 262 }}>
                    <div className="pop__head">Why this is locked</div>
                    <div className="pop__body" style={{ gap: 10 }}>
                      <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>Approving a journal entry needs <b>Approver</b> on <span className="hi">गणित</span>. Your level is <Lvl v="editor" />.</div>
                      <button className="btn btn--fill btn--sm" onClick={() => { setPop(false); open('request-access'); }}>Request Approver</button>
                    </div>
                  </div>
                </>
              )}
            </span>
          </div>
          <div className="dnycard__r">A locked control stays <b>visible and explains itself</b> — including which level would unlock it and how to ask. Silence is the failure mode.</div>
        </div>

        <div className="dnycard">
          <div className="dnycard__h">4 · Deep link somebody shared</div>
          <div className="dnybox" style={{ minHeight: 168 }}>
            <span className="dnybox__ic">{SI.lock}</span>
            <b style={{ fontSize: 13.5 }}>INV-2607 is not shared with you</b>
            <span className="mute" style={{ fontSize: 12, maxWidth: '34ch', textWrap: 'pretty' }}>Aanya Mehta linked this in <span className="hi">संवाद</span> #gst-filing. You need Viewer on <span className="hi">गणित</span>.</span>
            <div className="rowflex" style={{ gap: 7, marginTop: 3 }}>
              <button className="btn btn--fill btn--sm" onClick={() => open('request-access')}>Request access</button>
              <button className="btn btn--out btn--sm">Ask Aanya</button>
            </div>
          </div>
          <div className="dnycard__r">Name the record, name the level, name a human who can grant it. The attempt is written to the audit log as a denied event.</div>
        </div>

        <div className="dnycard">
          <div className="dnycard__h">5 · Read-only, still useful</div>
          <div className="mockcard" style={{ margin: 0 }}>
            <div className="props" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="prop"><span className="prop__l">Client</span><span className="prop__v">Tata Steel</span></div>
              <div className="prop"><span className="prop__l">Value</span><span className="prop__v mono">₹18,50,000</span></div>
            </div>
            <div className="rowflex" style={{ gap: 7, marginTop: 9 }}><span className="tag" style={{ '--c': '#6E747C' }}>{SI.lock} fields read-only</span></div>
            <textarea className="inp" rows="2" placeholder="You can still comment…" style={{ marginTop: 9 }} />
          </div>
          <div className="dnycard__r">Viewer is not a dead end. Comments, mentions and thread replies stay open, so the person can still contribute what they know.</div>
        </div>

        <div className="dnycard dnycard--rule">
          <div className="dnycard__h">The rule behind all five</div>
          <div style={{ fontSize: 13, lineHeight: 1.62, textWrap: 'pretty' }}>
            A permission boundary should read as a <b>deliberate design decision</b>, not as a bug. Every denied state names the thing, names the level, and offers the next step.
            Nothing dead-ends, nothing lies, and nothing hints at data the person cannot have.
          </div>
          <div className="mute" style={{ fontSize: 11.5, marginTop: 11 }}>Research rules 6 and 14 — Flowlu’s opaque permissions, and never lying about state.</div>
        </div>
      </div>
    </div>
  );
}

// ══ Client portal role — a guest is not a small member ══
function RolesClient() {
  return (
    <div className="two">
      <div className="col">
        <div className="mocklbl"><span className="mocklbl__t">केंद्र Client Portal · as Meera Joshi sees it</span><span className="mocklbl__n">external guest</span></div>
        <div className="lvlmock">
          <div className="clihdr">
            <Mark size={26} />
            <span style={{ minWidth: 0 }}><b style={{ fontSize: 13.5, display: 'block' }}>Aekam Inc</b><span className="mute" style={{ fontSize: 11 }}>Shared with Tata Steel</span></span>
            <span style={{ marginLeft: 'auto' }}><Av n="Meera Joshi" s={26} /></span>
          </div>
          <div className="wanote" style={{ margin: '0 0 2px' }}>{SI.eye} You are viewing one shared workspace. Placeholder — you see only what Aekam has shared with you.</div>
          <div className="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <Stat lbl="Shared items" hi="साझा" v="6" sub="of 20 on this board" kind="p" />
            <Stat lbl="Invoices" hi="बीजक" v="3" sub="1 overdue" kind="warn" />
            <Stat lbl="To sign" hi="हस्ताक्षर" v="1" sub="fit-out agreement" />
          </div>
          <div className="mockcard">
            <b style={{ fontSize: 12.5 }}>Mumbai fit-out <span className="hi mute">समीक्षा</span></b>
            <div className="col" style={{ gap: 6, marginTop: 9 }}>
              {[['Site measurement sign-off', 'Shared'], ['Revised layout — v3', 'Shared'], ['Milestone 1 invoice', 'Shared']].map(([t, s]) => (
                <div key={t} className="between" style={{ padding: '7px 10px', background: 'var(--s-low)', borderRadius: 'var(--r-sm)' }}>
                  <span style={{ fontSize: 12.5 }}>{t}</span><span className="tag" style={{ '--c': '#04837A' }}>{s}</span>
                </div>
              ))}
              <div className="between" style={{ padding: '7px 10px', border: '1px dashed var(--outline-variant)', borderRadius: 'var(--r-sm)' }}>
                <span className="mute" style={{ fontSize: 12 }}>14 internal items</span><span className="mute" style={{ fontSize: 11 }}>never listed, never counted</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="col">
        <Card title="What a client can never reach" hi="सीमा">
          <div className="col" style={{ gap: 8 }}>
            {['Any module in the sidebar — a guest has no sidebar', 'Other clients, other projects, other boards', 'Internal comments, internal tasks, time entries', 'Your team list, roles, or org settings', 'Margins, cost prices, or anything from Vetana'].map(s => (
              <div key={s} className="rowflex" style={{ gap: 8, fontSize: 12.5, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }}>{SI.lock}</span><span style={{ minWidth: 0 }}>{s}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Sharing controls" hi="नियंत्रण">
          <div className="col" style={{ gap: 12 }}>
            {[['Items internal by default', 'A new task is invisible to clients until shared explicitly.', true],
              ['Client can comment', 'On shared items only.', true],
              ['Client can upload', 'Documents land in a review queue, not straight onto the board.', true],
              ['Client sees due dates', 'Off while a project is still being scoped.', false]].map(([t, d, on]) => (
              <div key={t} className="between" style={{ gap: 12, alignItems: 'flex-start' }}>
                <span style={{ minWidth: 0 }}><b style={{ fontSize: 12.5, display: 'block' }}>{t}</b><span className="mute" style={{ fontSize: 11.5, lineHeight: 1.45 }}>{d}</span></span>
                <span className={'sw' + (on ? ' on' : '')} />
              </div>
            ))}
          </div>
          <div className="degnote" style={{ marginTop: 14 }}>A guest holds no org identity. Remove them and nothing else changes — there is no member record to clean up, no grants to revoke.</div>
        </Card>
      </div>
    </div>
  );
}

// ══ Module admin panels — finance thresholds and the AI inheritance rule ══
function RolesSettings() {
  const [thr, setThr] = React.useState(100000);
  return (
    <div className="two">
      <div className="col">
        <Card title="गणित Ganit — approval rules" hi="वित्त">
          <div className="col" style={{ gap: 15 }}>
            <div>
              <div className="between" style={{ marginBottom: 8 }}>
                <span className="fld__l">Approver required above</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>{lakh(thr)}</span>
              </div>
              <input className="sld" type="range" min="10000" max="1000000" step="10000" value={thr} onChange={e => setThr(parseInt(e.target.value))} />
              <div className="mute" style={{ fontSize: 11.5, marginTop: 6 }}>Editors post entries below this freely. At or above it, an Approver on गणित must sign off.</div>
            </div>
            <div className="divider" />
            <div className="between"><span style={{ minWidth: 0 }}><b style={{ fontSize: 12.5, display: 'block' }}>Two approvers above ₹10 L</b><span className="mute" style={{ fontSize: 11.5 }}>Dual sign-off on large entries.</span></span><span className="sw on" /></div>
            <div className="between"><span style={{ minWidth: 0 }}><b style={{ fontSize: 12.5, display: 'block' }}>Lock periods after filing</b><span className="mute" style={{ fontSize: 11.5 }}>Closed to 30 Jun 2026. Admin can reopen, and it is audited.</span></span><span className="sw on" /></div>
            <div>
              <div className="fld__l" style={{ marginBottom: 8 }}>May close a period</div>
              <div className="chips">
                <span className="chip on"><Av n="Aanya Mehta" s={17} /> Aanya Mehta</span>
                <span className="chip on"><Av n="Keval Shah" s={17} /> Keval Shah</span>
                <button className="chip">{I.plus} Add</button>
              </div>
              <div className="mute" style={{ fontSize: 11.5, marginTop: 7 }}>Both hold Approver or above on गणित. Nobody else is eligible, so nobody else is listed.</div>
            </div>
          </div>
        </Card>
      </div>
      <div className="col">
        <Card title="सृजन Srijan — AI access" hi="कृत्रिम">
          <div className="degnote degnote--hi">The assistant answers with the asker’s permissions, never its own. It cannot become a way around a grant.</div>
          <div className="col" style={{ gap: 13, marginTop: 14 }}>
            <div className="aidemo">
              <div className="aidemo__q"><Av n="Rohan Iyer" s={22} /><span>“What is Priya’s CTC?”</span></div>
              <div className="aidemo__a">
                <span className="aidemo__ic">{I.ai}</span>
                <span>I can’t answer that — your access to <span className="hi">वेतन</span> Payroll is None, so salary data is outside what I can read for you. <span className="mute">Placeholder response.</span></span>
              </div>
            </div>
            <div className="divider" />
            <div>
              <div className="fld__l" style={{ marginBottom: 8 }}>Sources the assistant may read</div>
              <div className="col" style={{ gap: 6 }}>
                {[['कर्तव्य Tasks', 'per grant', true], ['ग्रह CRM', 'per grant', true], ['गणित Finance', 'per grant', true], ['वेतन Payroll', 'excluded entirely', false], ['Uploaded knowledge base', 'org-wide', true]].map(([s, m, on]) => (
                  <div key={s} className="between" style={{ padding: '8px 11px', background: on ? 'var(--s-low)' : 'var(--danger-container)', borderRadius: 'var(--r-sm)' }}>
                    <span style={{ fontSize: 12.5 }} className={s.match(/^[a-z]/i) ? '' : 'hi'}>{s}</span>
                    <span className="rowflex" style={{ gap: 8 }}><span className="mute" style={{ fontSize: 11 }}>{m}</span><span className={'sw' + (on ? ' on' : '')} style={{ width: 34, height: 20 }} /></span>
                  </div>
                ))}
              </div>
              <div className="mute" style={{ fontSize: 11.5, marginTop: 7 }}>Payroll is excluded for everyone, at every level. Some data should not be summarisable.</div>
            </div>
            <div className="between"><span style={{ minWidth: 0 }}><b style={{ fontSize: 12.5, display: 'block' }}>Members may publish bots</b><span className="mute" style={{ fontSize: 11.5 }}>Admin on सृजन only.</span></span><span className="sw" /></div>
            <div className="between"><span style={{ minWidth: 0 }}><b style={{ fontSize: 12.5, display: 'block' }}>Credit budget</b><span className="mute" style={{ fontSize: 11.5 }}>2,000 per member per month.</span></span><span className="mono" style={{ fontSize: 12.5 }}>12,400 / 24,000</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ══ Matrix as cards — the mobile form of a 6-column grid ══
function MatrixCards({ open }) {
  return (
    <div className="mtxcards">
      {MEMBERS.map(mem => (
        <div key={mem.e} className="mtxcard">
          <div className="mtxcard__h">
            <Av n={mem.n} s={30} />
            <span style={{ minWidth: 0 }}><b style={{ fontSize: 13, display: 'block' }}>{mem.n}</b><span className="mute" style={{ fontSize: 11 }}>{mem.job}</span></span>
            <span style={{ marginLeft: 'auto' }}><RoleBadge r={mem.role} /></span>
          </div>
          {ORG_ENABLED.map(code => {
            const mod = MODULES.find(x => x.code === code);
            return (
              <button key={code} className="mtxcard__r" onClick={() => open('cell', { mem, code })}>
                <span className="hi" style={{ fontSize: 13.5, color: mod.sensitive ? 'var(--danger)' : 'var(--primary)' }}>{mod.hi}</span>
                <span className="mtxcard__en">{mod.en}{mod.sensitive ? ' ⚠' : ''}</span>
                <span style={{ marginLeft: 'auto' }}><Lvl v={mem.g[code] || 'none'} /></span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ══ The agent's side of support access ══
function SupportRequest({ close }) {
  const [mods, setMods] = React.useState(['ganit']);
  const [lvl, setLvl] = React.useState('viewer');
  const [ttl, setTtl] = React.useState('2h');
  const [why, setWhy] = React.useState('');
  const toggle = c => setMods(m => m.includes(c) ? m.filter(x => x !== c) : [...m, c]);
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="sheet" style={{ width: 'min(560px, calc(100% - 48px))' }}>
        <div className="sheet__head">
          <h3 className="sheet__t">Request access</h3>
          <span className="tag" style={{ '--c': '#7c5cbf', marginLeft: 6 }}><span className="tag__dot" />Platform support</span>
          <button className="icobtn" style={{ marginLeft: 'auto' }} onClick={close}>{I.x}</button>
        </div>
        <div className="sheet__body">
          <div className="degnote degnote--hi">You hold no access to Aekam Inc. Nothing here is visible to you until an org owner or admin approves this request.</div>
          <div className="row2">
            <label className="fld"><span className="fld__l">Organisation</span><select className="inp"><option>Aekam Inc</option><option>Shreeji Traders</option><option>Nirmal Exports</option></select></label>
            <label className="fld"><span className="fld__l">Ticket</span><input className="inp mono" defaultValue="#4821" /></label>
          </div>
          <div>
            <div className="fld__l" style={{ marginBottom: 7 }}>Modules you need</div>
            <div className="col" style={{ gap: 6 }}>
              {MODULES.filter(m => ORG_ENABLED.includes(m.code)).map(m => (
                <button key={m.code} className="between" style={{ padding: '9px 11px', borderRadius: 'var(--r-sm)', background: mods.includes(m.code) ? 'var(--primary-container)' : 'var(--s-low)', textAlign: 'left' }} onClick={() => toggle(m.code)}>
                  <span className="rowflex" style={{ gap: 8 }}>
                    <span style={{ width: 15, height: 15, borderRadius: 4, background: mods.includes(m.code) ? 'var(--primary)' : 'transparent', border: '1.5px solid ' + (mods.includes(m.code) ? 'var(--primary)' : 'var(--outline)'), color: '#fff', fontSize: 10, display: 'grid', placeItems: 'center' }}>{mods.includes(m.code) ? '✓' : ''}</span>
                    <b className="hi" style={{ fontSize: 14 }}>{m.hi}</b><span style={{ fontSize: 12.5 }}>{m.en}</span>
                  </span>
                  {m.sensitive && <span className="tag" style={{ '--c': '#B42318' }}>Sensitive</span>}
                </button>
              ))}
            </div>
            <div className="mute" style={{ fontSize: 11.5, marginTop: 7 }}>Ask for the fewest modules that reproduce the problem. Broad requests get declined.</div>
          </div>
          <div className="row2">
            <div><div className="fld__l" style={{ marginBottom: 7 }}>Level</div>
              <div className="seg" style={{ width: '100%' }}>{['viewer', 'editor'].map(l => <button key={l} className={'seg__b' + (lvl === l ? ' on' : '')} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setLvl(l)}>{LVL[l][0]}</button>)}</div>
            </div>
            <div><div className="fld__l" style={{ marginBottom: 7 }}>Duration</div>
              <div className="seg" style={{ width: '100%' }}>{['2h', '24h', '7d'].map(v => <button key={v} className={'seg__b' + (ttl === v ? ' on' : '')} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setTtl(v)}>{v}</button>)}</div>
            </div>
          </div>
          <label className="fld"><span className="fld__l">Why you need it — the customer reads this</span>
            <textarea className="inp" rows="3" value={why} onChange={e => setWhy(e.target.value)} placeholder="Ticket #4821 — GSTR-3B totals do not match the invoice list. I need the July invoices and the reconciliation to reproduce it." />
            <span className="mute" style={{ fontSize: 11.5 }}>Shown verbatim in their approval screen. No reason, no request.</span>
          </label>
          <div className="rowflex" style={{ gap: 9, padding: '10px 12px', background: 'var(--warn-container)', borderRadius: 'var(--r-sm)', fontSize: 12, lineHeight: 1.5 }}>
            {I.clock}<span>Every record you open during the session is written to <b>their</b> audit log with your name. They can revoke at any moment.</span>
          </div>
        </div>
        <div className="sheet__foot">
          <span className="mute" style={{ fontSize: 11.5, marginRight: 'auto' }}>{mods.length} module{mods.length === 1 ? '' : 's'} · {LVL[lvl][0]} · {ttl}</span>
          <button className="btn btn--out btn--sm" onClick={close}>Cancel</button>
          <button className="btn btn--fill btn--sm" disabled={!mods.length} onClick={close}>Send request</button>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { RolesDegradation, RolesDenied, RolesClient, RolesSettings, MatrixCards, SupportRequest, VetanaMock, DEG, VET_ACCESS });
