// Vikray · one order — the record drawer.
//
// 27-vikray.md §6: the build replaced the whole tab with the detail view and a
// "Back to list" button, while everywhere else in the product opening a record
// opens a DRAWER over the list. Two navigation models for "open this row" is a
// learned inconsistency, and it is the one the user learns second that costs
// them. This is the shared `.dr` chrome the task drawer uses — scrim, focus
// trap, Escape, exit animation — so it is the same object, not one that
// resembles it. Below 1024px it takes the full viewport, which is what the task
// drawer already does on a phone.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { StatusBar } from '../../components/ui/StatusBar';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import FocusTrap from '../../components/ui/FocusTrap';
import Tag from '../../components/ui/Tag';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import LineItemEditor from '../../components/LineItemEditor';
import { inr } from '../../lib/inr';
import { orderColor, ORDER_LABELS } from '../../lib/statusColors';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import {
  FLOW_STAGES, nextStatus, ADVANCE_LABEL, asItems, lineAmount,
  previewTotals, useGanitAccess, probeGanit,
} from './_shared';

export default function OrderDetail({ orderId, onClose, onChanged }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change orders' });
  const { pushToast } = useToast();
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  // Editing
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState([]);

  const ganit = useGanitAccess();

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.get(`/v1/vikray/orders/${orderId}`);
      setOrder(r.data);
    } catch (e) {
      setErr(e);
      setOrder(null);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { probeGanit().then(r => setProducts(r.products)); }, []);

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

  const advance = to => run('advance the order',
    () => api.patch(`/v1/vikray/orders/${orderId}/status`, { status: to }),
    `Order is now ${ORDER_LABELS[to]?.toLowerCase() || to}`);

  const invoice = () => run('generate the invoice', async () => {
    const r = await api.post(`/v1/vikray/orders/${orderId}/invoice`);
    pushToast({ title: `Invoice ${r.data.invoice_number} created in Finance`, type: 'success' });
  });

  const cancel = () => run('cancel the order',
    () => api.delete(`/v1/vikray/orders/${orderId}`),
    'Order cancelled').then(ok => { if (ok) requestClose(); });

  function startEdit() {
    setDraft({
      expected_delivery: order.expected_delivery || '',
      discount: Number(order.discount || 0),
      notes: order.notes || '',
      line_items: asItems(order.line_items).map(li => ({ ...li })),
    });
    setEditing(true);
  }

  async function saveEdit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/v1/vikray/orders/${orderId}`, draft);
      pushToast({ title: 'Order updated', type: 'success' });
      setEditing(false);
      await load();
      onChanged?.();
    } catch (e2) {
      pushToast({ title: e2.response?.data?.detail || 'Could not update the order', type: 'error' });
    } finally { setSaving(false); }
  }

  const o = order;
  const items = o ? asItems(o.line_items) : [];
  const next = o ? nextStatus(o.status) : null;
  const cancelled = o?.status === 'cancelled';
  // The backend refuses a PATCH on anything but a draft ("Only draft orders can
  // be edited", routers/vikray.py:244) while the old UI offered Edit on
  // `confirmed` as well — a button that always 400ed. It matches the server now.
  const canEdit = o?.status === 'draft';
  const canCancel = o?.status === 'draft' || o?.status === 'confirmed';
  const canInvoice = o && o.status !== 'draft' && !o.invoice_id && !cancelled;
  const preview = editing && draft ? previewTotals(draft.line_items, draft.discount) : null;

  const body = (
    <>
      <div
        className={`dr__scrim${closing ? ' is-closing' : ''}`}
        role="presentation"
        onClick={e => e.target === e.currentTarget && requestClose()}
      >
        <FocusTrap active>
          <div
            className={`dr vkd${closing ? ' is-closing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={o ? `Sales order ${o.order_number}` : 'Sales order'}
            onAnimationEnd={onExitEnd}
          >
            <header className="dr__head">
              <div className="dr__crumb">
                <span className="dr__crumb-p">Sales</span>
                <span className="dr__crumb-sep">/</span>
                <span className="dr__crumb-t">{o ? o.order_number : 'Order'}</span>
              </div>
              <div className="dr__acts">
                <button type="button" className="dr__ico" aria-label="Close" onClick={requestClose}>×</button>
              </div>
            </header>

            {err ? (
              <div className="dr__body">
                <ErrorState kind={errorKind(err)} onRetry={load} />
              </div>
            ) : !o ? (
              <div className="dr__body">
                <SkeletonRegion label="Loading the order"><SkeletonList rows={6} showAvatar={false} /></SkeletonRegion>
              </div>
            ) : (
              <>
                <div className="vkd__title">
                  <h2 className="vkd__num">{o.order_number}</h2>
                  <span className="vkd__when">
                    {o.order_date}
                    {o.expected_delivery && ` · delivery ${o.expected_delivery}`}
                  </span>
                  {cancelled && <Tag color={orderColor('cancelled')}>Cancelled</Tag>}
                  {o.invoice_id && <Tag color="var(--ok)">Invoiced</Tag>}
                </div>

                {/* The pipeline, not a button whose label changes (27 §3). It is
                    read-only here: the only legal move is the next one, and the
                    server enforces that — a clickable segment that 400s on four
                    of its five targets teaches the user the control is broken. */}
                {!cancelled && (
                  <div className="dr__pipe-wrap">
                    <StatusBar stages={FLOW_STAGES} current={o.status} />
                  </div>
                )}

                <div className="vkd__acts">
                  {next && !cancelled && (
                    <button type="button" className="btn btn--fill btn--sm" disabled={!!busy || !canWrite}
                      onClick={() => advance(next)} title={denial || undefined}>
                      {busy === 'advance the order' ? 'Working…' : ADVANCE_LABEL[o.status]}
                    </button>
                  )}

                  {/* 27 §11 — invoicing reaches into Ganit, which is a sensitive
                      module. When the grant is missing the control is absent and
                      the reason is stated, rather than a dead button or a 403 the
                      user has to press to discover. */}
                  {canInvoice && ganit !== false && (
                    <button type="button" className="btn btn--out btn--sm" disabled={!!busy}
                      onClick={() => invoice()}>
                      {busy === 'generate the invoice' ? 'Working…' : 'Generate invoice'}
                    </button>
                  )}

                  {canEdit && !editing && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={startEdit}>Edit</button>
                  )}
                  {canCancel && (
                    <button
                      type="button" className="btn btn--danger btn--sm" disabled={!!busy || !canWrite}
                      onClick={() => setConfirm({
                        title: `Cancel ${o.order_number}?`,
                        message: o.status === 'confirmed'
                          ? 'The order is withdrawn and any stock it reserved is returned to the ledger. This cannot be undone.'
                          : 'The order is withdrawn. This cannot be undone.',
                        confirmLabel: 'Cancel order',
                        onConfirm: cancel,
                      })} title={denial || undefined}>
                      Cancel order
                    </button>
                  )}
                </div>

                {canInvoice && ganit === false && (
                  <p className="note vkd__gate" role="status">
                    {/* `गणित` was here, inside the <b>. Three separate faults in
                        one run: 24 §"where it must not" puts error and denial
                        text on the No list (a user reading a refusal for the
                        first time is not helped by half of it in a second
                        script); `.note` resolves to --font-ui, which has no
                        Devanagari coverage, so the glyphs fell through to a
                        system face — measured 89.45px against Tiro's 85.45px;
                        and <b> asked weight 600 of a font that ships only 400.
                        The module is named in English, which is what the rest
                        of this sentence is. */}
                    An invoice is an accounting record, so raising one needs a
                    <b> Finance</b> grant as well as Sales. Ask an organisation
                    admin, or ask somebody in Finance to raise it from this order.
                  </p>
                )}

                <div className="dr__body">
                  {(o.contact_name || o.contact_company) && (
                    <section className="dr__sec">
                      <h3 className="dr__lbl">Customer<Secondary className="dr__lbl-hi" value="ग्राहक" /></h3>
                      <p className="vkd__party">
                        {o.contact_name || o.contact_company}
                        {o.contact_name && o.contact_company && <span className="vkd__co"> · {o.contact_company}</span>}
                      </p>
                      {(o.contact_email || o.contact_phone) && (
                        <p className="vkd__contact">{[o.contact_email, o.contact_phone].filter(Boolean).join(' · ')}</p>
                      )}
                    </section>
                  )}

                  <section className="dr__sec">
                    <h3 className="dr__lbl">Line items<Secondary className="dr__lbl-hi" value="वस्तुएँ" /></h3>
                    {items.length === 0 ? (
                      <p className="dr__empty">This order carries no lines.</p>
                    ) : (
                      <div className="tbl__wrap">
                        <table className="tbl">
                          <thead>
                            <tr>
                              <th>Description</th>
                              <th>HSN</th>
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
                                <td className="vkd__hsn">{li.hsn_code || '—'}</td>
                                <td className="tbl__num">{li.quantity} {li.unit}</td>
                                <td className="tbl__num">{inr(li.rate)}</td>
                                <td className="tbl__num">{li.gst_rate}%</td>
                                <td className="tbl__num vkd__amt">{inr(lineAmount(li))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  {/* Server figures, always. CGST/SGST vs IGST is the one piece
                      of GST logic that must not be got wrong, and `is_igst`
                      already splits it correctly. */}
                  <section className="dr__sec vkd__totwrap">
                    <dl className="vkd__tot">
                      <div className="vkd__totrow"><dt>Subtotal</dt><dd>{inr(o.subtotal)}</dd></div>
                      {o.is_igst ? (
                        <div className="vkd__totrow vkd__totrow--sub"><dt>IGST</dt><dd>{inr(o.igst)}</dd></div>
                      ) : (
                        <>
                          <div className="vkd__totrow vkd__totrow--sub"><dt>CGST</dt><dd>{inr(o.cgst)}</dd></div>
                          <div className="vkd__totrow vkd__totrow--sub"><dt>SGST</dt><dd>{inr(o.sgst)}</dd></div>
                        </>
                      )}
                      {Number(o.discount) > 0 && (
                        <div className="vkd__totrow vkd__totrow--off"><dt>Discount</dt><dd>−{inr(o.discount)}</dd></div>
                      )}
                      <div className="vkd__totrow vkd__totrow--tot"><dt>Total</dt><dd>{inr(o.total)}</dd></div>
                    </dl>
                  </section>

                  {o.notes && !editing && (
                    <section className="dr__sec">
                      <h3 className="dr__lbl">Notes<Secondary className="dr__lbl-hi" value="टिप्पणी" /></h3>
                      <p className="vkd__notes">{o.notes}</p>
                    </section>
                  )}

                  {editing && draft && (
                    <form className="dr__sec" onSubmit={saveEdit}>
                      <h3 className="dr__lbl">Edit order<Secondary className="dr__lbl-hi" value="संपादन" /></h3>
                      <div className="row2 vkd__editrow">
                        <label className="fld">
                          <span className="fld__l">Expected delivery</span>
                          <input type="date" className="inp" value={draft.expected_delivery}
                            onChange={e => setDraft(d => ({ ...d, expected_delivery: e.target.value }))} />
                        </label>
                        <label className="fld">
                          <span className="fld__l">Order discount (₹)</span>
                          <input type="number" min="0" className="inp" value={draft.discount}
                            onChange={e => setDraft(d => ({ ...d, discount: Number(e.target.value) }))} />
                        </label>
                      </div>

                      <LineItemEditor
                        value={draft.line_items}
                        products={products}
                        onChange={line_items => setDraft(d => ({ ...d, line_items }))}
                      />

                      <p className="vkd__est">
                        Estimated total <b>{inr(preview.total)}</b>
                        <span className="vkd__estnote">
                          — a preview. The final figures are computed and stored by the server when you save.
                        </span>
                      </p>

                      <label className="fld vkd__editrow">
                        <span className="fld__l">Notes</span>
                        <textarea className="inp vkd__ta" value={draft.notes}
                          onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
                      </label>

                      <div className="vkd__acts">
                        <button type="submit" className="btn btn--fill btn--sm" disabled={saving || !canWrite} title={denial || undefined}>
                          {saving ? 'Saving…' : 'Save changes'}
                        </button>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>
                          Discard
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </>
            )}
          </div>
        </FocusTrap>
      </div>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );

  return createPortal(body, document.body);
}
