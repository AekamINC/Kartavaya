import React from 'react';
import { WEEK_HI_MON } from '../../lib/dates';

/**
 * The seven-day strip under the hero greeting. Behaviour unchanged —
 * 05-today-dashboard.md §5 says keep it as-is — with two edits it does ask for:
 *
 *   · `WEEK_HI` moved to `lib/dates.js` beside the Sunday-first array the page
 *     uses, with the indexing documented. Both were correct in place and
 *     trivially confusable; keeping them apart was the risk.
 *   · Dots still cap at four. Five dots in a 40px cell is noise, and
 *     `.k-week__dots` holds its height when empty so the row does not jump
 *     between days with and without tasks.
 */
export default function WeekStrip({ weekDates = [], dotsByDay = {}, todayIdx }) {
  return (
    <div className="k-hero__weekstrip">
      {weekDates.map((d, i) => {
        const dots = dotsByDay[d.toDateString()] || 0;
        const isToday = i === todayIdx;
        return (
          <div
            key={d.toDateString()}
            className={`k-wday${isToday ? ' is-today' : ''}`}
            aria-current={isToday ? 'date' : undefined}
          >
            <div className="k-week__hi">{WEEK_HI_MON[i]}</div>
            <div className="k-week__num">{d.getDate()}</div>
            <div className="k-week__dots" aria-hidden="true">
              {Array.from({ length: Math.min(dots, 4) }).map((_, j) => <i key={j} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
