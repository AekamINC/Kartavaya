// Manav → Shifts → Swaps. Employees trading rostered days.
//
// `load()` caught to a toast over a list left at `[]`, so a failed fetch
// rendered "No pending swaps". `loadEmployees()` was a bare `catch {}`.
//
// ── The Schedule ID field ────────────────────────────────────────────────────
//
// The form asked the person to type a raw UUID into a text box labelled
// "Schedule ID — Your schedule ID". Nothing on the screen showed them what
// their schedule IDs were, so the field was unfillable without opening the
// network tab. It is now a select over the caller's own roster, read from
// `/v1/manav/schedules`, showing the date and shift name and submitting the id.
//
// Approving a swap is an APPROVER-level action that rewrites two people's
// rosters, and it fired on a single click. It now confirms and names both
// people.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Empty } from '../../components/editorial';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useList, ErrorNote, Shim, errText, monthRange, thisMonth } from './_shared';

export default function SwapRequests({ pushToast }) {
  const swaps = useList('/v1/manav/swaps?status=pending');
  const [showForm, setShowForm] = useState(false);
  const [acting, setActing] = useState('');
  const [confirm, setConfirm] = useState(null);

  async function handleAction(id, action) {
    setActing(id + action);
    try {
      await api.patch(`/v1/manav/swaps/${id}?action=${action}`);
      pushToast({ title: `Swap ${action}`, type: 'success' });
      swaps.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The decision could not be recorded.'), type: 'error' });
    } finally { setActing(''); }
  }

  return (
    <div>
      <div className="mn-head">
        <h3 className="k-section__title">
          Swap requests<span className="k-section__title-hi" lang="hi">अदला-बदली</span>
        </h3>
        <button type="button" className="k-btn k-btn--primary" onClick={() => setShowForm(true)}>
          + Request swap
        </button>
      </div>

      {showForm && (
        <SwapForm
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); swaps.reload(); }}
          pushToast={pushToast}
        />
      )}

      {swaps.loading ? <Shim count={3} />
        : swaps.error ? <ErrorNote what="Swap requests" error={swaps.error} onRetry={swaps.reload} />
          : swaps.items.length === 0 ? (
            <Empty
              icon="🔄"
              title="No pending swaps"
              sub="Requests to trade a rostered day appear here for approval."
            />
          ) : (
            <div className="mn-grid">
              {swaps.items.map(s => (
                <article key={s.id} className="mn-card">
                  <div className="mn-card__meta">
                    <div>
                      <strong>{s.requester_name}</strong> wants to swap with{' '}
                      <strong>{s.target_name}</strong>
                    </div>
                    <div className="mn-t__mono">{s.schedule_date} · {s.shift_name}</div>
                    {s.reason && <div className="mn-quote">{s.reason}</div>}
                  </div>
                  <div className="mn-card__act">
                    <button
                      type="button"
                      className="k-btn k-btn--primary k-btn--sm"
                      disabled={!!acting}
                      onClick={() => setConfirm({
                        title: 'Approve this swap?',
                        message: `${s.requester_name} and ${s.target_name} will exchange their rostered shifts on ${s.schedule_date}. Both rosters change.`,
                        confirmLabel: 'Approve',
                        intent: 'neutral',
                        onConfirm: () => handleAction(s.id, 'approved'),
                      })}
                    >
                      {acting === s.id + 'approved' ? 'Approving…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="k-btn k-btn--ghost k-btn--sm k-btn--reject"
                      disabled={!!acting}
                      onClick={() => handleAction(s.id, 'rejected')}
                    >
                      {acting === s.id + 'rejected' ? 'Rejecting…' : 'Reject'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function SwapForm({ onClose, onCreated, pushToast }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ requester_schedule_id: '', target_employee_id: '', reason: '' });

  const employees = useList('/v1/manav/employees');
  // The caller's own roster for this month, so the schedule can be PICKED
  // rather than typed as a UUID. At self scope this route returns only the
  // caller's rows, which is exactly the set a swap may be requested from.
  const { from, to } = monthRange(thisMonth());
  const schedUrl = `/v1/manav/schedules?date_from=${from}&date_to=${to}`;
  const schedules = useList(schedUrl, [schedUrl]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/swaps', form);
      pushToast({ title: 'Swap request created', type: 'success' });
      onCreated();
    } catch (err) {
      pushToast({ title: errText(err, 'The swap request could not be created.'), type: 'error' });
    } finally { setSaving(false); }
  }

  const noRoster = !schedules.loading && !schedules.error && schedules.items.length === 0;

  return (
    <form onSubmit={submit} className="k-formpanel">
      <h4 className="k-section__title">New swap request</h4>

      {employees.error && (
        <ErrorNote what="The employee list" error={employees.error} onRetry={employees.reload} />
      )}
      {schedules.error && (
        <ErrorNote what="Your roster" error={schedules.error} onRetry={schedules.reload} />
      )}
      {noRoster && (
        <p className="note note--info">
          <b>Nothing is rostered to you this month.</b> A swap trades a shift you
          already hold, so there is nothing to offer yet.
        </p>
      )}

      <div className="k-formpanel__grid k-formpanel__grid--3">
        <label className="k-formpanel__label">
          <span>Your shift *</span>
          <select className="k-formpanel__input" required value={form.requester_schedule_id}
            disabled={schedules.loading || !!schedules.error || noRoster}
            onChange={e => setForm({ ...form, requester_schedule_id: e.target.value })}>
            <option value="">
              {schedules.loading ? 'Loading…' : schedules.error ? 'Unavailable' : '— Select —'}
            </option>
            {(schedules.items || []).map(s => (
              <option key={s.id} value={s.id}>
                {s.date} · {s.shift_name}{s.employee_name ? ` · ${s.employee_name}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="k-formpanel__label">
          <span>Swap with *</span>
          <select className="k-formpanel__input" required value={form.target_employee_id}
            disabled={employees.loading || !!employees.error}
            onChange={e => setForm({ ...form, target_employee_id: e.target.value })}>
            <option value="">
              {employees.loading ? 'Loading…' : employees.error ? 'Unavailable' : '— Select —'}
            </option>
            {(employees.items || []).map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name}</option>
            ))}
          </select>
        </label>
        <label className="k-formpanel__label">
          <span>Reason</span>
          <input className="k-formpanel__input" value={form.reason}
            onChange={e => setForm({ ...form, reason: e.target.value })} />
        </label>
      </div>
      <div className="k-formpanel__actions">
        <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="k-btn k-btn--primary"
          disabled={saving || !!employees.error || !!schedules.error || noRoster}>
          {saving ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </form>
  );
}
