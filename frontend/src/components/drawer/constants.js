// Status, approval and priority colour now come from lib/statusColors.js — the
// single map. These names are re-exported so the drawer's existing importers
// keep working, but the values are no longer defined here: this file and
// editorial/StatusChip.jsx each had their own set and they disagreed (done was
// green here and teal there, requested purple here and amber there).
export {
  STATUS_COLORS,
  STATUS_LABELS,
  PRIORITY_LABELS,
  APPROVAL_LABELS as APPROVAL_STATUS_LABEL,
  APPROVAL_COLORS as APPROVAL_STATUS_COLOR,
} from '../../lib/statusColors';

export const lbl = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
  marginBottom: 5, display: 'block',
};

export function fmtMinutes(mins) {
  if (!mins) return '0m';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
