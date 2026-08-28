#!/usr/bin/env node
/**
 * RATCHET — no e2e spec may CREATE data by any route except the product's UI.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Proposal 93, rule 1: "Every row is typed by a user. Playwright opens the page,
 * fills the form, picks from the real picker, uploads the real file and clicks
 * the real button. Nothing is inserted by SQL and nothing is posted straight to
 * an API — because a row created by SQL proves the table exists, and only a row
 * created by a click proves the product works."
 *
 * That rule is the whole point of the exercise and it is also the easiest one to
 * quietly break, because posting to the API is *so much faster* than driving a
 * form, and a suite that does it still goes green. A green suite over a bypassed
 * product is worth less than no suite at all: it reports coverage it does not
 * have.
 *
 * So the rule gets a check rather than a promise.
 *
 * ── What is banned, and what is not ─────────────────────────────────────────
 *
 * BANNED  — anything that writes without a click:
 *             page.request.post/put/patch/delete   (Playwright's API client)
 *             fetch(...)/axios with a write verb inside page.evaluate
 *             execute_sql / INSERT / UPDATE INTO from a spec
 *
 * ALLOWED — reading, and the login bootstrap:
 *             page.request.get / GET fetches  — verification, not creation
 *             SELECT                          — asserting the row appeared IS
 *                                               the required evidence
 *             storageState / auth minting     — the precondition for driving a
 *                                               UI at all, not a bypass of one
 *
 * Run:  node frontend/scripts/check-e2e-no-bypass.mjs
 * Exit: 1 on any violation, naming file and line.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOTS = ['e2e-real', 'e2e'];
const HERE = process.cwd();

/** Each rule is a decision: anything added here is a thing the ratchet will
 *  never catch again, so the list stays short and every entry is justified. */
const BANNED = [
  {
    re: /page\.request\.(post|put|patch|delete)\s*\(/i,
    why: 'writes through Playwright\'s API client instead of clicking the button',
  },
  {
    re: /(?:fetch|axios)\s*\([^)]*\)\s*[^;]*method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
    why: 'writes with a raw fetch/axios instead of driving the form',
  },
  {
    re: /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i,
    why: 'creates or mutates rows with SQL — a row created by SQL proves only that the table exists',
  },
  {
    re: /execute_sql|apply_migration/i,
    why: 'reaches the database directly from a spec',
  },
];

/** Files exempt, each with a reason. An exemption without a reason is a hole. */
const EXEMPT = new Map([
  ['e2e-real/mint-state.mjs', 'mints auth state from a token; the precondition for driving the UI, not a write to the product'],
  ['e2e-real/auth.setup.ts', 'logs in through the real form and persists storage state'],
]);

/**
 * KNOWN BASELINE — violations that existed when this ratchet landed, 2026-08-28.
 *
 * A ratchet that fails on day one gets disabled on day one, and a ratchet that
 * silently ignores what it found is a lie. So the existing breaches are listed
 * here BY LINE, with what is wrong and who fixes it. The check still fails on
 * anything NEW, which is the point: the count may go down, never up.
 *
 * All five are in `real-user.spec.ts` — the suite named for the rule it breaks.
 * They drive a payroll revert/reprocess/approve cycle through
 * `page.request.post/patch` instead of clicking, to restore a fixture the test
 * consumes. The author's comment argues it is better than reaching into the
 * database, which is true and is not the standard: rule 1 bans the API route as
 * well as the SQL one.
 *
 * ⚠ AND THE PATH IS ALSO DEAD. It authenticates with `E2E_ADMIN_PASSWORD`, which
 * is NOT in `.env.e2e` — the owner is a token-only Google account, as
 * `onefile.config.ts:4` and `mint-state.mjs` both record. So `ownerLogin.ok()`
 * cannot be true and the branch fails whenever it is reached.
 *
 * OWNER: proposal 93 Suite 08 (Vetana), wave 3 — it must drive revert, reprocess
 * and approve through the payroll screens, which also covers separated duty
 * properly instead of asserting it with two bearer tokens.
 */
const BASELINE = new Set([
  'e2e-real/real-user.spec.ts:325',
  'e2e-real/real-user.spec.ts:334',
  'e2e-real/real-user.spec.ts:340',
  'e2e-real/real-user.spec.ts:352',
  'e2e-real/real-user.spec.ts:357',
]);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

const violations = [];
const baselineHits = new Set();
let scanned = 0;

for (const root of ROOTS) {
  for (const file of walk(join(HERE, root))) {
    const rel = relative(HERE, file).replace(/\\/g, '/');
    if (EXEMPT.has(rel)) continue;
    scanned++;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      // A line that is only a comment is documentation, not behaviour.
      const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
      if (!code.trim()) return;
      for (const { re, why } of BANNED) {
        if (!re.test(code)) continue;
        const key = `${rel}:${i + 1}`;
        if (BASELINE.has(key)) { baselineHits.add(key); continue; }
        violations.push({ rel, line: i + 1, why, text: line.trim().slice(0, 110) });
      }
    });
  }
}

if (violations.length) {
  console.error('\n✗ e2e bypass check FAILED — proposal 93 rule 1\n');
  console.error('  "Nothing is inserted by SQL and nothing is posted straight to an API."\n');
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}`);
    console.error(`     ${v.why}`);
    console.error(`     ${v.text}\n`);
  }
  console.error(`  ${violations.length} violation(s) across ${scanned} spec file(s).`);
  console.error('  A row created by SQL proves the table exists. Only a click proves the product works.\n');
  process.exit(1);
}

console.log(`✓ e2e bypass check passed — ${scanned} spec file(s), no NEW SQL or direct-API writes`);
if (baselineHits.size) {
  console.log(`  ⚠ ${baselineHits.size} known baseline violation(s) still present, owned by proposal 93 Suite 08:`);
  for (const k of [...baselineHits].sort()) console.log(`      ${k}`);
  console.log('  This number may go DOWN, never up.');
}
// A baseline entry that no longer matches is a stale exemption — a hole that
// would silently re-admit a bypass on that line. Fail rather than rot.
const stale = [...BASELINE].filter((k) => !baselineHits.has(k));
if (stale.length) {
  console.error(`
✗ ${stale.length} BASELINE entr(ies) no longer match — remove them from BASELINE:`);
  for (const k of stale) console.error(`      ${k}`);
  process.exit(1);
}
