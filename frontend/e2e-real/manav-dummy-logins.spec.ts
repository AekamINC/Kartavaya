/**
 * PHASE 0.23 — DUMMY LOGINS, LINKED TO REAL EMPLOYEE RECORDS.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * `staging.manav_employees.user_id` was NULL on every one of E2E Test &
 * Associates' 83 employee rows (measured 2026-08-26). That single column is the
 * only join between the personnel side of the product and the account side, so
 * with it empty:
 *
 *   · `pahchan._employee_for` returns None for every caller, and `create_punch`
 *     answers 409 "Your account is not linked to an employee record" — which is
 *     the one reason the new web clock-in screen
 *     (`frontend/src/pages/pahchan/Clock.jsx`) shipped 🟡 rather than ✅.
 *   · `manav._own_employee_id` returns None, so every self-service surface —
 *     own payslip, own attendance, own leave — answers as though the
 *     organisation employs nobody.
 *   · every e2e suite drives the SAME god-mode account, so no spec has ever
 *     exercised what an org_member with a narrow grant can actually reach.
 *
 * The owner's decision, 2026-08-26: *"Create dummy logins and link 10–15
 * employees. Most links are arithmetically impossible and that is fine — a
 * login is a tool, not a record."*
 *
 * ── THE MECHANISM IS NOT BUILT HERE ─────────────────────────────────────────
 *
 * Nothing in this file is a workaround for a missing feature. All three halves
 * already exist and this spec only DRIVES them:
 *
 *   · `POST /v1/org/members`            → `org_members.py:237` — an address with
 *     no account becomes an invitation (`preflight_org_invite` → `issue_invite`).
 *   · `POST /auth/accept-invite`        → `auth_router.py:1141` — mints the
 *     account, writes the grant rows, and (`:1099`) AUTO-LINKS the employee when
 *     the invitation names one.
 *   · `PUT /v1/org/members/{id}/modules` → `org_members.py:564` — the grants,
 *     which have to land here rather than on the invitation. See `defect ·`.
 *   · `POST /v1/manav/employees/{id}/link` → `manav.py:1706` — the explicit
 *     link, which is what these twelve use because the employees already exist.
 *
 * ── DATA IS ENTERED AS A REAL USER, THROUGH THE PRODUCT'S OWN FORMS ─────────
 *
 * The owner's standing rule. There is not one INSERT in this file. The
 * invitation is typed into Organisation ▸ Members, the password is chosen at
 * /accept-invite, and the link is made from the Manav employee record — the same
 * three screens a customer uses. The one thing no UI can do is read an
 * invitation token out of an unreadable @example.com mailbox, and that is not
 * done with SQL either: `POST /v1/org/members` RETURNS `invite_link`, and the
 * screen itself offers it as "Copy invite link". The spec reads the write
 * response, exactly as the admin reads the button.
 *
 * ── SCOPE: E2E TEST & ASSOCIATES, AND NOTHING ELSE ──────────────────────────
 *
 * Unicode Group is a real customer with real people and is NOT on
 * `OUTBOUND_SUPPRESSED_ORGS` — an invitation raised there really sends. Every
 * test below runs `assertOutboundFenceFor(page, TARGET_ORG)`, which derives the
 * fence from the org the SESSION is in rather than from an environment
 * variable, because a fence that attests about an org the session is not in is
 * not a fence (`_helpers.ts:325`). Every address is `@example.com`, RFC 2606
 * reserved, so even a cleared Railway variable cannot reach a real inbox.
 *
 * ── ⚠ ONE MAIL PER ACCEPTANCE STILL LEAVES THE BUILDING ─────────────────────
 *
 * READ THIS BEFORE ADDING ROWS. Measured from `staging.outbound_log`, this run,
 * 2026-08-26:
 *
 *   purpose=invite    status=suppressed   org_id=64e7bea6…   ✓ the fence holds
 *   purpose=welcome   status=SENT         org_id=NULL        ✗ it does not
 *
 * `auth_router.py:1267` sends `send_welcome_email` at the end of
 * `accept_invite`. That endpoint is unauthenticated and has no `get_org_id`
 * dependency, so `outbound.set_org` never runs, the send is attributed to NO
 * org, and `_org_suppressed(None)` answers False (`outbound.py:243`) — only
 * `OUTBOUND_MODE` governs it, and staging runs `live`. The invitation knows its
 * organisation (`invite["org_id"]`, used twenty lines earlier for the employee
 * auto-link), so the fence has everything it needs and is simply not asked.
 *
 * The consequence is not confined to this spec: EVERY acceptance into a
 * suppressed organisation mails the new account. Here it is bounded and aimed
 * at the least-bad possible target — twelve `@example.com` addresses, which
 * RFC 2606 reserves and RFC 7505 gives a null MX, so they are refused at the
 * recipient's edge rather than looping. It is still twelve hard bounces at the
 * verified sender domain, and that is a cost this file should not be able to
 * repeat silently. DO NOT scale the table below until `accept_invite` sets the
 * org on that send.
 *
 * ── RE-RUNNABLE, AND IT NEVER DOUBLE-INVITES ────────────────────────────────
 *
 * Each of the twelve rows is pinned to an employee CODE (EMP-001…EMP-012), so a
 * second run resolves the same twelve records rather than whichever twelve the
 * directory happens to sort first. Each row then asks, in order:
 *
 *   1. is this employee already linked to OUR account?  → assert and stop.
 *   2. does the account already exist in this org?      → skip the invitation,
 *                                                         link only.
 *   3. neither                                          → invite, accept, link.
 *
 * So the first run creates twelve accounts and twelve links; every run after it
 * proves the twelve are still there and writes nothing.
 *
 * ── CREDENTIALS ─────────────────────────────────────────────────────────────
 *
 * `E2E_DUMMY_NN_EMAIL` / `E2E_DUMMY_NN_PASSWORD` in `.env.e2e` (gitignored,
 * untracked). A missing pair is a FAILURE, never a skip — this file does not
 * invent an address, because an address invented at runtime would create a
 * thirteenth account on the shared database every time the suite ran.
 *
 * Run:
 *   node e2e-real/mint-state.mjs
 *   npx playwright test --config e2e-real/onefile.config.ts manav-dummy-logins
 */
