import React from 'react';
import { Card } from '../../components/editorial';
import { Avatar } from '../../components/ui';
import { relTime } from '../../lib/utils';

/**
 * Recent activity — 05-today-dashboard.md §2 (side column), `/v1/activity/feed`.
 *
 * The actor avatar was `AVATAR_COLORS[i % len]` where `i` is the FEED position,
 * so the same colleague changed colour every time the feed reordered. `Avatar`
 * hashes the name (26 §8), which is the whole point of a deterministic palette.
 */
export default function TeamPulse({ activity, onOpenActivity }) {
  return (
    <Card
      title="Team pulse"
      sanskrit="दल की गतिविधि"
      right={<button className="k-link" onClick={onOpenActivity}>All activity →</button>}
    >
      <div className="k-activity">
        {activity.length === 0 ? (
          <p className="k-today__quiet">No activity in the last few days.</p>
        ) : activity.slice(0, 6).map((a, i) => {
          const actor = a.actor_name || a.actor || 'Someone';
          return (
            <div key={a.event_id || i} className="k-activity__row">
              <Avatar name={actor} size={22} />
              <div className="k-activity__body">
                <div className="k-activity__line">
                  <b>{actor.split(' ')[0]}</b>{' '}
                  <span className="k-mute">{a.verb || a.type || 'updated'}</span>{' '}
                  <span className="k-activity__what">{a.subject_title || a.task_title || ''}</span>
                </div>
                <div className="k-activity__when">{relTime(a.created_at || a.at)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
