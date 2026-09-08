/**
 * platform — is this the installed app, or the website?
 *
 * The two need different first screens, and until now they got the same one.
 *
 * `/` renders the marketing landing page to anyone not signed in: a hero, a
 * module tour, plans, a "Request a demo" button. That is right on the web,
 * where the page's job is to explain the product to someone who has never seen
 * it. It is wrong in the APK, where the person has already been given an
 * account by their firm's admin, already installed a 8MB app, and is opening it
 * to do a day's work. Nobody installs an app and then needs convincing to try
 * the product.
 *
 * Same reasoning one screen deeper: the sign-in page devotes half its width to
 * a rotating panel selling Ganit, Dristi and the invite-only access model. On a
 * tablet in landscape that panel is 640px of advertising shown to someone whose
 * only intent is to type a password they already have.
 *
 * ── What counts as "the app" ────────────────────────────────────────────────
 *
 * Capacitor is the definite case: `window.Capacitor` is injected by the native
 * bridge, so its presence is proof, not a guess.
 *
 * An INSTALLED PWA counts too. A user who added Kartavaya to their home screen
 * from the browser is in exactly the same position — they have an account, they
 * launched from an icon, and a standalone window with no address bar is not
 * where anyone browses marketing copy. `display-mode: standalone` is how the
 * platform reports that, and `navigator.standalone` is the iOS Safari spelling
 * of the same fact.
 *
 * Deliberately NOT included: viewport width, user agent, touch support. A
 * narrow browser window is still the website, and someone reading the landing
 * page on a phone should still get the landing page. This asks how the product
 * was LAUNCHED, which is the question that actually distinguishes the cases.
 */

/** True inside the Capacitor container — the APK or an iOS build. */
export function isNativeApp() {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  if (!cap) return false;
  // Capacitor 8 exposes a function; older bridges set a boolean. Accept both
  // rather than depending on a bridge version the web build never loads.
  if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
  return cap.isNative === true;
}

/**
 * True for the APK and for an installed PWA — anything launched from an icon
 * rather than typed into an address bar.
 *
 * Read at call time, not cached at module load: the bridge is injected before
 * the bundle evaluates, but `display-mode` can change within a session when a
 * browser tab is installed to the home screen, and a stale `false` would strand
 * that user on marketing copy for the rest of the session.
 */
export function isInstalledApp() {
  if (typeof window === 'undefined') return false;
  if (isNativeApp()) return true;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch { /* matchMedia is absent in some embedded webviews */ }
  return window.navigator?.standalone === true;
}

/**
 * True on the APP host — the one whose whole job is signing in.
 *
 * ── Why a hostname decides this ─────────────────────────────────────────────
 *
 * `www.` is the landing page and where the CTA lands. `app.` is login and the
 * product behind it. They are ONE Cloudflare Pages project and one build —
 * `RootGate` picks a face from whether there is a user — so without this a
 * logged-out visitor to `app.kartavaya.com` gets marketing copy rather than the
 * sign-in form they came for.
 *
 * It is the same judgement `isInstalledApp()` above already makes, for the same
 * reason: someone arriving at `app.` was sent there by an invite, an approval
 * mail or a bookmark. The landing page's job — explaining the product to a
 * stranger — is already done by the time they get there.
 *
 * ⚠ Prefix-matched on `app.`, not an equality test against one FQDN, so it holds
 * on `app.kartavaya.com` and on any future `app.<something>` without another
 * edit. Deliberately does NOT match `staging.` or a preview deployment: those
 * are whole-product hosts where the landing page is still worth seeing.
 */
export function isAppHost() {
  if (typeof window === 'undefined') return false;
  const host = window.location?.hostname;
  return typeof host === 'string' && host.startsWith('app.');
}

// ── Which host serves which page ───────────────────────────────────────────────
//
// ⚠ ALL FOUR WEB HOSTS ARE ONE CLOUDFLARE PAGES PROJECT AND ONE BUILD.
// `docs/DNS-AND-SUBDOMAINS.md` §"The confirmed topology". So every host already
// serves every route, nothing 404s, and the split below is real only because
// the bundle enforces it. There is no server here to enforce it and no test in
// the world goes red when it is ignored — the pages all work on the wrong host,
// which is exactly why this drifted for months.
//
//   kartavaya.com / www.   the landing page, and the legal documents a stranger
//                          reads while deciding — the only surface with no
//                          account behind it
//   app.kartavaya.com      login and the product — the backend's `FRONTEND_URL`
//   pay.kartavaya.com      the public invoice — the backend's `PAY_URL`
//
// The damage from getting it wrong is NOT a 404. It is a session on the wrong
// origin: `localStorage` is per-origin, so a person who signs in at the apex
// holds a session `app.kartavaya.com` cannot read, while every link the backend
// mails them — invite, approval, password reset, task — is built from
// `FRONTEND_URL` and lands on `app.`. They are asked to log in again by a
// product that believes they already are, and no screen can explain it.

/** The two hosts email links are built from. Named once; see the map above. */
const APP_HOST = 'app.kartavaya.com';
const PAY_HOST = 'pay.kartavaya.com';

/** The path the sign-in form lives at, on every host that serves it. */
const LOGIN_PATH = '/login';

