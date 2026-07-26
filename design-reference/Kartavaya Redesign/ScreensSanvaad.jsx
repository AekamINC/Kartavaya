// Sanvaad — internal messaging (samvada_*). Channel list / message log / thread flexpane.
// Every state here maps to a column in migration 058: type, is_edited, is_deleted,
// parent_message_id, reactions, read receipts, muted, is_archived.
const SI = {
  hash: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M7.5 3l-1.5 14M14 3l-1.5 14M3.5 7.5h13.5M2.8 12.5h13.5"/></svg>,
  lock: <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="4.5" y="8.5" width="11" height="8.5" rx="1.8"/><path d="M7 8.5V6.2a3 3 0 016 0v2.3"/></svg>,
  star: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7L10 2.8z"/></svg>,
  starOn: <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7L10 2.8z"/></svg>,
  bellOff: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6.2 6.5A4 4 0 0114 8v3.3l2 2.2H7"/><path d="M4 13.7l1.9-2.2V8"/><path d="M3 3l14 14"/></svg>,
  clip: <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14.5 9.5l-5 5a3.2 3.2 0 01-4.5-4.5l6-6a2.2 2.2 0 013 3l-6 6a1.2 1.2 0 01-1.7-1.7l5-5"/></svg>,
  smile: <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10" cy="10" r="7.4"/><path d="M7 11.6c.7.9 1.7 1.4 3 1.4s2.3-.5 3-1.4"/><circle cx="7.6" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="12.4" cy="8" r=".9" fill="currentColor" stroke="none"/></svg>,
  thread: <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 10.5a2 2 0 01-2 2H8l-3.5 2.5V5.5a2 2 0 012-2h8.5a2 2 0 012 2v5z"/><path d="M8 7h6"/></svg>,
  file: <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4.5 3h7L16 7.5v9a1 1 0 01-1 1H5.5a1 1 0 01-1-1v-13a1 1 0 011-1z"/><path d="M11 3v4.5h4.5"/></svg>,
  eye: <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1.8 10S4.8 4.8 10 4.8 18.2 10 18.2 10 15.2 15.2 10 15.2 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.3"/></svg>,
  tick1: <svg width="15" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M2 6.6l3.2 3.2L12.4 2.4"/></svg>,
  tick2: <svg width="17" height="12" viewBox="0 0 18 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M1 6.6l3.2 3.2L11.4 2.4"/><path d="M6.4 9.2l.6.6L14.6 2.4"/></svg>,
  clock2: <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="10" cy="10" r="7.2"/><path d="M10 6.2V10l2.6 1.8"/></svg>,
  alert: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M10 3.4l7 12.2H3l7-12.2z"/><path d="M10 8v3.2M10 13.6v.1"/></svg>,
  wa: <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 00-6.9 12L2 18l4.1-1.1A8 8 0 1010 2zm0 1.6a6.4 6.4 0 013.1 12 6.4 6.4 0 01-3.1.8 6.4 6.4 0 01-3.3-.9l-.3-.2-2.4.6.6-2.3-.2-.4A6.4 6.4 0 0110 3.6zm-2.9 3c-.2 0-.4.1-.6.3-.2.2-.6.6-.6 1.4s.6 1.7.7 1.8c.1.1 1.2 1.9 3 2.6 1.5.6 1.8.5 2.2.4.4 0 1.1-.4 1.3-.9.2-.5.2-.9.1-1l-.6-.3-1-.5c-.2 0-.3 0-.4.1l-.6.7c-.1.1-.2.2-.4.1a4.5 4.5 0 01-1.4-.9 5 5 0 01-.9-1.2c-.1-.2 0-.3.1-.4l.4-.5.2-.4-.1-.3-.5-1.2c-.1-.3-.3-.3-.4-.3h-.5z"/></svg>,
  back: <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M11.5 4.5L6 10l5.5 5.5"/></svg>,
  link: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8.2 11.8a2.8 2.8 0 010-4l2-2a2.8 2.8 0 014 4l-1 1"/><path d="M11.8 8.2a2.8 2.8 0 010 4l-2 2a2.8 2.8 0 01-4-4l1-1"/></svg>,
};

