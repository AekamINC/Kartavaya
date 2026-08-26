// Manav → Holidays. The public-holiday calendar.
//
// `load()` caught to a toast over a list left at `[]`, so a failed fetch
// rendered "No holidays configured". A holiday list that silently reads as
// empty is a working day nobody was told about.
//
// The Remove control was a bare `<button>` with `background:none;border:none`
// inline — a link painted by hand, outside the button system, with no focus
// ring and no confirmation on a destructive action.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty, DataTable, Td } from '../../components/editorial';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Badge, useList, ErrorNote, Shim, errText } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import DateInput from '../../components/ui/DateInput';
import { GST_STATES } from '../../lib/validators';

// The same list the invoice form's Place of supply select is built from, and
// deliberately not a second copy: a state typed by hand — "Maharastra", "MH",
// a trailing space — reads as a different state from every other row in the
// database, and nothing downstream could tell a typo from a state.
//
// The VALUE is the numeric GST code ('27'), which is what the API stores. The
// backend accepts 'MH' and 'Maharashtra' too and normalises them, but a select
// can only send what is in the list, so the list sends the canonical form.
const STATE_OPTIONS = Object.entries(GST_STATES)
  .sort((a, b) => a[1].localeCompare(b[1]));

/** '27' → 'Maharashtra'. Falls back to whatever is on the row, because a
 *  holiday written before this form existed may carry the alphabetic form. */
function stateLabel(code, name) {
  if (!code) return null;
  return name || GST_STATES[code] || GST_STATES[String(code).padStart(2, '0')] || String(code);
}

export default function HolidaysTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const { pushToast } = useToast();
  const list = useList('/v1/manav/holidays');
  const [showForm, setShowForm] = useState(false);
  // `state_code: ''` is "the whole country", which is what all 38 existing
  // rows mean — the column has been on the table since migration 175 and not
  // one row carries a value. Blank is sent as blank and stored as NULL.
  const [form, setForm] = useState({ name: '', date: '', is_optional: false, state_code: '' });
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/holidays', form);
      pushToast({ title: 'Holiday added', type: 'success' });
      setShowForm(false);
      setForm({ name: '', date: '', is_optional: false, state_code: '' });
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The holiday could not be added.'), type: 'error' });
    } finally { setSaving(false); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/manav/holidays/${id}`);
      pushToast({ title: 'Holiday removed', type: 'success' });
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The holiday could not be removed.'), type: 'error' });
    }
  }

  return (
    <div>
      <div className="mn-bar">
        <div className="mn-bar__gap" />
        <button type="button" className="k-btn k-btn--primary" onClick={() => setShowForm(true)}
          disabled={!canWrite} title={denial || undefined}>
          + Add holiday
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="k-formpanel">
          <div className="k-formpanel__grid k-formpanel__grid--2">
            <label className="k-formpanel__label">
              <span>Name *</span>
              <input className="k-formpanel__input" required value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="k-formpanel__label">
              <span>Date *</span>
              <DateInput className="k-formpanel__input" type="date" required value={form.date}
                onChange={e => setForm({ ...form, date: e.target.value })} />
            </label>
            <label className="k-formpanel__label">
              <span>Applies to</span>
              {/* Blank is the DEFAULT and it is the common case: most holidays
                  close the whole firm. Naming a state narrows it, and nothing
                  is ever narrowed by accident. */}
              <select className="k-formpanel__input" value={form.state_code}
                onChange={e => setForm({ ...form, state_code: e.target.value })}>
                <option value="">Whole country</option>
                {STATE_OPTIONS.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </label>
            <label className="k-formpanel__label mn-check">
              <input type="checkbox" checked={form.is_optional}
                onChange={e => setForm({ ...form, is_optional: e.target.checked })} />
              <span>Optional holiday</span>
            </label>
          </div>
          <p className="note note--info">
            An optional holiday is one an employee may choose to take. A
            mandatory one closes the organisation for everybody.
            {' '}A holiday left at <strong>Whole country</strong> applies to
            every employee. Naming a state limits it to the people recorded as
            working there — and to anyone whose state is not recorded, because
            nobody having said is not the same as them being somewhere else.
          </p>
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving || !canWrite} title={denial || undefined}>
              {saving ? 'Adding…' : 'Add holiday'}
            </button>
          </div>
        </form>
      )}

      {list.loading ? <Shim count={4} />
        : list.error ? <ErrorNote what="The holiday calendar" error={list.error} onRetry={list.reload} />
          : list.items.length === 0 ? (
            <Empty
              icon="📅"
              title="No holidays configured"
              sub="Add public holidays and company-wide days off. Attendance and payroll both read this calendar."
            />
          ) : (
            <DataTable arrange="manav.holidays" columns={['Date', 'Name', 'Type', 'Applies to', '']}>
              {list.items.map(h => (
                <tr key={h.id}>
                  <Td className="mn-t__mono">{h.date}</Td>
                  <Td bold>{h.name}</Td>
                  <Td>
                    <Badge
                      text={h.is_optional ? 'Optional' : 'Mandatory'}
                      color={h.is_optional ? 'var(--warn)' : 'var(--ok)'}
                    />
                  </Td>
                  {/* The state NAME, never the bare code — a calendar that says
                      "27" is a calendar nobody can read. */}
                  <Td>{stateLabel(h.state_code, h.state_name) || 'Whole country'}</Td>
                  <Td>
                    <button
                      type="button"
                      className="k-btn k-btn--ghost k-btn--sm k-btn--reject"
                      onClick={() => setConfirm({
                        title: `Remove ${h.name}?`,
                        message: `${h.date} will go back to being an ordinary working day. Attendance and payroll both read this calendar.`,
                        confirmLabel: 'Remove',
                        intent: 'danger',
                        onConfirm: () => remove(h.id),
                      })}
                    >
                      Remove
                    </button>
                  </Td>
                </tr>
              ))}
            </DataTable>
          )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
