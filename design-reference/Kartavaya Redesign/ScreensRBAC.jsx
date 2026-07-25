// RBAC — org members, module matrix, invite wizard, platform-support approval, audit
// Per PLAN_RBAC.md. approver:false = this module has no approver level.
// def = the level a new grant defaults to. sensitive = role-derived: Ganit, Vetana
// and Manav are NOT granted per member. Access follows the org role, so their cells
// are locked rather than pickable.
const SENS_BY_ROLE = { org_owner: 'admin', org_admin: 'admin', manager: 'none', member: 'none', client: 'none' };
const ROLE_NAME = { org_owner: 'Owner', org_admin: 'Org admin', manager: 'Manager', member: 'Member', client: 'Client' };
const MODULES = [
  { code: 'kartavya', hi: 'कर्तव्य', en: 'Projects', approver: false, def: 'admin' },
  { code: 'graha', hi: 'ग्रह', en: 'CRM', approver: true, def: 'admin' },
  { code: 'vikray', hi: 'विक्रय', en: 'Sales', approver: true, def: 'admin' },
  { code: 'ganit', hi: 'गणित', en: 'Accounting', approver: true, def: 'viewer', sensitive: true },
  { code: 'vetana', hi: 'वेतन', en: 'Payroll', approver: true, def: 'viewer', sensitive: true },
  { code: 'manav', hi: 'मानव', en: 'HRMS', approver: true, def: 'viewer', sensitive: true },
  { code: 'prachar', hi: 'प्रचार', en: 'Marketing', approver: true, def: 'admin' },
  { code: 'dristi', hi: 'दृष्टि', en: 'Analytics', approver: false, def: 'admin' },
  { code: 'srijan', hi: 'सृजन', en: 'AI', approver: false, def: 'admin' },
  { code: 'esign', hi: 'हस्ताक्षर', en: 'eSign', approver: false, def: 'admin' },
  { code: 'sanvaad', hi: 'संवाद', en: 'Messaging', approver: false, def: 'admin' },
];

// What each level can do per module — drives the role guide and the degraded views
const CAN = {
  kartavya: { viewer: 'View tasks, boards', editor: 'Create/edit tasks, log time', admin: 'Manage views, templates, automations' },
  graha: { viewer: 'View contacts, deals', editor: 'Create/edit contacts, deals', approver: 'Approve deal stages', admin: 'Manage pipelines, import/export' },
  vikray: { viewer: 'View orders, invoices', editor: 'Create orders, draft invoices', approver: 'Approve quotes, confirm invoices', admin: 'Manage products, price lists, taxes' },
  ganit: { viewer: 'View journal entries', editor: 'Create entries, reconcile', approver: 'Approve entries, close periods', admin: 'Manage chart of accounts' },
  vetana: { viewer: 'View own payslips', editor: 'Prepare payroll runs', approver: 'Approve payroll, release payments', admin: 'Manage salary structures' },
  manav: { viewer: 'View org chart, own profile', editor: 'Manage employee records', approver: 'Approve leave, expenses', admin: 'Manage policies, departments' },
  prachar: { viewer: 'View campaigns', editor: 'Create campaigns, posts', approver: 'Approve for publish', admin: 'Manage channels, budgets' },
  dristi: { viewer: 'View dashboards', editor: 'Create/edit reports', admin: 'Manage data sources' },
  srijan: { viewer: 'Use chatbot', editor: 'Manage KB docs', admin: 'Configure models, publish bots' },
  esign: { viewer: 'View signed docs', editor: 'Create/send sign requests', admin: 'Manage templates' },
  sanvaad: { viewer: 'Read channels', editor: 'Send messages, create channels', admin: 'Manage channel settings' },
};

// Aekam enables these for the org; the org admin can only grant within them
const ORG_ENABLED = ['kartavya', 'graha', 'ganit', 'manav', 'vetana', 'dristi'];

const LVL = {
  none: ['—', 'var(--on-surface-faint)', 'transparent'],
  viewer: ['Viewer', '#6E747C', 'color-mix(in srgb, #6E747C 14%, transparent)'],
  editor: ['Editor', '#0082c6', 'color-mix(in srgb, #0082c6 16%, transparent)'],
  approver: ['Approver', '#A66207', 'color-mix(in srgb, #A66207 18%, transparent)'],
  admin: ['Admin', '#04837A', 'color-mix(in srgb, #04837A 18%, transparent)'],
};
const LEVELS = ['none', 'viewer', 'editor', 'approver', 'admin'];

const MEMBERS = [
  { n: 'Keval Shah', e: 'keval@aekam.co', role: 'org_owner', job: 'Founder', last: 'now', g: { kartavya: 'admin', graha: 'admin', ganit: 'admin', manav: 'admin', vetana: 'admin', dristi: 'admin' } },
  { n: 'Aanya Mehta', e: 'aanya@aekam.co', role: 'org_admin', job: 'CFO', last: '12m ago', g: { kartavya: 'editor', ganit: 'approver', vetana: 'approver', dristi: 'editor', graha: 'viewer' } },
  { n: 'Rohan Iyer', e: 'rohan@aekam.co', role: 'org_member', job: 'Legal', last: '3h ago', g: { kartavya: 'editor', graha: 'editor', ganit: 'viewer' } },
  { n: 'Priya Nair', e: 'priya@aekam.co', role: 'org_member', job: 'SM Account Manager', last: '1h ago', g: { kartavya: 'editor', graha: 'viewer' } },
  { n: 'Arjun Desai', e: 'arjun@aekam.co', role: 'org_member', job: 'Sales', last: '2d ago', g: { kartavya: 'viewer', graha: 'editor' } },
  { n: 'Fatima Sheikh', e: 'fatima@aekam.co', role: 'org_admin', job: 'Operations', last: '25m ago', g: { kartavya: 'admin', manav: 'admin', vetana: 'viewer', dristi: 'editor' } },
];

