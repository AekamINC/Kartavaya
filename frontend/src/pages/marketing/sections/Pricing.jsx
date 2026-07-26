import React from 'react';
import { PRIMARY_CTA, ctaReady } from '../cta';

/**
 * Pricing — tier names only.
 *
 * ── NO FIGURES ON THIS PAGE, AND NONE IN THIS FILE ─────────────────────────
 * Not in copy, not as placeholder, not in a comment. Stated by the owner in
 * `_REQUEST-2026-07-26.md` §3.8 — "No pricing numbers anywhere in the design.
 * Not in the prototype, not in the spec, not on the landing page, not as
 * placeholder copy. Tier *names* are fine; figures are not."
 *
 * An earlier revision of this file kept the reasoning as a comment WITH the
 * numbers in it. That is the same disclosure with a slower fuse: comments get
 * quoted into commit messages, tickets and the next draft of the page, and a
 * figure that survives one copy-paste is published. The reasoning is kept, the
 * arithmetic is not — read the catalogue if you need it.
 *
 * ── Why no credit figures ──────────────────────────────────────────────────
 * The ledger's §5 audit of the live database found THREE different credit
 * allowances for the same tier, in three places: `plans.default_credits`,
 * `plans.features.srijan_credits_monthly`, and `hub_tiers.credits_monthly` —
 * `staging.hub_tiers` being a second parallel catalogue at the same prices with
 * a different feature shape. The ledger's instruction is explicit: "Resolve
 * before any pricing surface renders a number."
 *
 * An even earlier draft published the allowances from the hardcoded array in
 * AdminOrgsPage.jsx. That array agrees with one of the three sources, and
 * agreeing with one of three disagreeing sources is not verification. It would
 * have put a precise, confident, possibly wrong number in front of the audience
 * most likely to hold us to it.
 *
 * ── Why no rupee prices ────────────────────────────────────────────────────
 * List prices do exist in the catalogue. Two reasons they are not here even so:
 * `price_monthly` carries two incompatible unit conventions in one column — the
 * retired gen-1 rows and the live gen-2 rows are orders of magnitude apart — so
 * anything reading it without filtering `is_active` mixes them; and the backend
 * strips `price_monthly` for anyone who is not platform staff, which makes
 * publishing it a decision someone has to take rather than one to infer from a
 * table.
 *
 * ── Why no free tier ───────────────────────────────────────────────────────
 * Decided 2026-07-25: there is no free tier. `free` becomes `basic`, charged
 * manually per client by user count. The row still says `free` in
 * AdminOrgsPage.jsx and in staging.plans; that rename is a pending migration
 * with a small blast radius, both affected orgs already carrying a
 * monthly_price override. This page must not advertise a tier the business has
 * decided not to sell, so it says `basic` now.
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

        {/* One line per card, and nothing pinned to the bottom of it.
            `22` asks for the credit chip to be pinned with margin-top:auto,
            which was a real fix for a real 20px misalignment — but the chip it
            aligned held the per-tier credit figure, and there is no figure to
            hold. What was left was the same sentence repeated in all four
            cards, which is filler that looks like content. It says the one
            true thing once, below the grid, and the cards carry the only
            per-tier fact this page can stand behind: who the tier is for.
            Restore the pinned row when there is something per-tier to pin. */}
        <div className="lplans" data-rev>
          {PLANS.map(p => (
            <div className={`lplan${p.highlight ? ' lplan--hi' : ''}`} key={p.code}>
              <div className="lplan__n">{p.code}</div>
              <div className="lplan__d">{p.desc}</div>
            </div>
          ))}
        </div>

        {/* --primary is a FILL at 4.04:1 on --bg and is not a text colour;
            primary-coloured TEXT is --primary-text at 5.2:1 (00 §12). */}
        <p className="lplans__note">
          The monthly AI allowance rises with the tier. Pricing is set per firm
          against your headcount and volume.{' '}
          {ctaReady
            ? <a className="lplans__a" href={PRIMARY_CTA.href}>Talk to us</a>
            : <span className="lplans__a lplans__a--off">Talk to us</span>}
          {' '}for a quote.
        </p>
      </div>
    </section>
  );
}
