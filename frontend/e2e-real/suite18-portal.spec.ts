/**
 * Proposal 93 · Stage 3 · WAVE 6 · SUITE 18 — Client portal, on Unicode Group.
 *
 * §10: "Log in as an org client; projects, boards, comments, approvals, files;
 * attempt another org's project by id and be refused. → no seat consumed."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` and nothing else. `signIn()` calls `assertOrg()` before any
 * test does anything, and `assertOrg()` asserts the org **ID** the SERVER
 * resolved — never a name on screen, because the name is what got corrupted
 * when a platform credential renamed Aekam Inc on 2026-08-28. No platform or
 * god-mode credential appears in this file; god mode is Suite 19's subject.
 *
 * ⚠ AND THE LANE ACCOUNT IS ONE OF THE TWO "CORRUPT-LOOKING" ROWS. Measured
 * 2026-08-29 from `GET /api/auth/me` with `E2E_UNICODE_TOKEN`:
 *
 *     user_id      user_21457956f010
 *     email        kevalvshah03+1@gmail.com
 *     users.role   "client"                      ← the legacy global column
 *     org_roles    [org_admin @ Unicode Group]
 *
 * CLAUDE.md: "`users.role` is a per-org fact stored in one global column. Rows
 * that look corrupt (org admins with `role='client'`) are real; never clean
 * them." This is one of exactly two such rows and it is named in
 * `middleware/roles.is_portal_client`'s own docstring. It is NOT a portal
 * client — `is_portal_client` requires `role='client'` AND no staff-side role,
 * and `navContext().isClient` requires `role==='client'` AND zero org roles.
 * Both answer false here, correctly. 18.02 asserts that rather than assuming.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ §10 CANNOT BE RUN AS WRITTEN, AND THAT IS THE SUITE'S FIRST FINDING
 * ═══════════════════════════════════════════════════════════════════════════
 * "Log in as an org client" needs an account the server treats as one. Measured
 * live on 2026-08-29, before a line of this file ran:
 *
 *   · `public.users WHERE role='client'` → **2 rows**, and BOTH hold
 *     `org_admin` in `staging.user_roles` (`user_91601f25f601` Kasti ORG,
 *     `user_21457956f010` Keval UK). `is_portal_client` returns False for
 *     both — by design, and that design is a shipped fix.
 *   · `staging.user_roles WHERE role_code IN ('org_client','aekam_team')` →
 *     **0 rows**. The two project-only roles have never been granted.
 *   · **Therefore: zero drivable portal clients exist.**
 *
 * And none can be made from an org-side screen. Three doors, all measured at
 * HEAD and all closed:
 *
 *   1. `POST /api/v1/org/invites` — the Members screen. `INVITABLE_ROLES` is
 *      `('org_owner','org_admin','org_member')` and `_assert_may_grant_role`
 *      answers **400** to anything else. Worse for §10's purpose: the INSERT
 *      hard-codes `role` to the literal `"member"`, so every account this door
 *      creates carries `users.role='member'` whatever else is asked for.
 *      `accept_invite` (`auth_router.py`) sets `users.role = invite["role"]`,
 *      so "member" is the only value that door can ever produce.
 *   2. `POST /api/teams/{id}/members` with `role: 'client'` — the **Team**
 *      screen, which DOES offer a Client option (`TeamsPage.jsx:344`). It
 *      writes `project_assignments.role` and `team_members.role` and never
 *      touches `users.role`. 18.07 drives it and reads that back.
 *   3. `POST /api/admin/invites` with `role: 'client'` — the platform console.
 *      This is the ONLY door that sets `users.role='client'`, and it is
 *      `require_platform_role(*CONSOLE_ROLES)`: **god mode**, reserved for
 *      Suite 19 by this programme's own safety rule.
 *
 * So the verdict, and it is a product finding rather than a suite shortfall:
 * **a client-portal login can only be minted by Aekam's platform staff. No
 * screen an org owner or administrator can reach creates one.** Recorded as
 * BLOCKED with evidence, per the brief — not skipped, and not invented by SQL.
 *
 * WHAT IS DRIVEN INSTEAD, and it is most of the suite's value: §10's other two
 * assertions are tenancy assertions, and both are fully drivable from an
 * org-scoped session. 18.03 drives all four portal ROUTES and proves the
 * confinement in the staff→portal direction. 18.05 and 18.08–18.12 attempt
 * another org's project, board, task, comment thread, approval and files by id
 * — comparing **ID SETS, never response bytes**, because a 200 carrying an
 * empty list and a 200 carrying another tenant's rows are the same shape.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ WHAT 18.10 FOUND — READ THIS BEFORE CALLING IT A TEST BUG
 * ═══════════════════════════════════════════════════════════════════════════
 * `GET /api/tasks/{id}/comments` served **another organisation's comment
 * thread, verbatim, with author names**, to a caller whose `GET` on the task
 * itself answered 403. Measured from a browser session on staging, with this
 * lane's own credential:
 *
 *     GET /api/tasks/task_e03dc6c1e106            403 {"detail":"Not authorized"}
 *     GET /api/tasks/task_e03dc6c1e106/comments   200 three comments
 *     GET /api/tasks/task_76394cae4212/comments   200 another firm's note about
 *                                                     a client's Google Business
 *                                                     verification
 *     GET /api/tasks/task_7a773897f58f/comments   200 "Please co-ordinate with
 *                                                     Sneha"
 *
 * All three tasks belong to **Aekam Inc**. Live exposure: **87 comments over 29
 * tasks — 22 of them on 15 Aekam Inc tasks** — readable by any authenticated
 * account. ACTIVE.
 *
 * Cause, at HEAD: `list_comments` asked one question — "`is_portal_client`?
 * then `client_can_access_task`" — with **no `else`**. Every caller who is not
 * a portal client fell through to `WHERE c.task_id=$1`. `add_comment` carried
 * the identical hole on the WRITE side and is the worse of the two, because its
 * fan-out emails the task's creator, assignees and `task_clients` rows.
 *
 * A fix is in this branch (`server.py::assert_may_reach_task_thread`, plus
 * `backend/tests/test_task_comment_tenancy.py`, 9 tests, proved to bite by
 * mutation). **This agent cannot deploy**, so 18.10 stays RED against staging
 * until the backend ships. That is reported, not worked around: relaxing it to
 * "200 is fine" is exactly how a real defect gets buried.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SAFETY — what this suite deliberately does NOT do
 * ═══════════════════════════════════════════════════════════════════════════
 * · **No write is attempted against another organisation.** Aekam Inc is
 *   NO-TOUCH under §12, and this repo's standing rule is "never test validation
 *   by writing to the live DB". A cross-tenant write probe IS the exploit: if
 *   the guard is missing the probe leaves a row in somebody else's company. The
 *   refusal side of every write path is covered in
 *   `backend/tests/test_task_comment_tenancy.py`, where refusing costs nobody a
 *   row. Every probe below is a `page.request.get`, which
 *   `scripts/check-e2e-no-bypass.mjs` explicitly permits as verification.
 * · **`outbound_mode` is `live` and `suppressed_orgs_digest` is `"0"`** —
 *   nothing is suppressed. So this suite drives no path that sends: the one
 *   control it presses (`POST /teams/{id}/members`, 18.06/18.07) has no sender
 *   in its handler, verified at HEAD. `assertOutboundFence` from `_helpers` is
 *   deliberately NOT called: it requires the digest to name the E2E org, which
 *   would fail this lane for a reason that has nothing to do with the portal.
 *   18.00 asserts and PRINTS the mode instead.
 * · **The protected set is a before/after fixture.** `team_ae1d58543b21`
 *   ("Aekam Inc", inside Unicode) holds 20 tasks — 19 live plus 1 archived,
 *   measured 2026-08-29. 18.00 records it and 18.13 re-reads it. Nothing in
 *   this file writes to that team, and 18.07 asserts the lane account cannot.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 IDEMPOTENCE — proved by running twice, never claimed
 * ═══════════════════════════════════════════════════════════════════════════
 * Only one test creates anything: 18.06/18.07 adds ONE project-level client to
 * S3 Project 08, keyed on the deterministic address `PORTAL_CLIENT_EMAIL`. It
 * reads the roster first and presses the button only if that address is absent,
 * then asserts the roster either way. A second run therefore types nothing and
 * still asserts everything. Everything else in this file is a read.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §14 — THIS SUITE RULES ON NOTHING
 * ═══════════════════════════════════════════════════════════════════════════
 * Every failure reports the WIRE — method, status, path, body — and stops. No
 * assertion is relaxed to make a screen pass. Whether a red test is the product
 * or the test is the lead's judgement, and the evidence is written here so it
 * can be made.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite18.config.ts
 */
