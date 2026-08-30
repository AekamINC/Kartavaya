#!/usr/bin/env node
/**
 * check-dependency-audit.mjs — the dependency audit, RATCHETED.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 *     - name: Dependency security audit
 *       run: yarn audit --groups dependencies || true
 *
 * `|| true`. The step has never been able to fail, and on the day this was
 * written it was hiding **17 advisories against shipped production
 * dependencies — 4 High, 12 Moderate, 1 Low**. Every one of them in `axios`
 * (10), `react-router` (6) and `form-data` (1, transitive under axios). Nobody
 * had been told, because a green tick over `|| true` is indistinguishable from
 * a green tick over a clean audit.
 *
 * That is the same failure mode as the contrast gate and `check-touch-targets`:
 * a check present, running, and structurally incapable of reporting anything.
 *
 * ── Why a ratchet and not simply "fail on any advisory" ─────────────────────
 *
 * Because clearing the 17 means bumping `axios ^1.15.0` (installed 1.16.0) to
 * >=1.18.0 and `react-router ^7.6.0` (installed 7.15.0) to >=7.18.2, and that
 * regenerates `yarn.lock`. This repo has a standing rule that a lockfile
 * regenerated on Windows breaks the Vercel and Railway builds — yarn rewrites
 * esbuild `linux-x64` to `win32-x64` — which is recorded at the top of
 * `scripts/visual-baseline.mjs` and is why `@axe-core/playwright` was not added
 * either. A react-router minor bump also needs a run of the suites behind it.
 *
 * So the upgrade is an owner action with a deploy risk attached, and it is NOT
 * a thing to do inside a testing pass. What IS available today is stopping the
 * number from growing: the 17 known advisory ids are recorded by name, and the
 * EIGHTEENTH fails the build. The list may shrink — and it should, in one
 * deliberate upgrade from a Linux checkout — and it may never grow.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *     node scripts/check-dependency-audit.mjs            # from frontend/
 *     node scripts/check-dependency-audit.mjs --write    # re-record
 *
 * `--groups dependencies` is deliberate and inherited from the step this
 * replaces: a devDependency advisory cannot reach a user, and treating it as
 * one is how a gate earns a reputation for crying wolf.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASELINE_URL = new URL('dependency-audit-baseline.json', import.meta.url);
const WRITE = process.argv.includes('--write');

if (!existsSync(new URL('../package.json', import.meta.url))) {
  console.error('check-dependency-audit: run from the frontend/ directory.');
  process.exit(1);
}

// `yarn audit --json` streams one JSON object per line and exits NON-ZERO when
// it finds anything — which is the whole reason the CI step had `|| true`
// bolted on. The exit code is therefore ignored here on purpose; what matters
// is the advisory list, and an empty list from a failed run is caught below.
//
// One command STRING rather than (command, args[]) with `shell: true`. Node
// emits DEP0190 for the latter — args under a shell are concatenated, not
// escaped — and warning noise on a security gate is the last place it belongs.
// Every token here is a literal in this file; nothing is interpolated.
const run = spawnSync('yarn audit --groups dependencies --json', {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  shell: true,
});

if (run.error) {
  console.error(`check-dependency-audit: could not run yarn audit — ${run.error.message}`);
  process.exit(1);
}

const advisories = new Map(); // id -> {severity, module, title, patched}
let sawSummary = false;

for (const line of (run.stdout || '').split('\n')) {
  const t = line.trim();
  if (!t) continue;
  let d;
  try { d = JSON.parse(t); } catch { continue; }
  if (d.type === 'auditSummary') sawSummary = true;
  if (d.type !== 'auditAdvisory') continue;
  const a = d.data.advisory;
  advisories.set(String(a.id), {
    severity: a.severity,
    module: a.module_name,
    title: (a.title || '').slice(0, 70),
    patched: a.patched_versions || '',
  });
}

// ANTI-VACUITY. `yarn audit` failing to run, or its output format changing,
// yields zero advisories — which is indistinguishable from a clean tree unless
// the summary record is there to prove the audit actually completed. A gate
// that silently passes when its tool breaks is the thing this file exists to
// stop being.
if (!sawSummary) {
  console.error('check-dependency-audit: yarn audit produced no summary record.');
  console.error('The audit did not complete, so the result is UNKNOWN — which is not a pass.');
  console.error(`stderr: ${(run.stderr || '').slice(0, 400)}`);
  process.exit(1);
}

const RANK = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
const sorted = [...advisories.entries()].sort(
  (a, b) => (RANK[a[1].severity] ?? 9) - (RANK[b[1].severity] ?? 9) || a[1].module.localeCompare(b[1].module),
);

const counts = {};
for (const [, a] of sorted) counts[a.severity] = (counts[a.severity] || 0) + 1;
const summary = Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ') || 'none';

console.log(`check-dependency-audit: ${advisories.size} advisory(ies) against production dependencies — ${summary}\n`);

if (WRITE) {
  writeFileSync(
    BASELINE_URL,
    `${JSON.stringify(
      {
        _comment:
          'Known advisories against production dependencies. SHRINK ONLY — see ' +
          'scripts/check-dependency-audit.mjs. Clearing these is an UPGRADE (axios >=1.18.0, ' +
          'react-router >=7.18.2) and must be done from a Linux checkout: a yarn.lock ' +
          'regenerated on Windows rewrites esbuild linux-x64 to win32-x64 and breaks the deploy.',
        _recorded: new Date().toISOString().slice(0, 10),
        _summary: summary,
        known: Object.fromEntries(sorted.map(([id, a]) => [id, `${a.severity} · ${a.module} · patched ${a.patched} · ${a.title}`])),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`recorded ${advisories.size} known advisory(ies) to scripts/dependency-audit-baseline.json`);
  process.exit(0);
}

if (!existsSync(BASELINE_URL)) {
  console.error('check-dependency-audit: no baseline file. Create it with --write.');
  process.exit(1);
}

const known = JSON.parse(readFileSync(BASELINE_URL, 'utf8')).known;
const fresh = sorted.filter(([id]) => !(id in known));
const fixed = Object.keys(known).filter((id) => !advisories.has(id));

if (fixed.length) {
  console.log(`✓ ${fixed.length} baselined advisory(ies) are gone. Shrink the baseline (--write):`);
  for (const id of fixed) console.log(`    ${id}  ${known[id]}`);
  console.log('');
}

if (fresh.length) {
  console.error(`✘ ${fresh.length} NEW advisory(ies) against production dependencies:\n`);
  for (const [id, a] of fresh) {
    console.error(`    ${a.severity.toUpperCase().padEnd(8)} ${a.module.padEnd(20)} patched ${a.patched}`);
    console.error(`             ${a.title}`);
    console.error(`             https://www.npmjs.com/advisories/${id}`);
  }
  console.error('\n  Upgrade the package, or — if it cannot be upgraded today — say so in');
  console.error('  docs/STATUS.md and add it here WITH that entry. Do not add it silently.');
  process.exit(1);
}

console.log(`✓ no new advisories; ${Object.keys(known).length} held at baseline.`);
console.log('  They are listed in scripts/dependency-audit-baseline.json, each with the');
console.log('  version that patches it. Shrinking that file is the direction of travel.');
