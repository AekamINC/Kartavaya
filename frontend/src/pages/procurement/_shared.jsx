// Procurement · shared vocabulary for the purchase-order screens.
//
// Every colour is a token reference, never a literal: a badge that hardcodes
// its light-mode colour renders that colour on dark surfaces too, which is how
// every invoice badge in Ganit ended up unreadable before `_shared.jsx` there
// was cleaned out.
import React from 'react';

/** The lifecycle, in the order proposal 77 draws it. */
export const PO_STATUSES = [
  'draft', 'awaiting_approval', 'rejected', 'issued',
  'part_received', 'received', 'closed', 'cancelled',
];

/** What a person calls each status. The database values are snake_case and a
 *  screen that renders them raw reads like a log file. */
export const PO_STATUS_LABELS = {
  draft: 'Draft',
  awaiting_approval: 'Awaiting approval',
  rejected: 'Rejected',
  issued: 'Issued',
  part_received: 'Part received',
  received: 'Received',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const PO_STATUS_COLORS = {
  draft: 'var(--on-surface-3)',
  awaiting_approval: 'var(--warn)',
  rejected: 'var(--danger)',
  issued: 'var(--st-in-progress)',
  part_received: 'var(--st-in-review)',
  received: 'var(--ok)',
  closed: 'var(--on-surface-3)',
  cancelled: 'var(--danger)',
};

/** Statuses that count as committed spend — ordered, not yet discharged.
 *  Mirrors `services/purchase_orders.OPEN_STATUSES`; the server is the
 *  authority and this is only what the client greys out. */
export const OPEN_STATUSES = ['issued', 'part_received', 'received'];

export function Badge({ text, color }) {
  return (
    <span className="gn-tag" style={{ color, borderColor: color }}>
      {PO_STATUS_LABELS[text] || text}
    </span>
  );
}

/** A blank line, the shape the form and the server agree on. */
export const EMPTY_LINE = {
  product_id: '', description: '', hsn_code: '', sac_code: '',
  qty_ordered: 1, unit: 'NOS', rate: 0, gst_rate: 18, discount_pct: 0,
};

export const BLANK_PO = {
  vendor_id: '', po_date: '', expected_date: '', department: '', category: '',
  currency: 'INR', place_of_supply: '', is_igst: false, terms: '', notes: '',
  delivery_address: {}, line_items: [{ ...EMPTY_LINE }],
};

/**
 * The order total, computed the way the SERVER computes it.
 *
 * A form that shows a total the server then disagrees with is worse than a form
 * that shows nothing, so the rounding here is the same order of operations as
 * `services/purchase_orders.compute_po_totals` — line total rounded first, GST
 * on the rounded figure, CGST and SGST each half of that, rounded again. The
 * server's answer is still what is stored; this is a preview.
 */
export function previewTotals(lines, isIgst) {
  let subtotal = 0; let cgst = 0; let sgst = 0; let igst = 0;
  (lines || []).forEach((l) => {
    const qty = Number(l.qty_ordered) || 0;
    const rate = Number(l.rate) || 0;
    const disc = Number(l.discount_pct) || 0;
    let lineTotal = qty * rate;
    if (disc > 0) lineTotal *= (1 - disc / 100);
    lineTotal = Math.round(lineTotal * 100) / 100;
    const gst = Math.round((lineTotal * (Number(l.gst_rate) || 0) / 100) * 100) / 100;
    if (isIgst) igst += gst;
    // The halves are EXACT: round one, subtract for the other. Rounding both
    // independently rounds an odd paisa UP TWICE, so CGST+SGST exceeds the tax
    // on the line and the same goods total more intra-state than inter-state.
    // Matches `services/purchase_orders.py`, which this preview shadows — a PO
    // is matched against the invoice it becomes, and a paisa apart is reported
    // as a tax discrepancy on an otherwise correct match.
    else {
      const half = Math.round((gst / 2) * 100) / 100;
      cgst += half; sgst += Math.round((gst - half) * 100) / 100;
    }
    subtotal += lineTotal;
  });
  const r = (n) => Math.round(n * 100) / 100;
  return { subtotal: r(subtotal), cgst: r(cgst), sgst: r(sgst), igst: r(igst),
    total: r(subtotal + cgst + sgst + igst) };
}
