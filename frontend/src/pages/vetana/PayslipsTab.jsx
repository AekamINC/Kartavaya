// Vetana → Payslips. The wage record, and the refusal to issue a broken one.
//
// ── The refusal is the feature ───────────────────────────────────────────────
//
// A payslip is a statutory document. `design-reference/Kartavaya Redesign/docs/
// Payslip.html` is its specification, and `services/doc_validation.py` enforces
// it: if a slip is missing a statutory identifier for a deduction it records, or
// its figures do not reconcile, `generate_payslip_pdf` raises `DocumentIncomplete`
// and the endpoint answers 422 with a structured payload — every blocking gap
// named, with the reason it blocks and where to fix it.
//
// The download button used to turn all of that into the four-word toast "Failed
// to download payslip". The backend refused correctly and the person was told
// nothing, so the only available conclusion was that the button was broken —
// which is exactly how a careful refusal gets "fixed" by being bypassed.
//
// It now renders the payload: what is missing, why it blocks, and what to set.
// Advisory gaps are shown separately because they do NOT block — the document
// issues with those marked inside it.
import React, { useState, useEffect } from 'react';
import DateInput from '../../components/ui/DateInput';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import {
  Section, Badge, Empty, BackButton, ModCard, DataTable, Td,
} from '../../components/editorial';
import {
  useList, ErrorNote, FMT, Shim, PS_COLORS, errText, monthName, thisMonth,
} from './_shared';

