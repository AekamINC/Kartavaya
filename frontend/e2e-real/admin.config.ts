/**
 * Proposal 93 · SUITE 19 — the platform console, and the ONLY config that
 * carries a god-mode credential.
 *
 * ── Why this is a separate config rather than a project inside wave1 ────────
 * Suite 19 is the one suite 93 permits to use `platform_admin`. Every other
 * suite is org-scoped by rule, because a platform token does not scope to an
 * org — it resolves through `platform_bypass` to **Aekam Inc**, which is how
 * Suite 02 renamed the one company the programme guarantees is untouched.
 *
 * Keeping it in `wave1.config.ts` would mean `npx playwright test --config
 * wave1` silently runs a god-mode suite alongside the write suites, and the
 * separation would exist only in the reader's head. A separate config makes
 * using god mode a deliberate act: you have to name this file.
 *
 * ── `workers: 1` ────────────────────────────────────────────────────────────
 * Not for rate limiting — the console is not auth-shaped. It is because this
 * suite mutates one org's subscription and a second worker toggling the same
 * row would produce a conflict indistinguishable from a product defect.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/admin.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-admin');

export default defineConfig({
  ...base,
  testDir: HERE,
  // Its own outputDir: Playwright EMPTIES this at the start of a run and writes
  // live traces into it, so a shared directory means two concurrent runs delete
  // each other's in-flight artifacts and a green journey is reported red.
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(OUT, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(OUT, 'report.json') }],
  ],
  projects: [
    {
      name: 'admin',
      testMatch: /suite19-admin-modules\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
