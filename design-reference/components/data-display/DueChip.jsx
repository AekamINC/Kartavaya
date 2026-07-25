import React from 'react';

function relDue(iso) {
  if (!iso) return { label: '—', tone: 'muted' };
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const diff = Math.round((d - now) / 86400000);
  if (diff < 0)   return { label: Math.abs(diff) + 'd overdue', tone: 'danger' };
  if (diff === 0) return { label: 'Today', tone: 'warn' };
  if (diff === 1) return { label: 'Tomorrow', tone: 'warn' };
  if (diff < 7)   return { label: 'In ' + diff + 'd', tone: 'normal' };
  return { label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), tone: 'muted' };
}

export function DueChip({ date, variant, flush }) {
  const { label, tone } = variant ? { label: date, tone: variant } : relDue(date);
  return (
    <span className={'k-due k-due--' + tone + (flush ? ' k-due--flush' : '')}>
      {label}
    </span>
  );
}
