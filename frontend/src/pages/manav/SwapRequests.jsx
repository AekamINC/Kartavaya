import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';

export default function SwapRequests({ pushToast }) {
  const [swaps, setSwaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ requester_schedule_id: '', target_employee_id: '', reason: '' });
  const [employees, setEmployees] = useState([]);

  useEffect(() => { load(); loadEmployees(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/manav/swaps?status=pending');
      setSwaps(r.data.data || r.data || []);
    } catch { pushToast({ title: 'Failed to load swaps', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadEmployees() {
    try {
      const r = await api.get('/v1/manav/employees');
      setEmployees(r.data.data || r.data || []);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/swaps', form);
      pushToast({ title: 'Swap request created', type: 'success' });
      setShowForm(false);
      setForm({ requester_schedule_id: '', target_employee_id: '', reason: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function handleAction(id, action) {
    try {
      await api.patch(`/v1/manav/swaps/${id}?action=${action}`);
      pushToast({ title: `Swap ${action}`, type: 'success' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Swap Requests</h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ Request Swap</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Swap Request</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Schedule ID *</span>
              <input className="k-input" required placeholder="Your schedule ID" value={form.requester_schedule_id} onChange={e => setForm({ ...form, requester_schedule_id: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Target Employee *</span>
              <select className="k-input" required value={form.target_employee_id} onChange={e => setForm({ ...form, target_employee_id: e.target.value })}>
                <option value="">— Select —</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Reason</span>
              <input className="k-input" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Submitting…' : 'Submit'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        swaps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 24px' }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>🔄</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>No pending swaps</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Shift swap requests between employees appear here.</div>
          </div>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {swaps.map(s => (
            <div key={s.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                <div><strong>{s.requester_name}</strong> wants to swap with <strong>{s.target_name}</strong></div>
                <div style={{ color: 'var(--ink-2)', marginTop: 4 }}>{s.schedule_date} · {s.shift_name}</div>
                {s.reason && <div style={{ color: 'var(--ink-2)', marginTop: 2, fontStyle: 'italic' }}>"{s.reason}"</div>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="k-btn k-btn--primary" style={{ fontSize: 12, flex: 1 }} onClick={() => handleAction(s.id, 'approved')}>Approve</button>
                <button className="k-btn k-btn--ghost" style={{ fontSize: 12, flex: 1, color: 'var(--danger)' }} onClick={() => handleAction(s.id, 'rejected')}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
