/**
 * The preview and the server must agree to the paisa on a discounted document.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * Until 2026-08-31 both sides taxed the value BEFORE the flat order discount,
 * and `previewTotals` carried a docstring saying the two "can disagree" about
 * the order in which discounts apply. That caveat is what let a real defect
 * look like a rounding tolerance: the server over-stated output tax by ₹900 on
 * SO-2026-0007 and on the tax invoice raised from it, and the preview agreed
 * with it — so nothing on screen looked wrong.
 *
 * s.15(3)(a) CGST Act excludes an invoice-recorded discount from the
 * transaction value, so tax is charged on the net. Both sides now do that,
 * apportioned pro-rata across lines because lines may carry different
 * `gst_rate`s and a lump deduction would misstate the CGST/SGST/IGST split.
 *
 * ⚠ THE EXPECTED FIGURES BELOW ARE THE SERVER'S, NOT THE PREVIEW'S. They were
 * produced by `backend/routers/vikray.py::_compute_order_totals` and are held
 * here as constants, so this file fails if the client drifts away from the
 * server — which is the failure that actually happened. Do not "fix" a failure
 * here by editing the constant; check which side moved.
 * The server side is pinned by `backend/tests/test_vikray_order_discount_is_not_taxed.py`.
 */
import { describe, it, expect } from 'vitest';

import { previewTotals } from '../_shared';

const r2 = n => Math.round(n * 100) / 100;

describe('previewTotals — a recorded discount leaves the taxable value', () => {
  it('matches the server on SO-2026-0007, the live order that found the bug', () => {
    // 4 × 7500 = 30000 gross, 5000 discount → 25000 taxable @ 18% = 4500.
    const t = previewTotals([{ quantity: 4, rate: 7500, gst_rate: 18 }], 5000);
    expect(r2(t.subtotal)).toBe(30000);
    expect(r2(t.gst)).toBe(4500);      // was 5400 — 18% of the GROSS
    expect(r2(t.total)).toBe(29500);
  });

  it('matches the server on SO-2026-0035, the mixed-rate case', () => {
    // 4 × 17500 @ 18% + 2 × 8500 @ 5%, less 5000 apportioned pro-rata.
    const t = previewTotals([
      { quantity: 4, rate: 17500, gst_rate: 18 },
      { quantity: 2, rate: 8500, gst_rate: 5 },
    ], 5000);
    expect(r2(t.subtotal)).toBe(87000);
    expect(r2(t.gst)).toBe(12677.01);  // was 13450
    expect(r2(t.total)).toBe(94677.01);
  });

  it('leaves an undiscounted order untouched — the overwhelming majority', () => {
    const t = previewTotals([{ quantity: 4, rate: 7500, gst_rate: 18 }], 0);
    expect(r2(t.gst)).toBe(5400);
    expect(r2(t.total)).toBe(35400);
  });

  it('keeps a per-line percentage discount working as it always did', () => {
    const t = previewTotals([{ quantity: 1, rate: 10000, gst_rate: 18, discount_pct: 10 }], 0);
    expect(r2(t.subtotal)).toBe(9000);
    expect(r2(t.gst)).toBe(1620);
  });

  it('charges the same tax whether 10% comes off the line or ₹1000 off the order', () => {
    const perLine = previewTotals([{ quantity: 1, rate: 10000, gst_rate: 18, discount_pct: 10 }], 0);
    const flat = previewTotals([{ quantity: 1, rate: 10000, gst_rate: 18 }], 1000);
    expect(r2(flat.gst)).toBe(r2(perLine.gst));
    expect(r2(flat.total)).toBe(r2(perLine.total));
  });

  it('never taxes a negative value when the discount exceeds the order', () => {
    const t = previewTotals([{ quantity: 1, rate: 30000, gst_rate: 18 }], 99999);
    expect(r2(t.gst)).toBe(0);
  });

  it('survives an empty or zero-value order without dividing by zero', () => {
    expect(r2(previewTotals([], 500).gst)).toBe(0);
    expect(r2(previewTotals([{ quantity: 1, rate: 0, gst_rate: 18 }], 0).gst)).toBe(0);
  });

  it('only ever reduces the tax — a preview must never quote MORE than before', () => {
    const lines = [{ quantity: 4, rate: 7500, gst_rate: 18 }];
    const none = previewTotals(lines, 0).gst;
    for (const d of [1, 100, 5000, 29999]) {
      expect(previewTotals(lines, d).gst).toBeLessThan(none + 1e-9);
    }
  });
});
