/**
 * check-ci-runs-every-gate — every gate in `npm run check` also runs in CI.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `.github/workflows/ci.yml` does not run `npm run check`. It names each gate
 * as its own step, deliberately, so a red build says WHICH gate failed rather
 * than "check exited 1" — and the comment in that file says so.
 *
 * The cost of that choice is a hand-maintained list, and on 2026-08-27 three of
 * the eleven gates had fallen off it:
 *
 *     check-csp-hash            in `npm run check`, NOT in CI
 *     check-class-collisions    in `npm run check`, NOT in CI
 *     check-one-index-html      in `npm run check`, NOT in CI
 *
 * The first is the expensive one. It exists because the sha256 in `vercel.json`
 * drifted from the inline bootstrap in `index.html`, so the browser silently
 * refused to run the script — every load, for every user, with a green build
 * and nothing in the logs — and the theme flashed on staging for days before
 * anybody read the deployed console. The gate written to catch that had never
 * run in CI. A rule that is written and not armed is the exact failure Phase 6
 * exists to close, and it had reproduced inside Phase 6's own toolchain.
 *
 * So: CI keeps its one-step-per-gate shape, and this check makes the list
 * impossible to drift. Add a gate to `npm run check` without adding a CI step
 * and the gate suite fails, naming it.
 *
 * ── What it does NOT assert ─────────────────────────────────────────────────
 *
 * Not the reverse direction. CI legitimately runs things `npm run check` does
 * not — the production build, the type check, pytest — and demanding symmetry
 * would either bloat the local gate or invite exemptions.
 *
 * Not the ORDER, and not that the steps are in the same job. Either is fine as
 * long as the gate runs somewhere in the workflow on every push.
 *
 * Run: node scripts/check-ci-runs-every-gate.mjs   (wired into `npm run check`)
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..');
const CI = join(repo, '.github', 'workflows', 'ci.yml');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const check = pkg.scripts?.check;
if (!check) {
  console.error('check-ci-runs-every-gate: package.json has no `check` script — ' +
                'the gate suite has been renamed and this check is reading nothing.');
  process.exit(1);
}

/** Every `scripts/<name>.mjs` the gate suite runs, in order, de-duplicated. */
const gates = [...new Set([...check.matchAll(/scripts\/([\w-]+)\.mjs/g)].map(m => m[1]))];
if (gates.length < 5) {
  console.error(`check-ci-runs-every-gate: only ${gates.length} gate(s) parsed out of ` +
                '`npm run check` — the script format has changed and this check is blind.');
  process.exit(1);
}

let ci;
try {
  ci = readFileSync(CI, 'utf8');
} catch {
  console.error(`check-ci-runs-every-gate: cannot read ${CI}. If the workflow moved, ` +
                'point this check at the new path rather than deleting it.');
  process.exit(1);
}

const missing = gates.filter(g => !ci.includes(`scripts/${g}.mjs`));
if (missing.length) {
  console.error(
    'check-ci-runs-every-gate: these gates run locally and NOT in CI:\n' +
    missing.map(g => `  scripts/${g}.mjs`).join('\n') +
    '\n\nCI names each gate as its own step so a red build says which one failed.\n' +
    'That list is hand-maintained, which is how check-csp-hash fell off it and\n' +
    'left the CSP-hash drift uncaught while the bootstrap was dead on staging.\n' +
    'Add a step to .github/workflows/ci.yml for each gate above.',
  );
  process.exit(1);
}

console.log(`check-ci-runs-every-gate: all ${gates.length} gate(s) in \`npm run check\` also run in CI.`);
