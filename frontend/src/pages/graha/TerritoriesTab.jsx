// Graha · territories — named sales regions and who covers them.
//
// 26 inline styles are now `gr__*` classes, and the `.catch(() => {})` that
// rendered "Territories (0)" over a failed fetch is a real error state.
import React, { useState, useEffect } from 'react';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import TerritoryMap from '../../components/TerritoryMap';

export default function TerritoriesTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change CRM settings' });
  const { pushToast } = useToast();
  const [territories, setTerritories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showForm, setShowForm] = useState(false);
  /* Which territory the form is EDITING, or null to create a new one.
     `PATCH /v1/graha/territories/{id}` has existed since migration 023 — it is
     org-scoped, admin-gated and validates its members through
     `_validated_territory_users` — and it had ZERO CALLERS. So a territory could
     be created and deleted and never corrected: the only way to fix a typo in a
     pincode list was to delete the territory and lose its round-robin position.
     Phase 7.1 routes leads by `rules.pincodes`, and a rule nobody can edit is a
     rule nobody will keep accurate. */
  const [editingId, setEditingId] = useState(null);
  /* The backfill report, or null. `POST /v1/graha/contacts/route-all` is the
     7.1 backfill, and it exists as a ROUTE rather than a migration on purpose:
     migrations are pre-approved in this project and rewriting live rows is not,
     so it has to be something a person triggers and can read the result of. */
  const [routing, setRouting] = useState(false);
  const [report, setReport] = useState(null);
  /* `rules` is a jsonb column that has existed since migration 023 and has
     never held anything. `rules.pincodes` is what a territory actually IS in
     India — the patch of postcodes it covers — and it is what the map draws. */
  const [form, setForm] = useState({ name: '', description: '', assigned_users: [], rules: { pincodes: [] } });
  const [pinInput, setPinInput] = useState('');
  /* WAS a free-text "User ID" box, and the chips rendered `u.slice(0, 12)` —
     twelve characters of a UUID, which identifies nobody. Worse, whatever was
     typed went straight into round-robin and could assign a lead to a person
     who does not exist. It is a dropdown of real members now, and the server
     refuses ids that are not in the org. */
  const [members, setMembers] = useState([]);
  const [userInput, setUserInput] = useState('');
  /* Which saved territory is showing its map, or null. Before 7.5 the map
     rendered ONLY inside `{showForm && …}`, so the shape of a territory could
     be seen while creating it and never again — a reader had to press Edit, an
     action that implies they intend to change something, just to look. One at a
     time: each open map is an SDK instance and a geometry fetch. */
  const [mapOpenId, setMapOpenId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setErr(null);
    try {
      const r = await api.get('/v1/graha/territories');
      setTerritories(rows(r));
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load territories', type: 'error' });
    }
    finally { setLoading(false); }
    // `/v1/org/members` is org_admin+ only — and so is creating a territory, so
    // a plain member losing this list loses nothing they could have used.
    try {
      const m = await api.get('/v1/org/members');
      setMembers(rows(m));
    } catch { setMembers([]); }
  }

  function memberName(id) {
    const m = members.find(x => x.user_id === id);
    return m ? (m.full_name || m.email) : null;
  }

  function blankForm() {
    return { name: '', description: '', assigned_users: [], rules: { pincodes: [] } };
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(blankForm());
    setPinInput('');
  }

  function startEdit(t) {
    /* `rules` is spread rather than replaced: it is a free-form jsonb column and
       this form only knows about `pincodes`. Every live row holds `{}` or
       `{"pincodes": []}` today, so there is nothing else to preserve yet — but
       the PATCH body REPLACES the whole column, so the day a rule of another
       kind is added, a save from this screen would silently delete it. */
    setForm({
      name: t.name || '',
      description: t.description || '',
      assigned_users: t.assigned_users || [],
      rules: { ...(t.rules || {}), pincodes: t.rules?.pincodes || [] },
    });
    setEditingId(t.id);
    setShowForm(true);
    setPinInput('');
  }

  async function submit(e) {
    e.preventDefault();
    try {
      if (editingId) await api.patch(`/v1/graha/territories/${editingId}`, form);
      else await api.post('/v1/graha/territories', form);
      pushToast({ title: editingId ? 'Territory updated' : 'Territory created', type: 'success' });
      closeForm();
      load();
    } catch (e2) { pushToast({ title: e2.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function routeAll() {
    /* A confirm, because this REWRITES LIVE ROWS. Every other button on this
       tab touches one territory the reader is looking at; this one walks every
       contact in the organisation. The sentence says what will change and what
       will not — a person's own choice of territory is never overwritten, which
       is the fact that decides whether this is safe to press twice. */
    if (!window.confirm(
      'File every unrouted contact under the territory that claims its pincode?'
      + '\n\n'
      + 'This changes contact records across the whole organisation. '
      + 'Contacts that already have a territory are left exactly as they are, '
      + 'and a pincode no territory claims is skipped rather than guessed at.'
    )) return;
    setRouting(true);
    try {
      const r = await api.post('/v1/graha/contacts/route-all', {});
      setReport(body(r));
      pushToast({ title: `${body(r).count} contact(s) filed`, type: 'success' });
      load();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Could not route contacts', type: 'error' });
    } finally { setRouting(false); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this territory? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/territories/${id}`);
      setTerritories(prev => prev.filter(t => t.id !== id));
    } catch { pushToast({ title: 'Could not delete territory', type: 'error' }); }
  }

  /* Typed, not chosen: there is no list of Indian pincodes to offer, and a
     six-digit field is faster than a search for someone who knows their patch.
     Validated to six digits so a typo does not become a territory rule. */
  function addPincodes() {
    const found = (pinInput.match(/\d{6}/g) || []);
    if (!found.length) {
      pushToast({ title: 'A pincode is six digits', type: 'error' });
      return;
    }
    const have = form.rules.pincodes || [];
    const next = [...new Set([...have, ...found])];
    setForm({ ...form, rules: { ...form.rules, pincodes: next } });
    setPinInput('');
  }

  function addUser() {
    const u = userInput.trim();
    if (u && !form.assigned_users.includes(u)) {
      setForm({ ...form, assigned_users: [...form.assigned_users, u] });
      setUserInput('');
    }
  }

  if (loading) return <SkeletonRegion label="Loading territories"><SkeletonList rows={4} /></SkeletonRegion>;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  return (
    <div>
      <div className="gr__shead">
        <h3 className="gr__st">Territories ({territories.length})</h3>
        <button className="k-btn k-btn--ghost" onClick={routeAll}
                disabled={!canWrite || routing} title={denial || undefined}>
          {routing ? 'Filing…' : 'File contacts by pincode'}
        </button>
        <button className="k-btn k-btn--primary"
                onClick={() => (showForm ? closeForm() : setShowForm(true))}
                disabled={!canWrite} title={denial || undefined}>+ New Territory</button>
      </div>

      {report && (
        <div className="gr__panel gr__panel--flat">
          <h4 className="gr__ptitle gr__ptitle--sm">Filed by pincode</h4>
          {/* Counts and NAMES. The endpoint returns no contact ids and keys
              `by_territory` by name, because a backfill report is read by a
              person and a uuid identifies nobody. */}
          <div className="gr__dpair"><strong>Newly filed:</strong> {report.count} of {report.considered} contact(s)</div>
          <div className="gr__dpair"><strong>Already had a territory:</strong> {report.already_filed}</div>
          <div className="gr__dpair"><strong>Had a usable pincode:</strong> {report.with_a_pin}</div>
          {/* NOT an error, and said in words rather than left as a bare number:
              a pincode no territory claims is the ordinary case on a database
              where the patches have not been drawn yet. */}
          <div className="gr__dpair"><strong>No territory claims that pincode:</strong> {report.no_territory_claims_it}</div>
          <div className="gr__dpair"><strong>Also given a rep:</strong> {report.assigned_a_rep}</div>
          {report.failed > 0 && (
            <div className="gr__dpair"><strong>Could not be filed:</strong> {report.failed}</div>
          )}
          {Object.keys(report.by_territory || {}).length > 0 && (
            <div className="gr__chips gr__chips--tight">
              {Object.entries(report.by_territory).map(([name, n]) => (
                <span key={name} className="gr__tok">{name} · {n}</span>
              ))}
            </div>
          )}
          {report.overlaps?.length > 0 && (
            <div className="gr__lsub">
              {/* Two territories claiming one pincode is a configuration
                  question, not a failure — the routing picks deterministically
                  and says so here so somebody can settle it. */}
              {report.overlaps.length} pincode(s) claimed by more than one
              territory: {report.overlaps.map(o => `${o.pincode} (${o.territories.join(', ')})`).join('; ')}
            </div>
          )}
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setReport(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="gr__panel gr__panel--flat">
          <h4 className="gr__ptitle gr__ptitle--sm">
            {editingId ? 'Edit territory' : 'New territory'}
          </h4>
          <div className="gr__grid">
            <label className="gr__f"><span className="gr__fl">Name</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label className="gr__f"><span className="gr__fl">Description</span>
              <input className="k-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          <div className="gr__group">
            <span className="gr__fl">Assigned Users</span>
            <div className="gr__chips">
              {form.assigned_users.map(u => (
                <span key={u} className="gr__tok">
                  {memberName(u) || 'Unknown member'}
                  <button type="button" className="gr__tokx" aria-label={`Remove ${memberName(u) || 'member'}`}
                    onClick={() => setForm({ ...form, assigned_users: form.assigned_users.filter(x => x !== u) })}>×</button>
                </span>
              ))}
            </div>
            <div className="gr__bar">
              <select className="k-input gr__grow" aria-label="Person to add"
                      value={userInput} onChange={e => setUserInput(e.target.value)}>
                <option value="">— Choose a person —</option>
                {members
                  .filter(m => !form.assigned_users.includes(m.user_id))
                  .map(m => (
                    <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>
                  ))}
              </select>
              <button type="button" className="k-btn k-btn--ghost" onClick={addUser}>Add</button>
            </div>
          </div>
          <div className="gr__group">
            <span className="gr__fl">Pincodes covered</span>
            <div className="gr__chips">
              {(form.rules.pincodes || []).map(pc => (
                <span key={pc} className="gr__tok">
                  {pc}
                  <button type="button" className="gr__tokx" aria-label={`Remove ${pc}`}
                    onClick={() => setForm({
                      ...form,
                      rules: { ...form.rules, pincodes: form.rules.pincodes.filter(x => x !== pc) },
                    })}>×</button>
                </span>
              ))}
            </div>
            <div className="gr__bar">
              <input className="k-input gr__grow" inputMode="numeric"
                     placeholder="400001, 400002…" aria-label="Pincodes"
                     value={pinInput} onChange={e => setPinInput(e.target.value)} />
              <button type="button" className="k-btn k-btn--ghost" onClick={addPincodes}>Add</button>
            </div>
            {/* `territoryId` is what makes this draw anything: the shapes come
                from `GET /territories/{id}/geometry`, which reads the SAVED
                row. A territory being CREATED has no id and no saved row, and
                the component says so rather than showing an empty map. */}
            <TerritoryMap territoryId={editingId} pincodes={form.rules.pincodes || []} />
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={closeForm}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={!canWrite} title={denial || undefined}>
              {editingId ? 'Save changes' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {territories.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'No territories yet', hi: 'कोई क्षेत्र नहीं' }}
          description="A territory names a region and the people who cover it, so leads route to whoever owns the patch."
          action={canWrite ? 'New Territory' : undefined}
          onAction={canWrite ? () => setShowForm(true) : undefined}
        />
      ) : territories.map(t => (
        <React.Fragment key={t.id}>
        <div className="gr__lrow">
          <div className="gr__lmain">
            <div className="gr__lt">{t.name}</div>
            {t.description && <div className="gr__lsub">{t.description}</div>}
            {t.rules?.pincodes?.length > 0 && (
              <div className="gr__lsub">{t.rules.pincodes.length} pincode(s)</div>
            )}
            {t.assigned?.length > 0 && (
              <div className="gr__chips gr__chips--tight">
                {/* `assigned` is the server's join to `users`; it carries names.
                    `assigned_users` is still the id array the form posts back. */}
                {t.assigned.map(p => (
                  <Badge key={p.user_id} text={p.name} color="var(--st-in-review)" />
                ))}
              </div>
            )}
          </div>
          <span className="gr__ls">
            {t.assigned_users?.length || 0} {t.assigned_users?.length === 1 ? 'person' : 'people'}
          </span>
          {/* Looking at a territory is not editing it, and until 7.5 the only
              way to see one was to press Edit. No write permission needed. */}
          <button className="k-btn k-btn--ghost"
                  aria-expanded={mapOpenId === t.id}
                  onClick={() => setMapOpenId(mapOpenId === t.id ? null : t.id)}>
            {mapOpenId === t.id ? 'Hide map' : 'Map'}
          </button>
          <button className="k-btn k-btn--ghost" onClick={() => startEdit(t)}
                  disabled={!canWrite} title={denial || undefined}>Edit</button>
          <button className="k-btn k-btn--reject" onClick={() => remove(t.id)}>Delete</button>
        </div>
        {mapOpenId === t.id && (
          /* No `pincodes` prop: nothing is being edited here, so there is no
             unsaved list to warn about, and the saved coverage is the answer. */
          <TerritoryMap territoryId={t.id} height={300} />
        )}
        </React.Fragment>
      ))}
    </div>
  );
}
