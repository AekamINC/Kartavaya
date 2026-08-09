// Manav → Attendance. The daily ledger, the monthly summary, and the one
// sentence about what editing a row here actually does.
//
// ── What this tab now says out loud that it did not before ───────────────────
//
// ATTENDANCE IS A PAYROLL INPUT. `POST /v1/manav/attendance` upserts straight
// into `staging.manav_attendance` with `marked_by='manual'`, and that is the
// exact table Vetana's payroll run prices. Marking someone absent here is not
// a note in a register — it is a decision about what they are paid. Nothing on
// this screen said so.
//
// The `marked_by='manual'` flag is also load-bearing in the other direction.
// `POST /v1/pahchan/attendance/publish` pairs biometric punches with approved
// corrections and upserts the same rows, but its `DO UPDATE` carries a WHERE
// that refuses to overwrite a manual row — so a value typed here WINS over the
// device, permanently, until someone edits it here again. That is the correct
// behaviour and it is invisible, so the panel states it.
//
// ── The defect ───────────────────────────────────────────────────────────────
//
// Both `load()` and `loadSummary()` were `catch { toast }` over state that
// stayed `[]`, and the render branched on `records.length === 0` to print
// "No attendance records — no records found for this date range". A failed
// fetch therefore asserted that nobody attended, on the screen that decides
// pay. `loadEmployees()` was a bare `catch {}`, so the Mark form could open
// with a silently empty employee list and no explanation.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty, DataTable, Td } from '../../components/editorial';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import {
  Badge, ATT_STATUSES, ATT_COLORS,
  useList, useResource, ErrorNote, Shim, errText, clockTime, today,
} from './_shared';
import DateInput from '../../components/ui/DateInput';

// `onUpdate` refreshes the KPI strip on ManavPage. Without it the list
// below updates and the headline figure above does not — measured live:
// approving a leave flipped the row to "approved" while the strip still
// read "5 awaiting approval", and only a reload corrected it to 4.
// EmployeesTab already took this prop, which is why the employee count was
// the one figure that stayed right.
export default function AttendanceTab({ onUpdate }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const { pushToast } = useToast();
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  // The applied range. Typing in a date box must not fire a request per
  // keystroke — a half-typed year is a range query for the year 202.
  const [range, setRange] = useState({ from: today(), to: today() });
  const [view, setView] = useState('daily');
  const [showMark, setShowMark] = useState(false);

  const listUrl = `/v1/manav/attendance?date_from=${range.from}&date_to=${range.to}`;
  const records = useList(listUrl, [listUrl]);

  return (
    <div>
      <div className="mn-bar">
        <label className="mn-field">
          <span className="mn-field__l">From</span>
          <DateInput className="k-input mn-f" type="date" value={dateFrom}
            onChange={e => setDateFrom(e.target.value)} />
        </label>
        <label className="mn-field">
          <span className="mn-field__l">To</span>
          <DateInput className="k-input mn-f" type="date" value={dateTo}
            onChange={e => setDateTo(e.target.value)} />
        </label>
        <button
          type="button"
          className="k-btn k-btn--ghost"
          onClick={() => { setRange({ from: dateFrom, to: dateTo }); setView('daily'); }}
        >
          View
        </button>
        <button
          type="button"
          className={`k-btn k-btn--ghost${view === 'summary' ? ' on' : ''}`}
          onClick={() => setView('summary')}
        >
          Monthly summary
        </button>
        <div className="mn-bar__gap" />
        <button type="button" className="k-btn k-btn--primary" onClick={() => setShowMark(true)}
          disabled={!canWrite} title={denial || undefined}>
          Mark attendance
        </button>
      </div>

      <p className="note note--info mn-bridge">
        <b>This ledger is what payroll is priced from.</b> Vetana reads these
        rows directly, so a status changed here changes what that person is
        paid for that day. A row marked by hand also outranks the biometric
        device permanently — the Pahchan publish will not overwrite it.
      </p>

      {showMark && (
        <MarkForm
          onClose={() => setShowMark(false)}
          onMarked={() => { setShowMark(false); records.reload(); onUpdate?.(); }}
          pushToast={pushToast}
        />
      )}

      {view === 'summary'
        ? <MonthlySummary month={range.from.substring(0, 7)} />
        : records.loading ? <Shim count={6} />
          : records.error ? <ErrorNote what="The attendance ledger" error={records.error} onRetry={records.reload} />
            : records.items.length === 0 ? (
              <Empty
                icon="📊"
                title="No attendance in this range"
                sub={`Nothing is recorded between ${range.from} and ${range.to}. Widen the dates, or mark attendance for a day.`}
              />
            ) : (
              <DataTable columns={['Date', 'Employee', 'Status', 'Check in', 'Check out', { label: 'Hours', align: 'right' }, 'Marked by']}>
                {records.items.map(r => (
                  <tr key={r.id}>
                    <Td className="mn-t__mono">{r.date}</Td>
                    <Td bold>
                      {r.employee_name}{' '}
                      <span className="mn-t__mute mn-t__mono">({r.employee_code || '—'})</span>
                    </Td>
                    <Td><Badge text={r.status} color={ATT_COLORS[r.status] || 'var(--on-surface-3)'} /></Td>
                    <Td className="mn-t__mono">{clockTime(r.check_in)}</Td>
                    <Td className="mn-t__mono">{clockTime(r.check_out)}</Td>
                    <Td align="right" mono>{r.work_hours != null ? `${Number(r.work_hours).toFixed(1)}h` : '—'}</Td>
                    <Td className="mn-t__mute">{r.marked_by}</Td>
                  </tr>
                ))}
              </DataTable>
            )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Marking a day
   ══════════════════════════════════════════════════════════════════════════ */

function MarkForm({ onClose, onMarked, pushToast }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const employees = useList('/v1/manav/employees');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employee_id: '', date: today(), status: 'present',
    check_in: '', check_out: '', notes: '',
  });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/attendance', form);
      pushToast({ title: 'Attendance marked', type: 'success' });
      onMarked();
    } catch (err) {
      pushToast({ title: errText(err, 'Attendance could not be marked.'), type: 'error' });
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="k-formpanel">
      <h3 className="k-section__title">Mark attendance</h3>

      {/* The employee list failing is not the same as there being no
          employees, and the form must not silently offer an empty select. */}
      {employees.error && (
        <ErrorNote what="The employee list" error={employees.error} onRetry={employees.reload} />
      )}

      <div className="k-formpanel__grid k-formpanel__grid--3">
        <label className="k-formpanel__label">
          <span>Employee *</span>
          <select
            className="k-formpanel__input"
            required
            value={form.employee_id}
            disabled={employees.loading || !!employees.error}
            onChange={e => setForm({ ...form, employee_id: e.target.value })}
          >
            <option value="">
              {employees.loading ? 'Loading…' : employees.error ? 'Unavailable' : 'Select…'}
            </option>
            {(employees.items || []).map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code || '—'})</option>
            ))}
          </select>
        </label>
        <label className="k-formpanel__label">
          <span>Date</span>
          <DateInput className="k-formpanel__input" type="date" value={form.date}
            onChange={e => setForm({ ...form, date: e.target.value })} />
        </label>
        <label className="k-formpanel__label">
          <span>Status</span>
          <select className="k-formpanel__input" value={form.status}
            onChange={e => setForm({ ...form, status: e.target.value })}>
            {ATT_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label className="k-formpanel__label">
          <span>Check in</span>
          <DateInput className="k-formpanel__input" type="datetime-local" value={form.check_in}
            onChange={e => setForm({ ...form, check_in: e.target.value })} />
        </label>
        <label className="k-formpanel__label">
          <span>Check out</span>
          <DateInput className="k-formpanel__input" type="datetime-local" value={form.check_out}
            onChange={e => setForm({ ...form, check_out: e.target.value })} />
        </label>
        <label className="k-formpanel__label">
          <span>Notes</span>
          <input className="k-formpanel__input" value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })} />
        </label>
      </div>

      <p className="note note--warn">
        <b>This writes to the row payroll reads.</b> Work hours are computed
        from check-in and check-out when both are given. The row is marked as
        entered by hand, which stops the biometric bridge from ever replacing it.
      </p>

      <div className="k-formpanel__actions">
        <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="k-btn k-btn--primary" disabled={saving || !!employees.error || !canWrite} title={denial || undefined}>
          {saving ? 'Marking…' : 'Mark'}
        </button>
      </div>
    </form>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The month
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `/v1/manav/attendance/summary` answers `{ data: [...], month: "YYYY-MM" }`.
 *
 * That envelope carries `month` alongside the rows, so this call site keeps the
 * whole body rather than unwrapping to the array — the heading prints the month
 * the SERVER resolved, not the one this component asked for, and those differ
 * whenever the query is malformed or clamped.
 */
