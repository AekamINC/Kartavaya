#!/usr/bin/env node
/**
 * run-vitest-baselined.mjs — vitest with a frozen failure baseline.
 *
 * Same contract as check-contrast.mjs's contrast-baseline.json: the known
 * failures are recorded in scripts/vitest-baseline.json, a NEW failure fails
 * the run, and a baselined failure that now passes is printed so the baseline
 * can be shrunk. The file may only shrink; regenerate deliberately with
 * `--update-baseline`, never as a reflex.
 *
 * Usage:  node scripts/run-vitest-baselined.mjs              (from frontend/)
 *         node scripts/run-vitest-baselined.mjs --update-baseline
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const BASELINE_PATH = fileURLToPath(new URL('./vitest-baseline.json', import.meta.url));
const UPDATE = process.argv.includes('--update-baseline');

const tmp = mkdtempSync(join(tmpdir(), 'vitest-baseline-'));
const outFile = join(tmp, 'results.json');

// Default reporter for humans on the console; json reporter to a file for us.
// vitest's own exit code is ignored — pass/fail is decided against the
// baseline below.
const res = spawnSync(
  'npx',
  ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${outFile}`],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (res.error) {
  console.error('run-vitest-baselined: could not launch vitest —', res.error.message);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(outFile, 'utf8'));
} catch {
  console.error('run-vitest-baselined: no JSON report produced — vitest crashed before writing it.');
  process.exit(1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/** Key: posix-relative file path + full test name. No line numbers — the
 *  contrast baseline learned that lesson (see check-contrast.mjs keyOf). */
const keyOf = (file, fullName) =>
  `${relative(process.cwd(), file).split(sep).join('/')} :: ${fullName}`;

const failing = new Set();
for (const suite of report.testResults ?? []) {
  let anyAssertionFailed = false;
  for (const a of suite.assertionResults ?? []) {
    if (a.status === 'failed') {
      failing.add(keyOf(suite.name, a.fullName));
      anyAssertionFailed = true;
    }
  }
  // A file that failed to even load reports suite status 'failed' with no
  // failed assertions. That is a failure, keyed on the file alone.
  if (suite.status === 'failed' && !anyAssertionFailed) {
    failing.add(keyOf(suite.name, '<suite failed to run>'));
  }
}

// Zero tests collected is a broken run, not a green one.
if ((report.numTotalTests ?? 0) === 0) {
  console.error('run-vitest-baselined: vitest collected zero tests — refusing to pass.');
  process.exit(1);
}

if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify({
    note: 'Known-failing vitest tests, accepted deliberately. A NEW failure fails CI. Shrink this file; do not grow it.',
    generated: new Date().toISOString().slice(0, 10),
    failures: [...failing].sort(),
  }, null, 2) + '\n');
  console.log(`run-vitest-baselined: baseline written — ${failing.size} known failures`);
  process.exit(0);
}

let baseline = [];
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).failures ?? [];
} catch { /* absent — every failure is then new, which is correct */ }
const known = new Set(baseline);

const fresh = [...failing].filter((k) => !known.has(k)).sort();
const fixed = baseline.filter((k) => !failing.has(k)).sort();

if (fixed.length) {
  console.log(`\nrun-vitest-baselined: ${fixed.length} baselined failure(s) now PASS — shrink scripts/vitest-baseline.json:`);
  for (const k of fixed) console.log(`  FIXED  ${k}`);
}
const held = failing.size - fresh.length;
if (held) console.log(`run-vitest-baselined: ${held} known failure(s) held at baseline`);

if (fresh.length) {
  console.error(`\nrun-vitest-baselined: FAILED — ${fresh.length} failure(s) not in the baseline:`);
  for (const k of fresh) console.error(`  NEW    ${k}`);
  process.exit(1);
}
console.log('run-vitest-baselined: no new failures');
process.exit(0);
