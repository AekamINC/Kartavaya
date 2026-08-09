// Manav → Leave. Requests to action, leave types, and the clash check.
//
// ── The conflict checker was wired to an endpoint that does not exist ────────
//
// This is the find of this tab, and it had never worked once. `checkConflicts`
// called `/v1/manav/leaves/check-conflicts?start_date=…&end_date=…&department=…`
// while the route's signature is `(employee_id, start_date, end_date)` with
// `employee_id` REQUIRED and no `department` parameter at all. FastAPI answers
// a missing required query param with 422 before the handler runs, so every
// press of "Check" produced a toast reading "Failed to check" and nothing else,
// forever.
//
// Had it returned 200 the panel would still have rendered blank, because every
// field it read is misnamed. The route answers
// `{ conflicts, conflict_count, department, department_size, on_leave_count,
//    exceeds_threshold }` and the panel read `overlap_count`,
// `overlap_percentage`, `has_conflict` and `overlapping_leaves` — four names,
// none of which the server has ever sent. It also printed `ol.leave_type`,
// which the query does not select either.
//
// Rebuilt against the real contract: the employee is now chosen (it has to be —
// the department the check runs over is derived from that employee's own), the
// percentage is computed here from the two counts the server does send, and the
// 30% threshold is read from `exceeds_threshold` rather than recomputed, so
// this panel and the server cannot disagree about what "too many" means.
//
// ── And the usual defect ─────────────────────────────────────────────────────
//
// `load()` caught to a toast over a list left at `[]`, so a failed fetch
// rendered "No leave requests — requests from employees will appear here for
// approval". `loadTypes()` and `loadEmployees()` were bare `catch {}`.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import {
  Badge, LEAVE_COLORS, useList, ErrorNote, Shim, errText,
} from './_shared';
import DateInput from '../../components/ui/DateInput';

