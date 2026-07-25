import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge } from './_shared';

export default function WebFormsTab() {
  const { pushToast } = useToast();
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', auto_source: 'web_form' });
  const [submissions, setSubmissions] = useState({});
  const [openSubs, setOpenSubs] = useState(null);

  useEffect(() => {
    api.get('/v1/graha/web-forms')
      .then(r => setForms(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/web-forms', form);
      pushToast({ title: 'Form created', type: 'success' });
      setShowCreate(false);
      const r = await api.get('/v1/graha/web-forms');
      setForms(r.data.data || []);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this web form? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/web-forms/${id}`);
      setForms(prev => prev.filter(f => f.id !== id));
    } catch { pushToast({ title: 'Could not delete web form', type: 'error' }); }
  }

  async function loadSubs(formId) {
    if (openSubs === formId) { setOpenSubs(null); return; }
    try {
      const r = await api.get(`/v1/graha/web-forms/${formId}/submissions`);
      setSubmissions(prev => ({ ...prev, [formId]: r.data.data || [] }));
      setOpenSubs(formId);
    } catch { pushToast({ title: 'Failed to load submissions', type: 'error' }); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Web-to-Lead Forms ({forms.length})</h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => setShowCreate(!showCreate)}>+ New Form</button>
      </div>

      {showCreate && (
        <form onSubmit={create} style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Form Name</span>
              <input className="k-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Slug (URL path)</span>
              <input className="k-input" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} required placeholder="e.g. contact-us" /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Source Tag</span>
              <input className="k-input" value={form.auto_source} onChange={e => setForm({ ...form, auto_source: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Create</button>
          </div>
        </form>
      )}

      {forms.map(f => (
        <div key={f.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--rule-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{f.name}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                /api/v1/graha/f/{f.slug} · {f.submission_count} submissions · source: {f.auto_source}
              </div>
            </div>
            <button className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => loadSubs(f.id)}>
              {openSubs === f.id ? 'Hide' : 'Submissions'}
            </button>
            <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: '#ef4444' }} onClick={() => remove(f.id)}>Delete</button>
          </div>
          {openSubs === f.id && submissions[f.id] && (
            <div style={{ marginTop: 8, paddingLeft: 12 }}>
              {submissions[f.id].length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>No submissions yet.</p>
              ) : submissions[f.id].map(s => (
                <div key={s.id} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
                  <Badge text={s.status} color={s.status === 'processed' ? '#10b981' : '#6b7280'} />
                  <span style={{ marginLeft: 8, color: 'var(--ink-2)' }}>
                    {Object.entries(s.data || {}).slice(0, 3).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(' · ')}
                  </span>
                  <span style={{ float: 'right', fontSize: 11, color: 'var(--ink-3)' }}>
                    {new Date(s.created_at).toLocaleString('en-IN')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {forms.length > 0 && (
        <div style={{ marginTop: 24, padding: 16, background: 'var(--bg-raised)', borderRadius: 8, fontSize: 12, color: 'var(--ink-3)' }}>
          <strong>Embed code:</strong> POST your form data as JSON to <code>/api/v1/graha/f/{'<slug>'}</code> — fields: name, email, phone, company, message. No auth required.
        </div>
      )}
    </div>
  );
}
