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

/**
 * The two `useDocumentDownload` keys that belong to the exports panel.
 *
 * One hook serves four buttons across two panels, and its error carries the
 * `key` of the button that failed precisely so the message can be shown against
 * that button. Without this split, a failed Tally export reports itself under
 * "File & share", two panels away from the control the user pressed.
 */
const EXPORT_KEYS = new Set(['gstr1', 'tally']);

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

/**
 * What the two export files would contain — before anyone downloads one.
 *
 * This panel is the product's actual claim. Kartavaya does not file anything;
 * what it offers a CA firm is data clean enough to file FROM, and the only
 * honest way to offer that is to say, up front, which documents did not make it
 * and why. A silent export that quietly drops four invoices is worse than no
 * export, because the firm finds out when the books do not tie.
 *
 * Three states, kept genuinely distinct:
 *   loading — the previews are in flight; no counts are shown, not even zeroes
 *   error   — both previews failed; the panel says so and offers a retry
 *   ready   — real counts, including an explicit zero, which is a fact here
 *
 * A zero voucher count is NOT the empty state: it is the answer, and the export
 * buttons above will refuse with a 422 that says the same thing.
 */
function ExportSummary({ loading, error, onRetry, info }) {
  if (loading) {
    return (
      <SkeletonRegion label="Checking what these exports would contain">
        <SkeletonCardGrid count={2} columns={1} lines={2} />
      </SkeletonRegion>
    );
  }

  if (error) {
    return <ErrorState kind={errorKind(error)} onRetry={onRetry} />;
  }

  const gstr1 = info?.gstr1;
  const tally = info?.tally;
  const held = [
    ...(Array.isArray(tally?.held_back) ? tally.held_back : []),
    ...(Array.isArray(gstr1?.held_back) ? gstr1.held_back : []),
  ];
  const omitted = Array.isArray(gstr1?.sections_omitted) ? gstr1.sections_omitted : [];
  const notes = Array.isArray(gstr1?.credit_debit_notes_not_in_file)
    ? gstr1.credit_debit_notes_not_in_file : [];
  const sections = Array.isArray(gstr1?.sections_emitted) ? gstr1.sections_emitted : [];

  return (
    <>
      {tally && (
        <p className="gn-est__note">
          <strong>Tally:</strong> {tally.voucher_count}{' '}
          {tally.voucher_count === 1 ? 'voucher' : 'vouchers'} —{' '}
          {tally.sales_count} sales, {tally.credit_note_count} credit,{' '}
          {tally.debit_note_count} debit, {tally.purchase_count} purchase.
          Quotations, proformas, drafts and cancelled documents are never exported.
        </p>
      )}

      {gstr1 ? (
        <p className="gn-est__note">
          <strong>GSTR-1:</strong>{' '}
          {sections.length
            ? <>sections <span className="gn-chk__items">{sections.join(', ')}</span>,
              from {gstr1.invoice_count}{' '}
              {gstr1.invoice_count === 1 ? 'invoice' : 'invoices'}.</>
            : <>no section can be filled for this period.</>}
          {gstr1.reconciliation && (
            <> Reported taxable value {inr(Number(gstr1.reconciliation.reported_taxable_value || 0))}
              {' '}against {inr(Number(gstr1.reconciliation.source_taxable_value || 0))} on the
              invoices themselves — a difference of{' '}
              {inr(Number(gstr1.reconciliation.taxable_value_difference || 0))}.</>
          )}
        </p>
      ) : (
        <p className="gn-est__note">
          <strong>GSTR-1:</strong> unavailable for this period. Most often this is a
          missing organisation GSTIN — press the button above for the exact reason.
        </p>
      )}

      {notes.length > 0 && (
        <p className="gn-est__note">
          <strong>Not in the GSTR-1 file:</strong> {notes.join('; ')}. Kartavaya stores
          no link from a credit or debit note to the document it amends and no reason
          code, so the cdnr section is left out rather than filled with a note that
          cannot be tied to its original. Enter these on the portal yourself.
        </p>
      )}

      {held.length > 0 && (
        <ul className="gn-chk__list">
          <li className="gn-chk__i gn-chk__i--bad">
            <span className="gn-chk__t">
              {held.length} {held.length === 1 ? 'document is' : 'documents are'} held
              back from these exports
            </span>
            <span className="gn-chk__d">
              Each is missing something the export cannot invent. They are absent from
              the files above — fix them in Ganit → Invoices and export again.
            </span>
            {held.slice(0, 6).map((h) => (
              <span className="gn-chk__items" key={`${h.document}-${h.reason}`}>
                {h.document} — {h.reason}
              </span>
            ))}
            {held.length > 6 && (
              <span className="gn-chk__d">…and {held.length - 6} more.</span>
            )}
          </li>
        </ul>
      )}

      {omitted.length > 0 && (
        <p className="gn-est__note">
          <strong>GSTR-1 sections this file never carries:</strong>{' '}
          {omitted.map((o) => o.section).join(', ')}. Kartavaya has no store behind
          them, and an empty section reads as “there were none” to whoever files from
          it. They are omitted rather than sent blank.
        </p>
      )}
    </>
  );
}