// `onUpdate` refreshes the KPI strip on ManavPage. Without it the list
// below updates and the headline figure above does not — measured live:
// approving a leave flipped the row to "approved" while the strip still
// read "5 awaiting approval", and only a reload corrected it to 4.
// EmployeesTab already took this prop, which is why the employee count was
// the one figure that stayed right.
export default function LeavesTab({ onUpdate }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const { pushToast } = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [panel, setPanel] = useState(null);   // 'request' | 'type' | 'conflict' | null
  const [acting, setActing] = useState('');

  const url = `/v1/manav/leaves${statusFilter ? `?status=${statusFilter}` : ''}`;
  const leaves = useList(url, [url]);
  const types = useList('/v1/manav/leave-types');
  const employees = useList('/v1/manav/employees');

  async function actionLeave(leaveId, status) {
    setActing(leaveId + status);
    try {
      await api.patch(`/v1/manav/leaves/${leaveId}/action`, { status });
      pushToast({ title: `Leave ${status}`, type: 'success' });
      leaves.reload();
      leaves.reload();
      onUpdate?.();
    } catch (err) {
      pushToast({ title: errText(err, 'The decision could not be recorded.'), type: 'error' });
    } finally { setActing(''); }
  }

  return (
    <div>
      <div className="mn-bar">
        <label className="mn-field">
          <span className="mn-field__l">Status</span>
          <select className="k-input mn-f--sm" value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {['pending', 'approved', 'rejected', 'cancelled'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <div className="mn-bar__gap" />
        <button type="button" className="k-btn k-btn--ghost"
          onClick={() => setPanel(panel === 'conflict' ? null : 'conflict')}>
          Check clashes
        </button>
        <button type="button" className="k-btn k-btn--ghost"
          onClick={() => setPanel(panel === 'type' ? null : 'type')}>
          + Leave type
        </button>
        <button type="button" className="k-btn k-btn--primary"
          onClick={() => setPanel(panel === 'request' ? null : 'request')}
          disabled={!canWrite} title={denial || undefined}>
          + Request leave
        </button>
      </div>

      {panel === 'conflict' && (
        <ConflictCheck employees={employees} onClose={() => setPanel(null)} />
      )}

      {panel === 'type' && (
        <LeaveTypeForm
          onClose={() => setPanel(null)}
          onCreated={() => { setPanel(null); types.reload(); }}
          pushToast={pushToast}
        />
      )}

      {panel === 'request' && (
        <RequestForm
          employees={employees}
          types={types}
          onClose={() => setPanel(null)}
          onCreated={() => { setPanel(null); leaves.reload(); onUpdate?.(); }}
          pushToast={pushToast}
        />
      )}

      {leaves.loading ? <Shim count={4} />
        : leaves.error ? <ErrorNote what="Leave requests" error={leaves.error} onRetry={leaves.reload} />
          : leaves.items.length === 0 ? (
            <Empty
              icon="🏖️"
              title={statusFilter ? `No ${statusFilter} leave requests` : 'No leave requests'}
              sub={statusFilter
                ? 'Clear the status filter to see every request.'
                : 'Requests from employees appear here for approval.'}
            />
          ) : (
            <div className="mn-list">
              {leaves.items.map(lr => (
                <article key={lr.id} className="mn-rec">
                  <div className="mn-rec__top">
                    <div className="mn-rec__who">
                      <span className="mn-rec__name">{lr.employee_name}</span>
                      <span className="mn-rec__code">{lr.employee_code}</span>
                    </div>
                    <Badge text={lr.status} color={LEAVE_COLORS[lr.status] || 'var(--on-surface-3)'} />
                  </div>
                  <div className="mn-rec__body">
                    <strong>{lr.leave_type_name}</strong> ({lr.leave_type_code}) ·{' '}
                    {lr.start_date} → {lr.end_date} · {lr.days} day{Number(lr.days) === 1 ? '' : 's'}
                    {lr.reason && <> · {lr.reason}</>}
                    {lr.rejection_reason && (
                      <span className="mn-rec__rej"> · Rejected: {lr.rejection_reason}</span>
                    )}
                  </div>
                  {lr.status === 'pending' && (
                    <div className="mn-rec__act">
                      <button
                        type="button"
                        className="k-btn k-btn--primary k-btn--sm"
                        disabled={!!acting || !canWrite}
                        onClick={() => actionLeave(lr.id, 'approved')} title={denial || undefined}>
                        {acting === lr.id + 'approved' ? 'Approving…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        className="k-btn k-btn--ghost k-btn--sm k-btn--reject"
                        disabled={!!acting}
                        onClick={() => actionLeave(lr.id, 'rejected')}
                      >
                        {acting === lr.id + 'rejected' ? 'Rejecting…' : 'Reject'}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The clash check — rebuilt against the endpoint the server actually serves
   ══════════════════════════════════════════════════════════════════════════ */

function ConflictCheck({ employees, onClose }) {
  const [form, setForm] = useState({ employee_id: '', start_date: '', end_date: '' });
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });

  async function run(e) {
    e.preventDefault();
    setState({ status: 'loading', data: null, error: '' });
    const q = new URLSearchParams({
      employee_id: form.employee_id,
      start_date: form.start_date,
      end_date: form.end_date,
    });
    try {
      const r = await api.get(`/v1/manav/leaves/check-conflicts?${q}`);
      setState({ status: 'done', data: r.data, error: '' });
    } catch (err) {
      setState({ status: 'error', data: null, error: errText(err, 'The clash check could not run.') });
    }
  }

  const d = state.data;
  // The server sends the two counts; the percentage is derived here rather
  // than sent, and `exceeds_threshold` is the server's own verdict — this
  // panel never recomputes the 30% rule, so the two cannot drift apart.
  const pct = d && d.department_size > 0
    ? Math.round((d.on_leave_count / d.department_size) * 100)
    : null;

  return (
    <section className="k-formpanel">
      <div className="mn-head">
        <h4 className="k-section__title">
          Check clashes<Secondary className="k-section__title-hi" value="टकराव" />
        </h4>
        <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>Close</button>
      </div>

      <p className="mn-pii__note">
        Counts who else in the same department is already booked off across
        these dates. The department is the one that employee belongs to — which
        is why the check needs a person, not just a range.
      </p>

      {employees.error && (
        <ErrorNote what="The employee list" error={employees.error} onRetry={employees.reload} />
      )}

      <form onSubmit={run}>
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
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </label>
          <label className="k-formpanel__label">
            <span>Start *</span>
            <DateInput className="k-formpanel__input" type="date" required value={form.start_date}
              onChange={e => setForm({ ...form, start_date: e.target.value })} />
          </label>
          <label className="k-formpanel__label">
            <span>End *</span>
            <DateInput className="k-formpanel__input" type="date" required value={form.end_date}
              onChange={e => setForm({ ...form, end_date: e.target.value })} />
          </label>
        </div>
        <div className="k-formpanel__actions">
          <button type="submit" className="k-btn k-btn--primary" disabled={state.status === 'loading'}>
            {state.status === 'loading' ? 'Checking…' : 'Check'}
          </button>
        </div>
      </form>

      {state.status === 'error' && (
        <p className="note note--warn" role="status">
          <b>The clash check did not run.</b> {state.error}
        </p>
      )}

      {state.status === 'done' && d && (
        <div>
          <div className="mn-conf__row">
            <span>
              <strong>{d.on_leave_count}</strong> of <strong>{d.department_size}</strong> in{' '}
              <strong>{d.department || 'this department'}</strong> would be away
              {pct != null && <> ({pct}%)</>}
            </span>
            <Badge
              text={d.exceeds_threshold ? 'Over threshold' : 'Within threshold'}
              color={d.exceeds_threshold ? 'var(--danger)' : 'var(--ok)'}
            />
          </div>

          {d.exceeds_threshold && (
            <p className="note note--warn">
              <b>More than 30% of the department would be on leave.</b> The
              request can still be approved — this is a staffing warning, not a
              block.
            </p>
          )}

          {d.department_size === 0 && (
            <p className="note note--info">
              That employee has no department set, so there is no group to
              measure against. Set a department on their record for this check
              to mean anything.
            </p>
          )}

          {d.conflicts?.length > 0 && (
            <div className="mn-conf__list">
              {d.conflicts.map(c => (
                <div key={c.id} className="mn-conf__item">
                  {c.employee_name}{' '}
                  <span className="mn-rec__code">{c.employee_code}</span> —{' '}
                  {c.start_date} → {c.end_date} · {c.days} day
                  {Number(c.days) === 1 ? '' : 's'} · {c.status}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Forms
   ══════════════════════════════════════════════════════════════════════════ */

function LeaveTypeForm({ onClose, onCreated, pushToast }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', code: '', annual_quota: 12, is_paid: true, carry_forward: false,
  });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/leave-types', form);
      pushToast({ title: 'Leave type created', type: 'success' });
      onCreated();
    } catch (err) {
      pushToast({ title: errText(err, 'The leave type could not be created.'), type: 'error' });
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="k-formpanel">
      <h4 className="k-section__title">New leave type</h4>
      <div className="k-formpanel__grid k-formpanel__grid--3">
        <label className="k-formpanel__label">
          <span>Name *</span>
          <input className="k-formpanel__input" required value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="k-formpanel__label">
          <span>Code *</span>
          <input className="k-formpanel__input" required placeholder="e.g. CL, SL, EL" value={form.code}
            onChange={e => setForm({ ...form, code: e.target.value })} />
        </label>
        <label className="k-formpanel__label">
          <span>Annual quota</span>
          <input className="k-formpanel__input" type="number" min="0" value={form.annual_quota}
            onChange={e => setForm({ ...form, annual_quota: parseInt(e.target.value, 10) || 0 })} />
        </label>
        <label className="k-formpanel__label mn-check">
          <input type="checkbox" checked={form.is_paid}
            onChange={e => setForm({ ...form, is_paid: e.target.checked })} />
          <span>Paid leave</span>
        </label>
        <label className="k-formpanel__label mn-check">
          <input type="checkbox" checked={form.carry_forward}
            onChange={e => setForm({ ...form, carry_forward: e.target.checked })} />
          <span>Carries forward</span>
        </label>
      </div>
      <div className="k-formpanel__actions">
        <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="k-btn k-btn--primary" disabled={saving || !canWrite} title={denial || undefined}>
          {saving ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  );
}

function RequestForm({ employees, types, onClose, onCreated, pushToast }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employee_id: '', leave_type_id: '', start_date: '', end_date: '', days: 1, reason: '',
  });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/leaves', form);
      pushToast({ title: 'Leave request submitted', type: 'success' });
      onCreated();
    } catch (err) {
      pushToast({ title: errText(err, 'The request could not be submitted.'), type: 'error' });
    } finally { setSaving(false); }
  }

  const blocked = !!employees.error || !!types.error;

  return (
    <form onSubmit={submit} className="k-formpanel">
      <h4 className="k-section__title">Request leave</h4>

      {employees.error && (
        <ErrorNote what="The employee list" error={employees.error} onRetry={employees.reload} />
      )}
      {types.error && (
        <ErrorNote what="Leave types" error={types.error} onRetry={types.reload} />
      )}
      {!types.loading && !types.error && types.items.length === 0 && (
        <p className="note note--warn">
          <b>No leave types are defined.</b> A request has to be against a type,
          so create one first with “+ Leave type”.
        </p>
      )}

      <div className="k-formpanel__grid k-formpanel__grid--2">
        <label className="k-formpanel__label">
          <span>Employee *</span>
          <select className="k-formpanel__input" required value={form.employee_id}
            disabled={employees.loading || !!employees.error}
            onChange={e => setForm({ ...form, employee_id: e.target.value })}>
            <option value="">
              {employees.loading ? 'Loading…' : employees.error ? 'Unavailable' : 'Select employee…'}
            </option>
            {(employees.items || []).map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>
            ))}
          </select>
        </label>
        <label className="k-formpanel__label">
          <span>Leave type *</span>
          <select className="k-formpanel__input" required value={form.leave_type_id}
            disabled={types.loading || !!types.error}
            onChange={e => setForm({ ...form, leave_type_id: e.target.value })}>
            <option value="">
              {types.loading ? 'Loading…' : types.error ? 'Unavailable' : 'Select…'}
            </option>
            {(types.items || []).map(lt => (
              <option key={lt.id} value={lt.id}>{lt.name} ({lt.code})</option>
            ))}
          </select>
        </label>
        <label className="k-formpanel__label">
          <span>Days</span>
          <input className="k-formpanel__input" type="number" step="0.5" min="0.5" value={form.days}
            onChange={e => setForm({ ...form, days: parseFloat(e.target.value) || 1 })} />
        </label>
        <label className="k-formpanel__label">
          <span>Start date *</span>
          <DateInput className="k-formpanel__input" type="date" required value={form.start_date}
            onChange={e => setForm({ ...form, start_date: e.target.value })} />
        </label>
        <label className="k-formpanel__label">
          <span>End date *</span>
          <DateInput className="k-formpanel__input" type="date" required value={form.end_date}
            onChange={e => setForm({ ...form, end_date: e.target.value })} />
        </label>
        <label className="k-formpanel__label mn-fw">
          <span>Reason</span>
          <textarea className="k-formpanel__input mn-ta" rows={2} value={form.reason}
            onChange={e => setForm({ ...form, reason: e.target.value })} />
        </label>
      </div>
      <div className="k-formpanel__actions">
        <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="k-btn k-btn--primary" disabled={saving || blocked || !canWrite} title={denial || undefined}>
          {saving ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </form>
  );
}
