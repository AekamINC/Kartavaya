// Aekam platform console — cross-org. Deliberately NOT the tenant app.
// Grounded in AdminOrgsPage / AdminBillingPage / AdminCostDashboardPage on staging.
const ORGS_ALL = [
  { n: 'Aekam Inc', own: 'keval@aekam.co', plan: 'internal', users: 6, mods: 6, credits: 4820, cap: 5000, cost: 18400, billed: 0, mrr: 0, st: 'active', own_org: true },
  { n: 'Saraswati Textiles', own: 'ramesh@saraswatitextiles.in', plan: 'growth', users: 14, mods: 5, credits: 3120, cap: 4000, cost: 11200, billed: 14560, mrr: 24000, st: 'active' },
  { n: 'Nirmal Exports', own: 'accounts@nirmalexports.com', plan: 'starter', users: 4, mods: 3, credits: 480, cap: 500, cost: 2100, billed: 2730, mrr: 10000, st: 'active' },
  { n: 'Labofab India', own: 'admin@labofab.in', plan: 'growth', users: 22, mods: 7, credits: 5940, cap: 6000, cost: 21800, billed: 28340, mrr: 24000, st: 'active' },
  { n: 'Kalyan Jewellers', own: 'it@kalyan.co.in', plan: 'starter', users: 9, mods: 4, credits: 120, cap: 500, cost: 620, billed: 806, mrr: 10000, st: 'trial' },
  { n: 'Bharat Forge', own: 'sunita@bharatforge.com', plan: 'free', users: 2, mods: 1, credits: 0, cap: 100, cost: 0, billed: 0, mrr: 0, st: 'suspended' },
];
const PLAN_C = { internal: '#7c5cbf', growth: '#04837A', starter: '#0082c6', free: '#8E8D87' };
const ST_C = { active: '#04837A', trial: '#A66207', suspended: '#B42318' };

