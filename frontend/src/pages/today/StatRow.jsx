import React from 'react';

/**
 * The four Today stat tiles — 05-today-dashboard.md §1 (Stat tiles) and §2.
 *
 * VARIANTS ARE SEMANTIC, NOT COLOUR-NAMED. Staging used `blue|teal|amber|red`
 * and gave `red` to "DONE THIS WEEK" — the one tile that is unambiguously good
 * news. The mapping §1 specifies:
 *
 *   Open tasks      neutral  --on-surface-3
 *   Due today       info     --primary
 *   Overdue         danger   --danger
 *   Done this week  ok       --ok
 *
 * The tiles render `.k-stat` markup directly rather than going through
 * `ui/StatTile.jsx`. That component's alias table maps every name it does not
 * know onto `neutral`, and it has no name that reaches `--primary`, so the
 * "Due today" tile could not be given its specified colour without editing a
 * file this change does not own. The CSS is shared — `.k-stat` and the four
 * `.k-stat--*` rules in editorial.css serve both — so this is one tile design,
 * not two.
 */
function Tile({ label, hi, value, sub, tone = 'neutral' }) {
  return (
    <div className={`k-stat k-stat--${tone}`}>
      <div className="k-stat__lbl">
        <span>{label}</span>
        {hi && <span className="k-stat__hi">{hi}</span>}
      </div>
      <div className="k-stat__val">{value}</div>
      {sub && <div className="k-stat__sub">{sub}</div>}
    </div>
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function StatRow({
  open = 0, projectCount = 0, dueToday = 0, dueTodayHigh = 0,
  overdue = 0, completedWeek = 0, completionRate = 0,
}) {
  return (
    <div className="k-stats">
      <Tile
        tone="neutral"
        label="OPEN TASKS" hi="खुला" value={open}
        // `|| 1` used to turn zero into one here, so a brand-new org with
        // nothing in it was told its open tasks span one project. The empty
        // case now says something true.
        sub={projectCount === 0 ? 'no projects yet' : `across ${plural(projectCount, 'project')}`}
      />
      <Tile
        tone="info"
        label="DUE TODAY" hi="आज" value={dueToday}
        sub={dueTodayHigh > 0 ? `${dueTodayHigh} high priority` : 'nothing urgent'}
      />
      <Tile
        tone="danger"
        label="OVERDUE" hi="विलंबित" value={overdue}
        sub={overdue > 0 ? 'needs attention' : 'all on track'}
      />
      <Tile
        tone="ok"
        label="DONE THIS WEEK" hi="इस सप्ताह" value={completedWeek}
        sub={completedWeek > 0 ? `${completionRate}% completion rate` : 'keep going'}
      />
    </div>
  );
}
