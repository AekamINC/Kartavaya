// Manav → Shifts → Bids. Open shifts employees can put their name against.
//
// `load()` caught to a toast over a list left at `[]`, so a failed fetch
// rendered "No open bids — employees can bid for open shifts here".
// `loadShifts()` was a bare `catch {}`, leaving the post form with an empty
// shift dropdown and nothing to explain it.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Empty } from '../../components/editorial';
import { useList, ErrorNote, Shim, errText, today } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';

export default function ShiftBids({ pushToast }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const bids = useList('/v1/manav/shift-bids?status=open');
  const shifts = useList('/v1/manav/shifts');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState('');
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
    setApplying(id);
    try {
      await api.post(`/v1/manav/shift-bids/${id}/apply`);
      pushToast({ title: 'Applied to bid', type: 'success' });
      bids.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The application could not be recorded.'), type: 'error' });
    } finally { setApplying(''); }
  }

  return (
    <div>
      <div className="mn-head">
        <h3 className="k-section__title">
          Shift bids<span className="k-section__title-hi" lang="hi">बोली</span>
        </h3>
        <button type="button" className="k-btn k-btn--primary" onClick={() => setShowForm(true)}
          disabled={!canWrite} title={denial || undefined}>
          + Post bid
        </button>
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
              <input className="k-formpanel__input" type="date" required value={form.date}
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
        : bids.error ? <ErrorNote what="Open shift bids" error={bids.error} onRetry={bids.reload} />
          : bids.items.length === 0 ? (
            <Empty
              icon="🙋"
              title="No open bids"
              sub="Post a shift that needs covering and employees can put their name against it."
            />
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
                    <button
                      type="button"
                      className="k-btn k-btn--primary k-btn--sm mn-wide"
                      disabled={applying === b.id || !canWrite}
                      onClick={() => applyBid(b.id)} title={denial || undefined}>
                      {applying === b.id ? 'Applying…' : 'Apply'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
    </div>
  );
}
