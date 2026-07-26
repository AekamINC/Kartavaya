import React from 'react';
import { inr } from '../../lib/inr';

/**
 * MarginCell — 11-platform-admin.md §1 "Margin, and where it may appear".
 *
 * "`.mgn__d` shows the working: USD metered cost, the FX rate used, the org's
 * markup_pct, and the INR charged. A margin number with no visible derivation
 * is unauditable, and this is the number the business runs on."
 *
 * ── The containment rule, and what this component can and cannot do ──────────
 *
 * 11 is unambiguous: "This class must never render outside
 * [data-surface="platform"]. Enforce it at the serializer: platform cost,
 * margin and markup fields do not belong in any tenant response, export, PDF or
 * support-agent view. **A CSS-level or component-level guard is not
 * sufficient** — someone will eventually reuse the component."
 *
 * So the guard below is not the enforcement and is not offered as one. It is a
 * tripwire: if this component is ever rendered inside the tenant app it renders
 * nothing and says why in the console, which turns a silent margin leak on a
 * customer's screen into a visible blank during development. The real control
 * is that the tenant API never serialises these fields — that is a backend
 * change and is listed in this batch's report as outstanding.
 */
function insidePlatformSurface(node) {
  if (!node || typeof node.closest !== 'function') return true;   // SSR / tests
  return Boolean(node.closest('[data-surface="platform"]'));
}

export default function MarginCell({ marginInr, costUsd, fxRate, markupPct, chargedInr, row }) {
  const ref = React.useRef(null);
  const [blocked, setBlocked] = React.useState(false);

  React.useEffect(() => {
    if (insidePlatformSurface(ref.current)) return;
    setBlocked(true);
    // Loud, and only in development — a warning in a customer's console is
    // itself a disclosure that these numbers exist.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error(
        'MarginCell rendered outside [data-surface="platform"]. Platform cost and ' +
        'margin must not reach a tenant surface — see 11-platform-admin.md §1.',
      );
    }
  }, []);

  if (blocked) return <span ref={ref} />;

  const margin = Number(marginInr) || 0;
  const parts = [];
  if (costUsd != null) parts.push(`$${(Number(costUsd) || 0).toFixed(2)}`);
  if (fxRate) parts.push(`× ₹${Number(fxRate).toFixed(2)}`);
  if (markupPct != null) parts.push(`+ ${Math.round((Number(markupPct) || 0) * 100)}%`);
  if (chargedInr != null) parts.push(`= ${inr(chargedInr, { decimals: 2 })}`);

  return (
    <span ref={ref} className={row ? 'mgn mgn--row' : 'mgn'}>
      <span className={margin < 0 ? 'mgn__v is-loss' : 'mgn__v'}>{inr(margin, { decimals: 2 })}</span>
      {parts.length > 0 && <span className="mgn__d">{parts.join(' ')}</span>}
    </span>
  );
}