const MOD_GLYPH = { ganit: 'fin', graha: 'crm', kartavya: 'task', pahchan: 'clock', vetana: 'pay' };

const CH = [
  { id: 'assistant', hi: 'सहायक', en: 'assistant', ai: true, star: true, topic: 'Reads your workspace · answers with live data' },
  { id: 'gst', hi: 'कर-विवरणी', en: 'gst-filing', type: 'private', unread: 4, mention: true, star: true, topic: 'Q1 FY27 returns · GSTR-1, 2B, 3B', mem: ['Keval Shah', 'Aanya Mehta', 'Rohan Iyer', 'Fatima Sheikh'] },
  { id: 'general', hi: 'सामान्य', en: 'general', type: 'public', unread: 3, star: true, topic: 'Everyone at Aekam Inc', mem: ['Keval Shah', 'Aanya Mehta', 'Rohan Iyer', 'Priya Nair', 'Arjun Desai', 'Fatima Sheikh'] },
  { id: 'mumbai', hi: 'मुंबई', en: 'tata-mumbai', type: 'public', unread: 0, star: true, topic: 'Tata Steel Mumbai fit-out · linked to KAR-582', mem: ['Keval Shah', 'Rohan Iyer', 'Arjun Desai'] },
  { id: 'aanya', en: 'Aanya Mehta', type: 'dm', unread: 2, dm: 'Aanya Mehta', topic: 'Manager · Finance · Mumbai' },
  { id: 'diwali', hi: 'दिवाली', en: 'diwali-campaign', type: 'public', unread: 12, muted: true, topic: 'Festive creatives and spend', mem: ['Priya Nair', 'Keval Shah', 'Arjun Desai'] },
  { id: 'rohan', en: 'Rohan Iyer', type: 'dm', unread: 0, dm: 'Rohan Iyer', topic: 'Member · Legal · Pune' },
  { id: 'vendors', hi: 'विक्रेता', en: 'vendor-onboarding', type: 'public', unread: 0, topic: 'KYC, agreements, bank details', mem: ['Fatima Sheikh', 'Rohan Iyer'] },
  { id: 'holi', hi: 'होली', en: 'holi-2026', type: 'public', archived: true, topic: 'Closed 14 Mar 2026' },
  { id: 'audit', hi: 'अंकेक्षण', en: 'audit-fy25', type: 'private', archived: true, topic: 'Closed 30 Sep 2025' },
];

