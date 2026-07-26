import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';

export default function ShiftBids({ pushToast }) {
  const [bids, setBids] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ shift_id: '', date: '', slots_needed: 1 });

  useEffect(() => { load(); loadShifts(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/manav/shift-bids?status=open');
      setBids(r.data.data || r.data || []);
    } catch { pushToast({ title: 'Failed to load bids', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadShifts() {
    try {
      const r = await api.get('/v1/manav/shifts');
      setShifts(r.data.data || r.data || []);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/shift-bids', { ...form, slots_needed: Number(form.slots_needed) });
      pushToast({ title: 'Bid posted', type: 'success' });
      setShowForm(false);
      setForm({ shift_id: '', date: '', slots_needed: 1 });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function applyBid(id) {
    try {
      await api.post(`/v1/manav/shift-bids/${id}/apply`);
      pushToast({ title: 'Applied to bid', type: 'success' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Shift Bids</h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ Post Bid</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Shift Bid</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Shift *</span>
              <select className="k-input" required value={form.shift_id} onChange={e => setForm({ ...form, shift_id: e.target.value })}>
                <option value="">— Select —</option>
                {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Date *</span>
              <input className="k-input" type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Slots Needed *</span>
              <input className="k-input" type="number" min="1" required value={form.slots_needed} onChange={e => setForm({ ...form, slots_needed: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Posting…' : 'Post Bid'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        bids.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 24px' }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>🙋</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>No open bids</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Employees can bid for open shifts here.</div>
          </div>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {bids.map(b => (
            <div key={b.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{b.shift_name}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 8 }}>
                <div>Date: {b.date}</div>
                <div>Slots needed: {b.slots_needed}</div>
                <div>Responses: {b.responses ?? 0}</div>
              </div>
              <button className="k-btn k-btn--primary" style={{ fontSize: 12, width: '100%' }} onClick={() => applyBid(b.id)}>Apply</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
