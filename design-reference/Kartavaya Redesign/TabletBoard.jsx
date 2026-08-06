// Tablet board, and the supporting pane that fills a portrait screen.
//
// A kanban is columns because a desk is wide. Held upright, five 190pt columns
// three cards deep is neither a board nor a list — so in portrait the statuses
// stack as collapsible groups and the cards flow inside them, which uses the
// height the orientation actually gave us. Landscape keeps the columns and
// makes them full-height lanes rather than short stacks floating at the top.

function TBoard({ back, go, portrait, state }) {
  const [cols, setCols] = React.useState(BT);
  const [shut, setShut] = React.useState([]);
  const [adding, setAdding] = React.useState(null);
  const [nt, setNt] = React.useState('');
  const total = Object.values(cols).reduce((n, a) => n + a.length, 0);
  const add = k => {
    if (!nt.trim()) return;
    setCols({ ...cols, [k]: [...cols[k], { t: nt.trim(), c: 'GST-new', p: 'med', a: [], d: '—' }] });
    setNt(''); setAdding(null);
  };

  const Card = ({ t, i }) => (
    <div className="mbd__card" key={t.c + i} onClick={() => go && go('task')}>
      <span className="mbd__pri" style={{ background: PC[t.p] }} />
      <div className="mbd__cardh"><span className="mono mbd__code">{t.c}</span>{t.apv && <span className="mbd__apv">{TI.shield}</span>}</div>
      <p className="mbd__ct">{t.t}</p>
      {t.blocked && <span className="mbd__blk">{t.blocked}</span>}
      <div className="mbd__cardf">
        <span className={'mbd__due' + (t.d === 'overdue' ? ' od' : '')}>{TI.cal} {t.d}</span>
        {t.sub && <span className="mbd__sub">{t.sub}</span>}
        <span className="mbd__avs">{t.a.map(a => <AvT key={a} n={a} s={19} />)}</span>
      </div>
    </div>
  );

  const Adder = ({ k }) => adding === k
    ? <div className="mbd__addwrap"><textarea className="mbd__addi" autoFocus rows={2} placeholder="Task title" value={nt} onChange={e => setNt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(k); } if (e.key === 'Escape') { setAdding(null); setNt(''); } }} />
      <div className="mbd__addact"><button className="mbtn mbtn--out" onClick={() => { setAdding(null); setNt(''); }}>Cancel</button><button className="mbtn" onClick={() => add(k)} disabled={!nt.trim()}>Add</button></div></div>
    : <button className="mbd__add" onClick={() => setAdding(k)}>{TI.plus} Add task</button>;

  const head = (
    <div className="tbd__top">
      <span className="mbd__title"><b>Quarterly GST</b><i>{total} tasks · Aekam Inc</i></span>
      <span className="tbd__legend">
        {COLS.map(([k, l, c]) => (
          <button key={k} className="tbd__lg" onClick={() => setShut(s => s.filter(x => x !== k))}>
            <i style={{ background: c }} /><span>{l}</span><em className="mono">{cols[k].length}</em>
          </button>
        ))}
      </span>
    </div>
  );

  if (portrait) return (
    <>
      {head}
      <div className="tbd">
        {COLS.map(([k, l, c]) => {
          const open = !shut.includes(k);
          return (
            <section className="tbd__grp" key={k}>
              <button className={'tbd__gh' + (open ? ' open' : '')} onClick={() => setShut(s => open ? [...s, k] : s.filter(x => x !== k))}>
                <i className="mbd__coldot" style={{ background: c }} />
                <span>{l}</span><em>{cols[k].length}</em>
                <span className="tbd__chev">{TI.chevR}</span>
              </button>
              {open && (
                <div className="tbd__cards">
                  {cols[k].length === 0 && <div className="mbd__cempty">Nothing here.</div>}
                  {cols[k].map((t, i) => <Card t={t} i={i} key={t.c + i} />)}
                  <Adder k={k} />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );

  return (
    <>
      {head}
      <div className="tbd tbd--row">
        {COLS.map(([k, l, c]) => (
          <div className="tbd__col" key={k}>
            <div className="tbd__colh"><i className="mbd__coldot" style={{ background: c }} /><span>{l}</span><em className="mono">{cols[k].length}</em></div>
            <div className="tbd__list">
              {cols[k].length === 0 && <div className="mbd__cempty">Nothing here.<br />Drag a card in.</div>}
              {cols[k].map((t, i) => <Card t={t} i={i} key={t.c + i} />)}
              <Adder k={k} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// Portrait supporting pane for Approvals. A queue of four ends a third of the
// way down a 1376pt screen; what belongs underneath is what was already decided,
// which is the one thing an approver looks for that is not in the queue.
const TDECIDED = [
  ['Aanya Mehta', 'approved', 'July payroll run · ₹6,76,900 net', '09:14', 'ok'],
  ['Keval Shah', 'declined', 'Pune travel claim — receipts missing for 2 legs', '08:52', 'bad'],
  ['Aanya Mehta', 'approved', 'Vendor onboarding — Shreeji Traders', 'Yesterday 18:20', 'ok'],
  ['Keval Shah', 'approved', '2 days casual leave · Rohit Shah', 'Yesterday 16:03', 'ok'],
  ['Vikram Desai', 'approved', 'GSTR-1 filing sign-off — July', 'Yesterday 11:37', 'ok'],
];

function TDecided() {
  return (
    <div className="mbody">
      <div className="msec">Decided <span>last 24 hours</span></div>
      {TDECIDED.map(([who, verb, what, when, k]) => (
        <div className="mact" key={what}>
          <span className={'mact__ic tdec--' + k}>{k === 'ok' ? I.check : I.x}</span>
          <span style={{ minWidth: 0, flex: 1 }}><b>{who}</b> {verb} <span className="tdec__w">{what}</span></span>
          <span className="mono mact__t">{when}</span>
        </div>
      ))}
      <div className="mhint">Every decision is written to the audit trail with the reason attached. A decline without one cannot be saved.</div>
    </div>
  );
}

Object.assign(window, { TBoard, TDecided });