function Lvl({ v }) {
  const [lbl, c, bg] = LVL[v] || LVL.none;
  if (v === 'none' || !v) return <span style={{ color: 'var(--on-surface-faint)', fontSize: 12 }}>—</span>;
  return <span className="tag" style={{ '--c': c, background: bg }}>{lbl}</span>;
}

function RoleBadge({ r }) {
  const M = { org_owner: ['Owner', '#04837A'], org_admin: ['Admin', '#0082c6'], org_member: ['Member', '#6E747C'], client: ['Client', '#7c5cbf'] };
  const [lbl, c] = M[r] || M.org_member;
  return <span className="tag" style={{ '--c': c }}><span className="tag__dot" />{lbl}</span>;
}

// ── Screen: org members + matrix + invite + support + audit ────────────
function ScreenRoles({ open }) {
  const [tab, setTab] = React.useState('members');
  const TABS = ['members', 'matrix', 'role levels', 'denied states', 'client portal', 'module rules', 'invitations', 'support access', 'audit log', 'projects'];
  return (
    <div className="screen">
      <PH kick="Settings · व्यवस्था" hi="अधिकार" en="Roles & access"
        lede="Aekam enables modules for this organisation. You grant them to people, at a level per module."
        right={<><button className="btn btn--out btn--sm" onClick={() => open('roleguide')}>{I.doc} Role guide</button><button className="btn btn--fill btn--sm" onClick={() => open('invite')}>{I.plus} Invite</button></>} />

      <div style={{ display: 'flex', gap: 10, padding: '10px 13px', background: 'var(--s-container)', borderRadius: 'var(--r-md)', fontSize: 12.5, alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--ok)', flexShrink: 0, marginTop: 1 }}>{I.check}</span>
        <span style={{ minWidth: 0 }}>
          <b>{ORG_ENABLED.length} of {MODULES.length} modules</b> enabled for Aekam Inc by the Aekam platform.
          <span className="mute"> Vikray, Prachar, Srijan, eSign and Sanvaad are not enabled — request them before you can grant access.</span>
        </span>
      </div>

      <TabBar tabs={TABS} val={tab} set={setTab} max={6} counts={{ members: MEMBERS.length, 'support access': 1, invitations: 2 }} />

      {tab === 'members' && (
        <div className="tbl">
          <div className="tbl__scroll">
            <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.5fr) 116px minmax(0,1.7fr) 92px 44px' }}>
              <span>Member</span><span>Org role</span><span>Module grants</span><span>Last active</span><span></span>
            </div>
            {MEMBERS.map(m => (
              <div key={m.e} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.5fr) 116px minmax(0,1.7fr) 92px 44px' }}>
                <span className="tbl__c"><Av n={m.n} s={30} /><span style={{ minWidth: 0 }}>
                  <span className="tbl__t" style={{ display: 'block' }}>{m.n}</span>
                  <span className="tbl__s">{m.e} · <i style={{ fontStyle: 'normal', color: 'var(--on-surface-faint)' }}>{m.job}</i></span>
                </span></span>
                <span className="tbl__c"><RoleBadge r={m.role} /></span>
                <span className="tbl__c" style={{ flexWrap: 'wrap', gap: 5, overflow: 'visible' }}>
                  {Object.entries(m.g).slice(0, 3).map(([code, lvl]) => {
                    const mod = MODULES.find(x => x.code === code), [, c, bg] = LVL[lvl];
                    return <span key={code} className="tag" style={{ '--c': c, background: bg }}>
                      <span className="hi">{mod.hi}</span> {LVL[lvl][0]}
                      {mod.sensitive && <b title="Sensitive module" style={{ opacity: .7 }}>·</b>}
                    </span>;
                  })}
                  {Object.keys(m.g).length > 3 && <span className="mute" style={{ fontSize: 11.5 }}>+{Object.keys(m.g).length - 3}</span>}
                </span>
                <span className="tbl__c"><span className="tbl__s mono">{m.last}</span></span>
                <span className="tbl__c"><button className="icobtn" onClick={() => open('member', m)}>{I.dots}</button></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'matrix' && (
        <>
          <div className="between">
            <div className="chips">
              {LEVELS.slice(1).map(l => <span key={l} className="tag" style={{ '--c': LVL[l][1], background: LVL[l][2] }}>{LVL[l][0]}</span>)}
            </div>
            <span className="mute" style={{ fontSize: 11.5 }}>Click any cell to change a level. Sensitive modules are locked — they follow the org role.</span>
          </div>
          <div className="tbl mtx-tbl">
            <div className="tbl__scroll">
              <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(150px,1.4fr) repeat(6, minmax(84px, 1fr))' }}>
                <span>Member</span>
                {ORG_ENABLED.map(code => {
                  const m = MODULES.find(x => x.code === code);
                  return <span key={code} style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                    <span className="hi" style={{ fontSize: 12, textTransform: 'none', letterSpacing: 0, color: m.sensitive ? 'var(--danger)' : 'var(--primary)' }}>{m.hi}</span>
                    <span style={{ fontSize: 8.5 }}>{m.en}{m.sensitive ? ' ⚠' : ''}</span>
                  </span>;
                })}
              </div>
              {MEMBERS.map(mem => (
                <div key={mem.e} className="tbl__row" style={{ gridTemplateColumns: 'minmax(150px,1.4fr) repeat(6, minmax(84px, 1fr))' }}>
                  <span className="tbl__c"><Av n={mem.n} s={26} /><span className="tbl__t">{mem.n}</span></span>
                  {ORG_ENABLED.map(code => (
                    <span key={code} className="tbl__c">
                      <button style={{ width: '100%', textAlign: 'left' }} onClick={() => open('cell', { mem, code })}><Lvl v={mem.g[code] || 'none'} /></button>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <MatrixCards open={open} />
          <div className="mute" style={{ fontSize: 11.5 }}>Below 1024px this becomes one card per member — a 6-column grid can't be read on a phone.</div>
        </>
      )}

      {tab === 'role levels' && <RolesDegradation />}
      {tab === 'denied states' && <RolesDenied open={open} />}
      {tab === 'client portal' && <RolesClient />}
      {tab === 'module rules' && <RolesSettings />}

      {tab === 'support access' && (
        <div className="two">
          <div className="col">
            <Card title="Pending request" hi="अनुरोध" right={<Tag c="#A66207">Needs your decision</Tag>}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 13 }}>
                <Av n="Sneha Kshatriya" s={40} c="#7c5cbf" />
                <div style={{ minWidth: 0 }}>
                  <div className="rowflex" style={{ gap: 8 }}><b style={{ fontSize: 14 }}>Sneha Kshatriya</b><span className="tag" style={{ '--c': '#7c5cbf' }}><span className="tag__dot" />Platform support</span></div>
                  <div className="mute" style={{ fontSize: 12, marginTop: 2 }}>sneha@aekaminc.com · requested 14 minutes ago</div>
                  <div style={{ marginTop: 11, padding: '10px 12px', background: 'var(--s-container)', borderRadius: 'var(--r-sm)', fontSize: 12.5, lineHeight: 1.55 }}>
                    “Ticket #4821 — you reported GSTR-3B totals not matching the invoice list. I need to see the July invoices and the reconciliation to reproduce it.”
                  </div>
                  <div className="rowflex" style={{ gap: 6, marginTop: 11 }}>
                    <span className="mute" style={{ fontSize: 11.5 }}>Asked for</span>
                    <span className="tag" style={{ '--c': '#A66207', background: LVL.viewer[2] }}><span className="hi">गणित</span> Viewer</span>
                    <span className="tag" style={{ '--c': '#6E747C', background: LVL.viewer[2] }}><span className="hi">दृष्टि</span> Viewer</span>
                  </div>
                  <div className="rowflex" style={{ gap: 8, marginTop: 14 }}>
                    <button className="btn btn--fill btn--sm" onClick={() => open('approve-support')}>Review &amp; approve</button>
                    <button className="btn btn--out btn--sm" onClick={() => open('request-access')}>See the agent's side</button>
                    <button className="btn btn--danger btn--sm">Deny</button>
                  </div>
                </div>
              </div>
            </Card>
            <Card title="Active sessions" hi="सक्रिय" flush right={<Tag c="#04837A">1 live</Tag>}>
              <div className="tbl__scroll">
                <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1.2fr) 92px 104px 78px' }}>
                  <span>Agent</span><span>Modules</span><span>Level</span><span>Expires in</span><span></span>
                </div>
                <div className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1.2fr) 92px 104px 78px' }}>
                  <span className="tbl__c"><Av n="Om Chauhan" s={26} c="#7c5cbf" /><span style={{ minWidth: 0 }}><span className="tbl__t" style={{ display: 'block' }}>Om Chauhan</span><span className="tbl__s">granted by Keval</span></span></span>
                  <span className="tbl__c"><span className="tag" style={{ '--c': '#6E747C', background: LVL.viewer[2] }}><span className="hi">ग्रह</span></span></span>
                  <span className="tbl__c"><Lvl v="viewer" /></span>
                  <span className="tbl__c"><span className="mono" style={{ fontSize: 12.5, color: 'var(--warn)', fontWeight: 600 }}>1h 42m</span></span>
                  <span className="tbl__c"><button className="btn btn--danger btn--sm">Revoke</button></span>
                </div>
              </div>
            </Card>
          </div>
          <Card title="How support access works" hi="नियम">
            <ol className="col" style={{ gap: 9, margin: 0, paddingLeft: 17, fontSize: 12.5, color: 'var(--on-surface-2)', lineHeight: 1.55 }}>
              <li>Platform support starts with <b>zero access</b> to your data.</li>
              <li>They must request specific modules and state a reason.</li>
              <li>You choose the level and a <b>time limit</b> — it expires on its own.</li>
              <li>Everything they open is written to your audit log.</li>
              <li>You can revoke instantly, at any point.</li>
            </ol>
            <div className="rowflex" style={{ gap: 9, marginTop: 14, padding: '10px 12px', background: 'var(--ok-container)', borderRadius: 'var(--r-sm)', fontSize: 12 }}>
              {I.check}<span>Support can never be granted <b>Approver</b> or <b>Admin</b> on a sensitive module.</span>
            </div>
          </Card>
        </div>
      )}

      {tab === 'audit log' && (
        <>
          <div className="between">
            <div className="chips">
              <button className="chip on">All events</button>
              <button className="chip">Role changes</button>
              <button className="chip">Support sessions</button>
              <button className="chip">Record access</button>
              <button className="chip">Denied attempts</button>
            </div>
            <button className="btn btn--out btn--sm">{I.doc} Export</button>
          </div>
          <Card flush>
            <div style={{ padding: 'var(--pad-card)' }}>
              {[['Om Chauhan', 'support', 'opened 14 contact records in ग्रह', '11:42', '#7c5cbf'],
                ['Keval Shah', 'owner', 'granted Fatima Sheikh Admin on मानव', '10:18', '#04837A'],
                ['Rohan Iyer', 'member', 'was denied — tried to create an invoice with Viewer access', '09:54', '#B42318'],
                ['Keval Shah', 'owner', 'approved 2h support access for Om Chauhan on ग्रह', '09:40', '#04837A'],
                ['Aanya Mehta', 'admin', 'approved the July payroll run in वेतन', '09:12', '#0082c6'],
                ['System', '', 'expired support session for Sneha Kshatriya', 'Yesterday', '#6E747C']].map(([who, role, what, when, c], i, a) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 13, paddingBottom: i < a.length - 1 ? 15 : 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 9, background: c, marginTop: 5, flexShrink: 0 }} />
                    {i < a.length - 1 && <span style={{ flex: 1, width: 1, background: 'var(--outline-variant)', marginTop: 3 }} />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 13 }}><b>{who}</b>{role && <span className="mute" style={{ fontSize: 11.5 }}> ({role})</span>} {what}</span>
                  </div>
                  <span className="mute mono" style={{ fontSize: 11 }}>{when}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {tab === 'projects' && (
        <div className="two">
          <Card title="Quarterly GST filing" hi="परियोजना" flush right={<button className="btn btn--out btn--sm">{I.plus} Add member</button>}>
            <div className="tbl__scroll">
              <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.6fr) 116px minmax(0,1fr)' }}><span>Member</span><span>Project role</span><span>Org</span></div>
              {[['Keval Shah', 'owner', 'Aekam Inc'], ['Aanya Mehta', 'admin', 'Aekam Inc'], ['Rohan Iyer', 'member', 'Aekam Inc'], ['Meera Joshi', 'client', '— external guest']].map(([n, r, org]) => (
                <div key={n} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.6fr) 116px minmax(0,1fr)' }}>
                  <span className="tbl__c"><Av n={n} s={26} /><span className="tbl__t">{n}</span></span>
                  <span className="tbl__c"><RoleBadge r={r === 'client' ? 'client' : r === 'owner' ? 'org_owner' : r === 'admin' ? 'org_admin' : 'org_member'} /></span>
                  <span className="tbl__c"><span className="tbl__s" style={{ color: r === 'client' ? 'var(--warn)' : undefined }}>{org}</span></span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Guest containment" hi="अतिथि">
            <div className="rowflex" style={{ gap: 9, padding: '10px 12px', background: 'var(--warn-container)', borderRadius: 'var(--r-sm)', fontSize: 12.5, lineHeight: 1.55, alignItems: 'flex-start' }}>
              <span style={{ flexShrink: 0 }}>{I.clock}</span>
              <span><b>Meera Joshi is a guest, not a member.</b> She holds no org identity and no module access — she can only open this one board.</span>
            </div>
            <div className="divider" style={{ margin: '14px 0' }} />
            <div className="between" style={{ marginBottom: 9 }}>
              <span className="prop__l"><span>Internal-only items</span><span className="prop__hi">आंतरिक</span></span>
              <span className="sw on" />
            </div>
            <div className="mute" style={{ fontSize: 12, lineHeight: 1.55 }}>Tasks and comments are internal by default. Share one with the client explicitly — otherwise inviting a client to a board shows them your notes about them.</div>
            <div className="rowflex" style={{ gap: 6, marginTop: 12 }}>
              <span className="tag" style={{ '--c': '#6E747C' }}>14 internal</span>
              <span className="tag" style={{ '--c': '#04837A' }}>6 shared with client</span>
            </div>
          </Card>
        </div>
      )}

      {tab === 'invitations' && (
        <Card flush>
          <div className="tbl__scroll">
            <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.5fr) 116px minmax(0,1.4fr) 96px 92px' }}>
              <span>Email</span><span>Org role</span><span>Grants</span><span>Sent</span><span>Status</span>
            </div>
            {[['manthan@aekam.co', 'org_member', [['vikray', 'editor']], '2d ago', 'Pending'], ['kasti@aekam.co', 'org_member', [['ganit', 'viewer'], ['dristi', 'viewer']], '5d ago', 'Expired']].map(([e, r, g, sent, st]) => (
              <div key={e} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.5fr) 116px minmax(0,1.4fr) 96px 92px' }}>
                <span className="tbl__c"><span className="tbl__t">{e}</span></span>
                <span className="tbl__c"><RoleBadge r={r} /></span>
                <span className="tbl__c" style={{ gap: 5 }}>{g.map(([c, l]) => <span key={c} className="tag" style={{ '--c': LVL[l][1], background: LVL[l][2] }}><span className="hi">{MODULES.find(m => m.code === c).hi}</span> {LVL[l][0]}</span>)}</span>
                <span className="tbl__c"><span className="tbl__s mono">{sent}</span></span>
                <span className="tbl__c"><Tag c={st === 'Pending' ? '#A66207' : '#6E747C'}>{st}</Tag></span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}


// ══ Level picker — hides approver on modules that have no approver level ══
function LevelPick({ mod, val, set }) {
  const opts = ['none', 'viewer', 'editor', ...(mod.approver ? ['approver'] : []), 'admin'];
  return (
    <div className="seg" style={{ width: '100%' }}>
      {opts.map(l => (
        <button key={l} className={'seg__b' + (val === l ? ' on' : '')} style={{ flex: 1, justifyContent: 'center', padding: '5px 6px', fontSize: 11.5 }}
          onClick={() => set(l)} title={l === 'none' ? 'No access' : CAN[mod.code]?.[l]}>
          {l === 'none' ? 'None' : LVL[l][0]}
        </button>
      ))}
    </div>
  );
}

// ══ 5-step invite wizard — vertical flow on mobile, stepper on desktop ══
function InviteWizard({ close }) {
  const [step, setStep] = React.useState(1);
  const [role, setRole] = React.useState('org_member');
  const [grants, setGrants] = React.useState({});
  const [confirm, setConfirm] = React.useState(null);
  const enabled = MODULES.filter(m => ORG_ENABLED.includes(m.code));
  const STEPS = ['People', 'Org role', 'Module access', 'Projects', 'Review'];

  const setGrant = (mod, lvl) => {
    if (mod.sensitive && (lvl === 'approver' || lvl === 'admin')) { setConfirm({ mod, lvl }); return; }
    setGrants(g => ({ ...g, [mod.code]: lvl }));
  };

  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="sheet" style={{ width: 'min(680px, calc(100% - 48px))' }}>
        <div className="sheet__head">
          <h3 className="sheet__t">Invite to Aekam Inc <span className="hi" style={{ fontSize: 15, color: 'var(--primary)' }}>निमंत्रण</span></h3>
          <span className="mute mono" style={{ fontSize: 11, marginLeft: 'auto' }}>Step {step} of 5</span>
          <button className="icobtn" onClick={close}>{I.x}</button>
        </div>

        <div className="tabs" style={{ padding: '0 var(--pad-card)', flexShrink: 0 }}>
          <div className="tabs__scroll">
            {STEPS.map((s, i) => (
              <button key={s} className={'tabs__b' + (step === i + 1 ? ' on' : '')} onClick={() => setStep(i + 1)}>
                <span style={{ width: 17, height: 17, borderRadius: 9, display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, background: step > i + 1 ? 'var(--ok)' : step === i + 1 ? 'var(--primary)' : 'var(--s-highest)', color: step >= i + 1 ? '#fff' : 'var(--on-surface-3)' }}>{step > i + 1 ? '✓' : i + 1}</span>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="sheet__body">
          {step === 1 && (
            <>
              <div className="fld"><span className="fld__l">Email addresses</span>
                <textarea className="inp" rows="3" placeholder="manthan@aekam.co, kasti@aekam.co" autoFocus />
                <span className="mute" style={{ fontSize: 11.5 }}>One per line, or comma-separated. Paste a CSV column to bulk invite.</span>
              </div>
              <div className="rowflex" style={{ gap: 9, padding: '10px 12px', background: 'var(--s-container)', borderRadius: 'var(--r-sm)', fontSize: 12.5 }}>
                {I.check}<span>The person must already have a Kartavaya account.</span>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div className="fld"><span className="fld__l">Organisation role</span></div>
              {[['org_admin', 'Org Admin', 'Manages members, module grants, branding. Cannot transfer ownership or delete the org.'],
                ['org_member', 'Org Member', 'Uses only the modules you grant, at the level you set.']].map(([v, t, d]) => (
                <button key={v} onClick={() => setRole(v)} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 11, textAlign: 'left', padding: '13px 14px', borderRadius: 'var(--r-md)', border: '1px solid ' + (role === v ? 'var(--primary)' : 'var(--outline-variant)'), background: role === v ? 'var(--primary-container)' : 'transparent' }}>
                  <span style={{ width: 17, height: 17, borderRadius: 9, marginTop: 2, border: '2px solid ' + (role === v ? 'var(--primary)' : 'var(--outline)'), background: role === v ? 'var(--primary)' : 'transparent', boxShadow: role === v ? 'inset 0 0 0 3px var(--on-primary)' : 'none' }} />
                  <span><b style={{ fontSize: 13.5, display: 'block' }}>{t}</b><span className="mute" style={{ fontSize: 12, lineHeight: 1.5 }}>{d}</span></span>
                </button>
              ))}
              <div className="mute" style={{ fontSize: 11.5 }}>Owner can't be assigned here — ownership is transferred, not granted.</div>
            </>
          )}
          {step === 3 && (
            <>
              <div className="between"><span className="fld__l">Module access</span><span className="mute" style={{ fontSize: 11.5 }}>{ORG_ENABLED.length} enabled for this org</span></div>
              {enabled.map(m => (
                <div key={m.code} style={{ padding: '11px 12px', borderRadius: 'var(--r-md)', background: m.sensitive ? 'var(--danger-container)' : 'var(--s-low)' }}>
                  <div className="between" style={{ marginBottom: 8 }}>
                    <span className="rowflex" style={{ gap: 8 }}>
                      <b className="hi" style={{ fontSize: 15, color: m.sensitive ? 'var(--danger)' : 'var(--primary)' }}>{m.hi}</b>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{m.en}</span>
                      {m.sensitive && <span className="tag" style={{ '--c': '#B42318' }}>Sensitive · by org role</span>}
                    </span>
                  </div>
                  {m.sensitive ? (() => {
                    const lvl = SENS_BY_ROLE[role] || 'none';
                    return <>
                      <div className="rowflex" style={{ gap: 9, padding: '9px 11px', background: 'var(--surface)', borderRadius: 'var(--r-sm)', fontSize: 12, lineHeight: 1.5 }}>
                        <span style={{ color: 'var(--danger)', fontWeight: 700 }}>⚠</span>
                        <span>Not granted per member. <b>{ROLE_NAME[role] || 'This role'}</b> gets <b>{lvl === 'none' ? 'no access' : LVL[lvl][0]}</b> — change the org role to change this.</span>
                      </div>
                      <div className="mute" style={{ fontSize: 11.5, marginTop: 6 }}>{CAN[m.code]?.[lvl] || 'No access to this module'}</div>
                    </>;
                  })() : <>
                    <LevelPick mod={m} val={grants[m.code] || m.def} set={l => setGrant(m, l)} />
                    <div className="mute" style={{ fontSize: 11.5, marginTop: 6 }}>{CAN[m.code]?.[grants[m.code] || m.def] || 'No access to this module'}</div>
                  </>}
                </div>
              ))}
              <div className="mute" style={{ fontSize: 11.5 }}>Modules Aekam hasn't enabled for Aekam Inc can't be granted — request them first.</div>
            </>
          )}
          {step === 4 && (
            <>
              <div className="fld"><span className="fld__l">Project assignments — optional</span></div>
              {[['Quarterly GST filing', 'राजस्व'], ['Diwali campaign', 'विपणन'], ['Mumbai fit-out', 'समीक्षा']].map(([p, hi]) => (
                <div key={p} className="between" style={{ padding: '10px 12px', borderRadius: 'var(--r-md)', background: 'var(--s-low)' }}>
                  <span className="rowflex" style={{ gap: 8 }}><span className="sw" /><b style={{ fontSize: 13 }}>{p}</b><span className="hi mute" style={{ fontSize: 12 }}>{hi}</span></span>
                  <select className="inp" style={{ width: 128, padding: '6px 26px 6px 10px' }}><option>Member</option><option>Admin</option><option>Client</option></select>
                </div>
              ))}
            </>
          )}
          {step === 5 && (
            <>
              <div className="fld"><span className="fld__l">Review</span></div>
              <div className="col" style={{ gap: 11, padding: '13px 14px', background: 'var(--s-low)', borderRadius: 'var(--r-md)' }}>
                <div className="between"><span className="mute" style={{ fontSize: 12 }}>Inviting</span><b style={{ fontSize: 13 }}>manthan@aekam.co</b></div>
                <div className="between"><span className="mute" style={{ fontSize: 12 }}>Org role</span><RoleBadge r={role} /></div>
                <div className="divider" />
                {enabled.map(m => {
                  const lvl = m.sensitive ? (SENS_BY_ROLE[role] || 'none') : (grants[m.code] || m.def);
                  return <div key={m.code} className="between"><span className="rowflex" style={{ gap: 7 }}><span className="hi mute" style={{ fontSize: 13 }}>{m.hi}</span><span className="mute" style={{ fontSize: 12 }}>{m.en}</span></span><Lvl v={lvl} /></div>;
                })}
              </div>
              <div className="rowflex" style={{ gap: 9, padding: '10px 12px', background: 'var(--ok-container)', borderRadius: 'var(--r-sm)', fontSize: 12.5 }}>
                {I.check}<span>They'll get an email and a WhatsApp message with the invite link.</span>
              </div>
            </>
          )}
        </div>

        <div className="sheet__foot">
          {step > 1 && <button className="btn btn--out btn--sm" style={{ marginRight: 'auto' }} onClick={() => setStep(step - 1)}>{I.chevL} Back</button>}
          <button className="btn btn--out btn--sm" onClick={close}>Cancel</button>
          {step < 5
            ? <button className="btn btn--fill btn--sm" onClick={() => setStep(step + 1)}>Continue {I.chevR}</button>
            : <button className="btn btn--fill btn--sm" onClick={close}>Send invite</button>}
        </div>
      </div>
      {confirm && <RoleConfirm mod={confirm.mod} lvl={confirm.lvl} who="manthan@aekam.co"
        onCancel={() => setConfirm(null)}
        onOk={() => { setGrants(g => ({ ...g, [confirm.mod.code]: confirm.lvl })); setConfirm(null); }} />}
    </>
  );
}

// ══ Sensitive-module escalation warning ══
function RoleConfirm({ mod, lvl, who, onCancel, onOk }) {
  const WHY = { ganit: 'journal entries, the chart of accounts and every invoice', vetana: 'payroll data including individual salaries', manav: 'employee records, salaries and personal documents' };
  return (
    <>
      <div className="scrim" style={{ zIndex: 130 }} onClick={onCancel} />
      <div className="sheet" style={{ zIndex: 135, width: 'min(460px, calc(100% - 48px))', top: '12%' }}>
        <div className="sheet__head" style={{ background: 'var(--danger-container)' }}>
          <span style={{ color: 'var(--danger)' }}>{I.clock}</span>
          <h3 className="sheet__t" style={{ fontSize: 16 }}>Grant {LVL[lvl][0]} on <span className="hi" style={{ color: 'var(--danger)' }}>{mod.hi}</span>?</h3>
        </div>
        <div className="sheet__body">
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>
            <b>{mod.en}</b> contains {WHY[mod.code] || 'sensitive business data'}. {LVL[lvl][0]} access lets <b>{who}</b> {(CAN[mod.code]?.[lvl] || '').toLowerCase()}.
          </p>
          <div className="rowflex" style={{ gap: 9, padding: '10px 12px', background: 'var(--s-container)', borderRadius: 'var(--r-sm)', fontSize: 12.5 }}>
            {I.check}<span>This change is written to the audit log with your name.</span>
          </div>
        </div>
        <div className="sheet__foot">
          <button className="btn btn--out btn--sm" onClick={onCancel}>Keep viewer</button>
          <button className="btn btn--fill btn--sm" style={{ background: 'var(--danger)' }} onClick={onOk}>Grant {LVL[lvl][0]}</button>
        </div>
      </div>
    </>
  );
}

// ══ Support approval — TTL picker, module scope, viewer/editor only ══
function SupportApprove({ close }) {
  const [ttl, setTtl] = React.useState('24h');
  const [lvl, setLvl] = React.useState('viewer');
  const [mods, setMods] = React.useState(['ganit', 'dristi']);
  const toggle = c => setMods(m => m.includes(c) ? m.filter(x => x !== c) : [...m, c]);
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="sheet" style={{ width: 'min(560px, calc(100% - 48px))' }}>
        <div className="sheet__head">
          <h3 className="sheet__t">Approve support access</h3>
          <button className="icobtn" style={{ marginLeft: 'auto' }} onClick={close}>{I.x}</button>
        </div>
        <div className="sheet__body">
          <div className="rowflex" style={{ gap: 11 }}>
            <Av n="Sneha Kshatriya" s={36} c="#7c5cbf" />
            <span><b style={{ fontSize: 13.5, display: 'block' }}>Sneha Kshatriya</b><span className="mute" style={{ fontSize: 12 }}>Platform support · ticket #4821</span></span>
          </div>
          <div>
            <div className="fld__l" style={{ marginBottom: 7 }}>Time limit</div>
            <div className="seg" style={{ width: '100%' }}>
              {[['2h', '2 hours'], ['24h', '24 hours'], ['7d', '7 days'], ['manual', 'Until revoked']].map(([v, l]) => (
                <button key={v} className={'seg__b' + (ttl === v ? ' on' : '')} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setTtl(v)}>{l}</button>
              ))}
            </div>
            {ttl === 'manual' && <div className="rowflex" style={{ gap: 8, marginTop: 8, padding: '9px 11px', background: 'var(--warn-container)', borderRadius: 'var(--r-sm)', fontSize: 12 }}>{I.clock}<span>Open-ended access stays until you revoke it. A time limit is safer.</span></div>}
          </div>
          <div>
            <div className="fld__l" style={{ marginBottom: 7 }}>Access level</div>
            <div className="seg" style={{ width: '100%' }}>
              {['viewer', 'editor'].map(l => <button key={l} className={'seg__b' + (lvl === l ? ' on' : '')} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setLvl(l)}>{LVL[l][0]}</button>)}
            </div>
            <div className="mute" style={{ fontSize: 11.5, marginTop: 6 }}>Support can never be granted Approver or Admin.</div>
          </div>
          <div>
            <div className="fld__l" style={{ marginBottom: 7 }}>Modules they may open</div>
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
          </div>
        </div>
        <div className="sheet__foot">
          <span className="mute" style={{ fontSize: 11.5, marginRight: 'auto' }}>Expires {ttl === 'manual' ? 'only when revoked' : 'in ' + ttl} · fully audited</span>
          <button className="btn btn--danger btn--sm" onClick={close}>Deny</button>
          <button className="btn btn--fill btn--sm" onClick={close}>Approve {mods.length} module{mods.length === 1 ? '' : 's'}</button>
        </div>
      </div>
    </>
  );
}

// ══ Matrix cell editor ══
function CellEdit({ data, close }) {
  const mod = MODULES.find(m => m.code === data.code);
  const [lvl, setLvl] = React.useState(data.mem.g[data.code] || 'none');
  const [confirm, setConfirm] = React.useState(null);
  const pick = l => { if (mod.sensitive && (l === 'approver' || l === 'admin')) setConfirm(l); else setLvl(l); };
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="sheet" style={{ width: 'min(440px, calc(100% - 48px))' }}>
        <div className="sheet__head">
          <h3 className="sheet__t" style={{ fontSize: 16 }}>{data.mem.n} · <span className="hi" style={{ color: 'var(--primary)' }}>{mod.hi}</span></h3>
          <button className="icobtn" style={{ marginLeft: 'auto' }} onClick={close}>{I.x}</button>
        </div>
        <div className="sheet__body">
          <LevelPick mod={mod} val={lvl} set={pick} />
          <div style={{ padding: '11px 13px', background: 'var(--s-low)', borderRadius: 'var(--r-md)', fontSize: 12.5, lineHeight: 1.55 }}>
            {lvl === 'none' ? 'No access — ' + mod.en + ' will not appear in their sidebar.' : CAN[mod.code]?.[lvl]}
          </div>
          {!mod.approver && <div className="mute" style={{ fontSize: 11.5 }}>{mod.en} has no approver level — there is nothing to approve in this module.</div>}
        </div>
        <div className="sheet__foot">
          <button className="btn btn--out btn--sm" onClick={close}>Cancel</button>
          <button className="btn btn--fill btn--sm" onClick={close}>Save</button>
        </div>
      </div>
      {confirm && <RoleConfirm mod={mod} lvl={confirm} who={data.mem.n} onCancel={() => setConfirm(null)} onOk={() => { setLvl(confirm); setConfirm(null); }} />}
    </>
  );
}

// ══ Role guide ══
function RoleGuide({ close }) {
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="sheet" style={{ width: 'min(720px, calc(100% - 48px))' }}>
        <div className="sheet__head">
          <h3 className="sheet__t">What each level can do</h3>
          <button className="icobtn" style={{ marginLeft: 'auto' }} onClick={close}>{I.x}</button>
        </div>
        <div className="sheet__body" style={{ gap: 0 }}>
          <div className="tbl" style={{ border: 0 }}>
            <div className="tbl__scroll">
              <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(120px,1fr) repeat(4, minmax(130px,1.2fr))' }}>
                <span>Module</span>{['viewer', 'editor', 'approver', 'admin'].map(l => <span key={l} style={{ color: LVL[l][1] }}>{LVL[l][0]}</span>)}
              </div>
              {MODULES.map(m => (
                <div key={m.code} className="tbl__row" style={{ gridTemplateColumns: 'minmax(120px,1fr) repeat(4, minmax(130px,1.2fr))', alignItems: 'flex-start', paddingTop: 9, paddingBottom: 9 }}>
                  <span className="tbl__c" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                    <b className="hi" style={{ fontSize: 14, color: m.sensitive ? 'var(--danger)' : 'var(--primary)' }}>{m.hi}</b>
                    <span className="tbl__s">{m.en}{m.sensitive ? ' ⚠' : ''}</span>
                  </span>
                  {m.sensitive
                    ? <span className="tbl__c" style={{ gridColumn: 'span 4', fontSize: 11.5, lineHeight: 1.45, display: 'block', color: 'var(--danger)' }}>
                        Not grantable per member — Owner and Org admin get full access, everyone else none.
                      </span>
                    : ['viewer', 'editor', 'approver', 'admin'].map(l => (
                      <span key={l} className="tbl__c" style={{ fontSize: 11.5, color: CAN[m.code]?.[l] ? 'var(--on-surface-2)' : 'var(--on-surface-faint)', lineHeight: 1.45, display: 'block' }}>
                        {CAN[m.code]?.[l] || '—'}
                      </span>
                    ))}
                </div>
              ))}
            </div>
          </div>
          <div className="rowflex" style={{ gap: 9, padding: '11px 13px', background: 'var(--danger-container)', borderRadius: 'var(--r-sm)', fontSize: 12.5, marginTop: 14 }}>
            <span style={{ color: 'var(--danger)' }}>⚠</span><span><b>Sensitive modules</b> — Ganit, Vetana and Manav are not granted per member at all. Access follows the org role: Owner and Org admin have it, nobody else does. Every other module is granted per member and defaults to Admin.</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ══ Member sheet ══
function MemberSheet({ data, close }) {
  const m = data || MEMBERS[0];
  const enabled = MODULES.filter(x => ORG_ENABLED.includes(x.code));
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="drawer">
        <div className="drawer__head">
          <Av n={m.n} s={34} />
          <span style={{ minWidth: 0 }}><b style={{ fontSize: 14, display: 'block' }}>{m.n}</b><span className="mute" style={{ fontSize: 12 }}>{m.e}</span></span>
          <button className="icobtn" style={{ marginLeft: 'auto' }} onClick={close}>{I.x}</button>
        </div>
        <div className="drawer__body">
          <div className="props">
            <div className="prop"><span className="prop__l"><span>Org role</span></span><span className="prop__v"><RoleBadge r={m.role} /></span></div>
            <div className="prop"><span className="prop__l"><span>Job title</span><span className="prop__hi">पद</span></span><span className="prop__v">{m.job}</span></div>
            <div className="prop"><span className="prop__l"><span>Last active</span></span><span className="prop__v mono">{m.last}</span></div>
          </div>
          <div className="mute" style={{ fontSize: 11.5, marginTop: -8 }}>Job title is a label. It grants nothing.</div>
          <div className="divider" />
          <div>
            <div className="fld__l" style={{ marginBottom: 9 }}>Module grants</div>
            <div className="col" style={{ gap: 10 }}>
              {enabled.map(mod => (
                <div key={mod.code} style={{ padding: '10px 12px', borderRadius: 'var(--r-md)', background: mod.sensitive ? 'var(--danger-container)' : 'var(--s-low)' }}>
                  <div className="between" style={{ marginBottom: 7 }}>
                    <span className="rowflex" style={{ gap: 8 }}><b className="hi" style={{ fontSize: 14 }}>{mod.hi}</b><span style={{ fontSize: 12.5 }}>{mod.en}</span></span>
                    {mod.sensitive && <span className="tag" style={{ '--c': '#B42318' }}>Sensitive</span>}
                  </div>
                  <LevelPick mod={mod} val={m.g[mod.code] || 'none'} set={() => { }} />
                </div>
              ))}
            </div>
          </div>
          <div className="divider" />
          <div>
            <div className="fld__l" style={{ marginBottom: 8, color: 'var(--danger)' }}>Danger zone</div>
            <div className="col" style={{ gap: 8 }}>
              <button className="btn btn--danger btn--sm">Remove from organisation</button>
              {m.role === 'org_owner' && <button className="btn btn--danger btn--sm">Transfer ownership</button>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { LevelPick, InviteWizard, RoleConfirm, SupportApprove, CellEdit, RoleGuide, MemberSheet, MODULES, ORG_ENABLED, CAN, LVL, LEVELS, MEMBERS, Lvl, RoleBadge, ScreenRoles });
