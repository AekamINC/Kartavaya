/**
 * Week arrays and the day windows the Today screen derives everything from —
 * 05-today-dashboard.md §1.
 *
 * TWO WEEK-START CONVENTIONS SHIP HERE AND BOTH ARE CORRECT IN PLACE, which is
 * exactly why they are trivially confusable. They now sit side by side with the
 * indexing spelled out, instead of one living in `WeekStrip.jsx` and the other
 * in `DashboardPage.jsx` where the difference had to be inferred from the call
 * site:
 *
 *   WEEK_HI_MON   Monday-first. Indexed by POSITION in the seven-cell strip —
 *                 `WEEK_HI_MON[i]` pairs with `weekDates()[i]`.
 *   DAYS_HI_SUN   Sunday-first. Indexed by `Date#getDay()`, which is 0 = Sunday.
 *
 * Swapping one for the other shifts every Devanagari day name by a day and
 * throws nothing, so the names carry the convention rather than a comment.
 */

/** Short Devanagari day names, Monday-first, indexed by strip position. */
export const WEEK_HI_MON = ['सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'रवि'];

/** Full Devanagari day names, Sunday-first, indexed by `date.getDay()`. */
export const DAYS_HI_SUN = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];

/** Position of a date within a Monday-first week. Monday → 0, Sunday → 6. */
export function mondayIndex(date = new Date()) {
  return (date.getDay() + 6) % 7;
}

/**
 * The seven dates of the Monday-first week containing `base`, each at local
 * midnight. Returned in strip order, so index 0 is always Monday.
 */
export function weekDates(base = new Date()) {
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const idx = mondayIndex(start);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() - idx + i);
    return d;
  });
}

/**
 * The four boundaries every "due today / overdue / this week / done this week"
 * filter compares against, all at local midnight so a task due at 09:00 counts
 * as due today rather than as overdue.
 */
export function dayWindow(base = new Date()) {
  const today = new Date(base);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const weekEnd  = new Date(today); weekEnd.setDate(today.getDate() + 7);
  const weekAgo  = new Date(today); weekAgo.setDate(today.getDate() - 7);
  return { today, tomorrow, weekEnd, weekAgo };
}


/* ── Months and timestamps ────────────────────────────────────────────────
 *
 * `thisMonth`, `monthRange`, `stamp` and `shortStamp` were declared in four,
 * two, two and two page packages respectively until 2026-09-03 — hub's `stamp`
 * carrying the docstring "one implementation, so the module reads uniformly"
 * while sahayak held the second. They are here because a month string and a
 * timestamp are not a page package's to define: two screens formatting the same
 * instant differently is the defect, and it is invisible until the screens are
 * open side by side.
 *
 * ⚠ LOCAL TIME, NOT UTC. `pages/admin/InvoiceBuilder.jsx` still derives its own
 * month from `getUTCFullYear`/`getUTCMonth`, which names the PREVIOUS month for
 * an IST user between midnight and 05:30 on the first. That copy is left where
 * it is, renamed `thisMonthUtc` so the difference is in the name rather than
 * three lines down, because which of the two an invoice screen wants is a
 * product decision and not a de-duplication.
 */

/** The current month as `YYYY-MM`, in the reader's own timezone. */
export function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * First and last day of a `YYYY-MM`, as `YYYY-MM-DD` — the window every
 * attendance, payroll and statutory query is bounded by.
 *
 * The month is resolved ONCE and the resolved value is what the strings are
 * built from. Both former copies read `month || thisMonth()` for the day count
 * and then interpolated the raw `month` into the bounds, so a call with no
 * argument returned `{ from: 'undefined-01', to: 'undefined-31' }` — a window
 * the API cannot parse, from a default that looks like it works.
 */
export function monthRange(month) {
  const m = month || thisMonth();
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(y, mo, 0).getDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
}

/** `12 Jul 2026, 4:05 pm` — one implementation, so every module reads alike. */
export function stamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** `12 Jul 26` — the compact form for a card footer. */
export function shortStamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}
