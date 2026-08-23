// Procurement · one purchase order — the record drawer.
//
// Three quantities per line, not one: ordered, received, billed. The GAPS are
// what this screen exists to show — ordered > received is a late supplier,
// received > billed is the period-end accrual, billed > received is a vendor
// charging for goods that never came. A drawer that showed one quantity would
// be a document viewer, and the market already has plenty of those.
//
// Same `.dr` chrome as the vendor-bill drawer and Vikray's order drawer.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, body, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import FocusTrap from '../../components/ui/FocusTrap';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { DataTable, Td } from '../../components/editorial';
import DateInput from '../../components/ui/DateInput';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import { inr } from '../../lib/inr';
import { Badge, PO_STATUS_COLORS } from './_shared';

const LINE_COLUMNS = [
  '#', 'Description', 'HSN/SAC',
  { label: 'Ordered', align: 'right' },
  { label: 'Received', align: 'right' },
  { label: 'Billed', align: 'right' },
  { label: 'Rate', align: 'right' },
  { label: 'Line total', align: 'right' },
];

export default function PurchaseOrderDetail({ poId, onClose, onChanged }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'manage purchase orders' });
  const { pushToast } = useToast();
  const [po, setPo] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState(null);
  const [settings, setSettings] = useState(null);
  const [receipt, setReceipt] = useState({ po_line_id: '', qty: '', received_on: '', note: '' });
  const [closeReason, setCloseReason] = useState('');
  const [bills, setBills] = useState([]);
  const [linkBill, setLinkBill] = useState('');

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.get(`/v1/procurement/purchase-orders/${poId}`);
      setPo(body(r));
    } catch (e) { setErr(e); setPo(null); }
  }, [poId]);

  const loadMatch = useCallback(async () => {
    try {
      const r = await api.get(`/v1/procurement/purchase-orders/${poId}/match`);
      setMatch(body(r));
    } catch { setMatch(null); }
  }, [poId]);

  useEffect(() => { load(); loadMatch(); }, [load, loadMatch]);

  useEffect(() => {
    // The close-short reasons are the firm's own list; a free-text box here
    // would produce a reason nothing can report on.
    api.get('/v1/procurement/settings')
      .then(r => setSettings(body(r).data))
      .catch(() => setSettings(null));
  }, []);

  useEffect(() => {
    // Unlinked bills for THIS supplier, so the link control offers only bills
    // that could legitimately belong to this order.
    if (!po?.data?.vendor_id) return;
    api.get('/v1/ganit/vendor-bills', { params: { vendor_id: po.data.vendor_id } })
      .then(r => setBills(rows(r).filter(b => !b.po_id)))
      .catch(() => setBills([]));
  }, [po?.data?.vendor_id]);

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

  async function act(path, payload, okTitle) {
    setBusy(true);
    try {
      const r = await api.post(`/v1/procurement/purchase-orders/${poId}/${path}`, payload || {});
      pushToast({ title: okTitle, message: body(r).note || undefined, type: 'success' });
      await load();
      await loadMatch();
      onChanged?.();
      return true;
    } catch (e) {
      pushToast({
        title: e.response?.data?.detail || 'That could not be done',
        type: 'error',
      });
      return false;
    } finally { setBusy(false); }
  }

  async function saveReceipt(e) {
    e.preventDefault();
    if (!receipt.po_line_id) { pushToast({ title: 'Choose a line', type: 'error' }); return; }
    const qty = parseFloat(receipt.qty);
    if (!qty) { pushToast({ title: 'A receipt must record a quantity', type: 'error' }); return; }
    const ok = await act('receipts', { ...receipt, qty }, 'Receipt recorded');
    if (ok) setReceipt({ po_line_id: '', qty: '', received_on: '', note: '' });
  }

  async function doClose(e) {
    e.preventDefault();
    if (!closeReason) { pushToast({ title: 'Choose a reason', type: 'error' }); return; }
    await act('close', { reason: closeReason }, 'Order closed');
  }

  async function attachBill(e) {
    e.preventDefault();
    if (!linkBill) return;
    setBusy(true);
    try {
      await api.post(`/v1/procurement/vendor-bills/${linkBill}/link`, { po_id: poId });
      pushToast({ title: 'Bill linked to this order', type: 'success' });
      setLinkBill('');
      await load();
      await loadMatch();
      onChanged?.();
    } catch (e2) {
      pushToast({ title: e2.response?.data?.detail || 'Could not link the bill', type: 'error' });
    } finally { setBusy(false); }
  }

  async function detachBill(billId) {
    setBusy(true);
    try {
      await api.post(`/v1/procurement/vendor-bills/${billId}/link`, { po_id: null });
      pushToast({ title: 'Bill unlinked', type: 'success' });
      await load();
      await loadMatch();
      onChanged?.();
    } catch (e2) {
      pushToast({ title: e2.response?.data?.detail || 'Could not unlink the bill', type: 'error' });
    } finally { setBusy(false); }
  }

  const o = po?.data;
  const lines = po?.lines || [];
  const receipts = po?.receipts || [];
  const revisions = po?.revisions || [];
  const approvals = po?.approvals || [];
  const approval = po?.approval;
  const linked = po?.bills || [];
  const canReceive = o && ['issued', 'part_received', 'received'].includes(o.status);
  const write = canWrite && !busy;

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
          aria-label={o ? `Purchase order ${o.po_number || 'draft'}` : 'Purchase order'}
          onAnimationEnd={onExitEnd}
        >
          <header className="dr__head">
            <div className="dr__crumb">
              <span className="dr__crumb-p">Purchase orders</span>
              <span className="dr__crumb-sep">/</span>
              <span className="dr__crumb-t">{o ? (o.po_number || 'Draft') : 'Order'}</span>
            </div>
            <div className="dr__acts">
              <button type="button" className="dr__ico" aria-label="Close" onClick={requestClose}>×</button>
            </div>
          </header>

          {err ? (
            <div className="dr__body"><ErrorState kind={errorKind(err)} onRetry={load} /></div>
          ) : !o ? (
            <div className="dr__body">
              <SkeletonRegion label="Loading the purchase order">
                <SkeletonList rows={5} showAvatar={false} />
              </SkeletonRegion>
            </div>
          ) : (
            <>
              <div className="gnd__title">
                <h2 className="gnd__num">{o.po_number || 'Not yet numbered'}</h2>
                <span className="gnd__when">
                  {o.vendor_name}
                  {o.po_date && ` · ${o.po_date}`}
                  {o.expected_date && ` · expected ${o.expected_date}`}
                  {o.revision > 0 && ` · revision ${o.revision}`}
                </span>
                <Badge text={o.status} color={PO_STATUS_COLORS[o.status] || 'var(--on-surface-3)'} />
              </div>

              <div className="dr__body">
                {!o.po_number && (
                  <p className="note" role="status">
                    A draft carries no number. The serial is minted when the
                    order is issued, so a discarded draft leaves no gap in the
                    series.
                  </p>
                )}

                {/* ── The workflow ─────────────────────────────────── */}
                <div className="gn-bar">
                  {['draft', 'rejected'].includes(o.status) && (
                    <button
                      type="button" className="btn btn--fill btn--sm" disabled={!write}
                      title={denial || undefined}
                      onClick={() => act('submit', {}, 'Sent on its way')}
                    >
                      Submit
                    </button>
                  )}
                  {o.status === 'awaiting_approval' && approval?.caller_may_approve && (
                    <>
                      <button
                        type="button" className="btn btn--fill btn--sm" disabled={!write}
                        onClick={() => act('approve', {}, 'Approved')}
                      >
                        Approve
                      </button>
                      <button
                        type="button" className="btn btn--ghost btn--sm" disabled={!write}
                        onClick={() => act('reject', {}, 'Rejected')}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {o.status === 'awaiting_approval' && !approval?.caller_may_approve && (
                    <span className="gn-row__meta">{approval?.caller_may_not_because}</span>
                  )}
                </div>

                {approval?.required && (
                  <div className="gn-panel">
                    <h3 className="gn-panel__h">
                      Approval<Secondary className="dr__lbl-hi" value="अनुमोदन" />
                    </h3>
                    <div className="gn-facts">
                      <div>
                        Rule <span className="gn-facts__v">{approval.rule_name || '—'}</span>
                      </div>
                      <div>
                        Recorded{' '}
                        <span className="gn-facts__v">
                          {approval.decisions_this_revision} of {approval.approvers_required}
                        </span>
                      </div>
                    </div>
                    {approvals.length > 0 && (
                      <div>
                        {approvals.map((a, i) => (
                          <div className="gn-sig__row" key={`${a.revision}-${i}`}>
                            <span className="gn-sig__name">{a.approver_name}</span>
                            <span className="gn-sig__r">
                              {a.decision === 'approved' ? 'Approved' : 'Rejected'}
                              {a.note ? ` — ${a.note}` : ''}
                            </span>
                            <span className="gn-sig__when">rev {a.revision}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── The three quantities ─────────────────────────── */}
                <h3 className="gn-panel__h">
                  Lines<Secondary className="dr__lbl-hi" value="पंक्तियाँ" />
                </h3>
                <DataTable columns={LINE_COLUMNS}>
                  {lines.map(l => (
                    <tr className="gn-tbl__row" key={l.id}>
                      <Td>{l.line_no}</Td>
                      <Td bold>{l.description}</Td>
                      <Td>{l.hsn_code || l.sac_code || '—'}</Td>
                      <Td align="right">{Number(l.qty_ordered)} {l.unit}</Td>
                      <Td align="right">{Number(l.qty_received)}</Td>
                      <Td align="right">{Number(l.qty_billed)}</Td>
                      <Td align="right">{inr(Number(l.rate), { decimals: 2 })}</Td>
                      <Td align="right">{inr(Number(l.line_total), { decimals: 2 })}</Td>
                    </tr>
                  ))}
                </DataTable>

                <div className="gn-tot">
                  <div className="gn-tot__r">
                    <span className="gn-tot__l">Subtotal</span>
                    <span className="gn-tot__v">{inr(Number(o.subtotal), { decimals: 2 })}</span>
                  </div>
                  {o.is_igst ? (
                    <div className="gn-tot__r">
                      <span className="gn-tot__l">IGST</span>
                      <span className="gn-tot__v">{inr(Number(o.igst), { decimals: 2 })}</span>
                    </div>
                  ) : (
                    <>
                      <div className="gn-tot__r">
                        <span className="gn-tot__l">CGST</span>
                        <span className="gn-tot__v">{inr(Number(o.cgst), { decimals: 2 })}</span>
                      </div>
                      <div className="gn-tot__r">
                        <span className="gn-tot__l">SGST</span>
                        <span className="gn-tot__v">{inr(Number(o.sgst), { decimals: 2 })}</span>
                      </div>
                    </>
                  )}
                  <div className="gn-tot__r gn-tot__r--sum">
                    <span className="gn-tot__l">Total</span>
                    <span className="gn-tot__v">{inr(Number(o.total), { decimals: 2 })}</span>
                  </div>
                  <p className="gn-tot__note">
                    {o.is_igst
                      ? 'Inter-state supply, so the whole tax is IGST.'
                      : 'Intra-state supply, so the tax splits CGST and SGST.'}
                    {o.place_of_supply ? ` Place of supply ${o.place_of_supply}.` : ''}
                  </p>
                </div>

                {/* ── Receiving ────────────────────────────────────── */}
                {canReceive && (
                  <form className="gn-form" onSubmit={saveReceipt}>
                    <h4 className="gn-form__h">Record a delivery</h4>
                    <div className="gn-form__grid gn-form__grid--2">
                      <label className="fld">
                        <span className="fld__l">Line<span className="fld__req">*</span></span>
                        <select
                          className="inp" required value={receipt.po_line_id}
                          onChange={e => setReceipt({ ...receipt, po_line_id: e.target.value })}
                        >
                          <option value="">Select…</option>
                          {lines.map(l => (
                            <option key={l.id} value={l.id}>
                              {l.line_no}. {l.description} — {Number(l.qty_received)} of {Number(l.qty_ordered)} {l.unit}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="fld">
                        <span className="fld__l">Quantity<span className="fld__req">*</span></span>
                        <input
                          className="inp" type="number" step="any" required value={receipt.qty}
                          onChange={e => setReceipt({ ...receipt, qty: e.target.value })}
                        />
                      </label>
                      <label className="fld">
                        <span className="fld__l">Received on</span>
                        <DateInput
                          className="inp" type="date" value={receipt.received_on}
                          onChange={e => setReceipt({ ...receipt, received_on: e.target.value })}
                        />
                      </label>
                      <label className="fld">
                        <span className="fld__l">Note</span>
                        <input
                          className="inp" value={receipt.note}
                          onChange={e => setReceipt({ ...receipt, note: e.target.value })}
                        />
                      </label>
                    </div>
                    <p className="gn-tot__note">
                      A negative quantity records a return. The first delivery
                      sets the acceptance date on any bill linked to this order,
                      which is what the MSME payment clock runs from.
                    </p>
                    <div className="gn-form__acts">
                      <button type="submit" className="btn btn--fill btn--sm" disabled={!write}
                        title={denial || undefined}>
                        Record receipt
                      </button>
                    </div>
                  </form>
                )}

                {receipts.length > 0 && (
                  <div className="gn-panel">
                    <h3 className="gn-panel__h">
                      Deliveries<Secondary className="dr__lbl-hi" value="प्राप्ति" />
                    </h3>
                    <div className="gn-pay__row" />
                    {receipts.map(r => (
                      <div className="gn-pay__row" key={r.id}>
                        <span className="gn-pay__amt">{Number(r.qty)}</span>
                        <span className="gn-pay__when">{r.received_on}</span>
                        <span className="gn-pay__meta">
                          {r.received_by_name}{r.note ? ` — ${r.note}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Bills against this order ─────────────────────── */}
                <div className="gn-panel">
                  <h3 className="gn-panel__h">
                    Bills against this order<Secondary className="dr__lbl-hi" value="बिल" />
                  </h3>
                  {linked.length === 0 ? (
                    <p className="gn-tot__note">
                      No bill has been linked yet. A bill without a purchase
                      order is perfectly legal — linking one is what enables the
                      three-way match.
                    </p>
                  ) : linked.map(b => (
                    <div className="gn-pay__row" key={b.id}>
                      <span className="gn-pay__ref">{b.internal_ref}</span>
                      <span className="gn-pay__amt">{inr(Number(b.total), { decimals: 2 })}</span>
                      <span className="gn-pay__when">{b.bill_date}</span>
                      <button
                        type="button" className="btn btn--ghost btn--sm"
                        disabled={!write} onClick={() => detachBill(b.id)}
                      >
                        Unlink
                      </button>
                    </div>
                  ))}
                  {canReceive && bills.length > 0 && (
                    <form className="gn-bar" onSubmit={attachBill}>
                      <label className="gn-bar__f">
                        <span className="gn-bar__fl">Link a bill</span>
                        <select
                          className="inp gn-bar__sel" value={linkBill}
                          onChange={e => setLinkBill(e.target.value)}
                        >
                          <option value="">Select…</option>
                          {bills.map(b => (
                            <option key={b.id} value={b.id}>
                              {b.internal_ref} — {inr(Number(b.total))}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" className="btn btn--ghost btn--sm" disabled={!write || !linkBill}>
                        Link
                      </button>
                    </form>
                  )}
                </div>

                {/* ── The three-way match ──────────────────────────── */}
                {/* `exceptions` is defaulted rather than assumed. The match
                    response is the one payload in this drawer that a partial
                    or older server could answer without it, and a `.length` on
                    undefined does not degrade — it takes the whole drawer down
                    with a white screen, hiding the order as well as the match. */}
                {match && (
                  <div className={`gn-panel${match.matched ? ' gn-panel--ok' : ' gn-panel--warn'}`}>
                    <h3 className="gn-panel__h">
                      Three-way match<Secondary className="dr__lbl-hi" value="मिलान" />
                    </h3>
                    {(match.exceptions || []).length === 0 ? (
                      <p className="gn-tot__note">
                        Order, receipts and bills agree. Nothing is approved
                        automatically on the strength of that.
                      </p>
                    ) : (
                      <div className="gn-chk__list">
                        {(match.exceptions || []).map((x, i) => (
                          <div
                            className={`gn-chk__i${x.severity === 'high' ? ' gn-chk__i--bad' : ''}`}
                            key={`${x.kind}-${i}`}
                          >
                            <span className="gn-chk__t">
                              {x.line_no ? `Line ${x.line_no}` : 'This order'}
                            </span>
                            <span className="gn-chk__d">{x.detail}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="gn-tot__note">{match.basis}</p>
                  </div>
                )}

                {/* ── Revisions ────────────────────────────────────── */}
                {revisions.length > 0 && (
                  <div className="gn-panel">
                    <h3 className="gn-panel__h">
                      Revision history<Secondary className="dr__lbl-hi" value="संशोधन" />
                    </h3>
                    {revisions.map(rv => (
                      <div className="gn-pay__row" key={rv.revision}>
                        <span className="gn-pay__ref">Revision {rv.revision}</span>
                        <span className="gn-pay__when">{String(rv.changed_at).slice(0, 10)}</span>
                        <span className="gn-pay__meta">
                          {rv.changed_by_name}
                          {rv.reason ? ` — ${rv.reason}` : ''}
                          {rv.re_approved ? ' · went back for approval' : ''}
                        </span>
                      </div>
                    ))}
                    <p className="gn-tot__note">
                      Each revision keeps the order exactly as it stood before
                      the change. The original is never destroyed.
                    </p>
                  </div>
                )}

                {/* ── Close short ──────────────────────────────────── */}
                {canReceive && (
                  <form className="gn-form" onSubmit={doClose}>
                    <h4 className="gn-form__h">Close this order short</h4>
                    <div className="gn-form__grid gn-form__grid--2">
                      <label className="fld">
                        <span className="fld__l">Reason<span className="fld__req">*</span></span>
                        <select
                          className="inp" value={closeReason}
                          onChange={e => setCloseReason(e.target.value)}
                        >
                          <option value="">Select…</option>
                          {(settings?.close_reasons || []).map(r => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="gn-tot__note">
                      Without this, a partly-fulfilled order sits open for ever
                      and the committed-spend figure is permanently wrong. The
                      reason comes from your firm's own list so a report can
                      group by it.
                    </p>
                    <div className="gn-form__acts">
                      <button type="submit" className="btn btn--ghost btn--sm" disabled={!write}
                        title={denial || undefined}>
                        Close short
                      </button>
                    </div>
                  </form>
                )}

                {o.status === 'closed' && o.closed_reason && (
                  <p className="note" role="status">
                    Closed short: {o.closed_reason}
                  </p>
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
