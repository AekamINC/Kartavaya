// Graha · labels — the contact tag vocabulary, and assigning one.
//
// 27 inline styles are now `gr__*` classes. The swatch and the label card both
// take their colour through `--c`, which is the one legitimate surviving inline
// (check-tokens deviation 2) because a label's colour is user data.
import React, { useState, useEffect } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import useModuleWrite from '../../hooks/useModuleWrite';

// The one literal in this module that stays a literal. A label colour is USER
// DATA: it is persisted to the DB and fed to <input type="color">, which accepts
// only #rrggbb — a var() reference there is invalid and the control silently
// resets to #000000. This is a seed value for a data field, not a colour in the
// design system, so the "no hardcoded hex" rule does not reach it.
const DEFAULT_LABEL_COLOR = '#6366f1';

export default function LabelsTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change CRM settings' });
  const { pushToast } = useToast();
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', color: DEFAULT_LABEL_COLOR });
  const [saving, setSaving] = useState(false);
  const [assignForm, setAssignForm] = useState({ contact_id: '', label_id: '' });
  const [showAssign, setShowAssign] = useState(false);
  const [contacts, setContacts] = useState([]);

  useEffect(() => { load(); }, []);

  async function load() {
    setErr(null);
    try {
      const r = await api.get('/v1/graha/labels');
      setLabels(rows(r));
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load labels', type: 'error' });
    }
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
    } catch (e2) { pushToast({ title: e2.response?.data?.detail || 'Failed', type: 'error' }); }
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

  // The contact dropdown is an enrichment on the assign form.
  async function loadContacts() {
    try {
      const r = await api.get('/v1/graha/contacts');
      setContacts(rows(r));
    } catch { /* the select stays empty and Assign cannot be submitted */ }
  }

  async function assignLabel(e) {
    e.preventDefault();
    try {
      await api.post(`/v1/graha/contacts/${assignForm.contact_id}/labels/${assignForm.label_id}`);
      pushToast({ title: 'Label assigned', type: 'success' });
      setShowAssign(false);
      setAssignForm({ contact_id: '', label_id: '' });
    } catch (e2) { pushToast({ title: e2.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  return (
    <div>
      <div className="gr__bar">
        <button className="k-btn k-btn--primary" onClick={() => setShowForm(true)} disabled={!canWrite} title={denial || undefined}>+ New Label</button>
        <button className="k-btn k-btn--ghost" onClick={() => { setShowAssign(true); loadContacts(); }}>Assign to Contact</button>
      </div>

      {showForm && (
        <form onSubmit={save} className="gr__panel">
          <h3 className="gr__ptitle">New Label</h3>
          <div className="gr__bar">
            <label className="gr__f gr__grow"><span className="gr__fl">Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label className="gr__f"><span className="gr__fl">Color</span>
              <input className="gr__color" type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} /></label>
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving || !canWrite} title={denial || undefined}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {showAssign && (
        <form onSubmit={assignLabel} className="gr__panel gr__panel--accent">
          <h4 className="gr__ptitle gr__ptitle--sm">Assign Label to Contact</h4>
          <div className="gr__grid">
            <label className="gr__f"><span className="gr__fl">Contact *</span>
              <select className="k-input" required value={assignForm.contact_id} onChange={e => setAssignForm({ ...assignForm, contact_id: e.target.value })}>
                <option value="">Select…</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label className="gr__f"><span className="gr__fl">Label *</span>
              <select className="k-input" required value={assignForm.label_id} onChange={e => setAssignForm({ ...assignForm, label_id: e.target.value })}>
                <option value="">Select…</option>
                {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select></label>
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowAssign(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={!canWrite} title={denial || undefined}>Assign</button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading labels"><SkeletonList rows={4} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : labels.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'No labels yet', hi: 'कोई नाम नहीं' }}
          description="A label groups contacts across type and company — priority, region, campaign, whatever you sort by."
          action={canWrite ? 'New Label' : undefined}
          onAction={canWrite ? () => setShowForm(true) : undefined}
        />
      ) : (
        <div className="gr__lcards">
          {labels.map(l => (
            <div key={l.id} className="gr__lcard">
              <span className="gr__swatch" style={{ '--c': l.color || 'var(--on-surface-3)' }} />
              <span className="gr__lname">{l.name}</span>
              <button className="k-btn k-btn--reject" onClick={() => remove(l.id)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
