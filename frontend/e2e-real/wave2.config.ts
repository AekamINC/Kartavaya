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
  timeout: 45 * 60_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(OUT, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(OUT, 'report.json') }],
  ],
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
