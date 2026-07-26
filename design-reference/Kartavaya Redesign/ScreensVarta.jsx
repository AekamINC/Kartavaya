// Varta — WhatsApp Business half of Sanvaad (varta_*). Shared inbox, templates
// with Meta's approval round-trip, auto-replies, business accounts.
const VA_TABS = ['conversations', 'templates', 'auto-replies', 'accounts'];

const CONV = [
  { id: 'meera', n: 'Meera Joshi', co: 'Tata Steel', ph: '+91 98200 41122', st: 'open', asg: 'Aanya Mehta', unread: 2, last: 'Placeholder — can you share the revised invoice?', t: '09:48', opted: true, since: '14 Feb 2026', win: 21, crm: 'Meera Joshi · Tata Steel' },
  { id: 'ramesh', n: 'Ramesh Iyer', co: 'Saraswati Textiles', ph: '+91 98250 77341', st: 'pending', asg: 'Arjun Desai', unread: 0, last: 'Placeholder — thanks, will confirm on Monday.', t: 'Tue', opted: true, since: '3 Jan 2026', win: 0, crm: 'Ramesh Iyer · Saraswati Textiles' },
  { id: 'anil', n: 'Anil Kapoor', co: 'Godrej Interio', ph: '+91 98191 20044', st: 'open', asg: null, unread: 1, last: 'Placeholder inbound message.', t: 'Mon', opted: false, since: null, win: 0, crm: 'Anil Kapoor · Godrej Interio' },
  { id: 'sunita', n: 'Sunita Reddy', co: 'Bharat Forge', ph: '+91 98220 65510', st: 'resolved', asg: 'Aanya Mehta', unread: 0, last: 'Placeholder — payment done, UTR shared.', t: 'Mon', opted: true, since: '22 Nov 2025', win: 0, crm: 'Sunita Reddy · Bharat Forge' },
];

const VA_LOG = {
  meera: [
    { day: 'Yesterday · कल' },
    { out: true, tmpl: 'payment_reminder_v3', head: 'Payment reminder', txt: 'Namaste Meera, invoice INV-2607 for ₹5,01,500 was due on 13 July. Placeholder body text with the {{1}} variable filled in.', foot: 'Aekam Inc · Reply STOP to opt out', btns: ['Pay via UPI', 'Talk to us'], t: '16:02', st: 'read', by: 'Aanya Mehta' },
    { txt: 'Placeholder inbound reply. Sending it to accounts today.', t: '16:40' },
    { day: 'Today · आज' },
    { txt: 'Placeholder — can you share the revised invoice?', t: '09:48' },
    { out: true, txt: 'Placeholder outbound free-text reply, allowed because she messaged us within 24 hours.', t: '09:52', st: 'delivered', by: 'Aanya Mehta' },
    { out: true, txt: 'Placeholder message that failed to send.', t: '09:53', st: 'failed', err: '131047 · Re-engagement required', by: 'Aanya Mehta' },
  ],
  ramesh: [
    { day: 'Tuesday · मंगलवार' },
    { txt: 'Placeholder — thanks, will confirm on Monday.', t: '11:20' },
    { out: true, txt: 'Placeholder reply sent inside the window.', t: '11:26', st: 'read', by: 'Arjun Desai' },
  ],
  anil: [{ day: 'Monday · सोमवार' }, { txt: 'Placeholder inbound message from an un-opted number.', t: '15:03' }],
  sunita: [{ day: 'Monday · सोमवार' }, { txt: 'Placeholder — payment done, UTR shared.', t: '10:12' }, { out: true, txt: 'Placeholder acknowledgement.', t: '10:15', st: 'read', by: 'Aanya Mehta' }],
};

const TICK = {
  pending: [SI.clock2, 'var(--on-surface-faint)', 'Pending'],
  sent: [SI.tick1, 'var(--on-surface-faint)', 'Sent'],
  delivered: [SI.tick2, 'var(--on-surface-faint)', 'Delivered'],
  read: [SI.tick2, '#0082c6', 'Read'],
  failed: [SI.alert, 'var(--danger)', 'Failed'],
};

