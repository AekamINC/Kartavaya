// Graha · a client's statutory obligations — the register that had no screen.
//
// ── Why this file exists ─────────────────────────────────────────────────────
//
// `public.client_obligations` was created by migration 175 on 2026-08-20 and
// held ZERO rows in every org for thirteen days. Nothing wrote it: no screen,
// no import, no seed. Two shipped skills read it and both refused, correctly,
// to describe an empty register as a clean one —
//
//   Client obligations register   "91 active clients, nothing recorded"
//   Client filing calendar        an empty calendar, every month
//
// The filing calendar is the highest-value conversion on the skill shelf: every
// row it emits is a date, an owner and a client, which is a task in all but
// name. It was never blocked on the calendar. It was blocked on somebody being
// able to say "this client is a regular GST filer and Priya owns it".
//
// ── The one thing this screen says that a plain CRUD form would not ──────────
//
// NINE OF THE SIXTEEN OBLIGATIONS CANNOT BE DATED, and the sharpest is QRMP —
// the case the register mainly exists for. The statute calendar holds the
// monthly GSTR-1 and GSTR-3B rows only; a QRMP filer's quarterly returns and
// monthly PMT-06 are not seeded, so a firm can tick QRMP, save it, and get a
// filing calendar with no dates on it.
//
// Saying that ON THE FORM, at the moment the box is ticked, turns a bug report
// into a known gap. The answer is not hardcoded here: `/v1/graha/obligation-keys`
// derives it from the same `_NO_CALENDAR_RULE` the skill reads, so the day the
// calendar gains a CMP-08 row this screen stops warning about composition
// without anybody editing it.
//
// ── Ending is not deleting, and the screen offers both ───────────────────────
//
// A client who left the composition scheme WAS under it, and the register is
// asked historical questions — so ending writes `effective_to` and the row
// stays. Deleting is for a row typed against the wrong client. Conflating them
// would make the register unable to answer "what was this client in 2024?",
// which is most of why it carries dates at all.
import React, { useState, useEffect, useCallback } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import DateInput from '../../components/ui/DateInput';
import useModuleWrite from '../../hooks/useModuleWrite';

/** An empty form. `effective_from` blank means "as of today" — the column defaults. */
const BLANK = {
  obligation_key: '',
  state_code: '',
  owner_user_id: '',
  registration_no: '',
  effective_from: '',
  effective_to: '',
  notes: '',
};

const fmt = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric',
}) : '');

