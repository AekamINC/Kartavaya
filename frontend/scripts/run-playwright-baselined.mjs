#!/usr/bin/env node
/**
 * run-playwright-baselined.mjs — the cross-browser matrix, with a baseline.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `frontend/playwright.config.ts` runs four specs across seven browser and
 * device projects. The first time it was ever run outside Chromium (2026-08-30)
 * it came back 150 pass / 77 fail, and the 77 break down into three completely
 * different things that must not be treated the same way:
 *
 *   3   already failing in Chromium before any of this existed — proved by
 *       running `PW_BROWSERS=chromium`, which reproduces the old single-project
 *       behaviour exactly. This suite runs in no CI job today, so nobody was
 *       looking at them.
 *   41  REAL cross-browser and cross-platform defects. Eight distinct tests
 *       that pass on Desktop Chrome and fail on Safari or at phone width.
 *   33  Firefox, every one of them `browserType.launch: spawn UNKNOWN` — this
 *       Windows machine cannot start the Firefox binary at all. The same fault
 *       is recorded in e2e-real/real.config.ts for `channel: 'chromium'`. It is
 *       an environment limit, not a product fact, and it does not occur on the
 *       ubuntu runner.
 *
 * A suite that is red on the day it lands gets ignored by the second week, and
 * this repository has the scar tissue to prove it — the contrast gate existed
 * and ran nowhere while five failing pairs were signed off by two audits. So
 * this takes the same shape as `run-vitest-baselined.mjs` and
 * `contrast-baseline.json`: what was broken when the gate landed is recorded BY
 * NAME, a NEW failure fails the build, and a FIXED one is printed so the
 * baseline can shrink.
 *
 * **The baseline may shrink. It may never grow.** Adding a line to make a red
 * build green is the one thing this file exists to prevent.
 *
 * ── A browser that cannot launch is NOT a baselined failure ─────────────────
 *
 * It is missing coverage, which is worse: the matrix reported on a project it
 * never ran. Launch failures are counted separately and fail the run by
 * default. `--allow-unlaunchable` downgrades them to a loud warning, for the
 * Windows desk where Firefox will not start. CI must never pass that flag —
 * enforcing that all seven engines actually launch is most of the point of
 * running this on ubuntu.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *     node scripts/run-playwright-baselined.mjs                  # from frontend/
 *     node scripts/run-playwright-baselined.mjs --allow-unlaunchable
 *     node scripts/run-playwright-baselined.mjs --write          # re-record
 *
 * Any other arguments are passed through to `playwright test`, so
 * `--project=webkit` and friends work.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, 'playwright-baseline.json');

if (!existsSync(join(HERE, '..', 'package.json'))) {
  console.error('run-playwright-baselined: run from the frontend/ directory.');
  process.exit(1);
}

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const ALLOW_UNLAUNCHABLE = argv.includes('--allow-unlaunchable');
const passthrough = argv.filter((a) => a !== '--write' && a !== '--allow-unlaunchable');

// A key a human can read in a diff, and that survives a test moving line.
const keyOf = (project, file, title) => `${project} :: ${file} :: ${title}`;

/** Playwright's own launch faults, which are about the machine, not the code. */
const isLaunchFailure = (msg) =>
  /browserType\.launch|Executable doesn't exist|spawn UNKNOWN|Host system is missing dependencies/i.test(msg);

// ── Run ──────────────────────────────────────────────────────────────────────
// JSON to a file, not stdout: the config prints its matrix banner and vite
// prints its own startup, and a reporter sharing a stream with either is a
// reporter that cannot be parsed. (The banner goes to stderr for this reason;
// the file keeps it true regardless of what else decides to talk.)
//
// ⚠ NOT `npx`. Since the fix for CVE-2024-27980, Node refuses to spawn a `.cmd`
// or `.bat` without `shell: true` — `spawnSync('npx.cmd', ...)` returns status
// `null` with no output, which this script correctly but unhelpfully reports as
// "playwright produced no report". `shell: true` is not the answer either: it
// puts every argument through cmd.exe quoting. Running the CLI's own entry
// point with the node we are already inside skips both problems and works
// identically on ubuntu.
const CLI = join(HERE, '..', 'node_modules', '@playwright', 'test', 'cli.js');
if (!existsSync(CLI)) {
  console.error(`run-playwright-baselined: no Playwright CLI at ${CLI}. Run \`yarn install\` first.`);
  process.exit(1);
}
const out = join(mkdtempSync(join(tmpdir(), 'kartavya-pw-')), 'report.json');
const run = spawnSync(
  process.execPath,
  [CLI, 'test', '--config', 'playwright.config.ts', '--reporter=json', ...passthrough],
  { encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: out }, stdio: ['ignore', 'ignore', 'inherit'] },
);