const VA_ST = { open: ['Open', '#0082c6'], pending: ['Pending', '#A66207'], resolved: ['Resolved', '#04837A'] };

const TMPL = [
  { n: 'payment_reminder_v3', cat: 'utility', lang: 'en_IN', st: 'approved', meta: '148920371', used: '2h ago', body: 'Namaste {{1}}, invoice {{2}} for ₹{{3}} was due on {{4}}. Placeholder body text.', head: 'Payment reminder', foot: 'Aekam Inc · Reply STOP to opt out', btns: ['Pay via UPI', 'Talk to us'] },
  { n: 'gst_filing_due', cat: 'utility', lang: 'en_IN', st: 'pending', meta: null, used: '—', sub: 'Submitted 2 days ago', body: 'Placeholder. {{1}}, your GSTR-3B for {{2}} is due on {{3}}.', head: 'Filing reminder', foot: 'Aekam Inc', btns: ['View working'] },
  { n: 'diwali_offer_2026', cat: 'marketing', lang: 'hi_IN', st: 'rejected', meta: null, used: '—', why: 'Meta: body contains promotional language not permitted for this category. Placeholder reason.', body: 'प्लेसहोल्डर। {{1}}, दिवाली पर विशेष छूट।', head: null, foot: 'Aekam Inc', btns: ['अभी देखें'] },
  { n: 'invoice_shared', cat: 'utility', lang: 'en_IN', st: 'approved', meta: '148920412', used: 'Yesterday', body: 'Placeholder. Invoice {{1}} is attached.', head: 'Document', foot: 'Aekam Inc', btns: [] },
  { n: 'otp_login', cat: 'authentication', lang: 'en_IN', st: 'approved', meta: '148918003', used: '5m ago', body: '{{1}} is your Kartavaya verification code.', head: null, foot: 'Do not share this code', btns: ['Copy code'] },
  { n: 'welcome_new_client', cat: 'utility', lang: 'en_IN', st: 'draft', meta: null, used: '—', body: 'Placeholder welcome body.', head: null, foot: '', btns: [] },
];
const TM_ST = { approved: ['Approved', '#04837A'], pending: ['In review at Meta', '#A66207'], rejected: ['Rejected', '#B42318'], draft: ['Draft', '#8E8D87'] };
const TM_CAT = { utility: '#0082c6', marketing: '#7c5cbf', authentication: '#5C6450' };

const AUTO = [
  { k: 'keyword', hi: 'शब्द', t: 'Keyword match', d: 'Fires when an inbound message contains one of these words.', cfg: 'invoice, बिल, payment, receipt', on: true, reply: 'Placeholder. Send us the invoice number and we will pull it up.' },
  { k: 'first_message', hi: 'प्रथम', t: 'First message', d: 'Sent once, the first time a number ever writes to you.', cfg: 'Once per contact', on: true, reply: 'Placeholder greeting. Namaste — you have reached Aekam Inc.' },
  { k: 'off_hours', hi: 'अवकाश', t: 'Outside business hours', d: 'Mon–Sat 09:30–18:30 IST. Sunday closed.', cfg: 'Mon–Sat · 09:30–18:30 IST', on: true, reply: 'Placeholder. We are closed right now and will reply by 10:00 tomorrow.' },
  { k: 'fallback', hi: 'अन्य', t: 'Fallback', d: 'Nothing else matched and no agent has replied in 10 minutes.', cfg: 'After 10 minutes', on: false, reply: 'Placeholder fallback reply.' },
];

function Tick({ st }) {
  const [ic, c, lbl] = TICK[st] || TICK.sent;
  return <span className="wab__tick" style={{ color: c }} title={lbl}>{ic}</span>;
}

