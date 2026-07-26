import React, { useMemo, useState } from 'react';
import TaskDrawer from '../TaskDrawer';
import { Avatar, DueChip, EmptyState, StatusChip } from '../ui';
import { PRIORITY_COLORS } from '../../lib/statusColors';

/**
 * WorkloadView — per-member load: open, overdue, due soon, done
 * (04-boards-table-views.md §5, "restyle only").
 *
 * Four literals and one silent failure went with the restyle:
 *
 *  · **The load bar used `#0082c6`**, the retired brand blue, alongside
 *    `#dc2626` and `#f59e0b`. The bar encodes over/under-load, which is
 *    ok/warn/danger — three tokens that already exist and already flip.
 *  · **`sColor + '18'` rendered no background at all**, because
 *    `STATUS_COLORS` holds `var(--st-*)` now and `"var(--st-todo)18"` is not a
 *    colour. `StatusChip`.
 *  · **The avatar colour keyed off the array index**, and the array is sorted by
 *    open-task count — so a person's colour changed whenever anyone finished a
 *    task. `Avatar` hashes the name.
 *  · **A fifth copy of the due-date rule**, with its own `⚠` and its own
 *    weight. `DueChip`.
 *
 * The bar itself is not `.prg`: `.prg` is a determinate progress bar toward a
 * goal, and this is a load *relative to the busiest person*, which has no goal
 * and is not progress toward anything. Same shape, different meaning.
 */
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

export default function WorkloadView({ tasks = [], teamMembers = [] }) {
  const [drawer, setDrawer] = useState(null);
  const [expanded, setExpanded] = useState({});

  const now = new Date();

  const members = useMemo(() => {
    // Anyone with tasks counts, even if they are not on the member list —
    // otherwise a departed assignee's work disappears from the workload view
    // while still being open.
    const base = (teamMembers || []).map(m => ({ ...m, id: m.user_id }));
    const seen = new Set(base.map(m => m.user_id));
    tasks.forEach(t => {
      (t.assignee_user_ids || []).forEach((uid, i) => {
        if (seen.has(uid)) return;
        base.push({ user_id: uid, display_name: (t.assignee_names || [])[i] || uid, id: uid });
        seen.add(uid);
      });
    });
    return base;
  }, [teamMembers, tasks]);

  const byMember = useMemo(() => {
    const map = {};
    members.forEach(m => { map[m.user_id] = []; });
    tasks.forEach(t => {
      (t.assignee_user_ids || []).forEach(uid => {
        if (!map[uid]) map[uid] = [];
        map[uid].push(t);
      });
    });
    const unassigned = tasks.filter(t => !(t.assignee_user_ids || []).length);
    if (unassigned.length) map.__unassigned__ = unassigned;
    return map;
  }, [members, tasks]);

  const allMembers = useMemo(() => {
    const openCount = m => m.tasks.filter(t => t.status !== 'done').length;
    const list = members.map(m => ({ ...m, tasks: byMember[m.user_id] || [] }));
    if (byMember.__unassigned__?.length) {
      list.push({ user_id: '__unassigned__', display_name: 'Unassigned', tasks: byMember.__unassigned__ });
    }
    return list.sort((a, b) => openCount(b) - openCount(a));
  }, [members, byMember]);

  const maxLoad = Math.max(...allMembers.map(m => m.tasks.filter(t => t.status !== 'done').length), 1);

  if (allMembers.length === 0) {
    return (
      <EmptyState
        illustration="tasks"
        title="Nobody has work on this board"
        description="Assign a task and the person picks up a row here."
      />
    );
  }

  return (
    <div className="stack">
      {allMembers.map(m => {
        const open = m.tasks.filter(t => t.status !== 'done');
        const done = m.tasks.filter(t => t.status === 'done');
        const overdue = open.filter(t => t.due_at && new Date(t.due_at) < now);
        const dueSoon = open.filter(t => t.due_at && new Date(t.due_at) >= now && daysBetween(now, new Date(t.due_at)) <= 3);
        const isExp = !!expanded[m.user_id];
        const barPct = Math.min((open.length / maxLoad) * 100, 100);
        const tone = open.length > maxLoad * 0.75 ? 'var(--danger)'
          : open.length > maxLoad * 0.5 ? 'var(--warn)'
            : 'var(--primary)';
        const name = m.display_name || m.full_name || m.email || m.user_id;

        return (
          <section key={m.user_id} className="tg" style={{ '--c': tone }}>
            <button
              type="button"
              className="tg__h wl__h"
              aria-expanded={isExp}
              onClick={() => setExpanded(e => ({ ...e, [m.user_id]: !e[m.user_id] }))}
            >
              <Avatar name={name} size={36} />

              <span className="wl__who">
                <span className="wl__name">{name}</span>
                <span className="wl__bar">
                  <span className="wl__fill" style={{ width: `${barPct}%` }} />
                </span>
              </span>

              <Stat n={open.length} label="open" />
              <Stat n={overdue.length} label="overdue" tone={overdue.length ? 'var(--danger)' : undefined} />
              <Stat n={dueSoon.length} label="due soon" tone={dueSoon.length ? 'var(--warn)' : undefined} />
              <Stat n={done.length} label="done" tone="var(--ok)" />
            </button>

            {isExp && open.length === 0 && <p className="tg__empty">Nothing open.</p>}

            {isExp && open.map(t => (
              <button
                key={t.task_id}
                type="button"
                className="tg__row wl__row"
                onClick={() => setDrawer(t.task_id)}
              >
                <span className="tg__pdot" style={{ '--c': PRIORITY_COLORS[t.priority] || 'var(--on-surface-3)' }} />
                <span className="tg__title">{t.title}</span>
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
        onSaved={() => setDrawer(null)}
      />
    </div>
  );
}

function Stat({ n, label, tone }) {
  return (
    <span className="mt__stat">
      <span className="mt__n" style={tone ? { color: tone } : undefined}>{n}</span>
      <span className="mt__l">{label}</span>
    </span>
  );
}