export default function StatsTab() {
  const [period, setPeriod] = useState(currentMonth);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const doc = useDocumentDownload();
  const [challan, setChallan] = useState(BLANK_CHALLAN);
  const [challanOpen, setChallanOpen] = useState(false);

  // The export previews load INDEPENDENTLY of the GSTR-3B summary above. They
  // are a different question ("what would come out of the export?") answered by
  // different routes, and a failure in one must not blank the other — a screen
  // that hides the filing summary because an export preview 422'd would be
  // reporting the wrong problem.
  const [exportsInfo, setExportsInfo] = useState(null);
  const [exportsErr, setExportsErr] = useState(null);
  const [exportsLoading, setExportsLoading] = useState(true);

  const loadExports = useCallback(async () => {
    setExportsLoading(true);
    setExportsErr(null);
    try {
      // `allSettled`, not `all`: the GSTR-1 preview refuses when the org has no
      // GSTIN, and that refusal must not take the Tally figures down with it.
      const [g, t] = await Promise.allSettled([
        api.get(`/v1/documents/gst/gstr1/${period}/preview`),
        api.get(`/v1/documents/tally/${period}/preview`),
      ]);
      if (g.status === 'rejected' && t.status === 'rejected') {
        setExportsInfo(null);
        setExportsErr(t.reason);
        return;
      }
      setExportsInfo({
        gstr1: g.status === 'fulfilled' ? body(g.value) : null,
        gstr1Error: g.status === 'rejected' ? g.reason : null,
        tally: t.status === 'fulfilled' ? body(t.value) : null,
      });
    } catch (e) {
      setExportsInfo(null);
      setExportsErr(e);
    } finally {
      setExportsLoading(false);
    }
  }, [period]);

  useEffect(() => { loadExports(); }, [loadExports]);

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

              <p className="gn-est__note">
                Kartavaya is not a GSP and does not upload to the IRP — the working
                paper above is prepared for filing on the portal by hand or by your CA.
              </p>
            </div>

            <DocumentError
              error={EXPORT_KEYS.has(doc.error?.key) ? null : doc.error}
              onDismiss={doc.clear}
            />
          </section>

          {/* ── 3b · Data exports ───────────────────────────────────────────
              Two files for software the FIRM already runs. Neither is a return
              and neither is filed from here; see the note below, which says so
              on screen because the artefacts say so on their own face. */}
          <section className="gn-panel">
            <div className="gn-panel__head">
              <h3 className="gn-panel__h">
                Data exports<span className="dr__lbl-hi" lang="hi">निर्यात</span>
              </h3>
              <span className="gn-tbl__mute">{periodLabel(period)}</span>
            </div>

            <div className="gn-gst__acts">
              <button
                type="button"
                className="btn btn--out"
                disabled={doc.busy === 'gstr1'}
                onClick={() => doc.run('gstr1', {
                  url: `/v1/documents/gst/gstr1/${period}/json`,
                  filename: `Kartavaya-GSTR1-data-${period}.json`,
                  fallback: 'Could not build the GSTR-1 export',
                })}
              >
                {doc.busy === 'gstr1' ? 'Building…' : 'Export GSTR-1 JSON'}
              </button>
              <button
                type="button"
                className="btn btn--out"
                disabled={doc.busy === 'tally'}
                onClick={() => doc.run('tally', {
                  url: `/v1/documents/tally/${period}`,
                  filename: `Kartavaya-Tally-${period}.xml`,
                  fallback: 'Could not build the Tally export',
                })}
              >
                {doc.busy === 'tally' ? 'Building…' : 'Tally export (XML)'}
              </button>

              <p className="gn-est__note">
                Both files are <strong>your own data, for your own software</strong>.
                Neither is a return, neither is filed from Kartavaya, and neither
                states a tax liability. The GSTR-1 file is outward-supply data in the
                shape the GSTN offline utility reads; the Tally file is voucher XML
                that Tally Prime and ERP 9 both import.
              </p>

              {/* A refusal belongs against the button that was pressed. The
                  422 these routes answer says exactly WHY nothing came out —
                  "no place of supply on INV-2026-0004" — and that sentence is
                  the whole reason the backend refuses instead of sending an
                  empty file. */}
              <DocumentError
                error={EXPORT_KEYS.has(doc.error?.key) ? doc.error : null}
                onDismiss={doc.clear}
              />

              <ExportSummary
                loading={exportsLoading}
                error={exportsErr}
                onRetry={loadExports}
                info={exportsInfo}
              />
            </div>
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
