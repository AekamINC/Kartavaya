// Chrome — sidebar (frosted source list + rail), toolbar, Appearance popover, mobile nav
const I = {
  dash: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.6"/><rect x="11" y="2.5" width="6.5" height="6.5" rx="1.6"/><rect x="2.5" y="11" width="6.5" height="6.5" rx="1.6"/><rect x="11" y="11" width="6.5" height="6.5" rx="1.6"/></svg>,
  board: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2.5" y="3" width="4" height="14" rx="1.4"/><rect x="8" y="3" width="4" height="9.5" rx="1.4"/><rect x="13.5" y="3" width="4" height="12" rx="1.4"/></svg>,
  task: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 5.5l2 2 3.5-3.5M11 5.5h6M3 13l2 2 3.5-3.5M11 13h6"/></svg>,
  crm: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7.5" cy="6.5" r="2.8"/><path d="M2.5 16.5c0-3 2.3-4.8 5-4.8s5 1.8 5 4.8"/><path d="M14 5.5a2.4 2.4 0 010 4.4M15.5 15.8c0-1.9-.9-3.3-2.3-4"/></svg>,
  fin: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 3.5h9l3.5 3.5v9.5a1 1 0 01-1 1H5a1 1 0 01-1-1v-12a1 1 0 011-1z"/><path d="M12.5 3.5V7H16M7 11h6M7 14h4"/></svg>,
  hr: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10" cy="6" r="2.9"/><path d="M4 17c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/></svg>,
  sales: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 15.5L7 9.5l3.5 3L17 4.5"/><path d="M12.5 4.5H17V9"/></svg>,
  pay: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2.5" y="5" width="15" height="10.5" rx="2"/><path d="M2.5 8.5h15M6 12.5h3"/></svg>,
  mkt: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3.5 8v4a1 1 0 001 1h2l4.5 3.5v-13L6.5 7h-2a1 1 0 00-1 1z"/><path d="M14.5 7.5a4 4 0 010 5"/></svg>,
  chat: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 12a2 2 0 01-2 2H7l-4 3V5a2 2 0 012-2h10a2 2 0 012 2v7z"/><path d="M7 7h6M7 10h4"/></svg>,
  ai: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M10 2.5l1.7 4.3 4.3 1.7-4.3 1.7L10 14.5 8.3 10.2 4 8.5l4.3-1.7L10 2.5z"/><path d="M15.5 13.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9z"/></svg>,
  report: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 16.5V9M7.5 16.5v-11M12 16.5v-7M16.5 16.5V4"/></svg>,
  hub: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10" cy="10" r="2.4"/><circle cx="10" cy="3.5" r="1.6"/><circle cx="16.5" cy="13" r="1.6"/><circle cx="3.5" cy="13" r="1.6"/><path d="M10 7.6V5.1M11.9 11.3l3.2 1.1M8.1 11.3l-3.2 1.1"/></svg>,
  sign: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 14.5c2.5 0 3-8 5.5-8s1 6 3 6 1.5-3 3.5-3"/><path d="M3 17.5h14"/></svg>,
  inbox: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 11l2-6.5h11l2 6.5v4.5a1 1 0 01-1 1H3.5a1 1 0 01-1-1V11z"/><path d="M2.5 11h4l1 2h5l1-2h4"/></svg>,
  check: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10" cy="10" r="7.5"/><path d="M6.8 10.2l2.2 2.2 4.2-4.4"/></svg>,
  gear: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1L4.7 4.7"/></svg>,
  bell: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M16 13.5l-2-2.2V8a4 4 0 00-8 0v3.3l-2 2.2h12z"/><path d="M8.2 16.5a2 2 0 003.6 0"/></svg>,
  search: <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="8.6" cy="8.6" r="5.4"/><path d="M12.8 12.8L17 17"/></svg>,
  plus: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M10 4.5v11M4.5 10h11"/></svg>,
  x: <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>,
  chevL: <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 4.5L6.5 10l5.5 5.5"/></svg>,
  chevR: <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M8 4.5L13.5 10 8 15.5"/></svg>,
  sun: <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2v2M10 16v2M18 10h-2M4 10H2M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4M15.7 15.7l-1.4-1.4M5.7 5.7L4.3 4.3"/></svg>,
  moon: <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M16 12.4A6.8 6.8 0 017.6 4a7 7 0 108.4 8.4z"/></svg>,
  send: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 10l14-6-6 14-2-6-6-2z"/></svg>,
  filter: <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 5.5h14M6 10h8M8.5 14.5h3"/></svg>,
  dots: <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="4.5" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="10" cy="15.5" r="1.5"/></svg>,
  doc: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4.5 3h7L16 7.5v9a1 1 0 01-1 1H5.5a1 1 0 01-1-1v-13a1 1 0 011-1z"/><path d="M11 3v4.5h4.5"/></svg>,
  clock: <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10" cy="10" r="7.4"/><path d="M10 5.8V10l2.8 2"/></svg>,
};

