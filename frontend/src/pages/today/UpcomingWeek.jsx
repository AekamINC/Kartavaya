import React from 'react';
import { Card, ProjectTag } from '../../components/editorial';
import { DueChip, AvatarStack } from '../../components/ui';

/** The next seven days, soonest first — 05-today-dashboard.md §2 (side column). */
export default function UpcomingWeek({ tasks, onOpenTask }) {
  return (
    <Card title="Upcoming this week" sanskrit="आगामी सप्ताह">
      <div className="k-upcoming">
        {tasks.length === 0 ? (
          <p className="k-today__quiet">Nothing due in the next seven days.</p>
        ) : tasks.map(t => (
          <button key={t.task_id} className="k-upcoming__row" onClick={() => onOpenTask(t)}>
            <DueChip date={t.due_at} flush status={t.status} completedAt={t.completed_at} />
            <div className="k-upcoming__body">
              <div className="k-upcoming__title">{t.title}</div>
              {t.team_name && <div className="k-upcoming__meta"><ProjectTag name={t.team_name} dense /></div>}
            </div>
            <AvatarStack users={(t.assignee_names || []).map(name => ({ name }))} size={18} max={2} />
          </button>
        ))}
      </div>
    </Card>
  );
}
