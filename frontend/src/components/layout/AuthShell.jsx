import React, { useEffect, useState } from 'react';
import '../../styles/auth.css';

/**
 * AuthShell — the split sign-in shell (12-auth-onboarding.md §1, §2).
 *
 * This was the last screen still on the old cold-blue system: #f4fafd page,
 * #d0e8f5 borders, #0a1628 text, #8aa5be copy, all baked in as literals. It is
 * the FIRST screen anyone sees, and because none of those values were tokens it
 * could not respond to the theme at all — a user with dark mode set got a white
 * sign-in page and then a near-black app one click later.
 *
 * Commit 884e11a moved the shell itself onto tokens and put the `.au` grid in
 * styles/settings.css. What 12 §5 still asked for, and what this adds, is the
 * watermark and the rotating module line — plus the removal of the last cold
 * blue on the surface, `KLogo`, which paints `K.gradD`
 * (`linear-gradient(135deg,#0082c6,#05b7aa)`) and cannot follow the accent.
 * The mark below is drawn from --primary / --primary-vivid instead, so a user
 * who picks Rose does not get a blue logo on the sign-in page.
 *
 * The brand panel is CONSTANT across login, accept-invite, forgot and reset —
 * AUTH-SPEC: "the left half never changes shape while the right half does". The
 * per-screen heading therefore belongs in the form pane, not here, which is why
 * this no longer takes `title` / `sub`.
 *
 * The panel is HIDDEN below 900px rather than stacked. Stacking a tall
 * decorative panel above the form on a phone means scrolling past marketing to
 * reach a password field.
 */

/**
 * Three variants, 7s apart, with dots to jump — AUTH-SPEC "Shared auth shell".
 *
 * AUTH-SPEC's second panel is a commercial figure and its third is a customer
 * quote; the spec flags both as placeholder, and the same file says the figures
 * "contradict the real plan model". Neither ships. A number on the sign-in
 * screen is a commitment the billing model has not made, and an invented quote
 * is a fabricated reference. Both slots carry a claim that is true today
 * instead: a second module, and the invite-only access rule.
 *
 * `hi` is fixed decorative Devanagari and renders in --font-hindi (24 §
 * watermark exception); it is not a translated string and does not follow the
 * language setting.
 */
const ROTATE = [
  {
    id: 'ganit',
    kind: 'Module', hi: 'गणित', en: 'Ganit · Finance',
    line: 'GST-ready invoices, e-way bills and TDS in the same ledger your CA already understands.',
    foot: 'One of 15 modules. Turn on only what you need.',
  },
  {
    id: 'dristi',
    kind: 'Module', hi: 'दृष्टि', en: 'Dristi · Reports',
    line: 'Reports, dashboards and pivots built on the records the other modules already keep — nothing to export first.',
    foot: 'Every module writes to the same ledger.',
  },
  {
    id: 'access',
    kind: 'Access', hi: 'कर्तव्य', en: 'Invite only',
    line: 'There is no public sign-up. Every account is created by someone already inside your organisation.',
    foot: 'Need access? Ask your admin, or talk to us.',
  },
];

/**
 * The mark. `KLogo` painted `linear-gradient(135deg,#0082c6,#05b7aa)` — the
 * retired brand blue (00 §9) — and could not follow the accent, so a user on
 * Rose still got a blue logo on the sign-in page. Drawn from --primary /
 * --primary-vivid instead, with the glyph on --on-primary, which is the ground's
 * declared partner and therefore correct in both themes without a literal.
 *
 * The corner has NO `rx` attribute: 00 §3 forbids a literal radius outright, and
 * a baked-in 9 would ignore the user's Border radius setting. `.au__mark` rounds
 * it from --r-md in auth.css.
 */
function Mark({ size = 36 }) {
  return (
    <svg className="au__mark" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <defs>
        <linearGradient id="au-mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--primary)" />
          <stop offset="1" stopColor="var(--primary-vivid)" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" fill="url(#au-mark-g)" />
      <path d="M8 18L18 8L28 18L18 28L8 18Z" stroke="var(--on-primary)" strokeWidth="1.8" fill="none" />
      <path d="M13 18L18 13L23 18L18 23L13 18Z" fill="var(--on-primary)" opacity=".85" />
    </svg>
  );
}

function BrandPanel() {
  const [i, setI] = useState(0);

  // Auto-advancing content is moving content (WCAG 2.2.2). A user who asked
  // their OS for less motion gets the first panel and the dots, not a carousel
  // that changes under them while they are typing a password.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % ROTATE.length), 7000);
    return () => clearInterval(t);
  }, []);

  const r = ROTATE[i];
  return (
    <aside className="au__brand">
      <div className="au__mesh" aria-hidden="true" />
      {/* lang="hi" is not only for screen readers here (it is aria-hidden):
          .au__wm sets letter-spacing:-.03em, which at this size is ~7.7px of
          negative tracking pulling the र्त and व्य conjuncts of कर्तव्य apart.
          The [lang="hi"] rule in editorial.css resets tracking to 0, which is
          what 24-bilingual-devanagari.md requires for Devanagari. */}
      <span className="au__wm" lang="hi" aria-hidden="true">कर्तव्य</span>

      <div className="au__top">
        <Mark size={36} />
        <div>
          <div className="au__wordmark">Kartavaya</div>
          <div className="au__by">by Aekam Inc</div>
        </div>
      </div>

      <div className="au__mid">
        <h2 className="au__title">Your business,<br /><em className="au__em">one platform.</em></h2>
        <p className="au__sub">
          आपका व्यापार, एक ही जगह — projects, clients, money, people and messaging,
          without stitching five tools together.
        </p>
      </div>

      <div className="au__rot" key={i}>
        <div className="au__rot-k">{r.kind}</div>
        <div className="au__rot-t">
          <span className="au__rot-hi" lang="hi">{r.hi}</span>
          <span className="au__rot-en">{r.en}</span>
        </div>
        <p className="au__rot-l">{r.line}</p>
        <div className="au__rot-f">{r.foot}</div>
      </div>

      <div className="au__dots">
        {ROTATE.map((v, n) => (
          <button
            key={v.id}
            type="button"
            className={'au__dotb' + (n === i ? ' on' : '')}
            onClick={() => setI(n)}
            aria-label={`Show panel ${n + 1} of ${ROTATE.length}: ${v.kind} — ${v.en}`}
            aria-current={n === i ? 'true' : undefined}
          />
        ))}
      </div>
    </aside>
  );
}

export default function AuthShell({ children, shake = false }) {
  return (
    <div className="au">
      <BrandPanel />
      <main className="au__form">
        <div className={'au__box' + (shake ? ' is-shake' : '')}>
          {children}
          <div className="au__foot">
            <span>Powered by</span>
            <span className="au__dot" aria-hidden="true" />
            <span className="au__aekam">Aekam Inc</span>
          </div>
        </div>
      </main>
    </div>
  );
}
