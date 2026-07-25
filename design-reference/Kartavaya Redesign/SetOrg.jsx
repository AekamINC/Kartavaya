// B — Organisation settings hub. Six tabs. Profile field shape is the real
// /v1/org/profile payload from pages/OrgSettingsPage.jsx.
const ORG = {
  name: 'Aekam Inc', gstin: '27AAACA1234B1ZX', pan: 'AAACA1234B', email: 'accounts@aekam.co', phone: '+91 22 4890 1122',
  website: 'aekam.co', desc: 'Chartered accountancy and advisory practice. Placeholder description.',
  industry: 'CA / Legal practice', size: '1–10', founded: '2019',
  addr: { l1: '4th floor, Sunbeam Chambers', l2: 'Vithaldas Thackersey Marg', city: 'Mumbai', state: 'Maharashtra', pin: '400020', country: 'India' },
  bank: { name: 'Aekam Inc', num: '5010 0123 4567 89', ifsc: 'HDFC0000123', bank: 'HDFC Bank', branch: 'Churchgate', upi: 'aekam@hdfcbank' },
  note: 'Payment due within 30 days. Interest at 18% p.a. on overdue amounts as per MSME Act.',
};

function OrgProfile() {
  const [drag, setDrag] = React.useState(false);
  const [logo, setLogo] = React.useState(true);
  return (
    <div className="two">
      <div className="scol">
        <Card title="Company" hi="कंपनी">
          <div className="ogrid">
            <label className="fld" style={{ gridColumn: 'span 2' }}><span className="fld__l">Legal name</span><input className="inp" defaultValue={ORG.name} /></label>
            <label className="fld"><span className="fld__l">GSTIN</span><input className="inp mono" defaultValue={ORG.gstin} /><span className="au-f__hint">15 characters. Validated against the state code.</span></label>
            <label className="fld"><span className="fld__l">PAN</span><input className="inp mono" defaultValue={ORG.pan} /></label>
            <label className="fld"><span className="fld__l">Billing email</span><input className="inp" defaultValue={ORG.email} /></label>
            <label className="fld"><span className="fld__l">Phone</span><input className="inp mono" defaultValue={ORG.phone} /></label>
            <label className="fld"><span className="fld__l">Website</span><input className="inp" defaultValue={ORG.website} /></label>
            <label className="fld"><span className="fld__l">Founded</span><input className="inp mono" defaultValue={ORG.founded} /></label>
            <label className="fld" style={{ gridColumn: 'span 2' }}><span className="fld__l">Description</span><textarea className="inp" rows="2" defaultValue={ORG.desc} /></label>
            <div className="fld"><span className="fld__l">Industry</span><select className="inp" defaultValue={ORG.industry}>{['IT Services', 'Manufacturing', 'Retail & Trading', 'Agency', 'Consulting', 'CA / Legal practice', 'Other'].map(x => <option key={x}>{x}</option>)}</select></div>
            <div className="fld"><span className="fld__l">Team size</span><select className="inp" defaultValue={ORG.size}>{['1–10', '11–50', '51–200', '200+'].map(x => <option key={x}>{x}</option>)}</select></div>
          </div>
        </Card>
        <Card title="Billing address" hi="पता" right={<span className="mute" style={{ fontSize: 11.5 }}>appears on every invoice</span>}>
          <div className="ogrid">
            <label className="fld" style={{ gridColumn: 'span 2' }}><span className="fld__l">Address line 1</span><input className="inp" defaultValue={ORG.addr.l1} /></label>
            <label className="fld" style={{ gridColumn: 'span 2' }}><span className="fld__l">Address line 2</span><input className="inp" defaultValue={ORG.addr.l2} /></label>
            <label className="fld"><span className="fld__l">City</span><input className="inp" defaultValue={ORG.addr.city} /></label>
            <label className="fld"><span className="fld__l">State</span><input className="inp" defaultValue={ORG.addr.state} /><span className="au-f__hint">Drives place of supply.</span></label>
            <label className="fld"><span className="fld__l">PIN code</span><input className="inp mono" defaultValue={ORG.addr.pin} /></label>
            <label className="fld"><span className="fld__l">Country</span><input className="inp" defaultValue={ORG.addr.country} /></label>
          </div>
        </Card>
        <Card title="Bank details" hi="बैंक">
          <div className="ogrid">
            <label className="fld"><span className="fld__l">Account name</span><input className="inp" defaultValue={ORG.bank.name} /></label>
            <label className="fld"><span className="fld__l">Account number</span><input className="inp mono" defaultValue={ORG.bank.num} /></label>
            <label className="fld"><span className="fld__l">IFSC</span><input className="inp mono" defaultValue={ORG.bank.ifsc} /></label>
            <label className="fld"><span className="fld__l">Bank</span><input className="inp" defaultValue={ORG.bank.bank} /></label>
            <label className="fld"><span className="fld__l">Branch</span><input className="inp" defaultValue={ORG.bank.branch} /></label>
            <label className="fld"><span className="fld__l">UPI ID</span><input className="inp mono" defaultValue={ORG.bank.upi} /></label>
          </div>
          <div className="snote">{SI.lock} Bank details are shown on invoices and in the client portal. They are never sent to the AI assistant.</div>
        </Card>
      </div>
      <div className="scol">
        <Card title="Logo" hi="प्रतीक">
          <div className={'ologo' + (drag ? ' drag' : '')}
            onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); setLogo(true); }}>
            {logo ? (
              <>
                <Mark size={72} />
                <div className="ologo__meta"><b>favicon.png</b><span>512 × 512 · 14 KB</span></div>
                <div className="rowflex" style={{ gap: 7 }}>
                  <button className="btn btn--out btn--sm">Replace</button>
                  <button className="btn btn--out btn--sm">Crop</button>
                  <button className="btn btn--danger btn--sm" onClick={() => setLogo(false)}>Remove</button>
                </div>
              </>
            ) : (
              <>
                <span className="ologo__ic">{I.doc}</span>
                <b style={{ fontSize: 13 }}>Drop a logo here</b>
                <span className="mute" style={{ fontSize: 11.5, textAlign: 'center', maxWidth: '30ch' }}>PNG or SVG, at least 512px square. Used on invoices, the client portal and the sign-in panel.</span>
                <button className="btn btn--out btn--sm" onClick={() => setLogo(true)}>Choose a file</button>
              </>
            )}
          </div>
          <div className="ologo__uses">
            <span className="fld__l" style={{ marginBottom: 8, display: 'block' }}>Where it appears</span>
            {[['Tax invoice header', true], ['Client portal', true], ['Sign-in panel', true], ['Email templates', false]].map(([l, on]) => (
              <div key={l} className="between" style={{ padding: '7px 0' }}>
                <span style={{ fontSize: 12.5 }}>{l}</span>
                <SSwitch on={on} set={() => {}} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Invoice note" hi="टिप्पणी">
          <textarea className="inp" rows="4" defaultValue={ORG.note} />
          <div className="mute" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.5 }}>Printed at the foot of every invoice and quotation. Leave it empty and the block is omitted rather than left blank.</div>
        </Card>
      </div>
    </div>
  );
}

