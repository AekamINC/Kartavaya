import React from 'react';
import { formatTime, hasTimeComponent } from '../../lib/timeFormat';

/**
 * The single due-date presentation rule.
 *
 * This logic existed three times and the three disagreed, so the same task read
 * "Today, 4:30 pm" in a list, "Due today, 4:30 pm" on a board and "Jul 25" in
 * the table — and only the board had a two-day "soon" tier. Worse, the table
 * formatted with toLocaleDateString(undefined, …), i.e. the BROWSER's locale,
 * while the other two pin en-IN: a US-locale browser showed the same date in
 * two different formats on two screens of the same app.
 *
 * The board's `soon` tier is adopted here — it is genuinely useful — but
 * adopted ONCE. Tone names are this file's (danger/warn/soon/normal/muted);
 * the board's parallel vocabulary (overdue/today/soon/…) is gone.
 */
export function relDue(iso) {
  if (!iso) return { label: '—', tone: 'muted' };
  const time = hasTimeComponent(iso) ? `, ${formatTime(iso)}` : '';
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const diff = Math.round((d - now) / 86400000);
  if (diff < 0)   return { label: `${Math.abs(diff)}d overdue`, tone: 'danger' };
  if (diff === 0) return { label: `Today${time}`,    tone: 'warn' };
  if (diff === 1) return { label: `Tomorrow${time}`, tone: 'warn' };
  if (diff === 2) return { label: `In ${diff}d${time}`, tone: 'soon' };
  if (diff < 7)   return { label: `In ${diff}d${time}`, tone: 'normal' };
  return { label: `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}${time}`, tone: 'muted' };
}

function relCompleted(completedAt) {
  const d = new Date(completedAt);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60)  return `${diffMins || 1}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24)   return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7)   return `${diffDays}d ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

const DONE_STATUSES = new Set(['done', 'approved']);

export default function DueChip({ date, flush, status, completedAt }) {
  const { label, tone } = relDue(date);

  if (DONE_STATUSES.has(status) && completedAt && date) {
    const onTime = new Date(completedAt) <= new Date(date);
    if (onTime) {
      // Completed on time → green pill
      return (
        <span className={`k-due k-due--done${flush ? ' k-due--flush' : ''}`}>
          ✓ Done {relCompleted(completedAt)}
        </span>
      );
    }
    // Completed late — check if same calendar day
    const dueDay  = new Date(date);       dueDay.setHours(0,0,0,0);
    const doneDay = new Date(completedAt); doneDay.setHours(0,0,0,0);
    const lateDays = Math.round((doneDay - dueDay) / 86400000);
    if (lateDays === 0) {
      // Same calendar day, just past the time — treat as on time
      return (
        <span className={`k-due k-due--done${flush ? ' k-due--flush' : ''}`}>
          ✓ Done {relCompleted(completedAt)}
        </span>
      );
    }
    return (
      <span className={`k-due k-due--danger${flush ? ' k-due--flush' : ''}`}>
        ✓ Done · {lateDays}d late
      </span>
    );
  }

  // Done but no due date — hide badge
  if (DONE_STATUSES.has(status) && tone === 'danger') return null;

  return (
    <span className={`k-due k-due--${tone}${flush ? ' k-due--flush' : ''}`}>
      {label}
    </span>
  );
}
