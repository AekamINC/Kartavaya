import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge } from './_shared';

export default function TerritoriesTab() {
  const { pushToast } = useToast();
  const [territories, setTerritories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', assigned_users: [] });
  const [userInput, setUserInput] = useState('');

  useEffect(() => {
    api.get('/v1/graha/territories')
      .then(r => setTerritories(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/territories', form);
      pushToast({ title: 'Territory created', type: 'success' });
      setShowForm(false);
      setForm({ name: '', description: '', assigned_users: [] });
      const r = await api.get('/v1/graha/territories');
      setTerritories(r.data.data || []);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this territory? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/territories/${id}`);
      setTerritories(prev => prev.filter(t => t.id !== id));
    } catch { pushToast({ title: 'Could not delete territory', type: 'error' }); }
  }

  function addUser() {
    const u = userInput.trim();
    if (u && !form.assigned_users.includes(u)) {
      setForm({ ...form, assigned_users: [...form.assigned_users, u] });
      setUserInput('');
    }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Territories ({territories.length})</h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => setShowForm(!showForm)}>+ New Territory</button>
      </div>

      {showForm && (
        <form onSubmit={create} style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name</span>
              <input className="k-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <input className="k-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4, fontSize: 13 }}>Assigned Users</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {form.assigned_users.map(u => (
                <span key={u} style={{ fontSize: 11, background: 'var(--bg-raised)', padding: '2px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {u.slice(0, 12)}
                  <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#ef4444' }}
                    onClick={() => setForm({ ...form, assigned_users: form.assigned_users.filter(x => x !== u) })}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="k-input" placeholder="User ID" value={userInput} onChange={e => setUserInput(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="k-btn k-btn--ghost" onClick={addUser}>Add</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Create</button>
          </div>
        </form>
      )}

      {territories.map(t => (
        <div key={t.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--rule-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
              {t.description && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t.description}</div>}
            </div>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{t.assigned_users?.length || 0} users</span>
            <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: '#ef4444' }} onClick={() => remove(t.id)}>Delete</button>
          </div>
          {t.assigned_users?.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {t.assigned_users.map(u => <Badge key={u} text={u.slice(0, 12)} color="#6366f1" />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
