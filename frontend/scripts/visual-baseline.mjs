/**
 * visual-baseline.mjs — capture pixel screenshots of the main surfaces in both
 * themes, for diffing against a previous run.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS DELIBERATELY NOT WIRED INTO CI, AND ITS OUTPUT IS DELIBERATELY NOT
 * COMMITTED. BOTH DECISIONS ARE LOAD-BEARING.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1 · Why the output is not committed
 *
 *   A pixel baseline is only comparable against a run on the SAME platform.
 *   Font rasterisation, subpixel hinting and default font substitution all
 *   differ between Windows and the Linux container CI runs in — a
 *   Windows-authored PNG does not fail occasionally on Linux, it fails on every
 *   glyph every time. This is the same class of bug as the repo's standing
 *   lockfile rule (Windows yarn rewrites esbuild `linux-x64` → `win32-x64`).
 *
 *   So: baselines are generated in the environment that will compare them, and
 *   kept as CI artefacts or in a dedicated store. `visual-baselines/` is
 *   gitignored. If you find PNGs in a diff, something has gone wrong.
 *
 * 2 · Why it is not in CI
 *
 *   It needs `@playwright/test` and a downloaded browser binary. Neither is in
 *   `frontend/package.json`, and adding a dependency here means regenerating
 *   `yarn.lock` — which, from Windows, breaks the Vercel and Railway builds.
 *   The behavioural e2e suite (`src/__tests__/e2e/`) therefore runs on the
 *   installed vitest/jsdom stack and covers the flows; this script covers the
 *   one thing jsdom genuinely cannot do, and is run by hand when a redesign
 *   lands.
 *
 * 3 · Why it refuses to run without an explicit opt-in
 *
 *   Staging and production SHARE ONE SUPABASE PROJECT. A browser pointed at a
 *   deployed URL and signed in is writing to production's database — a login
 *   alone creates a session row and moves `last_login`. This script therefore:
 *
 *     · requires `VISUAL_BASELINE=1` to run at all;
 *     · refuses any host that is not localhost unless `VISUAL_ALLOW_REMOTE=1`
 *       is ALSO set, and refuses the known production hostnames outright;
 *     · never signs in and never issues a write. It captures PUBLIC surfaces
 *       only. Authenticated surfaces need a seeded local backend, which is a
 *       separate piece of work recorded in the report.
 *
 * ── Usage
 *
 *     cd frontend
 *     yarn add -D @playwright/test          # NOTE: do not commit yarn.lock
 *     npx playwright install chromium
 *     yarn start                            # in another shell
 *     VISUAL_BASELINE=1 node scripts/visual-baseline.mjs
 *
 * Output: `visual-baselines/<surface>.<theme>.png`
 */

import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'visual-baselines';

/** Public surfaces only. Nothing here requires a session. */
const SURFACES = [
  { name: 'landing', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'forgot-password', path: '/forgot-password' },
];

const THEMES = ['light', 'dark'];
const VIEWPORTS = [
  { name: 'mobile', width: 393, height: 852 },
  { name: 'desktop', width: 1440, height: 900 },
];

/** Hostnames this script must never point a browser at. */
const FORBIDDEN_HOSTS = [
  'kartavaya.com', 'www.kartavaya.com',
  'kartavya.com', 'www.kartavya.com',
];

function refuse(why) {
  console.error(`\nvisual-baseline: REFUSING TO RUN\n\n  ${why}\n`);
  process.exit(1);
}

function checkGuards(baseUrl) {
  if (process.env.VISUAL_BASELINE !== '1') {
    refuse(
      'set VISUAL_BASELINE=1 to run. This script drives a real browser at a real\n'
      + '  URL, and staging and production share one database — it does not run by\n'
      + '  accident.',
    );
  }

  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    refuse(`VISUAL_BASE_URL is not a URL: ${baseUrl}`);
  }

  if (FORBIDDEN_HOSTS.includes(url.hostname)) {
    refuse(
      `${url.hostname} is a production hostname. Screenshots are never taken\n`
      + '  against production, whatever the reason seems to be.',
    );
  }

  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (!isLocal && process.env.VISUAL_ALLOW_REMOTE !== '1') {
    refuse(
      `${url.hostname} is not localhost. Set VISUAL_ALLOW_REMOTE=1 if you are\n`
      + '  certain this host has its own database. It almost certainly does not:\n'
      + '  staging and production share one Supabase project.',
    );
  }
}

async function main() {
  const baseUrl = process.env.VISUAL_BASE_URL || 'http://localhost:3000';
  checkGuards(baseUrl);

  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    refuse(
      '@playwright/test is not installed. See the header of this file — it is a\n'
      + '  deliberate omission from package.json, because regenerating yarn.lock on\n'
      + '  Windows breaks the Linux builds. Install it locally without committing\n'
      + '  the lockfile.',
    );
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  let shots = 0;

  try {
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: theme,
          // Freeze motion so a mid-animation frame cannot make two identical
          // pages diff. This is also the setting the reduced-motion assertions
          // in src/__tests__/e2e/theme-motion.test.jsx describe.
          reducedMotion: 'reduce',
        });

        for (const surface of SURFACES) {
          const page = await context.newPage();

          // The app reads [data-theme] off <html>, written by applyPrefs from
          // localStorage. colorScheme alone only drives prefers-color-scheme,
          // which is the SYSTEM signal — set the stored preference too, before
          // any script runs, or every shot is light.
          await page.addInitScript((t) => {
            localStorage.setItem('k_prefs', JSON.stringify({ mode: t }));
          }, theme);

          await page.goto(new URL(surface.path, baseUrl).href, { waitUntil: 'networkidle' });

          // Belt and braces: assert the attribute actually landed rather than
          // trusting it, or a "dark" baseline is a second light one.
          const applied = await page.getAttribute('html', 'data-theme');
          if (applied !== theme) {
            console.warn(`  ! ${surface.name}: data-theme is "${applied}", expected "${theme}"`);
          }

          const file = join(OUT_DIR, `${surface.name}.${viewport.name}.${theme}.png`);
          await page.screenshot({ path: file, fullPage: true });
          console.log(`  ✓ ${file}`);
          shots += 1;
          await page.close();
        }

        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nvisual-baseline: ${shots} screenshots in ${OUT_DIR}/`);
  console.log('Diff against a previous run from the SAME platform. Do not commit these.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
