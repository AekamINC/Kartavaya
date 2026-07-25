function KartavayaApp() {
  const load = () => { try { return JSON.parse(localStorage.getItem('kv_appearance') || '{}'); } catch (_) { return {}; } };
  const [st, setSt] = React.useState({ theme: 'light', accent: 'teal', glass: 0.6, radius: 12, density: 'cozy', display: 'serif', platform: 'mac', preset: 'all', surface: 'tenant', ...load() });
  const [view, setView] = React.useState(() => localStorage.getItem('kv_view') || 'dash');
  const [rail, setRail] = React.useState(false);
  const [overlay, setOverlay] = React.useState(null);
  const [drawer, setDrawer] = React.useState(null);
  const [mobNav, setMobNav] = React.useState(false);
  const [sync, setSync] = React.useState('ok');

  const set = (k, v) => setSt(s => ({ ...s, [k]: v }));

  React.useEffect(() => {
    const r = document.documentElement, a = ACCENTS.find(x => x.id === st.accent) || ACCENTS[0];
    r.dataset.theme = st.theme; r.dataset.density = st.density; r.dataset.display = st.display; r.dataset.platform = st.platform; r.dataset.surface = st.surface;
    r.style.setProperty('--glass-mix', st.glass);
    r.style.setProperty('--radius-base', st.radius + 'px');
    r.style.setProperty('--primary-vivid', a.vivid);
    r.style.setProperty('--primary', st.theme === 'dark' ? a.pd : a.p);
    r.style.setProperty('--primary-hover', st.theme === 'dark' ? a.p : a.pd);
    r.style.setProperty('--primary-container', st.theme === 'dark' ? a.pcd : a.pc);
    try { localStorage.setItem('kv_appearance', JSON.stringify(st)); } catch (_) { }
  }, [st]);

  React.useEffect(() => { try { localStorage.setItem('kv_view', view); } catch (_) { } }, [view]);

  const enabled = PRESETS[st.preset] ? [...PRESETS[st.preset], 'roles'] : null;
  React.useEffect(() => { if (enabled && !enabled.includes(view)) setView(enabled[0]); }, [st.preset]);

  // Keyboard layer — Tally-style, invisible until used
  React.useEffect(() => {
    let g = false, t;
    const inField = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    const h = e => {
      if (e.key === 'Escape') { if (overlay) setOverlay(null); else if (drawer) setDrawer(null); else if (document.activeElement?.blur) document.activeElement.blur(); return; }
      if (inField() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') { e.preventDefault(); setOverlay({ kind: 'kbd' }); return; }
      if (g) { g = false; const R = { d: 'dash', c: 'graha', i: 'ganit', h: 'manav', s: 'sanvaad', b: 'boards', t: 'tasks' }; if (R[e.key]) { e.preventDefault(); setView(R[e.key]); } return; }
      if (e.key === 'g') { g = true; clearTimeout(t); t = setTimeout(() => { g = false; }, 800); return; }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setOverlay({ kind: view === 'ganit' ? 'invoice' : 'task' }); }
    };
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); clearTimeout(t); };
  }, [view, overlay, drawer]);

  const open = (kind, data) => {
    if (kind === 'task' && data) { setDrawer(data); return; }
    setOverlay({ kind, data });
    setSync('pending');
    setTimeout(() => setSync('ok'), 2400);
  };
  const kbd = () => setOverlay({ kind: 'kbd' });

  const SCREENS = {
    dash: <ScreenDash open={open} />,
    boards: <ScreenBoards open={open} />,
    tasks: <ScreenTasks open={open} />,
    graha: <ScreenGraha open={open} />,
    vikray: <ScreenVikray open={open} />,
    ganit: <ScreenGanit open={open} kbd={kbd} />,
    manav: <ScreenManav />,
    vetana: <ScreenVetana open={open} />,
    pahchan: <ScreenPahchan open={open} />,
    sanvaad: <ScreenSanvaad />,
    prachar: <ScreenPrachar />,
    srijan: <ScreenSrijan />,
    dristi: <ScreenDristi />,
    hub: <ScreenHub />,
    esign: <ScreenEsign open={open} />,
    approvals: <ScreenApprovals />,
    roles: <ScreenRoles open={open} />,
    platform: <ScreenPlatform open={open} />,
    customize: <CustomizeHub />,
    orgset: <OrgHub />,
    settings: <CustomizeHub />,
  };

  if (view === 'aekam') return <AdminConsole exit={() => setView('dash')} />;

  return (
    <div className="kv">
      <Sidebar view={view} go={setView} rail={rail} setRail={setRail} enabled={enabled} />
      {mobNav && (
        <>
          <div className="scrim" onClick={() => setMobNav(false)} style={{ zIndex: 130 }} />
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 135 }} onClick={e => e.stopPropagation()}>
            <Sidebar view={view} go={v => { setView(v); setMobNav(false); }} rail={false} setRail={() => { }} enabled={enabled} />
          </div>
        </>
      )}
      <div className="kv__main">
        <Toolbar view={view} st={st} set={set} onNew={() => open(view === 'ganit' ? 'invoice' : 'task')} onKbd={kbd} sync={sync} />
        <MobileTop view={view} onMenu={() => setMobNav(true)} st={st} set={set} />
        <main className="kv__content">{st.surface === 'platform' ? SCREENS.platform : (SCREENS[view] || SCREENS.dash)}</main>
        <MobileNav view={view} go={setView} />
        <button className="fab" onClick={() => open(view === 'ganit' ? 'invoice' : 'task')} aria-label="New">{I.plus}</button>
      </div>

      {drawer && <TaskDrawer data={drawer} close={() => setDrawer(null)} />}
      {overlay?.kind === 'invoice' && <InvoiceSheet close={() => setOverlay(null)} />}
      {overlay?.kind === 'invite' && <InviteWizard close={() => setOverlay(null)} />}
      {overlay?.kind === 'approve-support' && <SupportApprove close={() => setOverlay(null)} />}
      {overlay?.kind === 'cell' && <CellEdit data={overlay.data} close={() => setOverlay(null)} />}
      {overlay?.kind === 'roleguide' && <RoleGuide close={() => setOverlay(null)} />}
      {overlay?.kind === 'request-access' && <SupportRequest close={() => setOverlay(null)} />}
      {overlay?.kind === 'member' && <MemberSheet data={overlay.data} close={() => setOverlay(null)} />}
      {overlay?.kind === 'org-detail' && <OrgDetail data={overlay.data} close={() => setOverlay(null)} />}
      {overlay?.kind === 'kbd' && <KbdSheet close={() => setOverlay(null)} />}
      {overlay && !['invoice', 'kbd', 'invite', 'approve-support', 'cell', 'roleguide', 'member', 'org-detail', 'request-access'].includes(overlay.kind) && <GenericSheet kind={overlay.kind} close={() => setOverlay(null)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<KartavayaApp />);
