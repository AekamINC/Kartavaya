/**
 * Proposal 93 · Stage 3 · WAVE 5 — SUITE 14 (Sahayak / Hub), on Unicode Group
 * at §4 volumes.
 *
 * ── WHY THIS IS ITS OWN CONFIG AND NOT `wave5.config.ts` ────────────────────
 * §14's wave 5 is four suites — 03 core PM, 13 Sanvaad, 14 Sahayak, 15 eSign —
 * and three of them are being written by other agents in this same tree at the
 * same time. A shared `wave5.config.ts` is a file three authors would have to
 * write simultaneously and the last one to save wins. One config per suite
 * costs a file and removes the collision entirely; the wave's parallelism is a
 * property of running them at once, not of sharing a config. Modelled on
 * `suite17.config.ts`, which records the same reasoning.
 *
 * ── ⚠ ITS OWN outputDir, AND THAT IS THE WHOLE POINT ────────────────────────
 * Playwright EMPTIES `outputDir` at the start of a run and writes live traces
 * into it, so two concurrent runs sharing one directory delete each other's
 * in-flight artifacts and a green journey is reported red. `wave2.config.ts`
 * learned that with two projects in one directory. Several agents work in this
 * tree at once, so it is a standing condition and not a hypothetical.
 *
 * ── `workers: 1` ────────────────────────────────────────────────────────────
 * Not for the rate limiter — nothing here posts to `/auth/login`, and
 * `backend/limiter.py` constructs `Limiter` with no `default_limits`, so only
 * auth-shaped routes are limited. It is because THIS SUITE'S TESTS DEPEND ON
 * EACH OTHER IN ORDER: 14.00 measures the wallet every later test branches on,
 * 14.14's knowledge-base question needs 14.14's own upload to have landed, and
 * 14.15's chat sessions are counted as a delta against the list 14.15 read a
 * moment earlier. A second worker would read those counts mid-write and report
 * a product failure for a scheduling artefact.
 *
 * ── `channel: 'chrome'` ─────────────────────────────────────────────────────
 * Inherited from `real.config.ts`. Without it Vercel's bot mitigation answers
 * `403 Forbidden` with `x-vercel-mitigated: deny` to the bundled headless
 * shell, and every assertion fails on an element that was never served.
 *
 * ── The timeout ─────────────────────────────────────────────────────────────
 * 14.02 opens seven tab panels and 14.13 opens eight more; 14.14 uploads eight
 * knowledge documents and asks twelve questions of them; 14.15 opens six chat
 * sessions. The per-test default is nowhere near any of them, and a Sahayak
 * answer alone has averaged 7.3 s on the live service.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite14.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import base from './real.config';

// ESM scope — there is no __dirname here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-suite14');

export default defineConfig({
  ...base,
  testDir: HERE,
  outputDir: path.join(OUT, 'artifacts'),
  retries: 0,
  workers: 1,
  timeout: 45 * 60_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(OUT, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(OUT, 'report.json') }],
  ],
  projects: [
    {
      name: 'sahayak',
      testMatch: /suite14-sahayak\.spec\.ts/,
      outputDir: path.join(OUT, 'sahayak'),
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
