// Mobile app prototype — high-value screens only. Heavy configuration stays on desktop.
// Grounded in mobile/src: 5-tab nav with a centre pill, TaskDetail as a bottom-sheet
// modal, offline mutation queue and push context already exist.
const MDEV = {
  ios15: { n: 'iPhone 15 Pro', w: 393, h: 852, os: 'ios', notch: 'dynamic', safeT: 59, safeB: 34, r: 55 },
  iose: { n: 'iPhone SE', w: 375, h: 667, os: 'ios', notch: 'none', safeT: 20, safeB: 0, r: 22 },
  pixel: { n: 'Pixel 8', w: 412, h: 915, os: 'android', notch: 'punch', safeT: 40, safeB: 24, r: 34 },
};
const MTABS = [
  ['today', 'Today', 'आज', 'dash'],
  ['tasks', 'Tasks', 'कर्तव्य', 'task'],
  ['add', '', '', 'plus'],
  ['msgs', 'Messages', 'संवाद', 'chat', 7],
  ['more', 'More', 'अधिक', 'dots'],
];
const MMODULES = [
  ['Approvals', 'सम्मति', 'check', 3, 'approvals'], ['Time', 'समय', 'clock', 0, 'time'], ['Reminders', 'स्मरण', 'bell', 5, 'reminders'],
  ['Attendance', 'पहचान', 'clock', 0, 'pahchan'], ['CRM', 'ग्रह', 'crm', 0, 'crm'], ['Finance', 'गणित', 'fin', 0, 'fin'],
  ['HRMS', 'मानव', 'hr', 2, 'hr'], ['Payslips', 'वेतन', 'pay', 0, 'pay'], ['Reports', 'दृष्टि', 'report', 0, 'rep'],
  ['Assistant', 'सृजन', 'ai', 0, 'ai'], ['eSign', 'हस्ताक्षर', 'sign', 1, 'sign'], ['Notifications', 'सूचना', 'bell', 12, 'inbox'],
];
const MAPPROVALS = [
  { id: 1, who: 'Rohan Iyer', kind: 'Task', t: 'Mumbai fit-out — final layout', sub: 'Layout v3 with the revised lift lobby', when: '12 min', ctx: 'KAR-582 · milestone 2' },
  { id: 2, who: 'Priya Nair', kind: 'Leave', t: '3 days casual leave', sub: '12–14 Aug · 8.5 days balance', when: '1 h', ctx: 'Marketing · no overlap' },
  { id: 3, who: 'Fatima Sheikh', kind: 'Expense', t: '₹18,400 travel claim', sub: 'Pune site visit · 3 receipts', when: '2 h', ctx: 'Within policy' },
  { id: 4, who: 'Aanya Mehta', kind: 'Payroll', t: 'July run · 6 employees', sub: '₹6,76,900 net', when: 'Yesterday', ctx: 'Attendance verified' },
];
const MMSGS = [
  { hi: 'कर-विवरणी', en: 'gst-filing', last: 'Aanya: Two vendor invoices are missing HSN', t: '09:41', n: 4, men: true },
  { hi: 'सामान्य', en: 'general', last: 'Priya: Diwali creatives are scheduled', t: '10:04', n: 3 },
  { dm: 'Aanya Mehta', last: 'Payroll cut-off is Thursday', t: '09:52', n: 2, on: true },
  { hi: 'मुंबई', en: 'tata-mumbai', last: 'Rohan: Saves us three weeks', t: 'Tue', n: 0 },
  { dm: 'Rohan Iyer', last: 'You: Chase both vendors today', t: 'Mon', n: 0, on: false },
];

