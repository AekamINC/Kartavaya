import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';

// The one literal in this module that stays a literal. A label colour is USER
// DATA: it is persisted to the DB and fed to <input type="color">, which accepts
// only #rrggbb — a var() reference there is invalid and the control silently
// resets to #000000. This is a seed value for a data field, not a colour in the
// design system, so the "no hardcoded hex" rule does not reach it.
const DEFAULT_LABEL_COLOR = '#6366f1';

export default function LabelsTab() {
  const { pushToast } = useToast();
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', color: DEFAULT_LABEL_COLOR });
  const [saving, setSaving] = useState(false);
  const [assignForm, setAssignForm] = useState({ contact_id: '', label_id: '' });
  const [showAssign, setShowAssign] = useState(false);
  const [contacts, setContacts] = useState([]);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/graha/labels');
      setLabels(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load labels', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/labels', form);
      pushToast({ title: 'Label created', type: 'success' });
      setShowForm(false);
      setForm({ name: '', color: DEFAULT_LABEL_COLOR });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this label? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/labels/${id}`);
      pushToast({ title: 'Label deleted', type: 'success' });
      setLabels(prev => prev.filter(l => l.id !== id));
    } catch { pushToast({ title: 'Could not delete label', type: 'error' }); }
  }

  async function loadContacts() {
    try {
      const r = await api.get('/v1/graha/contacts');
      setContacts(r.data.data || []);
    } catch {}
  }

  async function assignLabel(e) {
    e.preventDefault();
    try {
      await api.post(`/v1/graha/contacts/${assignForm.contact_id}/labels/${assignForm.label_id}`);
      pushToast({ title: 'Label assigned', type: 'success' });
      setShowAssign(false);
      setAssignForm({ contact_id: '', label_id: '' });
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ New Label</button>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 13 }} onClick={() => { setShowAssign(true); loadContacts(); }}>Assign to Contact</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Label</h3>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ fontSize: 13, flex: 1 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Color</span>
              <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })}
                style={{ width: 48, height: 36, border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-sm)', cursor: 'pointer' }} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {showAssign && (
        <form onSubmit={assignLabel} style={{ background: 'var(--surface-1)', border: '1px solid var(--k-primary)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Assign Label to Contact</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact *</span>
              <select className="k-input" required value={assignForm.contact_id} onChange={e => setAssignForm({ ...assignForm, contact_id: e.target.value })}>
                <option value="">Select…</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Label *</span>
              <select className="k-input" required value={assignForm.label_id} onChange={e => setAssignForm({ ...assignForm, label_id: e.target.value })}>
                <option value="">Select…</option>
                {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowAssign(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Assign</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        labels.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No labels yet.</p> : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {labels.map(l => (
            <div key={l.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 16, height: 16, borderRadius: 'var(--r-xs)', background: l.color || 'var(--on-surface-3)' }} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{l.name}</span>
              <button onClick={() => remove(l.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 11, marginLeft: 8 }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
