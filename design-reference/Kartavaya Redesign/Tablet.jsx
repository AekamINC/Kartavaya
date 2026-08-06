// Tablet — the frame, the navigation and the window-size rules.
// The screens themselves are the phone screens from Mobile.jsx, unchanged. That
// is the whole point: a tablet layout is a pane arrangement, not a second app.

// Widths are points (iPadOS) / density-independent pixels (Android) — the units
// the layout actually reasons in. Physical pixels never appear in a breakpoint.
const TDEV = {
  a7:    { n: '7-inch Android',  sub: 'Galaxy Tab A9 class', os: 'android', w: 600,  h: 960,  r: 16, ua: 'mobile' },
  a11:   { n: '11-inch Android', sub: 'Pixel Tablet',        os: 'android', w: 800,  h: 1280, r: 20, ua: 'mobile' },
  a13:   { n: '13-inch Android', sub: 'Tab S9 Ultra class',  os: 'android', w: 960,  h: 1540, r: 22, ua: 'mobile' },
  mini:  { n: 'iPad mini',       sub: '8.3-inch · A17 Pro',  os: 'ipados',  w: 744,  h: 1133, r: 20, ua: 'desktop' },
  air11: { n: 'iPad Air 11"',    sub: 'M3',                  os: 'ipados',  w: 820,  h: 1180, r: 20, ua: 'desktop' },
  pro13: { n: 'iPad Pro 13"',    sub: 'M4',                  os: 'ipados',  w: 1032, h: 1376, r: 24, ua: 'desktop' },
};

// Four classes, matching Material's window size classes and the points at which
// iPadOS itself changes behaviour. Everything downstream reads the class, never
// the device: on a 13-inch iPad in Slide Over this app is 320pt and compact.
const tClass = w => w < 600 ? 'compact' : w < 840 ? 'medium' : w < 1200 ? 'expanded' : 'large';

// The rail's six destinations are a phone tab bar's six, and a rail 1000pt tall
// has room for every one of them. It fills to fit: as many as the height holds,
// grouped, with the remainder behind More — and on a tall tablet held upright
// there is no remainder, so More does not appear at all.
const TRAIL = [
  ['today', 'Today', 'dash', 0, 'a'],
  ['tasks', 'Tasks', 'task', 12, 'a'],
  ['msgs', 'Messages', 'chat', 7, 'a'],
  ['approvals', 'Approvals', 'check', 3, 'a'],
  ['inbox', 'Alerts', 'bell', 12, 'a'],
  ['pahchan', 'Clock', 'clock', 0, 'b'],
  ['time', 'Time', 'clock', 0, 'b'],
  ['crm', 'CRM', 'crm', 0, 'c'],
  ['fin', 'Finance', 'fin', 0, 'c'],
  ['hr', 'HRMS', 'hr', 2, 'c'],
  ['pay', 'Payslips', 'pay', 0, 'c'],
  ['rep', 'Reports', 'report', 0, 'c'],
  ['ai', 'Assistant', 'ai', 0, 'c'],
  ['sign', 'eSign', 'sign', 1, 'c'],
  ['settings', 'Settings', 'hub', 0, 'd'],
];

// At ≥1200 the rail becomes this, and More is deleted rather than expanded —
// the twelve modules it hid on a phone are all directly reachable here.
const TDRAWER = [
  ['work', null, [
    ['today', 'Today', 'आज', 'dash', 0],
    ['tasks', 'Tasks', 'कर्तव्य', 'task', 12],
    ['msgs', 'Messages', 'संवाद', 'chat', 7],
    ['approvals', 'Approvals', 'सम्मति', 'check', 3],
    ['inbox', 'Notifications', 'सूचना', 'bell', 12],
  ]],
  ['att', 'Attendance', [
    ['pahchan', 'Clock in', 'पहचान', 'clock', 0],
    ['time', 'Time', 'समय', 'clock', 0],
  ]],
  ['mods', 'Modules', [
    ['crm', 'CRM', 'ग्रह', 'crm', 0],
    ['fin', 'Finance', 'गणित', 'fin', 0],
    ['hr', 'HRMS', 'मानव', 'hr', 2],
    ['pay', 'Payslips', 'वेतन', 'pay', 0],
    ['rep', 'Reports', 'दृष्टि', 'report', 0],
    ['ai', 'Assistant', 'सहायक', 'ai', 0],
    ['sign', 'eSign', 'हस्ताक्षर', 'sign', 1],
  ]],
  ['sys', null, [
    ['settings', 'Settings', 'व्यवस्था', 'hub', 0],
  ]],
];

function TStatus({ d }) {
  return (
    <div className="tstat">
      <span className="mono">9:41</span>
      <span className="tstat__r">
        <svg width="15" height="11" viewBox="0 0 16 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="4.5" y="5.5" width="3" height="6.5" rx="1" /><rect x="9" y="3" width="3" height="9" rx="1" /><rect x="13.5" y="0" width="2.5" height="12" rx="1" opacity=".35" /></svg>
        <svg width="14" height="11" viewBox="0 0 15 12" fill="currentColor"><path d="M7.5 11.2l-7-7A9.9 9.9 0 017.5 1.4a9.9 9.9 0 017 2.8l-7 7z" /></svg>
        <span className="mono" style={{ fontSize: 11, opacity: .7 }}>{d.os === 'ipados' ? '84%' : '76%'}</span>
        <svg width="22" height="11" viewBox="0 0 24 12" fill="none"><rect x=".6" y=".6" width="19" height="10.8" rx="3" stroke="currentColor" strokeOpacity=".4" /><rect x="2" y="2" width="14" height="8" rx="2" fill="currentColor" /><path d="M21 4v4a2 2 0 000-4z" fill="currentColor" fillOpacity=".4" /></svg>
      </span>
    </div>
  );
}

