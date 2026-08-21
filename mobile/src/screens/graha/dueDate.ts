/**
 * When a follow-up is due.
 *
 * A separate module from `FollowUpSheet.tsx` for one reason, the same one
 * `components/screenStatus.ts` was split out for: Node's type-stripping does not
 * transform JSX, so nothing in a `.tsx` file can be imported by `node --test`.
 * A date rule that cannot be tested is a date rule that quietly drifts, and this
 * one has two off-by-a-day traps in it.
 */

/**
 * `days` from `from`, at 10:00 local.
 *
 * Two decisions, both about the same failure:
 *
 * **10:00, not "now plus n days".** A follow-up set at 17:40 and due at 17:40
 * three days later is due after the working day it belongs to. It shows up in
 * `GET /today`'s `overdue_followups` on the morning of day three — before anyone
 * would have made the call — and a to-do list that is wrong first thing is a
 * to-do list nobody clears. Ten in the morning is when the call happens.
 *
 * **`setDate`, not `+ n * 86400000`.** Adding milliseconds is arithmetic on an
 * instant; adding days is arithmetic on a calendar. India has no DST so the two
 * agree here today — but the app is not pinned to IST, `Date` uses the device's
 * zone, and a rep travelling is exactly the person this feature is for. The
 * calendar version is right everywhere and costs nothing.
 *
 * Never mutates its argument. The sheet holds `due` in state and passes it
 * back in.
 */
export function dueDateIn(days: number, from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0);
  return d;
}

/**
 * The quick answers.
 *
 * Relative buttons rather than a calendar-first flow, because "call them back on
 * Thursday" is the actual thought. Counting days to a date on a phone while
 * walking to the car is how a follow-up ends up unset, and an unset follow-up is
 * the deal going quiet. The picker is still there for anything that is a real
 * date.
 */
export const QUICK_DUE = [
  { key: '1',  label: 'Tomorrow' },
  { key: '3',  label: 'In 3 days' },
  { key: '7',  label: 'Next week' },
  { key: '14', label: 'In 2 weeks' },
] as const;

/** The default the sheet opens on. Three days is a working-week follow-up. */
export const DEFAULT_QUICK = '3';
