/**
 * THE BROWSER AND PLATFORM MATRIX — one definition, read by every Playwright
 * config in this repo.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Until this landed, all three Playwright configs declared exactly one project:
 *
 *     projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
 *
 * So the entire browser-driven half of QA — 69 specs against deployed staging,
 * 4 specs against a stubbed local build — ran on ONE engine at ONE viewport.
 * Nothing in this repository had ever loaded the product in Gecko or WebKit,
 * and nothing had ever loaded it at a phone width. Two whole categories of
 * defect (engine-specific CSS/JS, and responsive layout) had no test that could
 * see them, while the suite reported itself green.
 *
 * That is the same shape as the contrast gate, the CSP gate and the Mappls
 * gate: absence reading as coverage. This file is the fix for the browser half.
 *
 * ── The matrix maps to what this product ACTUALLY ships on ──────────────────
 *
 * Not "all the browsers Playwright can start". Every row below is a surface a
 * Kartavaya customer really uses, and each is here for a reason it can fail:
 *
 *   chromium        Chrome/Edge/Brave on Windows and macOS. The majority of
 *                   Indian firm desktops. This is the engine everything was
 *                   already tested on.
 *   firefox         Gecko. Different CSS cascade edge cases, different flexbox
 *                   and grid rounding, no -webkit- prefixes honoured.
 *   webkit          Safari on macOS. The engine most likely to differ, and the
 *                   one nothing here has ever run.
 *   android-chrome  An Android phone — AND the Capacitor WebView. `frontend/
 *                   android/` ships this same bundle as an APK, and that
 *                   WebView IS Android Chrome. So this project is not only
 *                   "mobile web": it is the shipping Android surface.
 *   ios-safari      An iPhone. WebKit is the ONLY engine iOS permits, so
 *                   there is no fallback if the product breaks here.
 *   ipad-safari     An iPad, landscape. The tablet layout.
 *   android-tablet  An Android tablet, landscape — deliberately mirroring the
 *                   `Tab_A11_Plus` AVD that `mobile/e2e/android_e2e.py`
 *                   already drives, so the web and native tablet stories are
 *                   measured at comparable geometry.
 *
 * DESKTOP EDGE IS NOT HERE, on purpose. It is Chromium with a different badge:
 * it costs a full project and buys no engine coverage that `chromium` does not
 * already give. Name it explicitly (`PW_BROWSERS=edge`) if a defect ever turns
 * out to be Edge-specific; the descriptor is resolved the same way.
 *
 * ── Cost control: PW_BROWSERS ───────────────────────────────────────────────
 *
 * Seven projects is seven times the wall-clock and, for any suite that writes,
 * seven times the rows in a database staging and production SHARE. So no
 * config gets the full matrix by accident. Each one passes its own default to
 * `browserProjects()`, and `PW_BROWSERS` overrides it:
 *
 *     PW_BROWSERS=all                 every row below
 *     PW_BROWSERS=desktop             chromium, firefox, webkit
 *     PW_BROWSERS=mobile              android-chrome, ios-safari
 *     PW_BROWSERS=tablet              ipad-safari, android-tablet
 *     PW_BROWSERS=chromium,webkit     exactly those, by name
 *
 * An unknown name THROWS at config load rather than resolving to nothing. A
 * typo that silently ran zero projects would report a green run over no tests
 * at all, which is the failure mode this whole file is arguing against.
 *
 * ── Installing the engines ──────────────────────────────────────────────────
 *
 * `npm ci` does not fetch them. Once, from `frontend/`:
 *
 *     npx playwright install firefox webkit
 *
 * chromium is already present (it is what the existing suites use). If a
 * project fails with "Executable doesn't exist", that command is the answer —
 * it is NOT a product failure, and nothing here silently skips to hide it.
 */
import { devices } from '@playwright/test';
import type { PlaywrightTestConfig, PlaywrightTestProject } from '@playwright/test';

export type Lane = 'desktop' | 'mobile' | 'tablet';

export interface MatrixBrowser {
  /** Project name. Appears in reports and in `--project=`. */
  name: string;
  lane: Lane;
  /** Key into Playwright's `devices` table. Verified present in 1.56.0. */
  device: string;
  /** The rendering engine, for reading a failure at a glance. */
  engine: 'chromium' | 'firefox' | 'webkit';
  /** What real thing this project stands in for. */
  stands_for: string;
}

export const MATRIX: MatrixBrowser[] = [
  { name: 'chromium',       lane: 'desktop', device: 'Desktop Chrome',            engine: 'chromium', stands_for: 'Chrome / Edge / Brave on a desktop' },
  { name: 'firefox',        lane: 'desktop', device: 'Desktop Firefox',           engine: 'firefox',  stands_for: 'Firefox on a desktop' },
  { name: 'webkit',         lane: 'desktop', device: 'Desktop Safari',            engine: 'webkit',   stands_for: 'Safari on macOS' },
  { name: 'android-chrome', lane: 'mobile',  device: 'Pixel 7',                   engine: 'chromium', stands_for: 'an Android phone, and the Capacitor WebView' },
  { name: 'ios-safari',     lane: 'mobile',  device: 'iPhone 14',                 engine: 'webkit',   stands_for: 'an iPhone — WebKit is the only engine iOS allows' },
  { name: 'ipad-safari',    lane: 'tablet',  device: 'iPad (gen 7) landscape',    engine: 'webkit',   stands_for: 'an iPad, landscape' },
  { name: 'android-tablet', lane: 'tablet',  device: 'Galaxy Tab S4 landscape',   engine: 'chromium', stands_for: 'an Android tablet — the Tab_A11_Plus AVD geometry' },
];

