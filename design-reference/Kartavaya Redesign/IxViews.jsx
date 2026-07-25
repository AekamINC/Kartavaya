// Sections 9–10 — Kanban and table. Against staging views/KanbanView.jsx,
// views/KanbanCard.jsx, views/TableView.jsx.
const KCOLS = [['todo', 'To Do', 'कार्य', '#8E8D87'], ['in_progress', 'In Progress', 'चालू', '#0082c6'], ['in_review', 'In Review', 'समीक्षा', '#8b5cf6'], ['done', 'Done', 'सम्पन्न', '#16a34a']];
const KCARDS = [
  { id: 'KAR-582', t: 'Tata Steel — Mumbai fit-out review', c: 'in_review', p: 'urgent', a: ['Keval Shah', 'Aanya Mehta'], cm: 4, due: 'Today', dv: 'danger' },
  { id: 'KAR-184', t: 'Compile Q1 GSTR-3B working notes', c: 'in_progress', p: 'high', a: ['Rohan Iyer'], cm: 7, due: 'Tomorrow', dv: 'warn' },
  { id: 'KAR-112', t: 'Share Diwali campaign draft', c: 'in_progress', p: 'medium', a: ['Priya Nair'], cm: 2, due: 'In 3d' },
  { id: 'KAR-411', t: 'Vendor agreement — clause update', c: 'todo', p: 'low', a: ['Rohan Iyer'], cm: 0, due: '2 Aug' },
  { id: 'KAR-090', t: 'Reconcile input tax credit for June', c: 'todo', p: 'high', a: ['Aanya Mehta'], cm: 1, due: 'In 5d' },
  { id: 'KAR-077', t: 'Verify PF challan', c: 'done', p: 'medium', a: ['Priya Nair'], cm: 3, due: 'Done' },
];

