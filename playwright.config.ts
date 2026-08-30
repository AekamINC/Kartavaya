import { defineConfig } from '@playwright/test';
import { browserProjects, announceSelection } from './frontend/playwright.matrix';

/**
 * E2E test configuration for Kartavaya web app.
 *
 * In CI: set PLAYWRIGHT_BASE_URL to the deployed Vercel URL.
 * Locally: runs against the Vite dev server on port 3000.
 *
 * The webServer block is skipped in CI (reuseExistingServer: true +
 * the CI sets PLAYWRIGHT_BASE_URL to an already-deployed app).
 *
 * ── Cross-browser here is OPT-IN, and that is deliberate ────────────────────
 *
 * This suite points at a DEPLOYED url and writes. Staging and production share
 * one Supabase database, so every extra project is another full pass of real
 * rows against real customer data. `frontend/playwright.config.ts` is where the
 * matrix runs by default, because that one stubs every response and writes
 * nothing; this one stays on `chromium` until somebody asks for more:
 *
 *     PW_BROWSERS=desktop npx playwright test     # + firefox, webkit
 *     PW_BROWSERS=all     npx playwright test     # + phone and tablet
 *
 * Before widening it, know what the specs you are about to run seven times
 * actually write.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const CI = !!process.env.CI;

// One engine unless asked. See the header — this suite writes.
const DEFAULT_BROWSERS = 'chromium';
announceSelection(DEFAULT_BROWSERS);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: CI ? 1 : 0,
  workers: CI ? 1 : 2,
  reporter: CI ? 'github' : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: browserProjects({ fallback: DEFAULT_BROWSERS }),

  // Only start the dev server when running locally (no PLAYWRIGHT_BASE_URL)
  ...(!CI && !process.env.PLAYWRIGHT_BASE_URL
    ? {
        webServer: {
          command: 'cd frontend && yarn start',
          url: 'http://localhost:3000',
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }
    : {}),
});