export default function PayslipsTab({ onChanged }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'disburse payroll' });
  const [monthFilter, setMonthFilter] = useState('');
  const list = useList(
    `/v1/vetana/payslips${monthFilter ? `?month=${encodeURIComponent(monthFilter)}` : ''}`,
    [monthFilter],
  );
  const [detailId, setDetailId] = useState(null);

  if (detailId) {
    return (
      <PayslipDetail
        id={detailId}
        onBack={() => { setDetailId(null); list.reload(); }}
        onChanged={() => { list.reload(); onChanged?.(); }}
      />
    );
  }

  return (
    <div className="k-section">
      <div className="k-section__head vt-head">
        <h3 className="k-section__title">
          Payslips<Secondary className="k-section__title-hi" value="वेतन पर्ची" />
        </h3>
        <div className="vt-head__act">
          <div className="vt-field">
            <span className="vt-field__l" id="vt-month-payslips">Month</span>
            {/* Was a native `<input type="month">`. The product bans native
                date-family controls (CLAUDE.md), and Vetana is where a wrong
                month costs most: the value must match
                `vetana_payroll_runs.month` EXACTLY, and a wrong one does not
                fail -- it files against a run nobody will ever look at.
                A `div`, not a `label`, because DateInput renders a BUTTON and
                a label cannot label one; the association is aria-labelledby. */}
            <DateInput
              type="month"
              value={monthFilter}
              max={thisMonth()}
              onChange={e => setMonthFilter(e.target.value)}
              className="k-formpanel__input vt-field__in"
              aria-labelledby="vt-month-payslips"
            />
          </div>
          {monthFilter && (
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setMonthFilter('')}>
              Clear
            </button>
          )}
        </div>
      </div>

      {list.loading ? <Shim count={4} />
        : list.error ? <ErrorNote what="Payslips" error={list.error} onRetry={list.reload} />
          : list.items.length === 0 ? (
            <Empty
              icon="📄"
              title={monthFilter ? `No payslips for ${monthName(monthFilter)}` : 'No payslips yet'}
              sub={monthFilter
                ? 'That month has not been processed, or it produced no payslips. Clear the filter to see every month.'
                : 'Process a month on the Payroll tab and a payslip is written for each employee with a salary structure.'}
            />
          ) : (
            <div className="vt-list">
              {list.items.map(p => (
                <ModCard key={p.id} onClick={() => setDetailId(p.id)}>
                  <div>
                    <strong className="vt-row__t">{p.employee_name}</strong>
                    <span className="vt-code">{p.payslip_number}</span>
                    <p className="vt-row__s">{monthName(p.month)}</p>
                  </div>
                  <div className="vt-row__end">
                    <span className="vt-row__num">{FMT(p.net_pay)}</span>
                    <Badge text={p.status} color={PS_COLORS[p.status]} />
                  </div>
                </ModCard>
              ))}
            </div>
          )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One payslip
   ══════════════════════════════════════════════════════════════════════════ */

function PayslipDetail({ id, onBack, onChanged }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'disburse payroll' });
  const { pushToast } = useToast();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [busy, setBusy] = useState('');
  const [refusal, setRefusal] = useState('');
  // The 422 payload from `doc_validation`. Held in state rather than toasted:
  // it is a list of things to go and fix, and it has to stay readable while the
  // person fixes them.
  const [incomplete, setIncomplete] = useState(null);

  useEffect(() => { load(); }, [id]);

  async function load() {
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get(`/v1/vetana/payslips/${id}`);
      setState({ loading: false, error: '', data: r.data });
    } catch (err) {
      setState({ loading: false, error: errText(err), data: null });
    }
  }

  async function disburse() {
    setBusy('disburse');
    setRefusal('');
    try {
      await api.patch(`/v1/vetana/payslips/${id}/disburse`);
      pushToast({ title: 'Payslip marked as disbursed', type: 'success' });
      load();
      onChanged?.();
    } catch (err) {
      const msg = errText(err);
      if (err?.response?.status === 403) setRefusal(msg);
      else pushToast({ title: msg, type: 'error' });
    } finally { setBusy(''); }
  }

  /**
   * The PDF comes back as a blob, so an ERROR also comes back as a blob and has
   * to be read before it can be understood. The previous version parsed it and
   * then took `.detail` as a string — but on a 422 `detail` is the structured
   * `as_payload()` object, so it rendered as "[object Object]" at best.
   */
  async function download(p) {
    setBusy('pdf');
    setIncomplete(null);
    setRefusal('');
    try {
      const res = await api.get(`/v1/vetana/payslips/${p.id}/pdf`, { responseType: 'blob' });
      if (!res.data || res.data.size === 0) {
        pushToast({ title: 'The payslip PDF came back empty — nothing was downloaded.', type: 'error' });
        return;
      }
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Payslip-${p.payslip_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      let detail = err?.response?.data;
      if (detail instanceof Blob) {
        try { detail = JSON.parse(await detail.text())?.detail; } catch { detail = null; }
      } else {
        detail = detail?.detail;
      }
      if (detail && typeof detail === 'object' && detail.error === 'document_incomplete') {
        setIncomplete(detail);
        return;
      }
      if (err?.response?.status === 403) {
        setRefusal(typeof detail === 'string' ? detail
          : 'Downloading another employee’s payslip needs admin on Vetana. Your own needs no grant.');
        return;
      }
      pushToast({
        title: typeof detail === 'string' ? detail : 'The payslip PDF could not be generated.',
        type: 'error',
      });
    } finally { setBusy(''); }
  }

  if (state.loading) return <Shim count={6} />;
  if (state.error) {
    return (
      <div>
        <BackButton onClick={onBack} label="Back to list" />
        <ErrorNote what="This payslip" error={state.error} onRetry={load} />
      </div>
    );
  }

  const p = state.data;
  const earnings = [
    ['Basic', p.basic], ['HRA', p.hra], ['DA', p.da],
    ['Special allowance', p.special_allowance], ['Conveyance', p.conveyance],
    ['Medical', p.medical], ['Overtime', p.overtime_pay],
  ].filter(([, v]) => Number(v) > 0);
  const deductions = [
    ['Provident fund (employee)', p.pf_employee],
    ['State insurance (employee)', p.esi_employee],
    ['Professional tax', p.professional_tax],
    ['TDS', p.tds],
    ['Loan repayment', p.loan_deduction],
  ].filter(([, v]) => Number(v) > 0);

  return (
    <div>
      <BackButton onClick={onBack} label="Back to list" />
      <div className="k-detail">
        <div className="k-detail__header">
          <div>
            <h3 className="k-detail__title">{p.payslip_number}</h3>
            <p className="k-detail__sub">
              {p.employee_name} · {p.employee_code} · {monthName(p.month)}
            </p>
          </div>
          <div className="vt-row__end">
            <Badge text={p.status} color={PS_COLORS[p.status]} />
            <button
              type="button"
              className="k-btn k-btn--ghost"
              disabled={busy === 'pdf'}
              onClick={() => download(p)}
            >
              {busy === 'pdf' ? 'Generating…' : 'Download PDF'}
            </button>
            {p.status === 'approved' && (
              <button
                type="button"
                className="k-btn k-btn--primary"
                disabled={busy === 'disburse' || !canWrite}
                onClick={disburse} title={denial || undefined}>
                {busy === 'disburse' ? 'Marking…' : 'Mark disbursed'}
              </button>
            )}
          </div>
        </div>

        {refusal && (
          <p className="note note--warn" role="status">
            <b>That needs a different grant.</b> {refusal}
          </p>
        )}

        {incomplete && <Incomplete payload={incomplete} onDismiss={() => setIncomplete(null)} />}

        <div className="k-metabar">
          <span>Working days: <strong>{p.working_days}</strong></span>
          <span>Present: <strong>{p.present_days}</strong></span>
          <span>Paid leave: <strong>{p.leaves_paid}</strong></span>
          <span>Unpaid: <strong>{p.leaves_unpaid}</strong></span>
          {Number(p.overtime_hours) > 0 && <span>Overtime: <strong>{p.overtime_hours}h</strong></span>}
        </div>

        <div className="vt-slip">
          <Section title="Earnings" hi="आय">
            <DataTable columns={['Component', { label: 'Amount', align: 'right' }]}>
              {earnings.map(([label, val]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <Td align="right" mono>{FMT(val)}</Td>
                </tr>
              ))}
              <tr className="vt-tot">
                <td>Gross</td>
                <Td align="right" mono bold>{FMT(p.gross)}</Td>
              </tr>
            </DataTable>
          </Section>

          <div>
            <Section title="Deductions" hi="कटौती">
              <DataTable columns={['Component', { label: 'Amount', align: 'right' }]}>
                {deductions.map(([label, val]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <Td align="right" mono color="var(--danger)">{FMT(val)}</Td>
                  </tr>
                ))}
                <tr className="vt-tot vt-tot--minus">
                  <td>Total deductions</td>
                  <Td align="right" mono bold color="var(--danger)">{FMT(p.total_deductions)}</Td>
                </tr>
              </DataTable>
            </Section>

            {Number(p.reimbursements) > 0 && (
              <p className="note note--info">
                <b>+ {FMT(p.reimbursements)}</b> expense reimbursement, added after
                deductions.
              </p>
            )}

            <div className="k-netbox">
              <p className="k-netbox__label">Net pay</p>
              <p className="k-netbox__value">{FMT(p.net_pay)}</p>
            </div>

            <dl className="vt-pol vt-pol--tight">
              <Fact k="Provident fund (employer)" v={FMT(p.pf_employer)} />
              <Fact k="State insurance (employer)" v={FMT(p.esi_employer)} />
              {p.pan && <Fact k="PAN" v={p.pan} />}
              {p.uan && <Fact k="UAN" v={p.uan} />}
              {p.bank_name && <Fact k="Bank" v={`${p.bank_name} · ${p.bank_account || '—'}`} />}
              {p._pii_masked && (
                <p className="vt-pol__src">
                  Identity and account numbers are masked here at every access
                  level. The payslip PDF carries the full values — it is the
                  statutory document, and it is audited when anyone downloads
                  somebody else’s.
                </p>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ k, v }) {
  return (
    <div className="vt-pol__r">
      <dt className="vt-pol__k">{k}</dt>
      <dd className="vt-pol__v">{v}</dd>
    </div>
  );
}

/**
 * The 422 from `services/doc_validation.py`, rendered as the work list it is.
 *
 * Each gap carries `label` (what is missing), `reason` (why it blocks) and `fix`
 * (where to set it). Showing only the message would be a refusal with no way
 * forward; showing the fields is the difference between "this failed" and "set
 * these three things and it will not".
 */
function Incomplete({ payload, onDismiss }) {
  const blocking = payload.blocking || [];
  const advisory = payload.advisory || [];
  return (
    <section className="note note--danger vt-inc" role="status">
      <div className="vt-inc__head">
        <b>This payslip was not issued.</b>
        <button type="button" className="k-btn k-btn--ghost vt-inc__x" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <p className="vt-inc__m">{payload.message}</p>

      <ul className="vt-gaps">
        {blocking.map(g => (
          <li key={g.field} className="vt-gap">
            <span className="vt-gap__l">{g.label}</span>
            <span className="vt-gap__f">{g.field}</span>
            <p className="vt-gap__r">{g.reason}</p>
            {g.fix && <p className="vt-gap__x">{g.fix}</p>}
          </li>
        ))}
      </ul>

      {advisory.length > 0 && (
        <>
          <p className="vt-inc__m">
            These do not block the document. It issues with them marked inside it.
          </p>
          <ul className="vt-gaps vt-gaps--adv">
            {advisory.map(g => (
              <li key={g.field} className="vt-gap">
                <span className="vt-gap__l">{g.label}</span>
                <p className="vt-gap__r">{g.reason}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
