// Manav → Shifts → Bids. Open shifts employees can put their name against.
//
// `load()` caught to a toast over a list left at `[]`, so a failed fetch
// rendered "No open bids — employees can bid for open shifts here".
// `loadShifts()` was a bare `catch {}`, leaving the post form with an empty
// shift dropdown and nothing to explain it.
//
// ── THE HALF THAT WAS MISSING: AWARDING ──────────────────────────────────────
//
// This screen posted a bid and let an employee apply, then rendered
// "{n} responses" and stopped. `POST /shift-bids/{bid}/accept/{employee}` has
// existed on the server since migration 027's endpoints were written and was
// unreachable from anywhere in the product, because NOTHING RETURNED THE
// APPLICANTS — `GET /shift-bids` answers an integer, so there was no honest way
// to obtain the employee id that route needs.
//
// The loop therefore ended at "employees apply". A manager watched a number go
// up and rostered somebody by hand from the Schedules sub-tab, which loses the
// only thing a bid is for: the record that the person volunteered.
// `ScheduleGrid`'s coverage panel closes with "A shift covered by fewer than
// expected is a gap to fill — post it under Bids", pointing at that dead end.
//
// `GET /shift-bids/{id}/responses` was added to close it. It is fetched PER BID
// AND ONLY ON DEMAND: the applicant list names colleagues, and a board of forty
// open shifts must not issue forty requests naming forty people just to render.
//
// ── The status filter is part of the same fix ────────────────────────────────
//
// The list has always asked for `status=open`. Once an award can fill a bid, a
// filled bid leaves that list — and with no way to view the other two states,
// awarding a shift would make the record of who got it disappear. So the three
// states 027's CHECK allows are all reachable here.
import React, { useCallback, useState } from 'react';
import { api } from '../../lib/api';
import { Empty } from '../../components/editorial';
import { useList, ErrorNote, Shim, errText, today } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import DateInput from '../../components/ui/DateInput';

const STATES = [
  { value: 'open', label: 'Open' },
  { value: 'filled', label: 'Filled' },
  { value: 'cancelled', label: 'Cancelled' },
];

const EMPTY_BY_STATE = {
  open: {
    title: 'No open bids',
    sub: 'Post a shift that needs covering and employees can put their name against it.',
  },
  filled: {
    title: 'No bids have been filled',
    sub: 'A bid moves here once every slot on it has been awarded.',
  },
  cancelled: {
    title: 'No cancelled bids',
    sub: 'Nothing posted here has been withdrawn.',
  },
};

/**
 * The applicants on one bid, and the control that awards a slot.
 *
 * Loading, failure and empty are kept apart for the reason the whole module is
 * built around (`_shared.jsx`): "Nobody has applied to this shift" is a
 * statement about the business, and a caught error left over an empty array
 * prints it when the truth is that the request failed. On this screen that
 * matters more than most — a manager who reads it stops waiting and rosters
 * someone by hand.
 */
