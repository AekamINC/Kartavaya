import React, { useLayoutEffect, useRef, useState } from 'react';
import { usePicker } from './Picker';
import CalendarGrid from './CalendarGrid';
import MonthGrid, { fmtMonth, parseMonth } from './MonthGrid';

/**
 * DateInput — a drop-in replacement for `<input type="date">`,
 * `type="datetime-local"`, `type="time"` and `type="month"`.
 *
 * ⚠ `month` WAS THE HOLE, and it was a named one. `Field.jsx` forwarded the
 * other three here and not this, so five screens still emitted the native
 * widget the rule bans — three of them Vetana, where a wrong month does not
 * fail loudly but files against a payroll run that will never look at it. Suite
 * 20.04 failed on this deliberately and called the fix a feature rather than a
 * one-liner; `MonthGrid.jsx` is that feature.
 *
 * There were 91 of those three across 53 files. Two complaints follow from that
 * and neither can be fixed on the native control:
 *
 *   1. "light white colour and not readable" — the browser paints its own
 *      calendar, and with no `color-scheme` declared it always painted the
 *      LIGHT one, over the dark theme. That half is fixed in
 *      kartavaya-design.css and now applies to every remaining native widget.
 *   2. "it opens to the side of the field, it needs to start underneath the
 *      picker icon" — the native popup's position is the browser's to choose
 *      and is not addressable from CSS at all. The only fix is to stop using
 *      the native popup.
 *
 * So the calendar is ours: `.pk__pop`, which is `top: calc(100% + 5px);
 * left: 0` off the trigger — underneath, left-aligned, in theme tokens. It
 * flips up or right only when the viewport has no room, measured on open.
 *
 * The API is deliberately the input's, not a nicer one, so a call site changes
 * by its tag alone and `onChange={e => set(e.target.value)}` keeps working:
 *
 *   - the native input, with className / type / value / onChange as written
 *   + <DateInput …the same props…>
 *
 * `value` and the value handed back are the same strings the input used —
 * `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, `HH:mm` — parsed and built by hand rather
 * than through Date.toISOString(), which is UTC and moves an IST date back a
 * day for every time before 05:30.
 */

const Ic = {
  cal: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  ),
  clock: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />
    </svg>
  ),
};

/* The month names, the weekday initials and the two chevrons went to
   CalendarGrid along with the header that used them. */
const p2 = n => String(n).padStart(2, '0');

/** `2026-08-09` → a LOCAL midnight Date. `new Date(s)` parses that shape as UTC. */
const parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d;
};
const fmtDay = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const parseTime = (s) => {
  const m = /(\d{1,2}):(\d{2})/.exec(s || '');
  return m ? { h: Math.min(23, +m[1]), min: Math.min(59, +m[2]) } : null;
};

/** en-IN, pinned — the same choice PickerDate made, and for the same reason:
 *  the browser's locale rendered one date two ways on two screens. */