const MSGS = {
  gst: [
    { id: 'g1', day: 'Yesterday · कल' },
    { id: 'g2', who: 'Aanya Mehta', t: '17:42', txt: 'June ITC working is up. Two vendor invoices are missing HSN codes — I have flagged both in Ganit.', rx: [['👍', 2, false]], replies: 3, replyWho: ['Keval Shah', 'Rohan Iyer', 'Aanya Mehta'], lastReply: '2h ago' },
    { id: 'g3', sys: 'ganit', mod: 'गणित · Ganit', t: '17:44', txt: 'Placeholder system message. 2 purchase invoices flagged — HSN code missing. Vendors: Shreeji Traders, Kohinoor Packaging.', act: 'Open in Ganit' },
    { id: 'g4', who: 'Rohan Iyer', t: '18:10', txt: 'Chased Shreeji — they will re-issue with HSN by Monday. Kohinoor is not answering the phone.' },
    { id: 'g5', who: 'Rohan Iyer', t: '18:11', cont: true, txt: 'Placeholder follow-up line. Replace with the real vendor note.' },
    { id: 'g6', day: 'Today · आज' },
    { id: 'g7', who: 'Fatima Sheikh', t: '09:02', txt: 'Attached the reconciliation — GSTR-2B against books, June.', att: { n: 'GSTR-2B-recon-June-FY27.xlsx', s: '248 KB' }, rx: [['🙏', 3, true], ['✅', 1, false]] },
    { id: 'g8', who: 'Keval Shah', me: true, t: '09:15', txt: 'Placeholder reply from me about the MSME 45-day clause and what it means for the Tata payment.', edited: true, seen: ['Aanya Mehta', 'Rohan Iyer', 'Fatima Sheikh'] },
    { id: 'g9', deleted: true, who: 'Priya Nair', t: '09:20' },
    { id: 'g10', newFrom: true },
    { id: 'g11', who: 'Aanya Mehta', t: '09:41', txt: 'Placeholder. @Keval Shah GSTR-3B for Q1 is due in 26 days — starting the working notes today.', replies: 0 },
    { id: 'g12', sys: 'kartavya', mod: 'कर्तव्य · Tasks', t: '09:44', txt: 'KAR-184 “Compile Q1 GSTR-3B working notes” moved to In Progress by Aanya Mehta.', act: 'Open KAR-184' },
  ],
  general: [
    { id: 'n1', day: 'Today · आज' },
    { id: 'n2', sys: 'pahchan', mod: 'पहचान · Attendance', t: '09:30', txt: 'Placeholder. 3 regularisation requests are waiting on a manager for more than 24 hours.', act: 'Review queue' },
    { id: 'n3', who: 'Priya Nair', t: '10:04', txt: 'Diwali creatives are scheduled for the 14th across all four channels. Placeholder copy.', rx: [['🔥', 4, false]] },
    { id: 'n4', newFrom: true },
    { id: 'n5', who: 'Arjun Desai', t: '11:22', txt: 'Placeholder announcement text goes here.', replies: 6, replyWho: ['Keval Shah', 'Priya Nair', 'Fatima Sheikh'], lastReply: '20m ago' },
    { id: 'n6', who: 'Fatima Sheikh', t: '11:40', txt: 'Placeholder — office is closed on the 2nd for maintenance.' },
  ],
  mumbai: [
    { id: 'm1', day: 'Today · आज' },
    { id: 'm2', sys: 'graha', mod: 'ग्रह · CRM', t: '08:15', txt: 'Placeholder. Deal “Tata Steel — Mumbai” moved to Proposal. Value ₹18.5 L. Owner Keval Shah.', act: 'Open deal' },
    { id: 'm3', who: 'Rohan Iyer', t: '09:31', txt: 'Checked the clause — we can invoice on milestone completion, not on sign-off. Saves us three weeks.', rx: [['👍', 3, false], ['🙏', 1, false]], replies: 2, replyWho: ['Keval Shah', 'Rohan Iyer'], lastReply: '1h ago' },
    { id: 'm4', who: 'Keval Shah', me: true, t: '09:38', txt: 'Placeholder. Good — raise the first milestone invoice this week.', seen: ['Rohan Iyer', 'Arjun Desai'] },
  ],
  aanya: [
    { id: 'a1', day: 'Today · आज' },
    { id: 'a2', who: 'Aanya Mehta', t: '09:50', txt: 'Placeholder direct message about the payroll cut-off.' },
    { id: 'a3', newFrom: true },
    { id: 'a4', who: 'Aanya Mehta', t: '09:52', cont: true, txt: 'Second placeholder line in the same group.' },
  ],
  diwali: [
    { id: 'd1', day: 'Monday · सोमवार' },
    { id: 'd2', who: 'Priya Nair', t: '15:10', txt: 'Placeholder. This channel is muted for you — 12 unread, no notifications sent.' },
  ],
  rohan: [{ id: 'r1', day: 'Yesterday · कल' }, { id: 'r2', who: 'Rohan Iyer', t: '16:20', txt: 'Placeholder direct message.' }],
  vendors: [{ id: 'v1', day: 'Last week · पिछला सप्ताह' }, { id: 'v2', who: 'Fatima Sheikh', t: '12:02', txt: 'Placeholder vendor onboarding note.' }],
  holi: [{ id: 'h1', day: '14 Mar 2026' }, { id: 'h2', who: 'Priya Nair', t: '18:00', txt: 'Placeholder. Archived channels stay readable but cannot be posted to.' }],
  audit: [{ id: 'u1', day: '30 Sep 2025' }, { id: 'u2', who: 'Aanya Mehta', t: '19:14', txt: 'Placeholder closing note for FY25 audit.' }],
};

