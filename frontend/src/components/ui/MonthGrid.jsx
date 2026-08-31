import React, { useEffect, useRef, useState } from 'react';

/**
 * MonthGrid — the twelve-month panel behind `<DateInput type="month">`.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The product's standing rule is that there are NO native date-family controls:
 * `CLAUDE.md` bans `<input type="date">` because the native picker is the one
 * control in the product with no design, and because Playwright cannot `fill()`
 * a control clipped out of the tab order.
 *
 * `Field.jsx` routed `date`, `datetime-local` and `time` through `DateInput`
 * and NOT `month`, so month fields kept emitting the native widget. Suite 20.04
 * failed on that deliberately and named the fix as a FEATURE rather than a
 * one-line change — "closing it means giving `DateInput` a month mode". This is
 * that month mode.
 *
 * Five screens carried the native control, and three of them are Vetana, where
 * `manav/BonusTab.jsx` had already written down what a wrong month costs: the
 * value has to match `vetana_payroll_runs.month` EXACTLY, and a wrong one "does
 * not fail, it files the award against a month no payroll run will ever look
 * at, and the person is simply not paid."
 *
 * ── SHAPE ───────────────────────────────────────────────────────────────────
 *
 * Deliberately built on CalendarGrid's markup and classes — `pk__cal`,
 * `pk__calh`, `pk__cnav`, `pk__calt`, `pk__grid`, `pk__grow`, `pk__gcell`,
 * `pk__d` — so the two panels cannot drift apart visually and no new styling
 * decisions are invented here. The only addition is `pk__d--mon`, because a
 * three-letter month does not fit a cell sized for a two-digit day.
 *
 * The roving tabindex is CalendarGrid's rule too: exactly one cell carries
 * `tabIndex={0}`, so Tab treats the grid as ONE control rather than twelve.
 */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
              'August', 'September', 'October', 'November', 'December'];

const Ic = {
  prev: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>,
  next: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>,
};

/** `2026-08` → `{y: 2026, m: 7}`, or null. Accepts a longer date and takes its month. */
export const parseMonth = (s) => {
  const m = /^(\d{4})-(\d{2})/.exec(s || '');
  if (!m) return null;
  const mi = +m[2] - 1;
  return mi >= 0 && mi <= 11 ? { y: +m[1], m: mi } : null;
};

/** `{y, m}` → `2026-08`. The wire format, which is what the column stores. */
export const fmtMonth = ({ y, m }) => `${y}-${String(m + 1).padStart(2, '0')}`;

const ord = ({ y, m }) => y * 12 + m;

export default function MonthGrid({ value, min, max, onPick }) {
  const now = new Date();
  const thisMonth = { y: now.getFullYear(), m: now.getMonth() };
  const sel = parseMonth(value);
  const lo = parseMonth(min);
  const hi = parseMonth(max);

  const [year, setYear] = useState((sel || thisMonth).y);
  // A focus stop that follows the selection when the caller changes it, so
  // re-opening the panel on a different value does not leave the roving index
  // pointing at a cell from the previous month.
  const [focus, setFocus] = useState((sel || thisMonth).m);
  const wantFocus = useRef(false);
  const gridRef = useRef(null);

  useEffect(() => {
    if (!sel) return;
    setYear(sel.y);
    setFocus(sel.m);
    // `value` is the wire string; depending on the parsed object would rebuild
    // it every render and reset the focus stop on every keystroke elsewhere.
  }, [value]);                     // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!wantFocus.current || !gridRef.current) return;
    wantFocus.current = false;
    gridRef.current.querySelector('[data-mon][tabindex="0"]')?.focus();
  }, [focus, year]);

  const blocked = (y, m) => {
    const o = ord({ y, m });
    return (lo && o < ord(lo)) || (hi && o > ord(hi));
  };

  const move = (delta) => {
    let y = year;
    let m = focus + delta;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    wantFocus.current = true;
    setYear(y);
    setFocus(m);
  };

  const onKeyDown = (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4,
                   PageUp: -12, PageDown: 12 }[e.key];
    if (step !== undefined) { e.preventDefault(); move(step); return; }
    if (e.key === 'Home') { e.preventDefault(); wantFocus.current = true; setFocus(0); return; }
    if (e.key === 'End') { e.preventDefault(); wantFocus.current = true; setFocus(11); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!blocked(year, focus)) onPick?.({ y: year, m: focus });
    }
  };

  const stepYear = (n) => { wantFocus.current = false; setYear(y => y + n); };

  return (
    <div className="pk__cal">
      <div className="pk__calh">
        <button type="button" className="pk__cnav" aria-label="Previous year"
                onClick={() => stepYear(-1)}>{Ic.prev}</button>
        <span className="pk__calt" aria-live="polite">{year}</span>
        <button type="button" className="pk__cnav" aria-label="Next year"
                onClick={() => stepYear(1)}>{Ic.next}</button>
      </div>
      <div
        ref={gridRef}
        // `pk__grid--mon` retracks this to FOUR columns. `.pk__grid` alone is
        // the calendar's seven-day week, and `.pk__grow`/`.pk__gcell` are
        // `display: contents`, so the row grouping below carries no layout
        // weight — twelve months in a 7-track grid paint as 7 + 5.
        className="pk__grid pk__grid--mon"
        role="grid"
        aria-label="Choose a month"
        onKeyDown={onKeyDown}
      >
        {[0, 1, 2].map(row => (
          <div className="pk__grow" role="row" key={row}>
            {[0, 1, 2, 3].map((col) => {
              const m = row * 4 + col;
              const on = !!sel && sel.y === year && sel.m === m;
              const isNow = thisMonth.y === year && thisMonth.m === m;
              const off = blocked(year, m);
              const cls = ['pk__d', 'pk__d--mon', isNow ? 'today' : '', on ? 'on' : '']
                .filter(Boolean).join(' ');
              return (
                <div role="gridcell" className="pk__gcell" key={m} aria-selected={on || undefined}>
                  <button
                    type="button"
                    data-mon
                    className={cls}
                    tabIndex={focus === m ? 0 : -1}
                    disabled={off}
                    aria-label={`${FULL[m]} ${year}`}
                    aria-current={isNow ? 'date' : undefined}
                    onClick={() => { wantFocus.current = false; setFocus(m); onPick?.({ y: year, m }); }}
                  >{MON[m]}</button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export { MonthGrid };