import { test, expect, Page } from '@playwright/test';
import {
  RUN, api, apiOk, settle, openTab, shot, submitting, pickOption,
  useOrg, activeOrgId, assertOutboundFenceFor,
} from './_helpers';
import { GODMODE_STATE } from './real.config';

// ── NO TRACE, NO VIDEO, AND THAT IS A DELIBERATE TRADE ──────────────────────
//
// The config's `trace: 'on'` cost this file two false failures in one evening,
// both of them AFTER the journey had already succeeded:
//
//   · a 22MB trace serialised on a PASSING test pushed EMP-004 past its
//     timeout — a green journey reported as a red one;
//   · `context.close()` threw `ENOENT … .playwright-artifacts-0/…recording.trace`
//     twice, because a live trace recording is a file in `outputDir` and
//     Playwright EMPTIES `outputDir` when any run against this config starts.
//     Five agents share this working tree, so a second `playwright test`
//     landing mid-journey is a standing condition, not an accident. Giving this
//     spec its own `outputDir` (onefile.config.ts) did not fix it: the same
//     config is what the other run cleans.
//
// Recording nothing removes the file that gets deleted. What is lost is the
// trace viewer; what is kept is the failure message, a screenshot, and — the
// evidence that actually matters here — the ROWS, which every test reads back
// from the server and which outlive any run. File-scoped: no other spec's
// evidence changes.
test.use({
  storageState: GODMODE_STATE,
  trace: 'off',
  video: 'off',
  screenshot: 'only-on-failure',
});
// `timeout` here as well as `test.setTimeout` in the bodies: the per-test call
// did not cover the fixture teardown that overran, and this does.
test.describe.configure({ mode: 'serial', timeout: 300_000 });

/** E2E Test & Associates [TEST ORG]. The ONLY org this file may touch. */
const TARGET_ORG = '64e7bea6-6abe-490c-a2a4-27a60c6be916';
const TARGET_NAME = /E2E Test & Associates/i;
/** Unicode Group — a real customer, never written to, asserted against below. */
const FORBIDDEN_ORG = 'fae87907-2f99-4b35-a241-c94d9e1e4a17';

const BASE = process.env.E2E_BASE_URL || 'https://staging.kartavaya.com';

/** The DPDP notice version the clock screen serves (`pahchan.py:521`). */
const NOTICE_VERSION = '2026-08-06.1';

/**
 * ONE punch id, for ever. `create_punch` is idempotent on
 * (org_id, client_punch_id, employee_id), so a stable id means this spec adds
 * exactly ONE attendance row to the shared database across every run it will
 * ever have — the row that proves the 409 is gone — and a re-run reads it back
 * as `duplicate: true` rather than piling up a punch a month.
 */
const CLOCK_PUNCH_ID = 'e2e-phase023-first-linked-clock-in';

type Grant = { code: string; label: string; level: 'viewer' | 'editor' | 'approver' | 'admin' };

type Row = {
  /** The `NN` in `E2E_DUMMY_NN_EMAIL`. */
  n: string;
  /** Pins the employee record. Names repeat in this org; codes do not. */
  code: string;
  /** What the person types into the accept-invite form. */
  name: string;
  role: 'org_admin' | 'org_member';
  grants: Grant[];
};

/**
 * TWELVE ROWS, AND WHY EACH ONE IS DIFFERENT.
 *
 * `INVITABLE_ROLES` is only ('org_owner', 'org_admin', 'org_member')
 * (`org_invites.py:67`), and org_owner may be granted only by another owner —
 * so the Tier-2 spread available to any UI is two codes wide. The rest of the
 * spread is Tier 4: the per-module grant LEVEL, which is what actually decides
 * what a session reaches (`middleware/role_tiers.level_satisfies`).
 *
 * So the twelve are chosen to give the suites one account per authority shape
 * that exists today, rather than twelve copies of the same seat:
 *
 *   org_admin           reaches every ACTIVE module by role alone
 *                       (`subscription.py`'s org-role short-circuit) — the
 *                       shape most specs already assume they are driving.
 *   pahchan:editor      clocks in. THE shape the Pahchan gap was about.
 *   pahchan:admin       the attendance REVIEWER, who approves other people's.
 *   manav:viewer        reads the directory but changes nothing.
 *   manav:admin         personnel files — an HR administrator in all but name.
 *   vetana:admin        defines salary structures and CANNOT release money —
 *                       the half of the separated-duty pair an org_admin is
 *                       allowed to hand out. The approver half is owner-only
 *                       (`role_tiers.grant_needs_owner_authority`) and E2E
 *                       already has one; see the note on row 08.
 *   ganit:admin         the books at admin.
 *   ganit:editor        the books below it, so the level itself is drivable.
 *   graha+vikray editor two modules at once, the ordinary commercial seat.
 *   (no grants)         the narrowest seat the product can issue: core PM and
 *                       notifications, every module: entry hidden from the rail.
 *
 * `hr_admin`, `org_client` and `aekam_team` are deliberately ABSENT and cannot
 * be produced from any screen — see the report at the foot of this file.
 */