import { test, expect, Page } from '@playwright/test';
import { lane, activeLane, assertOrg, ORG } from './_lanes';
import { settle, isForeignInlineScriptRefusal } from './_helpers';
// ⚠ STAGE 4 (§14): `activeLane()` reads E2E_LANE and DEFAULTS TO 'unicode', so an
// unset run is byte-for-byte the Unicode run this suite was authored against.
// `lane('unicode')` frozen here at import time was why the UK replay could not
// be run at all — §14's own first category, a hidden dependency on Unicode.
const LANE = activeLane();
const API = process.env.E2E_API_URL || 'https://api.kartavaya.com';

const BLOCKED =
  'BLOCKED — no Unicode Group credential. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e at the repo root. ⚠ It must be an ' +
  'ORG-SCOPED account: a platform_admin token resolves to Aekam Inc via ' +
  'platform_bypass and would write there. ENVIRONMENT blocker, not a product ' +
  'or test defect.';

/* ══════════════════════════════════════════════════════════════════════════
   THE TARGETS — measured, with provenance, and each paired with a control
   ══════════════════════════════════════════════════════════════════════════

   ⚠ EVERY NEGATIVE TARGET HAS A POSITIVE CONTROL, and that pairing is the
   whole reason these constants are hard-coded rather than discovered.

   A refusal probe against an id that has been deleted answers 404 and passes
   while proving nothing — the classic test that cannot fail. So each foreign id
   below is checked alongside an id in THIS org that must answer 200 through the
   identical call. If the control goes red the probe is meaningless and the test
   says so, instead of reporting a green refusal over a dead endpoint.

   Discovery is not an option here: the only way to learn another tenant's ids
   from inside a session is the leak being tested for.

   Read from the live database 2026-08-29, read-only. */

/** Aekam Inc's own team, and a task on it. The lane account holds NO Aekam Inc
 *  role and NO `project_assignments` row on this team — verified in 18.00. */
const FOREIGN_TEAM = 'team_e93135831d78';        // "Acute Angle Engineering"
const FOREIGN_TASK = 'task_36fc635a3e5a';        // "Google update"
/** A second Aekam Inc task, chosen because it HAS COMMENTS (3). An empty
 *  thread cannot tell a leak from an absence — this one can. */
const FOREIGN_TASK_WITH_THREAD = 'task_e03dc6c1e106';

/** This org, for the controls. S3 Project 08 is the least-loaded Unicode
 *  project (0 tasks on 2026-08-29), which is why 18.06 writes there. */
const OWN_TEAM = 'team_913c86bc0253';            // "S3 Project 08"
const OWN_TEAM_BUSY = 'team_c55f3960bf2f';       // "S3 Project 01", 32 tasks
const OWN_TASK_WITH_THREAD = 'task_213e889b76a2';// "S3-T002", 8 comments

/** ⚠ PROTECTED (§12). A team NAMED "Aekam Inc" that lives INSIDE Unicode
 *  Group. It holds the 20 tasks proposal 93 guarantees untouched — 19 live and
 *  1 archived. The lane account is org_admin of Unicode so it legitimately
 *  READS this team; it holds no `project_assignments` row on it, so it cannot
 *  add anybody. Both are asserted. */
const PROTECTED_TEAM = 'team_ae1d58543b21';
const PROTECTED_TASK_TOTAL = 20;

/** The one grant that legitimately crosses an org line for this account, and
 *  the reason 18.05 cannot simply assert "everything is Unicode's".
 *  `project_assignments(user_21457956f010, team_95beaa7529a9, role='client')`
 *  — an Aekam Inc project the account was explicitly added to. See 18.05. */
const GRANTED_FOREIGN_TEAM = 'team_95beaa7529a9';// "AekamInc-UK", Aekam Inc

/** The address 18.06/18.07 types. Deterministic, so the second run finds it
 *  rather than making a second one. Inside the allowed recipient set even
 *  though this path sends nothing: `kevalvshah03+…@gmail.com` is a real,
 *  deliverable mailbox, and `@example.com` is never used anywhere here. */
const PORTAL_CLIENT_EMAIL = 'kevalvshah03+s18portal@gmail.com';

/** Fields `ClientTaskOut` must never carry — `19-client-portal.md`'s never-see
 *  list, transcribed from `backend/tests/test_client_portal.py` so the live
 *  contract and the unit contract cannot drift apart. */
const FORBIDDEN_CLIENT_KEYS = [
  'assignee_user_ids', 'assignee_emails', 'assignee_names', 'estimated_minutes',
  'custom_fields', 'subtasks', 'approved_by', 'column_id', 'sort_order',
  'user_id', 'category_id', 'priority', 'tags', 'status',
  'created_by_user_id', 'assigned_by_user_id', 'completed_by_user_id',
  'reminder_at', 'reminder_sent_at', 'requires_approval', 'archived_at',
  'org_id', 'team_id', 'brand_settings', 'deleted_at', 'created_by',
];

/* ══════════════════════════════════════════════════════════════════════════
   THE HARNESS
   ══════════════════════════════════════════════════════════════════════════ */

test.beforeAll(() => {
  console.log(
    `\n  LANE : ${LANE.org} (${LANE.orgId})  · reference lane, §14` +
    `\n  API  : ${API}` +
    `\n  ⚠ §10 asks this suite to "log in as an org client". ZERO drivable` +
    `\n    portal clients exist and no org-side screen creates one — see the` +
    `\n    file header. 18.01/18.02/18.07 measure that; the rest drives the` +
    `\n    tenancy half, which is where this suite's value is.\n`,
  );
});

/**
 * Sign in, then REFUSE TO CONTINUE unless the session resolved to Unicode.
 *
 * `assertOrg()` is called HERE rather than left to each test to remember. It
 * has been found not running twice already, and `_lanes.ts` says why in
 * capitals: "a rule every author must re-apply is the rule that renamed Aekam
 * Inc, and a NEW suite is exactly the case that forgets."
 */
async function signIn(page: Page) {
  if (LANE.email && LANE.password) {
    await page.goto('/login');
    await expect(page.locator('#au-email')).toBeVisible({ timeout: 30_000 });
    await page.locator('#au-email').fill(LANE.email);
    await page.locator('#au-password').fill(LANE.password);
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
  } else {
    if (!LANE.token) throw new Error(BLOCKED);
    await page.goto('/login');
    await page.evaluate((t) => localStorage.setItem('auth_token', t), LANE.token);
    await page.goto('/dashboard');
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
  }
  await assertOrg(page.request, page, LANE);
}

