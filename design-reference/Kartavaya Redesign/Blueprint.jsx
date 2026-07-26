const { useState, useRef, useLayoutEffect } = React;

const CV = <svg className="mc__cv" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>;
const Pv = ({ k }) => <span className={'pv pv--' + k} title={P[k][1]}>{P[k][0]}</span>;

function Sec({ n, t, hi, d, children }) {
  return (
    <section className="bps" id={'s' + n}>
      <div className="bps__h"><span className="bps__n">{n}</span><h2 className="bps__t">{t}</h2>{hi && <span className="bps__hi">{hi}</span>}</div>
      {d && <p className="bps__d">{d}</p>}
      {children}
    </section>
  );
}

// The diagram draws its own connectors from measured node boxes rather than
// hardcoded coordinates — a state added to the data lands correctly with no
// path maths, and the arrows cannot drift from the transition list.
function Fsm({ m, sel, setSel }) {
  const wrap = useRef(null);
  const [paths, setPaths] = useState([]);
  const cols = Math.max(...m.states.map(s => s.x)) + 1;
  const rows = Math.max(...m.states.map(s => s.y || 0)) + 1;

  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const draw = () => {
      const box = el.getBoundingClientRect();
      const at = id => { const n = el.querySelector(`[data-st="${id}"]`); if (!n) return null; const r = n.getBoundingClientRect(); return { l: r.left - box.left, r: r.right - box.left, t: r.top - box.top, b: r.bottom - box.top, cx: r.left - box.left + r.width / 2, cy: r.top - box.top + r.height / 2 }; };
      setPaths(m.edges.map(([a, b]) => {
        const A = at(a), B = at(b); if (!A || !B) return null;
        // Same column — the branch sits directly below its parent, so a
        // left-to-right path would run backwards. Route it vertically.
        if (Math.abs(A.cx - B.cx) < 6) {
          const down = B.t > A.b;
          return { d: `M${A.cx} ${down ? A.b : A.t} L${B.cx} ${(down ? B.t : B.b) + (down ? -7 : 7)}`, hx: B.cx, hy: (down ? B.t : B.b) + (down ? -1 : 1), rot: down ? 90 : -90, a, b };
        }
        const back = B.l < A.l;
        const sameRow = Math.abs(A.cy - B.cy) < 4;
        const x1 = back ? A.l - 3 : A.r + 3, x2 = back ? B.r + 7 : B.l - 7;
        if (sameRow) return { d: `M${x1} ${A.cy} L${x2} ${B.cy}`, hx: x2, hy: B.cy, rot: back ? 180 : 0, a, b };
        const mid = x1 + (x2 - x1) / 2;
        return { d: `M${x1} ${A.cy} L${mid} ${A.cy} L${mid} ${B.cy} L${x2} ${B.cy}`, hx: x2, hy: B.cy, rot: back ? 180 : 0, a, b };
      }).filter(Boolean));
    };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(el);
    return () => ro.disconnect();
  }, [m, cols, rows]);

  const touches = id => !sel || sel === id || m.edges.some(([a, b]) => (a === sel && b === id) || (b === sel && a === id));

  return (
    <div className="fsm" ref={wrap} style={{ gridTemplateColumns: `repeat(${cols}, max-content)`, gridTemplateRows: `repeat(${rows}, auto)` }}>
      <svg className="fsm__svg" width="100%" height="100%">{paths.map((p, i) => { const hot = sel && (p.a === sel || p.b === sel); return <React.Fragment key={i}><path d={p.d} className={hot ? 'hot' : ''} /><polygon className={'hd' + (hot ? ' hot' : '')} points="0,-3.4 6,0 0,3.4" transform={`translate(${p.hx} ${p.hy}) rotate(${p.rot || 0})`} /></React.Fragment>; })}</svg>
      {m.states.map(s => (
        <button key={s.id} data-st={s.id} className={'st st--' + s.tone + (sel === s.id ? ' on' : touches(s.id) ? '' : ' dim')}
          style={{ gridColumn: s.x + 1, gridRow: (s.y || 0) + 1 }}
          onClick={() => setSel(sel === s.id ? null : s.id)}>
          <span className="st__l">{s.label}</span><span className="st__k">{s.id}</span>
        </button>
      ))}
    </div>
  );
}