function MTaskCard({ t, os, syncing, onClick, style, ...rest }) {
  const due = t.due === 'Done' ? '18 Jul' : t.due;
  const danger = t.dv === 'danger' || t.due === 'Done', warn = t.dv === 'warn' || t.p === 'high' || t.p === 'urgent';
  return (
    <div className={'mtc mtc--' + os} onClick={onClick} style={style} {...rest}>
      <div className="mtc__top">
        <span className="mtc__dot" style={{ background: t.pc }} />
        <span className="mtc__proj">{t.proj}</span>
        <span className="mtc__id mono">{t.id.toLowerCase().replace('kar-', 't_')}</span>
        {syncing && <span className="mtc__sync">{I.clock}</span>}
      </div>
      <div className="mtc__title">{t.t}</div>
      {t.sub > 0 && (
        <div className="mtc__prog">
          <span className="mtc__track"><span className="mtc__bar" style={{ width: (t.subDone / t.sub) * 100 + '%', background: t.subDone === t.sub ? '#05b7aa' : 'var(--primary)' }} /></span>
          <span className="mtc__pt">{t.subDone}/{t.sub}</span>
        </div>
      )}
      <div className="mtc__foot">
        <span className={'mtc__chip' + (danger ? ' danger' : warn ? ' warn' : '')}>{I.clock}{due}</span>
        {t.appr && <span className="mtc__chip appr">APPROVAL</span>}
        {t.men && <span className="mtc__chip men">@{os === 'android' ? ' Mention' : ''}</span>}
        <span style={{ flex: 1 }} />
        <Avs list={t.a} max={3} s={os === 'android' ? 24 : 22} />
      </div>
    </div>
  );
}

function MStatus({ d, theme }) {
  return (
    <div className="mstat" style={{ height: d.safeT, paddingTop: d.os === 'ios' ? 14 : 8 }}>
      <span className="mstat__t mono">9:41</span>
      {d.notch === 'dynamic' && <span className="mstat__island" />}
      {d.notch === 'punch' && <span className="mstat__punch" />}
      <span className="mstat__r">
        <svg width="15" height="11" viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="4.5" y="5.5" width="3" height="6.5" rx="1" /><rect x="9" y="3" width="3" height="9" rx="1" /><rect x="13.5" y="0" width="2.5" height="12" rx="1" opacity=".35" /></svg>
        <svg width="14" height="11" viewBox="0 0 15 12" fill="currentColor"><path d="M7.5 11.2l-7-7A9.9 9.9 0 017.5 1.4a9.9 9.9 0 017 2.8l-7 7z" /></svg>
        <svg width="22" height="11" viewBox="0 0 24 12" fill="none"><rect x=".6" y=".6" width="19" height="10.8" rx="3" stroke="currentColor" strokeOpacity=".4" /><rect x="2" y="2" width="14" height="8" rx="2" fill="currentColor" /><path d="M21 4v4a2 2 0 000-4z" fill="currentColor" fillOpacity=".4" /></svg>
      </span>
    </div>
  );
}

function MOffline({ on }) {
  if (!on) return null;
  return <div className="moff">{SI.alert}<span><b>Offline.</b> 3 changes queued · oldest 12 min</span></div>;
}

