import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';

export default function DepartmentsTab() {
  const { pushToast } = useToast();
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '' });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '' });
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/manav/departments');
      setDepartments(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load departments', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/departments', form);
      pushToast({ title: 'Department created', type: 'success' });
      setShowForm(false);
      setForm({ name: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function saveEdit(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      await api.patch(`/v1/manav/departments/${editingId}`, editForm);
      pushToast({ title: 'Department updated', type: 'success' });
      setEditingId(null);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setEditSaving(false); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/manav/departments/${id}`);
      pushToast({ title: 'Department deleted', type: 'success' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  return (
    <div>
      <button className="k-btn k-btn--primary" style={{ fontSize: 13, marginBottom: 16 }} onClick={() => setShowForm(true)}>+ Add Department</button>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Department Name *</span>
            <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ maxWidth: 300 }} /></label>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        departments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏢</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No departments yet</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Organise your team by department for easier reporting and shift management.</div>
          </div>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {departments.map(d => (
            <div key={d.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20 }}>
              {editingId === d.id ? (
                <form onSubmit={saveEdit}>
                  <input className="k-input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} style={{ marginBottom: 8, width: '100%' }} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="submit" className="k-btn k-btn--primary" style={{ fontSize: 11, padding: '2px 8px' }} disabled={editSaving}>{editSaving ? 'Saving…' : 'Save'}</button>
                    <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <h4 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700 }}>{d.name}</h4>
                  <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                    <div>{d.employee_count} employee{d.employee_count !== 1 ? 's' : ''}</div>
                    {d.head_name && <div style={{ marginTop: 4 }}>Head: {d.head_name}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { setEditingId(d.id); setEditForm({ name: d.name }); }}>Edit</button>
                    <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px', color: '#ef4444' }} onClick={() => remove(d.id)}>Delete</button>
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
