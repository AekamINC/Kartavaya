import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader } from '../components/editorial';

export default function HubClientsPage() {
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', industry: '', website: '', contact_name: '', contact_email: '', contact_phone: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/hub/clients');
      setClients(r.data.data || []);
    } catch {
      pushToast({ title: 'Failed to load clients', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/hub/clients', form);
      pushToast({ title: 'Client created', type: 'success' });
      setShowCreate(false);
      setForm({ name: '', slug: '', industry: '', website: '', contact_name: '', contact_email: '', contact_phone: '' });
      load();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to create client', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function autoSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Loading…</div>;

  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader title="Hub Clients" subtitle="Manage your brand clients" />

      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="k-btn k-btn--primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : '+ New Client'}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>New Client</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" value={form.name} required
                onChange={e => setForm({ ...form, name: e.target.value, slug: autoSlug(e.target.value) })} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Slug *</span>
              <input className="k-input" value={form.slug} required pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]"
                onChange={e => setForm({ ...form, slug: e.target.value })} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Industry</span>
              <input className="k-input" value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Website</span>
              <input className="k-input" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact Name</span>
              <input className="k-input" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact Email</span>
              <input className="k-input" type="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact Phone</span>
              <input className="k-input" value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} />
            </label>
          </div>
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create Client'}
            </button>
          </div>
        </form>
      )}

      {clients.length === 0 ? (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 48, textAlign: 'center' }}>
          <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>No clients yet. Create your first client to start generating AI content.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {clients.map(c => (
            <div key={c.id} onClick={() => navigate(`/hub/clients/${c.id}`)}
              style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20, cursor: 'pointer', transition: 'border-color .15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--k-primary)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--rule-soft)'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--k-primary-ghost)', color: 'var(--k-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16 }}>
                  {c.name?.[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink-1)' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{c.slug}</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-3)' }}>
                <span>{c.industry || '—'}</span>
                <span style={{ fontWeight: 700, color: 'var(--k-primary)' }}>{c.credits ?? 0} credits</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
