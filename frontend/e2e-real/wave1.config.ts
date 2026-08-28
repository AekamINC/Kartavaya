/**
 * Proposal 93 · Stage 3 · WAVE 1 — Suite 01 (auth & account) and Suite 02
 * (org settings), driven against Unicode Group on deployed staging.
 *
 * ── Its own config, and its own outputDir ───────────────────────────────────
 * `coldstart.config.ts` records the reason at length and it has not changed:
 * Playwright EMPTIES `outputDir` at the start of a run and writes live traces
 * into it, so two concurrent runs sharing one directory delete each other's
 * in-flight artifacts and a green journey is reported red. Several agents work
 * in this tree at once, so that is a standing condition, not a hypothetical.
 *
 * ── No `setup` project ──────────────────────────────────────────────────────
 * `auth.setup.ts` signs the owner in through the login form, and the owner is a
 * token-only Google account with no password — that project always fails on it.
 * Every spec here logs in inside the test, through the real form, which is what
 * "every row is typed by a user" requires anyway.
 *
 * ── `channel: 'chrome'` ─────────────────────────────────────────────────────
 * Inherited from `real.config.ts`. Without it Vercel's bot mitigation answers
 * `403 Forbidden` with `x-vercel-mitigated: deny` to the bundled headless
 * shell, and every assertion fails on an element that was never served.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave1.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-wave1');

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  // One real user at a time. The rate-limit test in Suite 01 deliberately
  // exhausts `POST /auth/login` (5/minute, keyed on the forwarded IP), so a
  // second worker signing in from the same egress address would be refused by
  // this suite's own doing and report a product failure for a test artefact.
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(OUT, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(OUT, 'report.json') }],
  ],
  projects: [
    {
      name: 'wave1',
      testMatch: /(suite01-auth|suite02-org-settings|dayone-module-403|save-probe|upi-readback-probe|gstin-blank-probe)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
