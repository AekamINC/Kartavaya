import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import TodayItem from './TodayItem';
import { mixAlpha } from '../../lib/statusColors';

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
    { key: 'overdue_followups', title: 'Overdue Follow-ups', color: 'var(--danger)', icon: '⏰', emptyMsg: 'No overdue follow-ups' },
    { key: 'stale_deals', title: 'Deals Going Cold', color: 'var(--warn)', icon: '🧊', emptyMsg: 'All deals are active' },
    { key: 'new_leads', title: 'New Leads (24h)', color: 'var(--ok)', icon: '🌱', emptyMsg: 'No new leads today' },
    { key: 'todays_activities', title: "Today's Activities", color: 'var(--st-in-review)', icon: '📋', emptyMsg: 'No activities today' },
    { key: 'recent_closures', title: 'Recent Won/Lost (7d)', color: 'var(--st-in-progress)', icon: '🏁', emptyMsg: 'No recent closures' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
      {sections.map(s => {
        const items = data[s.key] || [];
        return (
          <div key={s.key} style={{ border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
              borderBottom: '1px solid var(--rule-soft)', background: 'var(--bg-raised)' }}>
              <span>{s.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{s.title}</span>
              {items.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 'var(--r-pill)',
                  background: mixAlpha(s.color, 9), color: s.color }}>{items.length}</span>
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
