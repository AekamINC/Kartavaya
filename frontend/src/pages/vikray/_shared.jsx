// Constants and helpers shared across the vikray tabs.
//
// Nothing here is a colour literal or a second copy of a formatter: order
// status colour is `lib/statusColors.js` (ORDER_COLORS, already on 00 §9
// tokens) and rupees are `lib/inr.js`. VikrayPage carried a private `lakh()`
// that `inrShort` already does — the ninth reimplementation of Indian digit
// grouping in the tree, and the reason a figure could read "₹5.6 L" on one
// surface and "₹5.6L" on the next.
// `React` by name, not only the hooks: this file renders JSX now
// (`shipToFields`) and the classic runtime needs the binding in scope.
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ORDER_LABELS } from '../../lib/statusColors';

/**
 * The order lifecycle, in order. Five states, strictly linear, plus a terminal
 * `cancelled` that is not on the line.
 *
 * `27-vikray.md` §3: this must be SHOWN as a pipeline rather than as a single
 * button whose label changes — a user needs to see where an order sits and what
 * remains, which one button cannot say. The forward transitions match the
 * backend's `_VALID_TRANSITIONS` exactly (backend/routers/vikray.py:120); if
 * they ever drift the UI offers a move the server refuses.
 */
export const ORDER_FLOW = ['draft', 'confirmed', 'dispatched', 'delivered', 'closed'];

/**
 * The canonical address of one sales order.
 *
 * An order had no URL: it opened as a drawer over `OrdersTab`, held in
 * `VikrayPage`'s `openOrderId` state, so a salesperson could not bookmark it,
 * send it to a colleague, press Back out of it, or reload without losing their
 * place — and every notification or email that wanted to deep-link to an order
 * had nowhere to point. It is `/vikray/orders/<id>` now, written once here so
 * the list, the dashboard drill-in and the create form cannot spell the same
 * record three ways.
 *
 * The id in a URL is not the id on screen — the names-not-ids rule is about
 * what is DRAWN, and nothing here draws it.
 *
 * ── `search` IS NOT OPTIONAL DECORATION. IT IS THE LIST UNDERNEATH. ─────────
 *
 * This returned the bare path, and that quietly undid the reason the record is
 * a nested route at all. `VikrayPage` reads its open tab from `?tab=` and falls
 * back to the STARRED DEFAULT when the query is absent — so opening an order
 * from the orders list navigated to a URL with no tab in it, and the list
 * behind the drawer silently became whichever tab the reader had starred
 * (Pipeline, on the reference org). Press Back, or share the link, or refresh,
 * and you land on a tab you were never on.
 *
 * `OrderRoute.jsx`'s own header says keeping the list underneath is the whole
 * point: "the list underneath is genuinely still there … Back returns the
 * reader to the tab, the stage filter and the chip they left." It could not,
 * because the tab was dropped on the way in.
 *
 * Found by proposal 93 Suite 10 (10.05) on 2026-08-29, driving the real screen:
 * the orders panel was gone from behind the drawer and the pipeline panel had
 * taken its place.
 *
 * So the caller passes the location's own `search` and the tab rides along.
 * Passing nothing is still correct for a caller that genuinely has no context —
 * a notification deep-link — which is why the parameter defaults to empty
 * rather than being required.
 */
export const orderPath = (id, search = '') => {
  const q = String(search || '');
  const query = q && q !== '?' ? (q.startsWith('?') ? q : `?${q}`) : '';
  return `/vikray/orders/${encodeURIComponent(id)}${query}`;
};

/**
 * What the order list HAS, declared once — the floor `useColumnPrefs` resolves
 * a saved arrangement against, and the shipped layout `OrderRows` falls back to
 * where no arrangement exists (the dashboard's card).
 *
 * The widths are not new numbers. They are the ones `.vko__head` / `.vko__row`
 * already carried in `module.css`, moved here because the grid template is now
 * built from this list: a header whose columns can drift from its rows is worse
 * than no header, and the only way to keep them identical once a person can
 * reorder them is for both to read the same source.
 *
 * `party` and `progress` carry NO width on purpose — they are the two flexible
 * tracks, and the CSS weighted them 1.6 : 1 in the party's favour because the
 * name is the only column a reader scans. That weighting cannot survive a
 * generic `minmax(0, 1fr)`, so `OrderRows` restores it (see `template` there).
 *
 * `order` is `fixed`: a row whose identifier can be hidden is a row you cannot
 * cite, and every other door into the record — the dashboard, the pipeline —
 * opens from it.
 */
