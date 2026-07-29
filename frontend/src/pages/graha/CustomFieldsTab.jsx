// Graha · fields — org-defined extra fields on a contact or a deal.
//
// 25 inline styles are now `gr__*` classes.
//
// Two corrections beyond the styling. The `.catch(() => {})` rendered
// "Custom Fields (0)" over a failed fetch. And the list body was
// `['contact','deal'].map(...)` returning `null` for any entity with no fields,
// so with zero fields defined the tab rendered a heading, a button, and
// nothing else — no empty state existed at all, in either the failure or the
// genuinely-empty case.
import React, { useState, useEffect } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';

const FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox', 'url', 'email', 'phone'];

export default function CustomFieldsTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change CRM settings' });
  const { pushToast } = useToast();
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ entity_type: 'contact', field_name: '', field_type: 'text', options: [], is_required: false, sort_order: 0 });

  useEffect(() => { load(); }, []);

  async function load() {
    setErr(null);
    try {
      const r = await api.get('/v1/graha/custom-fields');
      setFields(rows(r));
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load custom fields', type: 'error' });
    }
    finally { setLoading(false); }
  }

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/custom-fields', form);
      pushToast({ title: 'Field created', type: 'success' });
      setShowForm(false);
      load();
    } catch (e2) { pushToast({ title: e2.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this custom field? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/custom-fields/${id}`);
      setFields(prev => prev.filter(f => f.id !== id));
    } catch { pushToast({ title: 'Could not delete field', type: 'error' }); }
  }

  if (loading) return <SkeletonRegion label="Loading custom fields"><SkeletonList rows={4} /></SkeletonRegion>;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  return (
    <div>
      <div className="gr__shead">
        <h3 className="gr__st">Custom Fields ({fields.length})</h3>
        <button className="k-btn k-btn--primary" onClick={() => setShowForm(!showForm)} disabled={!canWrite} title={denial || undefined}>+ New Field</button>
      </div>

      {showForm && (
        <form onSubmit={create} className="gr__panel gr__panel--flat">
          <div className="gr__grid gr__grid--3">
            <label className="gr__f"><span className="gr__fl">Entity</span>
              <select className="k-input" value={form.entity_type} onChange={e => setForm({ ...form, entity_type: e.target.value })}>
                <option value="contact">Contact</option>
                <option value="deal">Deal</option>
              </select></label>
            <label className="gr__f"><span className="gr__fl">Field Name</span>
              <input className="k-input" required value={form.field_name} onChange={e => setForm({ ...form, field_name: e.target.value })} /></label>
            <label className="gr__f"><span className="gr__fl">Type</span>
              <select className="k-input" value={form.field_type} onChange={e => setForm({ ...form, field_type: e.target.value })}>
                {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select></label>
          </div>
          <div className="gr__bar">
            <label className="gr__f gr__f--inline">
              <input type="checkbox" checked={form.is_required} onChange={e => setForm({ ...form, is_required: e.target.checked })} />
              Required
            </label>
            <label className="gr__f gr__f--inline"><span className="gr__fl gr__fl--inline">Order:</span>
              <input className="k-input gr__num" type="number" value={form.sort_order}
                onChange={e => setForm({ ...form, sort_order: parseInt(e.target.value, 10) || 0 })} /></label>
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={!canWrite} title={denial || undefined}>Create</button>
          </div>
        </form>
      )}

      {fields.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'No custom fields yet', hi: 'कोई क्षेत्र नहीं' }}
          description="A custom field adds something your business tracks that the standard contact and deal records do not carry."
          action={canWrite ? 'New Field' : undefined}
          onAction={canWrite ? () => setShowForm(true) : undefined}
        />
      ) : ['contact', 'deal'].map(entity => {
        const ef = fields.filter(f => f.entity_type === entity);
        if (!ef.length) return null;
        return (
          <div key={entity} className="gr__group">
            <h4 className="gr__eyebrow">{entity} fields</h4>
            {ef.map(f => (
              <div key={f.id} className="gr__lrow gr__lrow--tight">
                <div className="gr__lmain">
                  <span className="gr__lt--sm">{f.field_name}</span>
                  <span className="gr__ls"> {f.field_type}</span>
                  {f.is_required && <Badge text="required" color="var(--danger)" />}
                </div>
                <button className="k-btn k-btn--reject" onClick={() => remove(f.id)}>Delete</button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
