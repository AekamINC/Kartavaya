// Procurement · purchase orders — the list, the form, and the way in.
//
// Proposal 77's floor, stated as a design requirement rather than a nicety:
// "if our PO is harder than Vyapar's invoice, a small firm will not use it".
// So the form is the vendor-bill form's shape — one screen, lines inline, no
// wizard — and everything that makes this a PROCUREMENT module rather than a
// document generator (approval, revisions, receipts, the three-way match)
// lives in the record drawer, where it appears only once it is relevant.
import React, { useCallback, useEffect, useState } from 'react';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { StatTile } from '../../components/editorial';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import DateInput from '../../components/ui/DateInput';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import { inr } from '../../lib/inr';
import PurchaseOrderDetail from './PurchaseOrderDetail';
import POSettingsPanel from './POSettingsPanel';
import {
  BLANK_PO, EMPTY_LINE, Badge, PO_STATUSES, PO_STATUS_COLORS,
  PO_STATUS_LABELS, previewTotals,
} from './_shared';

export default function PurchaseOrdersTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'raise purchase orders' });
  const { pushToast } = useToast();

  const [orders, setOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [committed, setCommitted] = useState(null);
  const [committedFailed, setCommittedFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState({ ...BLANK_PO, line_items: [{ ...EMPTY_LINE }] });

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const params = statusFilter ? { status: statusFilter } : undefined;
      const r = await api.get('/v1/procurement/purchase-orders', { params });
      setOrders(rows(r));
    } catch (e) {
      // "No purchase orders yet" after a failed fetch tells a firm it has
      // ordered nothing, which is a different and much worse statement.
      setErr(e);
      setOrders([]);
    } finally { setLoading(false); }
  }, [statusFilter]);

  const loadCommitted = useCallback(async () => {
    setCommittedFailed(false);
    try {
      const r = await api.get('/v1/procurement/reports/committed-spend');
      setCommitted(body(r));
    } catch { setCommitted(null); setCommittedFailed(true); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    loadCommitted();
    // The vendor is the counterparty and the catalogue is THE catalogue —
    // `/v1/products`, the one every module reads. Procurement mints no second
    // item list of its own.
    api.get('/v1/ganit/vendors').then(r => setVendors(rows(r))).catch(() => setVendors([]));
    api.get('/v1/products').then(r => setProducts(rows(r))).catch(() => setProducts([]));
  }, [loadCommitted]);

  function updateLine(idx, key, val) {
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = { ...items[idx], [key]: val };
      return { ...f, line_items: items };
    });
  }

  /** Choosing a catalogue product fills the line from the catalogue rather than
   *  asking the buyer to retype an HSN code they will get wrong. */
  function pickProduct(idx, productId) {
    const p = products.find(x => x.id === productId);
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = p
        ? {
          ...items[idx],
          product_id: p.id,
          description: items[idx].description || p.name,
          hsn_code: p.hsn_code || '',
          sac_code: p.sac_code || '',
          unit: p.unit || 'NOS',
          rate: Number(p.cost_price ?? p.price ?? 0),
          gst_rate: Number(p.gst_rate ?? 18),
        }
        : { ...items[idx], product_id: '' };
      return { ...f, line_items: items };
    });
  }

  async function savePO(e) {
    e.preventDefault();
    if (!form.vendor_id) { pushToast({ title: 'Select a supplier', type: 'error' }); return; }
    setSaving(true);
    try {
      const r = await api.post('/v1/procurement/purchase-orders', form);
      pushToast({
        title: 'Draft purchase order created',
        message: 'It carries no number yet — the serial is minted when you issue it.',
        type: 'success',
      });
      setShowForm(false);
      setForm({ ...BLANK_PO, line_items: [{ ...EMPTY_LINE }] });
      await load();
      await loadCommitted();
      setOpenId(body(r).data?.id || null);
    } catch (e2) {
      pushToast({
        title: e2.response?.data?.detail || 'Could not create the purchase order',
        type: 'error',
      });
    } finally { setSaving(false); }
  }

  const preview = previewTotals(form.line_items, form.is_igst);

  return (
    <div>
      {committed && (
        <div className="gn-stats" style={{ '--gn-min': '160px' }}>
          <StatTile
            label="Committed" sanskrit="प्रतिबद्ध"
            value={inr(Number(committed.total || 0))}
          />
          <StatTile label="Open orders" value={committed.orders ?? 0} />
          {(committed.budgets || []).filter(b => b.state !== 'ok').slice(0, 2).map(b => (
            <StatTile
              key={b.department}
              label={`${b.department} budget`}
              value={`${b.used_pct}%`}
              variant={b.state === 'over' ? 'danger' : 'warn'}
            />
          ))}
        </div>
      )}
      {committedFailed && (
        <p className="note note--warn" role="status">
          The committed-spend total could not be loaded. The orders below are
          unaffected.
        </p>
      )}

      <div className="gn-bar">
        <label className="gn-bar__f">
          <span className="gn-bar__fl">Status</span>
          <select
            className="inp gn-bar__sel" value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {PO_STATUSES.map(s => (
              <option key={s} value={s}>{PO_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <span className="gn-bar__sp" />
        <button
          type="button" className="btn btn--ghost btn--sm"
          onClick={() => setShowSettings(v => !v)}
        >
          {showSettings ? 'Close settings' : 'Settings'}
        </button>
        <button
          type="button" className="btn btn--fill btn--sm"
          onClick={() => setShowForm(v => !v)}
          disabled={!canWrite} title={denial || undefined}
        >
          {showForm ? 'Close form' : '+ Purchase order'}
        </button>
      </div>

      {showSettings && <POSettingsPanel onClose={() => setShowSettings(false)} />}

      {showForm && canWrite && (
        <form className="gn-form" onSubmit={savePO}>
          <h4 className="gn-form__h">New purchase order</h4>
          <div className="gn-form__grid">
            <label className="fld">
              <span className="fld__l">Supplier<span className="fld__req">*</span></span>
              <select
                className="inp" required value={form.vendor_id}
                onChange={e => setForm({ ...form, vendor_id: e.target.value })}
              >
                <option value="">Select…</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label className="fld">
              <span className="fld__l">Order date</span>
              <DateInput
                className="inp" type="date" value={form.po_date}
                onChange={e => setForm({ ...form, po_date: e.target.value })}
              />
            </label>
            <label className="fld">
              <span className="fld__l">Expected by</span>
              <DateInput
                className="inp" type="date" value={form.expected_date}
                onChange={e => setForm({ ...form, expected_date: e.target.value })}
              />
            </label>
            <label className="fld">
              <span className="fld__l">Department</span>
              <input
                className="inp" value={form.department}
                onChange={e => setForm({ ...form, department: e.target.value })}
              />
            </label>
            <label className="fld">
              <span className="fld__l">Category</span>
              <input
                className="inp" value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
              />
            </label>
            <label className="gn-chk">
              <input
                type="checkbox" checked={form.is_igst}
                onChange={e => setForm({ ...form, is_igst: e.target.checked })}
              />
              <span>Inter-state (IGST)</span>
            </label>
          </div>
          <p className="gn-tot__note">
            The tax split is derived from the supplier's GSTIN where they have
            one recorded. A supplier without a GSTIN is perfectly orderable —
            the box above is then what decides.
          </p>

          <h4 className="gn-form__h">Line items</h4>
          {form.line_items.map((li, i) => (
            <div key={i} className="gn-li" style={{ '--gn-li': '1.4fr 1.6fr 80px 110px 80px 1fr 30px' }}>
              <div>
                {i === 0 && <span className="gn-li__l">Product</span>}
                <select
                  className="inp" value={li.product_id}
                  onChange={e => pickProduct(i, e.target.value)}
                >
                  <option value="">Not in catalogue</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                {i === 0 && <span className="gn-li__l">Description</span>}
                <input
                  className="inp" placeholder="Description" required value={li.description}
                  onChange={e => updateLine(i, 'description', e.target.value)}
                />
              </div>
              <div>
                {i === 0 && <span className="gn-li__l">Qty</span>}
                <input
                  className="inp" type="number" step="any" value={li.qty_ordered}
                  onChange={e => updateLine(i, 'qty_ordered', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                {i === 0 && <span className="gn-li__l">Rate</span>}
                <input
                  className="inp" type="number" step="any" value={li.rate}
                  onChange={e => updateLine(i, 'rate', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                {i === 0 && <span className="gn-li__l">GST%</span>}
                <input
                  className="inp" type="number" step="any" value={li.gst_rate}
                  onChange={e => updateLine(i, 'gst_rate', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                {i === 0 && <span className="gn-li__l">HSN/SAC</span>}
                <input
                  className="inp" value={li.hsn_code}
                  onChange={e => updateLine(i, 'hsn_code', e.target.value)}
                />
              </div>
              <button
                type="button" className="gn-li__x" aria-label={`Remove line ${i + 1}`}
                disabled={form.line_items.length === 1}
                onClick={() => setForm(f => ({
                  ...f, line_items: f.line_items.filter((_, j) => j !== i),
                }))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button" className="btn btn--ghost btn--sm"
            onClick={() => setForm(f => ({ ...f, line_items: [...f.line_items, { ...EMPTY_LINE }] }))}
          >
            + Add line
          </button>

          <div className="gn-tot">
            <div className="gn-tot__r">
              <span className="gn-tot__l">Subtotal</span>
              <span className="gn-tot__v">{inr(preview.subtotal, { decimals: 2 })}</span>
            </div>
            <div className="gn-tot__r gn-tot__r--sum">
              <span className="gn-tot__l">Total</span>
              <span className="gn-tot__v">{inr(preview.total, { decimals: 2 })}</span>
            </div>
          </div>

          <label className="fld gn-form__wide">
            <span className="fld__l">Terms</span>
            <textarea
              className="inp gn-ta" rows={2} value={form.terms}
              onChange={e => setForm({ ...form, terms: e.target.value })}
            />
          </label>
          <label className="fld gn-form__wide">
            <span className="fld__l">Notes</span>
            <textarea
              className="inp gn-ta" rows={2} value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
            />
          </label>

          <div className="gn-form__acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save draft'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading purchase orders">
          <SkeletonList rows={5} showAvatar={false} />
        </SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : orders.length === 0 ? (
        statusFilter ? (
          <EmptyState
            illustration="search"
            title={{ en: `No ${PO_STATUS_LABELS[statusFilter] || statusFilter} orders`, hi: 'कोई आदेश नहीं' }}
            description="Nothing sits at this status right now. Clear the filter to see every order."
            action="Show all orders"
            onAction={() => setStatusFilter('')}
          />
        ) : (
          <EmptyState
            illustration="generic"
            title={{ en: 'No purchase orders yet', hi: 'कोई क्रय आदेश नहीं' }}
            description={canWrite
              ? 'A purchase order records what you asked a supplier for, what arrived, and what they billed you. Committed spend, late suppliers and the three-way match all follow from it.'
              : `A purchase order records what you asked a supplier for, what arrived and what they billed you. ${denial}`}
            action={canWrite ? '+ Purchase order' : undefined}
            onAction={canWrite ? () => setShowForm(true) : undefined}
          />
        )
      ) : (
        <div className="gn-list">
          {orders.map(o => (
            <button type="button" key={o.id} className="gn-row" onClick={() => setOpenId(o.id)}>
              <span className="gn-row__head">
                <span>
                  <span className="gn-row__t">{o.vendor_name}</span>
                  <span className="gn-row__ref">{o.po_number || 'Draft'}</span>
                </span>
                <span className="gn-row__r">
                  <span className="gn-row__v">{inr(Number(o.total || 0))}</span>
                  <Badge text={o.status} color={PO_STATUS_COLORS[o.status] || 'var(--on-surface-3)'} />
                </span>
              </span>
              <span className="gn-row__meta">
                <span>
                  {o.po_date}
                  {o.expected_date && ` · expected ${o.expected_date}`}
                  {o.department && ` · ${o.department}`}
                  {o.revision > 0 && ` · revision ${o.revision}`}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {openId && (
        <PurchaseOrderDetail
          poId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => { load(); loadCommitted(); }}
        />
      )}
    </div>
  );
}
