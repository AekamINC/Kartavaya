// Indian rupee formatting — one implementation.
//
// Indian digit grouping is 2,2,3 (₹5,01,500), not 3,3,3 (₹501,500). Getting it
// wrong is immediately visible to every user of this product. The rule is
// currently reimplemented across 87 call sites; this is the shared version.
//
// Pair every rendered figure with `font-variant-numeric: tabular-nums` — the
// .mtbl__num and .mk__v rules in styles/module.css already do.

/** Exact amount with Indian grouping: 501500 → "₹5,01,500". */
export function inr(value, { symbol = true, decimals = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return symbol ? '₹0' : '0';
  const s = n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return symbol ? `₹${s}` : s;
}

/**
 * Abbreviated for space-constrained surfaces: 501500 → "₹5.0L".
 * Lakh/crore, not K/M — an Indian CA reading "₹0.5M" has to convert it.
 */
export function inrShort(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const trim = s => s.replace(/\.0$/, '');
  if (abs >= 1_00_00_000) return `${sign}₹${trim((abs / 1_00_00_000).toFixed(1))}Cr`;
  if (abs >= 1_00_000)    return `${sign}₹${trim((abs / 1_00_000).toFixed(1))}L`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

/** Plain grouped integer, no symbol — counts, quantities. */
export const grouped = value =>
  Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-IN') : '0';
