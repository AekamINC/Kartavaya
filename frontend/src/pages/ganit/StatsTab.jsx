// Ganit · stats — the GST filing screen.
//
// `ScreensBiz.jsx:60–117` defines this tab as a four-panel filing screen:
// pre-filing validation, the GSTR-3B summary, File & share, and GSTR-2B
// reconciliation. What stood here instead was five invoice-count tiles and a
// cash chart — and neither belonged:
//
//   · The tiles duplicated `KpiStrip` in `GanitPage.jsx`, which already renders
//     receivables/overdue/collected/payables directly above this panel. In the
//     reference those figures are the row ABOVE the tab bar (ScreensBiz:17–23),
//     not the body of this tab.
//   · The cash chart is the Dashboard's, and already lives at
//     `pages/today/CashPosition.jsx`. Nothing is lost by removing it here.
//
// ── What is real and what is not ──────────────────────────────────────────
// The figures and the validation findings are COMPUTED, from
// `GET /v1/documents/gst/gstr3b/{period}` — the JSON sibling of the route that
// renders the working paper, reading the same `_assemble_gstr3b` and the same
// `gstr3b_pdf.compute`. The screen and the document therefore cannot state
// different tax.
//
// Two things the reference draws are NOT rendered as fact, because Kartavaya
// has no data for them and inventing it on a tax screen is the worst thing this
// file could do:
//
//   · GSTR-2B reconciliation ("42 / 47 matched"). There is no 2B store — no
//     table, no endpoint, nothing to fetch. The panel says so.
//   · "Kartavaya is a registered GSP — invoices upload to the IRP directly.
//     Last sync 14 min ago." That is a claim about a regulatory status
//     Kartavaya does not hold, printed on the screen a firm files taxes from.
//     Replaced with what is actually true.
//
// Rows GSTR-3B needs and no column stores — reverse charge, nil/exempt,
// non-GST, every ITC reversal — are marked UNRECORDED rather than shown as a
// confident zero. A zero there asserts that no such liability arose.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, body } from '../../lib/api';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonCardGrid, SkeletonRegion } from '../../components/ui/Skeleton';
import DocumentError from '../../components/ui/DocumentError';
import { useDocumentDownload } from '../../lib/documents';
import { inr } from '../../lib/inr';

