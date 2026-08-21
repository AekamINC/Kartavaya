// Vikray · `/vikray/orders/:orderId` — one sales order, as a URL.
//
// The record itself is still `OrderDetail`: the same drawer, the same chrome,
// the same actions. Nothing about it was copied — it was UNPLUGGED from
// `OrdersTab`, which used to render it from `VikrayPage`'s `openOrderId` state,
// and plugged into the router instead. There is one component that draws an
// order and one way to reach it, so the two cannot drift apart or disagree.
//
// What this file adds is the three things a route owes that a piece of tab
// state did not:
//
//   · the id comes from the PATH, so the record loads on a cold arrival — a
//     bookmark, a colleague's link, a notification, a refresh — with no list
//     behind it and nothing in memory. `OrderDetail` already fetched by id;
//     it simply never had an id that outlived the page.
//   · closing is a NAVIGATION, so Back and Escape mean the same thing and the
//     address bar keeps up with the screen.
//   · a write inside the record announces itself, so the list underneath
//     refetches. That was `onChanged`, a prop from the parent; the parent is
//     the router now, and `ordersChanged` carries it instead.
import React, { useCallback, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import OrderDetail from './OrderDetail';
import { ordersChanged } from './_shared';

export default function OrderRoute() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * Did this drawer open on top of something of ours?
   *
   * `key` is `'default'` only for a history entry this app never pushed — a
   * fresh tab on a pasted link, or the first page of a session. Anything else
   * means the list is one step back and `-1` returns the reader to it with
   * their scroll, their tab and their filter intact, and without leaving a
   * dead-end entry behind. Cold, there is nothing to go back TO: `-1` would
   * walk out of the app entirely, so the module page is pushed over the
   * record's own entry.
   *
   * Read once, into a ref: by the time this fires the location may have been
   * replaced by a navigation inside the record, and the question is about how
   * the reader ARRIVED.
   */
  const arrivedFromApp = useRef(location.key !== 'default');

  const close = useCallback(() => {
    if (arrivedFromApp.current) navigate(-1);
    else navigate('/vikray', { replace: true });
  }, [navigate]);

  return (
    // Keyed on the id: `/vikray/orders/a` → `/vikray/orders/b` is the same
    // route and the same element, so without this React would keep the mounted
    // instance and every piece of its editing state — a half-typed line item
    // on order A, still on screen, now pointed at order B.
    <OrderDetail
      key={orderId}
      orderId={orderId}
      onClose={close}
      onChanged={ordersChanged}
    />
  );
}
