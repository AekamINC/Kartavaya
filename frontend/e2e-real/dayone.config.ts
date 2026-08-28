/**
 * Its own config and its own outputDir — a Wave 1 agent is driving the product
 * in this same tree right now, and Playwright EMPTIES outputDir at run start
 * while writing live traces into it. Two runs sharing a directory delete each
 * other's in-flight artifacts and report a green journey as red.
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
  outputDir: path.join(os.tmpdir(), 'kartavya-e2e-dayone-artifacts'),
  retries: 0,
  workers: 1,
  reporter: [['list']],
  projects: [
    {
      name: 'dayone',
      testMatch: /dayone-capture\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