function ScreenPlatform({ open }) {
  const [tab, setTab] = React.useState('orgs');
  const TABS = ['orgs', 'billing', 'ai cost', 'support sessions', 'diagnostics', 'plans'];
  const totalMrr = ORGS_ALL.reduce((a, o) => a + o.mrr, 0);
  const totalCost = ORGS_ALL.reduce((a, o) => a + o.cost, 0);
  const totalBilled = ORGS_ALL.reduce((a, o) => a + o.billed, 0);

  return (
    <div className="screen">
      <PH kick="Aekam platform · मंच" hi="प्रशासन" en="Platform console"
        lede="Every organisation on Kartavaya. This is Aekam's own surface — customers never see it."
        right={<><button className="btn btn--out btn--sm">{I.doc} Export</button><button className="btn btn--fill btn--sm" onClick={() => open('new-org')}>{I.plus} New org</button></>} />

      <div className="stats">
        <Stat kind="p" lbl="Organisations" hi="संस्थाएँ" v={ORGS_ALL.length} sub="4 active · 1 trial · 1 suspended" />
        <Stat kind="ok" lbl="MRR" hi="मासिक" v={lakh(totalMrr)} trend={12} />
        <Stat kind="t" lbl="AI cost" hi="लागत" v={inr(totalCost)} sub="real spend, 30d" />
        <Stat kind="ok" lbl="AI billed" hi="वसूली" v={inr(totalBilled)} sub={'margin ' + Math.round((1 - totalCost / totalBilled) * 100) + '%'} />
        <Stat kind="warn" lbl="Overdue" hi="बकाया" v="2" sub={inr(38600)} />
      </div>

      <TabBar tabs={TABS} val={tab} set={setTab} counts={{ orgs: ORGS_ALL.length, 'support sessions': 2 }} />

      {tab === 'orgs' && (
        <div className="tbl">
          <div className="tbl__scroll">
            <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.5fr) 96px 74px 74px 128px 92px 88px' }}>
              <span>Organisation</span><span>Plan</span><span className="tbl__c--num">Users</span><span className="tbl__c--num">Modules</span><span>Credits</span><span>Status</span><span></span>
            </div>
            {ORGS_ALL.map(o => (
              <div key={o.n} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.5fr) 96px 74px 74px 128px 92px 88px' }}>
                <span className="tbl__c">
                  <Av n={o.n} s={28} c={PLAN_C[o.plan]} />
                  <span style={{ minWidth: 0 }}>
                    <span className="tbl__t" style={{ display: 'block' }}>{o.n}{o.own_org && <span className="tag" style={{ '--c': '#7c5cbf', marginLeft: 7 }}>us</span>}</span>
                    <span className="tbl__s">{o.own}</span>
                  </span>
                </span>
                <span className="tbl__c"><Tag c={PLAN_C[o.plan]}>{o.plan}</Tag></span>
                <span className="tbl__c tbl__c--num">{o.users}</span>
                <span className="tbl__c tbl__c--num">{o.mods}/11</span>
                <span className="tbl__c" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>
                  <span className="mono" style={{ fontSize: 11, color: o.credits / o.cap > .9 ? 'var(--warn)' : 'var(--on-surface-3)' }}>{o.credits} / {o.cap}</span>
                  <span className="meter" style={{ height: 4 }}><span className="meter__f" style={{ display: 'block', width: Math.min(100, o.credits / o.cap * 100) + '%', background: o.credits / o.cap > .9 ? 'var(--warn)' : 'var(--primary)' }} /></span>
                </span>
                <span className="tbl__c"><Tag c={ST_C[o.st]}>{o.st}</Tag></span>
                <span className="tbl__c"><button className="btn btn--out btn--sm" onClick={() => open('org-detail', o)}>Open</button></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'ai cost' && (
        <>
          <div className="rowflex" style={{ gap: 9, padding: '10px 13px', background: 'var(--danger-container)', borderRadius: 'var(--r-md)', fontSize: 12.5, alignItems: 'flex-start' }}>
            <span style={{ flexShrink: 0 }}>⚠</span>
            <span><b>Platform-only figures.</b> Real provider cost and margin must never appear in a tenant's Billing screen — tenants see billed credits only.</span>
          </div>
          <div className="two">
            <Card title="Cost vs billed" hi="लागत" right={<Seg opts={[{ id: 'm', l: '30d' }, { id: 'q', l: 'Quarter' }]} val="m" set={() => { }} />}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 150, padding: '4px 0' }}>
                {ORGS_ALL.filter(o => o.billed > 0).map(o => (
                  <div key={o.n} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 3, height: '100%' }} title={o.n}>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', flex: 1 }}>
                      <div style={{ flex: 1, height: (o.cost / 30000 * 100) + '%', background: 'var(--tertiary-container)', borderRadius: '3px 3px 0 0' }} />
                      <div style={{ flex: 1, height: (o.billed / 30000 * 100) + '%', background: 'var(--primary)', borderRadius: '3px 3px 0 0' }} />
                    </div>
                    <span className="mute" style={{ fontSize: 9.5, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.n.split(' ')[0]}</span>
                  </div>
                ))}
              </div>
              <div className="between" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--outline-variant)' }}>
                <span className="rowflex" style={{ fontSize: 12 }}><i className="chip__dot" style={{ background: 'var(--tertiary-container)' }} /> Provider cost <b className="mono">{inr(totalCost)}</b></span>
                <span className="rowflex" style={{ fontSize: 12 }}><i className="chip__dot" style={{ background: 'var(--primary)' }} /> Billed <b className="mono">{inr(totalBilled)}</b></span>
                <span style={{ fontSize: 12 }}>Margin <b className="mono" style={{ color: 'var(--ok)' }}>{inr(totalBilled - totalCost)}</b></span>
              </div>
            </Card>
            <div className="col">
              <Card title="Markup" hi="अधिभार">
                <div className="fld"><div className="between"><span className="fld__l">Default markup on AI credits</span><span className="mono" style={{ fontSize: 12 }}>30%</span></div><input className="sld" type="range" min="0" max="100" step="5" defaultValue="30" /></div>
                <div className="mute" style={{ fontSize: 11.5, marginTop: 7 }}>Set per org at creation as <span className="mono">markup_pct</span>. Changing the default doesn't alter existing orgs.</div>
              </Card>
              <Card title="Model routing" hi="मार्ग" right={<span className="tag" style={{ '--c': '#7c5cbf' }}>srijan_admin</span>}>
                <div className="col" style={{ gap: 8 }}>
                  {[['Drafting & summaries', 'Haiku', '₹0.42 / 1k'], ['Reasoning & analysis', 'Sonnet', '₹2.10 / 1k'], ['OCR & extraction', 'Haiku + vision', '₹0.68 / 1k']].map(([task, model, rate]) => (
                    <div key={task} className="between" style={{ padding: '9px 11px', background: 'var(--s-low)', borderRadius: 'var(--r-sm)' }}>
                      <span style={{ minWidth: 0 }}><b style={{ fontSize: 12.5, display: 'block' }}>{task}</b><span className="mute" style={{ fontSize: 11 }}>{model}</span></span>
                      <span className="mono" style={{ fontSize: 11.5 }}>{rate}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      {tab === 'billing' && (
        <>
          <div className="rowflex" style={{ gap: 9, padding: '10px 13px', background: 'var(--warn-container)', borderRadius: 'var(--r-md)', fontSize: 12.5 }}>
            {I.clock}<span><b>2 invoices overdue</b> — {inr(38600)} across Labofab India and Kalyan Jewellers.</span>
            <span className="mute">account_finance has read-only access to this tab.</span>
          </div>
          <div className="tbl">
            <div className="tbl__scroll">
              <div className="tbl__head" style={{ gridTemplateColumns: '104px minmax(0,1.4fr) 96px 110px 100px 110px' }}>
                <span>Invoice</span><span>Organisation</span><span>Plan</span><span className="tbl__c--num">Amount</span><span>Status</span><span></span>
              </div>
              {[['SUB-1042', 'Labofab India', 'growth', 28320, 'overdue'], ['SUB-1041', 'Kalyan Jewellers', 'starter', 10280, 'overdue'],
                ['SUB-1040', 'Saraswati Textiles', 'growth', 28320, 'paid'], ['SUB-1039', 'Nirmal Exports', 'starter', 11800, 'paid']].map(([id, org, plan, amt, st]) => (
                <div key={id} className="tbl__row" style={{ gridTemplateColumns: '104px minmax(0,1.4fr) 96px 110px 100px 110px' }}>
                  <span className="tbl__c"><span className="tbl__id">{id}</span></span>
                  <span className="tbl__c"><span className="tbl__t">{org}</span></span>
                  <span className="tbl__c"><Tag c={PLAN_C[plan]}>{plan}</Tag></span>
                  <span className="tbl__c tbl__c--num">{inr(amt)}</span>
                  <span className="tbl__c"><Tag c={st === 'paid' ? '#04837A' : '#B42318'}>{st}</Tag></span>
                  <span className="tbl__c">{st === 'overdue' ? <button className="btn btn--fill btn--sm">Record payment</button> : <span className="mute" style={{ fontSize: 11.5 }}>—</span>}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'support sessions' && (
        <>
          <div className="rowflex" style={{ gap: 9, padding: '10px 13px', background: 'var(--s-container)', borderRadius: 'var(--r-md)', fontSize: 12.5 }}>
            {I.check}<span>Aekam staff hold <b>2 approved sessions</b> right now. Every one was granted by that org's admin and expires on its own.</span>
          </div>
          <div className="tbl">
            <div className="tbl__scroll">
              <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1fr) 84px 104px 88px' }}>
                <span>Agent</span><span>Organisation</span><span>Modules</span><span>Level</span><span>Expires</span><span></span>
              </div>
              {[['Om Chauhan', 'Aekam Inc', 'ग्रह', 'viewer', '1h 42m', 0], ['Sneha Kshatriya', 'Labofab India', 'गणित · दृष्टि', 'editor', '5d 3h', 1]].map(([a, org, mods, lvl, exp, warn]) => (
                <div key={a} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1fr) 84px 104px 88px' }}>
                  <span className="tbl__c"><Av n={a} s={26} c="#7c5cbf" /><span className="tbl__t">{a}</span></span>
                  <span className="tbl__c"><span className="tbl__t">{org}</span></span>
                  <span className="tbl__c"><span className="hi mute" style={{ fontSize: 13 }}>{mods}</span></span>
                  <span className="tbl__c"><Lvl v={lvl} /></span>
                  <span className="tbl__c"><span className="mono" style={{ fontSize: 12.5, color: warn ? 'var(--warn)' : 'inherit' }}>{exp}</span></span>
                  <span className="tbl__c"><button className="btn btn--danger btn--sm">End</button></span>
                </div>
              ))}
            </div>
          </div>
          <Card title="Requests awaiting an org admin" hi="प्रतीक्षित">
            <div className="between" style={{ padding: '10px 12px', background: 'var(--s-low)', borderRadius: 'var(--r-sm)' }}>
              <span className="rowflex" style={{ gap: 9 }}><Av n="Bhumi Shrimali" s={26} c="#7c5cbf" /><span style={{ minWidth: 0 }}><b style={{ fontSize: 12.5, display: 'block' }}>Bhumi Shrimali → Nirmal Exports</b><span className="mute" style={{ fontSize: 11.5 }}>Ticket #4903 · asked 2h ago · no response yet</span></span></span>
              <button className="btn btn--out btn--sm">Nudge admin</button>
            </div>
          </Card>
        </>
      )}

      {tab === 'plans' && (
        <div className="grid">
          {[['Free', 'free', 0, 1, 100, '2 users'], ['Starter', 'starter', 10000, 4, 500, '10 users'], ['Growth', 'growth', 24000, 8, 4000, '25 users'], ['Enterprise', 'enterprise', 0, 11, 20000, 'Unlimited']].map(([n, code, price, mods, credits, seats]) => (
            <div key={code} className="card" style={{ padding: 'var(--pad-card)', borderColor: code === 'growth' ? 'var(--primary)' : undefined }}>
              <div className="between"><b style={{ fontSize: 14 }}>{n}</b><Tag c={PLAN_C[code] || '#7c5cbf'}>{code}</Tag></div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, marginTop: 8 }}>{price ? inr(price) : 'Custom'}<span className="mute" style={{ fontSize: 12, fontFamily: 'var(--font-ui)' }}>{price ? ' / mo' : ''}</span></div>
              <div className="divider" style={{ margin: '11px 0' }} />
              <div className="col" style={{ gap: 5, fontSize: 12 }}>
                <div className="between"><span className="mute">Modules</span><b>{mods} of 11</b></div>
                <div className="between"><span className="mute">AI credits</span><b className="mono">{credits}/mo</b></div>
                <div className="between"><span className="mute">Seats</span><b>{seats}</b></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'diagnostics' && (
        <>
          <div className="rowflex" style={{ gap: 9, padding: '10px 13px', background: 'var(--s-container)', borderRadius: 'var(--r-md)', fontSize: 12.5 }}>
            <span className="tag" style={{ '--c': '#0082c6' }}>developer</span>
            <span>Logs, migrations and feature flags. <b>No customer PII, no billing, no role assignment.</b></span>
          </div>
          <div className="two">
            <Card title="Migrations" hi="स्थानांतरण" flush>
              {[['058_sanvaad_messaging', 'applied', '2026-07-18'], ['016_multi_role_org_admin', 'applied', '2026-06-02'], ['059_platform_support_sessions', 'pending', '—'], ['060_module_role_levels', 'pending', '—']].map(([n, st, d], i) => (
                <div key={n} className="between" style={{ padding: '11px var(--pad-card)', borderBottom: i < 3 ? '1px solid var(--outline-variant)' : 0 }}>
                  <span className="mono" style={{ fontSize: 12 }}>{n}</span>
                  <span className="rowflex" style={{ gap: 9 }}><Tag c={st === 'applied' ? '#04837A' : '#A66207'}>{st}</Tag><span className="mute mono" style={{ fontSize: 11 }}>{d}</span></span>
                </div>
              ))}
            </Card>
            <Card title="Feature flags" hi="ध्वज">
              <div className="col" style={{ gap: 9 }}>
                {[['module_role_levels', 1], ['pahchan_face_scan', 1], ['varta_whatsapp', 0], ['internal_only_tasks', 0]].map(([f, on]) => (
                  <div key={f} className="between"><span className="mono" style={{ fontSize: 12 }}>{f}</span><span className={'sw' + (on ? ' on' : '')} /></div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// Org detail — the module toggle that only Aekam can operate
function OrgDetail({ data, close }) {
  const o = data || ORGS_ALL[1];
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="drawer">
        <div className="drawer__head">
          <Av n={o.n} s={34} c={PLAN_C[o.plan]} />
          <span style={{ minWidth: 0 }}><b style={{ fontSize: 14, display: 'block' }}>{o.n}</b><span className="mute" style={{ fontSize: 12 }}>{o.own}</span></span>
          <button className="icobtn" style={{ marginLeft: 'auto' }} onClick={close}>{I.x}</button>
        </div>
        <div className="drawer__body">
          <div className="props">
            <div className="prop"><span className="prop__l"><span>Plan</span></span><span className="prop__v"><Tag c={PLAN_C[o.plan]}>{o.plan}</Tag></span></div>
            <div className="prop"><span className="prop__l"><span>Status</span></span><span className="prop__v"><Tag c={ST_C[o.st]}>{o.st}</Tag></span></div>
            <div className="prop"><span className="prop__l"><span>Users</span></span><span className="prop__v mono">{o.users}</span></div>
            <div className="prop"><span className="prop__l"><span>Markup</span></span><span className="prop__v mono">30%</span></div>
          </div>
          <div className="divider" />
          <div>
            <div className="between" style={{ marginBottom: 9 }}>
              <span className="fld__l">Modules enabled for this org</span>
              <span className="mute" style={{ fontSize: 11.5 }}>{o.mods} of {MODULES.length}</span>
            </div>
            <div className="col" style={{ gap: 7 }}>
              {MODULES.map((m, i) => {
                const on = i < o.mods;
                return (
                  <div key={m.code} className="between" style={{ padding: '9px 11px', borderRadius: 'var(--r-sm)', background: on ? 'var(--primary-container)' : 'var(--s-low)' }}>
                    <span className="rowflex" style={{ gap: 8 }}>
                      <b className="hi" style={{ fontSize: 14 }}>{m.hi}</b><span style={{ fontSize: 12.5 }}>{m.en}</span>
                      {m.sensitive && <span className="tag" style={{ '--c': '#B42318' }}>Sensitive</span>}
                    </span>
                    <span className={'sw' + (on ? ' on' : '')} />
                  </div>
                );
              })}
            </div>
            <div className="mute" style={{ fontSize: 11.5, marginTop: 9 }}>Only Aekam can toggle these. The org's own admin grants them to people within what's enabled here.</div>
          </div>
          <div className="divider" />
          <div>
            <div className="fld__l" style={{ marginBottom: 8, color: 'var(--danger)' }}>Danger zone</div>
            <div className="col" style={{ gap: 8 }}>
              <button className="btn btn--danger btn--sm">Suspend organisation</button>
              <button className="btn btn--danger btn--sm">Deactivate and archive data</button>
            </div>
            <div className="mute" style={{ fontSize: 11.5, marginTop: 7 }}>platform_admin only. Both actions are audited and reversible for 30 days.</div>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { ORGS_ALL, PLAN_C, ST_C, ScreenPlatform, OrgDetail });
