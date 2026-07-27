// Ganit · one vendor bill — the record drawer.
//
// Replaces another `if (detail) return (…)` full-panel takeover. Same `.dr`
// chrome as the invoice drawer and Vikray's order drawer.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import FocusTrap from '../../components/ui/FocusTrap';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import { safeArray, Badge, BILL_STATUS_COLORS } from './_shared';

export default function VendorBillDetail({ billId, onClose, onChanged }) {
  const { pushToast } = useToast();
  const [bill, setBill] = useState(null);
  const [err, setErr] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);
  // Set only when the server has actually refused. Ganit is a separated-duty
  // module — holding `admin` does NOT confer `approver` — and paying a vendor
  // bill is one of the two actions gated on `approver`, because money leaves
  // the company. The control is not hidden on a guess about the caller's level;
  // it is disabled once the server has said no, with the reason.
  const [denied, setDenied] = useState(false);

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      // Bare object with the bill's own columns at the top level plus
      // `payments` — NOT a `{data: …}` envelope and not `{bill: …}`.
      const r = await api.get(`/v1/ganit/vendor-bills/${billId}`);
      setBill(body(r));
    } catch (e) {
      setErr(e);
      setBill(null);
    }
  }, [billId]);

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

  async function recordPayment(e) {
    e.preventDefault();
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { pushToast({ title: 'Enter an amount above zero', type: 'error' }); return; }
    setPaying(true);
    try {
      await api.post(`/v1/ganit/vendor-bills/${billId}/payments`, { amount: amt });
      pushToast({ title: 'Payment recorded', type: 'success' });
      setPayAmount('');
      await load();
      onChanged?.();
    } catch (e2) {
      if (e2.response?.status === 403) {
        setDenied(true);
        pushToast({
          title: 'You cannot release payment on this bill',
          message: 'Paying a vendor needs the approver level in Finance. Administering the books and releasing money are deliberately separate authorities here.',
          type: 'error',
        });
      } else {
        pushToast({ title: e2.response?.data?.detail || 'Could not record the payment', type: 'error' });
      }
    } finally { setPaying(false); }
  }

  const items = safeArray(bill?.line_items);
  const balance = bill ? Number(bill.total || 0) - Number(bill.amount_paid || 0) : 0;
  const settled = bill?.status === 'paid' || bill?.status === 'cancelled';

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
          aria-label={bill ? `Vendor bill ${bill.internal_ref}` : 'Vendor bill'}
          onAnimationEnd={onExitEnd}
        >
          <header className="dr__head">
            <div className="dr__crumb">
              <span className="dr__crumb-p">Payables</span>
              <span className="dr__crumb-sep">/</span>
              <span className="dr__crumb-t">{bill ? bill.internal_ref : 'Bill'}</span>
            </div>
            <div className="dr__acts">
              <button type="button" className="dr__ico" aria-label="Close" onClick={requestClose}>×</button>
            </div>
          </header>

          {err ? (
            <div className="dr__body"><ErrorState kind={errorKind(err)} onRetry={load} /></div>
          ) : !bill ? (
            <div className="dr__body">
              <SkeletonRegion label="Loading the bill">
                <SkeletonList rows={5} showAvatar={false} />
              </SkeletonRegion>
            </div>
          ) : (
            <>
              <div className="gnd__title">
                <h2 className="gnd__num">{bill.internal_ref}</h2>
                <span className="gnd__when">
                  {bill.vendor_name}
                  {bill.bill_date && ` · ${bill.bill_date}`}
                  {bill.due_date && ` · due ${bill.due_date}`}
                </span>
                <Badge text={bill.status} color={BILL_STATUS_COLORS[bill.status] || 'var(--on-surface-3)'} />
              </div>

              <div className="dr__body">
                <section className="dr__sec">
                  <div className="gn-facts">
                    <div>Total <span className="gn-facts__v">{inr(Number(bill.total || 0))}</span></div>
                    <div>Paid <span className="gn-facts__v">{inr(Number(bill.amount_paid || 0))}</span></div>
                    <div>Balance <span className="gn-facts__v">{inr(balance)}</span></div>
                  </div>
                </section>

                {!settled && (
                  <section className="dr__sec">
                    <h3 className="dr__lbl">Release payment<span className="dr__lbl-hi" lang="hi">भुगतान</span></h3>
                    {denied ? (
                      <p className="note note--warn" role="status">
                        Paying a vendor needs the <b>approver</b> level in Finance (गणित). Administering
                        the books and releasing money are separate authorities here, so an admin grant
                        does not carry it. Ask an organisation admin for the approver level, or ask
                        somebody who holds it to release this bill.
                      </p>
                    ) : (
                      <form className="gn-payline" onSubmit={recordPayment}>
                        <label className="fld">
                          <span className="fld__l">Amount (₹)</span>
                          <input className="inp gn-payline__in" type="number" step="0.01" min="0"
                            value={payAmount} onChange={e => setPayAmount(e.target.value)} />
                        </label>
                        <button type="submit" className="btn btn--fill btn--sm" disabled={paying}>
                          {paying ? 'Recording…' : 'Record payment'}
                        </button>
                      </form>
                    )}
                  </section>
                )}

                <section className="dr__sec">
                  <h3 className="dr__lbl">Line items<span className="dr__lbl-hi" lang="hi">वस्तुएँ</span></h3>
                  {items.length === 0 ? (
                    <p className="dr__empty">This bill carries no lines.</p>
                  ) : (
                    <div className="tbl__wrap">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Description</th>
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

                {bill.payments?.length > 0 && (
                  <section className="dr__sec">
                    <h3 className="dr__lbl">Payments<span className="dr__lbl-hi" lang="hi">भुगतान</span></h3>
                    {bill.payments.map(p => (
                      <div key={p.id} className="gn-pay__row">
                        <span>
                          <span className="gn-pay__amt">{inr(Number(p.amount))}</span>
                          {/* `method`, not `payment_method` — vendor payments and
                              invoice payments are different tables with different
                              column names. */}
                          {p.method && <span className="gn-pay__meta">{String(p.method).replace('_', ' ')}</span>}
                          {p.reference && <span className="gn-pay__ref">{p.reference}</span>}
                        </span>
                        <span className="gn-pay__when">{p.payment_date}</span>
                      </div>
                    ))}
                  </section>
                )}

                {bill.notes && (
                  <section className="dr__sec">
                    <h3 className="dr__lbl">Notes<span className="dr__lbl-hi" lang="hi">टिप्पणी</span></h3>
                    <p className="gnd__contact">{bill.notes}</p>
                  </section>
                )}
              </div>
            </>
          )}
        </div>
      </FocusTrap>
    </div>
  );

  return createPortal(panel, document.body);
}
