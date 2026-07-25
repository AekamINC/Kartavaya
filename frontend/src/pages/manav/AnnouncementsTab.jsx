import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge, PRIORITY_COLORS } from './_shared';

export default function AnnouncementsTab() {
  const { pushToast } = useToast();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', body: '', priority: 'normal', pinned: false, expires_at: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/manav/announcements');
      setAnnouncements(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load announcements', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/v1/manav/announcements/${editing}`, form);
        pushToast({ title: 'Announcement updated', type: 'success' });
        setEditing(null);
      } else {
        await api.post('/v1/manav/announcements', form);
        pushToast({ title: 'Announcement published', type: 'success' });
      }
      setShowForm(false);
      setForm({ title: '', body: '', priority: 'normal', pinned: false, expires_at: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/manav/announcements/${id}`);
      pushToast({ title: 'Announcement removed', type: 'success' });
      setAnnouncements(prev => prev.filter(a => a.id !== id));
    } catch { pushToast({ title: 'Could not remove announcement', type: 'error' }); }
  }

  function startEdit(a) {
    setEditing(a.id);
    setForm({ title: a.title, body: a.body, priority: a.priority, pinned: a.pinned, expires_at: a.expires_at || '' });
    setShowForm(true);
  }

  return (
    <div>
      <button className="k-btn k-btn--primary" style={{ fontSize: 13, marginBottom: 16 }} onClick={() => { setShowForm(true); setEditing(null); setForm({ title: '', body: '', priority: 'normal', pinned: false, expires_at: '' }); }}>
        + New Announcement
      </button>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>{editing ? 'Edit' : 'New'} Announcement</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Body *</span>
              <textarea className="k-input" required rows={4} value={form.body}
                onChange={e => setForm({ ...form, body: e.target.value })} style={{ resize: 'vertical' }} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Priority</span>
              <select className="k-input" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                {['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Expires At</span>
              <input className="k-input" type="datetime-local" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} /></label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.pinned} onChange={e => setForm({ ...form, pinned: e.target.checked })} />
              <span style={{ fontWeight: 600 }}>Pin to top</span></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Publish'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        announcements.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📢</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No announcements</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Post company-wide announcements that all employees will see.</div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {announcements.map(a => (
            <div key={a.id} style={{ background: 'var(--surface-1)', border: `1px solid ${a.pinned ? 'var(--k-primary)' : 'var(--rule-soft)'}`, borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {a.pinned && <span style={{ fontSize: 14 }}>📌</span>}
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{a.title}</h4>
                </div>
                <Badge text={a.priority} color={PRIORITY_COLORS[a.priority] || '#6E7B91'} />
              </div>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{a.body}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {new Date(a.published_at || a.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  {a.expires_at && ` · Expires: ${new Date(a.expires_at).toLocaleDateString('en-IN')}`}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => startEdit(a)}>Edit</button>
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: '#ef4444' }} onClick={() => remove(a.id)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
