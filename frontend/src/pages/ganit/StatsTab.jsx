import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { StatTile } from '../../components/editorial';
import { inr } from '../../lib/inr';

export default function StatsTab() {
  const { pushToast } = useToast();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/ganit/stats');
      setStats(r.data);
    } catch { pushToast({ title: 'Failed to load stats', type: 'error' }); }
    finally { setLoading(false); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p>;
  if (!stats) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
      <StatTile label="Total Invoices" value={stats.total_invoices} />
      <StatTile label="Outstanding" value={inr(Number(stats.total_outstanding))} />
      <StatTile label="Collected" value={inr(Number(stats.total_collected))} />
      <StatTile label="Unpaid" value={stats.unpaid_count} />
      <StatTile label="Overdue" value={stats.overdue_count} />
    </div>
  );
}
