// Status, approval and priority colour now come from lib/statusColors.js — the
// single map. These names are re-exported so the drawer's existing importers
// keep working, but the values are no longer defined here: this file and
// editorial/StatusChip.jsx each had their own set and they disagreed (done was
// green here and teal there, requested purple here and amber there).
export {
  STATUS_COLORS,
  STATUS_LABELS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  APPROVAL_LABELS as APPROVAL_STATUS_LABEL,
  APPROVAL_COLORS as APPROVAL_STATUS_COLOR,
} from '../../lib/statusColors';

import { STATUS_COLORS as SC } from '../../lib/statusColors';

// `lbl` — the exported INLINE STYLE OBJECT — is gone. It is `.dr__lbl` in
// styles/drawer.css now. An inline style object cannot be themed, cannot be
// overridden per-surface and does not respond to the density setting; it was a
// class in everything but name (03 §1). Use <Lbl> from ./DrawerLabel.

/** `0m` / `Xh Ym` / `Ym`. Kept verbatim — this shape is right. */
export function fmtMinutes(mins) {
  if (!mins) return '0m';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/**
 * A board column carries a name, not a status, so the pipeline has nothing to
 * colour itself with. These map the names teams actually use onto the six
 * status keys, and anything unrecognised falls through to the accent rather
 * than inventing a seventh hue.
 *
 * Order matters: "in review" contains neither "todo" nor "done", but "review
 * done" contains both, and the later state should win.
 */
const COLUMN_STATUS = [
  [/reject|declin/i,                 'rejected'],
  [/done|complete|closed|finish|ship/i, 'done'],
  [/review|qa|verify|check/i,        'in_review'],
  [/approv|request|sign[\s-]*off/i,  'requested'],
  [/progress|doing|active|wip|ongoing/i, 'in_progress'],
  [/to[\s-]*do|todo|backlog|new|open|inbox/i, 'todo'],
];

/** The `--st-*` custom property for a column name, or the accent. */
export function columnStageColor(name) {
  const hit = COLUMN_STATUS.find(([re]) => re.test(name || ''));
  return hit ? SC[hit[1]] : 'var(--primary)';
}
