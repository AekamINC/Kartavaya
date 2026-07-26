import React from 'react';
import { PRIMARY_CTA, ctaReady } from '../cta';

/**
 * Pricing — the real plan model.
 *
 * The four plans and their credit allowances come from the actual catalogue in
 * AdminOrgsPage.jsx: free 200, starter 500, growth 1,000, scale 2,000. An
 * earlier prototype showed Free / Pro / Enterprise at ₹4,999; that was invented
 * and none of those plans exist.
 *
 * No rupee figures are published here. The plans table does carry
 * `price_monthly`, but the backend strips it for anyone who is not platform
 * staff — so it is not a public list price today, and I am not going to invent
 * one. Credits are the headline number instead, which is what actually varies
 * between the plans.
 *
 * The monthly/annual toggle from the prototype is gone: it was meaningless
 * without listed prices. Restore it only if annual pricing genuinely exists.
 */
const PLANS = [
  { code: 'free',    credits: 200,   desc: 'Try the product with a small team and a real workload.' },
  { code: 'starter', credits: 500,   desc: 'A single-office firm running tasks, invoicing and approvals.' },
  { code: 'growth',  credits: 1000,  desc: 'Multiple partners, client portal in daily use, payroll on.', highlight: true },
  { code: 'scale',   credits: 2000,  desc: 'Several offices, heavier AI use, higher document volume.' },
];

export default function Pricing() {
  return (
    <section className="lsec" id="pricing">
      <div className="lwrap">
        <div data-rev>
          <div className="lsec__kicker">Plans</div>
          <h2 className="lsec__h">Priced on AI credits, not per seat</h2>
          {/* "Credits" means nothing to an accountant and sounds like a metering
              trick, so it gets defined in the first sentence rather than in a
              footnote. */}
          <p className="lsec__lede">
            A credit is one AI request against your own data — drafting a reply,
            summarising a ledger, extracting a lead from an email. Everything
            else in the product is unmetered: tasks, invoices, payroll runs,
            client approvals and users are not counted.
          </p>
        </div>

        <div className="lplans" data-rev>
          {PLANS.map(p => (
            <div className={`lplan${p.highlight ? ' lplan--hi' : ''}`} key={p.code}>
              <div className="lplan__n">{p.code}</div>
              <div className="lplan__d">{p.desc}</div>
              <div className="lplan__cr">
                <div className="lplan__n2">{p.credits.toLocaleString('en-IN')}</div>
                <div className="lplan__u">AI credits / month</div>
              </div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 13.5, color: 'var(--on-surface-2)', marginTop: 22 }}>
          Pricing is set per firm.{' '}
          {ctaReady
            ? <a href={PRIMARY_CTA.href} style={{ color: 'var(--primary)' }}>Talk to us</a>
            : <span style={{ color: 'var(--on-surface-3)' }}>Talk to us</span>}
          {' '}for a quote against your headcount and volume.
        </p>
      </div>
    </section>
  );
}
