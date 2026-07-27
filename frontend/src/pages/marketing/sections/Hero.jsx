import React from 'react';
import { PRIMARY_CTA, SECONDARY_CTA, ctaReady, CTA_PENDING_NOTE } from '../cta';

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
          {/* आपकी भाषा is Hindi, not Sanskrit — आपकी is the Hindi possessive.
              It was marked lang="sa", which sends a screen reader to the wrong
              language and, under 24's rules, the wrong line-height.
              `.lhero__h em` now also sets --font-hindi: it was inheriting
              --font-display and rendering through per-glyph fallback. */}
          <h1 className="lhero__h">
            Practice management that speaks<br />
            <em lang="hi">आपकी भाषा</em>
          </h1>
          <p className="lhero__sub">
            Tasks, invoicing, payroll and client approvals for Indian accounting
            firms — in one place, with GST built in rather than bolted on.
          </p>

          <div className="lhero__ctas">
            {/* Until a destination exists the primary CTA is not rendered as a
                link at all. Two failure modes are being avoided, not one: a
                dead href, and — the version this replaces — a DISABLED button
                still carrying .lcta--fill, which paints full primary and reads
                as live right up until the click does nothing. .lcta:disabled
                now mutes it, and the reason is stated in visible copy below
                rather than in a title tooltip aimed at a developer. */}
            {ctaReady ? (
              <a className="lcta lcta--fill" href={PRIMARY_CTA.href}>{PRIMARY_CTA.label}</a>
            ) : (
              <button className="lcta lcta--fill" type="button" disabled
                      aria-describedby="lp-cta-note">
                {PRIMARY_CTA.label}
              </button>
            )}
            <a className="lcta lcta--out" href={SECONDARY_CTA.href}>{SECONDARY_CTA.label}</a>
          </div>

          {/* Invite-only stated plainly rather than buried. Someone who cannot
              sign themselves up should learn that here, not after clicking. */}
          <p className="lhero__trust" id="lp-cta-note">
            {ctaReady
              ? 'Invite-only. Your firm’s admin adds you — there is no public sign-up.'
              : CTA_PENDING_NOTE}
          </p>
        </div>

        <div data-rev>
          <div className="lframe" aria-hidden="true">
            <div className="lframe__bar">
              <span className="lframe__dot" /><span className="lframe__dot" /><span className="lframe__dot" />
            </div>
            <div className="lframe__body">
              <article className="k-card lfrag">
                <div className="lfrag__row">
                  <span className="k-statuschip" style={{ '--c': 'var(--st-in-progress)' }}>
                    <span className="k-statuschip__dot" />In progress
                  </span>
                  <span className="lfrag__meta">GST · Q2</span>
                </div>
                <div className="lfrag__t">
                  GSTR-3B — Nirmal Exports
                </div>
                <div className="lfrag__d">
                  Due in 3 days · assigned to Rhea
                </div>
              </article>

              <article className="k-card lfrag">
                <div className="lfrag__row">
                  <span className="k-statuschip" style={{ '--c': 'var(--ap-pending-client)' }}>
                    <span className="k-statuschip__dot" />Awaiting client
                  </span>
                </div>
                <div className="lfrag__t">
                  Invoice INV-2043 — ₹1,24,500
                </div>
                <div className="lfrag__d">
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