export const ORDER_COLUMNS = [
  { id: 'order',    label: 'Order',    width: 92, fixed: true },
  { id: 'party',    label: 'Party' },
  { id: 'value',    label: 'Value',    width: 84, className: 'vko__val' },
  { id: 'progress', label: 'Progress' },
  { id: 'state',    label: 'State',    width: 106 },
];

/**
 * "An order changed" — from the record route back to the list behind it.
 *
 * `OrderDetail` used to be a child of `OrdersTab` and could call `onChanged`
 * straight up the tree. As a routed sibling of `VikrayPage` it has no such
 * path: the shell owns the tab state, not the list's `load`. A subscription is
 * the only wiring that does not require editing the module shell and every tab
 * in between. No payload and no ordering guarantee — the subscriber refetches,
 * which is exactly what `onChanged` made it do before.
 */
const orderWatchers = new Set();

/** Subscribe. Returns the unsubscribe, so an effect can return it directly. */
export function onOrdersChanged(fn) {
  orderWatchers.add(fn);
  return () => { orderWatchers.delete(fn); };
}

/** Announce a write. Copied before iterating — a listener may unsubscribe. */
export function ordersChanged() {
  for (const fn of [...orderWatchers]) {
    try { fn(); } catch { /* one bad listener must not stop the others */ }
  }
}

const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Could this path segment be a record id at all?
 *
 * A typed or truncated URL must not become a request. `GET /orders/{order_id}`
 * takes the segment as a plain string and hands it to `$1::uuid`
 * (routers/vikray.py:421), so a malformed one is a cast failure — a 500, which
 * `errorKind` reads as "Something broke on our side, not yours". That is the
 * one sentence on the list that is untrue here: nothing broke, the link is
 * wrong. Checked in the browser, the reader gets "this doesn't exist" instead.
 */
export const isRecordId = v => typeof v === 'string' && RECORD_ID.test(v.trim());

/** A rejection shaped like the 404 the server would have sent. */
export const notFound = () => ({ response: { status: 404 } });

export const FLOW_STAGES = ORDER_FLOW.map(value => ({ value, label: ORDER_LABELS[value] }));

/** The one forward move from a state, or null at the end of the line. */
export const nextStatus = s => {
  const i = ORDER_FLOW.indexOf(s);
  return i > -1 && i < ORDER_FLOW.length - 1 ? ORDER_FLOW[i + 1] : null;
};

export const ADVANCE_LABEL = {
  draft: 'Confirm order',
  confirmed: 'Mark dispatched',
  dispatched: 'Mark delivered',
  delivered: 'Close order',
};

/** How far along the line an order is, 0–5, for the row progress bar. */
export const flowIndex = s => {
  const i = ORDER_FLOW.indexOf(s);
  return i < 0 ? 0 : i + 1;
};

/**
 * A blank line item.
 *
 * `product_id` is in this shape and was NOT in the one VikrayPage used. That
 * omission was load-bearing: the backend's `_apply_stock_moves`
 * (routers/vikray.py:128) skips any line with no `product_id`, so confirming an
 * order deducted nothing and the Stock tab's "On hand" stayed at zero for every
 * product forever. `fillFromProduct` set description, HSN, rate, GST and unit
 * from the chosen product and dropped the one field that links the line back to
 * it — so the stock ledger looked empty rather than wrong, which is why it
 * survived. `LineItemEditor` now carries it through.
 */
export const emptyLine = () => ({
  product_id: '', description: '', hsn_code: '', quantity: 1,
  unit: 'NOS', rate: 0, gst_rate: 18, discount_pct: 0,
});

