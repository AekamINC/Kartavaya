import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import CalendarGrid from './CalendarGrid';
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
  ch:    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="pk-chev" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>,
  tick:  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>,
  tickS: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>,
  srch:  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.2-3.2" /></svg>,
  plus:  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>,
};

/**
 * A CEILING, not the exit duration. The unmount is driven by `animationend`;
 * this only covers the case where the event never arrives (panel hidden or the
 * animation interrupted), so it must sit ABOVE the CSS duration.
 *
 * It used to be a flat 130ms against a CSS exit of `--dur-fast` —
 * `calc(140ms * var(--ix))` — so it was wrong at every setting of the user's
 * Animations preference: 10ms early at `full`, 60ms of dead panel at `reduced`,
 * and a full 130ms wait at `none`, which is the setting that asks for none.
 * `.pk__pop.is-closing` is `dmSheetOut var(--dur-base)` in the mobile sheet
 * form as well, so one constant could never have matched both.
 */
const EXIT_FALLBACK_MS = 500;

/**
 * Dismiss, roving focus and the exit animation, once instead of four times.
 *
 * The close path is `setClosing(true)` → unmount when the exit animation ends,
 * never a bare `setOpen(false)`: the current pickers unmount instantly, so
 * `dmPopOut` never plays at all and the popover simply vanishes.
 *
 * Escape comes from `useDismiss`, which stops propagation — dismissing a picker
 * inside the task drawer must not also close the drawer behind it.
 */
export function usePicker(open, setOpen, rootRef, listRef, opts = {}) {
  // Options, not extra positional arguments: `DateInput.jsx` calls this with
  // the original four and must keep behaving exactly as it did — a calendar
  // has no rows to type ahead into and no listbox to move focus onto.
  const { typeahead = false, focusList = false, triggerRef = null, cursorAtOpen = 0 } = opts;
  const [closing, setClosing] = useState(false);
  const [cursor, setCursor] = useState(0);
  const timer = useRef(null);
  const buf = useRef('');
  const bufTimer = useRef(null);
  // See Popover.jsx: the handler must distinguish the exit animation from the
  // entrance, and a closure over `closing` would hold the value from the render
  // that installed it. Without this the picker closes as soon as it opens.
  const closingRef = useRef(false);

  const finish = useCallback(() => {
    clearTimeout(timer.current);
    closingRef.current = false;
    setClosing(false);
    setOpen(false);
  }, [setOpen]);

  const close = useCallback(() => {
    closingRef.current = true;
    setClosing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(finish, EXIT_FALLBACK_MS);
    // Focus goes back NOW, not when the exit finishes. A keyboard user who
    // closes a picker in a form must land back on the field they came from —
    // deferring it would leave focus inside a panel that is already leaving,
    // and if the panel is what held focus, on nothing at all once it unmounts.
    triggerRef?.current?.focus?.();
  }, [finish, triggerRef]);

  // Rows animate on hover and the list shimmers while loading, so the panel's
  // own exit has to be told apart from anything bubbling out of its children.
  const onExitEnd = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    if (!closingRef.current) return;
    finish();
  }, [finish]);

  useEffect(() => () => clearTimeout(timer.current), []);
  useDismiss(open, rootRef, close);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      const rows = listRef.current
        ? [...listRef.current.querySelectorAll('[data-pkrow]:not([disabled])')]
        : [];
      if (!rows.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(rows.length - 1, c + 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); return; }
      if (e.key === 'Home')      { e.preventDefault(); setCursor(0); return; }
      if (e.key === 'End')       { e.preventDefault(); setCursor(rows.length - 1); return; }
      if (e.key === 'Enter')     { e.preventDefault(); rows[cursor]?.click(); return; }
      // Tab out of an open picker commits nothing and closes — leaving the
      // panel open while focus walks off into the form behind it is the one
      // outcome no user means.
      if (e.key === 'Tab') { close(); return; }

      /**
       * TYPEAHEAD. The gap this fills is not exotic: on a four-item status
       * picker every user who has ever met a `<select>` types the first letter
       * of what they want, and until now nothing happened. It is off wherever
       * a search box is shown instead — the box IS the typeahead there, and a
       * buffer competing with it would move the cursor while the user is
       * still narrowing the list under it.
       */
      if (!typeahead) return;
      if (e.key.length !== 1 || !/\S/.test(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
      clearTimeout(bufTimer.current);
      buf.current += e.key.toLowerCase();
      // 700ms is the buffer, not a debounce: "on" must reach "On hold" as one
      // word, and a pause long enough to be a second attempt starts over.
      bufTimer.current = setTimeout(() => { buf.current = ''; }, 700);
      const at = rows.findIndex(r =>
        (r.querySelector('.pk__n')?.textContent || r.textContent || '')
          .trim().toLowerCase().startsWith(buf.current));
      if (at > -1) { e.preventDefault(); setCursor(at); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, cursor, listRef, typeahead, close]);

  // Opening lands on the row that is already selected, not on the first one.
  // Arrowing down from the top of a twelve-item list to reach the value you
  // are trying to change is not navigation, it is a penalty.
  useEffect(() => {
    if (!open) { setCursor(0); buf.current = ''; return; }
    setCursor(cursorAtOpen > 0 ? cursorAtOpen : 0);
  }, [open, cursorAtOpen]);

  /**
   * Focus moves INTO the list, which is what makes `aria-activedescendant`
   * mean anything: the attribute is only read on the element that holds focus,
   * so a cursor announced from a listbox nobody is focused on is announced to
   * nobody. Skipped when a search box is shown — that box autofocuses and
   * carries the attribute itself.
   */
  useEffect(() => {
    if (!open || !focusList) return;
    listRef.current?.focus?.();
  }, [open, focusList, listRef]);

  // Keep the cursor row in view. jsdom has no scrollIntoView at all, hence the
  // optional call rather than a feature test.
  useEffect(() => {
    if (!open) return;
    const rows = listRef.current?.querySelectorAll('[data-pkrow]:not([disabled])');
    rows?.[cursor]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, cursor, listRef]);

  useEffect(() => () => clearTimeout(bufTimer.current), []);

  return { closing, close, cursor, setCursor, onExitEnd };
}