const THREAD = {
  g2: [
    { who: 'Keval Shah', me: true, t: '17:50', txt: 'Placeholder. Which two vendors?' },
    { who: 'Rohan Iyer', t: '17:55', txt: 'Shreeji Traders and Kohinoor Packaging. Placeholder detail.' },
    { who: 'Aanya Mehta', t: '18:02', txt: 'Both are on the June ITC sheet, rows 14 and 27. Placeholder.', rx: [['👍', 1, false]] },
  ],
  n5: [{ who: 'Priya Nair', t: '11:30', txt: 'Placeholder thread reply.' }, { who: 'Keval Shah', me: true, t: '11:34', txt: 'Placeholder thread reply from me.' }],
  m3: [{ who: 'Keval Shah', me: true, t: '09:33', txt: 'Placeholder thread reply.' }, { who: 'Rohan Iyer', t: '09:35', txt: 'Placeholder second reply.' }],
};

const QUICK_RX = ['👍', '🙏', '✅', '🔥', '👀'];

function MTxt({ t }) {
  const parts = String(t).split(/(@[A-Z][a-z]+ [A-Z][a-z]+)/g);
  return <>{parts.map((p, i) => p.startsWith('@') ? <span key={i} className="mnt">{p}</span> : p)}</>;
}

function Rx({ list, onTog, can }) {
  if (!list || !list.length) return null;
  return (
    <div className="rx">
      {list.map(([e, n, mine]) => (
        <button key={e} className={'rx__b' + (mine ? ' on' : '')} disabled={!can} onClick={() => onTog(e)}>
          <span>{e}</span><span className="rx__n">{n}</span>
        </button>
      ))}
      {can && <button className="rx__add" onClick={() => onTog('👀')} title="Add reaction">{SI.smile}</button>}
    </div>
  );
}

function Msg({ m, rx, onTog, onThread, can }) {
  if (m.day) return <div className="mdiv"><span>{m.day}</span></div>;
  if (m.newFrom) return <div className="mdiv mdiv--new"><span>New messages · नए संदेश</span></div>;
  if (m.deleted) return <div className="msg msg--gone"><span className="msg__tomb">{SI.file} Message deleted by {m.who} · {m.t}</span></div>;
  if (m.sys) return (
    <div className="msg msg--sys">
      <span className="msg__glyph">{I[MOD_GLYPH[m.sys]]}</span>
      <div className="msg__b">
        <div className="msg__head"><span className="msg__who hi" style={{ fontSize: 12.5 }}>{m.mod}</span><span className="tag" style={{ '--c': 'var(--on-surface-3)', fontSize: 10, padding: '0 7px' }}>system</span><span className="msg__t">{m.t}</span></div>
        <div className="msg__sysb"><MTxt t={m.txt} />{m.act && <button className="btn btn--text btn--sm" style={{ padding: '2px 0', marginTop: 6, display: 'block' }}>{m.act} →</button>}</div>
      </div>
    </div>
  );
  const rl = rx[m.id];
  return (
    <div className={'msg' + (m.me ? ' msg--me' : '') + (m.cont ? ' msg--cont' : '')}>
      {!m.me && (m.cont ? <span className="msg__gut">{m.t}</span> : <Av n={m.who} s={30} />)}
      <div className="msg__b">
        {!m.me && !m.cont && <div className="msg__head"><span className="msg__who">{m.who}</span><span className="msg__t">{m.t}</span></div>}
        <div className="msg__txt"><MTxt t={m.txt} />{m.edited && <span className="msg__ed">(edited)</span>}</div>
        {m.att && (
          <div className="att">
            <span className="att__ic">{SI.file}</span>
            <span style={{ minWidth: 0 }}><span className="att__n">{m.att.n}</span><span className="att__s">{m.att.s} · spreadsheet</span></span>
            <button className="btn btn--out btn--sm" style={{ marginLeft: 'auto' }}>Download</button>
          </div>
        )}
        <Rx list={rl} can={can} onTog={e => onTog(m.id, e)} />
        {m.replies > 0 && (
          <button className="thrl" onClick={() => onThread(m)}>
            <Avs list={m.replyWho} max={3} s={19} />
            <span className="thrl__n">{m.replies} replies</span>
            <span className="thrl__t">Last reply {m.lastReply}</span>
          </button>
        )}
        {m.seen && <div className="seen">{SI.eye} Seen by {m.seen.slice(0, 2).map(n => n.split(' ')[0]).join(', ')}{m.seen.length > 2 ? ` +${m.seen.length - 2}` : ''}</div>}
      </div>
      {m.me && <Av n={m.who} s={30} />}
      {can && (
        <div className="msg__acts">
          {QUICK_RX.map(e => <button key={e} className="msg__act" onClick={() => onTog(m.id, e)}>{e}</button>)}
          <button className="msg__act" title="Reply in thread" onClick={() => onThread(m)}>{SI.thread}</button>
          <button className="msg__act" title="More">{I.dots}</button>
        </div>
      )}
    </div>
  );
}

