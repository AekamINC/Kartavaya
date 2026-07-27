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
import { useToast } from '../../components/ui/toast';
import FocusTrap from '../../components/ui/FocusTrap';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import { describeDocumentError } from '../../lib/docErrors';
import { useDocumentDownload } from '../../lib/documents';
import DocumentError from '../../components/ui/DocumentError';
import {
  safeArray, Badge, UpiPayBlock, waLink, waInvoiceText,
  INV_TYPE_LABELS, STATUS_COLORS, DOC_STATUS_COLORS, PAY_METHODS,
} from './_shared';

const NEXT_DOC_STATUS = { draft: 'final', final: 'sent', sent: 'viewed' };
const NEXT_DOC_LABEL = { draft: 'Mark final', final: 'Mark sent', sent: 'Mark viewed' };

export default function InvoiceDetail({ invoiceId, onClose, onChanged }) {
  const { pushToast } = useToast();
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);
  const [downloading, setDownloading] = useState(false);
  // A quotation rendered through the INVOICE route comes out as a tax invoice
  // wearing another name — an HSN column no offer needs, no validity date, and
  // the supplier's signature where the design has the client's acceptance
  // block. `/v1/documents/quotations/{id}/pdf` renders it against its own
  // specification; see `services/quotation_pdf.py`.
  const quote = useDocumentDownload();
  const [busy, setBusy] = useState('');
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
                  title={wa
                    ? 'Opens WhatsApp with the message ready — you choose the chat and press send'
                    : `${inv.contact_name || 'This customer'} has no phone number on their contact record`}
                  onClick={() => { if (wa) window.open(wa, '_blank', 'noopener,noreferrer'); }}
                >
                  Send on WhatsApp
                </button>

                {NEXT_DOC_STATUS[inv.doc_status] && (
                  <button type="button" className="btn btn--out btn--sm" disabled={!!busy}
                    onClick={() => advanceDoc(NEXT_DOC_STATUS[inv.doc_status])}>
                    {NEXT_DOC_LABEL[inv.doc_status]}
                  </button>
                )}

                {inv.invoice_type === 'quotation' && inv.estimate_status !== 'accepted' && inv.estimate_status !== 'converted' && (
                  <button type="button" className="btn btn--out btn--sm" disabled={!!busy} onClick={acceptEstimate}>
                    Accept estimate
                  </button>
                )}
                {inv.invoice_type === 'quotation' && inv.estimate_status === 'accepted' && (
                  <button type="button" className="btn btn--tonal btn--sm" disabled={!!busy} onClick={convertToInvoice}>
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
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowPay(v => !v)}>
                    {showPay ? 'Close' : 'Record payment'}
                  </button>
                )}
              </div>

              <DocumentError error={quote.error} onDismiss={quote.clear} />

              <div className="dr__body">
                {inv.contact_name && (
                  <section className="dr__sec">
                    <h3 className="dr__lbl">Billed to<span className="dr__lbl-hi" lang="hi">ग्राहक</span></h3>
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
                  <h3 className="dr__lbl">Line items<span className="dr__lbl-hi" lang="hi">वस्तुएँ</span></h3>
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
                    <h3 className="dr__lbl">Payments<span className="dr__lbl-hi" lang="hi">भुगतान</span></h3>
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

  return createPortal(panel, document.body);
}