function OrgMembers({ open }) {
  return (
    <div className="scol">
      <div className="between">
        <span className="mute" style={{ fontSize: 12.5, maxWidth: '62ch' }}>
          Org role sets what somebody can administer. Module grants set what they can see and do. The two are separate on purpose — being an admin of the organisation does not grant payroll.
        </span>
        <div className="rowflex" style={{ gap: 8 }}>
          <button className="btn btn--out btn--sm">{I.doc} Role guide</button>
          <button className="btn btn--fill btn--sm">{I.plus} Add member</button>
        </div>
      </div>
      <div className="tbl"><div className="tbl__scroll">
        <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1.5fr) 108px minmax(0,1.8fr) 88px 44px' }}>
          <span>Member</span><span>Org role</span><span>Module grants</span><span>Last active</span><span></span>
        </div>
        {MEMBERS.map(m => (
          <div key={m.e} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1.5fr) 108px minmax(0,1.8fr) 88px 44px' }}>
            <span className="tbl__c"><Av n={m.n} s={30} /><span style={{ minWidth: 0 }}>
              <span className="tbl__t" style={{ display: 'block' }}>{m.n}</span><span className="tbl__s">{m.e}</span></span></span>
            <span className="tbl__c"><RoleBadge r={m.role} /></span>
            <span className="tbl__c" style={{ flexWrap: 'wrap', gap: 5, overflow: 'visible' }}>
              {Object.entries(m.g).slice(0, 3).map(([code, lvl]) => {
                const mod = MODULES.find(x => x.code === code);
                return <span key={code} className="tag" style={{ '--c': LVL[lvl][1], background: LVL[lvl][2] }}><span className="hi">{mod.hi}</span> {LVL[lvl][0]}</span>;
              })}
              {Object.keys(m.g).length > 3 && <span className="mute" style={{ fontSize: 11.5 }}>+{Object.keys(m.g).length - 3}</span>}
            </span>
            <span className="tbl__c"><span className="tbl__s mono">{m.last}</span></span>
            <span className="tbl__c"><button className="icobtn" onClick={() => open && open('member', m)}>{I.dots}</button></span>
          </div>
        ))}
      </div></div>
      <div className="snote">{I.check} The full permission matrix lives in <b>Roles &amp; access</b>. This tab is the roster; that one is the grid.</div>
    </div>
  );
}