/**
 * The hosts that serve the LANDING page rather than the product.
 *
 * Named, not pattern-matched — the opposite choice from `isAppHost()` above,
 * for the opposite reason. A prefix loose enough to catch a future marketing
 * host is also loose enough to catch `pay.`, `staging.` or a preview, and the
 * cost of a wrong match here is a visitor thrown to a different ORIGIN than the
 * one they are reading. Adding a line when a marketing host is added is cheaper
 * than that, and the test below says where to add it.
 */
const MARKETING_HOSTS = new Set(['kartavaya.com', 'www.kartavaya.com']);

/**
 * Everything the marketing host is allowed to serve. An ALLOWLIST, deliberately.
 *
 * The inverse — listing what to redirect — would have to name sixty-odd routes
 * and would silently keep serving the sixty-first the day someone adds it. This
 * way a new route is on `app.` by default and only an explicit line moves it,
 * which is the direction the mistake should fall.
 *
 * The legal four are here because the people who read them have no account and
 * never will: a prospect evaluating the product and their counsel. They are
 * linked from the landing page's own footer, and they are the marketing site's
 * indexable surface — bouncing a stranger to the app host to read a privacy
 * policy reads as broken. Confirmed with the owner, 2026-09-08.
 */
const MARKETING_PATHS = new Set([
  '/',
  '/privacy',
  '/subprocessors',
  '/security',
  '/dpa',
]);

/**
 * Paths owned by the invoice host.
 *
 * `/i/:token` is the one page whose reader is the CUSTOMER'S customer —
 * `email_service.py` puts it on its own host on purpose, so that an invoice
 * link can never be mistaken for a session and the two can be cached and
 * rate-limited apart. A prefix, because the token is part of the path.
 */
const PAY_PREFIXES = ['/i/'];

/** True on the landing-page hosts, and only those. */
export function isMarketingHost() {
  if (typeof window === 'undefined') return false;
  return MARKETING_HOSTS.has(window.location?.hostname);
}

/** `/privacy/` is `/privacy`; `/` stays `/`. A trailing slash is not a route. */
function normalisePath(pathname) {
  const p = pathname || '/';
  return p.length > 1 ? p.replace(/\/+$/, '') || '/' : p;
}

/**
 * The absolute URL this page belongs at — or `null` when it is already home.
 *
 * Called once before React mounts (`index.jsx`), which is the whole point: the
 * alternative is rendering a protected page on the marketing host long enough
 * for it to fire its API calls and write to the wrong origin's storage, and
 * only then navigating away.
 *
 * ⚠ ONLY the marketing hosts are policed. `localhost`, a `*.pages.dev` preview
 * and `app.`/`pay.` themselves are left entirely alone — on those the app IS
 * the origin you are on. `frontend/e2e-real/diag.config.ts` drives
 * `kartavaya.pages.dev`, and sending it to production `app.` would take the
 * suite out of the build under test and into a different deploy.
 *
 * Takes the location rather than reading the global, so the test can drive it
 * with a plain object instead of stubbing a browser.
 */
export function offHostRedirect(loc) {
  const here = loc || (typeof window === 'undefined' ? null : window.location);
  if (!here || !MARKETING_HOSTS.has(here.hostname)) return null;

  const path = normalisePath(here.pathname);
  if (MARKETING_PATHS.has(path)) return null;

  const host = PAY_PREFIXES.some((p) => path.startsWith(p)) ? PAY_HOST : APP_HOST;
  // The ORIGINAL pathname, not the normalised one: this is where the visitor
  // was going, and `?from=`, `?expired=1` and `#anchor` are read on arrival.
  return `https://${host}${here.pathname || '/'}${here.search || ''}${here.hash || ''}`;
}

/**
 * Where "Sign in" on the landing page goes.
 *
 * ── The bug this closes ─────────────────────────────────────────────────────
 *
 * The link was `/login` — relative — so clicking it on `kartavaya.com` left the
 * visitor on `kartavaya.com/login`. That RENDERS: `www.` and `app.` are one
 * Pages project and one build, so the sign-in form appears and the password
 * works. Which is exactly why it survived. Nothing 404s, nothing errors, and
 * the visitor ends up running the whole product from the marketing host.
 *
 * It is not cosmetic. A session is stored per ORIGIN, so signing in at the apex
 * builds a session `app.kartavaya.com` cannot see — while every link the
 * backend mails is built from `FRONTEND_URL`, which is `https://app.kartavaya.com`
 * (`backend/email_service.py`): invites, approvals, password resets, task links.
 * One person then holds two half-signed-in origins, and no screen says why the
 * invite mail asked them to log in again.
 *
 * ⚠ ONLY the marketing hosts jump. `localhost`, a `*.pages.dev` preview and
 * `staging.` are whole-product hosts where the app IS the origin you are on —
 * `frontend/e2e-real/diag.config.ts` drives `kartavaya.pages.dev` — and sending
 * those to production `app.` would take a developer's click, or a suite's, out
 * of the build under test.
 */
export function signInHref() {
  return isMarketingHost() ? `https://${APP_HOST}${LOGIN_PATH}` : LOGIN_PATH;
}
