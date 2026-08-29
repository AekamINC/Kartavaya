/**
 * Config for Stage 4's read-only probes. Its own file and its own `outputDir`
 * for the reason `coldstart.config.ts` records at length: Playwright EMPTIES
 * `outputDir` at the start of a run, so two concurrent runs sharing one
 * directory delete each other's in-flight artifacts. Several agents work in
 * this tree at once, so that is a standing condition, not a hypothetical.
 *
 * No `setup` project: `auth.setup.ts` signs in the owner through the login
 * form and the owner is a token-only account, so that project always fails.
 * These probes sign in inside the test, via `signInAs` — which runs
 * `assertOrg` and so proves the lane from the id the SERVER resolved.
 *
 * Run:
 *   cd frontend
 *   E2E_LANE=uk npx playwright test --config e2e-real/probe.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(os.tmpdir(), 'kartavya-e2e-probe', 'artifacts'),
  retries: 0,
  workers: 1,
  reporter: [['list']],
  projects: [
    {
      name: 'probe',
      testMatch: /onboard-overlay-probe\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
