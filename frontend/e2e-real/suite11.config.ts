/**
 * Proposal 93 · Stage 3 · WAVE 4 — SUITE 11 (Prachar, marketing), on Unicode
 * Group at §4 volumes.
 *
 * ── WHY THIS IS ITS OWN CONFIG AND NOT `wave4.config.ts` ────────────────────
 * §14's wave 4 is four suites — 06 Kray, 10 Vikray, 11 Prachar, 17 billing —
 * and three of them were being written by other agents in this same tree while
 * this one was. `wave4.config.ts` already carries `vikray` and `kray`, both
 * appended by their own authors mid-run; a third author editing that file is a
 * third chance for the last save to win. `suite17.config.ts` exists for exactly
 * this reason and this file is modelled on it. The wave's parallelism is a
 * property of running the suites at once, not of sharing a config.
 *
 * ── ⚠ ITS OWN outputDir, AND THAT IS THE WHOLE POINT ────────────────────────
 * Playwright EMPTIES `outputDir` at the start of a run and writes live traces
 * into it, so two concurrent runs sharing one directory delete each other's
 * in-flight artifacts and a green journey is reported red. `wave2.config.ts`
 * learned that with two projects in one directory. Nothing outside
 * `%TEMP%/kartavya-e2e-suite11` is touched by this file.
 *
 * ── `workers: 1` ────────────────────────────────────────────────────────────
 * Not the rate limiter — nothing here posts to `/auth/login`, and
 * `backend/limiter.py` builds `Limiter` with no `default_limits`, so only
 * auth-shaped routes are limited. It is because THIS SUITE'S TESTS DEPEND ON
 * EACH OTHER IN ORDER, and one of those dependencies is a safety gate rather
 * than a convenience: 11.6 may not press Send until 11.2 has built the reach
 * list whose addresses are the only ones this suite is allowed to mail, and
 * 11.7's exclusion proof is only a proof if it runs AFTER the six sends in
 * 11.6. A second worker would start a send against a half-built audience.
 *
 * ── `channel: 'chrome'` ─────────────────────────────────────────────────────
 * Inherited from `real.config.ts`. Without it Vercel's bot mitigation answers
 * `403 Forbidden` with `x-vercel-mitigated: deny` to the bundled headless
 * shell, and every assertion fails on an element that was never served.
 *
 * ── The timeout ─────────────────────────────────────────────────────────────
 * 11.2 types 24 contacts into a nine-field form; 11.6 sends six campaigns and
 * polls an ASYNCHRONOUS dispatch (`asyncio.create_task` in
 * `routers/prachar.py`) to a real provider for each; 11.9 types 30
 * registrations. The per-test default is nowhere near any of the three.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite11.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-suite11');

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 1,
  // ⚠ CAPPED 2026-08-30, from 60 minutes. A per-test budget measured in
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
      name: 'prachar',
      testMatch: /suite11-prachar\.spec\.ts/,
      outputDir: path.join(OUT, 'prachar'),
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
