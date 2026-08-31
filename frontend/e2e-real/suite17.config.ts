/**
 * Proposal 93 · Stage 3 · WAVE 4 — SUITE 17 (Client billing), on Unicode Group
 * at §4 volumes.
 *
 * ── WHY THIS IS ITS OWN CONFIG AND NOT `wave4.config.ts` ────────────────────
 * §14's wave 4 is four suites — 06 Kray, 10 Vikray, 11 Prachar, 17 billing —
 * and three of them are being written by other agents in this same tree at the
 * same time. A shared `wave4.config.ts` is a file three authors would have to
 * write simultaneously, and the last one to save wins. One config per suite
 * costs a file and removes the collision entirely; the wave's parallelism is a
 * property of running them at once, not of sharing a config.
 *
 * ── ⚠ ITS OWN outputDir, AND THAT IS THE WHOLE POINT ────────────────────────
 * Playwright EMPTIES `outputDir` at the start of a run and writes live traces
 * into it, so two concurrent runs sharing one directory delete each other's
 * in-flight artifacts and a green journey is reported red. `wave2.config.ts`
 * learned that the hard way with two projects in one directory. Several agents
 * work in this tree at once, so it is a standing condition and not a
 * hypothetical.
 *
 * ── `workers: 1` ────────────────────────────────────────────────────────────
 * Not for the rate limiter — nothing here posts to `/auth/login`, and
 * `backend/limiter.py` constructs `Limiter` with no `default_limits`, so only
 * auth-shaped routes are limited. It is because THIS SUITE'S TESTS DEPEND ON
 * EACH OTHER IN ORDER: 17.03's service lines hang off 17.02's profiles, 17.04
 * changes them, 17.07 bills 17.06's usage. A second worker would start 17.03
 * against profiles that do not exist yet and report a product failure for a
 * scheduling artefact.
 *
 * ── `channel: 'chrome'` ─────────────────────────────────────────────────────
 * Inherited from `real.config.ts`. Without it Vercel's bot mitigation answers
 * `403 Forbidden` with `x-vercel-mitigated: deny` to the bundled headless
 * shell, and every assertion fails on an element that was never served.
 *
 * ── The timeout ─────────────────────────────────────────────────────────────
 * 17.04 makes five subscription changes through five separate modal round
 * trips and then provokes a sixth; 17.10 opens two payment links in two fresh
 * browser contexts. The per-test default is nowhere near either.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite17.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-suite17');

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 1,
  // ⚠ CAPPED 2026-08-30, from 45 minutes. A per-test budget measured in
  // tens of minutes does not protect a slow test — it hides a DEAD one. Suite 04
  // proved it: the browser died, the worker sat at idle CPU, and with a 45-minute
  // budget nothing killed the wait. 2 of 22 tests ran, 20 never started, and the
  // wave lost its slot to a crash that never surfaced as a failure.
  //
  // 20 minutes is ~7x the longest test actually observed in this programme
  // (04.04, fifty contacts with addresses, 2.7m). A test that genuinely needs
  // more should say so with `test.setTimeout()` in the file that needs it, where
  // the exception is visible, rather than every test inheriting a budget sized
  // for the slowest one.
  timeout: 20 * 60_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(OUT, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(OUT, 'report.json') }],
  ],
  projects: [
    {
      name: 'client-billing',
      testMatch: /suite17-client-billing\.spec\.ts/,
      outputDir: path.join(OUT, 'client-billing'),
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
