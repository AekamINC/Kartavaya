/**
 * Proposal 93 · Stage 3 · WAVE 2 · SUITE 07 — Manav (HR), on Unicode Group.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` and nothing else. `signIn()` below calls `assertOrg()`
 * before any test may write, and `assertOrg()` asserts the org **ID** the
 * SERVER resolved — never a name on screen, because the name is exactly what
 * got corrupted when a platform credential renamed Aekam Inc on 2026-08-28.
 * See the header of `_lanes.ts`. No platform/god-mode credential appears here.
 *
 * Measured 2026-08-29, before a line of this file ran, with
 * `Authorization: E2E_UNICODE_TOKEN` and `X-Org-Id: fae87907…`:
 *
 *     GET /api/v1/org/profile        200  Unicode Group
 *     GET /api/v1/manav/stats        200  {"total_employees":0, …}
 *     employees · leave-types · holidays · shifts · job-openings · candidates ·
 *     assets · offboarding · announcements · expense-claims · departments ·
 *     bonus-awards · exit-interviews · swaps · shift-bids · performance ·
 *     custody/dsc · custody/notices        ALL 200, ALL rows=0
 *
 * So every empty state this suite asserts in 07.1 is asserted over a genuinely
 * empty module, and every count afterwards is a count this suite produced.
 *
 * ⚠ `meta.branch` COULD NOT BE CHECKED. CLAUDE.md says to confirm which SHA the
 * service runs before trusting a live probe. The deployed backend exposes no
 * such route — `/api/version`, `/api/_meta`, `/version`, `/api/build` and
 * `/api/health/meta` all answer 404. What it does answer is
 * `GET /api/health → {"environment":"staging","schema":"staging","db":"connected"}`.
 * That is the whole of the available evidence and it is recorded here rather
 * than glossed over.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ WHY NOT ONE EMPLOYEE IN THIS SUITE CARRIES AN EMAIL ADDRESS
 * ═══════════════════════════════════════════════════════════════════════════
 * Measured on the same day:
 *
 *     GET /api/health → {"outbound_mode":"live","suppressed_orgs_digest":"0"}
 *
 * NOTHING is suppressed. Unicode Group is not on `OUTBOUND_SUPPRESSED_ORGS` and
 * the addresses in that org are real people's — `.env.e2e` says so in capitals.
 * And Manav mails the address on the EMPLOYEE row from five separate paths:
 *
 *   · `POST /announcements`  mails EVERY active employee who has an address
 *     (`routers/manav.py:3214-3225`) — 6 announcements × 30 employees = 180
 *     real sends from one test.
 *   · `PATCH /leaves/{id}/action`      (:2992)
 *   · `PATCH /expense-claims/{id}/…`   (:4270, :4315)
 *   · `POST /schedules`                (:3599) — once per rostered cell, so 150
 *   · `POST /assets/{id}/assign|return`(:4768, :4805)
 *
 * `services/employee_email.py::_skip` returns True for a blank address, and the
 * five call sites above all guard on `emp.get("email")`. So an employee with no
 * address sends nothing, and an employee with no address is an entirely
 * ordinary personnel record — the form marks Email optional and only requires
 * it when the login box is ticked. **Every employee this suite types is created
 * with the Email field left blank, deliberately, and that is the ONLY reason
 * this suite can run at ~600 records without mailing anybody.**
 *
 * The same reasoning removes the "18 linked to logins" route through the
 * employee form's own **This person needs to sign in** tick: that path issues a
 * real invitation to a real inbox AND puts an address on the personnel row,
 * which re-arms all five senders above. It is not exercised here; 02.8 already
 * proves invite → accept → seat end to end. What IS exercised here is the
 * LINKING control, which invites nobody — see 07.12 and its shortfall note.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §4 VOLUMES THAT ARE NOT REACHABLE, AND WHY — stated, never silently capped
 * ═══════════════════════════════════════════════════════════════════════════
 * 1 · **4 cancelled leave requests.** `PATCH /leaves/{id}/action` accepts
 *     `'approved'` or `'rejected'` and answers 400 to anything else
 *     (`routers/manav.py:2911`), and `LeavesTab.jsx` renders exactly two
 *     buttons on a pending request. There is no cancel control and no cancel
 *     transition. 07.3 leaves 4 requests PENDING and says so.
 * 2 · **30 leave balances.** No route creates a balance. The only INSERT into
 *     `manav_leave_balances` in the whole backend is inside the APPROVAL branch
 *     of that same handler (:2981), and it creates at most one row per
 *     (employee, leave type, year). 14 approvals therefore produce at most 14
 *     balance rows. 07.3 targets 14 and proves the number MOVES.
 * 3 · **18 employees linked to a login.** Linking connects an employee to an
 *     account that is ALREADY a member of the organisation — `LinkPicker` and
 *     `LinkAccountsTab` both say so, and `POST /employees/{id}/link` takes a
 *     `user_id` off the member list. `GET /org/members` returned NINE rows on
 *     2026-08-29 carrying EIGHT distinct accounts (`kevalvshah03@gmail.com`
 *     appears twice — once org_owner, once org_admin, which is the per-org role
 *     fact CLAUDE.md says never to "clean"). The ceiling is therefore 8, not 18,
 *     and raising it means inviting ten more real people into a live org.
 * 4 · **8 performance reviews.** There is no performance-review record in this
 *     product. `PerformanceTab.jsx` has no create control, and
 *     `GET /performance/summary` DERIVES its rows from attendance. So 07.11
 *     marks attendance for 8 people and asserts 8 rows appear in the summary —
 *     which is the same evidence a review count was asking for, obtained the
 *     only way the product offers. It is a substitution, not the asked-for row.
 * 5 · **Notices need a CRM client.** `NewNotice.client_id` is mandatory
 *     (`routers/custody.py`), and `GET /custody/clients` returned rows=0 on
 *     Unicode. 07.13 types one company into the real Graha client form when
 *     none exists — a real form, really typed — and says in its own body that
 *     it is reaching outside Manav to do it. ⚠ Even with a client, the notice
 *     write itself does not complete; see §14 below.
 * 6 · **8 assets returned.** All 24 were created and issued; the return write
 *     never answers. See §14 below. This is a measurement, not a cap.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 IDEMPOTENCE — proved by running twice, never claimed
 * ═══════════════════════════════════════════════════════════════════════════
 * Every record this suite creates carries a DETERMINISTIC key: `S7-01`,
 * `AST-S7-04`, leave code `S7CL`, holiday name, shift name, asset tag, opening
 * title, announcement title, UDIN document title, DSC holder name. Each test
 * READS what exists first and creates only the shortfall, then asserts the
 * total. A second run therefore creates nothing and still asserts everything.
 *
 * `RUN` exists for the one place uniqueness is genuinely needed — the Graha
 * client 07.13 may have to mint — and is deliberately NOT sprinkled anywhere
 * else, because a stamped name is the opposite of idempotent.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * STATUTORY NOTES — where a green assertion could be wrong
 * ═══════════════════════════════════════════════════════════════════════════
 * · **Work state is set at create.** Professional tax is a STATE levy: Gujarat
 *   runs a four-slab ladder and Maharashtra a three-slab one with a separate
 *   female threshold, so the same salary yields different PT in each. This
 *   suite therefore RECORDS the state (Unicode is Gujarat, GST code 24, with
 *   four people deliberately on 27/29 so the register is not monotonic) and
 *   asserts that the detail page renders the state's NAME. It **does not assert
 *   any PT figure**: nothing on these screens computes one, and a number
 *   asserted here would be a number this suite invented.
 * · **PAN and Aadhaar block nothing.** 07.2 types one employee with both left
 *   blank and requires the save to succeed — the same standing GSTIN/PAN/TAN
 *   carries, which has regressed more than once.
 * · **Maternity leave is 182 days** — 26 weeks, Maternity Benefit (Amendment)
 *   Act 2017. That is why the leave type carries that quota and not a round 180.
 * · **Paternity leave has no central private-sector statutory entitlement.** It
 *   is recorded here as a company policy at 15 days and labelled as such.
 * · **Movable festival dates are not asserted.** The holiday calendar in 07.4
 *   uses dates that are FIXED — Republic Day, Labour Day, Independence Day,
 *   Gandhi Jayanti, Christmas, and Uttarayan/Vasi Uttarayan (solar, hence fixed
 *   at 14–15 January) — plus company-declared closures. Diwali, Holi and Eid
 *   move with the lunar calendar and this suite will not state a 2026 date for
 *   them as though it were authority.
 * · **Employees are soft-deleted and a leaver flag is deliberate.** 07.8 starts
 *   four exits and does NOT complete any: completing is what sets
 *   `is_active=FALSE`, and the screen's own rule is that deactivation is the
 *   last step. Keeping them open is what keeps 30 people on the register.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §14 — THIS SUITE RULES ON NOTHING
 * ═══════════════════════════════════════════════════════════════════════════
 * Every failure below is written to report the WIRE (method, status, path,
 * body) and stop. No assertion here is relaxed to make a screen pass, and no
 * product defect is diagnosed. That judgement is reserved.
 *
 * THREE THINGS STOPPED, and each is recorded as a MEASUREMENT with the three
 * evidence streams §14 asks for. None of them is a verdict and none of them is
 * worked around:
 *
 * 1 · 07.6 — `POST /api/v1/manav/assets/{id}/return` never answers.
 *     · wire      `POST /api/v1/manav/assets/dffe02d2…/return  net::ERR_FAILED`,
 *                 and the app's own toast reads "No response from the server —
 *                 check your connection". Reproduced on two deployments.
 *     · code      `routers/manav.py:4787` selects `a.asset_type`.
 *     · catalogue `SELECT column_name FROM information_schema.columns WHERE
 *                 table_name='manav_assets'` answers, in every schema:
 *                 asset_tag, name, **category**, serial_number, purchase_date,
 *                 purchase_cost, assigned_to, assigned_date, returned_date,
 *                 condition, notes, is_active, created_by/at, updated_at.
 *                 There is no `asset_type` column. Migration 043 names the
 *                 column `category`.
 *     All 24 assets were created and all 24 issued through the real controls;
 *     the eight returns §4 asks for could not be driven.
 *
 * 2 · 07.13 — `POST /api/v1/custody/notices` never answers.
 *     · wire      `POST /api/v1/custody/notices  net::ERR_FAILED`.
 *     · Railway   deploy log, 2026-08-29T02:23:19Z, deployment d26962b8:
 *                 `asyncpg.exceptions.UndefinedColumnError: column r.created_at
 *                 does not exist`.
 *     · code      `services/custody/notices.py:452-453` selects `r.created_at,
 *                 r.updated_at`; on the create path `r` is the `written` CTE,
 *                 whose column list is `_WRITE_RETURNING` (:875-880) and does
 *                 not carry either. The table itself HAS both columns — the
 *                 live catalogue confirms it — so the register reads fine and
 *                 only the write path fails.
 *     The notice register still holds 0 rows on every org.
 *
 * 3 · 07.14 — the DSC and UDIN register rows render 77px while `--row-h`
 *     resolves to 66px AT THE ROW ITSELF (document token also 66px). Nine other
 *     Manav tables measure 66/66. `scripts/check-table-rows.mjs` is green —
 *     it checks that a table class REFERENCES the token, which these do; this
 *     is the runtime half of the same contract and it is measured, not read.
 *
 * ── AND ONE THING THIS SUITE ITSELF GOT WRONG, LEFT ON THE RECORD ──────────
 * An early revision keyed UDIN idempotence on the `at-risk` list alone. A
 * numbered document leaves that list, so the second run recorded the same
 * signing again and `staging.udin_register` carries two "Net worth certificate
 * (S7)" rows for Sharma Textiles. The register has no delete — deliberately —
 * so the duplicate stands. The key is now at-risk ∪ revocable and the volume is
 * counted from `by_status`; see the note at that call site.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave2.config.ts --grep "Suite 07"
 */
import { test, expect, Page, Locator } from '@playwright/test';
import { lane, activeLane, assertOrg } from './_lanes';
import { setDate, settle, isForeignInlineScriptRefusal } from './_helpers';

// ⚠ STAGE 4 (§14): `activeLane()` reads E2E_LANE and DEFAULTS TO 'unicode', so an
// unset run is byte-for-byte the Unicode run this suite was authored against.
// `lane('unicode')` frozen here at import time was why the UK replay could not
// be run at all — §14's own first category, a hidden dependency on Unicode.
const LANE = activeLane();
const API = process.env.E2E_API_URL || 'https://api.kartavaya.com';

/** The one place a stamp is needed. See §6 above. */
const RUN = new Date().toISOString().slice(0, 10).replace(/-/g, '');

const BLOCKED =
  'BLOCKED — no Unicode Group credential. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e at the repo root. ⚠ It must be an ' +
  'ORG-SCOPED account: a platform_admin token resolves to Aekam Inc via ' +
  'platform_bypass and would write there. ENVIRONMENT blocker, not a product ' +
  'or test defect.';

/**
 * ⚠ ORDER YES, `serial` NO — and the difference is deliberate.
 *
 * The tests build on each other's rows: 07.3 needs the employees 07.2 typed,
 * 07.5's roster needs the two people 07.7 hires. Playwright runs the tests in
 * one file in DECLARATION order on a single worker (this config does not set
 * `fullyParallel`), so that ordering holds without `mode: 'serial'`.
 *
 * What `serial` would add is SKIPPING every later test once one fails — and on
 * a programme whose whole purpose is to measure how much of a module a customer
 * can actually drive, that turns one shipped blocker into twelve unmeasured
 * screens. 07.6 currently stops on a write the server never answers; under
 * `serial` that single failure would have hidden exits, custody, commission,
 * the three compliance registers and the standing-rule sweep, and the report
 * would have had nothing to say about any of them.
 *
 * Every test signs in for itself and reads what exists before it creates, so a
 * later test is not left half-built by an earlier failure — it either finds its
 * precondition and proceeds, or fails saying which test owns it.
 */

