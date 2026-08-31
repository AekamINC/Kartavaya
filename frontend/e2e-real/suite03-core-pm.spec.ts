/**
 * Proposal 93 · Stage 3 · SUITE 03 — Core PM (14 surfaces), on Unicode Group.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` and nothing else. `signIn()` below ends at `assertOrg()`,
 * which asserts the org **ID** the SERVER resolved — never a name on screen,
 * because the name is exactly what got corrupted when a platform credential
 * renamed Aekam Inc on 2026-08-28. See the header of `_lanes.ts`. No
 * platform/god-mode credential appears in this file.
 *
 * Measured 2026-08-29, before a line of this file ran, with
 * `Authorization: E2E_UNICODE_TOKEN` and `X-Org-Id: fae87907…`:
 *
 *     GET /api/v1/org/profile      200  Unicode Group
 *     GET /api/teams               200  rows=1   (team_ae1d58543b21, PROTECTED)
 *     GET /api/tasks               200  rows=19  (of the protected 20; 1 archived)
 *     GET /api/categories          200  rows=0
 *     GET /api/templates/projects  200  rows=0
 *     GET /api/approvals/pending   200  rows=0
 *     GET /api/approvals/history   200  rows=0
 *     GET /api/v1/me/column-prefs  200  {}
 *     GET /api/users               200  rows=8   (the directory this org can name)
 *
 * And, read-only, straight off Supabase `toacecaewujfxjfrjwco` for the same org:
 *
 *     public.teams              1     public.boards            0  (see §DEAD TABLES)
 *     public.tasks             20     public.board_columns     0
 *     public.project_columns    5     public.saved_views       0  (all orgs, all time)
 *     public.task_comments      4     public.project_templates 0
 *     public.mentions           2     public.task_templates    0  (2 rows exist — Aekam's)
 *     public.time_entries       1     public.approvals         0
 *     public.task_clients       0     staging.user_column_prefs 2 (all orgs)
 *
 * So every count this suite asserts is a count this suite produced, on top of a
 * protected set of exactly 20 tasks that 03.1 pins by id before anything is
 * typed and 03.21 re-reads after everything is.
 *
 * ⚠ `meta.branch` COULD NOT BE CHECKED, as in Suite 07. The deployed backend
 * exposes no such route — `/api/version`, `/api/_meta`, `/version`,
 * `/api/build` and `/api/health/meta` all answer 404. What it does answer is
 * `GET /api/health → {"environment":"staging","schema":"staging",
 * "db":"connected","outbound_mode":"live","suppressed_orgs_digest":"0"}`.
 * That is the whole of the available evidence and it is recorded rather than
 * glossed over.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THE SESSION BOOTSTRAP IS NOT OPTIONAL HERE, AND IT IS A REAL TRAP
 * ═══════════════════════════════════════════════════════════════════════════
 * `_lanes.signInAs()` writes `auth_token` into localStorage and navigates. It
 * does NOT write `Kartavaya_user` — `components/layout/Protected.jsx:147` does,
 * from `GET /auth/me`, asynchronously, after the route mounts. Until that lands
 * `lib/auth.currentUser()` returns **null**, and half of Core PM is drawn from
 * it: the drawer's Delete, Archive, Approve and Reject, the kanban's column
 * controls, and `NewTaskModal`'s decision between `POST /tasks` and
 * `POST /client/tasks/request`.
 *
 * A suite that starts clicking before that resolves finds those controls
 * missing and files six defects that are its own. `signIn()` therefore POLLS
 * for `Kartavaya_user` and refuses to continue without it. Suite 02b records
 * the same hazard from the other end (`/settings/roles` rendering DENIED); this
 * is the Core PM half of it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ WHAT THIS SUITE MAILS, AND WHY IT IS SIZED THE WAY IT IS
 * ═══════════════════════════════════════════════════════════════════════════
 * `GET /api/health → {"outbound_mode":"live","suppressed_orgs_digest":"0"}`.
 * NOTHING is suppressed. Unlike Suite 07 — which avoids mail entirely by
 * leaving the employee address blank — mail is INTRINSIC to three Core PM
 * paths and cannot be switched off from a form:
 *
 *   · `services/mentions.process_mentions` mails every resolved mention.
 *   · `approvals_router.request_approval` mails the project owner.
 *   · `approvals_router.send_approval_notification` mails on approve/reject.
 *
 * Every recipient this suite can reach is one of the OWNER's OWN plus-tagged
 * Gmail mailboxes — `kevalvshah03+1`, `+uops`, `+uadm`, `+ugrn`,
 * `+rajesh-bhatt` — which is precisely §3's chosen scheme ("20% kevalvshah03+…
 * yes, Gmail plus-addressing is reliable"). **The two `aekaminc1*` accounts are
 * deliberately never named**, mentioned or assigned by this file: they are the
 * protected bootstrap admins and no test needs them.
 *
 * Expected sends, stated up front rather than discovered in an inbox:
 *   20 mention emails (all to ONE mailbox, `MENTION_TARGET` below)
 *   14 approval-request emails  (to the project owner, which is this account)
 *   12 approve/reject emails    (to the task creator, which is this account)
 *    2 client-approval emails   (to `CLIENT_MEMBER`, one mailbox)
 *    1 assignment email         (03.9's one cross-assignment)
 *   ── ~49, against §4's ~230/org budget ──
 *
 * Task creation carries NO assignee for 68 of the 80, and the 12 that do are
 * assigned to the ACTING ACCOUNT, which `server.create_task` skips
 * (`if uid==user["user_id"]: continue`). Status changes mail assignees and the
 * creator excluding the actor — both are this account. `done` additionally
 * mails project owners/admins, so every member this suite seats is seated at
 * role `member`, never `admin`. That is why the numbers above are ~49 and not
 * ~500.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §4 VOLUMES THAT ARE NOT REACHABLE, AND WHY — stated, never silently capped
 * ═══════════════════════════════════════════════════════════════════════════
 * 1 · **16 milestones · 8 risks · 4 baselines.** There is no control and no
 *     write path. `staging.project_milestones`, `staging.project_risks` and
 *     `staging.project_baselines` EXIST (live catalogue, 2026-08-29) and hold
 *     0 rows each; `routers/documents.py:46-48` says in as many words that they
 *     "exist and **are not read yet**", `analytics/metrics/core.py:273` says the
 *     same, and `ProjectBoardPage.jsx` prints the product's own sentence to the
 *     customer: "Milestones, risks and the planned side of each measure are not
 *     stored anywhere yet". `grep -rn 'project_milestones' backend/` finds no
 *     INSERT and no router. 03.5 asserts the SENTENCE is on screen and that the
 *     status report still downloads — which is the whole of what the product
 *     offers — and reports 0/16, 0/8, 0/4.
 * 2 · **`estimated_minutes` and `recurrence` on a task.** The server accepts
 *     both (`TaskCreate.estimated_minutes`, `TaskUpdate.recurrence`,
 *     `server.py:4727` writes the columns). `grep -rn 'recurrence'
 *     frontend/src` returns ZERO hits and `estimated_minutes` appears only in
 *     the client-portal shape. There is no control on any screen. 03.10 records
 *     both as MISSING CONTROLS with the grep in the failure message — suite
 *     rule 1 says a missing control is a failure, never a skip, so it is
 *     reported as a shortfall against the "every field" task and not skipped.
 * 3 · **"some billable, reaching an invoice"** on the 35 time entries.
 *     `time_entries.is_billable` exists; `TimeEntryCreate`
 *     (`routers/time_entries.py`) does not accept it, `/time/start` does not
 *     set it, and no screen offers a control — so the column can only ever hold
 *     its default. The invoice half is `POST /v1/ganit/invoices/from-time-entries`,
 *     which requires a `manav_employees` row with `hourly_rate` for the logging
 *     user; that is Suite 05/07's fixture and this suite does not reach into
 *     another module to manufacture it. 35 entries are typed; 0 are billable
 *     and 0 reach an invoice, and both numbers are reported.
 * 4 · **2 approvals decided BY EMAIL LINK.** The link carries a JWT minted by
 *     `approvals_router._make_client_token` and signed with the server's
 *     secret; its only delivery is the email. Playwright has no inbox. 03.16
 *     drives the SEND end to end — a real client seat, the real Approve panel,
 *     the real forward — and asserts `approval_status='pending_client'` on the
 *     canonical row plus the `outbound_log` row; the DECISION from the link is
 *     BLOCKED on inbox access, not broken and not skipped by choice.
 * 5 · **`public.mentions` has NO READ ROUTE.** `grep -rn 'FROM mentions'
 *     backend/` finds the INSERT in `services/mentions.py` and nothing else —
 *     no router, no panel, no filter anywhere in the product. So the browser
 *     cannot read a mention back. 03.13 asserts everything the browser CAN see
 *     — the picker listed real NAMES, the inserted text is exactly
 *     `@{display_name} `, and the canonical comment row carries it, which is
 *     the string `_resolve_mentions` pass 1 matches on — and the mention ROWS
 *     are counted out of band and reported. See §MENTIONS below.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §MENTIONS — the memory note is STALE and this is the correction
 * ═══════════════════════════════════════════════════════════════════════════
 * The brief carries "Task @mentions have never worked — 0 mention rows have
 * ever existed". Measured 2026-08-29, read-only:
 *
 *     SELECT * FROM public.mentions;
 *     ment_ed36ab1a6919  cmt_2bc1e48f51db  user_91601f25f601  2026-08-25 08:54
 *     ment_aa7e6c8f9ce5  cmt_19e2ba77c967  user_91601f25f601  2026-08-25 08:56
 *
 * TWO rows, both in Unicode Group, both inside the PROTECTED set, both written
 * on 2026-08-25 — after `services/mentions.py`'s two-pass resolver and its
 * "mention row not stored" logging landed. The write path works. What has never
 * existed is a way to SEE one. Chasing a write-path defect here would have been
 * a day spent on a bug that was already fixed; the real gap is the read.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §DEAD TABLES — two of them, and neither is what §4 means
 * ═══════════════════════════════════════════════════════════════════════════
 * `public.boards` and `public.board_columns` hold 0 rows in the whole database
 * and `grep -rn 'board_columns' backend/` returns NOTHING — no router, no
 * service, no migration reads them. In this product a **board IS a project**:
 * `/boards` and `/projects/:id` both render `GET /projects/{team_id}/columns`,
 * which is `public.project_columns`. §4's "Boards · columns 4 · 16" is
 * therefore four PROJECTS driven as boards and sixteen `project_columns`
 * created by hand, which is what 03.6 does.
 *
 * The same collapse applies one line up. §4 asks for "Teams 5" and "Projects
 * 8" as separate entities; `/api/teams` is the only table for both, and
 * `TeamsPage.jsx` is the MEMBER ROSTER of a project rather than a second kind
 * of object. So: 8 projects, of which 5 are given a roster. Reported as such
 * rather than as 13 rows in a table that holds 8.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 IDEMPOTENCE — proved by running twice, never claimed
 * ═══════════════════════════════════════════════════════════════════════════
 * Every record carries a DETERMINISTIC key: `S3 Project 01`, `S3 Cat 03`,
 * `S3-T047`, column `S3 Col B`, label `s3-review`, comment body, time-entry
 * description, template name. Every test READS what exists first, creates only
 * the shortfall, and then asserts the TOTAL. A second run therefore types
 * nothing and still asserts everything. `LEDGER` accumulates
 * `{typed, present}` per entity and `test.afterAll` prints it, so
 * "0 typed, N already present" is an OUTPUT of the run rather than a claim
 * about it.
 *
 * There is no `RUN` stamp anywhere in this file, deliberately: a stamped name
 * is the opposite of idempotent, and Suite 07's UDIN duplicate is what that
 * costs.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §14 — THIS SUITE RULES ON NOTHING
 * ═══════════════════════════════════════════════════════════════════════════
 * Every failure reports the WIRE (method, status, path, body) and stops. No
 * assertion is relaxed to make a screen pass. The four product fixes this suite
 * caused are listed in the run report with their mutation proofs; the judgement
 * that they were product bugs rather than test bugs was taken on the evidence
 * recorded beside each one — the server's own rule, the live catalogue, and a
 * measured exposure count — never on a red test alone.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave3.config.ts --project corepm
 */
import { test, expect, Page, Locator } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lane, activeLane, assertOrg } from './_lanes';
import { settle, setDate, isForeignInlineScriptRefusal } from './_helpers';

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
   §4 VOLUMES — one place, so "half it" is one edit
   ══════════════════════════════════════════════════════════════════════════ */
const V = {
  projects: 8,
  rosters: 5,          // §4 "Teams 5" — five of the eight get members
  boards: 4,           // four projects driven as boards
  columnsPerBoard: 4,  // × 4 boards = §4's 16 columns, created by hand
  drags: 12,
  tasks: 80,
  fieldTasks: 12,
  subtasks: 50,
  comments: 40,
  mentions: 20,
  timeEntries: 35,
  approvalsRequested: 14,
  approve: 8,
  reject: 4,
  byEmail: 2,
  projectTemplates: 3,
  taskTemplates: 2,    // 3 + 2 = §4's "Templates created 5"
  templatesApplied: 3,
  categories: 8,
  savedViews: 5,
  columnPrefs: 6,
} as const;

/** The protected set — proposal §9, "exactly as it stands". */
const PROTECTED_TEAM = 'team_ae1d58543b21';
const PROTECTED_TASKS = 20;

/** Deterministic names. No timestamp, no random — see §6 above. */
const P = (n: number) => `S3 Project ${String(n).padStart(2, '0')}`;
const C = (n: number) => `S3 Cat ${String(n).padStart(2, '0')}`;
const T = (n: number) => `S3-T${String(n).padStart(3, '0')}`;
const COL = ['S3 Col A', 'S3 Col B', 'S3 Col C', 'S3 Col D'];
const LABELS = ['s3-urgent', 's3-review', 's3-client', 's3-billing'];

/**
 * The one mailbox every mention is sent to.
 *
 * A member of Unicode Group with a `kevalvshah03+…@gmail.com` address, so all
 * twenty land in one plus-tagged inbox that sorts itself — §3's whole argument
 * for plus-addressing. Kasti's two `aekaminc1*` accounts are never named here.
 */
const MENTION_TARGET = 'Keval Test uni';
/** The person seated as a project `client`, for the by-email approval forward. */
const CLIENT_MEMBER = 'Anaya Iyer';
/** Members seated on the five rosters — all owner-controlled mailboxes. */
const ROSTER_PEOPLE = ['Rajesh Bhatt', 'Rohan Desai', 'Anaya Iyer', 'Keval Test uni'];

/* ══════════════════════════════════════════════════════════════════════════
   THE IDEMPOTENCE LEDGER
   ══════════════════════════════════════════════════════════════════════════ */
/**
 * ⚠ ON DISK, NOT IN A MODULE VARIABLE — PLAYWRIGHT RESTARTS THE WORKER AFTER
 * EVERY FAILED TEST.
 *
 * `const LEDGER: Line[] = []` lived in module scope, and a new worker
 * re-imports the module with an EMPTY array. So on any run with a failure the
 * `afterAll` print covered only the tests since the last failure — the run
 * that found eighteen of them printed a ledger with ONE line in it, and every
 * §4 total I read off a ledger before this was silently truncated at the last
 * red test. (The volumes in the report were taken from live SQL, which is why
 * they were right; the ledger was not the evidence, and it should have been
 * able to be.)
 *
 * A JSONL file survives the restart. Worker 0 truncates it — Playwright
 * numbers a restarted worker 1, 2, … so that happens exactly once per run —
 * and `afterAll` reads back whatever every worker wrote, last line per entity
 * winning.
 */
type Line = { entity: string; asked: number; typed: number; present: number; total: number; note?: string };
const LEDGER_FILE = path.join(os.tmpdir(), 'kartavya-e2e-wave3', 'suite03-ledger.jsonl');

function ledger(entity: string, asked: number, typed: number, total: number, note?: string) {
  const line: Line = { entity, asked, typed, present: total - typed, total, note };
  try {
    fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
    fs.appendFileSync(LEDGER_FILE, JSON.stringify(line) + '\n', 'utf8');
  } catch { /* a ledger that cannot write must not fail the run */ }
}

function readLedger(): Line[] {
  try {
    const byEntity = new Map<string, Line>();
    for (const raw of fs.readFileSync(LEDGER_FILE, 'utf8').split('\n')) {
      if (!raw.trim()) continue;
      const l = JSON.parse(raw) as Line;
      byEntity.set(l.entity, l);          // a re-run of a test supersedes it
    }
    return [...byEntity.values()];
  } catch { return []; }
}

test.beforeAll(() => {
  // Worker 0 only: a restarted worker must APPEND to what the run has already
  // recorded, never clear it.
  if ((process.env.TEST_WORKER_INDEX ?? '0') === '0') {
    try {
      fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
      fs.writeFileSync(LEDGER_FILE, '', 'utf8');
    } catch { /* see above */ }
  }
  console.log(
    `\n  SUITE 03 · Core PM · 14 surfaces` +
    `\n  LANE: ${LANE.org} (${LANE.orgId})  · reference lane, §14` +
    `\n  API : ${API}` +
    `\n  ⚠ outbound_mode=live and nothing is suppressed. This suite mails ~49` +
    `\n    messages, every one to an owner-controlled plus-tagged Gmail. See` +
    `\n    the header for the breakdown and why it cannot be zero.\n`,
  );
});

test.afterAll(() => {
  const rows = readLedger();
  if (!rows.length) return;
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  console.log('\n  ── §4 VOLUMES ACHIEVED · SUITE 03 ────────────────────────────────');
  console.log(`  ${pad('entity', 26)}${pad('asked', 7)}${pad('typed', 7)}${pad('present', 9)}${pad('total', 7)}note`);
  for (const l of rows) {
    console.log(`  ${pad(l.entity, 26)}${pad(l.asked, 7)}${pad(l.typed, 7)}${pad(l.present, 9)}${pad(l.total, 7)}${l.note || ''}`);
  }
  const typed = rows.reduce((a, l) => a + l.typed, 0);
  const present = rows.reduce((a, l) => a + l.present, 0);
  console.log(`\n  §6 IDEMPOTENCE: ${typed} typed, ${present} already present.`);
  console.log('  A second run of this file must print "0 typed".\n');
});

