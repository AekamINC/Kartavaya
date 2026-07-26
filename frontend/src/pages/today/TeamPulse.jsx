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
 *
 * THE VERB. `activity_events` has no `verb` column — `routers/activity.py`
 * returns `type`, `actor_name`, `task_title`, `team_name` and `created_at` —
 * so `a.verb || a.type` always resolved to the second and the raw enum reached
 * the reader: "Priya status_changed Q3 GST filing".
 *
 * `pages/ActivityFeedPage.jsx` already owns a VERB_MAP that renders these
 * properly ("moved", "commented on", "logged time on"). It is not imported
 * here on purpose: it is not exported, and pulling a page module into the
 * Today chunk to reach a seven-line table is worse than the problem. Copying
 * the table is worse still — a second translation of the same enum is exactly
 * the duplication `02` exists to end, and it is how `commented` ends up
 * meaning two things.
 *
 * So this humanises the enum generically instead. It is a floor, not the
 * finished treatment: the map belongs in `lib/` with both callers importing it.
 * See the report.
 */
const verbLabel = t => (t ? String(t).replace(/_/g, ' ') : 'updated');

export default function TeamPulse({ activity = [], onOpenActivity }) {
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
                  <span className="k-mute">{verbLabel(a.type || a.verb)}</span>{' '}
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
