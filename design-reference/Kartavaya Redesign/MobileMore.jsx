/* Inbox · Settings · Time · Reminders — grounded in mobile/src/screens/
   InboxScreen.tsx (tabs Mentions/Approvals/Status/Comments, date groups Today/आज,
   Yesterday/कल), SettingsScreen.tsx (8 notification kinds with Hindi + desc,
   push scope Always/Mine only/Project, theme System/Light/Dark, card r14 bw1 mx16),
   MeScreen.tsx (pushDesc per kind). */
const { useState: uM } = React;

const KIND = {
  mention: ['उल्लेख', 'Mentions', 'var(--primary)'],
  approval_request: ['अनुमोदन', 'Approval requests', 'var(--warn)'],
  assigned: ['असाइन किया', 'Task assigned', 'var(--primary)'],
  comment: ['टिप्पणियाँ', 'Comments', 'var(--on-surface-3)'],
  status_changed: ['स्थिति', 'Status changes', 'var(--on-surface-3)'],
  done: ['पूर्ण', 'Task completed', 'var(--ok)'],
  approved: ['स्वीकृत', 'Approved', 'var(--ok)'],
  rejected: ['अस्वीकृत', 'Rejected', 'var(--danger)'],
};
const KDESC = {
  assigned: 'When a task is assigned to you', comment: 'When someone comments on your task',
  mention: 'When you are @-mentioned', approval_request: 'When approval is requested',
  approved: 'When your task is approved', rejected: 'When your task is rejected',
  status_changed: 'When a task status changes', done: 'When a task is marked done',
};
const ITABS = [['all', 'All'], ['mentions', 'Mentions'], ['approvals', 'Approvals'], ['status', 'Status'], ['comments', 'Comments']];
const INBOX = [
  { g: 'Today', hi: 'आज', items: [
    { k: 'mention', who: 'Aanya Mehta', b: 'mentioned you on', t: 'File GSTR-3B for July 2026', at: '12:38', un: true },
    { k: 'approval_request', who: 'Vikram Desai', b: 'requested approval on', t: 'TDS challan for Q1', at: '11:52', un: true },
    { k: 'rejected', who: 'Rohit Shah', b: 'rejected', t: 'Diwali campaign draft', at: '10:14', un: true, note: 'Client wants the Hindi copy first.' },
  ] },
  { g: 'Yesterday', hi: 'कल', items: [
    { k: 'assigned', who: 'Priya Nair', b: 'assigned you', t: 'Collect Form 16 from 3 vendors', at: '17:20' },
    { k: 'comment', who: 'Aanya Mehta', b: 'commented on', t: 'Reconcile 2B mismatches', at: '15:03' },
    { k: 'done', who: 'Priya Nair', b: 'completed', t: 'ITC ledger reconciled', at: '09:41' },
  ] },
];

