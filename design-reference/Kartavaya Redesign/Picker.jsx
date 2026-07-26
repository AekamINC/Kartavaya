// One picker. Four modes: person · option · multi · date.
// Replaces PersonPicker, DatePicker, PriorityPicker and CategoryPicker —
// four independent implementations with four different dismiss behaviours.
const PkIc = {
  ch: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="ch"><path d="M6 9l6 6 6-6" /></svg>,
  tick: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>,
  tickS: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>,
  srch: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.2-3.2" /></svg>,
  plus: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  prev: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>,
  next: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>,
};

// Dismiss, roving focus and exit animation live here once — not in four places.
function usePicker(open, setOpen, listRef) {
  const [closing, setClosing] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const close = React.useCallback(() => {
    setClosing(true);
    setTimeout(() => { setClosing(false); setOpen(false); }, 130);
  }, [setOpen]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      const rows = listRef.current ? [...listRef.current.querySelectorAll('[data-pkrow]:not([disabled])')] : [];
      if (!rows.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(rows.length - 1, c + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
      if (e.key === 'Home') { e.preventDefault(); setCursor(0); }
      if (e.key === 'End') { e.preventDefault(); setCursor(rows.length - 1); }
      if (e.key === 'Enter') { e.preventDefault(); rows[cursor] && rows[cursor].click(); }
    };
    const onDown = e => { if (!e.target.closest('.pk')) close(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown); };
  }, [open, cursor, close, listRef]);
  React.useEffect(() => { if (!open) setCursor(0); }, [open]);
  return { closing, close, cursor, setCursor };
}

function PkPop({ closing, up, right, w, children }) {
  return <div className={'pk__pop' + (closing ? ' is-closing' : '') + (up ? ' pk__pop--up' : '') + (right ? ' pk__pop--right' : '')} style={w ? { minWidth: w } : null} role="dialog">{children}</div>;
}

function PkRow({ on, cursor, box, onClick, children }) {
  return (
    <button type="button" data-pkrow className={'pk__row' + (on ? ' on' : '') + (cursor ? ' is-cursor' : '')} role="option" aria-selected={!!on} onClick={onClick}>
      {children}
      {box ? <span className="pk__box">{PkIc.tickS}</span> : <span className="pk__tick">{PkIc.tick}</span>}
    </button>
  );
}

// ── The picker ───────────────────────────────────────────────────────────────
// mode: 'option' | 'person' | 'multi' | 'date'
function Picker({ mode = 'option', items = [], value, onChange, placeholder = 'Select', search, field, up, right, onCreate, createLabel, disabled, width }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const listRef = React.useRef(null);
  const { closing, close, cursor, setCursor } = usePicker(open, setOpen, listRef);
  React.useEffect(() => { if (!open) setQ(''); }, [open]);

  if (mode === 'date') return <PickerDate {...{ value, onChange, placeholder, field, up, right, disabled }} />;

  const multi = mode === 'multi';
  const sel = multi ? (value || []) : value;
  const shown = q ? items.filter(i => (i.name || i.label).toLowerCase().includes(q.toLowerCase())) : items;
  const pick = it => { if (multi) { const has = sel.includes(it.id); onChange(has ? sel.filter(x => x !== it.id) : [...sel, it.id]); } else { onChange(it.id); close(); } };

  let label = placeholder, empty = true;
  if (multi && sel.length) { label = sel.length === 1 ? (items.find(i => i.id === sel[0]) || {}).name : sel.length + ' selected'; empty = false; }
  else if (!multi && sel != null) { const it = items.find(i => i.id === sel); if (it) { label = it.name || it.label; empty = false; } }

  return (
    <div className={'pk' + (field ? ' pk--field' : '')} style={width ? { width } : null}>
      <button type="button" className={'pk__tr' + (empty ? ' is-empty' : '')} aria-expanded={open} aria-haspopup="listbox" disabled={disabled} onClick={() => open ? close() : setOpen(true)}>
        {!empty && !multi && mode === 'person' && <Av n={label} sz={19} />}
        {!empty && !multi && mode === 'option' && (items.find(i => i.id === sel) || {}).color && <span className="pdot" style={{ background: (items.find(i => i.id === sel) || {}).color }} />}
        {multi && sel.length > 1 && <AvStack ids={sel} items={items} />}
        <span className="pk__lbl">{label}</span>
        {PkIc.ch}
      </button>
      {open && (
        <PkPop closing={closing} up={up} right={right}>
          {search !== false && items.length > 6 && (
            <div className="pk__srch">{PkIc.srch}<input autoFocus value={q} placeholder="Search" onChange={e => { setQ(e.target.value); setCursor(0); }} /></div>
          )}
          <div className="pk__list" ref={listRef} role="listbox" aria-multiselectable={multi}>
            {shown.length === 0 && <div className="pk__none">No match for “{q}”</div>}
            {shown.map((it, i) => (
              <PkRow key={it.id} on={multi ? sel.includes(it.id) : sel === it.id} cursor={cursor === i} box={multi} onClick={() => pick(it)}>
                {mode === 'person' && <Av n={it.name} sz={22} />}
                {it.color && <span className="pdot" style={{ background: it.color }} />}
                <span className="pk__b"><span className="pk__n">{it.name || it.label}</span>{it.meta && <span className="pk__m">{it.meta}</span>}</span>
              </PkRow>
            ))}
          </div>
          {onCreate && <><div className="pk__sep" /><button type="button" className="pk__new" onClick={() => { onCreate(q); close(); }}>{PkIc.plus}{createLabel || 'Create'}{q && ' “' + q + '”'}</button></>}
        </PkPop>
      )}
    </div>
  );
}

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const fmtD = d => !d ? null : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

