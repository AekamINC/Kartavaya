/**
 * Proposal 93 · Stage 3 · WAVE 4 — Suite 06 (Kray, procurement), Suite 10
 * (Vikray, sales), Suite 11 (Prachar, marketing) and Suite 17 (client billing),
 * on Unicode Group at §4 volumes.
 *
 * ── WHAT WAVE 3 LEFT BEHIND, WHICH IS WHY THIS CAN RUN AT ALL ──────────────
 * §14's waves are a dependency graph, not a schedule. Measured on the live
 * database before this file was written (2026-08-29):
 *
 *   18 products, 12 of them costed · 25 clients · 53 contacts   (Suites 04, 05)
 *   53 invoices, 12 crediting a salesperson                     (Suite 05)
 *   30 employees · 8 commission schemes, 3 bands each           (Suite 07)
 *   30 deals, 8 of them Won                                     (Suite 04)
 *
 * An order needs a company to be raised against and a catalogue to be raised
 * from; a commission payout needs a ladder to be paid by. All four exist, so
 * this wave is unblocked by evidence rather than by assumption.
 *
 * ── ⚠ ITS OWN outputDir PER PROJECT, AND WAVE 2 TAUGHT THIS THE HARD WAY ───
 * `wave2.config.ts` gave both its suites ONE outputDir, and Playwright EMPTIES
 * that directory at the start of a run — so the two agents driving it were
 * deleting each other's in-flight traces, and one had to pass `--output` by
 * hand to avoid it. A green journey reported red is the failure mode, and it
 * costs an hour of reading the wrong artifacts. Every project below therefore
 * gets its OWN directory, not just the config.
 *
 * ── `workers: 4` ───────────────────────────────────────────────────────────
 * One per suite, and §14's own ceiling: login is rate-limited to 5/min and a
 * lane that trips its own limiter produces failures indistinguishable from
 * defects. Suite 01 is the only suite that must stay at 1, and it is not here.
 *
 * ⚠ THEY ARE INDEPENDENT IN WHAT THEY CREATE AND NOT IN WHAT THEY READ.
 * Vikray reads the catalogue Ganit owns and the commission ladder Manav owns,
 * and creates neither: the eighteen products are Suite 05's and the schemes are
 * Suite 07's, and doubling either here would corrupt their volume sheets. That
 * is deliberately NOT expressed as a shared fixture — whichever suite needs
 * another's rows reads them and says so, because a suite that depends on a
 * sibling's output inside one wave is a suite that only passes in one order.
 *
 * ── ADDING YOUR SUITE ──────────────────────────────────────────────────────
 * Append a project with its own `testMatch` and its own `outputDir` under
 * `OUT`. Do not share a directory and do not reorder the existing entries.
 *
 * Run one suite:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave4.config.ts --project vikray
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-wave4');

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 4,
  // §4 is ~400 records for Vikray alone — 35 orders each with a picker, two
  // dates, a catalogue line and a lifecycle walk, 45 stock movements, 10
  // targets — every one typed into a real form. The per-test default is
  // nowhere near a suite that seeds an order book before it asserts anything.
  timeout: 120 * 60_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(OUT, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(OUT, 'report.json') }],
  ],
  projects: [
    {
      name: 'vikray',
      testMatch: /suite10-vikray\.spec\.ts/,
      outputDir: path.join(OUT, 'vikray'),
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