function Bubble({ m }) {
  if (m.day) return <div className="mdiv"><span>{m.day}</span></div>;
  return (
    <div className={'wab' + (m.out ? ' wab--out' : '') + (m.st === 'failed' ? ' wab--fail' : '')}>
      {m.tmpl && <div className="wab__tag">{SI.file} template · {m.tmpl}</div>}
      {m.head && <div className="wab__head">{m.head}</div>}
      <div className="wab__txt">{m.txt}</div>
      {m.foot && <div className="wab__foot">{m.foot}</div>}
      {m.btns && m.btns.length > 0 && <div className="wab__btns">{m.btns.map(b => <span key={b} className="wab__btn">{b}</span>)}</div>}
      <div className="wab__meta">
        {m.by && <span title={'Sent by ' + m.by}>{m.by.split(' ')[0]}</span>}
        <span className="mono">{m.t}</span>
        {m.out && <Tick st={m.st} />}
      </div>
      {m.st === 'failed' && <div className="wab__err">{SI.alert} {m.err}<button className="btn btn--text btn--sm" style={{ padding: '1px 0' }}>Send template instead</button></div>}
    </div>
  );
}

function VartaConversations() {
  const [sel, setSel] = React.useState('meera');
  const [filt, setFilt] = React.useState('open');
  const [pick, setPick] = React.useState(false);
  const [info, setInfo] = React.useState(false);
  const list = CONV.filter(c => filt === 'all' || c.st === filt);
  const c = CONV.find(x => x.id === sel) || CONV[0];
  const winOpen = c.opted && c.win > 0;
  return (
    <div className="wa">
      <div className={'wa__list' + (pick ? ' wa__list--open' : '')}>
        <div style={{ padding: '10px 11px 8px', borderBottom: '1px solid var(--outline-variant)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="seg" style={{ flex: 1 }}>
            {[['open', 'Open', 2], ['pending', 'Pending', 1], ['resolved', 'Done', 24]].map(([v, l, n]) => (
              <button key={v} className={'seg__b' + (filt === v ? ' on' : '')} style={{ flex: 1, justifyContent: 'center', padding: '6px 6px' }} onClick={() => setFilt(v)}>{l}<span className="seg__n">{n}</span></button>
            ))}
          </div>
          <button className="icobtn chat__mch" onClick={() => setPick(false)}>{I.x}</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {list.map(x => (
            <button key={x.id} className={'wa__row' + (sel === x.id ? ' on' : '')} onClick={() => { setSel(x.id); setPick(false); }}>
              <Av n={x.n} s={34} />
              <span className="wa__rb">
                <span className="wa__rt"><b>{x.n}</b><span className="mono wa__rtime">{x.t}</span></span>
                <span className="wa__rco">{x.co}</span>
                <span className="wa__rlast">{x.last}</span>
                <span className="rowflex" style={{ gap: 6, marginTop: 4 }}>
                  {x.asg ? <span className="wa__asg"><Av n={x.asg} s={14} /> {x.asg.split(' ')[0]}</span> : <span className="wa__asg wa__asg--none">Unassigned</span>}
                  {!x.opted && <span className="tag" style={{ '--c': 'var(--danger)', fontSize: 10, padding: '0 7px' }}>not opted in</span>}
                </span>
              </span>
              {x.unread > 0 && <span className="chat__ch-n men" style={{ alignSelf: 'flex-start' }}>{x.unread}</span>}
            </button>
          ))}
          {!list.length && <div style={{ padding: 22 }}><Empty ic={SI.wa} t="Nothing here" s="No conversations in this state." /></div>}
        </div>
      </div>

      <div className="chat__main">
        <div className="chat__head">
          <button className="icobtn chat__mch" onClick={() => setPick(true)} title="Conversations">{SI.back}</button>
          <span className="rowflex" style={{ gap: 9, minWidth: 0 }}>
            <Av n={c.n} s={30} />
            <span style={{ minWidth: 0, lineHeight: 1.25 }}>
              <b style={{ fontSize: 14.5, display: 'block' }}>{c.n}</b>
              <span className="mono mute" style={{ fontSize: 11 }}>{c.ph}</span>
            </span>
            <Tag c={VA_ST[c.st][1]}>{VA_ST[c.st][0]}</Tag>
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn btn--out btn--sm">Assign</button>
          <button className="btn btn--out btn--sm">{c.st === 'resolved' ? 'Reopen' : 'Resolve'}</button>
          <button className="icobtn chat__mch" onClick={() => setInfo(true)} title="Contact">{SI.eye}</button>
        </div>

        <div className="chat__log wa__log">{(VA_LOG[c.id] || []).map((m, i) => <Bubble key={i} m={m} />)}</div>

        {!c.opted ? (
          <div className="composer composer--locked">
            {SI.lock}
            <span style={{ flex: 1, minWidth: 0 }}>{c.n} has not opted in. WhatsApp policy blocks all outbound messages, including templates, until consent is recorded. <span className="mute">Opt-in comes from a web form, a QR code, or a reply to your number.</span></span>
            <button className="btn btn--out btn--sm">Send opt-in link</button>
          </div>
        ) : winOpen ? (
          <div className="composer">
            <button className="icobtn" title="Attach">{SI.clip}</button>
            <textarea className="composer__in" rows="1" placeholder={'Reply to ' + c.n.split(' ')[0] + ' — free text, window closes in ' + c.win + 'h'} />
            <button className="icobtn" title="Send a template">{SI.file}</button>
            <button className="btn btn--fill" style={{ height: 40, width: 44, padding: 0 }}>{I.send}</button>
          </div>
        ) : (
          <div className="composer" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 9 }}>
            <div className="wanote">{SI.clock2} The 24-hour service window closed. Free text is blocked until {c.n.split(' ')[0]} writes again — you can still send an approved template.</div>
            <div className="rowflex" style={{ gap: 8 }}>
              <select className="inp" style={{ flex: 1 }} defaultValue="payment_reminder_v3">
                {TMPL.filter(t => t.st === 'approved').map(t => <option key={t.n} value={t.n}>{t.n} · {t.cat}</option>)}
              </select>
              <button className="btn btn--fill btn--sm">Send template</button>
            </div>
          </div>
        )}
      </div>

      <div className={'wa__side' + (info ? ' wa__side--open' : '')}>
        <div className="wa__sh" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Contact · संपर्क
          <button className="icobtn chat__mch" style={{ marginLeft: 'auto' }} onClick={() => setInfo(false)}>{I.x}</button>
        </div>
        <div className="wa__sb">
          <div className="prop"><span className="prop__l">Opt-in</span><span className="prop__v">
            {c.opted ? <><span className="pdot" style={{ background: 'var(--ok)' }} /> Opted in · {c.since}</> : <><span className="pdot" style={{ background: 'var(--danger)' }} /> No consent on record</>}
          </span></div>
          <div className="prop"><span className="prop__l">Assigned to</span><span className="prop__v">{c.asg ? <><Av n={c.asg} s={20} /> {c.asg}</> : <span className="mute">Unassigned</span>}</span></div>
          <div className="prop"><span className="prop__l">Service window</span><span className="prop__v">{c.win > 0 ? <span className="mono">{c.win}h left</span> : <span className="mute">Closed — template only</span>}</span></div>
          <div className="divider" />
          <button className="wa__link">{SI.link} <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>{c.crm}</span><span className="mute" style={{ fontSize: 11 }}>Open in ग्रह Graha</span></span></button>
          <div className="prop"><span className="prop__l">Labels</span><div className="chips" style={{ gap: 6 }}><span className="chip" style={{ padding: '3px 9px', fontSize: 11.5 }}>Receivables</span><span className="chip" style={{ padding: '3px 9px', fontSize: 11.5 }}>MSME</span><button className="chip" style={{ padding: '3px 9px', fontSize: 11.5 }}>{I.plus}</button></div></div>
          <div className="prop"><span className="prop__l">Internal note</span><textarea className="inp" rows="3" placeholder="Only your team sees this. Never delivered to WhatsApp." /></div>
        </div>
      </div>
    </div>
  );
}

