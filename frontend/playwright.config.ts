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
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`;

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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Skipped when PLAYWRIGHT_BASE_URL names something already running.
  ...(process.env.PLAYWRIGHT_BASE_URL ? {} : {
    webServer: {
      command: 'npx vite --port 3000 --strictPort',
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { VITE_BACKEND_URL: 'http://127.0.0.1:9' },
    },
  }),
});