// ── Module registry: Hindi-forward, English as subtitle ────────────────
const NAV = [
  { sec: 'Workspace', hi: 'कार्यक्षेत्र', items: [
    { id: 'dash', hi: 'मुख्य', en: 'Dashboard', ic: 'dash' },
    { id: 'boards', hi: 'फलक', en: 'Boards', ic: 'board' },
    { id: 'tasks', hi: 'कर्तव्य', en: 'Tasks', ic: 'task', badge: 12 },
  ]},
  { sec: 'Revenue', hi: 'राजस्व', items: [
    { id: 'graha', hi: 'ग्रह', en: 'CRM', ic: 'crm' },
    { id: 'vikray', hi: 'विक्रय', en: 'Sales', ic: 'sales' },
    { id: 'ganit', hi: 'गणित', en: 'Finance', ic: 'fin', badge: 4 },
  ]},
  { sec: 'People', hi: 'जन', items: [
    { id: 'manav', hi: 'मानव', en: 'HRMS', ic: 'hr' },
    { id: 'vetana', hi: 'वेतन', en: 'Payroll', ic: 'pay' },
    { id: 'pahchan', hi: 'पहचान', en: 'Attendance', ic: 'clock', badge: 3 },
    { id: 'sanvaad', hi: 'संवाद', en: 'Messaging', ic: 'chat', badge: 7 },
  ]},
  { sec: 'Growth', hi: 'वृद्धि', items: [
    { id: 'prachar', hi: 'प्रचार', en: 'Marketing', ic: 'mkt' },
    { id: 'srijan', hi: 'सृजन', en: 'AI Hub', ic: 'ai' },
    { id: 'dristi', hi: 'दृष्टि', en: 'Reports', ic: 'report' },
  ]},
  { sec: 'Settings', hi: 'व्यवस्था', items: [
    { id: 'roles', hi: 'अधिकार', en: 'Roles & access', ic: 'gear', badge: 1 },
    { id: 'customize', hi: 'रूपांकन', en: 'Customization', ic: 'sun' },
    { id: 'orgset', hi: 'संस्था', en: 'Organisation', ic: 'doc' },
    { id: 'aekam', hi: 'ऐकम', en: 'Aekam admin', ic: 'hub' },
  ]},
  { sec: 'Clients', hi: 'ग्राहक', items: [
    { id: 'hub', hi: 'केंद्र', en: 'Client Portal', ic: 'hub' },
    { id: 'esign', hi: 'हस्ताक्षर', en: 'eSign', ic: 'sign' },
    { id: 'approvals', hi: 'सम्मति', en: 'Approvals', ic: 'check', badge: 3 },
  ]},
];

const PRESETS = {
  ca: ['dash', 'tasks', 'ganit', 'graha', 'esign', 'approvals', 'hub'],
  legal: ['dash', 'tasks', 'boards', 'esign', 'approvals', 'hub', 'sanvaad'],
  agency: ['dash', 'boards', 'tasks', 'graha', 'prachar', 'srijan', 'sanvaad', 'hub'],
  trading: ['dash', 'ganit', 'vikray', 'graha', 'manav', 'pahchan', 'vetana', 'dristi'],
  consult: ['dash', 'tasks', 'graha', 'vikray', 'ganit', 'sanvaad', 'dristi', 'hub'],
  all: null,
};

