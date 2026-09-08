/**
 * The host split — which of the four hosts is allowed to serve which page.
 *
 * ── Why this is pinned, and pinned hard ─────────────────────────────────────
 *
 * `kartavaya.com`, `www.`, `app.` and `pay.` are ONE Cloudflare Pages project
 * and ONE build. Every host can already serve every route. So there is no
 * server to enforce this split, nothing 404s when it is broken, and NO OTHER
 * TEST IN THE REPO GOES RED — the pages all work on the wrong host. That is not
 * a hypothetical: the landing page shipped `href="/login"` and every visitor
 * who clicked Sign in ran the whole product from the marketing origin, for
 * months, with no error anywhere.
 *
 * The damage is a session on the wrong ORIGIN. `localStorage` is per-origin, so
 * signing in at the apex builds a session `app.kartavaya.com` cannot read,
 * while every link the backend mails is built from `FRONTEND_URL` and lands on
 * `app.`. The person is asked to log in again by a product that thinks they
 * already are.
 *
 * The negative cases carry as much weight as the positive ones. `localhost`, a
 * `*.pages.dev` preview and `app.`/`pay.` themselves must be left ALONE:
 * `e2e-real/diag.config.ts` drives `kartavaya.pages.dev`, and a rule that
 * bounced it to production `app.` would quietly move every suite off the build
 * under test.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { isMarketingHost, signInHref, offHostRedirect } from '../platform';

/** A location, without a browser. `offHostRedirect` takes one for this reason. */
function loc(hostname, pathname = '/', search = '', hash = '') {
  return { hostname, pathname, search, hash };
}

