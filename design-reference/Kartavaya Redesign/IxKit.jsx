// Interaction catalogue harness. Every entry is one IxCard: a live demo on the
// left, the build spec on the right, and what staging does today underneath.
window.IX_SECTIONS = window.IX_SECTIONS || [];
const IxCtx = React.createContext({ surface: 'mac', mobile: false });
const useIx = () => React.useContext(IxCtx);

// Bump a key to re-mount a demo so a one-shot animation can be watched again.
function useReplay() {
  const [k, setK] = React.useState(0);
  return [k, () => setK(x => x + 1)];
}

function IxRow({ k, v }) {
  if (!v) return null;
  return <div className="ixr"><span className="ixr__k">{k}</span><span className="ixr__v">{v}</span></div>;
}

function IxCard({ n, t, trig, lede, children, spec = {}, today, wide }) {
  return (
    <article className="ixc">
      <header className="ixc__h">
        <span className="ixc__n">{n}</span>
        <h3 className="ixc__t">{t}</h3>
        {trig && <span className="ixc__trig">{trig}</span>}
      </header>
      {lede && <p className="ixc__lede">{lede}</p>}
      <div className={'ixc__b' + (wide ? ' ixc__b--wide' : '')}>
        {children}
        <div className="ixspec">
          <IxRow k="Entry" v={spec.entry} />
          <IxRow k="Active" v={spec.active} />
          <IxRow k="Dismiss" v={spec.dismiss} />
          <IxRow k="Exit" v={spec.exit} />
          <IxRow k="Mobile" v={spec.mobile} />
          <IxRow k="Tokens" v={spec.tokens} />
          <IxRow k="Handler" v={spec.handler} />
          <IxRow k="A11y" v={spec.a11y} />
        </div>
      </div>
      {today && <div className="ixtoday"><b>Today</b><span>{today}</span></div>}
    </article>
  );
}

function IxStage({ children, flush, onReplay, note, h }) {
  return (
    <div className={'ixstage' + (flush ? ' ixstage--flush' : '')} style={h ? { minHeight: h } : undefined}>
      {onReplay && <div className="ixstage__lbl"><button className="ixreplay" onClick={onReplay}>replay</button></div>}
      {children}
      {note && <div className="ixhint">{note}</div>}
    </div>
  );
}

// Wraps a demo in a phone shell when the mobile surface is selected, so one
// demo body serves both without being written twice.
function IxSurface({ children, h }) {
  const { mobile } = useIx();
  if (!mobile) return <div className="ixframe" style={{ minHeight: h || 172 }}>{children}</div>;
  return (
    <div className="ixphone" style={{ height: (h || 172) + 150 }}>
      <span className="ixphone__notch" />
      {children}
    </div>
  );
}

function num(v) { return <span className="ixnum">{v}</span>; }

function IxApp() {
  const [surface, setSurface] = React.useState('mac');
  const [theme, setTheme] = React.useState('light');
  const [slow, setSlow] = React.useState(false);
  const [cur, setCur] = React.useState(window.IX_SECTIONS[0]?.id);
  const mobile = surface === 'mweb' || surface === 'mapp';

  React.useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = theme;
    r.dataset.platform = mobile ? 'mac' : surface;
    r.dataset.slowmo = slow ? '1' : '0';
    r.dataset.surfaceKind = surface;
  }, [surface, theme, slow, mobile]);

  React.useEffect(() => {
    const els = window.IX_SECTIONS.map(s => document.getElementById(s.id)).filter(Boolean);
    const io = new IntersectionObserver(es => {
      const vis = es.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setCur(vis.target.id);
    }, { rootMargin: '-80px 0px -70% 0px' });
    els.forEach(e => io.observe(e));
    return () => io.disconnect();
  }, []);

  const groups = [];
  window.IX_SECTIONS.forEach(s => {
    const g = groups.find(x => x.g === s.group);
    if (g) g.items.push(s); else groups.push({ g: s.group, items: [s] });
  });

  return (
    <IxCtx.Provider value={{ surface, mobile }}>
      <div className="ix">
        <header className="ixbar">
          <span className="ixbar__t">Interaction catalogue<span className="ixbar__hi">क्रिया</span></span>
          <span className="mute" style={{ fontSize: 11.5, marginLeft: 4 }}>{window.IX_SECTIONS.reduce((a, s) => a + (s.count || 0), 0)} interactions</span>
          <span style={{ flex: 1 }} />
          <div className="seg">
            {[['mac', 'macOS'], ['win', 'Windows'], ['mweb', 'Mobile web'], ['mapp', 'Mobile app']].map(([v, l]) => (
              <button key={v} className={'seg__b' + (surface === v ? ' on' : '')} onClick={() => setSurface(v)}>{l}</button>
            ))}
          </div>
          <button className={'chip' + (slow ? ' on' : '')} onClick={() => setSlow(!slow)} title="Scale every duration 4× so you can actually see the curve">
            {slow ? '4× slow motion' : 'Real speed'}
          </button>
          <button className="icobtn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Theme">{theme === 'dark' ? I.moon : I.sun}</button>
        </header>

        <nav className="ixnav">
          {groups.map(({ g, items }) => (
            <div key={g}>
              <div className="ixnav__g">{g}</div>
              {items.map(s => (
                <button key={s.id} className={'ixnav__s' + (cur === s.id ? ' on' : '')}
                  onClick={() => { const el = document.getElementById(s.id); if (el) el.parentElement.parentElement.scrollTo({ top: el.offsetTop - 70, behavior: 'smooth' }); }}>
                  {s.title}<span className="ixnav__n">{s.count}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="ixmain">
          <div className="ixhead">
            <h1>Every interaction, specified</h1>
            <p>
              Each entry below is a working demo, not a description. Click it. Turn on <b>4× slow motion</b> to watch the
              curve, and switch surfaces to see the mobile variant. The spec column is what an engineer implements; the amber
              strip is what the staging branch does today, so the delta is never in doubt.
            </p>
            <p className="mute" style={{ fontSize: 12 }}>
              Read from <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>kevalvshah/Kartavya@staging · frontend/src/components/</code>.
              Durations are tokens, never literals — slow motion works by scaling <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>--dur-*</code> at the root.
            </p>
          </div>
          {window.IX_SECTIONS.map(s => (
            <section key={s.id} id={s.id} className="ixsec">
              <header className="ixsec__h">
                <span className="ixsec__n">{s.n}</span>
                <h2 className="ixsec__t">{s.title}</h2>
                {s.hi && <span className="ixsec__hi">{s.hi}</span>}
                {s.src && <span className="ixsec__src">{s.src}</span>}
              </header>
              <s.Comp />
            </section>
          ))}
        </main>
      </div>
    </IxCtx.Provider>
  );
}

Object.assign(window, { IxCtx, useIx, useReplay, IxCard, IxStage, IxSurface, IxRow, num, IxApp });
