// C + D — Aekam platform admin console. Its own sidebar, violet surface, seven
// areas. Redesigns AdminPage / AdminBillingPage / AdminOrgsPage / AdminCostDashboardPage
// and adds Dashboard, Users, Support sessions and System settings.
const ADM_NAV = [
  ['dash', 'Dashboard', 'मुख्य', 'dash'],
  ['orgs', 'Organisations', 'संस्था', 'hub', 34],
  ['users', 'Users', 'उपयोगकर्ता', 'hr', 212],
  ['billing', 'Billing & invoices', 'बीजक', 'fin', 3],
  ['costs', 'Cost analytics', 'व्यय', 'report'],
  ['support', 'Support sessions', 'सहायता', 'check', 1],
  ['sys', 'System settings', 'व्यवस्था', 'gear'],
];
// plan, credits and markup are the real per-org fields: plan_code, monthly_credits,
// monthly_price, markup_pct. Plans are free | starter | growth | scale.
const ORGS = [
  ['Aekam Inc', 'keval@aekam.co', 'growth', 'active', 6, 6, 10000, '2 Jun 2026', '2.1 GB', 1000, 30],
  ['Shreeji Traders', 'ops@shreeji.in', 'growth', 'active', 14, 9, 12000, '18 Apr 2026', '6.4 GB', 1000, 30],
  ['Nirmal Exports', 'admin@nirmal.co', 'free', 'active', 3, 3, 0, '11 Jul 2026', '340 MB', 200, 30],
  ['Kalyan Interiors', 'accounts@kalyan.in', 'starter', 'paused', 8, 7, 6000, '3 Feb 2026', '4.8 GB', 500, 25],
  ['Bharat Logistics', 'it@bharatlog.com', 'scale', 'active', 61, 13, 42000, '9 Nov 2025', '48 GB', 2000, 22],
  ['Amul Coop Dairy', 'finance@amulcoop.in', 'growth', 'suspended', 22, 8, 10000, '27 Jan 2026', '11 GB', 1000, 30],
];
const PLAN_CREDITS = { free: 200, starter: 500, growth: 1000, scale: 2000 };
const PLATFORM_ROLES = [
  ['platform_admin', 'Platform Admin', 'Everything, including billing and costs', '#B42318'],
  ['account_manager', 'Account Manager', 'Orgs and members, no cost data', '#0082c6'],
  ['account_finance', 'Account / Finance', 'Invoices, payments, cost analytics', '#A66207'],
  ['developer', 'Developer', 'System settings, feature flags, health', '#5C6450'],
  ['srijan_admin', 'Srijan Admin', 'AI models, prompts, credit policy', '#7c5cbf'],
];
const O_ST = { active: ['Active', '#04837A'], paused: ['Paused', '#A66207'], suspended: ['Suspended', '#B42318'] };
const REV = [[

'Aug', 148], ['Sep', 162], ['Oct', 171], ['Nov', 186], ['Dec', 198], ['Jan', 214], ['Feb', 231], ['Mar', 248], ['Apr', 267], ['May', 281], ['Jun', 302], ['Jul', 318]];
const GROWTH = [['Aug', 2], ['Sep', 3], ['Oct', 1], ['Nov', 4], ['Dec', 2], ['Jan', 5], ['Feb', 3], ['Mar', 4], ['Apr', 6], ['May', 3], ['Jun', 5], ['Jul', 4]];

function Bars({ data, unit, kind }) {
  const max = Math.max(...data.map(d => d[1]));
  return (
    <div className="achart">
      {data.map(([l, v]) => (
        <div key={l} className="achart__c" title={l + ' · ' + (unit || '') + v}>
          <span className={'achart__b' + (kind ? ' ' + kind : '')} style={{ height: Math.max(4, (v / max) * 100) + '%' }} />
          <span className="achart__l">{l}</span>
        </div>
      ))}
    </div>
  );
}

