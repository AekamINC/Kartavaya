import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';

export default function ShiftDefinitions({ pushToast }) {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingShift, setEditingShift] = useState(null);
  const [editShiftForm, setEditShiftForm] = useState({});
  const [editShiftSaving, setEditShiftSaving] = useState(false);
  const [form, setForm] = useState({ name: '', start_time: '09:00', end_time: '17:00', break_minutes: 30, color: 'var(--st-in-progress)' });

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/manav/shifts');
      setShifts(r.data.data || r.data || []);
    } catch { pushToast({ title: 'Failed to load shifts', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/shifts', { ...form, break_minutes: Number(form.break_minutes) });
      pushToast({ title: 'Shift created', type: 'success' });
      setShowForm(false);
      setForm({ name: '', start_time: '09:00', end_time: '17:00', break_minutes: 30, color: 'var(--st-in-progress)' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  function startEditShift(s) {
    setEditingShift(s.id);
    setEditShiftForm({ name: s.name || '', start_time: s.start_time || '09:00', end_time: s.end_time || '17:00', break_minutes: s.break_minutes ?? 30, color: s.color || 'var(--st-in-progress)' });
  }

  async function saveEditShift(e) {
    e.preventDefault();
    setEditShiftSaving(true);
    try {
      await api.patch(`/v1/manav/shifts/${editingShift}`, { ...editShiftForm, break_minutes: Number(editShiftForm.break_minutes) });
      pushToast({ title: 'Shift updated', type: 'success' });
      setEditingShift(null);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Could not update shift', type: 'error' }); }
    finally { setEditShiftSaving(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Shift Definitions</h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ Add Shift</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Shift</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Start Time *</span>
              <input className="k-input" type="time" required value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>End Time *</span>
              <input className="k-input" type="time" required value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Break (mins)</span>
              <input className="k-input" type="number" value={form.break_minutes} onChange={e => setForm({ ...form, break_minutes: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Color</span>
              <input className="k-input" type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} style={{ height: 36, padding: 2 }} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create Shift'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        shifts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🕐</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No shifts defined</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Create shift templates to schedule your team's working hours.</div>
          </div>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {shifts.map(s => (
            <div key={s.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 16 }}>
              {editingShift === s.id ? (
                <form onSubmit={saveEditShift}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label style={{ fontSize: 12, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>Name</span>
                      <input className="k-input" value={editShiftForm.name} onChange={e => setEditShiftForm({ ...editShiftForm, name: e.target.value })} /></label>
                    <label style={{ fontSize: 12 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>Start</span>
                      <input className="k-input" type="time" value={editShiftForm.start_time} onChange={e => setEditShiftForm({ ...editShiftForm, start_time: e.target.value })} /></label>
                    <label style={{ fontSize: 12 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>End</span>
                      <input className="k-input" type="time" value={editShiftForm.end_time} onChange={e => setEditShiftForm({ ...editShiftForm, end_time: e.target.value })} /></label>
                    <label style={{ fontSize: 12 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>Break (mins)</span>
                      <input className="k-input" type="number" value={editShiftForm.break_minutes} onChange={e => setEditShiftForm({ ...editShiftForm, break_minutes: e.target.value })} /></label>
                    <label style={{ fontSize: 12 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>Color</span>
                      <input className="k-input" type="color" value={editShiftForm.color} onChange={e => setEditShiftForm({ ...editShiftForm, color: e.target.value })} style={{ height: 32, padding: 2 }} /></label>
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                    <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => setEditingShift(null)}>Cancel</button>
                    <button type="submit" className="k-btn k-btn--primary" style={{ fontSize: 11 }} disabled={editShiftSaving}>{editShiftSaving ? 'Saving…' : 'Save'}</button>
                  </div>
                </form>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color || 'var(--st-in-progress)', flexShrink: 0 }} />
                    <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{s.name}</span>
                    <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => startEditShift(s)}>Edit</button>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                    <div>{s.start_time} — {s.end_time}</div>
                    <div>Break: {s.break_minutes ?? 0} mins</div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
