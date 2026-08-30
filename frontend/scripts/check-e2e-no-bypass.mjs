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

/**
 * ── CLOCK ENDPOINTS — a NARROW, NAMED exemption, and why it is not a hole ────
 *
 * Ruled 2026-08-29 by the lead, on proposal 93 Suite 16 (Niyam).
 *
 * This ratchet's own sentence is the test: *"A row created by SQL proves the
 * table exists. Only a click proves the product works."* Rule 1 exists to stop
 * a suite AUTHORING DATA without driving the product. A scheduler tick authors
 * nothing — it advances the clock, and **time is not a row**.
 *
 * Suite 16 is the case that forced the question, and it is worth stating rather
 * than leaving to be re-derived. It creates every automation rule by typing in
 * the builder, arms each one through the real toggle, and causes each
 * triggering event by driving the module that owns it — a task created in Core
 * PM, a deal moved in Graha, a receipt recorded in Ganit. The rows §4 asks it
 * to produce (`niyam_runs`, `niyam_run_steps`) are then written BY THE ENGINE in
 * response to those clicks. What the suite cannot do is wait fifteen minutes:
 * **`cron-niyam` is disarmed at `0 0 1 1 *` under proposal 93's own R1 freeze**,
 * nothing in the product's UI drains the event outbox, and without a tick the
 * runs are not merely unproven — they are unobservable.
 *
 * The alternative was worse and was refused: arming a production cron so that a
 * test can pass is not something this programme does.
 *
 * ⚠ AND IT IS DELIBERATELY *NOT* IN `BASELINE`. That list is five entries and
 * its own comment says the number "may go DOWN, never up"; growing it to slip
 * past a check is the "test edited green" failure the whole programme exists to
 * prevent. A baseline that grows is a rule getting SOFTER. An exemption that
 * names one endpoint and says why is a rule getting SHARPER — the same shape
 * `backend/tests/test_a_get_does_not_write.py` already uses for its two
 * deliberate carve-outs.
 *
 * ── THE FOUR CONDITIONS, EACH ENFORCED BELOW RATHER THAN PROMISED ───────────
 *
 * 1. **Named literally.** `/api/internal/niyam/sweep`, in full. A PREFIX IS NOT
 *    A STACK — this repo's standing rule about `DROP` applies just as well to
 *    an allowlist. `/api/internal/` as a prefix would admit the nineteen
 *    `/api/internal/cron/*` endpoints, several of which SEND EMAIL, and one of
 *    which would fire a dunning ladder at real customers.
 * 2. **Write-free by construction, and checked.** The call must carry NO
 *    request body. `routers/niyam.py`'s `sweep` takes none — only an
 *    `X-Cron-Secret` header — so a POST with a `data:` payload is not this
 *    endpoint being ticked, it is something being authored, and it stays a
 *    violation.
 * 3. **The URL must be a LITERAL.** A path assembled from a variable could be
 *    anything at run time, so only `${API}/api/internal/niyam/sweep` and its
 *    bare-string equivalent match. `${...}` is permitted ONLY as the origin.
 * 4. **Every exemption must be USED.** An entry that matches nothing is a stale
 *    hole, and it fails the same way a stale BASELINE entry does.
 *
 * All six mutations were proved to bite on 2026-08-29 and the files restored
 * byte-identical: a data-creating endpoint, a sibling under the same prefix, a
 * body on the tick, a variable path, a stale entry, and the entry removed.
 */
const CLOCK_ENDPOINTS = new Map([
  ['/api/internal/niyam/sweep',
   'Niyam engine tick. `routers/niyam.py` accepts no body and dispatches to ' +
   '`services/niyam/sweep.tick`, which drains the event outbox and resumes ' +
   'elapsed waits. It authors no domain row of its own: every row it causes is ' +
   'written by a rule the suite TYPED, against an event the suite caused by ' +
   'driving that event\'s own module. `cron-niyam` is disarmed at "0 0 1 1 *" ' +
   'under proposal 93 R1, so nothing else will ever call it. Suite 16.'],
]);