const ROWS: Row[] = [
  { n: '01', code: 'EMP-001', name: 'Isha Desai', role: 'org_admin', grants: [] },
  { n: '02', code: 'EMP-002', name: 'Kabir Malhotra', role: 'org_admin', grants: [] },
  {
    n: '03', code: 'EMP-003', name: 'Tara Mehta', role: 'org_member',
    grants: [
      { code: 'manav', label: 'Manav', level: 'viewer' },
      { code: 'pahchan', label: 'Pahchan', level: 'editor' },
    ],
  },
  {
    n: '04', code: 'EMP-004', name: 'Vivaan Joshi', role: 'org_member',
    grants: [
      { code: 'manav', label: 'Manav', level: 'viewer' },
      { code: 'pahchan', label: 'Pahchan', level: 'editor' },
    ],
  },
  {
    n: '05', code: 'EMP-005', name: 'Anaya Saxena', role: 'org_member',
    grants: [
      { code: 'manav', label: 'Manav', level: 'viewer' },
      { code: 'pahchan', label: 'Pahchan', level: 'editor' },
    ],
  },
  {
    n: '06', code: 'EMP-006', name: 'Reyansh Patel', role: 'org_member',
    grants: [{ code: 'pahchan', label: 'Pahchan', level: 'admin' }],
  },
  {
    n: '07', code: 'EMP-007', name: 'Myra Bansal', role: 'org_member',
    grants: [
      { code: 'manav', label: 'Manav', level: 'admin' },
      { code: 'pahchan', label: 'Pahchan', level: 'editor' },
    ],
  },
  {
    // ── NOT `vetana: approver`, and the reason is a product rule ────────────
    // `role_tiers.grant_needs_owner_authority` makes approver on a
    // separated-duty module (vetana, ganit) an OWNER's decision, and every
    // account this suite can authenticate as is an org_admin — including god
    // mode, which holds an `org_admin` row in this org rather than no row at
    // all, so the rule fires rather than being skipped. Measured live: `PUT
    // /org/members/{id}/modules` → 403 "Only an organisation owner can grant
    // approver on vetana." That is the rule working, not a defect.
    //
    // It costs nothing here: E2E ALREADY HAS a payroll approver — the seeded
    // "E2E Test Approver", whose password is `E2E_APPROVER_PASSWORD` — so the
    // approver shape is already drivable and this row is spent on one that is
    // not. `ganit: admin` is the books at admin, which no other row holds.
    n: '08', code: 'EMP-008', name: 'Advik Rao', role: 'org_member',
    grants: [{ code: 'ganit', label: 'Ganit', level: 'admin' }],
  },
  {
    n: '09', code: 'EMP-009', name: 'Kiara Agarwal', role: 'org_member',
    grants: [{ code: 'vetana', label: 'Vetana', level: 'admin' }],
  },
  {
    n: '10', code: 'EMP-010', name: 'Arnav Kulkarni', role: 'org_member',
    grants: [{ code: 'ganit', label: 'Ganit', level: 'editor' }],
  },
  {
    n: '11', code: 'EMP-011', name: 'Saanvi Verma', role: 'org_member',
    grants: [
      { code: 'graha', label: 'Graha', level: 'editor' },
      { code: 'vikray', label: 'Vikray', level: 'editor' },
    ],
  },
  { n: '12', code: 'EMP-012', name: 'Vihaan Iyer', role: 'org_member', grants: [] },
];

/**
 * The sensitive three. A grant on one of these at approver or admin raises a
 * confirmation before it is saved (`catalogue.sensitiveGrantRaises`), and this
 * spec asserts that dialog IS there rather than clicking past whatever appears
 * — a confirmation that silently stopped appearing is a real regression and
 * would otherwise pass unnoticed.
 */
const SENSITIVE = new Set(['ganit', 'kray', 'vetana', 'manav']);
const needsConfirm = (r: Row) =>
  r.grants.some(g => SENSITIVE.has(g.code) && (g.level === 'approver' || g.level === 'admin'));

/** Credentials, or a FAILURE naming the missing line. Never invented. */
function creds(n: string): { email: string; password: string } {
  const email = process.env[`E2E_DUMMY_${n}_EMAIL`];
  const password = process.env[`E2E_DUMMY_${n}_PASSWORD`];
  expect(email, `E2E_DUMMY_${n}_EMAIL is not in .env.e2e — this spec never invents an ` +
    'address, because an invented one creates another account on the shared database ' +
    'on every run').toBeTruthy();
  expect(password, `E2E_DUMMY_${n}_PASSWORD is not in .env.e2e`).toBeTruthy();
  expect(email!, `E2E_DUMMY_${n}_EMAIL must be @example.com (RFC 2606) — a routable ` +
    'address here would mail a real person').toMatch(/@example\.com$/);
  return { email: email!, password: password! };
}

const state: {
  linkedBefore?: number;
  employeesBefore?: number;
  linkedNow: Set<string>;
} = { linkedNow: new Set() };

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), TARGET_ORG);
  await page.goto('/manav');
  await settle(page);
  const org = await activeOrgId(page);
  expect(org, 'the session is not pointed at E2E Test & Associates').toBe(TARGET_ORG);
  expect(org, 'the session is pointed at Unicode Group — a real customer whose mail ' +
    'REALLY SENDS. Nothing in this file may run there.').not.toBe(FORBIDDEN_ORG);
});

// ══ THE FENCE, AND THE BASELINE ══════════════════════════════════════════════

test('fence · the session is in E2E, and E2E is shielded, before any invitation',
  async ({ page }) => {
    await useOrg(page, TARGET_ORG, TARGET_NAME);
    await assertOutboundFenceFor(page, TARGET_ORG);
  });

test('baseline · how many employees carry a login before this run', async ({ page }) => {
  // The DELTA endpoint, not the directory. `GET /manav/employees` caps at 500
  // and this org has 83, so it would work today — but the counts here are
  // computed server-side over the whole table, which is what makes the
  // before/after comparison a fact rather than a page of it.
  const q = await apiOk(page, 'get', '/api/v1/manav/employees/awaiting-link');
  state.linkedBefore = Number(q.counts.linked);
  state.employeesBefore = Number(q.counts.employees);
  expect(Number.isFinite(state.linkedBefore),
    'awaiting-link did not return counts.linked').toBe(true);
  // eslint-disable-next-line no-console
  console.log(`baseline · ${state.linkedBefore} of ${state.employeesBefore} employees ` +
    'in E2E carry a login');
});

