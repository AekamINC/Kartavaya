/**
 * Playwright config for the frontend's own browser checks.
 *
 * Separate from the root `playwright.config.ts` on purpose, for two reasons.
 *
 * **Resolution.** The root config lives beside no `package.json`, so its
 * `import from '@playwright/test'` resolves only if something has been
 * installed at the repo root. The repo's documented install is
 * `cd frontend && npm ci`, and with only that, running the root config fails
 * with MODULE_NOT_FOUND before a single test loads — verified by deleting the
 * root `node_modules` and trying. A config inside `frontend/` resolves against
 * `frontend/node_modules`, which is the install that actually exists.
 *
 * **Blast radius.** The root suite is wired to a DEPLOYED url and its CI job is
 * named "writes to the shared database". These tests write nothing anywhere:
 * they stub every `/api/**` response and drive a local dev server. Keeping the
 * two apart means neither inherits the other's assumptions.
 *
 * `webServer` starts vite itself, so the whole thing is one command. It also
 * supplies `VITE_BACKEND_URL`, without which `lib/api.js` replaces
 * `document.body` with a configuration error and throws — the app will not boot
 * at all, and every test fails on an empty page. The value is deliberately a
 * dead port: nothing should reach it, and if a request escapes the stub it
 * fails fast and loudly rather than silently hitting a real host.
 *
 * ⚠ THAT DEAD PORT USED TO BE 9, AND PORT 9 IS ENGINE-SPECIFIC. See the
 * `DEAD_BACKEND` constant below — the first WebKit run in this repo's history
 * failed 94 tests on it, all of them harness, none of them product.
 *
 * ── THIS IS WHERE THE FULL BROWSER MATRIX LIVES, AND WHY ────────────────────
 *
 * The blast radius paragraph above is exactly the licence for it. Cross-browser
 * and cross-platform coverage means running the same journey seven times; on a
 * suite that writes, that is seven times the rows in a database staging and
 * production SHARE, and it is not affordable. Here it costs nothing but
 * wall-clock: every `/api/**` is stubbed, the backend URL is a dead port, and
 * the server is a local vite. So this config defaults to `all` — the only one
 * that does — and the suites that write default to `chromium` and take the
 * matrix only when asked.
 *
 * Practically: engine-specific CSS and JS faults, and responsive layout faults,
 * are caught HERE, on four specs, for free — not on staging, where they would
 * cost writes and where nobody had ever looked for them.
 *
 * Once, to fetch the engines (`npm ci` does not):
 *     npx playwright install firefox webkit
 */
import { defineConfig } from '@playwright/test';
import { browserProjects, announceSelection } from './playwright.matrix';

const PORT = 3000;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`;

// The whole matrix by default. Narrow it with PW_BROWSERS — e.g. `desktop`,
// `mobile`, or `chromium` while iterating on a spec.
const DEFAULT_BROWSERS = 'all';

/**
 * The address `lib/api.js` is pointed at, and the reason it is not port 9.
 *
 * It WAS `http://127.0.0.1:9` — port 9 is discard, so nothing can answer, which
 * is the property this harness wants: every `/api/**` is stubbed by
 * `page.route`, and anything that escapes the stub should fail immediately
 * rather than quietly reach a real host.
 *
 * MEASURED 2026-08-30, the first time these specs were ever run outside
 * Chromium: WebKit refuses port 9 BEFORE Playwright's interception gets a look
 * at the request —
 *
 *     Not allowed to use restricted network port 9: http://127.0.0.1:9/api/auth/me
 *
 * — because 9 is on the WHATWG bad-ports list and WebKit enforces it in the
 * network layer. The route handler never fires, `/auth/me` never resolves, and
 * the app does the RIGHT thing: it renders "Could not reach Kartavaya. Your
 * session is still valid — this is a connection problem". Every subsequent
 * assertion then fails looking for a module header that was never going to
 * exist. That was 94 of the 142 failures in the first full-matrix run, and not
 * one of them was a product defect. Chromium hides the difference because its
 * own bad-port check happens after interception.
 *
 * 59999 is unassigned, above the bad-ports list, and closed on this machine, so
 * an escaped request still dies instantly — with ECONNREFUSED, in every engine.
 * Do not "tidy" this back to a low port.
 */
const DEAD_BACKEND = 'http://127.0.0.1:59999';

// Say out loud what is about to run. A matrix you cannot see is a matrix you
// stop trusting — and "did that actually run in WebKit?" is the first question
// anyone asks of a green cross-browser suite.
announceSelection(DEFAULT_BROWSERS);

export default defineConfig({
  testDir: './e2e',
  // A cold vite start plus ten module pages: generous, because a timeout here
  // reads as a product failure and sends the next person hunting for a bug.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: browserProjects({
    fallback: DEFAULT_BROWSERS,
    // `design-geometry.spec.ts` measures the DESKTOP tier of the `--row-h`
    // contract: a `.k-trow` at min-height 66px, a 16px outer gutter, a 14px
    // column gap. The stylesheets carry 19 `max-width: 767px` rules plus
    // `(hover: none)` and `(pointer: coarse)` branches, so a phone or a tablet
    // is entitled to a different layout there. Asserting the desktop numbers
    // against a 412px viewport would report a product failure for a design
    // decision — so this spec runs on the three desktop projects only.
    //
    // The other three specs are behavioural (write gating, form gates, skill
    // steps, and the white-screen check that loads every module page) and run
    // on all seven. Those are the ones where an engine or a viewport can
    // genuinely break the product.
    desktopOnly: /design-geometry\.spec\.ts/,
  }),

  // Skipped when PLAYWRIGHT_BASE_URL names something already running.
  ...(process.env.PLAYWRIGHT_BASE_URL ? {} : {
    webServer: {
      // `--host 127.0.0.1` is load-bearing on Windows. Without it vite binds the
      // hostname `localhost`, which resolves to IPv6 `::1` there, while
      // Playwright polls the IPv4 `url` below — so the server never appeared to
      // come up and the run died with "Timed out waiting 120000ms from
      // config.webServer" having never started a test. Measured 2026-07-31:
      // vite was ready in 507ms, `localhost:3000` answered 200, and
      // `127.0.0.1:3000` answered nothing at all.
      command: 'npx vite --port 3000 --strictPort --host 127.0.0.1',
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { VITE_BACKEND_URL: DEAD_BACKEND },
    },
  }),
});
