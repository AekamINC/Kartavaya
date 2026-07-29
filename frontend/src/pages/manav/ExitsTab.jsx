// Manav → Exits.
//
// Offboarding and the exit interview, in one place, because they are one
// process: someone resigns, hands things back, is interviewed, is settled, and
// only then leaves the register.
//
// ── What this replaces ───────────────────────────────────────────────────────
// Nothing. Offboarding was a single `DELETE /employees/{id}` that set
// `is_active=FALSE` and `status='terminated'`. There was no record of why
// anyone left, when, what they owed or what they had to hand back — and because
// payroll selects structures joined on `e.is_active=TRUE`, an employee marked
// inactive dropped out of payroll immediately, so an outstanding salary advance
// was never recovered.
//
// ── The one rule the screen is built around ──────────────────────────────────
// **Deactivation is the LAST step, not the first.** Starting an exit does not
// remove anyone from the register; `Complete exit` does. Someone serving notice
// is still an employee — still paid, still accruing leave, still repaying an
// advance — and the whole defect above came from conflating "has resigned" with
// "has gone".
import React, { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useList, ErrorNote, Shim, errText } from './_shared';

const EXIT_TYPES = [
  ['resignation', 'Resignation'],
  ['termination', 'Termination'],
  ['retirement', 'Retirement'],
  ['end_of_contract', 'End of contract'],
  ['redundancy', 'Redundancy'],
  ['abandonment', 'Abandonment'],
  ['death', 'Death in service'],
];

// The reasons an attrition report is actually built from. Kept identical to the
// CHECK constraint in migration 083 — if the two drift, the server rejects what
// this offers, which is the worst kind of form.
const EXIT_REASONS = [
  ['compensation', 'Compensation'],
  ['career_growth', 'Career growth'],
  ['management', 'Management'],
  ['work_life_balance', 'Work–life balance'],
  ['relocation', 'Relocation'],
  ['role_mismatch', 'Role mismatch'],
  ['culture', 'Culture'],
  ['health', 'Health'],
  ['higher_studies', 'Higher studies'],
  ['better_offer', 'Better offer'],
  ['personal', 'Personal'],
  ['other', 'Other'],
];

const STATUS_COLOR = {
  initiated: 'var(--st-todo)',
  in_clearance: 'var(--st-in-progress)',
  interview_done: 'var(--st-in-review)',
  settled: 'var(--st-in-review)',
  completed: 'var(--ok)',
  cancelled: 'var(--on-surface-3)',
};

const BLANK_EXIT = {
  employee_id: '', exit_type: 'resignation', reason: '',
  resignation_date: '', last_working_day: '', notice_period_days: 30,
  notice_waived: false, rehire_eligible: null, notes: '',
};

const BLANK_INTERVIEW = {
  primary_reason: '', overall_rating: '', would_recommend: null,
  would_return: null, notes: '',
};

