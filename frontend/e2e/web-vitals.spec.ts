/**
 * PERFORMANCE, MEASURED IN A BROWSER — and only the parts worth gating.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 *
 * It is not a load test and it is not Lighthouse. `scripts/check-bundle-budget.mjs`
 * already covers the regression that actually happens — somebody imports a
 * library — deterministically and without a browser. This covers the half a
 * byte count cannot see: what the page DOES while it renders.
 *
 * ── The line between what is gated and what is only reported ────────────────
 *
 * This is the whole design of the file, and getting it wrong is how a
 * performance test becomes a flaky test that gets deleted.
 *
 *   GATED — deterministic for a given build, on any machine:
 *     · CUMULATIVE LAYOUT SHIFT. A number produced by the layout engine from
 *       the same DOM and the same stylesheet every time. It is also the metric
 *       that maps to a real complaint ("it moved as I went to tap it"), and
 *       this product has already shipped one shift-shaped defect: 22 bar fills
 *       that painted full-size on frame one, found by `check-mount-motion`.
 *     · DOM NODE COUNT. Deterministic under a stubbed API, and the thing that
 *       makes a mid-range Android phone slow in a way no network can explain.
 *     · API CALLS on a cold load. NOT total requests — the first version of
 *       this file gated on those and measured 226 to 269 per page, which is
 *       not a product fact at all: `vite dev` serves every ES module as its own
 *       request, and production ships 345 code-split files instead. The number
 *       that means the same thing in both modes is how many times the PAGE
 *       calls its own API, and an N+1 waterfall there is a real defect that
 *       survives to production.
 *
 *   REPORTED, NEVER GATED — wall-clock, which depends on the machine:
 *     · LCP and the load timings. A CI runner under contention will produce a
 *       number three times a desk's, and a budget on that is a coin toss. They
 *       are printed on every run so a human can see a trend; they fail nothing.
 *
 * ── Blast radius: none ──────────────────────────────────────────────────────
 *
 * Same isolation as `f32-write-gating.spec.ts` and `a11y.spec.ts`: local vite,
 * every `/api/**` stubbed, backend URL on a dead port.
 */
import { test, expect, Page } from '@playwright/test';

const PAGES = ['/dashboard', '/tasks', '/ganit', '/graha'];

/**
 * Budgets, recorded 2026-08-30 from a real build.
 *
 * CLS 0.1 is the Core Web Vitals "good" threshold, not a number invented here.
 * The node and request ceilings are the measured values plus headroom — enough
 * that a refactor does not trip them and little enough that a new waterfall
 * does.
 */
const BUDGET = {
  cls: 0.1,
  domNodes: 3000,
  /**
   * DISTINCT API endpoints one page touches while loading.
   *
   * ⚠ Two wrong versions of this budget came before this one, and both were
   * measuring the harness rather than the product. Recording why, because the
   * same trap catches the next person:
   *
   *   1. TOTAL REQUESTS — 226 on /dashboard, 269 on /ganit. Almost all of them
   *      ES module fetches `vite dev` invents; production ships 345 code-split
   *      files instead. That was a budget on Vite's architecture.
   *   2. TOTAL API CALLS — 35 on /dashboard. `src/index.jsx:83` wraps the app
   *      in `<React.StrictMode>`, which double-invokes every effect IN
   *      DEVELOPMENT ONLY. So each `2x` in that list is one fetch, counted
   *      twice by the harness. That was a budget on StrictMode.
   *
   * DISTINCT endpoints survives both: StrictMode changes how many times an
   * endpoint is called, never how many different ones there are.
   */
  distinctEndpoints: 24,
  /**
   * The most times any ONE endpoint may be requested on a single load.
   *
   * 2, exactly because of the StrictMode doubling above: one component
   * fetching once shows up twice, and that is the ceiling the artefact can
   * reach. THREE OR MORE therefore cannot be StrictMode — it is two components
   * asking for the same thing instead of sharing it, and it survives to
   * production at half the count but the same shape.
   */
  maxPerEndpoint: 2,
};

/**
 * KNOWN OVER-FETCHING, recorded 2026-08-30 — the first time anything counted.
 *
 * Endpoints requested three or more times on a single page load, which the
 * StrictMode artefact cannot explain (see `maxPerEndpoint`). Each line is two
 * or more components fetching the same thing instead of sharing it.
 *
 * Recorded rather than fixed: the fix is a data-layer change (hoist the fetch,
 * or cache it) across several components, which is product work and not a
 * thing to do inside a testing pass. Baseline contract as everywhere else in
 * this repo — it may shrink, it may never grow, and a NEW over-fetch on any
 * page fails immediately.
 */