/**
 * A LIVE DEFECT, PINNED WITHOUT WRITING A ROW.
 *
 * `POST /api/v1/org/members` answers 500 for ANY non-empty `module_grants`, and
 * the 500 escapes `CORSMiddleware` so the browser reports it as a CORS failure
 * and the screen says only "Failed to add member".
 *
 *   backend/routers/org_members.py:188   `module_grants: list = []`  — untyped,
 *                                        so the items stay raw dicts.
 *   backend/routers/org_invites.py:184   `g.code` on those dicts → AttributeError.
 *
 * `POST /v1/org/invites` types the same field as `List[GrantIn]`
 * (`org_invites.py:105`), so Pydantic coerces there and the identical payload
 * answers a clean 400. The two doors into one function disagree about the shape
 * of what they hand it.
 *
 * It is not an edge case: the Add-or-invite form pre-populates every
 * non-sensitive active module (`ModuleGrantEditor.defaultGrantsFor`), so the
 * button is broken for every invitation an admin sends unless they first go into
 * the picker and clear all nine by hand — which is exactly what
 * `inviteFromMembersTab` below has to do.
 *
 * THE PROBE NEVER WRITES, in either direction. It names a module the
 * organisation does not have, so a WORKING endpoint refuses it 400 "Unknown
 * module" before it reaches a seat count or an INSERT, and a BROKEN one raises
 * on the attribute access before it reaches the check. That makes this safe to
 * leave in the suite for ever: when the fix lands this test fails with the
 * sentence below, and the workaround above can come out.
 */
test('defect · POST /org/members still 500s on any module grant (org_members.py:188)',
  async ({ page }) => {
    const res = await api(page, 'post', '/api/v1/org/members', {
      email: 'never.created@example.com',
      role: 'org_member',
      module_grants: [{ code: 'a-module-no-org-has', role: 'viewer' }],
    });
    const body = await res.text();

    expect(res.status(), 'POST /v1/org/members no longer 500s on a module grant — the ' +
      'untyped `module_grants: list` at backend/routers/org_members.py:188 has been ' +
      'given a type. DELETE the module-clearing in inviteFromMembersTab() below and ' +
      'let the invitation carry its grants again, then delete this test. ' +
      `The server answered ${res.status()}: ${body}`)
      .toBe(500);
  });

// ══ THE TWELVE ═══════════════════════════════════════════════════════════════

for (const row of ROWS) {
  const grantWords = row.grants.length
    ? row.grants.map(g => `${g.code}:${g.level}`).join(' ')
    : 'no module grants';

  test(`${row.code} · ${row.name} gets a login and is linked — ${row.role}, ${grantWords}`,
    async ({ page, browser }) => {
      // Three screens and two browser contexts in one test. The config's 90s is
      // sized for a single form; a first run here is invite + accept + link and
      // legitimately takes longer. A re-run, where all three are already done,
      // finishes in a couple of seconds.
      test.setTimeout(240_000);
      const { email, password } = creds(row.n);

      // ── The employee, resolved by CODE ────────────────────────────────────
      // Names repeat in this directory — EMP-001 and EMP-021 are both "Isha
      // Desai" — so a lookup by name would link a login to whichever of the two
      // the planner reached first. `search` matches employee_code as well as
      // name and email (`manav.py:1118`).
      const found = await apiOk(page, 'get',
        `/api/v1/manav/employees?search=${encodeURIComponent(row.code)}`);
      const matches = (found.data ?? []).filter((e: any) => e.employee_code === row.code);
      expect(matches.length,
        `expected exactly one active employee with code ${row.code} in E2E, saw ` +
        `${matches.length}. This spec pins employees by code; if the seed changed, ` +
        'the row above must change with it.').toBe(1);
      const employee = matches[0];

      // ── Already done? Then this run writes nothing ────────────────────────
      if (employee.user_id) {
        const canonical = await apiOk(page, 'get', `/api/v1/manav/employees/${employee.id}`);
        expect(canonical.login?.email?.toLowerCase(),
          `${row.code} is linked to a DIFFERENT account than this spec owns. That is ` +
          'either a deliberate link somebody else made or a wrong one; unlink it from ' +
          'Manav ▸ Link logins before re-running.').toBe(email.toLowerCase());
        await ensureGrants(page, row, email);
        state.linkedNow.add(row.code);
        return;
      }

      // ── Does the account exist already? ───────────────────────────────────
      // `link-candidates` is every account in this org. Asking it is what stops
      // a re-run raising a second invitation for an address that already has a
      // login — which `preflight_org_invite` would 409 anyway, but a 409 read as
      // a failure is how a green suite turns red for a correct reason.
      const candidates = await apiOk(page, 'get', '/api/v1/manav/employees/link-candidates');
      const already = (candidates.data ?? [])
        .find((c: any) => String(c.email || '').toLowerCase() === email.toLowerCase());

      if (!already) {
        await inviteFromMembersTab(page, row, email);
        await acceptTheInvitation(browser, row, email, password);
      }

      // OUTSIDE the branch, deliberately. An earlier run that created the
      // account and then failed on the grants would otherwise skip them for
      // ever, and the account would sit in the org holding nothing while the
      // spec reported it green.
      await ensureGrants(page, row, email);

      // ── Link, from the employee's own record ──────────────────────────────
      await linkFromTheEmployeeRecord(page, row, employee.id, email);
      state.linkedNow.add(row.code);
    });
}

// ══ THE DELTA ════════════════════════════════════════════════════════════════