/** Clearance as an array whatever arrived — see the jsonb note in `db.py`. */
function asClearance(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

export default function ExitsTab() {
  const { pushToast } = useToast();
  const exits = useList('/v1/manav/offboarding');
  const employees = useList('/v1/manav/employees');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK_EXIT });
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [interviewFor, setInterviewFor] = useState(null);
  const [interview, setInterview] = useState({ ...BLANK_INTERVIEW });

  const rows = exits.items || [];
  const staff = (employees.items || []).filter(e => e.is_active !== false);

  // Anyone already leaving must not be offered again — the server enforces one
  // live exit per employee, and offering a name that will 409 is a form that
  // knows better than it behaves.
  const leaving = useMemo(
    () => new Set(rows.filter(r => r.status !== 'cancelled').map(r => String(r.employee_id))),
    [rows],
  );
  const selectable = staff.filter(e => !leaving.has(String(e.id)));

  const counts = useMemo(() => {
    const c = { live: 0, completed: 0, interviews: 0 };
    for (const r of rows) {
      if (r.status === 'completed') c.completed += 1;
      else if (r.status !== 'cancelled') c.live += 1;
      if (Number(r.has_interview) > 0) c.interviews += 1;
    }
    return c;
  }, [rows]);

  async function startExit(e) {
    e.preventDefault();
    if (!form.employee_id) {
      pushToast({ title: 'Pick who is leaving', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      await api.post('/v1/manav/offboarding', form);
      pushToast({ title: 'Exit started', type: 'success' });
      setShowForm(false);
      setForm({ ...BLANK_EXIT });
      exits.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The exit could not be started.'), type: 'error' });
    } finally { setSaving(false); }
  }

  async function toggleClearance(row, idx) {
    const items = asClearance(row.clearance).map((c, i) =>
      i === idx ? { ...c, done: !c.done, done_at: !c.done ? new Date().toISOString() : null } : c);
    setBusy(row.id);
    try {
      await api.patch(`/v1/manav/offboarding/${row.id}`, { clearance: items, status: 'in_clearance' });
      exits.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'That item could not be updated.'), type: 'error' });
    } finally { setBusy(''); }
  }

  async function completeExit(row) {
    setBusy(row.id);
    try {
      await api.post(`/v1/manav/offboarding/${row.id}/complete`);
      pushToast({ title: `${row.employee_name} offboarded`, type: 'success' });
      exits.reload();
      employees.reload();
    } catch (err) {
      // The server refuses while clearance is outstanding and NAMES what is
      // left, so surface its message rather than a generic one.
      pushToast({ title: errText(err, 'The exit could not be completed.'), type: 'error' });
    } finally { setBusy(''); setConfirm(null); }
  }

  async function saveInterview(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/exit-interviews', {
        employee_id: interviewFor.employee_id,
        primary_reason: interview.primary_reason,
        overall_rating: interview.overall_rating ? Number(interview.overall_rating) : null,
        would_recommend: interview.would_recommend,
        would_return: interview.would_return,
        notes: interview.notes,
        responses: [],
      });
      pushToast({ title: 'Exit interview recorded', type: 'success' });
      setInterviewFor(null);
      setInterview({ ...BLANK_INTERVIEW });
      exits.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The interview could not be saved.'), type: 'error' });
    } finally { setSaving(false); }
  }

  if (exits.loading) return <Shim count={4} />;
  if (exits.error) return <ErrorNote what="Exits" error={exits.error} onRetry={exits.reload} />;

  return (
    <div className="mv-tab">
      <div className="gn-bar">
        <span className="mv-count">
          {counts.live} in progress · {counts.completed} completed · {counts.interviews} interviewed
        </span>
        <span className="gn-bar__sp" />
        <button type="button" className="btn btn--fill btn--sm"
          onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Close form' : '+ Start an exit'}
        </button>
      </div>

      {showForm && (
        <form className="gn-form gn-form--accent" onSubmit={startExit}>
          <h3 className="gn-form__t">Start an exit</h3>
          <p className="of__h">
            This records the exit and starts the clearance checklist. It does
            <strong> not</strong> remove anyone from the register — they stay on
            payroll, keep accruing leave and keep repaying any advance until you
            press <em>Complete exit</em>.
          </p>
          <div className="of">
            <label className="of__f">
              <span className="of__l">Who is leaving *</span>
              <select className="inp" value={form.employee_id}
                onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
                <option value="">Select…</option>
                {selectable.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.name}{e.employee_code ? ` · ${e.employee_code}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="of__f">
              <span className="of__l">Exit type</span>
              <select className="inp" value={form.exit_type}
                onChange={e => setForm(f => ({ ...f, exit_type: e.target.value }))}>
                {EXIT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="of__f">
              <span className="of__l">Resignation date</span>
              <input type="date" className="inp" value={form.resignation_date}
                onChange={e => setForm(f => ({ ...f, resignation_date: e.target.value }))} />
            </label>
            <label className="of__f">
              <span className="of__l">Last working day</span>
              <input type="date" className="inp" value={form.last_working_day}
                onChange={e => setForm(f => ({ ...f, last_working_day: e.target.value }))} />
            </label>
            <label className="of__f">
              <span className="of__l">Notice period (days)</span>
              <input type="number" min="0" className="inp" value={form.notice_period_days}
                onChange={e => setForm(f => ({ ...f, notice_period_days: Number(e.target.value) }))} />
            </label>
            <label className="of__f of__f--check">
              <input type="checkbox" checked={form.notice_waived}
                onChange={e => setForm(f => ({ ...f, notice_waived: e.target.checked }))} />
              <span>Notice waived or bought out</span>
            </label>
            <label className="of__f of__f--wide">
              <span className="of__l">Reason</span>
              <input className="inp" value={form.reason}
                placeholder="In their words, or yours"
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
            </label>
          </div>
          <div className="gn-form__acts">
            <button type="button" className="btn btn--ghost btn--sm"
              onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
              {saving ? 'Starting…' : 'Start exit'}
            </button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <Empty
          icon="🚪"
          title="Nobody is leaving"
          sub="When someone resigns, start their exit here. The clearance checklist, the interview and the final settlement all hang off this record."
        />
      ) : (
        <div className="tbl__wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Employee</th><th>Type</th><th>Last day</th>
                <th>Clearance</th><th>Interview</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const items = asClearance(r.clearance);
                const done = items.filter(c => c.done).length;
                const open = openId === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <tr className="tbl__row--click" onClick={() => setOpenId(open ? null : r.id)}>
                      <td>
                        <div className="gr__td--name">{r.employee_name}</div>
                        {r.employee_code && <div className="gr__ls">{r.employee_code}</div>}
                      </td>
                      <td className="gr__td--mute">
                        {(EXIT_TYPES.find(([v]) => v === r.exit_type) || [, r.exit_type])[1]}
                      </td>
                      <td className="gr__td--mute">{r.last_working_day || '—'}</td>
                      <td className="gr__td--mute">{items.length ? `${done}/${items.length}` : '—'}</td>
                      <td className="gr__td--mute">{Number(r.has_interview) > 0 ? 'Done' : '—'}</td>
                      <td>
                        <span className="tag" style={{ '--tag-c': STATUS_COLOR[r.status] }}>
                          {String(r.status).replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="gr__td--mute">{open ? '▾' : '▸'}</td>
                    </tr>

                    {open && (
                      <tr>
                        <td colSpan={7}>
                          <div className="mv-exit__panel">
                            {r.reason && <p className="of__h">“{r.reason}”</p>}
                            <p className="of__h">
                              Notice {r.notice_period_days} day{r.notice_period_days === 1 ? '' : 's'}
                              {r.notice_waived ? ' · waived' : ''}
                              {r.resignation_date ? ` · resigned ${r.resignation_date}` : ''}
                            </p>

                            <h4 className="dr__lbl">Clearance</h4>
                            {items.length === 0 ? (
                              <p className="of__h">No checklist on this exit.</p>
                            ) : (
                              <ul className="mv-exit__list">
                                {items.map((c, i) => (
                                  <li key={`${r.id}-${i}`}>
                                    <label className="of__f--check">
                                      <input type="checkbox" checked={!!c.done}
                                        disabled={busy === r.id || r.status === 'completed'}
                                        onChange={() => toggleClearance(r, i)} />
                                      <span>{c.item}</span>
                                      {c.owner && <span className="gr__ls"> · {c.owner}</span>}
                                    </label>
                                  </li>
                                ))}
                              </ul>
                            )}

                            <div className="gn-form__acts">
                              <button type="button" className="btn btn--out btn--sm"
                                disabled={r.status === 'completed'}
                                onClick={() => {
                                  setInterviewFor(r);
                                  setInterview({ ...BLANK_INTERVIEW });
                                }}>
                                {Number(r.has_interview) > 0 ? 'Edit exit interview' : 'Record exit interview'}
                              </button>
                              <button type="button" className="btn btn--fill btn--sm"
                                disabled={busy === r.id || r.status === 'completed'}
                                onClick={() => setConfirm({
                                  title: `Complete ${r.employee_name}’s exit?`,
                                  // Says exactly what completing does, because this is
                                  // the step that takes someone off payroll — and doing
                                  // that before the final settlement is what left
                                  // advances unrecovered in the first place.
                                  message:
                                    'This marks them inactive and removes them from payroll. '
                                    + 'Run their final settlement first if anything is still owed — '
                                    + 'an outstanding salary advance cannot be recovered once they '
                                    + 'are off the payroll.',
                                  confirmLabel: 'Complete exit',
                                  onConfirm: () => completeExit(r),
                                })}>
                                {r.status === 'completed' ? 'Completed' : 'Complete exit'}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {interviewFor && (
        <form className="gn-form gn-form--accent" onSubmit={saveInterview}>
          <h3 className="gn-form__t">Exit interview — {interviewFor.employee_name}</h3>
          <div className="of">
            <label className="of__f">
              <span className="of__l">Primary reason for leaving</span>
              <select className="inp" value={interview.primary_reason}
                onChange={e => setInterview(f => ({ ...f, primary_reason: e.target.value }))}>
                <option value="">Not stated</option>
                {EXIT_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="of__f">
              <span className="of__l">Overall experience</span>
              <select className="inp" value={interview.overall_rating}
                onChange={e => setInterview(f => ({ ...f, overall_rating: e.target.value }))}>
                <option value="">Not rated</option>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} / 5</option>)}
              </select>
            </label>
            <label className="of__f of__f--check">
              <input type="checkbox" checked={interview.would_recommend === true}
                onChange={e => setInterview(f => ({ ...f, would_recommend: e.target.checked }))} />
              <span>Would recommend us as an employer</span>
            </label>
            <label className="of__f of__f--check">
              <input type="checkbox" checked={interview.would_return === true}
                onChange={e => setInterview(f => ({ ...f, would_return: e.target.checked }))} />
              <span>Would consider returning</span>
            </label>
            <label className="of__f of__f--wide">
              <span className="of__l">Notes</span>
              <input className="inp" value={interview.notes}
                placeholder="What they said, in their words"
                onChange={e => setInterview(f => ({ ...f, notes: e.target.value }))} />
            </label>
          </div>
          <div className="gn-form__acts">
            <button type="button" className="btn btn--ghost btn--sm"
              onClick={() => setInterviewFor(null)}>Cancel</button>
            <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save interview'}
            </button>
          </div>
        </form>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