/**
 * ── READ-ONLY QUERY ENDPOINTS — the second NARROW, NAMED exemption ──────────
 *
 * Ruled 2026-08-29 by the lead, on proposal 93 Suite 12 (Dristi).
 *
 * `CLOCK_ENDPOINTS` above admits a POST that carries NO BODY. This admits a
 * different and equally narrow shape: **a POST whose body IS the question**.
 * Some reads cannot be a GET because their request is structured — a source, a
 * row dimension, a column dimension, a measure and two dates — and the endpoint
 * chose a body rather than six query parameters. That choice is about HTTP
 * ergonomics; it is not the suite bypassing a form.
 *
 * The rule's own sentence is the test, exactly as it was for the clock: *"A row
 * created by SQL proves the table exists. Only a click proves the product
 * works."* Rule 1 exists to stop a suite AUTHORING DATA without driving the
 * product. **An aggregate query authors nothing, and that was MEASURED, not
 * read off the source:**
 *
 *   · `routers/dristi.py::run_pivot_query`, lines 1682-1848, contains
 *     `pool.fetch` and `pool.fetchrow` and nothing else — no `INSERT`, no
 *     `UPDATE`, no `DELETE FROM`, no `pool.execute`, no audit or log call.
 *   · `pg_stat_user_tables.n_tup_ins` — Postgres's own cumulative INSERT
 *     counter — was snapshotted across all **174** tables in `staging` and
 *     `public` that have ever taken a row; **40** successful
 *     `POST /api/v1/dristi/query` calls were fired across four sources; the
 *     counter was re-read. **Zero of 174 tables moved.** `audit_log`,
 *     `activity_events`, `niyam_events`, `outbound_log`, `dristi_report_logs`,
 *     `analytics_views`, `dristi_dashboards` and `analytics_metrics_daily` were
 *     separately counted before and after and were identical.
 *
 * ⚠ And the thing that would make this exemption dangerous is expressly not
 * true: 93 §4 counts "report types run 18" and "report runs incl. window
 * changes 40" as VOLUMES, and if a run were a ROW then creating those rows over
 * `page.request.post` would be precisely the bypass this ratchet exists to
 * stop. It is not a row. Nothing is written when a report runs — which is why
 * the measurement above is the load-bearing part of this comment and the
 * source-reading is only corroboration.
 *
 * ⚠ NOT IN `BASELINE`, for the same reason `CLOCK_ENDPOINTS` is not: that list
 * is five and its own comment says the number "may go DOWN, never up". A
 * baseline that grows is a rule getting SOFTER; an exemption that names one
 * endpoint, states its evidence and enforces four conditions is a rule getting
 * SHARPER.
 *
 * ── THE FOUR CONDITIONS, ENFORCED BELOW RATHER THAN PROMISED ───────────────
 *
 * 1. **Named literally.** `/api/v1/dristi/query`, in full. A PREFIX IS NOT A
 *    STACK — this repo's standing rule about `DROP` applies just as well to an
 *    allowlist. `/api/v1/dristi/` as a prefix would admit
 *    `POST /v1/dristi/dashboards`, `POST /v1/dristi/scheduled-reports` and
 *    `POST /scheduled-reports/{id}/run-now` — two of which author rows and the
 *    third of which SENDS EMAIL.
 * 2. **The URL must be a LITERAL.** A path assembled from a variable could be
 *    anything at run time, so only `${API}/api/v1/dristi/query` and its
 *    bare-string equivalent match. `${...}` is permitted ONLY as the origin.
 * 3. **EVERY KEY OF THE BODY MUST BE A DECLARED QUERY KEY.** This is the
 *    condition that does the work, and it is why the exemption is not simply
 *    "this path may be posted to". The body must be an object LITERAL at the
 *    call site and each of its top-level keys must appear in `keys` below. A
 *    spread, a variable, or one unrecognised field and the line is a violation
 *    like any other — so a helper taking `Record<string, any>` and passing it
 *    through cannot launder an authoring field past this check.
 * 4. **Every exemption must be USED.** An entry that matches nothing is a stale
 *    hole, and it fails the same way a stale BASELINE entry does.
 *
 * Five mutations were proved to bite on 2026-08-29 and both files restored
 * byte-identical (sha256 re-checked): a sibling under the same prefix
 * (`/v1/dristi/dashboards`), a row-authoring endpoint on another module
 * (`/v1/graha/deals`), an extra body key, a body passed as a variable, and the
 * entry renamed out of the allowlist.
 */
