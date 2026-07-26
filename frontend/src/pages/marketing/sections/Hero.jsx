import React from 'react';
import { PRIMARY_CTA, SECONDARY_CTA, ctaReady } from '../cta';

/**
 * Hero — headline, subhead, CTA pair, trust line, product visual.
 *
 * The visual is a real task card and a real status chip, using the product's
 * own classes, rendered small inside a browser frame. Not an illustration:
 * an illustration of a UI is a promise the product has to keep, and it
 * usually differs in a way that reads as bait. This also makes the marketing
 * page a consumer of the design system, so a token change reaches it too.
 *
 * Static markup only — no fetching, no effects, no skeletons. These are
 * pictures that happen to be made of components.
 */
export default function Hero() {
  return (
    <header className="lhero">
      <div className="lwrap lhero__grid">
        <div data-rev>
          <h1 className="lhero__h">
            Practice management that speaks<br />
            <em lang="sa">आपकी भाषा</em>
          </h1>
          <p className="lhero__sub">
            Tasks, invoicing, payroll and client approvals for Indian accounting
            firms — in one place, with GST built in rather than bolted on.
          </p>

          <div className="lhero__ctas">
            {/* Rendered as a button with no href until a destination exists,
                so it cannot silently become a dead link in production. */}
            {ctaReady ? (
              <a className="lcta lcta--fill" href={PRIMARY_CTA.href}>{PRIMARY_CTA.label}</a>
            ) : (
              <button className="lcta lcta--fill" type="button" disabled
                      title="Destination not configured — see pages/marketing/cta.js">
                {PRIMARY_CTA.label}
              </button>
            )}
            <a className="lcta lcta--out" href={SECONDARY_CTA.href}>{SECONDARY_CTA.label}</a>
          </div>

          {/* Invite-only stated plainly rather than buried. Someone who cannot
              sign themselves up should learn that here, not after clicking. */}
          <p className="lhero__trust">
            Invite-only. Your firm’s admin adds you — there is no public sign-up.
          </p>
        </div>

        <div data-rev>
          <div className="lframe" aria-hidden="true">
            <div className="lframe__bar">
              <span className="lframe__dot" /><span className="lframe__dot" /><span className="lframe__dot" />
            </div>
            <div className="lframe__body">
              <article className="k-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span className="k-statuschip" style={{ '--c': 'var(--st-in-progress)' }}>
                    <span className="k-statuschip__dot" />In progress
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>GST · Q2</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--on-surface)' }}>
                  GSTR-3B — Nirmal Exports
                </div>
                <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                  Due in 3 days · assigned to Rhea
                </div>
              </article>

              <article className="k-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span className="k-statuschip" style={{ '--c': 'var(--ap-pending-client)' }}>
                    <span className="k-statuschip__dot" />Awaiting client
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--on-surface)' }}>
                  Invoice INV-2043 — ₹1,24,500
                </div>
                <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                  Sent for approval · 2 days ago
                </div>
              </article>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