/**
 * ⚠ `X-Org-Id` IS NOT OPTIONAL, and `_helpers.ts::api()` MUST NOT be used here.
 *
 * `src/lib/api.js:39` puts the active org on every request the product makes.
 * `_helpers.ts::api()` sends `X-Org-Id: process.env.E2E_ORG_ID` — which names
 * **E2E Test & Associates**, not Unicode. A read helper answering for a
 * different organisation than the screen beside it is the same class of fault
 * as the 2026-08-28 cross-org incident, so this file has its own, bound to the
 * lane's org id and to nothing in the environment. Suite 07 carries the
 * identical note; this is the same decision, not a copy-paste.
 *
 * GET only, and that is a rule rather than an accident:
 * `scripts/check-e2e-no-bypass.mjs` bans `page.request.post/put/patch/delete`
 * and permits `get`, because asserting that a row appeared — or did not — IS
 * the required evidence.
 */
async function orgGet(page: Page, path: string) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  return page.request.get(`${API}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Org-Id': LANE.orgId,
    },
  });
}

async function orgGetJson(page: Page, path: string) {
  const r = await orgGet(page, path);
  expect(r.status(), `GET ${path} → ${r.status()}: ${(await r.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  return await r.json();
}

/**
 * A refusal, stated as a set membership rather than as one number.
 *
 * 401/403/404 are all honest refusals and the product uses more than one on
 * purpose — `ClientPages.jsx` is explicit that "a project the client is not on
 * is `missing`, not `denied`", because a denial must never confirm a record
 * exists to somebody who should not know it. So this accepts any of the three
 * and rejects 2xx, and it PRINTS the body on failure because "200 with an empty
 * list" and "200 with somebody else's rows" are the two outcomes a bare status
 * assertion cannot tell apart.
 */
async function expectRefused(page: Page, path: string, why: string) {
  const r = await orgGet(page, path);
  const body = (await r.text()).slice(0, 400);
  expect([401, 403, 404],
    `\n  ⚠ CROSS-TENANT READ NOT REFUSED\n` +
    `     GET ${path}\n` +
    `     status : ${r.status()}\n` +
    `     body   : ${body}\n` +
    `     why it must be refused: ${why}\n` +
    `     caller : ${LANE.email} — org_admin of ${LANE.org} ONLY\n`)
    .toContain(r.status());
  return r;
}

/** The other half of every refusal: the identical call, in this org, must work.
 *  Without it a refusal proves the endpoint is broken, not that it is scoped. */
async function expectControlServes(page: Page, path: string) {
  const r = await orgGet(page, path);
  expect(r.status(),
    `\n  ⚠ POSITIVE CONTROL FAILED — the refusal beside this one proves nothing.\n` +
    `     GET ${path} → ${r.status()}: ${(await r.text()).slice(0, 300)}\n` +
    `     This call is in the caller's OWN org and must answer 200. Either the\n` +
    `     fixture id has gone, or the endpoint is down. Do not read the paired\n` +
    `     refusal as evidence of scoping until this is green.\n`)
    .toBe(200);
  return r;
}

/** Console errors, collected per test. §1: "zero uncaught errors across the
 *  whole run, collected per screen." */
function watchConsole(page: Page) {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Cloudflare's `__CF$cv$` loader carries a per-request token, so its hash
    // differs every load and can never be allowed by hash. CLASSIFIED, not
    // ignored: a refusal of OUR bootstrap still fails. See _helpers.
    if (isForeignInlineScriptRefusal(m.text())) return;
    errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  return errs;
}

/** A rendered UUID is a defect wherever it appears (`check-rendered-ids.mjs` is
 *  the static half; this is the runtime half). */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/* ══════════════════════════════════════════════════════════════════════════
   18.00 · PREFLIGHT — what is true before anything runs
   ══════════════════════════════════════════════════════════════════════════ */

test('18.00 · preflight — the deployment, the lane account, and the protected set',
  async ({ page }) => {
    // ⚠ `meta.branch` COULD NOT BE CHECKED, the same shortfall Suites 03, 07,
    // 08 and 11 each recorded. The deployed backend exposes no such route —
    // `/api/version`, `/api/meta`, `/api/_meta`, `/version`, `/api/build` and
    // `/api/health/meta` all answer 404. `GET /api/health` is the whole of the
    // available evidence and it is asserted rather than glossed over.
    const health = await page.request.get(`${API}/api/health`);
    expect(health.status(), 'GET /api/health').toBe(200);
    const meta = await health.json();
    expect(meta.environment, 'this suite must run against STAGING').toBe('staging');
    expect(meta.schema).toBe('staging');
    expect(meta.db).toBe('connected');
    console.log(`  health: env=${meta.environment} schema=${meta.schema} ` +
      `outbound_mode=${meta.outbound_mode} suppressed=${meta.suppressed_orgs_digest}`);

    await signIn(page);

    // WHO IS ACTUALLY DRIVING. Asserted, not assumed — the whole suite's
    // reasoning about "is this a portal client" rests on these three facts.
    const me = await orgGetJson(page, '/api/auth/me');
    const u = me.user || me;
    expect(u.user_id, 'the lane credential changed identity').toBe('user_21457956f010');
    expect(u.role,
      'the lane account is expected to carry the legacy users.role=\'client\' — ' +
      'one of the two live rows CLAUDE.md says never to clean. If this is no ' +
      'longer true somebody cleaned them, and 18.02 is measuring a different ' +
      'database than the one this file was written against.')
      .toBe('client');
    const roles = (u.org_roles || []).map((r: any) => `${r.role_code}@${r.org_id}`);
    expect(roles,
      'the lane must hold exactly one org role, in Unicode Group. More than one ' +
      'and `assertOrg` is the only thing keeping the writes in the right place.')
      .toEqual([`org_admin@${ORG.UNICODE}`]);
    expect((u.platform_roles || []).length,
      'a platform role here would mean god mode is driving a write suite — ' +
      '`_lanes.ts` rule 1, and the reason Aekam Inc got renamed on 2026-08-28')
      .toBe(0);

    // THE FOREIGN TARGETS ARE GENUINELY FOREIGN. `GET /api/teams/{id}` answers
    // 403 "Not a team member" for a team this account cannot reach, so this
    // doubles as the proof that FOREIGN_TEAM is outside the lane's reach — the
    // precondition every probe below depends on.
    const foreign = await orgGet(page, `/api/teams/${FOREIGN_TEAM}`);
    expect([403, 404],
      `FOREIGN_TEAM ${FOREIGN_TEAM} answered ${foreign.status()} — it is NOT ` +
      `foreign to this account, so every probe using it would be vacuous. Pick ` +
      `another Aekam Inc team.`).toContain(foreign.status());

    // THE PROTECTED SET, BEFORE. §12's guarantee is a before/after fixture
    // rather than a promise. 18.13 re-reads it.
    //
    // ⚠ `task_count` is on the LIST payload, not the detail one:
    // `GET /api/teams/{id}` returns `{team, members, your_role}` and the team
    // object has no count. Measured on the first run of this file, which read
    // the detail and got `undefined` — a fixture that compares `undefined` to
    // 20 is a fixture that would have failed identically whether or not the
    // protected set had moved, which is the opposite of evidence.
    const teams = await orgGetJson(page, '/api/teams');
    const prot = (Array.isArray(teams) ? teams : teams.teams || [])
      .find((t: any) => t.team_id === PROTECTED_TEAM);
    expect(prot,
      `${PROTECTED_TEAM} — proposal 93's protected team — is not in this org's ` +
      `team list at all`).toBeTruthy();
    console.log(`  protected ${PROTECTED_TEAM} "${prot.name}" ` +
      `task_count=${prot.task_count} (§12 fixture, re-read in 18.13)`);
    expect(prot.name, 'the protected team was renamed').toBe('Aekam Inc');
  });

/* ══════════════════════════════════════════════════════════════════════════
   18.01–18.02 · CAN A CLIENT-PORTAL LOGIN BE CREATED AT ALL?
   ══════════════════════════════════════════════════════════════════════════ */

test('18.01 · the Members screen offers no client role — every account it makes is staff',
  async ({ page }) => {
    const errs = watchConsole(page);
    await signIn(page);

    await page.goto('/settings/organisation?tab=members');
    await settle(page);

    const role = page.locator('#add-role');
    // A missing control is a FAILURE, never a skip — suite rule 1. If the add
    // form is not there the screen cannot be assessed at all, and saying so is
    // the point.
    const opener = page.getByRole('button', { name: /add member|invite/i }).first();
    if (await opener.count() && !(await role.count())) {
      await opener.click();
      await settle(page);
    }
    await expect(role,
      'the Members tab renders no #add-role picker, so an org admin has no way ' +
      'to choose what kind of account they are creating. That is a failure of ' +
      'the screen, not a reason to skip.').toBeVisible({ timeout: 20_000 });

    const offered = await role.locator('option').evaluateAll(
      (os) => os.map((o) => (o as HTMLOptionElement).value));
    console.log(`  #add-role offers: ${offered.join(', ')}`);

    // The measurement, stated as the finding rather than as a preference. Both
    // codes are `SEAT_CONSUMING_ORG_ROLES`; neither is `org_client`.
    expect(offered,
      '\n  §10 asks this suite to "log in as an org client". The org\'s own ' +
      'Members screen\n  offers only seat-consuming staff roles, so it cannot ' +
      'create the account §10 needs.\n  If this list ever gains a client ' +
      'option, Suite 18 can finally be run as written —\n  that is what this ' +
      'assertion is watching for.\n')
      .toEqual(['org_member', 'org_admin']);

    // And the server agrees, which matters more than the picker: a widened
    // picker over an unchanged `INVITABLE_ROLES` would be a dead control.
    // Read-only — `GET /v1/org/invites` lists what exists, it creates nothing.
    const invites = await orgGetJson(page, '/api/v1/org/invites');
    for (const inv of invites) {
      expect(['org_owner', 'org_admin', 'org_member'],
        `a pending invite carries org_role=${inv.org_role}, which INVITABLE_ROLES ` +
        `does not contain — the ladder moved`).toContain(inv.org_role);
    }

    expect(errs, `console errors on the Members tab: ${errs.join(' | ')}`).toEqual([]);
  });

test('18.02 · zero portal clients exist in this org — the portal predicate, applied to every member',
  async ({ page }) => {
    await signIn(page);

    // `is_portal_client` = users.role='client' AND no staff-side role.
    // `GET /v1/org/members` is filtered to SEAT_ROLES, so EVERY row it returns
    // holds a staff-side role by construction — which is exactly the point:
    // there is no member of this organisation for whom the predicate can be
    // true, and the list proves it without needing each user's `users.role`.
    const members = await orgGetJson(page, '/api/v1/org/members');
    expect(members.length, 'the org has no members at all').toBeGreaterThan(0);

    const STAFF_SIDE = ['org_owner', 'org_admin', 'org_member', 'hr_admin'];
    const codes = [...new Set(members.map((m: any) => m.role_code))].sort();
    console.log(`  ${members.length} member rows, ` +
      `${new Set(members.map((m: any) => m.user_id)).size} distinct accounts, ` +
      `role codes: ${codes.join(', ')}`);

    for (const m of members) {
      expect(STAFF_SIDE,
        `member ${m.full_name || m.user_id} carries role_code=${m.role_code}. ` +
        `If that is a PROJECT-ONLY code (org_client / aekam_team) then a portal ` +
        `client now exists and §10 can be run as written — re-open this suite.`)
        .toContain(m.role_code);
    }

    // ⚠ NAMES, NOT IDS — and this is the one endpoint that hands the org its own
    // people, so it is the natural place for a UUID to escape onto a screen.
    for (const m of members) {
      expect(UUID_RE.test(String(m.full_name || '')), 'a UUID in a member NAME').toBe(false);
      expect(String(m.user_id || '').startsWith('user_'),
        'member ids must stay opaque `user_…` strings, never raw UUIDs').toBe(true);
    }
  });

/* ══════════════════════════════════════════════════════════════════════════
   18.03 · THE FOUR PORTAL SCREENS — driven, in the only direction available
   ══════════════════════════════════════════════════════════════════════════ */

test('18.03 · all four portal routes confine staff out, and none of them breaks',
  async ({ page }) => {
    const errs = watchConsole(page);
    await signIn(page);

    // `Protected.jsx`: "A non-client must not sit inside the portal either. The
    // portal reads `/client/*` endpoints that return a deliberately thin,
    // client-shaped payload, so a staff user there sees a reduced version of
    // their own data and reasonably concludes something is broken."
    //
    // This is the ONLY direction of the confinement that can be driven without
    // a portal account, and it is worth driving: it is a real guard, it is the
    // twin of the rule that keeps a client OUT of the staff app, and a broken
    // one would hand every staff member a portal that looks like a bug report.
    const routes = [
      '/client',
      '/client/projects',
      '/client/approvals',
      '/client/files',
      `/client/project/${OWN_TEAM}`,
    ];

    for (const r of routes) {
      await page.goto(r);
      await settle(page);
      await expect(page,
        `\n  ${r} did not confine a staff caller.\n` +
        `     landed on : ${page.url()}\n` +
        `     Protected.jsx sends a non-client at /client/* to /dashboard. If ` +
        `this route\n     now RENDERS the portal for staff, the thin ` +
        `client-shaped payload is being\n     shown to somebody who should see ` +
        `the full app.\n`)
        .toHaveURL(/\/dashboard/, { timeout: 20_000 });

      // Not merely redirected — the portal chrome must be absent. `ClientShell`
      // draws the firm's wordmark and a three-item nav; a redirect that still
      // painted it would be a redirect that arrived too late.
      await expect(page.locator('.cl-shell, [data-testid="client-shell"]'),
        `${r} redirected but left the portal shell mounted`).toHaveCount(0);
      console.log(`  ${r.padEnd(34)} → ${new URL(page.url()).pathname}`);
    }

    // §1's console rule. A redirect loop or an unmounted-fetch warning shows up
    // here and nowhere else.
    expect(errs,
      `console errors while driving the portal routes: ${errs.join(' | ')}`)
      .toEqual([]);
  });

/* ══════════════════════════════════════════════════════════════════════════
   18.04 · THE PORTAL'S OWN READS — shape, not just status
   ══════════════════════════════════════════════════════════════════════════ */

test('18.04 · the portal payloads carry the client allow-list and nothing off it',
  async ({ page }) => {
    await signIn(page);

    // `19-client-portal.md`, quoted at the top of `test_client_portal.py`: "The
    // failure mode is a well-meaning `GET /api/client/tasks` that returns the
    // full task object and lets the component pick fields. Then one
    // `{JSON.stringify(task)}` in a debug branch, or one new field rendered by
    // a shared component, leaks it."
    //
    // That contract has unit coverage over a mocked pool. This asserts it
    // against the DEPLOYED service over REAL rows, which is the half a fixture
    // cannot give: a field added to `TaskOut` and forgotten reaches production
    // before it reaches a mock.
    const tasks = await orgGetJson(page, '/api/client/tasks');
    const projects = await orgGetJson(page, '/api/client/projects');
    const approvals = await orgGetJson(page, '/api/client/approvals');
    console.log(`  /client/tasks=${tasks.length} /client/projects=${projects.length} ` +
      `/client/approvals=${approvals.length}`);

    expect(Array.isArray(tasks) && Array.isArray(projects) && Array.isArray(approvals),
      'a portal read did not return a list').toBe(true);

    const offenders: string[] = [];
    const scan = (rows: any[], where: string) => {
      for (const row of rows) {
        for (const k of Object.keys(row || {})) {
          if (FORBIDDEN_CLIENT_KEYS.includes(k)) offenders.push(`${where}.${k}`);
        }
      }
    };
    scan(tasks, 'client/tasks');
    scan(projects, 'client/projects');
    scan(approvals, 'client/approvals');

    expect([...new Set(offenders)],
      '\n  A portal payload carries a field off 19\'s never-see list. Each one ' +
      'reaches an\n  EXTERNAL PARTY the moment a portal account exists, and the ' +
      'shape is the guard —\n  a test that only checked the wanted fields would ' +
      'go green the day TaskOut was\n  wired back in.\n')
      .toEqual([]);

    // The portal's fourth read. `useClientPortal.js` catches its failure on
    // purpose — "a client whose org row is unreachable gets the portal without
    // a wordmark rather than an error screen" — so a non-200 here is a
    // degradation, not a crash, and is recorded rather than asserted fatal.
    const firm = await orgGet(page, '/api/v1/org/profile');
    console.log(`  /v1/org/profile → ${firm.status()} (portal wordmark source)`);
  });

/* ══════════════════════════════════════════════════════════════════════════
   18.05–18.07 · ID SETS, AND THE SEAT
   ══════════════════════════════════════════════════════════════════════════ */

test('18.05 · /client/projects returns no project this account was never given',
  async ({ page }) => {
    await signIn(page);

    // ⚠ ID SETS, NEVER BYTES. `audit_cross_org_access` is explicit: compare the
    // SETS. A 200 carrying an empty list and a 200 carrying another tenant's
    // rows are the same shape to a status assertion.
    const projects = await orgGetJson(page, '/api/client/projects');
    const returned: string[] = projects.map((p: any) => p.projectId).sort();

    // What this org actually owns, read through the staff endpoint the caller
    // is entitled to. Anything in `returned` that is not in here is either an
    // explicit personal grant or a leak, and the assertion below separates them.
    //
    // `GET /api/teams` and NOT `/api/projects` — there is no such route (404,
    // measured), and both `TeamsPage.jsx:47` and `ProjectsPage.jsx:95` call
    // `/teams`. A project IS a team in this schema; the two words are one table.
    const mine = await orgGetJson(page, '/api/teams');
    const mineIds = new Set(
      (Array.isArray(mine) ? mine : mine.teams || []).map((p: any) => p.team_id));

    // ── THE ONE DOCUMENTED CROSSING, AND WHY IT IS NOT WAVED THROUGH ────────
    //
    // `GET /api/client/projects` scopes on `project_assignments` OR an
    // org_owner/admin/member row — and the FIRST leg carries no org predicate
    // and does not read `X-Org-Id` at all. Measured 2026-08-29: this account,
    // whose only org role is on Unicode Group, is returned "AekamInc-UK"
    // (`team_95beaa7529a9`) — an **Aekam Inc** project — because somebody added
    // it there as a project client.
    //
    // Whether that is correct is not this suite's ruling to make: the row is a
    // deliberate grant, and a portal client is defined by project grants rather
    // than by org membership. What is NOT arguable is that the list mixes two
    // tenants with no label, and that switching org changes nothing about it —
    // the `audit_org_switch_never_scoped` shape. Recorded, named, and pinned:
    // ONE crossing is tolerated by id, a SECOND fails this test.
    const unexpected = returned.filter(
      (id) => !mineIds.has(id) && id !== GRANTED_FOREIGN_TEAM);

    console.log(`  /client/projects returned ${returned.length}: ${returned.join(', ')}`);
    console.log(`  of those, ${returned.filter((i) => !mineIds.has(i)).length} are ` +
      `outside this org's project list`);

    expect(unexpected,
      '\n  ⚠ /client/projects returned a project this account holds no grant on.\n' +
      '     The endpoint\'s first leg (`project_assignments`) carries NO org\n' +
      '     predicate and ignores X-Org-Id, so the only thing standing between\n' +
      '     it and another tenant\'s project list is the absence of a row.\n' +
      `     Known and documented crossing: ${GRANTED_FOREIGN_TEAM} (AekamInc-UK,\n` +
      '     Aekam Inc) — an explicit project_assignments grant. Anything else\n' +
      '     here is new.\n')
      .toEqual([]);

    // And the negative target must be absent outright.
    expect(returned,
      `${FOREIGN_TEAM} is another org's project with no grant to this account`)
      .not.toContain(FOREIGN_TEAM);
  });

test('18.06 · adding a project client consumes NO seat — counted before and after',
  async ({ page }) => {
    await signIn(page);

    // §10: "→ no seat consumed". Proved by a COUNT before and after, never by
    // the absence of a warning — the brief is explicit about that, and an
    // absent warning is exactly what a silently-consumed seat looks like.
    //
    // `subscription/current.user_count` is `org_invites.count_seats` — the ONE
    // seat counter, the same function the refusal sentence and the admin
    // console both read. Counting members on a screen instead would be counting
    // a different thing.
    const before = await orgGetJson(page, '/api/v1/subscription/current');
    const seatsBefore = before.user_count;
    const membersBefore = await orgGetJson(page, '/api/v1/org/members');
    console.log(`  seats before: ${seatsBefore} · member rows: ${membersBefore.length}`);

    // ── DRIVE THE ONE ORG-SIDE CONTROL THAT SAYS "CLIENT" ──────────────────
    await page.goto('/teams');
    await settle(page);

    const projectPicker = page.locator('label.fld:has-text("Project") select').first();
    await expect(projectPicker,
      'the Team screen renders no project picker — an org admin cannot reach ' +
      'the only control in the product labelled "Client"')
      .toBeVisible({ timeout: 25_000 });
    await projectPicker.selectOption(OWN_TEAM);
    await settle(page);

    // IDEMPOTENCE: read the roster first and type only the shortfall. §6.
    //
    // ⚠ THE ROSTER IS READ FROM THE RECORD, NOT FROM THE CARD, and the reason
    // is a defect this test found on its first run. `GET /api/teams/{id}`
    // resolves a member's name through `LEFT JOIN users u`, so somebody invited
    // BY ADDRESS — who has no `users` row yet — comes back with
    // `display_name: "Unnamed member"` and `full_name: null`, and
    // `TeamsPage.jsx` renders `display_name || full_name || email`. The card
    // therefore reads "Unnamed member" and the address is nowhere on the
    // screen, so an idempotence check keyed on the address would type a second
    // copy on every run. See 18.07 for the same defect stated as a finding.
    const rosterNow = await orgGetJson(page, `/api/teams/${OWN_TEAM}`);
    const already = (rosterNow.members || []).filter(
      (m: any) => (m.email || '').toLowerCase() === PORTAL_CLIENT_EMAIL).length;
    const typed = already === 0;

    if (typed) {
      const opener = page.getByRole('button', { name: /add member to this project/i });
      await expect(opener,
        'no "Add member to this project" control on a project this account owns')
        .toBeVisible({ timeout: 20_000 });
      await opener.click();
      await settle(page);

      // The email box only appears once the search box is empty — the form
      // offers "pick an existing person" first and "invite by address" second.
      const emailBox = page.getByLabel('Invite by email');
      await expect(emailBox,
        'the add-member form offers no way to invite an address').toBeVisible();
      await emailBox.fill(PORTAL_CLIENT_EMAIL);

      // ⚠ THE CONTROL UNDER TEST. `TeamsPage.jsx:344` offers four project roles
      // and one of them is Client.
      const roleSel = page.locator('label.fld:has-text("Role") select').first();
      await expect(roleSel, 'no role picker in the add-member form').toBeVisible();
      const roleOptions = await roleSel.locator('option').evaluateAll(
        (os) => os.map((o) => (o as HTMLOptionElement).value));
      expect(roleOptions,
        'the project role picker no longer offers "client" — if that option was ' +
        'removed, this is the last org-side control that named a client at all')
        .toContain('client');
      await roleSel.selectOption('client');

      // A client-only field appears with it, and it must: the form is
      // describing an external company, not a colleague.
      await expect(page.getByPlaceholder(/company name \(for client\)/i),
        'choosing Client revealed no Company field — the option is cosmetic')
        .toBeVisible();
      await page.getByPlaceholder(/company name \(for client\)/i).fill('Suite 18 Portal Co');

      await page.getByRole('button', { name: /^add to /i }).click();
      await settle(page);
    } else {
      console.log('  0 typed, 1 already present — second run, verifying only');
    }

    // ── READ THE WRITE RESPONSE, THEN THE CANONICAL ROW ────────────────────
    // Suite rules 2 and 3. The card is the write response rendered; the roster
    // from `GET /api/teams/{id}` is the canonical row. The on-screen assertion
    // is on the ROLE BADGE rather than the address, because of the naming
    // defect recorded above — the card cannot show who this person is.
    await page.reload();
    await settle(page);
    await page.locator('label.fld:has-text("Project") select').first()
      .selectOption(OWN_TEAM);
    await settle(page);
    await expect(page.locator('.k-mcard .k-rolebadge--client'),
      `\n  the project roster shows no card at role "client" after the add.\n` +
      `     ${OWN_TEAM} should now carry exactly one, and a role badge is the\n` +
      `     only thing on that card that identifies it — see the naming defect\n` +
      `     noted above.\n`)
      .toHaveCount(1, { timeout: 20_000 });

    const canonical = await orgGetJson(page, `/api/teams/${OWN_TEAM}`);
    const roster = canonical.members || canonical.team?.members || [];
    const row = roster.find((m: any) => (m.email || '').toLowerCase() === PORTAL_CLIENT_EMAIL);
    expect(row,
      `${PORTAL_CLIENT_EMAIL} is on screen but not in GET /api/teams/${OWN_TEAM} — ` +
      `the roster and the record disagree`).toBeTruthy();
    expect(row.role, 'the row was stored at a different role than the one chosen')
      .toBe('client');

    // ── THE ASSERTION §10 ASKS FOR ─────────────────────────────────────────
    const after = await orgGetJson(page, '/api/v1/subscription/current');
    const membersAfter = await orgGetJson(page, '/api/v1/org/members');
    console.log(`  seats after:  ${after.user_count} · member rows: ${membersAfter.length}` +
      `  (typed=${typed ? 1 : 0})`);

    expect(after.user_count,
      `\n  ⚠ A SEAT WAS CONSUMED BY A PROJECT-ONLY GRANT.\n` +
      `     before ${seatsBefore} → after ${after.user_count}\n` +
      `     §10: "no seat consumed". role_tiers.SEAT_CONSUMING_ORG_ROLES is\n` +
      `     ORG_ROLES + HR_ADMIN_ROLES and deliberately excludes the two\n` +
      `     project-only codes: "a client seeing their own project costs the\n` +
      `     customer nothing … the roles are free BECAUSE they reach nothing\n` +
      `     but the project."\n`)
      .toBe(seatsBefore);
    expect(membersAfter.length,
      'the org member list grew — a project client became an org member')
      .toBe(membersBefore.length);
  });

test('18.07 · that control grants a PROJECT role, not a portal login — read back',
  async ({ page }) => {
    await signIn(page);

    // ── THE FINDING §10 RUNS INTO, STATED AS AN ASSERTION ──────────────────
    //
    // `add_team_member` writes `team_members.role` and
    // `project_assignments.role` and NEVER touches `users.role`. So the person
    // 18.06 added is a project client and NOT a portal client: the server's
    // `is_portal_client` and the client's `navContext().isClient` both read
    // `users.role`, and it is untouched. They cannot reach `/client/*`.
    //
    // And for a brand-new address there is no `users` row at all — the handler
    // writes a `team_members` row at status='invited', issues no invitation and
    // sends no email, so the address has no way to become an account. Asserted
    // through the product's own directory rather than by reading the source.
    const canonical = await orgGetJson(page, `/api/teams/${OWN_TEAM}`);
    const roster = canonical.members || canonical.team?.members || [];
    const row = roster.find((m: any) => (m.email || '').toLowerCase() === PORTAL_CLIENT_EMAIL);
    expect(row, `18.06 did not leave ${PORTAL_CLIENT_EMAIL} on ${OWN_TEAM}`).toBeTruthy();

    console.log(`  roster row: role=${row.role} status=${row.status} ` +
      `user_id=${row.user_id ?? 'null'}`);

    expect(row.role, 'the project role').toBe('client');
    expect(row.user_id ?? null,
      '\n  A `users` row was created for an address added from the Team screen.\n' +
      '     That would be new: `add_team_member` resolves an EXISTING user or\n' +
      '     writes a roster row with no account behind it. If an account now\n' +
      '     exists, check whether it carries users.role=\'client\' — because if\n' +
      '     it does, a portal login can finally be created org-side and §10 can\n' +
      '     be run as written.\n')
      .toBe(null);

    // ── AND WHAT THE FIRM TYPED ABOUT THAT CLIENT IS STORED AND NEVER SHOWN ─
    //
    // Found by this test on 2026-08-29. 18.06 fills the Company box the Client
    // option reveals, and `public.team_members` really does carry it —
    // `company_name = 'Suite 18 Portal Co'`, `receives_approval_emails = true`,
    // read straight off the row. But the roster this screen renders comes from
    // `get_team`, which resolves `full_name`, `position`, `company_name`,
    // `member_role` and `receives_approval_emails` through `LEFT JOIN users u`
    // rather than from `tm.*` — and an invitee with no account has no `users`
    // row, so all five come back null and `display_name` falls to "Unnamed
    // member".
    //
    // The consequence on screen: the only project role in the product that
    // describes an EXTERNAL COMPANY renders as an anonymous card with no name,
    // no address and no company, and the two fields the form insisted on
    // collecting are invisible for exactly the population they exist for. The
    // model's own docstring calls this shape "the worst a defect takes in this
    // product: the save succeeds and the value goes nowhere" — it was fixed on
    // the write and the read was left behind.
    //
    // Asserted rather than described, so it cannot rot: the row HAS the
    // company, the roster response does NOT.
    console.log(`  roster company_name=${row.company_name ?? 'null'} ` +
      `display_name=${row.display_name ?? 'null'}  ← from LEFT JOIN users`);
    expect(row.display_name,
      'an invited project client now renders with a real name — if `get_team` ' +
      'started falling back to `team_members.email`, this finding is fixed and ' +
      'the note above should go with it')
      .toBe('Unnamed member');

    // The org's own directory must not have gained anybody either.
    const members = await orgGetJson(page, '/api/v1/org/members');
    expect(members.some((m: any) => (m.email || '').toLowerCase() === PORTAL_CLIENT_EMAIL),
      'a project client appeared on the org Members screen — the two lists ' +
      'answer different questions and must not merge')
      .toBe(false);

    // ── AND THE PROTECTED TEAM REFUSES THE SAME CONTROL ────────────────────
    // `team_ae1d58543b21` holds §12's 20 tasks. The lane account is org_admin
    // of Unicode but holds no `project_assignments` row on that team, so
    // `add_team_member`'s own gate (`mem.role in ('owner','admin')`) refuses
    // it. Driven as a read of the screen's own affordance: the picker offers
    // the team, and the add control must not be there.
    await page.goto('/teams');
    await settle(page);
    const picker = page.locator('label.fld:has-text("Project") select').first();
    await expect(picker).toBeVisible({ timeout: 25_000 });
    const options = await picker.locator('option').evaluateAll(
      (os) => os.map((o) => (o as HTMLOptionElement).value));
    if (options.includes(PROTECTED_TEAM)) {
      await picker.selectOption(PROTECTED_TEAM);
      await settle(page);
      await expect(page.getByRole('button', { name: /add member to this project/i }),
        '\n  ⚠ The Team screen offers an "Add member" control on the PROTECTED\n' +
        '     team (§12, 20 tasks). The lane account holds no project role on\n' +
        '     it, so the server refuses — but a control that offers a write the\n' +
        '     server will refuse is a dead control, and on this team it is a\n' +
        '     dead control pointed at the one thing 93 guarantees untouched.\n')
        .toHaveCount(0);
    } else {
      console.log(`  ${PROTECTED_TEAM} is not in the project picker — nothing to press`);
    }
  });

/* ══════════════════════════════════════════════════════════════════════════
   18.08–18.12 · "ATTEMPT ANOTHER ORG'S … BY ID AND BE REFUSED"
   ══════════════════════════════════════════════════════════════════════════
   §10 says "project". The brief says do it properly — project, board, task,
   comment, approval, file — and pair every refusal with a control. */

test('18.08 · another org\'s PROJECT and BOARD, by id, are refused', async ({ page }) => {
    await signIn(page);

    const probes: Array<[string, string, string]> = [
      // [foreign path, control path, why it must be refused]
      [`/api/teams/${FOREIGN_TEAM}`, `/api/teams/${OWN_TEAM}`,
        'the project record itself — name, brand settings, created_by'],
      [`/api/teams/${FOREIGN_TEAM}/members`, `/api/teams/${OWN_TEAM}/members`,
        'another firm\'s staff roster, with addresses'],
      [`/api/teams/${FOREIGN_TEAM}/clients`, `/api/teams/${OWN_TEAM}/clients`,
        'another firm\'s CLIENT contacts — the approval dropdown\'s source'],
      [`/api/projects/${FOREIGN_TEAM}/columns`, `/api/projects/${OWN_TEAM}/columns`,
        'the board structure §10 calls "boards"'],
    ];

    for (const [foreign, control, why] of probes) {
      await expectControlServes(page, control);
      const r = await expectRefused(page, foreign, why);
      console.log(`  ${String(r.status()).padEnd(4)} ${foreign}`);
    }

    // The portal's own by-id route, driven in the browser rather than the wire.
    // `ClientPages.jsx` resolves a project from the list it already holds, so a
    // project the caller is not on must render `missing` — and 18.03 already
    // proved staff are bounced out of `/client/*` entirely, which is the
    // stronger refusal. Asserted here so the two rules are recorded together.
    await page.goto(`/client/project/${FOREIGN_TEAM}`);
    await settle(page);
    await expect(page,
      `/client/project/${FOREIGN_TEAM} did not bounce a staff caller`)
      .toHaveURL(/\/dashboard/, { timeout: 20_000 });
  });

test('18.09 · another org\'s TASK and its TIME are refused, by id', async ({ page }) => {
    await signIn(page);

    await expectControlServes(page, `/api/tasks/${OWN_TASK_WITH_THREAD}`);
    await expectRefused(page, `/api/tasks/${FOREIGN_TASK}`,
      'the task record — title, description, assignees, attachments');
    await expectRefused(page, `/api/tasks/${FOREIGN_TASK_WITH_THREAD}`,
      'the task record of the thread 18.10 probes');

    await expectControlServes(page, `/api/time/task/${OWN_TASK_WITH_THREAD}`);
    await expectRefused(page, `/api/time/task/${FOREIGN_TASK_WITH_THREAD}`,
      'billable hours logged by another firm on their own engagement');
  });

test('18.10 · another org\'s COMMENT THREAD is refused, by id', async ({ page }) => {
    await signIn(page);

    // ⚠⚠ THIS IS THE ONE. See the file header for the full measurement.
    //
    // On 2026-08-29 this answered 200 with three comments, author names and
    // bodies, from a task whose own GET answered 403. `list_comments` had a
    // gate for portal clients and NO `else`, so every staff account in every
    // organisation fell through to `WHERE c.task_id=$1`.
    //
    // The control matters more here than anywhere: an empty thread cannot tell
    // a leak from an absence, so the foreign target is a task with THREE
    // comments and the control is one with EIGHT. If the control is empty the
    // probe proves nothing and this test says so first.
    const control = await expectControlServes(page,
      `/api/tasks/${OWN_TASK_WITH_THREAD}/comments`);
    const mine = await control.json();
    expect(mine.length,
      `the control task ${OWN_TASK_WITH_THREAD} has no comments, so a refusal ` +
      `on the foreign one would be indistinguishable from an empty thread. ` +
      `Point OWN_TASK_WITH_THREAD at a task that has some.`)
      .toBeGreaterThan(0);

    const r = await orgGet(page, `/api/tasks/${FOREIGN_TASK_WITH_THREAD}/comments`);
    const body = await r.text();
    let leaked = 0;
    try { leaked = JSON.parse(body).length; } catch { /* not a list */ }

    expect([401, 403, 404],
      `\n  ⚠⚠ CROSS-TENANT COMMENT LEAK — CONFIRMED, ACTIVE\n` +
      `     GET /api/tasks/${FOREIGN_TASK_WITH_THREAD}/comments → ${r.status()}\n` +
      `     rows returned: ${leaked}\n` +
      `     caller: ${LANE.email}, org_admin of ${LANE.org} ONLY. The SAME\n` +
      `     caller is refused the task itself with 403 (18.09 asserts it).\n` +
      `     The task belongs to Aekam Inc.\n` +
      `     body: ${body.slice(0, 400)}\n\n` +
      `     Cause at HEAD: server.py::list_comments gated only\n` +
      `     is_portal_client and had no else, so every staff caller reached\n` +
      `     WHERE c.task_id=$1 with no team, org or membership predicate.\n` +
      `     Live exposure when found: 87 comments over 29 tasks, 22 of them\n` +
      `     on 15 Aekam Inc tasks.\n\n` +
      `     A fix is in this branch — server.py::assert_may_reach_task_thread,\n` +
      `     covered by backend/tests/test_task_comment_tenancy.py (9 tests,\n` +
      `     proved to bite by mutation). THIS TEST STAYS RED UNTIL THE BACKEND\n` +
      `     IS DEPLOYED. Do not relax it.\n`)
      .toContain(r.status());
  });

test('18.11 · APPROVALS and FILES stay inside the caller\'s own grants',
  async ({ page }) => {
    await signIn(page);

    // ── APPROVALS ──────────────────────────────────────────────────────────
    // `client_approvals` is scoped to approvals the caller raised or that sit
    // on a task explicitly shared with them, so every approval must name a task
    // the portal also returns. An approval on a task the caller cannot see is
    // the leak `19-client-portal.md` names by hand: the firm's own pending
    // queue, "internal staff requests they have no part in".
    const tasks = await orgGetJson(page, '/api/client/tasks');
    const approvals = await orgGetJson(page, '/api/client/approvals');
    const taskIds = new Set(tasks.map((t: any) => t.taskId));
    const orphaned = approvals
      .map((a: any) => a.taskId)
      .filter((id: string) => id && !taskIds.has(id));
    expect(orphaned,
      `\n  /client/approvals named ${orphaned.length} task(s) that /client/tasks\n` +
      `     does not return: ${orphaned.join(', ')}\n` +
      `     The two reads must agree, or the approvals list is a second door\n` +
      `     onto tasks the first one refuses.\n`)
      .toEqual([]);

    // Nor may an approval carry an address. `ClientApprovalOut` is an
    // allow-list with no email field, and the reason is on 19's never-see list:
    // "team member emails and phone numbers beyond the single named contact".
    for (const a of approvals) {
      const blob = JSON.stringify(a);
      expect(/[\w.+-]+@[\w-]+\.[\w.]+/.test(blob),
        `an approval row carries an email address: ${blob.slice(0, 200)}`).toBe(false);
      expect(UUID_RE.test(blob), `an approval row renders a UUID: ${blob.slice(0, 200)}`)
        .toBe(false);
    }

    // ── FILES ──────────────────────────────────────────────────────────────
    // `/client/files` is a reading of `/client/tasks`, so every file must hang
    // off a task the caller reaches, and every signed URL must be scoped to a
    // project in that same set. A file whose R2 key names a project the caller
    // cannot open is the attachment half of the same leak — and it would come
    // with a LIVE SIGNED URL, which is the part that outlives the session.
    const projects = await orgGetJson(page, '/api/client/projects');
    const projectIds = new Set(projects.map((p: any) => p.projectId));
    const stray: string[] = [];
    for (const t of tasks) {
      for (const f of (t.files || [])) {
        const m = String(f.url || '').match(/projects\/(team_[0-9a-f]+)\//);
        if (m && !projectIds.has(m[1])) stray.push(`${t.taskId} → ${m[1]}`);
      }
    }
    console.log(`  files across ${tasks.length} tasks: ` +
      `${tasks.reduce((n: number, t: any) => n + (t.files || []).length, 0)}`);
    expect(stray,
      `\n  A portal file carries a signed URL for a project the caller is not\n` +
      `     on: ${stray.join(', ')}\n` +
      `     A signed URL outlives the request that issued it.\n`)
      .toEqual([]);
  });

test('18.12 · the task_clients GRANT cannot be read across a tenant boundary',
  async ({ page }) => {
    await signIn(page);

    // ⚠ `task_clients` IS A GRANT OF ACCESS, not a label. A row in it is the
    // whole of a portal client's authority over a task — `client_tasks`,
    // `client_approvals`, `client_can_access_task` and `client-approve` all
    // read it. `POST`/`DELETE /api/tasks/{id}/clients/{user_id}` write it and
    // both are ORPHANED (no caller in either client;
    // `93-E-ORPHANED-CAPABILITY-SWEEP.md` §3.5) — a deployed write with no
    // screen behind it.
    //
    // Their WRITE side is NOT probed here. Both are `_require_admin`, a
    // PLATFORM role this lane does not hold, so the honest probe would be from
    // a god-mode credential — Suite 19's subject, not this one's — and a probe
    // that DID get through would have self-issued access to another tenant's
    // task and left the row behind. §12 makes that unacceptable and this repo's
    // rule makes it unnecessary: refusals belong in a backend test.
    //
    // What IS asserted is the read side of the same grant: the caller's own
    // task set must not grow a task from an org they hold nothing in.
    const tasks = await orgGetJson(page, '/api/client/tasks');
    const projects = await orgGetJson(page, '/api/client/projects');
    const projectIds = new Set(projects.map((p: any) => p.projectId));

    const unanchored = tasks
      .filter((t: any) => t.projectId && !projectIds.has(t.projectId))
      .map((t: any) => `${t.taskId}@${t.projectId}`);
    console.log(`  ${tasks.length} portal tasks across ` +
      `${new Set(tasks.map((t: any) => t.projectId)).size} projects`);
    expect(unanchored,
      `\n  /client/tasks returned a task whose project /client/projects does not\n` +
      `     list: ${unanchored.join(', ')}\n` +
      `     The two reads scope differently — tasks by five personal legs,\n` +
      `     projects by assignment or org role — so a divergence is a task\n` +
      `     reachable through a door the project list does not admit.\n`)
      .toEqual([]);

    // And the foreign task must not be in the set by any route at all.
    const ids = new Set(tasks.map((t: any) => t.taskId));
    for (const foreign of [FOREIGN_TASK, FOREIGN_TASK_WITH_THREAD]) {
      expect(ids.has(foreign),
        `${foreign} is an Aekam Inc task and it reached this account's portal ` +
        `task list — a task_clients row, an assignee entry or a leak`).toBe(false);
    }
  });

/* ══════════════════════════════════════════════════════════════════════════
   18.13 · THE §12 FIXTURE, RE-READ
   ══════════════════════════════════════════════════════════════════════════ */

test('18.13 · the protected 20 are intact and this suite wrote nothing outside Unicode',
  async ({ page }) => {
    await signIn(page);

    // §12: "Before and after the admin suite, every Aekam-scoped table is
    // counted … and the counts must be identical." This suite touches no Aekam
    // table at all, so the check is narrower and exact: the protected team, by
    // id, still carries its 20 tasks.
    const teams = await orgGetJson(page, '/api/teams');
    const team = (Array.isArray(teams) ? teams : teams.teams || [])
      .find((t: any) => t.team_id === PROTECTED_TEAM);
    expect(team, `${PROTECTED_TEAM} vanished from this org's team list`).toBeTruthy();
    expect(team.name, 'the protected team was renamed').toBe('Aekam Inc');

    // `task_count` on `TeamOut`. Measured 2026-08-29: 20 rows total, 19 with
    // `archived_at IS NULL`. Whichever of the two this endpoint reports, it
    // must not have MOVED — so both are accepted and a third value fails.
    const n = team.task_count;
    console.log(`  ${PROTECTED_TEAM} "${team.name}" task_count=${n} ` +
      `(20 total / 19 live on 2026-08-29)`);
    expect([PROTECTED_TASK_TOTAL, PROTECTED_TASK_TOTAL - 1],
      `\n  ⚠ THE PROTECTED SET MOVED. ${PROTECTED_TEAM} reports ${n} tasks;\n` +
      `     proposal 93 §12 guarantees 20 (19 live + 1 archived), measured\n` +
      `     2026-08-29. Something in this session wrote to the one team the\n` +
      `     programme promises not to touch.\n`)
      .toContain(n);

    // The roster of the protected team must not have gained the address 18.06
    // typed — the sharpest available proof that the write landed where it was
    // pointed.
    const detail = await orgGetJson(page, `/api/teams/${PROTECTED_TEAM}`);
    const roster = detail.members || [];
    expect(roster.some((m: any) => (m.email || '').toLowerCase() === PORTAL_CLIENT_EMAIL),
      `18.06's project client landed on the PROTECTED team instead of ${OWN_TEAM}`)
      .toBe(false);
    expect(roster.some((m: any) => m.role === 'client'),
      'the protected team gained a client role — §12 says nothing on it moves')
      .toBe(false);

    // And the projects this org owns are still the projects this org owns —
    // the org-level version of the same guarantee.
    const list = Array.isArray(teams) ? teams : teams.teams || [];
    console.log(`  ${LANE.org} holds ${list.length} projects at the end of this suite`);
    expect(list.length, 'the org lost or gained projects during a read-only suite')
      .toBeGreaterThan(0);
  });