function MHead({ hi, en, right, sub }) {
  return (
    <div className="mhead">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="mhead__hi hi">{hi}</div>
        <div className="mhead__en">{en}</div>
        {sub && <div className="mhead__sub">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

// ── Today ──────────────────────────────────────────────────────────────
function MToday({ st, go, clockedIn, setClockedIn, os }) {
  const [k, bump] = useReplay();
  if (st === 'loading') return (
    <div className="mbody">
      <MHead hi="आज" en="Today" sub="Friday, 25 July" />
      <div className="mrow2">{[0, 1, 2].map(i => <Sk key={i} w="100%" h={62} r="14px" />)}</div>
      <Sk w="100%" h={54} r="14px" />
      {[0, 1, 2, 3].map(i => <Sk key={i} w="100%" h={72} r="14px" />)}
    </div>
  );
  if (st === 'error') return (
    <div className="mbody">
      <MHead hi="आज" en="Today" />
      <div className="mmid">
        <span className="mmid__ic">{SI.alert}</span>
        <b>Couldn’t load today</b>
        <span>The server didn’t answer. Anything you changed offline is still queued and safe.</span>
        <button className="mbtn mbtn--fill" onClick={bump}>Try again</button>
      </div>
    </div>
  );
  return (
    <div className="mbody" key={k}>
      <MHead hi="आज" en="Today" sub="Friday, 25 July · 3 due, 1 overdue"
        right={<span className="mav"><Av n="Keval Shah" s={34} /></span>} />
      <div className="mweek">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <button key={i} className={'mweek__d' + (i === 4 ? ' on' : '') + (i > 4 ? ' off' : '')}>
            <i>{d}</i><b>{21 + i}</b>{[2, 4].includes(i) && <span className="mweek__dot" />}
          </button>
        ))}
      </div>
      <div className="mstats">
        {[['Due today', '3', 'p'], ['Overdue', '1', 'danger'], ['Approvals', '3', 'warn'], ['Unread', '7', '']].map(([l, v, k2]) => (
          <div key={l} className={'mstat2' + (k2 ? ' ' + k2 : '')}><b>{v}</b><i>{l}</i></div>
        ))}
      </div>
      {!clockedIn ? (
        <button className="mclock" onClick={() => go('pahchan')}>
          <span className="mclock__ic">{I.clock}</span>
          <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}><b>Clock in</b><i>पहचान · not clocked in today</i></span>
          {I.chevR}
        </button>
      ) : (
        <button className="mclock mclock__in" onClick={() => go('pahchan')}>
          <span className="mclock__ic"><span className="mpulse" /></span>
          <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}><b className="mono">4h 18m</b><i>Since 09:02 · inside geo-fence</i></span>
          {I.chevR}
        </button>
      )}
      <div className="msec">Due today <span>3</span></div>
      {TASKS.slice(0, 3).map((t, i) => (
        <MTaskCard key={t.id} t={i === 0 ? { ...t, due: '23 Jul', dv: 'danger' } : t} os={os} syncing={i === 1} onClick={() => go('task')} />
      ))}
      <div className="msec">Activity <span>live</span></div>
      {[['Aanya Mehta', 'approved the July payroll run', '4m', 'check'], ['Rohan Iyer', 'mentioned you in #gst-filing', '18m', 'chat'], ['System', 'INV-2607 is now 12 days overdue', '2h', 'fin']].map(([w, a, t, ic]) => (
        <div key={a} className="mact">
          <span className="mact__ic">{I[ic]}</span>
          <span style={{ minWidth: 0, flex: 1 }}><b>{w}</b> {a}</span>
          <span className="mono mact__t">{t}</span>
        </div>
      ))}
    </div>
  );
}

