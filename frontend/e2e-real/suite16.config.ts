/**
 * Proposal 93 · Stage 3 · WAVE 6 — SUITE 16 (Niyam, automations), on Unicode
 * Group at §4 volumes.
 *
 * ── WHY ITS OWN CONFIG ──────────────────────────────────────────────────────
 * §14's wave 6 is three suites — 16 Niyam, 18 portal, 19 admin — and several
 * agents share this tree. `suite17.config.ts` records why a shared wave config
 * is a file three authors overwrite in turn; the same holds here. One config
 * per suite costs a file and removes the collision.
 *
 * ── ⚠ ITS OWN outputDir ─────────────────────────────────────────────────────
 * Playwright EMPTIES `outputDir` at the start of a run and writes live traces
 * into it, so two concurrent runs sharing one directory delete each other's
 * in-flight artifacts and a green journey is reported red. `wave2.config.ts`
 * learned that with two projects in one directory. It is a standing condition
 * in this tree, not a hypothetical.
 *
 * ── `workers: 1`, AND HERE IT IS LOAD-BEARING RATHER THAN TIDY ──────────────
 * This suite drives a SINGLE GLOBAL ENGINE. `POST /api/internal/niyam/sweep`
 * claims one row in `staging.niyam_engine_tick` and a second concurrent tick is
 * told "a tick was already running" and returns having done NOTHING — with a
 * 200 (`sweep.py`, `_claim_tick`). Two workers would therefore produce a test
 * that swept, saw zero runs, and reported the engine dead. The tests are also
 * ordered by construction: 16.08 arms rules 16.04 created, 16.09–16.13 fire
 * them, 16.16 disarms them.
 *
 * ── `channel: 'chrome'` ─────────────────────────────────────────────────────
 * Inherited from `real.config.ts`. Without it Vercel's bot mitigation answers
 * `403 Forbidden` with `x-vercel-mitigated: deny` to the bundled headless
 * shell, and every assertion fails on an element that was never served.
 *
 * ── THE TIMEOUT, AND WHY IT IS THE LARGEST IN THE PROGRAMME ─────────────────
 * 16.07 drains a real backlog. Measured on the live database 2026-08-29:
 * `staging.niyam_events` holds **747 unprocessed Unicode rows**, because
 * `cron-niyam` has been disarmed at `0 0 1 1 *` since proposal 93's R1 freeze
 * and the last tick ran 2026-08-28 09:46 UTC. `DRAIN_LIMIT` is 200 and
 * `TICK_BUDGET_SECONDS` is 240, so clearing it takes several ticks and each one
 * may run for minutes. 16.15 additionally WAITS OUT a real `wait` step.
 *
 * ── ⚠ THE ONE CREDENTIAL THIS SUITE NEEDS THAT `.env.e2e` DOES NOT CARRY ────
 * `E2E_CRON_SECRET`. Nothing in the product drains the outbox — there is no
 * user control for it anywhere — so a rule cannot fire without the engine's own
 * clock being advanced, and the cron that would advance it is deliberately off.
 * Supply it for the run rather than storing it:
 *
 *   cd frontend
 *   export E2E_CRON_SECRET="$(railway variables --service Kartavya \
 *       --environment staging --kv | sed -n 's/^CRON_SECRET=//p')"
 *   npx playwright test --config e2e-real/suite16.config.ts
 *
 * The spec FAILS, naming this, if it is absent. It is not a skip.
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-suite16');

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 1,
  // 16.07 drains a 747-event backlog through an engine bounded at 200 events
  // and 240 seconds a tick; 16.14 waits out a real `wait` step.
  // ⚠ CAPPED 2026-08-30, from 75 minutes. A per-test budget measured in
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
      name: 'niyam',
      testMatch: /suite16-niyam\.spec\.ts/,
      outputDir: path.join(OUT, 'niyam'),
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
