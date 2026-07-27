// Graha · web forms — public lead-capture endpoints and their submissions.
//
// 26 inline styles are now `gr__*` classes. The load was `.catch(() => {})`
// with no error state at all, so a failure rendered "Web-to-Lead Forms (0)" and
// an empty page — indistinguishable from having created none.
//
// `POST /api/v1/graha/f/{slug}` is deliberately unauthenticated: it is a public
// form endpoint that resolves its org from the slug. That is one of only two
// ungated routes in `routers/graha.py` (the other is the HMAC-signed
// `/inbound-leads` webhook); every read path in the router carries
// `_gate = require_module("graha")`.
import React, { useState, useEffect } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from './_shared';

export default function WebFormsTab() {
  const { pushToast } = useToast();
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', auto_source: 'web_form' });
  const [submissions, setSubmissions] = useState({});
  const [openSubs, setOpenSubs] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setErr(null);
    try {
      const r = await api.get('/v1/graha/web-forms');
      setForms(rows(r));
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load web forms', type: 'error' });
    }
    finally { setLoading(false); }
  }

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/web-forms', form);
      pushToast({ title: 'Form created', type: 'success' });
      setShowCreate(false);
      setForm({ name: '', slug: '', auto_source: 'web_form' });
      load();
    } catch (e2) { pushToast({ title: e2.response?.data?.detail || 'Failed', type: 'error' }); }
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
      setSubmissions(prev => ({ ...prev, [formId]: rows(r) }));
      setOpenSubs(formId);
    } catch { pushToast({ title: 'Failed to load submissions', type: 'error' }); }
  }

  if (loading) return <SkeletonRegion label="Loading web forms"><SkeletonList rows={4} /></SkeletonRegion>;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  return (
    <div>
      <div className="gr__shead">
        <h3 className="gr__st">Web-to-Lead Forms ({forms.length})</h3>
        <button className="k-btn k-btn--primary" onClick={() => setShowCreate(!showCreate)}>+ New Form</button>
      </div>

      {showCreate && (
        <form onSubmit={create} className="gr__panel gr__panel--flat">
          <div className="gr__grid gr__grid--3">
            <label className="gr__f"><span className="gr__fl">Form Name</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label className="gr__f"><span className="gr__fl">Slug (URL path)</span>
              <input className="k-input" required value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder="e.g. contact-us" /></label>
            <label className="gr__f"><span className="gr__fl">Source Tag</span>
              <input className="k-input" value={form.auto_source} onChange={e => setForm({ ...form, auto_source: e.target.value })} /></label>
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Create</button>
          </div>
        </form>
      )}

      {forms.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'No web forms yet', hi: 'कोई प्रपत्र नहीं' }}
          description="A web form gives your site a public endpoint that turns a submission straight into a CRM contact."
          action="New Form"
          onAction={() => setShowCreate(true)}
        />
      ) : forms.map(f => (
        <div key={f.id} className="gr__lrow">
          <div className="gr__lmain">
            <div className="gr__lt">{f.name}</div>
            <div className="gr__ls">
              /api/v1/graha/f/{f.slug} · {f.submission_count} submissions · source: {f.auto_source}
            </div>
            {openSubs === f.id && submissions[f.id] && (
              <div className="gr__stack">
                {submissions[f.id].length === 0 ? (
                  <p className="gr__mute">No submissions yet.</p>
                ) : submissions[f.id].map(s => (
                  <div key={s.id} className="gr__lrow gr__lrow--tight">
                    <Badge text={s.status} color={s.status === 'processed' ? 'var(--ok)' : 'var(--on-surface-3)'} />
                    <span className="gr__lsub gr__grow">
                      {Object.entries(s.data || {}).slice(0, 3).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(' · ')}
                    </span>
                    <span className="gr__twhen">{new Date(s.created_at).toLocaleString('en-IN')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="k-btn k-btn--ghost" aria-expanded={openSubs === f.id} onClick={() => loadSubs(f.id)}>
            {openSubs === f.id ? 'Hide' : 'Submissions'}
          </button>
          <button className="k-btn k-btn--reject" onClick={() => remove(f.id)}>Delete</button>
        </div>
      ))}

      {forms.length > 0 && (
        <div className="gr__hint">
          <strong>Embed code:</strong> POST your form data as JSON to <code>/api/v1/graha/f/{'<slug>'}</code> — fields: name, email, phone, company, message. No auth required.
        </div>
      )}
    </div>
  );
}
