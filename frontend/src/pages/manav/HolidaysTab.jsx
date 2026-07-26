import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge } from './_shared';

export default function HolidaysTab() {
  const { pushToast } = useToast();
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', is_optional: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/manav/holidays');
      setHolidays(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load holidays', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/holidays', form);
      pushToast({ title: 'Holiday added', type: 'success' });
      setShowForm(false);
      setForm({ name: '', date: '', is_optional: false });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function deleteHoliday(id) {
    try {
      await api.delete(`/v1/manav/holidays/${id}`);
      setHolidays(prev => prev.filter(h => h.id !== id));
      pushToast({ title: 'Holiday removed', type: 'success' });
    } catch { pushToast({ title: 'Could not remove holiday', type: 'error' }); }
  }

  return (
    <div>
      <button className="k-btn k-btn--primary" style={{ fontSize: 13, marginBottom: 16 }} onClick={() => setShowForm(true)}>+ Add Holiday</button>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Date *</span>
              <input className="k-input" type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
          </div>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <input type="checkbox" checked={form.is_optional} onChange={e => setForm({ ...form, is_optional: e.target.checked })} />
            <span style={{ fontWeight: 600 }}>Optional Holiday</span></label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Adding…' : 'Add Holiday'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        holidays.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No holidays configured</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Add public holidays and company-wide days off for this year.</div>
          </div>
        ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Date', 'Name', 'Type', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holidays.map(h => (
              <tr key={h.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '10px' }}>{h.date}</td>
                <td style={{ padding: '10px', fontWeight: 600 }}>{h.name}</td>
                <td style={{ padding: '10px' }}><Badge text={h.is_optional ? 'Optional' : 'Mandatory'} color={h.is_optional ? 'var(--warn)' : 'var(--ok)'} /></td>
                <td style={{ padding: '10px' }}>
                  <button onClick={() => deleteHoliday(h.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 11 }}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
