import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { StatTile } from '../../components/editorial';
import { Badge, STAGE_COLORS } from './_shared';

export default function PipelineTab() {
  const { pushToast } = useToast();
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/graha/pipeline-summary');
      setSummary(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load pipeline', type: 'error' }); }
    finally { setLoading(false); }
  }

  const total = summary.reduce((s, r) => s + Number(r.total_value), 0);

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatTile label="Total Pipeline" value={`₹${total.toLocaleString('en-IN')}`} />
        <StatTile label="Active Deals" value={summary.reduce((s, r) => s + Number(r.count), 0)} />
      </div>

      {summary.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No deals yet. Create deals to see your pipeline.</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {summary.map(s => (
            <div key={s.stage} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <Badge text={s.stage} color={STAGE_COLORS[s.stage] || '#6E7B91'} />
              <div style={{ fontSize: 28, fontWeight: 800, margin: '12px 0 4px', color: 'var(--ink-1)' }}>{Number(s.count)}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>₹{Number(s.total_value).toLocaleString('en-IN')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
