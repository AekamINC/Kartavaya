// Graha · activities — the log of calls, emails, meetings, notes and tasks.
//
// ── This tab did not exist as a page ───────────────────────────────────────
// It rendered a "+ Log Activity" button, a create form, and — when the form was
// closed — one sentence: "Activities are logged against contacts and deals.
// Open a contact or deal to see its full activity history." That is a tab
// telling you to go somewhere else to see its own contents.
//
// `GET /v1/graha/activities` has existed the whole time. It is gated, it takes
// `contact_id`, `deal_id` and `activity_type` filters, it orders by
// `created_at DESC` and caps at 100 rows. Nothing on the front end ever called
// it. So this is the owner's "only tab is done not the whole page" complaint in
// its literal form, and the fix is to render the list the endpoint returns.
//
// The row enrichment is deliberate and soft. `list_activities` selects from
// `graha_activities` with no join, so it returns `contact_id` / `deal_id` and
// no names — a raw UUID in a log tells nobody anything. Contacts and deals are
// fetched alongside and used as a lookup; if either fails the row falls back to
// showing nothing rather than an id, and the log still renders.
//
// 17 inline styles are now `gr__*` classes.
import React, { useState, useEffect, useCallback } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge, ACTIVITY_TYPES, ACT_ICONS } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';

const TYPE_COLORS = {
  call: 'var(--st-in-progress)', email: 'var(--st-in-review)',
  meeting: 'var(--tertiary)', note: 'var(--on-surface-3)', task: 'var(--ok)',
};

export default function ActivitiesTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'log activities' });
  const { pushToast } = useToast();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ activity_type: 'note', title: '', description: '', deal_id: '', contact_id: '' });
  const [saving, setSaving] = useState(false);
  const [deals, setDeals] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [completing, setCompleting] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const url = typeFilter
        ? `/v1/graha/activities?activity_type=${encodeURIComponent(typeFilter)}`
        : '/v1/graha/activities';
      const r = await api.get(url);
      setActivities(rows(r));
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load activities', type: 'error' });
    }
    finally { setLoading(false); }
  }, [typeFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadOptions(); }, []);

  // Names for the two id columns, and the create form's dropdowns. Both are
  // enrichments: a failure costs a name, not the log.
  async function loadOptions() {
    try {
      const [d, c] = await Promise.all([api.get('/v1/graha/deals'), api.get('/v1/graha/contacts')]);
      setDeals(rows(d));
      setContacts(rows(c));
    } catch { /* rows show no linked name; selects offer "None" only */ }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/activities', form);
      pushToast({ title: 'Activity logged', type: 'success' });
      setShowForm(false);
      setForm({ activity_type: 'note', title: '', description: '', deal_id: '', contact_id: '' });
      load();
    } catch (e2) { pushToast({ title: e2.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function complete(id) {
    setCompleting(id);
    try {
      await api.patch(`/v1/graha/activities/${id}/complete`);
      pushToast({ title: 'Marked complete', type: 'success' });
      setActivities(prev => prev.map(a => (a.id === id ? { ...a, is_completed: true, completed_at: new Date().toISOString() } : a)));
    } catch { pushToast({ title: 'Could not complete activity', type: 'error' }); }
    finally { setCompleting(null); }
  }

  const contactName = id => contacts.find(c => c.id === id)?.name;
  const dealTitle = id => deals.find(d => d.id === id)?.title;

  return (
    <div>
      <div className="gr__bar">
        <select className="k-input gr__sel" aria-label="Filter by activity type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="gr__spacer" />
        <button className="k-btn k-btn--primary" onClick={() => setShowForm(true)} disabled={!canWrite} title={denial || undefined}>+ Log Activity</button>
      </div>

      {showForm && (
        <form onSubmit={save} className="gr__panel">
          <h3 className="gr__ptitle">Log Activity</h3>
          <div className="gr__grid">
            <label className="gr__f"><span className="gr__fl">Type</span>
              <select className="k-input" value={form.activity_type} onChange={e => setForm({ ...form, activity_type: e.target.value })}>
                {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select></label>
            <label className="gr__f"><span className="gr__fl">Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label className="gr__f"><span className="gr__fl">Deal</span>
              <select className="k-input" value={form.deal_id} onChange={e => setForm({ ...form, deal_id: e.target.value })}>
                <option value="">None</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select></label>
            <label className="gr__f"><span className="gr__fl">Contact</span>
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label className="gr__f gr__f--wide"><span className="gr__fl">Description</span>
              <textarea className="k-input gr__ta" rows={3} value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Log Activity'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading activities"><SkeletonList rows={6} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : activities.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'No activities logged', hi: 'कोई क्रिया नहीं' }}
          description={typeFilter
            ? `Nothing of type "${typeFilter}" has been logged. Clear the filter to see everything.`
            : 'A call, an email, a meeting or a note against a contact or a deal. Log the first one and it appears here.'}
          action="Log Activity"
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div className="gr__tblwrap gr__tblwrap--bare">
          <table className="gr__tbl">
            <thead>
              <tr>
                <th>Type</th>
                <th>Activity</th>
                <th>Linked to</th>
                <th>Status</th>
                <th>Logged</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {activities.map(a => {
                const cn = a.contact_id && contactName(a.contact_id);
                const dt = a.deal_id && dealTitle(a.deal_id);
                return (
                  <tr key={a.id}>
                    <td>
                      <span className="gr__tic" aria-hidden="true">{ACT_ICONS[a.activity_type] || '●'}</span>{' '}
                      <Badge text={a.activity_type} color={TYPE_COLORS[a.activity_type] || 'var(--on-surface-3)'} />
                    </td>
                    <td>
                      <div className={a.is_completed ? 'gr__td--name gr__ctitle--done' : 'gr__td--name'}>{a.title}</div>
                      {a.description && <div className="gr__ls">{a.description}</div>}
                    </td>
                    <td className="gr__td--mute">
                      {dt || cn ? [dt, cn].filter(Boolean).join(' · ') : '—'}
                    </td>
                    <td>
                      <Badge
                        text={a.is_completed ? 'Done' : 'Open'}
                        color={a.is_completed ? 'var(--ok)' : 'var(--warn)'}
                      />
                    </td>
                    <td className="gr__td--when">
                      {a.created_at ? new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td>
                      {!a.is_completed && (
                        <button className="k-btn k-btn--ghost" disabled={completing === a.id} onClick={() => complete(a.id)}>
                          {completing === a.id ? 'Saving…' : 'Complete'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
