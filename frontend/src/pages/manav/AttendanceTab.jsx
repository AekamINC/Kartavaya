import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge, ATT_STATUSES, ATT_COLORS } from './_shared';

export default function AttendanceTab() {
  const { pushToast } = useToast();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [showMark, setShowMark] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [markForm, setMarkForm] = useState({ employee_id: '', date: new Date().toISOString().split('T')[0], status: 'present', check_in: '', check_out: '', notes: '' });
  const [summary, setSummary] = useState(null);
  const [viewMode, setViewMode] = useState('daily');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get(`/v1/manav/attendance?date_from=${dateFrom}&date_to=${dateTo}`);
      setRecords(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load attendance', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadSummary() {
    try {
      const month = dateFrom.substring(0, 7);
      const r = await api.get(`/v1/manav/attendance/summary?month=${month}`);
      setSummary(r.data);
    } catch { pushToast({ title: 'Failed to load summary', type: 'error' }); }
  }

  async function loadEmployees() {
    try {
      const r = await api.get('/v1/manav/employees');
      setEmployees(r.data.data || []);
    } catch {}
  }

  async function markAttendance(e) {
    e.preventDefault();
    try {
      await api.post('/v1/manav/attendance', markForm);
      pushToast({ title: 'Attendance marked', type: 'success' });
      setShowMark(false);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input className="k-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 150 }} />
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>to</span>
        <input className="k-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: 150 }} />
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>View</button>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={() => { setViewMode('summary'); loadSummary(); }}>Monthly Summary</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => { setShowMark(true); loadEmployees(); setViewMode('daily'); }}>Mark Attendance</button>
      </div>

      {showMark && (
        <form onSubmit={markAttendance} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Mark Attendance</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Employee *</span>
              <select className="k-input" required value={markForm.employee_id} onChange={e => setMarkForm({ ...markForm, employee_id: e.target.value })}>
                <option value="">Select…</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code || '—'})</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Date</span>
              <input className="k-input" type="date" value={markForm.date} onChange={e => setMarkForm({ ...markForm, date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Status</span>
              <select className="k-input" value={markForm.status} onChange={e => setMarkForm({ ...markForm, status: e.target.value })}>
                {ATT_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Check In</span>
              <input className="k-input" type="datetime-local" value={markForm.check_in} onChange={e => setMarkForm({ ...markForm, check_in: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Check Out</span>
              <input className="k-input" type="datetime-local" value={markForm.check_out} onChange={e => setMarkForm({ ...markForm, check_out: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
              <input className="k-input" value={markForm.notes} onChange={e => setMarkForm({ ...markForm, notes: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowMark(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Mark</button>
          </div>
        </form>
      )}

      {viewMode === 'summary' && summary ? (
        <div>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Monthly Summary — {summary.month}</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                {['Code', 'Name', 'Present', 'Absent', 'Half Day', 'Late', 'Leaves', 'Hours', 'OT'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(summary.data || []).map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.employee_code || '—'}</td>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{r.name}</td>
                  <td style={{ padding: '8px', color: 'var(--ok)' }}>{r.present_days}</td>
                  <td style={{ padding: '8px', color: 'var(--danger)' }}>{r.absent_days}</td>
                  <td style={{ padding: '8px' }}>{r.half_days}</td>
                  <td style={{ padding: '8px', color: 'var(--st-in-review)' }}>{r.late_days}</td>
                  <td style={{ padding: '8px', color: 'var(--st-in-progress)' }}>{r.leave_days}</td>
                  <td style={{ padding: '8px' }}>{Number(r.total_hours).toFixed(1)}</td>
                  <td style={{ padding: '8px' }}>{Number(r.overtime_hours).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginTop: 12 }} onClick={() => setViewMode('daily')}>Back to Daily View</button>
        </div>
      ) : (
        <>
          {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
            records.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No attendance records</div>
                <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>No records found for this date range. Try adjusting the filters above.</div>
              </div>
            ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  {['Date', 'Employee', 'Status', 'Check In', 'Check Out', 'Hours', 'Marked By'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                    <td style={{ padding: '8px' }}>{r.date}</td>
                    <td style={{ padding: '8px', fontWeight: 600 }}>{r.employee_name} <span style={{ fontWeight: 400, color: 'var(--ink-3)', fontSize: 11 }}>({r.employee_code || '—'})</span></td>
                    <td style={{ padding: '8px' }}><Badge text={r.status} color={ATT_COLORS[r.status] || 'var(--on-surface-3)'} /></td>
                    <td style={{ padding: '8px', fontSize: 12 }}>{r.check_in ? new Date(r.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td style={{ padding: '8px', fontSize: 12 }}>{r.check_out ? new Date(r.check_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td style={{ padding: '8px' }}>{r.work_hours ? `${Number(r.work_hours).toFixed(1)}h` : '—'}</td>
                    <td style={{ padding: '8px', fontSize: 11, color: 'var(--ink-3)' }}>{r.marked_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
