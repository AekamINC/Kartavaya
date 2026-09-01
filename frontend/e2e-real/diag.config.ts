/**
 * DIAGNOSTIC CONFIG — two projects, identical but for `channel`.
 *
 * `real.config.ts` says every Desktop Chrome project must name
 * `channel: 'chrome'` because the bundled Chromium is answered by bot
 * mitigation. The standalone suite configs override `projects` wholesale and
 * none of them names it. This proves whether that is what is killing them.
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-diag');

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 1,
  timeout: 5 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  projects: [
    {
      name: 'bundled-chromium',
      testMatch: /diag-boot\.spec\.ts/,
      outputDir: path.join(OUT, 'bundled'),
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'real-chrome',
      testMatch: /diag-boot\.spec\.ts/,
      outputDir: path.join(OUT, 'chrome'),
      use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: 'https://kartavaya.pages.dev' },
    },
  ],
});
