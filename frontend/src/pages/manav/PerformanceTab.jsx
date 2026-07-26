import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';

export default function PerformanceTab() {
  const { pushToast } = useToast();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().substring(0, 7));

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [y, m] = month.split('-');
      const from_date = `${y}-${m}-01`;
      const lastDay = new Date(Number(y), Number(m), 0).getDate();
      const to_date = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
      const r = await api.get(`/v1/manav/performance/summary?from_date=${from_date}&to_date=${to_date}`);
      setData(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load performance', type: 'error' }); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input className="k-input" type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ width: 180 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={load}>Load</button>
      </div>

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        data.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📈</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No performance data</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Attendance-based performance summary for the selected month. Mark attendance first to see metrics here.</div>
          </div>
        ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Employee', 'Department', 'Present', 'Absent', 'Late', 'Leaves Used', 'Total Hours', 'Avg Hours/Day', 'Attendance %'].map(h => (
                <th key={h} style={{ textAlign: ['Present', 'Absent', 'Late', 'Leaves Used', 'Total Hours', 'Avg Hours/Day', 'Attendance %'].includes(h) ? 'right' : 'left',
                  padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(e => {
              const present = Number(e.days_present || 0);
              const absent = Number(e.days_absent || 0);
              const totalDays = present + absent;
              const attendance_pct = totalDays > 0 ? ((present / totalDays) * 100).toFixed(0) : '—';
              const avg_hours = present > 0 ? (Number(e.total_work_hours || 0) / present).toFixed(1) : '—';
              return (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '10px', fontWeight: 600 }}>{e.name}</td>
                  <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{e.department || '—'}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: '#10b981' }}>{e.days_present}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: '#ef4444' }}>{e.days_absent}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: '#6366f1' }}>{e.days_late}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: '#0082c6' }}>{e.leaves_taken}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{Number(e.total_work_hours || 0).toFixed(1)}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{avg_hours}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>
                    <span style={{ color: Number(attendance_pct) >= 90 ? '#10b981' : Number(attendance_pct) >= 75 ? '#f59e0b' : '#ef4444' }}>
                      {attendance_pct}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
