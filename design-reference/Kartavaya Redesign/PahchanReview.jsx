// Pahchan — the register. Human comparison is the only verification in v1,
// so this surface has one job: make a whole day scannable in seconds.
const { useState: useS, useEffect: useE, useRef: useR } = React;

function PhRegister() {
  const [sel, setSel] = useS(null);
  const [only, setOnly] = useS(false);
  const [verdict, setVerdict] = useS({});
  const [cursor, setCursor] = useS(0);
  const [state, setState] = useS('ready');
  // The cursor needs a synchronous source of truth. React batches keypresses,
  // so a handler closing over `cursor` reads the same stale value for every
  // press in a burst — five fast confirms advanced five rows but wrote the
  // same id five times, silently skipping four people. A ref mutates now.
  const curRef = useR(0);
  const seek = n => { curRef.current = Math.max(0, Math.min(n, rows.length - 1)); setCursor(curRef.current); };
  const mapEl = useR(null), mapObj = useR(null);

  const rows = PH_PUNCHES.map(p => {
    const e = PH_TEAM.find(t => t.id === p.emp);
    const flags = [...p.flags, ...(p.src === 'offline' ? ['off'] : [])];
    return { ...p, e, flags };
  }).filter(r => !only || r.flags.length);

  const cur = rows[cursor];

  // Keyboard is what makes "ten seconds" true. Mouse-only means one row at a
  // time no matter how dense the layout is.
  useE(() => {
    // Not bound at all unless rows are on screen. A reviewer mid-burst will
    // press Enter again while a fetch is in flight; without this, that records
    // a verdict against a row nobody can see.
    const host = rvRef.current;
    if (!host || state !== 'ready' || !rows.length) return;
    const record = val => {
      const row = rows[curRef.current];
      if (!row) return;
      setVerdict(v => ({ ...v, [row.id]: val }));
      seek(curRef.current + 1);
    };
    const onKey = ev => {
      // instanceof Element first: a synthetic event dispatched on window or
      // document has a target with no .matches, and the throw killed the
      // handler silently — which is how this read as "not bound at all".
      if (ev.target instanceof Element && ev.target.matches('input,textarea,select')) return;
      const k = ev.key.toLowerCase();
      if (k === 'j' || ev.key === 'ArrowDown') { ev.preventDefault(); seek(curRef.current + 1); }
      else if (k === 'k' || ev.key === 'ArrowUp') { ev.preventDefault(); seek(curRef.current - 1); }
      else if (ev.key === 'Enter') { ev.preventDefault(); record('ok'); }
      else if (k === 'f') { ev.preventDefault(); record('no'); }
      else if (k === 'o') { ev.preventDefault(); const row = rows[curRef.current]; if (row) setSel(s => s === row.id ? null : row.id); }
    };
    host.addEventListener('keydown', onKey);
    return () => host.removeEventListener('keydown', onKey);
  }, [rows.length, state]);

  // Real geometry, not a drawn rectangle — the pin has to be trustworthy.
  useE(() => {
    if (!sel || !mapEl.current || !window.L) return;
    const r = rows.find(x => x.id === sel);
    if (!r) return;
    if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; }
    const m = L.map(mapEl.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false })
      .setView([r.lat, r.lng], r.dist > 1000 ? 13 : 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(m);
    L.circle([PH_GEO.lat, PH_GEO.lng], { radius: PH_GEO.radius, color: '#04837A', weight: 1.4, fillColor: '#04837A', fillOpacity: .1 }).addTo(m);
    // Accuracy is a radius, not a dot. Drawing it as a dot is the lie that
    // makes a ±184m fix look like proof of presence.
    L.circle([r.lat, r.lng], { radius: r.acc, color: r.dist > PH_GEO.radius ? '#B42318' : '#04837A', weight: 1, fillColor: r.dist > PH_GEO.radius ? '#B42318' : '#04837A', fillOpacity: .22 }).addTo(m);
    L.circleMarker([r.lat, r.lng], { radius: 5, color: '#fff', weight: 2, fillColor: r.dist > PH_GEO.radius ? '#B42318' : '#04837A', fillOpacity: 1 }).addTo(m);
    if (r.dist > 1000) m.fitBounds(L.latLngBounds([[r.lat, r.lng], [PH_GEO.lat, PH_GEO.lng]]).pad(.28));
    setTimeout(() => m.invalidateSize(), 60);
    mapObj.current = m;
    return () => { if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; } };
  }, [sel]);

  const rvRef = useR(null);
  const [kb, setKb] = useS(false);
  const done = Object.keys(verdict).length;
  const flagged = rows.filter(r => r.flags.length).length;

  // The header labels the table, so it is present whenever a table is —
  // including while it is still arriving. Gating it on state === 'ready'
  // made 31px of static chrome mount when the data landed, shifting every
  // row down by its full height. Derived once so the two cannot diverge.
  const hasTable = state === 'loading' || (state === 'ready' && rows.length > 0);

  return (
    <div className="rv" ref={rvRef} tabIndex={0}
      onFocus={() => setKb(true)} onBlur={() => setKb(false)}>
      <div className="rv__bar">
        <b style={{ fontSize: 13 }}>Friday, 26 July 2026</b>
        <span className="ph-seg">
          <button className={'ph-seg__b' + (!only ? ' on' : '')} onClick={() => { setOnly(false); seek(0); }}>All {PH_PUNCHES.length}</button>
          <button className={'ph-seg__b' + (only ? ' on' : '')} onClick={() => { setOnly(true); seek(0); }}>Needs a look {flagged}</button>
        </span>
        <span className={'rv__keys' + (kb ? ' on' : '')}>
          <kbd>J</kbd><kbd>K</kbd> move · <kbd>↵</kbd> confirm · <kbd>F</kbd> flag · <kbd>O</kbd> open
        </span>
        <span className="rv__c">{done} of {rows.length} reviewed</span>
        <span className="rv__demo">
          <i>state</i>
          {['ready', 'loading', 'empty', 'error'].map(s =>
            <button key={s} className={'rv__demo-b' + (state === s ? ' on' : '')} onClick={() => setState(s)}>{s}</button>)}
        </span>
      </div>

      {hasTable && <div className="rv__hd">
        <span />
        <span>Person</span>
        <span>Punch · reference pair</span>
        <span>Time</span>
        <span>Where</span>
        <span style={{ textAlign: 'right' }}>Verdict</span>
      </div>}

      {state === 'loading' && <div className="rv__sk" role="status" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading the register…</span>
        {Array.from({ length: 6 }, (_, i) =>
          <div className="rv__skr" key={i}>
            <span className="rv__n"><span className="skb" style={{ width: 14, marginLeft: 'auto' }} /></span>
            <span className="rv__who rv__skst"><span className="skb" style={{ width: '46%', height: 12 }} /><span className="skb" style={{ width: '30%', height: 9 }} /></span>
            <span className="rv__trip"><span className="skb skb--ph" /><span className="skb skb--ph" /><span className="skb skb--ph" /></span>
            <span className="rv__t rv__skst"><span className="skb" style={{ width: 62, height: 12 }} /><span className="skb" style={{ width: 44, height: 9 }} /></span>
            <span className="rv__loc"><span className="skb" style={{ width: '74%' }} /></span>
            <span className="rv__v"><span className="skb" style={{ width: 64, height: 22, borderRadius: 11, marginLeft: 'auto' }} /></span>
          </div>)}
      </div>}

      {state === 'error' && <div className="rv__state rv__state--err">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 8v5M12 16.5v.5"/><path d="M10.3 3.9 2.4 17.3A1.9 1.9 0 0 0 4 20.2h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z"/></svg>
        <b>The register did not load</b>
        <p>Punches are safe — this is a read failure, not a data loss. Nothing was written and nothing was lost.</p>
        <div className="rv__state-act">
          <button className="btn btn--fill" onClick={() => setState('ready')}>Try again</button>
          <button className="btn btn--ghost" style={{ fontSize: 12 }}>Work offline</button>
        </div>
      </div>}

      {state === 'empty' && !only && <div className="rv__state">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/></svg>
        <b>Nobody has clocked in yet</b>
        <p>The register fills as the team punches in. On a normal weekday the first entries land between 9:00 and 9:40.</p>
        <div className="rv__state-act">
          <button className="btn btn--ghost" style={{ fontSize: 12 }}>View yesterday</button>
        </div>
      </div>}

      {state === 'empty' && only && <div className="rv__state rv__state--ok">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m4.5 12.5 5 5 10-11"/></svg>
        <b>Nothing needs a look</b>
        <p>Every punch today cleared the checks. This is a finished queue, not an empty one — there is nothing waiting on you.</p>
        <div className="rv__state-act">
          <button className="btn btn--ghost" style={{ fontSize: 12 }} onClick={() => { setOnly(false); setState('ready'); }}>Show all {PH_PUNCHES.length}</button>
        </div>
      </div>}

      {state === 'ready' && rows.length === 0 && <div className="rv__state rv__state--ok">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m4.5 12.5 5 5 10-11"/></svg>
        <b>Nothing needs a look</b>
        <p>Every punch today cleared the checks. This is a finished queue, not an empty one.</p>
        <div className="rv__state-act">
          <button className="btn btn--ghost" style={{ fontSize: 12 }} onClick={() => setOnly(false)}>Show all {PH_PUNCHES.length}</button>
        </div>
      </div>}

      {state === 'ready' && rows.map((r, i) => <React.Fragment key={r.id}>
        <div className={'rv__r' + (i === cursor ? ' on' : '')} onClick={() => { seek(i); setSel(sel === r.id ? null : r.id); }}>
          <span className="rv__n">{i + 1}</span>
          <span className="rv__who">
            <b>{r.e.n}</b>
            <i>{r.e.r}</i>
            {r.flags.map(f => <span key={f} className={'rv__flag ' + PH_FLAG[f][1]} style={{ marginLeft: 5 }}>{PH_FLAG[f][0]}</span>)}
          </span>
          <span className="rv__trip">
            <span className="rv__f" title="Punch selfie" />
            <span className="rv__vs">vs</span>
            {r.e.refs > 0 ? <span className="rv__f rv__f--ref" title="Reference — straight on" /> : <span className="rv__f rv__f--none" title="No reference" />}
            {r.e.refs > 1 ? <span className="rv__f rv__f--ref rv__f--ang" title="Reference — three-quarter" /> : <span className="rv__f rv__f--none" title="No second reference" />}
          </span>
          <span className="rv__t">{r.t}<i>{r.dir === 'in' ? 'clock in' : 'clock out'}</i></span>
          <span className="rv__loc">{PH_ICON.gps}{r.dist > PH_GEO.radius ? (r.note || `${(r.dist / 1000).toFixed(1)} km away`) : 'On site'}</span>
          <span className="rv__v" onClick={e => e.stopPropagation()}>
            <button className={'rv__vb ok' + (verdict[r.id] === 'ok' ? ' on' : '')} onClick={() => setVerdict(v => ({ ...v, [r.id]: 'ok' }))} aria-label="Confirm">{PH_ICON.tick}</button>
            <button className={'rv__vb no' + (verdict[r.id] === 'no' ? ' on' : '')} onClick={() => setVerdict(v => ({ ...v, [r.id]: 'no' }))} aria-label="Flag">{PH_ICON.flag}</button>
          </span>
        </div>

        {sel === r.id && <div className="rv-det">
          <div>
            <div className="rv-cmp">
              <div className="rv-cmp__c">
                <div className="rv-cmp__f" />
                <div className="rv-cmp__l">Punch<b>{r.t} today</b></div>
              </div>
              <div className="rv-cmp__c">
                {r.e.refs > 0 ? <div className="rv-cmp__f" /> : <div className="rv-cmp__f" style={{ background: 'repeating-linear-gradient(45deg,var(--s-container),var(--s-container) 6px,var(--s-high) 6px,var(--s-high) 12px)' }} />}
                <div className="rv-cmp__l">Reference 1<b>{r.e.refs > 0 ? 'Straight on · 14 Mar' : 'Not captured'}</b></div>
              </div>
              <div className="rv-cmp__c">
                {r.e.refs > 1 ? <div className="rv-cmp__f rv-cmp__f--ang" /> : <div className="rv-cmp__f" style={{ background: 'repeating-linear-gradient(45deg,var(--s-container),var(--s-container) 6px,var(--s-high) 6px,var(--s-high) 12px)' }} />}
                <div className="rv-cmp__l">Reference 2<b>{r.e.refs > 1 ? 'Three-quarter · 14 Mar' : 'Not captured'}</b></div>
              </div>
            </div>
            {r.e.refs < 2 && <p className="ph-note" style={{ margin: '13px 0 0' }}>
              <b>{r.e.refs === 0 ? 'No reference pair.' : 'Only one reference.'}</b> There is nothing to compare against, so this punch cannot be verified — only accepted on trust. Send an enrollment request rather than confirming it.
            </p>}
          </div>
          <div>
            <div className="rv-map" ref={mapEl} />
            <div className="rv-meta">
              <div className="rv-meta__r"><span className="rv-meta__k">Coordinates</span><span className="rv-meta__v">{r.lat.toFixed(4)}, {r.lng.toFixed(4)}</span></div>
              <div className="rv-meta__r"><span className="rv-meta__k">Accuracy</span><span className="rv-meta__v" style={r.acc > 100 ? { color: 'var(--tertiary)' } : undefined}>±{r.acc} m</span></div>
              <div className="rv-meta__r"><span className="rv-meta__k">From fence</span><span className="rv-meta__v" style={r.dist > PH_GEO.radius ? { color: 'var(--danger)' } : undefined}>{r.dist > 1000 ? (r.dist / 1000).toFixed(1) + ' km' : r.dist + ' m'}</span></div>
              <div className="rv-meta__r"><span className="rv-meta__k">Captured</span><span className="rv-meta__v">In-app camera</span></div>
              <div className="rv-meta__r"><span className="rv-meta__k">Delivery</span><span className="rv-meta__v">{r.src === 'offline' ? `Offline · synced ${r.sync}` : 'Live'}</span></div>
              <div className="rv-meta__r"><span className="rv-meta__k">Mock location</span><span className="rv-meta__v">Not detected</span></div>
              <div className="rv-meta__r"><span className="rv-meta__k">Photo deleted</span><span className="rv-meta__v">24 Oct 2026</span></div>
            </div>
          </div>
        </div>}
      </React.Fragment>)}
    </div>
  );
}

Object.assign(window, { PhRegister });
