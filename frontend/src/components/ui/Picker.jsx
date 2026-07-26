import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { Avatar, AvatarStack } from './Avatar';

/**
 * One picker. Four modes: person · option · multi · date.
 * (26-component-inventory.md §4 — the largest unspecified piece, in the
 * most-used surface.)
 *
 * The drawer ships FOUR independently-written pickers — assignee, date,
 * priority, category. Between them: four dismiss behaviours (two do not close
 * on Escape), one hardcoded `z-index: 300`, one hardcoded upward placement, no
 * arrow-key support anywhere, and four separate mobile treatments.
 *
 *   <Picker mode="person" items={members}    value={id}  onChange={set} />
 *   <Picker mode="multi"  items={members}    value={ids} onChange={set} />
 *   <Picker mode="option" items={PRIORITIES} value={p}   onChange={set} />
 *   <Picker mode="option" items={cats} onCreate={mk} createLabel="New category" />
 *   <Picker mode="date"   value={due} onChange={setDue} />
 *
 * `up` / `right` replace every hardcoded `bottom: calc(100% + 4px)` in the
 * build. `search` defaults on above 6 items and off below — never a search box
 * over a four-item list.
 */

const Ic = {
  ch:    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="ch" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>,
  tick:  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>,
  tickS: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>,
  srch:  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.2-3.2" /></svg>,
  plus:  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>,
  prev:  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>,
  next:  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>,
};

const EXIT_MS = 130;

/**
 * Dismiss, roving focus and the exit animation, once instead of four times.
 *
 * The close path is `setClosing(true)` → unmount after 130ms, never a bare
 * `setOpen(false)`: the current pickers unmount instantly, so `dmPopOut` never
 * plays at all and the popover simply vanishes.
 *
 * Escape comes from `useDismiss`, which stops propagation — dismissing a picker
 * inside the task drawer must not also close the drawer behind it.
 */
