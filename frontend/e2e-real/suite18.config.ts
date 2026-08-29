/**
 * Proposal 93 · Stage 3 · WAVE 6 — SUITE 18 (Client portal), on Unicode Group.
 *
 * ── WHY ITS OWN CONFIG, MODELLED ON `suite17.config.ts` ─────────────────────
 * §14's wave 6 is three suites — 16 Niyam, 18 portal, 19 admin — written by
 * three agents in this same tree at the same time. A shared `wave6.config.ts`
 * is a file three authors would have to write simultaneously and the last one
 * to save wins. One config per suite costs a file and removes the collision;
 * the wave's parallelism is a property of running them at once, not of sharing
 * a config.
 *
 * ── ⚠ ITS OWN outputDir, AND THAT IS THE WHOLE POINT ────────────────────────
 * Playwright EMPTIES `outputDir` at the start of a run and writes live traces
 * into it, so two concurrent runs sharing one directory delete each other's
 * in-flight artifacts and a green journey is reported red. `wave2.config.ts`
 * learned that with two projects in one directory. Several agents work in this
 * tree at once, so it is a standing condition, not a hypothetical.
 *
 * ── `workers: 1` ────────────────────────────────────────────────────────────
 * Not for the rate limiter — nothing here posts to `/auth/login`. It is because
 * 18.06 reads a seat count, drives a control, and reads the seat count again,
 * and a second worker running any other test between those two reads would make
 * the delta somebody else's. A before/after count is only evidence on one
 * worker.
 *
 * ── `channel: 'chrome'` ─────────────────────────────────────────────────────
 * Inherited from `real.config.ts`. Without it Vercel's bot mitigation answers
 * `403 Forbidden` with `x-vercel-mitigated: deny` to the bundled headless
 * shell, and every assertion fails on an element that was never served.
 *
 * ── The timeout ─────────────────────────────────────────────────────────────
 * 18.09–18.12 sweep several dozen endpoints across four organisations' ids, and
 * 18.03 navigates all four portal routes. Generous rather than tight: a suite
 * whose subject is refusals must never report a timeout as a refusal.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite18.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-suite18');

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 1,
  timeout: 20 * 60_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(OUT, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(OUT, 'report.json') }],
  ],
  projects: [
    {
      name: 'client-portal',
      testMatch: /suite18-portal\.spec\.ts/,
      outputDir: path.join(OUT, 'client-portal'),
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
