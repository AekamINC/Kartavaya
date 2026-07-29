// Graha · follow-ups — the next step on a contact or a deal.
//
// 31 inline styles are now `gr__*` classes. This tab is what the pipeline board
// reads to decide whether a deal has a next step at all, so "No follow-ups
// found" printed after a failed fetch is the same false statement twice: here,
// and as a clean pipeline on the board. It has an error state now.
import React, { useState, useEffect } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';

export default function FollowUpsTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'set follow-ups' });
  const { pushToast } = useToast();
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [deals, setDeals] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [form, setForm] = useState({ title: '', description: '', contact_id: '', deal_id: '', due_at: '', remind_at: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setErr(null);
    try {
      // `GET /v1/graha/follow-ups` takes `is_completed` (a bool) and has no
      // `status` parameter at all. This sent `?status=pending|completed|overdue`,
      // which FastAPI drops silently — so the filter did nothing, and picking
      // "Completed" kept showing the OPEN list (the route defaults to
      // `is_completed=FALSE` when the parameter is absent). Three choices, none
      // of which worked, and one that stated the opposite of what it had.
      //
      // `overdue` has no server-side equivalent, and it is a strict subset of
      // "not completed" — past its `due_at` and still open — so it is asked for
      // as the open set and narrowed here. Both are bounded by the route's
      // LIMIT 200.
      const done = statusFilter === 'completed';
      const r = await api.get(`/v1/graha/follow-ups?is_completed=${done}`);
      const list = rows(r);
      const now = Date.now();
      setFollowUps(
        statusFilter === 'overdue'
          ? list.filter(f => f.due_at && new Date(f.due_at).getTime() < now)
          : list
      );
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load follow-ups', type: 'error' });
    }
    finally { setLoading(false); }
  }

  // Both dropdowns are an enrichment on the create form.
  async function loadOptions() {
    try {
      const [c, d] = await Promise.all([api.get('/v1/graha/contacts'), api.get('/v1/graha/deals')]);
      setContacts(rows(c));
      setDeals(rows(d));
    } catch { /* selects offer "None" only */ }
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
    } catch (e2) { pushToast({ title: e2.response?.data?.detail || 'Failed', type: 'error' }); }
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

  const field = (label, node) => (
    <label className="gr__f"><span className="gr__fl">{label}</span>{node}</label>
  );

  return (
    <div>
      <div className="gr__bar">
        <select className="k-input gr__sel" aria-label="Filter by status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
        </select>
        <button className="k-btn k-btn--ghost" onClick={load}>Filter</button>
        <div className="gr__spacer" />
        <button className="k-btn k-btn--primary" disabled={!canWrite} title={denial || undefined}
          onClick={() => { setShowForm(true); loadOptions(); }}>+ New Follow-up</button>
      </div>

      {showForm && (
        <form onSubmit={save} className="gr__panel">
          <h3 className="gr__ptitle">New Follow-up</h3>
          <div className="gr__grid">
            {field('Title *', <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />)}
            {field('Due Date *', <input className="k-input" type="datetime-local" required value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} />)}
            {field('Contact', (
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ))}
            {field('Deal', (
              <select className="k-input" value={form.deal_id} onChange={e => setForm({ ...form, deal_id: e.target.value })}>
                <option value="">None</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            ))}
            {field('Remind At', <input className="k-input" type="datetime-local" value={form.remind_at} onChange={e => setForm({ ...form, remind_at: e.target.value })} />)}
            {field('Description', <input className="k-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />)}
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading follow-ups"><SkeletonList rows={5} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : followUps.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'No follow-ups', hi: 'कोई अनुसरण नहीं' }}
          description={statusFilter
            ? `Nothing matches the "${statusFilter}" filter. Clear it to see everything.`
            : 'A follow-up is the next step on a contact or a deal. Deals without one are flagged on the pipeline board.'}
          action="New Follow-up"
          onAction={() => { setShowForm(true); loadOptions(); }}
        />
      ) : (
        <div className="gr__cards">
          {followUps.map(f => {
            const overdue = !f.is_completed && new Date(f.due_at) < new Date();
            return (
              <div key={f.id} className={`gr__card${overdue ? ' gr__card--late' : ''}`}>
                <div className="gr__crow">
                  <span className={f.is_completed ? 'gr__ctitle gr__ctitle--done' : 'gr__ctitle'}>{f.title}</span>
                  <Badge
                    text={f.is_completed ? 'Done' : overdue ? 'Overdue' : 'Pending'}
                    color={f.is_completed ? 'var(--ok)' : overdue ? 'var(--danger)' : 'var(--warn)'}
                  />
                </div>
                <div className="gr__cmeta--plain">
                  {f.contact_name && <span>{f.contact_name} · </span>}
                  {f.deal_title && <span>{f.deal_title} · </span>}
                  <span>Due: {new Date(f.due_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  {f.description && <span> · {f.description}</span>}
                </div>
                <div className="gr__sacts">
                  {!f.is_completed && (
                    <button className="k-btn k-btn--primary" onClick={() => complete(f.id)}>Complete</button>
                  )}
                  <button className="k-btn k-btn--reject" onClick={() => remove(f.id)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