const READ_ONLY_QUERY_ENDPOINTS = new Map([
  ['/api/v1/dristi/query', {
    keys: new Set(['source', 'group_by', 'group_by2', 'measure', 'date_from', 'date_to']),
    why:
      'Dristi pivot engine. `routers/dristi.py::run_pivot_query` (1682-1848) only ' +
      'SELECTs and GROUPs: no INSERT, UPDATE, DELETE, pool.execute or audit call ' +
      'anywhere in the handler. Measured 2026-08-29: 40 calls moved n_tup_ins on ' +
      'ZERO of 174 tables in staging+public. A report RUN is not a row. Suite 12.',
  }],
]);

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

/**
 * Is this `page.request.post(...)` a bare tick of a NAMED clock endpoint?
 *
 * Reads the WHOLE call, not the matched line — the call spans lines and a body
 * would otherwise be invisible to the check. Returns the endpoint, or null, in
 * which case the line is a violation like any other.
 */
function clockTick(lines, i) {
  // The statement, from the match to its closing `);`, capped so an unbalanced
  // file cannot make this walk to the end.
  let stmt = '';
  for (let j = i; j < Math.min(i + 12, lines.length); j++) {
    stmt += lines[j];
    if (/\)\s*;?\s*$/.test(lines[j].trim())) break;
    stmt += ' ';
  }

  for (const [endpoint] of CLOCK_ENDPOINTS) {
    // CONDITIONS 1 + 3: the endpoint appears LITERALLY, and the only
    // interpolation allowed before it is the origin. `${API}/api/internal/...`
    // and `'https://host/api/internal/...'` match; a path carrying a variable
    // segment does not.
    const literal = new RegExp(
      'post\\s*\\(\\s*[`\'"](?:\\$\\{[A-Za-z_$][\\w$]*\\})?[^`\'"$]*' +
      endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '[`\'"]');
    if (!literal.test(stmt)) continue;

    // CONDITION 2: no request body. `sweep` takes none, so a `data:` payload is
    // something being AUTHORED and is not this endpoint being ticked.
    if (/\bdata\s*:/.test(stmt)) return null;
    if (/\b(?:multipart|form)\s*:/.test(stmt)) return null;

    return endpoint;
  }
  return null;
}

/**
 * Is this `page.request.post(...)` a bare READ of a NAMED query endpoint?
 *
 * Same statement reconstruction as `clockTick`, and the same literal-path rule
 * — but where the clock demands NO body, this one demands a body made ONLY of
 * declared query keys. That inversion is deliberate: a query endpoint's body is
 * its question, so banning bodies would ban the endpoint, and admitting any
 * body would admit anything. Reading the keys is what keeps the exemption to
 * the exact shape it was granted for.
 *
 * Returns the endpoint, or null, in which case the line is a violation like any
 * other. Fails CLOSED at every ambiguity: no `data:` at all, a `data:` that is
 * a variable rather than an object literal, a spread, or one unrecognised key.
 */
