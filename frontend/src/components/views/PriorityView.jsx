import React, { useMemo, useState } from 'react';
import TaskDrawer from '../TaskDrawer';
import { AvatarStack, DueChip, StatusChip } from '../ui';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../lib/statusColors';

/**
 * PriorityView — tasks grouped Urgent → High → Medium → Low
 * (04-boards-table-views.md §5, "restyle only").
 *
 * The restyle carried three live defects out with it:
 *
 *  · **The status pill had no background.** `background: sColor + '18'` is the
 *    hex-alpha trick, and it worked while `STATUS_COLORS` held hexes. It holds
 *    `var(--st-*)` references now, so the declaration evaluated to
 *    `"var(--st-todo)18"` — not a colour, silently dropped. Every pill in this
 *    view rendered as bare text. Same bug as `Badge` in 02, same fix:
 *    `StatusChip`, which carries the colour on a dot rather than by tinting the
 *    ground its own text sits on.
 *  · **The avatar showed a UUID.** `uid.slice(-2).toUpperCase()` took the last
 *    two characters of the *user id*, so a stack of assignees read `4F`, `A1`,
 *    `0C`. The names are on the task; `AvatarStack` uses them.
 *  · **`#dc2626`** for overdue, twice, and a fourth private copy of the
 *    due-date rule with its own `⚠` prefix. `--danger` and `DueChip`.
 *
 * The collapsible group and its rows are `.tg*` — the same object MyTasks and
 * Workload draw, written once.
 */
const PRIORITIES = [
  { id: 'urgent', label: PRIORITY_LABELS.urgent, sans: 'अत्यावश्यक', color: PRIORITY_COLORS.urgent },
  { id: 'high', label: PRIORITY_LABELS.high, sans: 'उच्च', color: PRIORITY_COLORS.high },
  { id: 'medium', label: PRIORITY_LABELS.medium, sans: 'मध्यम', color: PRIORITY_COLORS.medium },
  { id: 'low', label: PRIORITY_LABELS.low, sans: 'लघु', color: PRIORITY_COLORS.low },
];

export default function PriorityView({ tasks = [], columns = [], teamMembers = [], onTasksChange }) {
  const [drawer, setDrawer] = useState(null);
  const [collapsed, setCollapsed] = useState({});

  const colMap = useMemo(
    () => Object.fromEntries((columns || []).map(c => [c.column_id, c])),
    [columns],
  );

  const grouped = useMemo(() => {
    const m = Object.fromEntries(PRIORITIES.map(p => [p.id, []]));
    tasks.forEach(t => {
      const p = t.priority || 'medium';
      if (m[p]) m[p].push(t);
    });
    return m;
  }, [tasks]);

  const now = new Date();

  return (
    <div className="stack">
      {PRIORITIES.map(p => {
        const rows = grouped[p.id] || [];
        const isCol = !!collapsed[p.id];
        const overdue = rows.filter(t => t.due_at && new Date(t.due_at) < now && t.status !== 'done').length;

        return (
          <section key={p.id} className="tg" style={{ '--c': p.color }}>
            <button
              type="button"
              className="tg__h"
              aria-expanded={!isCol}
              onClick={() => setCollapsed(c => ({ ...c, [p.id]: !c[p.id] }))}
            >
              <span className="tg__pdot" />
              <span className="tg__t">{p.label}</span>
              <span className="tg__s">{p.sans}</span>
              <span className="tg__c">{rows.length}</span>
              {overdue > 0 && <span className="tg__warn">{overdue} overdue</span>}
              <svg className="tg__x" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {!isCol && rows.length === 0 && (
              <p className="tg__empty">Nothing at this priority.</p>
            )}

            {!isCol && rows.map(t => {
              const col = colMap[t.column_id];
              const people = (t.assignee_user_ids || []).map((id, i) => ({
                id, name: (t.assignee_names || [])[i] || id,
              }));
              return (
                <button
                  key={t.task_id}
                  type="button"
                  className="tg__row"
                  onClick={() => setDrawer(t.task_id)}
                >
                  <StatusChip status={t.status} approvalStatus={t.approval_status} />
                  <span className="tg__title">{t.title}</span>
                  {col && (
                    <span className="tb__col">
                      <span className="tb__coldot" style={{ '--c': col.color || 'var(--on-surface-3)' }} />
                      {col.name}
                    </span>
                  )}
                  {t.due_at && (
                    <DueChip date={t.due_at} status={t.status} completedAt={t.completed_at} flush />
                  )}
                  {people.length > 0 && <AvatarStack users={people} size={22} max={3} />}
                </button>
              );
            })}
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