// plan_code + monthly_credits from the platform PLAN_OPTIONS. Price is set per
// org by Aekam, so it is shown as agreed rather than as a published rate card.
const OPLANS = [
  ['Free', 'free', 0, 200, ['Up to 3 people', '3 modules', '2 GB files'], false],
  ['Starter', 'starter', 6000, 500, ['Unlimited people', '6 modules', '20 GB files'], false],
  ['Growth', 'growth', 10000, 1000, ['All 15 modules', 'WhatsApp inbox', '100 GB files', 'Priority support'], true],
  ['Scale', 'scale', null, 2000, ['Multi-entity', 'SSO and SCIM', 'Own R2 bucket', 'Contractual SLA'], false],
];
function OrgBilling() {
  return (
    <div className="scol">
      <div className="two">
        <div className="scol">
          <Card title="Subscription" hi="सदस्यता" right={<Tag c="#04837A">Active</Tag>}>
            <div className="stats" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
              <Stat lbl="Plan" hi="योजना" v="Growth" sub="1,000 credits/mo" kind="p" />
              <Stat lbl="Renews" hi="नवीनीकरण" v="21 Aug" sub="₹10,000 + GST" />
            </div>
            <div className="divider" style={{ margin: '15px 0' }} />
            <SRow t="Billing period" d="Annual is two months free. Switching mid-cycle prorates.">
              <SSeg val="monthly" set={() => {}} opts={[['monthly', 'Monthly'], ['annual', 'Annual']]} />
            </SRow>
            <div className="divider" style={{ margin: '15px 0' }} />
            <div className="obill">
              <div className="between" style={{ marginBottom: 8 }}>
                <span className="fld__l">AI credits this month</span>
                <span className="mono" style={{ fontSize: 12.5 }}>620 / 1,000</span>
              </div>
              <div className="meter"><span className="meter__f" style={{ width: '62%' }} /></div>
              <div className="mute" style={{ fontSize: 11.5, marginTop: 7 }}>Resets on the 1st. Credits do not carry over. At 90% the org owner gets one email — not a banner on every screen.</div>
            </div>
          </Card>
          <Card title="Invoices" hi="बीजक" flush right={<button className="btn btn--text btn--sm">Download all</button>}>
            <div className="tbl__scroll">
              <div className="tbl__head" style={{ gridTemplateColumns: '.9fr .8fr .7fr .7fr 84px' }}>
                <span>Invoice</span><span>Period</span><span>Amount</span><span>Status</span><span></span></div>
              {[['AEK-2026-07', 'Jul 2026', 5899, 'paid'], ['AEK-2026-06', 'Jun 2026', 5899, 'paid'], ['AEK-2026-05', 'May 2026', 5899, 'paid'], ['AEK-2026-04', 'Apr 2026', 4130, 'paid']].map(([id, per, amt, st]) => (
                <div key={id} className="tbl__row" style={{ gridTemplateColumns: '.9fr .8fr .7fr .7fr 84px' }}>
                  <span className="tbl__c"><span className="tbl__id">{id}</span></span>
                  <span className="tbl__c"><span className="tbl__s">{per}</span></span>
                  <span className="tbl__c tbl__c--num" style={{ fontSize: 12.5 }}>{inr(amt)}</span>
                  <span className="tbl__c"><Tag c="#04837A">Paid</Tag></span>
                  <span className="tbl__c"><button className="btn btn--out btn--sm">PDF</button></span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="scol">
          <Card title="Change plan" hi="योजना बदलें">
            <div className="scol" style={{ gap: 9 }}>
              {OPLANS.map(([n, code, price, credits, feats, cur]) => (
                <div key={n} className={'oplan' + (cur ? ' cur' : '')}>
                  <div className="between">
                    <span className="rowflex" style={{ gap: 8 }}><b style={{ fontSize: 14 }}>{n}</b><span className="mono mute" style={{ fontSize: 10.5 }}>{credits} credits/mo</span></span>
                    {cur ? <Tag c="#04837A">Current</Tag> : <span className="mono" style={{ fontSize: 13 }}>{price === null ? 'Agreed' : price === 0 ? 'Free' : '₹' + price.toLocaleString('en-IN') + '/mo'}</span>}
                  </div>
                  <ul className="oplan__f">{feats.map(f => <li key={f}>{I.check}{f}</li>)}</ul>
                  {!cur && <button className="btn btn--out btn--sm" style={{ width: '100%' }}>{price === null ? 'Talk to us' : price === 0 ? 'Downgrade' : 'Change plan'}</button>}
                </div>
              ))}
            </div>
          </Card>
          <Card title="Payment method" hi="भुगतान">
            <div className="opay">
              <span className="opay__ic">{I.fin}</span>
              <span style={{ minWidth: 0, flex: 1 }}><b>HDFC •••• 4821</b><span>Auto-debit mandate · expires 09/29</span></span>
              <button className="btn btn--out btn--sm">Change</button>
            </div>
            <div className="chips" style={{ marginTop: 11 }}>
              {['UPI mandate', 'NEFT / RTGS', 'Razorpay'].map(c => <span key={c} className="chip" style={{ fontSize: 11.5 }}>{c}</span>)}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function OrgModules() {
  const [on, setOn] = React.useState(() => Object.fromEntries(MODULES.map(m => [m.code, ORG_ENABLED.includes(m.code)])));
  const n = Object.values(on).filter(Boolean).length;
  return (
    <div className="scol">
      <div className="between">
        <span className="mute" style={{ fontSize: 12.5, maxWidth: '62ch' }}>
          <b style={{ color: 'var(--on-surface)' }}>{n} of {MODULES.length} active.</b> A module that is off does not appear in anybody's sidebar and cannot be granted. Only the owner or an org admin can change this.
        </span>
        <Tag c="#0082c6">Growth plan · all modules available</Tag>
      </div>
      <div className="omods">
        {MODULES.map(m => (
          <div key={m.code} className={'omod' + (on[m.code] ? ' on' : '') + (m.sensitive ? ' sens' : '')}>
            <div className="omod__h">
              <span className="omod__ic">{I[{ kartavya: 'task', graha: 'crm', vikray: 'sales', ganit: 'fin', vetana: 'pay', manav: 'hr', prachar: 'mkt', dristi: 'report', srijan: 'ai', esign: 'sign', sanvaad: 'chat' }[m.code]]}</span>
              <span style={{ minWidth: 0 }}>
                <b className="hi">{m.hi}</b>
                <span className="omod__en">{m.en}</span>
              </span>
              <SSwitch on={on[m.code]} set={v => setOn(x => ({ ...x, [m.code]: v }))} />
            </div>
            <div className="omod__f">
              {m.sensitive
                ? <span className="tag" style={{ '--c': 'var(--danger)' }}>{SI.lock} Sensitive · new grants default to Viewer</span>
                : <span className="mute" style={{ fontSize: 11 }}>{on[m.code] ? 'Active · grantable' : 'Off · hidden everywhere'}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="snote snote--warn">{SI.alert}<span>Turning a module off does not delete its data. It hides the module and revokes every grant; turning it back on restores the grants exactly as they were.</span></div>
    </div>
  );
}

function OrgSecurity() {
  const [tfa, setTfa] = React.useState(true);
  const [enforce, setEnforce] = React.useState(false);
  return (
    <div className="two">
      <div className="scol">
        <Card title="Two-factor authentication" hi="द्विस्तरीय" right={<Tag c={tfa ? '#04837A' : '#8E8D87'}>{tfa ? 'Available' : 'Off'}</Tag>}>
          <SRow t="Allow 2FA" d="Authenticator app or SMS to the registered number.">
            <SSwitch on={tfa} set={setTfa} />
          </SRow>
          <div className="divider" style={{ margin: '13px 0' }} />
          <SRow t="Require it for everyone" hi="अनिवार्य" d="Members without 2FA are asked to set it up at next sign-in and cannot skip.">
            <SSwitch on={enforce} set={setEnforce} locked={!tfa} />
          </SRow>
          {enforce && <div className="snote snote--warn">{SI.alert}<span>4 of 6 members have 2FA today. Enforcing it locks out <b>2 people</b> until they enrol. They will be emailed first.</span></div>}
        </Card>
        <Card title="Sessions" hi="सत्र">
          <SRow t="Idle timeout" d="Signed out after this long with no activity. Payroll and Roles always re-prompt regardless.">
            <SSeg val="60" set={() => {}} opts={[['15', '15m'], ['30', '30m'], ['60', '1h'], ['never', 'Never']]} />
          </SRow>
          <div className="divider" style={{ margin: '13px 0' }} />
          <SRow t="One device at a time" d="Signing in elsewhere ends the earlier session.">
            <SSwitch on={false} set={() => {}} />
          </SRow>
        </Card>
      </div>
      <div className="scol">
        <Card title="Password policy" hi="कूटशब्द">
          <SRow t="Minimum length"><SSeg val="8" set={() => {}} opts={[['8', '8'], ['12', '12'], ['16', '16']]} /></SRow>
          <div className="divider" style={{ margin: '12px 0' }} />
          {[['Require a number and a symbol', true], ['Block the 10,000 most common passwords', true], ['Expire every 90 days', false]].map(([l, v]) => (
            <div key={l} className="between" style={{ padding: '9px 0' }}>
              <span style={{ fontSize: 12.5, maxWidth: '38ch', lineHeight: 1.45 }}>{l}</span>
              <SSwitch on={v} set={() => {}} />
            </div>
          ))}
          <div className="snote">{I.check} Forced rotation makes people write passwords down. Off by default, and we recommend leaving it off.</div>
        </Card>
        <Card title="IP restrictions" hi="प्रतिबंध" right={<Tag c="#8E8D87">Not configured</Tag>}>
          <div className="mute" style={{ fontSize: 12.5, lineHeight: 1.6 }}>Restrict sign-in to named IP ranges — usually the office and a VPN. Leave it empty and any address is allowed.</div>
          <div className="oiplist">
            <div className="oip"><span className="mono">203.0.113.0/24</span><span className="mute">Mumbai office · placeholder</span><button className="icobtn" style={{ width: 26, height: 26 }}>{I.x}</button></div>
            <div className="oip oip--add"><input className="inp mono" placeholder="0.0.0.0/0" /><button className="btn btn--out btn--sm">Add range</button></div>
          </div>
          <div className="snote snote--warn">{SI.alert}<span>Adding a range you are not currently inside will lock you out immediately. We test your own address before saving.</span></div>
        </Card>
      </div>
    </div>
  );
}

function OrgDanger() {
  const [typed, setTyped] = React.useState('');
  const [step, setStep] = React.useState(0);
  return (
    <div className="two">
      <Card title="Transfer ownership" hi="स्वामित्व">
        <div className="mute" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          Ownership can only move to an existing <b>org admin</b>. You become an org admin in exchange — you are not removed.
        </div>
        <div className="scol" style={{ gap: 7, marginTop: 13 }}>
          {MEMBERS.filter(m => m.role === 'org_admin').map(m => (
            <button key={m.e} className="oxfer">
              <Av n={m.n} s={28} />
              <span style={{ minWidth: 0, flex: 1 }}><b>{m.n}</b><span>{m.e} · {m.job}</span></span>
              <span className="btn btn--out btn--sm">Transfer</span>
            </button>
          ))}
        </div>
        <div className="snote">{SI.lock} Requires your password and a 2FA code. Both of you are emailed, and it is written to the audit log.</div>
      </Card>
      <Card title="Delete organisation" hi="विलोपन">
        <div className="sdanger">
          <b>This deletes everything, for everyone</b>
          <span>6 members, 4 projects, 182 tasks, 47 invoices, 14 months of payroll and 2.1 GB of files. There is no restore. Statutory records you are legally required to keep are your responsibility to export first.</span>
          {step === 0 && <button className="btn btn--danger btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setStep(1)}>Start deletion…</button>}
          {step >= 1 && (
            <>
              <label className="au-check" style={{ marginTop: 4 }}><input type="checkbox" /><span className="au-check__b">{I.check}</span>I have exported the data we are required to retain</label>
              <label className="fld"><span className="fld__l">Type the organisation name to confirm</span>
                <input className="inp" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Aekam Inc" autoFocus /></label>
              <div className="rowflex" style={{ gap: 8 }}>
                <button className="btn btn--danger btn--sm" disabled={typed !== 'Aekam Inc'}>Delete Aekam Inc permanently</button>
                <button className="btn btn--out btn--sm" onClick={() => { setStep(0); setTyped(''); }}>Cancel</button>
              </div>
              <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>Deletion is queued for 7 days. Sign in during that window to cancel it.</span>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

const ORG_TABS = [['profile', 'Profile'], ['members', 'Members'], ['billing', 'Billing'], ['modules', 'Modules'], ['security', 'Security'], ['danger', 'Danger zone']];
function OrgHub({ open }) {
  const [tab, setTab] = React.useState('profile');
  return (
    <div className="setwrap">
      <PH kick="Settings · व्यवस्था" hi="संस्था" en="Organisation"
        lede="One hub instead of a profile page, a members page and a separate billing route. Everything an org admin owns is behind these six tabs."
        right={<><span className="tag" style={{ '--c': '#04837A' }}><span className="tag__dot" />All changes saved</span><button className="btn btn--fill btn--sm">Done</button></>} />
      <TabBar tabs={ORG_TABS.map(t => t[0])} val={tab} set={setTab} max={6} counts={{ members: MEMBERS.length, modules: ORG_ENABLED.length }} />
      <div className="setbody">
        {tab === 'profile' && <OrgProfile />}
        {tab === 'members' && <OrgMembers open={open} />}
        {tab === 'billing' && <OrgBilling />}
        {tab === 'modules' && <OrgModules />}
        {tab === 'security' && <OrgSecurity />}
        {tab === 'danger' && <OrgDanger />}
      </div>
    </div>
  );
}

Object.assign(window, { OrgHub, OrgProfile, OrgMembers, OrgBilling, OrgModules, OrgSecurity, OrgDanger, ORG });
