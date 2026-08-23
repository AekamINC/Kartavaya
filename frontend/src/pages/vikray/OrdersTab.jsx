// Vikray · orders — the list.
//
// Four hundred lines shorter than the version this replaces: the create form is
// `OrderForm`, the record is `OrderDetail`, the row is `OrderRows`, and the
// line-item grid is one shared component instead of two divergent copies.
//
// ── Opening an order is a navigation now ────────────────────────────────────
//
// This tab used to RENDER the record — `{openId && <OrderDetail …/>}` — off an
// id held in `VikrayPage`. That is why an order had no URL, and why a refresh,
// a Back press or a link to a colleague lost it. The record lives at
// `/vikray/orders/:orderId` (`OrderRoute.jsx`); every door into it is now a
// `navigate`, and this file no longer knows what an order looks like.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { Empty } from '../../components/editorial';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { ORDER_LABELS } from '../../lib/statusColors';
import { ORDER_FLOW, orderPath, onOrdersChanged, ORDER_COLUMNS } from './_shared';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';
import OrderRows from './OrderRows';
import OrderForm from './OrderForm';
import useModuleWrite from '../../hooks/useModuleWrite';

/** `newNonce` — the page header's "+ New order" opens the form on this tab.
 *  A counter, not a boolean, so a second press re-opens it after a cancel.
 *
 *  `openId` / `onOpen` are the module shell's older way of saying "open this
 *  order", still used by the Dashboard, Pipeline and Customers tabs, which
 *  route their drill-ins through `VikrayPage`. They are kept and FUNNELLED:
 *  an id arriving that way is turned into the same navigation a row click
 *  makes, and the shell's copy is cleared immediately so a stale id cannot
 *  reopen the record later. One destination, three doors — not two behaviours. */
export default function OrdersTab({ newNonce = 0, status = '', onStatus, openId, onOpen }) {
  const navigate = useNavigate();
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'record orders' });
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showForm, setShowForm] = useState(false);
  /* This list was the one table in Vikray with no column control, because it
     is a button-row grid rather than a <table> and the arrangement work
     attaches to table cells. `OrderRows` now speaks the grid half of the same
     contract, so the control belongs here — the Orders tab owns the
     arrangement; the dashboard's card renders the shipped one. */
  const cols = useColumnPrefs('vikray.orders', ORDER_COLUMNS);

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

  /** The one way this list opens a record. */
  const open = useCallback(id => { if (id) navigate(orderPath(id)); }, [navigate]);

  /* The shell's drill-in, forwarded. Cleared in the same tick it is read: the
     id is a one-shot instruction, and leaving it set meant that returning to
     this tab later re-opened an order nobody had asked for again. */
  useEffect(() => {
    if (!openId) return;
    onOpen?.(null);
    navigate(orderPath(openId));
  }, [openId, onOpen, navigate]);

  /* A write inside the record — an advance, an edit, a cancellation — used to
     come back as `onChanged`, because the record was this component's child.
     It is a routed sibling now, so it announces instead and the list listens.
     Without this, confirming an order left the row behind the drawer still
     saying Draft. */
  useEffect(() => onOrdersChanged(load), [load]);

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
        <ColumnsButton cols={cols} />
      </div>

      {showForm && canWrite && (
        <OrderForm
          onCancel={() => setShowForm(false)}
          onCreated={o => { setShowForm(false); load(); open(o.id); }}
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
        <OrderRows orders={orders} onOpen={open} cols={cols} />
      )}
    </div>
  );
}
