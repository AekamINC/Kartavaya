/**
 * Proposal 93 · Stage 3 · WAVE 5 — SUITE 15 (eSign), on Unicode Group at §4
 * volumes.
 *
 * ── WHY THIS IS ITS OWN CONFIG AND NOT `wave5.config.ts` ────────────────────
 * §14's wave 5 is four suites — 03 core PM, 13 Sanvaad, 14 Sahayak, 15 eSign —
 * and three of them are being written by other agents in this same tree at the
 * same time. A shared `wave5.config.ts` is a file three authors would have to
 * write simultaneously and the last one to save wins. One config per suite
 * costs a file and removes the collision; the wave's parallelism is a property
 * of running them at once, not of sharing a config.
 *
 * ── ⚠ ITS OWN outputDir, AND THAT IS THE WHOLE POINT ────────────────────────
 * Playwright EMPTIES `outputDir` at the start of a run and writes live traces
 * into it, so two concurrent runs sharing one directory delete each other's
 * in-flight artifacts and a green journey is reported red. Several agents work
 * in this tree at once, so it is a standing condition and not a hypothetical.
 * `kartavya-e2e-suite15` belongs to this suite and to nothing else.
 *
 * ── `workers: 1` ────────────────────────────────────────────────────────────
 * Not for the rate limiter — nothing here posts to `/auth/login`. It is
 * because THIS SUITE'S TESTS DEPEND ON EACH OTHER IN ORDER: 15.04 sends the
 * documents 15.02 typed, 15.05 reminds a signer 15.04 invited, 15.07 signs the
 * links 15.04 issued and 15.08 downloads what 15.07 completed. A second worker
 * would start 15.04 against documents that do not exist yet and report a
 * product failure for a scheduling artefact.
 *
 * ── `channel: 'chrome'` ─────────────────────────────────────────────────────
 * Inherited from `real.config.ts`. Without it Vercel's bot mitigation answers
 * `403 Forbidden` with `x-vercel-mitigated: deny` to the bundled headless
 * shell, and every assertion fails on an element that was never served.
 *
 * ⚠ THE SIGNING CONTEXT INHERITS `use` FROM HERE AND MUST STAY THAT WAY. 15.07
 * opens `browser.newContext()` with NO storage state — that is the point of it
 * — but it still needs the real Chrome channel, or the counterparty's first
 * navigation is answered by Vercel's mitigation and the "signing link is dead"
 * finding is an infrastructure artefact. `browser` from the fixture already
 * carries the channel, so a plain `newContext()` is correct and
 * `chromium.launch()` would not be.
 *
 * ── The timeout ─────────────────────────────────────────────────────────────
 * 15.02 types six documents, twenty-four placed fields and ten signers through
 * the real form, uploading a real multi-page PDF each time; 15.07 drives four
 * complete counterparty journeys in four fresh browser contexts, each of them
 * an OTP round trip. The per-test default is nowhere near either.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite15.config.ts
 *
 * ⚠ NEVER pipe the run through `tail` — it truncates failures AND masks the
 * exit code. Read `report.json` under the outputDir below.
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-suite15');

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
      name: 'esign',
      testMatch: /suite15-esign\.spec\.ts/,
      outputDir: path.join(OUT, 'esign'),
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
