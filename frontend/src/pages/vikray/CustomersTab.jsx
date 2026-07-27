// Vikray · customers — the sales ledger's view of who buys.
//
// ── Why this tab exists ───────────────────────────────────────────────────
// `design-reference/Kartavaya Redesign/Data.jsx:125` lists it and `TAB_HI:139`
// gives it ग्राहक. It was dropped on the reading that customers are Graha's.
// The distinction the reading missed: Graha owns the CONTACT — who they are,
// who owns the relationship, how warm the lead is. This owns the TRADING
// HISTORY — what they have ordered from us, how much, when last, what is still
// open. A firm's sales lead asks the second question in Sales, and answering it
// by sending them to the CRM to read a deal board is the wrong surface.
//
// ── What it is not ────────────────────────────────────────────────────────
// Not a second contact list. Every row here is derived by GROUPing this
// module's own `vikray_orders`, so a contact who has never ordered does not
// appear, and none of Graha's CRM columns (lead score, owner, source, tags,
// notes, last-contacted) are fetched or shown. The identifying fields that ARE
// shown are the ones `GET /v1/vikray/orders/{id}` already returns behind this
// same module gate.
//
// ── Three states, not two ─────────────────────────────────────────────────
// `list` stays `null` until a load SUCCEEDS. "No customers yet" rendered over a
// failed request tells an accounting firm their client list is empty, which is
// a statement about their business rather than about the network.
import React, { useCallback, useEffect, useState } from 'react';
import { api, rows } from '../../lib/api';
import { Empty } from '../../components/editorial';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonTable } from '../../components/ui/Skeleton';
import { inr, grouped } from '../../lib/inr';
import OrderRows from './OrderRows';

/** One customer's orders, opened in place. Its own three states. */
function CustomerOrders({ contactId, onOpenOrder }) {
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    setFailed(false);
    api.get('/v1/vikray/orders', { params: { contact_id: contactId } })
      .then(r => { if (!dead) setList(rows(r)); })
      .catch(() => { if (!dead) { setList(null); setFailed(true); } });
    return () => { dead = true; };
  }, [contactId]);

  if (failed) return <p className="vk-cu__none">These orders did not load.</p>;
  if (!list) return <p className="vk-cu__none">Loading orders…</p>;
  if (list.length === 0) return <p className="vk-cu__none">No active orders for this customer.</p>;
  return <OrderRows orders={list.slice(0, 8)} onOpen={onOpenOrder} />;
}

export default function CustomersTab({ onOpenOrder }) {
  const [list, setList] = useState(null);     // null until a load succeeds
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');     // the debounced value actually sent
  const [expanded, setExpanded] = useState(null);

  // Typing a name should not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.get('/v1/vikray/customers', { params: query ? { q: query } : undefined });
      setList(rows(r));
    } catch (e) {
      setErr(e);
      setList(null);
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="vk-cu">
      <div className="vk-bar">
        <label className="vk-cu__search">
          <span className="sr-only">Search customers</span>
          <input
            className="inp"
            value={q}
            placeholder="Search by name or company…"
            onChange={e => setQ(e.target.value)}
          />
        </label>
        <p className="vk-bar__note">
          Built from this module's orders — a contact with no order does not appear here.
        </p>
      </div>

      {err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : !list ? (
        <SkeletonRegion label="Loading customers">
          <SkeletonTable rows={5} columns={5} showAvatar={false} />
        </SkeletonRegion>
      ) : list.length === 0 ? (
        <Empty
          icon="teams"
          title={query ? 'No customer matches that' : 'No customers yet'}
          sub={query
            ? 'No party with an order on the books matches that name or company.'
            : 'A customer appears here as soon as an order is raised against them, with what they have ordered and what is still open.'}
          cta={query ? 'Clear the search' : undefined}
          onCta={query ? () => setQ('') : undefined}
        />
      ) : (
        <div className="tbl__wrap">
          <table className="tbl vk-cu__t">
            <thead>
              <tr>
                <th>Customer</th>
                <th>GSTIN</th>
                <th className="tbl__num">Orders</th>
                <th className="tbl__num">Ordered</th>
                <th className="tbl__num">Open</th>
                <th>Last order</th>
              </tr>
            </thead>
            <tbody>
              {list.map(c => {
                const open = expanded === c.contact_id;
                const title = c.contact_company || c.contact_name || 'Unnamed customer';
                const second = c.contact_company && c.contact_name ? c.contact_name : null;
                return (
                  <React.Fragment key={c.contact_id}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className="vk-cu__name"
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : c.contact_id)}
                        >
                          {title}
                        </button>
                        {second && <span className="vk-cu__who">{second}</span>}
                      </td>
                      <td className="vk-cu__gst">
                        {c.gstin || <span className="vk-cu__nogst">Not recorded</span>}
                      </td>
                      <td className="tbl__num">{grouped(c.order_count)}</td>
                      <td className="tbl__num">{inr(c.order_value)}</td>
                      <td className="tbl__num">
                        {Number(c.open_orders) > 0
                          ? <b className="vk-cu__open">{grouped(c.open_orders)}</b>
                          : <span className="vk-cu__nogst">None</span>}
                      </td>
                      <td className="vk-cu__last">{c.last_order_date || '—'}</td>
                    </tr>
                    {open && (
                      <tr className="vk-cu__exp">
                        <td colSpan={6}>
                          <CustomerOrders contactId={c.contact_id} onOpenOrder={onOpenOrder} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
