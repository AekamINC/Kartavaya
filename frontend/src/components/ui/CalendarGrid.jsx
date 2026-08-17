import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The month grid, once instead of twice.
 *
 * `PickerDate` (Picker.jsx) and `DateInput` carried byte-identical calendar
 * markup — same header, same `role="grid"`, same cell loop — and the second
 * copy existed only because the first was not reusable. Fixing the grid in one
 * of them would have left the other broken, and fixing both by hand would have
 * guaranteed they drift apart again on the next change.
 *
 * ── WHAT WAS WRONG WITH `role="grid"` ────────────────────────────────────
 * Both copies declared a grid and then supplied none of what the role means:
 *
 *   · NO ROWS AND NO CELLS. `role="grid"` with 42 buttons as direct children
 *     is a grid of one row, or of nothing — a screen reader announcing
 *     "column 3, row 4" has no structure to read that from, so it says
 *     nothing. Weeks are the entire reason a month is drawn as a table
 *     rather than a list.
 *   · NO KEYBOARD. `usePicker`'s generic row handler did technically reach
 *     these cells (they were marked `data-pkrow`), but it moves a cursor by
 *     ONE row per ArrowDown, and one cell down in a calendar is one WEEK, not
 *     one day. It also never rendered a cursor here, because `PickerDate`
 *     does not read the `cursor` it returns. So the arrow keys did something
 *     invisible and wrong at the same time. The cells no longer carry
 *     `data-pkrow`, which takes that handler out of the calendar entirely.
 *   · NO NAMES. Every cell was announced as a bare number. "14", with no
 *     month, no year and no weekday, in a control whose whole job is to say
 *     which 14th.
 *   · EVERY CELL A TAB STOP. 42 buttons, so Tab crossed the month one day at
 *     a time before reaching anything else.
 *
 * ── ROVING TABINDEX ──────────────────────────────────────────────────────
 * Exactly one cell is tabbable at a time and the arrow keys move which one.
 * That is the grid pattern: Tab enters and leaves the calendar as a unit,
 * arrows navigate inside it. Crossing a month boundary with an arrow key
 * changes the view rather than stopping at the edge, because a user heading
 * for the 1st of next month should not have to notice that a button exists.
 *
 * ── `display: contents` ON THE ROWS ──────────────────────────────────────
 * `.pk__grid` is a 7-column CSS grid whose direct children are the cells, so
 * wrapping each week in a real `<div role="row">` would make the ROWS the grid
 * items and collapse the month into a single column. `.pk__grow` is
 * `display: contents`, which puts the row in the accessibility tree and takes
 * it out of the layout. The browser bugs that once stripped `display: contents`
 * elements from the a11y tree were fixed in Chrome 89, Firefox 87 and Safari
 * 15.4; below those the row semantics are lost but the calendar still works
 * and still looks right, which is the correct way round for that trade.
 */

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
/** Sunday-first, matching the grid both callers already drew. */
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const Ic = {
  prev: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>,
  next: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>,
};

const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sameDay = (a, b) => !!a && !!b && a.toDateString() === b.toDateString();
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/** Month arithmetic for the VIEW, which is only ever a month anchor. */
const addMonths = (d, n) => { const x = new Date(d); x.setDate(1); x.setMonth(x.getMonth() + n); return x; };
/**
 * Month arithmetic for a DAY, which is a different problem: the 31st has no
 * counterpart in February, and both of the obvious implementations get it
 * wrong. `setMonth` rolls 31 Jan forward into March; normalising to the 1st
 * throws the day away entirely and lands PageDown on the 1st of every month.
 * Clamping to the last day of the month actually aimed at is the only answer
 * that keeps the user where they pointed.
 */
const addMonthsToDay = (d, n) => {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last));
};

