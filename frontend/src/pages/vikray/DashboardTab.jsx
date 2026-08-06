// Vikray · dashboard — where the orders are, and which of them need somebody.
//
// ── What this tab was, and why it is not that ─────────────────────────────
// Four StatTiles: total orders, open deals, drafts, dispatched. Four counts and
// nothing to do with any of them. The rendered reference
// (`design-reference/Kartavaya Redesign/ScreensBiz.jsx`, `ScreenVikray`) opens
// this module on a table of live records with a progress bar per row — "Quote
// to cash" — and a "Stalled" card naming, in plain language, the two that have
// stopped moving. The figures live above the tab bar, where KpiStrip already
// puts them; repeating them here as a second row of tiles said the same thing
// twice and answered nothing.
//
// The reference is quote-shaped and the build is order-shaped, so the table is
// order-to-cash and "Stalled" asks the questions the order columns can answer.
// Every row is a real order from `/v1/vikray/orders`; nothing here is mocked.
//
// ── The defect this file used to carry ────────────────────────────────────
// `.catch(() => {})` with `if (!data) return <Shimmer/>`: on failure `data`
// stayed null forever and the tab showed a loading shimmer that would never
// resolve — no toast, no retry, no way out. A skeleton that never finishes is a
// lie that never stops telling itself. Both requests below report failure, and
// they fail independently: the counts going down must not blank the list.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Empty } from '../../components/editorial';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { ORDER_LABELS, orderColor } from '../../lib/statusColors';
import { ORDER_FLOW, attention } from './_shared';
import OrderRows from './OrderRows';
import { Secondary } from '../../components/Bilingual';

const COUNT_KEY = {
  draft: 'draft_orders', confirmed: 'confirmed_orders',
  dispatched: 'dispatched_orders', delivered: 'delivered_orders',
};

export default function DashboardTab({ onOpenOrder, onFilter }) {
  const [mix, setMix] = useState(null);
  const [mixErr, setMixErr] = useState(null);
  const [orders, setOrders] = useState(null);
  const [ordersErr, setOrdersErr] = useState(null);

  const load = useCallback(() => {
    setMixErr(null);
    api.get('/v1/vikray/dashboard').then(r => setMix(r.data)).catch(e => { setMix(null); setMixErr(e); });
    setOrdersErr(null);
    api.get('/v1/vikray/orders')
      .then(r => setOrders(r.data?.data || []))
      .catch(e => { setOrders(null); setOrdersErr(e); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const needing = (orders || [])
    .map(o => ({ o, flag: attention(o) }))
    .filter(x => x.flag)
    .slice(0, 6);

  return (
    <div className="vk-dash">
      {/* The status mix. A count is only useful if it takes you to the rows it
          counts, so every one of these is a button that filters the Orders tab
          — which is also why `closed` is here and `cancelled` is not: a
          cancelled order is soft-deleted server-side and the list cannot show
          one. */}
      {mixErr ? (
        <p className="note note--warn" role="status">
          <b>The order counts did not load.</b> The list below is unaffected.
        </p>
      ) : !mix ? (
        <div className="vk-mix vk-mix--load" aria-hidden="true">
          {ORDER_FLOW.slice(0, 4).map(s => <span key={s} className="vk-mix__b vk-mix__b--load" />)}
        </div>
      ) : (
        <div className="vk-mix">
          {ORDER_FLOW.slice(0, 4).map(s => (
            <button key={s} type="button" className="vk-mix__b" style={{ '--c': orderColor(s) }}
              onClick={() => onFilter(s)}>
              <span className="vk-mix__n">{Number(mix[COUNT_KEY[s]]) || 0}</span>
              <span className="vk-mix__l">{ORDER_LABELS[s]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="vk-two">
        <section className="card vk-card">
          <header className="card__head">
            <div className="card__titles">
              <h3 className="card__title">Order to cash</h3>
              <Secondary className="card__hi" value="आदेश से भुगतान" />
            </div>
            {orders?.length > 0 && (
              <button type="button" className="btn btn--text btn--sm" onClick={() => onFilter('')}>
                All {orders.length}
              </button>
            )}
          </header>
          <div className="card__body card__body--flush">
            {ordersErr ? (
              <ErrorState kind={errorKind(ordersErr)} onRetry={load} />
            ) : !orders ? (
              <SkeletonRegion label="Loading orders"><SkeletonList rows={5} showAvatar={false} /></SkeletonRegion>
            ) : orders.length === 0 ? (
              <Empty
                icon="invoice"
                title="No orders yet"
                sub="Every order shows its progress from draft to closed here, so you can see where the money has stopped."
              />
            ) : (
              <OrderRows orders={orders.slice(0, 8)} onOpen={onOpenOrder} />
            )}
          </div>
        </section>

        <section className="card vk-card">
          <header className="card__head">
            <div className="card__titles">
              <h3 className="card__title">Needs attention</h3>
              <Secondary className="card__hi" value="रुका हुआ" />
            </div>
          </header>
          <div className="card__body">
            {ordersErr ? (
              <p className="vk-att__none">Could not check — the order list did not load.</p>
            ) : !orders ? (
              <SkeletonRegion label="Checking orders"><SkeletonList rows={2} showAvatar={false} /></SkeletonRegion>
            ) : needing.length === 0 ? (
              <p className="vk-att__none">
                Nothing has stalled. Every open order has a delivery date in the future and every
                delivered one has been invoiced.
              </p>
            ) : (
              <ul className="vk-att">
                {needing.map(({ o, flag }) => (
                  <li key={o.id} className={`vk-att__i vk-att__i--${flag.tone}`}>
                    <span className="vk-att__txt">
                      <b className="vk-att__who">{o.contact_name || o.contact_company || o.order_number}</b>
                      <span className="vk-att__why">{flag.text}</span>
                    </span>
                    <button type="button" className="btn btn--out btn--sm" onClick={() => onOpenOrder(o.id)}>
                      Open
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