function Machine({ m, open, toggle }) {
  const [sel, setSel] = useState(null);
  return (
    <div className={'mc' + (open ? ' on' : '')}>
      <button className="mc__h" onClick={toggle}>
        {CV}<span className="mc__nm">{m.name}</span><span className="mc__hi">{m.hi}</span>
        <Pv k={m.prov} />
        <span className="mc__ct">{m.states.length} states · {m.edges.length} transitions</span>
      </button>
      <div className="mc__b">
        <p className="mc__src"><b>From</b> {m.from}</p>
        <p className="mc__note">{m.note}</p>
        <Fsm m={m} sel={sel} setSel={setSel} />
        <div>
          {m.edges.map(([a, b, g], i) => (
            <div key={i} className={'tr' + (sel && a !== sel && b !== sel ? ' dim' : '')}>
              <span className="tr__a">{a}</span><span className="tr__ar">→</span><span className="tr__b">{b}</span><span className="tr__g">{g}</span>
            </div>
          ))}
        </div>
        <code className="mc__api">{m.api}</code>
        <dl className="gd">{m.guards.map(([k, v], i) => <React.Fragment key={i}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
      </div>
    </div>
  );
}

function Entity({ e }) {
  const [on, setOn] = useState(false);
  const [n, prov, d, f] = e;
  return (
    <div className={'e' + (on ? ' on' : '')}>
      <button className="e__h" onClick={() => setOn(!on)}>
        {CV}<span className="e__n">{n}</span><span className="e__d">{d}</span><Pv k={prov} />
      </button>
      <div className="e__f"><div className="e__fl">{f.split(' · ').map(x => <b key={x}>{x}</b>)}</div></div>
    </div>
  );
}

const CLS = { full: 'Full', write: 'Write', read: 'Read', scoped: 'Scoped', grant: 'By grant', none: '—' };

function Blueprint() {
  const [tab, setTab] = useState('fsm');
  const [openM, setOpenM] = useState('task');
  const TABS = [['fsm', 'State machines', MACHINES.length], ['ent', 'Entities', ENTITIES.reduce((n, g) => n + g.items.length, 0)], ['rt', 'Real-time', REALTIME.length], ['sync', 'Offline sync', SYNC.length], ['perm', 'Permissions', PERMS.rows.length], ['open', 'Open questions', OPEN.length]];

  return (
    <div className="bpx">
      <header className="bph">
        <span className="bph__m">Kartavaya<i>System blueprint</i></span>
        <span className="bph__s">For the system architect · derived from 28 handover files and the staging branch</span>
      </header>
      <nav className="bpn">{TABS.map(([k, l, n]) => <button key={k} className={'bpn__b' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}<b>{n}</b></button>)}</nav>

      <div className="bpw">
        <div className="bpkey">
          <Pv k="src" /><span>read in staging</span>
          <Pv k="ui" /><span>implied by the design, not checked against the backend</span>
          <Pv k="gap" /><span>believed absent — verify first</span>
        </div>
        <p className="bpwarn"><b>Scope of this document.</b> It was assembled from the frontend and the design work. <code>backend/</code> exists — FastAPI routers, migrations, services and tests — and was <b>not</b> systematically read. Every <em>Design</em> row is a proposal that may already be implemented, and every <em>Gap</em> may already exist. The invite machine was badged <em>Source</em> while citing a design document until that was caught; reading the real handler both corrected the citation and surfaced a defect the design had missed. Do the same before building any table here.</p>

        {tab === 'fsm' && (
          <Sec n="01" t="State machines" hi="अवस्था" d="Five machines the interface encodes. Click a state to isolate its transitions. Each machine names the file it was read from. Design means inferred from the prototype and not checked against the backend — not that no backend exists; see the note above.">
            <div className="mcs">{MACHINES.map(m => <Machine key={m.id} m={m} open={openM === m.id} toggle={() => setOpenM(openM === m.id ? null : m.id)} />)}</div>
          </Sec>
        )}

        {tab === 'ent' && (
          <Sec n="02" t="Entities" hi="इकाई" d="What the interface requires to exist, grouped by concern. Field lists are the minimum the screens read or write, not a finished schema — expand a row to see them. Every table is scoped to org; that scoping is the row-level-security boundary and it is the one thing that must not be got wrong.">
            {ENTITIES.map(g => (
              <div className="eg" key={g.g}>
                <div className="eg__t">{g.g}</div>
                <div className="et">{g.items.map(e => <Entity key={e[0]} e={e} />)}</div>
              </div>
            ))}
          </Sec>
        )}

        {tab === 'rt' && (
          <Sec n="03" t="Real-time surface" hi="तत्काल" d="Eight live behaviours the design promises, and what each one costs. The distinction that matters: ephemeral never touches the database, durable persists before it publishes, derived is computed from existing rows and must never become a counter column — a counter drifts and cannot be recomputed.">
            <table className="bt">
              <thead><tr><th>Behaviour</th><th>Channel</th><th>Kind</th><th>Note</th></tr></thead>
              <tbody>{REALTIME.map(([b, c, k, n]) => <tr key={b}><td>{b}</td><td><code>{c}</code></td><td><span className={'tag tag--' + k}>{k}</span></td><td>{n}</td></tr>)}</tbody>
            </table>
          </Sec>
        )}

        {tab === 'sync' && (
          <Sec n="04" t="Offline sync" hi="समन्वय" d="The mobile app queues mutations offline. That makes replay semantics a backend contract, not a client detail — and the two hardest cases are state transitions, which must re-evaluate their guard rather than be applied blindly, and attendance, where two clocks disagreeing is signal rather than noise.">
            <div className="ob">{SYNC.map(([t, prov, d]) => (
              <div className={'o o--' + prov} key={t}><div className="o__t">{t}<Pv k={prov} /></div><div className="o__d">{d}</div></div>
            ))}</div>
          </Sec>
        )}

        {tab === 'perm' && (
          <Sec n="05" t="Permissions" hi="अधिकार" d="Five roles against fifteen capabilities. By grant means the module gives nothing until it is explicitly granted, by role — the owner's decision, and it applies to Ganit, Vetana and Manav regardless of how senior the role is. Client is not a member: it authenticates through a scoped share token and must never resolve to a membership row.">
            <table className="pm">
              <thead><tr><th>Capability</th>{PERMS.roles.map(r => <th key={r}>{r}</th>)}</tr></thead>
              <tbody>{PERMS.rows.map(([cap, lv]) => (
                <tr key={cap}><td>{cap}</td>{lv.map((l, i) => <td key={i}><span className={'cl cl--' + l}>{CLS[l]}</span></td>)}</tr>
              ))}</tbody>
            </table>
          </Sec>
        )}

        {tab === 'open' && (
          <Sec n="06" t="Open questions" hi="प्रश्न" d="Eight decisions that belong to the architect, not the designer. The ones marked Source are things staging does today that will not survive volume; the Gap entries are infrastructure the design assumes and the codebase does not have.">
            <div className="ob">{OPEN.map(([t, prov, d]) => (
              <div className={'o o--' + prov} key={t}><div className="o__t">{t}<Pv k={prov} /></div><div className="o__d">{d}</div></div>
            ))}</div>
          </Sec>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Blueprint />);