/** en-IN, pinned — the same decision the rest of this folder already made. */
const fullName = d => d.toLocaleDateString('en-IN',
  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/**
 * @param value    the selected date, or null
 * @param min/max  inclusive bounds; cells outside them are disabled
 * @param onPick   called with a Date when a day is chosen
 * @param autoFocus move focus onto the grid when it mounts. True for a popover
 *                  that just opened; a caller with its own focus plan says no.
 */
export function CalendarGrid({ value, min, max, onPick, autoFocus = true }) {
  const selected = value ? midnight(value) : null;
  const today = useMemo(() => midnight(new Date()), []);

  const [view, setView] = useState(() => addMonths(selected || today, 0));
  // The one tabbable cell. Starts on the selection, or on today when there is
  // none — never on the 1st, which is nobody's answer.
  const [focusDay, setFocusDay] = useState(() => selected || today);
  const gridRef = useRef(null);
  // Focus follows `focusDay` only after a key or an explicit request, never on
  // an ordinary re-render — otherwise clicking a quick-pick button above the
  // calendar would yank focus back down into the grid.
  const wantFocus = useRef(autoFocus);

  const y = view.getFullYear();
  const m = view.getMonth();

  const weeks = useMemo(() => {
    const first = new Date(y, m, 1).getDay();
    const len = new Date(y, m + 1, 0).getDate();
    const prevLen = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = first - 1; i >= 0; i--) cells.push({ d: prevLen - i, out: true, date: new Date(y, m - 1, prevLen - i) });
    for (let d = 1; d <= len; d++) cells.push({ d, date: new Date(y, m, d) });
    while (cells.length % 7) { const d = cells.length - first - len + 1; cells.push({ d, out: true, date: new Date(y, m + 1, d) }); }
    const out = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [y, m]);

  const blocked = useCallback(d => (min && d < midnight(min)) || (max && d > midnight(max)), [min, max]);

  // Moving the cursor off the visible month brings the month with it.
  const goTo = useCallback((d) => {
    wantFocus.current = true;
    setFocusDay(d);
    if (d.getFullYear() !== view.getFullYear() || d.getMonth() !== view.getMonth()) {
      setView(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }, [view]);

  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    gridRef.current?.querySelector('[data-day][tabindex="0"]')?.focus?.();
  }, [focusDay, view]);

  const onKeyDown = (e) => {
    const k = e.key;
    let next = null;
    if (k === 'ArrowLeft') next = addDays(focusDay, -1);
    else if (k === 'ArrowRight') next = addDays(focusDay, 1);
    // One cell up or down is one WEEK. This is the whole reason a generic
    // list handler cannot drive a calendar.
    else if (k === 'ArrowUp') next = addDays(focusDay, -7);
    else if (k === 'ArrowDown') next = addDays(focusDay, 7);
    else if (k === 'Home') next = addDays(focusDay, -focusDay.getDay());
    else if (k === 'End') next = addDays(focusDay, 6 - focusDay.getDay());
    else if (k === 'PageUp') next = addMonthsToDay(focusDay, e.shiftKey ? -12 : -1);
    else if (k === 'PageDown') next = addMonthsToDay(focusDay, e.shiftKey ? 12 : 1);
    else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      if (!blocked(focusDay)) onPick?.(focusDay);
      return;
    } else return;

    e.preventDefault();
    goTo(next);
  };

  const stepMonth = (n) => {
    const nextView = addMonths(view, n);
    setView(nextView);
    // The cursor comes along, or it would sit on a month nobody is looking at.
    const day = Math.min(focusDay.getDate(), new Date(nextView.getFullYear(), nextView.getMonth() + 1, 0).getDate());
    wantFocus.current = false;          // a mouse click on the chevron keeps its own focus
    setFocusDay(new Date(nextView.getFullYear(), nextView.getMonth(), day));
  };

  return (
    <div className="pk__cal">
      <div className="pk__calh">
        <button type="button" className="pk__cnav" aria-label="Previous month" onClick={() => stepMonth(-1)}>{Ic.prev}</button>
        {/* `aria-live`: the month changes under the arrow keys without focus
            ever leaving the grid, so nothing else would announce the move. */}
        <span className="pk__calt" aria-live="polite">{MON[m]} {y}</span>
        <button type="button" className="pk__cnav" aria-label="Next month" onClick={() => stepMonth(1)}>{Ic.next}</button>
      </div>
      <div
        className="pk__grid"
        role="grid"
        ref={gridRef}
        aria-label={`${MON[m]} ${y}`}
        onKeyDown={onKeyDown}
      >
        <div className="pk__grow" role="row">
          {DOW.map((d, i) => (
            // The letter is ambiguous on its own — S is both Sunday and
            // Saturday, T both Tuesday and Thursday — so the header carries
            // the full name and shows the initial.
            <span className="pk__dow" role="columnheader" abbr={DOW_FULL[i]}
                  aria-label={DOW_FULL[i]} key={`${d}-${i}`}>{d}</span>
          ))}
        </div>
        {weeks.map((week) => (
          <div className="pk__grow" role="row" key={week[0].date.toISOString()}>
            {week.map((c) => {
              const off = blocked(c.date);
              const isFocus = sameDay(c.date, focusDay);
              const cls = ['pk__d', c.out ? 'out' : '', sameDay(c.date, today) ? 'today' : '',
                sameDay(c.date, selected) ? 'on' : ''].filter(Boolean).join(' ');
              return (
                <div role="gridcell" className="pk__gcell" key={c.date.toISOString()}
                     aria-selected={sameDay(c.date, selected) || undefined}>
                  <button
                    type="button"
                    data-day
                    className={cls}
                    // The roving stop. Exactly one 0 in the whole month, so Tab
                    // treats the calendar as one control instead of 42.
                    tabIndex={isFocus ? 0 : -1}
                    disabled={off}
                    aria-label={fullName(c.date)}
                    aria-current={sameDay(c.date, today) ? 'date' : undefined}
                    onClick={() => { wantFocus.current = false; setFocusDay(c.date); onPick?.(c.date); }}
                  >{c.d}</button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default CalendarGrid;
