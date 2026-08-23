// Vetana → Payroll. Runs, the attendance they are priced from, and approval.
//
// ── Three things this tab now says out loud that it did not before ───────────
//
// 1 · WHAT PROCESSING ACTUALLY DOES. `POST /v1/vetana/payroll/process` does not
//     merely compute a run: it writes a payslip per employee AND EMAILS EVERY
//     EMPLOYEE WITH AN ADDRESS ON FILE, with the PDF attached. Re-running a
//     month deletes that month's payslips and rebuilds them, so a second click
//     is a second round of email to everybody. The button used to fire all of
//     that on one click with no confirmation. It now names the consequence
//     first.
//
// 2 · WHERE THE NUMBERS COME FROM. The reference's `ScreenVetana` puts a
//     "Source" card beside the run — "Attendance imported from मानव" — because
//     a payroll figure that cannot be traced to its input is a figure nobody can
//     defend. `AttendanceSource` below is that card, wired to the real bridge.
//
// 3 · WHETHER OVERTIME WAS COMPUTED AT ALL. Migration 082 added the shift
//     policy; `overtime_enabled` defaults FALSE and there was no UI anywhere for
//     it. "0 hours of overtime" and "overtime was never calculated" look
//     identical on a payslip and mean opposite things, so the source card prints
//     which of the two it is, in the API's own words.
//
// ── On the Approve control ───────────────────────────────────────────────────
//
// Vetana is a separated-duty module: admin defines what people are paid,
// approver releases the money, and admin does NOT satisfy approver. The backend
// enforces that (`vetana.py` `_RELEASE_LEVEL`) and answers with a written
// explanation rather than a bare 403. This tab shows that explanation verbatim
// and keeps it on screen — it is a rule the person needs to read and act on, not
// a toast that disappears in four seconds. The control itself is deliberately
// NOT hidden by a client-side level check; see the note in
// `__tests__/e2e/separated-duty.test.jsx`, which pins that decision.
import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import useModuleWrite from '../../hooks/useModuleWrite';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Secondary } from '../../components/Bilingual';
import {
  Section, StatTile, Badge, Empty, BackButton, ModCard, DataTable, Td,
} from '../../components/editorial';
import {
  useList, ErrorNote, FMT, Shim, RUN_COLORS, errText, monthName, thisMonth, monthRange,
} from './_shared';