function PkPop({ closing, up, right, width, children, ...rest }) {
  const cls = ['pk__pop', closing ? 'is-closing' : '', up ? 'pk__pop--up' : '', right ? 'pk__pop--right' : '']
    .filter(Boolean).join(' ');
  return <div className={cls} style={width ? { minWidth: width } : undefined} role="dialog" {...rest}>{children}</div>;
}

function PkRow({ id, on, cursor, box, onClick, children }) {
  const cls = ['pk__row', on ? 'on' : '', cursor ? 'is-cursor' : ''].filter(Boolean).join(' ');
  return (
    // `tabIndex={-1}`: the row is a real button and would otherwise be a tab
    // stop of its own, so Tab would walk the options one at a time instead of
    // leaving the picker. The listbox holds focus; the rows are pointed at.
    <button type="button" data-pkrow id={id} tabIndex={-1} className={cls} role="option" aria-selected={!!on} onClick={onClick}>
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
  const triggerRef = useRef(null);
  const uid = useId();

  const isMulti = mode === 'multi';
  const selNow = isMulti ? (value || []) : value;
  const hasSearch = search !== false && (search === true || items.length > 6);
  // Where the cursor starts. Computed here rather than inside the hook because
  // only the caller knows which row is the current value.
  const atOpen = !isMulti && selNow != null
    ? Math.max(0, items.findIndex(i => i.id === selNow))
    : 0;

  const { closing, close, cursor, setCursor, onExitEnd } = usePicker(
    open, setOpen, rootRef, listRef,
    { typeahead: !hasSearch, focusList: !hasSearch, triggerRef, cursorAtOpen: atOpen },
  );

  useEffect(() => { if (!open) setQ(''); }, [open]);

  if (mode === 'date') {
    return <PickerDate {...{ value, onChange, placeholder, field, up, right, disabled, ariaLabel }} />;
  }

  const multi = isMulti;
  const sel = selNow;
  const shown = q ? items.filter(i => nameOf(i).toLowerCase().includes(q.toLowerCase())) : items;
  const rowId = i => `${uid}-opt-${i}`;
  // The cursor is only real while the panel is open and not on its way out.
  const activeId = open && !closing && shown.length ? rowId(Math.min(cursor, shown.length - 1)) : undefined;

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
        ref={triggerRef}
        type="button"
        className={`pk__tr ${empty ? 'is-empty' : ''}`.trim()}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        // A collapsed listbox trigger opens on Down and Up — the ARIA
        // authoring practice for a select, and the keypress every user who has
        // met a native `<select>` tries first. Enter and Space come free with
        // a real `<button>`; adding them here would fire the click twice.
        onKeyDown={(e) => {
          if (open) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); }
        }}
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
        <PkPop closing={closing} up={up} right={right} onAnimationEnd={onExitEnd} aria-label={ariaLabel || placeholder}>
          {search !== false && (search === true || items.length > 6) && (
            <div className="pk__srch">
              {Ic.srch}
              <input
                /* `type="text"` is NOT redundant. A CSS attribute selector
                   matches the ATTRIBUTE, not the IDL property — `<input>` with
                   no `type` written on it is `input.type === 'text'` in JS and
                   still does not match `input[type="text"]` in CSS. That
                   selector is how mobile-responsive.css §Forms delivers the
                   16px that stops iOS Safari zooming the viewport on focus and
                   never zooming back out. This field is the search box inside
                   every picker popover — the one place in the app where a
                   touch user types — and it was the one input the rule could
                   not see. */
                type="text"
                autoFocus
                value={q}
                placeholder="Search"
                aria-label="Search options"
                // The search box holds focus, so it is the box — not the list
                // below it — that has to name the row the arrow keys are on.
                aria-activedescendant={activeId}
                aria-controls={`${uid}-list`}
                onChange={e => { setQ(e.target.value); setCursor(0); }}
              />
            </div>
          )}
          <div
            className="pk__list"
            id={`${uid}-list`}
            ref={listRef}
            role="listbox"
            // Focusable only when it is the thing that takes focus. With a
            // search box above, the list is pointed at from there instead.
            tabIndex={hasSearch ? undefined : -1}
            aria-activedescendant={hasSearch ? undefined : activeId}
            aria-multiselectable={multi || undefined}
          >
            {shown.length === 0 && <div className="pk__none">{q ? `No match for “${q}”` : 'Nothing to choose from'}</div>}
            {shown.map((it, i) => (
              <PkRow
                key={it.id}
                id={rowId(i)}
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

/* MON, DOW and the two chevrons moved to CalendarGrid with the month header. */

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
  const { closing, close, onExitEnd } = usePicker(open, setOpen, rootRef, listRef);
  const selected = value ? new Date(value) : null;
  // The month view, the cell loop and the day-comparison helper all moved into
  // CalendarGrid, which is now the only place a month is drawn.
  const today = new Date(); today.setHours(0, 0, 0, 0);
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
        <PkPop closing={closing} up={up} right={right} width={256} onAnimationEnd={onExitEnd} aria-label={ariaLabel || 'Choose a date'}>
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
          <div ref={listRef}>
            <CalendarGrid value={selected} onPick={set} />
          </div>
        </PkPop>
      )}
    </div>
  );
}

export default Picker;