function MonthlySummary({ month }) {
  const res = useResource(`/v1/manav/attendance/summary?month=${month}`, [month]);

  if (res.loading) return <Shim count={6} />;
  if (res.error) return <ErrorNote what="The monthly summary" error={res.error} onRetry={res.reload} />;

  const data = res.data?.data || [];

  return (
    <section className="k-section">
      <div className="k-section__head">
        <h3 className="k-section__title">
          Monthly summary
          <Secondary className="k-section__title-hi" value="मासिक सारांश" />
        </h3>
        <span className="mn-bar__lbl mn-t__mono">{res.data?.month || month}</span>
      </div>

      {data.length === 0 ? (
        <Empty
          icon="📊"
          title="Nothing recorded this month"
          sub="No attendance rows exist for this month yet, so there is nothing to total."
        />
      ) : (
        <DataTable columns={[
          'Code', 'Name',
          { label: 'Present', align: 'right' },
          { label: 'Absent', align: 'right' },
          { label: 'Half day', align: 'right' },
          { label: 'Late', align: 'right' },
          { label: 'Leave', align: 'right' },
          { label: 'Hours', align: 'right' },
          { label: 'Overtime', align: 'right' },
        ]}>
          {data.map(r => (
            <tr key={r.id}>
              <Td className="mn-t__mono">{r.employee_code || '—'}</Td>
              <Td bold>{r.name}</Td>
              <Td align="right" mono><span className="mn-t__n" style={{ '--c': 'var(--ok)' }}>{r.present_days}</span></Td>
              <Td align="right" mono><span className="mn-t__n" style={{ '--c': 'var(--danger)' }}>{r.absent_days}</span></Td>
              <Td align="right" mono>{r.half_days}</Td>
              <Td align="right" mono><span className="mn-t__n" style={{ '--c': 'var(--tertiary)' }}>{r.late_days}</span></Td>
              <Td align="right" mono><span className="mn-t__n" style={{ '--c': 'var(--st-in-progress)' }}>{r.leave_days}</span></Td>
              <Td align="right" mono>{Number(r.total_hours || 0).toFixed(1)}</Td>
              <Td align="right" mono>{Number(r.overtime_hours || 0).toFixed(1)}</Td>
            </tr>
          ))}
        </DataTable>
      )}
    </section>
  );
}
