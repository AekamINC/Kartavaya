import React from 'react';
import { Card, PriorityDot, ProjectTag } from '../../components/editorial';
import { DueChip, AvatarStack, EmptyState } from '../../components/ui';

/**
 * "On your plate" and "Waiting on others" — 05-today-dashboard.md §2.
 *
 * They are two sections rendered by one component because they differ only in
 * which side of the delegation they show, and §"bug 5" is explicit that they
 * must not be one list: staging filtered with
 *
 *   created_by_user_id === myId || user_id === myId || assignee_user_ids.includes(myId)
 *
 * so work you created and handed to someone else sat on YOUR plate, and for a
 * manager the list degraded into "everything I have ever touched". Your plate is
 * what is assigned to you. Created-but-delegated work is a second section.
 *
 * The row id is `#${task_id.slice(-6)}`, the same form as `DrawerHeader.jsx` and
 * `KanbanCard.jsx`. It used to be `KAR-${i + 100}` off the MAP INDEX, so the
 * third row was KAR-102 until something above it closed and a different task
 * became KAR-102 — two lists could show one id for different tasks, and an id a
 * user quoted in a message referred to nothing.
 *
 * Assignee colour is no longer `AVATAR_COLORS[j % len]`. Indexing by position
 * gave the same person a different colour depending on where they landed in the
 * list; `AvatarStack` hashes the name, which is what 26 §8 asks for.
 */
export default function TaskListCard({
  title, sanskrit, tasks, emptyTitle, emptyBody, illustration = 'tasks',
  linkLabel, onLink, onOpenTask,
}) {
  return (
    <Card
      title={title}
      sanskrit={sanskrit}
      right={linkLabel ? <button className="k-link" onClick={onLink}>{linkLabel}</button> : undefined}
      noPad
    >
      {tasks.length === 0 ? (
        <div className="k-today__empty">
          <EmptyState illustration={illustration} title={emptyTitle} description={emptyBody} />
        </div>
      ) : (
        // `noPad` only zeroes the <section>; `Card` always renders
        // `.k-card__body` with its own padding, so the rows would float inside
        // it and their hairlines would stop short of the card edge. The list
        // cancels that padding rather than teaching Card a new prop.
        <div className="k-tasklist">
          {tasks.map(t => (
            <button key={t.task_id} className="k-taskrow" onClick={() => onOpenTask(t)}>
              <PriorityDot priority={t.priority} />
              <span className="k-taskrow__id">#{t.task_id?.slice(-6) || '—'}</span>
              <span className="k-taskrow__title">{t.title}</span>
              {t.team_name && <ProjectTag name={t.team_name} dense />}
              <DueChip date={t.due_at} status={t.status} completedAt={t.completed_at} />
              <AvatarStack users={(t.assignee_names || []).map(name => ({ name }))} size={20} max={3} />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
