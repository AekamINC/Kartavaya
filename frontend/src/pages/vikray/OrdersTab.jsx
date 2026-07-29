// Vikray · orders — the list.
//
// Four hundred lines shorter than the version this replaces: the create form is
// `OrderForm`, the record is `OrderDetail`, the row is `OrderRows`, and the
// line-item grid is one shared component instead of two divergent copies.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Empty } from '../../components/editorial';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { ORDER_LABELS } from '../../lib/statusColors';
import { ORDER_FLOW } from './_shared';
import OrderRows from './OrderRows';
import OrderForm from './OrderForm';
import OrderDetail from './OrderDetail';
import useModuleWrite from '../../hooks/useModuleWrite';

/** `newNonce` — the page header's "+ New order" opens the form on this tab.
 *  A counter, not a boolean, so a second press re-opens it after a cancel. */
export default function OrdersTab({ newNonce = 0, status = '', onStatus, openId, onOpen }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'record orders' });
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await api.get('/v1/vikray/orders', { params: status ? { status } : undefined });
      setOrders(r.data?.data || []);
    } catch (e) {
      // A failed load left `orders` at [] and painted "No orders yet — create
      // your first sales order", which is a wrong answer offered as an
      // invitation. An empty list and a failed request are different facts.
      setErr(e);
      setOrders([]);
    } finally { setLoading(false); }
  }, [status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (newNonce) setShowForm(true); }, [newNonce]);

  return (
    <div>
      <div className="vk-bar">
        <label className="vk-bar__f">
          <span className="vk-bar__fl">Status</span>
          <select className="inp" value={status} onChange={e => onStatus(e.target.value)}>
            <option value="">All</option>
            {ORDER_FLOW.map(s => <option key={s} value={s}>{ORDER_LABELS[s]}</option>)}
            {/* `cancelled` is deliberately absent. `DELETE /orders/{id}` sets
                is_active=FALSE and `GET /orders` filters on it, so the option
                existed and could only ever return nothing — a filter that is
                always empty reads as "you have no cancelled orders", which is
                a claim this endpoint cannot make. */}
          </select>
        </label>
        <button type="button" className="btn btn--fill btn--sm vk-bar__new"
          disabled={!canWrite} title={denial || undefined}
          onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Close form' : '+ New order'}
        </button>
      </div>

      {showForm && canWrite && (
        <OrderForm
          onCancel={() => setShowForm(false)}
          onCreated={o => { setShowForm(false); load(); onOpen(o.id); }}
        />
      )}

      {loading ? (
        <SkeletonRegion label="Loading orders"><SkeletonList rows={6} showAvatar={false} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : orders.length === 0 ? (
        status ? (
          <Empty
            icon="invoice"
            title={`No ${ORDER_LABELS[status]?.toLowerCase() || status} orders`}
            sub="Nothing sits at this stage right now. Clear the filter to see every order."
            cta="Show all orders"
            onCta={() => onStatus('')}
          />
        ) : (
          <Empty
            icon="invoice"
            title="No orders yet"
            sub={canWrite
              ? 'A sales order records what a customer has agreed to buy. Confirm one and it moves your stock; deliver it and it becomes an invoice.'
              : `A sales order records what a customer has agreed to buy — confirming one moves your stock, delivering it makes an invoice. ${denial}`}
            cta={canWrite ? '+ New order' : undefined}
            onCta={canWrite ? () => setShowForm(true) : undefined}
          />
        )
      ) : (
        <OrderRows orders={orders} onOpen={onOpen} />
      )}

      {openId && (
        <OrderDetail orderId={openId} onClose={() => onOpen(null)} onChanged={load} />
      )}
    </div>
  );
}
