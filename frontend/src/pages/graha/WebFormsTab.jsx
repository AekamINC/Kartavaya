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
import useModuleWrite from '../../hooks/useModuleWrite';
import { apiErrorText } from '../../lib/apiError';

export default function WebFormsTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change CRM settings' });
  const { pushToast } = useToast();
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', auto_source: 'web_form' });
  const [copied, setCopied] = useState('');

  /* The address a member of the PUBLIC uses. Built from the browser's own
     origin rather than from a configured base: this tab is only ever open on
     the host the customer is already using, so that origin is by construction
     the right one, and a stale env var cannot hand somebody a dead link to
     put on their website. */
  const publicUrl = slug => `${window.location.origin}/f/${slug}`;

  async function copy(slug) {
    const url = publicUrl(slug);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* Clipboard refused — an insecure context, or the permission denied.
         The input beside the button holds the same text and selects itself on
         focus, so there is always a way to take the link by hand. */
      return;
    }
    setCopied(slug);
    setTimeout(() => setCopied(c => (c === slug ? '' : c)), 2000);
  }
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
    } catch (e2) { pushToast({ title: apiErrorText(e2, 'Failed'), type: 'error' }); }
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
        <button className="k-btn k-btn--primary" onClick={() => setShowCreate(!showCreate)} disabled={!canWrite} title={denial || undefined}>+ New Form</button>
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
            <button type="submit" className="k-btn k-btn--primary" disabled={!canWrite} title={denial || undefined}>Create</button>
          </div>
        </form>
      )}

      {forms.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'No web forms yet', hi: 'कोई प्रपत्र नहीं' }}
          description="A web form gives your site a public endpoint that turns a submission straight into a CRM contact."
          action={canWrite ? 'New Form' : undefined}
          onAction={canWrite ? () => setShowCreate(true) : undefined}
        />
      ) : forms.map(f => (
        <div key={f.id} className="gr__lrow">
          <div className="gr__lmain">
            <div className="gr__lt">{f.name}</div>
            <div className="gr__ls">
              {f.submission_count} submissions · source: {f.auto_source}
            </div>
            {/* ── THE LINK, WHICH IS THE WHOLE POINT OF PUBLISHING A FORM ────
                This row used to print the API PATH — `/api/v1/graha/f/<slug>`
                — which is not a thing anybody can be sent. Suite 04.14 found
                the consequence: the tab offered no link, no preview and no
                hosted page, so a firm had to write and host the JavaScript
                itself before one lead could arrive, and 0 of 12 public
                submissions were made. `/f/:slug` is now a real page. */}
            <div className="gr__lform">
              <input
                className="k-input gr__lurl" readOnly value={publicUrl(f.slug)}
                aria-label={`Public link for ${f.name}`}
                onFocus={e => e.target.select()}
              />
              <button type="button" className="k-btn k-btn--ghost"
                onClick={() => copy(f.slug)}>
                {copied === f.slug ? 'Copied' : 'Copy link'}
              </button>
              {/* `rel="noreferrer"` and a new tab: this is the customer
                  checking their own public page, and it must not take them out
                  of the tab they are working in. */}
              <a className="k-btn k-btn--ghost" href={publicUrl(f.slug)}
                target="_blank" rel="noreferrer">Preview</a>
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
          <strong>Where to put the link:</strong> on your website, in an email
          signature, or in a WhatsApp message. Whoever opens it fills the form in
          and the reply arrives here as a contact and a lead.
          {' '}Developers can also POST JSON straight to{' '}
          <code>/api/v1/graha/f/{'<slug>'}</code> — fields: name, email, phone,
          company, message, no auth required.
        </div>
      )}
    </div>
  );
}
