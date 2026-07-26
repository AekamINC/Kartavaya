import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import TodayItem from './TodayItem';

export default function TodayTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/v1/graha/today')
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;
  if (!data) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Could not load today view.</p>;

  const sections = [
    { key: 'overdue_followups', title: 'Overdue Follow-ups', color: '#ef4444', icon: '⏰', emptyMsg: 'No overdue follow-ups' },
    { key: 'stale_deals', title: 'Deals Going Cold', color: '#f59e0b', icon: '🧊', emptyMsg: 'All deals are active' },
    { key: 'new_leads', title: 'New Leads (24h)', color: '#10b981', icon: '🌱', emptyMsg: 'No new leads today' },
    { key: 'todays_activities', title: "Today's Activities", color: '#6366f1', icon: '📋', emptyMsg: 'No activities today' },
    { key: 'recent_closures', title: 'Recent Won/Lost (7d)', color: '#0082c6', icon: '🏁', emptyMsg: 'No recent closures' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
      {sections.map(s => {
        const items = data[s.key] || [];
        return (
          <div key={s.key} style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
              borderBottom: '1px solid var(--rule-soft)', background: 'var(--bg-raised)' }}>
              <span>{s.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{s.title}</span>
              {items.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 99,
                  background: `${s.color}18`, color: s.color }}>{items.length}</span>
              )}
            </div>
            <div style={{ padding: '8px 14px', maxHeight: 280, overflowY: 'auto' }}>
              {items.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--ink-3)', padding: '8px 0' }}>{s.emptyMsg}</p>
              ) : items.map((item, i) => (
                <TodayItem key={item.id || i} item={item} section={s.key} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