function MInbox({ os, state, go }) {
  const [tab, setTab] = uM('all');
  const [read, setRead] = uM({});
  const map = { mentions: ['mention'], approvals: ['approval_request', 'approved', 'rejected'], status: ['status_changed', 'done', 'assigned'], comments: ['comment'] };
  const groups = INBOX.map(g => ({ ...g, items: g.items.filter(i => tab === 'all' || map[tab].includes(i.k)) })).filter(g => g.items.length);
  const unread = INBOX.flatMap(g => g.items).filter((i, n) => i.un && !read[i.t + n]).length;

  if (state === 'empty' || (state !== 'loading' && groups.length === 0)) return (
    <><div className="mtop" style={{ paddingTop: os === 'ios' ? 56 : 36 }}><span className="mtop__t">Inbox <i className="hi">सूचना</i></span></div>
      <div className="mitabs">{ITABS.map(([k, l]) => <button key={k} className={'mitab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div className="mbody mempty"><span className="mempty__i" style={{ color: 'var(--ok)' }}>{TI.ok}</span><b>Nothing here</b><i>{tab === 'all' ? "You're all caught up." : `No ${ITABS.find(t => t[0] === tab)[1].toLowerCase()} right now.`}</i></div></>
  );

  return (
    <>
      <div className="mtop" style={{ paddingTop: os === 'ios' ? 56 : 36 }}>
        <span className="mtop__t">Inbox <i className="hi">सूचना</i></span>
        {unread > 0 && <button className="mitab__all" onClick={() => setRead(Object.fromEntries(INBOX.flatMap(g => g.items).map((i, n) => [i.t + n, true])))}>Mark all read</button>}
      </div>
      <div className="mitabs">
        {ITABS.map(([k, l]) => <button key={k} className={'mitab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="mbody" style={{ padding: '0 0 14px' }}>
        {state === 'loading'
          ? <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>{[0, 1, 2, 3].map(i => <div key={i} style={{ display: 'flex', gap: 11 }}><div className="msk" style={{ width: 32, height: 32, borderRadius: 16, flexShrink: 0 }} /><div style={{ flex: 1 }}><div className="msk" style={{ height: 12, width: '72%' }} /><div className="msk" style={{ height: 11, width: '46%', marginTop: 7 }} /></div></div>)}</div>
          : groups.map(g => (
            <div key={g.g}>
              <div className="msec"><span>{g.g}</span><span className="hi">{g.hi}</span></div>
              {g.items.map((i, n) => {
                const [hi, , c] = KIND[i.k];
                const isUn = i.un && !read[i.t + n];
                return (
                  <button key={n} className={'mirow' + (isUn ? ' un' : '')} onClick={() => { setRead({ ...read, [i.t + n]: true }); go && go('task'); }}>
                    <AvT n={i.who} s={32} />
                    <span className="mirow__b">
                      <span className="mirow__l"><b>{i.who.split(' ')[0]}</b> {i.b} <em>{i.t}</em></span>
                      {i.note && <span className="mirow__n">“{i.note}”</span>}
                      <span className="mirow__m"><i style={{ color: c }}>{hi}</i> · {i.at}</span>
                    </span>
                    {isUn && <i className="mirow__dot" />}
                  </button>
                );
              })}
            </div>
          ))}
      </div>
    </>
  );
}

function MSettings({ os, back }) {
  const [theme, setTheme] = uM('system');
  const [notif, setNotif] = uM({ mention: 'always', approval_request: 'always', assigned: 'mine_only', comment: 'project', status_changed: 'project', done: 'mine_only', approved: 'always', rejected: 'always' });
  const [push, setPush] = uM(true);
  const [fmt, setFmt] = uM('24h');
  const [lang, setLang] = uM('en+hi');
  const [open, setOpen] = uM(null);
  const SCOPE = [['always', 'Always'], ['mine_only', 'Mine only'], ['project', 'Project'], ['off', 'Off']];

  return (
    <>
      <div className="mtop mtd__top" style={{ paddingTop: os === 'ios' ? 56 : 36 }}>
        <button className="micon" onClick={back}>{TI.chevL}</button>
        <span className="mtd__topt">Settings</span><span style={{ width: 28 }} />
      </div>
      <div className="mbody" style={{ padding: '14px 0 20px', gap: 18 }}>
        <div className="mst">
          <span className="mst__k">APPEARANCE</span>
          <div className="mst__card">
            <div className="mst__seg">
              {[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) =>
                <button key={k} className={'mst__segb' + (theme === k ? ' on' : '')} onClick={() => setTheme(k)}>{l}</button>)}
            </div>
            <div className="mst__row" onClick={() => setOpen('lang')}>
              <span><b>Language</b><i>{{ 'en': 'English', 'en+hi': 'English + हिन्दी', 'hi': 'हिन्दी' }[lang]}</i></span>{TI.chevR}
            </div>
            <div className="mst__row last">
              <span><b>Time format</b><i>{fmt === '24h' ? '14:30' : '2:30 PM'}</i></span>
              <div className="mst__seg sm">{[['12h', '12hr'], ['24h', '24hr']].map(([k, l]) => <button key={k} className={'mst__segb' + (fmt === k ? ' on' : '')} onClick={() => setFmt(k)}>{l}</button>)}</div>
            </div>
          </div>
        </div>

        <div className="mst">
          <span className="mst__k">PUSH NOTIFICATIONS</span>
          <div className="mst__card">
            <div className="mst__row last">
              <span><b>Push on this device</b><i>{push ? 'Pixel 8 · registered' : 'Off — you will only see in-app'}</i></span>
              <button className={'mtg' + (push ? ' on' : '')} onClick={() => setPush(!push)}><i /></button>
            </div>
          </div>
        </div>

        <div className="mst">
          <span className="mst__k">WHAT TO NOTIFY ME ABOUT</span>
          <div className="mst__card">
            {Object.keys(KDESC).map((k, i, a) => (
              <div className={'mst__row' + (i === a.length - 1 ? ' last' : '')} key={k} onClick={() => setOpen(k)}>
                <span><b>{KIND[k][1]} <em className="hi">{KIND[k][0]}</em></b><i>{KDESC[k]}</i></span>
                <span className={'mst__scope' + (notif[k] === 'off' ? ' off' : '')}>{SCOPE.find(s => s[0] === notif[k])[1]}</span>
              </div>
            ))}
          </div>
          <p className="mst__note">Approval requests stay on — turning them off would hide work that is waiting on you.</p>
        </div>

        <div className="mst">
          <div className="mst__card">
            <div className="mst__row last dgr"><span><b>Sign out</b><i>ks@aekam.co · Aekam Inc</i></span>{TI.chevR}</div>
          </div>
        </div>
      </div>

      {open && open !== 'lang' && <MSheet title={KIND[open][1]} onClose={() => setOpen(null)}>
        {SCOPE.map(([k, l]) => (
          <button key={k} className="msheet__r" onClick={() => { setNotif({ ...notif, [open]: k }); setOpen(null); }}>
            <span style={{ flex: 1, textAlign: 'left' }}><b>{l}</b><i className="msheet__sub">{{ always: 'Every time, on any project', mine_only: 'Only tasks assigned to me', project: 'Only projects I follow', off: 'Never notify' }[k]}</i></span>
            {notif[open] === k && <span style={{ color: 'var(--primary-text)' }}>{TI.check}</span>}
          </button>
        ))}
      </MSheet>}
      {open === 'lang' && <MSheet title="Language" onClose={() => setOpen(null)}>
        {[['en', 'English', 'Interface in English only'], ['en+hi', 'English + हिन्दी', 'English labels with Hindi subtitles'], ['hi', 'हिन्दी', 'Interface in Hindi']].map(([k, l, d]) =>
          <button key={k} className="msheet__r" onClick={() => { setLang(k); setOpen(null); }}>
            <span style={{ flex: 1, textAlign: 'left' }}><b>{l}</b><i className="msheet__sub">{d}</i></span>{lang === k && <span style={{ color: 'var(--primary-text)' }}>{TI.check}</span>}
          </button>)}
      </MSheet>}
    </>
  );
}

function MTime({ os, back }) {
  const [run, setRun] = uM(false);
  const [sec, setSec] = uM(0);
  React.useEffect(() => { if (!run) return; const t = setInterval(() => setSec(s => s + 1), 1000); return () => clearInterval(t); }, [run]);
  const hms = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const ENT = [
    { t: 'File GSTR-3B for July 2026', p: 'Quarterly GST', d: '2h 40m', from: '09:20', to: '12:00' },
    { t: 'Reconcile 2B mismatches', p: 'Quarterly GST', d: '1h 15m', from: '13:05', to: '14:20' },
    { t: 'Client call — Nirmal Exports', p: 'Mumbai review', d: '45m', from: '15:00', to: '15:45' },
  ];
  return (
    <>
      <div className="mtop mtd__top" style={{ paddingTop: os === 'ios' ? 56 : 36 }}>
        <button className="micon" onClick={back}>{TI.chevL}</button><span className="mtd__topt">Time <i className="hi">समय</i></span><span style={{ width: 28 }} />
      </div>
      <div className="mbody" style={{ padding: '14px 16px 20px', gap: 14 }}>
        <div className={'mtm__run' + (run ? ' on' : '')}>
          <span className="mtm__runk">{run ? 'RUNNING' : 'NO TIMER RUNNING'}</span>
          <b className="mono">{hms(sec)}</b>
          {run && <span className="mtm__runt">File GSTR-3B for July 2026</span>}
          <button className="mtm__runb" onClick={() => setRun(!run)}>{run ? 'Stop' : 'Start on a task'}</button>
        </div>
        <div className="msec" style={{ padding: 0 }}><span>Today</span><span className="mono" style={{ color: 'var(--on-surface-3)' }}>4h 40m</span></div>
        {ENT.map((e, i) => (
          <div className="mtm__e" key={i}>
            <span className="mtm__eb"><b>{e.t}</b><i>{e.p} · {e.from}–{e.to}</i></span>
            <span className="mono mtm__ed">{e.d}</span>
          </div>
        ))}
        <div className="mtm__wk"><span>This week</span><b className="mono">21h 05m</b><i>of 40h</i><span className="mtm__wkbar"><i style={{ width: '53%' }} /></span></div>
      </div>
    </>
  );
}

function MReminders({ os, back }) {
  const [rem, setRem] = uM([
    { t: 'File GSTR-3B for July 2026', when: 'Today, 18:00', k: 'due', on: true },
    { t: 'Chase Nirmal for HSN codes', when: 'Tomorrow, 10:00', k: 'follow', on: true },
    { t: 'TDS challan for Q1 — approve', when: 'Mon 28 Jul, 09:30', k: 'apv', on: true },
    { t: 'Advance tax instalment', when: '15 Sep, 09:00', k: 'due', on: false },
  ]);
  const [snz, setSnz] = uM(null);
  return (
    <>
      <div className="mtop mtd__top" style={{ paddingTop: os === 'ios' ? 56 : 36 }}>
        <button className="micon" onClick={back}>{TI.chevL}</button><span className="mtd__topt">Reminders <i className="hi">स्मरण</i></span><button className="micon">{TI.plus}</button>
      </div>
      <div className="mbody" style={{ padding: '14px 16px 20px', gap: 10 }}>
        {rem.map((r, i) => (
          <div className={'mrm' + (r.on ? '' : ' off')} key={i}>
            <span className="mrm__ic" style={{ color: r.k === 'apv' ? 'var(--warn)' : r.k === 'follow' ? 'var(--primary)' : 'var(--on-surface-3)' }}>{r.k === 'apv' ? TI.shield : TI.clock}</span>
            <span className="mrm__b"><b>{r.t}</b><i>{r.when}</i></span>
            <button className="mrm__snz" onClick={() => setSnz(i)}>Snooze</button>
            <button className={'mtg sm' + (r.on ? ' on' : '')} onClick={() => setRem(rem.map((x, j) => j === i ? { ...x, on: !x.on } : x))}><i /></button>
          </div>
        ))}
        <p className="mst__note" style={{ margin: '4px 2px 0' }}>Reminders fire on this device only. Turning one off does not change the task's due date.</p>
      </div>
      {snz !== null && <MSheet title="Snooze until" onClose={() => setSnz(null)}>
        {['In 1 hour', 'This evening, 18:00', 'Tomorrow, 09:00', 'Next Monday, 09:00'].map(l =>
          <button key={l} className="msheet__r" onClick={() => { setRem(rem.map((x, j) => j === snz ? { ...x, when: l.replace('In 1 hour', 'Today, 15:40') } : x)); setSnz(null); }}>{TI.clock}<span>{l}</span></button>)}
      </MSheet>}
    </>
  );
}

/* Per-screen states for the four screens that had none. Skeletons mirror the
   real layout of each screen — a generic grey box teaches the eye nothing. */
function MState({ kind, state, os, back }) {
  const sk = (h, w, r) => <div className="msk" style={{ height: h, width: w || '100%', borderRadius: r || 6 }} />;
  const head = t => <div className="mtop" style={{ paddingTop: os === 'ios' ? 56 : 36 }}>{back && <button className="micon" onClick={back}>{TI.chevL}</button>}<span className="mtop__t">{t}</span></div>;

  const EMPTY = {
    msgs: ['No conversations yet', 'Sanvaad channels appear here once you are added to one. Ask your admin, or start a direct message.'],
    chat: ['No messages yet', 'This channel is empty. Say something — everyone in #gst-filing will see it.'],
    approvals: ['Nothing waiting on you', 'When someone requests approval, it lands here and on your lock screen.'],
    more: ['No modules active', 'Your org has not activated any modules yet. An org admin can turn them on in Settings.'],
  };
  const ERR = {
    msgs: ['Messages did not load', 'Sanvaad is not responding. Your messages are safe — this is a connection problem.'],
    chat: ['Could not open this channel', 'You may have lost access, or the channel was archived.'],
    approvals: ['Approvals did not load', 'We could not reach the approvals service. Nothing has been approved or declined.'],
    more: ['Could not load your modules', 'Your session may have expired. Signing in again usually fixes it.'],
  };
  const TITLE = { msgs: <>Messages <i className="hi">संवाद</i></>, chat: '#gst-filing', approvals: <>Approvals <i className="hi">सम्मति</i></>, more: <>More <i className="hi">अधिक</i></> };

  if (state === 'loading') return (
    <>{head(TITLE[kind])}
      <div className="mbody" style={{ padding: kind === 'chat' ? '14px 14px 0' : '14px 16px', gap: kind === 'chat' ? 10 : 13 }}>
        {kind === 'chat' && [['62%', 'l'], ['48%', 'r'], ['78%', 'l'], ['40%', 'r'], ['56%', 'l']].map(([w, s], i) =>
          <div key={i} style={{ display: 'flex', justifyContent: s === 'r' ? 'flex-end' : 'flex-start' }}>{sk(s === 'r' ? 34 : 44, w, 14)}</div>)}
        {kind === 'msgs' && [0, 1, 2, 3, 4].map(i => <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>{sk(44, 44, 22)}<div style={{ flex: 1 }}>{sk(12, '54%')}<div style={{ height: 7 }} />{sk(11, '82%')}</div></div>)}
        {kind === 'approvals' && [0, 1, 2].map(i => <div key={i}>{sk(96, null, 12)}</div>)}
        {kind === 'more' && <>{sk(68, null, 12)}<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 9 }}>{[...Array(9)].map((_, i) => sk(74, null, 12))}</div></>}
      </div></>
  );

  const [t, d] = (state === 'error' ? ERR : EMPTY)[kind];
  return (
    <>{head(TITLE[kind])}
      <div className="mbody mempty">
        <span className="mempty__i" style={{ color: state === 'error' ? 'var(--danger)' : 'var(--on-surface-faint)' }}>{state === 'error' ? TI.no : TI.ok}</span>
        <b>{t}</b><i>{d}</i>
        {state === 'error' && <button className="mbtn" style={{ marginTop: 14 }}>Try again</button>}
      </div></>
  );
}

Object.assign(window, { MInbox, MSettings, MTime, MReminders, MState });
