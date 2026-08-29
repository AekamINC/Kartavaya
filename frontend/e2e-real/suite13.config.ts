/**
 * Proposal 93 · Stage 3 · WAVE 5 — SUITE 13 (Sanvaad / chat), on Unicode Group
 * at §4 volumes.
 *
 * ── WHY THIS IS ITS OWN CONFIG ──────────────────────────────────────────────
 * §14's wave 5 is four suites — 03 core PM, 13 Sanvaad, 14 Sahayak, 15 eSign —
 * and several are being written by other agents in this same tree at the same
 * time. A shared `wave5.config.ts` is a file several authors would have to
 * write simultaneously and the last one to save wins. One config per suite
 * costs a file and removes the collision entirely; the wave's parallelism is a
 * property of running the suites at once, not of sharing a config file.
 *
 * ── ⚠ ITS OWN outputDir, AND THAT IS THE WHOLE POINT ────────────────────────
 * Playwright EMPTIES `outputDir` at the start of a run and writes live traces
 * into it, so two concurrent runs sharing one directory delete each other's
 * in-flight artifacts and a green journey is reported red. `wave2.config.ts`
 * learned that with two projects in one directory. Several agents work in this
 * tree at once, so it is a standing condition rather than a hypothetical.
 *
 * ── `workers: 1` ────────────────────────────────────────────────────────────
 * Not the rate limiter — nothing here posts to `/auth/login`. It is because
 * THIS SUITE'S TESTS DEPEND ON EACH OTHER IN ORDER: 13.03 posts into the
 * channels 13.02 created, 13.06 threads off 13.03's messages, 13.10 searches
 * the corpus 13.03 typed, 13.13 archives a channel 13.02 made. A second worker
 * would start 13.03 against channels that do not exist yet and report a product
 * failure for a scheduling artefact.
 *
 * ── `channel: 'chrome'` ─────────────────────────────────────────────────────
 * Inherited from `real.config.ts`. Without it Vercel's bot mitigation answers
 * `403 Forbidden` with `x-vercel-mitigated: deny` to the bundled headless
 * shell, and every assertion fails on an element that was never served.
 *
 * ── The timeout ─────────────────────────────────────────────────────────────
 * 13.03 types 140 messages through the real composer and 13.06 types 24 thread
 * replies, each one waiting for its own POST to answer. The per-test default is
 * nowhere near that. `expect.timeout` is raised too: the channel log polls on a
 * 3 s cycle when focused and 8 s when blurred, so a row can legitimately take
 * two poll cycles to appear for a reader that is not the sender.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite13.config.ts
 *
 * ⚠ Do NOT pipe the output through `tail`: it truncates the failure blocks AND
 * masks the exit code. Read `report.json` under the outputDir below.
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-suite13');

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 1,
  timeout: 60 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(OUT, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(OUT, 'report.json') }],
  ],
  projects: [
    {
      name: 'sanvaad',
      testMatch: /suite13-sanvaad\.spec\.ts/,
      outputDir: path.join(OUT, 'sanvaad'),
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
