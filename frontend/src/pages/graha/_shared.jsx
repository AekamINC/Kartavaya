// Constants and helpers shared across the Graha tabs.
// Extracted verbatim from the original single-file GrahaPage.jsx.
import React from 'react';

export const CONTACT_TYPES = ['lead', 'customer', 'vendor', 'partner'];
export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'task'];
export const TYPE_COLORS = { lead: '#f59e0b', customer: '#10b981', vendor: '#6366f1', partner: '#0082c6' };
export const STAGE_COLORS = { New: '#6E7B91', Qualified: '#f59e0b', Proposal: '#0082c6', Negotiation: '#8b5cf6', Won: '#10b981', Lost: '#ef4444' };
export const SOURCE_COLORS = { indiamart: '#2563eb', justdial: '#ea580c', manual: '#6b7280', website: '#10b981' };
export const ACT_ICONS = { call: '📞', email: '✉️', meeting: '📅', note: '📝', task: '✅' };
export const TL_ICONS = { activity: '●', followup: '⏰', invoice: '📄', deal: '💼' };
export const TL_SUB_ICONS = { call: '📞', email: '✉️', meeting: '📅', note: '📝', task: '✅' };
export const TL_COLORS = { activity: '#0082c6', followup: '#d97706', invoice: '#10b981', deal: '#8b5cf6', _default: '#6E7B91' };

export function dealStaleness(updatedAt) {
  if (!updatedAt) return null;
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000);
  if (days >= 14) return { days, level: 'critical', color: '#dc2626', bg: '#dc262612', label: `${days}d stale` };
  if (days >= 7) return { days, level: 'warning', color: '#d97706', bg: '#d9770612', label: `${days}d idle` };
  if (days >= 3) return { days, level: 'mild', color: '#6E7B91', bg: '#6E7B9112', label: `${days}d ago` };
  return null;
}
export function RotBadge({ updatedAt }) {
  const rot = dealStaleness(updatedAt);
  if (!rot) return null;
  return (
    <span title={`No activity for ${rot.days} days`} style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: rot.bg, color: rot.color, whiteSpace: 'nowrap',
      display: 'inline-flex', alignItems: 'center', gap: 3,
    }}>
      {rot.level === 'critical' ? '🔥' : rot.level === 'warning' ? '⏳' : '·'} {rot.label}
    </span>
  );
}
export function Badge({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${color}18`, color }}>{text}</span>
  );
}