function TmplPreview({ t }) {
  return (
    <div className="wapv">
      <div className="wapv__scr">
        <div className="wab wab--out" style={{ maxWidth: '100%' }}>
          {t.head && <div className="wab__head">{t.head}</div>}
          <div className="wab__txt">{t.body}</div>
          {t.foot && <div className="wab__foot">{t.foot}</div>}
          <div className="wab__meta"><span className="mono">now</span><Tick st="read" /></div>
        </div>
        {t.btns && t.btns.length > 0 && <div className="wapv__btns">{t.btns.map(b => <span key={b} className="wapv__btn">{b}</span>)}</div>}
      </div>
      <div className="wapv__cap">Preview · what the customer sees</div>
    </div>
  );
}

function VartaTemplates() {
  const [open, setOpen] = React.useState(null);
  return (
    <div className="col">
      <div className="between">
        <span className="mute" style={{ fontSize: 12.5, maxWidth: '64ch' }}>Every template is reviewed by Meta before it can be sent. Approval is a round-trip, so a template has four states — and a rejected one tells you why.</span>
        <button className="btn btn--fill btn--sm" onClick={() => setOpen(TMPL[5])}>{I.plus} New template</button>
      </div>
      <div className="tbl"><div className="tbl__scroll">
        <div className="tbl__head" style={{ gridTemplateColumns: '1.7fr .8fr .6fr 1.2fr .9fr .7fr' }}>
          <span>Name</span><span>Category</span><span>Lang</span><span>Status</span><span>Meta ID</span><span>Last used</span>
        </div>
        {TMPL.map(t => (
          <button key={t.n} className="tbl__row" style={{ gridTemplateColumns: '1.7fr .8fr .6fr 1.2fr .9fr .7fr' }} onClick={() => setOpen(t)}>
            <span className="tbl__c"><span className="mono" style={{ fontSize: 12.5, fontWeight: 500 }}>{t.n}</span></span>
            <span className="tbl__c"><Tag c={TM_CAT[t.cat]}>{t.cat}</Tag></span>
            <span className="tbl__c"><span className="mono tbl__s">{t.lang}</span></span>
            <span className="tbl__c" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <Tag c={TM_ST[t.st][1]}>{TM_ST[t.st][0]}</Tag>
              {t.sub && <span className="tbl__s" style={{ fontSize: 10.5 }}>{t.sub}</span>}
            </span>
            <span className="tbl__c">{t.meta ? <span className="mono tbl__s">{t.meta}</span> : <span className="mute">—</span>}</span>
            <span className="tbl__c"><span className="tbl__s">{t.used}</span></span>
          </button>
        ))}
      </div></div>

      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(null)} />
          <div className="sheet" style={{ width: 'min(880px, calc(100% - 48px))' }}>
            <div className="sheet__head">
              <h3 className="sheet__t">{open.st === 'draft' ? 'New template' : open.n}</h3>
              {open.st !== 'draft' && <Tag c={TM_ST[open.st][1]}>{TM_ST[open.st][0]}</Tag>}
              <button className="icobtn" style={{ marginLeft: 'auto' }} onClick={() => setOpen(null)}>{I.x}</button>
            </div>
            <div className="sheet__body tmpl2">
              <div className="col" style={{ gap: 14 }}>
                {open.st === 'rejected' && <div className="wanote wanote--bad">{SI.alert} {open.why}</div>}
                {open.st === 'pending' && <div className="wanote">{SI.clock2} In review at Meta. Typically under 24 hours — you cannot edit or send while it is pending.</div>}
                <div className="row2">
                  <label className="fld"><span className="fld__l">Name</span><input className="inp mono" defaultValue={open.st === 'draft' ? '' : open.n} placeholder="lower_snake_case" /></label>
                  <label className="fld"><span className="fld__l">Language</span><select className="inp" defaultValue={open.lang}><option>en_IN</option><option>hi_IN</option><option>mr_IN</option><option>gu_IN</option></select></label>
                </div>
                <div className="fld"><span className="fld__l">Category</span><div className="chips">{['utility', 'marketing', 'authentication'].map(k => <button key={k} className={'chip' + (open.cat === k ? ' on' : '')}><span className="chip__dot" style={{ background: TM_CAT[k] }} />{k}</button>)}</div></div>
                <div className="fld"><span className="fld__l">Header</span><div className="chips">{['none', 'text', 'image', 'document'].map(k => <button key={k} className={'chip' + ((open.head ? 'text' : 'none') === k ? ' on' : '')}>{k}</button>)}</div>{open.head && <input className="inp" defaultValue={open.head} style={{ marginTop: 8 }} />}</div>
                <label className="fld"><span className="fld__l">Body</span><textarea className="inp" rows="4" defaultValue={open.body} /><span style={{ fontSize: 10.5, color: 'var(--on-surface-faint)' }}>Use {'{{1}}'}, {'{{2}}'} for variables. Kartavaya fills them from Ganit and Graha at send time.</span></label>
                <label className="fld"><span className="fld__l">Footer</span><input className="inp" defaultValue={open.foot} placeholder="Optional · 60 characters" /></label>
                <div className="fld"><span className="fld__l">Buttons</span>
                  <div className="col" style={{ gap: 7 }}>
                    {(open.btns || []).map(b => (
                      <div key={b} className="rowflex" style={{ gap: 7 }}>
                        <select className="inp" style={{ width: 130 }} defaultValue="quick"><option value="quick">Quick reply</option><option>Visit URL</option><option>Call</option></select>
                        <input className="inp" defaultValue={b} style={{ flex: 1 }} />
                        <button className="icobtn">{I.x}</button>
                      </div>
                    ))}
                    <button className="btn btn--out btn--sm" style={{ alignSelf: 'flex-start' }}>{I.plus} Add button</button>
                  </div>
                </div>
              </div>
              <TmplPreview t={open} />
            </div>
            <div className="sheet__foot">
              <span className="mute" style={{ marginRight: 'auto', fontSize: 11.5 }}>{open.meta ? <>Meta template ID <span className="mono">{open.meta}</span></> : 'Not yet submitted to Meta'}</span>
              <button className="btn btn--out" onClick={() => setOpen(null)}>Save draft</button>
              <button className="btn btn--fill" disabled={open.st === 'pending'}>{open.st === 'rejected' ? 'Fix and resubmit' : 'Submit to Meta'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function VartaAuto() {
  const [on, setOn] = React.useState(() => Object.fromEntries(AUTO.map(a => [a.k, a.on])));
  return (
    <div className="col">
      <span className="mute" style={{ fontSize: 12.5, maxWidth: '64ch' }}>Four triggers, checked in this order. The first match wins, so fallback only fires when nothing above it did.</span>
      <div className="col" style={{ gap: 10 }}>
        {AUTO.map((a, i) => (
          <div key={a.k} className={'auto' + (on[a.k] ? '' : ' auto--off')}>
            <span className="auto__n mono">{i + 1}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="rowflex" style={{ gap: 8 }}>
                <b style={{ fontSize: 13.5 }}>{a.t}</b><span className="hi mute" style={{ fontSize: 12.5 }}>{a.hi}</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--on-surface-faint)' }}>trigger_type={a.k}</span>
              </div>
              <div className="mute" style={{ fontSize: 12, marginTop: 2 }}>{a.d}</div>
              <div className="auto__cfg">{a.k === 'keyword' ? <>Keywords <span className="mono">{a.cfg}</span></> : a.cfg}</div>
              <div className="auto__reply">{a.reply}</div>
            </div>
            <div className="rowflex" style={{ gap: 8, alignSelf: 'flex-start' }}>
              <button className="btn btn--out btn--sm">Edit</button>
              <button className={'sw' + (on[a.k] ? ' on' : '')} onClick={() => setOn(p => ({ ...p, [a.k]: !p[a.k] }))} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VartaAccounts() {
  return (
    <div className="col">
      <div className="two">
        <div className="col">
          <Card title="Business account" hi="व्यापार खाता" right={<Tag c="#04837A">Active</Tag>}>
            <div className="props">
              <div className="prop"><span className="prop__l">Provider</span><span className="prop__v">Meta Cloud API</span></div>
              <div className="prop"><span className="prop__l">Display name</span><span className="prop__v">Aekam Inc</span></div>
              <div className="prop"><span className="prop__l">Number</span><span className="prop__v mono">+91 22 4890 1122</span></div>
              <div className="prop"><span className="prop__l">Quality rating</span><span className="prop__v"><span className="pdot" style={{ background: 'var(--ok)' }} /> High</span></div>
              <div className="prop"><span className="prop__l">Messaging limit</span><span className="prop__v">10,000 / 24h</span></div>
              <div className="prop"><span className="prop__l">Verification</span><span className="prop__v">Green tick approved</span></div>
            </div>
            <div className="divider" style={{ margin: '14px 0' }} />
            <div className="rowflex" style={{ gap: 8 }}>
              <span className="pdot" style={{ background: 'var(--ok)' }} />
              <span style={{ fontSize: 12.5 }}>Webhook receiving — last event 40 seconds ago</span>
              <button className="btn btn--text btn--sm" style={{ marginLeft: 'auto' }}>View log</button>
            </div>
          </Card>
          <Card title="Second number" hi="दूसरा क्रमांक" right={<Tag c="#A66207">Pending</Tag>}>
            <div className="props">
              <div className="prop"><span className="prop__l">Number</span><span className="prop__v mono">+91 80 4712 3390</span></div>
              <div className="prop"><span className="prop__l">Purpose</span><span className="prop__v">Bengaluru support line</span></div>
            </div>
            <div className="wanote" style={{ marginTop: 12 }}>{SI.clock2} Waiting on Meta business verification. Placeholder — submitted 2 days ago. No messages can be sent from this number yet.</div>
          </Card>
        </div>
        <div className="col">
          <Card title="Opt-in sources" hi="सहमति">
            <div className="col" style={{ gap: 11 }}>
              {[['Web form on aekam.in', 412, true], ['QR code at reception', 96, true], ['Imported from Graha', 148, false], ['Reply to our number', 233, true]].map(([s, n, ok]) => (
                <div key={s} className="between" style={{ gap: 10 }}>
                  <span style={{ fontSize: 12.5, minWidth: 0 }}>{s}</span>
                  <span className="rowflex" style={{ gap: 9 }}>
                    <span className="mono" style={{ fontSize: 12 }}>{n}</span>
                    {ok ? <Tag c="#04837A">valid</Tag> : <Tag c="#B42318">needs proof</Tag>}
                  </span>
                </div>
              ))}
            </div>
            <div className="wanote wanote--bad" style={{ marginTop: 13 }}>{SI.alert} 148 contacts imported from Graha have no consent record. They are excluded from every send until an opt-in is captured.</div>
          </Card>
          <Card title="This month" hi="इस माह">
            <div className="stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Stat lbl="Sent" hi="भेजे" v="4,182" sub="placeholder" />
              <Stat lbl="Delivered" hi="प्राप्त" v="97.4%" kind="ok" />
              <Stat lbl="Read" hi="पढ़े" v="71.2%" kind="p" />
              <Stat lbl="Failed" hi="विफल" v="108" kind="danger" sub="mostly 131047" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function VartaPane() {
  const [tab, setTab] = React.useState('conversations');
  return (
    <>
      <div className="wahdr">
        <span className="wahdr__ic">{SI.wa}</span>
        <span style={{ minWidth: 0 }}>
          <b style={{ fontSize: 15 }}>WhatsApp</b>
          <span className="hi" style={{ fontSize: 12.5, marginLeft: 8, color: 'var(--primary-text)' }}>वार्ता</span>
          <span style={{ fontSize: 12.5, marginLeft: 8, color: 'var(--on-surface-3)' }}>Business · Meta Cloud API · one shared inbox for the whole team</span>
        </span>
        <span className="rowflex" style={{ gap: 7, marginLeft: 'auto' }}>
          <span className="pdot" style={{ background: 'var(--ok)' }} />
          <span style={{ fontSize: 12 }}>+91 22 4890 1122</span>
        </span>
      </div>
      <TabBar tabs={VA_TABS} val={tab} set={setTab} max={4} />
      {tab === 'conversations' && <VartaConversations />}
      {tab === 'templates' && <VartaTemplates />}
      {tab === 'auto-replies' && <VartaAuto />}
      {tab === 'accounts' && <VartaAccounts />}
    </>
  );
}

Object.assign(window, { VartaPane, VartaConversations, VartaTemplates, VartaAuto, VartaAccounts, Bubble, Tick, TMPL, CONV });