function readOnlyQuery(lines, i) {
  let stmt = '';
  for (let j = i; j < Math.min(i + 25, lines.length); j++) {
    stmt += lines[j];
    if (/^\s*\}?\s*\)\s*;?\s*$/.test(lines[j])) break;
    stmt += ' ';
  }

  for (const [endpoint, spec] of READ_ONLY_QUERY_ENDPOINTS) {
    // CONDITIONS 1 + 2: the endpoint appears LITERALLY, and the only
    // interpolation allowed before it is the origin.
    const literal = new RegExp(
      'post\\s*\\(\\s*[`\'"](?:\\$\\{[A-Za-z_$][\\w$]*\\})?[^`\'"$]*' +
      endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '[`\'"]');
    if (!literal.test(stmt)) continue;

    // CONDITION 3: the body must be an object LITERAL whose every top-level key
    // is declared. `data: body` — a variable — is NOT verifiable and is refused,
    // which is the whole reason the call site spells its fields out.
    const at = stmt.indexOf('data:') >= 0 ? stmt.indexOf('data:') : stmt.indexOf('data :');
    if (at < 0) return null;                       // no body at all — not this shape
    const rest = stmt.slice(at).replace(/^data\s*:\s*/, '');
    if (!rest.startsWith('{')) return null;        // a variable, a spread, a call
    // Walk to the matching brace so a nested object cannot hide a key outside it.
    let depth = 0;
    let end = -1;
    for (let k = 0; k < rest.length; k++) {
      if (rest[k] === '{') depth++;
      else if (rest[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    if (end < 0) return null;                      // unbalanced — refuse
    const obj = rest.slice(1, end);
    if (/\.\.\./.test(obj)) return null;           // a spread hides its keys
    // Top-level keys only: strip nested braces before harvesting.
    let flat = obj;
    for (let pass = 0; pass < 6; pass++) flat = flat.replace(/\{[^{}]*\}/g, '');
    const found = [...flat.matchAll(/(?:^|,)\s*['"]?([A-Za-z_$][\w$]*)['"]?\s*:/g)]
      .map((m) => m[1]);
    if (!found.length) return null;
    if (found.some((k) => !spec.keys.has(k))) return null;

    return endpoint;
  }
  return null;
}

const violations = [];
const baselineHits = new Set();
const clockHits = new Map();
const queryHits = new Map();
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
        // A NAMED clock endpoint, ticked with no body, is not a bypass — see
        // CLOCK_ENDPOINTS. Everything else on this line is still judged.
        const tick = /page\.request\.post/.test(code) ? clockTick(lines, i) : null;
        if (tick) {
          clockHits.set(tick, (clockHits.get(tick) || 0) + 1);
          continue;
        }
        // A NAMED read-only query endpoint, posted with a body made only of
        // declared query keys, is not a bypass — see READ_ONLY_QUERY_ENDPOINTS.
        const q = /page\.request\.post/.test(code) ? readOnlyQuery(lines, i) : null;
        if (q) {
          queryHits.set(q, (queryHits.get(q) || 0) + 1);
          continue;
        }
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
if (clockHits.size) {
  console.log(`  ⚠ ${[...clockHits.values()].reduce((a, b) => a + b, 0)} clock tick(s) ` +
    'allowed, BY NAME, on endpoints that author no domain row:');
  for (const [ep, n] of clockHits) console.log(`      ${ep}  ×${n}`);
  console.log('  A tick advances the scheduler; it does not create data. See CLOCK_ENDPOINTS.');
}
if (queryHits.size) {
  console.log(`  ⚠ ${[...queryHits.values()].reduce((a, b) => a + b, 0)} read-only ` +
    'quer(ies) allowed, BY NAME, on endpoints that author no row:');
  for (const [ep, n] of queryHits) console.log(`      ${ep}  ×${n}`);
  console.log('  Measured, not assumed: 40 calls moved n_tup_ins on 0 of 174 tables.');
  console.log('  See READ_ONLY_QUERY_ENDPOINTS — the body\'s keys are checked, not just the path.');
}
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

// CONDITION 4 — an exemption nothing uses is a hole standing open for the next
// author to walk through. Same polarity, and the same reasoning, as the stale
// BASELINE check above.
const unusedClock = [...CLOCK_ENDPOINTS.keys()].filter((k) => !clockHits.has(k));
if (unusedClock.length) {
  console.error(`
✗ ${unusedClock.length} CLOCK_ENDPOINTS entr(ies) are no longer used by any spec.`);
  console.error('  An allowlist entry nothing matches is a hole kept open for no reason —');
  console.error('  delete it, or the next author inherits permission nobody asked for:');
  for (const k of unusedClock) console.error(`      ${k}`);
  process.exit(1);
}

// CONDITION 4, again — same polarity, same reasoning, for the query allowlist.
const unusedQuery = [...READ_ONLY_QUERY_ENDPOINTS.keys()].filter((k) => !queryHits.has(k));
if (unusedQuery.length) {
  console.error(`
✗ ${unusedQuery.length} READ_ONLY_QUERY_ENDPOINTS entr(ies) are no longer used by any spec.`);
  console.error('  An allowlist entry nothing matches is a hole kept open for no reason —');
  console.error('  delete it, or the next author inherits permission nobody asked for:');
  for (const k of unusedQuery) console.error(`      ${k}`);
  process.exit(1);
}