const label = (type, value) => {
  if (type === 'time') {
    const t = parseTime(value);
    return t ? new Date(2000, 0, 1, t.h, t.min).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : null;
  }
  if (type === 'month') {
    // `parseDay` cannot serve here: `2026-08` has no day component, so the
    // regex fails and every month would render as the empty placeholder.
    const mm = parseMonth(value);
    return mm ? new Date(mm.y, mm.m, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : null;
  }
  const d = parseDay(value);
  if (!d) return null;
  const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  if (type !== 'datetime-local') return day;
  const t = parseTime(value.slice(11));
  return t ? `${day}, ${new Date(2000, 0, 1, t.h, t.min).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : day;
};

const TIMES = Array.from({ length: 48 }, (_, i) => `${p2(Math.floor(i / 2))}:${p2((i % 2) * 30)}`);

export default function DateInput({
  type = 'date', value: valueProp, defaultValue, onChange, name, className = '', disabled, required,
  min, max, placeholder, id, style, autoFocus, onKeyDown, onBlur,
  'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy,
}) {
  // The inline table editor is UNCONTROLLED (`defaultValue` + read on Enter),
  // so the component has to hold the value itself when no `value` is passed —
  // exactly as the input it replaces did.
  const [inner, setInner] = useState(defaultValue ?? '');
  const controlled = valueProp !== undefined;
  const value = controlled ? valueProp : inner;
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const popRef = useRef(null);
  const [flip, setFlip] = useState({ up: false, right: false });
  const { closing, close, onExitEnd } = usePicker(open, setOpen, rootRef, listRef);

  const withTime = type === 'datetime-local';
  const isMonth = type === 'month';
  const dayPart = type === 'time' ? '' : (value || '').slice(0, 10);
  const timePart = type === 'time' ? (value || '') : (value || '').slice(11, 16);
  const selected = parseDay(dayPart);

  // Placement is measured, not guessed: `.pk__pop` is already anchored under
  // the trigger, and it flips only when there is genuinely no room — a field
  // near the bottom of a modal would otherwise open off-screen, which is the
  // behaviour being complained about.
  useLayoutEffect(() => {
    if (!open || !popRef.current || !rootRef.current) return;
    const t = rootRef.current.getBoundingClientRect();
    const p = popRef.current.getBoundingClientRect();
    setFlip({
      up: t.bottom + p.height + 8 > window.innerHeight && t.top - p.height - 8 > 0,
      right: t.left + p.width + 8 > window.innerWidth,
    });
  }, [open]);

  const emit = (v) => {
    if (!controlled) setInner(v);
    onChange?.({ target: { value: v, name, id, type } });
  };
  const minDay = parseDay(min);
  const maxDay = parseDay(max);

  const pickDay = (d) => {
    const s = fmtDay(d);
    if (withTime) { emit(`${s}T${timePart || '09:00'}`); close(); return; }
    emit(s);
    close();
  };
  const pickTime = (hm) => {
    if (type === 'time') { emit(hm); close(); return; }
    emit(`${dayPart || fmtDay(new Date())}T${hm}`);
    close();
  };
  const pickMonth = (ym) => { emit(fmtMonth(ym)); close(); };

  // The month view, the cell loop and the day-comparison helper all live in
  // CalendarGrid now — this file no longer draws a calendar. `today` stays:
  // the Today/Tomorrow/Next week row above the grid is still ours.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const shown = label(type, value);

  const cls = ['pk', 'pk--field', 'pk--dt', className].filter(Boolean).join(' ');
  const popCls = ['pk__pop', closing ? 'is-closing' : '', flip.up ? 'pk__pop--up' : '', flip.right ? 'pk__pop--right' : ''].filter(Boolean).join(' ');

  return (
    <div
      ref={rootRef}
      className={cls}
      style={style}
      /* onBlur belongs on the ROOT, not the trigger. The table's inline editor
         passes `onBlur={() => setEditing(null)}`; on the trigger that fires the
         moment the calendar is clicked, which unmounts the editor before the
         day button can be pressed — the edit could never be completed. */
      onBlur={onBlur ? (e) => {
        if (open) return;
        if (e.currentTarget.contains(e.relatedTarget)) return;
        onBlur(e);
      } : undefined}
    >
      {/* The native control stays in the DOM, visually hidden and out of the
          tab order. It is not decoration: it keeps form serialisation by
          `name`, and it keeps `input[type="date"]` working for the tests and
          for anything that sets a value programmatically. `required` is
          deliberately NOT forwarded — a hidden required field makes the
          browser refuse to submit with an error it cannot show, so the
          requirement is carried as `aria-required` on the trigger. */}
      <input
        className="pk__native"
        type={type}
        name={name}
        value={value || ''}
        min={min}
        max={max}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={e => emit(e.target.value)}
      />
      <button
        type="button"
        id={id}
        className={`pk__tr ${shown ? '' : 'is-empty'}`.trim()}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-required={required || undefined}
        disabled={disabled}
        /* eslint-disable-next-line jsx-a11y/no-autofocus */
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="pk__dti" aria-hidden="true">{type === 'time' ? Ic.clock : Ic.cal}</span>
        <span className="pk__lbl">
          {shown || placeholder || (type === 'time' ? 'No time' : isMonth ? 'No month' : 'No date')}
        </span>
      </button>

      {open && (
        <div ref={popRef} className={popCls} role="dialog" onAnimationEnd={onExitEnd} aria-label={ariaLabel || (isMonth ? 'Choose a month' : 'Choose a date')} style={{ minWidth: 256 }}>
          {isMonth && (
            <>
              <div className="pk__quick">
                {/* The months a payroll or filing screen actually reaches for.
                    "Next month" is deliberately absent: every month field in
                    the product carries `max={thisMonth()}` because you cannot
                    run a payroll or file a return for a month that has not
                    happened, and a quick button that lands on a blocked value
                    would be a control that refuses itself. */}
                {[['This month', 0], ['Last month', -1]].map(([l, n]) => (
                  <button key={l} type="button" className="pk__q" onClick={() => {
                    const d = new Date(today.getFullYear(), today.getMonth() + n, 1);
                    pickMonth({ y: d.getFullYear(), m: d.getMonth() });
                  }}>{l}</button>
                ))}
                {value && !required && <button type="button" className="pk__q" onClick={() => { emit(''); close(); }}>Clear</button>}
              </div>
              <div ref={listRef}>
                <MonthGrid value={value} min={min} max={max} onPick={pickMonth} />
              </div>
            </>
          )}

          {type !== 'time' && !isMonth && (
            <>
              <div className="pk__quick">
                {[['Today', 0], ['Tomorrow', 1], ['Next week', 7]].map(([l, n]) => (
                  <button key={l} type="button" className="pk__q" onClick={() => { const d = new Date(today); d.setDate(d.getDate() + n); pickDay(d); }}>{l}</button>
                ))}
                {value && !required && <button type="button" className="pk__q" onClick={() => { emit(''); close(); }}>Clear</button>}
              </div>
              <div ref={listRef}>
                {/* One grid, shared with PickerDate. `min`/`max` were the only
                    thing this copy did that the other did not, so they are a
                    prop rather than a second calendar. */}
                <CalendarGrid value={selected} min={minDay} max={maxDay} onPick={pickDay} />
              </div>
            </>
          )}

          {(withTime || type === 'time') && (
            <div className="pk__times" ref={type === 'time' ? listRef : undefined} role="listbox" aria-label="Time">
              {TIMES.map(hm => (
                <button key={hm} type="button" data-pkrow role="option" aria-selected={timePart === hm}
                  className={`pk__t ${timePart === hm ? 'on' : ''}`.trim()}
                  onClick={() => pickTime(hm)}>
                  {new Date(2000, 0, 1, +hm.slice(0, 2), +hm.slice(3)).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { DateInput };