function AdmDash() {
  return (
    <div className="scol">
      <div className="stats">
        <Stat lbl="Organisations" hi="संस्था" v="34" sub="4 new this month" trend={13} kind="p" />
        <Stat lbl="Users" hi="उपयोगकर्ता" v="212" sub="147 active today" trend={8} />
        <Stat lbl="MRR" hi="मासिक" v="₹3.18 L" sub="₹318,400" trend={6} kind="ok" />
        <Stat lbl="Storage" hi="भंडार" v="184 GB" sub="of 1 TB on R2" />
        <Stat lbl="Overdue" hi="बकाया" v="₹41,293" sub="3 invoices" kind="danger" />
      </div>
      <div className="two">
        <div className="scol">
          <Card title="Revenue" hi="राजस्व" right={<span className="mute mono" style={{ fontSize: 11 }}>MRR, ₹ thousands</span>}>
            <Bars data={REV} unit="₹" />
          </Card>
          <Card title="New organisations" hi="वृद्धि" right={<span className="mute mono" style={{ fontSize: 11 }}>per month</span>}>
            <Bars data={GROWTH} kind="alt" />
          </Card>
        </div>
        <div className="scol">
          <Card title="Needs attention" hi="ध्यान" right={<Tag c="#A66207">5</Tag>}>
            <div className="scol" style={{ gap: 0 }}>
              {[['3 invoices overdue', '₹41,293 · oldest 34 days', 'danger'], ['1 support request pending', 'Sneha → Aekam Inc · 14 min', 'warn'], ['Amul Coop suspended', 'Payment failed twice', 'danger'], ['2 orgs near credit limit', 'Bharat Logistics at 94%', 'warn'], ['R2 storage at 18%', 'No action needed', 'ok']].map(([t, d, k]) => (
                <button key={t} className="aalert">
                  <span className={'aalert__d ' + k} />
                  <span style={{ minWidth: 0, flex: 1 }}><b>{t}</b><span>{d}</span></span>
                  {I.chevR}
                </button>
              ))}
            </div>
          </Card>
          <Card title="System health" hi="स्वास्थ्य">
            {[['API p95 latency', '184 ms', 'ok', 24], ['Error rate', '0.11%', 'ok', 8], ['DB size', '41 GB / 100', 'ok', 41], ['Queue depth', '12 jobs', 'warn', 62]].map(([l, v, k, pct]) => (
              <div key={l} style={{ marginBottom: 12 }}>
                <div className="between" style={{ marginBottom: 5 }}>
                  <span style={{ fontSize: 12 }}>{l}</span>
                  <span className="mono" style={{ fontSize: 11.5, color: k === 'warn' ? 'var(--warn)' : 'var(--ok)' }}>{v}</span>
                </div>
                <div className="meter"><span className="meter__f" style={{ width: pct + '%', background: k === 'warn' ? 'var(--warn)' : 'var(--ok)' }} /></div>
              </div>
            ))}
          </Card>
          <Card title="Recent activity" hi="गतिविधि" flush>
            <div style={{ padding: 'var(--pad-card)' }}>
              {[['Nirmal Exports created', 'Free plan · 3 seats', '11 min'], ['Bharat Logistics → Enterprise', 'from Pro · ₹34,999', '2 h'], ['Support session expired', 'Sneha K · Aekam Inc', '4 h'], ['Invoice AEK-2026-07-14 paid', '₹5,899 · UPI', 'Yesterday']].map(([t, d, w], i, a) => (
                <div key={t} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 11, paddingBottom: i < a.length - 1 ? 13 : 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ width: 7, height: 7, borderRadius: 7, background: 'var(--primary)', marginTop: 5, flexShrink: 0 }} />
                    {i < a.length - 1 && <span style={{ flex: 1, width: 1, background: 'var(--outline-variant)', marginTop: 3 }} />}
                  </div>
                  <span style={{ minWidth: 0 }}><b style={{ fontSize: 12.5, display: 'block' }}>{t}</b><span className="mute" style={{ fontSize: 11 }}>{d}</span></span>
                  <span className="mute mono" style={{ fontSize: 10.5 }}>{w}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function AdmOrgs({ sel, setSel }) {
  const [q, setQ] = React.useState('');
  const [f, setF] = React.useState('all');
  const list = ORGS.filter(o => (f === 'all' || o[3] === f) && o[0].toLowerCase().includes(q.toLowerCase()));
  if (sel) {
    const o = ORGS.find(x => x[0] === sel) || ORGS[0];
    return <AdmOrgDetail o={o} back={() => setSel(null)} />;
  }
  return (
    <div className="scol">
      <div className="between">
        <div className="rowflex" style={{ gap: 9 }}>
          <label className="search" style={{ maxWidth: 260 }}>{I.search}<input placeholder="Search organisations" value={q} onChange={e => setQ(e.target.value)} /></label>
          <SSeg val={f} set={setF} opts={[['all', 'All'], ['active', 'Active'], ['paused', 'Paused'], ['suspended', 'Suspended']]} />
        </div>
        <button className="btn btn--fill btn--sm">{I.plus} Create organisation</button>
      </div>
      <div className="tbl"><div className="tbl__scroll">
        <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.5fr) 96px 96px 74px 74px 92px 84px 44px' }}>
          <span>Organisation</span><span>Plan</span><span>Status</span><span>Members</span><span>Modules</span><span>MRR</span><span>Storage</span><span></span>
        </div>
        {list.map(o => (
          <button key={o[0]} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.5fr) 96px 96px 74px 74px 92px 84px 44px' }} onClick={() => setSel(o[0])}>
            <span className="tbl__c"><Av n={o[0]} s={28} /><span style={{ minWidth: 0 }}><span className="tbl__t" style={{ display: 'block' }}>{o[0]}</span><span className="tbl__s">{o[1]}</span></span></span>
            <span className="tbl__c"><span className="chip" style={{ padding: '2px 9px', fontSize: 11.5 }}>{o[2]}</span></span>
            <span className="tbl__c"><Tag c={O_ST[o[3]][1]}>{O_ST[o[3]][0]}</Tag></span>
            <span className="tbl__c tbl__c--num" style={{ fontSize: 12 }}>{o[4]}</span>
            <span className="tbl__c tbl__c--num" style={{ fontSize: 12 }}>{o[5]}/15</span>
            <span className="tbl__c tbl__c--num" style={{ fontSize: 12 }}>{o[6] ? inr(o[6]) : '—'}</span>
            <span className="tbl__c"><span className="tbl__s mono">{o[8]}</span></span>
            <span className="tbl__c">{I.chevR}</span>
          </button>
        ))}
      </div></div>
      <div className="snote">{I.check} {list.length} of {ORGS.length} shown. Clicking a row opens the org, not a modal — an operator needs the URL to paste into a ticket.</div>
    </div>
  );
}

function AdmOrgDetail({ o, back }) {
  const [tab, setTab] = React.useState('overview');
  return (
    <div className="scol">
      <div className="rowflex" style={{ gap: 10 }}>
        <button className="btn btn--out btn--sm" onClick={back}>{I.chevL} All organisations</button>
        <span className="mute mono" style={{ fontSize: 11 }}>/admin/orgs/{o[0].toLowerCase().replace(/\W+/g, '-')}</span>
      </div>
      <div className="ahead">
        <Av n={o[0]} s={44} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="rowflex" style={{ gap: 9 }}>
            <b style={{ fontSize: 19, fontFamily: 'var(--font-display)', fontWeight: 500 }}>{o[0]}</b>
            <Tag c={O_ST[o[3]][1]}>{O_ST[o[3]][0]}</Tag>
            <span className="chip" style={{ padding: '2px 9px', fontSize: 11.5 }}>{o[2]}</span>
          </div>
          <span className="mute" style={{ fontSize: 12 }}>{o[1]} · created {o[7]} · {o[4]} members · {o[8]} stored</span>
        </div>
        <div className="rowflex" style={{ gap: 7 }}>
          <button className="btn btn--out btn--sm">Change plan</button>
          <button className="btn btn--out btn--sm">Add credits</button>
          <button className="btn btn--out btn--sm">{o[3] === 'active' ? 'Suspend' : 'Reactivate'}</button>
          <button className="btn btn--danger btn--sm" title="Writes an entry to the org's own audit log">{SI.eye} Impersonate</button>
        </div>
      </div>
      <div className="snote snote--warn">{SI.alert}<span><b>Impersonation is visible to the customer.</b> It appears in their audit log with your name and the reason, and they are emailed. There is no silent mode, by design.</span></div>
      <TabBar tabs={['overview', 'members', 'modules', 'invoices', 'activity']} val={tab} set={setTab} max={5} />
      {tab === 'overview' && (
        <div className="two">
          <div className="scol">
            <div className="stats" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
              <Stat lbl="MRR" v={o[6] ? inr(o[6]) : 'Free'} sub={o[2] + ' plan'} kind="p" />
              <Stat lbl="Billing" v="Current" sub="next 21 Aug" kind="ok" />
              <Stat lbl="AI credits" v="12.4k" sub="of 24k this month" />
              <Stat lbl="Storage" v={o[8]} sub="of 100 GB" />
            </div>
            <Card title="Cost vs charged" hi="लाभ">
              <div className="amargin">
                {[['Infrastructure', 412], ['AI models', 1284], ['WhatsApp', 218], ['Storage', 96]].map(([l, v]) => (
                  <div key={l} className="between" style={{ padding: '7px 0', borderBottom: '1px solid color-mix(in srgb, var(--outline-variant) 55%, transparent)' }}>
                    <span style={{ fontSize: 12.5 }}>{l}</span><span className="mono" style={{ fontSize: 12 }}>{inr(v)}</span>
                  </div>
                ))}
                <div className="between" style={{ padding: '10px 0 0' }}>
                  <b style={{ fontSize: 12.5 }}>Total cost</b><b className="mono" style={{ fontSize: 13 }}>{inr(2010)}</b>
                </div>
                <div className="between" style={{ padding: '4px 0' }}>
                  <b style={{ fontSize: 12.5 }}>Charged</b><b className="mono" style={{ fontSize: 13 }}>{inr(o[6] || 0)}</b>
                </div>
                <div className="amargin__f">
                  <span>Gross margin</span><b>{o[6] ? Math.round(((o[6] - 2010) / o[6]) * 100) + '%' : '—'}</b>
                </div>
              </div>
              <div className="snote">{SI.lock} Margin is platform-only. It is never exposed on any tenant surface, in any export, or to support agents.</div>
            </Card>
          </div>
          <div className="scol">
          <Card title="Plan & metering" hi="योजना">
            <div className="ogrid">
              <label className="fld"><span className="fld__l">Plan</span><select className="inp" defaultValue={o[2]}>{Object.keys(PLAN_CREDITS).map(p => <option key={p} value={p}>{p} · {PLAN_CREDITS[p]} credits</option>)}</select></label>
              <label className="fld"><span className="fld__l">Markup %</span><input className="inp mono" type="number" defaultValue={o[10]} /></label>
              <label className="fld"><span className="fld__l">Monthly credits</span><input className="inp mono" type="number" defaultValue={o[9]} step="50" /></label>
              <label className="fld"><span className="fld__l">Monthly price ₹</span><input className="inp mono" type="number" defaultValue={o[6]} step="500" /></label>
            </div>
            <div className="atopup">
              <span className="fld__l" style={{ marginBottom: 0 }}>Top up credits</span>
              {[100, 200, 500, 1000].map(n => <button key={n} className="btn btn--out btn--sm">+{n}</button>)}
              <input className="inp mono" style={{ width: 86 }} placeholder="Custom" />
            </div>
            <div className="mute" style={{ fontSize: 11.5, marginTop: 9 }}>Balance {o[9] - 380} · {380} used this period. Credits do not carry over.</div>
          </Card>
          <Card title="Storage & R2" hi="भंडार" right={<Tag c="#04837A">Configured</Tag>}>
            <div className="props" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="prop"><span className="prop__l">Used</span><span className="prop__v mono">{o[8]} of 100 GB</span></div>
              <div className="prop"><span className="prop__l">Bucket</span><span className="prop__v mono">kartavya-storage</span></div>
            </div>
            <div className="ar2" style={{ marginTop: 12 }}>
              <div className="ar2__g">
                <label className="fld"><span className="fld__l">Cloudflare account ID</span><input className="inp mono" defaultValue="abc123def456" /></label>
                <label className="fld"><span className="fld__l">Bucket name</span><input className="inp mono" defaultValue="kartavya-storage" /></label>
                <label className="fld"><span className="fld__l">Access key ID</span><input className="inp mono" defaultValue="••••••••••••" /></label>
                <label className="fld"><span className="fld__l">Secret access key</span><input className="inp mono" type="password" defaultValue="••••••••••••" /></label>
              </div>
              <div className="rowflex" style={{ gap: 8 }}>
                <button className="btn btn--out btn--sm">{I.check} Verify credentials</button>
                <button className="btn btn--fill btn--sm">Save</button>
              </div>
            </div>
            <div className="snote">{SI.lock} Each org can hold its own R2 account, so a customer’s files never share a bucket with anybody else’s. Verify before saving — a wrong key silently breaks every upload.</div>
          </Card>
          </div>
          <Card title="Owner & contacts" hi="संपर्क">
            <div className="scol" style={{ gap: 9 }}>
              {[['Keval Shah', o[1], 'Owner'], ['Aanya Mehta', 'aanya@aekam.co', 'Org admin']].map(([n, e, r]) => (
                <div key={e} className="rowflex" style={{ gap: 10 }}>
                  <Av n={n} s={28} />
                  <span style={{ minWidth: 0, flex: 1 }}><b style={{ fontSize: 12.5, display: 'block' }}>{n}</b><span className="mute" style={{ fontSize: 11 }}>{e}</span></span>
                  <RoleBadge r={r === 'Owner' ? 'org_owner' : 'org_admin'} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
      {tab === 'members' && <OrgMembers />}
      {tab === 'modules' && <OrgModules />}
      {tab === 'invoices' && <AdmInvoices scoped={o[0]} />}
      {tab === 'activity' && (
        <Card flush><div style={{ padding: 'var(--pad-card)' }}>
          {[['Plan changed Pro → Pro (annual)', 'by Om Chauhan · platform', '2 h'], ['Support session granted', 'Sneha K · गणित viewer · 2h TTL', '4 h'], ['Module enabled: पहचान', 'by Keval Shah', 'Yesterday'], ['Invoice AEK-2026-07 paid', '₹5,899 · UPI', '3 d']].map(([t, d, w], i, a) => (
            <div key={t} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 11, paddingBottom: i < a.length - 1 ? 13 : 0 }}>
              <span style={{ minWidth: 0 }}><b style={{ fontSize: 12.5, display: 'block' }}>{t}</b><span className="mute" style={{ fontSize: 11 }}>{d}</span></span>
              <span className="mute mono" style={{ fontSize: 10.5 }}>{w}</span>
            </div>
          ))}
        </div></Card>
      )}
    </div>
  );
}

const ALL_USERS = [
  ['Keval Shah', 'keval@aekam.co', 'Aekam Inc', 'Owner', '—', 'now'],
  ['Aanya Mehta', 'aanya@aekam.co', 'Aekam Inc', 'Org admin', '—', '12 min'],
  ['Sneha Kshatriya', 'sneha@aekaminc.com', '—', '—', 'Platform support', '14 min'],
  ['Om Chauhan', 'om@aekaminc.com', '—', '—', 'Platform admin', '2 h'],
  ['Ravi Menon', 'ravi@shreeji.in', 'Shreeji Traders', 'Owner', '—', '1 h'],
  ['Divya Rao', 'divya@bharatlog.com', 'Bharat Logistics, Nirmal Exports', 'Org admin, Member', '—', '3 h'],
];
function AdmUsers() {
  const [sel, setSel] = React.useState(null);
  const [q, setQ] = React.useState('');
  const list = ALL_USERS.filter(u => (u[0] + u[1]).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="scol">
      <div className="between">
        <label className="search" style={{ maxWidth: 300 }}>{I.search}<input placeholder="Search by name or email" value={q} onChange={e => setQ(e.target.value)} /></label>
        <SSeg val="all" set={() => {}} opts={[['all', 'All'], ['staff', 'Aekam staff'], ['owners', 'Owners']]} />
      </div>
      <div className="tbl"><div className="tbl__scroll">
        <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1.3fr) 132px 116px 78px 44px' }}>
          <span>User</span><span>Organisations</span><span>Org roles</span><span>Platform role</span><span>Active</span><span></span>
        </div>
        {list.map(u => (
          <button key={u[1]} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1.3fr) 132px 116px 78px 44px' }} onClick={() => setSel(u)}>
            <span className="tbl__c"><Av n={u[0]} s={28} c={u[4] !== '—' ? '#7c5cbf' : undefined} /><span style={{ minWidth: 0 }}><span className="tbl__t" style={{ display: 'block' }}>{u[0]}</span><span className="tbl__s">{u[1]}</span></span></span>
            <span className="tbl__c"><span className="tbl__s">{u[2]}</span></span>
            <span className="tbl__c"><span className="tbl__s">{u[3]}</span></span>
            <span className="tbl__c">{u[4] === '—' ? <span className="mute">—</span> : <span className="tag" style={{ '--c': '#7c5cbf' }}><span className="tag__dot" />{u[4]}</span>}</span>
            <span className="tbl__c"><span className="tbl__s mono">{u[5]}</span></span>
            <span className="tbl__c">{I.chevR}</span>
          </button>
        ))}
      </div></div>
      <Card title="Platform roles" hi="मंच भूमिका" right={<span className="mute" style={{ fontSize: 11.5 }}>Aekam staff only · never granted to a tenant</span>}>
        <div className="scol" style={{ gap: 0 }}>
          {PLATFORM_ROLES.map(([code, l, d, c]) => (
            <div key={code} className="aprole">
              <span className="tag" style={{ '--c': c, minWidth: 148 }}><span className="tag__dot" />{l}</span>
              <span style={{ minWidth: 0, flex: 1 }}><b className="mono">{code}</b><span>{d}</span></span>
              <span className="mono mute" style={{ fontSize: 11 }}>{code === 'platform_admin' ? 2 : code === 'developer' ? 3 : 1} assigned</span>
            </div>
          ))}
        </div>
        <div className="rowflex" style={{ gap: 8, marginTop: 13 }}>
          <input className="inp" style={{ flex: 1 }} placeholder="user@aekaminc.com" />
          <select className="inp" style={{ width: 180 }}>{PLATFORM_ROLES.map(r => <option key={r[0]}>{r[1]}</option>)}</select>
          <button className="btn btn--fill btn--sm">Assign</button>
        </div>
        <div className="snote snote--warn">{SI.alert}<span><b>account_manager</b> and <b>developer</b> cannot see cost or margin data. Only <b>platform_admin</b> and <b>account_finance</b> reach the cost dashboard.</span></div>
      </Card>
      {sel && (
        <>
          <div className="scrim" onClick={() => setSel(null)} />
          <div className="drawer">
            <div className="drawer__head">
              <Av n={sel[0]} s={34} c={sel[4] !== '—' ? '#7c5cbf' : undefined} />
              <span style={{ minWidth: 0 }}><b style={{ fontSize: 14, display: 'block' }}>{sel[0]}</b><span className="mute" style={{ fontSize: 12 }}>{sel[1]}</span></span>
              <button className="icobtn" style={{ marginLeft: 'auto' }} onClick={() => setSel(null)}>{I.x}</button>
            </div>
            <div className="drawer__body">
              <div className="props">
                <div className="prop"><span className="prop__l">Platform role</span><span className="prop__v">{sel[4]}</span></div>
                <div className="prop"><span className="prop__l">Last active</span><span className="prop__v mono">{sel[5]}</span></div>
                <div className="prop"><span className="prop__l">Created</span><span className="prop__v mono">2 Jun 2026</span></div>
              </div>
              <div className="divider" />
              <div>
                <div className="fld__l" style={{ marginBottom: 9 }}>Organisation memberships</div>
                {sel[2] === '—' ? <div className="mute" style={{ fontSize: 12.5 }}>Aekam staff. No org membership — access comes from time-boxed support sessions only.</div>
                  : sel[2].split(', ').map((o, i) => (
                    <div key={o} className="between" style={{ padding: '9px 11px', background: 'var(--s-low)', borderRadius: 'var(--r-sm)', marginBottom: 7 }}>
                      <span className="rowflex" style={{ gap: 8 }}><Av n={o} s={22} /><b style={{ fontSize: 12.5 }}>{o}</b></span>
                      <span className="rowflex" style={{ gap: 7 }}>
                        <span className="tag" style={{ '--c': '#0082c6' }}>{sel[3].split(', ')[i] || 'Member'}</span>
                        <button className="btn btn--danger btn--sm">Remove</button>
                      </span>
                    </div>
                  ))}
              </div>
              <div className="divider" />
              <div>
                <div className="fld__l" style={{ marginBottom: 8 }}>Assign platform role</div>
                <select className="inp">{[['none', 'None — tenant user']].concat(PLATFORM_ROLES.map(r => [r[0], r[1]])).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <div className="snote snote--warn">{SI.alert}<span>Platform admin can read every org’s billing and costs. Support cannot — it must request time-boxed access per org.</span></div>
              </div>
              <div className="divider" />
              <button className="btn btn--danger btn--sm" style={{ alignSelf: 'flex-start' }}>Disable account</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const INVS = [
  ['AEK-2026-07-14', 'Aekam Inc', 5899, 'paid', '21 Jul', 0],
  ['AEK-2026-07-13', 'Shreeji Traders', 5899, 'sent', '28 Jul', 0],
  ['AEK-2026-07-09', 'Bharat Logistics', 34999, 'overdue', '11 Jul', 14],
  ['AEK-2026-06-31', 'Amul Coop Dairy', 5899, 'overdue', '30 Jun', 25],
  ['AEK-2026-06-28', 'Kalyan Interiors', 5899, 'overdue', '21 Jun', 34],
  ['AEK-2026-07-15', 'Nirmal Exports', 0, 'draft', '—', 0],
];
function AdmInvoices({ scoped }) {
  const [f, setF] = React.useState('all');
  const [make, setMake] = React.useState(false);
  const list = INVS.filter(i => (f === 'all' || i[3] === f) && (!scoped || i[1] === scoped));
  return (
    <div className="scol">
      {!scoped && (
        <>
          <div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            <Stat lbl="MRR" hi="मासिक" v="₹3.18 L" trend={6} kind="p" />
            <Stat lbl="Invoiced" hi="जारी" v="₹3.64 L" sub="this month" />
            <Stat lbl="Collected" hi="प्राप्त" v="₹3.23 L" sub="88.7%" kind="ok" />
            <Stat lbl="Outstanding" hi="बकाया" v="₹41,293" sub="3 invoices" kind="danger" />
          </div>
          <div className="between">
            <SSeg val={f} set={setF} opts={[['all', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['paid', 'Paid'], ['overdue', 'Overdue']]} />
            <div className="rowflex" style={{ gap: 8 }}>
              <button className="btn btn--out btn--sm">Record payment</button>
              <button className="btn btn--fill btn--sm" onClick={() => setMake(true)}>{I.plus} Create invoice</button>
            </div>
          </div>
        </>
      )}
      <div className="tbl"><div className="tbl__scroll">
        <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1.1fr) 96px 96px 82px 92px' }}>
          <span>Invoice</span><span>Organisation</span><span>Amount</span><span>Status</span><span>Due</span><span></span>
        </div>
        {list.map(v => (
          <div key={v[0]} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1.1fr) 96px 96px 82px 92px' }}>
            <span className="tbl__c"><span className="tbl__id">{v[0]}</span></span>
            <span className="tbl__c"><span className="tbl__t" style={{ fontSize: 12 }}>{v[1]}</span></span>
            <span className="tbl__c tbl__c--num" style={{ fontSize: 12.5 }}>{v[2] ? inr(v[2]) : '—'}</span>
            <span className="tbl__c" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
              <Tag c={INV_ST[v[3] === 'draft' ? 'draft' : v[3]] ? INV_ST[v[3]][1] : '#8E8D87'}>{INV_ST[v[3]] ? INV_ST[v[3]][0] : v[3]}</Tag>
              {v[5] > 0 && <span style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 600 }}>{v[5]} days over</span>}
            </span>
            <span className="tbl__c"><span className="tbl__s mono">{v[4]}</span></span>
            <span className="tbl__c" style={{ gap: 5 }}>
              {v[3] === 'draft' ? <button className="btn btn--fill btn--sm">Send</button> : v[3] === 'overdue' ? <button className="btn btn--out btn--sm">Remind</button> : <button className="btn btn--out btn--sm">PDF</button>}
            </span>
          </div>
        ))}
      </div></div>
      {!scoped && (
        <div className="two">
          <Card title="Overdue management" hi="बकाया" right={<Tag c="#B42318">₹41,293</Tag>}>
            <SRow t="Automatic reminders" d="Day 3, day 7, then weekly. Stops the moment a payment lands.">
              <SSwitch on set={() => {}} />
            </SRow>
            <div className="divider" style={{ margin: '13px 0' }} />
            <SRow t="Suspend after" d="The org keeps read access and can export. Nothing is deleted.">
              <SSeg val="45" set={() => {}} opts={[['30', '30d'], ['45', '45d'], ['60', '60d'], ['never', 'Never']]} />
            </SRow>
          </Card>
          <Card title="Recent payments" hi="भुगतान" flush>
            <div className="tbl__scroll">
              <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.2fr) 88px 92px 84px' }}><span>Organisation</span><span>Amount</span><span>Method</span><span>Date</span></div>
              {[['Aekam Inc', 5899, 'UPI', '21 Jul'], ['Shreeji Traders', 5899, 'NEFT', '19 Jul'], ['Bharat Logistics', 17500, 'Bank · partial', '14 Jul']].map(p => (
                <div key={p[0] + p[3]} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.2fr) 88px 92px 84px', minHeight: 38 }}>
                  <span className="tbl__c"><span className="tbl__t" style={{ fontSize: 12 }}>{p[0]}</span></span>
                  <span className="tbl__c tbl__c--num" style={{ fontSize: 12 }}>{inr(p[1])}</span>
                  <span className="tbl__c"><span className="tbl__s">{p[2]}</span></span>
                  <span className="tbl__c"><span className="tbl__s mono">{p[3]}</span></span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
      {make && <AdmInvoiceSheet close={() => setMake(false)} />}
    </div>
  );
}

function AdmInvoiceSheet({ close }) {
  const [lines, setLines] = React.useState([['Kartavaya Pro — monthly subscription', 1, 4999]]);
  const sub = lines.reduce((a, l) => a + l[1] * l[2], 0);
  const gst = Math.round(sub * .18);
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="sheet" style={{ width: 'min(720px, calc(100% - 48px))' }}>
        <div className="sheet__head"><h3 className="sheet__t">Create invoice</h3><button className="icobtn" style={{ marginLeft: 'auto' }} onClick={close}>{I.x}</button></div>
        <div className="sheet__body">
          <div className="row2">
            <div className="fld"><span className="fld__l">Organisation</span><select className="inp">{ORGS.map(o => <option key={o[0]}>{o[0]}</option>)}</select></div>
            <label className="fld"><span className="fld__l">Due date</span><input className="inp" type="date" defaultValue="2026-08-08" /></label>
          </div>
          <div className="fld">
            <span className="fld__l">Line items</span>
            <div className="scol" style={{ gap: 7 }}>
              {lines.map((l, i) => (
                <div key={i} className="ailine">
                  <input className="inp" defaultValue={l[0]} />
                  <input className="inp mono" type="number" defaultValue={l[1]} onChange={e => setLines(x => x.map((y, j) => j === i ? [y[0], +e.target.value || 0, y[2]] : y))} />
                  <input className="inp mono" type="number" defaultValue={l[2]} onChange={e => setLines(x => x.map((y, j) => j === i ? [y[0], y[1], +e.target.value || 0] : y))} />
                  <button className="icobtn" onClick={() => setLines(x => x.filter((_, j) => j !== i))}>{I.x}</button>
                </div>
              ))}
              <button className="btn btn--out btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setLines(x => [...x, ['', 1, 0]])}>{I.plus} Add line</button>
            </div>
          </div>
          <div className="atotals">
            <div className="between"><span>Subtotal</span><span className="mono">{inr(sub)}</span></div>
            <div className="between"><span>IGST @ 18%</span><span className="mono">{inr(gst)}</span></div>
            <div className="between atotals__g"><b>Total</b><b className="mono">{inr(sub + gst)}</b></div>
          </div>
          <div className="snote">{I.check} Place of supply comes from the org’s billing state. Inter-state is IGST; Maharashtra orgs get CGST + SGST automatically.</div>
        </div>
        <div className="sheet__foot">
          <button className="btn btn--out btn--sm" style={{ marginRight: 'auto' }}>{I.doc} Preview PDF</button>
          <button className="btn btn--out btn--sm" onClick={close}>Save draft</button>
          <button className="btn btn--fill btn--sm" onClick={close}>Create and email</button>
        </div>
      </div>
    </>
  );
}

function AdmCosts() {
  const [per, setPer] = React.useState('30d');
  const [mk, setMk] = React.useState(30);
  const RATE = 83.42;
  const AI = [['anthropic', 'claude-sonnet-4', 456.82, 18420, '41.2 M'], ['anthropic', 'claude-haiku-4', 170.31, 62180, '88.4 M'], ['openai', 'whisper-large', 107.16, 3120, '—'], ['openai', 'embed-3-small', 85.82, 214000, '112 M']];
  const SCR = [['gst-portal', 62.40, 1240], ['mca-master', 28.15, 310], ['bank-statement', 41.90, 890]];
  const aiUsd = AI.reduce((s, r) => s + r[2], 0), scrUsd = SCR.reduce((s, r) => s + r[1], 0);
  const usd = aiUsd + scrUsd, inr = usd * RATE, charged = inr * (1 + mk / 100);
  const f2 = v => '$' + v.toFixed(2);
  return (
    <div className="scol">
      <div className="between">
        <SSeg val={per} set={setPer} opts={[['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['ytd', 'YTD']]} />
        <div className="rowflex" style={{ gap: 8 }}>
          <span className="mute mono" style={{ fontSize: 11 }}>Live rate ₹{RATE.toFixed(2)}/USD</span>
          <button className="btn btn--out btn--sm">{I.doc} Export CSV</button>
        </div>
      </div>
      <div className="amk">
        <span className="fld__l" style={{ marginBottom: 0 }}>Default markup</span>
        <input className="inp mono" type="number" min="0" max="100" value={mk} onChange={e => setMk(+e.target.value || 0)} />
        <span>%</span>
        <span className="mute" style={{ fontSize: 11.5, marginLeft: 4 }}>Cost is metered in USD, converted at the live rate, then charged in INR with this markup. Each org can override it.</span>
      </div>
      <div className="acost">
        <div className="acost__c"><div className="acost__k">Aekam cost</div><div className="acost__v">{f2(usd)}</div><div className="acost__s">₹{Math.round(inr).toLocaleString('en-IN')}</div></div>
        <div className="acost__c"><div className="acost__k">AI services</div><div className="acost__v">{f2(aiUsd)}</div><div className="acost__s">{Math.round((aiUsd / usd) * 100)}% of cost</div></div>
        <div className="acost__c"><div className="acost__k">Scraper / data</div><div className="acost__v">{f2(scrUsd)}</div><div className="acost__s">{Math.round((scrUsd / usd) * 100)}% of cost</div></div>
        <div className="acost__c"><div className="acost__k">Charged to clients</div><div className="acost__v">₹{Math.round(charged).toLocaleString('en-IN')}</div><div className="acost__s">at {mk}% markup</div></div>
        <div className="acost__c acost__c--m"><div className="acost__k">Margin</div><div className="acost__v">₹{Math.round(charged - inr).toLocaleString('en-IN')}</div><div className="acost__s">{Math.round(((charged - inr) / charged) * 100)}% of charge</div></div>
      </div>
      <div className="two">
        <Card title="AI cost by model" hi="मॉडल" flush>
          <div className="tbl__scroll">
            <div className="tbl__head" style={{ gridTemplateColumns: '84px minmax(0,1.3fr) 88px 92px 78px 84px' }}>
              <span>Provider</span><span>Model</span><span>Cost USD</span><span>Charge ₹</span><span>Calls</span><span>Tokens</span></div>
            {AI.map(r => (
              <div key={r[1]} className="tbl__row" style={{ gridTemplateColumns: '84px minmax(0,1.3fr) 88px 92px 78px 84px' }}>
                <span className="tbl__c"><span className="tbl__s">{r[0]}</span></span>
                <span className="tbl__c"><span className="mono" style={{ fontSize: 11.5 }}>{r[1]}</span></span>
                <span className="tbl__c tbl__c--num" style={{ fontSize: 11.5 }}>{f2(r[2])}</span>
                <span className="tbl__c tbl__c--num" style={{ fontSize: 11.5, color: 'var(--primary)', fontWeight: 600 }}>{Math.round(r[2] * RATE * (1 + mk / 100)).toLocaleString('en-IN')}</span>
                <span className="tbl__c tbl__c--num" style={{ fontSize: 11 }}>{r[3].toLocaleString('en-IN')}</span>
                <span className="tbl__c tbl__c--num" style={{ fontSize: 10.5 }}>{r[4]}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Scraper cost" hi="संग्रह" flush>
          <div className="tbl__scroll">
            <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.3fr) 88px 92px 74px' }}>
              <span>Scraper</span><span>Cost USD</span><span>Charge ₹</span><span>Runs</span></div>
            {SCR.map(r => (
              <div key={r[0]} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.3fr) 88px 92px 74px' }}>
                <span className="tbl__c"><span className="mono" style={{ fontSize: 11.5 }}>{r[0]}</span></span>
                <span className="tbl__c tbl__c--num" style={{ fontSize: 11.5 }}>{f2(r[1])}</span>
                <span className="tbl__c tbl__c--num" style={{ fontSize: 11.5, color: 'var(--primary)', fontWeight: 600 }}>{Math.round(r[1] * RATE * (1 + mk / 100)).toLocaleString('en-IN')}</span>
                <span className="tbl__c tbl__c--num" style={{ fontSize: 11 }}>{r[2].toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Top spenders" hi="प्रमुख" flush right={<span className="mute" style={{ fontSize: 11.5 }}>per-org markup applies</span>}>
        <div className="tbl__scroll">
          <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.4fr) 74px 74px 92px 96px 92px' }}>
            <span>Organisation</span><span>Plan</span><span>Markup</span><span>Cost USD</span><span>Charge ₹</span><span>Margin ₹</span></div>
          {ORGS.filter(o => o[6]).map(o => {
            const cu = (o[4] * 3.1 + 40);
            const ci = cu * RATE, ch = ci * (1 + o[10] / 100);
            return (
              <div key={o[0]} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.4fr) 74px 74px 92px 96px 92px' }}>
                <span className="tbl__c"><span className="tbl__t" style={{ fontSize: 12 }}>{o[0]}</span></span>
                <span className="tbl__c"><span className="tbl__s">{o[2]}</span></span>
                <span className="tbl__c tbl__c--num" style={{ fontSize: 11.5 }}>{o[10]}%</span>
                <span className="tbl__c tbl__c--num" style={{ fontSize: 11.5 }}>{f2(cu)}</span>
                <span className="tbl__c tbl__c--num" style={{ fontSize: 11.5, color: 'var(--primary)', fontWeight: 600 }}>{Math.round(ch).toLocaleString('en-IN')}</span>
                <span className="tbl__c tbl__c--num" style={{ fontSize: 11.5, color: 'var(--ok)', fontWeight: 600 }}>{Math.round(ch - ci).toLocaleString('en-IN')}</span>
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Daily trend" hi="प्रवृत्ति" right={<span className="rowflex" style={{ gap: 12, fontSize: 11 }}><span className="rowflex" style={{ gap: 5 }}><i style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--primary)' }} />AI</span><span className="rowflex" style={{ gap: 5 }}><i style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--tertiary)' }} />Scraper</span></span>}>
        <Bars data={REV.map(([m, v]) => [m, Math.round(v * .21)])} unit="$" />
      </Card>
      <div className="snote">{SI.lock} A client-facing cost report can be downloaded per org — it shows the charged INR amounts only. USD cost, the live rate and the markup never appear on it.</div>
    </div>
  );
}

function AdmSupport() {
  const [tab, setTab] = React.useState('active');
  return (
    <div className="scol">
      <TabBar tabs={['active', 'queue', 'history']} val={tab} set={setTab} max={3} counts={{ active: 1, queue: 1 }} />
      {tab === 'active' && (
        <Card title="Live sessions" hi="सक्रिय" flush right={<Tag c="#04837A">1 live</Tag>}>
          <div className="tbl__scroll">
            <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) 92px 104px 84px' }}>
              <span>Agent</span><span>Organisation</span><span>Modules</span><span>Level</span><span>Expires</span><span></span></div>
            <div className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) 92px 104px 84px' }}>
              <span className="tbl__c"><Av n="Om Chauhan" s={26} c="#7c5cbf" /><span className="tbl__t" style={{ fontSize: 12 }}>Om Chauhan</span></span>
              <span className="tbl__c"><span className="tbl__t" style={{ fontSize: 12 }}>Aekam Inc</span></span>
              <span className="tbl__c"><span className="tag" style={{ '--c': '#6E747C' }}><span className="hi">ग्रह</span></span></span>
              <span className="tbl__c"><Lvl v="viewer" /></span>
              <span className="tbl__c"><span className="mono" style={{ fontSize: 12.5, color: 'var(--warn)', fontWeight: 600 }}>1h 42m</span></span>
              <span className="tbl__c"><button className="btn btn--danger btn--sm">Revoke</button></span>
            </div>
          </div>
          <div className="snote">{I.check} Only the customer can grant. Platform admins can revoke but never self-approve — that is the whole point of the mechanism.</div>
        </Card>
      )}
      {tab === 'queue' && (
        <Card title="Pending requests" hi="प्रतीक्षा" right={<Tag c="#A66207">Waiting on customer</Tag>}>
          <div className="aqueue">
            <Av n="Sneha Kshatriya" s={38} c="#7c5cbf" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="rowflex" style={{ gap: 8 }}><b style={{ fontSize: 14 }}>Sneha Kshatriya</b><span className="mute" style={{ fontSize: 12 }}>→ Aekam Inc · ticket #4821</span></div>
              <div className="aqueue__q">“Placeholder — GSTR-3B totals do not match the invoice list. I need the July invoices and the reconciliation to reproduce it.”</div>
              <div className="rowflex" style={{ gap: 6, marginTop: 10 }}>
                <span className="tag" style={{ '--c': '#6E747C' }}><span className="hi">गणित</span> Viewer</span>
                <span className="tag" style={{ '--c': '#6E747C' }}><span className="hi">दृष्टि</span> Viewer</span>
                <span className="mute" style={{ fontSize: 11.5, marginLeft: 4 }}>2h requested · sent 14 min ago</span>
              </div>
            </div>
            <button className="btn btn--out btn--sm">Withdraw</button>
          </div>
        </Card>
      )}
      {tab === 'history' && (
        <Card flush>
          <div className="tbl__scroll">
            <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr) 92px 108px 92px' }}>
              <span>Agent</span><span>Organisation</span><span>Level</span><span>Records opened</span><span>Ended</span></div>
            {[['Sneha Kshatriya', 'Shreeji Traders', 'viewer', 22, 'expired'], ['Om Chauhan', 'Bharat Logistics', 'editor', 4, 'revoked'], ['Sneha Kshatriya', 'Kalyan Interiors', 'viewer', 9, 'expired']].map((s, i) => (
              <div key={i} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr) 92px 108px 92px' }}>
                <span className="tbl__c"><Av n={s[0]} s={24} c="#7c5cbf" /><span className="tbl__t" style={{ fontSize: 12 }}>{s[0]}</span></span>
                <span className="tbl__c"><span className="tbl__s">{s[1]}</span></span>
                <span className="tbl__c"><Lvl v={s[2]} /></span>
                <span className="tbl__c tbl__c--num" style={{ fontSize: 12 }}>{s[3]}</span>
                <span className="tbl__c"><Tag c={s[4] === 'revoked' ? '#B42318' : '#8E8D87'}>{s[4]}</Tag></span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function AdmSys() {
  const [maint, setMaint] = React.useState(false);
  return (
    <div className="two">
      <div className="scol">
        <Card title="Defaults for new organisations" hi="मूलभूत">
          <SRow t="Plan"><SSeg val="free" set={() => {}} opts={[['free', 'Free'], ['pro', 'Pro trial']]} /></SRow>
          <div className="divider" style={{ margin: '13px 0' }} />
          <div className="fld">
            <span className="fld__l">Modules enabled on creation</span>
            <div className="chips">
              {MODULES.map(m => <button key={m.code} className={'chip' + (['kartavya', 'graha', 'ganit'].includes(m.code) ? ' on' : '')}><span className="hi">{m.hi}</span> {m.en}</button>)}
            </div>
            <span className="au-f__hint">Three is enough to be useful on day one. Sensitive modules are never on by default.</span>
          </div>
          <div className="divider" style={{ margin: '13px 0' }} />
          <SRow t="AI credit allowance" d="Per member per month on Pro."><input className="inp mono" style={{ width: 110 }} defaultValue="2000" /></SRow>
        </Card>
        <Card title="Feature flags" hi="सुविधा">
          <div className="scol" style={{ gap: 0 }}>
            {[['pahchan_face_v2', 'New face-matching model', 'Aekam Inc, Shreeji only'], ['varta_broadcast', 'WhatsApp broadcast campaigns', 'Off everywhere'], ['dristi_pivot', 'Pivot table builder', 'All orgs'], ['sanvaad_huddle', 'Voice huddles in channels', 'Internal only']].map(([k, l, scope]) => (
              <div key={k} className="aflag">
                <span style={{ minWidth: 0, flex: 1 }}><b className="mono">{k}</b><span>{l} · <i>{scope}</i></span></span>
                <SSwitch on={scope !== 'Off everywhere'} set={() => {}} />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="scol">
        <Card title="Email templates" hi="साँचा" flush>
          <div className="scol" style={{ gap: 0, padding: 'var(--pad-card)' }}>
            {[['Welcome', 'After signup', 'welcome_v3'], ['Invitation', 'Member invited to an org', 'invite_v2'], ['Password reset', 'Expires in 1 hour', 'reset_v1'], ['Invoice', 'With PDF attached', 'invoice_v4'], ['Support access request', 'To the org owner', 'support_req_v1']].map(([t, d, id]) => (
              <button key={id} className="atmpl">
                <span className="atmpl__ic">{SI.file}</span>
                <span style={{ minWidth: 0, flex: 1 }}><b>{t}</b><span>{d} · <span className="mono">{id}</span></span></span>
                {I.chevR}
              </button>
            ))}
          </div>
        </Card>
        <Card title="Maintenance mode" hi="अनुरक्षण" right={<Tag c={maint ? '#B42318' : '#8E8D87'}>{maint ? 'Banner live' : 'Off'}</Tag>}>
          <SRow t="Show a banner to every user" d="Read-only mode is separate — this only warns."><SSwitch on={maint} set={setMaint} /></SRow>
          {maint && (
            <>
              <label className="fld" style={{ marginTop: 12 }}>
                <span className="fld__l">Banner message</span>
                <textarea className="inp" rows="2" defaultValue="Scheduled maintenance on Sunday 02:00–04:00 IST. Kartavaya stays available; syncing may be delayed." />
              </label>
              <div className="amaint">{SI.alert} Scheduled maintenance on Sunday 02:00–04:00 IST. Kartavaya stays available; syncing may be delayed.</div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function AdminConsole({ exit }) {
  const [view, setView] = React.useState('dash');
  const [org, setOrg] = React.useState(null);
  const [nav, setNav] = React.useState(false);
  const cur = ADM_NAV.find(n => n[0] === view);
  const BODY = {
    dash: <AdmDash />, orgs: <AdmOrgs sel={org} setSel={setOrg} />, users: <AdmUsers />,
    billing: <AdmInvoices />, costs: <AdmCosts />, support: <AdmSupport />, sys: <AdmSys />,
  };
  const go = id => { setView(id); setOrg(null); setNav(false); };
  return (
    <div className="adm" data-surface="platform">
      {nav && <div className="adm__scrim" onClick={() => setNav(false)} />}
      <aside className={'adm__side' + (nav ? ' adm__side--open' : '')}>
        <button className="adm__back" onClick={exit}>{I.chevL} Back to Kartavaya</button>
        <div className="adm__badge">
          <span className="adm__badge-d" />
          <span><b>Aekam platform</b><i>cross-organisation · 34 orgs</i></span>
        </div>
        <nav className="adm__nav">
          {ADM_NAV.map(([id, l, hi, ic, n]) => (
            <button key={id} className={'adm__i' + (view === id ? ' on' : '')} onClick={() => go(id)}>
              <span className="adm__ic">{I[ic]}</span>
              <span className="adm__l"><span>{l}</span><i className="hi">{hi}</i></span>
              {n && <span className="adm__n">{n}</span>}
            </button>
          ))}
        </nav>
        <div className="adm__foot">
          <Av n="Om Chauhan" s={28} c="#7c5cbf" />
          <span style={{ minWidth: 0 }}><b>Om Chauhan</b><i>Platform admin</i></span>
        </div>
      </aside>
      <div className="adm__main">
        <div className="adm__bar">
          <button className="adm__burger" onClick={() => setNav(true)} aria-label="Admin navigation">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 5.5h14M3 10h14M3 14.5h14" /></svg>
          </button>
          <span className="adm__crumb"><b>Aekam platform</b>{I.chevR}<span className="hi">{cur[2]}</span><span>{cur[1]}</span>{org && <>{I.chevR}<span>{org}</span></>}</span>
          <span style={{ flex: 1 }} />
          <span className="adm__warn">{SI.eye} Everything here is audited</span>
          <button className="adm__exit" onClick={exit}>{I.chevL} App</button>
          <button className="icobtn">{I.bell}<span className="icobtn__dot" /></button>
        </div>
        <div className="adm__body">
          <PH kick="Aekam platform · मंच" hi={cur[2]} en={cur[1]}
            lede={{
              dash: 'Cross-organisation health in one view. Nothing here is visible to any tenant.',
              orgs: 'Every organisation on the platform. Click one to open its plan, members, modules, invoices and audit trail.',
              users: 'Every user across every organisation, including Aekam staff who hold no org membership at all.',
              billing: 'Invoices, payments and overdue management across the platform.',
              costs: 'What each organisation costs to serve against what it pays. Margin never leaves this surface.',
              support: 'Time-boxed access into customer organisations, granted by the customer and revocable by both sides.',
              sys: 'Global defaults, email templates, maintenance mode and feature flags.',
            }[view]} />
          {BODY[view]}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AdminConsole, AdmDash, AdmOrgs, AdmUsers, AdmInvoices, AdmCosts, AdmSupport, AdmSys, ADM_NAV, ORGS, Bars });
