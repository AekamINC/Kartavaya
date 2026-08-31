/**
 * Proposal 93 · Stage 3 · WAVE 8 — SUITE 22, the dead-control sweep, on
 * Unicode Group.
 *
 * ── WHY THIS RUNS LAST, AND WHY THAT IS NOT SCHEDULING TRIVIA ───────────────
 * §14 puts Suite 22 alone in wave 8 because "a control on an empty table is
 * legitimately disabled — the sweep is meaningless until the org is full". A
 * disabled button is not a dead button, and a sweep run against an empty org
 * would classify half the product as unreachable and be wrong about every one
 * of them. Measured 2026-08-29 before this config was written: Unicode Group
 * holds 9 projects, 102 tasks, 28 clients, 79 contacts, 32 deals, 65 invoices,
 * 12 purchase orders, 30 employees and 35 sales orders. It is full.
 *
 * ── ITS OWN CONFIG, AND ONE outputDir PER PROJECT ──────────────────────────
 * Playwright EMPTIES `outputDir` at the start of a run and writes live traces
 * into it, so two concurrent runs — or two projects — sharing one directory
 * delete each other's in-flight artifacts and a green journey is reported red.
 * Several agents work in this tree at once, so it is a standing condition and
 * not a hypothetical. Every project below has its own directory.
 *
 * ── THE SHARDS, AND WHY THEY ARE DRAWN WHERE THEY ARE ──────────────────────
 * §4 sizes this suite at ~2,250 clicks across ~150 screens. Single-threaded at
 * the 1.2–2.0 s §6 costs an interaction, that is hours. The shards are drawn on
 * MODULE boundaries because a module page keeps its open tab in local state
 * (`GanitPage` says so in its own comment) — so a shard that spans half a
 * module would re-navigate constantly, and two workers inside one module would
 * fight over the same tab strip in two contexts for no gain.
 *
 * Six projects, no dependencies between them: each signs in for itself, and
 * each writes its own ledger file. `census` runs LAST because it depends on all
 * six, and its whole job is to read those files back and publish the count.
 *
 * ── `workers: 3` ────────────────────────────────────────────────────────────
 * NOT the login limiter — nothing here posts to `/auth/login`. `signInAs()`
 * takes the token branch, which is one `page.goto('/login')`, a localStorage
 * write and a redirect; `backend/limiter.py` constructs `Limiter` with no
 * `default_limits`, so only auth-shaped routes are limited at all.
 *
 * It is (a) machine cost — each worker is a real Chrome, and this environment
 * cannot spawn the bundled shell at all — and (b) the fact that four other
 * agents are driving this same staging service concurrently. §14's peak
 * concurrency for the whole programme is 4; three workers here leaves room.
 *
 * ── THE TIMEOUT ─────────────────────────────────────────────────────────────
 * A shard is 30–45 screens and 300–600 clicks, each with a settle window. 90
 * minutes is the ceiling that lets the slowest shard (money: Ganit's 21 tabs
 * plus Kray's 10 plus Vikray's 12) finish rather than be truncated mid-module,
 * which would publish a census with a silent cap in it — the exact failure §0
 * names.
 *
 * ── `channel: 'chrome'` ─────────────────────────────────────────────────────
 * Inherited from `real.config.ts`, and load-bearing: without it Vercel's bot
 * mitigation answers `403 Forbidden` with `x-vercel-mitigated: deny` to the
 * bundled headless shell and every screen in the sweep would enumerate zero
 * controls — i.e. the sweep would report the entire product dead.
 *
 * ── THE VIEWPORT IS 1600×1000 AND THAT IS A MEASUREMENT DECISION ───────────
 * `ModuleTabs` decides how many tabs sit inline by MEASURING its own strip's
 * client width at run time (`ModuleTabs.jsx`, the `fits` effect) — so the split
 * between the strip and the "More +N" popover is not knowable from the source
 * and changes with the window. A wider viewport puts more of the strip on
 * screen, which means fewer popover round trips and fewer chances to mis-locate
 * a tab. It does NOT change what is swept: `selectTab()` reaches a tab in the
 * tail through the real More menu, exactly as a person does.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite22.config.ts
 * One shard:
 *   npx playwright test --config e2e-real/suite22.config.ts --project money
 * Enumerate only, click nothing (the pass the reviewed allowlist is built from):
 *   SWEEP_DRY=1 npx playwright test --config e2e-real/suite22.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-suite22');

/** Shared by the spec, so the ledger and the report never drift apart. */
export const LEDGER_DIR = path.join(OUT, 'ledger');

const shard = (name: string) => ({
  name,
  testMatch: /suite22-dead-controls\.spec\.ts/,
  grep: new RegExp(`22\\.[0-9]+ ${name} `),
  outputDir: path.join(OUT, name),
  dependencies: ['preflight'],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
});

const SHARDS = ['chrome', 'core', 'settings', 'money', 'people', 'crm', 'comms'];

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 3,
  // ⚠ CAPPED 2026-08-30, from 90 minutes. A per-test budget measured in
  // tens of minutes does not protect a slow test — it hides a DEAD one. Suite 04
  // proved it: the browser died, the worker sat at idle CPU, and with a 45-minute
  // budget nothing killed the wait. 2 of 22 tests ran, 20 never started, and the
  // wave lost its slot to a crash that never surfaced as a failure.
  //
  // 20 minutes is ~7x the longest test actually observed in this programme
  // (04.04, fifty contacts with addresses, 2.7m). A test that genuinely needs
  // more should say so with `test.setTimeout()` in the file that needs it, where
  // the exception is visible, rather than every test inheriting a budget sized
  // for the slowest one.
  timeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(OUT, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(OUT, 'report.json') }],
  ],
  use: {
    ...base.use,
    // A trace per click across ~2,250 clicks is gigabytes and minutes. The
    // ledger is this suite's evidence, not the trace; traces are kept only for
    // the shard that fails.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      // FIRST, and every shard depends on it. It counts the protected 20 tasks
      // and writes that number to disk BEFORE any click happens, so `22.94`'s
      // after-count is compared against a genuine before — not against a
      // reading taken while three shards were already clicking.
      name: 'preflight',
      testMatch: /suite22-dead-controls\.spec\.ts/,
      grep: /22\.00 preflight /,
      outputDir: path.join(OUT, 'preflight'),
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
    },
    ...SHARDS.map(shard),
    {
      // LAST, and the only project with dependencies. It reads every shard's
      // ledger file back off disk and publishes the census — which is why it
      // must not start until all six have written theirs.
      name: 'census',
      testMatch: /suite22-dead-controls\.spec\.ts/,
      grep: /22\.9[0-9] census /,
      dependencies: SHARDS,
      outputDir: path.join(OUT, 'census'),
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
    },
  ],
});