/** `2026-07` → `July 2026`. */
function periodLabel(period) {
  const d = new Date(`${period}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return period;
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** `2026-08-20` → `20 Aug 2026`. */
function dateLabel(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ITNS-281's own vocabulary. The major head is a property of the DEDUCTEE and
// is never inferred from the deductor, so it is chosen, not defaulted.
const MAJOR_HEADS = [
  ['0020', '0020 — deductee is a company'],
  ['0021', '0021 — deductee is not a company'],
];
const PAYMENT_TYPES = [
  ['200', '200 — TDS payable by taxpayer'],
  ['400', '400 — TDS on regular assessment'],
];

const BLANK_CHALLAN = {
  deposit_date: '', major_head: '', payment_type: '',
  bsr_code: '', challan_serial: '', challan_number: '', bank_name: '',
  include_salary_tds: true,
};

/**
 * The same shapes `doc_validation` enforces, checked here too.
 *
 * Not a replacement for the server's validation — that stays the authority —
 * but a preparer who mistypes a 6-digit BSR code should learn it from the field
 * rather than from a round trip that returns a 422.
 */
function challanProblems(c) {
  const bad = [];
  if (!c.deposit_date) bad.push('deposit date');
  if (!c.major_head) bad.push('major head');
  if (!c.payment_type) bad.push('type of payment');
  if (!/^[0-9]{7}$/.test(c.bsr_code.trim())) bad.push('BSR code (seven digits)');
  if (!/^[0-9]{5}$/.test(c.challan_serial.trim())) bad.push('challan serial (five digits)');
  return bad;
}

export default function StatsTab() {
  const [period, setPeriod] = useState(currentMonth);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const doc = useDocumentDownload();
  const [challan, setChallan] = useState(BLANK_CHALLAN);
  const [challanOpen, setChallanOpen] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await api.get(`/v1/documents/gst/gstr3b/${period}`);
      setData(body(r));
    } catch (e) {
      // Loading, empty and ERROR are three states. An empty summary painted
      // over a failed fetch is a false statement about the period's liability.
      setErr(e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const checks = useMemo(() => (Array.isArray(data?.checks) ? data.checks : []), [data]);
  const blockers = useMemo(() => checks.filter(c => c.severity === 'blocking'), [checks]);
  const rows = useMemo(() => (Array.isArray(data?.rows) ? data.rows : []), [data]);

  /**
   * A mailto the user sends themselves.
   *
   * This BUILDS a URL and never dispatches: no send endpoint is called, no
   * address is filled in, and nothing leaves the browser until the user picks a
   * recipient in their own mail client and presses send. Same shape as the
   * WhatsApp control on the invoice drawer, and the reason `OUTBOUND_MODE` is
   * not involved — there is no outbound path here to gate.
   */
  const shareUrl = useMemo(() => {
    if (!data) return '';
    const lines = [
      `GSTR-3B working paper — ${periodLabel(period)}`,
      data.gstin ? `GSTIN: ${data.gstin}` : '',
      `Due: ${dateLabel(data.due_date)}`,
      '',
      ...rows.map(r => `${r.label}: ${r.recorded ? inr(Number(r.tax || 0)) : 'not recorded'}`),
      '',
      blockers.length
        ? `${blockers.length} item(s) to resolve before filing: ${blockers.map(b => b.title).join('; ')}`
        : 'No pre-filing blockers were found.',
      '',
      'Prepared in Kartavaya. The working paper PDF is attached separately.',
    ];
    return `mailto:?subject=${encodeURIComponent(`GSTR-3B ${periodLabel(period)}`)}`
      + `&body=${encodeURIComponent(lines.filter(l => l !== undefined).join('\n'))}`;
  }, [data, period, rows, blockers]);

  const problems = challanProblems(challan);

  const periodPicker = (
    <label className="gn-bar__f">
      <span className="gn-bar__fl">Tax period</span>
      <input
        className="inp gn-bar__sel" type="month" value={period}
        onChange={e => e.target.value && setPeriod(e.target.value)}
      />
    </label>
  );

  if (loading) {
    return (
      <SkeletonRegion label="Loading the GST position">
        <SkeletonCardGrid count={4} columns={2} lines={4} />
      </SkeletonRegion>
    );
  }

  if (err) {
    return (
      <div>
        <div className="gn-bar">{periodPicker}</div>
        <ErrorState kind={errorKind(err)} onRetry={load} />
      </div>
    );
  }

  return (
    <div>
      <div className="gn-bar">
        {periodPicker}
        <span className="gn-bar__sp" />
        {data?.due_date && (
          <span className="gn-facts__v">GSTR-3B due {dateLabel(data.due_date)}</span>
        )}
      </div>

      <div className="gn-gst">
        <div className="gn-gst__col">
          {/* ── 1 · Pre-filing validation ───────────────────────────────── */}
          <section className={`gn-panel${blockers.length ? ' gn-panel--warn' : ' gn-panel--ok'}`}>
            <div className="gn-panel__head">
              <h3 className="gn-panel__h">
                Pre-filing validation<span className="dr__lbl-hi" lang="hi">जाँच</span>
              </h3>
              <span className={`gn-tag${blockers.length ? ' gn-tag--danger' : ' gn-tag--ok'}`}>
                {blockers.length
                  ? `${blockers.length} ${blockers.length === 1 ? 'blocker' : 'blockers'}`
                  : 'No blockers'}
              </span>
            </div>

            {checks.length === 0 ? (
              <p className="gn-est__note">
                Nothing in {periodLabel(period)} fails a check Kartavaya can make:
                every invoice carries an HSN or SAC, and every counterparty GSTIN
                passes its own check digit.
              </p>
            ) : (
              <ul className="gn-chk__list">
                {checks.map(c => (
                  <li
                    key={c.code}
                    className={`gn-chk__i${c.severity === 'blocking' ? ' gn-chk__i--bad' : ''}`}
                  >
                    <span className="gn-chk__t">{c.title}</span>
                    <span className="gn-chk__d">{c.detail}</span>
                    {c.items?.length > 0 && (
                      <span className="gn-chk__items">{c.items.join(' · ')}</span>
                    )}
                    {c.fix && <span className="gn-chk__fix">Fix in {c.fix}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── 2 · GSTR-3B summary ─────────────────────────────────────── */}
          <section className="gn-panel">
            <div className="gn-panel__head">
              <h3 className="gn-panel__h">
                GSTR-3B summary<span className="dr__lbl-hi" lang="hi">विवरणी</span>
              </h3>
              <span className="gn-tbl__mute">{periodLabel(period)}</span>
            </div>

            <div className="gn-gst__rows">
              {rows.map(r => (
                <div className="gn-gst__row" key={r.key}>
                  <span className="gn-gst__l">{r.label}</span>
                  <span className="gn-gst__nums">
                    <span className="gn-gst__tx">
                      {r.taxable === null || r.taxable === undefined ? '' : inr(Number(r.taxable))}
                    </span>
                    <span className={`gn-gst__gst${r.recorded ? '' : ' gn-gst__gst--none'}`}>
                      {/* Never a bare 0 for a row with no store behind it. */}
                      {r.recorded ? inr(Number(r.tax || 0)) : 'not recorded'}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            <p className="gn-est__note">
              Computed from {data?.outward_count ?? 0} outward{' '}
              {data?.outward_count === 1 ? 'invoice' : 'invoices'} and{' '}
              {data?.inward_count ?? 0} vendor{' '}
              {data?.inward_count === 1 ? 'bill' : 'bills'} in this period.
              {blockers.some(b => b.code === 'hsn_missing')
                && ' Invoices missing an HSN or SAC are excluded from these figures and named above.'}
            </p>

            {data?.not_recorded?.length > 0 && (
              <p className="gn-est__note">
                <strong>Kartavaya stores no data for:</strong>{' '}
                {data.not_recorded.join('; ')}. These file as nil on the working
                paper, which states them rather than omitting the row — enter them
                on the portal if they apply.
              </p>
            )}
          </section>
        </div>

        <div className="gn-gst__col">
          {/* ── 3 · File & share ────────────────────────────────────────── */}
          <section className="gn-panel">
            <div className="gn-panel__head">
              <h3 className="gn-panel__h">
                File &amp; share<span className="dr__lbl-hi" lang="hi">प्रेषण</span>
              </h3>
            </div>

            <div className="gn-gst__acts">
              <button
                type="button"
                className="btn btn--fill"
                disabled={doc.busy === 'gstr3b'}
                onClick={() => doc.run('gstr3b', {
                  method: 'post',
                  url: `/v1/documents/gst/gstr3b/${period}/pdf`,
                  // The override rows stay at their defaults. Sending invented
                  // figures for reverse charge or an ITC reversal would put a
                  // number on a tax working paper that nobody ascertained.
                  data: {},
                  filename: `GSTR-3B-${period}.pdf`,
                  fallback: 'Could not generate the working paper',
                })}
              >
                {doc.busy === 'gstr3b' ? 'Generating…' : 'Export GSTR-3B working paper'}
              </button>

              <a className="btn btn--tonal" href={shareUrl}>Share with your CA</a>
              <p className="gn-est__note">
                Opens a draft in your own mail client with the summary in it. Kartavaya
                sends nothing — you choose the recipient and press send. Attach the
                working paper yourself.
              </p>

              <button
                type="button" className="btn btn--out" disabled
                title="No GSTR-1 JSON generator exists in Kartavaya yet — the portal's schema is not implemented."
              >
                Export GSTR-1 JSON
              </button>
              <button
                type="button" className="btn btn--out" disabled
                title="No Tally XML exporter exists in Kartavaya yet."
              >
                Tally export (XML)
              </button>
              <p className="gn-est__note">
                GSTR-1 JSON and Tally XML are not built. Kartavaya is not a GSP and
                does not upload to the IRP — the working paper above is prepared for
                filing on the portal by hand or by your CA.
              </p>
            </div>

            <DocumentError error={doc.error} onDismiss={doc.clear} />
          </section>

          {/* ── 4 · GSTR-2B reconciliation ──────────────────────────────── */}
          <section className="gn-panel">
            <div className="gn-panel__head">
              <h3 className="gn-panel__h">
                Reconciliation<span className="dr__lbl-hi" lang="hi">मेल</span>
              </h3>
              <span className="gn-tag">Unavailable</span>
            </div>
            <p className="gn-est__note">
              GSTR-2B is the auto-drafted credit statement the portal publishes each
              month. Kartavaya has nowhere to put one — no 2B store, no portal
              connection — so no invoice here has been matched against it, and no
              match rate can be shown.
            </p>
            <p className="gn-est__note">
              The <strong>Eligible ITC</strong> figure above is the tax on the{' '}
              {data?.inward_count ?? 0} vendor{' '}
              {data?.inward_count === 1 ? 'bill' : 'bills'} you have RECORDED. It is
              not confirmation the credit appears in your 2B, and claiming ITC that
              2B does not carry is the most common notice a firm receives. Reconcile
              on the portal before filing.
            </p>
          </section>
        </div>
      </div>

      {/* ── TDS challan (ITNS-281) ────────────────────────────────────────
          Its natural home: the deduction period is the same period as the
          return above, and the deductor is the same org. */}
      <section className="gn-panel">
        <div className="gn-panel__head">
          <h3 className="gn-panel__h">
            TDS challan · ITNS-281<span className="dr__lbl-hi" lang="hi">चालान</span>
          </h3>
          <button
            type="button" className="btn btn--ghost btn--sm"
            onClick={() => setChallanOpen(v => !v)}
          >
            {challanOpen ? 'Close' : 'Prepare counterfoil'}
          </button>
        </div>

        {challanOpen && (
          <>
            <p className="gn-est__note">
              The salary (192B) line is derived from Vetana payslips for{' '}
              {periodLabel(period)}. Everything else is transcribed from the
              counterfoil your bank issued — Kartavaya does not hold the CIN, so it
              is entered here rather than guessed.
            </p>

            <div className="gn-form__grid gn-form__grid--2 gn-form__grid--flush">
              <label className="fld">
                <span className="fld__l">Deposit date<span className="fld__req">*</span></span>
                <input
                  className="inp" type="date" value={challan.deposit_date}
                  onChange={e => setChallan({ ...challan, deposit_date: e.target.value })}
                />
              </label>
              <label className="fld">
                <span className="fld__l">Tender date</span>
                <input
                  className="inp" type="date" value={challan.tender_date || ''}
                  onChange={e => setChallan({ ...challan, tender_date: e.target.value })}
                />
              </label>
              <label className="fld">
                <span className="fld__l">Major head<span className="fld__req">*</span></span>
                <select
                  className="inp" value={challan.major_head}
                  onChange={e => setChallan({ ...challan, major_head: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {MAJOR_HEADS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="fld">
                <span className="fld__l">Type of payment<span className="fld__req">*</span></span>
                <select
                  className="inp" value={challan.payment_type}
                  onChange={e => setChallan({ ...challan, payment_type: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {PAYMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="fld">
                <span className="fld__l">BSR code<span className="fld__req">*</span></span>
                <input
                  className="inp" inputMode="numeric" maxLength={7} placeholder="7 digits"
                  value={challan.bsr_code}
                  onChange={e => setChallan({ ...challan, bsr_code: e.target.value })}
                />
              </label>
              <label className="fld">
                <span className="fld__l">Challan serial<span className="fld__req">*</span></span>
                <input
                  className="inp" inputMode="numeric" maxLength={5} placeholder="5 digits"
                  value={challan.challan_serial}
                  onChange={e => setChallan({ ...challan, challan_serial: e.target.value })}
                />
              </label>
              <label className="fld">
                <span className="fld__l">Challan number</span>
                <input
                  className="inp" value={challan.challan_number}
                  onChange={e => setChallan({ ...challan, challan_number: e.target.value })}
                />
              </label>
              <label className="fld">
                <span className="fld__l">Collecting bank</span>
                <input
                  className="inp" value={challan.bank_name}
                  onChange={e => setChallan({ ...challan, bank_name: e.target.value })}
                />
              </label>
            </div>

            <label className="gn-chk">
              <input
                type="checkbox" checked={challan.include_salary_tds}
                onChange={e => setChallan({ ...challan, include_salary_tds: e.target.checked })}
              />
              <span>Include the salary (192B) line derived from Vetana</span>
            </label>

            <div className="gn-form__acts">
              <button
                type="button"
                className="btn btn--fill btn--sm"
                disabled={doc.busy === 'challan' || problems.length > 0}
                title={problems.length ? `Still needed: ${problems.join(', ')}` : undefined}
                onClick={() => doc.run('challan', {
                  method: 'post',
                  url: `/v1/documents/tds/challan/${period}/pdf`,
                  data: {
                    ...challan,
                    bsr_code: challan.bsr_code.trim(),
                    challan_serial: challan.challan_serial.trim(),
                  },
                  filename: `TDS-${challan.challan_number || period}.pdf`,
                  fallback: 'Could not generate the challan',
                })}
              >
                {doc.busy === 'challan' ? 'Generating…' : 'Download challan'}
              </button>
            </div>

            {problems.length > 0 && (
              <p className="gn-est__note">Still needed: {problems.join(', ')}.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