test('delta · the linked count moved, and all twelve are in the linked half', async ({ page }) => {
  const q = await apiOk(page, 'get', '/api/v1/manav/employees/awaiting-link');
  const after = Number(q.counts.linked);

  expect(state.linkedNow.size,
    'not every row reached a link — read the failures above, not this line')
    .toBe(ROWS.length);

  // A DELTA, never an absolute. Somebody else linking an employee by hand
  // between two runs is a legitimate thing that must not fail this spec, and an
  // absolute assertion would make every such link a red suite.
  expect(after, `linked went from ${state.linkedBefore} to ${after}; this spec owns ` +
    `${ROWS.length} of them, so it must be at least ${(state.linkedBefore ?? 0)}`)
    .toBeGreaterThanOrEqual(state.linkedBefore ?? 0);
  expect(after, `only ${after} employees carry a login and this spec links ` +
    `${ROWS.length} — the count did not move`).toBeGreaterThanOrEqual(ROWS.length);

  // And the canonical rows say so, one at a time, from the endpoint the screen
  // reads rather than from the count.
  const linkedCodes = new Set((q.linked ?? []).map((e: any) => e.employee_code));
  for (const row of ROWS) {
    expect(linkedCodes.has(row.code),
      `${row.code} is not in awaiting-link's linked half, so the link did not stick`)
      .toBe(true);
  }
  // eslint-disable-next-line no-console
  console.log(`delta · linked ${state.linkedBefore} → ${after} of ${q.counts.employees}`);
});

// ══ THE POINT OF ALL OF IT: create_punch STOPS ANSWERING 409 ════════════════

test('clock-in · a linked account punches, where every account used to 409',
  async ({ page, browser }) => {
    test.setTimeout(180_000);
    const row = ROWS[0];                       // org_admin, so Pahchan by role
    const { email, password } = creds(row.n);

    const ctx = await browser.newContext({ baseURL: BASE });
    const p = await ctx.newPage();
    try {
      // Signed in through the real form, as this person. `login` is rate
      // limited at 5/min, which is why exactly one account signs in here.
      await p.goto('/login');
      const emailBox = p.locator('#au-email, input[type="email"]').first();
      const passBox = p.locator('#au-password, input[type="password"]').first();
      await expect(emailBox, 'the sign-in form has no email field').toBeVisible();
      await emailBox.fill(email);
      await passBox.fill(password);
      await p.getByRole('button', { name: /Sign in|Log ?in/i }).first().click();
      await p.waitForURL(/\/(dashboard|boards|tasks|projects)/, { timeout: 45_000 });

      // ── The screen ────────────────────────────────────────────────────────
      await p.goto('/pahchan');
      await settle(p);
      await openTab(p, /Clock in/);
      const panel = p.locator('[role="tabpanel"]').first();

      // ── WAIT FOR THE PANEL TO HAVE AN ANSWER BEFORE READING IT ───────────
      //
      // `Clock` renders a skeleton until `GET /pahchan/me` lands, so asking
      // "is the notice button there?" the instant the tab opens asks an empty
      // panel and gets `count() === 0`. That is not "already acknowledged" — it
      // is "not drawn yet", and the two are opposite instructions. Measured:
      // the acknowledgement was silently skipped, the gate never cleared, and
      // the failure surfaced twenty seconds later on the wrong assertion.
      //
      // The three states this panel can settle into are the notice gate, the
      // ready state, and the unlinked refusal. Waiting for whichever arrives
      // means the read below is a read of a decided screen.
      const ackBtn = panel.getByRole('button', { name: /I have read this/i });
      const readyLede = panel.getByText(/A selfie is recorded with every punch/i);
      const notLinked = panel.getByText(/not linked to an employee record/i);
      await expect(ackBtn.or(readyLede).or(notLinked),
        'the Clock panel never resolved into any of its three states — /pahchan/me ' +
        'did not answer, or the tab that opened is not the clock screen')
        .toBeVisible({ timeout: 30_000 });

      // The DPDP notice gates the camera, and it comes BEFORE the punch by
      // design (07 §9). Acknowledged the way a person does — a button, not a
      // POST — because the whole point of the gate is that it was on screen.
      if (await ackBtn.count()) {
        await submitting(p, '/pahchan/notice/ack', async () => { await ackBtn.first().click(); });
      }

      // THE ASSERTION THIS WHOLE PHASE EXISTS FOR. Before the link, this panel
      // rendered exactly one thing: "Your account is not linked to an employee
      // record yet" (`Clock.jsx:310`). It must be gone, and the ready state —
      // which is direction-independent, because a second run starts from
      // "Clock out" — must be there instead.
      await expect(notLinked,
        'the clock screen still says this account is not linked to an employee ' +
        'record — the link did not take, or the session is in the wrong org')
        .toHaveCount(0);
      await expect(readyLede,
        'the clock screen is not offering a punch, so create_punch cannot be reached ' +
        'from the surface a person actually uses')
        .toBeVisible({ timeout: 20_000 });
      await shot(p, `p023-clock-ready-${RUN}`);

      // ── The endpoint ──────────────────────────────────────────────────────
      // Driven directly rather than through the camera: `getUserMedia` needs a
      // fake-device browser flag this config does not set, and the 409 was never
      // about the photograph. `create_punch` is idempotent on the id above, so
      // this writes ONE row ever and reads it back on every later run.
      const punchRes = await api(p, 'post', '/api/v1/pahchan/punch', {
        direction: 'in',
        captured_at: new Date().toISOString(),
        client_punch_id: CLOCK_PUNCH_ID,
      });
      const punchBody = await punchRes.text();
      expect(punchRes.status(),
        `POST /pahchan/punch → ${punchRes.status()}: ${punchBody}. A 409 here means ` +
        'manav_employees.user_id is still NULL for this account — the link is what ' +
        'this endpoint reads (`pahchan._employee_for`).')
        .toBeLessThan(300);
      const out = JSON.parse(punchBody);
      const punch = out.punch ?? out;
      expect(punch.id, 'the punch response carries no id, so nothing was recorded')
        .toBeTruthy();
      expect(String(punch.direction), 'the punch was recorded in the wrong direction')
        .toBe('in');

      // ── And the person can now see their OWN record ───────────────────────
      // `manav._own_employee_id` is the other reader of the same column. A link
      // that satisfied Pahchan and not Manav would be half a link.
      const mine = await api(p, 'get', '/api/v1/manav/employees');
      expect(mine.status(), `GET /manav/employees as a linked employee → ${mine.status()}`)
        .toBeLessThan(400);
      const mineBody = await mine.json();
      const names = (mineBody.data ?? []).map((e: any) => e.name);
      expect(names, `a linked employee sees a directory that does not contain them; saw ` +
        `${names.length} row(s)`).toContain(row.name);
    } finally {
      await ctx.close();
    }
  });

