/**
 * Proposal 93 · Stage 3 · WAVE 7 — SUITE 12 (Dristi · reports and analytics),
 * on Unicode Group at §4 volumes.
 *
 * ── WHY THIS IS ITS OWN CONFIG ──────────────────────────────────────────────
 * §14's wave 7 is two suites — 12 Dristi and 20 cross-cutting — and other
 * agents are writing in this same tree at the same time. A shared
 * `wave7.config.ts` is a file two authors would save over each other. One
 * config per suite costs a file and removes the collision; the wave's
 * parallelism is a property of running them at once, not of sharing a config.
 *
 * ── ⚠ ITS OWN outputDir, AND THAT IS THE WHOLE POINT ────────────────────────
 * Playwright EMPTIES `outputDir` at the start of a run and writes live traces
 * into it, so two concurrent runs sharing one directory delete each other's
 * in-flight artifacts and a green journey is reported red. `wave2.config.ts`
 * learned that with two projects in one directory. Several agents work in this
 * tree at once, so it is a standing condition, not a hypothetical. Nothing here
 * points at `kartavya-e2e-downloads`, `kartavya-e2e-wave*` or any other suite's
 * directory: this suite owns `kartavya-e2e-suite12` and touches nothing else.
 *
 * ── `workers: 1` ────────────────────────────────────────────────────────────
 * Not for the rate limiter — nothing here posts to `/auth/login`. It is because
 * THIS SUITE'S TESTS DEPEND ON EACH OTHER IN ORDER: 12.05 pins charts onto the
 * dashboards 12.04 creates, 12.08 dispatches the schedules it books, and 12.12
 * counts what every earlier test left behind. A second worker would run 12.05
 * against boards that do not exist yet and report a product failure for a
 * scheduling artefact.
 *
 * Worse here than elsewhere: this is the RECONCILIATION suite. Every assertion
 * compares two figures read moments apart, and the org's rows are moving under
 * it — `public.tasks` for Unicode went 99 → 100 → 101 inside forty minutes of
 * measurement on 2026-08-29 while other agents worked. Two workers reading the
 * same pair at different instants would manufacture mismatches that are neither
 * a product bug nor a test bug, which is the worst kind of red.
 *
 * ── `channel: 'chrome'` ─────────────────────────────────────────────────────
 * Inherited from `real.config.ts`. Without it Vercel's bot mitigation answers
 * `403 Forbidden` with `x-vercel-mitigated: deny` to the bundled headless
 * shell, and every assertion fails on an element that was never served.
 *
 * ── The timeout ────────────────────────────────────────────────────────────
 * 12.02 walks nine reporting-period presets plus a custom range, and every one
 * of them re-runs the KPI strip and the open tab; 12.03 runs every non-absent
 * metric in the catalogue (76 of 107, measured 2026-08-29); 12.11 takes ~60
 * paired readings. The per-test default is nowhere near any of them.
 *
 * ── `acceptDownloads` ───────────────────────────────────────────────────────
 * §4 asks for 36 exports and §1 names "a 200 with an empty body" as the failure
 * to catch. Every export here is asserted as a FILE with bytes on disk, so
 * downloads must be accepted rather than cancelled. `devices['Desktop Chrome']`
 * already sets it; it is named here so nobody removes it as noise.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite12.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-suite12');

/** Where every downloaded export lands. Read by the spec, not only written. */
export const S12_DL = path.join(OUT, 'downloads');
fs.mkdirSync(S12_DL, { recursive: true });

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 1,
  timeout: 45 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(OUT, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(OUT, 'report.json') }],
  ],
  projects: [
    {
      name: 'dristi',
      testMatch: /suite12-dristi\.spec\.ts/,
      outputDir: path.join(OUT, 'dristi'),
      use: { ...devices['Desktop Chrome'], acceptDownloads: true },
    },
  ],
});
