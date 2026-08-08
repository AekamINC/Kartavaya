// Ganit · one invoice — the record drawer.
//
// THE OWNER ASKED FOR THIS SPECIFICALLY: the invoice must open as a popup over
// the ledger and offer BOTH "Download PDF" and "Send on WhatsApp".
//
// What it replaces: `InvoicesTab` did `if (detail) return (…)` and swapped the
// entire tab for the record, with a "← Back to list" button as the only way
// out. That is a second navigation model for "open this row" — everywhere else
// in the product (the task drawer, Vikray's order drawer) opening a record
// opens a DRAWER over the list, and the model a user learns second is the one
// that costs them. Three sibling Ganit tabs had the same takeover; all four are
// drawers now.
//
// This is the shared `.dr` chrome, not one that resembles it: same scrim, same
// FocusTrap, same Escape handling, same exit animation that waits on
// `animationend` rather than a timer. Below 1024px drawer.css already gives it
// the full viewport.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, body } from '../../lib/api';
import InvoiceForm from './InvoiceForm';
import { useToast } from '../../components/ui/toast';
import FocusTrap from '../../components/ui/FocusTrap';
import { Modal } from '../../components/ui/modal';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import { describeDocumentError } from '../../lib/docErrors';
import { useDocumentDownload } from '../../lib/documents';
import DocumentError from '../../components/ui/DocumentError';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import {
  safeArray, Badge, UpiPayBlock, waLink, waInvoiceText, payLink, payLinkBlocker,
  INV_TYPE_LABELS, STATUS_COLORS, DOC_STATUS_COLORS, PAY_METHODS,
} from './_shared';

const NEXT_DOC_STATUS = { draft: 'final', final: 'sent', sent: 'viewed' };
const NEXT_DOC_LABEL = { draft: 'Mark final', final: 'Mark sent', sent: 'Mark viewed' };

