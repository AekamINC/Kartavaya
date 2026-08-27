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
/** The only account that can reach more than one org — see mint-state.mjs. */
export const GODMODE_STATE = path.join(STATE_DIR, 'godmode.json');
export const DL_DIR = path.join(os.tmpdir(), 'kartavya-e2e-downloads');
for (const d of [STATE_DIR, DL_DIR]) fs.mkdirSync(d, { recursive: true });

export default defineConfig({
  testDir: __dirname,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1, // one real user at a time; journeys share server state
  retries: 0,
  // An HTML report and a video per test, because the runs are headless — this
  // environment cannot spawn a visible browser ("spawn UNKNOWN"). The report is
  // the thing to open: every step, every screenshot, and the footage of the
  // browser actually doing it. `npx playwright show-report <dir>` opens it.
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(DL_DIR, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(DL_DIR, 'report.json') }],
  ],
  outputDir: path.join(DL_DIR, 'artifacts'),
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://staging.kartavaya.com',
    // ── REAL CHROME, NOT THE BUNDLED HEADLESS SHELL ──────────────────────────
    //
    // Measured 2026-08-26: EVERY spec in this directory was failing on its first
    // navigation with a Vercel page reading "403: Forbidden", and the response
    // carried `x-vercel-mitigated: deny`. That is Vercel's bot mitigation on
    // staging.kartavaya.com refusing the request outright.
    //
    // It is not the user agent — curl sending the identical HeadlessChrome UA
    // gets 200. It is the client fingerprint: Playwright's default download for
    // `chromium` is `chromium-headless-shell`, which mitigation classifies as a
    // bot. Launching the SAME url with `channel: 'chrome'` — the real Chrome on
    // this machine, still headless — answers 200 with no mitigation header.
    //
    // So this is one line, and without it the whole suite reports a product
    // failure for an infrastructure reason: the page under test never loads and
    // every assertion fails on an element that was never served. `channel:
    // 'chromium'` is NOT the alternative — it needs a separate download this
    // environment cannot spawn ("spawn UNKNOWN", the same fault that keeps these
    // runs headless).
    //
    // The remedy on the Vercel side is an allow rule for the suite; until there
    // is one, this is what makes the specs able to see the app at all.
    channel: 'chrome',
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'real-user',
      // `campaign-send` is deliberately absent here. It is the one suite that
      // mails real inboxes, so it lives in its own project below and never runs
      // as part of a normal `npx playwright test`.
      testMatch: /(real-user|full-journey|phase0|ganit|graha|vikray|vetana|manav|pahchan|corepm|reach|org|sanvaad|audience-segment)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Tonight's work, driven against the deployed service. NO `setup`
      // dependency: `auth.setup.ts` signs in through the login form and the
      // owner is a token-only account (Google), so this project restores the
      // state `mint-state.mjs` writes from E2E_ADMIN_TOKEN instead.
      name: 'tonight',
      testMatch: /tonight\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Layout regressions that ONLY a real browser can see.
      //
      // The owner reported every dropdown in the task drawer blank. The values
      // were in the DOM and correctly coloured — the chevron beside them was
      // 141px of a 165px button and squeezed each label to zero width, because
      // a stale bare `.ch { width: 100% }` in sanvaad.css collided with the
      // picker's chevron class.
      //
      // No jsdom test can catch that: jsdom performs no layout, so every width
      // there is 0 whether the bug is present or not. It has to be measured
      // against the deployed bundle. Same no-`setup` reason as `skills`: the
      // owner signs in with Google and has no password for auth.setup.ts.
      name: 'ui',
      testMatch: /(drawerpickers|createdcolumn)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The skill shelf and the corner dock, driven as a person drives them.
      // Same reason as `tonight` for having no `setup` dependency: the owner
      // account signs in with Google and has no password for `auth.setup.ts`
      // to type, so this restores the state `mint-state.mjs` mints from
      // E2E_ADMIN_TOKEN.
      //
      // Its own project rather than a line in `real-user`, because it RUNS
      // SKILLS against the deployed service. Everything it runs is a free
      // `check` with no AI step and is verified by name against
      // WRITE_SKILL_FUNCTIONS before it is pressed — but a suite that causes
      // work on the shared database should be nameable, and skippable, on its
      // own.
      name: 'skills',
      testMatch: /skills\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Opt-in only — nothing here runs unless you name the project:
      //   npx playwright test --config e2e-real/real.config.ts --project=send
      name: 'send',
      testMatch: /campaign-send\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
