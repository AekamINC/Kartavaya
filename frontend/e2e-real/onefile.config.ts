/**
 * One-spec runner: the shared real.config with the password-based setup
 * project cut out, for when the auth state has been minted out-of-band
 * (auth.setup's owner login needs E2E_ADMIN_PASSWORD, which .env.e2e does
 * not carry — the owner is a token-only account).
 *
 *   npx playwright test --config e2e-real/onefile.config.ts client-report
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import base, { DL_DIR } from './real.config';

export default defineConfig({
  ...base,
  projects: [
    {
      name: 'one',
      testMatch: /(client-report|module-analytics|billing-tabs|billing-crud|phase1-acceptance|phase2-acceptance|phase3-acceptance|commission-seed)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // ── ITS OWN PROJECT, FOR ITS OWN `outputDir` ───────────────────────────
      //
      // Not a preference. Playwright EMPTIES `outputDir` when a run starts and
      // records live traces into `<outputDir>/.playwright-artifacts-N` while it
      // runs, so two `playwright test` processes sharing one directory delete
      // each other's in-flight files. Measured 2026-08-26: a concurrent
      // `phase3-acceptance` run wiped this one's artifacts mid-journey and
      // EMP-010 failed on `ENOENT … recording16.trace` inside `context.close()`
      // — after its account had already been created. A green journey reported
      // as a red one, and a re-run needed to finish the row.
      //
      // Several agents work in this tree at once, so that collision is a
      // standing condition rather than an accident. A separate directory is the
      // whole fix; the run command is unchanged because Playwright filters by
      // filename across every project.
      name: 'dummy-logins',
      testMatch: /manav-dummy-logins\.spec\.ts/,
      outputDir: path.join(DL_DIR, 'artifacts-dummy-logins'),
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Phase 4.1 + 4.2 — the first row in `module_compliance_settings` and the
      // first in `pahchan_employee_consents`, both written through the real
      // screens. Its own project for the same `outputDir` reason recorded
      // above: it opens a SECOND browser context (the employee signs in with
      // her own password to answer for herself), so a concurrent run emptying
      // the shared artefacts directory would tear a live recording out from
      // under a journey that had already succeeded.
      name: 'phase4-first-rows',
      testMatch: /phase4-first-rows\.spec\.ts/,
      outputDir: path.join(DL_DIR, 'artifacts-phase4-first-rows'),
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
