/**
 * Proposal 93 · Stage 3 · WAVE 3 — Suite 08 (Vetana, payroll), Suite 09
 * (Pahchan, attendance) and Suite 05 (Ganit, books), on Unicode Group at §4
 * volumes.
 *
 * ── WHAT WAVE 2 LEFT BEHIND, WHICH IS WHY THIS CAN RUN AT ALL ──────────────
 * §14's waves are a dependency graph, not a schedule. Measured on the live
 * database before this file was written:
 *
 *   30 employees · 6 leave types · 14 holidays · 150 roster cells   (Suite 07)
 *   25 clients · 53 contacts · 30 deals · 12 documents              (Suite 04)
 *
 * Payroll needs employees, attendance needs employees, and invoices need
 * clients. All three exist, so this wave is unblocked by evidence rather than
 * by assumption.
 *
 * ── ⚠ ITS OWN outputDir, AND WAVE 2 TAUGHT THIS THE HARD WAY ───────────────
 * `wave2.config.ts` gave both its suites ONE outputDir, and Playwright EMPTIES
 * that directory at the start of a run — so the two agents driving it were
 * deleting each other's in-flight traces, and one had to pass `--output` by
 * hand to avoid it. A green journey reported red is the failure mode, and it
 * costs an hour of reading the wrong artifacts.
 *
 * Each project here therefore gets its OWN directory, not just the config.
 *
 * ── `workers: 3` ───────────────────────────────────────────────────────────
 * One per suite. §14 caps concurrency at 4 because login is rate-limited to
 * 5/min and a lane that trips its own limiter produces failures
 * indistinguishable from defects — but these three suites are independent by
 * construction and there are only three of them.
 *
 * ⚠ THEY ARE INDEPENDENT IN WHAT THEY CREATE AND NOT IN WHAT THEY READ.
 * Vetana reads Pahchan's punches when a payroll run is published against an
 * attendance register (§4: "payslip day-count must equal register day-count").
 * That is deliberately NOT expressed as a shared fixture: whichever suite needs
 * the other's rows creates its own and says so, because a suite that depends on
 * a sibling's output inside one wave is a suite that only passes in one order.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave3.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-wave3');

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 3,
  // §4 is ~980 records for this wave — 3 payroll runs over 88 payslips, 240
  // punches each carrying a photo, 45 invoices — every one typed into a real
  // form. The per-test default is nowhere near a suite that seeds a month of
  // attendance before it asserts anything.
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
      name: 'vetana',
      testMatch: /suite08-vetana\.spec\.ts/,
      outputDir: path.join(OUT, 'vetana'),
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'pahchan',
      testMatch: /suite09-pahchan\.spec\.ts/,
      outputDir: path.join(OUT, 'pahchan'),
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'ganit',
      testMatch: /suite05-ganit\.spec\.ts/,
      outputDir: path.join(OUT, 'ganit'),
      use: { ...devices['Desktop Chrome'] },
    },
    /**
     * ── SUITE 03 · CORE PM ─────────────────────────────────────────────────
     *
     * §14 places Suite 03 in WAVE 5, not here — it needs Suite 04's clients for
     * the task→client link and reads nothing else from waves 2–4. It rides this
     * config rather than a wave5 file of its own because a config is a runner,
     * not a schedule, and adding a fifth is a fifth place for `channel:
     * 'chrome'` and the timeout to drift. Run it on its own:
     *
     *   npx playwright test --config e2e-real/wave3.config.ts --project corepm
     *
     * ⚠ ITS OWN `outputDir`, for the reason the header of this file records:
     * Playwright EMPTIES the directory at the start of a run, so two concurrent
     * agents sharing one delete each other's in-flight traces and a green
     * journey is reported red.
     *
     * `workers` is inherited (3) and this project is a single spec file, so it
     * runs on one worker in declaration order — which Suite 03 depends on: its
     * tests build on each other's rows. See the `serial` note in the spec.
     */
    {
      name: 'corepm',
      testMatch: /suite03-core-pm\.spec\.ts/,
      outputDir: path.join(OUT, 'corepm'),
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
