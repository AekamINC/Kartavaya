/**
 * One-spec runner: the shared real.config with the password-based setup
 * project cut out, for when the auth state has been minted out-of-band
 * (auth.setup's owner login needs E2E_ADMIN_PASSWORD, which .env.e2e does
 * not carry — the owner is a token-only account).
 *
 *   npx playwright test --config e2e-real/onefile.config.ts client-report
 */
import { defineConfig, devices } from '@playwright/test';
import base from './real.config';

export default defineConfig({
  ...base,
  projects: [
    {
      name: 'one',
      testMatch: /(client-report|module-analytics)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