function ChRow({ c, on, click }) {
  return (
    <button className={'chat__ch' + (on ? ' on' : '') + (c.archived ? ' arch' : '') + (c.muted ? ' muted' : '')} onClick={click}>
      {c.type === 'dm' ? <Av n={c.dm} s={17} /> : <span className="chat__ch-ic">{c.ai ? I.ai : c.type === 'private' ? SI.lock : SI.hash}</span>}
      <span className="chat__ch-lbl">
        {c.hi ? <><span className="hi">{c.hi}</span><span className="chat__ch-en">{c.en}</span></> : <span style={{ fontSize: 13 }}>{c.en}</span>}
      </span>
      {c.muted && <span className="chat__ch-m">{SI.bellOff}</span>}
      {c.archived && <span className="chat__ch-arch">archived</span>}
      {c.unread > 0 && <span className={'chat__ch-n' + (c.mention ? ' men' : '')}>{c.mention ? '@' : ''}{c.unread}</span>}
    </button>
  );
}

function ScreenSanvaad() {
  const [mode, setMode] = React.useState('channels');
  const [ch, setCh] = React.useState('gst');
  const [showAll, setShowAll] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [thread, setThread] = React.useState(null);
  const [role, setRole] = React.useState('editor');
  const [picker, setPicker] = React.useState(false);
  const [alog, setAlog] = React.useState([{ ai: true, t: 'now', txt: 'Good morning. Three things need you: the Tata Steel invoice is 12 days overdue, GSTR-3B is due in 26 days, and two deals have no next step.', chips: ['Draft a reminder', 'Show the two deals', 'What changed this week?'] }]);
  const [rx, setRx] = React.useState(() => {
    const o = {};
    Object.values(MSGS).forEach(ms => ms.forEach(m => { if (m.rx) o[m.id] = m.rx.map(r => [...r]); }));
    Object.entries(THREAD).forEach(([k, ms]) => ms.forEach((m, i) => { if (m.rx) o[k + '-' + i] = m.rx.map(r => [...r]); }));
    return o;
  });

  const cur = CH.find(c => c.id === ch) || CH[0];
  const canPost = role === 'editor' && !cur.archived;
  const live = CH.filter(c => !c.archived);
  const secs = showAll
    ? [['Starred · तारांकित', live.filter(c => c.star)], ['Channels · माध्यम', live.filter(c => !c.star && c.type !== 'dm')], ['Direct · सीधा', live.filter(c => c.type === 'dm')], ['Archived · संग्रहित', CH.filter(c => c.archived)]]
    : [['Unread & starred', live.filter(c => c.star || c.unread)], ['Direct · सीधा', live.filter(c => c.type === 'dm' && !c.unread && !c.star)]];

  const toggleRx = (id, e) => setRx(p => {
    const list = (p[id] || []).map(r => [...r]);
    const i = list.findIndex(r => r[0] === e);
    if (i < 0) list.push([e, 1, true]);
    else { list[i][2] = !list[i][2]; list[i][1] += list[i][2] ? 1 : -1; if (list[i][1] <= 0) list.splice(i, 1); }
    return { ...p, [id]: list };
  });

  const askAI = (txt) => {
    if (!txt.trim()) return;
    setAlog(l => [...l, { me: true, t: 'now', txt }]);
    setDraft('');
    setTimeout(() => setAlog(l => [...l, { ai: true, t: 'now', txt: 'Placeholder AI reply. Drafted a payment reminder for Tata Steel (₹5.01 L incl. GST, 12 days overdue) citing the MSME 45-day rule, with a UPI link. Ready to send to Meera Joshi on WhatsApp.', actions: ['Send on WhatsApp', 'Edit draft', 'Cancel'] }]), 700);
  };
  const send = (txt) => { if (cur.ai) return askAI(txt); if (!txt.trim()) return; setDraft(''); };

  return (
    <div className="screen" style={{ height: '100%', minHeight: 0 }}>
      <PH kick="People · जन" hi="संवाद" en="Messaging"
        lede="Unread and starred only. Threads open beside the log, never inside it — module events arrive as system messages, not notifications."
        right={<div className="seg" title="RBAC preview — Sanvaad module level">
          {[['editor', 'Editor'], ['viewer', 'Viewer']].map(([v, l]) => <button key={v} className={'seg__b' + (role === v ? ' on' : '')} onClick={() => setRole(v)}>{l}</button>)}
        </div>} />
      <TabBar tabs={MODULE_TABS.sanvaad} val={mode} set={setMode} max={2} />
      {mode === 'whatsapp' ? <VartaPane /> : (
        <div className={'chat' + (thread ? ' chat--thr' : '')} style={{ flex: 1, minHeight: 480 }}>
          <div className="chat__side">
            <div className="between" style={{ padding: '11px 12px 6px' }}>
              <span className="chat__sec" style={{ padding: 0 }}>Sanvaad</span>
              <div className="rowflex" style={{ gap: 2 }}>
                <button className="btn btn--text btn--sm" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => setShowAll(!showAll)}>{showAll ? 'Unread' : 'All'}</button>
                <button className="icobtn" style={{ width: 24, height: 24 }} title="New channel">{I.plus}</button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 10 }}>
              {secs.filter(([, list]) => list.length).map(([lbl, list]) => (
                <div key={lbl}>
                  <div className="chat__sec">{lbl}</div>
                  {list.map(c => <ChRow key={c.id} c={c} on={ch === c.id} click={() => { setCh(c.id); setThread(null); }} />)}
                </div>
              ))}
              {!showAll && <button className="chat__more" onClick={() => setShowAll(true)}>{CH.length - live.filter(c => c.star || c.unread).length} more channels</button>}
            </div>
          </div>

          <div className="chat__main">
            <div className="chat__head">
              <button className="icobtn chat__mch" onClick={() => setPicker(true)}>{SI.hash}</button>
              <span className="rowflex" style={{ gap: 8, minWidth: 0 }}>
                {cur.hi ? <b className="hi" style={{ fontSize: 16.5, color: 'var(--primary-text)' }}>{cur.hi}</b> : <b style={{ fontSize: 15 }}>{cur.en}</b>}
                <span className="mute" style={{ fontSize: 12.5 }}>{cur.hi ? (cur.type === 'private' ? '🔒 ' : cur.ai ? '' : '#') + cur.en : cur.type === 'dm' ? 'Direct message' : ''}</span>
                <button className="icobtn" style={{ width: 26, height: 26, color: cur.star ? 'var(--warn)' : undefined }} title="Star">{cur.star ? SI.starOn : SI.star}</button>
                {cur.muted && <span className="tag" style={{ '--c': 'var(--on-surface-3)' }}>{SI.bellOff} muted</span>}
              </span>
              <span className="chat__topic">{cur.topic}</span>
              {cur.mem && <Avs list={cur.mem} max={4} s={24} />}
              <button className="icobtn" title="Channel settings">{I.dots}</button>
            </div>

            {cur.archived && <div className="chat__banner">{SI.lock} This channel is archived. History stays searchable; nobody can post.<button className="btn btn--text btn--sm">Unarchive</button></div>}

            <div className="chat__log">
              {cur.ai ? alog.map((m, i) => (
                <div key={i} className={'msg' + (m.ai ? ' msg--ai' : '') + (m.me ? ' msg--me' : '')}>
                  {!m.me && <span className="av" style={{ width: 30, height: 30, background: 'var(--primary)', color: 'var(--on-primary)' }}>{I.ai}</span>}
                  <div className="msg__b">
                    {!m.me && <div className="msg__head"><span className="msg__who hi">सहायक</span><span className="tag" style={{ '--c': 'var(--tertiary)', fontSize: 10, padding: '0 7px' }}>AI</span><span className="msg__t">{m.t}</span></div>}
                    <div className="msg__txt">{m.txt}</div>
                    {m.chips && <div className="chips" style={{ marginTop: 10 }}>{m.chips.map(c => <button key={c} className="chip" onClick={() => askAI(c)}>{c}</button>)}</div>}
                    {m.actions && <div className="chips" style={{ marginTop: 10 }}>{m.actions.map((a, j) => <button key={a} className={j === 0 ? 'btn btn--fill btn--sm' : 'btn btn--out btn--sm'}>{a}</button>)}</div>}
                  </div>
                  {m.me && <Av n="Keval Shah" s={30} />}
                </div>
              )) : (MSGS[ch] || []).map(m => <Msg key={m.id} m={m} rx={rx} onTog={toggleRx} onThread={setThread} can={canPost} />)}
              {ch === 'gst' && canPost && <div className="rowflex" style={{ gap: 8, fontSize: 11.5, color: 'var(--on-surface-3)', paddingLeft: 2 }}><span className="typing"><i /><i /><i /></span> Rohan Iyer is typing…</div>}
            </div>

            {canPost ? (
              <div className="composer">
                <button className="icobtn" title="Attach">{SI.clip}</button>
                <textarea className="composer__in" rows="1" placeholder={cur.ai ? 'Ask about your workspace…' : 'Message ' + (cur.hi ? '#' + cur.en : cur.dm)} value={draft}
                  onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
                <button className="icobtn" title="Emoji">{SI.smile}</button>
                <button className="btn btn--fill" style={{ height: 40, width: 44, padding: 0 }} onClick={() => send(draft)}>{I.send}</button>
              </div>
            ) : (
              <div className="composer composer--locked">
                {SI.lock}
                <span style={{ flex: 1, minWidth: 0 }}>
                  {cur.archived ? <>This channel is archived — nobody can post, including admins.</>
                    : <>Your Sanvaad access is <b>Viewer</b>: you can read every channel you are a member of, but not send. <span className="mute">Editor adds sending and channel creation.</span></>}
                </span>
                {!cur.archived && <button className="btn btn--out btn--sm">Request Editor</button>}
              </div>
            )}
          </div>

          {thread && (
            <div className="thr">
              <div className="thr__head">
                <b style={{ fontSize: 13 }}>Thread</b><span className="hi mute" style={{ fontSize: 12 }}>सूत्र</span>
                <span className="mute" style={{ fontSize: 11.5, marginLeft: 6 }}>in {cur.hi ? '#' + cur.en : cur.en}</span>
                <button className="icobtn" style={{ marginLeft: 'auto' }} onClick={() => setThread(null)}>{I.x}</button>
              </div>
              <div className="thr__body">
                <Msg m={{ ...thread, replies: 0, seen: null }} rx={rx} onTog={toggleRx} onThread={() => {}} can={false} />
                <div className="thr__count">{(THREAD[thread.id] || []).length} replies</div>
                {(THREAD[thread.id] || []).map((r, i) => <Msg key={i} m={{ ...r, id: thread.id + '-' + i }} rx={rx} onTog={toggleRx} onThread={() => {}} can={canPost} />)}
              </div>
              {canPost && (
                <div className="thr__foot">
                  <textarea className="composer__in" rows="1" placeholder="Reply in thread…" />
                  <label className="rowflex" style={{ gap: 7, fontSize: 11.5, color: 'var(--on-surface-3)' }}><input type="checkbox" /> Also send to channel</label>
                  <button className="btn btn--fill btn--sm" style={{ alignSelf: 'flex-end' }}>{I.send} Reply</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {picker && (
        <>
          <div className="scrim" onClick={() => setPicker(false)} />
          <div className="bsheet">
            <div className="bsheet__grab" />
            <div style={{ overflowY: 'auto', paddingBottom: 16 }}>
              {secs.filter(([, l]) => l.length).map(([lbl, list]) => (
                <div key={lbl}><div className="chat__sec">{lbl}</div>{list.map(c => <ChRow key={c.id} c={c} on={ch === c.id} click={() => { setCh(c.id); setThread(null); setPicker(false); }} />)}</div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

Object.assign(window, { SI, MOD_GLYPH, MTxt, Msg, Rx, ScreenSanvaad });
