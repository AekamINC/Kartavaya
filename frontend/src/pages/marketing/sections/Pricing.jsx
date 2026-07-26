import React from 'react';
import { PRIMARY_CTA, ctaReady } from '../cta';

/**
 * Pricing — tiers only. NO NUMBERS, deliberately.
 *
 * ── Why no credit figures ──────────────────────────────────────────────────
 * The ledger's §5 audit of the live database found three different credit
 * allowances for the same tier, in three places:
 *
 *            plans.default_credits   plans.features   hub_tiers.credits_monthly
 *   Starter        500                    500                 1000
 *   Growth        1000                   1500                 1500
 *   Scale         2000                   5000                 2000
 *
 * staging.hub_tiers is a second parallel catalogue at the same prices with
 * different credits and a different feature shape. The ledger's instruction is
 * explicit: "Resolve before any pricing surface renders a number."
 *
 * An earlier draft of this file published 200/500/1000/2000, taken from the
 * hardcoded array in AdminOrgsPage.jsx. That array happens to match
 * plans.default_credits, but agreeing with one of three disagreeing sources is
 * not verification. Publishing it would put a precise, confident, possibly
 * wrong number in front of the audience most likely to hold us to it.
 *
 * ── Why no rupee prices ────────────────────────────────────────────────────
 * Real list prices DO exist (₹10,000 / ₹15,000 / ₹20,000 per month for
 * starter / growth / scale). Two reasons they are not here: price_monthly
 * carries two incompatible unit conventions in one column — the retired gen-1
 * rows are 99–249, the live gen-2 rows are 10,000–20,000 — so anything reading
 * the catalogue without filtering is_active mixes them; and the backend strips
 * price_monthly for anyone who is not platform staff, which means publishing it
 * is a decision someone has to make rather than one to infer from a table.
 *
 * ── Why no free tier ───────────────────────────────────────────────────────
 * Decided 2026-07-25: there is no free tier. `free` becomes `basic`, charged
 * manually per client by user count. The row still says `free` in
 * AdminOrgsPage.jsx and in staging.plans; that rename is a pending migration
 * (blast radius: 2 organisations, both already carrying a monthly_price
 * override). This page must not advertise a tier the business has decided not
 * to sell, so it says `basic` now.
 */
const PLANS = [
  { code: 'basic',   desc: 'A small practice getting off spreadsheets. Priced per user.' },
  { code: 'starter', desc: 'A single-office firm running tasks, invoicing and approvals.' },
  { code: 'growth',  desc: 'Multiple partners, client portal in daily use, payroll on.', highlight: true },
  { code: 'scale',   desc: 'Several offices, heavier AI use, higher document volume.' },
];

export default function Pricing() {
  return (
    <section className="lsec" id="pricing">
      <div className="lwrap">
        <div data-rev>
          <div className="lsec__kicker">Plans</div>
          <h2 className="lsec__h">Four tiers, priced for your firm</h2>
          {/* "Credits" means nothing to an accountant and sounds like a
              metering trick, so it gets defined in the first sentence rather
              than in a footnote. */}
          <p className="lsec__lede">
            Tiers differ by how much AI you use — a credit is one AI request
            against your own data, like drafting a reply, summarising a ledger
            or pulling a lead out of an email. Everything else is unmetered:
            tasks, invoices, payroll runs, client approvals and users are not
            counted.
          </p>
        </div>

        <div className="lplans" data-rev>
          {PLANS.map(p => (
            <div className={`lplan${p.highlight ? ' lplan--hi' : ''}`} key={p.code}>
              <div className="lplan__n">{p.code}</div>
              <div className="lplan__d">{p.desc}</div>
              {/* margin-top:auto pins this row to the bottom of every card
                  regardless of description length — a fixed description height
                  is what put the chips 20px out of alignment. */}
              <div className="lplan__cr">
                <div className="lplan__u">Monthly AI allowance rises with the tier</div>
              </div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 13.5, color: 'var(--on-surface-2)', marginTop: 22 }}>
          Pricing is set per firm against your headcount and volume.{' '}
          {ctaReady
            ? <a href={PRIMARY_CTA.href} style={{ color: 'var(--primary)' }}>Talk to us</a>
            : <span style={{ color: 'var(--on-surface-3)' }}>Talk to us</span>}
          {' '}for a quote.
        </p>
      </div>
    </section>
  );
}
