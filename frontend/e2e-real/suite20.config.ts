/**
 * Proposal 93 · Stage 3 · WAVE 7 — SUITE 20 (Cross-cutting), on Unicode Group.
 *
 * ── WHY ITS OWN CONFIG, AND ITS OWN `outputDir` ─────────────────────────────
 * Playwright EMPTIES `outputDir` at the start of a run and writes live traces
 * into it. Several agents drive this tree at once during proposal 93, so two
 * concurrent runs sharing one directory delete each other's in-flight
 * artifacts and a green journey is reported red — `wave2.config.ts` learned
 * that with two projects in one directory. One config per suite costs a file
 * and removes the collision entirely.
 *
 * ── `workers: 1` ────────────────────────────────────────────────────────────
 * NOT for the rate limiter: nothing here posts to `/auth/login`, and
 * `backend/limiter.py` builds `Limiter` with no `default_limits`, so only
 * auth-shaped routes are limited. It is because **this suite's tests share one
 * ledger FILE**. 20.01 sweeps every screen and writes what it saw; 20.02–20.05
 * each assert one dimension of that record. A second worker would read a
 * half-written ledger and report a product failure for a scheduling artefact.
 *
 * The ledger is a FILE and not a module-level variable for the reason the
 * agent brief states outright: **Playwright starts a NEW WORKER after a failed
 * test**, and module state does not survive it. A ledger in memory would be
 * empty for every test after the first red one, and each of them would then
 * report "nothing was swept" — a cascade of false findings hiding the real one.
 *
 * ── `channel: 'chrome'` ─────────────────────────────────────────────────────
 * Inherited from `real.config.ts`. Without it Vercel's bot mitigation answers
 * `403 Forbidden` with `x-vercel-mitigated: deny` to the bundled headless
 * shell, and every assertion fails on an element that was never served.
 *
 * ── 1280 × 720, DELIBERATELY, AND IT IS LOAD-BEARING ────────────────────────
 * `devices['Desktop Chrome']` is 1280×720, which sits inside `viewport-fit.css`
 * **band V2** (`min-width: 1024px and max-height: 780px`) — still the most
 * common laptop panel sold in India. Two things depend on it:
 *
 *   · `--row-h` is **50px** there for the default `cozy` density, not 66px.
 *     20.05 therefore READS the computed token off each row rather than naming
 *     a number; an agent nearly filed the correct 50px as a defect on
 *     2026-08-29 and this is the size at which that mistake is available.
 *   · The `DateInput`-inside-`Modal` geometry defect (93 §F item 5) was
 *     MEASURED at 1280×720. Changing the viewport here would make 20.13 stop
 *     reproducing a live, filed defect and look like a fix.
 *
 * 20.14 resizes deliberately and puts it back.
 *
 * ── artifacts turned DOWN, on purpose ───────────────────────────────────────
 * `real.config.ts` uses `trace: 'on'`, `video: 'on'`, `screenshot: 'on'`. This
 * suite visits ~145 screens in one test; at those settings the sweep alone
 * writes gigabytes and the run slows enough to change what it measures — a
 * throttled-network assertion cannot be trusted on a browser busy encoding
 * video. Traces and screenshots are kept for FAILURES, which is where they are
 * read.
 *
 * ── The timeout ─────────────────────────────────────────────────────────────
 * 20.01 opens every top-level route and every module tab and runs a DOM
 * measurement on each. The per-test default is nowhere near it.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite20.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-suite20');

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 1,
  // Tests must run in declaration order: 20.01 writes the ledger the next four
  // read. `fullyParallel` off is the default, but it is stated because the
  // ordering is a contract here rather than an accident.
  fullyParallel: false,
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
  use: {
    ...base.use,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'crosscutting',
      testMatch: /suite20-crosscutting\.spec\.ts/,
      outputDir: path.join(OUT, 'crosscutting'),
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