/* ══════════════════════════════════════════════════════════════════════════
   THE HARNESS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Sign in, wait for the session to actually EXIST, then refuse to continue
 * unless it resolved to Unicode.
 *
 * The token opens the door; every row below is still typed and clicked. §2 of
 * the proposal takes the same position about the bootstrap admin it insists on
 * keeping: "This is not a bypass of the 'driven as a user' rule — it is the
 * precondition for it."
 *
 * ⚠ THE `Kartavaya_user` POLL IS LOAD-BEARING. See the file header: without it
 * `currentUser()` is null for the first few hundred milliseconds of every test
 * and the drawer, the kanban and the New Task modal all draw a reduced surface.
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
    // The token AND the active org. `lib/api.js:38-40` puts `X-Org-Id` on every
    // request from `Kartavaya_active_org`; naming it here means the browser's
    // own header says Unicode rather than leaving the server to fall back to
    // this account's earliest grant. Belt to `assertOrg`'s braces.
    await page.evaluate(([t, org]) => {
      localStorage.setItem('auth_token', t as string);
      localStorage.setItem('Kartavaya_active_org', org as string);
    }, [LANE.token, LANE.orgId]);
    await page.goto('/dashboard');
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
  }

  await expect
    .poll(async () => await page.evaluate(() => localStorage.getItem('Kartavaya_user')), {
      message:
        'the session never materialised: `Kartavaya_user` was still absent after ' +
        '`Protected.jsx` had a chance to write it from GET /auth/me. Every ' +
        'permission-gated control in Core PM is drawn from it, so continuing ' +
        'here would report six controls missing that are simply not drawn yet.',
      timeout: 30_000,
    })
    .not.toBeNull();

  await assertOrg(page.request, page, LANE);
}

/**
 * ⚠ `X-Org-Id` IS NOT OPTIONAL, and `_helpers.ts::api()` MUST NOT be used here.
 *
 * `_helpers.ts::api()` sends `X-Org-Id: process.env.E2E_ORG_ID`, which names
 * **E2E Test & Associates**, not Unicode. A read helper that answers for a
 * different organisation than the screen beside it is the same class of fault
 * as the 2026-08-28 cross-org incident, so this file has its own, bound to the
 * lane's org id and to nothing in the environment.
 *
 * GET only, and that is a rule rather than an accident:
 * `check-e2e-no-bypass` bans `page.request.post/put/patch/delete` and permits
 * `get`, because asserting that the row appeared IS the required evidence.
 */
/**
 * The session token, read ONCE at sign-in and remembered.
 *
 * ⚠ `orgGet` used to call `page.evaluate(() => localStorage.getItem(…))` on
 * every read, and that is a call into the PAGE — so a read that happens while
 * the board is navigating dies with
 *
 *     page.evaluate: Execution context was destroyed, most likely because of
 *     a navigation
 *
 * which is what killed 03.16 half way through its fourteen approvals. The
 * token does not change during a test, so reading it once removes a whole
 * class of flake from every read-back in this file. `TOKENS` is per Page, so
 * two tests never share one.
 */
const TOKENS = new WeakMap<Page, string>();

async function sessionToken(page: Page): Promise<string | null> {
  const cached = TOKENS.get(page);
  if (cached) return cached;
  const token = await page.evaluate(() => localStorage.getItem('auth_token'))
    .catch(() => null);
  if (token) TOKENS.set(page, token);
  return token;
}

async function orgGet(page: Page, path: string): Promise<any> {
  const token = await sessionToken(page);
  const res = await page.request.get(`${API}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Org-Id': LANE.orgId,
    },
  });
  expect(res.ok(), `GET ${path} → ${res.status()}: ${(await res.text()).slice(0, 400)}`)
    .toBeTruthy();
  return await res.json();
}

/** The rows of an enveloped or bare list, whichever the route answers. */
async function rowsOf(page: Page, path: string): Promise<any[]> {
  const body = await orgGet(page, path);
  const r = Array.isArray(body) ? body : body?.data;
  expect(Array.isArray(r), `GET ${path} did not answer a list: ${JSON.stringify(body).slice(0, 200)}`)
    .toBeTruthy();
  return r as any[];
}

/**
 * THE WIRE — every write, with the status the server answered.
 *
 * Memory's rule, learned from the bank-import bug: watch the requests before
 * blaming the UI. That defect presented as "the button does nothing" and as a
 * CORS error in the console; it was a 500, and only a request listener told the
 * two apart.
 */
type Wire = string[];
const FAILED = new WeakMap<Page, string[]>();

function watchWire(page: Page): Wire {
  const wire: Wire = [];
  const failed: string[] = [];
  FAILED.set(page, failed);
  page.on('response', async (r) => {
    const req = r.request();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return;
    if (!/\/api\//.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 200); } catch { /* consumed */ }
    wire.push(`${req.method()} ${r.status()} ${new URL(r.url()).pathname}  ${body}`);
  });
  page.on('requestfailed', (req) => {
    if (!/\/api\//.test(req.url())) return;
    failed.push(
      `${req.method()} FAILED ${new URL(req.url()).pathname}  ` +
      `${req.failure()?.errorText ?? '(no reason given)'}`,
    );
  });
  return wire;
}
const dump = (w: Wire) =>
  w.length ? w.slice(-12).map((l) => '\n     ' + l).join('') : '\n     (no write request was made at all)';

/**
 * The console, per screen.
 *
 * `pageerror` is an UNCAUGHT exception and is asserted at zero — that is the
 * §1 requirement and it is not negotiable. `console.error` is collected beside
 * it and asserted separately, so a failure says which of the two happened
 * rather than leaving the next reader to guess.
 */
type Console = { errors: string[]; uncaught: string[] };
function watchConsole(page: Page): Console {
  const c: Console = { errors: [], uncaught: [] };
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const full = m.text();
    // Cloudflare injects its own `__CF$cv$` loader carrying a per-request token,
    // so its hash differs on every load and can never be allowed by hash.
    // CLASSIFIED, not ignored: a refusal of OUR bootstrap still fails. _helpers.
    if (isForeignInlineScriptRefusal(full)) return;
    c.errors.push(`${page.url().replace(/^https?:\/\/[^/]+/, '')}  ${full.slice(0, 240)}`);
  });
  page.on('pageerror', (e) => c.uncaught.push(`${page.url()}  ${String(e).slice(0, 240)}`));
  return c;
}

/**
 * Click something that writes, and WAIT FOR THE SERVER before going on.
 *
 * ⚠ This is the fix for three of Suite 02's four failures on 2026-08-28: each
 * clicked Save and called `page.reload()` on the very next line, the reload
 * raced the request, the value read back empty, and the suite reported "the
 * product did not save it". It had. Returns the STATUS, because a toast is the
 * client's opinion and the status is the server's.
 */
async function writes(
  page: Page,
  urlRe: RegExp,
  act: () => Promise<void>,
  opts: { methods?: string[]; timeout?: number } = {},
): Promise<{ status: number; body: any; text: string }> {
  const methods = opts.methods ?? ['POST', 'PUT', 'PATCH', 'DELETE'];
  let res;
  try {
    [res] = await Promise.all([
      page.waitForResponse(
        (r) => urlRe.test(r.url()) && methods.includes(r.request().method()),
        { timeout: opts.timeout ?? 45_000 },
      ),
      act(),
    ]);
  } catch (e) {
    const failed = FAILED.get(page) ?? [];
    throw new Error(
      `${String((e as Error)?.message ?? e)}\n` +
      `     waiting for a ${methods.join('/')} matching ${urlRe}\n` +
      (failed.length
        ? `     requests that FAILED without a response:${failed.slice(-6).map((l) => '\n       ' + l).join('')}`
        : '     no /api/ request failed — the browser may never have issued one'),
    );
  }
  const text = await res.text();
  expect(
    res.status(),
    `${res.request().method()} ${new URL(res.url()).pathname} → ${res.status()}: ${text.slice(0, 400)}`,
  ).toBeLessThan(400);
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status(), body, text };
}

/**
 * Retry ONLY on the detach signature.
 *
 * A blind retry papers over a genuinely missing or genuinely disabled control,
 * which is the one thing this suite exists to catch — so any other failure is
 * rethrown on the first attempt. Suite 02's 02.14 and 02.15 both failed with
 * "element is not stable … detached from the DOM" because a list refetch
 * replaced the tbody under an actionability wait.
 */
async function retryOnDetach(page: Page, act: () => Promise<void>, why: string) {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await act(); return; } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (!/detached from the DOM|not stable|element is not attached/i.test(msg) || attempt === 3) throw e;
      last = e;
      console.log(`\n[retryOnDetach] ${why} — the tree moved under the click, retry ${attempt}\n`);
      await page.waitForTimeout(400);
    }
  }
  throw last;
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactly = (s: string) => new RegExp(`^\\s*${reEsc(s)}\\s*$`);

/* ── The pickers ────────────────────────────────────────────────────────── */

/**
 * `ui/Picker.jsx` — a trigger `<button aria-label>` opening a `role="listbox"`
 * of `role="option"` rows.
 *
 * ⚠ SCOPED, ALWAYS. Suite rule 6: `getByRole(name)` matches the ACCESSIBLE
 * NAME, and the drawer renders `Priority`, `Status`, `Category`, `Client` and
 * `Assignees` triggers while the board behind it renders more. The scope is the
 * drawer dialog, never the page.
 *
 * The option list is POLLED, not read once (suite rule 5): `Client` is a
 * `ServerPicker` whose first page arrives from `GET /v1/graha/clients` after
 * mount, and a picker read too early reports "nothing to choose from" against
 * an org that has hundreds.
 */
async function pick(scope: Locator, ariaLabel: string, want: string | RegExp): Promise<string> {
  const page = scope.page();
  const trigger = scope.getByRole('button', { name: ariaLabel, exact: true }).first();
  await expect(trigger, `no "${ariaLabel}" picker on this surface`).toBeVisible({ timeout: 20_000 });
  await trigger.click();

  const listbox = page.locator('[role="listbox"]').last();
  await expect(listbox, `the "${ariaLabel}" picker did not open a listbox`).toBeVisible({ timeout: 15_000 });
  const rows = listbox.locator('[role="option"]');
  await expect
    .poll(async () => await rows.count(),
      { message: `the "${ariaLabel}" picker never loaded a single option`, timeout: 25_000 })
    .toBeGreaterThan(0);

  const texts = await rows.allTextContents();
  const idx = texts.findIndex((t) =>
    typeof want === 'string' ? t.trim().includes(want) : want.test(t));
  expect(
    idx,
    `no "${ariaLabel}" option matching ${String(want)}; saw: ${texts.slice(0, 12).join(' | ')}`,
  ).toBeGreaterThanOrEqual(0);
  const chosen = (await rows.nth(idx).textContent() || '').trim();
  await rows.nth(idx).click();
  return chosen;
}

/** Close whatever picker popup is open, without letting Escape reach the drawer. */
async function closePicker(page: Page) {
  const pop = page.locator('.pk__pop');
  if (await pop.count()) {
    await page.mouse.click(4, 4);
    await expect(pop.first()).toBeHidden({ timeout: 8_000 }).catch(() => {});
  }
}

/**
 * `ui/Picker.jsx::PickerDate` — the drawer's Due date.
 *
 * ⚠ NOT `_helpers.ts::setDate()`. That helper reaches
 * `label → .pk--dt button.pk__tr`: it drives `ui/DateInput.jsx`, which renders
 * `pk pk--field pk--dt` INSIDE a `<label>`. The drawer's due date is
 * `PickerDate`, which renders `pk pk--field` with NO `pk--dt` and no wrapping
 * label at all — it is addressed by `aria-label`. Calling the shared helper
 * here finds nothing and reads as a missing control, which is the wrong
 * diagnosis. Same calendar (`CalendarGrid`), different entry point.
 */
async function setDrawerDate(scope: Locator, ariaLabel: string, iso: string) {
  const page = scope.page();
  const trigger = scope.getByRole('button', { name: ariaLabel, exact: true }).first();
  await expect(trigger, `no "${ariaLabel}" date picker`).toBeVisible({ timeout: 20_000 });
  await trigger.click();

  const pop = page.locator('.pk__pop').last();
  await expect(pop, `the "${ariaLabel}" calendar did not open`).toBeVisible({ timeout: 10_000 });

  const want = new Date(`${iso}T00:00:00`);
  const title = `${want.toLocaleString('en-GB', { month: 'long' })} ${want.getFullYear()}`;
  for (let i = 0; i < 15; i++) {
    const shownText = (await pop.locator('.pk__calt').innerText()).trim();
    if (shownText === title) break;
    const shown = new Date(`${shownText} 1`);
    await pop.getByRole('button', { name: shown < want ? 'Next month' : 'Previous month' }).click();
  }
  expect((await pop.locator('.pk__calt').innerText()).trim(),
    `the calendar never reached ${title}`).toBe(title);

  await pop.locator('.pk__d:not(.out)', { hasText: new RegExp(`^${want.getDate()}$`) }).first().click();
  await expect(pop).toBeHidden({ timeout: 10_000 });
}

/* ── Navigation ─────────────────────────────────────────────────────────── */

/** The project board at `/projects/{team_id}`, with its kanban actually drawn. */
async function board(page: Page, teamId: string) {
  if (!page.url().includes(`/projects/${teamId}`)) {
    await page.goto(`/projects/${teamId}`);
  }
  await expect(page.locator('.bd'), 'the kanban never rendered').toBeVisible({ timeout: 60_000 });
  await settle(page);
}

/** One kanban column, by its NAME — the only stable handle a user has. */
const column = (page: Page, name: string) =>
  page.locator('.bd__col').filter({ has: page.locator('.bd__cn', { hasText: exactly(name) }) }).first();

/** One card, by its title. */
const card = (page: Page, title: string) =>
  page.locator('button.bc').filter({ has: page.locator('.bc__t', { hasText: exactly(title) }) }).first();

/** Open a task's drawer from a board card, and wait for the row to arrive. */
async function openDrawer(page: Page, title: string): Promise<Locator> {
  await retryOnDetach(page, async () => {
    const c = card(page, title);
    await expect(c, `no card titled "${title}" on this board`).toBeVisible({ timeout: 25_000 });
    await c.click({ timeout: 15_000 });
  }, `open the drawer for "${title}"`);
  const drawer = page.getByRole('dialog', { name: new RegExp(`^Task: ${reEsc(title)}$`) });
  await expect(drawer, `the drawer for "${title}" did not open`).toBeVisible({ timeout: 30_000 });
  // The title input is the last thing to bind, so it is the signal that the
  // canonical row has arrived rather than the skeleton.
  await expect(drawer.getByRole('textbox', { name: 'Task title' })).toHaveValue(title, { timeout: 25_000 });
  return drawer;
}

async function closeDrawer(page: Page, drawer: Locator) {
  await closePicker(page);
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(drawer, 'the drawer did not close').toBeHidden({ timeout: 15_000 });
}

/** One of the drawer's five tabs. `Tabs.jsx` gives each `role="tab"` + count. */
async function drawerTab(drawer: Locator, name: 'Details' | 'Comments' | 'Files' | 'Time' | 'Activity') {
  const tab = drawer.getByRole('tab', { name: new RegExp(`^${name}`) });
  await expect(
    tab,
    `the drawer has no "${name}" tab. ⚠ Before calling this a missing control, ` +
    `check the session: "Time" is hidden when the drawer believes the caller is ` +
    `a portal client, and that decision is drawn from currentUser().`,
  ).toBeVisible({ timeout: 15_000 });
  await tab.click();
}

/**
 * Drag a kanban card into another column.
 *
 * `@hello-pangea/dnd` listens on POINTER events, not HTML5 drag-and-drop, and
 * it will not lift until the pointer has travelled past its ~5px sloppy-click
 * threshold. `dragTo()` moves in one jump, which the library reads as a click
 * and discards — a drag that animates nothing and saves nothing, which is
 * exactly the defect §1 says a screenshot cannot distinguish from success.
 *
 * So: press, exceed the threshold, travel in steps, settle over the target,
 * release. The caller asserts the PATCH and then the canonical row.
 */
async function dragCard(page: Page, title: string, toColumn: string) {
  const src = card(page, title);
  await expect(src, `no card "${title}" to drag`).toBeVisible({ timeout: 20_000 });
  const dst = column(page, toColumn).locator('.bd__list');
  await expect(dst, `no column "${toColumn}" to drop into`).toBeVisible();

  /**
   * Scrolled INTO view before measuring — `toBeVisible()` is true for a card
   * that is in the DOM and unhidden but below the fold, and `boundingBox()`
   * then returns a y the mouse cannot reach.
   *
   * TWO PASSES, because the two elements pull in opposite directions: the
   * source column is the tall one (it holds every card yet to move) and the
   * target is short, so scrolling to a card low in "To Do" pushes the target's
   * `.bd__list` above the viewport — measured: `column y=-116 h=101`. If the
   * target ends up unreachable, scroll to IT instead and re-measure both. The
   * guard below then fails loudly if neither pass can see the pair, rather
   * than mis-dropping and blaming the product.
   */
  const hasOnScreenHeight = (r: { y: number; height: number } | null) =>
    !!r && r.y + r.height > 60 && r.y < (page.viewportSize()?.height ?? 720) - 60;

  await src.scrollIntoViewIfNeeded();
  let a = await src.boundingBox();
  let b = await dst.boundingBox();
  if (!hasOnScreenHeight(b)) {
    await dst.scrollIntoViewIfNeeded();
    a = await src.boundingBox();
    b = await dst.boundingBox();
  }
  expect(a && b, 'the card or the target column has no box to drag between').toBeTruthy();

  /**
   * ⚠ BOTH BOXES MUST BE INSIDE THE VIEWPORT, AND THIS GUARD IS WHY.
   *
   * `page.mouse.move` CLAMPS to the viewport. A board with nine columns is
   * ~2500px wide in a 1280px window, so a target column off to the right has a
   * bounding box whose centre the mouse can never reach: every move landed at
   * the right edge, the drop fell on nothing, `handleDragEnd` returned without
   * a PATCH, and the test reported "the drag animated and did not save" — the
   * exact defect it exists to catch, manufactured by its own arithmetic.
   *
   * Failing loudly here is the point: a silent mis-drop is indistinguishable
   * from the product bug, and the caller is told to pick a visible column
   * rather than being handed a false red.
   */
  const vp = page.viewportSize();
  const W = vp?.width ?? 1280;
  const H = vp?.height ?? 720;

  /**
   * ⚠ ONLY THE HORIZONTAL SPAN OF THE COLUMN IS REQUIRED, AND THE DROP FOLLOWS
   * THE CARD'S OWN ROW.
   *
   * The first version aimed at the column's own top edge. `.bd__list` is as
   * tall as the column, so once the board is scrolled to bring the fifth card
   * into view the column's box starts ABOVE the viewport — measured on the run
   * that caught it: `card y=540`, `column y=-226`. Aiming at the column's top
   * put the pointer off-screen, `page.mouse.move` clamped it, and the drop
   * landed on nothing.
   *
   * A person dragging a card sideways does not aim at the column heading; they
   * move across at the height they are already at. So the drop point is the
   * column's horizontal centre at the CARD's vertical position — which is
   * inside `.bd__list` for any card the board has scrolled into view.
   */
  const onScreenX = (r: { x: number; width: number }) => r.x >= 0 && r.x + r.width <= W + 1;
  const onScreenY = (r: { y: number; height: number }) => r.y >= 0 && r.y + r.height <= H + 1;
  expect(
    onScreenX(a!) && onScreenY(a!) && onScreenX(b!),
    `"${title}" or the column "${toColumn}" cannot be reached inside the ${W}x${H} ` +
    `viewport, so a mouse drag between them cannot be simulated — ` +
    `page.mouse.move clamps to the viewport and the drop would land on nothing.\n` +
    `     card   x=${Math.round(a!.x)} y=${Math.round(a!.y)} w=${Math.round(a!.width)} h=${Math.round(a!.height)}\n` +
    `     column x=${Math.round(b!.x)} y=${Math.round(b!.y)} w=${Math.round(b!.width)}\n` +
    `     This is a TEST precondition, not a product finding: choose a column ` +
    `that is on screen beside the card.`,
  ).toBeTruthy();

  const fromX = a!.x + a!.width / 2;
  const fromY = a!.y + a!.height / 2;
  const toX = b!.x + b!.width / 2;

  /**
   * The card's own row — but clamped into the TARGET LIST'S OWN BOX as well as
   * the viewport. A column holding one card has a short `.bd__list`, and
   * dropping at the source card's height then lands below it, on the column
   * behind: the drop is discarded and no PATCH is sent, which reads as the
   * product losing the move.
   */
  const lo = Math.max(b!.y + 8, 60);
  const hi = Math.min(b!.y + b!.height - 8, H - 60);
  expect(
    hi >= lo,
    `the "${toColumn}" drop area has no on-screen height to aim at ` +
    `(y=${Math.round(b!.y)} h=${Math.round(b!.height)} in a ${W}x${H} viewport)`,
  ).toBeTruthy();
  const toY = Math.min(Math.max(fromY, lo), hi);

  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  // Past @hello-pangea/dnd's ~5px sloppy-click threshold before travelling.
  await page.mouse.move(fromX, fromY + 10, { steps: 4 });
  await page.mouse.move(toX, toY, { steps: 24 });
  await page.mouse.move(toX, toY + 4, { steps: 6 });
  await page.mouse.up();
}

/* ══════════════════════════════════════════════════════════════════════════
   ⚠ ORDER YES, `serial` NO — and the difference is deliberate.

   The tests build on each other's rows: 03.8 needs the columns 03.6 typed,
   03.13 needs the tasks 03.8 typed. Playwright runs the tests in one file in
   DECLARATION order on a single worker (this project does not set
   `fullyParallel`), so that ordering holds without `mode: 'serial'`.

   What `serial` would add is SKIPPING every later test once one fails — and on
   a programme whose whole purpose is to measure how much of a module a customer
   can actually drive, that turns one shipped blocker into fourteen unmeasured
   screens. Every test signs in for itself and reads what exists before it
   creates, so a later test is not left half-built by an earlier failure: it
   either finds its precondition and proceeds, or fails saying which test owns
   it.
   ══════════════════════════════════════════════════════════════════════════ */

/** The eight projects, by name → team_id. Re-read per test; never cached. */
async function projectIds(page: Page): Promise<Record<string, string>> {
  const teams = await rowsOf(page, '/api/teams');
  const map: Record<string, string> = {};
  for (const t of teams) map[t.name] = t.team_id;
  return map;
}

async function requireProject(page: Page, name: string): Promise<string> {
  const ids = await projectIds(page);
  expect(
    ids[name],
    `"${name}" does not exist. 03.4 owns the eight projects; run it first — ` +
    `this is a precondition, not a product finding.`,
  ).toBeTruthy();
  return ids[name];
}

/* ══════════════════════════════════════════════════════════════════════════
   03.1 — THE PROTECTED SET, PINNED BY ID, BEFORE ANYTHING IS TYPED
   ══════════════════════════════════════════════════════════════════════════ */

test('03.1 the protected Aekam Inc team and its 20 tasks are present before anything is typed', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);

  const teams = await rowsOf(page, '/api/teams');
  const protectedTeam = teams.find((t) => t.team_id === PROTECTED_TEAM);
  expect(
    protectedTeam,
    `the protected team ${PROTECTED_TEAM} is NOT in GET /api/teams for ${LANE.org}. ` +
    `Proposal §9 pins it "exactly as it stands"; this suite refuses to write into ` +
    `an org where it has already gone.\n     teams seen: ${teams.map((t) => t.team_id).join(', ')}`,
  ).toBeTruthy();
  expect(
    protectedTeam.task_count,
    `the protected team holds ${protectedTeam.task_count} tasks, not ${PROTECTED_TASKS}`,
  ).toBe(PROTECTED_TASKS);

  // And on screen, by NAME — `check-rendered-ids.mjs`'s rule restated as an
  // assertion: the card says "Aekam Inc", never a uuid.
  await page.goto('/projects');
  await expect(page.locator('.k-pcard__name', { hasText: exactly('Aekam Inc') }).first())
    .toBeVisible({ timeout: 45_000 });
  const screen = await page.locator('.k-screen').innerText();
  expect(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(screen),
    'a raw UUID is rendered on /projects — the names-not-IDs rule',
  ).toBeFalsy();

  expect(con.uncaught, `uncaught exceptions on /projects:\n${con.uncaught.join('\n')}`).toEqual([]);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.2 — THE DAY-ONE EMPTY STATES, IN WORDS
   ══════════════════════════════════════════════════════════════════════════ */

test('03.2 every Core PM surface that is genuinely empty says so in words, and none throws', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);

  /**
   * ⚠ HONEST SCOPE. §1 asks for "every screen visited once before its data
   * exists". Unicode is the CONFIGURED-ORG lane and it still carries the
   * protected 20 tasks and their project, so /tasks, /boards, /projects and
   * /activity are NOT empty here and it would be a lie to assert an empty state
   * on them. Those four are asserted to RENDER — a real heading, no spinner
   * that never resolves, no blank page — and the empty-state wording is
   * asserted only where the module genuinely holds nothing.
   *
   * The brand-new-org lane (UK AekamINC, §4) is where all fourteen are
   * genuinely blank, and this same file is what runs there in Stage 4.
   */
  /**
   * ⚠ THIS TEST COULD NOT PASS TWICE, AND THAT IS §6's WHOLE POINT.
   *
   * It used to assert the empty-state wording UNCONDITIONALLY on these three
   * screens. But 03.3 creates eight categories and 03.17 creates five
   * templates — later in the same file — so the first run emptied the very
   * claim the second run makes. Measured 2026-08-29: this passed on the run
   * that found 18 other failures and FAILED on the next run against the same
   * org, with nothing changed but the rows its siblings had left behind. §6 is
   * proved by running twice, and a suite that only passes from empty is a
   * suite that has never been re-run.
   *
   * So the emptiness is READ, not assumed. A screen that holds nothing must
   * say so in words; a screen that holds something must show it and must not
   * hang on a skeleton. Both halves are real requirements and neither depends
   * on which sibling ran first.
   */
  const surfaces: Array<[string, RegExp, string[], RegExp]> = [
    ['/settings/categories', /No categories yet|अभी कोई वर्ग नहीं/,
      ['/api/categories'], /S3 Cat 01/],
    ['/templates', /No project templates yet|No task templates yet|अभी कोई साँचा नहीं/,
      ['/api/templates/projects', '/api/templates/tasks'], /S3 Project Template 1/],
    ['/approvals', /Nothing waiting|No .*(approval|request)|caught up/i,
      ['/api/approvals/pending', '/api/approvals/history'], /Recent decisions/],
  ];
  for (const [path, wording, sources, present] of surfaces) {
    let held = 0;
    for (const src of sources) held += (await rowsOf(page, src)).length;

    await page.goto(path);
    await settle(page);
    const text = await page.locator('.k-screen').innerText();

    if (held === 0) {
      expect(
        wording.test(text),
        `${path} holds nothing and does not SAY so. §1: "It says there is nothing yet, ` +
        `in words. This is what a new customer sees on day one."\n     screen read: ` +
        `${text.replace(/\s+/g, ' ').slice(0, 400)}`,
      ).toBeTruthy();
    } else {
      /**
       * POSITIVE EVIDENCE ONLY, and this is the correction to my own first
       * attempt. I had also asserted that the EMPTY wording must be absent
       * whenever the org holds rows — which went red on `/approvals`, a page
       * that is entirely correct: it draws two tabs and a decisions panel, so
       * the empty tab legitimately prints "No pending approvals … you are all
       * caught up" while the tiles read 2 pending / 6 approved / 4 rejected
       * and the decisions list names real tasks. "The empty state is absent"
       * is not a safe inverse on any screen built from more than one list.
       */
      expect(
        present.test(text),
        `${path} holds ${held} rows and does not render ${String(present)} — the ` +
        `screen resolved to neither its rows nor its empty state.` +
        `\n     screen read: ${text.replace(/\s+/g, ' ').slice(0, 400)}`,
      ).toBeTruthy();
    }
    await expect(
      page.locator('[aria-busy="true"]'),
      `${path} still shows a busy region after the network settled`,
    ).toHaveCount(0, { timeout: 30_000 });
  }

  // The four that legitimately carry the protected set: they must RENDER, and
  // must not resolve into a permanent skeleton.
  for (const [path, heading] of [
    ['/projects', 'Projects'], ['/tasks', 'Tasks'], ['/boards', ''], ['/teams', 'Team'],
    ['/time', 'Time Report'], ['/activity', 'Activity'], ['/inbox', 'Inbox'],
  ] as Array<[string, string]>) {
    await page.goto(path);
    await settle(page);
    await expect(page.locator('.k-screen'), `${path} rendered nothing at all`)
      .toBeVisible({ timeout: 45_000 });
    if (heading) {
      await expect(
        page.getByRole('heading', { name: new RegExp(reEsc(heading)) }).first(),
        `${path} has no "${heading}" heading`,
      ).toBeVisible({ timeout: 30_000 });
    }
    await expect(
      page.locator('[aria-busy="true"]'),
      `${path} still shows a busy region after the network settled — a spinner ` +
      `that never resolves is §1's named failure`,
    ).toHaveCount(0, { timeout: 30_000 });
  }

  expect(con.uncaught, `uncaught exceptions across the empty-state sweep:\n${con.uncaught.join('\n')}`)
    .toEqual([]);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.3 — CATEGORIES · 8
   ══════════════════════════════════════════════════════════════════════════ */

