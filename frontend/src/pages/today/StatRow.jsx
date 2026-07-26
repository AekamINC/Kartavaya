import React from 'react';
import { StatTile } from '../../components/ui';

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
 * This file used to render `.k-stat` markup by hand, because `ui/StatTile.jsx`
 * had no alias reaching `--primary` and silently fell back to `neutral` — so
 * "Due today" could not be given its specified tone through the component. That
 * gap is closed (`info: 'info'` is in the alias table), so the local copy is
 * gone and these are real StatTiles. One tile implementation, not two.
 *
 * ── The sub-labels ────────────────────────────────────────────────────────
 * 05 specifies the tiles but not their sub-lines, which is how both of the
 * interesting ones came to say something untrue.
 *
 * "across N projects" read `N || 1`, so a brand-new org was told its zero open
 * tasks spanned one project. Dropping `|| 1` fixed the lie and left two more
 * underneath it, because N counts DISTINCT team_ids AMONG OPEN TASKS and a
 * personal task carries no team_id at all:
 *
 *   open 0, N 0   → "no projects yet" is a claim about the ORG, and the org may
 *                   have twelve. The true statement is that nothing is open.
 *   open 9, N 0   → "no projects yet" while nine tasks are open. The count is
 *                   right; they are all personal. The sentence is not.
 *
 * "N% completion rate" was `completedWeek ÷ tasks.length` — this week's closures
 * over EVERY task the org has ever created. That is not a rate of anything: it
 * falls as the board grows however much work gets closed, so a team that
 * doubles both its throughput and its backlog in one week watches the number go
 * down. No honest denominator is available on this page — "how much of the work
 * in play closed" needs the set of tasks that were live during the window, and
 * a list of current rows cannot reconstruct it. So the tile compares like with
 * like instead: the same seven-day count for the seven days before it. One
 * window, one definition, no hidden denominator.
 */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What "across N projects" can honestly say, given open and N. */
function reach(open, projectCount) {
  if (open === 0)         return 'nothing open';
  if (projectCount === 0) return 'none in a project';
  return `across ${plural(projectCount, 'project')}`;
}

/** This week against last week. Never a percentage of an unrelated total. */
function trend(week, prevWeek) {
  if (week === 0 && prevWeek === 0) return 'keep going';
  const delta = week - prevWeek;
  if (delta === 0) return 'same as last week';
  return delta > 0 ? `${delta} more than last week` : `${-delta} fewer than last week`;
}

export default function StatRow({
  open = 0, projectCount = 0, dueToday = 0, dueTodayHigh = 0,
  overdue = 0, completedWeek = 0, completedPrevWeek = 0,
}) {
  return (
    <div className="k-stats">
      <StatTile
        variant="neutral"
        label="OPEN TASKS" sanskrit="खुला" value={open}
        sub={reach(open, projectCount)}
      />
      <StatTile
        variant="info"
        label="DUE TODAY" sanskrit="आज" value={dueToday}
        sub={dueTodayHigh > 0 ? `${dueTodayHigh} high priority` : 'nothing urgent'}
      />
      <StatTile
        variant="danger"
        label="OVERDUE" sanskrit="विलंबित" value={overdue}
        sub={overdue > 0 ? 'needs attention' : 'all on track'}
      />
      <StatTile
        variant="ok"
        label="DONE THIS WEEK" sanskrit="इस सप्ताह" value={completedWeek}
        sub={trend(completedWeek, completedPrevWeek)}
      />
    </div>
  );
}
