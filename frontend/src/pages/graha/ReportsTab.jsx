import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { StatTile } from '../../components/editorial';
import { formatINR } from '../../lib/utils';
import { Badge, stageColor, SOURCE_COLORS } from './_shared';

export default function ReportsTab() {
  const [conversion, setConversion] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [velocity, setVelocity] = useState(null);
  const [sources, setSources] = useState(null);
  const [reps, setReps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(90);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/v1/graha/reports/conversion?days=${days}`),
      api.get('/v1/graha/reports/forecast'),
      api.get(`/v1/graha/reports/pipeline-velocity?days=${days}`),
      api.get(`/v1/graha/reports/source-analysis?days=${days}`),
      api.get(`/v1/graha/reports/rep-performance?days=${days}`).catch(() => ({ data: null })),
    ]).then(([c, f, v, s, r]) => {
      setConversion(c.data);
      setForecast(f.data);
      setVelocity(v.data);
      setSources(s.data);
      setReps(r.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [days]);

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading reports...</p>;

  const fmt = v => v != null ? formatINR(v) : '—';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Period:</span>
        {[30, 60, 90, 180].map(d => (
          <button key={d} className={`k-btn ${days === d ? 'k-btn--primary' : 'k-btn--ghost'}`}
            style={{ fontSize: 11, padding: '2px 10px' }} onClick={() => setDays(d)}>{d}d</button>
        ))}
      </div>

      {conversion && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatTile label="Total Deals" value={conversion.total_deals} />
          <StatTile label="Won" value={conversion.won} />
          <StatTile label="Lost" value={conversion.lost} />
          <StatTile label="Open" value={conversion.open} />
          <StatTile label="Win Rate" value={`${conversion.conversion_rate}%`} />
          <StatTile label="Won Value" value={fmt(conversion.won_value)} />
          <StatTile label="Avg Cycle" value={`${conversion.avg_cycle_days}d`} />
        </div>
      )}

      {forecast && (
        <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-sm)', padding: 16, marginBottom: 24 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Revenue Forecast</h4>
          <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Pipeline</div><div style={{ fontSize: 18, fontWeight: 600 }}>{fmt(forecast.total_pipeline)}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Weighted</div><div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ok)' }}>{fmt(forecast.weighted_forecast)}</div></div>
          </div>
          {forecast.stages?.map(s => (
            <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
              <Badge text={s.stage} color={stageColor(s.stage)} />
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{s.count} deals</span>
              <span style={{ fontSize: 12, fontWeight: 600, minWidth: 100, textAlign: 'right' }}>{fmt(s.total_value)}</span>
              <span style={{ fontSize: 11, color: 'var(--ok)', minWidth: 90, textAlign: 'right' }}>≈ {fmt(s.weighted_value)}</span>
            </div>
          ))}
        </div>
      )}

      {velocity?.data?.length > 0 && (
        <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-sm)', padding: 16, marginBottom: 24 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Pipeline Velocity</h4>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Stage', 'Count', 'Total Value', 'Avg Value', 'Avg Days'].map(h =>
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase' }}>{h}</th>
              )}
            </tr></thead>
            <tbody>{velocity.data.map(r => (
              <tr key={r.stage} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '6px 8px' }}><Badge text={r.stage} color={stageColor(r.stage)} /></td>
                <td style={{ padding: '6px 8px' }}>{r.count}</td>
                <td style={{ padding: '6px 8px' }}>{fmt(r.total_value)}</td>
                <td style={{ padding: '6px 8px' }}>{fmt(r.avg_value)}</td>
                <td style={{ padding: '6px 8px' }}>{r.avg_days_in_stage ?? '—'}d</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {sources?.data?.length > 0 && (
        <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-sm)', padding: 16, marginBottom: 24 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Lead Source Analysis</h4>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Source', 'Leads', 'Deals', 'Won', 'Won Value'].map(h =>
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase' }}>{h}</th>
              )}
            </tr></thead>
            <tbody>{sources.data.map(r => (
              <tr key={r.source} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '6px 8px' }}><Badge text={r.source} color={SOURCE_COLORS[r.source] || 'var(--on-surface-3)'} /></td>
                <td style={{ padding: '6px 8px' }}>{r.leads}</td>
                <td style={{ padding: '6px 8px' }}>{r.deals}</td>
                <td style={{ padding: '6px 8px' }}>{r.won}</td>
                <td style={{ padding: '6px 8px' }}>{fmt(r.won_value)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {reps?.data?.length > 0 && (
        <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-sm)', padding: 16 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Rep Performance</h4>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Rep', 'Total', 'Won', 'Lost', 'Won Value', 'Avg Deal'].map(h =>
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase' }}>{h}</th>
              )}
            </tr></thead>
            <tbody>{reps.data.map(r => (
              <tr key={r.assigned_to} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '6px 8px', fontSize: 11, fontFamily: 'var(--mono)' }}>{r.assigned_to?.slice(0, 12) || '—'}</td>
                <td style={{ padding: '6px 8px' }}>{r.total_deals}</td>
                <td style={{ padding: '6px 8px', color: 'var(--ok)' }}>{r.won}</td>
                <td style={{ padding: '6px 8px', color: 'var(--danger)' }}>{r.lost}</td>
                <td style={{ padding: '6px 8px' }}>{fmt(r.won_value)}</td>
                <td style={{ padding: '6px 8px' }}>{fmt(r.avg_deal_value)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