const META = {};
NAV.forEach(g => g.items.forEach(it => { META[it.id] = { ...it, sec: g.sec }; }));
META.settings = { hi: 'व्यवस्था', en: 'Settings', ic: 'gear' };

function Mark({ size = 34 }) {
  return (
    <img className="mark" src="kartavaya-mark.png" width={size} height={size} alt="Kartavaya"
      style={{ width: size, height: size, objectFit: 'cover' }} />
  );
}

function Sidebar({ view, go, rail, setRail, enabled }) {
  const groups = NAV.map(g => ({ ...g, items: g.items.filter(it => !enabled || enabled.includes(it.id)) })).filter(g => g.items.length);
  return (
    <aside className={'side' + (rail ? ' side--rail' : '')}>
      <div className="side__brand">
        <Mark />
        {!rail && (
          <div className="wm">
            <div className="wm__main">Kartavaya</div>
            <div className="wm__hi">कर्तव्य</div>
            <div className="wm__sub">Aekam Inc</div>
          </div>
        )}
      </div>
      <nav className="side__nav">
        {groups.map(g => (
          <div key={g.sec}>
            <div className="side__sec"><span>{g.sec}</span><span className="side__sec-hi">{g.hi}</span></div>
            {g.items.map(it => (
              <button key={it.id} className={'side__item' + (view === it.id ? ' on' : '')} onClick={() => go(it.id)} title={rail ? `${it.hi} · ${it.en}` : undefined}>
                <span className="side__ic">{I[it.ic]}</span>
                {!rail && (
                  <span className="side__label">
                    <span className="side__en">{it.en}</span>
                    <span className="side__hi">{it.hi}</span>
                  </span>
                )}
                {!rail && it.badge && <span className="side__badge">{it.badge}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <button className="side__toggle" onClick={() => setRail(!rail)} title={rail ? 'Expand' : 'Collapse'}>
        {rail ? I.chevR : <>{I.chevL} Collapse</>}
      </button>
      <div className="side__foot">
        <span className="av" style={{ width: 30, height: 30, fontSize: 11, background: 'linear-gradient(140deg,#05b7aa,#0082c6)' }}>KS</span>
        {!rail && (
          <>
            <div className="side__me">
              <div className="side__me-n">Keval Shah</div>
              <div className="side__me-r">Owner · Aekam Inc</div>
            </div>
            <button className="icobtn" onClick={() => go('settings')} title="Settings">{I.gear}</button>
          </>
        )}
      </div>
    </aside>
  );
}

// ── Appearance popover — the per-user customisation the brief asks for ──
const ACCENTS = [
  { id: 'teal', label: 'Teal', vivid: '#05b7aa', p: '#04837A', pd: '#4FD8CB', pc: '#B4F1E8', pcd: '#00514B' },
  { id: 'olive', label: 'Olive', vivid: '#6c8c3f', p: '#4E6B28', pd: '#AFD07A', pc: '#D8ECB6', pcd: '#354A18' },
  { id: 'clay', label: 'Clay', vivid: '#c2703c', p: '#9A5324', pd: '#F0B183', pc: '#FBDDC4', pcd: '#6B3512' },
  { id: 'indigo', label: 'Indigo', vivid: '#5b6ee0', p: '#3F4FB8', pd: '#AEB8F5', pc: '#DDE1FB', pcd: '#2A3690' },
];

function AppearancePop({ st, set, onClose }) {
  const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 };
  const lbl = { fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--on-surface-3)' };
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 110 }} onClick={onClose} />
      <div className="pop" style={{ top: 52, right: 'var(--pad-page)', width: 306 }}>
        <div className="pop__head" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Appearance</span><span className="hi" style={{ letterSpacing: 0, textTransform: 'none', fontSize: 12 }}>रूप</span>
        </div>
        <div className="pop__body">
          <div style={row}>
            <span style={lbl}>Theme</span>
            <div className="seg">
              <button className={'seg__b' + (st.theme === 'light' ? ' on' : '')} onClick={() => set('theme', 'light')} style={{ padding: '5px 9px' }}>{I.sun}</button>
              <button className={'seg__b' + (st.theme === 'dark' ? ' on' : '')} onClick={() => set('theme', 'dark')} style={{ padding: '5px 9px' }}>{I.moon}</button>
            </div>
          </div>
          <div>
            <div style={{ ...lbl, marginBottom: 8 }}>Accent</div>
            <div className="swatches">
              {ACCENTS.map(a => (
                <button key={a.id} className={'swatch' + (st.accent === a.id ? ' on' : '')} onClick={() => set('accent', a.id)} style={{ background: a.vivid }} title={a.label} />
              ))}
            </div>
          </div>
          <div>
            <div style={{ ...row, marginBottom: 7 }}>
              <span style={lbl}>Translucency</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>{Math.round(st.glass * 100)}%</span>
            </div>
            <input className="sld" type="range" min="0" max="1" step="0.1" value={st.glass} onChange={e => set('glass', parseFloat(e.target.value))} />
            <div style={{ fontSize: 10.5, color: 'var(--on-surface-faint)', marginTop: 5 }}>0% = solid tonal surfaces · 100% = full vibrancy</div>
          </div>
          <div>
            <div style={{ ...row, marginBottom: 7 }}>
              <span style={lbl}>Corner radius</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>{st.radius}px</span>
            </div>
            <input className="sld" type="range" min="8" max="28" step="2" value={st.radius} onChange={e => set('radius', parseInt(e.target.value))} />
          </div>
          <div>
            <div style={{ ...lbl, marginBottom: 7 }}>Density</div>
            <div className="seg" style={{ width: '100%' }}>
              {['compact', 'cozy', 'comfy'].map(d => (
                <button key={d} className={'seg__b' + (st.density === d ? ' on' : '')} onClick={() => set('density', d)} style={{ flex: 1, justifyContent: 'center', textTransform: 'capitalize' }}>{d}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ ...lbl, marginBottom: 7 }}>Headings</div>
            <div className="seg" style={{ width: '100%' }}>
              {[['serif', 'Serif'], ['hybrid', 'Hybrid'], ['sans', 'Sans']].map(([v, l]) => (
                <button key={v} className={'seg__b' + (st.display === v ? ' on' : '')} onClick={() => set('display', v)} style={{ flex: 1, justifyContent: 'center' }}>{l}</button>
              ))}
            </div>
          </div>
          <div style={row}>
            <span style={lbl}>Platform</span>
            <div className="seg">
              {[['mac', 'Mac'], ['win', 'Windows']].map(([v, l]) => (
                <button key={v} className={'seg__b' + (st.platform === v ? ' on' : '')} onClick={() => set('platform', v)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="divider" />
          <div>
            <div style={{ ...lbl, marginBottom: 7 }}>Industry preset</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[['ca', 'CA firm'], ['legal', 'Legal'], ['agency', 'Agency'], ['trading', 'Trading'], ['consult', 'Consultancy'], ['all', 'Everything']].map(([v, l]) => (
                <button key={v} className={'chip' + (st.preset === v ? ' on' : '')} style={{ justifyContent: 'center', fontSize: 12 }} onClick={() => set('preset', v)}>{l}</button>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--on-surface-faint)', marginTop: 7, lineHeight: 1.45 }}>Only the modules a preset needs appear in the sidebar. An all-in-one should feel like a focused tool.</div>
          </div>
        </div>
      </div>
    </>
  );
}

// Sync chip — never lie about state (research rule 14)
function SyncChip({ state }) {
  const MAP = {
    ok: ['Synced', 'var(--ok)', '2m ago'],
    pending: ['3 changes pending', 'var(--warn)', 'syncing'],
    offline: ['Offline — saved locally', 'var(--on-surface-3)', 'will sync'],
  };
  const [lbl, c, sub] = MAP[state] || MAP.ok;
  return (
    <span className="rowflex" style={{ gap: 7, padding: '5px 11px', borderRadius: 'var(--r-pill)', background: 'var(--s-container)', fontSize: 11.5, flexShrink: 0 }} title={'Backup ' + sub}>
      <span style={{ width: 7, height: 7, borderRadius: 9, background: c, flexShrink: 0 }} />
      <span style={{ color: 'var(--on-surface-2)', fontWeight: 500 }}>{lbl}</span>
    </span>
  );
}

function Toolbar({ view, st, set, onNew, onKbd, sync }) {
  const [pop, setPop] = React.useState(false);
  const m = META[view] || { hi: 'कर्तव्य', en: 'Kartavaya' };
  return (
    <header className="bar">
      <div className="bar__crumb">
        <button className={'chip' + (st.surface === 'platform' ? ' on' : '')} style={{ padding: '4px 10px', fontSize: 12 }}
          title={st.surface === 'platform' ? 'Aekam platform console — cross-org' : 'Active organisation'}
          onClick={() => set('surface', st.surface === 'platform' ? 'tenant' : 'platform')}>
          {I.hub} {st.surface === 'platform' ? 'Aekam platform' : 'Aekam Inc'}
        </button>
        <span className="bar__crumb-sep">/</span>
        <span className="bar__crumb-hi">{m.hi}</span>
        <span className="bar__crumb-cur">{m.en}</span>
      </div>
      <div className="bar__spacer" />
      <label className="search">
        {I.search}
        <input placeholder="Search — or scope with in: ग्रह" />
        <kbd className="kbd">⌘K</kbd>
      </label>
      <div className="bar__spacer" />
      <SyncChip state={sync} />
      <button className="icobtn" title="Keyboard shortcuts" onClick={onKbd}><kbd className="kbd" style={{ background: 'none', padding: 0 }}>?</kbd></button>
      <button className="icobtn" title="Notifications">{I.bell}<span className="icobtn__dot" /></button>
      <button className={'icobtn' + (pop ? ' on' : '')} onClick={() => setPop(!pop)} title="Appearance">{st.theme === 'dark' ? I.moon : I.sun}</button>
      <button className="btn btn--fill btn--sm" onClick={onNew}>{I.plus} New</button>
      {pop && <AppearancePop st={st} set={set} onClose={() => setPop(false)} />}
    </header>
  );
}

function MobileTop({ view, onMenu, st, set }) {
  const [pop, setPop] = React.useState(false);
  const m = META[view] || { hi: 'कर्तव्य', en: 'Kartavaya' };
  return (
    <div className="mtopbar">
      <button className="icobtn" onClick={onMenu}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 5.5h14M3 10h14M3 14.5h14" /></svg>
      </button>
      <div style={{ minWidth: 0 }}>
        <div className="hi" style={{ fontSize: 15, lineHeight: 1.1, color: 'var(--primary)' }}>{m.hi}</div>
        <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--on-surface-3)', fontWeight: 600 }}>{m.en}</div>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
        <button className="icobtn" onClick={() => setPop(!pop)}>{st.theme === 'dark' ? I.moon : I.sun}</button>
        <button className="icobtn">{I.bell}<span className="icobtn__dot" /></button>
      </div>
      {pop && <AppearancePop st={st} set={set} onClose={() => setPop(false)} />}
    </div>
  );
}

const MOB_NAV = [
  { id: 'dash', hi: 'मुख्य', en: 'Home', ic: 'dash' },
  { id: 'tasks', hi: 'कर्तव्य', en: 'Tasks', ic: 'task' },
  { id: 'graha', hi: 'ग्रह', en: 'CRM', ic: 'crm' },
  { id: 'sanvaad', hi: 'संवाद', en: 'Chat', ic: 'chat' },
  { id: 'ganit', hi: 'गणित', en: 'Money', ic: 'fin' },
];

function MobileNav({ view, go }) {
  return (
    <nav className="mnav">
      {MOB_NAV.map(it => (
        <button key={it.id} className={'mnav__b' + (view === it.id ? ' on' : '')} onClick={() => go(it.id)}>
          <span className="mnav__ic">{I[it.ic]}</span>
          <span className="mnav__hi">{it.hi}</span>
        </button>
      ))}
    </nav>
  );
}

Object.assign(window, { I, NAV, META, ACCENTS, PRESETS, Mark, Sidebar, Toolbar, MobileTop, MobileNav, AppearancePop, SyncChip });
