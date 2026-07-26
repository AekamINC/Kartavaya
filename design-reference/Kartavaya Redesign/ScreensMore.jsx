// Dristi, Manav, Vetana, Prachar, Srijan, Hub, eSign (Sanvaad lives in ScreensSanvaad.jsx)
// ── Dristi (Reports) — canvas model with in-place config ───────────────
function ScreenDristi() {
  const [sel, setSel] = React.useState(0);
  const [tab, setTab] = React.useState('dashboards');
  const CHARTS = [
    { t: 'Revenue by month', hi: 'मासिक राजस्व', kind: 'bar', src: 'Invoices', dim: 'Month', met: 'Sum of total' },
    { t: 'Pipeline by stage', hi: 'चरण अनुसार', kind: 'funnel', src: 'Deals', dim: 'Stage', met: 'Sum of value' },
    { t: 'Collection ageing', hi: 'प्राप्य आयु', kind: 'bar', src: 'Invoices', dim: 'Age bucket', met: 'Sum of due' },
    { t: 'Team utilisation', hi: 'उपयोग', kind: 'row', src: 'Time entries', dim: 'Member', met: 'Billable hours' },
  ];
  return (
    <div className="screen">
      <PH kick="Growth · वृद्धि" hi="दृष्टि" en="Reports"
        lede="Configure the chart where it sits. No jumping to a separate query console."
        right={<><button className="btn btn--out btn--sm">{I.doc} Export</button><button className="btn btn--fill btn--sm">{I.plus} Add chart</button></>} />
      <TabBar tabs={MODULE_TABS.dristi} val={tab} set={setTab} />
      {!['dashboards', 'overview', 'reports', 'pivot'].includes(tab) && <TabStub tab={tab} module="दृष्टि Reports" />}
      {tab === 'pivot' && <DristiPivot />}
      {tab !== 'pivot' && <div className="two">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px,1fr))' }}>
          {CHARTS.map((c, i) => (
            <button key={c.t} className="card" onClick={() => setSel(i)} style={{ padding: 'var(--pad-card)', textAlign: 'left', borderColor: sel === i ? 'var(--primary)' : undefined }}>
              <div className="between"><span><b style={{ fontSize: 13.5 }}>{c.t}</b> <span className="hi mute" style={{ fontSize: 12 }}>{c.hi}</span></span><span className="mute">{I.dots}</span></div>
              {c.kind === 'bar' && (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 92, marginTop: 14 }}>
                  {[48, 62, 41, 78, 66, 88, 71, 94].map((h, j) => <div key={j} style={{ flex: 1, height: h + '%', background: j === 7 ? 'var(--primary)' : 'var(--primary-container)', borderRadius: '3px 3px 0 0' }} />)}
                </div>
              )}
              {c.kind === 'funnel' && (
                <div className="col" style={{ gap: 4, marginTop: 14 }}>
                  {[100, 78, 54, 38, 22].map((w, j) => <div key={j} style={{ width: w + '%', height: 14, background: 'var(--primary)', opacity: 1 - j * .15, borderRadius: 3 }} />)}
                </div>
              )}
              {c.kind === 'row' && (
                <div className="col" style={{ gap: 7, marginTop: 14 }}>
                  {[['Keval', 92], ['Aanya', 78], ['Rohan', 64], ['Priya', 51]].map(([n, v]) => (
                    <div key={n} className="rowflex" style={{ gap: 8 }}>
                      <span className="mute" style={{ fontSize: 11, width: 46 }}>{n}</span>
                      <span className="meter" style={{ flex: 1 }}><span className="meter__f" style={{ width: v + '%', display: 'block' }} /></span>
                      <span className="mono" style={{ fontSize: 11 }}>{v}%</span>
                    </div>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
        <Card title="Configure" hi="विन्यास" right={<span className="mute" style={{ fontSize: 11.5 }}>in place</span>}>
          <div className="col" style={{ gap: 13 }}>
            <div className="fld"><span className="fld__l">Source</span><select className="inp" defaultValue={CHARTS[sel].src}><option>{CHARTS[sel].src}</option><option>Deals</option><option>Tasks</option><option>Time entries</option></select></div>
            <div className="fld"><span className="fld__l">Dimension</span><select className="inp" defaultValue={CHARTS[sel].dim}><option>{CHARTS[sel].dim}</option></select></div>
            <div className="fld"><span className="fld__l">Measure</span><select className="inp" defaultValue={CHARTS[sel].met}><option>{CHARTS[sel].met}</option></select></div>
            <div className="fld"><span className="fld__l">Chart type</span>
              <div className="seg" style={{ width: '100%' }}>{['Bar', 'Line', 'Funnel', 'Table'].map((t, i) => <button key={t} className={'seg__b' + (i === 0 ? ' on' : '')} style={{ flex: 1, justifyContent: 'center' }}>{t}</button>)}</div>
            </div>
            <div className="divider" />
            <button className="btn btn--tonal" style={{ width: '100%' }}>Add to dashboard</button>
            <button className="btn btn--out" style={{ width: '100%' }}>Share with CA</button>
          </div>
        </Card>
      </div>}
    </div>
  );
}

// ── Manav (HRMS) ───────────────────────────────────────────────────────
function ScreenManav() {
  const [tab, setTab] = React.useState('employees');
  const ST = { in: ['Present', '#04837A'], leave: ['On leave', '#A66207'], wfh: ['WFH', '#0082c6'] };
  return (
    <div className="screen">
      <PH kick="People · जन" hi="मानव" en="HRMS"
        lede="Fix attendance and approve leave from the row where you see the problem."
        right={<button className="btn btn--fill btn--sm">{I.plus} Add employee</button>} />
      <div className="stats">
        <Stat kind="ok" lbl="Present" hi="उपस्थित" v="4" sub="of 6" />
        <Stat kind="warn" lbl="On leave" hi="अवकाश" v="1" sub="Rohan · till Fri" />
        <Stat kind="p" lbl="WFH" hi="गृहकार्य" v="1" />
        <Stat kind="danger" lbl="Needs correction" hi="सुधार" v="2" sub="missed punch-out" />
      </div>
      <TabBar tabs={MODULE_TABS.manav} val={tab} set={setTab} counts={{ employees: TEAM.length, leaves: 3 }} />
      {!['employees', 'attendance', 'leaves'].includes(tab) && <TabStub tab={tab} module="मानव HRMS" />}
      {tab === 'leaves' && <ManavLeaves />}
      {['employees', 'attendance'].includes(tab) && <div className="tbl">
        <div className="tbl__scroll">
          <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.4fr) 130px 120px 110px minmax(0,1fr)' }}>
            <span>Employee</span><span>Department</span><span>Location</span><span>Status</span><span>Today</span>
          </div>
          {TEAM.map(m => {
            const [lbl, c] = ST[m.status];
            const bad = m.n === 'Priya Nair' || m.n === 'Fatima Sheikh';
            return (
              <div key={m.n} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.4fr) 130px 120px 110px minmax(0,1fr)' }}>
                <span className="tbl__c"><Av n={m.n} s={28} /><span style={{ minWidth: 0 }}><span className="tbl__t" style={{ display: 'block' }}>{m.n}</span><span className="tbl__s hi">{m.hi}</span></span></span>
                <span className="tbl__c"><span className="tbl__s">{m.dept}</span></span>
                <span className="tbl__c"><span className="tbl__s">{m.city}</span></span>
                <span className="tbl__c"><Tag c={c}>{lbl}</Tag></span>
                <span className="tbl__c">
                  {bad
                    ? <><span className="mono" style={{ fontSize: 12, color: 'var(--warn)' }}>09:14 — missing</span><button className="btn btn--out btn--sm" style={{ marginLeft: 'auto' }}>Fix</button></>
                    : <span className="mono" style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>09:02 — 18:40</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>}
    </div>
  );
}

// ── Vetana (Payroll) ───────────────────────────────────────────────────
function ScreenVetana({ open }) {
  const [tab, setTab] = React.useState('payroll');
  return (
    <div className="screen">
      <PH kick="People · जन" hi="वेतन" en="Payroll"
        lede="July run reads directly from Manav attendance — no re-entry, no second system."
        right={<button className="btn btn--fill btn--sm" onClick={() => open('payrun')}>Run payroll</button>} />
      <div className="stats">
        <Stat kind="p" lbl="Gross (July)" hi="सकल" v={lakh(842000)} sub="6 employees" />
        <Stat lbl="Deductions" hi="कटौती" v={lakh(118400)} sub="PF · ESI · TDS" />
        <Stat kind="ok" lbl="Net payable" hi="देय" v={lakh(723600)} />
        <Stat kind="warn" lbl="Compliance due" hi="अनुपालन" v="15 Aug" sub="PF challan" />
      </div>
      <TabBar tabs={MODULE_TABS.vetana} val={tab} set={setTab} />
      {!['payroll', 'dashboard', 'statutory'].includes(tab) && <TabStub tab={tab} module="वेतन Payroll" />}
      {tab === 'statutory' && <VetanaStatutory />}
      {tab !== 'statutory' && <div className="two">
        <Card title="July run" hi="जुलाई" flush right={<Tag c="#A66207">Awaiting approval</Tag>}>
          <div className="tbl__scroll">
            <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.3fr) 100px 110px 110px 110px' }}>
              <span>Employee</span><span style={{ textAlign: 'right' }}>Days</span><span style={{ textAlign: 'right' }}>Gross</span><span style={{ textAlign: 'right' }}>Deduct</span><span style={{ textAlign: 'right' }}>Net</span>
            </div>
            {TEAM.map((m, i) => {
              const gross = [180000, 145000, 120000, 132000, 110000, 155000][i];
              const ded = Math.round(gross * .14);
              return (
                <div key={m.n} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.3fr) 100px 110px 110px 110px' }}>
                  <span className="tbl__c"><Av n={m.n} s={26} /><span className="tbl__t">{m.n}</span></span>
                  <span className="tbl__c tbl__c--num mute">{m.status === 'leave' ? '28' : '31'}</span>
                  <span className="tbl__c tbl__c--num">{inr(gross)}</span>
                  <span className="tbl__c tbl__c--num mute">−{inr(ded)}</span>
                  <span className="tbl__c tbl__c--num"><b>{inr(gross - ded)}</b></span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Source" hi="स्रोत">
          <div className="col" style={{ gap: 11 }}>
            <div className="rowflex" style={{ gap: 9, padding: '10px 12px', background: 'var(--ok-container)', borderRadius: 'var(--r-sm)' }}>
              <span style={{ color: 'var(--ok)' }}>{I.check}</span>
              <span style={{ fontSize: 12.5 }}>Attendance imported from <b>मानव</b> · 31 Jul</span>
            </div>
            <button className="btn btn--out btn--sm" style={{ width: '100%' }}>View attendance source</button>
            <div className="divider" />
            <div className="col" style={{ gap: 8 }}>
              {[['PF challan', '15 Aug'], ['ESI return', '15 Aug'], ['TDS 24Q', '31 Oct']].map(([l, d]) => (
                <div key={l} className="between" style={{ fontSize: 12.5 }}><span>{l}</span><span className="mono mute">{d}</span></div>
              ))}
            </div>
          </div>
        </Card>
      </div>}
    </div>
  );
}

// ── Prachar (Marketing) ────────────────────────────────────────────────
function ScreenPrachar() {
  const [tab, setTab] = React.useState('campaigns');
  const CH = { ig: ['Instagram', '#c2703c'], li: ['LinkedIn', '#0082c6'], wa: ['WhatsApp', '#04837A'], fb: ['Facebook', '#5b6ee0'] };
  const POSTS = { 4: [['ig', 'Diwali teaser'], ['li', 'Case study']], 7: [['wa', 'Offer blast']], 11: [['ig', 'Reel — office'], ['fb', 'Album']], 14: [['ig', 'Diwali launch'], ['li', 'Launch note'], ['wa', 'Catalogue'], ['fb', 'Launch post']], 18: [['li', 'Hiring post']], 22: [['ig', 'Testimonial']] };
  return (
    <div className="screen">
      <PH kick="Growth · वृद्धि" hi="प्रचार" en="Marketing"
        lede="Drag to reschedule. Channel dots in month view, full previews in week view."
        right={<><Seg opts={[{ id: 'm', l: 'Month' }, { id: 'w', l: 'Week' }]} val="m" set={() => { }} /><button className="btn btn--fill btn--sm">{I.plus} Schedule</button></>} />
      <TabBar tabs={MODULE_TABS.prachar} val={tab} set={setTab} />
      {!['campaigns', 'dashboard', 'templates'].includes(tab) && <TabStub tab={tab} module="प्रचार Marketing" />}
      {tab === 'templates' && <PracharTemplates />}
      {tab !== 'templates' && <><div className="chips">
        {Object.entries(CH).map(([k, [n, c]]) => <button key={k} className="chip on" style={{ background: 'color-mix(in srgb,' + c + ' 15%, transparent)', color: c }}><span className="chip__dot" style={{ background: c }} />{n}</button>)}
        <button className="chip">All campaigns</button>
      </div>
      <Card flush>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid var(--outline-variant)' }}>
          {['सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'रवि'].map(d => (
            <div key={d} className="hi" style={{ padding: '9px 0', textAlign: 'center', fontSize: 12, color: 'var(--on-surface-3)' }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
          {Array.from({ length: 28 }, (_, i) => {
            const day = i + 1, posts = POSTS[day] || [];
            return (
              <div key={i} style={{ minHeight: 88, padding: 7, borderRight: (i + 1) % 7 ? '1px solid var(--outline-variant)' : 0, borderBottom: '1px solid var(--outline-variant)', background: day === 14 ? 'var(--primary-container)' : undefined }}>
                <div className="mono" style={{ fontSize: 11, color: day === 14 ? 'var(--on-primary-container)' : 'var(--on-surface-3)', fontWeight: day === 14 ? 700 : 400 }}>{day}</div>
                <div className="col" style={{ gap: 3, marginTop: 5 }}>
                  {posts.map(([c, t], j) => (
                    <div key={j} className="rowflex" style={{ gap: 4, fontSize: 10.5, padding: '2px 5px', background: 'color-mix(in srgb,' + CH[c][1] + ' 16%, transparent)', borderRadius: 4, color: CH[c][1], fontWeight: 600 }}>
                      <span style={{ width: 5, height: 5, borderRadius: 9, background: CH[c][1], flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card></>}
    </div>
  );
}

// ── Srijan (AI Hub) ────────────────────────────────────────────────────
function ScreenSrijan() {
  const [tab, setTab] = React.useState('skills');
  const SKILLS = [
    ['Payment reminder writer', 'लेखक', 'Drafts WhatsApp reminders citing MSME terms', 34],
    ['GST notice explainer', 'व्याख्या', 'Plain-language summary of a GST notice', 12],
    ['Proposal drafter', 'प्रस्ताव', 'Builds a quote from a deal + past pricing', 21],
    ['Contact enricher', 'संवर्धन', 'Fills GSTIN, address and sector from a name', 58],
    ['Meeting note taker', 'टिप्पणी', 'Turns call notes into tasks with owners', 40],
    ['Invoice OCR', 'पठन', 'Reads purchase bills into Ganit entries', 96],
  ];
  return (
    <div className="screen">
      <PH kick="Growth · वृद्धि" hi="सृजन" en="AI Hub"
        lede="Skills run against your own data. Each one shows what it touched."
        right={<button className="btn btn--fill btn--sm">{I.plus} New skill</button>} />
      <div className="stats">
        <Stat kind="p" lbl="Runs this month" hi="प्रयोग" v="261" trend={18} />
        <Stat kind="ok" lbl="Hours saved" hi="बचत" v="~34" sub="estimated" />
        <Stat lbl="Active skills" hi="सक्रिय" v="6" />
        <Stat kind="warn" lbl="Needs review" hi="समीक्षा" v="3" sub="low confidence" />
      </div>
      <TabBar tabs={MODULE_TABS.srijan} val={tab} set={setTab} counts={{ skills: 6 }} />
      {!['skills', 'credits'].includes(tab) && <TabStub tab={tab} module="सृजन AI Hub" />}
      {tab === 'credits' && <SrijanCredits />}
      {tab === 'skills' && <div className="grid">
        {SKILLS.map(([t, hi, d, runs]) => (
          <button key={t} className="card" style={{ padding: 'var(--pad-card)', textAlign: 'left' }}>
            <div className="between"><span className="rowflex" style={{ gap: 8 }}><span style={{ color: 'var(--primary-text)' }}>{I.ai}</span><b style={{ fontSize: 13.5 }}>{t}</b></span><span className="hi mute" style={{ fontSize: 12 }}>{hi}</span></div>
            <div className="mute" style={{ fontSize: 12, marginTop: 7, lineHeight: 1.5 }}>{d}</div>
            <div className="between" style={{ marginTop: 12 }}><span className="mono mute" style={{ fontSize: 11 }}>{runs} runs</span><Tag c="#04837A">Active</Tag></div>
          </button>
        ))}
      </div>}
    </div>
  );
}

// ── Hub (Client Portal) — one page, less chrome ────────────────────────
function ScreenHub() {
  const [tab, setTab] = React.useState('content');
  return (
    <div className="screen">
      <PH kick="Clients · ग्राहक" hi="केंद्र" en="Client Portal"
        lede="What Tata Steel sees when they log in. Deliberately calmer than the internal UI."
        right={<button className="btn btn--out btn--sm">Preview as client</button>} />
      <div className="card card--tonal" style={{ padding: 'var(--pad-card)' }}>
        <div className="between">
          <div>
            <div className="mute" style={{ fontSize: 11, letterSpacing: '.15em', textTransform: 'uppercase', fontWeight: 700 }}>Client workspace</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, marginTop: 4 }}>Tata Steel — Mumbai</div>
          </div>
          <Avs list={['Meera Joshi', 'Keval Shah']} max={2} s={30} />
        </div>
      </div>
      <TabBar tabs={MODULE_TABS.hub} val={tab} set={setTab} />
      {!['content', 'publish'].includes(tab) && <TabStub tab={tab} module="केंद्र Client Portal" />}
      {tab === 'publish' && <HubPublish />}
      {tab !== 'publish' && <div className="two">
        <div className="col">
          <Card title="Project status" hi="स्थिति">
            <div className="between" style={{ marginBottom: 10 }}><span style={{ fontSize: 13 }}>Office fit-out — Phase 2</span><b className="mono">62%</b></div>
            <div className="meter"><div className="meter__f" style={{ width: '62%' }} /></div>
            <div className="col" style={{ gap: 0, marginTop: 16 }}>
              {[['Site survey', 'done'], ['Design sign-off', 'done'], ['Procurement', 'doing'], ['Installation', 'todo'], ['Handover', 'todo']].map(([t, s], i) => {
                const [lbl, hi, c] = STATUS[s];
                return (
                  <div key={t} className="between" style={{ padding: '10px 0', borderBottom: i < 4 ? '1px solid var(--outline-variant)' : 0 }}>
                    <span className="rowflex" style={{ gap: 9 }}><i className="pdot" style={{ background: c }} /><span style={{ fontSize: 13 }}>{t}</span></span>
                    <Tag c={c}>{lbl}</Tag>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title="Documents" hi="दस्तावेज़" flush>
            {[['Fit-out agreement', 'Signed · 12 Jun'], ['Phase 2 quote', 'Signed · 2 Jul'], ['INV-2607', 'Awaiting payment']].map(([t, s], i) => (
              <div key={t} className="between" style={{ padding: '12px var(--pad-card)', borderBottom: i < 2 ? '1px solid var(--outline-variant)' : 0 }}>
                <span className="rowflex" style={{ gap: 10 }}><span className="mute">{I.doc}</span><span style={{ minWidth: 0 }}><b style={{ fontSize: 13, display: 'block' }}>{t}</b><span className="mute" style={{ fontSize: 11.5 }}>{s}</span></span></span>
                <button className="btn btn--out btn--sm">Open</button>
              </div>
            ))}
          </Card>
        </div>
        <div className="col">
          <Card title="Next payment" hi="भुगतान">
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: 'var(--warn)' }}>{inr(501500)}</div>
            <div className="mute" style={{ fontSize: 12.5, marginTop: 3 }}>INV-2607 · 12 days overdue</div>
            <button className="btn btn--fill" style={{ width: '100%', marginTop: 14 }}>Pay by UPI</button>
            <button className="btn btn--out" style={{ width: '100%', marginTop: 8 }}>Download invoice</button>
          </Card>
          <Card title="Requests" hi="अनुरोध">
            <Empty ic={I.check} t="Nothing pending" s="Raise a change request and it lands in the team's approvals queue." action={<button className="btn btn--tonal btn--sm" style={{ marginTop: 8 }}>{I.plus} New request</button>} />
          </Card>
        </div>
      </div>}
    </div>
  );
}

// ── eSign ──────────────────────────────────────────────────────────────
function ScreenEsign({ open }) {
  const [tab, setTab] = React.useState('documents');
  const DOCS = [
    { id: 'DOC-441', t: 'Fit-out agreement — Phase 2', co: 'Tata Steel', st: 'signed', when: '2 Jul' },
    { id: 'DOC-440', t: 'Vendor agreement v2', co: 'Nirmal Exports', st: 'sent', when: '6d ago' },
    { id: 'DOC-439', t: 'NDA — consulting', co: 'Wipro Consumer', st: 'viewed', when: '2d ago' },
    { id: 'DOC-438', t: 'Retainer — quarterly GST', co: 'Saraswati Textiles', st: 'draft', when: 'Draft' },
  ];
  const DST = { draft: ['Draft', '#8E8D87'], sent: ['Sent', '#0082c6'], viewed: ['Viewed', '#7c5cbf'], signed: ['Signed', '#04837A'] };
  return (
    <div className="screen">
      <PH kick="Clients · ग्राहक" hi="हस्ताक्षर" en="eSign"
        lede="Signing happens inside the portal — the signer never leaves Kartavaya."
        right={<button className="btn btn--fill btn--sm" onClick={() => open('sign')}>{I.plus} Send for signature</button>} />
      <TabBar tabs={MODULE_TABS.esign} val={tab} set={setTab} max={2} counts={{ documents: 4 }} />
      {tab === 'create' && <EsignCreate />}
      {tab !== 'create' && <div className="two">
        <Card flush>
          <div className="tbl__scroll">
            <div className="tbl__head" style={{ gridTemplateColumns: '92px minmax(0,1.6fr) minmax(0,1fr) 110px 90px' }}>
              <span>Doc</span><span>Title</span><span>Party</span><span>Status</span><span>When</span>
            </div>
            {DOCS.map(d => {
              const [lbl, c] = DST[d.st];
              return (
                <button key={d.id} className="tbl__row" style={{ gridTemplateColumns: '92px minmax(0,1.6fr) minmax(0,1fr) 110px 90px' }} onClick={() => open('sign', d)}>
                  <span className="tbl__c"><span className="tbl__id">{d.id}</span></span>
                  <span className="tbl__c"><span className="tbl__t">{d.t}</span></span>
                  <span className="tbl__c"><span className="tbl__s">{d.co}</span></span>
                  <span className="tbl__c"><Tag c={c}>{lbl}</Tag></span>
                  <span className="tbl__c"><span className="tbl__s mono">{d.when}</span></span>
                </button>
              );
            })}
          </div>
        </Card>
        <Card title="Audit trail" hi="अभिलेख" right={<span className="mute mono" style={{ fontSize: 11 }}>DOC-441</span>}>
          <div className="col" style={{ gap: 0 }}>
            {[['Created by Keval Shah', '28 Jun · 14:02'], ['Recipient verified — Meera Joshi', '28 Jun · 14:03'], ['Sent via WhatsApp', '28 Jun · 14:03'], ['Opened (IP 49.36.x.x)', '30 Jun · 09:41'], ['Signed — OTP verified', '2 Jul · 11:16'], ['Sealed PDF generated', '2 Jul · 11:16']].map(([t, when], i, a) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, paddingBottom: i < a.length - 1 ? 14 : 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 9, background: i === a.length - 1 ? 'var(--ok)' : 'var(--primary)', flexShrink: 0, marginTop: 4 }} />
                  {i < a.length - 1 && <span style={{ flex: 1, width: 1, background: 'var(--outline-variant)', marginTop: 3 }} />}
                </div>
                <div><div style={{ fontSize: 12.5, fontWeight: 500 }}>{t}</div><div className="mute mono" style={{ fontSize: 10.5, marginTop: 1 }}>{when}</div></div>
              </div>
            ))}
          </div>
        </Card>
      </div>}
    </div>
  );
}

Object.assign(window, { ScreenDristi, ScreenManav, ScreenVetana, ScreenPrachar, ScreenSrijan, ScreenHub, ScreenEsign });
