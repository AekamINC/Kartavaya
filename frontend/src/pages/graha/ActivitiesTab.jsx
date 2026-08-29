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
import useTableView from '../../hooks/useTableView';
import TableToolbar from '../../components/ui/TableToolbar';
import { HeadCell } from '../../components/ui/Table';
// This log rendered its own date — `toLocaleDateString('en-IN', {day, month,
// year})` — which happens to print almost what `CreatedCell` prints and not
// quite: no `<time datetime>` for a screen reader, no full timestamp in a
// `title`, and a blank-date fallback that says nothing about WHY it is blank.
// Three near-copies of one format is how a product ends up unable to say what
// its date column means, so this is the shared cell now.
import { CreatedCell, ByCell, CREATED_KEY } from '../../components/ui/CreatedColumn';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';
import { apiErrorText } from '../../lib/apiError';

/**
 * What this log HAS, declared once, in the order it shipped.
 *
 * `fixed` on Activity — the subject line is the only cell that says WHAT
 * happened; a log without it is a column of type badges and dates. `fixed` on
 * Actions because Complete is the only verb on the row, and a stale
 * arrangement that hid it would leave open activities with no way to close
 * them.
 */
const ACTIVITY_COLUMNS = [
  { id: 'activity_type', label: 'Type', sortKey: 'activity_type' },
  { id: 'subject', label: 'Activity', sortKey: 'subject', fixed: true },
  { id: 'linked_to', label: 'Linked to', sortKey: 'contact_name' },
  /* "Logged by", not "Who". The old heading asked a question the column then
     answered ambiguously — who logged it, or who it was WITH? An activity
     already carries the other party in "Linked to", so naming the verb is
     what separates the two columns. */
  { id: 'created_by_name', label: 'Logged by', sortKey: 'created_by_name', className: 'tbl__by' },
  { id: 'status', label: 'Status', sortKey: 'status' },
  { id: CREATED_KEY, label: 'Logged', sortKey: CREATED_KEY, className: 'tbl__created' },
  /* ── NO `updated_at` / `updated_by_name` PAIR HERE, and it is not an
     oversight ──────────────────────────────────────────────────────────────
     `graha_activities` was deliberately left out of migration 201: it is an
     append-only event log, so it has no `updated_by` column and
     `list_activities` asks `actor_select("a")` for the creator half only
     (routers/graha.py). Declaring the two columns anyway would ship a table
     with two permanently em-dashed cells that a reader would take as "nothing
     here has ever been edited" — a claim about the data, made by the absence
     of a feature. When the log gains an updater the pair goes here and lands
     appended-and-visible for everybody. */
  { id: 'actions', label: 'Actions', sr: true, fixed: true },
];

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
    } catch (e2) { pushToast({ title: apiErrorText(e2, 'Failed'), type: 'error' }); }
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

  const view = useTableView(activities, {
    searchKeys: ['subject', 'notes', 'created_by_name'],
    filters: [{ key: 'activity_type', label: 'Type' }, { key: 'status', label: 'Status' }],
  });
  const cols = useColumnPrefs('graha.activities', ACTIVITY_COLUMNS);
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
          action={canWrite ? 'Log Activity' : undefined}
          onAction={canWrite ? () => setShowForm(true) : undefined}
        />
      ) : (
        <div className="tv-card">
        <TableToolbar view={view} label="activities">
          <ColumnsButton cols={cols} />
        </TableToolbar>
        <div className="tbl__wrap">
          <table className="tbl">
            <thead>
              <tr>
                {cols.columns.map(c => (
                  <HeadCell
                    key={c.id}
                    sortKey={c.sortKey}
                    sort={view.sort}
                    onSort={c.sortKey ? view.onSort : undefined}
                    num={c.num}
                    className={c.className}
                    width={c.width}
                    onResize={w => cols.setWidth(c.id, w)}
                  >
                    {c.sr ? <span className="sr-only">{c.label}</span> : c.label}
                  </HeadCell>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map(a => {
                const cn = a.contact_id && contactName(a.contact_id);
                const dt = a.deal_id && dealTitle(a.deal_id);
                return (
                  <tr key={a.id}>
                    {cols.cells({
                      activity_type: (
                        <td>
                          <span className="gr__tic" aria-hidden="true">{ACT_ICONS[a.activity_type] || '●'}</span>{' '}
                          <Badge text={a.activity_type} color={TYPE_COLORS[a.activity_type] || 'var(--on-surface-3)'} />
                        </td>
                      ),
                      subject: (
                        <td>
                          <div className={a.is_completed ? 'gr__td--name gr__ctitle--done' : 'gr__td--name'}>{a.title}</div>
                          {a.description && <div className="gr__ls">{a.description}</div>}
                        </td>
                      ),
                      linked_to: (
                        <td className="gr__td--mute">
                          {dt || cn ? [dt, cn].filter(Boolean).join(' · ') : '—'}
                        </td>
                      ),
                      /* Whose activity this is. `created_by_name` comes from the
                         join the list route makes; the id is never shown.

                         `<ByCell>` rather than the `|| '—'` this was, because
                         that fallback collapsed two different absences into
                         one dash. `has_creator` is the API telling us which:
                         TRUE with no name means the person who logged the call
                         has left and their user row is gone, and ByCell says
                         `unknown`; FALSE means no actor was ever recorded (the
                         rows this log carried before the column existed), and
                         that is the dash. On an activity log the difference
                         matters more than anywhere else — "we cannot say who
                         made this call" is a finding, "nobody made it" is
                         nonsense. */
                      created_by_name: <ByCell name={a.created_by_name} hasActor={a.has_creator} />,
                      status: (
                        <td>
                          <Badge
                            text={a.is_completed ? 'Done' : 'Open'}
                            color={a.is_completed ? 'var(--ok)' : 'var(--warn)'}
                          />
                        </td>
                      ),
                      [CREATED_KEY]: <CreatedCell value={a.created_at} />,
                      actions: (
                        <td>
                          {!a.is_completed && (
                            <button className="k-btn k-btn--ghost" disabled={completing === a.id} onClick={() => complete(a.id)}>
                              {completing === a.id ? 'Saving…' : 'Complete'}
                            </button>
                          )}
                        </td>
                      ),
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  );
}