function TRail({ os, cur, go, onAdd, h, offline }) {
  const ITEM = 63, FAB = os === 'android' ? 68 : 0, FOOT = 78, RULES = 30;
  const slots = Math.max(3, Math.floor((h - 64 - FAB - FOOT - RULES) / ITEM));
  const overflow = slots < TRAIL.length;
  const shown = overflow ? TRAIL.slice(0, slots - 1) : TRAIL;
  return (
    <nav className={'trail trail--' + os}>
      {os === 'android' && <button className="trail__fab" onClick={onAdd} title="New task">{I.plus}</button>}
      {shown.map(([k, l, ic, n, g], i) => (
        <React.Fragment key={k}>
          {i > 0 && g !== shown[i - 1][4] && <span className="trail__rule" />}
          <button className={'trail__b' + (cur === k ? ' on' : '')} onClick={() => go(k)}>
            <span className="trail__ic">{I[ic]}{n > 0 && <span className="trail__n">{n}</span>}</span>
            <i>{l}</i>
          </button>
        </React.Fragment>
      ))}
      {overflow && (
        <button className={'trail__b' + (cur === 'more' ? ' on' : '')} onClick={() => go('more')}>
          <span className="trail__ic">{I.dots}</span><i>More</i>
        </button>
      )}
      <div className="trail__foot">
        <span className="trail__sync"><span className={'tdrawer__dot' + (offline ? ' warn' : '')} />{offline ? 'Queued' : 'Synced'}</span>
        <button className="trail__me" title="Keval Shah · Aekam Inc"><Av n="Keval Shah" s={30} /></button>
      </div>
    </nav>
  );
}

function TDrawer({ os, cur, go, onAdd, clockedIn, offline }) {
  return (
    <nav className={'tdrawer tdrawer--' + os}>
      <div className="tdrawer__hd">
        <Av n="Keval Shah" s={34} />
        <span style={{ minWidth: 0 }}><b>Aekam Inc</b><i>Keval Shah · Owner</i></span>
      </div>
      <button className="tdrawer__new" onClick={onAdd}>{I.plus} New task</button>
      {TDRAWER.map(([g, label, items]) => (
        <React.Fragment key={g}>
          {label && <div className="tdrawer__sec">{label}</div>}
          {items.map(([k, l, hi, ic, n]) => (
            <button key={k} className={'tdrawer__b' + (cur === k ? ' on' : '')} onClick={() => go(k)}>
              {I[ic]}<span>{l}</span><i className="hi" style={{ fontStyle: 'normal', opacity: .5, fontSize: 12 }}>{hi}</i>
              {n > 0 && <span className="tdrawer__n">{n}</span>}
            </button>
          ))}
        </React.Fragment>
      ))}
      <div className="tdrawer__foot">
        <button className={'tdrawer__clock' + (clockedIn ? ' in' : '')} onClick={() => go('pahchan')}>
          {clockedIn ? <span className="mpulse" /> : I.clock}
          <span style={{ minWidth: 0, flex: 1 }}>
            {clockedIn
              ? <><b className="mono">4h 18m</b><i>Clocked in 09:02 · inside geo-fence</i></>
              : <><b>Clock in</b><i>पहचान · not clocked in today</i></>}
          </span>
        </button>
        <span className="tdrawer__sync">
          <span className={'tdrawer__dot' + (offline ? ' warn' : '')} />
          {offline ? '3 changes queued · oldest 12 min' : 'All changes saved · 09:41'}
        </span>
      </div>
    </nav>
  );
}

function TOther({ label }) {
  return (
    <div className="tother">
      <span className="tother__l">{label}</span>
      {[92, 74, 100, 86, 64, 96, 70].map((w, i) => <span key={i} className="tother__b" style={{ width: w + '%', opacity: 1 - i * .09 }} />)}
    </div>
  );
}

// The frame. Bezel, camera, status bar, home indicator — and the split, because
// a tablet app is a pane in someone else's layout as often as it owns the screen.
function TFrame({ d, land, split, children }) {
  const dw = land ? d.h : d.w, dh = land ? d.w : d.h;
  const bez = d.os === 'ipados' ? 13 : 11;
  // Slide Over is exactly 320pt on every iPad; Android's third-pane is proportional.
  const appW = split === 'full' ? dw
    : split === 'half' ? Math.floor((dw - 6) / 2)
    : d.os === 'ipados' ? 320 : Math.round(dw * .36);
  return (
    <div className={'ttab ttab--' + d.os} style={{ borderRadius: d.r + bez, padding: bez }}>
      <span className="ttab__cam" />
      <div className="tscreen" style={{ width: dw, height: dh, borderRadius: d.r }}>
        <TStatus d={d} />
        {split === 'full' ? (
          <div className="tapp" style={{ flex: 1, minHeight: 0 }}>{children(appW)}</div>
        ) : (
          <div className="tsplit">
            <TOther label={d.os === 'ipados' ? 'Split View · Safari' : 'Split screen · Chrome'} />
            <span className="tsplit__div" />
            <div className="tapp" style={{ width: appW, flexShrink: 0 }}>{children(appW)}</div>
          </div>
        )}
        <span className="thome" />
      </div>
    </div>
  );
}

Object.assign(window, { TDEV, tClass, TRAIL, TDRAWER, TStatus, TRail, TDrawer, TOther, TFrame });
