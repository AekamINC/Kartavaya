// Constants and helpers shared across the manav tabs.
// Extracted verbatim from the original single-file page component.
import React from 'react';

export const EMP_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'consultant'];
export const EMP_STATUSES = ['active', 'on_notice', 'terminated', 'resigned', 'absconding'];
export const ATT_STATUSES = ['present', 'absent', 'half_day', 'late', 'on_leave', 'holiday', 'weekend'];
export const STATUS_COLORS = { active: '#10b981', on_notice: '#f59e0b', terminated: '#ef4444', resigned: '#9ca3af', absconding: '#ef4444' };
export const ATT_COLORS = { present: '#10b981', absent: '#ef4444', half_day: '#f59e0b', late: '#6366f1', on_leave: '#0082c6', holiday: '#8b5cf6', weekend: '#9ca3af' };
export const LEAVE_COLORS = { pending: '#f59e0b', approved: '#10b981', rejected: '#ef4444', cancelled: '#9ca3af' };
export const CLAIM_COLORS = { pending: '#f59e0b', approved: '#10b981', rejected: '#ef4444', paid: '#0082c6' };
export const CLAIM_CATEGORIES = ['travel', 'meals', 'supplies', 'other'];
export const PRIORITY_COLORS = { low: '#6E7B91', normal: '#0082c6', high: '#f59e0b', urgent: '#ef4444' };
export const CANDIDATE_STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'];
export const STAGE_COLORS_REC = { applied: '#6E7B91', screening: '#0082c6', interview: '#8b5cf6', offer: '#f59e0b', hired: '#10b981', rejected: '#ef4444' };
export const ASSET_CATEGORIES = ['laptop', 'phone', 'tablet', 'vehicle', 'furniture', 'other'];
export const ASSET_CONDITIONS = ['new', 'good', 'fair', 'poor', 'disposed'];
export const CATEGORY_COLORS = { laptop: '#3b82f6', phone: '#8b5cf6', tablet: '#6366f1', vehicle: '#f59e0b', furniture: '#78716c', other: '#6b7280' };
export const CONDITION_COLORS = { new: '#10b981', good: '#0ea5e9', fair: '#f59e0b', poor: '#ef4444', disposed: '#9ca3af' };
export const FMT = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;

export function Badge({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${color}18`, color }}>{text?.replace(/_/g, ' ')}</span>
  );
}
