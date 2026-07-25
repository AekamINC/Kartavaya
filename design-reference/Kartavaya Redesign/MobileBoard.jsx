/* Mobile board detail — grounded in mobile/src/screens/BoardScreen.tsx:
   colTab pill row (r99, bw1, 11/6, text 13/600, count SpaceMono 11),
   column width 270 px pad 10/8, colHeader gap 8 pb 10, colDot 8, colName 13/800,
   card padding 14/16 marginBottom 10. Columns scroll horizontally with snap. */
const { useState: uB, useRef: rB } = React;

const COLS = [
  ['todo', 'To do', 'var(--on-surface-3)'],
  ['in_progress', 'In progress', 'var(--primary)'],
  ['in_review', 'In review', 'var(--warn)'],
  ['blocked', 'Blocked', 'var(--danger)'],
  ['done', 'Done', 'var(--ok)'],
];

const BT = {
  todo: [
    { t: 'Draft Q2 advance tax working', c: 'GST-121', p: 'med', a: ['Priya Nair'], d: '2 Aug' },
    { t: 'Collect Form 16 from 3 vendors', c: 'GST-125', p: 'low', a: ['Rohit Shah'], d: '5 Aug' },
  ],
  in_progress: [
    { t: 'File GSTR-3B for July 2026', c: 'GST-114', p: 'high', a: ['Aanya Mehta', 'Rohit Shah'], d: '20 Aug', sub: '3/5' },
    { t: 'Reconcile 2B mismatches', c: 'GST-118', p: 'high', a: ['Aanya Mehta'], d: '18 Aug', sub: '1/3' },
  ],
  in_review: [{ t: 'TDS challan for Q1', c: 'GST-109', p: 'med', a: ['Vikram Desai'], d: '12 Aug', apv: true }],
  blocked: [{ t: 'Nirmal HSN codes — awaiting client', c: 'GST-116', p: 'high', a: ['Rohit Shah'], d: 'overdue', blocked: 'Waiting on Nirmal Exports since 21 Jul' }],
  done: [
    { t: 'GSTR-1 filed for July', c: 'GST-103', p: 'med', a: ['Aanya Mehta'], d: '11 Aug' },
    { t: 'ITC ledger reconciled', c: 'GST-101', p: 'low', a: ['Priya Nair'], d: '8 Aug' },
  ],
};
const PC = { high: 'var(--danger)', med: 'var(--warn)', low: 'var(--on-surface-faint)' };

function MBoardDetail({ back, os, go, state }) {
  const [cols, setCols] = uB(BT);
  const [act, setAct] = uB('in_progress');
  const [moving, setMoving] = uB(null);
  const [adding, setAdding] = uB(null);
  const [nt, setNt] = uB('');
  const track = rB(null);

  const jump = k => {
    setAct(k);
    const i = COLS.findIndex(c => c[0] === k);
    const el = track.current && track.current.children[i];
    if (el) track.current.scrollTo({ left: el.offsetLeft - track.current.offsetLeft, behavior: 'smooth' });
  };
  const move = to => {
    const { from, i } = moving;
    const card = cols[from][i];
    setCols({ ...cols, [from]: cols[from].filter((_, j) => j !== i), [to]: [...cols[to], card] });
    setMoving(null);
  };
  const add = k => {
    if (!nt.trim()) return;
    setCols({ ...cols, [k]: [...cols[k], { t: nt.trim(), c: 'GST-new', p: 'med', a: [], d: '—' }] });
    setNt(''); setAdding(null);
  };
  const total = Object.values(cols).reduce((n, a) => n + a.length, 0);

  if (state === 'loading') return (
    <><div className="mtop" style={{ paddingTop: os === 'ios' ? 56 : 36 }}><button className="micon" onClick={back}>{TI.chevL}</button><span style={{ flex: 1 }} /></div>
      <div className="mbody" style={{ padding: '10px 0 0' }}>
        <div style={{ display: 'flex', gap: 8, padding: '0 14px 12px' }}>{[78, 92, 84].map((w, i) => <div key={i} className="msk" style={{ height: 30, width: w, borderRadius: 99, flexShrink: 0 }} />)}</div>
        <div style={{ display: 'flex', gap: 10, padding: '0 14px' }}>{[0, 1].map(i => <div key={i} style={{ width: 250, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="msk" style={{ height: 16, width: 96 }} />{[74, 92].map((h, k) => <div key={k} className="msk" style={{ height: h, borderRadius: 12 }} />)}</div>)}</div>
      </div></>
  );

  return (
    <>
      <div className="mtop mtd__top" style={{ paddingTop: os === 'ios' ? 56 : 36 }}>
        <button className="micon" onClick={back}>{TI.chevL}</button>
        <span className="mbd__title"><b>Quarterly GST</b><i>{total} tasks · Aekam Inc</i></span>
        <button className="micon">{TI.more}</button>
      </div>

      <div className="mbd__tabs">
        {COLS.map(([k, l, c]) => (
          <button key={k} className={'mbd__tab' + (act === k ? ' on' : '')} style={{ '--c': c }} onClick={() => jump(k)}>
            <i className="mbd__tabdot" /><span>{l}</span><em className="mono">{cols[k].length}</em>
          </button>
        ))}
      </div>

      <div className="mbody mbd" ref={track} onScroll={e => { const i = Math.round(e.target.scrollLeft / 270); if (COLS[i] && COLS[i][0] !== act) setAct(COLS[i][0]); }}>
        {COLS.map(([k, l, c]) => (
          <div className="mbd__col" key={k}>
            <div className="mbd__colh"><i className="mbd__coldot" style={{ background: c }} /><span className="mbd__coln">{l}</span><em className="mbd__colb mono">{cols[k].length}</em></div>
            {cols[k].length === 0 && <div className="mbd__cempty">Nothing here.<br />Drag a card in, or add one.</div>}
            {cols[k].map((t, i) => (
              <div className="mbd__card" key={t.c + i} onClick={() => go && go('task')}
                onContextMenu={e => { e.preventDefault(); setMoving({ from: k, i }); }}>
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
            ))}
            {adding === k
              ? <div className="mbd__addwrap"><textarea className="mbd__addi" autoFocus rows={2} placeholder="Task title" value={nt} onChange={e => setNt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(k); } if (e.key === 'Escape') { setAdding(null); setNt(''); } }} />
                <div className="mbd__addact"><button className="mbtn mbtn--out" onClick={() => { setAdding(null); setNt(''); }}>Cancel</button><button className="mbtn" onClick={() => add(k)} disabled={!nt.trim()}>Add</button></div></div>
              : <button className="mbd__add" onClick={() => setAdding(k)}>{TI.plus} Add task</button>}
          </div>
        ))}
      </div>
      <div className="mhint">Swipe between columns · long-press a card to move it</div>

      {moving && <MSheet title={`Move “${cols[moving.from][moving.i].t}”`} onClose={() => setMoving(null)}>
        {COLS.filter(([k]) => k !== moving.from).map(([k, l, c]) =>
          <button key={k} className="msheet__r" onClick={() => move(k)}><i className="msheet__dot" style={{ background: c }} /><span>{l}</span>{TI.chevR}</button>)}
      </MSheet>}
    </>
  );
}

Object.assign(window, { MBoardDetail });