/**
 * THE SHIP-TO ADDRESS — the field set, written ONCE, for both order surfaces.
 *
 * ── The defect this closes ─────────────────────────────────────────────────
 *
 * `vikray_orders.shipping_address` is a live jsonb column. `OrderCreate` and
 * `OrderUpdate` have both accepted it since they were written, the INSERT binds
 * it `$15::jsonb`, and `OrderDetail` renders a "Ship to" section off it — and
 * NO SCREEN HAD AN INPUT. `OrderForm` held `shipping_address: {}` in form state
 * and offered no box for it, so the section in the record could never appear
 * and the column could only be filled by an API caller. Measured 2026-08-29
 * across `reseed_backup_20260828`: of 380 orders, 358 carried `{}` or NULL and
 * the 22 that did not were written by a caller, not by a person.
 *
 * That is the same shape as the vendor address before Phase 8.0 and as
 * `graha_contacts.billing_address` before it grew fields: a column the API can
 * write and a human cannot. Proposal 93 §4 asks every order to carry one, so
 * this is the control that makes that possible.
 *
 * ── ONE DEFINITION, TWO SURFACES ───────────────────────────────────────────
 *
 * The create form and the record's edit form both write this jsonb. Two
 * surfaces writing one column is exactly how a field set forks — the Ganit/Kray
 * vendor form did it and needed a set-equality test to stop it, and
 * `ContactsTab` records the same rule for `billing_address`. So it is defined
 * here and spread into both.
 *
 * The five keys are `ContactsTab`'s, which are the five `AddressBlock` reads
 * first, so an order's ship-to renders the same way a client's address does.
 * `state_code` is deliberately not asked for: `AddressBlock` never prints it,
 * and the GST split on an order comes from the IGST checkbox, not from here.
 *
 * NOTHING HERE VALIDATES. A pincode is the same kind of fact as GSTIN/PAN/TAN
 * — non-mandatory, blocks nothing — and a half-typed one must not stop somebody
 * saving an order.
 */
export const EMPTY_SHIP_TO = { line1: '', line2: '', city: '', state: '', pincode: '' };

/** True when a stored address has nothing a reader could use. */
export const shipToIsEmpty = a =>
  !a || !Object.keys(EMPTY_SHIP_TO).some(k => String(a[k] ?? '').trim());

/**
 * The five inputs, rendered into whatever grid the caller is using.
 *
 * @param {object}   addr    the address as held in form state
 * @param {function} onAddr  called with the WHOLE next address
 */
export function shipToFields(addr, onAddr) {
  const a = addr || EMPTY_SHIP_TO;
  const set = (k, v) => onAddr({ ...EMPTY_SHIP_TO, ...a, [k]: v });
  const field = (label, key, extra = {}) => (
    <label className="fld" key={key}>
      <span className="fld__l">{label}</span>
      <input
        className="inp"
        aria-label={`Ship to ${label.toLowerCase()}`}
        value={a[key] || ''}
        onChange={e => set(key, e.target.value)}
        {...extra}
      />
    </label>
  );
  return (
    <>
      {field('Address line 1', 'line1')}
      {field('Address line 2', 'line2')}
      {field('City', 'city')}
      {field('State', 'state')}
      {/* `inputMode` gets the numeric keypad on a phone, which is the whole of
          what this field owes the person filling it in. Not enforced. */}
      {field('Pincode', 'pincode', { inputMode: 'numeric', maxLength: 6, placeholder: '395002' })}
    </>
  );
}

/** `line_items` arrives as jsonb from one endpoint and as a string from another. */
export const asItems = v => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
};

/** Amount for one line after its own percentage discount. */
export const lineAmount = li =>
  (Number(li.quantity) || 0) * (Number(li.rate) || 0) * (1 - (Number(li.discount_pct) || 0) / 100);

/**
 * Client-side totals for the create/edit forms.
 *
 * 27 §5: this is a PREVIEW and is labelled as one. The server computes the
 * authoritative figures in `_compute_order_totals`, and the two can disagree —
 * the order in which a per-line percentage discount and a flat order discount
 * are applied is not guaranteed to match. Making the client authoritative would
 * put tax arithmetic somewhere nobody can audit; showing an unlabelled figure
 * that later changes is the same lie with extra steps.
 */
export function previewTotals(lineItems, discount = 0) {
  const items = lineItems || [];
  const subtotal = items.reduce((s, li) => s + lineAmount(li), 0);
  const gst = items.reduce((s, li) => s + lineAmount(li) * (Number(li.gst_rate) || 0) / 100, 0);
  return { subtotal, gst, total: subtotal + gst - (Number(discount) || 0) };
}

