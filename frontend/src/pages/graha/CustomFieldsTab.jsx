import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge } from './_shared';

export default function CustomFieldsTab() {
  const { pushToast } = useToast();
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ entity_type: 'contact', field_name: '', field_type: 'text', options: [], is_required: false, sort_order: 0 });

  useEffect(() => {
    api.get('/v1/graha/custom-fields')
      .then(r => setFields(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/custom-fields', form);
      pushToast({ title: 'Field created', type: 'success' });
      setShowForm(false);
      const r = await api.get('/v1/graha/custom-fields');
      setFields(r.data.data || []);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this custom field? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/custom-fields/${id}`);
      setFields(prev => prev.filter(f => f.id !== id));
    } catch { pushToast({ title: 'Could not delete field', type: 'error' }); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  const FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox', 'url', 'email', 'phone'];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Custom Fields ({fields.length})</h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => setShowForm(!showForm)}>+ New Field</button>
      </div>

      {showForm && (
        <form onSubmit={create} style={{ border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-sm)', padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Entity</span>
              <select className="k-input" value={form.entity_type} onChange={e => setForm({ ...form, entity_type: e.target.value })}>
                <option value="contact">Contact</option><option value="deal">Deal</option></select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Field Name</span>
              <input className="k-input" value={form.field_name} onChange={e => setForm({ ...form, field_name: e.target.value })} required /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</span>
              <select className="k-input" value={form.field_type} onChange={e => setForm({ ...form, field_type: e.target.value })}>
                {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={form.is_required} onChange={e => setForm({ ...form, is_required: e.target.checked })} />
              Required</label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, marginRight: 4 }}>Order:</span>
              <input type="number" className="k-input" style={{ width: 60 }} value={form.sort_order}
                onChange={e => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Create</button>
          </div>
        </form>
      )}

      {['contact', 'deal'].map(entity => {
        const ef = fields.filter(f => f.entity_type === entity);
        if (!ef.length) return null;
        return (
          <div key={entity} style={{ marginBottom: 20 }}>
            <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-3)', marginBottom: 8 }}>
              {entity} fields
            </h4>
            {ef.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--rule-soft)' }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{f.field_name}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 8 }}>{f.field_type}</span>
                  {f.is_required && <Badge text="required" color="var(--danger)" />}
                </div>
                <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: 'var(--danger)' }} onClick={() => remove(f.id)}>Delete</button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