function Applicants({ bid, pushToast, onAwarded }) {
  // Asked HERE rather than threaded down as a prop. `check-write-gates` refuses
  // the prop form and is right to: a component that consumes a `canWrite` it did
  // not declare throws a ReferenceError the day someone renders it from a second
  // call site, and the failure is a white screen rather than a build error.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [awarding, setAwarding] = useState('');

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get(`/v1/manav/shift-bids/${bid.id}/responses`);
      setState({ loading: false, error: '', data: r.data });
    } catch (err) {
      setState({ loading: false, error: errText(err), data: null });
    }
  }, [bid.id]);

  React.useEffect(() => { load(); }, [load]);

  async function award(employeeId, name) {
    setAwarding(employeeId);
    try {
      const r = await api.post(`/v1/manav/shift-bids/${bid.id}/accept/${employeeId}`);
      const out = r?.data || {};
      pushToast({
        title: `${name} has the shift`,
        // Said every time, because the roster row is the part a manager assumes
        // still has to be done by hand — it does not.
        message: out.bid_status === 'filled'
          ? 'Every slot is awarded, so this bid is now closed. They are on the roster for that date.'
          : 'They are on the roster for that date.',
        type: 'success',
      });
      await load();
      onAwarded?.(out);
    } catch (err) {
      pushToast({ title: errText(err, 'The shift could not be awarded.'), type: 'error' });
    } finally { setAwarding(''); }
  }

  if (state.loading) return <Shim count={2} />;
  if (state.error) {
    return <ErrorNote what="The applicants" error={state.error} onRetry={load} />;
  }

  const list = state.data?.data || [];
  const needed = Number(state.data?.slots_needed ?? bid.slots_needed ?? 1);
  const awarded = Number(state.data?.slots_awarded ?? 0);
  // The server's answer wins over the row this card was rendered from. Awarding
  // the last slot closes the bid, and `load()` above re-reads it — reading the
  // stale list row here would leave an Award button live on a bid the next click
  // would 409.
  const bidStatus = state.data?.bid_status ?? bid.status;

  return (
    <div className="mn-bid__panel">
      <p className="mn-pii__note">
        <b>{awarded} of {needed}</b> slot{needed === 1 ? '' : 's'} awarded.
        {' '}Awarding one rosters that employee for {bid.date} straight away.
      </p>

      {list.length === 0 ? (
        <p className="note note--info">
          <b>Nobody has applied to this shift yet.</b> Employees see open bids on
          their own Shifts screen.
        </p>
      ) : (
        <ul className="mn-bid__apps">
          {list.map(a => (
            <li key={a.id} className="mn-bid__app">
              <span className="mn-bid__who">
                <b>{a.employee_name || 'Unknown employee'}</b>
                {a.employee_code && <span className="mn-t__mono"> {a.employee_code}</span>}
              </span>
              {a.status === 'accepted' ? (
                <span className="mn-bid__done">Awarded</span>
              ) : (
                <button
                  type="button"
                  className="k-btn k-btn--primary k-btn--sm"
                  disabled={awarding === a.employee_id || !canWrite || bidStatus !== 'open'}
                  title={denial || (bidStatus !== 'open' ? 'This bid is no longer open.' : undefined)}
                  onClick={() => award(a.employee_id, a.employee_name)}
                >
                  {awarding === a.employee_id ? 'Awarding…' : 'Award shift'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ShiftBids({ pushToast }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const [status, setStatus] = useState('open');
  const bidsUrl = `/v1/manav/shift-bids?status=${status}`;
  // `[bidsUrl]` — `useList` builds its fetch in a `useCallback` over the deps it
  // is given, so a list with no deps never re-runs when the url changes. The
  // filter would have looked switched and shown the first state forever.
  const bids = useList(bidsUrl, [bidsUrl]);
  const shifts = useList('/v1/manav/shifts');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openBid, setOpenBid] = useState('');
  const [form, setForm] = useState({ shift_id: '', date: today(), slots_needed: 1 });

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/shift-bids', {
        ...form, slots_needed: Number(form.slots_needed) || 1,
      });
      pushToast({ title: 'Bid posted', type: 'success' });
      setShowForm(false);
      setForm({ shift_id: '', date: today(), slots_needed: 1 });
      bids.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The bid could not be posted.'), type: 'error' });
    } finally { setSaving(false); }
  }

  async function applyBid(id) {
    try {
      await api.post(`/v1/manav/shift-bids/${id}/apply`);
      pushToast({ title: 'Applied to bid', type: 'success' });
      bids.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The application could not be recorded.'), type: 'error' });
    }
  }

  const empty = EMPTY_BY_STATE[status] || EMPTY_BY_STATE.open;

  return (
    <div>
      <div className="mn-head">
        <h3 className="k-section__title">
          Shift bids<Secondary className="k-section__title-hi" value="बोली" />
        </h3>
        <button type="button" className="k-btn k-btn--primary" onClick={() => setShowForm(true)}
          disabled={!canWrite} title={denial || undefined}>
          + Post bid
        </button>
      </div>

      <div className="mn-sub" role="tablist" aria-label="Which bids to show">
        {STATES.map(s => (
          <button
            key={s.value}
            type="button"
            role="tab"
            aria-selected={status === s.value}
            tabIndex={status === s.value ? 0 : -1}
            className={`mn-sub__b${status === s.value ? ' on' : ''}`}
            onClick={() => { setStatus(s.value); setOpenBid(''); }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {showForm && (
        <form onSubmit={save} className="k-formpanel">
          <h4 className="k-section__title">New shift bid</h4>

          {shifts.error && (
            <ErrorNote what="Shift definitions" error={shifts.error} onRetry={shifts.reload} />
          )}
          {!shifts.loading && !shifts.error && shifts.items.length === 0 && (
            <p className="note note--warn">
              <b>No shifts are defined.</b> A bid is for a specific shift, so
              create one under Definitions first.
            </p>
          )}

          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">
              <span>Shift *</span>
              <select className="k-formpanel__input" required value={form.shift_id}
                disabled={shifts.loading || !!shifts.error}
                onChange={e => setForm({ ...form, shift_id: e.target.value })}>
                <option value="">
                  {shifts.loading ? 'Loading…' : shifts.error ? 'Unavailable' : '— Select —'}
                </option>
                {(shifts.items || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>Date *</span>
              <DateInput className="k-formpanel__input" type="date" required value={form.date}
                onChange={e => setForm({ ...form, date: e.target.value })} />
            </label>
            <label className="k-formpanel__label">
              <span>Slots needed *</span>
              <input className="k-formpanel__input" type="number" min="1" required
                value={form.slots_needed}
                onChange={e => setForm({ ...form, slots_needed: e.target.value })} />
            </label>
          </div>
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving || !!shifts.error || !canWrite} title={denial || undefined}>
              {saving ? 'Posting…' : 'Post bid'}
            </button>
          </div>
        </form>
      )}

      {bids.loading ? <Shim count={3} />
        : bids.error ? <ErrorNote what="Shift bids" error={bids.error} onRetry={bids.reload} />
          : bids.items.length === 0 ? (
            <Empty icon="🙋" title={empty.title} sub={empty.sub} />
          ) : (
            <div className="mn-grid">
              {bids.items.map(b => (
                <div key={b.id} className="mn-card">
                  <h4 className="mn-card__t">{b.shift_name}</h4>
                  <div className="mn-card__meta">
                    <div className="mn-t__mono">{b.date}</div>
                    <div>{b.slots_needed} slot{Number(b.slots_needed) === 1 ? '' : 's'} needed</div>
                    <div>{b.responses ?? 0} response{Number(b.responses ?? 0) === 1 ? '' : 's'}</div>
                  </div>
                  <div className="mn-card__act">
                    {(b.status || status) === 'open' && (
                      <button
                        type="button"
                        className="k-btn k-btn--ghost k-btn--sm mn-wide"
                        disabled={!canWrite}
                        onClick={() => applyBid(b.id)} title={denial || undefined}>
                        Apply
                      </button>
                    )}
                    <button
                      type="button"
                      className="k-btn k-btn--primary k-btn--sm mn-wide"
                      aria-expanded={openBid === b.id}
                      onClick={() => setOpenBid(openBid === b.id ? '' : b.id)}
                    >
                      {openBid === b.id ? 'Hide applicants' : 'See applicants'}
                    </button>
                  </div>
                  {openBid === b.id && (
                    <Applicants
                      bid={{ ...b, status: b.status || status }}
                      pushToast={pushToast}
                      onAwarded={out => { if (out?.bid_status === 'filled') bids.reload(); }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
    </div>
  );
}
