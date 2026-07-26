// Constants and helpers shared across the manav tabs.
//
// Every colour is a token reference. The literals here were the full retired
// set — #0082c6 (retired brand blue, 00 §9), #8b5cf6, #ef4444, #f59e0b — plus
// four greys (#9ca3af, #6b7280, #6E7B91, #78716c) that are one token in this
// system. None of them followed the theme, so every badge on this module was
// the light-mode colour in dark mode.
//
// Where a map needs more hues than the status ramp carries, --tertiary
// (terracotta) and --secondary (olive) are the two remaining container-backed
// families; both flip by theme and both clear AA in each.
import React from 'react';
import Tag from '../../components/ui/Tag';
import { PRIORITY_COLORS as TASK_PRIORITY_COLORS } from '../../lib/statusColors';
import { inr } from '../../lib/inr';

export const EMP_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'consultant'];
export const EMP_STATUSES = ['active', 'on_notice', 'terminated', 'resigned', 'absconding'];
export const ATT_STATUSES = ['present', 'absent', 'half_day', 'late', 'on_leave', 'holiday', 'weekend'];
export const STATUS_COLORS = {
  active: 'var(--ok)', on_notice: 'var(--warn)', terminated: 'var(--danger)',
  resigned: 'var(--on-surface-3)', absconding: 'var(--danger)',
};
// Seven states, so this is the one map that exhausts the status ramp and
// reaches for --tertiary and --st-in-review to stay separable.
export const ATT_COLORS = {
  present: 'var(--ok)', absent: 'var(--danger)', half_day: 'var(--warn)',
  late: 'var(--tertiary)', on_leave: 'var(--st-in-progress)',
  holiday: 'var(--st-in-review)', weekend: 'var(--on-surface-3)',
};
export const LEAVE_COLORS = {
  pending: 'var(--warn)', approved: 'var(--ok)',
  rejected: 'var(--danger)', cancelled: 'var(--on-surface-3)',
};
export const CLAIM_COLORS = {
  pending: 'var(--warn)', approved: 'var(--ok)',
  rejected: 'var(--danger)', paid: 'var(--st-in-progress)',
};
export const CLAIM_CATEGORIES = ['travel', 'meals', 'supplies', 'other'];
// Announcement priority. Reads the canonical task-priority map rather than
// restating it — the only difference is that announcements say `normal` where
// tasks say `medium`, which is an alias, not a different colour.
export const PRIORITY_COLORS = {
  low:    TASK_PRIORITY_COLORS.low,
  normal: TASK_PRIORITY_COLORS.medium,
  medium: TASK_PRIORITY_COLORS.medium,
  high:   TASK_PRIORITY_COLORS.high,
  urgent: TASK_PRIORITY_COLORS.urgent,
};
export const CANDIDATE_STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'];
export const STAGE_COLORS_REC = {
  applied: 'var(--on-surface-3)', screening: 'var(--st-in-progress)',
  interview: 'var(--st-in-review)', offer: 'var(--warn)',
  hired: 'var(--ok)', rejected: 'var(--danger)',
};
export const ASSET_CATEGORIES = ['laptop', 'phone', 'tablet', 'vehicle', 'furniture', 'other'];
export const ASSET_CONDITIONS = ['new', 'good', 'fair', 'poor', 'disposed'];
export const CATEGORY_COLORS = {
  laptop: 'var(--st-in-progress)', phone: 'var(--st-in-review)',
  tablet: 'var(--primary-text)', vehicle: 'var(--warn)',
  furniture: 'var(--secondary)', other: 'var(--on-surface-3)',
};
export const CONDITION_COLORS = {
  new: 'var(--ok)', good: 'var(--st-in-progress)', fair: 'var(--warn)',
  poor: 'var(--danger)', disposed: 'var(--on-surface-3)',
};
// Was a local `₹${…toLocaleString('en-IN')}` — one of 87 reimplementations of
// Indian digit grouping that lib/inr.js exists to end.
export const FMT = inr;

/**
 * Badge — now `ui/Tag`, not a third private pill.
 *
 * Identical to the definitions in graha/_shared.jsx and ganit/_shared.jsx, all
 * three duplicating `.tag` from components.css. All three hardcoded
 * a 10px font (below 00 §12's 11px metadata floor, and deaf to the Text size
 * slider), a literal 99px radius (deaf to the Border radius setting), and
 * `background: \`${color}18\``, which stopped producing a colour the moment the
 * maps above became token references.
 */
export function Badge({ text, color, children }) {
  const label = text ?? children;
  return <Tag color={color}>{typeof label === 'string' ? label.replace(/_/g, ' ') : label}</Tag>;
}
