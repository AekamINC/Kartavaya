import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import { Badge, stageColor, TL_ICONS, TL_SUB_ICONS, TL_COLORS } from './_shared';
import { mixAlpha } from '../../lib/statusColors';
import { inr } from '../../lib/inr';

export default function ContactTimeline({ contactId }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback((cur) => {
    const params = cur ? `?cursor=${encodeURIComponent(cur)}&limit=30` : '?limit=30';
    api.get(`/v1/graha/contacts/${contactId}/timeline${params}`)
      .then(r => {
        setItems(prev => cur ? [...prev, ...r.data.data] : r.data.data);
        setCursor(r.data.next_cursor);
        setHasMore(!!r.data.next_cursor);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [contactId]);

  useEffect(() => { load(null); }, [load]);

  if (loading && items.length === 0) return <p style={{ fontSize: 12, color: 'var(--ink-3)', padding: 8 }}>Loading timeline...</p>;

  return (
    <div style={{ marginTop: 16 }}>
      <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-3)', marginBottom: 8 }}>Timeline</h4>
      {items.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>No activity yet.</p>
      ) : (
        <div style={{ position: 'relative', paddingLeft: 24 }}>
          <div style={{ position: 'absolute', left: 7, top: 4, bottom: 4, width: 2, background: 'var(--rule-soft)', borderRadius: 1 }} />
          {items.map((it, i) => {
            const icon = (it.type === 'activity' && it.subtype) ? (TL_SUB_ICONS[it.subtype] || TL_ICONS.activity) : TL_ICONS[it.type];
            const color = TL_COLORS[it.type] || TL_COLORS._default;
            return (
            <div key={`${it.type}-${it.id}-${i}`} style={{ position: 'relative', paddingBottom: 14, paddingLeft: 12 }}>
              <span style={{ position: 'absolute', left: -24, top: 1, width: 18, height: 18, borderRadius: 'var(--r-pill)',
                background: mixAlpha(color, 8), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>{icon}</span>
              <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span>{it.title}</span>
                {it.amount != null && <span style={{ color: 'var(--ok)', fontWeight: 600, fontSize: 12 }}>{inr(Number(it.amount))}</span>}
                {it.stage && <Badge text={it.stage} color={stageColor(it.stage)} />}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                <span style={{ color, fontWeight: 600, textTransform: 'capitalize' }}>{it.subtype || it.type}</span>
                {' · '}{it.ts ? new Date(it.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
              </div>
            </div>
            );
          })}
          {hasMore && (
            <button onClick={() => load(cursor)}
              style={{ fontSize: 12, color: 'var(--k-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
              Load more...
            </button>
          )}
        </div>
      )}
    </div>
  );
}
