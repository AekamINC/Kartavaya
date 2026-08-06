// Tablet panes. Every screen here is a phone screen from Mobile.jsx placed in a
// pane — the only new compositions are Today (a dashboard, so it gets columns
// instead of a detail pane) and the empty detail state.

const T_NAV = ['today', 'tasks', 'msgs', 'approvals', 'pahchan', 'more', 'board', 'inbox', 'time', 'reminders', 'settings', 'crm', 'fin', 'hr', 'pay', 'rep', 'ai', 'sign'];

function TEmpty({ kind }) {
  const copy = {
    task: ['task', 'No task open', 'Pick a task on the left. It opens here instead of covering the list, so you keep your place in it.'],
    chat: ['chat', 'No conversation open', 'Channels and direct messages open beside the list. Unread counts keep updating while you read another thread.'],
  }[kind];
  return (
    <div className="tempty">
      <div className="tempty__in">
        <span className="tempty__ic">{I[copy[0]]}</span>
        <b>{copy[1]}</b>
        <span>{copy[2]}</span>
      </div>
    </div>
  );
}

// Today is a summary, not a list of things you open — so it takes columns rather
// than a detail pane. Two columns at expanded and above; one below.
function TToday({ st, go, clockedIn, setClockedIn, os, cols }) {
  const Col = ({ children }) => <div className="ttoday__c">{children}</div>;
  const primary = (
    <Col>
      <MHead hi="आज" en="Today" sub="Friday, 25 July · 3 due, 1 overdue"
        right={<span className="mav"><Av n="Keval Shah" s={38} /></span>} />
      <div className="mweek">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <button key={i} className={'mweek__d' + (i === 4 ? ' on' : '') + (i > 4 ? ' off' : '')}>
            <i>{d}</i><b>{21 + i}</b>{[2, 4].includes(i) && <span className="mweek__dot" />}
          </button>
        ))}
      </div>
      <div className="mstats">
        {[['Due today', '3', 'p'], ['Overdue', '1', 'danger'], ['Approvals', '3', 'warn'], ['Unread', '7', '']].map(([l, v, k]) => (
          <div key={l} className={'mstat2' + (k ? ' ' + k : '')}><b>{v}</b><i>{l}</i></div>
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
    </Col>
  );
  const secondary = (
    <Col>
      <div className="msec" style={{ paddingTop: cols === 2 ? 22 : 12 }}>Waiting on you <span>3</span></div>
      {MAPPROVALS.slice(0, 3).map(a => (
        <button key={a.id} className="mtask" onClick={() => go('approvals')} style={{ alignItems: 'flex-start' }}>
          <Av n={a.who} s={28} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="mtask__t">{a.t}</span>
            <span className="mtask__m"><span className="mtask__due">{a.who.split(' ')[0]} · {a.kind} · {a.when}</span></span>
          </span>
        </button>
      ))}
      <div className="msec">Activity <span>live</span></div>
      {[['Aanya Mehta', 'approved the July payroll run', '4m', 'check'], ['Rohan Iyer', 'mentioned you in #gst-filing', '18m', 'chat'], ['System', 'INV-2607 is now 12 days overdue', '2h', 'fin'], ['Priya Nair', 'moved 3 cards on Diwali campaign', '3h', 'task']].map(([w, a, t, ic]) => (
        <div key={a} className="mact">
          <span className="mact__ic">{I[ic]}</span>
          <span style={{ minWidth: 0, flex: 1 }}><b>{w}</b> {a}</span>
          <span className="mono mact__t">{t}</span>
        </div>
      ))}
      <div className="msec">Unread <span>7</span></div>
      {MMSGS.filter(m => m.n).map((m, i) => (
        <button key={i} className="mtask" onClick={() => go('msgs')}>
          <span className="mchat__hash" style={{ width: 30, height: 30 }}>{m.dm ? <Av n={m.dm} s={30} /> : SI.hash}</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="mtask__t">{m.dm || m.hi}</span>
            <span className="mtask__m"><span className="mtask__due">{m.last}</span></span>
          </span>
          <span className={'mchat__n' + (m.men ? ' men' : '')}>{m.men ? '@' : ''}{m.n}</span>
        </button>
      ))}
    </Col>
  );
  if (cols === 1) return <div className="mbody">{primary.props.children}{secondary.props.children}</div>;
  return <div className="ttoday">{primary}{secondary}</div>;
}

function TBottom({ screen, go, onAdd, mos }) {
  return (
    <div className={'mnav2 mnav2--' + (mos || 'ios')} style={{ paddingBottom: 10 }}>
      {MTABS.map(([k, l, hi, ic, n]) => k === 'add' ? (
        <span key={k} className="mnav2__b" style={{ position: 'relative' }}>
          <button className="mnav2__pill" onClick={onAdd}>{I.plus}</button>
        </span>
      ) : (
        <button key={k} className={'mnav2__b' + (screen === k ? ' on' : '')} onClick={() => go(k)}>
          {I[ic]}<i>{hi}</i>{n && <span className="mnav2__badge">{n}</span>}
        </button>
      ))}
    </div>
  );
}

// The pane router. It reads the window class and nothing else — no device model,
// no orientation, no user agent. That is what makes Split View survivable.
function TApp({ w, h, d, st, offline, clockedIn, setClockedIn, screen, setScreen, detail, setDetail, onAdd }) {
  const cls = tClass(w), os = d.os;
  const mos = os === 'ipados' ? 'ios' : 'android';   // phone components speak ios/android
  const two = cls === 'expanded' || cls === 'large';
  const go = k => { if (k === 'stub') return; if (T_NAV.includes(k)) { setScreen(k); setDetail(null); } else setDetail(k); };
  const clear = () => setDetail(null);
  const listW = Math.max(280, Math.min(400, Math.round((w - (cls === 'large' ? 280 : (os === 'ipados' ? 72 : 80))) * 0.38)));
  const navW = cls === 'large' ? 280 : (os === 'ipados' ? 72 : 80);
  const contentW = w - navW;
  // A list of cards in one column across 700dp is a phone layout that happens to
  // be wide. Flow them instead.
  const gcols = contentW >= 1040 ? 3 : contentW >= 640 ? 2 : 1;
  const GRIDS = ['tasks', 'msgs', 'approvals', 'more', 'inbox'];
  // Two independent decisions, and tying them to the width class was the bug.
  //
  // List and detail sit SIDE BY SIDE whenever the content region can hold both
  // — 660dp is the floor, because below it the detail is narrower than a phone.
  // That includes portrait: an iPad held upright has 950dp of content and no
  // reason to stack. A task list over a task detail was the wrong answer.
  //
  // Stacking is only for a SUPPORTING pane — content that is not the detail of
  // the row above it — and it only needs height.
  const sbs = contentW >= 660;
  const tall = h > w && h >= 900;
  const stack = tall && !sbs ? false : tall;

  // Immersive by contract: attendance capture never shares the screen with
  // navigation, on any window size. It is the one screen that owns the pane.
  if (screen === 'pahchan') {
    return <div className="tpane tpane--wide" style={{ flex: 1 }}>
      <MPahchan back={() => setScreen('today')} clockedIn={clockedIn} setClockedIn={setClockedIn} offline={offline} />
    </div>;
  }

  // Compact — inside Slide Over, a third-width split, or a 7-inch in a narrow
  // window. The rail is gone and the phone's bottom bar is back, with whatever
  // was open in the detail pane now filling the window. Nothing is lost.
  if (cls === 'compact') {
    const push = detail === 'task' ? <MTaskDetail back={clear} os={mos} offline={offline} state={st} />
      : detail === 'chat' ? <MChat back={clear} /> : null;
    return (
      <>
        <div className="tpanes">
          <div className="tpane tpane--wide">
            {push || (
              screen === 'today' ? <TToday st={st} go={go} clockedIn={clockedIn} setClockedIn={setClockedIn} os={mos} cols={1} />
                : screen === 'tasks' ? <MTasks st={st} go={go} os={mos} />
                : screen === 'msgs' ? <MMessages go={go} />
                : screen === 'approvals' ? <MApprovals back={() => setScreen('today')} />
                : screen === 'board' ? <MBoardDetail back={() => setScreen('tasks')} os={mos} go={go} state={st} />
                : screen === 'inbox' ? <MInbox os={mos} state={st} go={go} />
                : screen === 'settings' ? <MSettings os={mos} back={() => setScreen('more')} />
                : screen === 'time' ? <MTime os={mos} back={() => setScreen('more')} />
                : screen === 'reminders' ? <MReminders os={mos} back={() => setScreen('more')} />
                : MODS[screen] ? <MModule m={screen} back={() => setScreen('more')} os={mos} go={go} />
                : <MMore go={go} />
            )}
          </div>
        </div>
        {!push && <TBottom mos={mos} screen={screen} go={go} onAdd={onAdd} />}
      </>
    );
  }

  const wide = c => <div className={'tpane tpane--wide' + gridCls}>{c}</div>;
  const tool = <div className="tptool"><button onClick={onAdd} title="New">{I.plus}</button></div>;
  // Detail as a pushed view — what medium does instead of splitting. A second
  // pane inside 760dp leaves a 320dp chat, which is worse than no split at all.
  const push = detail === 'task' ? <MTaskDetail back={clear} os={mos} offline={offline} state={st} />
    : detail === 'chat' ? <MChat back={clear} /> : null;
  const gridCls = (!push && GRIDS.includes(screen) && gcols > 1) ? ' tpane--grid' + (gcols > 2 ? ' tpane--g3' : '') : '';
  // Leading pane: a height cap when stacked so it ends at its last card, a fixed
  // width when side by side.
  const lead = pct => stack ? { maxHeight: pct } : { width: listW };
  const leadCls = 'tpane tpane--list' + (stack ? ' tpane--grid' : '');

  let body;
  if (sbs && screen === 'tasks') {
    body = (<>
      <div className="tpane tpane--list" style={{ width: listW }}>
        {os === 'ipados' && tool}
        <MTasks st={st} go={go} os={mos} />
      </div>
      <div className="tpane tpane--detail">
        {/* The pane opens the first task rather than sitting empty. Selecting a
            task has no side effect, so an empty half-screen buys nothing. */}
        <MTaskDetail back={clear} os={mos} offline={offline} state={st} />
      </div>
    </>);
  } else if (sbs && screen === 'msgs') {
    body = (<>
      <div className="tpane tpane--list" style={{ width: listW }}>
        {os === 'ipados' && tool}
        <MMessages go={go} />
      </div>
      <div className="tpane tpane--detail">
        {detail === 'chat' ? <MChat back={clear} /> : <TEmpty kind="chat" />}
      </div>
    </>);
  } else if (sbs && screen === 'inbox') {
    // An inbox is for triage, so the record a notification points at opens
    // beside the list rather than replacing it.
    body = (<>
      <div className="tpane tpane--list" style={{ width: listW }}><MInbox os={mos} state={st} go={go} /></div>
      <div className="tpane tpane--detail"><MTaskDetail back={clear} os={mos} offline={offline} state={st} /></div>
    </>);
  } else if (screen === 'approvals') {
    // No detail pane — an approval card already carries everything needed to
    // decide, and a second pane would be ceremony around a button. What goes
    // underneath instead is what has already been decided.
    body = stack ? (<>
      <div className={leadCls} style={lead('52%')}><MApprovals back={() => setScreen('today')} /></div>
      <div className="tpane tpane--detail"><TDecided /></div>
    </>) : wide(<MApprovals back={() => setScreen('today')} />);
  } else if (!two) {
    body = wide(push || (
      screen === 'today' ? <TToday st={st} go={go} clockedIn={clockedIn} setClockedIn={setClockedIn} os={mos} cols={contentW >= 640 ? 2 : 1} />
        : screen === 'tasks' ? <>{os === 'ipados' && tool}<MTasks st={st} go={go} os={mos} /></>
        : screen === 'msgs' ? <>{os === 'ipados' && tool}<MMessages go={go} /></>
        : screen === 'approvals' ? <MApprovals back={() => setScreen('today')} />
        : screen === 'board' ? <TBoard back={() => setScreen('tasks')} go={go} portrait={h > w} state={st} />
        : screen === 'inbox' ? <MInbox os={mos} state={st} go={go} />
        : screen === 'settings' ? <MSettings os={mos} back={() => setScreen('today')} />
        : screen === 'time' ? <MTime os={mos} back={() => setScreen('today')} />
        : screen === 'reminders' ? <MReminders os={mos} back={() => setScreen('today')} />
        : MODS[screen] ? <MModule m={screen} back={() => setScreen('today')} os={mos} go={go} />
        : <MMore go={go} />
    ));
  } else if (screen === 'tasks') {
    body = wide(<MTasks st={st} go={go} os={mos} />);
  } else if (screen === 'msgs') {
    body = wide(<MMessages go={go} />);
  } else if (screen === 'today') {
    body = wide(<TToday st={st} go={go} clockedIn={clockedIn} setClockedIn={setClockedIn} os={mos} cols={2} />);
  } else if (screen === 'approvals') {
    body = wide(<MApprovals back={() => setScreen('today')} />);
  } else if (screen === 'board') {
    body = <div className="tpane tpane--wide"><TBoard back={() => setScreen('tasks')} go={go} portrait={h > w} state={st} /></div>;
  } else if (screen === 'inbox') {
    body = wide(<MInbox os={mos} state={st} go={go} />);
  } else if (screen === 'settings') {
    body = wide(<MSettings os={mos} back={() => setScreen('today')} />);
  } else if (screen === 'time') {
    body = wide(<MTime os={mos} back={() => setScreen('today')} />);
  } else if (screen === 'reminders') {
    body = wide(<MReminders os={mos} back={() => setScreen('today')} />);
  } else if (MODS[screen]) {
    body = wide(<MModule m={screen} back={() => setScreen('today')} os={mos} go={go} />);
  } else {
    body = wide(<MMore go={go} />);
  }

  return (
    <div className="tpanes">
      {cls === 'large'
        ? <TDrawer os={os} cur={screen} go={go} onAdd={onAdd} clockedIn={clockedIn} offline={offline} />
        : <TRail os={os} cur={screen} go={go} onAdd={onAdd} h={h} offline={offline} />}
      <div className={'tbody' + (stack && screen === 'approvals' ? ' tbody--stack' : '')}>{body}</div>
    </div>
  );
}

// ── Browser surface ─────────────────────────────────────────────────────────
// The responsive web app in a tablet browser. Different target, different rules:
// there is no rail, the sidebar is the web sidebar, and on iPadOS the page is
// very likely being served the desktop layout whether it fits or not.
const TWEB_NAV = TDRAWER.flatMap(([, label, items]) => [label, ...items]);

function TWeb({ cssW, screen, setScreen, st, os, offline, clockedIn, setClockedIn, detail, setDetail }) {
  const [open, setOpen] = React.useState(false);
  const mos = os === 'ipados' ? 'ios' : 'android';
  // Web breakpoints are the three in 15-mobile-web.md, and they are CSS px —
  // which on iPad is very often not the width of the glass.
  const inFlow = cssW >= 1024, phone = cssW <= 767;
  const contentW = inFlow ? cssW - 232 : cssW;
  const gcols = contentW >= 1040 ? 3 : contentW >= 640 ? 2 : 1;
  const twoWeb = contentW >= 640;
  const go = k => { if (k === 'stub') return; if (T_NAV.includes(k)) { setScreen(k); setDetail(null); setOpen(false); } else setDetail(k); };
  const side = (
    <nav className="tweb__side" style={inFlow ? null : { position: 'absolute', inset: '0 auto 0 0', zIndex: 56, boxShadow: 'var(--shadow-4)' }}>
      {TWEB_NAV.map((it, i) => typeof it === 'string' || it === null
        ? (it && <div key={'s' + i} className="tweb__sec">{it}</div>)
        : (
          <button key={it[0]} className={'tweb__b' + (screen === it[0] ? ' on' : '')} onClick={() => go(it[0])}>
            {I[it[3]]}<span>{it[1]}</span><i className="hi">{it[2]}</i>
          </button>
        ))}
    </nav>
  );
  const main = detail === 'task' ? <MTaskDetail back={() => setDetail(null)} os={mos} offline={offline} state={st} />
    : detail === 'chat' ? <MChat back={() => setDetail(null)} />
    : screen === 'tasks' ? <MTasks st={st} go={go} os={mos} />
    : screen === 'msgs' ? <MMessages go={go} />
    : screen === 'approvals' ? <MApprovals back={() => setScreen('today')} />
    : screen === 'today' ? <TToday st={st} go={go} clockedIn={clockedIn} setClockedIn={setClockedIn} os={mos} cols={twoWeb ? 2 : 1} />
    : screen === 'board' ? <MBoardDetail back={() => setScreen('tasks')} os={mos} go={go} state={st} />
    : MODS[screen] ? <MModule m={screen} back={() => setScreen('today')} os={mos} go={go} />
    : <MMore go={go} />;
  return (
    <div className="tweb" style={{ position: 'relative' }}>
      {inFlow && side}
      <div className="tweb__main">
        {!inFlow && (
          <div className="tweb__top">
            <button className="tweb__burger" onClick={() => setOpen(!open)}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 5.5h14M3 10h14M3 14.5h14" /></svg>
            </button>
            <span className="tweb__ttl">Kartavaya</span>
          </div>
        )}
        <div className={'tpane tpane--wide' + (!detail && ['tasks', 'msgs', 'approvals', 'more', 'inbox'].includes(screen) && gcols > 1 ? ' tpane--grid' + (gcols > 2 ? ' tpane--g3' : '') : '')} style={{ flex: 1 }}>{main}</div>
        {phone && <TBottom mos={mos} screen={screen} go={go} onAdd={() => {}} />}
      </div>
      {!inFlow && open && <><span className="tweb__scrim" onClick={() => setOpen(false)} />{side}</>}
    </div>
  );
}

Object.assign(window, { TEmpty, TToday, TBottom, TApp, TWeb, T_NAV });