function KanbanDemo({ hint }) {
  const { mobile } = useIx();
  const [cards, setCards] = React.useState(KCARDS);
  const [drag, setDrag] = React.useState(null);
  const [over, setOver] = React.useState(null);
  const [adding, setAdding] = React.useState(null);
  const [draft, setDraft] = React.useState('');
  const [menu, setMenu] = React.useState(null);
  const [opened, setOpened] = React.useState(null);
  const [press, setPress] = React.useState(null);
  const moved = React.useRef(false);

  const drop = col => {
    if (!drag) return;
    if (moved.current) setCards(cs => cs.map(c => (c.id === drag ? { ...c, c: col, just: true } : c)));
    setDrag(null); setOver(null);
  };
  const add = col => {
    if (draft.trim()) setCards(cs => [...cs, { id: 'KAR-' + Math.floor(600 + Math.random() * 99), t: draft.trim(), c: col, p: 'medium', a: [], cm: 0, due: 'No date', just: true }]);
    setDraft('');
  };

  return (
    <IxStage h={mobile ? 400 : 344} note={hint}>
      <div className="kb">
        {KCOLS.map(([id, en, hi, c]) => {
          const list = cards.filter(x => x.c === id);
          return (
            <div key={id} className={'kb__col' + (over === id ? ' over' : '')}
              onDragOver={e => { e.preventDefault(); moved.current = true; setOver(id); }}
              onDragLeave={() => setOver(o => (o === id ? null : o))}
              onDrop={() => drop(id)}>
              <div className="kb__head">
                <span className="kb__bar" style={{ background: c }} />
                <b>{en}</b><i className="hi">{hi}</i>
                <span className="kb__n">{list.length}</span>
                <span style={{ position: 'relative' }}>
                  <button className="kb__dots" onClick={() => setMenu(menu === id ? null : id)}>{I.dots}</button>
                  {menu === id && (
                    <>
                      <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setMenu(null)} />
                      <div className="ov-menu" style={{ minWidth: 168 }}>
                        {[['Rename column', 'doc'], ['Set a WIP limit', 'check'], ['Sort by priority', 'filter'], ['Hide column', 'x']].map(([l, ic]) => (
                          <button key={l} className="ov-menu__i" onClick={() => setMenu(null)}><span className="ov-menu__ic">{I[ic]}</span>{l}</button>
                        ))}
                      </div>
                    </>
                  )}
                </span>
              </div>
              <div className="kb__body">
                {list.map(x => (
                  <div key={x.id} draggable={!mobile}
                    className={'kb__card' + (drag === x.id ? ' lift' : '') + (x.just ? ' just' : '') + (press === x.id ? ' press' : '')}
                    onDragStart={() => { setDrag(x.id); moved.current = false; }}
                    onDragEnd={() => { setDrag(null); setOver(null); }}
                    onMouseDown={() => setPress(x.id)} onMouseUp={() => setPress(null)} onMouseLeave={() => setPress(null)}
                    onClick={() => { if (!moved.current) setOpened(x); }}>
                    <div className="kb__top">
                      <span className="pdot" style={{ background: PRIO[x.p] }} />
                      <span className="kb__id">{x.id}</span>
                      <button className="kb__tick" title="Mark done" onClick={e => { e.stopPropagation(); setCards(cs => cs.map(y => y.id === x.id ? { ...y, c: y.c === 'done' ? 'todo' : 'done', just: true } : y)); }}>
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M3.5 8.4l3 3 6-6.6" /></svg>
                      </button>
                    </div>
                    <div className="kb__t">{x.t}</div>
                    <div className="kb__foot">
                      {x.a.length ? <Avs list={x.a} max={2} s={18} /> : <span className="kb__unass" title="Unassigned">{I.plus}</span>}
                      {x.cm > 0 && <span className="kb__cm">{SI.thread}{x.cm}</span>}
                      <span className={'kb__due' + (x.dv ? ' ' + x.dv : '')}>{x.due}</span>
                    </div>
                  </div>
                ))}
                {adding === id ? (
                  <div className="kb__add">
                    <textarea className="kb__in" rows="2" autoFocus value={draft} placeholder="Task title, ⏎ to add"
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(id); } if (e.key === 'Escape') { setDraft(''); setAdding(null); } }} />
                    <div className="rowflex" style={{ gap: 5 }}>
                      <button className="btn btn--fill btn--sm" onClick={() => add(id)}>Add</button>
                      <button className="btn btn--text btn--sm" onClick={() => { setDraft(''); setAdding(null); }}>Done</button>
                    </div>
                  </div>
                ) : (
                  <button className="kb__addb" onClick={() => setAdding(id)}>{I.plus} Add task</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {opened && (
        <>
          <div className="dm-scrim" onClick={() => setOpened(null)} />
          <div className="dm-drawer">
            <div className="dm-drawer__h">
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--on-surface-3)' }}>{opened.id}</span>
              <b style={{ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opened.t}</b>
              <button className="icobtn" style={{ marginLeft: 'auto', width: 26, height: 26 }} onClick={() => setOpened(null)}>{I.x}</button>
            </div>
            <div className="dm-drawer__b"><span className="mute" style={{ fontSize: 12 }}>A click opens the drawer. A drag does not — the handler checks whether the pointer moved before treating it as a click.</span></div>
          </div>
        </>
      )}
    </IxStage>
  );
}

// ── Table ──────────────────────────────────────────────────────────────
const TCOLS = [['t', 'Task', 2.2], ['st', 'Status', 1], ['p', 'Priority', .9], ['a', 'Assignee', 1.2], ['due', 'Due', .8]];
function TableDemo({ hint, h }) {
  const { mobile } = useIx();
  const [rows, setRows] = React.useState(TASKS.map(t => ({ ...t })));
  const [sort, setSort] = React.useState(null);
  const [w, setW] = React.useState(() => Object.fromEntries(TCOLS.map(([k, , f]) => [k, f])));
  const [sel, setSel] = React.useState([]);
  const [edit, setEdit] = React.useState(null);
  const [filters, setFilters] = React.useState([['Priority', 'is', 'High']]);
  const [fb, setFb] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [nf, setNf] = React.useState(['Status', 'is', '']);
  const resizing = React.useRef(null);

  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const [k, dir] = sort;
    const ORD = { urgent: 0, high: 1, medium: 2, low: 3 };
    return [...rows].sort((a, b) => {
      const va = k === 'p' ? ORD[a.p] : String(a[k] || ''), vb = k === 'p' ? ORD[b.p] : String(b[k] || '');
      return (va < vb ? -1 : va > vb ? 1 : 0) * (dir === 'asc' ? 1 : -1);
    });
  }, [rows, sort]);
  const cycle = k => setSort(s => (!s || s[0] !== k ? [k, 'asc'] : s[1] === 'asc' ? [k, 'desc'] : null));
  const grid = TCOLS.map(([k]) => 'minmax(0,' + w[k] + 'fr)').join(' ');

  React.useEffect(() => {
    const move = e => {
      if (!resizing.current) return;
      const { k, x0, w0 } = resizing.current;
      setW(p => ({ ...p, [k]: Math.max(.5, w0 + (e.clientX - x0) / 120) }));
    };
    const up = () => { resizing.current = null; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  return (
    <IxStage h={h || (mobile ? 400 : 356)} note={hint}>
      <div className="tv">
        <div className="tv__bar">
          <button className={'chip' + (fb ? ' on' : '')} onClick={() => { setFb(!fb); setStep(0); setNf(['Status', 'is', '']); }}>{I.filter} Filter</button>
          {filters.map((f, i) => (
            <span key={i} className="tv__chip">
              <b>{f[0]}</b><i>{f[1]}</i>{f[2]}
              <button onClick={() => setFilters(x => x.filter((_, j) => j !== i))}>{I.x}</button>
            </span>
          ))}
          {filters.length > 0 && <button className="btn btn--text btn--sm" style={{ padding: '2px 6px', fontSize: 11.5 }} onClick={() => setFilters([])}>Clear all</button>}
          <span style={{ flex: 1 }} />
          <span className="mute mono" style={{ fontSize: 11 }}>{sorted.length} rows</span>
          {fb && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setFb(false)} />
              <div className="dm-pop" style={{ top: 34, left: 0, width: 246 }}>
                <div className="tv__fb">
                  <div className="tv__fb-s">
                    {['Field', 'Operator', 'Value'].map((l, i) => <span key={l} className={i === step ? 'on' : i < step ? 'done' : ''}>{l}</span>)}
                  </div>
                  {step === 0 && ['Status', 'Priority', 'Assignee', 'Due date', 'Project'].map(f => (
                    <button key={f} className="dm-opt" onClick={() => { setNf([f, 'is', '']); setStep(1); }}>{f}</button>
                  ))}
                  {step === 1 && ['is', 'is not', 'contains', 'is empty'].map(op => (
                    <button key={op} className="dm-opt" onClick={() => { setNf(n => [n[0], op, '']); setStep(op === 'is empty' ? 3 : 2); }}>{op}</button>
                  ))}
                  {step === 2 && ['To Do', 'In Progress', 'In Review', 'Done'].map(v => (
                    <button key={v} className="dm-opt" onClick={() => { setFilters(x => [...x, [nf[0], nf[1], v]]); setFb(false); }}>{v}</button>
                  ))}
                  {step === 3 && <button className="dm-opt" onClick={() => { setFilters(x => [...x, [nf[0], nf[1], '']]); setFb(false); }}>Apply {nf[0]} {nf[1]}</button>}
                </div>
              </div>
            </>
          )}
        </div>

        {sel.length > 0 && (
          <div className="tv__bulk">
            <b>{sel.length} selected</b>
            <button className="btn btn--out btn--sm">Assign</button>
            <button className="btn btn--out btn--sm">Move to</button>
            <button className="btn btn--out btn--sm">Change status</button>
            <button className="btn btn--danger btn--sm">Delete</button>
            <span style={{ flex: 1 }} />
            <button className="btn btn--text btn--sm" onClick={() => setSel([])}>Clear</button>
          </div>
        )}

        <div className="tv__t">
          <div className="tv__head" style={{ gridTemplateColumns: '34px ' + grid }}>
            <span className="tv__c">
              <button className={'tv__ck' + (sel.length === sorted.length && sel.length ? ' on' : sel.length ? ' some' : '')}
                onClick={() => setSel(sel.length === sorted.length ? [] : sorted.map(r => r.id))}>
                {sel.length === sorted.length && sel.length ? I.check : sel.length ? <i /> : null}
              </button>
            </span>
            {TCOLS.map(([k, l]) => (
              <span key={k} className="tv__c tv__hc">
                <button className={'tv__sort' + (sort && sort[0] === k ? ' on' : '')} onClick={() => cycle(k)}>
                  {l}<i>{sort && sort[0] === k ? (sort[1] === 'asc' ? '↑' : '↓') : '↕'}</i>
                </button>
                <span className="tv__grip" onMouseDown={e => { resizing.current = { k, x0: e.clientX, w0: w[k] }; document.body.style.cursor = 'col-resize'; }} />
              </span>
            ))}
          </div>
          <div className="tv__rows">
            {sorted.map(r => (
              <div key={r.id} className={'tv__row' + (sel.includes(r.id) ? ' on' : '')} style={{ gridTemplateColumns: '34px ' + grid }}>
                <span className="tv__c">
                  <button className={'tv__ck' + (sel.includes(r.id) ? ' on' : '')}
                    onClick={() => setSel(s => (s.includes(r.id) ? s.filter(x => x !== r.id) : [...s, r.id]))}>
                    {sel.includes(r.id) ? I.check : null}
                  </button>
                </span>
                <span className="tv__c"><span className="tv__id">{r.id}</span><span className="tv__t2">{r.t}</span></span>
                <span className="tv__c">
                  {edit === r.id + 'st' ? (
                    <select className="inp" autoFocus style={{ padding: '3px 22px 3px 7px', fontSize: 11.5 }} defaultValue={r.st}
                      onBlur={() => setEdit(null)} onChange={e => { setRows(x => x.map(y => y.id === r.id ? { ...y, st: e.target.value } : y)); setEdit(null); }}>
                      {Object.keys(STATUS).map(k => <option key={k} value={k}>{STATUS[k][0]}</option>)}
                    </select>
                  ) : (
                    <button className="tv__cell" onClick={() => setEdit(r.id + 'st')}><Tag c={STATUS[r.st][2]}>{STATUS[r.st][0]}</Tag></button>
                  )}
                </span>
                <span className="tv__c">
                  {edit === r.id + 'p' ? (
                    <select className="inp" autoFocus style={{ padding: '3px 22px 3px 7px', fontSize: 11.5 }} defaultValue={r.p}
                      onBlur={() => setEdit(null)} onChange={e => { setRows(x => x.map(y => y.id === r.id ? { ...y, p: e.target.value } : y)); setEdit(null); }}>
                      {Object.keys(PRIO).map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                  ) : (
                    <button className="tv__cell" onClick={() => setEdit(r.id + 'p')}><span className="pdot" style={{ background: PRIO[r.p] }} /><span style={{ fontSize: 11.5, textTransform: 'capitalize' }}>{r.p}</span></button>
                  )}
                </span>
                <span className="tv__c"><button className="tv__cell"><Avs list={r.a} max={2} s={19} /></button></span>
                <span className="tv__c"><span className={'kb__due' + (r.dv && r.dv !== 'normal' && r.dv !== 'muted' ? ' ' + r.dv : '')}>{r.due}</span></span>
                <span className="tv__acts">
                  <button className="icobtn" style={{ width: 22, height: 22 }}>{I.doc}</button>
                  <button className="icobtn" style={{ width: 22, height: 22 }}>{I.dots}</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </IxStage>
  );
}

function IxSecKanban() {
  return (
    <>
      <IxCard n="9.1" t="Drag a card between columns" trig="mouse down · long-press"
        lede="The lifted card keeps full opacity and the column it will land in lights up. A ghosted card and a thin blue line make you guess twice."
        spec={{
          entry: <>On grab: <code>scale(1.02)</code>, <code>--shadow-2</code>, <code>rotate(.6deg)</code>, {num('140ms')}. The source slot keeps its height so nothing below jumps.</>,
          active: <>The hovered column gets a <code>--primary</code> tint and a dashed inner border, and its count badge previews the new total. Cards shift to open the drop slot, {num('180ms')} <code>--ease-emph</code>.</>,
          dismiss: <>Release to drop · <code>Esc</code> cancels and returns the card</>,
          exit: <>Card settles with <code>--ease-spring</code> over {num('300ms')} and runs one <code>--primary</code> flash so you can find it in the new column.</>,
          mobile: <>Long-press {num('420ms')} with a haptic tick to pick up. Horizontal auto-scroll when held within <code>40px</code> of an edge.</>,
          tokens: <><code>--shadow-2</code> · <code>--primary</code> tint · <code>--ease-spring</code></>,
          handler: <><code>onMove(cardId, toColumn, index)</code> → optimistic, <code>PATCH</code> with a fractional position so one row is written.</>,
          a11y: <>Card is focusable; <code>Space</code> lifts, arrows move between columns, <code>Space</code> drops, with a live-region announcement.</>,
        }}
        today="KanbanView.jsx moves cards but with no lift, no drop target highlight and no settle — the card teleports and the count updates a frame later.">
        <KanbanDemo hint="Drag any card into another column" />
      </IxCard>

      <IxCard n="9.2" t="Click versus drag" trig="click a card"
        lede="The same pointer does both, so the card has to tell them apart. A click that opens the drawer after an aborted drag is the most annoying bug in any board."
        spec={{
          entry: <>Press: <code>scale(.985)</code> in {num('90ms')} — enough to feel the target without looking like a drag has begun.</>,
          active: <>A movement flag is set on the first <code>dragover</code>. On release, the click handler opens the drawer <b>only</b> if the flag is clear.</>,
          dismiss: <>n/a</>,
          exit: <>Release returns to <code>scale(1)</code> {num('140ms')}, then the drawer opens per 1.1.</>,
          mobile: <>Tap opens; long-press enters drag. The two cannot collide because the thresholds differ.</>,
          tokens: <><code>--dur-instant</code> press</>,
          handler: <>Prefer a <code>3px</code> movement threshold over a timer — a slow deliberate drag should still be a drag.</>,
        }}
        today="Any mouseup on a card opens the drawer, so cancelling a drag by dropping it back opens the task you were moving.">
        <KanbanDemo hint="Click a card to open it · drag one and drop it back — no drawer" />
      </IxCard>

      <IxCard n="9.3" t="Column header and inline add" trig="click ⋯ · click Add"
        lede="Add stays open after each task so a stand-up's worth of work is one continuous typing session."
        spec={{
          entry: <>Composer replaces the Add button, <code>max-height</code> + fade {num('220ms')}, textarea focused. Header menu is the shared ⋯ primitive from 5.1.</>,
          active: <><code>⏎</code> creates and clears without closing; <code>⇧⏎</code> newlines. A <b>Done</b> link closes it explicitly. New card enters at the column's foot with <code>translateY(-6px)</code> + fade.</>,
          dismiss: <><code>Esc</code> · Done · blur while empty</>,
          exit: <>Collapses {num('180ms')} <code>--ease-exit</code>.</>,
          mobile: <>Composer sticks above the keyboard; the column scrolls under it.</>,
          tokens: <><code>--primary</code> ring · <code>--r-sm</code></>,
          handler: <><code>onCreate({'{ title, column }'})</code>, optimistic with a temporary id. WIP limit warns rather than blocks.</>,
        }}
        today="Add opens a full New Task modal, so adding six cards means six modals.">
        <KanbanDemo hint="Press “Add task” at the foot of a column, then ⏎ a few times" />
      </IxCard>

      <IxCard n="9.4" t="Card hover and quick actions" trig="hover"
        lede="One quick action, not five. A complete-tick is worth surfacing because it is the most common single change; everything else is a click into the drawer."
        spec={{
          entry: <>Card raises <code>--shadow-1</code> and its border warms toward <code>--primary</code> at <code>46%</code>, {num('140ms')}. The tick fades in top-right.</>,
          active: <>Assignee avatars gain a ring, the due chip keeps its danger colour, and an unassigned card shows a dashed <code>+</code> that is itself a target.</>,
          dismiss: <>Mouse out</>,
          exit: <>Fade {num('140ms')}. Ticking runs the 2.2 checkbox animation, then the card moves to Done with the 9.1 settle.</>,
          mobile: <>No hover. The tick is permanently visible at <code>44px</code> and the card carries a chevron.</>,
          tokens: <><code>--shadow-1</code> · <code>PRIO</code> colours · <code>--ok</code> tick</>,
          handler: <><code>stopPropagation</code> on every quick action, or ticking opens the drawer too.</>,
        }}
        today="KanbanCard.jsx has a hover shadow and nothing else; marking something done takes three clicks through the drawer.">
        <KanbanDemo hint="Hover a card · press its tick" />
      </IxCard>
    </>
  );
}

function IxSecTable() {
  return (
    <>
      <IxCard n="10.1" t="Sort and resize columns" trig="click header · drag edge"
        lede="Three-state sort, because the third click has to get you back to the natural order — otherwise the only way out is a reload."
        spec={{
          entry: <>Idle headers carry a faint <code>↕</code> at <code>--on-surface-faint</code>. It only becomes directional once sorted.</>,
          active: <>asc → desc → none. Rows reorder with no animation: animating a 40-row reorder is nausea, not polish. Sorted header goes <code>--on-surface</code> and its arrow <code>--primary</code>.</>,
          dismiss: <>Third click clears the sort</>,
          exit: <>Resize: the grip is a <code>5px</code> hit area on the header's right edge, cursor <code>col-resize</code>, tracked on <code>mousemove</code> against the fractional width. Minimum <code>.5fr</code> so a column can never vanish.</>,
          mobile: <>Sort moves into a sheet listing the columns; resize is dropped — there is no room and no pointer for it.</>,
          tokens: <><code>--primary</code> arrow · <code>--s-low</code> header</>,
          handler: <>Sort and widths persist per view in the URL and per user; both are preferences, not state.</>,
          a11y: <><code>aria-sort</code> on the header cell, <code>Enter</code> and <code>Space</code> cycle.</>,
        }}
        today="TableView.jsx sorts ascending/descending with no third state and no resize at all.">
        <TableDemo hint="Click a header three times · drag the right edge of one" />
      </IxCard>

      <IxCard n="10.2" t="Bulk selection" trig="check a row"
        lede="The action bar arrives only once something is selected, and it replaces the filter bar rather than stacking on top of it."
        spec={{
          entry: <>Bar slides down <code>translateY(-8px)</code> + fade {num('220ms')} <code>--ease-emph</code> above the header. Selected rows take <code>--primary-container</code>.</>,
          active: <>Header checkbox shows an indeterminate dash when the selection is partial. Count is the leading element, then Assign, Move, Change status, and Delete last and separated.</>,
          dismiss: <>Clear · unchecking the last row · <code>Esc</code></>,
          exit: <>Bar slides up {num('180ms')} <code>--ease-exit</code>.</>,
          mobile: <>Bar docks to the bottom above the nav; actions collapse into a sheet past three.</>,
          tokens: <><code>--primary-container</code> row · <code>--s-container</code> bar</>,
          handler: <>Bulk mutations are one request with an id array, and a single undo toast for the whole batch.</>,
          a11y: <><code>aria-checked="mixed"</code> on the partial header checkbox. <code>⇧</code>-click selects a range.</>,
        }}
        today="No bulk selection exists — changing status on twelve tasks is twelve drawer visits.">
        <TableDemo hint="Check a couple of rows, then the header checkbox" />
      </IxCard>

      <IxCard n="10.3" t="Inline cell edit" trig="click a cell"
        lede="Status, priority and assignee are single-click because they are pick-one fields. Text cells need a double-click, so a click can still select the row."
        spec={{
          entry: <>Cell swaps to a control in place at the same metrics, {num('120ms')}. No row height change.</>,
          active: <>Pick-one fields open their list immediately on focus, so the interaction is click → click. Escape restores the previous value.</>,
          dismiss: <>Selection commits and closes · blur commits · <code>Esc</code> reverts</>,
          exit: <>Control reverts to the chip, which runs one <code>--primary</code> flash to confirm the save. <code>Tab</code> moves to the next editable cell in the row.</>,
          mobile: <>Cell opens a bottom sheet; the table does not scroll horizontally to reach the control.</>,
          tokens: <><code>--primary</code> flash · <code>STATUS</code> and <code>PRIO</code> colours</>,
          handler: <>Optimistic <code>PATCH</code> per cell. On failure the old value returns and the cell tints <code>--danger-container</code> for {num('1.6s')}.</>,
        }}
        today="Every edit goes through the drawer. The table is read-only, which is why people export to Excel.">
        <TableDemo hint="Click a status or priority cell" />
      </IxCard>

      <IxCard n="10.4" t="Filter builder" trig="click Filter"
        lede="Field, then operator, then value — three short lists rather than one form. Applied filters live as chips above the table where they can be removed one at a time."
        spec={{
          entry: <>Popover from the button, <code>scale(.97)→1</code> {num('140ms')}. A step rail shows Field · Operator · Value so the depth is never a surprise.</>,
          active: <>Each step replaces the last in the same popover — no back button needed, because choosing again from the chip re-enters the flow. <code>is empty</code> skips the value step entirely.</>,
          dismiss: <>Value selection applies and closes · click outside · <code>Esc</code></>,
          exit: <>Popover fades; the chip enters the bar with <code>translateY(-4px)</code> + fade {num('180ms')}.</>,
          mobile: <>Full-height sheet, one step per screen, <code>48px</code> rows.</>,
          tokens: <><code>--secondary-container</code> chip · <code>--r-pill</code></>,
          handler: <>Filters serialise into the URL so a filtered view is a shareable link. Multiple filters are ANDed; OR needs an explicit group and is deliberately out of scope for v1.</>,
        }}
        today="A fixed set of dropdowns above the table. No compound filters, and the state is not in the URL, so a filtered view cannot be sent to anyone.">
        <TableDemo hint="Press Filter and walk the three steps" h={400} />
      </IxCard>
    </>
  );
}

window.IX_SECTIONS.push(
  { id: 'ix-kanban', n: '09', group: 'Views', title: 'Kanban', hi: 'फलक', src: 'views/KanbanView.jsx · KanbanCard.jsx', count: 4, Comp: IxSecKanban },
  { id: 'ix-table', n: '10', group: 'Views', title: 'Table', hi: 'सूची', src: 'views/TableView.jsx', count: 4, Comp: IxSecTable },
);
Object.assign(window, { KanbanDemo, TableDemo, IxSecKanban, IxSecTable, KCOLS, KCARDS });