/** Whole days from an ISO date to today. Negative is in the past. */
export function daysFromToday(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
}

/**
 * Why an order needs somebody, or null.
 *
 * The reference's "Stalled" card (`ScreensBiz.jsx`, `ScreenVikray`) lists two
 * quotes with a plain-language reason each. Its reasons — "sent 6 days ago, not
 * opened" — read off fields the build's order table does not have, so these are
 * the equivalent questions asked of the columns that DO exist. Every one is
 * derived from a row already on screen; none of it is a second request.
 */
export function attention(o) {
  if (o.status === 'cancelled' || o.status === 'closed') return null;
  const due = daysFromToday(o.expected_delivery);
  if (o.status === 'delivered' && !o.invoice_id) {
    return { text: 'Delivered, not yet invoiced', tone: 'warn' };
  }
  if (due != null && due < 0 && (o.status === 'draft' || o.status === 'confirmed')) {
    return { text: `Delivery date passed ${Math.abs(due)}d ago`, tone: 'danger' };
  }
  if (o.status === 'draft') {
    const age = daysFromToday(o.order_date);
    if (age != null && age <= -7) return { text: `Draft for ${Math.abs(age)} days`, tone: 'warn' };
  }
  return null;
}

/**
 * Whether this user may reach Ganit — the entitlement that governs invoicing.
 *
 * 27 §11 asks for the invoice action to be gated on Ganit and for the reason to
 * be stated, because a disabled button with no explanation is worse than an
 * absent one. The backend already stacks `require_module("ganit")` on
 * `POST /orders/{id}/invoice` (routers/vikray.py:37) — this only stops the user
 * discovering that by pressing the button.
 *
 * There is no "which modules may I reach" endpoint an ordinary member can call:
 * `GET /v1/org/modules` is org-settings-gated and would 403 for exactly the
 * people this question is about. So it PROBES the module with the cheapest read
 * behind the same gate and caches the one promise for the session. A 403 is the
 * answer; any other failure is not, and leaves the action available rather than
 * hiding a control over a dropped connection.
 *
 * ── THE PROBE MOVED, AND WHY IT HAD TO ──────────────────────────────────────
 * It used to read `/v1/ganit/products`. That endpoint's gate is now
 * `require_any_module("ganit", "vikray")` — the catalogue is one catalogue, and
 * a sales-only firm is entitled to it — so the probe would have started
 * answering "yes, you have Finance" to every Vikray user alive, and the order
 * screen would have offered an Invoice button that 403s on the click. It reads
 * `/v1/ganit/invoices?limit=1` instead: still the cheapest read in the module,
 * and still behind `require_module("ganit")` alone.
 *
 * The products it used to return came from the same call, so the two questions
 * had been sharing one request. They are separate now: `loadProducts()` reads
 * the shared catalogue and works for a firm with no Finance module at all.
 */
let ganitProbe = null;
export function probeGanit() {
  if (!ganitProbe) {
    ganitProbe = api.get('/v1/ganit/invoices', { params: { limit: 1 } })
      .then(() => ({ ok: true }))
      .catch(e => (e.response?.status === 403
        ? { ok: false }
        : { ok: true, soft: true }));
  }
  return ganitProbe;
}

/**
 * The product catalogue, once per session.
 *
 * `/v1/products` is gated on Ganit OR Vikray, so this resolves for a firm that
 * bought Sales alone — which is the whole point of the move. A failure returns
 * an empty list rather than throwing: an order form with no product dropdown is
 * degraded, an order form that will not render is broken.
 */
let productPromise = null;
export function loadProducts() {
  if (!productPromise) {
    productPromise = api.get('/v1/products')
      .then(r => ({ products: r.data?.data || [] }))
      .catch(() => ({ products: [] }));
  }
  return productPromise;
}

/** `null` while unknown, then `true` / `false`. Never blocks a render. */
export function useGanitAccess() {
  const [ok, setOk] = useState(null);
  useEffect(() => {
    let dead = false;
    probeGanit().then(r => { if (!dead) setOk(r.ok); });
    return () => { dead = true; };
  }, []);
  return ok;
}
