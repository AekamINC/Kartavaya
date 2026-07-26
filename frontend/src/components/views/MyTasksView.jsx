import React, { useMemo, useState } from 'react';
import { currentUser } from '../../lib/auth';
import { PRIORITY_COLORS } from '../../lib/statusColors';
import TaskDrawer from '../TaskDrawer';
import { Avatar, DueChip, EmptyState, StatusChip } from '../ui';

/**
 * MyTasksView — the current user's tasks, bucketed by due urgency
 * (04-boards-table-views.md §5: "adopt `ui/DueChip.jsx` and
 * `ui/StatusChip.jsx`").
 *
 * Three defects went with the adoption, and the third was live:
 *
 *  · **`#0082c6` was back.** The "This week" group used the retired brand blue,
 *    which 00 §9 removed from the three places it had reappeared. `#dc2626`,
 *    `#d97706` and `#16a34a` were the same problem in the other direction —
 *    light-mode literals that do not flip, so the group headers stayed
 *    mid-tone on a dark page.
 *  · **`sColor + '18'` produced no colour at all.** The hex-alpha suffix worked
 *    while `STATUS_COLORS` held hexes. It holds `var(--st-*)` references now,
 *    so this evaluated to `"var(--st-done)18"` — not a colour, silently
 *    dropped, and every status pill in this view rendered with no background.
 *    That is the `Badge` bug from 02, and the fix is the same: use
 *    `StatusChip`, which identifies by a dot rather than by tinting the text's
 *    own ground.
 *  · **Hover was an inline style.** `onMouseEnter` wrote
 *    `currentTarget.style.background`, which then outranks anything added
 *    later — the same defect 04 names in the table.
 *
 * The due column was a fourth copy of the due-date rule, formatted `en-IN` but
 * with its own `⚠` prefix and its own overdue weight. `DueChip` now.
 */
const GROUPS = [
  { id: 'overdue', label: 'Overdue', sans: 'विलंबित', color: 'var(--danger)' },
  { id: 'today', label: 'Due today', sans: 'आज', color: 'var(--warn)' },
  { id: 'week', label: 'This week', sans: 'इस सप्ताह', color: 'var(--st-in-progress)' },
  { id: 'upcoming', label: 'Upcoming', sans: 'आगामी', color: 'var(--on-surface-2)' },
  { id: 'nodate', label: 'No due date', sans: 'अनिर्धारित', color: 'var(--on-surface-3)' },
  { id: 'done', label: 'Done', sans: 'सम्पन्न', color: 'var(--ok)' },
];

function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

export default function MyTasksView({ tasks = [], teamMembers = [], onTasksChange }) {
  const me = currentUser();
  const [drawer, setDrawer] = useState(null);
  const [collapsed, setCollapsed] = useState({ done: true });

  const myTasks = useMemo(() => {
    if (!me?.user_id) return [];
    return tasks.filter(t => (t.assignee_user_ids || []).includes(me.user_id));
  }, [tasks, me]);

  const grouped = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const m = { overdue: [], today: [], week: [], upcoming: [], nodate: [], done: [] };
    myTasks.forEach(t => {
      if (t.status === 'done') { m.done.push(t); return; }
      if (!t.due_at) { m.nodate.push(t); return; }
      const due = new Date(t.due_at); due.setHours(0, 0, 0, 0);
      const diff = daysBetween(now, due);
      if (diff < 0) m.overdue.push(t);
      else if (diff === 0) m.today.push(t);
      else if (diff <= 7) m.week.push(t);
      else m.upcoming.push(t);
    });
    return m;
  }, [myTasks]);

  const totalOpen = myTasks.filter(t => t.status !== 'done').length;

  if (!me) {
    return <EmptyState illustration="generic" title="Not signed in" description="Sign in to see the work assigned to you." />;
  }

  return (
    <div className="mt">
      <div className="mt__sum">
        <div className="mt__me">
          <Avatar name={me.full_name || me.email || 'Me'} size={36} />
          <div>
            <div className="mt__name">{me.full_name || me.email}</div>
            <div className="mt__kicker">My tasks</div>
          </div>
        </div>
        <span className="mt__rule" />
        <SumStat n={totalOpen} label="open" />
        <SumStat n={grouped.overdue.length} label="overdue" tone={grouped.overdue.length ? 'var(--danger)' : undefined} />
        <SumStat n={grouped.today.length} label="today" tone={grouped.today.length ? 'var(--warn)' : undefined} />
        <SumStat n={grouped.done.length} label="done" tone="var(--ok)" />
      </div>

      {myTasks.length === 0 && (
        <EmptyState
          illustration="tasks"
          title="No tasks assigned to you"
          description="Tasks assigned to you in this project will appear here."
        />
      )}

      {GROUPS.map(g => {
        const rows = grouped[g.id] || [];
        if (rows.length === 0) return null;
        const isCol = !!collapsed[g.id];
        return (
          <section key={g.id} className="tg" style={{ '--c': g.color }}>
            <button
              type="button"
              className="tg__h"
              aria-expanded={!isCol}
              onClick={() => setCollapsed(c => ({ ...c, [g.id]: !c[g.id] }))}
            >
              <span className="tg__t">{g.label}</span>
              <span className="tg__s">{g.sans}</span>
              <span className="tg__c">{rows.length}</span>
              <svg className="tg__x" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {!isCol && rows.map(t => (
              <button
                key={t.task_id}
                type="button"
                className="tg__row"
                onClick={() => setDrawer(t.task_id)}
              >
                <span className="tg__pdot" style={{ '--c': PRIORITY_COLORS[t.priority] || 'var(--on-surface-3)' }} />
                <span className="tg__title">{t.title}</span>
                {t.attachments?.length > 0 && (
                  <span
                    className="tg__att"
                    title={`${t.attachments.length} attachment${t.attachments.length > 1 ? 's' : ''}`}
                  >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                      <path d="M10 3l-5 5a2.5 2.5 0 003.5 3.5l5-5a4 4 0 00-5.7-5.7L3 5.5" />
                    </svg>
                    {t.attachments.length}
                  </span>
                )}
                <StatusChip status={t.status} approvalStatus={t.approval_status} />
                {t.due_at && (
                  <DueChip date={t.due_at} status={t.status} completedAt={t.completed_at} flush />
                )}
              </button>
            ))}
          </section>
        );
      })}

      <TaskDrawer
        taskId={drawer}
        open={!!drawer}
        onClose={() => setDrawer(null)}
        teamMembers={teamMembers}
        onSaved={u => {
          setDrawer(null);
          if (u) onTasksChange?.(p => p.map(t => (t.task_id === u.task_id ? u : t)));
        }}
      />
    </div>
  );
}

function SumStat({ n, label, tone }) {
  return (
    <div className="mt__stat">
      <div className="mt__n" style={tone ? { color: tone } : undefined}>{n}</div>
      <div className="mt__l">{label}</div>
    </div>
  );
}