test.beforeAll(() => {
  console.log(
    `\n  LANE: ${LANE.org} (${LANE.orgId})  · reference lane, §14` +
    `\n  API : ${API}` +
    `\n  ⚠ outbound_mode=live and nothing is suppressed — every employee this` +
    `\n    suite types is created with NO email address. See the header.\n`,
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   THE HARNESS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Sign in, then REFUSE TO CONTINUE unless the session resolved to Unicode.
 *
 * The token opens the door; every row below is still typed and clicked. §2 of
 * the proposal takes the same position about the bootstrap admin it insists on
 * keeping: "This is not a bypass of the 'driven as a user' rule — it is the
 * precondition for it."
 *
 * `assertOrg()` is called HERE rather than left for each test to remember. It
 * has been found not running twice already; a countermeasure that depends on
 * being remembered is one that will be forgotten.
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
 * **E2E Test & Associates**, not Unicode. A read helper that answers for a
 * different organisation than the screen beside it is the same class of fault
 * as the 2026-08-28 cross-org incident, so this file has its own, bound to the
 * lane's org id and to nothing in the environment.
 *
 * GET only, and that is a rule rather than an accident: `check-e2e-no-bypass`
 * bans `page.request.post/put/patch/delete` and permits `get`, because
 * asserting that the row appeared IS the required evidence.
 */
async function orgGet(page: Page, path: string): Promise<any> {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
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
 * two apart. A failure here reports what the server actually said.
 */
type Wire = string[];
/**
 * A request that never came back is invisible to a response listener, and it is
 * the failure mode that reads most like "the button does nothing". So failures
 * are recorded too, with Chromium's own reason — `net::ERR_ABORTED`, a CORS
 * refusal, a dropped connection — and they are what a timeout in `writes()`
 * prints instead of a bare "Timeout exceeded".
 */
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
    failed.push(`${req.method()} FAILED ${new URL(req.url()).pathname}  ${req.failure()?.errorText ?? '(no reason given)'}`);
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
 * Open Manav and switch to one tab, wherever `ModuleTabs` has put it.
 *
 * Manav declares TWENTY tabs and `ModuleTabs` shows at most eight inline — the
 * rest live behind "More +N", and WHICH ones depends on the measured width of
 * the strip. A test that only looks in the tablist silently misses two thirds
 * of this module.
 *
 * ⚠ Scoped to the module tablist by its aria-label. `_helpers.ts::openTab`
 * uses a bare `getByRole('tab')`, and Manav renders THREE more tablists inside
 * its panels — Shifts' four sub-views, the DSC views, the Notice views — every
 * one of them `role="tab"`. Suite rule 6: an unscoped name match resolves in
 * DOM order and will hit the wrong one.
 *
 * The page holds its tab in local state with no URL parameter, so `goto` always
 * lands on whatever `useTabPrefs` has starred. Every caller therefore names the
 * tab it wants; nothing here assumes the landing tab.
 */
async function manav(page: Page, tabId: string): Promise<void> {
  if (!/\/manav/.test(page.url())) {
    await page.goto('/manav');
  }
  const strip = page.getByRole('tablist', { name: 'Manav sections' });
  await expect(strip, 'the Manav tab strip never rendered').toBeVisible({ timeout: 45_000 });

  /**
   * ⚠ LET THE STRIP FINISH MEASURING BEFORE DECIDING WHERE THE TAB IS.
   *
   * `ModuleTabs` does not have a fixed inline count: a `ResizeObserver` measures
   * the row and re-derives `fits`, then re-splits head and tail. So on first
   * paint `#mt-tab-recruitment` can EXIST, and a beat later be gone into the
   * More menu. Deciding the branch from `count()` and then clicking produced
   * "waiting for locator('#mt-tab-recruitment')" — a tab that was there when it
   * was looked for and not there when it was pressed.
   *
   * This waits for the number of inline tabs to stop moving, then decides.
   */
  let stable = -1;
  let sameFor = 0;
  for (let i = 0; i < 25; i++) {
    const n = await strip.locator('[role="tab"]').count();
    if (n > 0 && n === stable) { sameFor += 1; if (sameFor >= 3) break; } else { sameFor = 0; }
    stable = n;
    await page.waitForTimeout(200);
  }

  /**
   * The whole reach is retried, not just the click — because the branch itself
   * can go stale. This CANNOT let a missing tab pass: success is defined as the
   * PANEL opening, and after four attempts the real error is rethrown.
   */
  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const inline = page.locator(`#mt-tab-${tabId}`);
      if (await inline.count()) {
        await inline.click({ timeout: 15_000 });
      } else {
        const more = page.getByRole('button', { name: /^More/ });
        await expect(more, `the "${tabId}" tab is not inline and there is no More menu`).toBeVisible();
        // ⚠ THE TRIGGER IS A TOGGLE. `onClick={() => setOpenMore(o => !o)}`, so
        // clicking it when the popover is already open CLOSES it — and then the
        // menu lookup runs against a menu that is not on screen and reports the
        // tab as absent. `aria-expanded` is the state to read.
        if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 10_000 });
        // By the accessible NAME, which for a popover row is `tabEn(id)` — the
        // id with hyphens turned into spaces. The Devanagari beside it is
        // `aria-hidden`, so it never contributes.
        const row = menu.getByRole('menuitem', {
          name: new RegExp(`^\\s*${tabId.replace(/-/g, ' ')}\\s*$`, 'i'),
        });
        if (await row.count()) {
          await row.click();
        } else {
          /* ⚠ NEITHER PLACE — AND THAT USUALLY MEANS THE STRIP MOVED BETWEEN
             THE TWO LOOKS, NOT THAT THE TAB IS GONE. `fits` flaps while the
             ResizeObserver settles, so `recruitment` can read as absent from
             the inline head one moment and be back in it the next, having never
             been in the tail at all. Close the menu and look inline once more
             before accusing the product of a missing tab. */
          const listed = (await menu.locator('.mt__pop-en').allTextContents()).join(', ');
          const inlineIds = await page.$$eval('[id^="mt-tab-"]', (els) => els.map((e) => e.id).join(','));
          /* ⚠ THE RE-CHECK HAPPENS WHILE THE MENU IS STILL OPEN, and that is a
             test bug's fix. Closing the popover first — with Escape, which
             `ModuleTabs` handles by returning focus to the trigger — unmounts
             it, the strip's `ResizeObserver` fires on the width change and
             re-derives `fits`, and the tab that was inline a moment earlier is
             gone again. Measured: `$$eval('[id^="mt-tab-"]')` listed
             `mt-tab-recruitment` at this exact point while
             `locator('#mt-tab-recruitment').count()` answered 0 for ten
             seconds AFTER the Escape. So the look happens first and the
             closing happens second. */
          const backInline = page.locator(`#mt-tab-${tabId}`);
          expect(
            inlineIds.split(',').includes(`mt-tab-${tabId}`),
            `the "${tabId}" tab is in neither the strip nor the More menu.\n` +
            `     inline: ${inlineIds}\n     More menu: ${listed || '(the menu was not open)'}`,
          ).toBeTruthy();
          // Close the popover through its own toggle rather than through a key
          // the page also listens for, then take the inline route.
          await more.click();
          await backInline.click({ timeout: 15_000 });
        }
      }
      await expect(page.locator(`#mt-panel-${tabId}`),
        `the "${tabId}" panel did not open`).toBeVisible({ timeout: 20_000 });
      await settle(page);
      return;
    } catch (e) {
      last = e;
      if (attempt === 4) throw e;
      console.log(`\n[manav] the tab strip moved while reaching "${tabId}" — retry ${attempt}\n`);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  throw last;
}

/** Shifts has four sub-views of its own; `ShiftsTab.jsx` renders them as a tablist. */
async function shiftView(page: Page, view: 'definitions' | 'schedules' | 'bids' | 'swaps') {
  await page.locator(`#mn-shift-tab-${view}`).click();
  await expect(page.locator(`#mn-shift-panel-${view}`)).toBeVisible({ timeout: 20_000 });
  await settle(page);
}

/** A `.mn-sub` sub-view that is NOT a shift view — DSC and Notices both use one. */
async function subView(page: Page, listLabel: string, label: string) {
  const bar = page.getByRole('tablist', { name: listLabel });
  await expect(bar, `no sub-view bar labelled "${listLabel}"`).toBeVisible({ timeout: 20_000 });
  await bar.getByRole('tab', { name: label, exact: true }).click();
  await settle(page);
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
    // A bare "Timeout exceeded" is the least useful sentence a write test can
    // print. Say whether the browser issued the request at all, and what
    // Chromium said about it if it did.
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
 * Click a control that sits in a list which refetches under it.
 *
 * ⚠ THIS IS A TEST BUG'S FIX AND IT IS WRITTEN DOWN SO IT IS NOT LATER READ AS
 * A PRODUCT ONE. Suite 02's 02.14 and 02.15 both failed with
 *
 *     locator.click: element is not stable … element was detached from the DOM
 *
 * because a list refetch replaced the tbody while the click's actionability
 * wait was still running. Manav has no row ACTION MENUS, but it has the same
 * hazard on row buttons — Assets reloads its list after every assign, return
 * and delete, Holidays after every remove.
 *
 * TWO MEASURES, and the order matters:
 *   1. SETTLE FIRST — any GET already in flight for this list is awaited, so
 *      the common case never races at all. This is the real fix.
 *   2. RE-RESOLVE, at most three times, and ONLY on the detach signature. A
 *      blind retry papers over a genuinely missing or genuinely disabled
 *      control, which is the one thing this suite exists to catch — so any
 *      other failure is rethrown on the first attempt.
 */
async function retryOnDetach(page: Page, act: () => Promise<void>, why: string) {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await act();
      return;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (!/detached from the DOM|not stable|element is not attached/i.test(msg) || attempt === 3) throw e;
      last = e;
      console.log(`\n[retryOnDetach] ${why} — the tree moved under the click, retry ${attempt}\n`);
      await page.waitForTimeout(400);
    }
  }
  throw last;
}

async function clickSettled(page: Page, target: Locator, listUrl: RegExp, why: string) {
  await page
    .waitForResponse((r) => listUrl.test(r.url()) && r.request().method() === 'GET', { timeout: 2_000 })
    .catch(() => {});
  await retryOnDetach(page, async () => {
    await expect(target, why).toBeVisible({ timeout: 15_000 });
    await target.click({ timeout: 10_000 });
  }, why);
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The `<label>` element whose caption is EXACTLY this text.
 *
 * ⚠ NOT `getByLabel()`, and the reason is a real failure rather than taste.
 * Every form in this module is shaped `<label><span>Caption</span><control/></label>`,
 * and an accessible name computed from a wrapping label INCLUDES the embedded
 * control's own value. So `getByLabel('Work state', { exact: true })` finds
 * nothing: the computed name is "Work state Not recorded", because the select's
 * selected option is part of the label's text. It works on an empty text box
 * and silently stops working on every select and on any box that already has a
 * value — which is exactly the kind of matcher that passes on the happy path
 * and fails on the second run.
 *
 * Matching the `<span>` that carries the caption is structural and cannot drift
 * with the value.
 *
 * ⚠ THE INNER LOCATOR IS BUILT FROM `scope.page()`, NOT FROM `scope`, AND THAT
 * IS NOT A STYLE CHOICE. `filter({ has })` re-roots the inner locator at each
 * outer match and keeps its WHOLE selector chain — so
 * `scope.locator('span')` on a scope of `form.k-formpanel` becomes
 * `label >> form.k-formpanel >> span`, which can never match because no form
 * lives inside a label. It resolved zero elements on every call and read as
 * "no field labelled …", i.e. exactly like a missing control.
 */
function field(scope: Locator, label: string): Locator {
  const caption = scope.page().locator('span').filter({ hasText: new RegExp(`^\\s*${reEsc(label)}\\s*$`) });
  return scope.locator('label').filter({ has: caption }).first();
}

/**
 * Type into a field, with REAL KEYSTROKES.
 *
 * `fill('')` does not register with a controlled input — that is the fault
 * behind Suite 02's false accusation that "a firm cannot remove its GSTIN". So
 * this selects all and TYPES OVER the selection.
 *
 * ⚠ IT DOES NOT PRESS DELETE FIRST, and that is a bug this suite already
 * committed once. Several fields here open with a value and cannot hold an
 * empty one: `RequestForm`'s Days is
 * `onChange={e => setForm({...form, days: parseFloat(e.target.value) || 1})}`,
 * so clearing it makes React re-render the box as "1" — and the next keystroke
 * APPENDS. Every `days: 2` this suite typed reached the server as **12**, and
 * `days: 1` as **11**, on a screen that looked perfectly correct while it was
 * happening. `Break (minutes)`, `Slots needed` and `Notice period (days)` all
 * have the same shape.
 *
 * Typing over a selection replaces it in one event, so the box is never empty
 * and the default can never fire. An explicit Delete is kept for the one case
 * that genuinely wants a blank field.
 */
async function type(scope: Locator, label: string, value: string) {
  const box = field(scope, label).locator('input:not([type="checkbox"]):not([type="radio"]), textarea').first();
  await expect(box, `no field labelled "${label}"`).toBeVisible({ timeout: 20_000 });
  await box.click();
  await box.press('ControlOrMeta+a');
  if (value) {
    await box.pressSequentially(value, { delay: 4 });
    // Proof it landed. Without this the append-to-default fault above is
    // invisible until a downstream count disagrees with the form.
    await expect(box, `"${label}" would not take the value "${value}"`).toHaveValue(value, { timeout: 10_000 });
  } else {
    await box.press('Delete');
  }
}

/**
 * Choose from a real `<select>`, by the caption a person reads and the option
 * text they read.
 *
 * ⚠ NOT `_helpers.ts::pickOption`, and the reason is a real failure. That
 * helper ends `expect(idx).toBeGreaterThan(0)` — it assumes every select opens
 * with a placeholder, so index 0 is never a legal answer. Half the selects in
 * this module have no placeholder at all: Employment type opens on
 * `full_time`, Category on `laptop`, Condition on `new`, Priority on `low`. On
 * those it refuses the FIRST option and reports "no Employment type option
 * matching full time" while listing "full time" as the first thing it saw.
 *
 * ⚠ THE COUNT IS ASSERTED BEFORE THE SEARCH. A `findIndex` over an empty list
 * answers -1 and a `for` over one runs zero times — 02.3 passed forever that
 * way. An empty picker is a real failure and is reported as one.
 */
async function choose(scope: Locator, label: string, optionLabel: string | RegExp) {
  const sel = field(scope, label).locator('select').first();
  await expect(sel, `no select labelled "${label}"`).toBeVisible({ timeout: 20_000 });
  await selectByText(sel, label, optionLabel);
}

/**
 * The same, for a select this module labels with `aria-label` instead.
 *
 * ⚠ IT POLLS FOR THE OPTION, NOT FOR A COUNT. Every picker in this module
 * renders its own placeholder while the list is in flight — `{loading ?
 * 'Loading…' : error ? 'Unavailable' : '— Select —'}` — so a select that has
 * "loaded one option" has loaded NOTHING. Reading it once produced
 * `no "Your shift *" option matching …; the picker offered: Loading…`, which is
 * a race dressed up as a missing record.
 *
 * A picker that is genuinely `Unavailable` fails immediately rather than
 * waiting out the timeout: that is the list's own error state and it is a
 * finding, not something to wait for.
 */
async function selectByText(sel: Locator, label: string, optionLabel: string | RegExp) {
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  const hit = (t: string) =>
    typeof optionLabel === 'string' ? norm(t).includes(optionLabel) : optionLabel.test(t);

  const deadline = Date.now() + 30_000;
  let texts: string[] = [];
  let idx = -1;
  for (;;) {
    texts = (await sel.locator('option').allTextContents()).map(norm);
    idx = texts.findIndex(hit);
    if (idx >= 0) break;
    if (texts.some((t) => t === 'Unavailable')) break;   // the list failed; report it
    if (Date.now() > deadline) break;
    await sel.page().waitForTimeout(250);
  }
  expect(
    idx,
    `no "${label}" option matching ${optionLabel}; the picker offered: ` +
    (texts.length ? texts.slice(0, 12).join(' | ') : '(nothing at all)'),
  ).toBeGreaterThanOrEqual(0);
  const value = await sel.locator('option').nth(idx).getAttribute('value');
  await sel.selectOption(value ?? { index: idx });
}

/** Tick or untick a real checkbox, by the words beside it. */
async function tick(scope: Locator, words: string | RegExp, on = true) {
  const box = scope.locator('label').filter({ hasText: words }).first().locator('input[type="checkbox"]');
  await expect(box, `no checkbox beside "${words}"`).toBeVisible({ timeout: 20_000 });
  if ((await box.isChecked()) !== on) await box.click();
}

/**
 * Set a `DateInput type="time"`.
 *
 * `_helpers.ts::setDate` drives the calendar and there is no calendar on a time
 * picker: `DateInput.jsx:223` renders a listbox of 48 half-hour options. The
 * option is chosen BY INDEX off that list — `TIMES` is
 * `Array.from({length: 48}, (_, i) => …)` so index `h*2 + (m/30)` is exact,
 * where matching the rendered label would depend on `toLocaleTimeString`
 * agreeing between node and the browser.
 *
 * ⚠ THE COUNT IS ASSERTED BEFORE THE INDEX IS USED. 02.3 looped over
 * `input[type="checkbox"]` where the product renders `<button role="switch">`,
 * the loop ran zero times, and it passed every time. An `nth()` on an empty
 * list is the same shape of nothing.
 */
async function setTime(scope: Locator, label: string, hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  expect(m === 0 || m === 30, `${hhmm} is not on a half hour — the picker offers no such option`).toBeTruthy();
  const lbl = scope.locator('label').filter({ hasText: label }).first();
  await lbl.locator('button.pk__tr').first().click();
  const pop = lbl.locator('[role="dialog"]');
  await expect(pop).toBeVisible({ timeout: 10_000 });
  const options = pop.locator('.pk__times [role="option"]');
  await expect(options, 'the time picker offered no options at all').toHaveCount(48, { timeout: 10_000 });
  await options.nth(h * 2 + (m === 30 ? 1 : 0)).click();
  await expect(pop).toBeHidden({ timeout: 10_000 });
}

/**
 * A date that is YEARS away, driven through the same calendar.
 *
 * ⚠ `_helpers.ts::setDate` walks the calendar a month at a time and gives up
 * after THIRTEEN steps — deliberately, so a wrong ISO string fails the test
 * instead of spinning forever. That ceiling is right for a joining date and
 * wrong for a Digital Signature Certificate: a Class 3 DSC is issued for one,
 * two or three years, so "valid to" is routinely eighteen months out and
 * `the calendar never reached February 2028` is the helper's limit rather than
 * anything about the product.
 *
 * Same calendar, same clicks, a longer walk — and still bounded, at six years,
 * so a typo still fails rather than hanging.
 */
async function setDateFar(scope: Locator, labelText: string, iso: string) {
  const label = scope.locator('label', { hasText: labelText }).first();
  await label.locator('.pk--dt button.pk__tr').first().click();
  const pop = label.locator('.pk__pop');
  await expect(pop, `the date picker for "${labelText}" did not open`).toBeVisible({ timeout: 10_000 });

  const want = new Date(`${iso}T00:00:00`);
  const title = `${want.toLocaleString('en-GB', { month: 'long' })} ${want.getFullYear()}`;
  for (let i = 0; i < 73; i++) {
    const shownText = (await pop.locator('.pk__calt').innerText()).trim();
    if (shownText === title) break;
    const shown = new Date(`${shownText} 1`);
    await pop.getByRole('button', { name: shown < want ? 'Next month' : 'Previous month' }).click();
  }
  expect((await pop.locator('.pk__calt').innerText()).trim(),
    `the calendar never reached ${title} for "${labelText}"`).toBe(title);
  await pop.locator('.pk__d:not(.out)', { hasText: new RegExp(`^${want.getDate()}$`) }).first().click();
  await expect(pop).toBeHidden({ timeout: 10_000 });
}

/**
 * The toast TITLE. `.tst__t` carries the verb, `.tst__s` the message — 02.2b
 * was a test bug for reading the pair the wrong way round.
 *
 * ⚠ `.first()`, and it is a TEST BUG'S FIX rather than a loosening. Toasts
 * STACK: creating six departments in a row leaves several "Department created"
 * cards on screen at once, and a bare match is a strict-mode violation that
 * reads exactly like "the product did not confirm". The status of the write is
 * already asserted by `writes()` — the server's answer, not the client's
 * opinion — so this is the screen's corroboration and `.first()` is enough.
 */
function toastTitle(page: Page, text: string | RegExp) {
  return page.locator('.tst__t').filter({ hasText: text }).first();
}

/** The `Empty` component's own two nodes — `EmptyState.jsx:159,164`. */
function emptyTitle(page: Page) { return page.locator('.empty__title'); }

/* ══════════════════════════════════════════════════════════════════════════
   THE DATA — deterministic, so a second run recognises its own output
   ══════════════════════════════════════════════════════════════════════════ */

const DEPARTMENTS = ['Audit', 'Taxation', 'Advisory', 'Compliance', 'Accounts', 'Administration'];

/**
 * 28 people typed into the form; the other two of §4's thirty arrive as HIRES
 * from the recruitment pipeline in 07.7, which is what makes that conversion
 * provable rather than asserted.
 *
 * `state` is the GST state code the select stores. Unicode Group is a Gujarat
 * firm, so 24 dominates — but four people sit in 27 (Maharashtra) and 29
 * (Karnataka), because a register where every row carries the same state cannot
 * show that the column is being read at all. NO PT FIGURE IS ASSERTED: the
 * ladders differ by state and by gender and nothing on these screens computes
 * one, so a number here would be a number this suite invented.
 *
 * Joining dates are all inside the current month. `setDate` walks the calendar
 * a month at a time and gives up after thirteen steps, so a date far in the
 * past is unreachable through the picker — see the note on `date_of_birth` in
 * 07.2, which is a limitation of the shared helper, not of the product.
 */
type Emp = { code: string; name: string; dept: string; desig: string; state: string; type: string; join: string };
const EMPLOYEES: Emp[] = [
  { code: 'S7-01', name: 'Aarav Trivedi',    dept: 'Audit',          desig: 'Audit Manager',        state: '24', type: 'full_time', join: '2026-08-03' },
  { code: 'S7-02', name: 'Diya Bhatt',       dept: 'Audit',          desig: 'Senior Associate',     state: '24', type: 'full_time', join: '2026-08-03' },
  { code: 'S7-03', name: 'Kabir Solanki',    dept: 'Audit',          desig: 'Associate',            state: '24', type: 'full_time', join: '2026-08-04' },
  { code: 'S7-04', name: 'Meera Chauhan',    dept: 'Audit',          desig: 'Article Assistant',    state: '24', type: 'intern',    join: '2026-08-04' },
  { code: 'S7-05', name: 'Rohit Vyas',       dept: 'Taxation',       desig: 'Tax Manager',          state: '24', type: 'full_time', join: '2026-08-05' },
  { code: 'S7-06', name: 'Ishita Modi',      dept: 'Taxation',       desig: 'Senior Associate',     state: '24', type: 'full_time', join: '2026-08-05' },
  { code: 'S7-07', name: 'Nikhil Parekh',    dept: 'Taxation',       desig: 'Associate',            state: '27', type: 'full_time', join: '2026-08-06' },
  { code: 'S7-08', name: 'Sana Qureshi',     dept: 'Taxation',       desig: 'Associate',            state: '24', type: 'part_time', join: '2026-08-06' },
  { code: 'S7-09', name: 'Yash Rathod',      dept: 'Advisory',       desig: 'Advisory Manager',     state: '24', type: 'full_time', join: '2026-08-07' },
  { code: 'S7-10', name: 'Anjali Pandya',    dept: 'Advisory',       desig: 'Consultant',           state: '27', type: 'consultant', join: '2026-08-07' },
  { code: 'S7-11', name: 'Vivek Thakkar',    dept: 'Advisory',       desig: 'Analyst',              state: '24', type: 'full_time', join: '2026-08-10' },
  { code: 'S7-12', name: 'Pooja Raval',      dept: 'Advisory',       desig: 'Analyst',              state: '24', type: 'full_time', join: '2026-08-10' },
  { code: 'S7-13', name: 'Harsh Gandhi',     dept: 'Compliance',     desig: 'Compliance Lead',      state: '24', type: 'full_time', join: '2026-08-11' },
  { code: 'S7-14', name: 'Rhea Vaghela',     dept: 'Compliance',     desig: 'Compliance Officer',   state: '24', type: 'full_time', join: '2026-08-11' },
  { code: 'S7-15', name: 'Aditya Barot',     dept: 'Compliance',     desig: 'Executive',            state: '29', type: 'full_time', join: '2026-08-12' },
  { code: 'S7-16', name: 'Neha Dave',        dept: 'Compliance',     desig: 'Executive',            state: '24', type: 'contract',  join: '2026-08-12' },
  { code: 'S7-17', name: 'Manav Joshi',      dept: 'Accounts',       desig: 'Accounts Manager',     state: '24', type: 'full_time', join: '2026-08-13' },
  { code: 'S7-18', name: 'Krisha Amin',      dept: 'Accounts',       desig: 'Senior Accountant',    state: '24', type: 'full_time', join: '2026-08-13' },
  { code: 'S7-19', name: 'Parth Shukla',     dept: 'Accounts',       desig: 'Accountant',           state: '24', type: 'full_time', join: '2026-08-14' },
  { code: 'S7-20', name: 'Tanvi Bhavsar',    dept: 'Accounts',       desig: 'Accounts Assistant',   state: '24', type: 'full_time', join: '2026-08-14' },
  { code: 'S7-21', name: 'Devansh Jani',     dept: 'Accounts',       desig: 'Accounts Assistant',   state: '27', type: 'part_time', join: '2026-08-17' },
  { code: 'S7-22', name: 'Riya Kapadia',     dept: 'Administration', desig: 'Office Manager',       state: '24', type: 'full_time', join: '2026-08-17' },
  { code: 'S7-23', name: 'Om Prajapati',     dept: 'Administration', desig: 'Front Desk',           state: '24', type: 'full_time', join: '2026-08-18' },
  { code: 'S7-24', name: 'Zoya Shaikh',      dept: 'Administration', desig: 'HR Executive',         state: '24', type: 'full_time', join: '2026-08-18' },
  { code: 'S7-25', name: 'Jay Makwana',      dept: 'Administration', desig: 'IT Support',           state: '24', type: 'full_time', join: '2026-08-19' },
  { code: 'S7-26', name: 'Aisha Merchant',   dept: 'Advisory',       desig: 'Consultant',           state: '24', type: 'consultant', join: '2026-08-19' },
  { code: 'S7-27', name: 'Karan Desai',      dept: 'Audit',          desig: 'Associate',            state: '24', type: 'full_time', join: '2026-08-20' },
  { code: 'S7-28', name: 'Simran Kaur',      dept: 'Taxation',       desig: 'Associate',            state: '24', type: 'full_time', join: '2026-08-20' },
];

const STATE_NAME: Record<string, string> = { '24': 'Gujarat', '27': 'Maharashtra', '29': 'Karnataka' };

/**
 * Six leave types. The quotas are statutory where a statute exists and are
 * labelled as policy where one does not — see the statutory notes in the
 * header. Codes are the idempotence key.
 */
const LEAVE_TYPES = [
  { name: 'Casual Leave (S7)',    code: 'S7CL',  quota: 12,  paid: true,  carry: false },
  { name: 'Sick Leave (S7)',      code: 'S7SL',  quota: 12,  paid: true,  carry: false },
  { name: 'Earned Leave (S7)',    code: 'S7EL',  quota: 15,  paid: true,  carry: true },
  { name: 'Loss of Pay (S7)',     code: 'S7LOP', quota: 0,   paid: false, carry: false },
  { name: 'Maternity Leave (S7)', code: 'S7ML',  quota: 182, paid: true,  carry: false },
  { name: 'Paternity Leave (S7)', code: 'S7PL',  quota: 15,  paid: true,  carry: false },
];

/**
 * Fourteen holidays: twelve that apply to the whole country and two that are
 * Gujarat's. Every date here is FIXED — see the statutory note about movable
 * festivals in the header.
 */
const HOLIDAYS = [
  { name: 'New Year Day (S7)',              date: '2026-01-01', state: '',   optional: true },
  { name: 'Republic Day (S7)',              date: '2026-01-26', state: '',   optional: false },
  { name: 'Financial year-end closure (S7)', date: '2026-03-31', state: '',  optional: false },
  { name: 'Labour Day (S7)',                date: '2026-05-01', state: '',   optional: false },
  { name: 'Founders Day (S7)',              date: '2026-06-15', state: '',   optional: true },
  { name: 'Independence Day (S7)',          date: '2026-08-15', state: '',   optional: false },
  { name: 'Half-yearly closure (S7)',       date: '2026-09-30', state: '',   optional: false },
  { name: 'Gandhi Jayanti (S7)',            date: '2026-10-02', state: '',   optional: false },
  { name: 'Festival closure I (S7)',        date: '2026-11-09', state: '',   optional: true },
  { name: 'Festival closure II (S7)',       date: '2026-11-10', state: '',   optional: false },
  { name: 'Christmas Day (S7)',             date: '2026-12-25', state: '',   optional: false },
  { name: 'Year-end closure (S7)',          date: '2026-12-31', state: '',   optional: true },
  // Gujarat's two. Uttarayan is solar and therefore genuinely fixed at 14–15
  // January, which is why these two can be stated where Diwali cannot.
  { name: 'Uttarayan (S7)',                 date: '2026-01-14', state: 'Gujarat', optional: false },
  { name: 'Vasi Uttarayan (S7)',            date: '2026-01-15', state: 'Gujarat', optional: true },
];

const SHIFTS = [
  { name: 'General (S7)',   start: '09:00', end: '18:00', brk: 60 },
  { name: 'Morning (S7)',   start: '06:00', end: '14:00', brk: 30 },
  { name: 'Afternoon (S7)', start: '14:00', end: '22:00', brk: 30 },
  { name: 'Night (S7)',     start: '22:00', end: '06:00', brk: 45 },
  { name: 'Half day (S7)',  start: '09:00', end: '13:30', brk: 0 },
];

/** One rostered week, inside the current month so the picker opens on it. */
const ROSTER_WEEK = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'];

/**
 * The 24th leave request — a SECOND casual-leave day for S7-01, so that
 * approving it moves a balance that already exists rather than creating one.
 * Named as a constant because the string is the idempotence key AND the thing
 * the balance assertions look up; two spellings of it is how a re-run creates
 * a 25th request and then fails its own count.
 */
const MOVER = 'S7 leave 24 — the one that moves the balance';

const OPENINGS = [
  'Audit Associate (S7)',
  'Tax Associate (S7)',
  'Advisory Analyst (S7)',
  'Compliance Executive (S7)',
  'Accounts Assistant (S7)',
];

/**
 * Eighteen candidates. NO EMAIL ADDRESS on any of them, and that is deliberate:
 * `POST /candidates/{id}/hire` copies the candidate's email straight onto the
 * personnel row it creates (`routers/manav.py:4527`), which would re-arm every
 * one of the five senders listed in the header. See §"WHY NOT ONE EMPLOYEE …".
 */
const CANDIDATES = [
  'Bhavin Chokshi', 'Nidhi Sompura', 'Ravi Zala', 'Palak Trivedi', 'Sahil Mansuri',
  'Urvi Nanavati', 'Chirag Bhoi', 'Foram Panchal', 'Dev Acharya', 'Mitali Doshi',
  'Arjun Rana', 'Heli Sanghvi', 'Tejas Limbachiya', 'Shreya Vora', 'Naman Bhagat',
  'Kinjal Mistry', 'Aryan Padhiyar', 'Vidhi Contractor',
];

const ASSET_CATS = ['laptop', 'phone', 'tablet', 'vehicle', 'furniture', 'other'];

/* ══════════════════════════════════════════════════════════════════════════
   07.1 — EVERY SCREEN, BEFORE ITS DATA EXISTS
   ══════════════════════════════════════════════════════════════════════════ */

test.describe('Suite 07 — Manav · Unicode Group', () => {
  /**
   * ⚠ A WIDER VIEWPORT, AND IT IS A MEASUREMENT RATHER THAN A PREFERENCE.
   *
   * Manav declares TWENTY tabs. `ModuleTabs` does not use a fixed inline count:
   * a `ResizeObserver` measures the strip, divides by the AVERAGE rendered tab
   * width and re-derives how many fit, capped at eight. At the 1280px default
   * that division lands on the boundary and the strip OSCILLATES between seven
   * and eight inline tabs — and the eighth is `recruitment`. Measured on
   * staging: `$$eval('[id^="mt-tab-"]')` listed `mt-tab-recruitment` while
   * `locator('#mt-tab-recruitment').count()` answered 0 a moment later, and the
   * More menu listed twelve rows with `recruitment` in neither place, because
   * the two halves were read in different renders.
   *
   * That is a real thing about the product and it is reported rather than
   * silently absorbed — but a suite that has to open twenty tabs several
   * hundred times cannot ride a boundary condition. 1680px puts the division
   * well clear of the cap, so `fits` pins at eight and stays there.
   */
  test.use({ viewport: { width: 1680, height: 1000 } });

  test('07.1 every screen says in words that it is empty, and the console is clean', async ({ page }) => {
    const con = watchConsole(page);
    await signIn(page);

    /**
     * ⚠ THIS TEST IS ONLY MEANINGFUL BEFORE THE REST OF THE SUITE RUNS, and on
     * a re-run it will not be. That is not a defect to route around with a
     * relaxed assertion: it is what an empty-state test IS. So the emptiness of
     * each screen is checked against the SERVER first, and the sentence is
     * asserted only where the server agrees the table is empty. A screen that
     * has data on the second run is asserted the other way — the empty sentence
     * must be ABSENT — which is a real assertion rather than a skip.
     */
    const screens: Array<{ tab: string; path: string; title: RegExp }> = [
      { tab: 'employees',     path: '/api/v1/manav/employees',      title: /No employees yet/i },
      { tab: 'leaves',        path: '/api/v1/manav/leaves',         title: /No leave requests/i },
      { tab: 'expenses',      path: '/api/v1/manav/expense-claims', title: /No expense claims/i },
      { tab: 'announcements', path: '/api/v1/manav/announcements',  title: /No announcements/i },
      { tab: 'departments',   path: '/api/v1/manav/departments',    title: /No departments yet/i },
      { tab: 'holidays',      path: '/api/v1/manav/holidays',       title: /No holidays configured/i },
      { tab: 'assets',        path: '/api/v1/manav/assets',         title: /No assets yet/i },
      { tab: 'exits',         path: '/api/v1/manav/offboarding',    title: /Nobody is leaving/i },
      { tab: 'custody',       path: '/api/v1/manav/offboarding',    title: /Nobody is leaving/i },
      { tab: 'recruitment',   path: '/api/v1/manav/job-openings',   title: /No job openings yet/i },
      { tab: 'bonus',         path: '/api/v1/manav/bonus-awards',   title: /no bonus awarded/i },
      { tab: 'dsc',           path: '/api/v1/custody/dsc',          title: /No signing tokens recorded/i },
      { tab: 'notices',       path: '/api/v1/custody/notices',      title: /notice/i },
    ];

    const report: string[] = [];
    for (const s of screens) {
      const before = await rowsOf(page, s.path);
      await manav(page, s.tab);
      if (before.length === 0) {
        await expect(
          emptyTitle(page).filter({ hasText: s.title }),
          `${s.tab}: GET ${s.path} answered 0 rows, so the screen must SAY it is empty ` +
          `and it did not. A failed fetch rendering as an empty state is the defect this ` +
          `whole module was rebuilt around — see manav/_shared.jsx.`,
        ).toBeVisible({ timeout: 30_000 });
        report.push(`${s.tab}: 0 rows → empty state shown in words ✔`);
      } else {
        await expect(
          emptyTitle(page).filter({ hasText: s.title }),
          `${s.tab}: GET ${s.path} answered ${before.length} rows and the screen still ` +
          `shows the empty state. That is the same fault pointed the other way.`,
        ).toHaveCount(0);
        report.push(`${s.tab}: ${before.length} rows already → empty state correctly ABSENT ✔`);
      }
    }

    // The remaining screens carry their emptiness differently — a count line, a
    // note, or a derived table. Visited so all of §10's surfaces are opened at
    // least once, and asserted on what each actually renders.
    await manav(page, 'shifts');
    for (const v of ['definitions', 'schedules', 'bids', 'swaps'] as const) {
      await shiftView(page, v);
      report.push(`shifts/${v}: opened`);
    }
    // ⚠ TWO-BRANCH, like every other screen above, and it was NOT on the first
    // draft — it asserted "No pending swaps" unconditionally and went red on
    // the second run against the four swaps 07.5b had correctly created. An
    // empty-state assertion that cannot survive its own suite creating data is
    // a test that only works once.
    const swapsNow = await rowsOf(page, '/api/v1/manav/swaps?status=pending');
    if (swapsNow.length === 0) {
      await expect(emptyTitle(page).filter({ hasText: /No pending swaps/i }),
        'the swaps view holds no rows and must say so in words').toBeVisible({ timeout: 20_000 });
    } else {
      await expect(emptyTitle(page).filter({ hasText: /No pending swaps/i }),
        `${swapsNow.length} swaps are pending and the screen still shows the empty state`)
        .toHaveCount(0);
    }

    await manav(page, 'attendance');
    await manav(page, 'performance');
    await manav(page, 'commission');
    await manav(page, 'udin');
    await manav(page, 'logins');
    await manav(page, 'analytics');

    console.log('\n[07.1] ' + report.join('\n[07.1] ') + '\n');

    expect(con.uncaught, `UNCAUGHT page errors while walking every Manav screen:\n${con.uncaught.join('\n')}`)
      .toEqual([]);
    expect(con.errors, `console.error while walking every Manav screen:\n${con.errors.join('\n')}`)
      .toEqual([]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     07.2 — DEPARTMENTS AND THE PERSONNEL REGISTER
     ════════════════════════════════════════════════════════════════════════ */

  test('07.2 six departments and twenty-eight people, each typed into the form', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);

    // ── Departments ────────────────────────────────────────────────────────
    await manav(page, 'departments');
    let have = (await rowsOf(page, '/api/v1/manav/departments')).map((d) => String(d.name));
    for (const name of DEPARTMENTS) {
      if (have.includes(name)) continue;
      await page.getByRole('button', { name: '+ Add department', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await type(form, 'Department name *', name);
      await writes(page, /\/manav\/departments/, async () => {
        await form.getByRole('button', { name: 'Create', exact: true }).click();
      });
      await expect(toastTitle(page, /Department created/i)).toBeVisible({ timeout: 20_000 });
    }
    have = (await rowsOf(page, '/api/v1/manav/departments')).map((d) => String(d.name));
    for (const name of DEPARTMENTS) {
      expect(have, `the department "${name}" is not in GET /manav/departments${dump(wire)}`).toContain(name);
    }
    // ...and the customer sees them. A count before the loop, per suite rule:
    // a `for` over an empty list passes forever.
    const cards = page.locator('#mt-panel-departments .mn-card__t');
    await expect(cards).not.toHaveCount(0, { timeout: 20_000 });

    // ── The register ───────────────────────────────────────────────────────
    await manav(page, 'employees');
    /* ⚠ THE DIRECTORY IS NOT THE REGISTER OF CODES, AND THAT COST A 500.
       `GET /employees` applies `still_on_the_rolls()` and DELIBERATELY hides
       anybody whose last working day has passed — correct, and pinned by its
       own test. But an employee CODE stays taken by a leaver: the unique index
       carries no `is_active` and no on-the-rolls condition.
       So this skip oracle went blind to four of §4's own people the moment 07.8
       offboarded them, re-typed S7-03, and the POST answered 500 with no CORS
       headers — which the browser reports as `net::ERR_FAILED`, which is why the
       failure read as a network timeout rather than as a duplicate.
       The offboarding register is the other half of the roll, and it is a door
       the product already offers. */
    const existing = await rowsOf(page, '/api/v1/manav/employees');
    const leavers = await rowsOf(page, '/api/v1/manav/offboarding');
    const leaverIds = new Set(leavers.map((r) => String(r.employee_id)));
    const held = new Map(existing.map((e) => [String(e.employee_code || ''), e]));
    // A leaver's row is not in the directory, so its code has to be recovered
    // from the exit rows themselves where the endpoint carries it.
    for (const r of leavers) {
      const code = String(r.employee_code || '');
      if (code) held.set(code, r);
    }
    const byCode = held;
    console.log(
      `
  07.2 codes already taken: ${byCode.size} `
      + `(${existing.length} on the rolls, ${leaverIds.size} with an exit)
`,
    );

    let typed = 0;
    for (const emp of EMPLOYEES) {
      if (byCode.has(emp.code)) continue;

      await page.getByRole('button', { name: '+ Add employee', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await expect(form.getByRole('heading', { name: 'New employee' })).toBeVisible({ timeout: 20_000 });

      await type(form, 'Name *', emp.name);
      await type(form, 'Employee code', emp.code);
      // ⚠ EMAIL LEFT BLANK ON PURPOSE. See the header — five separate Manav
      // paths mail this address and staging's outbound_mode is `live`.
      await type(form, 'Department', emp.dept);
      await type(form, 'Designation', emp.desig);

      // WORK STATE AT CREATE. Professional tax is a state levy and this column
      // is the only record of which state a person works in — the PT brief
      // carries "Nothing records which state each employee works in" as a
      // permanent limitation, and this field is that record.
      await choose(form, 'Work state', STATE_NAME[emp.state]);

      await choose(form, 'Employment type', emp.type.replace(/_/g, ' '));
      await setDate(form, 'Date of joining', emp.join);

      // The home address. `manav_employees.address` is jsonb, the API has
      // always accepted it, and until 8.0 there was no input at all — all 83
      // live rows were `{}`. Typed here so the column carries something.
      await type(form, 'Address line 1', `${11 + (typed % 40)}, Unicode House`);
      await type(form, 'City', 'Ahmedabad');
      await type(form, 'State', STATE_NAME[emp.state]);
      await type(form, 'Pincode', '380015');

      // PAN and Aadhaar are left blank for everybody. 07.2b asserts separately
      // that blank is legal; here the point is that 28 hires do not need them.
      const res = await writes(page, /\/manav\/employees$/, async () => {
        await form.getByRole('button', { name: 'Add employee', exact: true }).click();
      });
      // The product must NOT report an invitation nobody asked for.
      expect(
        JSON.stringify(res.body),
        `${emp.code} was created with the login box unticked, so the response must carry ` +
        `no "invite" key at all — a login was neither asked for nor wanted, and an ` +
        `invitation here would be a real email to a real inbox.`,
      ).not.toMatch(/"invite"/);
      await expect(toastTitle(page, /^Employee added$/)).toBeVisible({ timeout: 20_000 });
      typed += 1;
    }

    // ── The evidence: the rows, and then the screen ────────────────────────
    const after = await rowsOf(page, '/api/v1/manav/employees');
    const codes = new Set(after.map((e) => String(e.employee_code || '')));
    /* The same correction as the skip oracle above, for the same reason: a
       person §4 asked for who has since LEFT is not missing from the register,
       they are correctly absent from the directory. Asserting against the
       filtered list alone would go a little redder every time somebody
       resigns, and would blame the product for its own rule. */
    for (const r of await rowsOf(page, '/api/v1/manav/offboarding')) {
      const c = String(r.employee_code || '');
      if (c) codes.add(c);
    }
    const missing = EMPLOYEES.filter((e) => !codes.has(e.code)).map((e) => e.code);
    expect(missing, `these codes are on neither the roll nor the exit register${dump(wire)}`)
      .toEqual([]);

    // The state went in as a CODE and must come back as one — the select can
    // only send what is in its list, and the list sends the canonical numeric
    // form the PT join needs.
    for (const emp of EMPLOYEES) {
      const row = after.find((r) => String(r.employee_code) === emp.code);
      // A leaver is off the directory by design; their state is not readable
      // here and is not this test's subject.
      if (!row) continue;
      expect(String(row.state ?? ''), `${emp.code} lost its work state`).toBe(emp.state);
    }

    // On screen: the Login column says "no login" for every one of them, which
    // is the state the whole product is currently in and the thing 07.12 moves.
    await page.reload();
    await manav(page, 'employees');
    const rows = page.locator('#mt-panel-employees table.tbl tbody tr');
    await expect(rows).not.toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('#mt-panel-employees .mn-nolink').first(),
      'the directory does not state how many of the people shown have no login').toBeVisible();

    console.log(`\n[07.2] typed ${typed} new employees this run; ` +
      `${after.length} on the register; ${DEPARTMENTS.length} departments\n`);

    expect(con.uncaught, `UNCAUGHT page errors:\n${con.uncaught.join('\n')}`).toEqual([]);
  });

  test('07.2b PAN and Aadhaar are non-mandatory and block nothing', async ({ page }) => {
    const wire = watchWire(page);
    await signIn(page);
    await manav(page, 'employees');

    /**
     * The standing rule is GSTIN / PAN / TAN, and it has drifted back more than
     * once. On a PERSONNEL form the two that carry it are PAN and Aadhaar, and
     * they are the two `services/statutory_ids.py` is entitled to refuse when
     * they are MALFORMED — which is a different thing from refusing them when
     * they are ABSENT.
     *
     * This asserts the absent case only, and it asserts it on the LAST person
     * on the roster so a re-run verifies rather than duplicating.
     */
    const target = EMPLOYEES[EMPLOYEES.length - 1];
    const already = (await rowsOf(page, '/api/v1/manav/employees'))
      .find((e) => String(e.employee_code) === target.code);
    expect(already, `${target.code} must exist before this test — 07.2 creates it${dump(wire)}`).toBeTruthy();
    expect(
      String(already.pan ?? ''),
      `${target.code} was saved with PAN blank and the register must have kept it blank`,
    ).toBe('');

    // And the form still offers both fields, empty, without marking them required.
    await page.getByRole('button', { name: '+ Add employee', exact: true }).click();
    const form = page.locator('form.k-formpanel');
    const pan = field(form, 'PAN').locator('input').first();
    const aadhaar = field(form, 'Aadhaar').locator('input').first();
    await expect(pan).toBeVisible();
    await expect(aadhaar).toBeVisible();
    expect(await pan.getAttribute('required'),
      'PAN is marked required on the employee form — GSTIN/PAN/TAN must block nothing').toBeNull();
    expect(await aadhaar.getAttribute('required'),
      'Aadhaar is marked required on the employee form — it must block nothing').toBeNull();
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  /* ════════════════════════════════════════════════════════════════════════
     07.3 — LEAVE: TYPES, REQUESTS, DECISIONS, AND A BALANCE THAT MOVES
     ════════════════════════════════════════════════════════════════════════ */

  test('07.3 leave types, twenty-four requests, and the balance MOVES on approval', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const wire = watchWire(page);
    await signIn(page);
    await manav(page, 'leaves');

    // ── Types ──────────────────────────────────────────────────────────────
    let types = await rowsOf(page, '/api/v1/manav/leave-types');
    for (const t of LEAVE_TYPES) {
      if (types.some((x) => String(x.code) === t.code)) continue;
      await page.getByRole('button', { name: '+ Leave type', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await expect(form.getByRole('heading', { name: 'New leave type' })).toBeVisible({ timeout: 20_000 });
      await type(form, 'Name *', t.name);
      await type(form, 'Code *', t.code);
      await type(form, 'Annual quota', String(t.quota));
      await tick(form, 'Paid leave', t.paid);
      await tick(form, 'Carries forward', t.carry);
      await writes(page, /\/manav\/leave-types/, async () => {
        await form.getByRole('button', { name: 'Create', exact: true }).click();
      });
      await expect(toastTitle(page, /Leave type created/i)).toBeVisible({ timeout: 20_000 });
    }
    types = await rowsOf(page, '/api/v1/manav/leave-types');
    for (const t of LEAVE_TYPES) {
      const row = types.find((x) => String(x.code) === t.code);
      expect(row, `leave type ${t.code} is not in GET /manav/leave-types${dump(wire)}`).toBeTruthy();
      // 182 days is 26 weeks — the Maternity Benefit (Amendment) Act 2017
      // entitlement. A round 180 here would be green and wrong.
      expect(Number(row.annual_quota), `${t.code} did not keep its annual quota`).toBe(t.quota);
    }

    // ── Requests ───────────────────────────────────────────────────────────
    //
    // 24 requests. Employee S7-01 deliberately receives TWO against the same
    // leave type, because the balance-movement assertion needs a second
    // approval against a row that already exists — the first approval CREATES
    // the balance, only the second one moves it.
    const staff = await rowsOf(page, '/api/v1/manav/employees');
    expect(staff.length, `07.2 must run first — the register is empty${dump(wire)}`).toBeGreaterThan(23);

    const plan: Array<{ code: string; type: string; from: string; to: string; days: number; reason: string }> = [];
    for (let i = 0; i < 23; i++) {
      const emp = EMPLOYEES[i];
      const t = LEAVE_TYPES[i % 6];
      const day = 3 + (i % 20);
      plan.push({
        code: emp.code, type: t.code,
        from: `2026-08-${String(day).padStart(2, '0')}`,
        to: `2026-08-${String(day + 1).padStart(2, '0')}`,
        days: 2,
        reason: `S7 leave ${i + 1}`,
      });
    }
    // The 24th: a SECOND casual-leave request for S7-01, one day, so approving
    // it moves an existing balance rather than creating one.
    plan.push({
      code: 'S7-01', type: 'S7CL', from: '2026-08-26', to: '2026-08-26', days: 1,
      reason: MOVER,
    });

    const existingReqs = await rowsOf(page, '/api/v1/manav/leaves');
    const seen = new Set(existingReqs.map((r) => String(r.reason || '')));

    for (const p of plan) {
      if (seen.has(p.reason)) continue;
      await manav(page, 'leaves');
      await page.getByRole('button', { name: '+ Request leave', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await expect(form.getByRole('heading', { name: 'Request leave' })).toBeVisible({ timeout: 20_000 });
      await choose(form, 'Employee *', `(${p.code})`);
      await choose(form, 'Leave type *', `(${p.type})`);
      await type(form, 'Days', String(p.days));
      await setDate(form, 'Start date *', p.from);
      await setDate(form, 'End date *', p.to);
      await type(form, 'Reason', p.reason);
      await writes(page, /\/manav\/leaves$/, async () => {
        await form.getByRole('button', { name: 'Submit', exact: true }).click();
      });
      await expect(toastTitle(page, /Leave request submitted/i)).toBeVisible({ timeout: 20_000 });
    }

    const all = await rowsOf(page, '/api/v1/manav/leaves');
    const mine = all.filter((r) => /^S7 leave /.test(String(r.reason || '')));
    expect(mine.length, `only ${mine.length} of the 24 planned requests exist${dump(wire)}`).toBe(24);

    /* ── THE BALANCE MOVES ────────────────────────────────────────────────
     *
     * §1 asks for the interaction, not the row: assert the number BEFORE and
     * AFTER the approval. The balance lives on the employee's own detail page
     * (`EmployeesTab.jsx` renders `res.data.leave_balances`), which is where a
     * customer reads it, so that is where it is read here — and the arithmetic
     * asserted is the screen's own: available = allocated + carried − used.
     */
    const s701 = staff.find((e) => String(e.employee_code) === 'S7-01');
    const cl = types.find((t) => String(t.code) === 'S7CL');
    const balanceOf = async () => {
      const detail = await orgGet(page, `/api/v1/manav/employees/${s701.id}`);
      const b = (detail.leave_balances || []).find((x: any) => String(x.leave_code) === 'S7CL');
      return b ? { allocated: Number(b.allocated), used: Number(b.used), carried: Number(b.carried_forward) } : null;
    };

    const first = mine.find((r) => r.reason === 'S7 leave 1');
    const second = mine.find((r) => r.reason === MOVER);
    expect(first && second, 'the two S7-01 casual-leave requests are not both present').toBeTruthy();
    expect(String(first.leave_type_code), 'request 1 is not against the casual-leave type').toBe('S7CL');

    /**
     * ⚠ AN ANCHORED MATCHER, and it is a test bug's fix. `hasText: 'S7 leave 1'`
     * is a SUBSTRING match, so it also selects "S7 leave 10" through
     * "S7 leave 19" and strict mode refuses the ambiguity — a failure that
     * reads exactly like "the leave request is not on screen". The negative
     * lookahead is what makes the number the whole number.
     */
    const cardFor = (reason: string) =>
      page.locator('#mt-panel-leaves article.mn-rec')
        .filter({ hasText: new RegExp(`${reEsc(reason)}(?![0-9])`) });

    const approveOnScreen = async (reason: string) => {
      await manav(page, 'leaves');
      const card = cardFor(reason);
      await expect(card, `no leave card on screen reading "${reason}"`).toHaveCount(1, { timeout: 30_000 });
      await writes(page, /\/manav\/leaves\/.+\/action/, async () => {
        await card.getByRole('button', { name: 'Approve', exact: true }).click();
      }, { methods: ['PATCH'] });
      await expect(toastTitle(page, /Leave approved/i)).toBeVisible({ timeout: 20_000 });
    };
    const rejectOnScreen = async (reason: string) => {
      await manav(page, 'leaves');
      const card = cardFor(reason);
      await expect(card, `no leave card on screen reading "${reason}"`).toHaveCount(1, { timeout: 30_000 });
      await writes(page, /\/manav\/leaves\/.+\/action/, async () => {
        await card.getByRole('button', { name: 'Reject', exact: true }).click();
      }, { methods: ['PATCH'] });
      await expect(toastTitle(page, /Leave rejected/i)).toBeVisible({ timeout: 20_000 });
    };

    const statusOf = async (reason: string) => {
      const rows = await rowsOf(page, '/api/v1/manav/leaves');
      return String(rows.find((r) => r.reason === reason)?.status || '');
    };

    // 14 approved. Requests 1..13 plus 24 — 24 is the one that moves S7-01's
    // existing balance, so it is approved LAST of the fourteen.
    const toApprove = [...Array(13)].map((_, i) => `S7 leave ${i + 1}`);
    const toReject = [...Array(6)].map((_, i) => `S7 leave ${14 + i}`);

    /**
     * ⚠ NOTHING BELOW IS A HARDCODED FIGURE, and that is §6 as much as §1.
     *
     * `action_leave_request` adds `int(lr["days"])` — the days on the row it
     * approved — so the expected number is READ OFF THE REQUESTS. Two reasons,
     * and the second one is the reason this test failed twice:
     *
     *   · A constant would be asserting the number this suite MEANT to type
     *     rather than the arithmetic the product actually performed.
     *   · A re-run has already approved everything, so a movement measured
     *     "before and after" would measure nothing. On a run where a request
     *     is genuinely pending, the MOVEMENT is driven and measured; on a run
     *     where it is not, the LEDGER IDENTITY is asserted instead — used must
     *     equal the sum of the days on every approved request for this pair.
     *     Both are real assertions and the log says which one ran.
     */
    const clRows = async () =>
      (await rowsOf(page, '/api/v1/manav/leaves')).filter(
        (r) => String(r.employee_code) === 'S7-01' && String(r.leave_type_code) === 'S7CL',
      );
    const ledgerUsed = (rows: any[]) =>
      rows.filter((r) => r.status === 'approved')
        .reduce((s, r) => s + Math.trunc(Number(r.days)), 0);

    const balBefore = await balanceOf();
    for (const reason of toApprove) {
      if ((await statusOf(reason)) === 'pending') await approveOnScreen(reason);
    }
    const balMid = await balanceOf();
    expect(balMid, 'approving S7-01\'s casual leave created no balance row at all').not.toBeNull();
    expect(
      balMid!.used,
      `S7-01's casual-leave "used" does not equal the days on the approved requests. ` +
      `Before: ${JSON.stringify(balBefore)}  After: ${JSON.stringify(balMid)}${dump(wire)}`,
    ).toBe(ledgerUsed(await clRows()));
    // `cl` is the SERVER's row, so the column is `annual_quota` — the local
    // constant's `quota` is this suite's own spelling and is not what came back.
    expect(balMid!.allocated, 'the new balance did not take the leave type\'s annual quota')
      .toBe(Number(cl.annual_quota));

    // The screen the customer reads, before the next decision.
    const readBalanceRow = async () => {
      await manav(page, 'employees');
      const row = page.locator('#mt-panel-employees table.tbl tbody tr').filter({ hasText: 'Aarav Trivedi' });
      await expect(row).toHaveCount(1, { timeout: 30_000 });
      await row.click();
      const t = page.locator('table.tbl').filter({ hasText: 'S7CL' });
      await expect(t, 'the employee detail shows no leave-balance table').toHaveCount(1, { timeout: 30_000 });
      return (await t.locator('tbody tr').filter({ hasText: 'S7CL' }).innerText()).replace(/\s+/g, ' ');
    };
    const shownBefore = await readBalanceRow();

    const moverStatus = await statusOf(MOVER);
    const secondDays = Math.trunc(Number(second.days));
    let movementDriven = false;

    if (moverStatus === 'pending') {
      await approveOnScreen(MOVER);
      movementDriven = true;
      const balAfter = await balanceOf();
      expect(
        balAfter!.used,
        `the second approval did not move S7-01's casual-leave "used". ` +
        `${balMid!.used} → ${balAfter!.used}, expected ${balMid!.used + secondDays}${dump(wire)}`,
      ).toBe(balMid!.used + secondDays);
      expect(
        (balAfter!.allocated + balAfter!.carried) - balAfter!.used,
        'available did not fall by the days that were approved',
      ).toBe((balMid!.allocated + balMid!.carried) - balMid!.used - secondDays);

      // The customer's own view of the same movement — the screen must change.
      const shownAfter = await readBalanceRow();
      expect(
        shownAfter,
        `the leave-balance row on S7-01's record reads exactly the same before and after an ` +
        `approval — "${shownBefore}". The server moved the number; the screen did not.`,
      ).not.toBe(shownBefore);
    } else {
      // Already decided on an earlier run. Verify rather than duplicate: the
      // stored balance must still equal the ledger it was built from, and the
      // screen must still be showing that figure rather than a stale one.
      const rows = await clRows();
      const balNow = await balanceOf();
      expect(
        balNow!.used,
        `S7-01's casual-leave balance has drifted away from the requests it was built from` +
        `${dump(wire)}`,
      ).toBe(ledgerUsed(rows));
      expect(
        shownBefore,
        'the leave-balance row on screen does not carry the "used" figure the server holds',
      ).toContain(String(balNow!.used));
    }

    // 6 rejected.
    for (const reason of toReject) {
      if ((await statusOf(reason)) === 'pending') await rejectOnScreen(reason);
    }

    const final = (await rowsOf(page, '/api/v1/manav/leaves'))
      .filter((r) => /^S7 leave /.test(String(r.reason || '')));
    const count = (s: string) => final.filter((r) => r.status === s).length;
    expect(count('approved'), `approved requests${dump(wire)}`).toBe(14);
    expect(count('rejected'), `rejected requests${dump(wire)}`).toBe(6);

    /* ⚠ §4 ASKS FOR FOUR CANCELLED REQUESTS AND THERE IS NO CANCEL.
     *
     * `LeavesTab.jsx` renders exactly two controls on a pending request,
     * Approve and Reject, and `PATCH /leaves/{id}/action` answers 400 to
     * anything that is not 'approved' or 'rejected' (routers/manav.py:2911).
     * So the four are left PENDING and the absence is asserted rather than
     * worked around — a suite that quietly filed them as "rejected" would be
     * reporting a transition the product does not have.
     */
    expect(count('pending'), `the four requests §4 wanted cancelled are left pending${dump(wire)}`).toBe(4);
    expect(count('cancelled'), 'nothing may reach the cancelled state, because nothing can').toBe(0);
    await manav(page, 'leaves');
    const pendingCard = page.locator('#mt-panel-leaves article.mn-rec').filter({ hasText: 'S7 leave 21' });
    await expect(pendingCard).toHaveCount(1, { timeout: 30_000 });
    await expect(
      pendingCard.first().getByRole('button', { name: /cancel/i }),
      'FINDING, not a workaround: a pending leave request offers no Cancel control. ' +
      'If one has appeared, this assertion is the thing that is now wrong.',
    ).toHaveCount(0);

    // Balances: the ceiling is the number of DISTINCT (employee, type) pairs
    // that were approved, because approval is the only thing that creates one.
    // ⚠ BY CODE, not by id. `GET /manav/leaves` answers `employee_code` and
    // `leave_type_code` and does NOT carry `employee_id`/`leave_type_id`, so
    // keying on those built "undefined:undefined" for every row and reported a
    // set of ONE. A count derived from a field that is not there is the same
    // vacuous shape as a loop that runs zero times.
    const pairs = new Set(
      final.filter((r) => r.status === 'approved')
        .map((r) => `${r.employee_code}:${r.leave_type_code}`),
    );
    expect([...pairs].every((k) => !/undefined/.test(k)),
      `the approved requests carry no employee/leave-type code: ${[...pairs].slice(0, 3).join(', ')}`)
      .toBeTruthy();
    console.log(`\n[07.3] 24 requests · 14 approved · 6 rejected · 4 pending (no cancel exists)` +
      `\n[07.3] balance rows reachable = ${pairs.size} distinct (employee, leave type) approvals` +
      `\n[07.3] balance movement was ${movementDriven ? 'DRIVEN and measured across a live approval'
        : 'VERIFIED from the ledger — every request was already decided on an earlier run'}\n`);
  });

  /* ════════════════════════════════════════════════════════════════════════
     07.4 — HOLIDAYS
     ════════════════════════════════════════════════════════════════════════ */

  test('07.4 fourteen holidays — twelve country-wide, two Gujarat', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const wire = watchWire(page);
    await signIn(page);
    await manav(page, 'holidays');

    const have = new Set((await rowsOf(page, '/api/v1/manav/holidays')).map((h) => String(h.name)));
    for (const h of HOLIDAYS) {
      if (have.has(h.name)) continue;
      await page.getByRole('button', { name: '+ Add holiday', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await type(form, 'Name *', h.name);
      await setDate(form, 'Date *', h.date);
      if (h.state) await choose(form, 'Applies to', h.state);
      await tick(form, 'Optional holiday', h.optional);
      await writes(page, /\/manav\/holidays/, async () => {
        await form.getByRole('button', { name: 'Add holiday', exact: true }).click();
      });
      await expect(toastTitle(page, /Holiday added/i)).toBeVisible({ timeout: 20_000 });
    }

    const rows = await rowsOf(page, '/api/v1/manav/holidays');
    const mine = rows.filter((h) => /\(S7\)$/.test(String(h.name)));
    expect(mine.length, `only ${mine.length} of the 14 holidays exist${dump(wire)}`).toBe(14);
    const stateBound = mine.filter((h) => String(h.state_code || ''));
    expect(stateBound.length, `${stateBound.length} holidays carry a state code, expected 2${dump(wire)}`).toBe(2);
    for (const h of stateBound) {
      expect(String(h.state_code), 'a Gujarat holiday must carry GST state code 24').toBe('24');
    }

    // On screen the CODE must never be what a person reads — "27" is a calendar
    // nobody can read. `HolidaysTab.jsx` renders the state NAME, and this is the
    // runtime half of the names-not-ids rule.
    await page.reload();
    await manav(page, 'holidays');
    const table = page.locator('#mt-panel-holidays table.tbl');
    await expect(table.locator('tbody tr')).not.toHaveCount(0, { timeout: 30_000 });
    const uttarayan = table.locator('tbody tr').filter({ hasText: 'Uttarayan (S7)' }).first();
    await expect(uttarayan).toBeVisible();
    await expect(uttarayan, 'a state-specific holiday must name the state, never the GST code')
      .toContainText('Gujarat');
    const republic = table.locator('tbody tr').filter({ hasText: 'Republic Day (S7)' }).first();
    await expect(republic).toContainText('Whole country');
    await expect(republic).toContainText('Mandatory');

    console.log(`\n[07.4] ${mine.length} holidays · ${stateBound.length} state-specific (Gujarat, code 24)\n`);
  });

  /* ════════════════════════════════════════════════════════════════════════
     ⚠ THE FILE ORDER IS NOT THE NUMBER ORDER, AND IT IS DELIBERATE.

     Playwright runs the tests in a file in DECLARATION order, and this file
     is `mode: 'serial'`. §4's roster is 30 people × 5 days = 150 cells, and
     two of those thirty arrive as HIRES from the recruitment pipeline — the
     28 typed into the employee form are only 28. Rostering before hiring
     produces 140 cells and reports it as a shortfall that is really an
     ordering mistake, which is exactly what happened on the first run.

     So 07.7 is declared here, before 07.5 and 07.6. The numbers keep the
     order §4 lists the volumes in; the file keeps the order the data needs.
     ════════════════════════════════════════════════════════════════════════ */

  /* ════════════════════════════════════════════════════════════════════════
     07.7 — RECRUITMENT, AND THE HIRE THAT BECOMES AN EMPLOYEE
     ════════════════════════════════════════════════════════════════════════ */

  test('07.7 five openings, eighteen candidates, and two hires that become employees', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const wire = watchWire(page);
    await signIn(page);
    await manav(page, 'recruitment');

    // ── Openings ───────────────────────────────────────────────────────────
    let openings = await rowsOf(page, '/api/v1/manav/job-openings');
    for (const title of OPENINGS) {
      if (openings.some((o) => String(o.title) === title)) continue;
      await page.getByRole('button', { name: '+ Job opening', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await expect(form.getByRole('heading', { name: 'New job opening' })).toBeVisible({ timeout: 20_000 });
      await type(form, 'Title *', title);
      await type(form, 'Description', `Recorded by Suite 07 — ${title}`);
      await writes(page, /\/manav\/job-openings$/, async () => {
        await form.getByRole('button', { name: 'Create', exact: true }).click();
      });
      await expect(toastTitle(page, /Job opening created/i)).toBeVisible({ timeout: 20_000 });
      openings = await rowsOf(page, '/api/v1/manav/job-openings');
    }
    openings = await rowsOf(page, '/api/v1/manav/job-openings');
    const mineOpen = openings.filter((o) => OPENINGS.includes(String(o.title)));
    expect(mineOpen.length, `${mineOpen.length} of the 5 openings exist${dump(wire)}`).toBe(5);

    // ── Candidates ─────────────────────────────────────────────────────────
    //
    // NO EMAIL ADDRESS, deliberately — `hire` copies it onto the personnel row.
    // See the note on CANDIDATES.
    const allCands = await rowsOf(page, '/api/v1/manav/candidates');
    const haveCand = new Set(allCands.map((c) => String(c.full_name)));
    for (let i = 0; i < CANDIDATES.length; i++) {
      const name = CANDIDATES[i];
      if (haveCand.has(name)) continue;
      const opening = mineOpen[i % mineOpen.length];
      await manav(page, 'recruitment');
      await choose(page.locator('#mt-panel-recruitment .mn-bar'), 'Opening', String(opening.title));
      await page.getByRole('button', { name: '+ Candidate', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await expect(form.getByRole('heading', { name: 'Add candidate' })).toBeVisible({ timeout: 20_000 });
      await type(form, 'Full name *', name);
      await type(form, 'Phone', `98250${String(10000 + i).slice(-5)}`);
      await writes(page, /\/manav\/candidates$/, async () => {
        await form.getByRole('button', { name: 'Add', exact: true }).click();
      });
      await expect(toastTitle(page, /Candidate added/i)).toBeVisible({ timeout: 20_000 });
    }

    const cands = await rowsOf(page, '/api/v1/manav/candidates');
    const mineCands = cands.filter((c) => CANDIDATES.includes(String(c.full_name)));
    expect(mineCands.length, `${mineCands.length} of the 18 candidates exist${dump(wire)}`).toBe(18);

    // ── Two hires ──────────────────────────────────────────────────────────
    //
    // A hire is only offered from the `offer` stage, so the two are walked
    // through the pipeline by the real chips first. The proof is not the stage
    // flip: it is that the personnel register gains a row.
    const empsBefore = await rowsOf(page, '/api/v1/manav/employees');
    const toHire = [CANDIDATES[0], CANDIDATES[1]];
    // How many conversions THIS run performs. §6 idempotence: a second run
    // recognises what the first did rather than repeating it, so the delta the
    // register may show is this number and not §4's two.
    let hiredNow = 0;

    for (const name of toHire) {
      const c = (await rowsOf(page, '/api/v1/manav/candidates')).find((x) => String(x.full_name) === name);
      if (String(c.stage) === 'hired' || c.converted_employee_id) continue;
      hiredNow += 1;

      const opening = mineOpen.find((o) => String(o.id) === String(c.job_opening_id)) || mineOpen[0];
      await manav(page, 'recruitment');
      await choose(page.locator('#mt-panel-recruitment .mn-bar'), 'Opening', String(opening.title));

      const cardFor = () => page.locator('#mt-panel-recruitment article.mn-cand').filter({ hasText: name });
      await expect(cardFor(), `no candidate card for ${name}`).toHaveCount(1, { timeout: 30_000 });

      // applied → screening → interview → offer, through the real chips.
      for (const stage of ['screening', 'interview', 'offer']) {
        const current = (await rowsOf(page, '/api/v1/manav/candidates'))
          .find((x) => String(x.full_name) === name);
        if (String(current.stage) === stage) continue;
        await writes(page, /\/manav\/candidates\/.+\/stage/, async () => {
          await cardFor().getByRole('button', { name: stage, exact: true }).click();
        }, { methods: ['PATCH'] });
        await expect(toastTitle(page, new RegExp(`Moved to ${stage}`, 'i'))).toBeVisible({ timeout: 20_000 });
      }

      // Hire is confirmed, because it writes into the personnel directory.
      await cardFor().getByRole('button', { name: 'Hire', exact: true }).click();
      // ⚠ `alertdialog`, not `dialog`. `ui/ConfirmDialog.jsx:102` uses the
      // alert role deliberately — this is a confirmation, not a form — and
      // `getByRole('dialog')` finds nothing at all.
      const dialog = page.getByRole('alertdialog');
      await expect(dialog, 'hiring must confirm — it creates a personnel record').toBeVisible({ timeout: 20_000 });
      await expect(dialog).toContainText(name);
      await writes(page, /\/manav\/candidates\/.+\/hire/, async () => {
        await dialog.getByRole('button', { name: 'Hire', exact: true }).click();
      });
      await expect(toastTitle(page, /employee record created/i)).toBeVisible({ timeout: 20_000 });
    }

    const empsAfter = await rowsOf(page, '/api/v1/manav/employees');
    for (const name of toHire) {
      const c = (await rowsOf(page, '/api/v1/manav/candidates')).find((x) => String(x.full_name) === name);
      expect(String(c.stage), `${name} is not at the hired stage${dump(wire)}`).toBe('hired');
      expect(c.converted_employee_id, `${name} carries no converted employee id${dump(wire)}`).toBeTruthy();
      expect(
        empsAfter.some((e) => String(e.name) === name),
        `${name} was hired and did NOT appear in the personnel register. The conversion ` +
        `is the whole point of the control${dump(wire)}`,
      ).toBeTruthy();
    }
    // ⚠ A GLOBAL CENSUS IS THE WRONG MARK, AND IT DRIFTS BY DESIGN. This
    // required the register to hold 30 people forever — 28 typed plus 2 hired —
    // but Suite 08 processes four AUGUST LEAVERS, and a leaver correctly stops
    // being on the roster. The floor then fails for a reason that has nothing
    // to do with hiring, and the failure message blames 07.2.
    //
    // The property this test owns is the DELTA it just made: the two hires
    // appeared. That is asserted above, by name, for each of them — so this
    // line adds nothing except a dependency on every other suite's side
    // effects. It is replaced by the delta, which is what "the conversion is
    // the whole point of the control" actually means.
    /* ⚠ THE DELTA IS OF WHAT THIS RUN ACTUALLY DID, NOT OF §4's TARGET.
       This asserted the register grew by exactly two. On the FIRST run that is
       right; on every run after it, both candidates are already hired — the
       loop above skips them by design, `hire_candidate` refuses a second
       conversion outright, and the register correctly does not move. The
       assertion therefore demanded that a re-run duplicate two people, which is
       the one thing this product is careful not to let anybody do.
       `hiredNow` counts the conversions THIS run performed. Zero is a true and
       healthy answer; what must never happen is a conversion that reports
       success and adds nobody, and that is what this now says. */
    expect(
      empsAfter.length - empsBefore.length,
      `${hiredNow} hire(s) were performed by this run and the register went from `
      + `${empsBefore.length} to ${empsAfter.length}. A conversion must add exactly `
      + `the people it converted — no more, and never fewer${dump(wire)}`,
    ).toBe(hiredNow);

    // And the customer sees them where they now belong.
    await manav(page, 'employees');
    const hiredRow = page.locator('#mt-panel-employees table.tbl tbody tr').filter({ hasText: toHire[0] });
    await expect(hiredRow, `${toHire[0]} is not in the employee directory on screen`)
      .toHaveCount(1, { timeout: 30_000 });

    console.log(`\n[07.7] 5 openings · 18 candidates · 2 hires · register now ${empsAfter.length}\n`);
  });

  /* ════════════════════════════════════════════════════════════════════════
     07.5 — SHIFT DEFINITIONS AND THE ROSTER
     ════════════════════════════════════════════════════════════════════════ */

  test('07.5 five shifts defined, and one week rostered across the register', async ({ page }) => {
    test.setTimeout(45 * 60_000);
    const wire = watchWire(page);
    await signIn(page);
    await manav(page, 'shifts');
    await shiftView(page, 'definitions');

    // ── Definitions ────────────────────────────────────────────────────────
    const haveShifts = new Set((await rowsOf(page, '/api/v1/manav/shifts')).map((s) => String(s.name)));
    for (const s of SHIFTS) {
      if (haveShifts.has(s.name)) continue;
      await page.getByRole('button', { name: '+ Add shift', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await expect(form.getByRole('heading', { name: 'New shift' })).toBeVisible({ timeout: 20_000 });
      await type(form, 'Name *', s.name);
      await setTime(form, 'Start time *', s.start);
      await setTime(form, 'End time *', s.end);
      await type(form, 'Break (minutes)', String(s.brk));
      await writes(page, /\/manav\/shifts$/, async () => {
        await form.getByRole('button', { name: 'Create shift', exact: true }).click();
      });
      await expect(toastTitle(page, /Shift created/i)).toBeVisible({ timeout: 20_000 });
    }
    const shifts = await rowsOf(page, '/api/v1/manav/shifts');
    for (const s of SHIFTS) {
      const row = shifts.find((x) => String(x.name) === s.name);
      expect(row, `shift "${s.name}" is not in GET /manav/shifts${dump(wire)}`).toBeTruthy();
      expect(String(row.start_time).slice(0, 5), `${s.name} did not keep its start time`).toBe(s.start);
      expect(String(row.end_time).slice(0, 5), `${s.name} did not keep its end time`).toBe(s.end);
    }

    // ── The roster: 30 people × 5 days ─────────────────────────────────────
    //
    // Idempotent per cell. `POST /schedules` is `ON CONFLICT (employee_id,
    // date) DO UPDATE`, so a repeat is harmless — but the run is also read
    // first and skipped, because 150 pointless writes is 150 pointless writes.
    const staff = (await rowsOf(page, '/api/v1/manav/employees'))
      .filter((e) => /^S7-/.test(String(e.employee_code || '')) || CANDIDATES.includes(String(e.name)));
    // ⚠ 27 ASSUMED NOBODY EVER LEAVES. Suite 08 processes four August leavers
    // and a leaver correctly drops off the roster, so this floor fails for a
    // reason unrelated to rostering and points the reader at 07.2, which is
    // fine. The roster needs ENOUGH people to cover the shifts it defines, and
    // that number is the one worth asserting.
    expect(staff.length,
      `only ${staff.length} people on the register — 07.2 must run first, and the ` +
      `roster below needs at least ${SHIFTS.length} to cover its shifts${dump(wire)}`)
      .toBeGreaterThanOrEqual(SHIFTS.length);

    const want = staff.slice(0, 30);
    const from = ROSTER_WEEK[0];
    const to = ROSTER_WEEK[ROSTER_WEEK.length - 1];
    const already = new Set(
      (await rowsOf(page, `/api/v1/manav/schedules?date_from=${from}&date_to=${to}`))
        .map((s) => `${s.employee_id}:${String(s.date).slice(0, 10)}`),
    );

    await shiftView(page, 'schedules');
    let placed = 0;
    for (let d = 0; d < ROSTER_WEEK.length; d++) {
      const date = ROSTER_WEEK[d];
      for (let i = 0; i < want.length; i++) {
        const emp = want[i];
        if (already.has(`${emp.id}:${date}`)) continue;
        const shift = SHIFTS[(i + d) % SHIFTS.length];

        await page.getByRole('button', { name: '+ Assign shift', exact: true }).click();
        const form = page.locator('form.k-formpanel');
        await expect(form.getByRole('heading', { name: 'Assign shift' })).toBeVisible({ timeout: 20_000 });
        await choose(form, 'Employee *', String(emp.name));
        await choose(form, 'Shift *', shift.name);
        await setDate(form, 'Date *', date);
        await writes(page, /\/manav\/schedules$/, async () => {
          await form.getByRole('button', { name: 'Assign', exact: true }).click();
        });
        placed += 1;
      }
    }

    const roster = await rowsOf(page, `/api/v1/manav/schedules?date_from=${from}&date_to=${to}`);
    expect(roster.length, `the rostered week holds ${roster.length} cells, expected 150${dump(wire)}`).toBe(150);

    // And a person can see it. Load the range and count what the table renders.
    await shiftView(page, 'schedules');
    await setDate(page.locator('#mn-shift-panel-schedules'), 'From', from);
    await setDate(page.locator('#mn-shift-panel-schedules'), 'To', to);
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    const grid = page.locator('#mn-shift-panel-schedules table.tbl tbody tr');
    await expect(grid).not.toHaveCount(0, { timeout: 45_000 });

    console.log(`\n[07.5] ${SHIFTS.length} shifts · ${placed} cells written this run · ${roster.length} rostered\n`);
  });

  test('07.5b six bids posted, and four swaps requested', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const wire = watchWire(page);
    await signIn(page);
    await manav(page, 'shifts');

    const shifts = await rowsOf(page, '/api/v1/manav/shifts');
    expect(shifts.length, `07.5 must run first${dump(wire)}`).toBeGreaterThan(4);

    // ── Bids ───────────────────────────────────────────────────────────────
    // Idempotence key: (shift, date). The form takes no free-text field, so
    // there is nothing to stamp — the pair IS the identity.
    const BIDS = [
      { shift: SHIFTS[0].name, date: '2026-08-24', slots: 2 },
      { shift: SHIFTS[1].name, date: '2026-08-25', slots: 1 },
      { shift: SHIFTS[2].name, date: '2026-08-26', slots: 3 },
      { shift: SHIFTS[3].name, date: '2026-08-27', slots: 1 },
      { shift: SHIFTS[4].name, date: '2026-08-28', slots: 2 },
      { shift: SHIFTS[0].name, date: '2026-08-31', slots: 1 },
    ];
    await shiftView(page, 'bids');
    const openBids = await rowsOf(page, '/api/v1/manav/shift-bids?status=open');
    const seenBid = new Set(openBids.map((b) => `${b.shift_name}:${String(b.date).slice(0, 10)}`));
    for (const b of BIDS) {
      if (seenBid.has(`${b.shift}:${b.date}`)) continue;
      await page.getByRole('button', { name: '+ Post bid', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await expect(form.getByRole('heading', { name: 'New shift bid' })).toBeVisible({ timeout: 20_000 });
      await choose(form, 'Shift *', b.shift);
      await setDate(form, 'Date *', b.date);
      await type(form, 'Slots needed *', String(b.slots));
      await writes(page, /\/manav\/shift-bids$/, async () => {
        await form.getByRole('button', { name: 'Post bid', exact: true }).click();
      });
      await expect(toastTitle(page, /Bid posted/i)).toBeVisible({ timeout: 20_000 });
    }
    const bids = await rowsOf(page, '/api/v1/manav/shift-bids?status=open');
    expect(bids.length, `${bids.length} open bids, expected at least 6${dump(wire)}`).toBeGreaterThanOrEqual(6);

    // The applicants panel — the half that was unreachable until
    // `GET /shift-bids/{id}/responses` existed. Opened, and asserted on what it
    // actually says when nobody has applied.
    await shiftView(page, 'bids');
    const card = page.locator('#mn-shift-panel-bids .mn-card').first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole('button', { name: 'See applicants', exact: true }).click();
    const panel = card.locator('.mn-bid__panel');
    await expect(panel, 'the applicants panel did not open').toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText(/slot/i);

    // ── Swaps ──────────────────────────────────────────────────────────────
    const from = ROSTER_WEEK[0];
    const to = ROSTER_WEEK[ROSTER_WEEK.length - 1];
    const roster = await rowsOf(page, `/api/v1/manav/schedules?date_from=${from}&date_to=${to}`);
    expect(roster.length, `07.5 must run first — nothing is rostered${dump(wire)}`).toBeGreaterThan(9);

    await shiftView(page, 'swaps');
    const openSwaps = await rowsOf(page, '/api/v1/manav/swaps?status=pending');
    const SWAPS = [0, 1, 2, 3].map((i) => ({
      cell: roster[i],
      target: roster[roster.length - 1 - i],
      reason: `S7 swap ${i + 1}`,
    }));
    const seenSwap = new Set(openSwaps.map((s) => String(s.reason || '')));
    for (const s of SWAPS) {
      if (seenSwap.has(s.reason)) continue;
      await page.getByRole('button', { name: '+ Request swap', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await expect(form.getByRole('heading', { name: 'New swap request' })).toBeVisible({ timeout: 20_000 });
      // The picker shows `date · shift · employee`, so the roster row is
      // identified by the words on screen and never by its id.
      await choose(form, 'Your shift *', `${String(s.cell.date).slice(0, 10)} · ${s.cell.shift_name} · ${s.cell.employee_name}`);
      await choose(form, 'Swap with *', String(s.target.employee_name));
      await type(form, 'Reason', s.reason);
      await writes(page, /\/manav\/swaps$/, async () => {
        await form.getByRole('button', { name: 'Submit', exact: true }).click();
      });
      await expect(toastTitle(page, /Swap request created/i)).toBeVisible({ timeout: 20_000 });
    }
    const swaps = await rowsOf(page, '/api/v1/manav/swaps?status=pending');
    const mine = swaps.filter((s) => /^S7 swap /.test(String(s.reason || '')));
    expect(mine.length, `${mine.length} swaps, expected 4${dump(wire)}`).toBe(4);

    // On screen, named on both sides — never an id.
    await shiftView(page, 'swaps');
    const swapCards = page.locator('#mn-shift-panel-swaps .mn-card');
    await expect(swapCards).not.toHaveCount(0, { timeout: 30_000 });
    await expect(swapCards.first()).toContainText('wants to swap with');

    console.log(`\n[07.5b] ${bids.length} open bids · ${mine.length} pending swaps\n`);
  });

  /* ════════════════════════════════════════════════════════════════════════
     07.6 — ASSETS
     ════════════════════════════════════════════════════════════════════════ */

  test('07.6 twenty-four assets issued, eight of them returned', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const wire = watchWire(page);
    await signIn(page);
    await manav(page, 'assets');

    const staff = (await rowsOf(page, '/api/v1/manav/employees'))
      .filter((e) => /^S7-/.test(String(e.employee_code || '')));
    expect(staff.length, `07.2 must run first${dump(wire)}`).toBeGreaterThan(23);

    const TAGS = [...Array(24)].map((_, i) => `AST-S7-${String(i + 1).padStart(2, '0')}`);
    let have = await rowsOf(page, '/api/v1/manav/assets');
    let byTag = new Map(have.map((a) => [String(a.asset_tag), a]));

    for (let i = 0; i < TAGS.length; i++) {
      if (byTag.has(TAGS[i])) continue;
      await page.getByRole('button', { name: '+ New asset', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await expect(form.getByRole('heading', { name: 'New asset' })).toBeVisible({ timeout: 20_000 });
      await type(form, 'Asset tag *', TAGS[i]);
      await type(form, 'Name *', `${ASSET_CATS[i % ASSET_CATS.length]} ${i + 1} (S7)`);
      await choose(form, 'Category', ASSET_CATS[i % ASSET_CATS.length]);
      await type(form, 'Serial number', `SN-S7-${1000 + i}`);
      await setDate(form, 'Purchase date', '2026-08-03');
      await type(form, 'Purchase cost', String(15000 + i * 500));
      await choose(form, 'Condition', i % 4 === 0 ? 'new' : 'good');
      await writes(page, /\/manav\/assets$/, async () => {
        await form.getByRole('button', { name: 'Create asset', exact: true }).click();
      });
      await expect(toastTitle(page, /Asset created/i)).toBeVisible({ timeout: 20_000 });
    }

    have = await rowsOf(page, '/api/v1/manav/assets');
    byTag = new Map(have.map((a) => [String(a.asset_tag), a]));
    const absent = TAGS.filter((t) => !byTag.has(t));
    expect(absent, `these asset tags were not created${dump(wire)}`).toEqual([]);

    // ── Issue all 24 ───────────────────────────────────────────────────────
    await manav(page, 'assets');
    const table = page.locator('#mt-panel-assets table.tbl');
    await expect(table.locator('tbody tr')).not.toHaveCount(0, { timeout: 30_000 });

    for (let i = 0; i < TAGS.length; i++) {
      const tag = TAGS[i];
      if (byTag.get(tag)?.assigned_to) continue;
      const row = table.locator('tbody tr').filter({ hasText: tag }).first();
      await clickSettled(page, row.getByRole('button', { name: 'Assign', exact: true }),
        /\/manav\/assets/, `no Assign control on the row for ${tag}`);
      const picker = row.getByLabel(new RegExp(`^Assign .* to$`));
      await expect(picker, `the assign picker did not open on ${tag}`).toBeVisible({ timeout: 20_000 });
      await selectByText(picker, 'assignee', String(staff[i % staff.length].name));
      await writes(page, /\/manav\/assets\/.+\/assign/, async () => {
        await row.getByRole('button', { name: 'Assign', exact: true }).click();
      });
      await expect(toastTitle(page, /Asset assigned/i)).toBeVisible({ timeout: 20_000 });
    }

    have = await rowsOf(page, '/api/v1/manav/assets');
    const issued = have.filter((a) => TAGS.includes(String(a.asset_tag)) && a.assigned_to);
    expect(issued.length, `${issued.length} of the 24 assets are out with somebody${dump(wire)}`).toBe(24);

    // ── Return eight ───────────────────────────────────────────────────────
    for (const tag of TAGS.slice(0, 8)) {
      const current = (await rowsOf(page, '/api/v1/manav/assets')).find((a) => String(a.asset_tag) === tag);
      if (!current?.assigned_to) continue;
      await manav(page, 'assets');
      const row = page.locator('#mt-panel-assets table.tbl tbody tr').filter({ hasText: tag }).first();
      await writes(page, /\/manav\/assets\/.+\/return/, async () => {
        await clickSettled(page, row.getByRole('button', { name: 'Return', exact: true }),
          /\/manav\/assets/, `no Return control on the row for ${tag}`);
      });
      await expect(toastTitle(page, /Asset returned/i)).toBeVisible({ timeout: 20_000 });
    }

    have = await rowsOf(page, '/api/v1/manav/assets');
    const stillOut = have.filter((a) => TAGS.includes(String(a.asset_tag)) && a.assigned_to);
    const returned = 24 - stillOut.length;
    expect(returned, `${returned} assets were returned, expected 8${dump(wire)}`).toBe(8);

    // The register says "Unassigned" where nobody holds it, and a NAME where
    // somebody does — never an id.
    await manav(page, 'assets');
    const first = page.locator('#mt-panel-assets table.tbl tbody tr').filter({ hasText: TAGS[0] }).first();
    await expect(first).toContainText('Unassigned');
    const held = page.locator('#mt-panel-assets table.tbl tbody tr').filter({ hasText: TAGS[23] }).first();
    await expect(held).not.toContainText('Unassigned');

    console.log(`\n[07.6] 24 assets · 24 issued · ${returned} returned · ${stillOut.length} still out\n`);
  });

  /* ════════════════════════════════════════════════════════════════════════
     07.8 — EXITS, EXIT INTERVIEWS AND THE CUSTODY REGISTER
     ════════════════════════════════════════════════════════════════════════ */

  test('07.8 four exits, four interviews, and twelve custody lines on a register that has never held one', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const wire = watchWire(page);
    await signIn(page);
    await manav(page, 'exits');

    const staff = (await rowsOf(page, '/api/v1/manav/employees'))
      .filter((e) => /^S7-/.test(String(e.employee_code || '')));
    expect(staff.length, `07.2 must run first${dump(wire)}`).toBeGreaterThan(23);

    // The four leavers, named from the end of the roster so they are not the
    // people 07.3's balances and 07.6's assets hang off.
    const LEAVERS = ['S7-25', 'S7-26', 'S7-27', 'S7-28']
      .map((code) => staff.find((e) => String(e.employee_code) === code))
      .filter(Boolean);
    expect(LEAVERS.length, 'the four leavers are not all on the register').toBe(4);

    const EXIT_TYPES = ['Resignation', 'Resignation', 'End of contract', 'Retirement'];
    // The directory BEFORE this test starts anything. See the assertion below
    // on why a constant floor was the wrong shape here.
    const rollBefore = (await rowsOf(page, '/api/v1/manav/employees')).length;
    let exits = await rowsOf(page, '/api/v1/manav/offboarding');
    const leaving = new Set(exits.map((r) => String(r.employee_id)));

    for (let i = 0; i < LEAVERS.length; i++) {
      const emp = LEAVERS[i];
      if (leaving.has(String(emp.id))) continue;
      await manav(page, 'exits');
      await page.getByRole('button', { name: '+ Start an exit', exact: true }).click();
      const form = page.locator('form.gn-form');
      await expect(form.getByRole('heading', { name: 'Start an exit' })).toBeVisible({ timeout: 20_000 });
      await choose(form, 'Who is leaving *', `${emp.name} · ${emp.employee_code}`);
      await choose(form, 'Exit type', EXIT_TYPES[i]);
      await setDate(form, 'Resignation date', '2026-08-24');
      await setDate(form, 'Last working day', '2026-09-30');
      await type(form, 'Notice period (days)', '30');
      await type(form, 'Reason', `S7 exit ${i + 1}`);
      await writes(page, /\/manav\/offboarding$/, async () => {
        await form.getByRole('button', { name: 'Start exit', exact: true }).click();
      });
      await expect(toastTitle(page, /Exit started/i)).toBeVisible({ timeout: 20_000 });
    }

    exits = await rowsOf(page, '/api/v1/manav/offboarding');
    const mineExits = exits.filter((r) => LEAVERS.some((e) => String(e.id) === String(r.employee_id)));
    expect(mineExits.length, `${mineExits.length} exits are open, expected 4${dump(wire)}`).toBe(4);

    /* ⚠ NOT COMPLETED, AND THAT IS THE PRODUCT'S OWN RULE.
     * `Complete exit` sets `is_active=FALSE` and takes the person off payroll;
     * `ExitsTab.jsx` opens by saying deactivation is the LAST step, not the
     * first. Completing all four here would take four people off the register
     * §4 asked to have thirty of. */
    for (const r of mineExits) {
      expect(String(r.status), 'a freshly started exit must not already be completed').not.toBe('completed');
    }
    /**
     * ⚠ AGAINST THE ROLL THIS TEST FOUND, NOT AGAINST A CONSTANT.
     *
     * This read `>= 30` and got 26, and the product was right. `manav_employees`
     * holds 30 active rows for this org and the directory returns 26, because
     * `still_on_the_rolls()` excludes anybody whose LAST WORKING DAY HAS PASSED
     * — and four people had already left: Kabir Solanki (11 Aug), Rohit Vyas
     * (13 Aug), Yash Rathod (17 Aug), Vivek Thakkar (20 Aug), all from earlier
     * rounds of this programme. 30 - 4 = 26.
     *
     * A flat floor of 30 is an assumption that nobody has ever left, on an org
     * that accumulates state across every run — so the check would go red a
     * little more every pass and blame the product each time.
     *
     * What the test actually means is that starting an exit does not take the
     * person off the register, and THAT is measurable exactly: the four exits
     * above are dated 2026-09-30, which is in the future, so the roll must not
     * have moved at all. `ExitsTab.jsx` opens by saying deactivation is the
     * LAST step, and `still_on_the_rolls`'s own note says a leaver keeps the
     * flag until settlement. Both are checked here rather than assumed.
     */
    const stillActive = (await rowsOf(page, '/api/v1/manav/employees')).length;
    expect(stillActive,
      `the directory held ${rollBefore} people before these four exits were started and `
      + `holds ${stillActive} after. A future-dated exit must not take anybody off the `
      + `roll — deactivation is the last step of an exit, not the first${dump(wire)}`)
      .toBe(rollBefore);

    // And each of the four is still THERE by name, not merely a count that
    // happens to match because somebody else was added in the same window.
    const roll = await rowsOf(page, '/api/v1/manav/employees');
    for (const emp of LEAVERS) {
      expect(roll.some((e) => String(e.id) === String(emp.id)),
        `${emp.name} has an exit dated 2026-09-30 — in the future — and has already `
        + 'left the directory. `still_on_the_rolls` excludes only a last working day '
        + 'that has PASSED').toBe(true);
    }

    // ── Four exit interviews ───────────────────────────────────────────────
    const REASONS = ['Compensation', 'Career growth', 'Relocation', 'Personal'];
    let interviews = await rowsOf(page, '/api/v1/manav/exit-interviews');
    for (let i = 0; i < mineExits.length; i++) {
      const r = mineExits[i];
      if (interviews.some((x) => String(x.employee_id) === String(r.employee_id))) continue;
      await manav(page, 'exits');
      const row = page.locator('#mt-panel-exits table.tbl tbody tr').filter({ hasText: String(r.employee_name) }).first();
      await expect(row, `no exit row for ${r.employee_name}`).toBeVisible({ timeout: 30_000 });
      await row.click();
      const open = page.locator('.mn-exit__panel');
      await expect(open, 'the exit panel did not open').toBeVisible({ timeout: 20_000 });
      await open.getByRole('button', { name: /exit interview/i }).click();

      const form = page.locator('form.gn-form').filter({ hasText: 'Exit interview' });
      await expect(form).toBeVisible({ timeout: 20_000 });
      await choose(form, 'Primary reason for leaving', REASONS[i]);
      await choose(form, 'Overall experience', `${3 + (i % 3)} / 5`);
      await tick(form, 'Would recommend us as an employer', i % 2 === 0);
      await type(form, 'Notes', `S7 exit interview ${i + 1}`);
      await writes(page, /\/manav\/exit-interviews$/, async () => {
        await form.getByRole('button', { name: 'Save interview', exact: true }).click();
      });
      await expect(toastTitle(page, /Exit interview recorded/i)).toBeVisible({ timeout: 20_000 });
      interviews = await rowsOf(page, '/api/v1/manav/exit-interviews');
    }
    interviews = await rowsOf(page, '/api/v1/manav/exit-interviews');
    const mineInt = interviews.filter((x) => LEAVERS.some((e) => String(e.id) === String(x.employee_id)));
    expect(mineInt.length, `${mineInt.length} exit interviews recorded, expected 4${dump(wire)}`).toBe(4);

    /* ── CUSTODY: TWELVE LINES ON A REGISTER THAT HAS NEVER HELD ONE ───────
     *
     * ⚠ `staging.manav_custody_ledger` has held 0 rows in its entire life —
     * migrations 160-164 shipped the four registers with no router and no
     * screen. The 422 that blocked this write is reported fixed and has never
     * been proved. So the STATUS asserted below is the server's, and a failure
     * here reports the wire and stops.
     *
     * Three lines per leaver, all recorded as `outstanding`, because that is
     * the state the read endpoint returns in `ledger_outstanding` — which is
     * what makes this loop idempotent: a line already written is visible and is
     * skipped. A `done` line would vanish from that list and be re-created on
     * every run, which is the four-times-the-truth failure the upsert exists to
     * prevent and which a manual line (subject_ref NULL) does not get.
     */
    const HOLDS = [
      { what: 'A DSC token', label: 'Sharma Textiles DSC token', action: 'Hand it to somebody' },
      { what: 'A device — laptop, phone, key', label: 'Dell Latitude 5420', action: 'Hand it to somebody' },
      { what: 'A portal login', label: 'GST portal login', action: 'Shut it off' },
    ];

    let lines = 0;
    for (const emp of LEAVERS) {
      const custody = await orgGet(page, `/api/v1/custody/offboarding/${emp.id}`);
      const already = new Set((custody.ledger_outstanding || []).map((l: any) => String(l.subject_label)));

      await manav(page, 'custody');
      await choose(page.locator('#mt-panel-custody .mn-bar').first(), 'Whose exit', String(emp.name));
      // The scan runs on selection; the counts panel is the proof it ran.
      await expect(page.locator('#mt-panel-custody .mn-facts'), 'the custody scan produced no panel')
        .toBeVisible({ timeout: 30_000 });

      for (const h of HOLDS) {
        const label = `${h.label} — ${emp.employee_code}`;
        if (already.has(label)) { lines += 1; continue; }
        await page.getByRole('button', { name: '+ Record something they hold', exact: true }).click();
        const form = page.locator('#mt-panel-custody form.k-formpanel');
        await expect(form).toBeVisible({ timeout: 20_000 });
        await choose(form, 'What', h.what);
        await type(form, 'Which one *', label);
        await choose(form, 'Hand over or shut off', h.action);
        await choose(form, 'Where it stands', 'Still outstanding');
        if (h.action.startsWith('Hand')) await type(form, 'Handed to', 'Riya Kapadia');
        await type(form, 'Note', `S7 custody line for ${emp.employee_code}`);
        await writes(page, /\/custody\/offboarding\/.+\/lines/, async () => {
          await form.getByRole('button', { name: 'Record it', exact: true }).click();
        });
        await expect(toastTitle(page, /^Recorded$/)).toBeVisible({ timeout: 20_000 });
        lines += 1;
      }
    }

    // The register, read back from the server for every leaver.
    let ledgerTotal = 0;
    for (const emp of LEAVERS) {
      const led = await orgGet(page, `/api/v1/custody/offboarding/${emp.id}/ledger`);
      const rows = (led.data || []).filter((l: any) => /^S7 custody line/.test(String(l.note || '')));
      expect(rows.length, `${emp.employee_code} carries ${rows.length} custody lines, expected 3${dump(wire)}`).toBe(3);
      ledgerTotal += rows.length;
    }
    expect(
      ledgerTotal,
      `the custody register holds ${ledgerTotal} lines for these four exits, expected 12. ` +
      `This table has held ZERO rows in its entire life; a number other than 12 here is the ` +
      `first thing to report${dump(wire)}`,
    ).toBe(12);

    // And the screen shows them, written down and still open.
    await manav(page, 'custody');
    await choose(page.locator('#mt-panel-custody .mn-bar').first(), 'Whose exit', String(LEAVERS[0].name));
    const written = page.locator('#mt-panel-custody .mn-list .mn-rec');
    await expect(written, 'nothing appears under "Written down and still open"')
      .not.toHaveCount(0, { timeout: 30_000 });

    console.log(`\n[07.8] 4 exits (none completed) · 4 interviews · ${ledgerTotal} custody lines\n`);
  });

  /* ════════════════════════════════════════════════════════════════════════
     07.9 — EXPENSE CLAIMS AND BONUSES
     ════════════════════════════════════════════════════════════════════════ */

  test('07.9 twelve expense claims and six bonuses, eligibility first', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const wire = watchWire(page);
    await signIn(page);

    const staff = (await rowsOf(page, '/api/v1/manav/employees'))
      .filter((e) => /^S7-/.test(String(e.employee_code || '')));
    expect(staff.length, `07.2 must run first${dump(wire)}`).toBeGreaterThan(23);

    // ── Claims ─────────────────────────────────────────────────────────────
    const CATS = ['travel', 'meals', 'supplies', 'other'];
    await manav(page, 'expenses');
    let claims = await rowsOf(page, '/api/v1/manav/expense-claims');
    const seen = new Set(claims.map((c) => String(c.description || '')));

    for (let i = 0; i < 12; i++) {
      const desc = `S7 claim ${i + 1}`;
      if (seen.has(desc)) continue;
      await manav(page, 'expenses');
      await page.getByRole('button', { name: '+ Submit claim', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await expect(form.getByRole('heading', { name: 'Submit expense claim' })).toBeVisible({ timeout: 20_000 });
      await choose(form, 'Employee *', `(${staff[i % staff.length].employee_code})`);
      await choose(form, 'Category', CATS[i % CATS.length]);
      await setDate(form, 'Date *', `2026-08-${String(5 + i).padStart(2, '0')}`);
      await type(form, 'Amount *', String(750 + i * 125));
      await type(form, 'Description', desc);
      await writes(page, /\/manav\/expense-claims$/, async () => {
        await form.getByRole('button', { name: 'Submit', exact: true }).click();
      });
      await expect(toastTitle(page, /Expense claim submitted/i)).toBeVisible({ timeout: 20_000 });
    }
    claims = await rowsOf(page, '/api/v1/manav/expense-claims');
    const mine = claims.filter((c) => /^S7 claim /.test(String(c.description || '')));
    expect(mine.length, `${mine.length} of the 12 claims exist${dump(wire)}`).toBe(12);

    // Decide a few, so the register is not one undifferentiated column.
    for (const desc of ['S7 claim 1', 'S7 claim 2', 'S7 claim 3']) {
      const c = mine.find((x) => x.description === desc);
      if (String(c.status) !== 'pending') continue;
      await manav(page, 'expenses');
      // Anchored, for the same reason the leave cards are: `hasText: 'S7 claim 1'`
      // is a substring match and also selects claims 10, 11 and 12.
      const card = page.locator('#mt-panel-expenses article.mn-rec')
        .filter({ hasText: new RegExp(`${reEsc(desc)}(?![0-9])`) });
      await expect(card).toHaveCount(1, { timeout: 30_000 });
      await writes(page, /\/manav\/expense-claims\/.+\/(approve|reject)/, async () => {
        await card.getByRole('button', { name: desc === 'S7 claim 3' ? 'Reject' : 'Approve', exact: true }).click();
      }, { methods: ['PATCH'] });
    }
    const decided = (await rowsOf(page, '/api/v1/manav/expense-claims'))
      .filter((c) => /^S7 claim [123]$/.test(String(c.description || '')));
    expect(decided.filter((c) => c.status === 'approved').length, `approved claims${dump(wire)}`).toBe(2);
    expect(decided.filter((c) => c.status === 'rejected').length, `rejected claims${dump(wire)}`).toBe(1);

    // ── Bonuses ────────────────────────────────────────────────────────────
    //
    // An award is REFUSED unless the person is eligible first, and eligibility
    // is WRITE-ONLY — no read endpoint returns it (`BonusTab.jsx` says so at
    // the top of the file). So eligibility is recorded through the real control
    // every run: setting it again is harmless and is the only way to be sure.
    await manav(page, 'bonus');
    const awards = await rowsOf(page, '/api/v1/manav/bonus-awards');
    const seenAward = new Set(awards.map((a) => String(a.reason || '')));
    const WHY = [
      'Filing season overtime', 'Client retention', 'Statutory audit delivery',
      'Process improvement', 'Recruitment referral', 'Long service',
    ];

    for (let i = 0; i < 6; i++) {
      const reason = `S7 bonus — ${WHY[i]}`;
      if (seenAward.has(reason)) continue;
      const emp = staff[i];

      // Eligibility, through the panel that exists for it.
      await manav(page, 'bonus');
      const panel = page.locator('#mt-panel-bonus .k-section').filter({ hasText: 'Who may be given a bonus' });
      await expect(panel, 'the eligibility panel is missing').toBeVisible({ timeout: 30_000 });
      await choose(panel.locator('.mn-bar'), 'Person', String(emp.name));
      await writes(page, /\/manav\/employees\/.+\/bonus-eligibility/, async () => {
        await panel.getByRole('button', { name: 'May be given a bonus', exact: true }).click();
      }, { methods: ['PUT'] });
      // The screen echoes the SERVER's answer, not the click.
      await expect(panel.locator('.mn-count').filter({ hasText: /Recorded:/ }),
        'the eligibility panel did not echo the server\'s answer').toBeVisible({ timeout: 20_000 });
      await expect(panel).toContainText(String(emp.name));

      await page.getByRole('button', { name: '+ Award a bonus', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await expect(form.getByRole('heading', { name: 'Award a bonus' })).toBeVisible({ timeout: 20_000 });
      await choose(form, 'Person', String(emp.name));
      await type(form, 'Amount (₹)', String(10000 + i * 2500));
      await type(form, 'Why', reason);
      await type(form, 'Notes', 'Recorded by Suite 07');
      await writes(page, /\/manav\/bonus-awards$/, async () => {
        await form.getByRole('button', { name: 'Award bonus', exact: true }).click();
      });
      await expect(toastTitle(page, /Bonus awarded/i)).toBeVisible({ timeout: 20_000 });
    }

    const finalAwards = (await rowsOf(page, '/api/v1/manav/bonus-awards'))
      .filter((a) => /^S7 bonus — /.test(String(a.reason || '')));
    expect(finalAwards.length, `${finalAwards.length} of the 6 bonuses exist${dump(wire)}`).toBe(6);

    // On screen: a NAME, an amount and the reason — never an id.
    await manav(page, 'bonus');
    await choose(page.locator('#mt-panel-bonus .mn-bar').first(), 'Payroll month', 'Every month');
    const bonusRows = page.locator('#mt-panel-bonus table.tbl tbody tr');
    await expect(bonusRows).not.toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('#mt-panel-bonus').getByText(/in total/)).toBeVisible();

    console.log(`\n[07.9] 12 claims (2 approved, 1 rejected) · ${finalAwards.length} bonuses\n`);
  });

  /* ════════════════════════════════════════════════════════════════════════
     07.10 — COMMISSION: BANDS TYPED OUT OF ORDER
     ════════════════════════════════════════════════════════════════════════ */

  test('07.10 eight commission arrangements, with the rates typed out of order', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const wire = watchWire(page);
    await signIn(page);

    const staff = (await rowsOf(page, '/api/v1/manav/employees'))
      .filter((e) => /^S7-/.test(String(e.employee_code || '')));
    expect(staff.length, `07.2 must run first${dump(wire)}`).toBeGreaterThan(23);

    /**
     * §4 asks for "2 schemes · 6 bands · 8 assignments". A commission
     * arrangement in this product is per-PERSON — `manav_commission_schemes`
     * carries `employee_id` — so the reading that fits the schema is: TWO
     * arrangement shapes, SIX distinct rates between them, recorded against
     * EIGHT people. That is what this does, and the mapping is written down
     * rather than left for the reader to reconstruct from the counts.
     *
     * ⚠ THE RATES ARE TYPED OUT OF ORDER ON PURPOSE. `commissionModel.js`
     * sorts them into a ladder and `create_commission_scheme` stores
     * `scheme.bands` — "as the SCHEME normalised them, sorted, de-duplicated,
     * not as the request happened to order them". The assertion is the SORT,
     * not the typing: the editor's own "runs to …" line must read the ladder in
     * ascending order while the boxes are still in the order they were typed,
     * and the stored bands must come back ascending.
     */
    /**
     * ⚠ THE OPTION TEXT IS THE PRODUCT'S, NOT A PARAPHRASE. `commissionModel.js`
     * spells these for a person rather than as column names — "Every month",
     * not "Monthly"; "Their own revenue", not "their own sales" — and a matcher
     * written from the column values finds nothing and reads as a missing
     * option. The values behind them are `monthly`/`annual` and `own`/`department`.
     */
    const SHAPES = [
      {
        basis: 'Turnover', period: 'Every month', scope: 'Their own revenue',
        // Typed 3rd, 1st, 2nd — deliberately not ascending.
        typed: [[500000, 3.75], [100000, 3], [750000, 5]],
        sorted: [100000, 500000, 750000],
      },
      {
        basis: 'Gross profit', period: 'Once a year', scope: "Their department's revenue",
        // Typed 2nd, 3rd, 1st.
        typed: [[1000000, 2.5], [2500000, 4], [250000, 1.25]],
        sorted: [250000, 1000000, 2500000],
      },
    ];

    const people = staff.slice(0, 8);
    let made = 0;

    for (let i = 0; i < people.length; i++) {
      const emp = people[i];
      const shape = SHAPES[i % 2];
      const existing = await orgGet(page, `/api/v1/manav/employees/${emp.id}/commission-schemes`);
      const rows = existing?.data ?? existing ?? [];
      if (Array.isArray(rows) && rows.length > 0) continue;

      await manav(page, 'commission');
      await page.getByRole('button', { name: '+ Record an arrangement', exact: true }).first().click();
      const form = page.locator('form.k-formpanel');
      await expect(form.getByRole('heading', { name: /Record a commission arrangement/ }))
        .toBeVisible({ timeout: 20_000 });

      await choose(form, 'Person', String(emp.name));
      await setDate(form, 'In force from', '2026-08-01');
      await tick(form, 'This person is on commission', true);
      await choose(form, 'Measured on', shape.basis);
      await choose(form, 'Settles', shape.period);
      await choose(form, 'Whose revenue', shape.scope);

      // Three rungs. The editor starts with one row, so two more are added.
      const rungs = form.locator('li.mn-lad__ed');
      await expect(rungs, 'the rate editor rendered no rows at all').toHaveCount(1, { timeout: 20_000 });
      await form.getByRole('button', { name: '+ Add a rate', exact: true }).click();
      await form.getByRole('button', { name: '+ Add a rate', exact: true }).click();
      await expect(rungs, 'the rate editor would not grow to three rows').toHaveCount(3, { timeout: 20_000 });

      for (let r = 0; r < 3; r++) {
        const rung = rungs.nth(r);
        await type(rung, 'From (₹)', String(shape.typed[r][0]));
        await type(rung, 'Rate (%)', String(shape.typed[r][1]));
      }

      /* THE SORT, ASSERTED BEFORE THE SAVE.
       * `upperFor()` reads the LADDER, which is the rows in amount order — so
       * the row carrying the LARGEST amount must be the one that says "and
       * everything above", whatever position it was typed in. */
      const largest = shape.typed.reduce((a, b) => (a[0] > b[0] ? a : b))[0];
      const largestIdx = shape.typed.findIndex((t) => t[0] === largest);
      await expect(
        rungs.nth(largestIdx).locator('.mn-lad__to'),
        `the rate editor does not read its rungs in amount order: row ${largestIdx + 1} carries ` +
        `the largest amount (${largest}) and must be the open-ended one, whatever order it was typed in`,
      ).toHaveText(/and everything above/);
      // ...and the row that was typed FIRST, which is not the smallest, must
      // run to the next amount up rather than being treated as the bottom rung.
      await expect(rungs.nth(0).locator('.mn-lad__to')).toHaveText(/runs to/);

      await writes(page, /\/manav\/commission-schemes$/, async () => {
        await form.getByRole('button', { name: 'Record arrangement', exact: true }).click();
      });
      await expect(toastTitle(page, /Commission arrangement recorded/i)).toBeVisible({ timeout: 20_000 });
      made += 1;
    }

    // ── The stored ladder is ascending, for every one of the eight ─────────
    let assigned = 0;
    for (let i = 0; i < people.length; i++) {
      const emp = people[i];
      const shape = SHAPES[i % 2];
      const body = await orgGet(page, `/api/v1/manav/employees/${emp.id}/commission-schemes`);
      const rows = (body?.data ?? body ?? []) as any[];
      expect(rows.length, `${emp.employee_code} has no commission arrangement${dump(wire)}`).toBeGreaterThan(0);
      const bands = (rows[0].bands || []).map((b: any) => Number(b.from_amount));
      expect(bands.length, `${emp.employee_code}'s arrangement stored no rates${dump(wire)}`).toBe(3);
      expect(
        bands,
        `${emp.employee_code}'s rates came back in the order they were TYPED rather than in ` +
        `amount order. The ladder is marginal — each rate pays on its own slice — so an ` +
        `unsorted ladder pays the wrong rate on every slice${dump(wire)}`,
      ).toEqual(shape.sorted);
      assigned += 1;
    }
    expect(assigned, `${assigned} people carry an arrangement, expected 8${dump(wire)}`).toBe(8);

    console.log(`\n[07.10] 2 shapes · 6 distinct rates · ${assigned} arrangements ` +
      `(${made} written this run) · every ladder stored ascending\n`);
  });

  /* ════════════════════════════════════════════════════════════════════════
     07.11 — ANNOUNCEMENTS AND THE PERFORMANCE SUMMARY
     ════════════════════════════════════════════════════════════════════════ */

  test('07.11 six announcements, and eight people in the performance summary', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const wire = watchWire(page);
    await signIn(page);

    /* ⚠ ANNOUNCEMENTS MAIL EVERY ACTIVE EMPLOYEE WHO HOLDS AN ADDRESS
     * (`routers/manav.py:3214-3225`), and staging's outbound_mode is `live`.
     * This test therefore PROVES the precondition before it publishes anything:
     * if any employee on this register has picked up an address, six
     * announcements become up to 180 real emails and this must stop rather than
     * send them. */
    const withEmail = (await rowsOf(page, '/api/v1/manav/employees'))
      .filter((e) => String(e.email || '').trim());
    expect(
      withEmail.map((e) => `${e.employee_code}:${e.email}`),
      'REFUSING TO PUBLISH. An announcement mails every active employee who holds an email ' +
      'address, staging reports outbound_mode="live" and nothing is suppressed, so publishing ' +
      'six of them here would send real mail to the addresses listed above. Suite 07 creates ' +
      'every employee with the address left blank precisely so this cannot happen — an address ' +
      'appearing here means something else put it there.',
    ).toEqual([]);

    await manav(page, 'announcements');
    const ANN = [
      { title: 'S7 · Filing calendar for September', priority: 'high', pinned: true },
      { title: 'S7 · Office timings during Uttarayan', priority: 'normal', pinned: false },
      { title: 'S7 · New leave policy summary', priority: 'normal', pinned: false },
      { title: 'S7 · Asset audit next week', priority: 'low', pinned: false },
      { title: 'S7 · Fire drill', priority: 'urgent', pinned: true },
      { title: 'S7 · Quarterly town hall', priority: 'normal', pinned: false },
    ];
    let anns = await rowsOf(page, '/api/v1/manav/announcements');
    const seen = new Set(anns.map((a) => String(a.title)));
    for (const a of ANN) {
      if (seen.has(a.title)) continue;
      await page.getByRole('button', { name: '+ New announcement', exact: true }).click();
      const form = page.locator('form.k-formpanel');
      await expect(form.getByRole('heading', { name: 'New announcement' })).toBeVisible({ timeout: 20_000 });
      await type(form, 'Title *', a.title);
      await type(form, 'Body *', `${a.title} — recorded by Suite 07 against Unicode Group.`);
      await choose(form, 'Priority', a.priority);
      await tick(form, 'Pin to top', a.pinned);
      await writes(page, /\/manav\/announcements$/, async () => {
        await form.getByRole('button', { name: 'Publish', exact: true }).click();
      });
      await expect(toastTitle(page, /Announcement published/i)).toBeVisible({ timeout: 20_000 });
    }
    anns = await rowsOf(page, '/api/v1/manav/announcements');
    const mine = anns.filter((a) => /^S7 · /.test(String(a.title)));
    expect(mine.length, `${mine.length} of the 6 announcements exist${dump(wire)}`).toBe(6);
    expect(mine.filter((a) => a.pinned).length, `pinned announcements${dump(wire)}`).toBe(2);

    await manav(page, 'announcements');
    const cards = page.locator('#mt-panel-announcements article.mn-ann');
    await expect(cards).not.toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('#mt-panel-announcements .mn-ann__pin').first(),
      'a pinned announcement must say so in words, not with an emoji').toContainText('Pinned');

    /* ── §4's "8 performance reviews" — WHAT IS ACTUALLY REACHABLE ─────────
     *
     * There is no performance-review record in this product. `PerformanceTab`
     * has no create control at all and `GET /performance/summary` DERIVES its
     * rows from attendance: days present, absent, late, hours. So the eight are
     * produced the only way the product allows — by marking attendance for
     * eight people — and the assertion is that eight of them appear in the
     * summary with the attendance percentage the screen states its denominator
     * for. This is a SUBSTITUTION and it is labelled as one.
     */
    const staff = (await rowsOf(page, '/api/v1/manav/employees'))
      .filter((e) => /^S7-/.test(String(e.employee_code || ''))).slice(0, 8);
    const DAY = '2026-08-27';
    const attBefore = await rowsOf(page, `/api/v1/manav/attendance?date_from=${DAY}&date_to=${DAY}`);
    const marked = new Set(attBefore.map((a) => String(a.employee_id)));

    await manav(page, 'attendance');
    for (const emp of staff) {
      if (marked.has(String(emp.id))) continue;
      await manav(page, 'attendance');
      await page.getByRole('button', { name: /Mark attendance/i }).first().click();
      const form = page.locator('form.k-formpanel');
      await expect(form).toBeVisible({ timeout: 20_000 });
      await choose(form, 'Employee *', String(emp.name));
      // "Date", not "Date *" — attendance defaults the day to today and does
      // not mark the field required, unlike every other date on this module.
      await setDate(form, 'Date', DAY);
      await choose(form, 'Status', 'present');
      await writes(page, /\/manav\/attendance$/, async () => {
        await form.getByRole('button', { name: /^(Mark|Save|Submit)$/ }).first().click();
      });
    }

    const att = await rowsOf(page, `/api/v1/manav/attendance?date_from=${DAY}&date_to=${DAY}`);
    expect(att.length, `${att.length} attendance rows on ${DAY}, expected at least 8${dump(wire)}`)
      .toBeGreaterThanOrEqual(8);

    await manav(page, 'performance');
    const perfRows = page.locator('#mt-panel-performance table.tbl tbody tr');
    await expect(perfRows, 'the performance summary shows nobody at all').not.toHaveCount(0, { timeout: 45_000 });
    const perf = await rowsOf(page, '/api/v1/manav/performance/summary?from_date=2026-08-01&to_date=2026-08-31');
    expect(perf.length, `${perf.length} people in the performance summary, expected at least 8${dump(wire)}`)
      .toBeGreaterThanOrEqual(8);
    // The denominator is stated on screen — a percentage with an unstated
    // denominator is not a measurement.
    await expect(page.locator('#mt-panel-performance').getByText(/present ÷ \(present \+ absent\)/))
      .toBeVisible();

    console.log(`\n[07.11] 6 announcements (2 pinned, 0 emails sent) · ` +
      `${perf.length} people in the derived performance summary\n`);
  });

  /* ════════════════════════════════════════════════════════════════════════
     07.12 — THE LINK BETWEEN A PERSONNEL RECORD AND A LOGIN
     ════════════════════════════════════════════════════════════════════════ */

  test('07.12 employees linked to real logins, through the real control', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const wire = watchWire(page);
    await signIn(page);

    /**
     * ⚠ 0 OF 98 EMPLOYEES HAVE EVER BEEN LINKED TO A LOGIN. That is the
     * standing finding this test exists to move, and it is why the assertions
     * below are about the CONTROL working rather than about a target count.
     *
     * §4 asks for 18. The ceiling is the number of member ACCOUNTS the
     * organisation has, because linking connects to an account that already
     * exists — `LinkPicker` says so on screen and `POST /employees/{id}/link`
     * takes a `user_id` off the member list. Whatever that ceiling is on the
     * day, it is reported; it is not quietly renamed as the target.
     */
    const options = await orgGet(page, '/api/v1/manav/employees/link-options');
    const accounts = (options?.data ?? options ?? []) as any[];
    expect(Array.isArray(accounts), 'GET /employees/link-options did not answer a list').toBeTruthy();
    const free = accounts.filter((a) => !a.linked_employee_id);

    await manav(page, 'logins');
    const queue = page.locator('#mt-panel-logins table.tbl tbody tr');
    await expect(queue, 'the linking queue is empty — 07.2 must run first')
      .not.toHaveCount(0, { timeout: 45_000 });

    // The screen must SAY how far short it is, rather than leaving an admin to
    // count. This is the sentence that makes the shortfall visible.
    const shortfallNote = page.locator('#mt-panel-logins .note--warn').filter({ hasText: /cannot be linked yet/ });
    const shortfallShown = await shortfallNote.count();

    let linked = 0;
    const target = Math.min(18, free.length);
    for (let i = 0; i < target; i++) {
      const fresh = await orgGet(page, '/api/v1/manav/employees/link-options');
      const stillFree = ((fresh?.data ?? fresh ?? []) as any[]).filter((a) => !a.linked_employee_id);
      if (stillFree.length === 0) break;
      const account = stillFree[0];

      await manav(page, 'logins');
      const row = page.locator('#mt-panel-logins table.tbl tbody tr').first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      const who = (await row.innerText()).replace(/\s+/g, ' ').trim();
      await row.click();

      const card = page.locator('#mt-panel-logins .mn-card').filter({ hasText: 'Choose the account that is' });
      await expect(card, 'the account picker did not open').toBeVisible({ timeout: 20_000 });

      const group = card.locator('[role="radiogroup"]');
      await expect(group, 'the account picker rendered no radiogroup').toBeVisible({ timeout: 20_000 });
      const choices = group.locator('label.mn-rec');
      await expect(choices, 'the account picker offered no accounts at all').not.toHaveCount(0);

      // Chosen BY EMAIL, which is what a person reads. `a.user_id` is the
      // radio's value and is never asserted or rendered by this test.
      const pick = choices.filter({ hasText: String(account.email) }).first();
      await expect(pick, `no account row on screen for ${account.email}`).toBeVisible({ timeout: 20_000 });
      await pick.locator('input[type="radio"]').click();

      // The claim, in names, before the button. This is the sentence the person
      // is agreeing to and it must name both sides.
      const claim = card.locator('.note--info').filter({ hasText: 'You are saying that' });
      await expect(claim, 'the picker does not state the claim in names before it is committed')
        .toBeVisible({ timeout: 20_000 });
      await expect(claim).toContainText(String(account.email));

      await writes(page, /\/manav\/employees\/.+\/link$/, async () => {
        await card.getByRole('button', { name: 'Link these two', exact: true }).click();
      });
      linked += 1;
      console.log(`[07.12] linked "${who.slice(0, 60)}" → ${account.email}`);
    }

    // ── The evidence ───────────────────────────────────────────────────────
    const employees = await rowsOf(page, '/api/v1/manav/employees');
    const nowLinked = employees.filter((e) => e.user_id);
    expect(
      nowLinked.length,
      `NOT ONE employee is linked to a login after driving the link control ${linked} times. ` +
      `This register has had 0 links in its entire life and this test is the thing that was ` +
      `meant to move it${dump(wire)}`,
    ).toBeGreaterThan(0);
    expect(nowLinked.length, 'fewer links exist than this run made').toBeGreaterThanOrEqual(Math.min(linked, 1));

    // On screen: the directory's Login column flips, and the "Already linked"
    // section names the person and the address — never an id.
    await manav(page, 'employees');
    const badge = page.locator('#mt-panel-employees table.tbl tbody tr').filter({ hasText: 'linked' });
    await expect(badge, 'no row in the directory shows a linked login').not.toHaveCount(0, { timeout: 30_000 });

    await manav(page, 'logins');
    await expect(page.locator('#mt-panel-logins').getByRole('heading', { name: /Already linked \(/ }),
      'the "Already linked" section did not appear').toBeVisible({ timeout: 30_000 });

    console.log(
      `\n[07.12] §4 asked for 18 links. ${accounts.length} member accounts exist on this org ` +
      `(${free.length} free at the start), so the CEILING is ${target}, not 18 — linking ` +
      `connects to an account that already exists and invites nobody. ` +
      `${linked} links made this run; ${nowLinked.length} employees now carry a login. ` +
      `The screen ${shortfallShown ? 'DID' : 'did NOT'} print the shortfall banner.\n`,
    );
  });

  /* ════════════════════════════════════════════════════════════════════════
     07.13 — THE THREE REGISTERS THAT HAVE NEVER HELD A ROW
     ════════════════════════════════════════════════════════════════════════ */

  test('07.13 UDIN, notices and DSC — three registers at zero on both orgs today', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const wire = watchWire(page);
    await signIn(page);

    // ── DSC: four certificates, all the firm's own ─────────────────────────
    //
    // `client_id` absent MEANS the practice's own certificate — a partner's DSC
    // held for the firm's own signing — so this register needs no CRM client.
    await manav(page, 'dsc');
    const DSCS = [
      { holder: 'CA Anil Sharma (S7)',  desig: 'Partner',   from: '2026-01-05', to: '2027-01-04', cls: 'Class 3', custody: 'With the firm' },
      { holder: 'CA Meera Bhatt (S7)',  desig: 'Partner',   from: '2026-02-10', to: '2028-02-09', cls: 'Class 3', custody: 'With the firm' },
      { holder: 'CA Rohit Vyas (S7)',   desig: 'Signatory', from: '2026-03-01', to: '2027-02-28', cls: 'Class 3', custody: 'With the firm' },
      { holder: 'CA Zoya Shaikh (S7)',  desig: 'Signatory', from: '2026-04-01', to: '2026-09-30', cls: 'Class 3', custody: 'With the firm' },
    ];
    let dsc = await rowsOf(page, '/api/v1/custody/dsc');
    const haveDsc = new Set(dsc.map((d) => String(d.holder_name)));
    for (const d of DSCS) {
      if (haveDsc.has(d.holder)) continue;
      await page.getByRole('button', { name: '+ Record a certificate', exact: true }).click();
      const form = page.locator('#mt-panel-dsc form.k-formpanel');
      await expect(form).toBeVisible({ timeout: 20_000 });
      await type(form, 'Holder’s name *', d.holder);
      await type(form, 'Designation', d.desig);
      // `setDateFar`, not `setDate` — a DSC runs one to three years and the
      // shared helper walks only thirteen months. See its docblock.
      await setDateFar(form, 'Valid from *', d.from);
      await setDateFar(form, 'Valid to *', d.to);
      await type(form, 'Certifying Authority', 'eMudhra');
      await type(form, 'Location', 'Safe, cabin 2');
      await type(form, 'Held by', 'Riya Kapadia');
      // PAN is deliberately left blank here too — the field's own comment says
      // it is non-mandatory and unvalidated, and that must stay true.
      await writes(page, /\/custody\/dsc$/, async () => {
        await form.getByRole('button', { name: 'Record certificate', exact: true }).click();
      });
      await expect(toastTitle(page, /^Recorded —/)).toBeVisible({ timeout: 20_000 });
    }
    dsc = await rowsOf(page, '/api/v1/custody/dsc');
    const mineDsc = dsc.filter((d) => /\(S7\)$/.test(String(d.holder_name)));
    expect(mineDsc.length, `${mineDsc.length} of the 4 certificates exist${dump(wire)}`).toBe(4);
    for (const d of mineDsc) {
      // The status is DERIVED from the dates and the custody state on the day
      // you ask — the form offers no status field at all — so it must be
      // present and it must not be blank.
      expect(String(d.status || ''), `${d.holder_name} came back with no derived status${dump(wire)}`).not.toBe('');
      expect(d.belongs_to_firm, `${d.holder_name} was recorded with no client and must read as the firm's own`)
        .toBeTruthy();
    }
    await manav(page, 'dsc');
    const dscRows = page.locator('#mt-panel-dsc table.tbl tbody tr');
    await expect(dscRows).not.toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('#mt-panel-dsc').getByText('The firm’s own').first()).toBeVisible();

    // ── UDIN: six signings ─────────────────────────────────────────────────
    //
    // `client_id` may be blank — "Not one of our companies" — but `client_name`
    // is required, because migration 161 stores the name as a SNAPSHOT taken at
    // signing. A company that renames itself must not retrospectively rename
    // what the practice certified.
    await manav(page, 'udin');
    const UDINS = [
      { title: 'Net worth certificate (S7)',     client: 'Sharma Textiles',   kind: 'Certificate', signed: '2026-08-20' },
      { title: 'Turnover certificate (S7)',      client: 'Patel Engineering', kind: 'Certificate', signed: '2026-08-21' },
      { title: 'Tax audit report 3CD (S7)',      client: 'Mehta Traders',     kind: 'GST or tax audit report', signed: '2026-08-24' },
      { title: 'GST annual return audit (S7)',   client: 'Shah Chemicals',    kind: 'GST or tax audit report', signed: '2026-08-25' },
      { title: 'Statutory audit report (S7)',    client: 'Desai Foods',       kind: 'Audit, assurance or attestation', signed: '2026-08-26' },
      { title: 'Certificate of utilisation (S7)', client: 'Joshi Infra',      kind: 'Certificate', signed: '2026-08-27' },
    ];
    /**
     * ⚠ THE IDEMPOTENCE KEY IS at-risk ∪ revocable, AND THE FIRST DRAFT WAS
     * WRONG IN A WAY THAT LEFT A DUPLICATE ROW BEHIND.
     *
     * `at-risk` lists documents AWAITING a number. The moment one is attached
     * the row leaves that list, so a second run could not see it and recorded
     * the same signing again — `staging.udin_register` now carries two "Net
     * worth certificate (S7)" rows for Sharma Textiles, and nothing in the
     * product can remove either: the register offers no delete, deliberately.
     *
     * A numbered entry is visible in exactly one other place, `revocable`, and
     * only for the 48 hours ICAI allows a revocation in. So this key is correct
     * within that window and NOT beyond it — after 48 hours a numbered document
     * appears in no listing this API offers, and a re-run would duplicate it
     * again. That is a limitation of the register's read surface, stated here
     * rather than papered over, and it is why only ONE document is numbered.
     */
    const atRisk = await rowsOf(page, '/api/v1/custody/udin/at-risk?include_lapsed=true');
    const revocable = await rowsOf(page, '/api/v1/custody/udin/revocable');
    let udin = atRisk;
    const haveUdin = new Set(
      [...atRisk, ...revocable].map((u) => String(u.document_title)),
    );
    for (const u of UDINS) {
      if (haveUdin.has(u.title)) continue;
      await page.getByRole('button', { name: '+ Record a signing', exact: true }).click();
      const form = page.locator('#mt-panel-udin form.k-formpanel');
      await expect(form).toBeVisible({ timeout: 20_000 });
      await type(form, 'Recorded as *', u.client);
      await choose(form, 'Kind *', u.kind);
      await type(form, 'Document *', u.title);
      await type(form, 'Financial year', '2026-27');
      await setDate(form, 'Signed on *', u.signed);
      await type(form, 'Signed by *', 'CA Anil Sharma');
      await type(form, 'Membership number', '123456');
      await writes(page, /\/custody\/udin$/, async () => {
        await form.getByRole('button', { name: 'Record signing', exact: true }).click();
      });
    }
    udin = await rowsOf(page, '/api/v1/custody/udin/at-risk?include_lapsed=true');
    const revocableAfter = await rowsOf(page, '/api/v1/custody/udin/revocable');
    // Counted over BOTH listings for the reason the key above is: a numbered
    // document is not "at risk" any more, so counting only that list reports
    // five where six were recorded.
    const mineUdin = udin.filter((u) => /\(S7\)$/.test(String(u.document_title)));
    const mineNumbered = revocableAfter.filter((u) => /\(S7\)$/.test(String(u.document_title)));
    const titlesSeen = new Set(
      [...mineUdin, ...mineNumbered].map((u) => String(u.document_title)),
    );

    /**
     * ⚠ THE VOLUME IS COUNTED FROM THE SUMMARY, NOT FROM A LIST.
     *
     * Neither list is complete: `at-risk` drops a document the moment it is
     * numbered and `revocable` drops it 48 hours later, so counting titles
     * across the two answers six today and five the day after tomorrow —
     * a suite that would go red on the passage of time rather than on anything
     * about the product. `GET /custody/udin/summary` answers `by_status`, which
     * is every row in the register whatever state it is in, and that is the
     * only stable count this API offers.
     */
    const udinSummary = await orgGet(page, '/api/v1/custody/udin/summary');
    const byStatus = udinSummary?.by_status ?? {};
    const registerTotal = Object.values(byStatus).reduce((s: number, n: any) => s + Number(n || 0), 0);
    expect(
      registerTotal,
      `the UDIN register holds ${registerTotal} rows (${JSON.stringify(byStatus)}); ` +
      `§4 asked for 6 and this register had never held one${dump(wire)}`,
    ).toBeGreaterThanOrEqual(6);
    for (const u of mineUdin) {
      // A row is born UNNUMBERED and the window runs from the signing date —
      // day 1 is that date itself, because ICAI counts both end dates.
      expect(String(u.udin || ''), `${u.document_title} was born carrying a UDIN, which it must not`).toBe('');
      expect(Number(u.day_of_window), `${u.document_title} has no window position${dump(wire)}`).toBeGreaterThan(0);
    }
    await manav(page, 'udin');
    await expect(page.locator('#mt-panel-udin table.tbl tbody tr')).not.toHaveCount(0, { timeout: 30_000 });

    /**
     * ONE number attached, through the real control, so the register's own loop
     * is closed rather than half-run — and it is pinned to ONE NAMED DOCUMENT
     * with ONE fixed UDIN.
     *
     * ⚠ Not `mineUdin[0]`. That picked whichever row happened to be first and,
     * once a duplicate existed, tried to put an already-issued number on it:
     * the product refused with 422 "One UDIN belongs to one signature; nothing
     * was changed", which is the register being right. A UDIN is unique in the
     * practice, so the pairing has to be fixed rather than positional.
     */
    const NUMBER_ME = 'Turnover certificate (S7)';
    const FIXED_UDIN = '26123456BKXYZA1235';
    const target = mineUdin.find(
      (u) => String(u.document_title) === NUMBER_ME && !String(u.udin || ''),
    );
    if (target) {
      const card = page.locator('#mt-panel-udin table.tbl tbody tr').filter({ hasText: NUMBER_ME }).first();
      await expect(card).toBeVisible({ timeout: 20_000 });
      await card.getByRole('button', { name: 'Add UDIN', exact: true }).click();
      const genForm = page.locator('#mt-panel-udin form.k-formpanel').last();
      await expect(genForm).toBeVisible({ timeout: 20_000 });
      await type(genForm, 'UDIN *', FIXED_UDIN);
      await writes(page, /\/custody\/udin\/.+\/generate/, async () => {
        await genForm.getByRole('button', { name: /Record|Save|Attach/ }).first().click();
      });
      // The number must be ON the row the register answers with.
      const numbered = await rowsOf(page, '/api/v1/custody/udin/revocable');
      expect(
        numbered.some((u) => String(u.document_title) === NUMBER_ME),
        `${NUMBER_ME} was numbered and did not appear among the revocable entries — ` +
        `a UDIN inside its 48-hour window is exactly what that list is${dump(wire)}`,
      ).toBeTruthy();
    } else {
      console.log(`[07.13] "${NUMBER_ME}" already carries its UDIN — verified, not re-issued`);
    }

    // ── Notices: five, and the CRM client they cannot exist without ────────
    //
    // ⚠ REACHING OUTSIDE MANAV, DELIBERATELY AND ONCE. `NewNotice.client_id` is
    // MANDATORY (`routers/custody.py`), `GET /custody/clients` answered rows=0
    // on Unicode on 2026-08-29, and Suite 04 — which owns the CRM lane — runs
    // in parallel with this file rather than before it. So if no company
    // exists, one is TYPED into the real Graha client form. That is still rule
    // 1: a real screen, a real form, a real button. It is recorded here so
    // nobody later reads a Graha row created by Suite 07 as a mystery.
    let clients = await rowsOf(page, '/api/v1/custody/clients');
    if (clients.length === 0) {
      await page.goto('/graha');
      await settle(page);
      const add = page.getByRole('button', { name: /\+\s*(New|Add)\s*client/i }).first();
      await expect(add, 'the CRM offers no way to add a client, so the notice register is unreachable')
        .toBeVisible({ timeout: 45_000 });
      await add.click();
      const cf = page.locator('form').filter({ has: page.getByLabel(/Name/i) }).first();
      await expect(cf).toBeVisible({ timeout: 20_000 });
      await cf.getByLabel(/^(Client name|Name)\s*\*?$/i).first().fill(`Suite07 Notice Client ${RUN}`);
      await writes(page, /\/graha\/clients/, async () => {
        await cf.getByRole('button', { name: /^(Create|Save|Add)/ }).first().click();
      });
      clients = await rowsOf(page, '/api/v1/custody/clients');
    }
    expect(
      clients.length,
      'BLOCKED — the notice register cannot hold a row without a client, and this ' +
      'organisation has none. `NewNotice.client_id` is mandatory in routers/custody.py.',
    ).toBeGreaterThan(0);

    const types = await rowsOf(page, '/api/v1/custody/notices/types');
    expect(types.length, 'the notice catalogue is empty').toBeGreaterThan(4);

    await manav(page, 'notices');
    let notices = await rowsOf(page, '/api/v1/custody/notices');
    const haveNotice = new Set(notices.map((n) => String(n.reference_no)));
    for (let i = 0; i < 5; i++) {
      const ref = `S7-NOTICE-${String(i + 1).padStart(3, '0')}`;
      if (haveNotice.has(ref)) continue;
      await page.getByRole('button', { name: '+ File a notice', exact: true }).click();
      const form = page.locator('#mt-panel-notices form.k-formpanel');
      await expect(form).toBeVisible({ timeout: 20_000 });
      await choose(form, 'Client *', String(clients[0].name));
      await choose(form, 'Notice *', String(types[i % types.length].label));
      await type(form, 'Department reference *', ref);
      await setDate(form, 'Served on *', `2026-08-${String(10 + i).padStart(2, '0')}`);
      // Some catalogue entries fix no statutory window and then demand the date
      // off the notice itself. The label says which, so the label decides.
      const dueLabel = form.locator('label').filter({ hasText: 'Reply by' }).first();
      if (/\*/.test((await dueLabel.innerText()) || '')) {
        await setDate(form, 'Reply by', `2026-09-${String(10 + i).padStart(2, '0')}`);
      }
      await type(form, 'Notes', `Filed by Suite 07 — ${ref}`);
      await writes(page, /\/custody\/notices$/, async () => {
        await form.getByRole('button', { name: 'File notice', exact: true }).click();
      });
    }

    notices = await rowsOf(page, '/api/v1/custody/notices');
    const mineNotices = notices.filter((n) => /^S7-NOTICE-/.test(String(n.reference_no)));
    expect(mineNotices.length, `${mineNotices.length} of the 5 notices exist${dump(wire)}`).toBe(5);
    for (const n of mineNotices) {
      // The window is SNAPSHOTTED onto the row, so a later edit to the
      // catalogue cannot move a deadline that has already been filed.
      expect(n.due_on, `${n.reference_no} carries no reply date at all${dump(wire)}`).toBeTruthy();
    }
    await manav(page, 'notices');
    await expect(page.locator('#mt-panel-notices table.tbl tbody tr')).not.toHaveCount(0, { timeout: 30_000 });

    console.log(`\n[07.13] DSC ${mineDsc.length}/4 · UDIN ${registerTotal} on the register ` +
      `(${titlesSeen.size} of this suite's 6 currently listed) · ` +
      `notices ${mineNotices.length}/5 — three registers that held 0 rows before this run\n`);
  });

  /* ════════════════════════════════════════════════════════════════════════
     07.14 — THE STANDING RULES, MEASURED ON THE LIVE SCREENS
     ════════════════════════════════════════════════════════════════════════ */

  test('07.14 no rendered id, one row contract, no bare native date input, clean console', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    const TABS = [
      'employees', 'attendance', 'shifts', 'leaves', 'expenses', 'commission', 'bonus',
      'recruitment', 'announcements', 'departments', 'holidays', 'performance', 'assets',
      'exits', 'custody', 'dsc', 'udin', 'notices', 'logins',
    ];

    // A UUID and a `user_xxxxxxxx` login id are the two shapes this product
    // must never render. `check-rendered-ids.mjs` is the static half; this is
    // the runtime half, and it reads what is actually on the page.
    const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
    const USER_ID = /\buser_[0-9a-f]{12}\b/i;

    const offenders: string[] = [];
    const rowHeights: string[] = [];

    let measured = 0;
    for (const tab of TABS) {
      await manav(page, tab);
      const panel = page.locator(`#mt-panel-${tab}`);

      /**
       * ⚠ WAIT FOR THE PANEL TO HAVE SAID SOMETHING BEFORE READING IT.
       *
       * The first version scanned `innerText()` and counted rows the instant
       * the panel appeared — while every tab was still a skeleton. The row
       * sweep therefore measured exactly ONE of nineteen tabs and passed, and
       * the id scan was reading shimmer. That is the 02.3 shape: a check that
       * runs over nothing reports no violations for ever.
       *
       * "Settled" is defined as THE SKELETON BEING GONE, not as one of a list
       * of content shapes. `_shared.jsx::Shim` renders `.k-shimmer` for every
       * loading state in this module, so its absence is the module's own signal
       * and it covers screens no content list would have guessed — recruitment
       * finishes as a `.mn-pipe` kanban with no table, no card and no empty
       * state, and an enumerated list of markers simply missed it.
       */
      await expect(panel.locator('.k-shimmer'), `the "${tab}" panel never finished loading`)
        .toHaveCount(0, { timeout: 30_000 });
      await settle(page);

      const text = await panel.innerText();
      if (UUID.test(text)) offenders.push(`${tab}: a UUID is rendered — ${text.match(UUID)![0]}`);
      if (USER_ID.test(text)) offenders.push(`${tab}: a login id is rendered — ${text.match(USER_ID)![0]}`);

      // ⚠ NOT `input[type="date"]` COUNTED FLAT, which is what Suite 02's 02.7
      // does. `DateInput.jsx` deliberately KEEPS a native input in the DOM —
      // "it keeps form serialisation by `name`, and it keeps input[type=date]
      // working for the tests" — clipped, aria-hidden and out of the tab order.
      // Counting those would report every correct DateInput as a violation.
      // The rule is that no BARE native date input exists, so that is what is
      // measured: every `input[type=date]` must be a `.pk__native`.
      const bare = await panel.locator('input[type="date"]:not(.pk__native)').count();
      if (bare) offenders.push(`${tab}: ${bare} bare native <input type="date"> outside DateInput`);

      // The one row contract. `--row-h` is 66px by default with 48/76 tiers;
      // the assertion is that a rendered row matches the token this document
      // resolves, not a hardcoded 66.
      const rows = panel.locator('table.tbl tbody tr');
      if (await rows.count()) {
        /**
         * ⚠ THE TOKEN IS READ AT THE ROW, NOT AT `documentElement`.
         *
         * `--row-h` has TIERS — 48 / 66 / 76 — and a table opts into one by
         * overriding the variable on its own scope. Reading the document's
         * value and comparing every table to it reports a table that correctly
         * chose the tall tier as a violation, which is a test that punishes the
         * product for using the system as designed. `getComputedStyle(row)`
         * resolves whatever cascade actually applies to that row.
         *
         * The tolerance is 2px for the row's border, and the tier is checked
         * as well: a row on none of the three declared tiers is off the
         * contract however self-consistent it is.
         */
        const m = await rows.first().evaluate((el) => ({
          docToken: getComputedStyle(document.documentElement).getPropertyValue('--row-h').trim(),
          rowToken: getComputedStyle(el).getPropertyValue('--row-h').trim(),
          h: Math.round(el.getBoundingClientRect().height),
        }));
        rowHeights.push(
          `${tab}: --row-h at the row=${m.rowToken || '(unset)'} ` +
          `(document=${m.docToken || '(unset)'}) rendered=${m.h}px`,
        );
        measured += 1;
        const want = parseFloat(m.rowToken || m.docToken);
        if (Number.isFinite(want) && Math.abs(m.h - want) > 2) {
          offenders.push(
            `${tab}: a table row renders ${m.h}px while its own --row-h resolves to ` +
            `${m.rowToken || m.docToken} (document token ${m.docToken})`,
          );
        }
      } else {
        rowHeights.push(`${tab}: no table on this screen`);
      }
    }

    console.log('\n[07.14] ' + rowHeights.join('\n[07.14] ') + '\n');

    /**
     * ⚠ THE SWEEP HAS TO HAVE SWEPT SOMETHING. Nineteen screens with one table
     * measured between them is not "no violations", it is a check that ran over
     * nothing — and it is exactly what happened before the settle above was
     * added. Manav renders a `.tbl` on employees, holidays, assets, exits,
     * performance, logins, dsc, udin and notices, so the floor is set well
     * below that and still bites if the sweep goes quiet again.
     */
    expect(
      measured,
      `only ${measured} of ${TABS.length} Manav screens had a table to measure, so the ` +
      `--row-h contract was barely checked at all:\n${rowHeights.join('\n')}`,
    ).toBeGreaterThanOrEqual(6);
    expect(offenders, `standing-rule violations measured on the live screens:\n${offenders.join('\n')}`)
      .toEqual([]);
    expect(con.uncaught, `UNCAUGHT page errors:\n${con.uncaught.join('\n')}`).toEqual([]);
    expect(con.errors, `console.error across every Manav screen:\n${con.errors.join('\n')}`).toEqual([]);
  });
});
