import React from 'react';
import { Badge, SOURCE_COLORS, ACT_ICONS } from './_shared';
import { inr } from '../../lib/inr';

export default function TodayItem({ item, section }) {
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
  const daysAgo = d => { if (!d) return ''; const ms = Date.now() - new Date(d).getTime(); return Math.floor(ms / 86400000) + 'd ago'; };

  if (section === 'overdue_followups') {
    const overdueDays = Math.floor((Date.now() - new Date(item.due_at).getTime()) / 86400000);
    return (
      <div style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600, minWidth: 36 }}>{overdueDays}d</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
          {item.contact_name && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{item.contact_name}</div>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{fmtDate(item.due_at)}</span>
      </div>
    );
  }

  if (section === 'stale_deals') {
    return (
      <div style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{item.contact_name} · {daysAgo(item.updated_at)} since activity</div>
        </div>
        {item.value && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{inr(Number(item.value))}</span>}
      </div>
    );
  }

  if (section === 'new_leads') {
    return (
      <div style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{item.company || item.email || item.phone}</div>
        </div>
        {item.source && <Badge text={item.source} color={SOURCE_COLORS[item.source] || 'var(--on-surface-3)'} />}
      </div>
    );
  }

  if (section === 'todays_activities') {
    return (
      <div style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>{ACT_ICONS[item.activity_type] || '●'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, textDecoration: item.is_completed ? 'line-through' : 'none',
            color: item.is_completed ? 'var(--ink-3)' : 'var(--ink)' }}>{item.title}</div>
          {item.contact_name && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{item.contact_name}</div>}
        </div>
      </div>
    );
  }

  if (section === 'recent_closures') {
    const won = item.stage === 'Won';
    return (
      <div style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Badge text={item.stage} color={won ? 'var(--ok)' : 'var(--danger)'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{item.title}</div>
          {item.contact_name && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{item.contact_name}</div>}
        </div>
        {item.value && <span style={{ fontSize: 12, fontWeight: 600, color: won ? 'var(--ok)' : 'var(--danger)', whiteSpace: 'nowrap' }}>{inr(Number(item.value))}</span>}
      </div>
    );
  }

  return null;
}
