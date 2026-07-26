/**
 * gst.js — the GST split for an Aekam subscription invoice.
 *
 * 11-platform-admin.md §Other defects: "For an Indian tax invoice the *rate*
 * may be 18% but the *breakdown* is not one number — inter-state is IGST 18%,
 * intra-state is CGST 9% + SGST 9%, and the invoice must show whichever applies
 * as separate lines."
 *
 * ── What is true of the STORE, and must not be confused ──────────────────────
 *
 * `staging.subscription_invoices` really does carry a single flat `gst` column,
 * and `POST /api/v1/subscription/admin/invoices` really does compute
 * `round(subtotal * 0.18, 2)` into it. That is Aekam billing its own customers.
 *
 * `staging.ganit_invoices` is a DIFFERENT table for a different purpose — a
 * tenant raising a tax invoice against their own client — and it already has
 * full `cgst` / `sgst` / `igst` / `place_of_supply` / `is_igst` columns. The two
 * are not the same surface and the flat column is not a defect in Ganit.
 *
 * So this module computes and DISPLAYS the correct split, and the total it
 * produces is the number that goes into the one column the API accepts. It does
 * not pretend the split is persisted. Splitting it in the store is a migration
 * on `subscription_invoices`, which is outside this batch.
 *
 * ── Why the treatment is chosen and not inferred silently ────────────────────
 *
 * The split depends on supplier state vs place of supply. The customer's state
 * is derivable — it is the first two digits of their GSTIN. The supplier's is
 * not present anywhere in the app. Guessing it would produce a confidently
 * wrong tax document, which is worse than asking, so: derive the default when
 * both ends are known, and let the operator set it when they are not.
 */

/** Supplier state code, if the deployment has been told. Never guessed. */
const SUPPLIER_STATE = String(import.meta.env.VITE_AEKAM_STATE_CODE || '').trim();

export const GST_RATE = 0.18;

/** GSTIN: first two characters are the state code. */
export function stateCodeOf(gstin) {
  const v = String(gstin ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return /^[0-9]{2}/.test(v) ? v.slice(0, 2) : null;
}

/**
 * 'intra' (CGST + SGST) · 'inter' (IGST) · null when it cannot be determined.
 *
 * null is a real answer and the form renders it as an unmade choice, not as a
 * default. A tax treatment nobody decided is the one thing this must not emit.
 */
export function defaultTreatment(customerGstin) {
  const customer = stateCodeOf(customerGstin);
  if (!customer || !/^[0-9]{2}$/.test(SUPPLIER_STATE)) return null;
  return customer === SUPPLIER_STATE ? 'intra' : 'inter';
}

export const supplierStateKnown = () => /^[0-9]{2}$/.test(SUPPLIER_STATE);

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {number} subtotal
 * @param {'intra'|'inter'|null} treatment
 * @returns {{subtotal:number, lines:Array<{label:string, rate:number, amount:number}>, gst:number, total:number, treatment:string|null}}
 *
 * `lines` is what the invoice prints. `gst` is the single number the current
 * API column accepts. They always agree to the paisa, because `gst` is the sum
 * of the lines rather than a second independent calculation — two roundings of
 * the same figure is how an invoice ends up off by one paisa.
 */
export function gstBreakdown(subtotal, treatment) {
  const base = r2(subtotal);
  let lines = [];

  if (treatment === 'intra') {
    const half = r2(base * (GST_RATE / 2));
    lines = [
      { label: 'CGST', rate: GST_RATE / 2, amount: half },
      { label: 'SGST', rate: GST_RATE / 2, amount: half },
    ];
  } else if (treatment === 'inter') {
    lines = [{ label: 'IGST', rate: GST_RATE, amount: r2(base * GST_RATE) }];
  } else {
    // Undetermined: show the rate, name nothing. "GST 18%" on a document that
    // has to say CGST or IGST is not a compliant line, and labelling it as
    // undetermined is what makes that visible before it is sent.
    lines = [{ label: 'GST (treatment not set)', rate: GST_RATE, amount: r2(base * GST_RATE) }];
  }

  const gst = r2(lines.reduce((s, l) => s + l.amount, 0));
  return { subtotal: base, lines, gst, total: r2(base + gst), treatment: treatment || null };
}

export const TREATMENTS = [
  { id: 'intra', label: 'Intra-state — CGST + SGST' },
  { id: 'inter', label: 'Inter-state — IGST' },
];