// ══ THE THREE STEPS, WRITTEN ONCE ════════════════════════════════════════════

/**
 * Organisation ▸ Members ▸ Add or invite a member.
 *
 * The address has no account, so `add_member` falls through to
 * `preflight_org_invite` + `issue_invite` and answers `status: "invited"` with
 * the link.
 *
 * ── WHY THE MODULE PICKER IS EMPTIED FIRST ──────────────────────────────────
 *
 * The invitation is SUPPOSED to carry its grants — `org_members.py:301` passes
 * `pre.grants` and `accept_invite` writes them (`auth_router.py:1024`) — and it
 * cannot today, because that endpoint 500s on any non-empty `module_grants`.
 * The test named `defect ·` above pins that, with the file and line.
 *
 * The form pre-populates nine, so leaving it alone fails EVERY invitation. The
 * picker is therefore opened and cleared, which is a control the screen offers
 * and a state it describes in words ("No modules — they will reach projects and
 * tasks only"). The grants are then applied after acceptance from the member's
 * own sheet, which goes through `PUT .../modules` and `_normalise_grant`
 * (`org_members.py:49`) — the path that DOES accept a dict.
 *
 * That is the workaround written down rather than hidden, and the pinned test
 * is what deletes it: when the 500 is fixed that test fails and says so.
 */
async function inviteFromMembersTab(page: Page, row: Row, email: string) {
  await page.goto('/settings/organisation?tab=members');
  await settle(page);

  // Scoped to the add form, not the page: the members table below carries
  // addresses and role words too, and a loose lookup finds one of those.
  const emailBox = page.locator('#add-email');
  await expect(emailBox, 'the Members tab has no "Add or invite a member" email field')
    .toBeVisible({ timeout: 20_000 });
  await emailBox.fill(email);

  const roleSelect = page.locator('#add-role');
  await expect(roleSelect, 'the Members tab has no role picker').toBeVisible();
  await roleSelect.selectOption(row.role);

  // ── Empty the picker. See the note above ─────────────────────────────────
  const choose = page.getByRole('button', { name: /^Choose modules$/ });
  await expect(choose, 'the add form offers no module picker, so the nine default grants ' +
    'cannot be cleared and every invitation from this screen will 500')
    .toBeVisible();
  await choose.click();

  const sheet = page.getByRole('dialog').filter({ hasText: /Module access/ }).first();
  await expect(sheet, 'the module-access sheet did not open').toBeVisible();
  const boxes = sheet.getByRole('checkbox');
  const n = await boxes.count();
  expect(n, 'the module sheet lists no modules at all').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const box = boxes.nth(i);
    if ((await box.getAttribute('aria-checked')) === 'true') await box.click();
  }
  await sheet.getByRole('button', { name: /^Use these modules$/ }).click();
  await expect(sheet, 'the module sheet stayed open after saving').toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('add-grants-summary'),
    'the add form still carries module grants, and the invitation will 500 on them')
    .toHaveText(/No modules/i);

  // ── The write, and the token, from the RESPONSE ──────────────────────────
  // Never from the "Invited" list below: `OrgInviteOut` has no `token` field on
  // purpose (`org_invites.py` module docstring), so the list CANNOT answer this
  // and reading it would be reading the wrong thing on principle.
  const created = await submitting(page, '/v1/org/members', async () => {
    await page.getByRole('button', { name: /^Add or invite$/ }).click();
  });

  expect(created.status, `expected an INVITATION for ${row.code}; the server answered ` +
    `"${created.status}", which means this address already had an account`).toBe('invited');
  expect(String(created.email || '').toLowerCase(),
    'the invitation was raised for a different address').toBe(email.toLowerCase());
  expect(String(created.role || ''), `${row.code} was invited at the wrong org role`)
    .toBe(row.role);
  expect(String(created.invite_link || ''),
    'the invitation carries no link, so there is no token to accept with')
    .toContain('token=');

  const token = new URL(created.invite_link).searchParams.get('token');
  expect(token, 'the invite link has no token parameter').toBeTruthy();
  (row as any)._token = token;
}

/**
 * Organisation ▸ Members ▸ (the row) ▸ Edit module grants.
 *
 * Where the grants land, because the invitation could not carry them. This is
 * `PUT /v1/org/members/{id}/modules`, which normalises `{code, role}` through
 * `_normalise_grant` and is not affected by the 500 above.
 *
 * REPLACE semantics: whatever is in the sheet when it is saved is what the
 * person holds afterwards. The accounts arrive with nothing, so ticking exactly
 * the wanted set is the whole grant.
 */
