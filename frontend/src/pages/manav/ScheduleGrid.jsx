// Manav → Shifts → Schedules. Roster assignment and coverage.
//
// ── The Coverage button did nothing, and could not have ──────────────────────
//
// `loadCoverage()` read `r.data.data || r.data || []`, but
// `GET /v1/manav/schedules/coverage` answers `{ coverage: [...],
// total_employees: N }` — there is no `data` key. So `r.data.data` was
// undefined, the `||` fell through to `r.data`, and `coverage` state became the
// ENVELOPE OBJECT rather than an array. The panel then rendered on
// `coverage.length > 0`, and an object has no `length`, so the condition was
// `undefined > 0` — false, always. Pressing Coverage fetched successfully and
// displayed nothing, with no error to explain it.
//
// This is precisely the unwrapping hazard `lib/api`'s `rows()` exists to end,
// and precisely the case where `rows()` alone is NOT the answer: the key is
// `coverage`, not `data`, and `total_employees` sits beside it and is worth
// showing. So this one call site keeps the whole body deliberately, the same
// way the attendance summary keeps its `month`.
//
// `loadDropdowns()` was also a bare `catch {}` covering BOTH selects at once,
// so a failure left the assign form with two empty dropdowns and no reason.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Empty, DataTable, Td } from '../../components/editorial';
import { Badge, useList, useResource, ErrorNote, Shim, errText, today } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import DateInput from '../../components/ui/DateInput';

export default function ScheduleGrid({ pushToast }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [range, setRange] = useState(null);      // null until Load is pressed
  const [showForm, setShowForm] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ employee_id: '', shift_id: '', date: today() });

  const employees = useList('/v1/manav/employees');
  const shifts = useList('/v1/manav/shifts');

  const schedUrl = range
    ? `/v1/manav/schedules?date_from=${range.from}&date_to=${range.to}`
    : null;
  const schedules = useList(schedUrl || '/v1/manav/schedules?date_from=&date_to=', [schedUrl]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/schedules', form);
      pushToast({ title: 'Shift assigned', type: 'success' });
      setShowForm(false);
      setForm({ employee_id: '', shift_id: '', date: today() });
      if (range) schedules.reload(); else setRange({ from: dateFrom, to: dateTo });
    } catch (err) {
      pushToast({ title: errText(err, 'The shift could not be assigned.'), type: 'error' });
    } finally { setSaving(false); }
  }

  const blocked = !!employees.error || !!shifts.error;

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
        <button type="button" className="k-btn k-btn--ghost"
          onClick={() => { setRange({ from: dateFrom, to: dateTo }); setShowCoverage(false); }}>
          Load
        </button>
        <button type="button" className="k-btn k-btn--ghost"
          onClick={() => { setRange({ from: dateFrom, to: dateTo }); setShowCoverage(true); }}>
          Coverage
        </button>
        <div className="mn-bar__gap" />
        <button type="button" className="k-btn k-btn--primary" onClick={() => setShowForm(true)}
          disabled={!canWrite} title={denial || undefined}>
          + Assign shift
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="k-formpanel">
          <h3 className="k-section__title">Assign shift</h3>

          {employees.error && (
            <ErrorNote what="The employee list" error={employees.error} onRetry={employees.reload} />
          )}
          {shifts.error && (
            <ErrorNote what="Shift definitions" error={shifts.error} onRetry={shifts.reload} />
          )}
          {!shifts.loading && !shifts.error && shifts.items.length === 0 && (
            <p className="note note--warn">
              <b>No shifts are defined.</b> A schedule assigns a shift, so create
              one under Definitions first.
            </p>
          )}

          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">
              <span>Employee *</span>
              <select className="k-formpanel__input" required value={form.employee_id}
                disabled={employees.loading || !!employees.error}
                onChange={e => setForm({ ...form, employee_id: e.target.value })}>
                <option value="">
                  {employees.loading ? 'Loading…' : employees.error ? 'Unavailable' : '— Select —'}
                </option>
                {(employees.items || []).map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>Shift *</span>
              <select className="k-formpanel__input" required value={form.shift_id}
                disabled={shifts.loading || !!shifts.error}
                onChange={e => setForm({ ...form, shift_id: e.target.value })}>
                <option value="">
                  {shifts.loading ? 'Loading…' : shifts.error ? 'Unavailable' : '— Select —'}
                </option>
                {(shifts.items || []).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="k-formpanel__label">
              <span>Date *</span>
              <DateInput className="k-formpanel__input" type="date" required value={form.date}
                onChange={e => setForm({ ...form, date: e.target.value })} />
            </label>
          </div>
          <div className="k-formpanel__actions">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving || blocked || !canWrite} title={denial || undefined}>
              {saving ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </form>
      )}

      {showCoverage && range && (
        <Coverage range={range} onClose={() => setShowCoverage(false)} />
      )}

      {!range ? (
        <Empty
          icon="📅"
          title="Pick a date range"
          sub="Choose dates above and press Load to see who is rostered."
        />
      ) : schedules.loading ? <Shim count={5} />
        : schedules.error ? (
          <ErrorNote what="The roster" error={schedules.error} onRetry={schedules.reload} />
        ) : schedules.items.length === 0 ? (
          <Empty
            icon="📅"
            title="Nobody is rostered in this range"
            sub={`No shift assignments exist between ${range.from} and ${range.to}.`}
          />
        ) : (
          <DataTable columns={['Date', 'Employee', 'Shift', 'Start', 'End']}>
            {schedules.items.map(s => (
              <tr key={s.id}>
                <Td className="mn-t__mono">{s.date}</Td>
                <Td bold>{s.employee_name}</Td>
                <Td><Badge text={s.shift_name} color={s.color || 'var(--st-in-progress)'} /></Td>
                <Td className="mn-t__mono">{s.start_time}</Td>
                <Td className="mn-t__mono">{s.end_time}</Td>
              </tr>
            ))}
          </DataTable>
        )}
    </div>
  );
}