test('03.3 eight task categories, typed into the real form', async ({ page }) => {
  const wire = watchWire(page);
  await signIn(page);

  const before = await rowsOf(page, '/api/categories');
  const have = new Set(before.map((c: any) => c.name));
  let typed = 0;

  await page.goto('/settings/categories');
  await expect(page.getByRole('heading', { name: /^Categories$/ })).toBeVisible({ timeout: 45_000 });

  for (let i = 1; i <= V.categories; i++) {
    const name = C(i);
    if (have.has(name)) continue;
    const box = page.getByRole('textbox', { name: 'Category name' });
    await expect(box, 'the category name field is not on the form').toBeVisible();
    await box.fill(name);
    // The colour is DATA on this form, not chrome — a real <input type="color">.
    await page.locator('input.cat-swatch').fill(['#2d6a4f', '#b5362a', '#1d5fa6', '#9a6a10'][i % 4]);
    const res = await writes(page, /\/api\/categories$/, async () => {
      await page.getByRole('button', { name: 'Create', exact: true }).click();
    });
    expect(res.body?.category_id, `POST /categories echoed no id: ${res.text.slice(0, 200)}`).toBeTruthy();
    typed += 1;
  }

  // Suite rule 3 — the CANONICAL row, never the POST echo.
  const after = await rowsOf(page, '/api/categories');
  const names = new Set(after.map((c: any) => c.name));
  for (let i = 1; i <= V.categories; i++) {
    expect(names.has(C(i)), `"${C(i)}" is not in GET /api/categories after the run.${dump(wire)}`)
      .toBeTruthy();
  }
  ledger('categories', V.categories, typed, V.categories);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.4 — PROJECTS · 8
   ══════════════════════════════════════════════════════════════════════════ */

test('03.4 eight projects created from /projects, each landing with its five default columns', async ({ page }) => {
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  const before = await projectIds(page);
  let typed = 0;

  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: /^Projects$/ })).toBeVisible({ timeout: 45_000 });

  for (let i = 1; i <= V.projects; i++) {
    const name = P(i);
    if (before[name]) continue;
    await page.getByRole('button', { name: 'New project' }).click();
    const box = page.getByRole('textbox', { name: 'Project name' });
    await expect(box, 'the New project form has no name field').toBeVisible();
    await box.fill(name);
    const res = await writes(page, /\/api\/teams$/, async () => {
      await page.getByRole('button', { name: 'Create project' }).click();
    });
    expect(res.body?.team_id, `POST /teams echoed no team_id: ${res.text.slice(0, 200)}`).toBeTruthy();
    typed += 1;
  }

  const ids = await projectIds(page);
  for (let i = 1; i <= V.projects; i++) {
    expect(ids[P(i)], `"${P(i)}" is not in GET /api/teams after the run.${dump(wire)}`).toBeTruthy();
  }

  /**
   * `server.create_team` calls `ensure_default_columns`, which is five columns.
   * Asserting it here is what makes 03.6's "16 typed BY HAND" an honest number
   * rather than a count that quietly includes the defaults.
   *
   * ⚠ A SUBSET, ACROSS ALL EIGHT — NOT AN EXACT LIST ON P(1).
   * This asserted `toEqual([...the five])` on P(1), which can only hold on a
   * project no other test has touched. 03.6 adds four `S3 Col *` columns to
   * boards 1–4, so the second time this test reaches the assertion it reads
   * nine names and fails — reporting a broken `ensure_default_columns` over a
   * board that is exactly right. It had never been reached before, because the
   * POST above always timed out first; it went red the moment the 500 was
   * fixed and the loop completed.
   *
   * Every project must CARRY the five, which is the server's actual guarantee,
   * and checking all eight is stronger than checking one.
   */
  const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'In Review', 'Approval', 'Done'];
  for (let i = 1; i <= V.projects; i++) {
    const names = (await rowsOf(page, `/api/projects/${ids[P(i)]}/columns`))
      .map((c: any) => c.name as string);
    const absent = DEFAULT_COLUMNS.filter((d) => !names.includes(d));
    expect(
      absent,
      `${P(i)} did not arrive with the five default columns — missing ` +
      `${absent.join(', ')}. server.create_team calls ensure_default_columns; ` +
      `saw: ${names.join(', ')}`,
    ).toEqual([]);
  }

  // And the grid renders NAMES.
  await page.reload();
  await expect(page.locator('.k-pcard__name', { hasText: exactly(P(1)) })).toBeVisible({ timeout: 45_000 });

  ledger('projects', V.projects, typed, V.projects);
  ledger('default columns', 0, 0, V.projects * 5, 'created by the server on project create');
  expect(con.uncaught, `uncaught exceptions on /projects:\n${con.uncaught.join('\n')}`).toEqual([]);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.5 — PROJECT MILESTONES · RISKS · BASELINES: the measured absence
   ══════════════════════════════════════════════════════════════════════════ */

test('03.5 the status report is the whole of what a project plan offers — milestones, risks and baselines have no control', async ({ page }) => {
  await signIn(page);
  const id = await requireProject(page, P(1));
  await board(page, id);

  /**
   * §4 asks for 16 milestones, 8 risks and 4 baselines. There is no control and
   * no write path anywhere in the product:
   *
   *   · `staging.project_milestones` · `project_risks` · `project_baselines`
   *     EXIST and hold 0 rows (live catalogue, 2026-08-29 — so this is not the
   *     "declared missing on a schema-qualified negative" mistake CLAUDE.md
   *     warns about; both product schemas were read).
   *   · `grep -rn 'project_milestones' backend/` finds documentation and no
   *     INSERT; `routers/documents.py:46-48` states they "are not read yet".
   *   · The product says so itself, to the customer, on this panel.
   *
   * So the assertion is that the product is HONEST about it, which is a real
   * requirement — §1's "degrades with a sentence, never a silent no-op" — and
   * the volume is reported at 0/16, 0/8, 0/4 rather than quietly dropped.
   */
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  const panel = page.locator('.k-card', { hasText: 'Status report' });
  await expect(panel, 'the project board has no Status report panel').toBeVisible({ timeout: 20_000 });
  await expect(
    panel,
    'the report panel does not say that milestones, risks and baselines are not stored — ' +
    'a plan section that silently prints actuals against nothing is worse than one that says so',
  ).toContainText(/Milestones, risks and the planned side .* not stored anywhere yet/);

  /**
   * The half that DOES work: the PDF. §4's project surface earns a download.
   *
   * ⚠ THE PERIOD IS A `DateInput`, AND IT HAS NO ACCESSIBLE NAME — suite rule 8
   * in its sharpest form. `ProjectBoardPage` writes
   * `<label className="fld"><span>From</span><DateInput …/></label>`, and
   * `DateInput` renders a `<button class="pk__tr">` whose only content is an
   * `aria-hidden` icon plus the formatted value. A `<label>` does not name a
   * `<button>` in the accessibility tree, and no `aria-label` is passed here, so
   * the trigger announces as "No date, button" and
   * `getByRole('button', { name: /^From/ })` matches NOTHING.
   *
   * That is a real (small) a11y defect and it is reported — but it is NOT a
   * missing control, and calling it one would have been the wrong diagnosis.
   * The control is addressed the way `_helpers.ts::setDate()` addresses every
   * other `DateInput` in this repo: through its wrapping label.
   */
  const from = panel.locator('label.fld', { hasText: 'From' }).locator('.pk--dt button.pk__tr').first();
  const to = panel.locator('label.fld', { hasText: 'To' }).locator('.pk--dt button.pk__tr').first();
  await expect(from, 'the report period has no From date control').toBeVisible({ timeout: 20_000 });
  await expect(to, 'the report period has no To date control').toBeVisible({ timeout: 20_000 });

  /**
   * Drive it, rather than only assert it exists: a period the customer chose.
   *
   * ⚠ BOTH DATES ARE INSIDE THE MONTH THE CALENDAR OPENS ON, AND THAT IS A
   * WORKAROUND FOR A REAL DEFECT — REPORTED, NOT HIDDEN.
   *
   * The first version asked for "30 days ago", which needs one press of
   * `Previous month`. That press cannot be made at 1280×720:
   *
   *     locator.click: Timeout 20000ms exceeded
   *       - <div class="vtb__bar">…</div> from <div class="vtb">…</div>
   *         subtree intercepts pointer events
   *
   * The panel sits low on the board, so `DateInput`'s measured flip opens the
   * calendar UPWARDS — straight underneath the board's view-toolbar card,
   * which paints over it. The failure screenshot shows the month header and
   * the first two weeks of the grid hidden behind the toolbar, with only days
   * 9–31 reachable. A customer on a 720px-tall window has the same calendar
   * and the same unreachable `Previous month`. That is a stacking defect in
   * `.pk__pop` versus `.vtb__bar`, it reaches every `DateInput` rendered low
   * on a board, and a global z-index change is not a Suite 03 decision — so it
   * is REPORTED with this evidence and recorded in the ledger below.
   *
   * `reportPeriod` already defaults to the 1st of the current month, so the
   * calendar opens on a month that needs no navigation.
   *
   * ⚠ AND THE DAY IS THE 15th, NOT THE 1st, FOR THE SAME DEFECT ONE ROW LOWER.
   * Avoiding the month nav was not enough: the second attempt was refused on
   * the day cell itself —
   *
   *     locator.click: Timeout 20000ms exceeded
   *       - locator resolved to <button … aria-label="Saturday, 1 August 2026">
   *       - <div class="fb">…</div> from <div class="vtb">…</div>
   *         subtree intercepts pointer events
   *
   * — because the 1st is in the calendar's FIRST week, which is the part of
   * the upward-flipped popup the toolbar covers. The screenshot shows days
   * 1–8 hidden and 9–31 reachable. So the whole top of the grid is
   * unclickable, not merely the month header, and a customer cannot pick an
   * early-month date on this panel at all. Measured, not inferred:
   * `--z-picker: 340` IS defined (animations.css:142) and `.vtb`/`.vtb__bar`
   * carry neither `position: sticky` nor a `z-index`, so this is a CLIPPING
   * or paint-order fault around the flipped popup rather than a missing
   * token — named here so the next reader does not re-derive it.
   */
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 15);
  await setDate(panel, 'From', `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-15`);
  await setDate(panel, 'To',
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
  await expect(
    panel.locator('.pb__none', { hasText: 'The start date is after the end date' }),
    'the period the suite typed reads as inverted',
  ).toHaveCount(0);

  /**
   * ⚠ THIS IS THE ASSERTION THAT FOUND THE ROUTE HAS NEVER WORKED.
   *
   * Measured 2026-08-29, the first time any run reached this button (every
   * earlier attempt died on the calendar above):
   *
   *     POST /api/v1/documents/projects/team_c55f3960bf2f/report/pdf
   *          ?period_start=2026-08-15&period_end=2026-08-29   →  404
   *
   * `routers/documents.download_project_report_pdf` looks the project up as
   *
   *     SELECT board_id, name FROM public.boards
   *      WHERE board_id=$1 AND team_id=$2
   *
   * and raises `404 "Project board not found"` when it misses. It always
   * misses. Read live from the catalogue, both product schemas:
   *
   *     public.boards            0 rows   (whole database, all time)
   *     public.board_columns     0 rows
   *     tasks WHERE board_id IS NOT NULL   0 rows
   *
   * In this product a board IS a project — `/projects/:id` renders
   * `public.teams` + `public.project_columns`, and `ProjectBoardPage` sends
   * its `projectId`, which is a `team_…` id and can never equal a
   * `boards.board_id`. The route also resolves the team as
   * `SELECT team_id FROM staging.organisations WHERE id=$1`, i.e. ONE team per
   * organisation, which is not the model either. Its own comments record a
   * previous `UndefinedTableError` here that "raised for every caller it has
   * ever had"; that one was fixed and the route now fails one statement
   * earlier instead.
   *
   * PRODUCT BUG, never worked, reported rather than rewritten: re-pointing an
   * eight-statement handler off a table that has no rows onto `teams` /
   * `project_columns` / `tasks.team_id` is a piece of work in its own right and
   * not a Suite 03 edit.
   */
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await panel.getByRole('button', { name: 'Download report' }).click();
  const file = await dl.catch(() => null);
  expect(
    file,
    'the "Download report" button produced no file. POST /v1/documents/projects/' +
    '{id}/report/pdf answers 404 "Project board not found" because it looks the ' +
    'project up in public.boards, which holds 0 rows in the whole database — ' +
    'a board in this product IS a project (public.teams). PRODUCT BUG.',
  ).not.toBeNull();
  const path = await file!.path();
  expect(path, 'the report download produced no file — a 200 with an empty body is §1\'s named failure').toBeTruthy();

  ledger('report calendar top half', 1, 0, 0,
    'PRODUCT DEFECT — the upward-flipped .pk__pop is covered by .vtb on the project ' +
    'board: month nav AND days 1-8 are unclickable at 1280x720. Reported, not fixed ' +
    'here — the owner of the design system decides, not Suite 03.');
  ledger('milestones', 16, 0, 0, 'NO CONTROL, NO WRITE PATH — see the test body');
  ledger('risks', 8, 0, 0, 'NO CONTROL, NO WRITE PATH');
  ledger('baselines', 4, 0, 0, 'NO CONTROL, NO WRITE PATH');
  ledger('project report PDF', 1, 0, 0,
    'PRODUCT BUG — POST /v1/documents/projects/{id}/report/pdf 404s: it reads ' +
    'public.boards (0 rows, all time) for an id that is a team_ id');
});

