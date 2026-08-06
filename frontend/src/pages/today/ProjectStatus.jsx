import React from 'react';
import { Card } from '../../components/editorial';
import { Secondary } from '../../components/Bilingual';
import {
  STATUS_LABELS, STATUS_LABELS_HI, statusColor,
} from '../../lib/statusColors';

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
 *
 * THE BAR HAS TO ACCOUNT FOR EVERY TASK IN ITS OWN TOTAL. It drew four statuses
 * — todo, in_progress, in_review, done — while `total` is the whole task list,
 * and `TasksListPage.jsx`'s STATUS_ORDER shows `requested` is a fifth live one
 * (`rejected` a sixth). Anything outside the four was invisible in the bar,
 * absent from the legend, and still inside the denominator of the meter below:
 * the segments summed to less than the width they were dividing, and the "%
 * complete" figure was measured against work the picture never showed.
 *
 * Two lists, deliberately:
 *   · the BAR renders every status present, so it always sums to `total`;
 *   · the LEGEND keeps the four core rows even at zero — a legend whose rows
 *     appear and vanish as counts cross zero cannot be read at a glance — and
 *     adds any other status that actually has tasks in it.
 */

/** Canonical order. The four core states first, the terminal ones last. */
const ORDER = ['todo', 'in_progress', 'in_review', 'requested', 'done', 'rejected'];

/** Always in the legend, so its height and row order are stable. */
const CORE = ['todo', 'in_progress', 'in_review', 'done'];

/**
 * Known statuses in canonical order, then anything unrecognised — both filtered
 * to what is actually present. `statusColor()` hands the unknown ones the
 * shared fallback rather than leaving a hole in the bar.
 */
function present(counts) {
  const known   = ORDER.filter(s => counts[s] > 0);
  const unknown = Object.keys(counts)
    .filter(s => !ORDER.includes(s) && counts[s] > 0)
    .sort();
  return [...known, ...unknown];
}

/** No enum reaches the user as-is, even one this file has never seen. */
const label = s => STATUS_LABELS[s] || String(s).replace(/_/g, ' ');

export default function ProjectStatus({ counts = {}, total = 0, onOpenProjects }) {
  const donePct  = total > 0 ? Math.round(((counts.done || 0) / total) * 100) : 0;
  const segments = present(counts);
  const rows     = [...CORE, ...segments.filter(s => !CORE.includes(s))];

  return (
    <Card
      title="Project status"
      sanskrit="स्थिति विवरण"
      right={<button className="k-link" onClick={onOpenProjects}>Open projects →</button>}
    >
      <div
        className="k-stackbar"
        role="img"
        aria-label={
          segments.length
            ? `Task status: ${segments.map(s => `${label(s)} ${counts[s]}`).join(', ')}`
            : 'No tasks yet'
        }
      >
        {segments.map(s => (
          <div
            key={s}
            className="k-stackbar__seg"
            style={{ flex: counts[s], background: statusColor(s) }}
            title={`${label(s)}: ${counts[s]}`}
          />
        ))}
      </div>

      <div className="k-statuslegend">
        {rows.map(s => (
          <div key={s} className="k-statuslegend__row">
            <span className="k-statuslegend__dot" style={{ background: statusColor(s) }} />
            <span className="k-statuslegend__lbl">{label(s)}</span>
            {STATUS_LABELS_HI[s] && <Secondary className="k-statuslegend__hi" value={STATUS_LABELS_HI[s]} />}
            <span className="k-statuslegend__count">{counts[s] || 0}</span>
          </div>
        ))}
      </div>

      <div className="k-meter">
        <div className="k-meter__bar">
          <div className="k-meter__fill" style={{ width: `${donePct}%` }} />
        </div>
        <div className="k-meter__lbl">
          {donePct}% complete
          {/* The Devanagari half is the SAME sentence, so it carries the
              per-cent figure with it rather than being a bare word — which is
              why it needs the render-prop form: `Secondary` decides whether
              the run exists, the call site decides what the run says. */}
          <Secondary className="hi-mute" value="सम्पन्न">
            {s => <> · {donePct}% {s}</>}
          </Secondary>
        </div>
      </div>
    </Card>
  );
}