async function ensureGrants(page: Page, row: Row, email: string) {
  const want = row.grants.map(g => `${g.code}:${g.level}`).sort();

  // Read first, and write only if the answer is wrong. That is what makes a
  // re-run of all twelve cost twelve API calls instead of twelve trips through
  // a modal — and it is also the check itself: a grant silently demoted to
  // viewer is the exact defect `TabMembers.jsx:24` records, and a spec that
  // only ever verified its own writes would never see one happen afterwards.
  if ((await heldGrants(page, row, email)).join('|') === want.join('|')) return;

  expect(row.grants.length, `${row.code}'s account holds module grants this spec did not ` +
    'give it. Nothing here removes a grant somebody else made — clear it from ' +
    'Organisation ▸ Members if that is the intention.').toBeGreaterThan(0);

  await page.goto('/settings/organisation?tab=members');
  await settle(page);

  // The member row, found by the address rather than by the name — two people
  // may share a name and this list has already had a "shared name" warning
  // built for it.
  const memberRow = page.locator('tr').filter({ hasText: email }).first();
  await expect(memberRow, `${email} is not in the member list, so the acceptance did not ` +
    'put them in this organisation').toBeVisible({ timeout: 25_000 });

  // WAIT FOR THE LIST TO STOP MOVING BEFORE OPENING THE MENU. This tab fires
  // TWO fetches on mount — `/v1/org/members` and `/v1/org/invites` — and each
  // one re-renders the table when it lands. A Menu popover opened in between is
  // DETACHED by that re-render mid-click, which is exactly what EMP-005 hit:
  // "element was detached from the DOM, retrying", for twenty seconds. One
  // button, two requests.
  await settle(page);

  const sheet = page.getByRole('dialog').filter({ hasText: /Module access/ }).first();
  // Two attempts, because the popover also animates in and a click landing on
  // the first frame is refused as unstable. A second open is free; a flake here
  // costs the whole row.
  for (let attempt = 1; attempt <= 2; attempt++) {
    await memberRow.getByRole('button', { name: /^Actions for / }).click();
    const item = page.getByRole('menuitem', { name: /^Edit module grants$/ });
    await expect(item, 'the member row offers no "Edit module grants" action')
      .toBeVisible({ timeout: 10_000 });
    try {
      await item.click({ timeout: 10_000 });
      await expect(sheet).toBeVisible({ timeout: 10_000 });
      break;
    } catch (err) {
      expect(attempt, `the "Edit module grants" sheet would not open for ${email}: ` +
        String(err).slice(0, 300)).toBeLessThan(2);
      await page.keyboard.press('Escape').catch(() => {});
      await settle(page);
    }
  }
  // Scoped INSIDE the sheet from here: the access matrix on the page behind
  // carries the same module labels and the same level words.
  await expect(sheet, 'the module-access sheet did not open for this member').toBeVisible();

  for (const g of row.grants) {
    const box = sheet.getByRole('checkbox', { name: `${g.label} access` });
    await expect(box, `the module sheet has no "${g.label} access" row — either the org ` +
      `lost its ${g.code} subscription or the catalogue changed`).toBeVisible();
    if ((await box.getAttribute('aria-checked')) !== 'true') await box.click();
    await expect(box, `${g.label} did not switch on`).toHaveAttribute('aria-checked', 'true');

    // The level buttons are disabled until the module is on, which is why they
    // are pressed after the checkbox and never before it.
    const levels = sheet.getByRole('group', { name: `${g.label} level` });
    const wanted = levels.getByRole('button', { name: new RegExp(`^${g.level}$`, 'i') });
    await expect(wanted, `${g.label} offers no "${g.level}" level; validLevels() and the ` +
      'org_member_modules_level_is_meaningful CHECK have to agree, so this is a real ' +
      'disagreement').toBeVisible();
    await wanted.click();
    await expect(wanted, `${g.label} did not settle on ${g.level}`)
      .toHaveAttribute('aria-pressed', 'true');
  }

  const saved = await submitting(page, /\/org\/members\/[^/]+\/modules$/, async () => {
    await sheet.getByRole('button', { name: /^Save access$/ }).click();
    // A sensitive module at approver or admin MUST confirm before it is saved
    // (`catalogue.sensitiveGrantRaises`). Asserted rather than tolerated: a
    // confirmation that quietly stopped appearing is the regression, and
    // clicking "whatever dialog appears" would hide it.
    const confirm = page.getByRole('alertdialog');
    if (needsConfirm(row)) {
      await expect(confirm, `granting ${row.grants.map(g => g.code).join(', ')} at ` +
        'approver/admin must confirm before it is saved, and no dialog appeared')
        .toBeVisible({ timeout: 10_000 });

      // ── KEYBOARD, AND NOT BECAUSE KEYBOARD IS TIDIER ────────────────────
      //
      // `.click()` cannot reach this button. Measured 2026-08-26 over 30-odd
      // retries, always the same answer: "<div class='ogr__r'> from <div>
      // subtree intercepts pointer events". The ConfirmDialog opens ON TOP OF
      // the still-open module Sheet and paints UNDER its grant rows, so
      // `elementFromPoint` at the button's centre returns a row of the sheet
      // behind it. A person with a mouse cannot confirm a sensitive grant from
      // Organisation ▸ Members at all.
      //
      // No jsdom test can see this — jsdom performs no layout, so
      // `sensitiveGrantConfirm.test.jsx` passes with the bug present. It is the
      // same class of fault as the blank task-drawer pickers that
      // `drawerpickers.spec.ts` exists for.
      //
      // Focus + Enter is a route a REAL user has (the dialog is reachable by
      // keyboard, and `keyboard a11y` is a shipped property of this build), and
      // it is not blocked by hit-testing. It is used here so the twelve can be
      // delivered, and the defect is REPORTED rather than absorbed: when the
      // stacking is fixed this can go back to `.click()`.
      const grant = confirm.getByRole('button', { name: /^Grant access$/ });
      await grant.focus();
      await page.keyboard.press('Enter');
    }
  });
  expect(saved, 'the modules PUT returned nothing').toBeTruthy();

  // ── The canonical row, from the server ───────────────────────────────────
  // `GET /v1/org/members` is what the screen reads back, and it is the only
  // thing that says what was actually stored — including the LEVEL, which is
  // the half that used to be dropped on the column default.
  expect(await heldGrants(page, row, email),
    `${row.code}'s account does not hold the grants that were just saved — the level ` +
    'is the half that used to be dropped on the column default').toEqual(want);
}

/** What this account actually holds, as sorted `code:level`, from the server. */
async function heldGrants(page: Page, row: Row, email: string): Promise<string[]> {
  const members = await apiOk(page, 'get', '/api/v1/org/members');
  const me = (Array.isArray(members) ? members : members.data ?? [])
    .find((m: any) => String(m.email || '').toLowerCase() === email.toLowerCase());
  expect(me, `${email} is not a member of this organisation. For ${row.code} that means ` +
    'either the acceptance never put them in it, or the link points at an account the ' +
    'org no longer holds.').toBeTruthy();
  return (me.module_grants ?? me.modules ?? [])
    .map((g: any) => (typeof g === 'string' ? g : `${g.code || g.module_code}:${g.role || g.level}`))
    .sort();
}

