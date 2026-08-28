/**
 * Config for the cold-start navigation audit.
 *
 * Its own file, and its own `outputDir`, for the reason `onefile.config.ts`
 * records at length: Playwright EMPTIES `outputDir` at the start of a run and
 * writes live traces into it, so two concurrent runs sharing one directory
 * delete each other's in-flight artifacts and a green journey gets reported red.
 * Several agents work in this tree at once, so that is a standing condition.
 *
 * It also has NO setup project. `auth.setup.ts` signs in the owner, and the
 * owner is a token-only Google account with no password — so the setup project
 * always fails on it. This suite logs in as the approver, inside the test.
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here. real.config.ts derives it the same way.
const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(os.tmpdir(), 'kartavya-e2e-coldstart'),
  retries: 0,
  workers: 1,
  reporter: [['list']],
  projects: [
    {
      name: 'coldstart',
      testMatch: /(coldstart-nav-audit|hub-org-probe|note-probe)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
