import React from 'react';
import { Card } from '../../components/editorial';
import { STATUS_COLORS, STATUS_LABELS, STATUS_LABELS_HI } from '../../lib/statusColors';

/**
 * Stacked bar, legend and completion meter — 05-today-dashboard.md §1.
 *
 * Segment colours come from `lib/statusColors.js`. Staging imported them from
 * `drawer/constants.js`, which is why the dashboard's "done" segment was a
 * different green from the drawer's; `constants.js` now re-exports the shared
 * map, but importing the source directly is what stops the next private map
 * from being added. `STATUS_HI` — the fourth status-label table in the codebase,
 * duplicated verbatim in `TasksListPage.jsx` — is gone; the Devanagari lives
 * beside the English in the same file now.
 */
const ORDER = ['todo', 'in_progress', 'in_review', 'done'];

export default function ProjectStatus({ counts, total, onOpenProjects }) {
  const donePct = total > 0 ? Math.round(((counts.done || 0) / total) * 100) : 0;

  return (
    <Card
      title="Project status"
      sanskrit="स्थिति विवरण"
      right={<button className="k-link" onClick={onOpenProjects}>Open projects →</button>}
    >
      <div className="k-stackbar" role="img" aria-label={`Task status: ${ORDER.map(s => `${STATUS_LABELS[s]} ${counts[s] || 0}`).join(', ')}`}>
        {ORDER.map(s => {
          const count = counts[s] || 0;
          if (!count) return null;
          return (
            <div
              key={s}
              className="k-stackbar__seg"
              style={{ flex: count, background: STATUS_COLORS[s] }}
              title={`${STATUS_LABELS[s]}: ${count}`}
            />
          );
        })}
      </div>

      <div className="k-statuslegend">
        {ORDER.map(s => (
          <div key={s} className="k-statuslegend__row">
            <span className="k-statuslegend__dot" style={{ background: STATUS_COLORS[s] }} />
            <span className="k-statuslegend__lbl">{STATUS_LABELS[s]}</span>
            <span className="k-statuslegend__hi">{STATUS_LABELS_HI[s]}</span>
            <span className="k-statuslegend__count">{counts[s] || 0}</span>
          </div>
        ))}
      </div>

      <div className="k-meter">
        <div className="k-meter__bar">
          <div className="k-meter__fill" style={{ width: `${donePct}%` }} />
        </div>
        <div className="k-meter__lbl">
          {donePct}% complete · <span className="hi-mute">{donePct}% सम्पन्न</span>
        </div>
      </div>
    </Card>
  );
}
