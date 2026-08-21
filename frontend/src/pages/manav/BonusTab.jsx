// Manav → Bonus. Who may be given one, and what was actually given.
//
// ── Why bonus is its own tab and not a section of Commission ────────────────
//
// They arrive together in the payroll line and they are not the same kind of
// fact. A commission is arithmetic: a ladder, a scope, a period, and a figure
// that follows from revenue whether anybody looks at it or not. A bonus is a
// DECISION — migration 190: "nothing here is computed from turnover, gross
// profit, a threshold, a band, a department or a period figure, and no code may
// derive it." Filing the decision under the arithmetic is how, a year from now,
// somebody asks what rate produced a ₹40,000 bonus.
//
// The screens differ too. Commission is one arrangement per person, revised
// rarely, read as history. Bonus is a list of individual awards with reasons,
// added often, read by payroll month. And there is a hard ordering between
// them: an award is REFUSED unless the person has been marked eligible first,
// so the eligibility control has to be on the same screen as the award or the
// refusal is a dead end.
//
// ── ONE THING THIS SCREEN CANNOT DO, STATED RATHER THAN HIDDEN ──────────────
//
// `manav_employees.bonus_eligible` is WRITE-ONLY from the browser. It is set by
// `PUT /employees/{id}/bonus-eligibility`, and it is returned by NO read
// endpoint — not `GET /employees`, not `GET /employees/{id}` (it is absent from
// `_EMP_SAFE_COLS`), not anywhere. Verified against routers/manav.py.
//
// So this screen cannot show who is currently eligible, and it does not
// pretend to. The control is worded as an ACTION ("Record that they may be
// given a bonus") rather than as a state, the answer the server returns from
// the PUT is shown back verbatim, and the limitation is written on the screen.
// Guessing — showing every unrecorded person as "not eligible" — would be the
// same fault as printing ₹0 for somebody nobody has measured.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty, DataTable, Td, Section } from '../../components/editorial';
import useModuleWrite from '../../hooks/useModuleWrite';
import { useList, ErrorNote, Shim, errText, FMT, thisMonth } from './_shared';

/** Nobody has awarded this person a bonus. NOT a ₹0 bonus. */
const NO_BONUS = 'no bonus awarded';

/** `2026-08` → `August 2026`. */
export function monthLabel(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period || '');
  if (!m) return period || '—';
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const idx = Number(m[2]) - 1;
  return names[idx] ? `${names[idx]} ${m[1]}` : period;
}

/**
 * The payroll months this screen offers, newest first.
 *
 * A `<select>`, not `<input type="month">`: the native month control is the
 * same browser-drawn widget the date rule bans, and the value here has to match
 * `vetana_payroll_runs.month` EXACTLY — a typo does not fail, it files the
 * award against a month no payroll run will ever look at, and the person is
 * simply not paid.
 */