/** Drive the globals-reading predicates by moving the hostname, as appHost does. */
function at(hostname) {
  vi.stubGlobal('window', { location: { hostname } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isMarketingHost', () => {
  it.each(['kartavaya.com', 'www.kartavaya.com'])('is true on %s', (host) => {
    at(host);
    expect(isMarketingHost()).toBe(true);
  });

  it.each([
    ['app.kartavaya.com', 'the product'],
    ['pay.kartavaya.com', 'the public invoice'],
    ['kartavaya.pages.dev', 'the Pages origin the e2e suites drive'],
    ['staging.kartavaya.com', 'cancelled, and never a marketing host'],
    ['localhost', 'development'],
    ['kartavaya.com.evil.test', 'a suffix attack, not our apex'],
  ])('is false on %s — %s', (host) => {
    at(host);
    expect(isMarketingHost()).toBe(false);
  });

  it('is false with no window rather than throwing', () => {
    vi.stubGlobal('window', undefined);
    expect(isMarketingHost()).toBe(false);
  });
});

describe('signInHref — the link the landing page renders', () => {
  it.each(['kartavaya.com', 'www.kartavaya.com'])(
    'leaves %s for the app host, because the session belongs there',
    (host) => {
      at(host);
      expect(signInHref()).toBe('https://app.kartavaya.com/login');
    },
  );

  it.each([
    ['app.kartavaya.com', 'already home — an absolute link would be a pointless round trip'],
    ['localhost', 'development; production app. is not where a dev click should land'],
    ['kartavaya.pages.dev', 'the preview must sign in to the preview'],
  ])('stays relative on %s — %s', (host) => {
    at(host);
    expect(signInHref()).toBe('/login');
  });
});

describe('offHostRedirect — what the marketing host may serve', () => {
  it.each([
    ['/', 'the landing page itself'],
    ['/privacy', 'read by a stranger with no account'],
    ['/subprocessors', 'read by a stranger with no account'],
    ['/security', 'read by a stranger with no account'],
    ['/dpa', 'read by a stranger with no account'],
  ])('keeps %s — %s', (path) => {
    expect(offHostRedirect(loc('kartavaya.com', path))).toBeNull();
    expect(offHostRedirect(loc('www.kartavaya.com', path))).toBeNull();
  });

  it('keeps a legal page reached with a trailing slash — a slash is not a route', () => {
    expect(offHostRedirect(loc('kartavaya.com', '/privacy/'))).toBeNull();
  });

  it('sends the sign-in form to the app host', () => {
    expect(offHostRedirect(loc('kartavaya.com', '/login')))
      .toBe('https://app.kartavaya.com/login');
  });

  it('carries the query and hash across, because LoginPage reads them', () => {
    // `?from=` is the difference between arriving where you were going and
    // arriving at the dashboard; `?expired=1` is the difference between a
    // sign-in form and one that explains itself.
    expect(offHostRedirect(loc('kartavaya.com', '/login', '?from=%2Ftasks&expired=1', '#f')))
      .toBe('https://app.kartavaya.com/login?from=%2Ftasks&expired=1#f');
  });

  it.each(['/dashboard', '/tasks', '/graha', '/accept-invite', '/approve', '/settings/roles'])(
    'sends %s to the app host',
    (path) => {
      expect(offHostRedirect(loc('kartavaya.com', path)))
        .toBe(`https://app.kartavaya.com${path}`);
    },
  );

  it('sends a public invoice to the PAY host, not the app', () => {
    // The reader is the customer's CUSTOMER. `email_service.py` keeps this on
    // its own host so an invoice link can never be mistaken for a session.
    expect(offHostRedirect(loc('kartavaya.com', '/i/abc123')))
      .toBe('https://pay.kartavaya.com/i/abc123');
  });

  it('does not mistake a path that merely starts with i for an invoice', () => {
    expect(offHostRedirect(loc('kartavaya.com', '/inbox')))
      .toBe('https://app.kartavaya.com/inbox');
  });

  it('sends an unknown path to the app host, which is where the catch-all lives', () => {
    // `<Route path="*">` already navigates to /dashboard, so an unknown path has
    // always ended at the sign-in form. This only moves that to the right host.
    expect(offHostRedirect(loc('kartavaya.com', '/pricing')))
      .toBe('https://app.kartavaya.com/pricing');
  });

  it.each([
    ['app.kartavaya.com', '/dashboard'],
    ['app.kartavaya.com', '/login'],
    ['app.kartavaya.com', '/'],
    ['pay.kartavaya.com', '/i/abc123'],
    ['kartavaya.pages.dev', '/login'],
    ['kartavaya.pages.dev', '/dashboard'],
    ['kartavaya.pages.dev', '/i/abc123'],
    ['localhost', '/dashboard'],
    ['localhost', '/i/abc123'],
    ['staging.kartavaya.com', '/login'],
  ])('leaves %s%s where it is', (host, path) => {
    expect(offHostRedirect(loc(host, path))).toBeNull();
  });

  it('leaves app.kartavaya.com/ alone — `/` is the SIGN-IN FORM there', () => {
    // `isAppHost()` sends a logged-out visitor at `app.` to the form instead of
    // the landing page, on purpose. A rule that said "`/` belongs to marketing"
    // would undo that and bounce every bookmarked app. visitor to the website.
    expect(offHostRedirect(loc('app.kartavaya.com', '/'))).toBeNull();
  });
});

describe('offHostRedirect — the invoice host serves ONE thing', () => {
  // `email_service.py:25`: the reader is the customer's customer, has no
  // account and never will, and keeping the invoice on its own host means "an
  // invoice link can never be mistaken for a session."
  //
  // That sentence was FALSE in production until 2026-09-08 — measured in a
  // browser, pay.kartavaya.com/ served the full marketing landing page and
  // /login served a working sign-in form, password field and all.

  it('keeps the invoice itself', () => {
    expect(offHostRedirect(loc('pay.kartavaya.com', '/i/abc123'))).toBeNull();
  });

  it('refuses to serve the sign-in form — the whole reason this host exists', () => {
    expect(offHostRedirect(loc('pay.kartavaya.com', '/login')))
      .toBe('https://app.kartavaya.com/login');
  });

  it.each(['/dashboard', '/graha', '/accept-invite'])(
    'sends %s to the app host',
    (path) => {
      expect(offHostRedirect(loc('pay.kartavaya.com', path)))
        .toBe(`https://app.kartavaya.com${path}`);
    },
  );

  it('sends the bare host to the landing page, not the sign-in form', () => {
    // Someone who trimmed the URL down has no invoice and no account. "What is
    // this?" is the honest answer. Owner's call, 2026-09-08.
    expect(offHostRedirect(loc('pay.kartavaya.com', '/')))
      .toBe('https://kartavaya.com/');
  });

  it('sends a legal page to the marketing host, where it is indexed', () => {
    expect(offHostRedirect(loc('pay.kartavaya.com', '/privacy')))
      .toBe('https://kartavaya.com/privacy');
  });
});

describe('offHostRedirect — an invoice minted on the app host still lands right', () => {
  // VITE_PAY_BASE_URL was set in no env file, so `payLink()` fell back to
  // `window.location.origin` and the app's own copy button minted
  // app.kartavaya.com/i/<token>. Fixed at the source in .env.production — but
  // those links are already in customers' inboxes and WhatsApp threads.

  it('moves it to the invoice host', () => {
    expect(offHostRedirect(loc('app.kartavaya.com', '/i/abc123')))
      .toBe('https://pay.kartavaya.com/i/abc123');
  });

  it('carries the query across', () => {
    expect(offHostRedirect(loc('app.kartavaya.com', '/i/abc123', '?utm=wa')))
      .toBe('https://pay.kartavaya.com/i/abc123?utm=wa');
  });

  it('does not move anything else off the app host', () => {
    // The legal pages stay: someone inside the product reading the DPA should
    // not be thrown onto the marketing site to do it.
    expect(offHostRedirect(loc('app.kartavaya.com', '/privacy'))).toBeNull();
    expect(offHostRedirect(loc('app.kartavaya.com', '/inbox'))).toBeNull();
  });

  it('is matched exactly, not by the `app.` prefix isAppHost() uses', () => {
    // A future app.<something-else> is a different environment. Throwing it at
    // PRODUCTION pay. would take it out of the deploy under test.
    expect(offHostRedirect(loc('app.kartavaya.dev', '/i/abc123'))).toBeNull();
  });

  it('returns null with no window rather than throwing', () => {
    // It is called from index.jsx before React mounts. A throw there is a blank
    // page on every host, which is far worse than the split it closes.
    vi.stubGlobal('window', undefined);
    expect(offHostRedirect()).toBeNull();
  });
});