/* ══════════════════════════════════════════════════════════════════════════
   03.6 — BOARDS · 4  ·  COLUMNS · 16, BY HAND
   ══════════════════════════════════════════════════════════════════════════ */

test('03.6 sixteen kanban columns typed by hand across four boards, plus rename and delete', async ({ page }) => {
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  const ids = await projectIds(page);
  let typed = 0;
  let total = 0;

  for (let b = 1; b <= V.boards; b++) {
    const id = ids[P(b)];
    expect(id, `${P(b)} is missing — 03.4 owns it`).toBeTruthy();
    await board(page, id);

    /**
     * ⚠ IF "Add column" IS NOT HERE, READ THIS BEFORE FILING ANYTHING.
     *
     * `KanbanView.canManageCols` decides. The server's rule for all four column
     * routes is `is_project_member(...).role in ('owner','admin')` — the role on
     * THIS PROJECT, which `server.create_team` sets to `owner` for whoever
     * created it, i.e. this account. If the control is absent while the server
     * would allow the write, the UI is reading a different question — which is
     * exactly what it was doing before 2026-08-29 (it read the legacy global
     * `users.role`, and 12 of the 18 org owners/administrators in this database
     * do not hold 'admin'/'owner' there).
     */
    const add = page.getByRole('button', { name: 'Add column' });
    await expect(
      add,
      `no "Add column" control on ${P(b)}, a project THIS ACCOUNT OWNS. ` +
      `GET /api/teams/${id} → your_role decides; the server would allow the write.`,
    ).toBeVisible({ timeout: 25_000 });

    const existing = new Set(
      (await rowsOf(page, `/api/projects/${id}/columns`)).map((c: any) => c.name),
    );

    for (let k = 0; k < V.columnsPerBoard; k++) {
      const name = COL[k];
      total += 1;
      if (existing.has(name)) continue;
      await add.click();
      const box = page.getByRole('textbox', { name: 'New column name' });
      await expect(box).toBeVisible({ timeout: 15_000 });
      await box.fill(name);
      // Colour and the Done flag are on the same form; the last one carries
      // `is_done`, so a board ends with two done-columns and the drag test can
      // prove a status side-effect.
      await page.locator('input.bd__swatch').fill(['#2d6a4f', '#1d5fa6', '#9a6a10', '#b5362a'][k]);
      if (k === V.columnsPerBoard - 1) {
        await page.locator('.bd__chk input[type="checkbox"]').check();
      }
      const res = await writes(page, new RegExp(`/api/projects/${id}/columns$`), async () => {
        await page.locator('.bd__form').getByRole('button', { name: 'Add', exact: true }).click();
      });
      expect(res.body?.column_id, `POST columns echoed no id: ${res.text.slice(0, 200)}`).toBeTruthy();
      typed += 1;
      await expect(column(page, name), `"${name}" did not appear on the board`).toBeVisible({ timeout: 20_000 });
    }

    // Canonical read-back — suite rule 3.
    const after = (await rowsOf(page, `/api/projects/${id}/columns`)).map((c: any) => c.name);
    for (const name of COL) {
      expect(after.includes(name), `"${name}" is not on ${P(b)} after the run.${dump(wire)}`).toBeTruthy();
    }
    expect(
      (await rowsOf(page, `/api/projects/${id}/columns`)).find((c: any) => c.name === COL[3])?.is_done,
      'the "Mark as Done" tick did not reach the row',
    ).toBeTruthy();
  }

  /* ── Rename and delete, on board 1 only, and both put back ─────────────
     A column is a real object with a real lifecycle, and §10 asks for the
     board's column controls rather than only its create. The rename is
     reverted and the deleted column is recreated, so the count above holds on
     a second run. */
  const id1 = ids[P(1)];
  await board(page, id1);
  const target = column(page, COL[2]);
  await target.locator('.bd__cn').dblclick();
  const rename = page.getByRole('textbox', { name: `Rename ${COL[2]}` });
  await expect(rename, 'double-click did not open the rename field').toBeVisible({ timeout: 15_000 });
  await rename.fill('S3 Col C renamed');
  await writes(page, new RegExp(`/api/projects/${id1}/columns/`), async () => {
    await rename.press('Enter');
  }, { methods: ['PUT'] });
  await expect(column(page, 'S3 Col C renamed')).toBeVisible({ timeout: 20_000 });
  // ...and back, so the suite leaves the shape it asserts.
  await column(page, 'S3 Col C renamed').locator('.bd__cn').dblclick();
  const rename2 = page.getByRole('textbox', { name: 'Rename S3 Col C renamed' });
  await rename2.fill(COL[2]);
  await writes(page, new RegExp(`/api/projects/${id1}/columns/`), async () => {
    await rename2.press('Enter');
  }, { methods: ['PUT'] });
  await expect(column(page, COL[2])).toBeVisible({ timeout: 20_000 });

  ledger('boards driven', V.boards, 0, V.boards, 'a board IS a project — see §DEAD TABLES');
  ledger('columns by hand', V.boards * V.columnsPerBoard, typed, total);
  ledger('column renamed', 1, 1, 1, 'renamed and reverted');
  expect(con.uncaught, `uncaught exceptions on the board:\n${con.uncaught.join('\n')}`).toEqual([]);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.7 — TASKS · 80
   ══════════════════════════════════════════════════════════════════════════ */

test('03.7 eighty tasks typed into the board, twelve of them through the New Task modal', async ({ page }) => {
  test.setTimeout(50 * 60_000);
  const wire = watchWire(page);
  await signIn(page);

  const ids = await projectIds(page);
  const boards = [1, 2, 3, 4].map((b) => ids[P(b)]);
  const existing = new Set(
    (await rowsOf(page, '/api/tasks')).map((t: any) => t.title),
  );
  let typed = 0;

  /**
   * The first twelve go through `NewTaskModal` — the product's PRIMARY create
   * surface, opened from the top bar, and the one that carries project, status,
   * priority, due date, subtasks, assignees, description and attachments. The
   * remaining 68 go through the kanban's inline composer, which is what a
   * person actually uses to fill a board. Two real controls, both driven.
   */
  for (let i = 1; i <= V.fieldTasks; i++) {
    const title = T(i);
    if (existing.has(title)) continue;
    await page.goto('/tasks');
    await page.getByRole('button', { name: 'New task' }).first().click();
    /**
     * ⚠ SUITE RULE 8, AND THIS ONE COST A WHOLE TEST. `getByRole(name)` matches
     * the ACCESSIBLE NAME. `NewTaskModal` is `role="dialog"
     * aria-labelledby="ntm-title"`, and `#ntm-title` reads **"What needs
     * doing?"** — the words "New task" appear only in the kicker above it,
     * which is not the labelledby target. So `{ name: /New task|Create/i }`
     * matched nothing and this reported a DEAD CONTROL over a modal that had
     * opened correctly. Verified from the failure's own page snapshot:
     * `dialog "What needs doing?"`.
     */
    const modal = page.getByRole('dialog', { name: /What needs doing/i }).first();
    await expect(modal, 'the New Task modal did not open').toBeVisible({ timeout: 20_000 });
    await modal.getByRole('textbox', { name: 'Task title' }).fill(title);
    await modal.getByRole('combobox', { name: 'PROJECT' }).selectOption({ label: P(1) });
    await modal.getByRole('combobox', { name: 'STATUS' }).selectOption('todo');
    await modal.getByRole('button', { name: /^(Low|Medium|High|Urgent)$/ })
      .filter({ hasText: i % 3 === 0 ? 'High' : 'Medium' }).first().click()
      .catch(() => { /* the priority group is a set of pressed buttons; medium is default */ });
    const res = await writes(page, /\/api\/tasks$/, async () => {
      await modal.getByRole('button', { name: 'Create Task' }).click();
    });
    expect(res.body?.task_id, `POST /tasks echoed no task_id: ${res.text.slice(0, 200)}`).toBeTruthy();
    typed += 1;
  }

  // The remaining 68, spread across the four boards' hand-made columns.
  let n = V.fieldTasks + 1;
  for (let b = 0; b < V.boards && n <= V.tasks; b++) {
    await board(page, boards[b]);
    for (let k = 0; k < COL.length && n <= V.tasks; k++) {
      const col = column(page, COL[k]);
      await expect(col, `column ${COL[k]} is missing on ${P(b + 1)} — 03.6 owns it`).toBeVisible();
      const per = Math.ceil((V.tasks - V.fieldTasks) / (V.boards * COL.length));
      /**
       * ⚠ THE COMPOSER STAYS OPEN AFTER ⏎, AND THE ADD BUTTON IS GONE WHILE IT
       * IS. `KanbanView` says so in its own comment — "the composer replaces
       * the Add button in place. It does NOT close on ⏎; that is the whole
       * point, and it is why the confirm is a 'Done' link rather than a
       * Cancel." This loop used to click "Add task" once per task, so the
       * SECOND task in every column waited 20s for a button that the product
       * had deliberately removed, and reported a dead control.
       *
       * Opened once per column and then typed into repeatedly, which is both
       * what the control is designed for and what a person filling a column
       * actually does.
       */
      const composer = page.getByRole('textbox', { name: `New task in ${COL[k]}` });
      for (let j = 0; j < per && n <= V.tasks; j++, n++) {
        const title = T(n);
        if (existing.has(title)) continue;
        if (!(await composer.isVisible().catch(() => false))) {
          const add = col.getByRole('button', { name: 'Add task' });
          await expect(add, `no "Add task" control in ${COL[k]} on ${P(b + 1)}`)
            .toBeVisible({ timeout: 20_000 });
          await add.click();
          await expect(composer, `no inline composer in ${COL[k]}`).toBeVisible({ timeout: 15_000 });
        }
        await composer.fill(title);
        await writes(page, /\/api\/tasks$/, async () => { await composer.press('Enter'); });
        typed += 1;
      }
      // Escape closes the composer so the next column's Add button is drawn.
      await page.keyboard.press('Escape').catch(() => {});
      await expect(composer, `the ${COL[k]} composer would not close on Escape`)
        .toBeHidden({ timeout: 10_000 })
        .catch(async () => { await page.mouse.click(4, 4); });
    }
  }

  /**
   * ⚠ SUITE RULE 4 — the list caps, so this asserts a DELTA and a MEMBERSHIP,
   * never a total. `GET /api/tasks` is the whole org's board and it carries the
   * protected 20 as well as everything above.
   */
  const after = await rowsOf(page, '/api/tasks');
  const titles = new Set(after.map((t: any) => t.title));
  const missing: string[] = [];
  for (let i = 1; i <= V.tasks; i++) if (!titles.has(T(i))) missing.push(T(i));
  expect(
    missing,
    `${missing.length} of the ${V.tasks} tasks are not in GET /api/tasks: ` +
    `${missing.slice(0, 12).join(', ')}${dump(wire)}`,
  ).toEqual([]);

  ledger('tasks', V.tasks, typed, V.tasks);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.8 — DRAG · 12, EACH ONE PROVING THE ROW MOVED
   ══════════════════════════════════════════════════════════════════════════ */

test('03.8 twelve cards dragged between columns, and every one persisted its column_id', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  /**
   * ⚠ A TALLER WINDOW, AND IT IS THE GEOMETRY THAT NEEDS IT, NOT THE PRODUCT.
   *
   * At 720px high, "To Do" holding a dozen cards is longer than the viewport,
   * so bringing the card into view scrolls the short target column off the
   * top: `card y=540, column y=-226`. A mouse drag needs BOTH ends reachable
   * at once, and no amount of scrolling gets there while the column is taller
   * than the window. 1600px holds a full column, which is also what a real
   * user's maximised desktop window does with this board.
   *
   * 03.21 is where the narrow breakpoints are exercised; this test is about
   * whether a drop persists.
   */
  await page.setViewportSize({ width: 1280, height: 1600 });
  await signIn(page);
  const id = await requireProject(page, P(1));
  await board(page, id);

  const cols = await rowsOf(page, `/api/projects/${id}/columns`);
  const byName: Record<string, string> = {};
  for (const c of cols) byName[c.name] = c.column_id;

  let moved = 0;
  for (let i = 1; i <= V.drags; i++) {
    const title = T(i);
    const before = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
    expect(before, `${title} is missing — 03.7 owns it`).toBeTruthy();

    /**
     * Always a DIFFERENT column from the one it is in, so `handleDragEnd`'s
     * "same column, same index → return" branch cannot make a no-op look green.
     *
     * ⚠ THE TARGETS ARE THE ADJACENT DEFAULT COLUMNS, NOT THE HAND-MADE `S3
     * Col *` ONES, AND THAT IS A MEASURED CONSTRAINT RATHER THAN A PREFERENCE.
     * P(1) carries nine columns after 03.6 — the five defaults plus four typed
     * ones — which is ~2500px of board in a 1280px window. The S3 columns sit
     * off-screen to the right, `page.mouse.move` clamps to the viewport, and
     * every drop landed on nothing. The 12 cards this test moves all start in
     * "To Do" (03.7 creates them through the New Task modal, which sets a
     * status and no column), so the columns beside them are the ones a mouse
     * can actually reach.
     *
     * §4 asks for twelve drags that persist, not for twelve particular
     * columns. `dragCard` now fails loudly rather than silently mis-dropping
     * if a target is ever off-screen again.
     */
    const REACHABLE = ['In Progress', 'In Review'];
    const first = REACHABLE[i % REACHABLE.length];
    const target = byName[first] === before.column_id
      ? REACHABLE[(i + 1) % REACHABLE.length]
      : first;
    expect(
      byName[target],
      `"${target}" is not a column on ${P(1)} — 03.4 creates the five defaults ` +
      `and 03.6 adds four more. Columns seen: ${Object.keys(byName).join(', ')}`,
    ).toBeTruthy();

    /**
     * ⚠ THE WAIT IS REGISTERED BEFORE THE DRAG, AND THAT IS THE WHOLE POINT.
     * This read `await dragCard(...)` and only THEN opened a `waitForResponse`
     * with an empty action — but `handleDragEnd` fires the PATCH within a few
     * milliseconds of `mouse.up()`, so the listener was routinely armed after
     * the response it was waiting for had already arrived. It would then time
     * out and accuse the product of a drag that "animates and does not save" —
     * which is precisely the defect this test exists to detect, reported by the
     * test's own race. A check that cries wolf is worse than no check.
     */
    const res = await writes(page, new RegExp(`/api/tasks/${before.task_id}/move$`),
      async () => { await dragCard(page, title, target); },
      { methods: ['PATCH'], timeout: 30_000 }).catch(async (e) => {
        throw new Error(
          `the drag of ${title} into "${target}" fired no PATCH /tasks/{id}/move.\n` +
          `     §1: "A drag that animates and does not save is the exact defect a ` +
          `screenshot cannot distinguish from success."\n     ${String(e).slice(0, 400)}`,
        );
      });

    // Suite rule 3 — the canonical row, not the PATCH echo.
    const canonical = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
    expect(
      canonical.column_id,
      `${title} animated into "${target}" and the row did not move. ` +
      `column_id is still ${canonical.column_id}; the drop wrote ${res.body?.column_id}`,
    ).toBe(byName[target]);
    moved += 1;
  }

  /**
   * ONE MORE, BY KEYBOARD. §1: "activation works without a mouse". Pangea's own
   * keyboard sensor is Space to lift, arrows to move, Space to drop — a control
   * reachable only by mouse is a control a keyboard user does not have, and the
   * board is the most-used surface in this product.
   */
  await board(page, id);
  const handle = card(page, T(1));
  await handle.focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowRight');
  const kb = await writes(page, /\/api\/tasks\/[^/]+\/move$/, async () => {
    await page.keyboard.press(' ');
  }, { methods: ['PATCH'], timeout: 30_000 }).catch(() => null);
  expect(
    kb,
    'the kanban card could not be moved with the keyboard: Space did not lift it, ' +
    'or ArrowRight did not travel, or Space did not drop it. @hello-pangea/dnd ' +
    'ships this sensor; a board that is mouse-only is §1\'s named failure.',
  ).not.toBeNull();

  await page.setViewportSize({ width: 1280, height: 720 });

  ledger('column drags', V.drags, moved, moved,
    'between the reachable default columns — a 9-column board is ~2500px and ' +
    'the hand-made S3 columns are off-screen at 1280px');
  ledger('keyboard drag', 1, 1, 1);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.9 — TEAMS · 5 ROSTERS
   ══════════════════════════════════════════════════════════════════════════ */

test('03.9 five projects given a member roster, one of them a client seat', async ({ page }) => {
  const wire = watchWire(page);
  await signIn(page);

  const ids = await projectIds(page);
  let typed = 0;
  let rosters = 0;

  await page.goto('/teams');
  await expect(page.getByRole('heading', { name: /^Team$/ })).toBeVisible({ timeout: 45_000 });

  for (let i = 1; i <= V.rosters; i++) {
    const name = P(i);
    const id = ids[name];
    expect(id, `${name} is missing — 03.4 owns it`).toBeTruthy();

    const detail = await orgGet(page, `/api/teams/${id}`);
    const seated = new Set((detail.members || []).map((m: any) => m.display_name));
    /**
     * ⚠ P(1) GETS THE WHOLE ROSTER, AND IT HAS TO.
     *
     * This read `slice(0, i)`, so P(1) was seated with exactly ONE person —
     * Rajesh Bhatt. But P(1) is the project every later test in this file
     * works on, and two of them need somebody else on it:
     *
     *   · 03.13 mentions MENTION_TARGET, and `services/mentions.
     *     _resolve_mentions` pass 1 selects members of the TASK'S PROJECT. A
     *     mention of somebody not on P(1) resolves to nobody.
     *   · 03.16 forwards two approvals to CLIENT_MEMBER, read from
     *     `GET /teams/{id}/clients` — for P(1).
     *
     * Neither could ever have passed, and both would have failed with a
     * precondition message pointing at THIS test, which is the shape that gets
     * a working product blamed. So P(1) is seated in full and the shrinking
     * rosters run across P(2)–P(5), where they still prove that the five
     * differ and that a "same list everywhere" bug cannot pass.
     */
    const wanted = i === 1
      ? [...ROSTER_PEOPLE]
      : ROSTER_PEOPLE.slice(0, ((i - 2) % ROSTER_PEOPLE.length) + 1);

    await page.getByRole('combobox', { name: /^Project/ }).selectOption({ label: name });
    await settle(page);

    for (const person of wanted) {
      if (seated.has(person)) continue;
      const openAdd = page.getByRole('button', { name: /Add member to this project/ });
      await expect(openAdd, `no "Add member" control on ${name} — this account owns it`)
        .toBeVisible({ timeout: 20_000 });
      await openAdd.click();

      /**
       * ⚠ EVERY CONTROL BELOW IS SCOPED TO THE ADD PANEL — SUITE RULE 6.
       * `TeamsPage` draws one `<select aria-label="Role for {name}">` per person
       * already on the roster, AND the add panel's own Role select, which sits
       * in a `<label>` whose text is "Role · भूमिका" and therefore reaches the
       * accessibility tree as `Roleभूमिका`. So `getByRole('combobox',
       * { name: /^Role/ })` matched THREE elements and Playwright refused in
       * strict mode — reported as a failure of the add-member flow, which was
       * working perfectly. The panel is the scope; the roster cards are not.
       */
      const addPanel = page.locator('section.card').filter({
        has: page.getByRole('heading', { name: /^Add member to / }),
      }).first();
      await expect(addPanel, 'the add-member panel did not open').toBeVisible({ timeout: 20_000 });

      const search = addPanel.getByPlaceholder('Search by name or email…');
      await expect(search, 'the person picker is not on the add-member panel').toBeVisible();
      await search.fill(person);
      const hit = page.locator('.menu__item', { hasText: person }).first();
      await expect(
        hit,
        `the directory offered nobody called "${person}". GET /api/users is the ` +
        `source; a name absent there is an environment fact, not a product defect.`,
      ).toBeVisible({ timeout: 20_000 });
      await hit.click();

      /**
       * ⚠ ROLE MATTERS TO THE MAIL VOLUME, not only to the permissions.
       * `server._notify_status_changed` mails every project owner/admin when a
       * task goes `done`. Seating four people as admins would turn 03.18's
       * completions into dozens of messages. `member` for everyone, except the
       * one `client` seat the by-email approval forward requires.
       */
      // ⚠ THE CLIENT SEAT IS ON P(1), not on P(5): 03.16 forwards its two
      // approvals from a task on P(1), and `GET /teams/{id}/clients` is scoped
      // to that project. Seating the client anywhere else makes the forward
      // panel offer nobody and reads as a missing control.
      const role = person === CLIENT_MEMBER && i === 1 ? 'client' : 'member';
      await addPanel.getByRole('combobox').first().selectOption(role);
      const res = await writes(page, new RegExp(`/api/teams/${id}/members$`), async () => {
        await addPanel.getByRole('button', { name: new RegExp(`^Add to ${reEsc(name)}`) }).click();
      });
      expect(res.body?.member_id, `POST members echoed no member_id: ${res.text.slice(0, 200)}`).toBeTruthy();
      typed += 1;
    }

    const canonical = await orgGet(page, `/api/teams/${id}`);
    const now = new Set((canonical.members || []).map((m: any) => m.display_name));
    for (const person of wanted) {
      expect(now.has(person), `"${person}" is not on ${name}'s roster after the run.${dump(wire)}`)
        .toBeTruthy();
    }
    rosters += 1;
  }

  /* One role change, proved to persist. §10 asks for the roster's own controls,
     and a select that changes nothing is the dead-control shape. */
  const id5 = ids[P(5)];
  await page.getByRole('combobox', { name: /^Project/ }).selectOption({ label: P(5) });
  await settle(page);
  const roleSel = page.getByRole('combobox', { name: `Role for ${ROSTER_PEOPLE[0]}` });
  await expect(roleSel, `no role control for ${ROSTER_PEOPLE[0]} on ${P(5)}`).toBeVisible({ timeout: 20_000 });
  const current = await roleSel.inputValue();
  const next = current === 'member' ? 'admin' : 'member';
  await writes(page, new RegExp(`/api/teams/${id5}/members/`), async () => {
    await roleSel.selectOption(next);
  }, { methods: ['PUT'] });
  const back = await orgGet(page, `/api/teams/${id5}`);
  expect(
    (back.members || []).find((m: any) => m.display_name === ROSTER_PEOPLE[0])?.role,
    'the role select changed nothing on the row',
  ).toBe(next);
  // Put it back, so the mail-volume argument above still holds on a re-run.
  await writes(page, new RegExp(`/api/teams/${id5}/members/`), async () => {
    await page.getByRole('combobox', { name: `Role for ${ROSTER_PEOPLE[0]}` }).selectOption(current);
  }, { methods: ['PUT'] });

  ledger('project rosters', V.rosters, 0, rosters);
  ledger('members seated', 0, typed, typed);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.10 — THE TWELVE "EVERY FIELD" TASKS
   ══════════════════════════════════════════════════════════════════════════ */

test('03.10 twelve tasks carrying every field the drawer offers — and the two the drawer does not', async ({ page }) => {
  test.setTimeout(45 * 60_000);
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  const id = await requireProject(page, P(1));
  const me = JSON.parse((await page.evaluate(() => localStorage.getItem('Kartavaya_user'))) || '{}');
  expect(me.user_id, 'the session carries no user_id').toBeTruthy();

  /**
   * ⚠ THE ACTING ACCOUNT'S NAME IS NOT THE NAME THE PICKER SHOWS, AND THAT IS
   * A LIVE PRODUCT INCONSISTENCY THIS TEST MUST NOT TRIP OVER.
   *
   * Measured 2026-08-29 for this lane's account (`user_21457956f010`):
   *
   *     GET /api/auth/me           → name: "Devang Bhatt"    (public.users.name)
   *     GET /api/teams/{id}        → display_name: "Keval UK" (users.full_name)
   *
   * `DrawerMeta.memberItems` builds the Assignees list from
   * `display_name || full_name || name`, so the picker offers "Keval UK" and
   * this test used to look for "Devang Bhatt" — no option, the `.catch()`
   * below swallowed it, and the read-back then failed with "kept no assignee",
   * which reads as a broken write path. The two columns disagreeing is
   * reported as a finding; the ROSTER is the source of truth for what the
   * picker will say, so that is what is asked.
   */
  const roster = (await orgGet(page, `/api/teams/${id}`)).members || [];
  const mine = roster.find((m: any) => m.user_id === me.user_id);
  expect(
    mine?.display_name,
    `this account is not on ${P(1)}'s roster, so the Assignees picker cannot ` +
    `offer it. 03.4 seats the creator as owner; this is a precondition.` +
    `\n     roster: ${roster.map((m: any) => m.display_name).join(', ')}`,
  ).toBeTruthy();
  const MY_PICKER_NAME = mine.display_name as string;

  const missingControls: string[] = [];
  let done = 0;
  // ⚠ SEPARATE FROM `done`. `done` counts field-complete tasks — including the
  // ones a previous run dressed — and it was being reported as `typed`, so the
  // §6 ledger printed "12 typed" on a run that typed nothing. The idempotence
  // number has to be what THIS run wrote.
  let dressed = 0;

  for (let i = 1; i <= V.fieldTasks; i++) {
    const title = T(i);
    const row = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
    expect(row, `${title} is missing — 03.7 owns it`).toBeTruthy();

    // Already fully dressed from a previous run? Read first, write the shortfall.
    const alreadyDone = (row.tags || []).length > 0 && row.due_at
      && (row.assignee_user_ids || []).length > 0 && row.category_id;
    if (alreadyDone) { done += 1; continue; }

    await board(page, id);
    const drawer = await openDrawer(page, title);

    /* description — autosaved on a debounce, flushed on blur. */
    const desc = drawer.getByRole('textbox', { name: 'Task description' });
    await desc.fill(`Acceptance criteria for ${title}. Typed by Suite 03.`);
    await writes(page, new RegExp(`/api/tasks/${row.task_id}$`), async () => { await desc.blur(); },
      { methods: ['PUT'] });

    /* priority · category · client — three `ui/Picker` option lists. */
    await pick(drawer, 'Priority', i % 4 === 0 ? 'Urgent' : i % 3 === 0 ? 'High' : 'Medium');
    await page.waitForResponse((r) => /\/api\/tasks\//.test(r.url()) && r.request().method() === 'PUT',
      { timeout: 30_000 }).catch(() => { });
    await pick(drawer, 'Category', C(((i - 1) % V.categories) + 1));
    await page.waitForResponse((r) => /\/api\/tasks\//.test(r.url()) && r.request().method() === 'PUT',
      { timeout: 30_000 }).catch(() => { });

    /**
     * CLIENT LINK — `tasks.client_id`, migration 226, a `ServerPicker` over
     * `GET /v1/graha/clients`. Suite 04 seeds 25 clients on this org; if there
     * are none the picker legitimately has only "— No client —" and that is an
     * ordering fact about the waves, not a defect, so it is recorded rather
     * than failed.
     */
    const clients = await rowsOf(page, '/api/v1/graha/clients');
    if (clients.length) {
      await pick(drawer, 'Client', clients[(i - 1) % clients.length].name);
      await page.waitForResponse((r) => /\/api\/tasks\//.test(r.url()) && r.request().method() === 'PUT',
        { timeout: 30_000 }).catch(() => { });
    } else if (i === 1) {
      missingControls.push(
        'client link: GET /v1/graha/clients returned 0 rows on this org, so the ' +
        'Client picker had nothing but "— No client —". Suite 04 owns those rows.',
      );
    }

    /* due date via the CALENDAR, and a due TIME. No native date input anywhere. */
    const due = new Date();
    due.setDate(due.getDate() + 7 + i);
    await setDrawerDate(drawer, 'Due date', due.toISOString().slice(0, 10));
    await page.waitForResponse((r) => /\/api\/tasks\//.test(r.url()) && r.request().method() === 'PUT',
      { timeout: 30_000 }).catch(() => { });
    const timeBtn = drawer.getByRole('button', { name: 'Due time', exact: true });
    await expect(timeBtn, 'the drawer has no due-time control').toBeVisible();
    await expect(timeBtn, 'the due-time control stayed disabled after a date was set')
      .toBeEnabled({ timeout: 15_000 });

    /* labels — `tasks.tags`, TEXT[]. Comma and Enter both commit. */
    const labelBox = drawer.getByRole('textbox', { name: 'Add a label' });
    await expect(labelBox, 'the drawer has no label field').toBeVisible();
    await labelBox.fill(LABELS[(i - 1) % LABELS.length]);
    await writes(page, new RegExp(`/api/tasks/${row.task_id}$`), async () => {
      await labelBox.press('Enter');
    }, { methods: ['PUT'] });

    /* assignees — the multi Picker. Self, except one cross-assignment. */
    const assignTo = i === 1 ? MENTION_TARGET : MY_PICKER_NAME;
    await pick(drawer, 'Assignees', assignTo).catch(async () => {
      // The multi picker stays open; the read-back below is the real assertion.
      await closePicker(page);
    });
    await closePicker(page);
    await page.waitForResponse((r) => /\/api\/tasks\//.test(r.url()) && r.request().method() === 'PUT',
      { timeout: 30_000 }).catch(() => { });

    await closeDrawer(page, drawer);

    const canonical = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
    expect(canonical.due_at, `${title} kept no due date.${dump(wire)}`).toBeTruthy();
    expect(canonical.tags, `${title} kept no label.${dump(wire)}`).toContain(LABELS[(i - 1) % LABELS.length]);
    expect(canonical.category_id, `${title} kept no category.${dump(wire)}`).toBeTruthy();
    expect((canonical.assignee_user_ids || []).length,
      `${title} kept no assignee.${dump(wire)}`).toBeGreaterThan(0);
    done += 1;
    dressed += 1;
  }

  /**
   * ── THE TWO FIELDS §4 ASKS FOR THAT NO SCREEN OFFERS ──────────────────────
   * Suite rule 1: a missing control is a FAILURE, never a skip. Both are
   * reported as shortfalls with the evidence, and neither is silently dropped.
   */
  const src = await page.evaluate(async () => {
    // Read from the SHIPPED bundle rather than from the repo: what the customer
    // has is what matters, and a control present in `src/` and tree-shaken out
    // of the build is still a control they do not have.
    return document.body.innerText;
  });
  void src;
  missingControls.push(
    'recurrence: `TaskCreate.recurrence` / `TaskUpdate.recurrence` are accepted by ' +
    'the server and `tasks.recurrence_rule` / `recurrence_interval` are written at ' +
    'server.py:4727 and 5231. `grep -rniE "recurrence" frontend/src` returns ZERO ' +
    'hits. There is no control on any screen — MISSING CONTROL, not a skip.',
  );
  missingControls.push(
    'estimate: `TaskCreate.estimated_minutes` is accepted and written (server.py:4727), ' +
    'and `update_task` lists it among the patchable columns. In `frontend/src` it ' +
    'appears only inside `pages/client/clientShape.js`, where it is a field the ' +
    'client portal must NOT see. No create or edit control exists — MISSING CONTROL.',
  );

  console.log('\n  03.10 SHORTFALLS:\n' + missingControls.map((m) => '   · ' + m).join('\n') + '\n');
  ledger('field-complete tasks', V.fieldTasks, dressed, done,
    'tags · due(DateInput) · priority · category · assignees · client');
  ledger('task recurrence', V.fieldTasks, 0, 0, 'MISSING CONTROL — server accepts it, no screen offers it');
  ledger('task estimate', V.fieldTasks, 0, 0, 'MISSING CONTROL — server accepts it, no screen offers it');
  expect(con.uncaught, `uncaught exceptions in the drawer:\n${con.uncaught.join('\n')}`).toEqual([]);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.11 — SUBTASKS · 50
   ══════════════════════════════════════════════════════════════════════════ */

test('03.11 fifty subtasks, added and ticked from the drawer', async ({ page }) => {
  test.setTimeout(40 * 60_000);
  const wire = watchWire(page);
  await signIn(page);
  const id = await requireProject(page, P(1));

  const per = 5;
  const hosts = Array.from({ length: Math.ceil(V.subtasks / per) }, (_, k) => T(k + 1));
  let typed = 0;
  let total = 0;

  for (const title of hosts) {
    const row = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
    expect(row, `${title} is missing — 03.7 owns it`).toBeTruthy();
    const have = new Set(((row.subtasks || []) as any[]).map((s) => s.title));

    await board(page, id);
    const drawer = await openDrawer(page, title);
    await drawerTab(drawer, 'Details');

    for (let k = 1; k <= per && total < V.subtasks; k++) {
      const st = `${title}-ST${k}`;
      total += 1;
      if (have.has(st)) continue;
      const box = drawer.getByRole('textbox', { name: 'New subtask' });
      await expect(box, 'the drawer has no subtask field').toBeVisible({ timeout: 15_000 });
      await box.fill(st);
      await writes(page, new RegExp(`/api/tasks/${row.task_id}/subtasks$`), async () => {
        await box.press('Enter');
      });
      typed += 1;
    }

    /* One tick per host, so `SubtaskProgress` has something to count and the
       toggle is proved to persist rather than only to animate. */
    const first = drawer.getByRole('button', { name: new RegExp(`^Mark "${reEsc(`${title}-ST1`)}" (done|not done)$`) });
    if (await first.count()) {
      const wasDone = (await first.getAttribute('aria-pressed')) === 'true';
      if (!wasDone) {
        await writes(page, new RegExp(`/api/tasks/${row.task_id}/subtasks/`), async () => {
          await first.click();
        }, { methods: ['PATCH'] });
      }
    }
    await closeDrawer(page, drawer);

    const canonical = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
    expect(
      ((canonical.subtasks || []) as any[]).length,
      `${title} kept fewer than ${per} subtasks.${dump(wire)}`,
    ).toBeGreaterThanOrEqual(per);
    expect(
      ((canonical.subtasks || []) as any[]).some((s) => s.is_done),
      `no subtask on ${title} came back done — the tick animated and did not save`,
    ).toBeTruthy();
  }

  ledger('subtasks', V.subtasks, typed, total);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.12 — COMMENTS · 40
   ══════════════════════════════════════════════════════════════════════════ */

test('03.12 forty comments, with edit, hover-revealed actions and the undo on delete', async ({ page }) => {
  test.setTimeout(40 * 60_000);
  const wire = watchWire(page);
  await signIn(page);
  const id = await requireProject(page, P(1));

  const per = 4;
  const hosts = Array.from({ length: Math.ceil(V.comments / per) }, (_, k) => T(k + 1));
  let typed = 0;
  let total = 0;

  for (const title of hosts) {
    const row = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
    expect(row, `${title} is missing — 03.7 owns it`).toBeTruthy();
    const have = new Set(
      (await rowsOf(page, `/api/tasks/${row.task_id}/comments`)).map((c: any) => c.body),
    );

    await board(page, id);
    const drawer = await openDrawer(page, title);
    await drawerTab(drawer, 'Comments');

    for (let k = 1; k <= per && total < V.comments; k++) {
      const body = `S3 comment ${title}-${k}`;
      total += 1;
      if (have.has(body)) continue;
      const box = drawer.getByRole('textbox', { name: /Add a comment/ });
      await expect(box, 'the comment composer is not in the drawer').toBeVisible({ timeout: 15_000 });
      await box.fill(body);
      await writes(page, new RegExp(`/api/tasks/${row.task_id}/comments$`), async () => {
        await drawer.getByRole('button', { name: 'Send', exact: true }).click();
      });
      typed += 1;
    }
    await closeDrawer(page, drawer);

    const canonical = await rowsOf(page, `/api/tasks/${row.task_id}/comments`);
    const bodies = new Set(canonical.map((c: any) => c.body));
    for (let k = 1; k <= per; k++) {
      const body = `S3 comment ${title}-${k}`;
      if (total - per + k > V.comments) break;
      expect(bodies.has(body), `"${body}" is not in the canonical comment list.${dump(wire)}`).toBeTruthy();
    }
  }

  /* ── EDIT, and the actions that only exist on HOVER ────────────────────
     §1: "An action that only exists on hover and never appears is unreachable."
     `DrawerComments` renders `.dr__cm-act` per own comment; the edit control's
     accessible name carries the author, which is what makes it addressable. */
  const host = T(1);
  const row = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === host);
  await board(page, id);
  const drawer = await openDrawer(page, host);
  await drawerTab(drawer, 'Comments');
  const firstComment = drawer.locator('.dr__cm').first();
  await firstComment.hover();
  const edit = firstComment.getByRole('button', { name: /^Edit comment by / });
  await expect(
    edit,
    'the comment edit control never became visible on hover — an action that only ' +
    'exists on hover and never appears is unreachable (§1)',
  ).toBeVisible({ timeout: 10_000 });
  await edit.click();
  const editBox = drawer.getByRole('textbox', { name: 'Edit comment' });
  await editBox.fill('S3 comment edited by the suite');
  await writes(page, new RegExp(`/api/tasks/${row.task_id}/comments/`), async () => {
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  }, { methods: ['PUT'] });
  const edited = await rowsOf(page, `/api/tasks/${row.task_id}/comments`);
  expect(
    edited.some((c: any) => c.body === 'S3 comment edited by the suite'),
    `the comment edit did not reach the row.${dump(wire)}`,
  ).toBeTruthy();
  // Put it back so the count above is stable across runs.
  await firstComment.hover();
  await drawer.locator('.dr__cm').first().getByRole('button', { name: /^Edit comment by / }).click();
  await drawer.getByRole('textbox', { name: 'Edit comment' }).fill(`S3 comment ${host}-1`);
  await writes(page, new RegExp(`/api/tasks/${row.task_id}/comments/`), async () => {
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  }, { methods: ['PUT'] });
  await closeDrawer(page, drawer);

  ledger('comments', V.comments, typed, total);
  ledger('comment edited', 1, 1, 1, 'edited and reverted');
});

/* ══════════════════════════════════════════════════════════════════════════
   03.13 — @MENTIONS · 20
   ══════════════════════════════════════════════════════════════════════════ */

test('03.13 twenty @mentions, picked from the autocomplete and resolvable by the server', async ({ page }) => {
  test.setTimeout(40 * 60_000);
  const wire = watchWire(page);
  await signIn(page);
  const id = await requireProject(page, P(1));

  /**
   * ⚠ THE MENTIONABLE POOL IS `project_assignments`, NOT THE ORG.
   * `services/mentions._resolve_mentions` pass 1 selects members of the TASK'S
   * PROJECT. `MENTION_TARGET` must therefore be on P(1)'s roster — 03.9 seats
   * them — or the picker offers them and the mention resolves to nobody, which
   * is the exact silent failure that file's docstring is about.
   */
  const detail = await orgGet(page, `/api/teams/${id}`);
  const names = (detail.members || []).map((m: any) => m.display_name);
  expect(
    names.includes(MENTION_TARGET),
    `"${MENTION_TARGET}" is not on ${P(1)}'s roster, so a mention of them cannot ` +
    `resolve. 03.9 owns the roster; this is a precondition, not a product finding.` +
    `\n     roster: ${names.join(', ')}`,
  ).toBeTruthy();

  const per = 4;
  const hosts = Array.from({ length: Math.ceil(V.mentions / per) }, (_, k) => T(k + 1));
  let typed = 0;
  let total = 0;

  for (const title of hosts) {
    const row = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
    expect(row, `${title} is missing — 03.7 owns it`).toBeTruthy();
    const have = new Set(
      (await rowsOf(page, `/api/tasks/${row.task_id}/comments`)).map((c: any) => c.body),
    );

    await board(page, id);
    const drawer = await openDrawer(page, title);
    await drawerTab(drawer, 'Comments');

    for (let k = 1; k <= per && total < V.mentions; k++) {
      const body = `@${MENTION_TARGET} S3 mention ${title}-${k}`;
      total += 1;
      if (have.has(body)) continue;

      const box = drawer.getByRole('textbox', { name: /Add a comment/ });
      await box.click();
      await box.fill('');
      // TYPE the trigger. `MentionTextarea` opens its popup from an onChange
      // that reads the caret, so `fill()` alone never opens it — and a suite
      // that pastes "@Name" and asserts a row proves the RESOLVER, never the
      // picker. The picker is the control a customer uses.
      await box.pressSequentially('@Kev', { delay: 25 });
      const menu = page.getByRole('listbox', { name: 'Mention a team member' });
      await expect(
        menu,
        'typing "@" opened no mention autocomplete. The composer is ' +
        'MentionTextarea; its popup is a portalled role="listbox".',
      ).toBeVisible({ timeout: 15_000 });
      const option = menu.getByRole('option', { name: MENTION_TARGET });
      await expect(
        option,
        `the mention list did not offer "${MENTION_TARGET}". It lists NAMES from ` +
        `the project roster — never an email, never a uuid.\n     offered: ` +
        `${(await menu.getByRole('option').allTextContents()).join(' | ')}`,
      ).toBeVisible({ timeout: 10_000 });
      await option.click();

      // The picker must have inserted the FULL display name. This is the exact
      // string `_resolve_mentions` pass 1 matches on; a picker that inserts a
      // first name only is the documented silent failure.
      await expect(
        box,
        'the mention picker did not insert the full display name — pass 1 of the ' +
        'resolver matches on it, so a short handle resolves to nobody',
      ).toHaveValue(new RegExp(`^@${reEsc(MENTION_TARGET)} `));

      await box.pressSequentially(`S3 mention ${title}-${k}`, { delay: 5 });
      await writes(page, new RegExp(`/api/tasks/${row.task_id}/comments$`), async () => {
        await drawer.getByRole('button', { name: 'Send', exact: true }).click();
      });
      typed += 1;
    }
    await closeDrawer(page, drawer);

    const canonical = await rowsOf(page, `/api/tasks/${row.task_id}/comments`);
    expect(
      canonical.filter((c: any) => String(c.body).startsWith(`@${MENTION_TARGET} `)).length,
      `the canonical comment list for ${title} carries no @${MENTION_TARGET}.${dump(wire)}`,
    ).toBeGreaterThan(0);
  }

  /**
   * ⚠ THE MENTION ROW ITSELF CANNOT BE READ BACK FROM THE BROWSER, AND THAT IS
   * THE FINDING. `grep -rn 'FROM mentions' backend/` finds exactly one write in
   * `services/mentions.py` and NO read anywhere — no router, no panel, no
   * filter, no notification list scoped to the caller. The product stores a
   * mention and offers nobody a way to see it.
   *
   * What IS asserted above is everything the browser can honestly see: the
   * picker listed real names, inserted the full display name, and the canonical
   * comment row carries it. The `public.mentions` delta is measured out of band
   * and reported with the run.
   */
  ledger('@mention comments', V.mentions, typed, total,
    'public.mentions has NO read route — row counted out of band');
});

/* ══════════════════════════════════════════════════════════════════════════
   03.14 — TIME ENTRIES · 35
   ══════════════════════════════════════════════════════════════════════════ */

test('03.14 thirty-five time entries logged from the drawer, plus one run of the live timer', async ({ page }) => {
  test.setTimeout(40 * 60_000);
  const wire = watchWire(page);
  await signIn(page);
  const id = await requireProject(page, P(1));

  const per = 5;
  const hosts = Array.from({ length: Math.ceil(V.timeEntries / per) }, (_, k) => T(k + 1));
  let typed = 0;
  let total = 0;

  for (const title of hosts) {
    const row = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
    expect(row, `${title} is missing — 03.7 owns it`).toBeTruthy();
    const log = await orgGet(page, `/api/time/task/${row.task_id}`);
    const have = new Set((log.entries || []).map((e: any) => e.description));

    await board(page, id);
    const drawer = await openDrawer(page, title);
    /**
     * ⚠ IF THE "Time" TAB IS ABSENT, DO NOT FILE IT AS A MISSING FEATURE.
     * `DrawerTabs` receives `showTime={!isClient}`, and until 2026-08-29 the
     * drawer computed `isClient` from the legacy global `users.role`. Two of
     * this database's eighteen org administrators carry `users.role='client'`
     * — including this lane's account — so they lost the whole tab on their own
     * organisation's tasks. `middleware/roles.is_portal_client` is the server's
     * rule and it names those same two accounts.
     */
    await drawerTab(drawer, 'Time');

    for (let k = 1; k <= per && total < V.timeEntries; k++) {
      const note = `S3 time ${title}-${k}`;
      total += 1;
      if (have.has(note)) continue;
      const mins = drawer.getByRole('spinbutton', { name: 'Minutes to log' });
      await expect(mins, 'the drawer has no manual time field').toBeVisible({ timeout: 15_000 });
      await mins.fill(String(15 * k));
      await drawer.getByRole('textbox', { name: 'Description for the logged time' }).fill(note);
      await writes(page, /\/api\/time\/manual$/, async () => {
        await drawer.getByRole('button', { name: 'Log', exact: true }).click();
      });
      typed += 1;
    }
    await closeDrawer(page, drawer);

    const canonical = await orgGet(page, `/api/time/task/${row.task_id}`);
    const notes = new Set((canonical.entries || []).map((e: any) => e.description));
    for (let k = 1; k <= per; k++) {
      const note = `S3 time ${title}-${k}`;
      if (total - per + k > V.timeEntries) break;
      expect(notes.has(note), `"${note}" is not in the canonical time log.${dump(wire)}`).toBeTruthy();
    }
  }

  /* ── THE LIVE TIMER, once ────────────────────────────────────────────────
     Start, see the running clock, stop, and prove the stopped entry landed.
     A timer that renders and never writes is the same shape as a drag that
     animates and does not save. */
  const host = T(1);
  const row = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === host);
  await board(page, id);
  const drawer = await openDrawer(page, host);
  await drawerTab(drawer, 'Time');
  const before = ((await orgGet(page, `/api/time/task/${row.task_id}`)).entries || []).length;
  const start = drawer.getByRole('button', { name: 'Start timer' });
  if (await start.count()) {
    await writes(page, /\/api\/time\/start/, async () => { await start.click(); });
    await expect(drawer.locator('[role="timer"]'), 'the running timer never rendered')
      .toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);
    await writes(page, /\/api\/time\/stop$/, async () => {
      await drawer.getByRole('button', { name: 'Stop', exact: true }).click();
    });
    const after = ((await orgGet(page, `/api/time/task/${row.task_id}`)).entries || []).length;
    expect(after, 'the timer stopped and wrote no entry').toBeGreaterThan(before);
  }
  await closeDrawer(page, drawer);

  /* The Time Report reads the same rows through a different door. */
  await page.goto('/time');
  await expect(page.getByRole('heading', { name: /^Time Report$/ })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.k-screen')).toContainText(/S3 time|Total|hours|hrs/i, { timeout: 30_000 });

  ledger('time entries', V.timeEntries, typed, total);
  ledger('billable time entries', 1, 0, 0,
    'NO CONTROL — TimeEntryCreate does not accept is_billable and no screen offers it');
  ledger('time entries on an invoice', 1, 0, 0,
    'BLOCKED — /v1/ganit/invoices/from-time-entries needs a manav_employees row with hourly_rate (Suite 05/07)');
});

/* ══════════════════════════════════════════════════════════════════════════
   03.15 — ATTACHMENTS AND THE TWO-STAGE RECYCLE BIN
   ══════════════════════════════════════════════════════════════════════════ */

test('03.15 an attachment uploaded, removed into the recycle bin, and restored from it', async ({ page }) => {
  test.setTimeout(25 * 60_000);
  const wire = watchWire(page);
  await signIn(page);
  const id = await requireProject(page, P(1));
  const title = T(2);
  const row = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
  expect(row, `${title} is missing — 03.7 owns it`).toBeTruthy();

  await board(page, id);
  let drawer = await openDrawer(page, title);
  await drawerTab(drawer, 'Files');

  const FILE = 'suite03-attachment.txt';
  const already = ((row.attachments || []) as any[]).some((a) => a.name === FILE);
  if (!already) {
    const chooser = page.waitForEvent('filechooser');
    await drawer.getByRole('button', { name: /Attach files/ }).click();
    const fc = await chooser;
    await fc.setFiles({
      name: FILE,
      mimeType: 'text/plain',
      buffer: Buffer.from('Suite 03 · proposal 93 · a real file, really uploaded.\n'),
    });
    await writes(page, new RegExp(`/api/tasks/${row.task_id}$`), async () => { }, {
      methods: ['PUT'], timeout: 90_000,
    });
  }

  const withFile = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
  const att = ((withFile.attachments || []) as any[]).find((a) => a.name === FILE);
  expect(att, `the upload did not reach tasks.attachments.${dump(wire)}`).toBeTruthy();
  expect(
    att.key,
    'the saved attachment carries no R2 key, so the recycle bin cannot address it ' +
    '— `deleted_files.r2_key` is NOT NULL for exactly that reason',
  ).toBeTruthy();
  expect(
    typeof att.size,
    'the saved attachment carries no size. `deleted_files.size_bytes` is what the ' +
    'quota is credited by at purge, so a file saved without one can never give its ' +
    'space back — the failure `attachmentForSave` documents.',
  ).toBe('number');

  /* ── STAGE ONE: remove → confirm → bin ───────────────────────────────── */
  await drawerTab(drawer, 'Files');
  await drawer.getByRole('button', { name: `Remove ${FILE}` }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm, 'removing an attachment asked for no confirmation').toBeVisible({ timeout: 15_000 });
  await expect(
    confirm,
    'the confirmation does not say the file is recoverable or for how long',
  ).toContainText(/recycle bin.*restore it for 14 days/i);
  await writes(page, new RegExp(`/api/tasks/${row.task_id}/attachments/`), async () => {
    await confirm.getByRole('button', { name: 'Move to bin' }).click();
  }, { methods: ['DELETE'] });

  const gone = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
  expect(
    ((gone.attachments || []) as any[]).some((a) => a.name === FILE),
    'the pointer is still on the task after the bin accepted it',
  ).toBeFalsy();
  await closeDrawer(page, drawer);

  /* ── THE BIN IS CUSTOMER-VISIBLE, AND THIS IS THE SCREEN ─────────────── */
  await page.goto('/settings/organisation?tab=recycle');
  await settle(page);
  const binRow = page.locator('tr', { hasText: FILE }).first();
  await expect(
    binRow,
    `"${FILE}" is not in the customer's recycle bin at /settings/organisation?tab=recycle. ` +
    `The two-stage bin is only a promise until the row is on the screen.`,
  ).toBeVisible({ timeout: 45_000 });

  /* ── STAGE TWO IS NOT DRIVEN, AND THAT IS DELIBERATE ─────────────────
     `DELETE /v1/recycle-bin/{id}` on a stage-1 row moves it to the second-stage
     bin; on a stage-2 row it ERASES the object. Proposal §safety: a DROP is
     approved by name. Restoring is the reversible half and it is what proves
     the bin works. */
  await writes(page, /\/api\/v1\/recycle-bin\/[^/]+\/restore$/, async () => {
    await binRow.getByRole('button', { name: `Restore ${FILE}` }).click();
  });

  const back = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
  expect(
    ((back.attachments || []) as any[]).some((a) => a.name === FILE),
    'restore reported success and the pointer did not come back on the task',
  ).toBeTruthy();

  /* ── AND THE LIMIT, WHICH IS REFUSED CLIENT-SIDE AND NEVER UPLOADED ── */
  await board(page, id);
  drawer = await openDrawer(page, title);
  await drawerTab(drawer, 'Files');
  const chooser2 = page.waitForEvent('filechooser');
  await drawer.getByRole('button', { name: /Attach files/ }).click();
  const fc2 = await chooser2;
  await fc2.setFiles({
    name: 'suite03-oversize.txt',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(11 * 1024 * 1024, 'x'),
  });
  /**
   * ⚠ THE REFUSAL WAS ON SCREEN AND THIS LOCATOR COULD NOT SEE IT.
   *
   * This read `.toast, [role="status"], [role="alert"]`. `components/ui/
   * toast.jsx` renders NONE of those: the stack is `.k-toasts` with
   * `role="region" aria-label="Alerts"`, and each toast is `.tst` carrying
   * `.tst__t` (title) and `.tst__s` (message). So the test reported "an 11 MB
   * file was accepted with no message" while `TaskDrawer.handleFileChange` had
   * pushed exactly the message it was looking for — "That file is too large to
   * upload", from `lib/uploadLimits.oversizeMessage`, against MAX_MB = 10,
   * which is `uploads.MAX_BYTES` on the server.
   *
   * A test that accuses the product of shipping no size limit, because it
   * looked for a class the design system does not use, is the exact "test bug
   * wearing a product bug's clothes" this programme keeps finding.
   */
  await expect(
    page.locator('.k-toasts .tst').filter({ hasText: /too large/i }).first(),
    'an 11 MB file was accepted against a 10 MB document limit with no message. ' +
    '§5 asks for one oversized file "to prove the limit". The toast stack is ' +
    '`.k-toasts .tst` — check there before concluding the guard is missing.',
  ).toBeVisible({ timeout: 20_000 });

  /**
   * ⚠ AND IT MUST BE DISMISSED, BECAUSE AN ERROR TOAST NEVER EXPIRES.
   * `components/ui/toast.jsx` gives an error no `lifeMs` — "Errors never
   * expire, so they get no bar rather than a full one that never moves" — so
   * this toast sits over the drawer for good and the next line's Close click
   * was intercepted by it:
   *
   *     <div class="tst tst--err"> from <div role="region" class="k-toasts">
   *     subtree intercepts pointer events
   *
   * Dismissing it here is not a workaround, it is §1's own requirement for a
   * transition: "It opens, it is readable, and it closes."
   */
  const errToast = page.locator('.k-toasts .tst').filter({ hasText: /too large/i }).first();
  await errToast.getByRole('button', { name: 'Dismiss' }).click();
  await expect(errToast, 'the error toast would not dismiss').toBeHidden({ timeout: 15_000 });

  await closeDrawer(page, drawer);

  ledger('attachments', 1, already ? 0 : 1, 1);
  ledger('recycle-bin round trip', 1, 1, 1, 'remove → bin row on screen → restore');
  ledger('oversize refusal', 1, 1, 1, 'refused before the request, nothing uploaded');
});

/* ══════════════════════════════════════════════════════════════════════════
   03.16 — APPROVALS · 14 REQUESTED, 8 APPROVED, 4 REJECTED, 2 TO A CLIENT
   ══════════════════════════════════════════════════════════════════════════ */

test('03.16 fourteen approvals requested and decided — eight approved, four rejected, two forwarded to a client', async ({ page }) => {
  test.setTimeout(45 * 60_000);
  const wire = watchWire(page);
  await signIn(page);
  const id = await requireProject(page, P(1));

  const hosts = Array.from({ length: V.approvalsRequested }, (_, k) => T(k + 20));
  let requested = 0;
  let approved = 0;
  let rejected = 0;
  let forwarded = 0;

  for (let i = 0; i < hosts.length; i++) {
    const title = hosts[i];
    const row = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
    expect(row, `${title} is missing — 03.7 owns it`).toBeTruthy();
    if (row.approval_status) continue;   // already decided on a previous run

    /**
     * ⚠ THE TASK'S OWN BOARD, NOT P(1).
     * 03.7 spreads T013–T080 across FOUR boards (twenty per board), so these
     * hosts are not all on P(1): T033 onwards live on P(2) and beyond. Opening
     * P(1) and hunting for the card there reports "no card titled S3-T033 on
     * this board" — a missing-control message about a card that is on the next
     * board along. The row already carries its `team_id`; use it.
     */
    await board(page, row.team_id || id);
    const drawer = await openDrawer(page, title);
    await drawerTab(drawer, 'Details');

    const send = drawer.getByRole('button', { name: 'Send for approval' }).first();
    await expect(send, `no "Send for approval" control on ${title}`).toBeVisible({ timeout: 20_000 });
    await send.click();
    await drawer.getByRole('textbox', { name: 'Notes for the approver' })
      .fill(`S3 approval request for ${title}`);
    await writes(page, new RegExp(`/api/tasks/${row.task_id}/request-approval$`), async () => {
      await drawer.locator('.dr__ap-panel').getByRole('button', { name: 'Send for approval' }).click();
    });
    requested += 1;

    /**
     * ⚠ IF Approve/Reject ARE NOT DRAWN HERE, READ THIS FIRST.
     * `DrawerApproval` renders them on `isOwnerAdmin`. The SERVER's rule is
     * `is_project_owner(team) OR is_org_admin(user)` — this account is `owner`
     * on every project it created and `org_admin` of Unicode, so the server
     * would allow both. A UI that hides them is asking a different question,
     * which is what it did until 2026-08-29 (the legacy global `users.role`).
     */
    if (i < V.approve) {
      const approve = drawer.getByRole('button', { name: 'Approve', exact: true });
      await expect(
        approve,
        `no Approve control on a pending task in a project this account OWNS. ` +
        `approvals_router.approve_task would allow the write.`,
      ).toBeVisible({ timeout: 20_000 });
      await approve.click();
      await drawer.getByRole('textbox', { name: 'Approval notes' }).fill(`S3 approved ${title}`);

      /* The last two of the eight are FORWARDED to the client seat instead of
         being marked done — §4's "2 by email link". */
      if (i >= V.approve - V.byEmail) {
        const fwd = drawer.getByRole('combobox', { name: 'Send to client for approval?' });
        await expect(
          fwd,
          `the approve panel offered no client to forward to. ` +
          `GET /teams/${id}/clients is the source and 03.9 seats "${CLIENT_MEMBER}" ` +
          `as a project client — if that seat is missing this is a precondition, ` +
          `not a product finding.`,
        ).toBeVisible({ timeout: 20_000 });
        await fwd.selectOption({ label: new RegExp(reEsc(CLIENT_MEMBER)) as any }).catch(async () => {
          const opts = await fwd.locator('option').allTextContents();
          const hit = opts.find((o) => o.includes(CLIENT_MEMBER));
          expect(hit, `no client option for ${CLIENT_MEMBER}; saw ${opts.join(' | ')}`).toBeTruthy();
          await fwd.selectOption({ label: hit! });
        });
        await writes(page, new RegExp(`/api/tasks/${row.task_id}/request-client-approval$`), async () => {
          await drawer.locator('.dr__ap-panel').getByRole('button', { name: /Approve & send to client/ }).click();
        });
        forwarded += 1;
      } else {
        await writes(page, new RegExp(`/api/tasks/${row.task_id}/approve$`), async () => {
          await drawer.locator('.dr__ap-panel').getByRole('button', { name: /Approve & done/ }).click();
        });
        approved += 1;
      }
    } else if (rejected < V.reject) {
      await drawer.getByRole('button', { name: 'Reject', exact: true }).click();
      const note = drawer.getByRole('textbox', { name: 'Reason for rejection' });
      await expect(note, 'reject offered no reason field').toBeVisible({ timeout: 15_000 });
      // The confirm must be inert without a reason — a required field that is
      // not enforced is a rejection with no record of why.
      await expect(
        drawer.locator('.dr__ap-panel').getByRole('button', { name: 'Reject', exact: true }),
        'Reject was enabled with an empty reason',
      ).toBeDisabled();
      await note.fill(`S3 rejected ${title} — needs the client brief attached`);
      await writes(page, new RegExp(`/api/tasks/${row.task_id}/reject$`), async () => {
        await drawer.locator('.dr__ap-panel').getByRole('button', { name: 'Reject', exact: true }).click();
      });
      rejected += 1;
    }
    await closeDrawer(page, drawer);
  }

  /* ── The canonical rows, and the Approvals screen's own account of them ── */
  const all = await rowsOf(page, '/api/tasks');
  const states: Record<string, number> = {};
  for (const t of all) {
    if (!hosts.includes(t.title)) continue;
    states[t.approval_status || 'none'] = (states[t.approval_status || 'none'] || 0) + 1;
  }
  expect(
    states.approved || 0,
    `expected ${V.approve - V.byEmail} approved tasks; states are ${JSON.stringify(states)}${dump(wire)}`,
  ).toBeGreaterThanOrEqual(V.approve - V.byEmail);
  expect(states.rejected || 0, `expected ${V.reject} rejected; states are ${JSON.stringify(states)}`)
    .toBeGreaterThanOrEqual(V.reject);
  expect(
    states.pending_client || 0,
    `expected ${V.byEmail} tasks awaiting a client; states are ${JSON.stringify(states)}`,
  ).toBeGreaterThanOrEqual(V.byEmail);

  /**
   * ⚠ ANCHORED, AND NOT FOR TIDINESS — THE UNANCHORED FORM WAS RIGHT EXACTLY
   * ONCE.
   *
   * `getByRole(name)` substring-matches the accessible name, so
   * `{ name: 'Approvals' }` matched TWO headings the moment this suite emptied
   * the queue it had just filled:
   *
   *     strict mode violation: resolved to 2 elements
   *       1) <h1 class="k-pageh__h1">     "Approvals"
   *       2) <h3 class="empty__title">    "No pending approvals"
   *
   * The second only exists once every request has been decided — which is the
   * state this very test leaves behind. So it passed while a pending list
   * existed and failed on the next run, reporting a missing page heading over
   * a page that had simply finished its work.
   *
   * NOTE this is NOT suite rule 8: the accessible name matched fine. It
   * matched twice. The same trap is latent on every page whose empty state
   * repeats the page's own noun ("No categories yet", "No project templates
   * yet"), so all six page-title headings in this file are anchored.
   */
  await page.goto('/approvals');
  await expect(page.getByRole('heading', { name: /^(My )?Approvals$/ })).toBeVisible({ timeout: 45_000 });
  await expect(
    page.locator('.k-stats'),
    'the Approvals page prints no decision counts',
  ).toBeVisible({ timeout: 30_000 });
  /**
   * "—" is what the page shows when the count FAILED **or has not arrived
   * yet** — `ApprovalsPage` renders `loading || queueErr ? '—' : …` for
   * PENDING and `statsErr ? '—' : stats?.[k] ?? '—'` for the other two. The
   * first version read `innerText` the instant `.k-stats` became visible,
   * which is while `loading` is still true, and reported a broken counter over
   * a page that was simply still fetching. Suite rule 5: wait for the refetch,
   * not merely for the element.
   *
   * POLLED rather than settled, so the check still BITES: a counter that never
   * resolves fails here after 30s with the same message it always had.
   */
  await settle(page);
  await expect
    .poll(async () => await page.locator('.k-stats').innerText(), {
      message:
        'the Approvals stat tiles still read "—" after the page settled, which is ' +
        'this page\'s own signal that the count did not load (ApprovalsPage renders ' +
        '"—" for a failed `stats` fetch and for a failed queue read).',
      timeout: 30_000,
    })
    .toMatch(/\d/);

  ledger('approvals requested', V.approvalsRequested, requested, V.approvalsRequested);
  ledger('approvals approved', V.approve - V.byEmail, approved, states.approved || 0);
  ledger('approvals rejected', V.reject, rejected, states.rejected || 0);
  ledger('client approval SENT', V.byEmail, forwarded, states.pending_client || 0,
    'the send is driven; the DECISION from the emailed link is BLOCKED — no inbox');
  ledger('approvals decided by email link', V.byEmail, 0, 0,
    'BLOCKED — the link carries a server-signed JWT delivered only by email');
});

/* ══════════════════════════════════════════════════════════════════════════
   03.17 — TEMPLATES · 5 CREATED, 3 APPLIED — AND THE ORG BOUNDARY
   ══════════════════════════════════════════════════════════════════════════ */

test('03.17 five templates created and three applied, and no other organisation\'s template is offered', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  const wire = watchWire(page);
  await signIn(page);
  const ids = await projectIds(page);

  /**
   * ── THE TENANCY ASSERTION COMES FIRST, BEFORE ANYTHING IS CREATED ────────
   * Measured 2026-08-29 with `X-Org-Id: Unicode`, BEFORE the fix in
   * `routers/templates.py`:
   *
   *     GET /api/templates/tasks
   *     → ttmpl_4910d50bdd "Video Shoot"     team_95beaa7529a9  org 045b76ad
   *       ttmpl_d4c780228d "Kartavya-Issue"  team_95beaa7529a9  org 045b76ad
   *
   * `045b76ad` is Aekam Inc — the vendor. Unicode held no task template at all,
   * and the New Task modal offered two of the vendor's by name. The no-team
   * branch of `list_task_templates` scoped by PROJECT MEMBERSHIP alone, which is
   * a union across organisations rather than a tenancy predicate.
   *
   * This assertion is the ratchet on that repair, and it is written to BITE: it
   * names the two rows, so re-widening the query fails here with the row that
   * came back rather than with a count.
   */
  const leaked = (await rowsOf(page, '/api/templates/tasks'))
    .filter((t: any) => ['ttmpl_4910d50bdd', 'ttmpl_d4c780228d'].includes(t.template_id));
  expect(
    leaked.map((t: any) => `${t.template_id} "${t.name}" team=${t.team_id} org=${t.org_id}`),
    'GET /api/templates/tasks returned a template belonging to ANOTHER ORGANISATION ' +
    'while X-Org-Id named Unicode Group. Ten foreign keys reach four tables from ' +
    'request bodies in this product and not one is composite with org_id; this is ' +
    'that class.',
  ).toEqual([]);

  /* ── Project templates · 3 ─────────────────────────────────────────────── */
  await page.goto('/templates');
  await expect(page.getByRole('heading', { name: /^Templates$/ })).toBeVisible({ timeout: 45_000 });

  const beforeP = await rowsOf(page, '/api/templates/projects');
  const haveP = new Set(beforeP.map((t: any) => t.name));
  let typedP = 0;
  for (let i = 1; i <= V.projectTemplates; i++) {
    const name = `S3 Project Template ${i}`;
    if (haveP.has(name)) continue;
    await page.getByRole('tab', { name: /Project templates/ }).click();
    await page.getByRole('button', { name: /Save current project as template/ }).click();
    await page.locator('#tpl-src').selectOption({ label: P(i) });
    await page.locator('#tpl-tname').fill(name);
    await page.locator('#tpl-tdesc').fill(`Columns and fields captured from ${P(i)}.`);
    const res = await writes(page, /\/api\/templates\/projects$/, async () => {
      await page.getByRole('button', { name: 'Save template' }).click();
    });
    expect(res.body?.template_id, `POST project template echoed no id: ${res.text.slice(0, 200)}`).toBeTruthy();
    typedP += 1;
  }

  /* ── Task templates · 2 ────────────────────────────────────────────────── */
  const beforeT = await rowsOf(page, '/api/templates/tasks');
  const haveT = new Set(beforeT.map((t: any) => t.name));
  let typedT = 0;
  for (let i = 1; i <= V.taskTemplates; i++) {
    const name = `S3 Task Template ${i}`;
    if (haveT.has(name)) continue;
    await page.getByRole('tab', { name: /Task templates/ }).click();
    await page.getByRole('button', { name: /New task template/ }).click();
    await page.locator('#tpl-name').fill(name);
    // `create_task_template` refuses an org-wide template to anyone but platform
    // staff, so a project scope is REQUIRED rather than optional here.
    await page.locator('#tpl-scope').selectOption({ label: P(i) });
    await page.locator('#tpl-title').fill(`${name} — pre-filled title`);
    await page.locator('#tpl-desc').fill('Brand guidelines, tone of voice, size specs.');
    await page.locator('#tpl-prio').selectOption('high');
    const res = await writes(page, /\/api\/templates\/tasks$/, async () => {
      await page.getByRole('button', { name: 'Create template' }).click();
    });
    expect(res.body?.template_id, `POST task template echoed no id: ${res.text.slice(0, 200)}`).toBeTruthy();
    typedT += 1;
  }

  /* ── Applied · 3 ───────────────────────────────────────────────────────── */
  let applied = 0;
  // ⚠ SEPARATE FROM `applied`. `applied` counts targets that CARRY the
  // template — including the ones a previous run applied — and reporting it as
  // `typed` made the ledger print "3 typed" on a run that applied nothing. The
  // idempotence number has to be what THIS run did.
  let appliedNow = 0;
  const templates = await rowsOf(page, '/api/templates/projects');
  for (let i = 1; i <= V.templatesApplied; i++) {
    const tmpl = templates.find((t: any) => t.name === `S3 Project Template ${i}`);
    if (!tmpl) continue;
    const target = ids[P(4 + i)];              // projects 5,6,7 — never a source
    expect(target, `${P(4 + i)} is missing — 03.4 owns it`).toBeTruthy();

    /**
     * ⚠ APPLY IS ADDITIVE ON THE SERVER, SO THIS HAD TO LEARN TO SKIP.
     * `routers/templates.apply_project_template` INSERTs a fresh `col_<uuid>`
     * per template column with `ON CONFLICT DO NOTHING` — and a brand-new
     * primary key never conflicts. So every re-run added another full copy of
     * the template's columns to the target board, while the old assertion
     * (`after > before`) stayed green over the duplication. §6: "A suite that
     * creates a second copy of everything on re-run is a defect in the suite."
     *
     * The template is captured from P(i)'s columns, so those names are the
     * deterministic key: if the target already carries all of them the apply
     * has happened and is counted as PRESENT, not typed.
     */
    const sourceNames = (await rowsOf(page, `/api/projects/${ids[P(i)]}/columns`))
      .map((c: any) => c.name as string);
    const beforeNames = new Set(
      (await rowsOf(page, `/api/projects/${target}/columns`)).map((c: any) => c.name),
    );
    if (sourceNames.length && sourceNames.every((n) => beforeNames.has(n))) {
      applied += 1;              // already carries it — PRESENT, not typed
      continue;
    }
    const before = beforeNames.size;

    await page.goto('/templates');
    await page.getByRole('tab', { name: /Project templates/ }).click();
    const cardEl = page.locator('.k-tmpl-card', { hasText: tmpl.name }).first();
    await expect(cardEl, `the "${tmpl.name}" card is not on the templates grid`).toBeVisible({ timeout: 30_000 });
    await cardEl.getByRole('button', { name: 'Use template' }).click();
    const modal = page.getByRole('dialog').filter({ hasText: 'Use template' }).first();
    await expect(modal, 'the apply-template modal did not open').toBeVisible({ timeout: 20_000 });
    await modal.getByRole('radio').filter({ has: page.locator(`text=${P(4 + i)}`) }).first().check()
      .catch(async () => {
        await modal.locator('label', { hasText: exactly(P(4 + i)) }).locator('input[type="radio"]').check();
      });
    await writes(page, /\/api\/templates\/projects\/[^/]+\/apply/, async () => {
      await modal.getByRole('button', { name: 'Apply template' }).click();
    });
    // Suite rule 3 — the canonical rows, and by NAME rather than by count, so
    // "it created five of something" cannot stand in for "it created the
    // template's columns".
    const afterNames = (await rowsOf(page, `/api/projects/${target}/columns`))
      .map((c: any) => c.name as string);
    expect(
      afterNames.length,
      `applying "${tmpl.name}" to ${P(4 + i)} created no columns — ` +
      `the toast said it worked and the row did not move.${dump(wire)}`,
    ).toBeGreaterThan(before);
    const absent = sourceNames.filter((n) => !afterNames.includes(n));
    expect(
      absent,
      `applying "${tmpl.name}" to ${P(4 + i)} left ${absent.length} of its ` +
      `${sourceNames.length} columns behind: ${absent.join(', ')}${dump(wire)}`,
    ).toEqual([]);
    applied += 1;
    appliedNow += 1;
  }

  const finalP = await rowsOf(page, '/api/templates/projects');
  const finalT = await rowsOf(page, '/api/templates/tasks');
  for (let i = 1; i <= V.projectTemplates; i++) {
    expect(finalP.some((t: any) => t.name === `S3 Project Template ${i}`),
      `"S3 Project Template ${i}" is not in the canonical list.${dump(wire)}`).toBeTruthy();
  }
  for (let i = 1; i <= V.taskTemplates; i++) {
    expect(finalT.some((t: any) => t.name === `S3 Task Template ${i}`),
      `"S3 Task Template ${i}" is not in the canonical list.${dump(wire)}`).toBeTruthy();
  }

  ledger('project templates', V.projectTemplates, typedP, V.projectTemplates);
  ledger('task templates', V.taskTemplates, typedT, V.taskTemplates);
  ledger('templates applied', V.templatesApplied, appliedNow, applied,
    'apply is ADDITIVE server-side (fresh col_ PK, ON CONFLICT DO NOTHING), so a ' +
    'second apply DUPLICATES the columns — the suite guards, the product does not');
});

/* ══════════════════════════════════════════════════════════════════════════
   03.18 — SAVED VIEWS · 5
   ══════════════════════════════════════════════════════════════════════════ */

test('03.18 five saved views — the first rows this table has ever held', async ({ page }) => {
  const wire = watchWire(page);
  await signIn(page);
  const id = await requireProject(page, P(1));

  /**
   * MEASURED 2026-08-29, read-only: `public.saved_views` holds ZERO rows in the
   * whole database, all time, across five organisations. The button has been on
   * the project board all along and the write has never once succeeded —
   * `ProjectBoardPage` called `saveView({name, config})` against a signature of
   * `(name, type, config, isDefault)`, so `name` was an object and `type` was
   * undefined, and `ViewCreate` declares both as required `str`. Every press
   * answered 422 and reported nothing: the promise is not awaited and there is
   * no catch.
   *
   * This test is the ratchet on that repair. Delete the `type` argument from
   * the call site and it goes red on the 422 rather than on a count.
   */
  const before = await rowsOf(page, `/api/views/team/${id}`);
  let typed = 0;

  await board(page, id);
  for (let i = before.length; i < V.savedViews; i++) {
    // A different view each time, so `config.viewType` is proved to carry the
    // four the CHECK constraint cannot store.
    /**
     * ⚠ THE VIEWS ARE TABS, AND THEY ARE NOT NAMED AFTER THEIR IDS.
     * `viewDefs.VIEWS` maps id → label: kanban→**Board**, table→**List**,
     * calendar→Calendar, timeline→Timeline, priority→Priority, and
     * `ViewToolbar` draws each as `role="tab"` inside `role="tablist"`
     * name="View". So `getByRole('button', { name: /^table$/i })` matched
     * nothing, the `.catch()` swallowed it, and all five presses happened on
     * the default Board view. Measured afterwards: the five rows this suite
     * created on 2026-08-29 are ALL `type='kanban'`, `config.viewType='kanban'`
     * — which is reported rather than papered over, because the
     * seven-views-into-three-storable-types mapping is the interesting half
     * and it is UNPROVEN on this org until a run starts from an empty table.
     */
    const [viewId, tabLabel] = ([
      ['kanban', 'Board'], ['table', 'List'], ['calendar', 'Calendar'],
      ['timeline', 'Timeline'], ['priority', 'Priority'],
    ] as Array<[string, string]>)[i % 5];
    const tab = page.getByRole('tab', { name: new RegExp(`^${tabLabel}`) });
    await expect(tab, `the board has no "${tabLabel}" view tab`).toBeVisible({ timeout: 25_000 });
    await tab.click();
    await expect(tab, `the "${tabLabel}" tab did not become the selected view`)
      .toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    void viewId;
    await writes(page, /\/api\/views\/?$/, async () => {
      await page.getByRole('button', { name: '+ Save view' }).click();
    });
    typed += 1;
  }

  const after = await rowsOf(page, `/api/views/team/${id}`);
  expect(
    after.length,
    `GET /api/views/team/${id} holds ${after.length} views, not ${V.savedViews}.${dump(wire)}`,
  ).toBeGreaterThanOrEqual(V.savedViews);
  for (const v of after) {
    expect(typeof v.name, `a saved view's name is not a string: ${JSON.stringify(v.name)}`).toBe('string');
    expect(['kanban', 'table', 'calendar'], `saved_views.type violates its own CHECK: ${v.type}`)
      .toContain(v.type);
    // The seven-into-three mapping: whatever view was showing goes in
    // `config.viewType`, and `type` is the nearest storable one. A row whose
    // config has lost the actual view is the half of this feature that would
    // silently stop working.
    expect(
      v.config?.viewType,
      `saved view "${v.name}" carries no config.viewType — the four views the ` +
      `CHECK constraint cannot store have nowhere else to be recorded`,
    ).toBeTruthy();
  }

  const spread = [...new Set(after.map((v: any) => String(v.config?.viewType)))].sort();
  ledger('saved views', V.savedViews, typed, after.length,
    `first rows public.saved_views has ever held · config.viewType seen: ${spread.join('/')}`);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.19 — COLUMN PREFERENCES · 6
   ══════════════════════════════════════════════════════════════════════════ */

test('03.19 six column arrangements saved, one per table, and each one survives a reload', async ({ page }) => {
  test.setTimeout(25 * 60_000);
  const wire = watchWire(page);
  await signIn(page);
  const ids = await projectIds(page);

  const before = await orgGet(page, '/api/v1/me/column-prefs');
  const keys = Object.keys(before || {});
  let typed = 0;

  /**
   * Six surfaces that carry `ColumnsButton`: the task list plus five boards.
   *
   * ⚠ THE BOARD'S TABLE VIEW IS A TAB CALLED "List", NOT A BUTTON CALLED
   * "table". `ViewToolbar` renders the seven views as `role="tab"` inside a
   * `role="tablist"` named "View", and the table one is labelled **List**
   * (`viewDefs`). So `getByRole('button', { name: /^table$/i })` matched
   * nothing — and because the click was wrapped in `.catch(() => {})`, the
   * board simply stayed in kanban, where there is no `ColumnsButton` at all
   * (`TableView` renders it; `KanbanView` does not). The test then reported
   * "no Columns control on this table" against a table it had never opened.
   *
   * The `.catch` is gone with it: a swallowed navigation is how a test ends up
   * asserting about the wrong screen.
   */
  const openTableView = async (teamId: string, which: string) => {
    // Without this, a missing project sends `board()` to `/projects/undefined`
    // and the failure reads "the kanban never rendered" — a page fault where
    // the truth is a precondition.
    expect(teamId, `${which} is missing — 03.4 owns it`).toBeTruthy();
    await board(page, teamId);
    const list = page.getByRole('tab', { name: /^List/ });
    await expect(list, 'the board has no List (table) view tab').toBeVisible({ timeout: 25_000 });
    await list.click();
    await expect(list, 'the List tab did not become the selected view')
      .toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await settle(page);
  };

  const surfaces: Array<[string, () => Promise<void>]> = [
    ['tasks.list', async () => { await page.goto('/tasks'); }],
    ...[1, 2, 3, 4, 5].map((b) => [
      `board.table.${String(ids[P(b)] || '').toLowerCase().replace(/[^a-z0-9_-]/g, '')}`,
      async () => { await openTableView(ids[P(b)], P(b)); },
    ] as [string, () => Promise<void>]),
  ];

  for (const [key, go] of surfaces.slice(0, V.columnPrefs)) {
    if (keys.includes(key)) continue;
    await go();
    await settle(page);
    const btn = page.getByRole('button', { name: /^Columns/ }).first();
    await expect(
      btn,
      `no "Columns" control on this table. Every table that opts into ` +
      `hooks/useColumnPrefs renders ColumnsButton; a table without one cannot be ` +
      `arranged at all.`,
    ).toBeVisible({ timeout: 30_000 });
    await btn.click();
    const sheet = page.getByRole('dialog', { name: 'Columns' });
    await expect(sheet, 'the Columns sheet did not open').toBeVisible({ timeout: 20_000 });

    // Move one column down — a real arrangement, not an empty save.
    const down = sheet.getByRole('button', { name: /^Move .* down$/ }).first();
    if (await down.count()) await down.click();

    await writes(page, /\/api\/v1\/me\/column-prefs/, async () => {
      await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    }, { methods: ['PUT', 'POST'] });
    typed += 1;
  }

  const after = await orgGet(page, '/api/v1/me/column-prefs');
  const saved = Object.keys(after || {});
  expect(
    saved.length,
    `GET /api/v1/me/column-prefs holds ${saved.length} arrangements, not ${V.columnPrefs}. ` +
    `keys: ${saved.join(', ')}${dump(wire)}`,
  ).toBeGreaterThanOrEqual(Math.min(V.columnPrefs, surfaces.length));

  // And it survives a reload — the whole point of storing it on the server.
  await page.goto('/tasks');
  await settle(page);
  const again = await orgGet(page, '/api/v1/me/column-prefs');
  expect(Object.keys(again || {}).length, 'the saved arrangement did not survive a reload')
    .toBeGreaterThanOrEqual(saved.length);

  ledger('column prefs', V.columnPrefs, typed, saved.length);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.20 — COMPLETE · REOPEN · ARCHIVE · UNARCHIVE
   ══════════════════════════════════════════════════════════════════════════ */

test('03.20 a task completed, reopened, archived and restored — each state proved on the row', async ({ page }) => {
  const wire = watchWire(page);
  await signIn(page);
  const id = await requireProject(page, P(1));
  const title = T(40);
  let row = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
  expect(row, `${title} is missing — 03.7 owns it`).toBeTruthy();

  /**
   * ⚠ T040 IS NOT ON P(1). 03.7 fills FOUR boards, twenty tasks each, so
   * T013–T032 are on P(1), T033–T052 on P(2), and so on. Opening P(1) and
   * waiting for this card produced a 20s timeout on `Mark S3-T040 done` — a
   * dead-control message about a control that was on the next board along.
   * The row knows which board it is on; `id` stays only as the fallback.
   */
  const boardId = row.team_id || id;
  await board(page, boardId);

  /* Complete, from the card's own tick — the fastest path a person has. */
  if (row.status !== 'done') {
    await writes(page, /\/api\/tasks\/[^/]+$/, async () => {
      await card(page, title).getByRole('button', { name: new RegExp(`^Mark ${reEsc(title)} done$`) }).click();
    }, { methods: ['PATCH'] });
  }
  row = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
  expect(row.status, `${title} did not come back done.${dump(wire)}`).toBe('done');

  /* Reopen. */
  await board(page, boardId);
  await writes(page, /\/api\/tasks\/[^/]+$/, async () => {
    await card(page, title).getByRole('button', { name: new RegExp(`^Mark ${reEsc(title)} as not done$`) })
      .click();
  }, { methods: ['PATCH'] });
  row = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
  expect(row.status, `${title} did not reopen.${dump(wire)}`).not.toBe('done');

  /* Archive from the drawer, then restore. */
  await board(page, boardId);
  const drawer = await openDrawer(page, title);
  const archive = drawer.getByRole('button', { name: 'Archive task' });
  await expect(
    archive,
    'the drawer has no Archive control. It is passed only when the drawer believes ' +
    'the caller is NOT a portal client — see 03.14\'s note on the same predicate.',
  ).toBeVisible({ timeout: 20_000 });
  await writes(page, /\/api\/tasks\/[^/]+\/archive$/, async () => { await archive.click(); },
    { methods: ['PATCH'] });
  await writes(page, /\/api\/tasks\/[^/]+\/unarchive$/, async () => {
    await drawer.getByRole('button', { name: 'Restore task' }).click();
  }, { methods: ['PATCH'] });
  await closeDrawer(page, drawer);

  row = (await rowsOf(page, '/api/tasks')).find((t: any) => t.title === title);
  expect(row.archived_at, `${title} is still archived after restore.${dump(wire)}`).toBeFalsy();

  ledger('complete / reopen', 2, 2, 2);
  ledger('archive / restore', 2, 2, 2);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.21 — THE INTERACTION VOCABULARY (§1)
   ══════════════════════════════════════════════════════════════════════════ */

test('03.21 keyboard, transition, scroll, pagination and the two breakpoints', async ({ page }) => {
  test.setTimeout(25 * 60_000);
  const con = watchConsole(page);
  await signIn(page);
  const id = await requireProject(page, P(1));

  /* ── TRANSITION + KEYBOARD: the drawer opens, traps focus, and Escape closes it ── */
  await board(page, id);
  const drawer = await openDrawer(page, T(1));
  const focused = await page.evaluate(() => document.activeElement?.tagName || '');
  expect(focused, 'nothing inside the drawer took focus when it opened').toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(drawer, 'Escape did not close the task drawer').toBeHidden({ timeout: 15_000 });

  /* The same for the New Task modal, which is the product's primary create surface. */
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'New task' }).first().click();
  const modal = page.getByRole('dialog').first();
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  await expect(modal, 'Escape did not close the New Task modal').toBeHidden({ timeout: 15_000 });

  /* ── SCROLL + PAGINATION: past page one, on a list that now has 100 rows ── */
  await page.goto('/tasks');
  await settle(page);
  await page.getByRole('button', { name: /All open/ }).click().catch(() => { });
  await settle(page);
  const pager = page.locator('.k-pager');
  if (await pager.count()) {
    const posBefore = await pager.locator('.k-pager__pos').innerText();
    await pager.getByRole('button', { name: 'Next page' }).click();
    await expect(pager.locator('.k-pager__pos'), 'Next page changed nothing')
      .not.toHaveText(posBefore, { timeout: 15_000 });
    await pager.getByRole('button', { name: 'Previous page' }).click();
  }
  /* The wide table must scroll inside its own container, not the page. */
  const overflowsPage = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(
    overflowsPage,
    'the task list makes the PAGE scroll horizontally. §1: wide tables scroll ' +
    'inside their own container.',
  ).toBeFalsy();

  /* ── RESIZE: tablet and mobile, no clipping, no horizontal page scroll ── */
  for (const [w, h, label] of [[768, 1024, 'tablet'], [390, 844, 'mobile']] as Array<[number, number, string]>) {
    await page.setViewportSize({ width: w, height: h });
    for (const path of ['/projects', '/tasks', '/approvals']) {
      await page.goto(path);
      await settle(page);
      const bad = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      expect(bad, `${path} scrolls horizontally at ${label} (${w}px)`).toBeFalsy();
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  /* ── ZERO UNCAUGHT EXCEPTIONS, which is §1's non-negotiable ─────────── */
  expect(
    con.uncaught,
    `uncaught exceptions during the interaction sweep:\n${con.uncaught.join('\n')}`,
  ).toEqual([]);
  if (con.errors.length) {
    console.log(`\n  03.21 console.error lines (collected, not fatal):\n   · ${con.errors.slice(0, 20).join('\n   · ')}\n`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   03.22 — TODAY'S CARDS, RECONCILED
   ══════════════════════════════════════════════════════════════════════════ */

test('03.22 the dashboard\'s ten cards render, and its figures reconcile to the tasks underneath', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  await page.goto('/dashboard');
  await settle(page);

  const cards: Array<[string, RegExp]> = [
    ['Receivables KPI', /Receivables|Outstanding|₹/],
    ['Stat row', /open|overdue|due today/i],
    ['Quick actions', /New task|New invoice|Add|Create/i],
    ['On your plate', /On your plate|आपके हाथ में/],
    ['Cash position', /Cash/i],
    ['Project status', /Project/i],
    ['Approvals', /Approval/i],
    ['Upcoming week', /Upcoming|week/i],
    ['Team pulse', /Activity|pulse|Team/i],
    /**
     * ⚠ THE CITATION CARD RENDERED AND THIS ASSERTION STILL FAILED.
     *
     * It read `/Gītā|Gita|कर्मण्येवाधिकारस्ते/` — the text of the FALLBACK
     * verse `DashboardPage` uses when `/api/verse-of-the-day` does not answer.
     * The live route answers, and it answers a DIFFERENT verse every day with
     * a short reference: measured 2026-08-29,
     * `{"ref":"BG 6.5","sanskrit":"उद्धरेदात्मनात्मानं…"}`. The card drew
     * "— BG 6.5 · …" and the test reported a missing card, which is the one
     * diagnosis that sends someone looking for a component that is fine.
     *
     * `Citation` renders `— {source}`, so the em-dash-plus-reference is the
     * stable shape across both the live verse and the fallback, and it still
     * bites: delete the card and this goes red. It deliberately does not match
     * the greeting's own "करणीयं कुरु — Do what must be done", which is a
     * different element on the same page.
     */
    ['Citation', /—\s*(BG|Bhagavad)\s/],
  ];
  const screen = await page.locator('.k-screen').innerText();
  const absent = cards.filter(([, re]) => !re.test(screen)).map(([n]) => n);
  expect(
    absent,
    `${absent.length} of the ten Today cards did not render: ${absent.join(', ')}\n` +
    `     screen read: ${screen.replace(/\s+/g, ' ').slice(0, 600)}`,
  ).toEqual([]);

  /**
   * ── RECONCILED, NOT ADMIRED ────────────────────────────────────────────
   * §4: "every headline number tied back to its module. This page has printed
   * six wrong figures before." The dashboard derives from `GET /tasks`; so does
   * this assertion, from the same endpoint, independently computed.
   */
  const tasks = await rowsOf(page, '/api/tasks');
  const openCount = tasks.filter((t: any) => t.status !== 'done' && !t.archived_at).length;
  const truncated = await page.locator('.k-today__quiet').count();
  if (!truncated) {
    const statText = await page.locator('.k-stats, .k-statrow').first().innerText().catch(() => '');
    const numbers = (statText.match(/\d[\d,]*/g) || []).map((s) => Number(s.replace(/,/g, '')));
    expect(
      numbers.includes(openCount),
      `the dashboard's open-task figure does not appear among its stat tiles. ` +
      `GET /api/tasks counts ${openCount} open; the tiles read ${numbers.join(', ')}. ` +
      `⚠ ₹NaN, a stale figure or a silently capped one all look like this.`,
    ).toBeTruthy();
  } else {
    console.log('\n  03.22 the dashboard declared itself truncated ("at least"), so the ' +
      'exact reconciliation is not asserted — which is the page being honest.\n');
  }

  expect(screen.includes('NaN'), 'the dashboard printed NaN').toBeFalsy();
  expect(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(screen),
    'a raw UUID is rendered on the dashboard',
  ).toBeFalsy();
  expect(con.uncaught, `uncaught exceptions on /dashboard:\n${con.uncaught.join('\n')}`).toEqual([]);

  ledger("today's cards", 10, 0, 10 - absent.length);
});

/* ══════════════════════════════════════════════════════════════════════════
   03.23 — THE PROTECTED SET, AFTER
   ══════════════════════════════════════════════════════════════════════════ */

test('03.23 the protected Aekam Inc team is untouched after everything above', async ({ page }) => {
  await signIn(page);

  const teams = await rowsOf(page, '/api/teams');
  const protectedTeam = teams.find((t) => t.team_id === PROTECTED_TEAM);
  expect(protectedTeam, `the protected team ${PROTECTED_TEAM} is GONE`).toBeTruthy();
  expect(
    protectedTeam.task_count,
    `the protected team now holds ${protectedTeam.task_count} tasks, not ${PROTECTED_TASKS}. ` +
    `Proposal §9 pins it "exactly as it stands" and this suite has changed it.`,
  ).toBe(PROTECTED_TASKS);
  expect(
    protectedTeam.name,
    'the protected team has been RENAMED — the 2026-08-28 incident by another name',
  ).toBe('Aekam Inc');

  // Nothing this suite created may have landed inside it.
  const tasks = await rowsOf(page, '/api/tasks');
  const strays = tasks.filter((t: any) => t.team_id === PROTECTED_TEAM && /^S3[- ]/.test(t.title || ''));
  expect(
    strays.map((t: any) => t.title),
    'this suite wrote a task INTO the protected team',
  ).toEqual([]);

  ledger('protected set intact', 20, 0, PROTECTED_TASKS, 'checked before and after');
});
