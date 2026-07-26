import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge } from './_shared';
import { mixAlpha } from '../../lib/statusColors';

export default function FollowUpsTab() {
  const { pushToast } = useToast();
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [deals, setDeals] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [form, setForm] = useState({ title: '', description: '', contact_id: '', deal_id: '', due_at: '', remind_at: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      let url = '/v1/graha/follow-ups?';
      if (statusFilter) url += `status=${statusFilter}&`;
      const r = await api.get(url);
      setFollowUps(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load follow-ups', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadOptions() {
    try {
      const [c, d] = await Promise.all([api.get('/v1/graha/contacts'), api.get('/v1/graha/deals')]);
      setContacts(c.data.data || []);
      setDeals(d.data.data || []);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/follow-ups', form);
      pushToast({ title: 'Follow-up created', type: 'success' });
      setShowForm(false);
      setForm({ title: '', description: '', contact_id: '', deal_id: '', due_at: '', remind_at: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function complete(id) {
    try {
      await api.patch(`/v1/graha/follow-ups/${id}/complete`);
      pushToast({ title: 'Marked complete', type: 'success' });
      load();
    } catch { pushToast({ title: 'Could not complete follow-up', type: 'error' }); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this follow-up? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/follow-ups/${id}`);
      pushToast({ title: 'Follow-up deleted', type: 'success' });
      setFollowUps(prev => prev.filter(f => f.id !== id));
    } catch { pushToast({ title: 'Could not delete follow-up', type: 'error' }); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="k-input" style={{ width: 130 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); }}>
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => { setShowForm(true); loadOptions(); }}>+ New Follow-up</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Follow-up</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Due Date *</span>
              <input className="k-input" type="datetime-local" required value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact</span>
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Deal</span>
              <select className="k-input" value={form.deal_id} onChange={e => setForm({ ...form, deal_id: e.target.value })}>
                <option value="">None</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Remind At</span>
              <input className="k-input" type="datetime-local" value={form.remind_at} onChange={e => setForm({ ...form, remind_at: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <input className="k-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        followUps.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No follow-ups found.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {followUps.map(f => {
            const overdue = !f.is_completed && new Date(f.due_at) < new Date();
            return (
              <div key={f.id} style={{ background: 'var(--surface-1)', border: `1px solid ${overdue ? mixAlpha('var(--danger)', 25) : 'var(--rule-soft)'}`, borderRadius: 'var(--r-md)', padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, textDecoration: f.is_completed ? 'line-through' : 'none' }}>{f.title}</span>
                  <Badge text={f.is_completed ? 'Done' : overdue ? 'Overdue' : 'Pending'}
                    color={f.is_completed ? 'var(--ok)' : overdue ? 'var(--danger)' : 'var(--warn)'} />
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 6 }}>
                  {f.contact_name && <span>{f.contact_name} · </span>}
                  {f.deal_title && <span>{f.deal_title} · </span>}
                  <span>Due: {new Date(f.due_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  {f.description && <span> · {f.description}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {!f.is_completed && (
                    <button className="k-btn k-btn--primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => complete(f.id)}>Complete</button>
                  )}
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '3px 10px', color: 'var(--danger)' }} onClick={() => remove(f.id)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
