/**
 * Real-user E2E suite against the deployed STAGING app, driving the seeded
 * "E2E Test & Associates [TEST ORG]" (org 64e7bea6, team_1682e055fd21).
 *
 * All writes stay inside that org. Credentials come from ../../.env.e2e
 * (gitignored). Auth storage states are written OUTSIDE the repo (os.tmpdir).
 *
 * Run from frontend/:  npx playwright test --config e2e-real/real.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.e2e from repo root without a dotenv dependency.
const envFile = path.resolve(__dirname, '..', '..', '.env.e2e');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export const STATE_DIR = path.join(os.tmpdir(), 'kartavya-e2e-auth');
export const OWNER_STATE = path.join(STATE_DIR, 'owner.json');
export const APPROVER_STATE = path.join(STATE_DIR, 'approver.json');
export const DL_DIR = path.join(os.tmpdir(), 'kartavya-e2e-downloads');
for (const d of [STATE_DIR, DL_DIR]) fs.mkdirSync(d, { recursive: true });

export default defineConfig({
  testDir: __dirname,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1, // one real user at a time; journeys share server state
  retries: 0,
  reporter: [['list'], ['json', { outputFile: path.join(DL_DIR, 'report.json') }]],
  outputDir: path.join(DL_DIR, 'artifacts'),
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://staging.kartavaya.com',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'real-user',
      testMatch: /(real-user|full-journey|phase0|ganit)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