export default function InvoiceDetail({ invoiceId, onClose, onChanged }) {
  const { pushToast } = useToast();
  // F32 — the module is read from the route, never named here. Everything
  // gated below MUTATES the ledger: advancing doc_status issues a tax invoice,
  // `Record payment` settles one, `Accept estimate` and `Convert to invoice`
  // both create documents. Reading the invoice stays open to a viewer, as does
  // `Download PDF` — the whole point of viewer.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change invoices' });
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [copied, setCopied] = useState(false);
  // A quotation rendered through the INVOICE route comes out as a tax invoice
  // wearing another name — an HSN column no offer needs, no validity date, and
  // the supplier's signature where the design has the client's acceptance
  // block. `/v1/documents/quotations/{id}/pdf` renders it against its own
  // specification; see `services/quotation_pdf.py`.
  const quote = useDocumentDownload();
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [payForm, setPayForm] = useState({ amount: '', payment_method: 'bank_transfer', reference: '', notes: '' });

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      // `GET /invoices/{id}` answers a bare object — `{invoice, payments}` —
      // not the `{data: […]}` envelope the LIST route uses. Same router, two
      // shapes; `body()` makes the call site indifferent.
      const r = await api.get(`/v1/ganit/invoices/${invoiceId}`);
      setDetail(body(r));
    } catch (e) {
      setErr(e);
      setDetail(null);
    }
  }, [invoiceId]);

  useEffect(() => { load(); }, [load]);

  const requestClose = useCallback(() => {
    closingRef.current = true;
    setClosing(true);
  }, []);

  const onExitEnd = useCallback(e => {
    if (e.target !== e.currentTarget || !closingRef.current) return;
    closingRef.current = false;
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); requestClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  async function run(label, fn, okMsg) {
    setBusy(label);
    try {
      await fn();
      if (okMsg) pushToast({ title: okMsg, type: 'success' });
      await load();
      onChanged?.();
      return true;
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || `Could not ${label}`, type: 'error' });
      return false;
    } finally { setBusy(''); }
  }

  const inv = detail?.invoice;

  async function downloadPdf() {
    if (!inv) return;
    setDownloading(true);
    try {
      const res = await api.get(`/v1/ganit/invoices/${inv.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${inv.invoice_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      // A 422 here is a refusal, not a failure: the invoice is missing a
      // mandatory GST particular and the backend declines to emit a document
      // that would look complete. A 409 is the same idea one level up — the
      // ORG has no GSTIN. Surface which field, not just "failed".
      const { title, message } = await describeDocumentError(e, 'Could not generate the PDF');
      pushToast({ title, message, type: 'error' });
    } finally { setDownloading(false); }
  }

  async function recordPayment(e) {
    e.preventDefault();
    const ok = await run('record the payment', () =>
      api.post(`/v1/ganit/invoices/${inv.id}/payments`, {
        ...payForm, amount: parseFloat(payForm.amount) || 0,
      }), 'Payment recorded');
    if (ok) {
      setShowPay(false);
      setPayForm({ amount: '', payment_method: 'bank_transfer', reference: '', notes: '' });
    }
  }

  const advanceDoc = to => run('update the status',
    () => api.patch(`/v1/ganit/invoices/${inv.id}/status`, { doc_status: to }),
    `Status is now ${to}`);

  const acceptEstimate = () => run('accept the estimate',
    () => api.post(`/v1/ganit/invoices/${inv.id}/accept-estimate`),
    'Estimate accepted');

  const convertToInvoice = () => run('convert the estimate', async () => {
    const r = await api.post(`/v1/ganit/invoices/${inv.id}/convert-to-invoice`);
    pushToast({ title: `Converted → ${body(r).invoice_number}`, type: 'success' });
    requestClose();
  });

  // Built here rather than in the handler so the button can be disabled — and
  // say WHY — when the contact carries no number, instead of failing on press.
  // Nothing is sent from this app: the link opens WhatsApp with the message
  // typed, and a human picks the chat and presses send.
  const wa = inv ? waLink(inv.contact_phone, waInvoiceText(inv)) : null;
  // Null for a draft or a settled invoice — `routers/pay.py` refuses both, so
  // the button that copies it is not rendered rather than copying a dead URL.
  const link = inv ? payLink(inv) : null;
  // Null when there IS a link. Rendered under the buttons so the sender learns
  // it before pressing send, not from the message afterwards.
  const blocker = inv ? payLinkBlocker(inv) : null;

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused outright in some embedded browsers. A
      // prompt the user can copy from by hand beats a button that does nothing.
      window.prompt('Copy the payment link:', link);
    }
  }

  async function emailInvoice() {
    if (!inv) return;
    setEmailing(true);
    try {
      const r = await api.post(`/v1/ganit/invoices/${inv.id}/email`);
      pushToast({
        title: `Sent to ${body(r).to}`,
        // Says which of the two went out. An invoice emailed without a payable
        // link is still a document delivered, and the sender should know which
        // one their customer received.
        message: body(r).pay_link_included
          ? 'PDF attached, with the payment link in the message.'
          : 'PDF attached. No payment link — this invoice is not in a shareable state.',
        type: 'success',
      });
      await load();
    } catch (e) {
      // Same treatment as the download: a 409/422 here is a refusal naming a
      // missing GST particular, not a failure.
      const { title, message } = await describeDocumentError(e, 'Could not email the invoice');
      pushToast({ title, message, type: 'error' });
    } finally { setEmailing(false); }
  }
  const items = safeArray(inv?.line_items);
  const settled = inv?.payment_status === 'paid' || inv?.payment_status === 'cancelled';
  // The quotation route accepts exactly these two types and answers 409 for
  // anything else, so the button is not offered where it cannot work.
  const isOffer = inv?.invoice_type === 'quotation' || inv?.invoice_type === 'proforma';

  const panel = (
    <div
      className={`dr__scrim${closing ? ' is-closing' : ''}`}
      role="presentation"
      onClick={e => e.target === e.currentTarget && requestClose()}
    >
      <FocusTrap active>
        <div
          className={`dr gnd${closing ? ' is-closing' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={inv ? `Invoice ${inv.invoice_number}` : 'Invoice'}
          onAnimationEnd={onExitEnd}
        >
          <header className="dr__head">
            <div className="dr__crumb">
              <span className="dr__crumb-p">Finance</span>
              <span className="dr__crumb-sep">/</span>
              <span className="dr__crumb-t">{inv ? inv.invoice_number : 'Invoice'}</span>
            </div>
            <div className="dr__acts">
              <button type="button" className="dr__ico" aria-label="Close" onClick={requestClose}>×</button>
            </div>
          </header>

          {err ? (
            <div className="dr__body">
              {/* Never an empty state. A failed fetch on a money screen that
                  renders as "nothing here" is a false statement about the
                  business, not a visibly broken page. */}
              <ErrorState kind={errorKind(err)} onRetry={load} />
            </div>
          ) : !inv ? (
            <div className="dr__body">
              <SkeletonRegion label="Loading the invoice">
                <SkeletonList rows={6} showAvatar={false} />
              </SkeletonRegion>
            </div>
          ) : (
            <>
              <div className="gnd__title">
                <h2 className="gnd__num">{inv.invoice_number}</h2>
                <span className="gnd__when">
                  {INV_TYPE_LABELS[inv.invoice_type] || inv.invoice_type}
                  {inv.invoice_date && ` · ${inv.invoice_date}`}
                  {inv.due_date && ` · due ${inv.due_date}`}
                </span>
                {inv.doc_status && (
                  <Badge text={inv.doc_status} color={DOC_STATUS_COLORS[inv.doc_status] || 'var(--on-surface-3)'} />
                )}
                <Badge text={inv.payment_status} color={STATUS_COLORS[inv.payment_status] || 'var(--on-surface-3)'} />
              </div>

              <div className="gnd__acts">
                <button type="button" className="btn btn--fill btn--sm" onClick={downloadPdf} disabled={downloading}>
                  {downloading ? 'Generating…' : 'Download PDF'}
                </button>

                {isOffer && (
                  <button
                    type="button"
                    className="btn btn--tonal btn--sm"
                    disabled={quote.busy === 'quotation'}
                    title="The offer rendered against the quotation specification — validity date, payment schedule and the client's acceptance block"
                    onClick={() => quote.run('quotation', {
                      url: `/v1/documents/quotations/${inv.id}/pdf`,
                      filename: `${inv.invoice_number || 'quotation'}.pdf`,
                      fallback: 'Could not generate the quotation',
                    })}
                  >
                    {quote.busy === 'quotation' ? 'Generating…' : 'Download quotation'}
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn--out btn--sm gnd__wa"
                  disabled={!wa}
                  title={!wa
                    ? `${inv.contact_name || 'This customer'} has no phone number on their contact record`
                    : blocker
                      ? `Opens WhatsApp with the message ready. ${blocker}`
                      : 'Opens WhatsApp with the payment link in the message — you choose the chat and press send'}
                  onClick={() => { if (wa) window.open(wa, '_blank', 'noopener,noreferrer'); }}
                >
                  Send on WhatsApp
                </button>

                {/* P5, option 3. The PDF is what an accounts department files;
                    the link is how it gets paid. One message carries both,
                    because sending either alone loses half the point.

                    The server reuses the PDF route, so an invoice it would
                    refuse to render — no supplier GSTIN, missing HSN — is one
                    it refuses to email, and the reason arrives here rather
                    than an invalid document arriving at a customer. */}
                <button
                  type="button"
                  className="btn btn--out btn--sm"
                  disabled={emailing || !inv.contact_email || !canWrite}
                  title={
                    !inv.contact_email
                      ? `${inv.contact_name || 'This customer'} has no email address on their contact record`
                      : denial || `Sends the PDF to ${inv.contact_email}, with the payment link in the message`
                  }
                  onClick={emailInvoice}
                >
                  {emailing ? 'Sending…' : 'Email invoice'}
                </button>

                {/* Copy, not "share": the owner pastes this wherever the
                    conversation already is. Only offered when the link would
                    actually work — a draft or a settled invoice 404s on the
                    public route, and a dead URL handed to a customer looks
                    like the product failed. */}
                {link && (
                  <button
                    type="button"
                    className="btn btn--out btn--sm"
                    onClick={copyLink}
                    title="The public payment page for this invoice — anyone with the link can view and pay it"
                  >
                    {copied ? 'Link copied' : 'Copy pay link'}
                  </button>
                )}

                {/* Edit — ANY UNPAID document, whatever its doc_status.
                    Owner's ruling 2026-08-03: "any invoice created and unpaid
                    can be amended and resent, same goes for quote."

                    It used to require `doc_status === 'draft'`, which hid this
                    button from every invoice the product creates by default —
                    `doc_status` DEFAULTS to 'final', including for one converted
                    from a Vikray order. That was the dead end: the PDF refuses a
                    line with no HSN under Rule 46(g) and tells the reader to fix
                    it "in Ganit → the invoice → Edit", while the status hid that
                    very control. Measured live: all six of Aekam Inc's invoices
                    were 'final' and four were incomplete — unissuable and
                    uncorrectable at the same time.

                    The server enforces the same rule and answers 409 with the
                    credit-note remedy named, so this button is the convenience
                    and not the control. */}
                {Number(inv.total || 0) - Number(inv.balance_due || 0) <= 0 && (
                  <button type="button" className="btn btn--out btn--sm"
                    disabled={!!busy || !canWrite} title={denial || undefined}
                    onClick={() => setEditing(true)}>
                    Edit
                  </button>
                )}

                {NEXT_DOC_STATUS[inv.doc_status] && (
                  <button type="button" className="btn btn--out btn--sm"
                    disabled={!!busy || !canWrite} title={denial || undefined}
                    onClick={() => advanceDoc(NEXT_DOC_STATUS[inv.doc_status])}>
                    {NEXT_DOC_LABEL[inv.doc_status]}
                  </button>
                )}

                {inv.invoice_type === 'quotation' && inv.estimate_status !== 'accepted' && inv.estimate_status !== 'converted' && (
                  <button type="button" className="btn btn--out btn--sm"
                    disabled={!!busy || !canWrite} title={denial || undefined} onClick={acceptEstimate}>
                    Accept estimate
                  </button>
                )}
                {inv.invoice_type === 'quotation' && inv.estimate_status === 'accepted' && (
                  <button type="button" className="btn btn--tonal btn--sm"
                    disabled={!!busy || !canWrite} title={denial || undefined} onClick={convertToInvoice}>
                    Convert to invoice
                  </button>
                )}
                {inv.estimate_status && (
                  <Badge
                    text={`Estimate: ${inv.estimate_status}`}
                    color={inv.estimate_status === 'accepted' ? 'var(--ok)'
                      : inv.estimate_status === 'rejected' ? 'var(--danger)' : 'var(--on-surface-3)'}
                  />
                )}
                {!settled && (
                  <button type="button" className="btn btn--ghost btn--sm"
                    disabled={!canWrite} title={denial || undefined}
                    onClick={() => setShowPay(v => !v)}>
                    {showPay ? 'Close' : 'Record payment'}
                  </button>
                )}
              </div>

              {/* WHY THE MESSAGE HAS NO LINK IN IT, said before the send rather
                  than discovered after.

                  The owner pressed Send on WhatsApp on a DRAFT and got the old
                  sentence — "Tax Invoice INV-2026-0088 dated 2026-08-08 for
                  ₹14,160." — which is precisely the message P5 exists to
                  replace. The code was right (a link to an unissued invoice
                  opens a dead page, and `routers/pay.py` 404s it), but a
                  silent fallback is indistinguishable from a feature that
                  never shipped.

                  The remedy is named because it is one button to the left. */}
              {blocker && (
                <p className="gnd__nolink" role="status">{blocker}</p>
              )}

              <DocumentError error={quote.error} onDismiss={quote.clear} />

              {/* What is missing from this document — INTERNAL ONLY.
                  Owner's ruling 2026-08-03: the invoice a customer reads stays
                  clean, with no red "NOT SET" markers, but the firm still has to
                  know before they send it. So the same check the PDF route runs
                  is reported here and nowhere else.

                  Blocking gaps stop the PDF outright, so they lead and say so.
                  Advisory ones render fine and are worth knowing — a missing
                  supplier GSTIN is normal below the registration threshold, and
                  wrong only if you ARE registered. */}
              {(detail?.document_check?.blocking?.length > 0
                || detail?.document_check?.advisory?.length > 0) && (
                <div className={`note ${detail.document_check.blocking.length ? 'note--warn' : 'note--info'} gnd__gaps`}>
                  <p className="gnd__gaps-t">
                    {detail.document_check.blocking.length > 0
                      ? `This invoice cannot be issued as a PDF yet — ${detail.document_check.blocking.length} required field${detail.document_check.blocking.length > 1 ? 's are' : ' is'} missing.`
                      : 'Worth checking before you send this — the PDF will still generate.'}
                    <span className="gnd__gaps-i"> Shown here only; the document itself stays clean.</span>
                  </p>
                  <ul className="gnd__gaps-l">
                    {[...detail.document_check.blocking, ...detail.document_check.advisory].map(g => (
                      <li key={g.field}><b>{g.label}</b> — {g.reason}{g.fix ? ` (${g.fix})` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="dr__body">
                {/* The editor replaces the record view rather than sitting
                    beside it: the fields it edits are the same ones displayed
                    below, and showing both invites the reader to trust whichever
                    one they looked at last. */}
                {inv.contact_name && (
                  <section className="dr__sec">
                    <h3 className="dr__lbl">Billed to<Secondary className="dr__lbl-hi" value="ग्राहक" /></h3>
                    <p className="gnd__party">
                      {inv.contact_name}
                      {inv.contact_company && <span className="gnd__co"> · {inv.contact_company}</span>}
                    </p>
                    {(inv.contact_gstin || inv.contact_email || inv.contact_phone) && (
                      <p className="gnd__contact">
                        {[
                          inv.contact_gstin && `GSTIN ${inv.contact_gstin}`,
                          inv.contact_email,
                          inv.contact_phone,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </section>
                )}

                <section className="dr__sec">
                  <h3 className="dr__lbl">Line items<Secondary className="dr__lbl-hi" value="वस्तुएँ" /></h3>
                  {items.length === 0 ? (
                    <p className="dr__empty">This invoice carries no lines.</p>
                  ) : (
                    <div className="tbl__wrap">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Description</th>
                            <th>HSN/SAC</th>
                            <th className="tbl__num">Qty</th>
                            <th className="tbl__num">Rate</th>
                            <th className="tbl__num">GST</th>
                            <th className="tbl__num">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((li, i) => (
                            <tr key={i}>
                              <td>{li.description || '—'}</td>
                              <td className="gnd__hsn">{li.hsn_code || li.sac_code || '—'}</td>
                              <td className="tbl__num">{li.quantity} {li.unit}</td>
                              <td className="tbl__num">{inr(Number(li.rate))}</td>
                              <td className="tbl__num">{li.gst_rate}%</td>
                              <td className="tbl__num">{inr(Number(li.line_total))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* Server figures, always. CGST/SGST vs IGST is the one piece of
                    GST logic that must not be got wrong, and `is_igst` already
                    splits it correctly on the row. */}
                <section className="dr__sec gnd__totwrap">
                  <dl className="gnd__tot">
                    <div className="gnd__totrow"><dt>Subtotal</dt><dd>{inr(Number(inv.subtotal))}</dd></div>
                    {inv.is_igst ? (
                      <div className="gnd__totrow gnd__totrow--sub"><dt>IGST</dt><dd>{inr(Number(inv.igst))}</dd></div>
                    ) : (
                      <>
                        <div className="gnd__totrow gnd__totrow--sub"><dt>CGST</dt><dd>{inr(Number(inv.cgst))}</dd></div>
                        <div className="gnd__totrow gnd__totrow--sub"><dt>SGST</dt><dd>{inr(Number(inv.sgst))}</dd></div>
                      </>
                    )}
                    {Number(inv.discount) > 0 && (
                      <div className="gnd__totrow gnd__totrow--off"><dt>Discount</dt><dd>−{inr(Number(inv.discount))}</dd></div>
                    )}
                    <div className="gnd__totrow gnd__totrow--tot"><dt>Total</dt><dd>{inr(Number(inv.total))}</dd></div>
                    {Number(inv.amount_paid) > 0 && (
                      <div className="gnd__totrow gnd__totrow--paid"><dt>Paid</dt><dd>{inr(Number(inv.amount_paid))}</dd></div>
                    )}
                    {Number(inv.balance_due) > 0 && (
                      <div className="gnd__totrow gnd__totrow--due"><dt>Balance due</dt><dd>{inr(Number(inv.balance_due))}</dd></div>
                    )}
                  </dl>
                </section>

                {(inv.sent_at || inv.viewed_at || inv.recurring_id) && (
                  <section className="dr__sec">
                    <p className="gnd__stamps">
                      {inv.sent_at && <span>Sent {new Date(inv.sent_at).toLocaleString('en-IN')}</span>}
                      {inv.viewed_at && <span>Viewed {new Date(inv.viewed_at).toLocaleString('en-IN')}</span>}
                      {inv.recurring_id && <span>Auto-generated from a recurring schedule</span>}
                    </p>
                  </section>
                )}

                {showPay && !settled && (
                  <form className="dr__sec gn-form gn-form--accent" onSubmit={recordPayment}>
                    <h4 className="gn-form__h">Record payment</h4>
                    <div className="gn-form__grid gn-form__grid--2 gn-form__grid--flush">
                      <label className="fld">
                        <span className="fld__l">Amount (₹)<span className="fld__req">*</span></span>
                        <input className="inp" type="number" step="0.01" required value={payForm.amount}
                          onChange={e => setPayForm({ ...payForm, amount: e.target.value })} />
                      </label>
                      <label className="fld">
                        <span className="fld__l">Method</span>
                        <select className="inp" value={payForm.payment_method}
                          onChange={e => setPayForm({ ...payForm, payment_method: e.target.value })}>
                          {PAY_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                        </select>
                      </label>
                      <label className="fld">
                        <span className="fld__l">Reference</span>
                        <input className="inp" placeholder="e.g. UTR, cheque no" value={payForm.reference}
                          onChange={e => setPayForm({ ...payForm, reference: e.target.value })} />
                      </label>
                      <label className="fld">
                        <span className="fld__l">Notes</span>
                        <input className="inp" value={payForm.notes}
                          onChange={e => setPayForm({ ...payForm, notes: e.target.value })} />
                      </label>
                    </div>
                    <div className="gn-form__acts">
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowPay(false)}>Cancel</button>
                      <button type="submit" className="btn btn--fill btn--sm" disabled={!!busy}>
                        {busy === 'record the payment' ? 'Recording…' : 'Record'}
                      </button>
                    </div>
                  </form>
                )}

                {detail.payments?.length > 0 && (
                  <section className="dr__sec">
                    <h3 className="dr__lbl">Payments<Secondary className="dr__lbl-hi" value="भुगतान" /></h3>
                    {detail.payments.map(p => (
                      <div key={p.id} className="gn-pay__row">
                        <span>
                          <span className="gn-pay__amt">{inr(Number(p.amount))}</span>
                          <span className="gn-pay__meta">{p.payment_method?.replace('_', ' ')}</span>
                          {p.reference && <span className="gn-pay__ref">{p.reference}</span>}
                        </span>
                        <span className="gn-pay__when">{p.payment_date}</span>
                      </div>
                    ))}
                  </section>
                )}

                <UpiPayBlock invoice={inv} />
              </div>
            </>
          )}
        </div>
      </FocusTrap>
    </div>
  );

  return createPortal(
    <>
      {panel}
      {/* THE EDITOR IS A CENTRED MODAL, NOT A SECTION INSIDE THE DRAWER.
          Owner's design, 2026-08-08. It used to replace the record view inside
          a ~480px drawer, and the seven-column line table cannot be read in
          that width — the reported bug was "Item" printing on top of "HSN/SAC".
          Widening the tracks and stacking on container width both stop the
          overlap, but neither makes a seven-column table READABLE in a drawer;
          only more width does that, and the drawer has none to give.

          `lg` is 900px, which fits every track at its full width with room
          left. Escape closes the modal alone — `Modal` stops the key reaching
          the drawer underneath, so one press does not close both. */}
      {inv && (
        <Modal
          open={editing}
          onOpenChange={setEditing}
          title={`Edit ${inv.invoice_number}`}
          size="lg"
          dataTestId="invoice-edit"
        >
          <InvoiceForm
            editing={inv}
            onCancel={() => setEditing(false)}
            onCreated={() => { setEditing(false); load(); onChanged?.(); }}
          />
        </Modal>
      )}
    </>,
    document.body,
  );
}
