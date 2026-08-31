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
import { browserProjects, announceSelection } from '../playwright.matrix';

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

/**
 * ── REAL CHROME, NOT THE BUNDLED HEADLESS SHELL ─────────────────────────────
 *
 * Measured 2026-08-26: EVERY spec in this directory was failing on its first
 * navigation with a Vercel page reading "403: Forbidden", and the response
 * carried `x-vercel-mitigated: deny`. That is Vercel's bot mitigation on
 * staging.kartavaya.com refusing the request outright.
 *
 * It is not the user agent — curl sending the identical HeadlessChrome UA gets
 * 200. It is the client fingerprint: Playwright's default download for
 * `chromium` is `chromium-headless-shell`, which mitigation classifies as a
 * bot. Launching the SAME url with `channel: 'chrome'` — the real Chrome on
 * this machine, still headless — answers 200 with no mitigation header.
 *
 * So this is one line, and without it the whole suite reports a product failure
 * for an infrastructure reason: the page under test never loads and every
 * assertion fails on an element that was never served. `channel: 'chromium'` is
 * NOT the alternative — it needs a separate download this environment cannot
 * spawn ("spawn UNKNOWN", the same fault that keeps these runs headless).
 *
 * The remedy on the Vercel side is an allow rule for the suite; until there is
 * one, this is what makes the specs able to see the app at all.
 *
 * ⚠ IT IS SET PER PROJECT, NOT IN THE SHARED `use`, AND THAT IS LOAD-BEARING.
 * It lived in the top-level `use` until the cross-browser projects arrived, and
 * `channel` is a CHROMIUM-ONLY option: a firefox or webkit project inheriting
 * it dies at launch with `Unsupported webkit channel "chrome"`. Setting
 * `channel: undefined` on the project does NOT clear it — measured, that is the
 * exact error above — because Playwright's `use` merge keeps the config value
 * for an explicitly-undefined key. The only thing that works is not putting it
 * there in the first place. Every Desktop Chrome project below names it.
 */
const CHROME_CHANNEL = 'chrome';

/**
 * ── CROSS-BROWSER / CROSS-PLATFORM, AND WHY IT IS NOT ON BY DEFAULT ─────────
 *
 * Every project below this comment drives real journeys that WRITE, against a
 * deployed service whose database staging and production SHARE. Multiplying
 * those by seven engines would be seven passes of real rows through real
 * customer data to learn something about CSS, which is not a trade worth
 * making. The default set is unchanged: Desktop Chrome, exactly as before.
 *
 * What the matrix gets instead is `xbrowser-*` — one READ-ONLY spec
 * (`xbrowser-smoke.spec.ts`) that stops at the public sign-in page and asks the
 * three questions only an engine can answer: is the app served to this
 * fingerprint, does the bundle boot, and does the page fit the viewport. It
 * types nothing and submits nothing, so it costs no rows.
 *
 * THE OPT-IN IS MECHANICAL, not a comment asking to be respected. These
 * projects do not exist unless `PW_BROWSERS` is set, so a bare
 * `npx playwright test` cannot pick them up:
 *
 *     PW_BROWSERS=all     npx playwright test --config e2e-real/real.config.ts --grep @xbrowser
 *     PW_BROWSERS=desktop npx playwright test --config e2e-real/real.config.ts --grep @xbrowser
 *
 * (`send` above claims to be opt-in and is not — a declared project runs on a
 *  bare invocation. That is why this one is gated on the environment instead.)
 *
 * The chromium-engine projects here take `CHROME_CHANNEL` for the mitigation
 * reason above; firefox and webkit take nothing, because there is no equivalent
 * channel for them. Whether mitigation then lets Gecko and WebKit through is
 * the open question that comment leaves; the smoke spec prints
 * `x-vercel-mitigated` on every run so the answer is measured, not assumed.
 */
const XBROWSER = process.env.PW_BROWSERS
  ? (announceSelection('all'),
    browserProjects({
      fallback: 'all',
      prefix: 'xbrowser',
      testMatch: /xbrowser-smoke\.spec\.ts/,
      // No `setup` dependency, and none is possible: this spec never signs in.
      // Same shape as `tonight` and `skills`, for a stronger reason.
      dependencies: [],
      usePerBrowser: (b) => (b.engine === 'chromium' ? { channel: CHROME_CHANNEL } : {}),
    }))
  : [];

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
    baseURL: process.env.E2E_BASE_URL || 'https://app.kartavaya.com',
    // `channel: 'chrome'` is NOT here on purpose — it is chromium-only and would
    // break the firefox/webkit projects. It is set per project as
    // `CHROME_CHANNEL`; the whole reason it is needed at all, and the measured
    // reason it cannot live here, are at that constant.
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'], channel: CHROME_CHANNEL } },
    {
      // Phase 7.6 · does Mappls answer a BROWSER on a whitelisted origin?
      //
      // Its own project because it is a PROBE, not a journey: it asserts only
      // that it ran and prints what each call returned, so a decision about
      // moving autosuggest client-side is made on a measurement. It costs a
      // handful of calls against an allocation of 200, so it is deliberately
      // not part of the `real-user` sweep.
      name: 'mappls-probe',
      testMatch: /(mappls-browser-probe|phase76-autosuggest)\.spec\.ts/,
      // NO `setup` dependency. `auth.setup.ts` signs BOTH users in and the
      // owner is a token-only Google account, so that project always fails on
      // the owner and would take this probe down with it. The approver state it
      // writes is all this needs, and it is written before that failure.
      // Same reasoning the `tonight` project below records.
      dependencies: [],
      use: { ...devices['Desktop Chrome'], channel: CHROME_CHANNEL },
    },
    {
      name: 'real-user',
      // `campaign-send` is deliberately absent here. It is the one suite that
      // mails real inboxes, so it lives in its own project below and never runs
      // as part of a normal `npx playwright test`.
      testMatch: /(real-user|full-journey|phase0|ganit|graha|vikray|vetana|manav|pahchan|corepm|reach|org|sanvaad|audience-segment)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], channel: CHROME_CHANNEL },
    },
    {
      // Tonight's work, driven against the deployed service. NO `setup`
      // dependency: `auth.setup.ts` signs in through the login form and the
      // owner is a token-only account (Google), so this project restores the
      // state `mint-state.mjs` writes from E2E_ADMIN_TOKEN instead.
      name: 'tonight',
      testMatch: /(tonight|phase75-territory-map)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel: CHROME_CHANNEL },
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
      use: { ...devices['Desktop Chrome'], channel: CHROME_CHANNEL },
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
      use: { ...devices['Desktop Chrome'], channel: CHROME_CHANNEL },
    },
    {
      // Opt-in only — nothing here runs unless you name the project:
      //   npx playwright test --config e2e-real/real.config.ts --project=send
      name: 'send',
      testMatch: /campaign-send\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], channel: CHROME_CHANNEL },
    },

    // Firefox, WebKit, a phone and a tablet — read-only, and present only when
    // PW_BROWSERS is set. See the XBROWSER block above.
    ...XBROWSER,
  ],
});