function PickerDate({ value, onChange, placeholder, field, up, right, disabled }) {
  const [open, setOpen] = React.useState(false);
  const listRef = React.useRef(null);
  const { closing, close } = usePicker(open, setOpen, listRef);
  const [view, setView] = React.useState(() => value ? new Date(value) : new Date());
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const y = view.getFullYear(), m = view.getMonth();
  const first = new Date(y, m, 1).getDay(), len = new Date(y, m + 1, 0).getDate(), prevLen = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = first - 1; i >= 0; i--) cells.push({ d: prevLen - i, out: true, date: new Date(y, m - 1, prevLen - i) });
  for (let d = 1; d <= len; d++) cells.push({ d, date: new Date(y, m, d) });
  while (cells.length % 7) { const d = cells.length - first - len + 1; cells.push({ d, out: true, date: new Date(y, m + 1, d) }); }
  const same = (a, b) => a && b && a.toDateString() === b.toDateString();
  const set = d => { onChange(d); close(); };
  const quick = [['Today', 0], ['Tomorrow', 1], ['Next week', 7]];

  return (
    <div className={'pk' + (field ? ' pk--field' : '')}>
      <button type="button" className={'pk__tr' + (value ? '' : ' is-empty')} aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={() => open ? close() : setOpen(true)}>
        <span className="pk__lbl">{value ? fmtD(value) : placeholder || 'No date'}</span>{PkIc.ch}
      </button>
      {open && (
        <PkPop closing={closing} up={up} right={right} w={256}>
          <div className="pk__quick">
            {quick.map(([l, n]) => <button key={l} type="button" className="pk__q" onClick={() => { const d = new Date(today); d.setDate(d.getDate() + n); set(d); }}>{l}</button>)}
            {value && <button type="button" className="pk__q" onClick={() => set(null)}>Clear</button>}
          </div>
          <div className="pk__cal" ref={listRef}>
            <div className="pk__calh">
              <button type="button" className="pk__cnav" aria-label="Previous month" onClick={() => setView(new Date(y, m - 1, 1))}>{PkIc.prev}</button>
              <span className="pk__calt">{MON[m]} {y}</span>
              <button type="button" className="pk__cnav" aria-label="Next month" onClick={() => setView(new Date(y, m + 1, 1))}>{PkIc.next}</button>
            </div>
            <div className="pk__grid">
              {DOW.map((d, i) => <span className="pk__dow" key={i}>{d}</span>)}
              {cells.map((c, i) => (
                <button key={i} type="button" data-pkrow className={'pk__d' + (c.out ? ' out' : '') + (same(c.date, today) ? ' today' : '') + (same(c.date, value) ? ' on' : '')} onClick={() => set(c.date)}>{c.d}</button>
              ))}
            </div>
          </div>
        </PkPop>
      )}
    </div>
  );
}

const AV_BG = ['#0F6E66', '#8A5A2B', '#5B4A7C', '#2F6B4F', '#8C3F52', '#3E5C8A'];
function Av({ n = '?', sz = 22 }) {
  const init = n.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return <span style={{ flex: 'none', width: sz, height: sz, borderRadius: '50%', background: AV_BG[h % AV_BG.length], color: '#fff', display: 'grid', placeItems: 'center', fontSize: Math.round(sz * .41), fontWeight: 600, letterSpacing: '.01em' }}>{init}</span>;
}
function AvStack({ ids, items }) {
  return <span style={{ display: 'flex', flex: 'none' }}>{ids.slice(0, 3).map((id, i) => <span key={id} style={{ marginLeft: i ? -6 : 0, borderRadius: '50%', boxShadow: '0 0 0 1.5px var(--s-low)' }}><Av n={(items.find(x => x.id === id) || {}).name || '?'} sz={19} /></span>)}</span>;
}

Object.assign(window, { Picker, PickerDate, Av, AvStack, PkIc, usePicker, PkPop, PkRow });