const KNOWN_OVERFETCH: Record<string, string[]> = {
  // ⚠ `/api/teams` IS OVER-FETCHED ON EVERY PAGE MEASURED, and worst on
  // /tasks: 8x in dev is FOUR components in production each fetching the same
  // roster independently. `/api/auth/me` is 3x everywhere — the session, asked
  // for twice. These are the whole list; a new one on any page fails.
  '/dashboard': ['4x /api/tasks', '4x /api/teams', '3x /api/auth/me'],
  '/tasks': ['8x /api/teams', '6x /api/tasks', '4x /api/categories', '3x /api/auth/me'],
  '/ganit': ['4x /api/v1/ganit/invoices', '4x /api/teams', '3x /api/auth/me'],
  '/graha': ['4x /api/v1/graha/reports/forecast', '4x /api/teams', '3x /api/auth/me'],
};

/**
 * THE STUB BODY, AND WHY IT IS A BARE ARRAY.
 *
 * ⚠ It was `{ data: [], total: 0, limit: 0, truncated: false }` — copied from
 * `f32-write-gating.spec.ts`, where it is correct. It is NOT correct here, and
 * the difference was invisible until it was measured:
 *
 *     engine    stub          rendered text   error boundary
 *     chromium  envelope       1,255 chars    clean
 *     chromium  bare-array     2,323 chars    clean
 *     webkit    envelope         955 chars    clean
 *     webkit    bare-array     2,019 chars    clean
 *
 * The envelope renders the SHELL AND NOTHING ELSE — roughly half the page —
 * because `DashboardPage.jsx` reads `GET /api/tasks` as what its own comment
 * says it is: "a bare array: no total, no next cursor". Handed an object it
 * throws `{} is not iterable` into the ErrorBoundary, which replaces the page
 * content while leaving the sidebar and topbar standing. Every rule in this
 * file then passed over a shell — and the WebKit run, where the shell is
 * smaller still, looked like an engine-specific product crash. It was the stub.
 *
 * f32 gets away with the envelope because the module pages go through `rows()`,
 * which accepts both shapes. The dashboard does not.
 */
const EMPTY = [];

async function harness(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'Kartavaya_user',
      JSON.stringify({ user_id: 'user_e2e', name: 'E2E User', email: 'e2e@example.com', role: 'org_admin' }),
    );
    localStorage.setItem('auth_token', 'e2e-stub-token');

    // Start observing BEFORE the app runs. A PerformanceObserver installed
    // after first paint sees nothing — `buffered: true` recovers past entries
    // for LCP but layout-shift entries are only delivered live, so an observer
    // attached from the test body would report a perfect CLS of 0 on a page
    // that jumped. That is the vacuous-pass shape this repo keeps meeting.
    (window as unknown as { __vitals: { cls: number; shifts: number; lcp: number } }).__vitals =
      { cls: 0, shifts: 0, lcp: 0 };
    const v = (window as unknown as { __vitals: { cls: number; shifts: number; lcp: number } }).__vitals;

    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (e.hadRecentInput) continue;      // a shift the user caused is not a defect
        v.cls += e.value;
        v.shifts += 1;
      }
    }).observe({ type: 'layout-shift', buffered: true });

    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last) v.lcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });

  await page.route('**/api/**', (route) =>
    route.request().url().includes('/auth/me')
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ user_id: 'user_e2e', name: 'E2E User', email: 'e2e@example.com', role: 'org_admin' }),
        })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY) }),
  );
}