/**
 * /accept-invite — a CLEAN browser, because this is a different person.
 *
 * Re-using the god-mode context would carry an `auth_token` into a screen whose
 * whole job is to mint one, and the shell would redirect away from it. The
 * context is closed at the end so the twelve accounts never leak into each
 * other's session.
 */
async function acceptTheInvitation(browser: any, row: Row, email: string, password: string) {
  const token = (row as any)._token as string;
  expect(token, 'no invitation token was carried from the invite step').toBeTruthy();

  const ctx = await browser.newContext({ baseURL: BASE });
  const p: Page = await ctx.newPage();
  try {
    await p.goto(`/accept-invite?token=${encodeURIComponent(token)}`);

    // The preview resolves first, and a dead token renders a dead end rather
    // than a form. Waiting on the NAME FIELD rather than on `networkidle`
    // means an expired or withdrawn invitation fails here with the screen's own
    // words instead of timing out on a click.
    const nameBox = p.locator('#inv-name');
    await expect(nameBox, `the accept-invite screen drew no form for ${row.code} — the ` +
      'token was refused, already used, or the preview call failed')
      .toBeVisible({ timeout: 30_000 });

    await nameBox.fill(row.name);
    await p.locator('#inv-password').fill(password);
    await p.locator('#inv-confirm').fill(password);

    // `accept-invite` is rate limited at 10/minute (`auth_router.py:1142`). The
    // twelve are serial and each takes far longer than six seconds, so the limit
    // is never approached — but a 429 read as "the invitation failed" would be
    // a false product finding, so it is named in the failure message.
    const accepted = await submitting(p, '/auth/accept-invite', async () => {
      await p.getByRole('button', { name: /Accept & create account|Activating/i }).click();
    });
    expect(accepted.user?.email?.toLowerCase() ?? accepted.user?.email,
      `accept-invite returned no user for ${row.code}: ${JSON.stringify(accepted).slice(0, 300)}`)
      .toBe(email.toLowerCase());

    // The person must end up signed in — that is what the endpoint promises.
    await p.waitForURL(/\/(dashboard|client|boards|tasks|projects)/, { timeout: 45_000 });
  } finally {
    await ctx.close();
  }
}

/**
 * Manav ▸ Employees ▸ (the record) ▸ Link an account.
 *
 * The employee record's own panel rather than the Link-logins review tab: this
 * one is reached by SEARCHING the code, which is the only way to tell EMP-001's
 * "Isha Desai" from EMP-021's. The review tab lists all seventy-three unlinked
 * records with no search of its own, so picking a row there is picking by
 * position.
 */
async function linkFromTheEmployeeRecord(page: Page, row: Row, employeeId: string, email: string) {
  await page.goto('/manav');
  await settle(page);
  // Unanchored on purpose. `ModuleTabs` renders the label plus a count and an
  // "Opens here" star inside the same button, so an anchored name matches the
  // label and not the accessible name.
  await openTab(page, /employees/i);

  const panel = page.locator('[role="tabpanel"]').first();
  const search = panel.getByRole('textbox', { name: /Search employees by name or code/i });
  await expect(search, 'the employee directory has no search box').toBeVisible({ timeout: 20_000 });
  await search.fill(row.code);
  // The box does NOT filter as you type — `applyFilter` runs on Enter or on the
  // Filter button (`EmployeesTab.jsx:245`). Typing and reading is reading the
  // unfiltered list, whose first row is somebody else entirely.
  await search.press('Enter');

  // Wait for the REFETCH the search causes, not for a timer.
  await expect
    .poll(async () => panel.locator('tr[role="button"]').count(),
      { message: `searching ${row.code} never narrowed the directory`, timeout: 20_000 })
    .toBe(1);

  const rowEl = panel.locator('tr[role="button"]').first();
  await expect(rowEl, `no employee row for ${row.code}`).toBeVisible();
  await expect(rowEl, `the directory row for ${row.code} does not say it has no login — ` +
    'it may already be linked to something else').toHaveAttribute('aria-label', /no login linked/i);
  await rowEl.click();

  const link = page.getByRole('button', { name: /^Link an account$/ });
  await expect(link, `${row.code}'s record offers no "Link an account" control. That is a ` +
    'missing control, not a reason to skip: without it the login can never be attached.')
    .toBeVisible({ timeout: 20_000 });
  await link.click();

  // The picker is a real <select> filled by a fetch, so its options arrive after
  // it mounts. `pickOption` polls for them and fails naming the picker if they
  // never come — a genuinely empty picker IS a finding.
  const form = page.locator('form.k-formpanel').filter({ hasText: /Account/ }).first();
  const select = form.locator('select').first();
  await pickOption(select, `account for ${row.code}`, new RegExp(email.replace(/[.+]/g, '\\$&'), 'i'));

  const written = await submitting(page, /\/manav\/employees\/[^/]+\/link$/, async () => {
    await form.getByRole('button', { name: /^Link account$/ }).click();
  });
  expect(written.status, `linking ${row.code} answered ${JSON.stringify(written).slice(0, 300)}`)
    .toBe('linked');
  expect(String(written.email || '').toLowerCase(),
    `${row.code} was linked to the wrong account`).toBe(email.toLowerCase());

  // ── Then the CANONICAL row, from the server ──────────────────────────────
  // The write response is what happened; this is what is stored. They have
  // disagreed before, which is the whole reason both are read.
  const canonical = await apiOk(page, 'get', `/api/v1/manav/employees/${employeeId}`);
  expect(canonical.login?.email?.toLowerCase(),
    `GET /manav/employees/{id} does not report the login that was just written for ` +
    `${row.code}`).toBe(email.toLowerCase());
  expect(canonical.employee_code ?? canonical.code ?? row.code,
    'the canonical row is a different employee than the one that was linked')
    .toBe(row.code);
}
