// Constants and helpers shared across the vikray tabs.
//
// Nothing here is a colour literal or a second copy of a formatter: order
// status colour is `lib/statusColors.js` (ORDER_COLORS, already on 00 §9
// tokens) and rupees are `lib/inr.js`. VikrayPage carried a private `lakh()`
// that `inrShort` already does — the ninth reimplementation of Indian digit
// grouping in the tree, and the reason a figure could read "₹5.6 L" on one
// surface and "₹5.6L" on the next.
import { useEffect, useState } from 'react';
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
 * behind the same gate — the product catalogue the order form already needs —
 * and caches the one promise for the session. A 403 is the answer; any other
 * failure is not, and leaves the action available rather than hiding a control
 * over a dropped connection.
 */
let ganitProbe = null;
export function probeGanit() {
  if (!ganitProbe) {
    ganitProbe = api.get('/v1/ganit/products')
      .then(r => ({ ok: true, products: r.data?.data || [] }))
      .catch(e => (e.response?.status === 403
        ? { ok: false, products: [] }
        : { ok: true, products: [], soft: true }));
  }
  return ganitProbe;
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
