// Vikray · targets — revenue target against actual, per salesperson.
//
// ── Two defects this file carried ────────────────────────────────────────
// 1 · `catch {}` swallowed the rejection ENTIRELY — no toast, no state. A 500
//     rendered "No targets set. Set sales targets for your team", with nothing
//     anywhere on the page saying the request had failed. Fixed and kept fixed:
//     the empty state below is reached only when the request SUCCEEDED and
//     returned nothing.
// 2 · The salesperson was a free-text box labelled "User ID", and the form
//     called `GET /teams` into a `members` state that was never rendered.
//     `/teams` returns TEAMS — the same endpoint ProjectsPage reads as its
//     project list — so even had it been rendered it would have offered the
//     wrong nouns. The only user directory in the API is `GET /v1/org/members`
//     (org_admin+), which is used here with an honest fallback rather than a
//     dropdown that silently comes back empty.
//
// `GET /v1/vikray/targets/leaderboard` had no caller either. It answers "who is
// ahead right now" for the CURRENT period only, which is a different question
// from the full table and is the one a sales lead opens this tab to ask.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonTable } from '../../components/ui/Skeleton';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { inr, grouped } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import DateInput from '../../components/ui/DateInput';
import useTableView from '../../hooks/useTableView';
// `CreatedHead` is gone: the header comes out of the column declaration below,
// which is what lets it be moved, hidden and resized. The CELL is unchanged.
import {
  CreatedCell, UpdatedCell, ByCell, CREATED_KEY, UPDATED_KEY,
} from '../../components/ui/CreatedColumn';
import TableToolbar from '../../components/ui/TableToolbar';
import { HeadCell } from '../../components/ui/Table';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';

/**
 * The target table's columns, declared once, in the order they shipped.
 *
 * Only Created carries a `sortKey`, and that is not an omission: the rest have
 * always been plain `<th>`, and a header that claims to sort a column the view
 * does not sort is worse than a header that claims nothing.
 *
 * `fixed` on Salesperson (whose target a row IS — every other cell is a number
 * about that person) and on the actions cell, which holds Edit and Remove and
 * the inline save pair. Achievement stays hideable: it is a bar derived from
 * Target and Actual, so a firm that reads the two numbers directly loses
 * nothing by folding it away.
 */
const TARGET_COLUMNS = [
  { id: 'salesperson_name', label: 'Salesperson', fixed: true },
  { id: 'period', label: 'Period' },
  { id: 'target_amount', label: 'Target', num: true },
  { id: 'actual_amount', label: 'Actual', num: true },
  { id: 'achievement', label: 'Achievement' },
  { id: CREATED_KEY, label: 'Created', sortKey: CREATED_KEY, className: 'tbl__created' },
  { id: 'actions', label: 'Actions', sr: true, className: 'vk-tg__acts', fixed: true },
  /* WHO set the target and WHO last moved it, appended at the END of the
     declaration — not slipped in beside Created, where they read better.
     `useColumnPrefs` stores an ARRANGEMENT against this key, and a column
     inserted into the middle of the base list arrives in a saved arrangement as
     an unknown id with no position; appending keeps every column a person has
     already arranged exactly where they put it, and the customise sheet is how
     they move these next to Created if that is where they want them.

     They are sortable because this table's sort is `useTableView` — CLIENT
     side, over the rows already loaded — so any key on the row can be ordered
     without the server being asked anything. (The header comment above about
     plain `<th>` predates the column declaration; every header here is a
     `HeadCell` now, and one carries a sort only if its column names a key.) */
  { id: 'created_by_name', label: 'Created by', sortKey: 'created_by_name', className: 'tbl__by' },
  { id: UPDATED_KEY, label: 'Updated', sortKey: UPDATED_KEY, className: 'tbl__created' },
  { id: 'updated_by_name', label: 'Updated by', sortKey: 'updated_by_name', className: 'tbl__by' },
];

/** The quarter containing `d`, as the two ISO dates the API wants. */
function quarterOf(d = new Date()) {
  const q = Math.floor(d.getMonth() / 3);
  const start = new Date(d.getFullYear(), q * 3, 1);
  const end = new Date(d.getFullYear(), q * 3 + 3, 0);
  const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { start: iso(start), end: iso(end), label: `Q${q + 1} ${d.getFullYear()}` };
}

const pctOf = t =>
  Number(t.target_amount) > 0
    ? Math.round((Number(t.actual_amount) || 0) / Number(t.target_amount) * 100)
    : null;