test.describe('@perf what the page does while it renders', () => {
  // Layout-shift entries are a Chromium API. Firefox and WebKit do not
  // implement `layout-shift` at all, so this whole file would measure a
  // constant zero there — a vacuous pass, dressed as cross-browser coverage.
  // Better to run on one engine and say so than to report three green ticks
  // for two engines that measured nothing.
  /**
   * ⚠ THE PROJECT, NOT THE ENGINE. This was `browserName !== 'chromium'`, and
   * that has a hole: THREE of the seven projects run on chromium —
   * `chromium`, `android-chrome` (Pixel 7) and `android-tablet` (Galaxy Tab).
   * `browserName` is `chromium` for all three, so the skip let the phone and
   * the tablet through and they failed against baselines recorded at 1280x720.
   * Eleven entries reached `playwright-baseline.json` before it was noticed —
   * a baseline quietly absorbing a scoping bug, which is the one thing a
   * baseline must never be allowed to do.
   */
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'layout-shift and LCP are Chromium-only APIs, and these budgets are recorded at the desktop viewport');
  });

  for (const path of PAGES) {
    test(`${path} settles without shifting, and does not over-render`, async ({ page }) => {
      await harness(page);

      const requests: string[] = [];
      const apiCalls: string[] = [];
      page.on('request', (r) => {
        requests.push(r.url());
        if (r.url().includes('/api/')) apiCalls.push(new URL(r.url()).pathname);
      });

      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.locator('main, [role="main"], .kv__main').first().waitFor({ state: 'attached', timeout: 20_000 });
      // Let late work land — a shift caused by a font swap or a lazy chunk
      // arrives well after the first paint and is exactly what a user notices.
      await page.waitForTimeout(2500);

      const m = await page.evaluate(() => {
        const v = (window as unknown as { __vitals: { cls: number; shifts: number; lcp: number } }).__vitals;
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        return {
          cls: v.cls,
          shifts: v.shifts,
          lcp: Math.round(v.lcp),
          domNodes: document.getElementsByTagName('*').length,
          domReady: Math.round(nav?.domContentLoadedEventEnd ?? 0),
          text: document.body.innerText.trim().length,
        };
      });

      // ANTI-VACUITY: a page that did not render has a perfect CLS, the fewest
      // possible nodes and the fastest possible LCP. Every metric below is only
      // meaningful over a page that actually mounted.
      expect(
        m.text,
        `${path} rendered ${m.text} characters — nothing mounted, so a "good" score here means ` +
          'nothing. The shell alone clears 900, so this floor is set above it.',
      ).toBeGreaterThan(900);
      expect(m.domNodes, `${path} has ${m.domNodes} DOM nodes — the page did not build`).toBeGreaterThan(50);

      // Reported, never gated. Wall-clock belongs to the machine, not the code.
      // eslint-disable-next-line no-console
      console.log(
        `[perf] ${path}: CLS ${m.cls.toFixed(4)} over ${m.shifts} shift(s) · ` +
          `${m.domNodes} nodes · ${apiCalls.length} api calls (${requests.length} requests total, ` +
          `mostly vite dev modules) · LCP ${m.lcp}ms · DCL ${m.domReady}ms ` +
          `(the two timings are informational — a CI runner under contention makes them meaningless)`,
      );

      expect(
        m.cls,
        `${path} shifted ${m.cls.toFixed(4)} over ${m.shifts} layout shift(s), past the ${BUDGET.cls} ` +
          '"good" Core Web Vitals threshold. Something is sized after it paints — an image without ' +
          'width/height, a font swap, or content injected above the fold. Open the trace and watch it move.',
      ).toBeLessThanOrEqual(BUDGET.cls);

      expect(
        m.domNodes,
        `${path} renders ${m.domNodes} DOM nodes against a ${BUDGET.domNodes} budget — and this is the ` +
          'EMPTY state, with every list stubbed to zero rows. A tree this size before any data arrives ' +
          'is what makes a mid-range Android phone feel slow, and no network can explain it away.',
      ).toBeLessThanOrEqual(BUDGET.domNodes);

      const byPath = apiCalls.reduce<Record<string, number>>((acc, p) => { acc[p] = (acc[p] || 0) + 1; return acc; }, {});
      const distinct = Object.keys(byPath);
      const overFetched = Object.entries(byPath)
        .filter(([, n]) => n > BUDGET.maxPerEndpoint)
        .sort((a, b) => b[1] - a[1]);

      expect(
        distinct.length,
        `${path} touches ${distinct.length} distinct API endpoints to load, against a ` +
          `${BUDGET.distinctEndpoints} budget:\n  ${distinct.sort().join('\n  ')}\n\n` +
          'Each is a round trip before the page is usable, on the networks this product is sold ' +
          'onto. This count is StrictMode-independent, so it means the same thing in production.',
      ).toBeLessThanOrEqual(BUDGET.distinctEndpoints);

      expect(
        overFetched.map(([p, n]) => `${n}x ${p}`),
        `${path} requests the same endpoint more than twice on one load:\n` +
          `  ${overFetched.map(([p, n]) => `${n}x ${p}`).join('\n  ')}\n\n` +
          'StrictMode doubling accounts for exactly 2x and no more, so this is two or more ' +
          'components fetching the same thing instead of sharing it. It survives to production ' +
          'at half the count and the same shape — the wasted round trips are real.',
      ).toEqual(KNOWN_OVERFETCH[path] ?? []);
    });
  }
});
