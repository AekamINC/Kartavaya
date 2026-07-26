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
