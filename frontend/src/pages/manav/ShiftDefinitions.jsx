// Manav → Shifts → Definitions. The org's shift catalogue.
//
// ── The colour picker could not round-trip its own value ─────────────────────
//
// The form defaulted `color` to the STRING `'var(--st-in-progress)'` and fed it
// straight to `<input type="color">`. A native colour input accepts `#rrggbb`
// and nothing else: anything it cannot parse is silently coerced to `#000000`,
// so the swatch opened black every time, and a shift created without touching
// the picker POSTed the literal text `var(--st-in-progress)` into
// `manav_shift_definitions.color` — a column whose backend default is the hex
// `#3B82F6`.
//
// This is a token sweep applied one field too far. Every other colour in this
// module SHOULD be a token; this one cannot be, because it is a user-chosen
// value persisted per row and rendered through a native control that only
// speaks hex. `DEFAULT_SHIFT_COLOR` in `_shared.jsx` carries that reasoning
// next to the value so it does not get "fixed" again.
//
// Rows already written with a token string still exist. `isHexColor` guards the
// input so those rows open on the default rather than silently becoming black,
// and the swatch beside the name renders the stored value as-is — a token
// string happens to be valid there, which is exactly why nobody noticed.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Empty } from '../../components/editorial';
import {
  useList, ErrorNote, Shim, errText, DEFAULT_SHIFT_COLOR, isHexColor,
} from './_shared';

const BLANK = {
  name: '', start_time: '09:00', end_time: '17:00',
  break_minutes: 30, color: DEFAULT_SHIFT_COLOR,
};

export default function ShiftDefinitions({ pushToast }) {
  const list = useList('/v1/manav/shifts');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(BLANK);
  const [editSaving, setEditSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/shifts', { ...form, break_minutes: Number(form.break_minutes) || 0 });
      pushToast({ title: 'Shift created', type: 'success' });
      setShowForm(false);
      setForm(BLANK);
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The shift could not be created.'), type: 'error' });
    } finally { setSaving(false); }
  }

  function startEdit(s) {
    setEditingId(s.id);
    setEditForm({
      name: s.name || '',
      start_time: s.start_time || '09:00',
      end_time: s.end_time || '17:00',
      break_minutes: s.break_minutes ?? 30,
      // A stored value that is not a hex cannot be shown by the picker.
      color: isHexColor(s.color) ? s.color : DEFAULT_SHIFT_COLOR,
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      await api.patch(`/v1/manav/shifts/${editingId}`, {
        ...editForm, break_minutes: Number(editForm.break_minutes) || 0,
      });
      pushToast({ title: 'Shift updated', type: 'success' });
      setEditingId(null);
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The shift could not be updated.'), type: 'error' });
    } finally { setEditSaving(false); }
  }

  return (
    <div>
      <div className="mn-head">
        <h3 className="k-section__title">
          Shift definitions<span className="k-section__title-hi" lang="hi">पारी</span>
        </h3>
        <button type="button" className="k-btn k-btn--primary" onClick={() => setShowForm(true)}>
          + Add shift
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="k-formpanel">
          <h4 className="k-section__title">New shift</h4>
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">
              <span>Name *</span>
              <input className="k-formpanel__input" required value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="k-formpanel__label">
              <span>Start time *</span>
              <input className="k-formpanel__input" type="time" required value={form.start_time}
                onChange={e => setForm({ ...form, start_time: e.target.value })} />
            </label>
            <label className="k-formpanel__label">
              <span>End time *</span>
              <input className="k-formpanel__input" type="time" required value={form.end_time}
                onChange={e => setForm({ ...form, end_time: e.target.value })} />
            </label>
            <label className="k-formpanel__label">
              <span>Break (minutes)</span>
              <input className="k-formpanel__input" type="number" min="0" value={form.break_minutes}
                onChange={e => setForm({ ...form, break_minutes: e.target.value })} />
            </label>
            <label className="k-formpanel__label">
              <span>Colour</span>
              <input className="k-formpanel__input mn-color" type="color" value={form.color}
                onChange={e => setForm({ ...form, color: e.target.value })} />
            </label>
          </div>
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create shift'}
            </button>
          </div>
        </form>
      )}

      {list.loading ? <Shim count={4} />
        : list.error ? <ErrorNote what="Shift definitions" error={list.error} onRetry={list.reload} />
          : list.items.length === 0 ? (
            <Empty
              icon="🕐"
              title="No shifts defined"
              sub="Create shift templates to schedule working hours, post bids and run swaps."
            />
          ) : (
            <div className="mn-grid">
              {list.items.map(s => (
                <div key={s.id} className="mn-card">
                  {editingId === s.id ? (
                    <form onSubmit={saveEdit}>
                      <div className="k-formpanel__grid k-formpanel__grid--2">
                        <label className="k-formpanel__label mn-fw">
                          <span>Name</span>
                          <input className="k-formpanel__input" value={editForm.name}
                            onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                        </label>
                        <label className="k-formpanel__label">
                          <span>Start</span>
                          <input className="k-formpanel__input" type="time" value={editForm.start_time}
                            onChange={e => setEditForm({ ...editForm, start_time: e.target.value })} />
                        </label>
                        <label className="k-formpanel__label">
                          <span>End</span>
                          <input className="k-formpanel__input" type="time" value={editForm.end_time}
                            onChange={e => setEditForm({ ...editForm, end_time: e.target.value })} />
                        </label>
                        <label className="k-formpanel__label">
                          <span>Break (min)</span>
                          <input className="k-formpanel__input" type="number" min="0" value={editForm.break_minutes}
                            onChange={e => setEditForm({ ...editForm, break_minutes: e.target.value })} />
                        </label>
                        <label className="k-formpanel__label">
                          <span>Colour</span>
                          <input className="k-formpanel__input mn-color" type="color" value={editForm.color}
                            onChange={e => setEditForm({ ...editForm, color: e.target.value })} />
                        </label>
                      </div>
                      <div className="mn-card__act">
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                          onClick={() => setEditingId(null)}>Cancel</button>
                        <button type="submit" className="k-btn k-btn--primary k-btn--sm" disabled={editSaving}>
                          {editSaving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="mn-card__head">
                        <span className="mn-dot" style={{ '--c': s.color || 'var(--st-in-progress)' }} />
                        <h4 className="mn-card__t">{s.name}</h4>
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                          onClick={() => startEdit(s)}>Edit</button>
                      </div>
                      <div className="mn-card__meta">
                        <div className="mn-t__mono">{s.start_time} — {s.end_time}</div>
                        <div>Break {s.break_minutes ?? 0} min</div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
    </div>
  );
}