export function payrollMonths(from = new Date(), back = 18, forward = 2) {
  const out = [];
  for (let i = forward; i >= -back; i -= 1) {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Everything wrong with an award, as sentences. Empty means it would be sent. */
export function awardProblems(form) {
  const out = [];
  if (!form.employee_id) out.push('Choose the person this bonus is for.');
  const raw = String(form.amount ?? '').trim();
  const amount = raw === '' ? null : Number(raw);
  if (amount === null) {
    out.push('Enter the amount. There is no suggested figure — the person deciding types the number.');
  } else if (!Number.isFinite(amount)) {
    out.push('The amount is not a number.');
  } else if (amount <= 0) {
    out.push('A bonus must be above zero. A ₹0 bonus is an unfinished form, and a zero '
      + 'printed beside the word "Bonus" is a statement about a person that nobody made.');
  }
  if (!String(form.reason || '').trim()) {
    out.push('Say why. A discretionary payment with no stated reason cannot be audited, '
      + 'defended, or explained to the person who did not get one.');
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(form.pay_period || '')) {
    out.push('Choose the payroll month this is paid in.');
  }
  return out;
}

export default function BonusTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'award bonuses' });
  const [month, setMonth] = useState('');
  const awards = useList(
    `/v1/manav/bonus-awards${month ? `?pay_period=${month}` : ''}`,
    [month],
  );
  const [showForm, setShowForm] = useState(false);

  const rows = awards.items || [];
  const total = rows.reduce((s, a) => s + Number(a.amount || 0), 0);

  return (
    <div>
      <p className="note note--info mn-intro">
        <b>A bonus is a decision, not a calculation.</b> Nothing derives it — no turnover, no
        threshold, no rate, no department. An award records how much, why, which payroll
        month it is paid in, and who decided. A person has to be marked as eligible before
        one can be awarded to them, and that is deliberate: awarding a bonus should never be
        the moment somebody discovers the question.
      </p>

      <div className="mn-bar">
        <label className="mn-field">
          <span className="mn-field__l">Payroll month</span>
          <select
            className="k-input mn-f"
            value={month}
            onChange={e => setMonth(e.target.value)}
          >
            <option value="">Every month</option>
            {payrollMonths().map(m => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </label>
        <div className="mn-bar__gap" />
        <button
          type="button"
          className="k-btn k-btn--primary"
          disabled={!canWrite}
          title={denial || undefined}
          onClick={() => setShowForm(v => !v)}
        >
          {showForm ? 'Cancel' : '+ Award a bonus'}
        </button>
      </div>

      {showForm && (
        <AwardForm
          onCancel={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); awards.reload(); }}
        />
      )}

      {awards.loading ? <Shim count={4} />
        : awards.error ? (
          <ErrorNote what="Bonus awards" error={awards.error} onRetry={awards.reload} />
        ) : rows.length === 0 ? (
          <Empty
            icon="🎁"
            title={month ? `${NO_BONUS} for ${monthLabel(month)}` : NO_BONUS}
            sub={month
              ? 'Nobody was awarded a bonus in this payroll month. That is not the same as '
                + 'everybody being awarded nothing — no decision was recorded.'
              : 'No bonus has been awarded. Awards are discretionary, so an empty register '
                + 'means nobody has decided to give one, not that the amounts came to zero.'}
          />
        ) : (
          <>
            <DataTable
              columns={['Person', { label: 'Amount', align: 'right' }, 'Why', 'Paid in', 'Decided']}
            >
              {rows.map(a => (
                <tr key={a.id}>
                  <Td bold>{a.employee_name}</Td>
                  <Td align="right" mono>{FMT(a.amount)}</Td>
                  <Td>{a.reason}</Td>
                  <Td>{monthLabel(a.pay_period)}</Td>
                  <Td className="mn-t__mute">{String(a.awarded_at || '').slice(0, 10) || '—'}</Td>
                </tr>
              ))}
            </DataTable>
            <p className="mn-count mn-grp__sub">
              {rows.length} {rows.length === 1 ? 'award' : 'awards'}
              {month ? ` in ${monthLabel(month)}` : ' on record'}, {FMT(total)} in total.
              An award reaches pay as a line on the payslip for its payroll month, so
              re-running that month produces the same payslip rather than paying twice.
            </p>
          </>
        )}

      <EligibilityPanel />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Awarding one
   ══════════════════════════════════════════════════════════════════════════ */

function AwardForm({ onCancel, onSaved }) {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'award bonuses' });
  const { pushToast } = useToast();
  const employees = useList('/v1/manav/employees');
  // NO DEFAULT AMOUNT and no default reason. The payroll month defaults to the
  // current one, which is a calendar fact rather than a decision about money.
  const [form, setForm] = useState({
    employee_id: '', amount: '', reason: '', pay_period: thisMonth(), notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [refusal, setRefusal] = useState('');

  const problems = awardProblems(form);
  const set = patch => setForm(f => ({ ...f, ...patch }));

  async function submit(e) {
    e.preventDefault();
    if (problems.length > 0) { setShowProblems(true); return; }
    setSaving(true);
    setRefusal('');
    try {
      await api.post('/v1/manav/bonus-awards', {
        employee_id: form.employee_id,
        // The API asks for a number and this screen does not round somebody's
        // bonus on its way past.
        amount: Number(String(form.amount).trim()),
        reason: form.reason.trim(),
        pay_period: form.pay_period,
        notes: form.notes || '',
      });
      pushToast({ title: 'Bonus awarded', type: 'success' });
      onSaved();
    } catch (err) {
      // The eligibility refusal (409) is the expected one and the server's
      // wording explains it properly. It is shown whole, with the way out
      // beside it, because this screen cannot tell in advance who is eligible.
      setRefusal(errText(err, 'The bonus could not be awarded.'));
    } finally { setSaving(false); }
  }

  const chosen = (employees.items || []).find(e => e.id === form.employee_id);

  return (
    <form onSubmit={submit} className="k-formpanel">
      <h3 className="k-section__title">Award a bonus</h3>

      {employees.error && (
        <ErrorNote what="The employee list" error={employees.error} onRetry={employees.reload} />
      )}

      <div className="k-formpanel__grid k-formpanel__grid--3">
        <label className="k-formpanel__label">
          <span>Person</span>
          <select
            className="k-formpanel__input"
            value={form.employee_id}
            disabled={employees.loading || !!employees.error}
            onChange={e => set({ employee_id: e.target.value })}
          >
            <option value="">{employees.loading ? 'Loading…' : 'Select…'}</option>
            {(employees.items || []).map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>

        <label className="k-formpanel__label">
          <span>Amount (₹)</span>
          {/* No placeholder and no default. Nothing on this screen suggests
              what a bonus should be. */}
          <input
            className="k-formpanel__input"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={form.amount}
            onChange={e => set({ amount: e.target.value })}
          />
        </label>

        <label className="k-formpanel__label">
          <span>Paid in payroll month</span>
          <select
            className="k-formpanel__input"
            value={form.pay_period}
            onChange={e => set({ pay_period: e.target.value })}
          >
            {payrollMonths().map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>

        <label className="k-formpanel__label mn-fw">
          <span>Why</span>
          <input
            className="k-formpanel__input"
            value={form.reason}
            onChange={e => set({ reason: e.target.value })}
          />
        </label>

        <label className="k-formpanel__label mn-fw">
          <span>Notes</span>
          <input
            className="k-formpanel__input"
            value={form.notes}
            onChange={e => set({ notes: e.target.value })}
          />
        </label>
      </div>

      <p className="mn-count mn-grp__sub">
        The reason is stored with the award and is not optional — it is what makes the
        payment auditable, and explainable to somebody who did not receive one.
      </p>

      {showProblems && problems.length > 0 && (
        <div className="note note--danger mn-prob" role="status">
          <b>This cannot be awarded yet.</b>
          <ul className="mn-prob__l">
            {problems.map(p => <li key={p}>{p}</li>)}
          </ul>
        </div>
      )}

      {refusal && (
        <div className="note note--warn mn-prob" role="status">
          <b>The server refused this award.</b> {refusal}
          {chosen && (
            <span className="mn-prob__go">
              <EligibilitySetter
                employee={chosen}
                compact
                onDone={() => setRefusal('')}
              />
            </span>
          )}
        </div>
      )}

      <div className="k-formpanel__actions">
        <button type="button" className="k-btn k-btn--ghost" onClick={onCancel}>Cancel</button>
        <button
          type="submit"
          className="k-btn k-btn--primary"
          disabled={saving || !canWrite}
          title={denial || undefined}
        >
          {saving ? 'Awarding…' : 'Award bonus'}
        </button>
      </div>
    </form>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Eligibility — an action, not a state, because it cannot be read back
   ══════════════════════════════════════════════════════════════════════════ */

function EligibilityPanel() {
  const employees = useList('/v1/manav/employees');
  const [picked, setPicked] = useState('');
  const chosen = (employees.items || []).find(e => e.id === picked) || null;

  return (
    <Section title="Who may be given a bonus" hi="पात्रता">
      <p className="note note--warn mn-intro">
        <b>This answer can be set here but cannot be read back.</b> The server records
        whether a person may be given a bonus, and no read endpoint returns it — so this
        screen deliberately does not show a list of who is eligible, because it would have
        to invent one. What it shows instead is the answer the server confirms after each
        change. Setting it again is harmless.
      </p>

      {employees.error ? (
        <ErrorNote what="The employee list" error={employees.error} onRetry={employees.reload} />
      ) : employees.loading ? <Shim count={2} /> : (
        <div className="mn-bar">
          <label className="mn-field">
            <span className="mn-field__l">Person</span>
            <select
              className="k-input mn-f--lg"
              value={picked}
              onChange={e => setPicked(e.target.value)}
            >
              <option value="">Select…</option>
              {(employees.items || []).map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>
          {chosen && <EligibilitySetter employee={chosen} />}
        </div>
      )}
    </Section>
  );
}

/**
 * The two buttons that record the answer, and the sentence the server sends
 * back. `compact` is the copy that sits inside a refusal note.
 */
function EligibilitySetter({ employee, compact, onDone }) {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'set bonus eligibility' });
  const { pushToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [failed, setFailed] = useState('');

  async function record(value) {
    setBusy(true);
    setFailed('');
    try {
      const r = await api.put(
        `/v1/manav/employees/${employee.id}/bonus-eligibility`,
        { bonus_eligible: value },
      );
      // The server answers with the NAME and the stored value. That answer is
      // what is shown — not what was clicked — so a write that did not land
      // cannot read as one that did.
      setAnswer(r.data);
      pushToast({ title: 'Bonus eligibility recorded', type: 'success' });
      if (onDone) onDone();
    } catch (err) {
      setFailed(errText(err, 'The answer could not be recorded.'));
    } finally { setBusy(false); }
  }

  return (
    <span className="mn-rowact">
      <button
        type="button"
        className="k-btn k-btn--ghost k-btn--sm"
        disabled={busy || !canWrite}
        title={denial || undefined}
        onClick={() => record(true)}
      >
        {compact ? `Record that ${employee.name} may be given a bonus` : 'May be given a bonus'}
      </button>
      {!compact && (
        <button
          type="button"
          className="k-btn k-btn--ghost k-btn--sm"
          disabled={busy || !canWrite}
          title={denial || undefined}
          onClick={() => record(false)}
        >
          May not
        </button>
      )}
      {answer && (
        <span className="mn-count">
          Recorded: <b>{answer.employee}</b>{' '}
          {answer.bonus_eligible ? 'may be given a bonus.' : 'may not be given a bonus.'}
        </span>
      )}
      {failed && <span className="mn-t__warn mn-count">{failed}</span>}
    </span>
  );
}