export default function PayrollTab({ runNonce, onChanged }) {
  const { pushToast } = useToast();
  // F32, the sharpest instance measured on staging: a member with NO Vetana
  // grant was offered `Run payroll` in the header, and pressing it walked them
  // through this tab, a month picker and a confirmation modal to `Process and
  // email` — which writes a payslip for every employee and mails each of them
  // the PDF. The API refused throughout; the UI advertised it throughout.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'run payroll' });
  const runs = useList('/v1/vetana/payroll/runs');
  const [month, setMonth] = useState('');
  const [processing, setProcessing] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [detailId, setDetailId] = useState(null);

  // "Run payroll" in the page header lands here. Default the month to the one
  // just gone — you run July's payroll in August, not July's in July.
  useEffect(() => {
    if (!runNonce) return;
    setDetailId(null);
    if (!month) setMonth(lastMonth());
  }, [runNonce]);

  async function processPayroll() {
    setProcessing(true);
    try {
      const r = await api.post('/v1/vetana/payroll/process', { month });
      pushToast({
        title: `Processed ${r.data.employee_count} ${r.data.employee_count === 1 ? 'employee' : 'employees'} — net ${FMT(r.data.total_net)}`,
        type: 'success',
      });
      runs.reload();
      onChanged?.();
    } catch (err) {
      pushToast({ title: errText(err, 'Payroll could not be processed.'), type: 'error' });
    } finally {
      setProcessing(false);
    }
  }

  if (detailId) {
    return (
      <RunDetail
        id={detailId}
        onBack={() => { setDetailId(null); runs.reload(); }}
        onChanged={() => { runs.reload(); onChanged?.(); }}
      />
    );
  }

  return (
    <div>
      <div className="k-section__head vt-head">
        <h3 className="k-section__title">
          Payroll runs<Secondary className="k-section__title-hi" value="वेतन संसाधन" />
        </h3>
        <div className="vt-head__act">
          <label className="vt-field">
            <span className="vt-field__l">Month</span>
            <input
              type="month"
              value={month}
              max={thisMonth()}
              onChange={e => setMonth(e.target.value)}
              className="k-formpanel__input vt-field__in"
            />
          </label>
          <button
            type="button"
            className="k-btn k-btn--primary"
            disabled={processing || !month || !canWrite}
            title={denial || undefined}
            onClick={() => setConfirm({
              title: `Process payroll for ${monthName(month)}?`,
              message:
                'This writes a payslip for every employee with a salary structure, and '
                + 'emails each of them their payslip with the PDF attached. Running the '
                + 'same month again deletes and rebuilds its payslips, which sends that '
                + 'email a second time. A month that has already been approved or '
                + 'disbursed cannot be re-run.',
              confirmLabel: 'Process and email',
              intent: 'warn',
              onConfirm: processPayroll,
            })}
          >
            {processing ? 'Processing…' : 'Process payroll'}
          </button>
        </div>
      </div>

      {!month && (
        <p className="note note--info">
          <b>Pick a month to process.</b> Everything below is the history of runs
          already made.
        </p>
      )}
      {month && <AttendanceSource month={month} />}

      {runs.loading ? <Shim count={4} />
        : runs.error ? <ErrorNote what="Payroll runs" error={runs.error} onRetry={runs.reload} />
          : runs.items.length === 0 ? (
            <Empty
              icon="📋"
              title="No payroll has been run"
              sub="Choose a month above and process it. Each run prices every active salary structure against that month's attendance."
            />
          ) : (
            <div className="vt-list">
              {runs.items.map(r => (
                <ModCard key={r.id} onClick={() => setDetailId(r.id)}>
                  <div>
                    <strong className="vt-row__t">{monthName(r.month)}</strong>
                    <p className="vt-row__s">
                      {r.month} · {r.employee_count} {r.employee_count === 1 ? 'employee' : 'employees'}
                    </p>
                  </div>
                  <div className="vt-row__end">
                    <div className="vt-row__fig">
                      <span className="vt-row__num">{FMT(r.total_net)}</span>
                      <p className="vt-row__sub">gross {FMT(r.total_gross)}</p>
                    </div>
                    <Badge text={r.status} color={RUN_COLORS[r.status]} />
                  </div>
                </ModCard>
              ))}
            </div>
          )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/** The month just gone, as `YYYY-MM`. */
function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   The source — what this run will be priced from
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The reference's "Source" card, wired.
 *
 * `POST /v1/pahchan/attendance/publish` with `dry_run: true` pairs the month's
 * punches into attendance rows and returns EXACTLY what it would write, without
 * writing it — the endpoint's own docstring says the first sensible thing to do
 * with a payroll input is look at it. That is what this does.
 *
 * It is behind a button rather than fired on render. It is a POST, it is not
 * free, and running it is a question the person asks — not something a tab does
 * to their org because they clicked "Payroll".
 *
 * The bridge needs the Pahchan module and org owner/admin. Anyone else gets a
 * plain statement of that, not an error: a payroll editor who cannot inspect
 * the attendance bridge is a normal, correct configuration.
 */
function AttendanceSource({ month }) {
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });
  const [policy, setPolicy] = useState(null);

  // Reset when the month changes — a preview of July shown under an August
  // heading is worse than no preview.
  useEffect(() => { setState({ status: 'idle', data: null, error: '' }); }, [month]);

  async function check() {
    const { from, to } = monthRange(month);
    setState({ status: 'loading', data: null, error: '' });
    try {
      const r = await api.post('/v1/pahchan/attendance/publish', {
        from_date: from, to_date: to, dry_run: true,
      });
      setState({ status: 'done', data: r.data, error: '' });
    } catch (err) {
      setState({
        status: 'error',
        data: null,
        error: err?.response?.status === 403
          ? 'Inspecting the attendance bridge needs the Pahchan module and an owner or admin role. The run itself is unaffected — it reads the same attendance either way.'
          : errText(err, 'The attendance bridge could not be checked.'),
      });
    }
    // The policy is a separate, cheap GET and is worth having even if the dry
    // run was refused: it is what says whether overtime is switched on at all.
    try {
      setPolicy((await api.get('/v1/pahchan/policy')).data);
    } catch { setPolicy(null); }
  }

  const d = state.data;
  const ot = d?.overtime;

  return (
    <section className="vt-src">
      <div className="vt-src__head">
        <h4 className="vt-src__t">
          Source<Secondary className="vt-src__hi" value="स्रोत" />
        </h4>
        <button type="button" className="k-btn k-btn--ghost" onClick={check} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Checking…' : 'Check attendance source'}
        </button>
      </div>

      <p className="vt-src__lede">
        A run prices <b>{monthName(month)}</b> from Manav attendance and approved
        leave. Checking the source pairs that month’s punches and reports what
        would be written — it changes nothing.
      </p>

      {state.status === 'error' && (
        <p className="note note--warn">
          <b>The attendance bridge did not report.</b> {state.error}
        </p>
      )}

      {state.status === 'done' && d && (
        <>
          {/* Only what a DRY RUN actually knows. `rows_written` and
              `skipped_manual_rows` are both 0 here by construction — the write
              loop is skipped entirely — so printing them would report "0 rows
              written" as if it were a finding. */}
          <div className="vt-src__grid">
            <SrcFact label="Days paired" value={d.days_built ?? '—'} sub="from punches and approved corrections" />
            <SrcFact label="Withheld for review" value={d.days_withheld_pending_review ?? 0} sub="not paired automatically" />
          </div>

          {/* The whole reason this card exists. */}
          {ot && (
            ot.computed ? (
              <p className="note note--info">
                <b>Overtime is being computed.</b> Beyond{' '}
                {ot.daily_threshold_hours}h a day or {ot.weekly_threshold_hours}h a
                week, at {ot.multiplier}× the ordinary rate
                {ot.total_hours != null && <> — <b>{ot.total_hours}h</b> in this window</>}.
              </p>
            ) : (
              <p className="note note--warn">
                <b>Overtime is not being computed.</b> {ot.reason}{' '}
                Until it is switched on, <code>overtime_hours</code> is left
                untouched and every payslip in this run shows no overtime pay —
                which is not the same as an employee having worked none.
              </p>
            )
          )}

          {Number(d.days_withheld_pending_review || 0) > 0 && (
            <p className="note note--warn">
              <b>{d.days_withheld_pending_review}{' '}
                {d.days_withheld_pending_review === 1 ? 'day is' : 'days are'} withheld pending review.</b>{' '}
              A withheld day has punches the bridge would not pair on its own —
              usually a missing check-out, or a punch still flagged for a
              reviewer. Clear them in Pahchan before processing, or those days
              price as absent and somebody is paid short.
            </p>
          )}
        </>
      )}

      {policy && (
        <dl className="vt-pol">
          <PolRow label="Standard day" value={`${policy.standard_hours_per_day}h`} />
          <PolRow label="Overtime after" value={`${policy.overtime_daily_threshold_hours}h/day · ${policy.overtime_weekly_threshold_hours}h/week`} />
          <PolRow label="Overtime rate" value={`${policy.overtime_multiplier}× ordinary`} />
          <PolRow label="Overtime" value={policy.overtime_enabled ? 'On' : 'Off'} />
          <p className="vt-pol__src">
            Factories Act 1948 — §54 nine hours a day, §51 forty-eight a week,
            §59 twice the ordinary rate. Set per organisation in Pahchan, because
            state Shops &amp; Establishments Acts differ.
          </p>
        </dl>
      )}
    </section>
  );
}

function SrcFact({ label, value, sub }) {
  return (
    <div className="vt-fact">
      <div className="vt-fact__l">{label}</div>
      <div className="vt-fact__v">{value}</div>
      {sub && <div className="vt-fact__s">{sub}</div>}
    </div>
  );
}

function PolRow({ label, value }) {
  return (
    <div className="vt-pol__r">
      <dt className="vt-pol__k">{label}</dt>
      <dd className="vt-pol__v">{value}</dd>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One run
   ══════════════════════════════════════════════════════════════════════════ */

function RunDetail({ id, onBack, onChanged }) {
  const { pushToast } = useToast();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  // The separated-duty refusal, kept on screen. A toast is the wrong home for a
  // sentence explaining an authority boundary — it is gone before it is read.
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => { load(); }, [id]);

  async function load() {
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get(`/v1/vetana/payroll/runs/${id}`);
      setState({ loading: false, error: '', data: r.data });
    } catch (err) {
      setState({ loading: false, error: errText(err), data: null });
    }
  }

  async function act(verb, path, done) {
    setBusy(verb);
    setRefusal('');
    try {
      await api.patch(path);
      pushToast({ title: done, type: 'success' });
      load();
      onChanged?.();
    } catch (err) {
      const msg = errText(err);
      if (err?.response?.status === 403) setRefusal(msg);
      else pushToast({ title: msg, type: 'error' });
    } finally {
      setBusy('');
    }
  }

  if (state.loading) return <Shim count={6} />;
  if (state.error) {
    return (
      <div>
        <BackButton onClick={onBack} label="Back to runs" />
        <ErrorNote what="This payroll run" error={state.error} onRetry={load} />
      </div>
    );
  }

  const run = state.data;
  const payslips = run.payslips || [];

  return (
    <div>
      <BackButton onClick={onBack} label="Back to runs" />
      <div className="k-detail">
        <div className="k-detail__header">
          <div>
            <h3 className="k-detail__title">{monthName(run.month)}</h3>
            <p className="k-detail__sub">
              {run.employee_count} {run.employee_count === 1 ? 'employee' : 'employees'} · {run.month}
            </p>
          </div>
          <Badge text={run.status} color={RUN_COLORS[run.status]} />
        </div>

        <div className="k-stats vt-stats">
          <StatTile label="Gross" sanskrit="सकल" value={FMT(run.total_gross)} />
          <StatTile label="Deductions" sanskrit="कटौती" value={FMT(run.total_deductions)} variant="danger" />
          <StatTile label="Net pay" sanskrit="देय" value={FMT(run.total_net)} variant="ok" />
          <StatTile label="Provident fund" sanskrit="निधि" value={FMT(run.total_pf)} variant="warn" />
          <StatTile label="State insurance" sanskrit="बीमा" value={FMT(run.total_esi)} variant="warn" />
          <StatTile label="Tax deducted" sanskrit="कर" value={FMT(run.total_tds)} variant="danger" />
        </div>

        {refusal && (
          <p className="note note--warn" role="status">
            <b>That needs a different grant.</b> {refusal}
          </p>
        )}

        {(run.status === 'processed' || run.status === 'approved') && (
          <div className="k-detail__actions">
            {run.status === 'processed' && (
              <button
                type="button"
                className="k-btn k-btn--primary"
                disabled={busy === 'approve'}
                onClick={() => act('approve', `/v1/vetana/payroll/runs/${run.id}/approve`, 'Payroll approved')}
              >
                {busy === 'approve' ? 'Approving…' : 'Approve Payroll'}
              </button>
            )}
            <button
              type="button"
              className="k-btn k-btn--ghost"
              disabled={busy === 'revert'}
              onClick={() => act('revert', `/v1/vetana/payroll/runs/${run.id}/revert`, 'Payroll reverted to draft')}
            >
              {busy === 'revert' ? 'Reverting…' : 'Revert to draft'}
            </button>
          </div>
        )}
      </div>

      <Section title="Employee Breakdown" hi="कर्मचारी विवरण">
        {payslips.length === 0 ? (
          <p className="note">
            <b>This run produced no payslips.</b> Every active employee needs a
            salary structure effective on or before the end of {monthName(run.month)}
            — a run prices structures, and skips anyone without one.
          </p>
        ) : (
          <DataTable arrange="vetana.payroll" columns={[
            'Employee',
            { label: 'Days', align: 'right' },
            { label: 'Gross', align: 'right' },
            { label: 'PF', align: 'right' },
            { label: 'ESI', align: 'right' },
            { label: 'PT', align: 'right' },
            { label: 'TDS', align: 'right' },
            { label: 'Net pay', align: 'right' },
          ]}>
            {payslips.map(p => (
              <tr key={p.id}>
                <td>
                  {p.employee_name}
                  <span className="vt-code">{p.employee_code}</span>
                </td>
                <Td align="right">{p.present_days}/{p.working_days}</Td>
                <Td align="right" mono>{FMT(p.gross)}</Td>
                <Td align="right" mono>{FMT(p.pf_employee)}</Td>
                <Td align="right" mono>{FMT(p.esi_employee)}</Td>
                <Td align="right" mono>{FMT(p.professional_tax)}</Td>
                <Td align="right" mono>{FMT(p.tds)}</Td>
                <Td align="right" mono bold>{FMT(p.net_pay)}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}