/** Not in the default matrix; resolvable by name. See the header. */
const EXTRA: MatrixBrowser[] = [
  { name: 'edge', lane: 'desktop', device: 'Desktop Edge', engine: 'chromium', stands_for: 'Edge on Windows (Chromium — same engine as `chromium`)' },
];

const ALL = [...MATRIX, ...EXTRA];

/**
 * Resolve `PW_BROWSERS` against the matrix, falling back to `fallback`.
 *
 * `fallback` is the config's own default, NOT a constant here: the stubbed
 * local suite can afford the whole matrix and the suites that write to the
 * shared database cannot, so the decision belongs to each config.
 */
export function selectedBrowsers(fallback: string): MatrixBrowser[] {
  const raw = (process.env.PW_BROWSERS || fallback).trim();

  if (raw === 'all') return MATRIX;

  const lanes: Lane[] = ['desktop', 'mobile', 'tablet'];
  if ((lanes as string[]).includes(raw)) return MATRIX.filter((b) => b.lane === raw);

  const wanted = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const out = wanted.map((name) => {
    const found = ALL.find((b) => b.name === name);
    if (!found) {
      // Loud, at config load, before a single test runs. A silent empty
      // selection is a green run over nothing.
      throw new Error(
        `PW_BROWSERS: unknown browser ${JSON.stringify(name)}. ` +
          `Known: ${ALL.map((b) => b.name).join(', ')}, or one of: all, desktop, mobile, tablet.`,
      );
    }
    return found;
  });

  if (out.length === 0) {
    throw new Error(`PW_BROWSERS resolved to no projects (raw: ${JSON.stringify(raw)}).`);
  }
  return out;
}

export interface BrowserProjectOptions {
  /** What to run when PW_BROWSERS is unset. Same grammar as PW_BROWSERS. */
  fallback: string;
  /** Which specs this project set runs. Omit to run the whole testDir. */
  testMatch?: RegExp;
  /**
   * Specs that are DESKTOP-ONLY, dropped from the mobile and tablet lanes.
   *
   * This exists for pixel-geometry specs. `design-geometry.spec.ts` asserts a
   * `.k-trow` at `min-height: 66px` with a 16px gutter — the desktop tier of
   * the `--row-h` contract. The stylesheets carry 19 `max-width: 767px` rules
   * plus `(hover: none)` and `(pointer: coarse)` branches, so a phone is
   * ENTITLED to a different layout there, and asserting the desktop number
   * against it would report a product failure for a design decision.
   */
  desktopOnly?: RegExp;
  /** Merged into every project's `use`, after the device descriptor. */
  use?: PlaywrightTestProject['use'];
  /**
   * Per-browser `use`, merged last. Exists for `channel`.
   *
   * `e2e-real/real.config.ts` sets `channel: 'chrome'` at the TOP LEVEL because
   * Vercel bot mitigation refuses the bundled headless shell's fingerprint —
   * the long version is in that file. `channel` is a Chromium-only option, so
   * a firefox or webkit project inheriting it cannot launch. This callback is
   * how such a config hands `chrome` to its chromium projects and nothing to
   * the others, instead of every config re-deriving the rule.
   */
  usePerBrowser?: (b: MatrixBrowser) => PlaywrightTestProject['use'];
  /** e.g. ['setup'] — applied to every project in the set. */
  dependencies?: string[];
  /** Prefix for project names, so several sets can coexist in one config. */
  prefix?: string;
}

/** Build the `projects` array for one config. */
export function browserProjects(opts: BrowserProjectOptions): PlaywrightTestProject[] {
  const { fallback, testMatch, desktopOnly, use, usePerBrowser, dependencies, prefix } = opts;

  return selectedBrowsers(fallback).map((b) => {
    const project: PlaywrightTestProject = {
      name: prefix ? `${prefix}-${b.name}` : b.name,
      use: { ...devices[b.device], ...(use || {}), ...(usePerBrowser ? usePerBrowser(b) : {}) },
    };
    if (testMatch) project.testMatch = testMatch;
    if (dependencies) project.dependencies = dependencies;
    if (desktopOnly && b.lane !== 'desktop') project.testIgnore = desktopOnly;
    return project;
  });
}

/**
 * Say out loud, at config load, what this run is about to cover. A matrix you
 * cannot see is a matrix you stop trusting, and "did that actually run in
 * WebKit?" is the first question anyone asks of a green cross-browser suite.
 *
 * ⚠ STDERR, NOT STDOUT, AND THAT IS NOT A STYLE CHOICE. A config runs before
 * the reporter does, so anything it writes to stdout lands INSIDE the report:
 * `--reporter=json` produced a file whose first line was this banner and whose
 * second was `{`, which no JSON parser accepts — measured, while trying to read
 * the very first full-matrix run. CI uses `reporter: 'github'` and the nightly
 * job keeps artefacts, so a machine-readable stream is not optional. stderr is
 * still shown to a human in the terminal and still captured in CI logs.
 */
export function announceSelection(fallback: string): void {
  // Every worker re-imports the config, so without this the banner printed once
  // per worker — five identical lines above a run, which is how a useful line
  // becomes noise people scroll past. Playwright sets TEST_WORKER_INDEX in
  // workers and not in the main process.
  if (process.env.TEST_WORKER_INDEX !== undefined) return;

  const sel = selectedBrowsers(fallback);
  const src = process.env.PW_BROWSERS ? 'PW_BROWSERS' : 'config default';
  process.stderr.write(
    `[matrix] ${sel.length} project(s) from ${src}=${process.env.PW_BROWSERS || fallback}: ` +
      sel.map((b) => `${b.name}(${b.engine})`).join(', ') +
      '\n',
  );
}

/** Kept so a config can widen a type without importing from two places. */
export type { PlaywrightTestConfig };
