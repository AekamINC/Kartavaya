// Constants and helpers shared across the Graha tabs.
//
// Every colour below is a token reference, never a literal — 00-tokens.md is
// explicit that a hardcoded hex cannot follow the theme, and this file carried
// the whole retired set: #0082c6 (the retired brand blue, 00 §9), #8b5cf6,
// #dc2626, #ef4444, #f59e0b and a slate #6E7B91 that existed nowhere else.
//
// Categorical maps use the status ramp rather than inventing hues, for the
// reason 00 §9 gives: those tokens sit at 38-42% saturation, so they never read
// as the user's accent (>60%), and they already flip by theme. Where a category
// needs a hue the status ramp does not carry, --secondary (olive) and
// --tertiary (terracotta) are the two remaining container-backed families.
import React from 'react';
import Tag from '../../components/ui/Tag';
import { mixAlpha } from '../../lib/statusColors';

export const CONTACT_TYPES = ['lead', 'customer', 'vendor', 'partner'];
export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'task'];
export const TYPE_COLORS = {
  lead: 'var(--warn)', customer: 'var(--ok)',
  vendor: 'var(--st-in-review)', partner: 'var(--st-in-progress)',
};
// Default pipeline stages. Deal stages are org-configurable (13 §2), so a stage
// outside this set falls back through stageColor() rather than rendering bare.
export const STAGE_COLORS = {
  New: 'var(--st-todo)', Qualified: 'var(--warn)', Proposal: 'var(--st-in-progress)',
  Negotiation: 'var(--st-in-review)', Won: 'var(--ok)', Lost: 'var(--danger)',
};
export const SOURCE_COLORS = {
  indiamart: 'var(--st-in-progress)', justdial: 'var(--tertiary)',
  manual: 'var(--on-surface-3)', website: 'var(--ok)',
};
export const ACT_ICONS = { call: '📞', email: '✉️', meeting: '📅', note: '📝', task: '✅' };
export const TL_ICONS = { activity: '●', followup: '⏰', invoice: '📄', deal: '💼' };
export const TL_SUB_ICONS = { call: '📞', email: '✉️', meeting: '📅', note: '📝', task: '✅' };
export const TL_COLORS = {
  activity: 'var(--st-in-progress)', followup: 'var(--warn)', invoice: 'var(--ok)',
  deal: 'var(--st-in-review)', _default: 'var(--on-surface-3)',
};

export const stageColor = s => STAGE_COLORS[s] || 'var(--on-surface-3)';

export function dealStaleness(updatedAt) {
  if (!updatedAt) return null;
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000);
  // `bg` was a hex-alpha suffix (#dc262612). With token references that string
  // concatenation produces "var(--danger)12", which is not a colour and is
  // dropped silently. The tint is now `.gr__rot`'s own color-mix off `--c`, so
  // there is one place that decides how strong it is.
  const at = (color, level, label) => ({ days, level, color, label });
  if (days >= 14) return at('var(--danger)', 'critical', `${days}d stale`);
  if (days >= 7)  return at('var(--warn)',   'warning',  `${days}d idle`);
  if (days >= 3)  return at('var(--on-surface-3)', 'mild', `${days}d ago`);
  return null;
}

/**
 * The "nobody has touched this" marker. Geometry lives in `.gr__rot`; only the
 * per-instance colour is inline, as `--c` — check-tokens deviation 2.
 */
export function RotBadge({ updatedAt }) {
  const rot = dealStaleness(updatedAt);
  if (!rot) return null;
  return (
    <span className="gr__rot" style={{ '--c': rot.color }} title={`No activity for ${rot.days} days`}>
      {rot.level === 'critical' ? '🔥' : rot.level === 'warning' ? '⏳' : '·'} {rot.label}
    </span>
  );
}

/**
 * Badge — now `ui/Tag`, not a fourth private pill.
 *
 * This was one of THREE byte-identical local Badge definitions (graha, ganit,
 * manav `_shared.jsx`), each duplicating `.tag` from components.css. All three
 * hardcoded a 10px font — below 00 §12's 11px metadata floor and immune to the
 * Text size slider — a literal 99px radius, which ignores the Border radius
 * setting, and `background: \`${color}18\``, dead since the colour maps became
 * token references.
 *
 * The signature is kept so no call site changes, and `children` is accepted
 * because five Dristi call sites pass the label as a child.
 */
export function Badge({ text, color, children }) {
  return <Tag color={color}>{text ?? children}</Tag>;
}
