import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ACTIVITY_TYPES } from './_shared';

export default function ActivitiesTab() {
  const { pushToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ activity_type: 'note', title: '', description: '', deal_id: '', contact_id: '' });
  const [saving, setSaving] = useState(false);
  const [deals, setDeals] = useState([]);
  const [contacts, setContacts] = useState([]);

  async function loadOptions() {
    try {
      const [d, c] = await Promise.all([
        api.get('/v1/graha/deals'), api.get('/v1/graha/contacts'),
      ]);
      setDeals(d.data.data || []);
      setContacts(c.data.data || []);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/activities', form);
      pushToast({ title: 'Activity logged', type: 'success' });
      setShowForm(false);
      setForm({ activity_type: 'note', title: '', description: '', deal_id: '', contact_id: '' });
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <button className="k-btn k-btn--primary" style={{ fontSize: 13, marginBottom: 16 }} onClick={() => { setShowForm(true); loadOptions(); }}>
        + Log Activity
      </button>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Log Activity</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</span>
              <select className="k-input" value={form.activity_type} onChange={e => setForm({ ...form, activity_type: e.target.value })}>
                {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Deal</span>
              <select className="k-input" value={form.deal_id} onChange={e => setForm({ ...form, deal_id: e.target.value })}>
                <option value="">None</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact</span>
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <textarea className="k-input" rows={3} value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })} style={{ resize: 'vertical' }} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Log Activity'}</button>
          </div>
        </form>
      )}

      {!showForm && (
        <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>
          Activities are logged against contacts and deals. Open a contact or deal to see its full activity history.
        </p>
      )}
    </div>
  );
}
