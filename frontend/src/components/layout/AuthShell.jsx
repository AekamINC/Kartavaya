import React, { useEffect, useState } from 'react';
import '../../styles/auth.css';
import { isInstalledApp } from '../../lib/platform';

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

/**
 * Has the user asked for no motion, by EITHER route?
 *
 * There are two, and only one of them is a media query. The OS setting is
 * `prefers-reduced-motion: reduce`. The in-app setting is Customization →
 * Animations, which `applyPrefs` persists to `k_prefs` and then expresses as
 * inline `--ix-user` / `--motion-scale-user` custom properties on the root —
 * there is no attribute and no media feature for it, so nothing that only asks
 * matchMedia can see it.
 *
 * Measured before this existed: with Animations = None the sign-in panel still
 * changed its content every 7 seconds. The person had turned motion off inside
 * the product and the very first screen ignored them.
 *
 * Read from `k_prefs` rather than from `useCustomize()` for two reasons. The
 * hook THROWS outside CustomizeProvider and the e2e harness mounts LoginPage
 * with only ToastProvider and a MemoryRouter, so calling it here would fail
 * `__tests__/e2e/auth-session.test.jsx` on mount. And the computed
 * `--motion-scale` cannot be trusted at this moment either: React runs child
 * effects before parent ones, so this effect fires BEFORE the provider's
 * `applyPrefs`, and would read the stylesheet default of 1 every time.
 * localStorage is the one source that is already correct during the first
 * render. `SigningPage.jsx` reads the same key for the same reason.
 *
 * `anim: 'reduced'` still rotates — reduced means less, not none, and the
 * remaining motion is a 180ms fade of a panel the user is not interacting with.
 */
function prefersNoMotion() {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
  } catch { /* no matchMedia — fall through to the stored preference */ }
  try {
    return JSON.parse(window.localStorage?.getItem('k_prefs') || '{}').anim === 'none';
  } catch { return false; }
}

function BrandPanel() {
  const [i, setI] = useState(0);

  // Auto-advancing content is moving content (WCAG 2.2.2). A user who asked for
  // less motion gets the first panel and the dots, not a carousel that changes
  // under them while they are typing a password. The dots stay in both cases:
  // stopping the timer must not remove the way to read the other two panels.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (prefersNoMotion()) return undefined;
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

/**
 * AppCrown — the app's sign-in header.
 *
 * Two ideas, kept because they do different jobs and do not compete.
 *
 * The CROWN is the launcher icon's own gradient, curved along its lower edge,
 * with क centred in white. You tap a blue-to-teal tile with a क on it and the
 * app opens on a blue-to-teal field with a क on it — the screen answers the
 * icon. That continuity is the whole point; a login that opens on a different
 * palette from the icon that launched it reads as a different application.
 *
 * The WATERMARK is the same letter again, ghosted enormous on the paper below
 * and bleeding off the corner. It gives the lower two-thirds something to be
 * — without it the form sits on an empty field, which is what made the first
 * version anonymous. A display glyph running past the margin is the editorial
 * move the rest of this product is built on.
 *
 * Neither repeats the wordmark. The h1 under this already reads "Sign in to
 * Kartavaya"; setting the name again under the mark is what made the earlier
 * attempt feel padded, with the brand stated three times on one screen.
 *
 * क is fixed decorative Devanagari in var(font-hindi) — the 24 § watermark
 * exception. It is not a translated string and does not follow the language
 * setting; it is the product's own initial, used as texture.
 */
function AppCrown() {
  return (
    <div className="au__crown" aria-hidden="true">
      <span className="au__crown-glow" />
      <span className="au__crown-ka" lang="hi">क</span>
    </div>
  );
}

export default function AuthShell({ children, shake = false }) {
  /*
   * The brand panel is for the WEB. In the installed app it is dropped
   * entirely, and the form takes the full width.
   *
   * That panel is a sales pitch: "Your business, one platform", a rotating tour
   * of Ganit and Dristi, and a note explaining that access is invite-only. Every
   * word of it is aimed at someone deciding whether to use Kartavaya. Nobody
   * reaching this screen from an app icon is deciding that — their admin created
   * their account, they installed the app, and they are here to type a password.
   * Measured on an 11-inch tablet in landscape it occupied 640px, more than half
   * the screen, to tell an existing user about a product they already use.
   *
   * The CSS already hides it below 900px, which is why this was invisible on a
   * phone and obvious on a tablet. Hiding it by PLATFORM as well is the rule
   * that actually matches the reason.
   */
  const app = isInstalledApp();
  return (
    <div className={'au' + (app ? ' au--app' : '')}>
      {app && <span className="au__appwm" lang="hi" aria-hidden="true">क</span>}
      {!app && <BrandPanel />}
      {app && <AppCrown />}
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