export function usePicker(open, setOpen, rootRef, listRef) {
  const [closing, setClosing] = useState(false);
  const [cursor, setCursor] = useState(0);
  const timer = useRef(null);

  const close = useCallback(() => {
    setClosing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setClosing(false); setOpen(false); }, EXIT_MS);
  }, [setOpen]);

  useEffect(() => () => clearTimeout(timer.current), []);
  useDismiss(open, rootRef, close);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      const rows = listRef.current
        ? [...listRef.current.querySelectorAll('[data-pkrow]:not([disabled])')]
        : [];
      if (!rows.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(rows.length - 1, c + 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
      if (e.key === 'Home')      { e.preventDefault(); setCursor(0); }
      if (e.key === 'End')       { e.preventDefault(); setCursor(rows.length - 1); }
      if (e.key === 'Enter')     { e.preventDefault(); rows[cursor]?.click(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, cursor, listRef]);

  useEffect(() => { if (!open) setCursor(0); }, [open]);

  return { closing, close, cursor, setCursor };
}

function PkPop({ closing, up, right, width, children, ...rest }) {
  const cls = ['pk__pop', closing ? 'is-closing' : '', up ? 'pk__pop--up' : '', right ? 'pk__pop--right' : '']
    .filter(Boolean).join(' ');
  return <div className={cls} style={width ? { minWidth: width } : undefined} role="dialog" {...rest}>{children}</div>;
}

function PkRow({ on, cursor, box, onClick, children }) {
  const cls = ['pk__row', on ? 'on' : '', cursor ? 'is-cursor' : ''].filter(Boolean).join(' ');
  return (
    <button type="button" data-pkrow className={cls} role="option" aria-selected={!!on} onClick={onClick}>
      {children}
      {box
        ? <span className="pk__box">{Ic.tickS}</span>
        : <span className="pk__tick">{Ic.tick}</span>}
    </button>
  );
}

const nameOf = it => it?.name ?? it?.label ?? '';

export function Picker({
  mode = 'option', items = [], value, onChange,
  placeholder = 'Select', search, field, up, right,
  onCreate, createLabel, disabled, width, ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const { closing, close, cursor, setCursor } = usePicker(open, setOpen, rootRef, listRef);

  useEffect(() => { if (!open) setQ(''); }, [open]);

  if (mode === 'date') {
    return <PickerDate {...{ value, onChange, placeholder, field, up, right, disabled, ariaLabel }} />;
  }

  const multi = mode === 'multi';
  const sel = multi ? (value || []) : value;
  const shown = q ? items.filter(i => nameOf(i).toLowerCase().includes(q.toLowerCase())) : items;

  const pick = (it) => {
    if (multi) {
      const has = sel.includes(it.id);
      onChange?.(has ? sel.filter(x => x !== it.id) : [...sel, it.id]);
      return;                        // multi stays open; single-select closes
    }
    onChange?.(it.id);
    close();
  };

  const current = !multi && sel != null ? items.find(i => i.id === sel) : null;
  let label = placeholder;
  let empty = true;
  if (multi && sel.length) {
    label = sel.length === 1 ? nameOf(items.find(i => i.id === sel[0])) || placeholder : `${sel.length} selected`;
    empty = false;
  } else if (current) {
    label = nameOf(current);
    empty = false;
  }

  return (
    <div ref={rootRef} className={`pk ${field ? 'pk--field' : ''}`.trim()} style={width ? { width } : undefined}>
      <button
        type="button"
        className={`pk__tr ${empty ? 'is-empty' : ''}`.trim()}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {current && mode === 'person' && <Avatar name={label} size={19} />}
        {current?.color && <span className="pdot" style={{ background: current.color }} />}
        {multi && sel.length > 1 && (
          <AvatarStack
            size={19}
            users={sel.map(id => ({ id, name: nameOf(items.find(x => x.id === id)) }))}
          />
        )}
        <span className="pk__lbl">{label}</span>
        {Ic.ch}
      </button>

      {open && (
        <PkPop closing={closing} up={up} right={right} aria-label={ariaLabel || placeholder}>
          {search !== false && (search === true || items.length > 6) && (
            <div className="pk__srch">
              {Ic.srch}
              <input
                autoFocus
                value={q}
                placeholder="Search"
                aria-label="Search options"
                onChange={e => { setQ(e.target.value); setCursor(0); }}
              />
            </div>
          )}
          <div className="pk__list" ref={listRef} role="listbox" aria-multiselectable={multi || undefined}>
            {shown.length === 0 && <div className="pk__none">{q ? `No match for “${q}”` : 'Nothing to choose from'}</div>}
            {shown.map((it, i) => (
              <PkRow
                key={it.id}
                on={multi ? sel.includes(it.id) : sel === it.id}
                cursor={cursor === i}
                box={multi}
                onClick={() => pick(it)}
              >
                {mode === 'person' && <Avatar name={nameOf(it)} size={22} />}
                {it.color && <span className="pdot" style={{ background: it.color }} />}
                <span className="pk__b">
                  <span className="pk__n">{nameOf(it)}</span>
                  {it.meta && <span className="pk__m">{it.meta}</span>}
                </span>
              </PkRow>
            ))}
          </div>
          {/* The create row carries whatever is in the search box, so typing a
              name that does not exist yet is one keystroke from making it. */}
          {onCreate && (
            <>
              <div className="pk__sep" />
              <button type="button" className="pk__new" onClick={() => { onCreate(q); close(); }}>
                {Ic.plus}{createLabel || 'Create'}{q && ` “${q}”`}
              </button>
            </>
          )}
        </PkPop>
      )}
    </div>
  );
}

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** en-IN, pinned. The table view used the BROWSER's locale, so the same date
 *  rendered two ways on two screens of the same app. */
const fmtD = d => !d ? null : d.toLocaleDateString('en-IN', {
  day: 'numeric', month: 'short',
  year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
});

export function PickerDate({ value, onChange, placeholder, field, up, right, disabled, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const { closing, close } = usePicker(open, setOpen, rootRef, listRef);
  const selected = value ? new Date(value) : null;
  const [view, setView] = useState(() => (selected || new Date()));

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const y = view.getFullYear(), m = view.getMonth();
  const first = new Date(y, m, 1).getDay();
  const len = new Date(y, m + 1, 0).getDate();
  const prevLen = new Date(y, m, 0).getDate();

  const cells = [];
  for (let i = first - 1; i >= 0; i--) cells.push({ d: prevLen - i, out: true, date: new Date(y, m - 1, prevLen - i) });
  for (let d = 1; d <= len; d++) cells.push({ d, date: new Date(y, m, d) });
  while (cells.length % 7) { const d = cells.length - first - len + 1; cells.push({ d, out: true, date: new Date(y, m + 1, d) }); }

  const same = (a, b) => a && b && a.toDateString() === b.toDateString();
  const set = (d) => { onChange?.(d); close(); };

  return (
    <div ref={rootRef} className={`pk ${field ? 'pk--field' : ''}`.trim()}>
      <button
        type="button"
        className={`pk__tr ${selected ? '' : 'is-empty'}`.trim()}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="pk__lbl">{selected ? fmtD(selected) : placeholder || 'No date'}</span>
        {Ic.ch}
      </button>

      {open && (
        <PkPop closing={closing} up={up} right={right} width={256} aria-label={ariaLabel || 'Choose a date'}>
          {/* Quick row ABOVE the calendar. Today and Tomorrow are the answer
              most of the time and should not be scrolled past. */}
          <div className="pk__quick">
            {[['Today', 0], ['Tomorrow', 1], ['Next week', 7]].map(([l, n]) => (
              <button key={l} type="button" className="pk__q" onClick={() => {
                const d = new Date(today); d.setDate(d.getDate() + n); set(d);
              }}>{l}</button>
            ))}
            {selected && <button type="button" className="pk__q" onClick={() => set(null)}>Clear</button>}
          </div>
          <div className="pk__cal" ref={listRef}>
            <div className="pk__calh">
              <button type="button" className="pk__cnav" aria-label="Previous month" onClick={() => setView(new Date(y, m - 1, 1))}>{Ic.prev}</button>
              <span className="pk__calt">{MON[m]} {y}</span>
              <button type="button" className="pk__cnav" aria-label="Next month" onClick={() => setView(new Date(y, m + 1, 1))}>{Ic.next}</button>
            </div>
            <div className="pk__grid" role="grid">
              {DOW.map((d, i) => <span className="pk__dow" key={`${d}-${i}`} aria-hidden="true">{d}</span>)}
              {cells.map((c) => {
                const cls = ['pk__d', c.out ? 'out' : '', same(c.date, today) ? 'today' : '', same(c.date, selected) ? 'on' : '']
                  .filter(Boolean).join(' ');
                return (
                  <button key={c.date.toISOString()} type="button" data-pkrow className={cls}
                    aria-current={same(c.date, today) ? 'date' : undefined}
                    onClick={() => set(c.date)}>{c.d}</button>
                );
              })}
            </div>
          </div>
        </PkPop>
      )}
    </div>
  );
}

export default Picker;