// ── Tasks / Boards ─────────────────────────────────────────────────────
function MTasks({ st, go, os }) {
  const [seg, setSeg] = React.useState('tasks');
  const [swiped, setSwiped] = React.useState(null);
  const [gone, setGone] = React.useState([]);
  const touch = React.useRef({});
  const [dx, setDx] = React.useState({});
  return (
    <div className="mbody">
      <MHead hi="कर्तव्य" en="Tasks" right={<button className="micon">{I.search}</button>} />
      <div className="mseg">
        {[['tasks', 'My tasks'], ['boards', 'Boards']].map(([v, l]) => (
          <button key={v} className={'mseg__b' + (seg === v ? ' on' : '')} onClick={() => setSeg(v)}>{l}</button>
        ))}
      </div>
      {seg === 'tasks' ? (
        <>
          <div className="mchips">
            {['All', 'Due today', 'Overdue', 'Urgent', 'Mumbai review'].map((c, i) => (
              <button key={c} className={'mchip' + (i === 0 ? ' on' : '')}>{c}</button>
            ))}
          </div>
          {st === 'empty' ? (
            <div className="mmid">
              <span className="mmid__ic">{I.check}</span>
              <b>Nothing due</b>
              <span>You’re clear for today. Six tasks are scheduled later this week.</span>
              <button className="mbtn mbtn--out">See this week</button>
            </div>
          ) : TASKS.filter(t => !gone.includes(t.id)).map(t => (
            <div key={t.id} className="mswipe">
              <span className="mswipe__l">{I.check} Done</span>
              <span className="mswipe__r">{I.clock} Snooze</span>
              <MTaskCard t={t} os={os} style={{ transform: dx[t.id] ? `translateX(${dx[t.id]}px)` : undefined }}
                onTouchStart={e => { touch.current[t.id] = e.touches[0].clientX; }}
                onTouchMove={e => setDx(p => ({ ...p, [t.id]: Math.max(-96, Math.min(96, e.touches[0].clientX - (touch.current[t.id] || 0))) }))}
                onTouchEnd={() => {
                  const v = dx[t.id] || 0;
                  if (v > 64) { setGone(g => [...g, t.id]); }
                  setDx(p => ({ ...p, [t.id]: 0 }));
                }}
                onClick={() => go('task')} />
            </div>
          ))}
          {!gone.length && st !== 'empty' && <div className="mhint">Swipe a task right to complete, left to snooze</div>}
        </>
      ) : (
        <>
          <div className="msec">Projects <span>4</span></div>
          {[['Quarterly GST filing', 'कर', 12, 4, '#0082c6'], ['Mumbai fit-out', 'समीक्षा', 18, 11, '#B42318'], ['Diwali campaign', 'विपणन', 9, 7, '#A66207'], ['Vendor onboarding', 'विक्रेता', 6, 6, '#5b6ee0']].map(([n, hi, tot, done, c]) => (
            <button key={n} className="mproj" onClick={() => go('board')}>
              <span className="mproj__bar" style={{ background: c }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="mproj__n">{n}<i className="hi">{hi}</i></span>
                <span className="mproj__m">{done} of {tot} done</span>
                <span className="meter" style={{ marginTop: 6 }}><span className="meter__f" style={{ width: (done / tot) * 100 + '%', background: c }} /></span>
              </span>
              {I.chevR}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

// ── Sanvaad ────────────────────────────────────────────────────────────
function MMessages({ go }) {
  return (
    <div className="mbody">
      <MHead hi="संवाद" en="Messages" right={<button className="micon">{I.search}</button>} />
      <div className="mchips">
        {['All', 'Unread 3', 'Channels', 'Direct'].map((c, i) => <button key={c} className={'mchip' + (i === 0 ? ' on' : '')}>{c}</button>)}
      </div>
      {MMSGS.map((m, i) => (
        <button key={i} className={'mchat' + (m.n ? ' un' : '')} onClick={() => go('chat')}>
          <span className="mchat__av">
            {m.dm ? <Av n={m.dm} s={44} /> : <span className="mchat__hash">{SI.hash}</span>}
            {m.on && <span className="mchat__on" />}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="mchat__top">
              <b>{m.dm || m.hi}</b>
              {!m.dm && <i>#{m.en}</i>}
              <span className="mono mchat__t">{m.t}</span>
            </span>
            <span className="mchat__last">{m.last}</span>
          </span>
          {m.n > 0 && <span className={'mchat__n' + (m.men ? ' men' : '')}>{m.men ? '@' : ''}{m.n}</span>}
        </button>
      ))}
    </div>
  );
}

function MChat({ back }) {
  const [v, setV] = React.useState('');
  const [msgs, setMsgs] = React.useState([
    { who: 'Aanya Mehta', t: '09:12', txt: 'June ITC working is up. Two vendor invoices are missing HSN codes.', rx: [['👍', 2]] },
    { who: 'Rohan Iyer', t: '09:31', txt: 'Chased Shreeji — they re-issue by Monday. Placeholder.', replies: 3 },
    { me: true, t: '09:38', txt: 'Chase both vendors today — we can’t file with them missing.', seen: true },
  ]);
  const [rec, setRec] = React.useState(false);
  return (
    <>
      <div className="mtop">
        <button className="micon" onClick={back}>{I.chevL}</button>
        <span className="mchat__hash" style={{ width: 32, height: 32 }}>{SI.hash}</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <b className="hi" style={{ fontSize: 15, display: 'block' }}>कर-विवरणी</b>
          <i className="mtop__sub">4 members · 2 online</i>
        </span>
        <button className="micon">{I.search}</button>
        <button className="micon">{I.dots}</button>
      </div>
      <div className="mbody mbody--chat">
        <div className="mdiv"><span>Today</span></div>
        {msgs.map((m, i) => (
          <div key={i} className={'mmsg' + (m.me ? ' me' : '')}>
            {!m.me && <Av n={m.who} s={30} />}
            <div className="mmsg__b">
              {!m.me && <span className="mmsg__who">{m.who}</span>}
              <div className="mmsg__bub">{m.txt}<span className="mmsg__t mono">{m.t}{m.me && <span className="mmsg__tick">{SI.tick2}</span>}</span></div>
              {m.rx && <div className="mmsg__rx">{m.rx.map(([e, n]) => <span key={e}>{e} {n}</span>)}</div>}
              {m.replies && <button className="mmsg__thr">{SI.thread} {m.replies} replies</button>}
            </div>
          </div>
        ))}
        <div className="mtyping"><span className="typing"><i /><i /><i /></span> Rohan is typing…</div>
      </div>
      <div className="mcomp">
        <button className="micon">{SI.clip}</button>
        <input className="mcomp__in" value={v} onChange={e => setV(e.target.value)} placeholder="Message" />
        <button className="micon">{SI.smile}</button>
        {v.trim()
          ? <button className="mcomp__send">{I.send}</button>
          : <button className={'mcomp__send mcomp__send--mic' + (rec ? ' rec' : '')} onMouseDown={() => setRec(true)} onMouseUp={() => setRec(false)} onTouchStart={() => setRec(true)} onTouchEnd={() => setRec(false)}>
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="7" y="2.5" width="6" height="9" rx="3" /><path d="M4.5 9.5a5.5 5.5 0 0011 0M10 15v2.5M7 17.5h6" /></svg>
          </button>}
      </div>
      {rec && <div className="mrec">{SI.alert} Hold to record · release to send · slide left to cancel</div>}
    </>
  );
}

// ── Pahchan ────────────────────────────────────────────────────────────
function MPahchan({ back, clockedIn, setClockedIn, offline }) {
  const [stage, setStage] = React.useState(clockedIn ? 'in' : 'camera');
  const [scan, setScan] = React.useState(0);
  const [tab, setTab] = React.useState('clock');
  React.useEffect(() => {
    if (stage !== 'scanning') return;
    const iv = setInterval(() => setScan(s => {
      if (s >= 100) { clearInterval(iv); setStage('matched'); setTimeout(() => { setClockedIn(true); setStage('in'); }, 900); return 100; }
      return s + 7;
    }), 90);
    return () => clearInterval(iv);
  }, [stage]);

  if (tab === 'cal') return (
    <>
      <div className="mtop"><button className="micon" onClick={back}>{I.chevL}</button><span style={{ flex: 1 }}><b className="hi" style={{ fontSize: 15 }}>पहचान</b> <i className="mtop__sub">My attendance</i></span></div>
      <div className="mbody">
        <div className="mseg">{[['clock', 'Clock'], ['cal', 'My attendance']].map(([v, l]) => <button key={v} className={'mseg__b' + (tab === v ? ' on' : '')} onClick={() => setTab(v)}>{l}</button>)}</div>
        <div className="mstats">
          {[['Present', '19', 'ok'], ['Late', '2', 'warn'], ['Leave', '1', ''], ['Hours', '164', 'p']].map(([l, v, k]) => (
            <div key={l} className={'mstat2' + (k ? ' ' + k : '')}><b>{v}</b><i>{l}</i></div>
          ))}
        </div>
        <div className="msec">July 2026 <span>heat map</span></div>
        <div className="mcal">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="mcal__dow">{d}</span>)}
          {[0, 1].map(i => <span key={'b' + i} />)}
          {Array.from({ length: 31 }, (_, i) => {
            const n = i + 1, dow = (n + 2) % 7;
            const kind = dow === 5 || dow === 6 ? 'wo' : n === 17 ? 'l' : n === 8 || n === 22 ? 'late' : n <= 25 ? 'p' : '';
            return <button key={n} className={'mcal__d ' + kind + (n === 25 ? ' today' : '')}>{n}</button>;
          })}
        </div>
        <div className="mlegend">
          {[['p', 'Present'], ['late', 'Late'], ['l', 'Leave'], ['wo', 'Weekly off']].map(([k, l]) => (
            <span key={k}><i className={'mcal__d ' + k} />{l}</span>
          ))}
        </div>
        <div className="msec">25 July <span>today</span></div>
        <div className="mdetail">
          {[['Clock in', '09:02', 'Face verified · inside geo-fence'], ['Clock out', '—', 'Still clocked in'], ['Total', '4h 18m', 'Break 0m · overtime 0m'], ['Location', 'BKC office', '18.9°N 72.8°E · 42m from centre']].map(([l, v, s]) => (
            <div key={l} className="mdetail__r"><i>{l}</i><b className="mono">{v}</b><span>{s}</span></div>
          ))}
        </div>
      </div>
    </>
  );

  return (
    <>
      {stage === 'in' ? (
        <>
          <div className="mtop"><button className="micon" onClick={back}>{I.chevL}</button><span style={{ flex: 1 }}><b className="hi" style={{ fontSize: 15 }}>पहचान</b> <i className="mtop__sub">Attendance</i></span></div>
          <div className="mbody">
            <div className="mseg">{[['clock', 'Clock'], ['cal', 'My attendance']].map(([v, l]) => <button key={v} className={'mseg__b' + (tab === v ? ' on' : '')} onClick={() => setTab(v)}>{l}</button>)}</div>
            <div className="mclocked">
              <span className="mpulse mpulse--lg" />
              <b className="mono">4h 18m</b>
              <i>Clocked in at 09:02</i>
              <span className="mclocked__meta">{I.check} Face verified · inside geo-fence · 42m from BKC office</span>
              {offline && <span className="mclocked__off">{SI.alert} Saved on this device with the real 09:02 timestamp — not the time it syncs. Held until it reaches the server; a punch is never dropped.</span>}
              <button className="mbtn mbtn--danger" onClick={() => { setClockedIn(false); setStage('camera'); }}>Clock out</button>
            </div>
            <div className="msec">Today so far</div>
            <div className="mdetail">
              {[['In', '09:02'], ['Break', '0m'], ['Expected out', '18:00'], ['Shift', 'General 09:00–18:00']].map(([l, v]) => (
                <div key={l} className="mdetail__r"><i>{l}</i><b className="mono">{v}</b></div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="mcam">
          <button className="mcam__x" onClick={back}>{I.x}</button>
          <div className="mcam__time mono">09:02<i>Friday, 25 July</i></div>
          <div className={'mcam__ring' + (stage === 'scanning' ? ' scan' : '') + (stage === 'matched' ? ' ok' : '')}>
            <span className="mcam__face">
              {stage === 'matched'
                ? <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round"><path d="M14 27l8 8 16-18" /></svg>
                : <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.6"><ellipse cx="32" cy="28" rx="15" ry="19" /><path d="M12 60c0-9 9-15 20-15s20 6 20 15" /></svg>}
            </span>
            {stage === 'scanning' && <span className="mcam__sweep" style={{ top: scan + '%' }} />}
          </div>
          <div className="mcam__msg">
            {stage === 'camera' && <><b>Look at the camera</b><i>Your face never leaves this device — only a match result is sent.</i></>}
            {stage === 'scanning' && <><b>Matching… {scan}%</b><i>Hold still</i></>}
            {stage === 'matched' && <><b>Matched — Keval Shah</b><i>Confidence 98.2%</i></>}
          </div>
          <div className="mcam__chips">
            <span className="mcam__chip">{I.check} GPS locked · 42m</span>
            <span className={'mcam__chip' + (offline ? ' warn' : '')}>{offline ? <>{SI.alert} Offline · queued</> : <>{I.check} Online</>}</span>
          </div>
          <button className="mcam__go" disabled={stage !== 'camera'} onClick={() => setStage('scanning')}>
            {stage === 'camera' ? 'Clock in' : stage === 'scanning' ? 'Scanning…' : 'Clocked in'}
          </button>
          <button className="mcam__alt" onClick={() => setTab('cal')}>My attendance</button>
        </div>
      )}
    </>
  );
}

// ── Approvals ──────────────────────────────────────────────────────────
function MApprovals({ back }) {
  const [list, setList] = React.useState(MAPPROVALS);
  const [dx, setDx] = React.useState({});
  const [sel, setSel] = React.useState([]);
  const [reject, setReject] = React.useState(null);
  const [note, setNote] = React.useState('');
  const touch = React.useRef({});
  const act = (id, ok) => { if (ok) setList(l => l.filter(x => x.id !== id)); else setReject(list.find(x => x.id === id)); setDx(p => ({ ...p, [id]: 0 })); };
  return (
    <>
      <div className="mtop">
        <button className="micon" onClick={back}>{I.chevL}</button>
        <span style={{ flex: 1 }}><b className="hi" style={{ fontSize: 15 }}>सम्मति</b> <i className="mtop__sub">{list.length} waiting on you</i></span>
        <button className="micon" onClick={() => setSel(sel.length ? [] : list.map(x => x.id))}>{I.check}</button>
      </div>
      <div className="mbody">
        {sel.length > 0 && (
          <div className="mbulk"><b>{sel.length} selected</b><button className="mbtn mbtn--fill mbtn--sm" onClick={() => { setList(l => l.filter(x => !sel.includes(x.id))); setSel([]); }}>Approve all</button><button className="mbtn mbtn--out mbtn--sm" onClick={() => setSel([])}>Cancel</button></div>
        )}
        {list.length === 0 ? (
          <div className="mmid"><span className="mmid__ic">{I.check}</span><b>Nothing waiting</b><span>You’re clear. New requests arrive as a push notification.</span></div>
        ) : list.map(a => (
          <div key={a.id} className="mswipe">
            <span className="mswipe__l ok">{I.check} Approve</span>
            <span className="mswipe__r bad">{I.x} Decline</span>
            <div className="mapp" style={{ transform: dx[a.id] ? `translateX(${dx[a.id]}px)` : undefined }}
              onTouchStart={e => { touch.current[a.id] = e.touches[0].clientX; }}
              onTouchMove={e => setDx(p => ({ ...p, [a.id]: Math.max(-110, Math.min(110, e.touches[0].clientX - (touch.current[a.id] || 0))) }))}
              onTouchEnd={() => { const v = dx[a.id] || 0; if (v > 72) act(a.id, true); else if (v < -72) act(a.id, false); else setDx(p => ({ ...p, [a.id]: 0 })); }}>
              <span className="mapp__top">
                {sel.length > 0 && <button className={'mck' + (sel.includes(a.id) ? ' on' : '')} onClick={() => setSel(s => s.includes(a.id) ? s.filter(x => x !== a.id) : [...s, a.id])}>{sel.includes(a.id) ? I.check : null}</button>}
                <Av n={a.who} s={28} />
                <span style={{ minWidth: 0, flex: 1 }}><b>{a.who}</b><i>{a.kind} · {a.when}</i></span>
                <span className="mapp__kind">{a.kind}</span>
              </span>
              <span className="mapp__t">{a.t}</span>
              <span className="mapp__sub">{a.sub}</span>
              <span className="mapp__ctx">{a.ctx}</span>
              <span className="mapp__acts">
                <button className="mbtn mbtn--out mbtn--sm" onClick={() => act(a.id, false)}>Decline</button>
                <button className="mbtn mbtn--fill mbtn--sm" onClick={() => act(a.id, true)}>Approve</button>
              </span>
            </div>
          </div>
        ))}
        {list.length > 0 && <div className="mhint">Swipe right to approve, left to decline · a decline needs a reason</div>}
      </div>
      {reject && (
        <>
          <div className="msheet__scrim" onClick={() => { setReject(null); setNote(''); }} />
          <div className="msheet">
            <span className="msheet__grab" />
            <div className="msheet__h"><b>Decline “{reject.t}”</b></div>
            <div className="msheet__b">
              <span className="mlbl">Why — required, {reject.who.split(' ')[0]} reads this</span>
              <textarea className="minp" rows="3" value={note} onChange={e => setNote(e.target.value)} autoFocus placeholder="Lift lobby dimension does not match the signed sheet." />
              <button className="mbtn mbtn--danger" disabled={!note.trim()} onClick={() => { setList(l => l.filter(x => x.id !== reject.id)); setReject(null); setNote(''); }}>Decline request</button>
              {!note.trim() && <span className="mhint" style={{ margin: 0 }}>Declining without a reason sends the work back to somebody who has to guess.</span>}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── More ───────────────────────────────────────────────────────────────
function MMore({ go }) {
  return (
    <div className="mbody">
      <MHead hi="अधिक" en="More" />
      <button className="mme">
        <Av n="Keval Shah" s={52} />
        <span style={{ minWidth: 0, flex: 1 }}><b>Keval Shah</b><i>Owner · Aekam Inc</i></span>
        {I.chevR}
      </button>
      <div className="msec">Pinned</div>
      <div className="mgrid mgrid--pin">
        {MMODULES.slice(0, 3).map(([n, hi, ic, b, k]) => (
          <button key={n} className="mtile" onClick={() => go(k)}>
            <span className="mtile__ic">{I[ic]}{b && <span className="mtile__b">{b}</span>}</span>
            <b className="hi">{hi}</b><i>{n}</i>
          </button>
        ))}
      </div>
      <div className="msec">All modules <span>12</span></div>
      <div className="mgrid">
        {MMODULES.map(([n, hi, ic, b, k]) => (
          <button key={n} className="mtile" onClick={() => go(k)}>
            <span className="mtile__ic">{I[ic]}{b && <span className="mtile__b">{b}</span>}</span>
            <b className="hi">{hi}</b><i>{n}</i>
          </button>
        ))}
      </div>
      <div className="msec">Settings</div>
      {[['Notifications & sounds', 'bell', 'settings'], ['Language', 'hub', 'settings'], ['Offline & sync', 'clock', 'stub'], ['Account', 'hr', 'settings'], ['About', 'doc', 'stub']].map(([l, ic, k]) => (
        <button key={l} className="mlist" onClick={() => go(k)}><span className="mlist__ic">{I[ic]}</span>{l}{I.chevR}</button>
      ))}
      <div className="mhint">Accent colour, fonts and density are set once on desktop — but theme, language, push and time format are here, because those change where you are.</div>
    </div>
  );
}

Object.assign(window, { MDEV, MTABS, MMODULES, MTaskCard, MStatus, MOffline, MHead, MToday, MTasks, MMessages, MChat, MPahchan, MApprovals, MMore });
