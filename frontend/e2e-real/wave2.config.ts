/**
 * Proposal 93 · Stage 3 · WAVE 2 — Suite 07 (Manav) and Suite 04 (Graha),
 * written FRESH against Unicode Group at §4 volumes.
 *
 * ── WHY THESE ARE NEW FILES AND NOT THE EXISTING ONES ───────────────────────
 * `manav.spec.ts` and `graha.spec.ts` already exist and cannot be re-pointed.
 * Both open with `test.use({ storageState: OWNER_STATE })` — the E2E lane — and
 * both are sized for Phase 4, not for §4. Re-pointing them would mean changing
 * the org, the credential, the volumes and the assertions in one edit, which is
 * a rewrite wearing the previous file's history.
 *
 * ── `workers: 4`, AND IT IS SETTLED RATHER THAN HOPEFUL ─────────────────────
 * Read out of `backend/limiter.py`: `Limiter` is constructed with NO
 * `default_limits`, so only routes carrying an explicit decorator are limited —
 * auth-shaped ones. Nothing in this wave posts to `/auth/login`; the lane
 * bootstraps from a token. §14's peak concurrency is 4 for the same reason.
 *
 * ⚠ **Only Suite 01 must stay `workers: 1`**, because it DELIBERATELY exhausts
 * the 5/min login limit. A second worker there would be refused by that suite's
 * own doing and report a product failure for a test artefact.
 *
 * ── ITS OWN outputDir ───────────────────────────────────────────────────────
 * Playwright EMPTIES `outputDir` at the start of a run and writes live traces
 * into it, so two concurrent runs sharing one directory delete each other's
 * in-flight artifacts and a green journey is reported red. Several agents work
 * in this tree at once, so that is a standing condition, not a hypothetical.
 *
 * ── `channel: 'chrome'` ─────────────────────────────────────────────────────
 * Inherited from `real.config.ts`. Without it Vercel's bot mitigation answers
 * `403 Forbidden` with `x-vercel-mitigated: deny` to the bundled headless
 * shell, and every assertion fails on an element that was never served.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave2.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-wave2');

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 4,
  // §4 is ~628 records for this wave, every one typed into a real form. The
  // per-test default is nowhere near enough for a suite that creates 30
  // employees before it asserts anything.
  //
  // ⚠ WAS `45 * 60_000`, AND THAT IS WHAT TURNED A CRASH INTO A HANG.
  //
  // Measured 2026-08-30: Suite 04 wrote all 25 clients (DB 21:14:50→21:15:08),
  // completed its edit step at 21:15:13, and then produced NO further output for
  // 7+ minutes. The browser process was GONE and the three worker PIDs sat at
  // *unchanging* CPU — idle, waiting, not serialising. The browser had died and
  // nothing killed the wait, because the per-test budget was forty-five minutes.
  // 2 of 22 tests ran; 20 never started, including 04.11 `lost_reason`, which is
  // the trap this wave exists to prove.
  //
  // Ten minutes is still far above anything a passing test here needs — the
  // whole 25-client journey wrote in 18 seconds — and it converts a dead browser
  // from "the wave silently loses its budget" into "one test fails, with a
  // timeout message, and the remaining twenty still run". A test that genuinely
  // needs longer than this should say so with `test.setTimeout()`, where the
  // exception is visible in the file that needs it.
  timeout: 10 * 60_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(OUT, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(OUT, 'report.json') }],
  ],

  // ── THE OTHER HALF OF THE SUITE 04 HANG ────────────────────────────────────
  //
  // `real.config.ts` sets `trace: 'on'` and `video: 'on'`, and this file spreads
  // it. That pairing is already on record in this directory as a cause rather
  // than a suspicion — `manav-dummy-logins.spec.ts` turns BOTH off file-scoped
  // and says why: a 22MB trace serialised on a PASSING test pushed EMP-004 past
  // its timeout (a green journey reported red), and `context.close()` threw
  // `ENOENT …/recording.trace` twice because a live trace recording is a file in
  // `outputDir` and Playwright EMPTIES `outputDir` when any run against the
  // config starts. Several agents share this machine, so a second run landing
  // mid-journey is a standing condition, not an accident.
  //
  // Suite 04 types 25 clients with full Indian addresses before it asserts
  // anything, so its trace and video are the largest in the wave — while other
  // wave agents hold their own browsers on the same machine. That is the memory
  // the dead browser was competing for.
  //
  // `retain-on-failure` rather than `off`: recording still happens, so a FAILING
  // test keeps its full trace and video — the evidence is only discarded on a
  // pass, which is precisely the expensive case and the one that never needed it.
  // Turning it `off` outright, as Suite 0.23 had to, also throws away the trace
  // viewer on the runs where it is the only way to see what happened.
  use: {
    ...base.use,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  /**
   * ⚠ ONE DIRECTORY PER PROJECT, AND THIS WAS A REAL BUG.
   *
   * Both suites shared the config's single `outputDir`, and Playwright EMPTIES
   * that directory at the start of a run — so the two agents driving this wave
   * concurrently were deleting each other's in-flight traces, and one had to
   * pass `--output` by hand to work around it.
   *
   * `coldstart.config.ts` records the reason at length and it was already known:
   * "a green journey is reported red". Knowing it at the config level and then
   * writing one directory for two projects is how it came back.
   */
  projects: [
    // ⚠ ADDED 2026-08-30. Proposal 105 §6 defines Wave 2 as "03 Core PM · 04
    // Graha", and this file declared only `graha` and `manav` — so
    // `--config=wave2.config.ts suite03-core-pm.spec.ts` collected ZERO tests
    // and exited 1 with "No tests found". A wave step that is a silent no-op
    // reads, in a run report, exactly like a wave step that passed nothing.
    // Suite 03 is also declared in `wave3.config.ts` as `corepm`; that is where
    // it was actually run from on 2026-08-30, and the two may coexist.
    {
      name: 'corepm',
      testMatch: /suite03-core-pm\.spec\.ts/,
      outputDir: path.join(OUT, 'corepm'),
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'graha',
      testMatch: /suite04-graha\.spec\.ts/,
      outputDir: path.join(OUT, 'graha'),
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'manav',
      testMatch: /suite07-manav\.spec\.ts/,
      outputDir: path.join(OUT, 'manav'),
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