export default function ObligationsSection({ clientId }) {
  // THE GATE IS DECLARED HERE, not passed in. `check-write-gates` refuses a
  // component that reads a `canWrite` it did not call for, and it is right to:
  // the first draft of this file took it as a prop, which works only for as
  // long as every caller remembers to pass it and white-screens with a
  // ReferenceError the first time one does not. The component that owns the
  // control owns the question.
  //
  // Same label shape as the tab around it. The endpoint's own gate is
  // `require_any_module("graha", "ganit", "vikray")` — broader than this, on
  // purpose, because a client's obligations are read by Ganit's compliance
  // skills too; this is the narrower of the two and refusing early is right.
  const { canWrite, reason: denial } = useModuleWrite({
    label: 'record client obligations',
  });
  const { pushToast } = useToast();
  const [list, setList] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [members, setMembers] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);      // null = closed
  const [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.get(`/v1/graha/clients/${clientId}/obligations`);
      setList(rows(r));
    } catch (e) { setErr(e); } finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // The sixteen keys and, for each, whether a date can be produced from it.
  // Served rather than held here: a second copy of a codelist drifts, and this
  // one would drift from a database CHECK that refuses the difference.
  useEffect(() => {
    let dead = false;
    api.get('/v1/graha/obligation-keys')
      .then(r => { if (!dead) setCatalogue(rows(r)); })
      .catch(() => { /* the picker falls back to being empty and says so */ });
    return () => { dead = true; };
  }, []);

  /* The org directory, for the owner field. `/v1/org/members` is org_admin+
     only: a plain member gets a 403 and the field says so rather than offering
     a box to paste a user id into — a screen must never ask a person to handle
     an id, and must never print one. Same shape as DealRoute, deliberately. */
  useEffect(() => {
    let dead = false;
    api.get('/v1/org/members')
      .then(r => { if (!dead) setMembers(rows(r)); })
      .catch(() => { /* not an admin: the field explains itself */ });
    return () => { dead = true; };
  }, []);

  const chosen = catalogue.find(o => o.key === form?.obligation_key);

  function openAdd() { setEditId(null); setForm({ ...BLANK }); }

  function openEdit(o) {
    setEditId(o.id);
    setForm({
      obligation_key: o.obligation_key,
      state_code: o.state_code || '',
      owner_user_id: o.owner_user_id || '',
      registration_no: o.registration_no || '',
      effective_from: o.effective_from || '',
      effective_to: o.effective_to || '',
      notes: o.notes || '',
    });
  }

  async function save() {
    if (!form.obligation_key) {
      pushToast({ title: 'Choose an obligation', type: 'error' });
      return;
    }
    setBusy(true);
    // Blanks go as null, not as "": every one of these columns is nullable and
    // an empty string would count as recorded in the register's denominators.
    const payload = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]),
    );
    try {
      if (editId) {
        await api.patch(`/v1/graha/clients/${clientId}/obligations/${editId}`, payload);
      } else {
        await api.post(`/v1/graha/clients/${clientId}/obligations`, payload);
      }
      pushToast({ title: editId ? 'Obligation updated' : 'Obligation recorded', type: 'success' });
      setForm(null); setEditId(null);
      load();
    } catch (e) {
      // The server's own sentence, not a generic one: every refusal here names
      // what to do — which sixteen keys are legal, that an end cannot precede a
      // start, that an open one already exists.
      pushToast({
        title: e?.response?.data?.detail || 'Could not save the obligation',
        type: 'error',
      });
    } finally { setBusy(false); }
  }

  async function endIt(o) {
    const today = new Date().toISOString().slice(0, 10);
    if (!window.confirm(
      `End this obligation today? The row stays on the register with an end `
      + `date, so past periods still answer correctly.`)) return;
    try {
      await api.patch(`/v1/graha/clients/${clientId}/obligations/${o.id}`, {
        obligation_key: o.obligation_key,
        state_code: o.state_code,
        owner_user_id: o.owner_user_id,
        registration_no: o.registration_no,
        effective_from: o.effective_from,
        effective_to: today,
        notes: o.notes,
      });
      pushToast({ title: 'Obligation ended', type: 'success' });
      load();
    } catch (e) {
      pushToast({ title: e?.response?.data?.detail || 'Could not end it', type: 'error' });
    }
  }

  async function remove(o) {
    if (!window.confirm(
      'Delete this row entirely? Use "End" instead if the client really did '
      + 'carry this obligation — deleting loses that history.')) return;
    try {
      await api.delete(`/v1/graha/clients/${clientId}/obligations/${o.id}`);
      pushToast({ title: 'Obligation deleted', type: 'success' });
      load();
    } catch { pushToast({ title: 'Could not delete it', type: 'error' }); }
  }

  const open = list.filter(o => !o.effective_to);
  const ended = list.filter(o => o.effective_to);
  const labelOf = key => catalogue.find(o => o.key === key)?.label || key;

  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  return (
    <div className="obl">
      <h4 className="gr__dsec">
        Statutory obligations ({open.length})
        {canWrite && (
          <button type="button" className="k-btn k-btn--ghost hb-btn--sm obl__add"
            onClick={openAdd} disabled={!!form}>
            + Record one
          </button>
        )}
        {!canWrite && denial && <span className="gr__ls obl__denied">{denial}</span>}
      </h4>

      {loading && <p className="gr__mute">Loading…</p>}

      {/* THE EMPTY STATE IS THE WHOLE POINT OF THE SCREEN. It is not "nothing
          to see": it is the reason the filing calendar has been returning an
          empty month, and it names the consequence rather than shrugging. */}
      {!loading && !list.length && !form && (
        <div className="note note--warn obl__empty">
          Nothing recorded for this client yet — so the filing calendar has no
          dates for them, and the obligations register counts them under
          “nothing recorded”. One row here is what turns both on.
        </div>
      )}

      {open.map(o => (
        <div key={o.id} className="obl__row">
          <div className="obl__main">
            <b className="gr__lt--sm">{labelOf(o.obligation_key)}</b>
            <span className="gr__ls obl__meta">
              from {fmt(o.effective_from)}
              {o.state_code && <> · {o.state_code}</>}
              {o.registration_no && <> · {o.registration_no}</>}
            </span>
            {/* A NAME, never the id behind it. An owner who has left the firm
                does not resolve, and reads as unassigned — which is a finding,
                not a broken row. */}
            <span className="gr__ls obl__meta">
              {o.owner_name ? `Owned by ${o.owner_name}` : 'No owner assigned'}
            </span>
            {o.notes && <span className="gr__ls obl__note">{o.notes}</span>}
          </div>
          {canWrite && (
            <div className="obl__acts">
              <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
                onClick={() => openEdit(o)}>Edit</button>
              <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
                onClick={() => endIt(o)}>End</button>
              <button type="button" className="k-btn k-btn--reject hb-btn--sm"
                onClick={() => remove(o)}>Delete</button>
            </div>
          )}
        </div>
      ))}

      {ended.length > 0 && (
        <>
          <p className="gr__mute obl__past">No longer in force ({ended.length})</p>
          {ended.map(o => (
            <div key={o.id} className="obl__row obl__row--ended">
              <div className="obl__main">
                <b className="gr__lt--sm">{labelOf(o.obligation_key)}</b>
                <span className="gr__ls obl__meta">
                  {fmt(o.effective_from)} – {fmt(o.effective_to)}
                </span>
              </div>
              {canWrite && (
                <div className="obl__acts">
                  <button type="button" className="k-btn k-btn--ghost hb-btn--sm"
                    onClick={() => openEdit(o)}>Edit</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {form && (
        <div className="obl__form">
          <label className="obl__f">
            <span className="obl__lbl">Obligation</span>
            <select className="k-input" value={form.obligation_key}
              onChange={e => setForm({ ...form, obligation_key: e.target.value })}>
              <option value="">Choose…</option>
              {catalogue.map(o => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>

          {/* The sentence this screen exists to say. Shown the moment the box is
              ticked, because afterwards it is a support ticket. */}
          {chosen && !chosen.can_be_dated && (
            <div className="note note--warn obl__gap">
              <b>No dates will be produced for this one.</b> {chosen.why_no_date}
              {' '}Recording it is still worth doing — the register counts it,
              and the calendar will date it the day the statute table gains the
              rule.
            </div>
          )}

          <div className="obl__grid">
            <label className="obl__f">
              <span className="obl__lbl">In force from</span>
              <DateInput value={form.effective_from}
                onChange={e => setForm({ ...form, effective_from: e.target.value })} />
              <span className="obl__hint">Blank means today.</span>
            </label>
            <label className="obl__f">
              <span className="obl__lbl">Until (optional)</span>
              <DateInput value={form.effective_to}
                onChange={e => setForm({ ...form, effective_to: e.target.value })} />
              <span className="obl__hint">Leave empty while it is still in force.</span>
            </label>
          </div>

          <div className="obl__grid">
            <label className="obl__f">
              <span className="obl__lbl">Owner</span>
              {members.length > 0 ? (
                <select className="k-input" value={form.owner_user_id}
                  onChange={e => setForm({ ...form, owner_user_id: e.target.value })}>
                  <option value="">Nobody yet</option>
                  {members.map(m => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name || m.full_name || m.email}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="obl__hint">
                  Only an organisation admin can see the member list, so the
                  owner cannot be set from this account.
                </span>
              )}
            </label>
            <label className="obl__f">
              <span className="obl__lbl">State code (optional)</span>
              <input className="k-input" value={form.state_code}
                placeholder="27 or MH"
                onChange={e => setForm({ ...form, state_code: e.target.value })} />
              <span className="obl__hint">
                Either convention. Both are stored as typed.
              </span>
            </label>
          </div>

          <label className="obl__f">
            <span className="obl__lbl">Registration number (optional)</span>
            <input className="k-input" value={form.registration_no}
              onChange={e => setForm({ ...form, registration_no: e.target.value })} />
          </label>

          <label className="obl__f">
            <span className="obl__lbl">Note (optional)</span>
            <input className="k-input" value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })} />
          </label>

          <div className="obl__acts obl__acts--form">
            <button type="button" className="k-btn k-btn--primary"
              onClick={save} disabled={busy}>
              {busy ? 'Saving…' : editId ? 'Save changes' : 'Record it'}
            </button>
            <button type="button" className="k-btn k-btn--ghost"
              onClick={() => { setForm(null); setEditId(null); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
