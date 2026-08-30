/**
 * `isAppHost()` — which hostname skips the landing page.
 *
 * ── Why this is pinned ──────────────────────────────────────────────────────
 *
 * `www.` and `app.` are ONE Cloudflare Pages project and one build. `RootGate`
 * picks a face from whether there is a user, so the ONLY thing that sends a
 * logged-out visitor at `app.kartavaya.com` to the sign-in form rather than to
 * marketing copy is this predicate.
 *
 * That makes it exactly the shape of defect this repo keeps meeting: a rule
 * with no test, on a path nobody clicks in development, that fails silently in
 * production. Someone tidying `startsWith('app.')` into an equality test
 * against one FQDN would break every future `app.<something>` host and nothing
 * would go red.
 *
 * The negative cases matter as much as the positive one. `staging.` and a
 * `*.pages.dev` preview are whole-product hosts where the landing page is still
 * worth seeing, and the apex IS the landing page.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { isAppHost } from '../platform';

/** Drive the real predicate by moving the hostname, not by mocking the module. */
function at(hostname) {
  vi.stubGlobal('window', { location: { hostname } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isAppHost', () => {
  it('is true on the app host — this is the whole point', () => {
    at('app.kartavaya.com');
    expect(isAppHost()).toBe(true);
  });

  it('is true for any future app.<something>, because it is prefix-matched', () => {
    at('app.kartavaya.dev');
    expect(isAppHost()).toBe(true);
  });

  it.each([
    ['www.kartavaya.com', 'the landing page and where the CTA lands'],
    ['kartavaya.com', 'the apex IS the landing page'],
    ['staging.kartavaya.com', 'a whole-product host; the landing page still applies'],
    ['kartavaya.pages.dev', 'the Pages origin, used by the e2e suites'],
    ['pay.kartavaya.com', 'the public invoice — never the sign-in form'],
    ['localhost', 'development'],
  ])('is false on %s — %s', (host) => {
    at(host);
    expect(isAppHost()).toBe(false);
  });

  it('does not match a host that merely CONTAINS "app."', () => {
    // `startsWith` is load-bearing: a substring test would drag in unrelated
    // hosts and quietly hide the landing page from them.
    at('notapp.kartavaya.com');
    expect(isAppHost()).toBe(false);
    at('myapp.kartavaya.com');
    expect(isAppHost()).toBe(false);
  });

  it('is false when there is no window at all, rather than throwing', () => {
    // The module is imported by the route tree, so a throw here would take the
    // whole app down in any non-browser evaluation.
    vi.stubGlobal('window', undefined);
    expect(isAppHost()).toBe(false);
  });

  it('is false when window exists but location does not', () => {
    vi.stubGlobal('window', {});
    expect(isAppHost()).toBe(false);
  });
});