if (!existsSync(out)) {
  console.error('\nrun-playwright-baselined: playwright produced no report.');
  console.error(`Its exit code was ${run.status}. That is a harness failure, not a test result —`);
  console.error('the run is UNKNOWN, and an unknown result must never be read as a pass.');
  process.exit(1);
}

const report = JSON.parse(readFileSync(out, 'utf8'));

// ── Collect ──────────────────────────────────────────────────────────────────
const failed = new Set();
const unlaunchable = new Map(); // project -> count
let counted = 0;

const walk = (suite, file) => {
  const f = suite.file || file;
  for (const s of suite.suites || []) walk(s, f);
  for (const spec of suite.specs || []) {
    for (const t of spec.tests || []) {
      counted += 1;
      const status = t.status || t.results?.at(-1)?.status;
      if (status === 'expected' || status === 'skipped') continue;
      const project = t.projectName || '?';
      const msg = t.results?.at(-1)?.error?.message || '';
      if (isLaunchFailure(msg)) {
        unlaunchable.set(project, (unlaunchable.get(project) || 0) + 1);
        continue;
      }
      failed.add(keyOf(project, spec.file || f, spec.title));
    }
  }
};
for (const s of report.suites || []) walk(s, undefined);

// A report with no tests in it is not a pass. This is the anti-vacuity floor:
// a config typo that selects zero specs would otherwise be indistinguishable
// from a clean run.
if (counted === 0) {
  console.error('\nrun-playwright-baselined: the report contains ZERO tests.');
  console.error('That is a configuration fault (a bad --project or testMatch), not a green run.');
  process.exit(1);
}

// ── Write mode ───────────────────────────────────────────────────────────────
if (WRITE) {
  const sorted = [...failed].sort();
  writeFileSync(
    BASELINE,
    `${JSON.stringify(
      {
        _comment:
          'Known-failing tests in the cross-browser matrix. SHRINK ONLY — see ' +
          'scripts/run-playwright-baselined.mjs. Launch failures are NOT recorded here; ' +
          'a browser that cannot start is missing coverage, not a known failure.',
        _recorded: new Date().toISOString().slice(0, 10),
        failures: sorted,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`run-playwright-baselined: recorded ${sorted.length} known failure(s) to ${BASELINE}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`run-playwright-baselined: no baseline at ${BASELINE}. Create it with --write.`);
  process.exit(1);
}
const baseline = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).failures);

// ── Compare ──────────────────────────────────────────────────────────────────
const fresh = [...failed].filter((k) => !baseline.has(k)).sort();
const fixed = [...baseline].filter((k) => !failed.has(k)).sort();

console.log(`\nrun-playwright-baselined: ${counted} test(s) across the matrix.`);

if (fixed.length) {
  console.log(`\n✓ ${fixed.length} baselined failure(s) now PASS. Remove them from the baseline:`);
  for (const k of fixed) console.log(`    ${k}`);
}

if (unlaunchable.size) {
  const lines = [...unlaunchable].map(([p, n]) => `${p} (${n} test(s))`).join(', ');
  const banner = `${unlaunchable.size} browser(s) could not LAUNCH: ${lines}`;
  if (ALLOW_UNLAUNCHABLE) {
    console.log(`\n⚠ ${banner}`);
    console.log('  Tolerated by --allow-unlaunchable. THE MATRIX DID NOT COVER THOSE ENGINES —');
    console.log('  this run proves nothing about them. CI must not pass this flag.');
  } else {
    console.error(`\n✘ ${banner}`);
    console.error('  A browser that will not start is MISSING COVERAGE, not a known failure.');
    console.error('  On ubuntu: `npx playwright install --with-deps chromium firefox webkit`.');
    console.error('  On the Windows desk where Firefox will not spawn: --allow-unlaunchable.');
  }
}

if (fresh.length) {
  console.error(`\n✘ ${fresh.length} NEW failure(s), not in the baseline:`);
  for (const k of fresh) console.error(`    ${k}`);
  console.error('\n  Fix them, or prove they are not regressions. Do NOT add them to the');
  console.error('  baseline to go green — the baseline may shrink, never grow.');
}

// Always say the number, even on a run that failed for another reason. A
// baseline nobody sees is a baseline that stops being a to-do list — same
// argument as the contrast gate printing its held pairs on every run.
if (!fresh.length) {
  console.log(`\n✓ no new failures; ${baseline.size} known failure(s) held at baseline.`);
  console.log('  They are listed in scripts/playwright-baseline.json. Shrink it.');
}

process.exit(fresh.length || (unlaunchable.size && !ALLOW_UNLAUNCHABLE) ? 1 : 0);