/**
 * Coverage. Keeps the whole envelope — the key is `coverage`, not `data`, and
 * `total_employees` sits beside it and is the only thing that makes a headcount
 * per shift mean anything.
 */
function Coverage({ range, onClose }) {
  const url = `/v1/manav/schedules/coverage?date_from=${range.from}&date_to=${range.to}`;
  const res = useResource(url, [url]);

  const rows = res.data?.coverage || [];
  const total = res.data?.total_employees;

  return (
    <section className="k-formpanel">
      <div className="mn-head">
        <h4 className="k-section__title">
          Coverage<Secondary className="k-section__title-hi" value="आवरण" />
        </h4>
        <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>Close</button>
      </div>

      {res.loading ? <Shim count={3} />
        : res.error ? <ErrorNote what="Coverage" error={res.error} onRetry={res.reload} />
          : rows.length === 0 ? (
            <p className="note note--info">
              <b>Nothing is rostered in this range.</b> There are no assignments
              between {range.from} and {range.to} to count.
            </p>
          ) : (
            <>
              {total != null && (
                <p className="mn-pii__note">
                  {total} active employee{Number(total) === 1 ? '' : 's'} in the
                  organisation. A shift covered by fewer than expected is a gap
                  to fill — post it under Bids.
                </p>
              )}
              <DataTable columns={[
                'Date', 'Shift',
                { label: 'Assigned', align: 'right' },
              ]}>
                {rows.map((c, i) => (
                  <tr key={`${c.date}-${c.shift_id || i}`}>
                    <Td className="mn-t__mono">{c.date}</Td>
                    <Td>{c.shift_name}</Td>
                    <Td align="right" mono bold>{c.assigned_count}</Td>
                  </tr>
                ))}
              </DataTable>
            </>
          )}
    </section>
  );
}
