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
//
// ── Why this is a grid and not a <table> ────────────────────────────────────
//
// Because the row is a <button>, and a <button> cannot be a <tr>. That is also
// why the column-arrangement work passed this list by: it attaches to table
// cells, and there were none here. `useColumnPrefs` ships the other half of
// that contract for exactly this case — `gridCells` and `gridTemplate` place
// div cells into grid tracks in the arranged order — so the list keeps its
// button rows AND becomes arrangeable, rather than one at the cost of the
// other.
//
// `cols` is OPTIONAL, and the dashboard passes nothing. Its "Order to cash"
// card shows the eight most recent orders in a shared line; a person
// rearranging the full list should not silently rearrange a summary card they
// were not looking at, and a Columns control has no room there. Without `cols`
// this renders the shipped layout, which is the same list `ORDER_COLUMNS`
// declares — one source, two callers, no drift.
import React from 'react';
import Tag from '../../components/ui/Tag';
import { inrShort } from '../../lib/inr';
import { orderColor, ORDER_LABELS } from '../../lib/statusColors';
import { ORDER_FLOW, flowIndex, attention, ORDER_COLUMNS } from './_shared';

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

/* The shipped arrangement, for the caller that has no hook. Shaped like the
   hook's own return so the render below never branches on which one it got. */
const SHIPPED = {
  columns: ORDER_COLUMNS,
  gridCells: (byId) => ORDER_COLUMNS.map(c => {
    const node = byId?.[c.id];
    return node == null
      ? <div key={c.id} />
      : React.cloneElement(node, { key: c.id });
  }),
};

/**
 * The two flexible tracks, weighted.
 *
 * `gridTemplate` gives every width-less column `minmax(0, 1fr)`, which is right
 * in general and wrong here: MEASURED against the narrowest place this row is
 * used — the dashboard card, about 650px inside — the party name needs the
 * slack. At an even 1 : 1 with a wider state column, "Wipro Consumer" wrapped
 * onto two lines in a 54px row. So the party keeps 1.6fr and the progress bar
 * keeps its 88px floor, and everything else honours whatever width the person
 * dragged it to.
 */
const track = (c) => {
  if (c.width) return `${c.width}px`;
  if (c.id === 'party') return 'minmax(0, 1.6fr)';
  if (c.id === 'progress') return 'minmax(88px, 1fr)';
  return 'minmax(0, 1fr)';
};

export default function OrderRows({ orders, onOpen, cols }) {
  const arrangement = cols || SHIPPED;
  // One template for the head and the rows, off one list. A header whose
  // columns can drift from its rows is worse than no header.
  const style = { gridTemplateColumns: arrangement.columns.map(track).join(' ') };

  return (
    <div className="vko">
      <div className="vko__head" style={style} aria-hidden="true">
        {arrangement.columns.map(c => <span key={c.id}>{c.label}</span>)}
      </div>

      {orders.map(o => {
        const flag = attention(o);
        const party = o.contact_name || o.contact_company;
        return (
          <button
            key={o.id}
            type="button"
            style={style}
            className={`vko__row${flag ? ` vko__row--${flag.tone}` : ''}`}
            onClick={() => onOpen(o.id)}
          >
            {arrangement.gridCells({
              order: <span className="vko__id">{o.order_number}</span>,
              party: (
                <span className="vko__party">
                  {party || <span className="vko__noparty">No customer</span>}
                  {/* The reason is text, not only a keyline: 00 §12 — colour is
                      never the sole carrier of meaning. */}
                  {flag && <span className="vko__why">{flag.text}</span>}
                </span>
              ),
              value: <span className="vko__val">{inrShort(o.total)}</span>,
              progress: <span className="vko__prog"><Progress status={o.status} /></span>,
              state: (
                <span className="vko__state">
                  <Tag color={orderColor(o.status)}>{ORDER_LABELS[o.status] || o.status}</Tag>
                  <span className="vko__date">{o.order_date}</span>
                </span>
              ),
            }, { className: 'vko__cell' })}
          </button>
        );
      })}
    </div>
  );
}