function Bar({ pct }) {
  if (pct == null) return <span className="vk-tg__nopct">No amount set</span>;
  return (
    <span className="vk-tg__bar">
      <span className="vk-tg__track">
        <span className={`vk-tg__fill${pct >= 100 ? ' is-met' : ''}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </span>
      <b className={`vk-tg__pct${pct >= 100 ? ' is-met' : ''}`}>{pct}%</b>
    </span>
  );
}

function TargetForm({ onSaved, onCancel }) {
  const { pushToast } = useToast();
  const q = quarterOf();
  const [people, setPeople] = useState(null);   // null = unknown, [] = none, list = ok
  const [restricted, setRestricted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    salesperson_id: '', period_start: q.start, period_end: q.end,
    target_amount: 0, target_deals: 0, notes: '',
  });

  useEffect(() => {
    let dead = false;
    api.get('/v1/org/members')
      .then(r => { if (!dead) setPeople(Array.isArray(r.data) ? r.data : (r.data?.members || [])); })
      .catch(e => {
        if (dead) return;
        setPeople([]);
        // 403 is not a failure here — it is the accurate answer for a member
        // who is not an org admin, and it needs a different sentence from a
        // dropped connection.
        setRestricted(e.response?.status === 403);
      });
    return () => { dead = true; };
  }, []);

  const set = patch => setForm(f => ({ ...f, ...patch }));

  async function submit(e) {
    e.preventDefault();
    if (!form.salesperson_id || !form.period_start || !form.period_end) {
      pushToast({ title: 'A target needs a person and a period', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      await api.post('/v1/vikray/targets', form);
      pushToast({ title: 'Target saved', type: 'success' });
      onSaved();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Could not save the target', type: 'error' });
    } finally { setSaving(false); }
  }

  return (
    <form className="vk-form" onSubmit={submit}>
      <div className="vk-form__head">
        <h3 className="vk-form__t">Set a target<Secondary className="vk-form__hi" value="लक्ष्य" /></h3>
      </div>

      <div className="vk-form__grid">
        <label className="fld">
          <span className="fld__l">Salesperson<Secondary className="fld__hi" value="विक्रेता" /></span>
          {people === null ? (
            <select className="inp" disabled><option>Loading people…</option></select>
          ) : people.length > 0 ? (
            <select className="inp" value={form.salesperson_id} onChange={e => set({ salesperson_id: e.target.value })}>
              <option value="">Choose…</option>
              {people.map(p => (
                <option key={p.user_id} value={p.user_id}>{p.full_name || p.email || p.user_id}</option>
              ))}
            </select>
          ) : (
            <>
              <input className="inp" value={form.salesperson_id} placeholder="User ID"
                onChange={e => set({ salesperson_id: e.target.value })} />
              <span className="fld__hint">
                {restricted
                  ? 'Only an organisation admin can list members, so the picker is unavailable — paste a user ID, or ask an admin to set targets.'
                  : 'The member list did not load. Paste a user ID, or retry in a moment.'}
              </span>
            </>
          )}
        </label>

        <label className="fld">
          <span className="fld__l">Period start</span>
          <DateInput type="date" className="inp" value={form.period_start}
            onChange={e => set({ period_start: e.target.value })} />
        </label>
        <label className="fld">
          <span className="fld__l">Period end</span>
          <DateInput type="date" className="inp" value={form.period_end}
            onChange={e => set({ period_end: e.target.value })} />
        </label>
      </div>

      {/* Targets are almost always quarterly, and typing two dates to say so is
          the kind of friction that leaves a tab unused. */}
      <div className="vk-form__quick">
        <span className="vk-form__quickl">Quick period</span>
        {[0, -3, 3].map(off => {
          const d = new Date(); d.setMonth(d.getMonth() + off);
          const p = quarterOf(d);
          const on = form.period_start === p.start && form.period_end === p.end;
          return (
            <button key={p.label} type="button" className={`btn btn--sm ${on ? 'btn--tonal' : 'btn--out'}`}
              onClick={() => set({ period_start: p.start, period_end: p.end })}>
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="vk-form__grid">
        <label className="fld">
          <span className="fld__l">Target amount (₹)</span>
          <input type="number" min="0" className="inp" value={form.target_amount}
            onChange={e => set({ target_amount: Number(e.target.value) })} />
          <span className="fld__hint">
            Measured against deals marked Won in this period and assigned to this person in Graha.
          </span>
        </label>
        <label className="fld">
          <span className="fld__l">Target deals</span>
          <input type="number" min="0" className="inp" value={form.target_deals}
            onChange={e => set({ target_deals: Number(e.target.value) })} />
        </label>
        <label className="fld">
          <span className="fld__l">Notes</span>
          <input className="inp" value={form.notes} onChange={e => set({ notes: e.target.value })} />
        </label>
      </div>

      <div className="vk-form__acts">
        <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save target'}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

export default function TargetsTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'set targets' });
  const { pushToast } = useToast();
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [board, setBoard] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await api.get('/v1/vikray/targets');
      setTargets(r.data?.data || []);
    } catch (e) {
      setErr(e);
      setTargets([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The current-period standing. Independent of the table: it failing must not
  // take the table with it, and vice versa.
  useEffect(() => {
    let dead = false;
    api.get('/v1/vikray/targets/leaderboard')
      .then(r => { if (!dead) setBoard(r.data?.data || []); })
      .catch(() => { if (!dead) setBoard([]); });
  }, [targets.length]);

  function startEdit(t) {
    setEditId(t.id);
    setDraft({
      target_amount: Number(t.target_amount) || 0,
      target_deals: Number(t.target_deals) || 0,
      notes: t.notes || '',
    });
  }

  async function saveEdit() {
    setSavingEdit(true);
    try {
      await api.patch(`/v1/vikray/targets/${editId}`, draft);
      pushToast({ title: 'Target updated', type: 'success' });
      setEditId(null);
      load();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Could not update the target', type: 'error' });
    } finally { setSavingEdit(false); }
  }

  async function remove(t) {
    try {
      await api.delete(`/v1/vikray/targets/${t.id}`);
      pushToast({ title: 'Target removed', type: 'success' });
      load();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Could not remove the target', type: 'error' });
    }
  }

  const lead = (board || []).filter(b => Number(b.target_amount) > 0).slice(0, 5);

  // Won revenue inside a target's period that NO target can claim, because the
  // deal has nobody assigned to it in Graha.
  //
  // This exists because a zero here has had two very different meanings. Until
  // now it meant the join was broken — attainment matched `graha_deals.owner_id`,
  // a column nothing in the product ever writes, so every target in every org
  // read Rs 0 forever. That is fixed. The zero that remains is the honest one:
  // the deals closed, but nobody is on them, so they belong to no target. Left
  // as a bare zero the two are indistinguishable on screen, and the first
  // instinct is that the number is broken again.
  //
  // Deduped by period: the API reports the figure per target row, so two people
  // sharing a quarter report the same rupees and it must be said once.
  const unclaimed = React.useMemo(() => {
    const byPeriod = new Map();
    for (const t of targets) {
      const amount = Number(t.unattributed_amount) || 0;
      if (amount <= 0) continue;
      const key = `${t.period_start}|${t.period_end}`;
      if (byPeriod.has(key)) continue;
      byPeriod.set(key, {
        key,
        start: t.period_start,
        end: t.period_end,
        amount,
        deals: Number(t.unattributed_deals) || 0,
      });
    }
    return [...byPeriod.values()];
  }, [targets]);

  const view = useTableView(targets, { searchKeys: ['salesperson_name'] });
  const cols = useColumnPrefs('vikray.targets', TARGET_COLUMNS);
  return (
    <div>
      <div className="vk-bar">
        <p className="vk-bar__note">
          Actuals come from deals marked <b>Won</b> in Graha (CRM) inside the target period
          and <b>assigned to that salesperson</b>. A deal with nobody assigned counts for no one.
        </p>
        <button type="button" className="btn btn--fill btn--sm vk-bar__new"
          disabled={!canWrite} title={denial || undefined}
          onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Close form' : '+ Set target'}
        </button>
      </div>

      {showForm && canWrite && <TargetForm onCancel={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}

      {lead.length > 0 && (
        <section className="card vk-card vk-lead">
          <header className="card__head">
            <div className="card__titles">
              <h3 className="card__title">This period</h3>
              <Secondary className="card__hi" value="वर्तमान" />
            </div>
          </header>
          <div className="card__body">
            <ol className="vk-lead__l">
              {lead.map(b => (
                <li key={b.salesperson_id} className="vk-lead__i">
                  <span className="vk-lead__n">{b.salesperson_name || 'Unnamed'}</span>
                  <Bar pct={Math.round(Number(b.achievement_pct) || 0)} />
                  <span className="vk-lead__v">{inr(b.actual_amount)} of {inr(b.target_amount)}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {loading ? (
        <SkeletonRegion label="Loading targets"><SkeletonTable rows={4} columns={5} showAvatar={false} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : targets.length === 0 ? (
        <Empty
          icon="teams"
          title="No targets set"
          sub={canWrite
            ? 'A target is a person, a period and a number. Set one and this table tracks it against the deals they close.'
            : `A target is a person, a period and a number, tracked against the deals they close. ${denial}`}
          cta={canWrite ? '+ Set target' : undefined}
          onCta={canWrite ? () => setShowForm(true) : undefined}
        />
      ) : (
        <>
          {unclaimed.length > 0 && (
            <div className="vk-tg__unclaimed" role="note">
              {unclaimed.map(u => (
                <p key={u.key} className="vk-tg__unclaimedl">
                  <b>{inr(u.amount)}</b> across {grouped(u.deals)} won{' '}
                  {u.deals === 1 ? 'deal' : 'deals'} in {u.start} → {u.end} counts towards
                  nobody&rsquo;s target — {u.deals === 1 ? 'it has' : 'they have'} no
                  salesperson assigned in Graha.
                </p>
              ))}
            </div>
          )}
          <div className="tv-card">
          <TableToolbar view={view} label="targets">
            <ColumnsButton cols={cols} />
          </TableToolbar>
          <div className="tbl__wrap">
          <table className="tbl vk-tg">
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
              {view.rows.map(t => (
                <tr key={t.id}>
                  {cols.cells({
                    // NEVER `t.salesperson_id`. This cell used to fall back to
                    // it when the name did not resolve, which put a raw
                    // `users.user_id` on screen — the names-not-ids rule broken,
                    // and `check-rendered-ids.mjs` did not catch it because that
                    // ratchet is positional rather than textual.
                    //
                    // `unknown` is the word `ByCell` uses for exactly this
                    // state, and it means the same thing here: a target IS
                    // assigned to somebody, but no user row stands behind the id
                    // any more. It reads differently from an em dash, which
                    // would say nobody is assigned — and a target with no
                    // salesperson cannot exist, `salesperson_id` being required
                    // on the form above.
                    salesperson_name: (
                      <td>
                        {t.salesperson_name || (
                          <span
                            className="vk-tg__unknown"
                            title="The account this target is assigned to no longer exists"
                          >
                            unknown
                          </span>
                        )}
                      </td>
                    ),
                    period: <td className="vk-tg__period">{t.period_start} → {t.period_end}</td>,
                    target_amount: (
                      <td className="tbl__num">
                        {editId === t.id ? (
                          <input type="number" min="0" className="inp vk-tg__in" value={draft.target_amount}
                            aria-label="Target amount"
                            onChange={e => setDraft(d => ({ ...d, target_amount: Number(e.target.value) }))} />
                        ) : inr(t.target_amount)}
                      </td>
                    ),
                    actual_amount: <td className="tbl__num">{inr(t.actual_amount)}</td>,
                    achievement: (
                      <td>
                        <Bar pct={pctOf(t)} />
                        {Number(t.target_deals) > 0 && (
                          <span className="vk-tg__deals">
                            {grouped(t.actual_deals)} of {grouped(t.target_deals)} deals
                          </span>
                        )}
                      </td>
                    ),
                    [CREATED_KEY]: <CreatedCell value={t.created_at} />,
                    /* `hasActor` is not optional. It is what separates a target
                       set by somebody whose account has since been deleted
                       (`unknown`) from one with no author recorded at all (an
                       em dash) — and a target with no author is a target
                       nobody can be asked about. */
                    created_by_name: <ByCell name={t.created_by_name} hasActor={t.has_creator} />,
                    [UPDATED_KEY]: <UpdatedCell value={t.updated_at} />,
                    updated_by_name: <ByCell name={t.updated_by_name} hasActor={t.has_updater} />,
                    actions: (
                      <td className="vk-tg__acts">
                        {editId === t.id ? (
                          <>
                            <button type="button" className="btn btn--fill btn--sm" disabled={savingEdit} onClick={saveEdit}>
                              {savingEdit ? '…' : 'Save'}
                            </button>
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditId(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => startEdit(t)}>Edit</button>
                            <button
                              type="button" className="btn btn--ghost btn--sm vk-tg__del"
                              onClick={() => setConfirm({
                                title: 'Remove this target?',
                                message: `The target for ${t.salesperson_name || 'this person'} covering ${t.period_start} to ${t.period_end} is deleted. Deals they have closed are not affected.`,
                                confirmLabel: 'Remove target',
                                onConfirm: () => remove(t),
                              })}
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </td>
                    ),
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
        </>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
