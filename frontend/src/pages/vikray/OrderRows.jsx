// The order list itself — a header row and a button per order.
//
// This is the reference's shape, not an approximation of it: `ScreensBiz.jsx`
// (`ScreenVikray`, "Quote to cash") renders `.tbl__head` plus one
// `<button className="tbl__row">` per record, with a five-segment progress bar
// in the Progress column and the state as a Tag beside it. A real <button> per
// row is also the only version of "click the row to open it" that a keyboard
// reaches — the build's `<div className="k-modcard" onClick=…>` was not
// focusable and had no role.
//
// Shared by the Dashboard tab (recent orders) and the Orders tab (the list), so
// the two can never disagree about what an order looks like.
import React from 'react';
import Tag from '../../components/ui/Tag';
import { inrShort } from '../../lib/inr';
import { orderColor, ORDER_LABELS } from '../../lib/statusColors';
import { ORDER_FLOW, flowIndex, attention } from './_shared';

function Progress({ status }) {
  const done = flowIndex(status);
  const c = orderColor(status);
  const cancelled = status === 'cancelled';
  return (
    <span className="vko__flow" aria-hidden="true">
      {ORDER_FLOW.map((s, i) => (
        <span
          key={s}
          className={`vko__seg${!cancelled && i < done ? ' is-on' : ''}`}
          style={!cancelled && i < done ? { '--c': c } : undefined}
        />
      ))}
    </span>
  );
}

export default function OrderRows({ orders, onOpen }) {
  return (
    <div className="vko">
      <div className="vko__head" aria-hidden="true">
        <span>Order</span>
        <span>Party</span>
        <span className="vko__val">Value</span>
        <span>Progress</span>
        <span>State</span>
      </div>

      {orders.map(o => {
        const flag = attention(o);
        const party = o.contact_name || o.contact_company;
        return (
          <button
            key={o.id}
            type="button"
            className={`vko__row${flag ? ` vko__row--${flag.tone}` : ''}`}
            onClick={() => onOpen(o.id)}
          >
            <span className="vko__id">{o.order_number}</span>
            <span className="vko__party">
              {party || <span className="vko__noparty">No customer</span>}
              {/* The reason is text, not only a keyline: 00 §12 — colour is
                  never the sole carrier of meaning. */}
              {flag && <span className="vko__why">{flag.text}</span>}
            </span>
            <span className="vko__val">{inrShort(o.total)}</span>
            <span className="vko__prog"><Progress status={o.status} /></span>
            <span className="vko__state">
              <Tag color={orderColor(o.status)}>{ORDER_LABELS[o.status] || o.status}</Tag>
              <span className="vko__date">{o.order_date}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
