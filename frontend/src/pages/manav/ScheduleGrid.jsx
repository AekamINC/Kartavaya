import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { Badge } from './_shared';

export default function ScheduleGrid({ pushToast }) {
  const [schedules, setSchedules] = useState([]);
  const [coverage, setCoverage] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [form, setForm] = useState({ employee_id: '', shift_id: '', date: today });

  useEffect(() => { loadDropdowns(); }, []);

  async function loadDropdowns() {
    try {
      const [e, s] = await Promise.all([api.get('/v1/manav/employees'), api.get('/v1/manav/shifts')]);
      setEmployees(e.data.data || e.data || []);
      setShifts(s.data.data || s.data || []);
    } catch {}
  }

  async function loadSchedules() {
    setLoading(true);
    try {
      const r = await api.get(`/v1/manav/schedules?date_from=${dateFrom}&date_to=${dateTo}`);
      setSchedules(r.data.data || r.data || []);
    } catch { pushToast({ title: 'Failed to load schedules', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadCoverage() {
    try {
      const r = await api.get(`/v1/manav/schedules/coverage?date_from=${dateFrom}&date_to=${dateTo}`);
      setCoverage(r.data.data || r.data || []);
      setShowCoverage(true);
    } catch { pushToast({ title: 'Failed to load coverage', type: 'error' }); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/schedules', form);
      pushToast({ title: 'Schedule assigned', type: 'success' });
      setShowForm(false);
      setForm({ employee_id: '', shift_id: '', date: today });
      loadSchedules();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13 }}>From <input className="k-input" type="date" aria-label="Filter from date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
        <label style={{ fontSize: 13 }}>To <input className="k-input" type="date" aria-label="Filter to date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={loadSchedules}>Load</button>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={loadCoverage}>Coverage</button>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ Assign Shift</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Assign Shift</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Employee *</span>
              <select className="k-input" required value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })}>
                <option value="">— Select —</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Shift *</span>
              <select className="k-input" required value={form.shift_id} onChange={e => setForm({ ...form, shift_id: e.target.value })}>
                <option value="">— Select —</option>
                {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Date *</span>
              <input className="k-input" type="date" aria-label="Assign date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Assigning…' : 'Assign'}</button>
          </div>
        </form>
      )}

      {showCoverage && coverage.length > 0 && (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Coverage</h4>
            <button className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => setShowCoverage(false)}>Close</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                {['Date', 'Shift', 'Assigned'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {coverage.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '8px 10px' }}>{c.date}</td>
                  <td style={{ padding: '8px 10px' }}>{c.shift_name}</td>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{c.assigned_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        schedules.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No schedules. Select dates and click Load.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Date', 'Employee', 'Shift', 'Start', 'End'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schedules.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '8px 10px' }}>{s.date}</td>
                <td style={{ padding: '8px 10px' }}>{s.employee_name}</td>
                <td style={{ padding: '8px 10px' }}><Badge text={s.shift_name} color={s.color || '#3B82F6'} /></td>
                <td style={{ padding: '8px 10px' }}>{s.start_time}</td>
                <td style={{ padding: '8px 10px' }}>{s.end_time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
