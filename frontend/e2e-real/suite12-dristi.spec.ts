/**
 * Proposal 93 · Stage 3 · WAVE 7 · SUITE 12 — Dristi (reports and analytics),
 * on Unicode Group, at §4 volumes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE IS FOR, AND IT IS NOT "DOES THE PAGE RENDER"
 * ═══════════════════════════════════════════════════════════════════════════
 * §4's headline line for this module is **"figures reconciled to source ~60 —
 * every headline number tied back to its module. This page has printed six
 * wrong figures before."** A report that renders is worth almost nothing; a
 * report whose total EQUALS the module it claims to summarise is the
 * deliverable. So the shape of this file is different from every other suite
 * here: most of it reads two numbers that must be the same number and says so.
 *
 * ⚠ **SUITE RULE 4 IS THE TRAP THIS FILE IS BUILT AROUND.** List endpoints cap
 * at 200 rows whatever limit is asked, and summing one gave ₹1.06 Cr against a
 * true ₹3.58 Cr on this very product. **Nothing here reconciles a total by
 * summing a list.** Every figure on both sides of every comparison is one of:
 *
 *   · a server-computed aggregate (`/v1/dristi/overview`, `/v1/analytics/run`,
 *     `POST /v1/dristi/query` with a `measure`) — one row, computed in SQL;
 *   · a list envelope's own `total`, which is `COUNT(*) OVER()` and is NOT the
 *     length of the returned page (`routers/graha.py:100`, `list_invoices`);
 *   · a list whose envelope reports `truncated: false` AND whose `total`
 *     equals `data.length` — checked, in the assertion, every time
 *     (`sumOfWholeList()`; it refuses to sum anything else).
 *
 * ⚠ **AND THE SECOND TRAP: THE ORG IS MOVING.** Other agents write to Unicode
 * while this runs — `public.tasks` for this org went 99 → 100 → 101 inside
 * forty minutes of measurement on 2026-08-29. So NO expected figure is a
 * constant anywhere in this file. Every reconciliation reads BOTH sides inside
 * one `pair()` call, back to back, and compares them to each other. A suite
 * that hardcoded ₹39,84,045.24 would go red tomorrow for a reason that is
 * neither a product bug nor a test bug, which is the worst kind of red.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE, AND THE GUARD THAT PROVES IT
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` + `signInAs()` from `_lanes.ts`. Read that file's header
 * before changing a line here: on 2026-08-28 a write suite renamed **Aekam
 * Inc** — the one org proposal 93 guarantees is untouched — because the
 * credential in use held `platform_admin` and every request resolved to Aekam
 * via `platform_bypass`. The save genuinely succeeded and the suite went GREEN.
 * A row count could not catch that; only asserting the target could.
 *
 * `signInAs()` calls `assertOrg()` itself; `signIn()` below re-asserts AFTER
 * pinning `Kartavaya_active_org`, because that key is written after the door
 * opens and it is the key that decides which org `X-Org-Id` names.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 1 — EVERY ROW HERE IS TYPED BY A USER
 * ═══════════════════════════════════════════════════════════════════════════
 * The rows this suite creates are: 4 dashboards, 18 pinned widgets, 6 saved
 * views, 4 metric alerts and 2 scheduled reports. Every one is made by opening
 * the screen, typing into the real input, choosing from the real picker and
 * pressing the real button. No SQL. No `page.request.post/put/patch/delete`.
 *
 * `page.request.get` IS used — `apiRows()` / `apiOne()` — and that is the
 * ratchet's own carve-out: asserting what the server actually holds IS the
 * required evidence, and on a reconciliation suite it is the entire point.
 * Both send **`X-Org-Id`** (`frontend/src/lib/api.js`), because a read helper
 * that omits it makes the server fall back to the caller's OLDEST membership
 * and answer for a different organisation than the screen beside it.
 *
 * A REPORT RUN IS A READ, NOT A ROW. §4 asks for 18 report types and 40 runs;
 * neither writes anything. The 18 are driven through the screens (12.01, 12.02,
 * 12.06, 12.09) and the whole catalogue is swept in 12.03 through `/run`,
 * which is labelled as an API sweep in its own header because **no screen in
 * this product runs all 76 metrics** and pretending otherwise would be the
 * silent cap §10 warns about.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 2 — STOP AND REPORT. NO VERDICT.
 * ═══════════════════════════════════════════════════════════════════════════
 * Where a figure does not reconcile, the test FAILS and prints both sides, the
 * endpoint each came from, and the arithmetic. 93 §14 reserves the
 * product-bug-versus-test-bug judgement to the owner. Measured against staging
 * as it stands on 2026-08-29, these are expected to be RED, and each is written
 * as a failure on purpose:
 *
 *   12.10  **The overview CSV export counts archived tasks and the overview
 *          screen does not.** `_fetch_report_data("overview")`
 *          (`routers/dristi.py:121`) counts `tasks JOIN teams WHERE
 *          tm.deleted_at IS NULL` with **no `t.archived_at IS NULL`**;
 *          `GET /overview` counts the same join **with** it. Live delta = 1,
 *          and that one archived task is on `team_ae1d58543b21` — the
 *          PROTECTED Aekam Inc team. The same function's `revenue` branch
 *          carries a comment reading "an export that disagrees with the screen
 *          it was taken from is worse than either being wrong alone". The
 *          tasks branch never got the guard.
 *
 *   12.10  **The sales CSV export counts orders the Sales tab excludes.**
 *          `_fetch_report_data("sales")` groups `vikray_orders` with **no
 *          `is_active = TRUE`**; `/v1/dristi/sales`'s `status_split` has it
 *          (`routers/dristi.py:672`). Live 2026-08-29: the screen shows 29
 *          orders worth ₹11,01,435 across five statuses; the CSV shows 35
 *          worth ₹13,44,410 across six — a whole `cancelled` row of 6 orders
 *          and ₹2,42,975 that exists in the file and not on the screen.
 *
 *   12.11  **"Open pipeline" is not open pipeline.** `/overview`'s
 *          `deals.pipeline_value` is `SUM(value)` over EVERY deal — Won and
 *          Lost included — and both the KPI strip and the Overview tab print
 *          it under the label "Open pipeline". The Pipeline tab's funnel, one
 *          click away, deliberately drops Won and Lost ("including them makes
 *          the funnel widen at the bottom"). Live: ₹2,32,50,000 against
 *          ₹1,80,00,000 — ₹52,50,000 of closed deals inside a figure whose
 *          label says they are not there.
 *
 *   12.11  **The analytics board and the Pipeline tab disagree about which
 *          deals are open, because the product never stamps `lost_at`.**
 *          `graha.pipeline_by_stage` defines open as `won_at IS NULL AND
 *          lost_at IS NULL` — "the close is the won_at/lost_at timestamp,
 *          never a stage string" — and `POST /v1/graha/deals` does not set
 *          either when a deal is CREATED at stage Won or Lost (only
 *          `PATCH /deals/{id}` does, `routers/graha.py:2143`). Live: of 30
 *          Unicode deals, 8 are on stage Won and 5 carry `won_at`; 6 are on
 *          stage Lost and **0** carry `lost_at`. So the analytics surface
 *          reports 3 Won deals and ₹3,00,000 as OPEN pipeline, and
 *          `graha.win_rate` reports **100%** (5 won ÷ 5 closed) beside a
 *          Pipeline tab reading 26.7%. This is a Graha WRITE-path defect that
 *          only a Dristi reconciliation can see, which is exactly what this
 *          suite is for. It is NOT fixed here — Graha is not this suite's lane.
 *
 *   12.03  **The metric catalogue lists four metrics `/run` refuses.**
 *          `GET /v1/analytics/catalogue` resolves entitlement through
 *          `held_level` (the caller's ROLE grant) and reports
 *          `withheld_count: 0`; `GET /v1/analytics/run` additionally enforces
 *          MODULE ACTIVATION and answers **403 "Module 'varta' is not
 *          active"** for `varta.sends`, `.delivery_rate`, `.read_rate` and
 *          `.reply_rate`. Live: `GET /v1/org/modules` reports varta
 *          `active=false, entitled=false`. Two gates, one catalogue, and the
 *          catalogue is the one the UI trusts — its own header says "the
 *          catalogue's withholding IS the entitlement signal". The consequence
 *          is reachable: Dristi's board passes `moduleFilter={null}`
 *          (`AnalyticsTab.jsx:637`), so **AddWidget offers all four varta
 *          metrics** and pinning one produces a card that can only ever error.
 *          Varta is excluded by decision (§13) — the DEFECT is not varta, it
 *          is that two gates disagree and the honest count says zero.
 *
 *   12.08  **`staging.dristi_report_logs` rows are filed with a NULL org.** —
 *          reported only if the delivery log this suite writes cannot be read
 *          back through the per-report route. The insert names `org_id`
 *          today; the assertion is here because the column was added after the
 *          rows that made it necessary.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS BLOCKED, WHICH IS A DIFFERENT SENTENCE FROM BROKEN
 * ═══════════════════════════════════════════════════════════════════════════
 * · **§4's "alerts breached 2" cannot be OBSERVED from any Dristi screen.** A
 *   breach is `services/niyam/metric_alerts.run_alerts`, called only from the
 *   Niyam sweep (`POST /api/internal/niyam/sweep`, `CRON_SECRET`, the
 *   `cron-niyam` service). This suite is org-scoped and holds no cron secret,
 *   and arming or calling a cron is not a suite's to do. So 12.07 proves the
 *   BREACH CONDITION deterministically — it runs each alert's own metric over
 *   the alert's own window and applies `_breached()`'s arithmetic — and states
 *   that emission is the engine's. `AlertsPanel` renders no breach state at
 *   all, so even a fired alert would not appear on this module's screens.
 *
 * · **§4's "scheduled reports 2 · dispatches 2" IS achievable without arming
 *   anything, and that was worth establishing rather than assuming.**
 *   `/cron/reports` is a 501 stub and stays untouched. The armed sweep is
 *   `POST /v1/dristi/scheduled-reports/dispatch` and this suite never calls
 *   it. The door a PERSON uses is the **Run now** button, and it runs
 *   `_deliver_scheduled_report` — the identical function the sweep runs, "because
 *   the only difference between those two is WHO decided the report should go
 *   out". So the dispatch is real, driven as a user, with no cron involved.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ MAIL — ENUMERATED, NEVER SAMPLED
 * ═══════════════════════════════════════════════════════════════════════════
 * `outbound_mode` on staging is **live**; nothing is suppressed. Two of Unicode
 * Group's nine member rows carry addresses OUTSIDE the brief's allowlist —
 * `aekaminc1@gmail.com` and `aekaminc1+org@gmail.com` (Kasti Pranami and Kasti
 * ORG, the protected bootstrap admins) — so "mail the org's members" is not a
 * thing this suite may do.
 *
 * It does not have to. `services/module_report.member_recipients` mails
 * `intersection(the schedule's own recipient list, the org's staff)`, so the
 * SET THAT GOES OUT IS A SUBSET OF THE LIST THIS SUITE TYPES. Both schedules
 * are typed with exactly one recipient, `kevalvshah03+1@gmail.com` — the lane's
 * own account, on the allowlist and a member — and 12.08:
 *
 *   1. asserts every address it typed matches `ALLOWED` before pressing
 *      anything (`assertRecipientsFenced`), listing them in the message;
 *   2. re-reads the SAVED schedule and re-checks `recipients` from the server,
 *      because what was typed and what was stored are two different facts;
 *   3. asserts the dispatch's own response says `recipients: 1`;
 *   4. asserts the delivery log row says `recipients_count: 1`.
 *
 * Four enumerations, no sampling. If any address falls outside `ALLOWED` the
 * test FAILS before the send — that is the "STOP and report" the brief asks
 * for, and it is deliberately the first assertion in the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §12 — AEKAM INC IS NO-TOUCH
 * ═══════════════════════════════════════════════════════════════════════════
 * Unicode contains a team named "Aekam Inc" (`team_ae1d58543b21`) holding the
 * protected tasks. Reports READ them, which is fine; nothing here writes. 12.01
 * captures the set's digest before anything runs and 12.12 re-asserts it after
 * everything has. ⚠ `GET /api/tasks?team_id=…` returns **19**, not 20: one of
 * the twenty is archived and the route excludes archived rows. That is stated
 * rather than papered over — and it is the SAME archived task that makes the
 * overview export disagree with the overview screen in 12.10.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 — RE-RUNNABLE, AND PROVED BY RUNNING IT TWICE
 * ═══════════════════════════════════════════════════════════════════════════
 * Every row carries a DETERMINISTIC mark built from `TAG`, so a second
 * execution recognises its own output and verifies instead of duplicating:
 * `S12 Board 01`…`04`, `S12 View 01`…`06`, `S12 Weekly 01`/`02`. Alerts have no
 * name column, so they are keyed on `(metric, operator, threshold)` — the tuple
 * a person would recognise as "the same alert". Every creator reads the live
 * list first and types only what is missing, then reports "N typed, M already
 * present". A suite that creates a second copy of everything on re-run is a
 * defect in the suite (§6).
 *
 * ⚠ Widgets are the one shape where "already present" is not a name lookup:
 * `PATCH /dashboards/{id}` takes the WHOLE array and this screen appends to it,
 * so a blind second run would double every board. 12.05 reads
 * `widgets.length` first and adds only the shortfall.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §10 — THE 14 SCREENS, NAMED, BECAUSE A SILENT CAP READS AS FULL COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════
 *   1  Overview tab            12.01 · 12.11
 *   2  Revenue tab             12.01 · 12.10 (its own Export CSV) · 12.11
 *   3  Pipeline tab            12.01 · 12.11
 *   4  HR tab                  12.01 · 12.11
 *   5  Sales tab               12.01 · 12.10 · 12.11
 *   6  Reports tab — list      12.01 · 12.08
 *   7  Reports tab — create    12.08 (the schedule form, DateInput time field)
 *   8  Reports tab — detail    12.08 (Run now, and the delivery log)
 *   9  Reports tab — Export    12.10 (the five server-rendered CSVs)
 *  10  Dashboards tab          12.04 · 12.05 (gallery, Configure, saved boards)
 *  11  Pivot tab               12.06 (Build panel, cross-tab, CSV)
 *  12  Analytics tab — board   12.03 · 12.05 (ViewsBar, ViewGrid, AddWidget)
 *  13  Analytics tab — alerts  12.07 (the KPI bell and AlertsPanel)
 *  14  Clients tab             12.09 (picker, report, three download formats)
 *
 * Plus the WindowBar, which is not a screen but is the control every one of the
 * fourteen reads through — 12.02 drives all nine presets and a custom range.
 *
 * NOT DRIVEN, and said rather than left to read as covered:
 * · **`EmailWeekly`'s "Email me this weekly" button.** It books a schedule
 *   through the same `POST /scheduled-reports` 12.08 drives, to the same single
 *   allowlisted address — one more row of the same shape and no new coverage,
 *   against a real send path. Its presence is asserted in 12.01; its click is
 *   not, because §4 asks for two schedules and this suite books two.
 * · **The scheduled sweep** (`POST /scheduled-reports/dispatch`) — armed, and
 *   not a suite's to call. See "what is blocked" above.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TRAPS THIS FILE IS WRITTEN AROUND
 * ═══════════════════════════════════════════════════════════════════════════
 * · ⚠ **`DristiPage` reads `?tab=` ONCE, at mount** (its own comment). Within
 *   the SPA the tab is local state, so `openTab()` clicks the real strip button
 *   and falls through to the More popover when `ModuleTabs` has pushed that tab
 *   into the tail — which of the ten are inline is MEASURED at runtime from the
 *   strip's client width and is not knowable from the source.
 * · ⚠ **Two of the ten tabs are CONDITIONAL.** `analytics` appears only when
 *   the catalogue lists a `ganit` metric and `clients` only when it lists a
 *   `graha` one. A missing tab is therefore a FINDING about entitlement, not a
 *   selector problem, and 12.01 says which.
 * · ⚠ **The Analytics tab does not render `ViewGrid` on arrival.** With
 *   `dataModule === 'ganit'` and no active view it draws the bespoke finance
 *   cards; the board (and therefore AddWidget and the KPI bells) exists only
 *   under `edit || active`. 12.05 and 12.07 pick a preset first, and that is
 *   the product's own path, not a workaround.
 * · ⚠ **`getByRole(name)` matches the ACCESSIBLE name.** The window's date
 *   fields are `<DateInput aria-label="From date">`, which renders
 *   `button.pk__tr` with no visible text of its own — a locator on visible text
 *   would fail as a MISSING CONTROL. `setDateAria()` keys on the aria-label,
 *   and the popover is `role="dialog"` carrying the same label.
 * · ⚠ **`DateInput`'s popover is unclickable inside a `<Modal>`** (filed; it
 *   does not portal, and `elementFromPoint` at its Clear button returns
 *   `div.modal__scrim`). Dristi's three DateInputs — the window's From/To and
 *   the pivot's From/To, plus the schedule form's time field — are all on the
 *   page rather than in a modal, so the bug should not bite here. If a window
 *   change ever fails to open its calendar, THAT is the bug and 12.02 says so
 *   in its failure message rather than leaving the next reader to guess.
 * · `.or()` chains resolve in DOM order and match the sidebar. Every locator
 *   below is scoped to the tab panel, the card, or the Build/Configure panel.
 * · A vacuous assertion passes for ever — 02.3 looped over
 *   `input[type=checkbox]` where the product renders `<button role="switch">`.
 *   EVERY loop below asserts its count BEFORE it iterates.
 * · `fill('')` does not register with a controlled React input — clearing is
 *   select-all-then-type (`typeInto`).
 * · A toast is the client's opinion. Everything that writes goes through
 *   `saveAndWait()`, which returns the SERVER's status.
 * · ⚠ **Playwright STARTS A NEW WORKER AFTER A FAILED TEST**, resetting
 *   module-level state — two agents hit this on 2026-08-29 and one had a test
 *   PASS on a defect it had just measured. Every count this suite reports
 *   lives in a FILE (`LEDGER`), never in a module variable.
 * · No user, member or org UUID is ever rendered or asserted. 12.12 scans the
 *   PAINTED TEXT of every Dristi screen for one, because
 *   `check-rendered-ids.mjs` is static and positional and cannot see an id the
 *   server pre-formatted into a string. ⚠ `/v1/dristi/sales`'s leaderboard
 *   returns `salesperson_id` on the wire; `SalesTab` renders only `name`, and
 *   12.12 proves the id does not reach the screen.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite12.config.ts
 */
import { test, expect, Page, Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { lane, signInAs as laneSignIn, assertOrg, ORG as ORG_IDS } from './_lanes';
import { isForeignInlineScriptRefusal } from './_helpers';
import { S12_DL } from './suite12.config';

const LANE = lane('unicode');
const API = process.env.E2E_API_URL || 'https://api.kartavaya.com';

const BLOCKED =
  'BLOCKED — no Unicode Group credential. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e at the repo root. ⚠ It must be an ' +
  'ORG-SCOPED account: a platform_admin token resolves to Aekam Inc via ' +
  'platform_bypass and will write there. ENVIRONMENT blocker, not a product ' +
  'or test defect.';

/** The suite's own mark. Deterministic — §6 idempotence hangs off it. */
const TAG = 'S12';

/** The protected Aekam Inc team inside Unicode (93 §12). READ, never written. */
const PROTECTED_TEAM = 'team_ae1d58543b21';

// ── §4 VOLUMES, stated once ─────────────────────────────────────────────────
const N_REPORT_TYPES = 18;      // report types run
const N_RUNS = 40;              // report runs including window changes
const N_EXPORTS = 36;           // exports downloaded
const N_DASHBOARDS = 4;
const N_WIDGETS = 18;
const N_VIEWS = 6;
const N_PIVOTS = 5;
const N_CLIENT_REPORTS = 6;
const N_ALERTS = 4;
const N_BREACHED = 2;
const N_SCHEDULES = 2;
const N_DISPATCHES = 2;
const N_RECONCILED = 60;

/**
 * The ONLY addresses this suite may cause a message to reach.
 *
 * The brief's list, verbatim, as a pattern. ⚠ `kevalvshah03@gmail.com` without
 * a plus-tag is the owner's own mailbox and IS admitted; `@example.com` is not
 * admitted under any circumstance — it is IANA-reserved and hard-bounces by
 * definition, on the SES account that sends real invoices.
 */
const ALLOWED =
  /^(?:[^@\s]+@simulator\.amazonses\.com|kevalvshah03(?:\+[^@\s]*)?@gmail\.com|kelisweet(?:\+[^@\s]*)?@gmail\.com|[^@\s]+@unicodegroup\.com)$/i;

/** The one recipient every schedule this suite books is addressed to. */
const RECIPIENT = (process.env.E2E_UNICODE_EMAIL || 'kevalvshah03+1@gmail.com').toLowerCase();

// ════════════════════════════════════════════════════════════════════════════
// A FILE-BACKED LEDGER
//
// ⚠ Playwright starts a NEW WORKER after a failed test, and a new worker
// re-imports this module — every module-level `let` goes back to its initial
// value. Two agents were caught by that on 2026-08-29; one had a test PASS on a
// defect it had just measured, because the counter it asserted against had been
// reset between the measurement and the assertion. Anything 12.12 has to report
// therefore lives on disk.
// ════════════════════════════════════════════════════════════════════════════
const LEDGER = path.join(os.tmpdir(), 'kartavya-e2e-suite12', 'ledger.json');

type Ledger = {
  runs?: number;
  exports?: string[];
  reportTypes?: string[];
  reconciled?: { name: string; left: string; right: string; ok: boolean }[];
  [k: string]: any;
};

function ledgerRead(): Ledger {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return {}; }
}
function ledgerWrite(patch: Ledger) {
  const cur = ledgerRead();
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify({ ...cur, ...patch }, null, 2));
}
/** Append to a named list in the ledger, de-duplicated. */
function ledgerAdd(key: string, ...items: string[]) {
  const cur = ledgerRead();
  const set = new Set<string>([...(cur[key] || []), ...items]);
  ledgerWrite({ [key]: [...set] });
}
function ledgerBump(key: string, by = 1) {
  const cur = ledgerRead();
  ledgerWrite({ [key]: Number(cur[key] || 0) + by });
}

// ════════════════════════════════════════════════════════════════════════════
// SIGN IN — the lane, then the guard, then the guard again
// ════════════════════════════════════════════════════════════════════════════

async function signIn(page: Page) {
  await laneSignIn(page, LANE);
  await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), LANE.orgId);
  await assertOrg(page.request, page, LANE);
  expect(LANE.orgId, 'the lane must be Unicode Group').toBe(ORG_IDS.UNICODE);
  expect(LANE.orgId, 'the lane must never be Aekam Inc').not.toBe(ORG_IDS.AEKAM);
}

// ════════════════════════════════════════════════════════════════════════════
// READ-BACK — GET only, and always with X-Org-Id
// ════════════════════════════════════════════════════════════════════════════

async function apiGet(page: Page, pathAndQuery: string) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  return page.request.get(`${API}${pathAndQuery}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Org-Id': LANE.orgId,
    },
  });
}

async function apiOne(page: Page, pathAndQuery: string): Promise<any> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 400)}`)
    .toBeLessThan(400);
  const body = await res.json();
  return body?.data ?? body;
}

/**
 * The WHOLE body, unwrapped by nothing.
 *
 * ⚠ `apiOne` unwraps `{data: …}`, which is right for the envelope endpoints and
 * WRONG for `/v1/analytics/run`: its payload IS `{metric, label, unit, grain,
 * window, as_of, data: [...]}`, so `apiOne` would hand back the ROW ARRAY and
 * every `payload.unit` / `payload.window` read would be undefined — and
 * `sum(payload)` would quietly answer 0 for every metric in the suite. A
 * reconciliation that compares a real figure against a silent zero fails, and
 * the failure would have read as a product defect. Anything that needs the
 * envelope's own fields uses this instead.
 */
async function apiRaw(page: Page, pathAndQuery: string): Promise<any> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 400)}`)
    .toBeLessThan(400);
  return await res.json();
}

/** The rows of a list endpoint, whichever envelope it answers with. */
async function apiRows(page: Page, pathAndQuery: string): Promise<any[]> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 400)}`)
    .toBeLessThan(400);
  const body = await res.json();
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

/** The WHOLE envelope, because `total` and `truncated` are the load-bearing part. */
async function apiEnvelope(page: Page, pathAndQuery: string): Promise<any> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 400)}`)
    .toBeLessThan(400);
  return await res.json();
}

/**
 * `POST /v1/dristi/query` — the pivot engine, used here as a CANONICAL
 * AGGREGATE and never as a list to be summed.
 *
 * ══ WHY A POST IS PERMITTED HERE, AND THE EVIDENCE FOR IT ══════════════════
 *
 * Rule 1 forbids a suite from posting, and `frontend/scripts/check-e2e-no-bypass.mjs`
 * enforces it. This call is a NAMED, ENFORCED exemption in that script's
 * `READ_ONLY_QUERY_ENDPOINTS`, and the exemption rests on a measurement rather
 * than on a reading:
 *
 *   · **Source.** `routers/dristi.py::run_pivot_query` spans lines 1682–1848
 *     and its body contains `pool.fetch` and `pool.fetchrow` and NOTHING ELSE
 *     — no `INSERT`, no `UPDATE`, no `DELETE FROM`, no `pool.execute`, no audit
 *     or log call.
 *   · **Measured live, 2026-08-29.** `pg_stat_user_tables.n_tup_ins` — the
 *     server's own cumulative INSERT counter — was snapshotted across all 174
 *     tables in `staging` and `public` that have ever taken a row; 40 successful
 *     `POST /api/v1/dristi/query` calls were fired across four sources; the
 *     counter was re-read. **Zero tables moved.** Row counts on `audit_log`,
 *     `activity_events`, `niyam_events`, `outbound_log`, `dristi_report_logs`,
 *     `analytics_views`, `dristi_dashboards` and `analytics_metrics_daily` were
 *     also identical before and after.
 *
 * So this endpoint AUTHORS NOTHING. The rule's own sentence is the test — "a
 * row created by SQL proves the table exists, and only a row created by a click
 * proves the product works" — and a POST that creates no row is not a shortcut
 * past a click. It is a read whose request happens to be a body (source,
 * dimension, measure, dates) rather than a query string.
 *
 * ⚠ AND THE ROWS §4 COUNTS ARE NOT MADE HERE. "Report types run" and "report
 * runs" are not rows at all — nothing is written by running a report — and
 * every ROW this suite is credited with (4 dashboards, 18 widgets, 6 views, 4
 * alerts, 2 schedules) is typed into a form and asserted from its own canonical
 * endpoint. 12.06 drives THIS engine through the Pivot screen, by pressing Run
 * query, which is where the "typed by a user" requirement actually lands. This
 * helper exists only so a reconciliation can ask the server for a total instead
 * of adding up a page that caps at 200.
 *
 * ⚠ THE BODY IS SPELLED OUT, FIELD BY FIELD, ON PURPOSE. The ratchet checks the
 * keys of the object literal at this call site against the six the query
 * endpoint accepts, so a caller cannot smuggle a field that would author
 * something through a helper that takes `Record<string, any>`. Passing `body`
 * straight through would make those keys invisible to the check and the
 * exemption would be a hole rather than a rule.
 */
type PivotAsk = {
  source: string;
  group_by?: string;
  group_by2?: string;
  measure: string;
  date_from?: string;
  date_to?: string;
};

async function query(page: Page, ask: PivotAsk): Promise<any> {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const res = await page.request.post(`${API}/api/v1/dristi/query`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Org-Id': LANE.orgId,
      'Content-Type': 'application/json',
    },
    data: {
      source: ask.source,
      group_by: ask.group_by ?? '',
      group_by2: ask.group_by2 ?? '',
      measure: ask.measure,
      date_from: ask.date_from ?? '',
      date_to: ask.date_to ?? '',
    },
  });
  expect(res.status(), `POST /query ${JSON.stringify(ask)} → ${res.status()}: ${(await res.text()).slice(0, 400)}`)
    .toBeLessThan(400);
  return (await res.json()).data;
}

/** The five-year span `_shared.explicitBounds` resolves "All time" to. */
function explicitBounds() {
  const iso = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 1826);
  return { from: iso(start), to: iso(today) };
}

// ════════════════════════════════════════════════════════════════════════════
// RECONCILIATION — collected, then asserted once, so one mismatch cannot hide
// the other fifty-nine
// ════════════════════════════════════════════════════════════════════════════

type Pair = { name: string; left: string; right: string; ok: boolean };

class Recon {
  rows: Pair[] = [];

  /**
   * Two figures that must be the same figure.
   *
   * Both sides are passed as already-fetched numbers, and every caller fetches
   * them back to back — the org is being written to by other agents while this
   * runs, so a comparison against a value read ten minutes ago is a comparison
   * against a different organisation.
   *
   * `tol` is in the unit of the figures. Money is compared to the paise (0.005)
   * because these are rupee sums, not floats anyone rounds; counts to 0.
   */
  eq(name: string, leftLabel: string, left: number, rightLabel: string, right: number, tol = 0.005) {
    const l = Number(left);
    const r = Number(right);
    const ok = Number.isFinite(l) && Number.isFinite(r) && Math.abs(l - r) <= tol;
    this.rows.push({
      name,
      left: `${leftLabel} = ${l}`,
      right: `${rightLabel} = ${r}`,
      ok,
    });
    return ok;
  }

  get bad() { return this.rows.filter((p) => !p.ok); }

  report(prefix: string) {
    const lines = this.rows.map((p) =>
      `     ${p.ok ? '✓' : '✗'} ${p.name}\n         ${p.left}\n         ${p.right}`);
    return `\n  ${prefix} — ${this.rows.length - this.bad.length}/${this.rows.length} reconciled\n${lines.join('\n')}\n`;
  }

  /** Push every pair into the file ledger, then fail once with the whole list. */
  settle(prefix: string) {
    const cur = ledgerRead();
    ledgerWrite({ reconciled: [...(cur.reconciled || []), ...this.rows] });
    console.log(this.report(prefix));
    expect(
      this.bad.map((p) => `\n     ${p.name}\n         ${p.left}\n         ${p.right}`).join(''),
      `${this.bad.length} of ${this.rows.length} figures do NOT reconcile to their module. ` +
      'Each line is two readings taken back to back of what must be one number:',
    ).toBe('');
  }
}

/**
 * Sum a list ONLY when the server says the list is whole.
 *
 * ⚠ SUITE RULE 4. Every list endpoint here caps at 200 rows whatever limit is
 * asked, and summing one gave ₹1.06 Cr against a true ₹3.58 Cr. This refuses to
 * add anything up unless the envelope itself attests that nothing was cut:
 * `truncated === false` AND `total === data.length`. Where that does not hold,
 * the caller must find a server-side aggregate instead — there is no "close
 * enough" branch, deliberately.
 */
function sumOfWholeList(envelope: any, field: string, what: string): number {
  const rows: any[] = Array.isArray(envelope) ? envelope : (envelope?.data || []);
  const total = Array.isArray(envelope) ? rows.length : envelope?.total;
  expect(envelope?.truncated,
    `${what}: the list is TRUNCATED, so summing it would answer a smaller question ` +
    '(suite rule 4 — summing a capped list gave ₹1.06 Cr against a true ₹3.58 Cr). ' +
    'Use a server-side aggregate.').not.toBe(true);
  expect(Number(total),
    `${what}: the envelope reports total=${total} against ${rows.length} rows returned — ` +
    'the page is not the whole list and must not be summed').toBe(rows.length);
  return rows.reduce((a, r) => a + (Number(r?.[field]) || 0), 0);
}

// ════════════════════════════════════════════════════════════════════════════
// THE CONSOLE, PER SCREEN
//
// `pageerror` is an UNCAUGHT exception and is asserted at zero — that is §1's
// requirement and it is not negotiable. `console.error` is collected beside it
// and asserted separately, so a failure says which of the two happened rather
// than leaving the next reader to guess.
// ════════════════════════════════════════════════════════════════════════════

type Watcher = { errors: { where: string; text: string }[]; at: (w: string) => void };

function watchConsole(page: Page): Watcher {
  const errors: { where: string; text: string }[] = [];
  let where = 'boot';
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Cloudflare's `__CF$cv$` loader carries a per-request token, so its hash
    // differs every load and can never be allowed by hash. CLASSIFIED, not
    // ignored: a refusal of OUR bootstrap still fails. See _helpers.
    if (isForeignInlineScriptRefusal(m.text())) return;
    errors.push({ where, text: m.text().slice(0, 240) });
  });
  page.on('pageerror', (e) => {
    errors.push({ where, text: `UNCAUGHT ${String((e as any)?.message ?? e).slice(0, 240)}` });
  });
  return { errors, at: (w: string) => { where = w; } };
}

const dumpConsole = (c: Watcher) =>
  c.errors.map((e) => `\n     [${e.where}] ${e.text}`).join('') || '\n     (none)';

function assertNoUncaught(c: Watcher) {
  const uncaught = c.errors.filter((e) => e.text.startsWith('UNCAUGHT'));
  expect(uncaught, `uncaught exception(s) on screen:${dumpConsole(c)}`).toHaveLength(0);
}

// ════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════════════════════════

/** The ten tab ids `DristiPage` can show, and the label each renders. */
const TABS: [string, string][] = [
  ['overview', 'Overview'],
  ['revenue', 'Revenue'],
  ['pipeline', 'Pipeline'],
  ['hr', 'HR'],
  ['sales', 'Sales'],
  ['reports', 'Reports'],
  ['dashboards', 'Dashboards'],
  ['pivot', 'Pivot'],
  ['analytics', 'Analytics'],
  ['clients', 'Clients'],
];

const panel = (page: Page, id: string) => page.locator(`#mt-panel-${id}`);

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
}

/**
 * Open Dristi and switch to one tab, wherever `ModuleTabs` has put it.
 *
 * `DristiPage` holds its tab in LOCAL STATE and reads `?tab=` only once at
 * mount, so navigating by URL inside the SPA goes nowhere — the strip button is
 * the control a person uses and is the control this drives. Which of the ten
 * are inline is measured at runtime from the strip's own width, so the More
 * popover is not an edge case, it is the normal path for the last few.
 *
 * A tab that is in NEITHER place is unreachable, which is a product finding and
 * not a selector problem, and the message says so.
 */
async function openTab(page: Page, id: string, label: string): Promise<Locator> {
  if (!/\/dristi/.test(new URL(page.url()).pathname)) {
    await page.goto('/dristi');
  }
  const strip = page.locator('.mt__wrap');
  await expect(strip, 'the Dristi tab strip never rendered').toBeVisible({ timeout: 60_000 });

  const already = panel(page, id);
  if (await already.count() && await already.isVisible().catch(() => false)) {
    await settle(page);
    return already;
  }

  const inline = page.locator(`#mt-tab-${id}`);
  if (await inline.count()) {
    await inline.click();
  } else {
    const more = strip.locator('button.mt__more');
    await expect(more, `tab "${label}" is not inline and there is no More menu to look in`)
      .toBeVisible();
    await more.click();
    const menu = strip.locator('[role="menu"]');
    await expect(menu, 'the More popover did not open').toBeVisible();
    const row = menu.locator('button[role="menuitem"]', { hasText: new RegExp(`^\\s*${label}`, 'i') });
    await expect(row.first(),
      `tab "${label}" is neither on the strip nor in the More menu — it is UNREACHABLE, ` +
      'which is a product finding and not a selector problem')
      .toBeVisible();
    await row.first().click();
  }

  await expect(panel(page, id), `the "${label}" panel never rendered after the tab was clicked`)
    .toBeVisible({ timeout: 45_000 });
  await settle(page);
  return panel(page, id);
}

/**
 * Which tabs the strip is offering right now — the entitlement answer.
 *
 * Inline first, then the tail behind "More +N", read in ONE opening of the
 * popover: which of the ten are inline is measured from the strip's own client
 * width, so the split is not knowable from the source and both places have to
 * be looked in. The popover is closed by clicking More again — its own toggle —
 * rather than by Escape, because a keypress that the component does not handle
 * leaves it open and every later locator resolves inside it.
 */
async function tabsOffered(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const [id] of TABS) {
    if (await page.locator(`#mt-tab-${id}`).count()) out.push(id);
  }
  if (out.length === TABS.length) return out;

  const more = page.locator('.mt__wrap button.mt__more');
  if (!(await more.count())) return out;
  await more.click();
  const menu = page.locator('.mt__wrap [role="menu"]');
  await expect(menu, 'the More popover did not open').toBeVisible();
  const tail = (await menu.locator('button[role="menuitem"] .mt__pop-en').allTextContents())
    .map((t) => t.trim().toLowerCase());
  await more.click();
  await expect(menu, 'the More popover did not close again').toBeHidden();

  for (const [id, label] of TABS) {
    if (out.includes(id)) continue;
    if (tail.includes(label.toLowerCase())) out.push(id);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// FORM MECHANICS
// ════════════════════════════════════════════════════════════════════════════

/**
 * One labelled field, found by ITS OWN LABEL and not by its contents.
 *
 * ⚠ `locator('label', { hasText: 'Source' })` matches a label whose SUBTREE
 * contains that text — and a `<label>` here wraps its `<select>`, so every
 * OPTION inside counts. On the Pivot tab that is not hypothetical: the
 * `contacts` source has a column called `source`, so once that source is
 * chosen the Rows and Columns selects both contain the word and the locator
 * resolves to three elements and dies in strict mode. Measured on this suite's
 * fifth pivot.
 *
 * The label word lives alone in `span.fld__l`, so that is what gets matched,
 * anchored, and the field is the label that contains it.
 */
function field(scope: Locator, page: Page, name: string): Locator {
  return scope.locator('label.fld').filter({
    has: page.locator('span.fld__l').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }),
  }).first();
}

/**
 * Type into a controlled React input the way a person does.
 * `fill('')` does not register with a controlled input — React never sees the
 * change and the box repaints with its old value — so clearing is done by
 * selecting the existing text and typing over it.
 */
async function typeInto(input: Locator, value: string) {
  await input.click();
  await input.press('ControlOrMeta+a');
  if (value === '') { await input.press('Backspace'); return; }
  await input.fill(value);
}

/**
 * Click something that writes, and return what the server actually stored.
 * A toast is the client's opinion; the response is what happened.
 */
async function saveAndWait(
  page: Page,
  act: () => Promise<void>,
  urlRe: RegExp,
  what: string,
  methods: string[] = ['POST', 'PUT', 'PATCH', 'DELETE'],
) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => urlRe.test(r.url()) && methods.includes(r.request().method()),
      { timeout: 90_000 }),
    act(),
  ]);
  const body = await res.text().catch(() => '');
  expect(res.status(),
    `${what}: ${res.request().method()} ${new URL(res.url()).pathname} → ${res.status()}\n     ${body.slice(0, 500)}`)
    .toBeLessThan(400);
  try { return JSON.parse(body); } catch { return {}; }
}

/**
 * Set a `<DateInput>` located by its ARIA LABEL, the way a person does — open
 * the calendar and click the day.
 *
 * `_helpers.setDate` finds the field through a wrapping `<label>` element; the
 * WindowBar's two date fields have no wrapping label at all, only
 * `aria-label="From date"` / `"To date"` on the trigger. `getByRole(name)`
 * matches the accessible name, and the popover carries the SAME aria-label as
 * `role="dialog"`, which is what makes the two findable as a pair without
 * guessing at DOM adjacency.
 *
 * ⚠ If the popover does not appear, say so as a DateInput failure rather than
 * as "the window did not change" — the known open bug (the popover is
 * unclickable inside a `<Modal>`; `elementFromPoint` at its Clear button
 * returns `div.modal__scrim`) has this exact signature, and Dristi's date
 * fields are on the page rather than in a modal, so seeing it HERE would be
 * new information.
 */
async function setDateAria(page: Page, scope: Locator, aria: string, iso: string) {
  const trigger = scope.locator(`button.pk__tr[aria-label="${aria}"]`).first();
  await expect(trigger,
    `no DateInput with aria-label "${aria}". ⚠ getByRole matches the ACCESSIBLE name, ` +
    'and this control renders no visible text of its own — a missing trigger here is a ' +
    'MISSING CONTROL, not a selector miss').toBeVisible();
  await trigger.click();

  const pop = page.getByRole('dialog', { name: aria });
  await expect(pop,
    `the "${aria}" calendar did not open. If this is a DateInput popover that mounted but ` +
    'cannot be reached, that is the filed non-portalling bug — and Dristi\'s date fields are ' +
    'NOT inside a Modal, so seeing it here is new').toBeVisible();

  const want = new Date(`${iso}T00:00:00`);
  const title = `${want.toLocaleString('en-GB', { month: 'long' })} ${want.getFullYear()}`;
  for (let i = 0; i < 26; i++) {
    const shownText = (await pop.locator('.pk__calt').innerText()).trim();
    if (shownText === title) break;
    const shown = new Date(`${shownText} 1`);
    await pop.getByRole('button', { name: shown < want ? 'Next month' : 'Previous month' }).click();
  }
  expect((await pop.locator('.pk__calt').innerText()).trim(),
    `the "${aria}" calendar never reached ${title}`).toBe(title);

  await pop.locator('.pk__d:not(.out)', { hasText: new RegExp(`^${want.getDate()}$`) }).first().click();
  await expect(pop).toBeHidden();
}

/**
 * Choose an option by its VISIBLE TEXT from a `<select>` a fetch fills in.
 *
 * Reading the options straight after `settle()` catches the empty mount and
 * reports "no clients to pick" against an org holding twenty-six — a false
 * product finding, which is worse than a flake (suite rule 5). Polls, matches
 * on the option TEXT, then selects by the option's `value`, which is an id and
 * is never rendered or asserted.
 */
async function pickByLabel(select: Locator, label: string | RegExp, what: string): Promise<string> {
  await expect.poll(async () => await select.locator('option').count(), {
    message: `the ${what} picker never loaded any options`,
    timeout: 30_000,
  }).toBeGreaterThan(1);

  const hit = (t: string) => (typeof label === 'string' ? t.includes(label) : label.test(t));
  const texts = await select.locator('option').allTextContents();
  const idx = texts.findIndex(hit);
  expect(idx, `no ${what} option matching ${label}; saw: ${texts.slice(0, 10).join(' | ')}`)
    .toBeGreaterThan(-1);
  const value = await select.locator('option').nth(idx).getAttribute('value');
  await select.selectOption(value!);
  return value!;
}

/**
 * Assert a download happens, save it, and hand back the bytes.
 *
 * §1 names "a 200 with an empty body" as the failure to catch, so an export
 * that produces no FILE — or a file of nothing — fails here rather than being
 * counted as a successful export.
 */
async function download(page: Page, trigger: () => Promise<void>, name: string): Promise<Buffer> {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), trigger()]);
  const dest = path.join(S12_DL, name);
  await dl.saveAs(dest);
  const buf = fs.readFileSync(dest);
  expect(buf.length,
    `${name} downloaded as an EMPTY file — §1's "a 200 with an empty body" is exactly this`)
    .toBeGreaterThan(20);
  ledgerAdd('exports', name);
  return buf;
}

/** Rows of a CSV, split on commas outside quotes. Small and sufficient here. */
function csvRows(buf: Buffer): string[][] {
  return buf.toString('utf8').split(/\r?\n/).map((line) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') { q = !q; continue; }
      if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  });
}

/** The first CSV row whose first cell is `key`, or null. */
const csvFind = (rows: string[][], key: string) =>
  rows.find((r) => (r[0] || '').trim() === key) || null;

// ════════════════════════════════════════════════════════════════════════════
// MAIL — the fence, enumerated
// ════════════════════════════════════════════════════════════════════════════

/**
 * Every address named here must be one this suite is permitted to reach.
 *
 * ⚠ NOT A SAMPLE. The whole list is checked and the whole list is printed in
 * the failure message, because the brief's instruction is "ENUMERATE every
 * recipient and assert each is [allowlisted] … Do not sample. If one falls
 * outside, STOP and report."
 *
 * `outbound_mode` on staging is `live` and nothing is suppressed, and two of
 * Unicode's own member rows (`aekaminc1@gmail.com`, `aekaminc1+org@gmail.com`)
 * are outside the allowlist — so this is the assertion that stands between a
 * test and somebody's real inbox.
 */
function assertRecipientsFenced(where: string, addresses: string[]) {
  expect(addresses.length, `${where}: no recipients at all to check — a fence over an ` +
    'empty list proves nothing').toBeGreaterThan(0);
  const outside = addresses.filter((a) => !ALLOWED.test(String(a || '').trim()));
  expect(outside,
    `${where}: ${outside.length} recipient(s) fall OUTSIDE the permitted set. ` +
    `staging is outbound_mode=live and nothing is suppressed, so this would be a real send.\n` +
    `     asked to mail : ${addresses.join(', ')}\n` +
    `     outside       : ${outside.join(', ')}\n` +
    '     permitted     : *@simulator.amazonses.com · kevalvshah03+*@gmail.com · ' +
    'kelisweet+*@gmail.com · *@unicodegroup.com')
    .toEqual([]);
}

// ════════════════════════════════════════════════════════════════════════════
// THE SUITE
// ════════════════════════════════════════════════════════════════════════════

test.describe('Suite 12 · Dristi — reports, analytics, and every figure tied to its module', () => {
  test.beforeAll(() => {
    expect(Boolean(LANE.token || (LANE.email && LANE.password)), BLOCKED).toBeTruthy();
  });

  // ──────────────────────────────────────────────────────────────────────────
  test('12.01 every Dristi screen renders, says what it is showing, and the console is clean',
    async ({ page }) => {
      const con = watchConsole(page);
      await signIn(page);

      // §12 — the protected set, captured BEFORE anything else happens. 12.12
      // re-reads it and compares. ⚠ 19, not 20: one of the twenty is archived
      // and `GET /api/tasks` excludes archived rows. Stated, not papered over.
      const protectedBefore = await apiRows(page, `/api/tasks?team_id=${PROTECTED_TEAM}`);
      const digestBefore = createHash('md5')
        .update(protectedBefore.map((t: any) => t.task_id).sort().join(','))
        .digest('hex');
      ledgerWrite({
        protectedCountBefore: protectedBefore.length,
        protectedDigestBefore: digestBefore,
      });
      expect(protectedBefore.length,
        'the protected Aekam Inc team inside Unicode holds no unarchived tasks — 93 §12 ' +
        'guarantees this set, and a suite that cannot see it cannot prove it survived')
        .toBeGreaterThan(0);

      con.at('/dristi');
      await page.goto('/dristi');
      await expect(page.locator('.mt__wrap'), 'the Dristi tab strip never rendered')
        .toBeVisible({ timeout: 60_000 });

      // ⚠ TWO OF THE TEN TABS ARE CONDITIONAL, AND THEY ARRIVE LATE. `analytics`
      // appears only when `/v1/analytics/catalogue` comes back listing a ganit
      // metric, and `clients` only when it lists a graha one — both set state in
      // a `useEffect`, so the strip paints EIGHT tabs first and grows to ten a
      // moment later. Reading the strip the instant it becomes visible reports
      // the two as missing and files an entitlement defect against a render
      // order: suite rule 5, "poll selects that a fetch populates".
      //
      // Polled, so a tab that never arrives is still a FAILURE and a tab that
      // arrives in 400ms is not one.
      let offered: string[] = [];
      await expect.poll(async () => {
        offered = await tabsOffered(page);
        return offered.length;
      }, {
        message: 'the Dristi tab strip never grew to its full set — `analytics` and `clients` ' +
          'are gated on the catalogue listing a ganit / graha metric, so a permanent gap is an ' +
          'ENTITLEMENT finding',
        timeout: 45_000,
      }).toBe(TABS.length);
      const missing = TABS.map(([id]) => id).filter((id) => !offered.includes(id));
      expect(missing,
        `Dristi is not offering ${missing.length} of its ten tabs: ${missing.join(', ')}. ` +
        '`analytics` and `clients` are gated on the catalogue listing a ganit / graha metric, ' +
        'so a gap here is an ENTITLEMENT finding — this account is org_admin on Unicode and ' +
        'every module except varta reads active=true')
        .toEqual([]);

      const seen: string[] = [];
      for (const [id, label] of TABS) {
        con.at(`tab:${id}`);
        const p = await openTab(page, id, label);
        // ⚠ POLLED, NOT READ ONCE. `TabState` renders a `<Shimmer>` while the
        // fetch is in flight and a shimmer carries NO TEXT, so reading
        // `innerText` the instant the panel becomes visible reports an empty
        // screen against a tab that is merely still loading — and would have
        // filed "the Revenue tab paints nothing" as a product defect. A panel
        // that never gains text is still a FAILURE: that is the state a person
        // cannot tell from a broken one.
        await expect.poll(
          async () => (await p.innerText()).replace(/\s+/g, ' ').trim().length,
          {
            message: `the "${label}" tab painted NOTHING within 45s. A blank panel is ` +
              'indistinguishable from a broken one, which is the §1 empty-state requirement ' +
              'stated the other way round — an empty screen must SAY it is empty, in words',
            timeout: 45_000,
          }).toBeGreaterThan(0);
        const text = (await p.innerText()).replace(/\s+/g, ' ').trim();
        // A tab that renders only a spinner for ever is the defect `_shared.jsx`
        // exists to name ("a failed fetch must never render as an empty state").
        await expect(p.locator('.note--warn'),
          `the "${label}" tab is showing an error card: ${text.slice(0, 200)}`)
          .toHaveCount(0);
        seen.push(`${label.padEnd(11)} ${text.slice(0, 110)}`);
      }

      // Screen 7 and 8 — the schedule create and detail views are inside the
      // Reports tab and are reached by its own buttons, not by a tab.
      con.at('tab:reports/create');
      const reports = await openTab(page, 'reports', 'Reports');
      const schedule = reports.getByRole('button', { name: /Schedule (a )?report/i }).first();
      await expect(schedule,
        'the Reports tab offers no way to schedule a report — §4 asks for 2 scheduled ' +
        'reports and this is the only door').toBeVisible();
      await schedule.click();
      await expect(reports.getByText('Schedule a report'),
        'the schedule form did not open').toBeVisible();
      await expect(field(reports, page, 'Recipients').locator('textarea'),
        'the schedule form has no recipients box').toBeVisible();
      await expect(reports.locator(`button.pk__tr`).first(),
        'the schedule form has no DateInput time field — §4\'s window changes are date-driven ' +
        'and a native <input type="date"> is forbidden product-wide').toBeVisible();
      seen.push('Reports/create  the schedule form, with a DateInput time field');
      await reports.getByRole('button', { name: /^Cancel$/ }).click();

      // Screen 9 — the export panel.
      await expect(reports.getByText('Export data'),
        'the Reports tab offers no Export panel — §4 asks for 36 exports').toBeVisible();
      seen.push('Reports/export  the five server-rendered CSV chips');

      // Screen 12/13 — the analytics board only exists under a view. Its own
      // arrival state is the bespoke finance arrangement, which is a different
      // screen and is asserted here too.
      con.at('tab:analytics');
      const anx = await openTab(page, 'analytics', 'Analytics');
      await expect(anx.locator('.vb'),
        'the Analytics tab renders no views bar — saved views and presets are §4 lines')
        .toBeVisible();
      await expect(anx.getByRole('button', { name: /Customise/ }),
        'the views bar offers no Customise — §4 asks for 6 saved views and this is the door')
        .toBeVisible();
      await expect(anx.locator('.anx-card').filter({ hasText: 'Alerts' }).first(),
        'the Analytics tab renders no Alerts panel — §4 asks for 4 alerts').toBeVisible();
      // `EmailWeekly` — asserted present, deliberately not clicked (see header).
      const weekly = anx.getByRole('button', { name: /Email me this weekly|Stop( my copy)?$/ });
      seen.push(`Analytics       views bar · alerts panel · weekly-email offer ${await weekly.count() ? 'present' : 'ABSENT'}`);

      console.log(`\n  12.01 — the fourteen Dristi screens:\n     ${seen.join('\n     ')}\n` +
        `     protected set: ${protectedBefore.length} unarchived tasks on ${PROTECTED_TEAM}, ` +
        `digest ${digestBefore}\n`);

      assertNoUncaught(con);
      expect(con.errors, `console.error while walking every Dristi screen:${dumpConsole(con)}`)
        .toHaveLength(0);
    });

  // ──────────────────────────────────────────────────────────────────────────
  test('12.02 the reporting period — nine presets and a custom range, each one re-running the page',
    async ({ page }) => {
      const con = watchConsole(page);
      await signIn(page);

      // Every request the page makes for a windowed figure, with its dates.
      const wire: string[] = [];
      page.on('response', (r) => {
        const u = r.url();
        if (!/\/api\/v1\/(dristi|analytics)\//.test(u)) return;
        if (r.request().method() !== 'GET') return;
        wire.push(new URL(u).pathname + new URL(u).search);
      });

      await page.goto('/dristi');
      const bar = page.locator('.dwin');
      await expect(bar, 'the reporting-period bar never rendered — it is the control every one ' +
        'of the fourteen screens reads through').toBeVisible({ timeout: 60_000 });

      const PRESETS = ['All time', 'Last 30 days', 'Last 90 days', 'This month', 'Last month',
        'This quarter', 'FY to date', 'Last 12 months'];

      // Assert the count BEFORE iterating — a loop over an empty list passes
      // for ever, which is how 02.3 shipped a vacuous assertion.
      const buttons = bar.locator('.dwin__presets button');
      expect(await buttons.count(),
        'the period bar offers fewer than the nine presets `WINDOW_PRESETS` declares')
        .toBeGreaterThanOrEqual(9);

      let runs = 0;
      const shown: string[] = [];
      for (const label of PRESETS) {
        con.at(`window:${label}`);
        const before = wire.length;
        const b = bar.getByRole('button', { name: label, exact: true });
        await expect(b, `the period bar offers no "${label}" preset`).toBeVisible();
        await b.click();
        await expect(b, `"${label}" did not become the selected period`)
          .toHaveAttribute('aria-pressed', 'true');
        // The bar states the span in words; that sentence is what a reader
        // relies on to know which dates a figure covers.
        const note = (await bar.locator('.dwin__note').innerText()).replace(/\s+/g, ' ').trim();
        expect(note.length, `the period bar says nothing about what "${label}" is showing`)
          .toBeGreaterThan(10);
        await expect.poll(() => wire.length, {
          message: `choosing "${label}" fired no read at all — the period changed on screen and ` +
            'nothing was re-run, which means the figures below it are from the previous window',
          timeout: 30_000,
        }).toBeGreaterThan(before);
        runs += wire.length - before;
        shown.push(`${label.padEnd(15)} ${note.slice(0, 90)}`);
      }

      // ── The custom range, through DateInput ────────────────────────────────
      // §4's window changes are date-driven, and this is the one place in Dristi
      // where a person types a date rather than picking a preset.
      con.at('window:custom');
      const before = wire.length;
      await bar.getByRole('button', { name: 'Custom…', exact: true }).click();
      const custom = bar.locator('.dwin__custom');
      await expect(custom, 'choosing "Custom…" revealed no date fields').toBeVisible();

      const today = new Date();
      const from = new Date(today); from.setDate(from.getDate() - 45);
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await setDateAria(page, custom, 'From date', iso(from));
      await setDateAria(page, custom, 'To date', iso(today));

      await expect.poll(() => wire.filter((u) => u.includes(`date_from=${iso(from)}`)).length, {
        message: `the custom range ${iso(from)} → ${iso(today)} never reached the wire. ` +
          'Either the window did not commit or the reads are not carrying it — and a figure ' +
          'drawn under a period it did not use is exactly this suite\'s subject',
        timeout: 30_000,
      }).toBeGreaterThan(0);
      runs += wire.length - before;
      shown.push(`Custom…         ${iso(from)} → ${iso(today)}, typed through DateInput`);

      // The end-before-start guard: the bar must SAY so rather than firing a
      // request for a negative window.
      const earlier = new Date(today); earlier.setDate(earlier.getDate() - 400);
      await setDateAria(page, custom, 'To date', iso(earlier));
      const guard = (await bar.locator('.dwin__note').innerText()).trim();
      expect(guard,
        'a To date before the From date is accepted silently — the bar states no problem')
        .toMatch(/end date is before the start date/i);
      shown.push('Custom… (bad)   the end-before-start case is stated in words');

      ledgerBump('runs', runs);
      console.log(`\n  12.02 — nine periods and a custom range; ${runs} windowed reads fired ` +
        `(§4 wants ${N_RUNS} runs including window changes, counted across 12.02/12.03/12.06/12.09)\n     ` +
        shown.join('\n     ') + '\n');

      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  test('12.03 every report type in the catalogue runs against real data',
    async ({ page }) => {
      const con = watchConsole(page);
      await signIn(page);

      // ⚠ THIS IS AN API SWEEP AND IT IS LABELLED AS ONE.
      // §4 asks that "every report in the catalogue" runs at least once. The
      // catalogue holds 107 metric declarations and NO SCREEN IN THIS PRODUCT
      // RUNS ALL OF THEM — a board caps at nine widgets. Driving nine and
      // calling the line met would be the silent cap §10 warns about, so the
      // whole catalogue is swept here through the same `/run` the widgets call,
      // and the SCREENS that run reports are driven in 12.01/12.02/12.06/12.09.
      const cat = await apiOne(page, '/api/v1/analytics/catalogue');
      const metrics: any[] = cat?.metrics || [];
      expect(metrics.length,
        'the analytics catalogue is empty for an org_admin on Unicode — every report type ' +
        'this module can run comes from here').toBeGreaterThan(20);

      const runnable = metrics.filter((m) => !m.absent);
      const absent = metrics.filter((m) => m.absent);
      const { from, to } = explicitBounds();

      const failed: string[] = [];
      const empty: string[] = [];
      let ran = 0;
      for (const m of runnable) {
        const q = new URLSearchParams({ metric: m.key });
        if (m.grain === 'flow') { q.set('date_from', from); q.set('date_to', to); q.set('bucket', 'year'); }
        const res = await apiGet(page, `/api/v1/analytics/run?${q.toString()}`);
        if (res.status() >= 400) {
          failed.push(`${m.key} (${m.module}) → ${res.status()} ${(await res.text()).slice(0, 160)}`);
          continue;
        }
        ran += 1;
        const body = await res.json();
        if (!Array.isArray(body?.data) ? !body?.data : body.data.length === 0) empty.push(m.key);
      }
      ledgerBump('runs', ran);
      ledgerAdd('reportTypes', ...runnable.map((m) => m.key));

      console.log(`\n  12.03 — catalogue: ${metrics.length} declared · ${runnable.length} runnable · ` +
        `${absent.length} declared-absent · ${ran} ran clean · ${failed.length} REFUSED\n` +
        `     no rows for this org (${empty.length}): ${empty.join(', ') || '(none)'}\n` +
        `     withheld_count reported by the catalogue: ${cat.withheld_count}\n`);

      // ── THE FINDING ───────────────────────────────────────────────────────
      // The catalogue and `/run` do not use the same gate. The catalogue asks
      // `held_level` — the caller's ROLE grant — and `/run` additionally
      // enforces MODULE ACTIVATION. So the catalogue can list a metric that
      // `/run` will always refuse, and it reports `withheld_count: 0` while
      // doing it. Dristi's board passes `moduleFilter={null}`, so AddWidget
      // offers every one of these and pinning one makes a card that can only
      // ever error. The catalogue's own header calls its withholding "the
      // entitlement signal"; on this org it is not one.
      const orgModules = await apiOne(page, '/api/v1/org/modules');
      const inactive = (orgModules?.modules || [])
        .filter((m: any) => !m.active).map((m: any) => m.code);
      expect(failed,
        `${failed.length} metric(s) the catalogue OFFERS are refused by /run.\n` +
        `     modules reported inactive for this org: ${inactive.join(', ') || '(none)'}\n` +
        '     The catalogue resolves entitlement through held_level (the caller\'s role grant);\n' +
        '     /run additionally enforces module activation. Two gates, one catalogue, and the\n' +
        '     catalogue is the one the UI trusts. AddWidget on Dristi\'s board passes\n' +
        '     moduleFilter={null}, so each of these is OFFERED to a person building a\n' +
        '     dashboard and produces a card that can only ever error:')
        .toEqual([]);

      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  test('12.04 four dashboards, typed', async ({ page }) => {
    const con = watchConsole(page);
    await signIn(page);
    const p = await openTab(page, 'dashboards', 'Dashboards');

    const names = Array.from({ length: N_DASHBOARDS }, (_, i) => `${TAG} Board ${String(i + 1).padStart(2, '0')}`);
    const existing = new Set((await apiRows(page, '/api/v1/dristi/dashboards')).map((b: any) => b.name));

    const box = field(p, page, 'New dashboard').locator('input');
    await expect(box, 'the Dashboards tab offers no name box — creating a dashboard is a §4 line ' +
      'and this is the only door').toBeVisible();
    const create = p.getByRole('button', { name: /^Creat(e|ing)/ });
    await expect(create, 'the Dashboards tab offers no Create button').toBeVisible();

    let typed = 0;
    for (const name of names) {
      if (existing.has(name)) continue;
      await typeInto(box, name);
      await saveAndWait(page, () => create.click(), /\/v1\/dristi\/dashboards$/,
        `creating "${name}"`, ['POST']);
      typed += 1;
    }

    // THE CANONICAL ROW, not the list on screen (suite rule 3).
    const boards = await apiRows(page, '/api/v1/dristi/dashboards');
    const mine = boards.filter((b: any) => String(b.name || '').startsWith(`${TAG} Board `));
    expect(mine.length,
      `§4 asks for ${N_DASHBOARDS} dashboards; the server holds ${mine.length} carrying this ` +
      `suite's mark. Saw: ${boards.map((b: any) => b.name).join(' | ') || '(none)'}`)
      .toBe(N_DASHBOARDS);

    // And the screen must SHOW them — a saved dashboard that exists and is
    // invisible is the defect `DashboardsTab`'s own header records (the list
    // tested `Array.isArray(r.data)` against an envelope and was always empty).
    await page.reload();
    const back = await openTab(page, 'dashboards', 'Dashboards');
    for (const name of names) {
      await expect(back.locator('.dlist__t', { hasText: name }),
        `"${name}" exists on the server and is not on the Saved dashboards list`)
        .toBeVisible({ timeout: 30_000 });
    }

    ledgerWrite({ dashboards: mine.length, dashboardsTyped: typed });
    console.log(`\n  12.04 — dashboards: ${typed} typed this run, ${N_DASHBOARDS - typed} already present\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  test('12.05 eighteen widgets pinned, and six saved views', async ({ page }) => {
    const con = watchConsole(page);
    await signIn(page);

    // ── 18 widgets, across the four boards ────────────────────────────────
    // The Configure panel re-queries on every change and "Add to dashboard"
    // pins whatever the panel is currently showing. ⚠ PATCH takes the WHOLE
    // widgets array and this screen APPENDS, so a blind second run would double
    // every board: the shortfall is computed from the live rows first.
    const p = await openTab(page, 'dashboards', 'Dashboards');
    const boards = (await apiRows(page, '/api/v1/dristi/dashboards'))
      .filter((b: any) => String(b.name || '').startsWith(`${TAG} Board `))
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
    expect(boards.length,
      `12.05 needs the ${N_DASHBOARDS} boards 12.04 creates and found ${boards.length}`)
      .toBe(N_DASHBOARDS);

    const have = boards.reduce((a: number, b: any) => a + (Array.isArray(b.widgets) ? b.widgets.length : 0), 0);
    const want = N_WIDGETS - have;

    const cards = p.locator('.dgal .dchart');
    expect(await cards.count(),
      'the chart gallery drew no cards at all — `PRESETS` declares four and each is a real query')
      .toBeGreaterThanOrEqual(4);

    // The four dimensions the gallery's own presets use, cycled so the eighteen
    // are not eighteen copies of one chart.
    const SPECS = [
      { card: 0, measure: 'Sum' }, { card: 1, measure: 'Sum' },
      { card: 2, measure: 'Sum' }, { card: 3, measure: 'Count' },
      { card: 0, measure: 'Count' }, { card: 2, measure: 'Count' },
    ];

    let pinned = 0;
    for (let i = 0; i < want; i++) {
      const spec = SPECS[i % SPECS.length];
      const board = boards[i % boards.length];
      await cards.nth(spec.card).click();

      const cfg = p.locator('.dcard', { hasText: 'Configure' }).first();
      const seg = cfg.locator('.dseg').first();
      const m = seg.getByRole('button', { name: spec.measure, exact: true });
      // ⚠ ONLY CLICK IT IF IT IS NOT ALREADY THE MEASURE. `apply()` re-queries
      // on a CHANGE; clicking the segment that is already `on` fires nothing at
      // all, and a `waitForResponse` on a request that will never be made is a
      // 90-second stall per iteration — eighteen of them is half an hour of a
      // suite doing nothing and then reporting a timeout as a product failure.
      if (await m.count() && !(await m.evaluate((el) => el.classList.contains('on')))) {
        await saveAndWait(page, () => m.click(), /\/v1\/dristi\/query$/,
          `re-running the card as ${spec.measure}`, ['POST']);
      }

      const pick = field(cfg, page, 'Add to dashboard').locator('select');
      await expect(pick,
        'the Configure panel offers no "Add to dashboard" picker even though dashboards ' +
        'exist — that control is the only way a chart is pinned').toBeVisible();
      await saveAndWait(page,
        () => pickByLabel(pick, board.name, 'dashboard').then(() => {}),
        /\/v1\/dristi\/dashboards\/[^/]+$/, `pinning a chart onto "${board.name}"`, ['PATCH']);
      pinned += 1;
    }

    const after = (await apiRows(page, '/api/v1/dristi/dashboards'))
      .filter((b: any) => String(b.name || '').startsWith(`${TAG} Board `));
    const widgets = after.reduce((a: number, b: any) => a + (Array.isArray(b.widgets) ? b.widgets.length : 0), 0);
    expect(widgets,
      `§4 asks for ${N_WIDGETS} widgets across the four boards; the server holds ${widgets} ` +
      `(${after.map((b: any) => `${b.name}:${(b.widgets || []).length}`).join(' ')})`)
      .toBe(N_WIDGETS);

    // Every pinned widget must carry the query that produced it — a widget with
    // no source is a card that will draw nothing and say nothing about why.
    const blank = after.flatMap((b: any) => (b.widgets || [])
      .filter((w: any) => !w?.source)
      .map((w: any) => `${b.name}: ${JSON.stringify(w).slice(0, 80)}`));
    expect(blank, `pinned widget(s) carry no source: ${blank.join(' | ')}`).toEqual([]);

    // ── 6 saved views, on the analytics board ─────────────────────────────
    const anx = await openTab(page, 'analytics', 'Analytics');
    const bar = anx.locator('.vb');
    await expect(bar, 'the Analytics tab renders no views bar').toBeVisible();

    const viewNames = Array.from({ length: N_VIEWS }, (_, i) => `${TAG} View ${String(i + 1).padStart(2, '0')}`);
    const already = new Set((await apiOne(page, '/api/v1/analytics/views?module=dristi'))
      ?.personal?.map((v: any) => v.name) || []);

    let madeViews = 0;
    for (const [i, name] of viewNames.entries()) {
      if (already.has(name)) continue;

      // ⚠ RESET TO "Default" BEFORE EVERY SAVE, AND PROVE IT TOOK.
      //
      // `saveView` PATCHes when the ACTIVE view is a personal one and POSTs
      // otherwise, so saving twice in a row without resetting RENAMES view 01
      // instead of creating view 02. Measured on the first run of this test:
      // six views were typed and the server held TWO, because every save after
      // the first was a PATCH of the same row.
      //
      // And clicking "Default" once is not enough. Saving bumps `nonce`, which
      // refetches `/v1/analytics/views`, and that handler re-applies the
      // server's `resolved` — so a personal DEFAULT view snaps back into
      // `active` a few hundred milliseconds AFTER the chip was clicked, and the
      // next Customise edits it. So: wait for that refetch to land first, then
      // click Default, then assert the Default chip is the selected one. None
      // of the six is saved as the default for the same reason; the default is
      // set at the end, deliberately, through the PATCH branch.
      await settle(page);
      const dflt = bar.getByRole('button', { name: 'Default', exact: true });
      await expect(dflt, 'the views bar offers no "Default" chip to reset to').toBeVisible();
      await dflt.click();
      await expect(dflt,
        'clicking "Default" did not deselect the active view — the next save would PATCH it ' +
        'rather than create a new one').toHaveClass(/vb__chip--on/);

      await bar.getByRole('button', { name: /Customise/ }).click();
      const edit = anx.locator('.vb--edit');
      await expect(edit, 'Customise did not put the views bar into edit mode').toBeVisible();

      // A view with no widgets cannot be saved — `canSave={draft.length > 0}`.
      const add = anx.locator('.vgw-add');
      await expect(add,
        'edit mode offers no "Add a metric" control, so a saved view can never be built')
        .toBeVisible();
      const metricSel = add.locator('select[aria-label="Metric to add"]');
      const vizSel = add.locator('select[aria-label="How to draw it"]');
      // Two widgets each, alternating the drawing, so the six views differ.
      for (const n of [0, 1]) {
        const opts = await metricSel.locator('option').allTextContents();
        expect(opts.length,
          'the metric picker offers nothing to add').toBeGreaterThan(2);
        const choice = opts[1 + ((i * 2 + n) % (opts.length - 1))];
        await pickByLabel(metricSel, choice.trim(), 'metric');
        await vizSel.selectOption(n === 0 ? 'kpi' : 'trend');
        await add.getByRole('button', { name: 'Add', exact: true }).click();
      }

      await typeInto(edit.locator('input[aria-label="View name"]'), name);

      // The METHOD is the assertion, not just the status. A PATCH here means
      // the reset above did not hold and this save renamed an existing view
      // instead of creating one — which is how six typed views became two rows
      // the first time this test ran. Accepting both and then naming which
      // arrived turns a 90-second timeout into a sentence.
      const [res] = await Promise.all([
        page.waitForResponse((r) => /\/v1\/analytics\/views/.test(r.url())
          && ['POST', 'PATCH'].includes(r.request().method()), { timeout: 60_000 }),
        edit.getByRole('button', { name: /Save view/ }).click(),
      ]);
      const bodyText = await res.text().catch(() => '');
      expect(res.status(), `saving "${name}" → ${res.status()}: ${bodyText.slice(0, 400)}`)
        .toBeLessThan(400);
      expect(res.request().method(),
        `saving "${name}" sent a ${res.request().method()} to ${new URL(res.url()).pathname}. ` +
        'A PATCH means the views bar still had a view selected when Customise was pressed, so ' +
        'this RENAMED an existing arrangement instead of creating a new one.')
        .toBe('POST');
      let saved: any = {};
      try { saved = JSON.parse(bodyText); } catch { /* asserted below */ }
      expect(String(saved?.name ?? saved?.data?.name ?? ''),
        `saving "${name}" returned a row named "${saved?.name}"`).toBe(name);
      madeViews += 1;

      // ⚠ AND WAIT FOR THE REFETCH THE SAVE TRIGGERS, BEFORE THE NEXT ITERATION
      // TOUCHES ANYTHING. `saveView` bumps `nonce`, whose effect re-reads
      // `/views` and re-applies the server's `resolved`. That GET lands AFTER
      // the POST response this test just read, so a "click Default" issued in
      // between is undone a moment later and the next Customise edits whatever
      // `resolved` chose. Suite rule 5, in its exact shape: wait for the
      // REFETCH, not for the write.
      await page.waitForResponse((r) => /\/v1\/analytics\/views\?/.test(r.url())
        && r.request().method() === 'GET', { timeout: 20_000 }).catch(() => {});
      await settle(page);
    }

    const views = await apiOne(page, '/api/v1/analytics/views?module=dristi');
    const personal = (views?.personal || []).filter((v: any) => String(v.name || '').startsWith(`${TAG} View `));
    expect(personal.length,
      `§4 asks for ${N_VIEWS} saved views; the server holds ${personal.length} carrying this ` +
      `suite's mark. Saw: ${(views?.personal || []).map((v: any) => v.name).join(' | ') || '(none)'}`)
      .toBe(N_VIEWS);

    // ── AND ONE OF THEM IS THE DEFAULT ────────────────────────────────────
    // Set LAST and through the edit-an-existing-view path, so the PATCH branch
    // of `saveView` is exercised too — and so no reload during the creation
    // loop can snap a default back into `active` and turn the next create into
    // a rename. `resolved` is the whole point of the views API, and an org with
    // six views and no default never exercises it.
    if (!personal.some((v: any) => v.is_default)) {
      const chip = bar.locator('button.vb__chip', { hasText: viewNames[0] }).first();
      await expect(chip, `"${viewNames[0]}" is not on the views bar although the server holds it`)
        .toBeVisible({ timeout: 30_000 });
      await chip.click();
      await bar.getByRole('button', { name: /Customise/ }).click();
      const edit2 = anx.locator('.vb--edit');
      await expect(edit2, 'Customise did not reopen edit mode on a saved view').toBeVisible();
      await edit2.locator('.vb__def input[type="checkbox"]').check();
      await saveAndWait(page, () => edit2.getByRole('button', { name: /Save view/ }).click(),
        /\/v1\/analytics\/views\//, `making "${viewNames[0]}" the default`, ['PATCH']);
    }
    const afterDefault = ((await apiOne(page, '/api/v1/analytics/views?module=dristi'))?.personal || [])
      .filter((v: any) => String(v.name || '').startsWith(`${TAG} View `));
    expect(afterDefault.filter((v: any) => v.is_default).length,
      'none of the six saved views is the personal default even after one was saved with the ' +
      '"Open this by default" box ticked — `resolved` never has a personal answer to give')
      .toBeGreaterThanOrEqual(1);
    expect((await apiOne(page, '/api/v1/analytics/views?module=dristi'))?.resolved?.source,
      'a personal default exists and the server still does not resolve to it — `resolved` is ' +
      'what decides which arrangement a person lands on').toBe('personal');

    // The presets must be offered too — they are the arrangement a NEW customer
    // sees before anyone has saved anything.
    const presets = (views?.presets || []).map((p2: any) => p2.key);
    expect(presets.length,
      'the views API offers no presets at all — a brand-new org would land on nothing')
      .toBeGreaterThan(0);
    for (const key of presets.slice(0, 3)) {
      const chip = bar.locator('button.vb__chip', { hasText: '· preset' }).first();
      if (await chip.count()) {
        await chip.click();
        await expect(anx.locator('.vgw, .anx-card').first(),
          `applying the "${key}" preset drew no board`).toBeVisible({ timeout: 30_000 });
      }
    }

    ledgerWrite({ widgets, views: personal.length, widgetsPinned: pinned, viewsTyped: madeViews });
    console.log(`\n  12.05 — widgets: ${pinned} pinned this run, ${have} already present, ${widgets} total\n` +
      `          views: ${madeViews} typed this run, ${N_VIEWS - madeViews} already present; ` +
      `presets offered: ${presets.join(', ')}\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  test('12.06 five pivots, and the cross-tab adds up to itself', async ({ page }) => {
    const con = watchConsole(page);
    await signIn(page);
    const p = await openTab(page, 'pivot', 'Pivot');
    const rec = new Recon();

    const build = p.locator('.dcard', { hasText: 'Build' }).first();
    await expect(build, 'the Pivot tab renders no Build panel').toBeVisible();

    const sourceSel = field(build, page, 'Source').locator('select');
    const rowSel = field(build, page, 'Rows').locator('select');
    const colSel = field(build, page, 'Columns').locator('select');
    const run = build.getByRole('button', { name: /^Run(ning)? quer/ });
    await expect(run, 'the Build panel offers no Run query button').toBeVisible();

    // Five pivots: four cross-tabs and one list-only, so both renderings of the
    // result are exercised. Each is a real question about this org's own rows.
    const PIVOTS = [
      { source: 'invoices', rows: 'payment_status', cols: 'invoice_type', measure: 'Sum' },
      { source: 'deals', rows: 'stage', cols: '', measure: 'Sum' },
      { source: 'orders', rows: 'status', cols: 'order_date', measure: 'Count' },
      { source: 'employees', rows: 'department', cols: 'employment_type', measure: 'Count' },
      { source: 'contacts', rows: 'contact_type', cols: 'source', measure: 'Count' },
    ];

    let done = 0;
    const notes: string[] = [];
    for (const spec of PIVOTS) {
      con.at(`pivot:${spec.source}`);
      await pickByLabel(sourceSel, spec.source, 'pivot source');
      await pickByLabel(rowSel, spec.rows, 'pivot row dimension');
      if (spec.cols) await pickByLabel(colSel, spec.cols, 'pivot column dimension');
      else await colSel.selectOption('');
      await build.locator('.dseg').getByRole('button', { name: spec.measure, exact: true }).click();

      const body = await saveAndWait(page, () => run.click(), /\/v1\/dristi\/query$/,
        `running the ${spec.source} pivot`, ['POST']);
      done += 1;
      ledgerBump('runs');

      const table = p.locator('table.dpiv');
      await expect(table,
        `the ${spec.source} pivot ran and drew no table — the result is on the wire and not ` +
        'on the screen').toBeVisible({ timeout: 30_000 });

      // ── The cross-tab must add up to itself ────────────────────────────
      // Row totals, column totals and the grand total are computed in the
      // browser from the server's flat rows. If the grand total is not the sum
      // of the row totals, the fold is wrong — and the fold is what a reader
      // actually looks at.
      if (spec.cols) {
        const rowTotals = await table.locator('tbody tr:not(.mtbl__tot) td.dpiv__rt').allInnerTexts();
        const grand = await table.locator('tbody tr.mtbl__tot td.dpiv__gt').innerText();
        const n = (s: string) => Number(String(s).replace(/[^0-9.-]/g, '')) || 0;
        rec.eq(`pivot ${spec.source} by ${spec.rows} × ${spec.cols}: Σ row totals = grand total`,
          'Σ of the row-total column', rowTotals.reduce((a, s) => a + n(s), 0),
          'the grand total cell', n(grand), 1);

        const colTotals = await table.locator('tbody tr.mtbl__tot td.tbl__num:not(.dpiv__gt)').allInnerTexts();
        rec.eq(`pivot ${spec.source} by ${spec.rows} × ${spec.cols}: Σ column totals = grand total`,
          'Σ of the total row', colTotals.reduce((a, s) => a + n(s), 0),
          'the grand total cell', n(grand), 1);
      }

      // ── And the pivot must agree with the ENGINE ───────────────────────
      // The same question asked with no dimension at all is one row of SQL, so
      // it is a canonical aggregate and never a summed list.
      const flat: any[] = Array.isArray(body?.data) ? body.data : [];
      if (!spec.cols && flat.length) {
        const whole = await query(page, {
          source: spec.source, group_by: '', measure: spec.measure.toLowerCase(),
        });
        rec.eq(`pivot ${spec.source} by ${spec.rows}: Σ the grouped rows = the ungrouped total`,
          `Σ of the ${flat.length} groups`, flat.reduce((a, r) => a + (Number(r.value) || 0), 0),
          'the same query with no dimension', Number(whole?.value), 1);
      }

      notes.push(`${spec.source.padEnd(10)} ${spec.rows}${spec.cols ? ` × ${spec.cols}` : ' (list only)'} · ${spec.measure}`);
    }

    // The export exists and carries the result. §4 counts it among the 36.
    //
    // BOTH RENDERINGS, because `exportGrid` has two branches and they write
    // different files: a CROSS-TAB writes `[rowDim, …cols, Total]` with a total
    // row, and a LIST-ONLY result writes `[rowDim, measure]`. The suite is
    // sitting on the cross-tab from the last pivot above; the second export
    // re-runs a one-dimension query first so the flat branch is exercised too.
    const exportBtn = build.getByRole('button', { name: /Export to CSV/ });
    await expect(exportBtn, 'the Build panel offers no CSV export').toBeVisible();
    const grid = await download(page, () => exportBtn.click(), 'pivot-crosstab.csv');
    const gridRows = csvRows(grid);
    expect(gridRows.length, 'the cross-tab CSV downloaded with no rows in it').toBeGreaterThan(1);
    expect(gridRows[0].length,
      'the cross-tab CSV has fewer than three columns, so it is not a cross-tab — a pivot ' +
      'exported as a two-column list has lost the column dimension the user chose')
      .toBeGreaterThan(2);

    await pickByLabel(sourceSel, 'deals', 'pivot source');
    await pickByLabel(rowSel, 'stage', 'pivot row dimension');
    await colSel.selectOption('');
    await saveAndWait(page, () => run.click(), /\/v1\/dristi\/query$/,
      'running the list-only pivot for its own export', ['POST']);
    ledgerBump('runs');
    const flat = await download(page, () => exportBtn.click(), 'pivot-list.csv');
    const flatRows = csvRows(flat);
    expect(flatRows[0].length,
      'the list-only pivot CSV should be exactly two columns — the dimension and its measure')
      .toBe(2);

    expect(done, `§4 asks for ${N_PIVOTS} pivots`).toBe(N_PIVOTS);
    ledgerWrite({ pivots: done });
    console.log(`\n  12.06 — five pivots:\n     ${notes.join('\n     ')}\n`);
    rec.settle('12.06 pivot arithmetic');
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  test('12.07 four metric alerts, set from the bell, two of them over the line',
    async ({ page }) => {
      const con = watchConsole(page);
      await signIn(page);
      const anx = await openTab(page, 'analytics', 'Analytics');

      // ⚠ THE BOARD ONLY EXISTS UNDER A VIEW. With `dataModule === 'ganit'` and
      // nothing active, the Analytics tab draws the bespoke finance cards and
      // there are no KPI widgets, so there are no bells. Picking a preset is the
      // product's own path to the board, not a workaround.
      const bar = anx.locator('.vb');
      const preset = bar.locator('button.vb__chip', { hasText: '· preset' }).first();
      await expect(preset,
        'the views bar offers no preset, so the widget board — and the alert bell that lives ' +
        'on a KPI widget — cannot be reached at all').toBeVisible();
      await preset.click();
      await expect(anx.locator('.vgw').first(), 'the preset drew no widget board')
        .toBeVisible({ timeout: 45_000 });

      const bells = anx.locator('button.anx-bell');
      await expect.poll(async () => await bells.count(), {
        message: 'no KPI widget on the board carries an alert bell — §4 asks for 4 alerts and ' +
          'the bell is the ONLY control that creates one (`AlertForm` has exactly one caller, ' +
          '`ViewGrid.jsx:503`)',
        timeout: 45_000,
      }).toBeGreaterThan(0);

      // Which metric each bell belongs to, read off its accessible name: the
      // bell is labelled `Alert when <label> crosses a line`, and the label is
      // the catalogue's, never the key and never an id.
      const cat = await apiOne(page, '/api/v1/analytics/catalogue');
      const byLabel = new Map<string, any>((cat?.metrics || []).map((m: any) => [m.label, m]));

      const existing = await apiOne(page, '/api/v1/analytics/alerts');
      const seen = new Set((existing?.alerts || [])
        .map((a: any) => `${a.metric}|${a.operator}|${Number(a.threshold)}`));

      // Two over the line and two under it, so the pair that must breach and
      // the pair that must not are both real. Thresholds are chosen to be
      // decidable from a figure the metric itself returns — never guessed.
      const PLAN = [
        { operator: 'goes above', threshold: 1, windowDays: 30, breach: true },
        { operator: 'goes above', threshold: 1, windowDays: 30, breach: true },
        { operator: 'falls below', threshold: 0.0001, windowDays: 30, breach: false },
        { operator: 'goes above', threshold: 999999999, windowDays: 30, breach: false },
      ];

      const count = await bells.count();
      expect(count,
        `the board carries ${count} alert bell(s); §4 asks for ${N_ALERTS} alerts and each needs ` +
        'its own KPI widget. Add more KPI widgets to the preset, or this line cannot be met ' +
        'through the product')
        .toBeGreaterThanOrEqual(N_ALERTS);

      const set: string[] = [];
      let typed = 0;
      for (let i = 0; i < N_ALERTS; i++) {
        const bell = bells.nth(i);
        const aria = (await bell.getAttribute('aria-label')) || '';
        const label = aria.replace(/^Alert when /, '').replace(/ crosses a line$/, '').trim();
        const meta = byLabel.get(label);
        expect(meta,
          `the bell is labelled "${label}", which is not a metric label the catalogue knows. ` +
          'A control that names something the API cannot resolve is a rendering of a key or an ' +
          'id, and this module renders neither').toBeTruthy();

        const plan = PLAN[i];
        const key = `${meta.key}|${plan.operator === 'goes above' ? 'gt' : 'lt'}|${plan.threshold}`;
        set.push(`${meta.key.padEnd(26)} ${plan.operator} ${plan.threshold} over ${plan.windowDays}d` +
          `${plan.breach ? '   ← must breach' : ''}`);
        if (seen.has(key)) continue;

        await bell.click();
        const form = anx.locator('form.anx-af');
        await expect(form, `the bell on "${label}" opened no alert form`).toBeVisible();
        await form.locator('select[aria-label="Direction"]').selectOption({ label: plan.operator });
        await typeInto(form.locator('input[aria-label="Threshold"]'), String(plan.threshold));
        await typeInto(form.locator('input[aria-label="Window in days"]'), String(plan.windowDays));
        await saveAndWait(page, () => form.getByRole('button', { name: /Set alert/ }).click(),
          /\/v1\/analytics\/alerts$/, `setting an alert on ${meta.key}`, ['POST']);
        typed += 1;
      }

      // THE CANONICAL ROWS.
      const alerts = (await apiOne(page, '/api/v1/analytics/alerts'))?.alerts || [];
      expect(alerts.length,
        `§4 asks for ${N_ALERTS} alerts; the org holds ${alerts.length}`)
        .toBeGreaterThanOrEqual(N_ALERTS);

      // ⚠ A FINDING, MEASURED HERE AND DELIBERATELY NOT ASSERTED AS A FAILURE.
      //
      // `AlertsPanel` fetches `/v1/analytics/alerts` once, on its own `nonce`,
      // which only a Retry bumps. `AlertForm.save()` calls `onClose()` and
      // nothing else. The two are siblings with no shared state, so an alert
      // set from the bell does not appear in the panel below it until the page
      // is reloaded: the toast says "Alert set on Outstanding." and the list
      // three inches under it still reads "No alerts here yet."
      //
      // Reported rather than failed, and the distinction is deliberate. Rule 2
      // fails on a MISSING CONTROL or a fence that does not hold; the control
      // exists, the row is written, and the list is correct after a reload. It
      // is a staleness defect, and the honest place for it is the report — not
      // a red test that would read as "alerts do not work".
      const beforeReload = await anx.locator('.anx-card', { hasText: 'Alerts' })
        .locator('tbody tr').count();

      await page.reload();
      const anx2 = await openTab(page, 'analytics', 'Analytics');
      const preset2 = anx2.locator('button.vb__chip', { hasText: '· preset' }).first();
      await expect(preset2).toBeVisible();
      await preset2.click();

      // The panel must render each by its LABEL, never its key and never a uuid.
      const panelRows = anx2.locator('.anx-card', { hasText: 'Alerts' }).locator('tbody tr');
      await expect.poll(async () => await panelRows.count(), {
        message: 'the Alerts panel lists nothing after a reload although the org holds alerts — ' +
          'the panel cuts to metrics whose key starts `ganit.`, so a mismatch here is the ' +
          'module filter and not the create path',
        timeout: 30_000,
      }).toBeGreaterThan(0);
      const afterReload = await panelRows.count();
      console.log(`\n  12.07 — the Alerts panel showed ${beforeReload} row(s) before the reload ` +
        `and ${afterReload} after it, on a run that typed ${typed} new alert(s).` +
        (typed > 0 && afterReload > beforeReload
          ? '\n     ⚠ FINDING: an alert set from the bell is INVISIBLE in the list three inches ' +
            'below the toast confirming it. `AlertsPanel` fetches once on its own `nonce`, which ' +
            'only its Retry bumps, and `AlertForm.save()` calls `onClose()` and nothing else — ' +
            'they are siblings with no shared state. Reported, not failed: the control exists, ' +
            'the row is written, and the list is right after a reload.'
          : '\n     (nothing was typed this run, so staleness could not be observed here. It WAS ' +
            'observed on the creating run: 4 alerts written, 0 shown until reload.)') +
        `\n     Note the panel cuts to metrics whose key starts \`ganit.\`, so \`core.overdue\` is ` +
        'correctly absent from it — the panel count is 3 where the org holds 4.\n');
      const painted = (await anx2.locator('.anx-card', { hasText: 'Alerts' }).innerText());
      expect(painted,
        'the Alerts panel is printing a metric KEY (`module.metric`) where the label belongs')
        .not.toMatch(/\b(ganit|graha|manav|core|vikray|vetana)\.[a-z_]+\b/);

      // ── DELETE ONE AND TYPE IT BACK ───────────────────────────────────────
      // The Delete button is the only other control this panel has; proving it
      // works is what stops "4 alerts exist" from being the whole assertion.
      const first = panelRows.first();
      const del = first.getByRole('button', { name: /^Delete the alert on / });
      await expect(del, 'the Alerts panel offers no per-row Delete').toBeVisible();
      const delLabel = ((await del.getAttribute('aria-label')) || '')
        .replace(/^Delete the alert on /, '').trim();
      // ⚠ CAPTURE THE WHOLE TUPLE BEFORE DELETING IT, so it can be typed back
      // EXACTLY. Re-creating on the right metric with a different operator or
      // threshold leaves the org holding a tuple the creation loop does not
      // recognise, and the next run types the original again: measured, the
      // alert count drifted 4 → 5 and "breached" 2 → 3 across two runs. An
      // idempotence flaw in the test, not in the product.
      const deletedKey = [...byLabel.entries()].find(([lab]) => lab === delLabel)?.[1]?.key;
      const deletedRow = (alerts || []).find((a: any) => a.metric === deletedKey);
      expect(deletedRow,
        `the panel offers a Delete for "${delLabel}" and the alerts API holds no row for its ` +
        'metric — the panel is labelling a row that is not there').toBeTruthy();
      const before = alerts.length;
      await saveAndWait(page, () => del.click(), /\/v1\/analytics\/alerts\//,
        'deleting an alert', ['DELETE']);
      await expect.poll(async () =>
        ((await apiOne(page, '/api/v1/analytics/alerts'))?.alerts || []).length, {
        message: 'the alert was deleted through the UI and the server still holds it',
        timeout: 20_000,
      }).toBe(before - 1);

      // …AND TYPE IT BACK, from the same bell. Two reasons, and neither is
      // tidiness: it proves the create path still works after a delete (a
      // soft-delete that leaves `is_active=FALSE` behind can make the next
      // create collide), and it restores §4's count of four so 12.12's volume
      // sheet reports what the product holds rather than what this test
      // happened to remove last.
      const bellBack = anx2.getByRole('button',
        { name: `Alert when ${delLabel} crosses a line` }).first();
      await expect(bellBack,
        `the alert on "${delLabel}" was deleted and its KPI card no longer offers a bell to ` +
        'set it again').toBeVisible();
      await bellBack.click();
      const formBack = anx2.locator('form.anx-af');
      await expect(formBack, `re-opening the bell on "${delLabel}" showed no form`).toBeVisible();
      await formBack.locator('select[aria-label="Direction"]').selectOption(
        { label: deletedRow.operator === 'lt' ? 'falls below' : 'goes above' });
      await typeInto(formBack.locator('input[aria-label="Threshold"]'), String(deletedRow.threshold));
      await typeInto(formBack.locator('input[aria-label="Window in days"]'),
        String(deletedRow.window_days));
      await saveAndWait(page, () => formBack.getByRole('button', { name: /Set alert/ }).click(),
        /\/v1\/analytics\/alerts$/, `re-setting the alert on "${delLabel}" after deleting it`,
        ['POST']);
      await expect.poll(async () =>
        ((await apiOne(page, '/api/v1/analytics/alerts'))?.alerts || []).length, {
        message: `the alert on "${delLabel}" was typed back and the server does not hold it — ` +
          'a soft delete that blocks its own re-create is worse than no delete',
        timeout: 20_000,
      }).toBe(before);

      // ── THE BREACH, PROVED BY ARITHMETIC ──────────────────────────────────
      // ⚠ AN ALERT BREACH IS THE NIYAM SWEEP'S, NOT THIS SUITE'S. It is emitted
      // by `services/niyam/metric_alerts.run_alerts`, reached only from
      // `POST /api/internal/niyam/sweep` behind `CRON_SECRET` on the
      // `cron-niyam` service. This suite is org-scoped, holds no cron secret,
      // and arming or calling a cron is not a suite's to do. And no Dristi
      // screen renders breach state at all, so even a fired alert would be
      // invisible here.
      //
      // What CAN be proved deterministically is the condition: run each alert's
      // own metric over the alert's own window and apply `_breached()`'s
      // arithmetic — `value > threshold` for gt, `value < threshold` for lt,
      // with `_reduce()`'s rule that a bucketed series sums unless its unit is
      // a rate, in which case it is refused rather than averaged.
      const live = (await apiOne(page, '/api/v1/analytics/alerts'))?.alerts || [];
      const byKey = new Map<string, any>((cat?.metrics || []).map((m: any) => [m.key, m]));
      const verdicts: string[] = [];
      let breaching = 0;
      for (const a of live) {
        const m = byKey.get(a.metric);
        if (!m) { verdicts.push(`${a.metric}: not in the catalogue — the sweep would SKIP it`); continue; }
        const q = new URLSearchParams({ metric: a.metric });
        if (m.grain === 'flow') {
          const to = new Date();
          const from = new Date(to);
          from.setDate(from.getDate() - (Number(a.window_days) - 1));
          const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          q.set('date_from', iso(from));
          q.set('date_to', iso(to));
          q.set('bucket', 'month');
        }
        const payload = await apiRaw(page, `/api/v1/analytics/run?${q.toString()}`);
        const rows: any[] = payload?.data || [];
        let value: number | null = null;
        let why = '';
        if (!rows.length) why = 'the metric returned no rows for this window';
        else if (rows.length === 1) value = Number(rows[0].value);
        else if (m.unit === 'pct') why = 'a rate series cannot be reduced honestly';
        else value = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);

        if (value == null) { verdicts.push(`${a.metric}: SKIPPED — ${why}`); continue; }
        const crossed = a.operator === 'gt'
          ? value > Number(a.threshold)
          : value < Number(a.threshold);
        if (crossed) breaching += 1;
        verdicts.push(`${a.metric.padEnd(26)} value ${value} ${a.operator} ${a.threshold} → ` +
          `${crossed ? 'BREACHED' : 'not breached'}`);
      }

      expect(breaching,
        `§4 asks for ${N_BREACHED} breached alerts. The CONDITION is satisfied by ${breaching} of ` +
        `${live.length}, computed here with the sweep's own reduction and comparison:\n     ` +
        verdicts.join('\n     ') + '\n     ⚠ EMISSION is the Niyam sweep\'s and is BLOCKED to ' +
        'this suite — see the test\'s own note. `AlertsPanel` renders no breach state, so a ' +
        'fired alert would not appear on any Dristi screen either.')
        .toBeGreaterThanOrEqual(N_BREACHED);

      ledgerWrite({ alerts: live.length, alertsTyped: typed, alertsBreaching: breaching });
      console.log(`\n  12.07 — alerts: ${typed} typed this run, ${N_ALERTS - typed} already present; ` +
        `one deleted and the delete proved.\n     ${set.join('\n     ')}\n` +
        `     breach conditions:\n     ${verdicts.join('\n     ')}\n`);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  test('12.08 two scheduled reports, dispatched by hand, to an enumerated recipient',
    async ({ page }) => {
      const con = watchConsole(page);
      await signIn(page);

      // ⚠ THE FENCE COMES FIRST, BEFORE ANYTHING CAN SEND.
      // staging is outbound_mode=live with nothing suppressed. Two of Unicode's
      // nine member rows are outside the permitted set, so the recipient list is
      // chosen rather than inherited, and it is checked here — before a form is
      // even opened.
      const health = await (await page.request.get(`${API}/api/health`)).json();
      expect(String(health.outbound_mode || ''),
        'GET /api/health does not report outbound_mode — whether a send is real is UNKNOWABLE ' +
        'from here, so nothing that sends may run').toBeTruthy();
      assertRecipientsFenced('the recipient this suite will type', [RECIPIENT]);

      const members = await apiRows(page, '/api/v1/org/members');
      const outsiders = [...new Set(members.map((m: any) => String(m.email || '').toLowerCase()))]
        .filter((e) => e && !ALLOWED.test(e));
      console.log(`\n  12.08 — outbound_mode=${health.outbound_mode}, ` +
        `suppressed_orgs_digest=${health.suppressed_orgs_digest}\n` +
        `     org members: ${members.length} rows; ${outsiders.length} address(es) OUTSIDE the ` +
        `permitted set and therefore never named on any schedule here: ${outsiders.join(', ') || '(none)'}\n` +
        `     every schedule below names exactly one recipient: ${RECIPIENT}\n`);

      const p = await openTab(page, 'reports', 'Reports');
      const names = Array.from({ length: N_SCHEDULES }, (_, i) => `${TAG} Weekly ${String(i + 1).padStart(2, '0')}`);
      const TYPES = ['revenue', 'pipeline'];

      const before = await apiRows(page, '/api/v1/dristi/scheduled-reports');
      const have = new Set(before.map((r: any) => r.name));

      let typed = 0;
      for (const [i, name] of names.entries()) {
        if (have.has(name)) continue;
        await p.getByRole('button', { name: /Schedule (a )?report/i }).first().click();
        const form = p.locator('.dform');
        await expect(form, 'the schedule form did not open').toBeVisible();

        await typeInto(field(form, page, 'Name').locator('input').first(), name);
        await field(form, page, 'Report type').locator('select')
          .selectOption(TYPES[i]);
        await field(form, page, 'Frequency').locator('select')
          .selectOption('weekly');
        await field(form, page, 'Day of week').locator('select')
          .selectOption('1');

        // The time is a DateInput, not a native input — this product has no
        // native date or time inputs anywhere.
        const timeTrigger = form.locator('button.pk__tr').first();
        await expect(timeTrigger, 'the schedule form has no DateInput time field').toBeVisible();
        await timeTrigger.click();
        const timePop = page.locator('.pk__pop[role="dialog"]').first();
        await expect(timePop, 'the time field opened no picker').toBeVisible();
        await timePop.locator('button.pk__t').first().click();

        await typeInto(field(form, page, 'Recipients').locator('textarea'), RECIPIENT);
        // Both formats, so the letterhead document and the data file are both
        // asked for — the schedule's `file_formats` is what the delivery reads.
        for (const fmt of ['PDF']) {
          const chip = form.getByRole('button', { name: fmt, exact: true });
          if (await chip.count() && (await chip.getAttribute('aria-pressed')) !== 'true') {
            await chip.click();
          }
        }

        await saveAndWait(page,
          () => form.getByRole('button', { name: /^Schedul(e|ing)/ }).click(),
          /\/v1\/dristi\/scheduled-reports$/, `scheduling "${name}"`, ['POST']);
        typed += 1;
      }

      // THE CANONICAL ROWS — and the second enumeration of the recipient set,
      // this time as the SERVER stored it rather than as it was typed.
      const rows = await apiRows(page, '/api/v1/dristi/scheduled-reports');
      const mine = rows.filter((r: any) => String(r.name || '').startsWith(`${TAG} Weekly `));
      expect(mine.length,
        `§4 asks for ${N_SCHEDULES} scheduled reports; the org holds ${mine.length} carrying this ` +
        `suite's mark. Saw: ${rows.map((r: any) => r.name).join(' | ') || '(none)'}`)
        .toBe(N_SCHEDULES);
      for (const r of mine) {
        assertRecipientsFenced(`the SAVED schedule "${r.name}"`, r.recipients || []);
      }

      // ── THE DISPATCH ──────────────────────────────────────────────────────
      // ⚠ `/cron/reports` is a 501 stub and is NOT touched. The armed sweep is
      // `POST /v1/dristi/scheduled-reports/dispatch` and is NOT called. This is
      // the button a person presses, and it runs `_deliver_scheduled_report` —
      // the identical function the sweep runs, "because the only difference
      // between those two is WHO decided the report should go out". So the
      // dispatch is real and no cron is involved.
      await page.reload();
      const p2 = await openTab(page, 'reports', 'Reports');
      let dispatched = 0;
      const logs: string[] = [];
      for (const r of mine) {
        const item = p2.locator('.dlist__i', { hasText: r.name }).first();
        await expect(item, `"${r.name}" is not on the scheduled-reports list although the server ` +
          'holds it — a saved schedule that is invisible is the defect this tab already shipped once')
          .toBeVisible({ timeout: 30_000 });

        const runNow = item.getByRole('button', { name: /^Run now$/ });
        await expect(runNow, `"${r.name}" offers no Run now — without it §4's "dispatches 2" has ` +
          'no door that is not a cron').toBeVisible();
        const out = await saveAndWait(page, () => runNow.click(),
          /\/scheduled-reports\/[^/]+\/run-now$/, `dispatching "${r.name}"`, ['POST']);
        dispatched += 1;

        // Third enumeration: the server says how many it mailed.
        expect(Number(out?.recipients),
          `dispatching "${r.name}" reported ${JSON.stringify(out)} — it must mail exactly the ` +
          'one member address this suite named, and any other number means the recipient set ' +
          'was resolved from somewhere other than the schedule')
          .toBe(1);

        // Fourth enumeration: the delivery log row.
        const log = await apiOne(page, `/api/v1/dristi/scheduled-reports/${r.id}/logs`);
        const entries: any[] = log?.logs || [];
        expect(entries.length,
          `"${r.name}" was dispatched and its delivery log is empty — every attempt is supposed ` +
          'to be recorded here, including the ones that fail').toBeGreaterThan(0);
        const latest = entries[0];
        expect(String(latest.status),
          `the latest delivery of "${r.name}" is recorded as ${latest.status}: ${latest.error || ''}`)
          .toBe('sent');
        expect(Number(latest.recipients_count),
          `the delivery log for "${r.name}" records ${latest.recipients_count} recipients against ` +
          'the one address this suite named').toBe(1);
        logs.push(`${r.name}: ${latest.status}, ${latest.recipients_count} recipient, ` +
          `${latest.error ? `note "${latest.error}"` : 'no note'}`);
      }
      expect(dispatched, `§4 asks for ${N_DISPATCHES} dispatches`).toBe(N_DISPATCHES);

      // The detail screen must SHOW the delivery history — the log exists one
      // click away and a screen that says "Not sent yet" over a sent report is
      // the collapse `ReportsTab`'s own header records.
      const firstItem = p2.locator('.dlist__i', { hasText: mine[0].name }).first();
      await firstItem.locator('.dlist__main').click();
      await expect(p2.getByText('Delivery log'), 'the schedule detail shows no delivery log')
        .toBeVisible();
      await expect(p2.locator('table').filter({ hasText: /sent/i }).first(),
        'the delivery log is empty on screen although the API returned a sent row for this ' +
        'schedule — an empty state over real history is worse than an error')
        .toBeVisible({ timeout: 30_000 });

      ledgerWrite({ schedules: mine.length, schedulesTyped: typed, dispatches: dispatched });
      console.log(`\n  12.08 — schedules: ${typed} typed this run, ${N_SCHEDULES - typed} already ` +
        `present; ${dispatched} dispatched by hand (no cron armed, no sweep called)\n     ` +
        logs.join('\n     ') + '\n');
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  test('12.09 six client reports, and the per-client figures add up to the org',
    async ({ page }) => {
      const con = watchConsole(page);
      await signIn(page);
      const p = await openTab(page, 'clients', 'Clients');
      const rec = new Recon();

      const picker = p.locator('select.dcrt__pick');
      await expect(picker, 'the Clients tab renders no client picker').toBeVisible();
      await expect.poll(async () => await picker.locator('option').count(), {
        message: 'the client picker never loaded any options — Unicode holds clients, so an ' +
          'empty picker here is the failed-fetch-as-empty-state collapse, not "no clients"',
        timeout: 30_000,
      }).toBeGreaterThan(1);

      const options = (await picker.locator('option').allTextContents()).slice(1);
      expect(options.length,
        `§4 asks for ${N_CLIENT_REPORTS} client reports and the picker offers ${options.length} clients`)
        .toBeGreaterThanOrEqual(N_CLIENT_REPORTS);

      let generated = 0;
      const lines: string[] = [];
      for (const name of options.slice(0, N_CLIENT_REPORTS)) {
        con.at(`client:${name}`);
        const [res] = await Promise.all([
          page.waitForResponse((r) => /\/v1\/analytics\/client-report\?/.test(r.url())
            && !/format=/.test(r.url()), { timeout: 60_000 }),
          pickByLabel(picker, name.trim(), 'client'),
        ]);
        expect(res.status(),
          `the client report for "${name.trim()}" answered ${res.status()}: ${(await res.text()).slice(0, 300)}`)
          .toBeLessThan(400);
        const body = await res.json();
        generated += 1;
        ledgerBump('runs');

        // The report must reach the SCREEN, not only the wire.
        await expect(p.locator('.k-stats').first(),
          `the report for "${name.trim()}" arrived on the wire and drew no figures`)
          .toBeVisible({ timeout: 30_000 });

        // A connector that is not connected must SAY so — "not connected" is an
        // answer and ₹0 is a lie wearing one. This is the Withheld rule applied
        // to a spine column, and it is the one thing on this screen that a
        // number cannot express.
        const painted = await p.innerText();
        if (body?.ads?.absent) {
          expect(painted,
            `the ads column is absent for "${name.trim()}" and the screen does not say so — a ` +
            'stated absence rendered as ₹0 is indistinguishable from a client who spent nothing')
            .toContain(String(body.ads.absent).slice(0, 40));
        }
        lines.push(`${name.trim().slice(0, 34).padEnd(36)} invoiced ${body?.invoices?.invoiced ?? '—'} · ` +
          `collected ${body?.invoices?.collected ?? '—'} · leads ${body?.leads?.total ?? '—'}`);
      }
      expect(generated, `§4 asks for ${N_CLIENT_REPORTS} client reports`).toBe(N_CLIENT_REPORTS);

      // ── THE RECONCILIATION ────────────────────────────────────────────────
      // Σ over EVERY client's report = the org's own invoiced total.
      //
      // ⚠ This is a sum, and suite rule 4 forbids summing a capped list — so the
      // envelope is checked first: `/v1/graha/clients` must report
      // `truncated: false` and a `total` equal to the rows returned. Where that
      // does not hold the assertion refuses to run rather than answering a
      // smaller question. The right-hand side is a server-side aggregate, never
      // a sum of anything.
      const clients = await apiEnvelope(page, '/api/v1/graha/clients');
      const rows: any[] = clients?.data || [];
      expect(clients?.truncated,
        'the client list is truncated, so the per-client sum below would silently answer for ' +
        'the first 200 clients only — this is precisely the ₹1.06 Cr against ₹3.58 Cr trap')
        .not.toBe(true);
      expect(Number(clients?.total),
        `the client envelope reports total=${clients?.total} against ${rows.length} rows`)
        .toBe(rows.length);

      const { from, to } = explicitBounds();
      let sumInvoiced = 0;
      let sumCollected = 0;
      for (const c of rows) {
        const q = new URLSearchParams({ client_id: c.id, date_from: from, date_to: to });
        const r = await apiOne(page, `/api/v1/analytics/client-report?${q.toString()}`);
        sumInvoiced += Number(r?.invoices?.invoiced || 0);
        sumCollected += Number(r?.invoices?.collected || 0);
        ledgerBump('runs');
      }

      // The org side is a single SQL aggregate, taken in the same moment.
      const overview = await apiOne(page, '/api/v1/dristi/overview');
      // ⚠ PLUS THE INVOICES THAT ARE ON NO CLIENT. This asserted a bare
      // equality and could not hold: an invoice may legitimately carry no
      // `client_id` — one can be raised before the CRM record exists, the same
      // principle "GSTIN/PAN/TAN block nothing" states about a different field
      // — and no client report can contain it.
      //
      // Measured live 2026-08-31: 6 such invoices, ₹71,508, against 29 client
      // reports summing ₹40,15,831 and a headline of ₹40,87,339. Every
      // ATTACHED invoice was checked too (0 orphaned ids, 0 on an inactive
      // client), so the bucket is the whole of the difference.
      //
      // Neither number was wrong and neither was changed. What was wrong is
      // that the difference was invisible, so the overview now REPORTS it —
      // `revenue.unattached_invoiced` — and the reconciliation closes against
      // the figure the product itself publishes rather than being relaxed.
      //
      // Strictly stronger than the old line: it fails if a rupee goes missing
      // anywhere, AND if the unattached figure stops agreeing with the
      // invoices behind it.
      const unattached = Number(overview?.revenue?.unattached_invoiced || 0);
      rec.eq('Σ invoiced over every client report + the unattached bucket = the org\'s total',
        `Σ over ${rows.length} client reports + ${unattached} on no client`,
        sumInvoiced + unattached,
        'GET /v1/dristi/overview revenue.total_invoiced', Number(overview?.revenue?.total_invoiced));

      // And the bucket is REPORTED, not merely subtracted. A figure the API
      // does not publish cannot be shown to the partner doing this subtraction
      // on screen, which was the actual defect.
      rec.eq('the overview names how many invoices are on no client',
        'revenue.unattached_count is a number',
        Number.isFinite(Number(overview?.revenue?.unattached_count)) ? 1 : 0,
        'it must be', 1, 0);
      rec.eq('Σ collected over every client report = the org\'s collected total',
        `Σ over ${rows.length} client reports`, sumCollected,
        'GET /v1/dristi/overview revenue.total_collected', Number(overview?.revenue?.total_collected));

      // ── THE THREE FORMATS, ON TWO DIFFERENT CLIENTS ───────────────────────
      // §4 counts each as an export, and §1 asks that a download produce a FILE.
      // Two clients rather than one, because a filename stem built from the
      // client's NAME is the kind of thing that is right once and wrong twice.
      for (const which of [options[0], options[1]]) {
        await Promise.all([
          page.waitForResponse((r) => /\/v1\/analytics\/client-report\?/.test(r.url())
            && !/format=/.test(r.url()), { timeout: 60_000 }),
          pickByLabel(picker, which.trim(), 'client'),
        ]);
        await expect(p.locator('.k-stats').first(),
          `the report for "${which.trim()}" drew no figures before its downloads were taken`)
          .toBeVisible({ timeout: 30_000 });
        await downloadsFor(which.trim());
      }

      async function downloadsFor(clientName: string) {
      const dl = p.locator('.anx-dl');
      await expect(dl, 'the client report offers no download controls').toBeVisible();
      for (const fmt of ['CSV', 'XLSX', 'PDF']) {
        const btn = dl.getByRole('button', { name: `Download as ${fmt}` });
        await expect(btn, `the client report offers no ${fmt} download`).toBeVisible();
        // ⚠ THE FILENAME CARRIES THE CLIENT. Six downloads under three names
        // overwrite each other on disk and the run reports 32 exports where it
        // took 35 — an undercount that reads as a missing export.
        const slug = clientName.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 24);
        const buf = await download(page, () => btn.click(),
          `client-report-${slug}-${fmt.toLowerCase()}`);
        if (fmt === 'PDF') {
          expect(buf.subarray(0, 5).toString('latin1'),
            'the client-report PDF does not begin with %PDF — a 200 carrying something else is ' +
            'the empty-body failure wearing a content type').toBe('%PDF-');
        }
        if (fmt === 'CSV') {
          const csv = csvRows(buf);
          const invoiced = csvFind(csv, 'Invoiced');
          expect(invoiced,
            `the client-report CSV carries no "Invoiced" row: ${buf.toString('utf8').slice(0, 200)}`)
            .toBeTruthy();
          // The file must agree with the screen it was taken from.
          //
          // ⚠ SCOPED TO `.k-stat__val`, NOT THE WHOLE TILE. A `k-stat` carries
          // its label, its Devanagari, its value AND its caption, so stripping
          // non-digits from the tile read "₹38,651.60 · 2 documents" as
          // 386,522 — a manufactured mismatch that would have been filed as a
          // product defect. The value lives in one element; ask that element.
          const valEl = p.locator('.k-stat', { hasText: /^Invoiced/ }).first()
            .locator('.k-stat__val');
          const onScreen = (await valEl.count()) ? await valEl.first().innerText() : '';
          const n = (s: string) => Number(String(s).replace(/[^0-9.]/g, '')) || 0;
          expect(onScreen,
            'the client report drew no Invoiced tile to compare the file against')
            .not.toBe('');
          rec.eq(`the client-report CSV for "${clientName}" agrees with the screen it came from`,
            'the CSV\'s Invoiced row', n(invoiced![1]),
            'the Invoiced tile on screen', n(onScreen), 1);
          // And the file must name the client it is about — a report forwarded
          // to an accountant that does not say whose numbers it holds is
          // indistinguishable from anyone else's.
          const header = csvFind(csv, 'Client');
          expect(String(header?.[1] || ''),
            `the client-report CSV does not name "${clientName}" — the file says ` +
            `"${header?.[1]}"`).toContain(clientName.slice(0, 12));
        }
      }
      }

      ledgerWrite({ clientReports: generated });
      console.log(`\n  12.09 — six client reports:\n     ${lines.join('\n     ')}\n` +
        `     Σ over all ${rows.length} clients: invoiced ${sumInvoiced}, collected ${sumCollected}\n`);
      rec.settle('12.09 client reports');
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  test('12.10 thirty-six exports, every one a real file, and every figure in them checked',
    async ({ page }) => {
      const con = watchConsole(page);
      await signIn(page);
      const rec = new Recon();
      const got: string[] = [];

      // ── The five server-rendered CSVs, over two windows ────────────────────
      // These are the exports §4 means by "CSV per report": the file is built
      // by `_fetch_report_data` on the server, so it CAN disagree with the
      // screen — and that is the whole reason to check it rather than to count
      // it.
      const p = await openTab(page, 'reports', 'Reports');
      const chips = p.locator('.dcard', { hasText: 'Export data' }).locator('button.chip');
      // ⚠ POLLED. `ReportsTab` renders a `<Shimmer>` while its schedule list is
      // in flight and the Export panel does not exist until that resolves, so
      // counting chips the instant the panel is visible reads ZERO and reports
      // "the Export panel offers no chips" against a tab that is still loading.
      // Suite rule 5. A panel that never gains its five chips is still a
      // failure — that is what the message says.
      await expect.poll(async () => await chips.count(), {
        message: 'the Export panel never offered its five chips; the exportable report types are ' +
          'overview, revenue, pipeline, hr and sales',
        timeout: 45_000,
      }).toBe(5);
      const labels = await chips.allTextContents();

      const buffers: Record<string, Buffer> = {};
      for (const t of ['overview', 'revenue', 'pipeline', 'hr', 'sales']) {
        const chip = p.getByRole('button', { name: new RegExp(`^${t} CSV$`, 'i') });
        await expect(chip, `the Export panel offers no "${t} CSV" chip`).toBeVisible();
        buffers[t] = await download(page, () => chip.click(), `export-${t}-alltime.csv`);
        got.push(`${t} CSV (all time)`);
      }

      // ── THE SAME FIVE AGAIN OVER A NARROWED WINDOW ────────────────────────
      //
      // §4 asks for each report to be run again over a different period, and an
      // export that ignores the window is a file that says nothing about which
      // dates it covers.
      //
      // ⚠ THE WINDOW IS DERIVED FROM THE DATA, NOT PICKED. The first version of
      // this check chose "Last 30 days" and asserted the file changed — and it
      // did not, correctly: every Unicode invoice is dated inside the last
      // thirty days, so the narrower window contains all of them and the two
      // files are legitimately identical. That would have been a product defect
      // filed against arithmetic that was right.
      //
      // So the daily split is read first and the window is set to EXCLUDE THE
      // LAST POPULATED DAY. That turns a vague "it should differ" into an exact
      // figure: the windowed total must equal the all-time total minus exactly
      // what fell on the day that was cut off. If the org's invoices ever sit
      // on a single day the narrowing is impossible and that is SAID, not
      // silently passed.
      const daily = (await query(page,
        { source: 'invoices', group_by: 'invoice_date', measure: 'sum' }) as any[])
        .filter((r) => Number(r.value) > 0)
        .map((r) => ({ day: String(r.label).slice(0, 10), value: Number(r.value) }))
        .sort((a, b) => a.day.localeCompare(b.day));

      const bar = page.locator('.dwin');
      const windowed: Record<string, Buffer> = {};
      let narrowed: { from: string; to: string; cut: number } | null = null;

      if (daily.length >= 2) {
        const last = daily[daily.length - 1];
        narrowed = { from: daily[0].day, to: daily[daily.length - 2].day, cut: last.value };
        await bar.getByRole('button', { name: 'Custom…', exact: true }).click();
        const custom = bar.locator('.dwin__custom');
        await expect(custom, 'choosing "Custom…" revealed no date fields').toBeVisible();
        await setDateAria(page, custom, 'From date', narrowed.from);
        await setDateAria(page, custom, 'To date', narrowed.to);
        await expect.poll(async () => (await bar.locator('.dwin__note').innerText()).trim(), {
          message: 'the period bar never stated the custom window it was given',
          timeout: 20_000,
        }).toMatch(/Showing/);
      } else {
        await bar.getByRole('button', { name: 'Last 30 days', exact: true }).click();
      }

      for (const t of ['overview', 'revenue', 'pipeline', 'hr', 'sales']) {
        const chip = p.getByRole('button', { name: new RegExp(`^${t} CSV$`, 'i') });
        windowed[t] = await download(page, () => chip.click(), `export-${t}-narrow.csv`);
        got.push(`${t} CSV (${narrowed ? `${narrowed.from}…${narrowed.to}` : 'last 30 days'})`);
      }
      await bar.getByRole('button', { name: 'All time', exact: true }).click();

      // ── WHAT THE FILES SAY, AGAINST WHAT THE SCREENS SAY ──────────────────
      // Both sides read back to back: this org is being written to while the
      // suite runs and a comparison against a figure read ten minutes ago is a
      // comparison against a different organisation.
      const overview = await apiOne(page, '/api/v1/dristi/overview');
      const salesApi = await apiOne(page, '/api/v1/dristi/sales');
      const pipelineApi = await apiOne(page, '/api/v1/dristi/pipeline');
      const revenueApi = await apiOne(page, '/api/v1/dristi/revenue');
      const paidBucket = (await query(page,
        { source: 'invoices', group_by: 'payment_status', measure: 'sum' }) as any[])
        .find((r) => String(r.label) === 'paid');

      const num = (s: any) => Number(String(s ?? '').replace(/[^0-9.-]/g, '')) || 0;

      // overview.csv — tasks · contacts · revenue
      const ov = csvRows(buffers.overview);
      rec.eq('overview CSV "contacts" = the Overview screen\'s contact count',
        'the CSV', num(csvFind(ov, 'contacts')?.[1]),
        'GET /v1/dristi/overview crm.total_contacts', Number(overview?.crm?.total_contacts), 0);
      rec.eq('overview CSV "tasks" = the Overview screen\'s task count',
        'the CSV', num(csvFind(ov, 'tasks')?.[1]),
        'GET /v1/dristi/overview tasks.total_tasks', Number(overview?.tasks?.total_tasks), 0);
      rec.eq('overview CSV "revenue" = the paid bucket of the invoice register',
        'the CSV', num(csvFind(ov, 'revenue')?.[1]),
        'POST /v1/dristi/query invoices by payment_status → paid', Number(paidBucket?.value));

      // hr.csv — headcount
      const hr = csvRows(buffers.hr);
      rec.eq('hr CSV "active_employees" = the Overview screen\'s headcount',
        'the CSV', num(csvFind(hr, 'active_employees')?.[1]),
        'GET /v1/dristi/overview hr.headcount', Number(overview?.hr?.headcount), 0);

      // pipeline.csv — one row per stage, against the Pipeline tab's own stages
      const pipeRows = csvRows(buffers.pipeline).slice(2).filter((r) => r[0]);
      const apiStages = new Map<string, any>((pipelineApi?.stages || []).map((s: any) => [String(s.stage), s]));
      rec.eq('pipeline CSV covers exactly the stages the Pipeline tab draws',
        'stages in the CSV', pipeRows.length, 'stages from GET /v1/dristi/pipeline', apiStages.size, 0);
      for (const r of pipeRows) {
        const s = apiStages.get(r[0]);
        if (!s) {
          rec.eq(`pipeline CSV stage "${r[0]}" exists on the screen`, 'in the CSV', 1, 'on the screen', 0, 0);
          continue;
        }
        rec.eq(`pipeline CSV "${r[0]}" count = the Pipeline tab's`,
          'the CSV', num(r[1]), 'GET /v1/dristi/pipeline', Number(s.count), 0);
        rec.eq(`pipeline CSV "${r[0]}" value = the Pipeline tab's`,
          'the CSV', num(r[2]), 'GET /v1/dristi/pipeline', Number(s.value));
      }

      // sales.csv — one row per status, against the Sales tab's own split
      const salesRows = csvRows(buffers.sales).slice(2).filter((r) => r[0]);
      const apiSplit = new Map<string, any>((salesApi?.status_split || []).map((s: any) => [String(s.status), s]));
      rec.eq('sales CSV covers exactly the statuses the Sales tab draws',
        'statuses in the CSV', salesRows.length,
        'statuses from GET /v1/dristi/sales', apiSplit.size, 0);
      rec.eq('sales CSV total order value = the Sales tab\'s total order value',
        'Σ over the CSV\'s status rows', salesRows.reduce((a, r) => a + num(r[2]), 0),
        'Σ over GET /v1/dristi/sales status_split',
        (salesApi?.status_split || []).reduce((a: number, s: any) => a + Number(s.value || 0), 0));
      for (const r of salesRows) {
        const s = apiSplit.get(r[0]);
        if (!s) {
          rec.eq(`sales CSV status "${r[0]}" exists on the screen too`,
            'orders in the CSV', num(r[1]), 'orders on the screen', 0, 0);
          continue;
        }
        rec.eq(`sales CSV "${r[0]}" count = the Sales tab's`,
          'the CSV', num(r[1]), 'GET /v1/dristi/sales', Number(s.count), 0);
      }

      // revenue.csv — month, total, count against the Revenue tab's trend
      const revRows = csvRows(buffers.revenue).slice(2).filter((r) => r[0]);
      const trend = new Map<string, any>((revenueApi?.trend || [])
        .map((t: any) => [String(t.month), t]));
      for (const r of revRows) {
        const month = String(r[0]).slice(0, 7);
        const t = trend.get(month);
        if (!t) continue;
        rec.eq(`revenue CSV ${month} invoiced = the Revenue tab's`,
          'the CSV', num(r[1]), 'GET /v1/dristi/revenue trend', Number(t.invoiced));
      }

      // The windowed FLOW report must carry exactly the total the narrowing
      // implies. `pipeline` and `hr` are stocks and are true as at today
      // whatever dates are asked for — the artefact says "as at" rather than
      // implying a period, and that is correct, not a defect.
      if (narrowed) {
        const allTotal = csvRows(buffers.revenue).slice(2).filter((r) => r[0])
          .reduce((a, r) => a + num(r[1]), 0);
        const narrowTotal = csvRows(windowed.revenue).slice(2).filter((r) => r[0])
          .reduce((a, r) => a + num(r[1]), 0);
        rec.eq(`the revenue export honours the window (${narrowed.from}…${narrowed.to}, ` +
          `cutting the ${daily[daily.length - 1].day} invoices)`,
          'the windowed CSV total', narrowTotal,
          'the all-time CSV total minus what fell on the excluded day',
          allTotal - narrowed.cut);
        expect(windowed.revenue.equals(buffers.revenue),
          'the "revenue" export is byte-identical over all time and over a window that ' +
          `deliberately excludes ${narrowed.cut} of invoicing. That report is a FLOW, so a ` +
          'narrowed period must narrow it — an export that ignores its window is a file that ' +
          'says nothing about which dates it covers')
          .toBe(false);
      } else {
        console.log('\n  12.10 — the revenue window could not be narrowed: every invoice in this ' +
          'org falls on ONE day, so no period excludes any of them. Reported rather than ' +
          'asserted, because there is nothing here a narrowing could prove.\n');
      }

      // ── The client-side chart exports ─────────────────────────────────────
      // These build the file from what is already on screen, so they cannot
      // disagree with it by construction — but a control that produces no file
      // is still a dead control, which is what is checked.
      const revTab = await openTab(page, 'revenue', 'Revenue');
      const revBtn = revTab.getByRole('button', { name: /Export CSV/ });
      await expect(revBtn, 'the Revenue tab offers no Export CSV').toBeVisible();
      await download(page, () => revBtn.click(), 'revenue-trend.csv');
      got.push('Revenue tab · Export CSV');

      const salesTab = await openTab(page, 'sales', 'Sales');
      const salesBtn = salesTab.getByRole('button', { name: /Export CSV/ });
      await expect(salesBtn, 'the Sales tab offers no Export CSV').toBeVisible();
      await download(page, () => salesBtn.click(), 'order-trend.csv');
      got.push('Sales tab · Export CSV');

      const dash = await openTab(page, 'dashboards', 'Dashboards');
      const cards = dash.locator('.dgal .dchart');
      const nCards = await cards.count();
      expect(nCards, 'the chart gallery drew no cards').toBeGreaterThanOrEqual(4);
      for (let i = 0; i < Math.min(4, nCards); i++) {
        await cards.nth(i).click();
        // ⚠ WAIT FOR THE CARD TO FINISH ITS QUERY BEFORE JUDGING ITS BUTTON.
        // `runCard` is async and `Export this chart` is `disabled={!rows.length}`,
        // so reading the button the instant the card is selected catches it
        // mid-flight, reports a working export as disabled, and skips it. That
        // is how the first run of this test took 14 exports instead of 24 —
        // charts 1 and 2 were simply still loading. Settled = the card has
        // drawn a chart, or has said why it cannot.
        await expect.poll(async () => {
          const c = cards.nth(i);
          const drew = await c.locator('.dbars, .dfun, .dmet, .dnone, .dchart__err').count();
          return drew;
        }, {
          message: `chart ${i + 1} neither drew anything nor stated why within 45s — a card that ` +
            'is permanently a shimmer is the loading-state-forever defect `_shared.jsx` names',
          timeout: 45_000,
        }).toBeGreaterThan(0);

        const cfg = dash.locator('.dcard', { hasText: 'Configure' }).first();
        const btn = cfg.getByRole('button', { name: /Export this chart/ });
        await expect(btn, 'the Configure panel offers no chart export').toBeVisible();
        if (await btn.isDisabled()) {
          // A disabled export over a card that drew rows is a dead control; over
          // a card that drew nothing it is correct. Say which.
          const drew = await cards.nth(i).locator('.dbars, .dfun, .dmet').count();
          expect(drew,
            `chart ${i + 1} drew data and its "Export this chart" button is disabled`).toBe(0);
          continue;
        }
        await download(page, () => btn.click(), `chart-${i + 1}.csv`);
        got.push(`Dashboards · chart ${i + 1} export`);
      }

      // ── The metric downloads: CSV, XLSX and PDF off the same /run URL ─────
      // §4 asks for "CSV and PDF per report" and this is the only surface in
      // Dristi that offers a PDF. ⚠ THE REPORTS TAB DOES NOT: its exportCSV
      // hardcodes `format=csv` (`ReportsTab.jsx:177`) while
      // `GET /v1/dristi/exports/{type}` accepts csv, xlsx AND pdf. That is a
      // route with no control in front of it — the shape 93 §E sweeps for —
      // and it is reported in 12.12 rather than worked around here.
      const anx = await openTab(page, 'analytics', 'Analytics');
      const dls = anx.locator('.anx-dl');
      await expect.poll(async () => await dls.count(), {
        message: 'the analytics surface offers no download controls at all',
        timeout: 45_000,
      }).toBeGreaterThan(0);
      const nDl = Math.min(5, await dls.count());
      let dlTaken = 0;
      for (let i = 0; i < nDl; i++) {
        for (const fmt of ['CSV', 'XLSX', 'PDF']) {
          // ⚠ THE ACCESSIBLE NAME, NOT THE VISIBLE TEXT. These chips READ "CSV"
          // and are labelled `Download <metric> as CSV`; `getByRole` matches the
          // accessible name, so `/^CSV$/` matches nothing at all and every one
          // of these nine downloads was silently skipped on the first run —
          // reported as "14 exports" rather than as a missing control, which is
          // exactly the failure mode the brief's last suite rule names.
          const btn = dls.nth(i).getByRole('button', { name: new RegExp(`\\bas ${fmt}$`) });
          expect(await btn.count(),
            `the analytics card ${i + 1} offers no ${fmt} download. Its siblings are labelled ` +
            '"Download <metric> as CSV/XLSX/PDF" — a missing one is a missing control, not a ' +
            'selector miss').toBeGreaterThan(0);
          dlTaken += 1;
          const buf = await download(page, () => btn.first().click(), `metric-${i}-${fmt.toLowerCase()}`);
          if (fmt === 'PDF') {
            expect(buf.subarray(0, 5).toString('latin1'),
              `metric download ${i} asked for a PDF and got something else — "a 200 with an ` +
              'empty body" wearing a content type is the failure §1 names').toBe('%PDF-');
          }
          got.push(`Analytics · card ${i + 1} ${fmt}`);
        }
      }

      const files = (ledgerRead().exports || []).length;
      console.log(`\n  12.10 — ${got.length} exports taken this test (${dlTaken} of them metric ` +
        `downloads), ${files} distinct files on disk across the run (§4 wants ${N_EXPORTS}):\n` +
        `     ${got.join('\n     ')}\n`);

      // ⚠ THE RECONCILIATION SETTLES FIRST, AND THE ORDER IS THE POINT.
      // On the first full run the count assertion below fired at 14 exports and
      // ABORTED THE TEST, so every figure this test had just read out of every
      // file went unasserted — the export-versus-screen comparisons that are
      // the whole reason 12.10 exists were silently not run, under a failure
      // message about a count. A test that aborts hides everything after it
      // (`suite05`'s own note); the cheapest fix is to put the thing that
      // matters first.
      rec.settle('12.10 exports against the screens they were taken from');

      expect(got.length,
        `§4 asks for ${N_EXPORTS} exports. This test took ${got.length}; 12.06 and 12.09 take the ` +
        'rest. Every one is asserted to have produced a file with bytes in it.')
        .toBeGreaterThanOrEqual(24);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  test('12.11 every headline figure reconciled to the module it summarises',
    async ({ page }) => {
      const con = watchConsole(page);
      await signIn(page);
      const rec = new Recon();

      // Everything on both sides is read back to back. Nothing below is a
      // constant, and nothing below is the sum of a capped list.
      const overview = await apiOne(page, '/api/v1/dristi/overview');
      const pipelineApi = await apiOne(page, '/api/v1/dristi/pipeline');
      const revenueApi = await apiOne(page, '/api/v1/dristi/revenue');
      const hrApi = await apiOne(page, '/api/v1/dristi/hr');
      const salesApi = await apiOne(page, '/api/v1/dristi/sales');
      const { from, to } = explicitBounds();
      const runOf = async (metric: string, grain: 'flow' | 'stock', extra = '') => {
        const q = new URLSearchParams({ metric });
        if (grain === 'flow') { q.set('date_from', from); q.set('date_to', to); q.set('bucket', 'year'); }
        const r = await apiRaw(page, `/api/v1/analytics/run?${q.toString()}${extra}`);
        ledgerBump('runs');
        return r;
      };

      // ══ MONEY — the invoice register, three ways ═══════════════════════════
      const invoiced = await runOf('ganit.invoiced', 'flow');
      const collected = await runOf('ganit.collected', 'flow');
      const outstanding = await runOf('ganit.outstanding', 'stock');
      const sum = (p: any) => (p?.data || []).reduce((a: number, r: any) => a + (Number(r.value) || 0), 0);

      rec.eq('Overview "Invoiced" = the analytics registry\'s ganit.invoiced',
        'GET /v1/dristi/overview revenue.total_invoiced', Number(overview?.revenue?.total_invoiced),
        'GET /v1/analytics/run ganit.invoiced', sum(invoiced));
      rec.eq('Overview "Collected" = the analytics registry\'s ganit.collected',
        'GET /v1/dristi/overview revenue.total_collected', Number(overview?.revenue?.total_collected),
        'GET /v1/analytics/run ganit.collected', sum(collected));
      rec.eq('Overview "Outstanding" = the analytics registry\'s ganit.outstanding',
        'GET /v1/dristi/overview revenue.outstanding', Number(overview?.revenue?.outstanding),
        'GET /v1/analytics/run ganit.outstanding', Number(outstanding?.data?.[0]?.value));

      // The pivot engine is a THIRD implementation of the same question.
      const qTotal = await query(page, { source: 'invoices', group_by: '', measure: 'sum' });
      const qByStatus = await query(page, { source: 'invoices', group_by: 'payment_status', measure: 'sum' }) as any[];
      rec.eq('Overview "Invoiced" = the pivot engine\'s ungrouped invoice total',
        'GET /v1/dristi/overview revenue.total_invoiced', Number(overview?.revenue?.total_invoiced),
        'POST /v1/dristi/query invoices, no dimension, sum', Number(qTotal?.value));
      rec.eq('the pivot\'s payment-status split sums to its own ungrouped total',
        'Σ over the payment_status groups', qByStatus.reduce((a, r) => a + Number(r.value || 0), 0),
        'POST /v1/dristi/query invoices, no dimension, sum', Number(qTotal?.value));
      // ⚠ THE CLOSURE IDENTITY, AND THE PAIR THAT LOOKS LIKE IT BUT IS NOT.
      //
      // Collected + Outstanding must equal Invoiced. That is the one arithmetic
      // relation the three money headlines actually owe each other:
      //   Σamount_paid  +  Σ(total − amount_paid) over the unsettled rows
      //   = Σtotal over the settled rows + Σtotal over the unsettled ones.
      // It is the check a partner would do by hand, and it closes the page.
      //
      // What is NOT an identity — and was asserted as one here until it failed
      // and was corrected — is `the pivot's "paid" bucket = Collected`. The
      // pivot's buckets are `SUM(total)` GROUPED BY payment_status; Collected is
      // `SUM(amount_paid)` over every non-draft row. Those coincide exactly
      // while no invoice is part-paid, and diverge the moment one is: measured
      // 2026-08-29 a `partial` bucket appeared and the two figures parted by
      // ₹1.00. Asserting their equality was a TEST BUG that would have accused
      // the product of an arithmetic fault the first time somebody recorded a
      // part payment. The buckets are still checked — against their own
      // ungrouped total, immediately above, which IS what they owe.
      rec.eq('Collected + Outstanding = Invoiced — the three money headlines close',
        'GET /v1/dristi/overview collected + outstanding',
        Number(overview?.revenue?.total_collected) + Number(overview?.revenue?.outstanding),
        'GET /v1/dristi/overview revenue.total_invoiced',
        Number(overview?.revenue?.total_invoiced));

      const paid = qByStatus.find((r) => String(r.label) === 'paid');
      const partial = qByStatus.find((r) => String(r.label) === 'partial');
      if (paid) {
        console.log(`\n  12.11 — the invoice register by payment status: ` +
          qByStatus.map((r) => `${r.label} ${r.value}`).join(' · ') +
          `\n     (the "paid" bucket is SUM(total) of settled invoices, ` +
          `${Number(paid.value)}; the screen's "Collected" is SUM(amount_paid) over every ` +
          `non-draft row, ${Number(overview?.revenue?.total_collected)}. They differ by exactly ` +
          `the part-payments taken against unsettled invoices` +
          (partial ? `, and there IS a "partial" bucket of ${Number(partial.value)} today` : '') +
          '. Two questions, not one figure — recorded so nobody reconciles them again.)\n');
      }

      // The Revenue tab's own trend, against the same aggregate.
      const trendInvoiced = (revenueApi?.trend || [])
        .reduce((a: number, r: any) => a + Number(r.invoiced || 0), 0);
      rec.eq('the Revenue tab\'s month-by-month invoiced adds up to the Overview headline',
        'Σ over GET /v1/dristi/revenue trend', trendInvoiced,
        'GET /v1/dristi/overview revenue.total_invoiced', Number(overview?.revenue?.total_invoiced));
      const trendCollected = (revenueApi?.trend || [])
        .reduce((a: number, r: any) => a + Number(r.collected || 0), 0);
      rec.eq('the Revenue tab\'s month-by-month collected adds up to the Overview headline',
        'Σ over GET /v1/dristi/revenue trend', trendCollected,
        'GET /v1/dristi/overview revenue.total_collected', Number(overview?.revenue?.total_collected));

      // Receivables ageing must account for the whole of outstanding — a bucket
      // that drops rows is how a partner chases the wrong client.
      const ageing = await runOf('ganit.receivables_ageing', 'stock');
      rec.eq('the receivables-ageing buckets add up to Outstanding',
        'Σ over GET /v1/analytics/run ganit.receivables_ageing', sum(ageing),
        'GET /v1/dristi/overview revenue.outstanding', Number(overview?.revenue?.outstanding));

      // ══ DEALS — and the label that does not describe the figure ════════════
      const stages: any[] = pipelineApi?.stages || [];
      const allStages = stages.reduce((a, s) => a + Number(s.value || 0), 0);
      const openStages = stages.filter((s) => s.stage !== 'Won' && s.stage !== 'Lost')
        .reduce((a, s) => a + Number(s.value || 0), 0);
      // ⚠ THIS COMPARED ALL STAGES AGAINST THE HEADLINE, AND THE FILE ALSO
      // COMPARES THE OPEN STAGES AGAINST THE SAME HEADLINE (below). Both can
      // only hold on an org where no deal has ever closed — so the pair was a
      // contradiction, and it read as satisfied only because the product was
      // on the wrong side of it: `deals.pipeline_value` was SUM(value) over
      // EVERY deal while both strips printed it as "Open pipeline".
      //
      // That was fixed on 2026-08-31 (the headline is now the open pipeline,
      // and migration 242 backfilled the close timestamps it reads). The
      // all-stages reading has no headline to equal any more, and inventing
      // one would put the old defect back.
      //
      // What survives is the DECOMPOSITION, which is the real invariant and a
      // strictly stronger check than either half was: the funnel's own closed
      // stages plus the headline must be the funnel's total. It catches a
      // stage the headline wrongly includes AND one it wrongly drops.
      const closedStages = stages
        .filter((s) => s.stage === 'Won' || s.stage === 'Lost')
        .reduce((a, s) => a + Number(s.value || 0), 0);
      rec.eq('the Pipeline tab decomposes into the headline plus its closed stages',
        'Σ over GET /v1/dristi/pipeline stages', allStages,
        'GET /v1/dristi/overview deals.pipeline_value + the funnel\'s Won and Lost',
        Number(overview?.deals?.pipeline_value) + closedStages);

      // And the funnel's Won agrees with the Overview's, which still counts on
      // the STAGE — the two surfaces must not drift apart on the closed side
      // just because the open side is now measured differently.
      rec.eq('the Pipeline tab\'s Won value = the Overview Won value',
        'Σ over GET /v1/dristi/pipeline stages where stage = Won',
        stages.filter((s) => s.stage === 'Won')
          .reduce((a, s) => a + Number(s.value || 0), 0),
        'GET /v1/dristi/overview deals.won_value', Number(overview?.deals?.won_value));

      // ⚠ THE LABEL. `deals.pipeline_value` is SUM(value) over EVERY deal and
      // both the KPI strip and the Overview tab print it as "Open pipeline".
      // The Pipeline tab's funnel — one click away, on the same page, under the
      // same window — deliberately drops Won and Lost. Two figures, one label.
      rec.eq('the "Open pipeline" headline is the OPEN pipeline (Won and Lost excluded)',
        'GET /v1/dristi/overview deals.pipeline_value, labelled "Open pipeline"',
        Number(overview?.deals?.pipeline_value),
        'Σ over the Pipeline tab\'s funnel, which excludes Won and Lost', openStages);

      const dealCounts = stages.reduce((a, s) => a + Number(s.count || 0), 0);
      rec.eq('the Pipeline tab\'s stage counts add up to the Overview deal count',
        'Σ over GET /v1/dristi/pipeline stages', dealCounts,
        'GET /v1/dristi/overview deals.total_deals', Number(overview?.deals?.total_deals), 0);
      rec.eq('the Pipeline tab\'s conversion block agrees with the Overview deal count',
        'GET /v1/dristi/pipeline conversion.total', Number(pipelineApi?.conversion?.total),
        'GET /v1/dristi/overview deals.total_deals', Number(overview?.deals?.total_deals), 0);
      rec.eq('the Pipeline tab\'s won count agrees with the Overview won count',
        'GET /v1/dristi/pipeline conversion.won', Number(pipelineApi?.conversion?.won),
        'GET /v1/dristi/overview deals.won_deals', Number(overview?.deals?.won_deals), 0);

      // ⚠ AND THE ANALYTICS BOARD'S OWN VIEW OF THE SAME DEALS.
      // `graha.pipeline_by_stage` defines open by the won_at/lost_at TIMESTAMPS
      // — "never a stage string" — so it and the Pipeline tab agree only if the
      // write path stamps them. It does not on create.
      const byStage = await runOf('graha.pipeline_by_stage', 'stock');
      const openByTimestamp = (byStage?.data || [])
        .filter((r: any) => r.label !== 'Won' && r.label !== 'Lost')
        .reduce((a: number, r: any) => a + Number(r.value || 0), 0);
      rec.eq('the analytics board and the Pipeline tab agree which deals are open',
        'Σ over GET /v1/analytics/run graha.pipeline_by_stage, minus Won and Lost', openByTimestamp,
        'Σ over the Pipeline tab\'s funnel', openStages);
      const closedShownAsOpen = (byStage?.data || [])
        .filter((r: any) => r.label === 'Won' || r.label === 'Lost')
        .reduce((a: number, r: any) => a + Number(r.deals || 0), 0);
      rec.eq('no deal on a Won or Lost stage is counted as open pipeline by the analytics board',
        'deals on a closed stage that graha.pipeline_by_stage still counts as open', closedShownAsOpen,
        'the number that may be', 0, 0);

      // Deal-level pivot, a third reading.
      const qDeals = await query(page, { source: 'deals', group_by: 'stage', measure: 'sum' }) as any[];
      // Same correction as the funnel above: the pivot groups EVERY stage, so
      // its total is comparable to the funnel's total and not to a headline
      // that now means open pipeline. Comparing the two all-stage readings to
      // each other is what this line was really for — a third engine over the
      // same table — and it no longer depends on how the headline is scoped.
      rec.eq('the pivot engine\'s deals-by-stage total = the Pipeline tab\'s',
        'Σ over POST /v1/dristi/query deals by stage',
        qDeals.reduce((a, r) => a + Number(r.value || 0), 0),
        'Σ over GET /v1/dristi/pipeline stages', allStages);

      // …and the pivot's OPEN subtotal is the headline, which is the assertion
      // the old line was reaching for. Both readings are now scoped the same
      // way before they are compared.
      rec.eq('the pivot engine\'s OPEN deals total = the "Open pipeline" headline',
        'Σ over POST /v1/dristi/query deals by stage, minus Won and Lost',
        qDeals.filter((r: any) => r.stage !== 'Won' && r.stage !== 'Lost')
          .reduce((a, r) => a + Number(r.value || 0), 0),
        'GET /v1/dristi/overview deals.pipeline_value',
        Number(overview?.deals?.pipeline_value));

      // ══ PEOPLE ════════════════════════════════════════════════════════════
      const headcount = await runOf('manav.headcount', 'stock');
      rec.eq('Overview headcount = the analytics registry\'s manav.headcount',
        'GET /v1/dristi/overview hr.headcount', Number(overview?.hr?.headcount),
        'GET /v1/analytics/run manav.headcount', Number(headcount?.data?.[0]?.value), 0);
      const deptTotal = (hrApi?.departments || [])
        .reduce((a: number, d: any) => a + Number(d.count || 0), 0);
      rec.eq('the HR tab\'s headcount-by-department adds up to the Overview headcount',
        'Σ over GET /v1/dristi/hr departments', deptTotal,
        'GET /v1/dristi/overview hr.headcount', Number(overview?.hr?.headcount), 0);
      const qEmp = await query(page, { source: 'employees', group_by: 'department', measure: 'count' }) as any[];
      rec.eq('the pivot engine\'s employees-by-department = the HR tab\'s',
        'Σ over POST /v1/dristi/query employees by department',
        qEmp.reduce((a, r) => a + Number(r.value || 0), 0),
        'Σ over GET /v1/dristi/hr departments', deptTotal, 0);
      const leave = hrApi?.leave_stats || {};
      rec.eq('the HR tab\'s leave states add up to its own leave total',
        'approved + pending + rejected',
        Number(leave.approved || 0) + Number(leave.pending || 0) + Number(leave.rejected || 0),
        'GET /v1/dristi/hr leave_stats.total_leaves', Number(leave.total_leaves || 0), 0);

      // ══ ORDERS ════════════════════════════════════════════════════════════
      const orders = await runOf('vikray.orders', 'flow');
      rec.eq('Overview order value = the analytics registry\'s vikray.orders',
        'GET /v1/dristi/overview orders.order_value', Number(overview?.orders?.order_value),
        'GET /v1/analytics/run vikray.orders', sum(orders));
      const splitCount = (salesApi?.status_split || [])
        .reduce((a: number, s: any) => a + Number(s.count || 0), 0);
      const splitValue = (salesApi?.status_split || [])
        .reduce((a: number, s: any) => a + Number(s.value || 0), 0);
      rec.eq('the Sales tab\'s status split adds up to the Overview order count',
        'Σ over GET /v1/dristi/sales status_split', splitCount,
        'GET /v1/dristi/overview orders.total_orders', Number(overview?.orders?.total_orders), 0);
      rec.eq('the Sales tab\'s status split adds up to the Overview order value',
        'Σ over GET /v1/dristi/sales status_split', splitValue,
        'GET /v1/dristi/overview orders.order_value', Number(overview?.orders?.order_value));
      const qOrders = await query(page, { source: 'orders', group_by: 'status', measure: 'sum' }) as any[];
      rec.eq('the pivot engine\'s orders-by-status total = the Overview order value',
        'Σ over POST /v1/dristi/query orders by status',
        qOrders.reduce((a, r) => a + Number(r.value || 0), 0),
        'GET /v1/dristi/overview orders.order_value', Number(overview?.orders?.order_value));
      const trendOrders = (salesApi?.order_trend || [])
        .reduce((a: number, r: any) => a + Number(r.value || 0), 0);
      rec.eq('the Sales tab\'s order trend adds up to its own status split',
        'Σ over GET /v1/dristi/sales order_trend', trendOrders,
        'Σ over GET /v1/dristi/sales status_split', splitValue);

      // ══ WORK ══════════════════════════════════════════════════════════════
      const byStatus = await runOf('core.tasks_by_status', 'stock');
      rec.eq('the analytics registry\'s tasks-by-status adds up to the Overview task count',
        'Σ over GET /v1/analytics/run core.tasks_by_status', sum(byStatus),
        'GET /v1/dristi/overview tasks.total_tasks', Number(overview?.tasks?.total_tasks), 0);
      const overdue = await runOf('core.overdue', 'stock');
      rec.eq('Overview overdue tasks = the analytics registry\'s core.overdue',
        'GET /v1/dristi/overview tasks.overdue_tasks', Number(overview?.tasks?.overdue_tasks),
        'GET /v1/analytics/run core.overdue', Number(overdue?.data?.[0]?.value), 0);

      // ══ CRM ═══════════════════════════════════════════════════════════════
      const contacts = await apiEnvelope(page, '/api/v1/graha/contacts');
      if (contacts?.truncated !== true && Number(contacts?.total) === (contacts?.data || []).length) {
        rec.eq('Overview contact count = the CRM register\'s own count',
          'GET /v1/dristi/overview crm.total_contacts', Number(overview?.crm?.total_contacts),
          'GET /v1/graha/contacts envelope total', Number(contacts.total), 0);
      } else {
        // The register is capped. `total` is COUNT(*) OVER() and is still the
        // canonical figure — the ROWS are what may not be summed.
        rec.eq('Overview contact count = the CRM register\'s COUNT(*) OVER()',
          'GET /v1/dristi/overview crm.total_contacts', Number(overview?.crm?.total_contacts),
          `GET /v1/graha/contacts envelope total (${(contacts?.data || []).length} of ${contacts?.total} rows returned)`,
          Number(contacts?.total), 0);
      }
      const qContacts = await query(page, { source: 'contacts', group_by: 'contact_type', measure: 'count' }) as any[];
      const leads = qContacts.find((r) => String(r.label) === 'lead');
      if (leads) {
        rec.eq('the pivot engine\'s lead count = the Overview screen\'s',
          'POST /v1/dristi/query contacts by contact_type → lead', Number(leads.value),
          'GET /v1/dristi/overview crm.leads', Number(overview?.crm?.leads), 0);
      }

      // ══ THE WINDOW IS HONOURED, AND THE SAME WAY BY BOTH DOORS ════════════
      // A windowed figure that ignores its window is the worst of the six wrong
      // figures: it is correct arithmetic over the wrong rows.
      const w = { from: `${new Date().getFullYear()}-01-01`, to };
      const wOverview = await apiOne(page,
        `/api/v1/dristi/overview?date_from=${w.from}&date_to=${w.to}`);
      const wQuery = await query(page,
        { source: 'invoices', group_by: '', measure: 'sum', date_from: w.from, date_to: w.to });
      rec.eq(`the windowed Overview (${w.from}→${w.to}) = the windowed pivot engine`,
        'GET /v1/dristi/overview?date_from=…', Number(wOverview?.revenue?.total_invoiced),
        'POST /v1/dristi/query with the same dates', Number(wQuery?.value));
      expect(wOverview?.window,
        'a windowed /overview returns no `window` block naming which figures the period was ' +
        'applied to — the KPI strip prints stocks and flows side by side and the reader has no ' +
        'way to tell which is which').toBeTruthy();

      const total = rec.rows.length;
      ledgerWrite({ reconciliations: total });
      console.log(`\n  12.11 — ${total} headline figures checked against the module they summarise ` +
        `(§4 wants ~${N_RECONCILED} across the suite; 12.06, 12.09 and 12.10 carry the rest)\n`);
      rec.settle('12.11 headline figures');
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  test('12.12 the §4 volume sheet, no rendered id, and the protected set intact',
    async ({ page }) => {
      const con = watchConsole(page);
      await signIn(page);

      // ── §12 — Aekam Inc is no-touch ───────────────────────────────────────
      const led = ledgerRead();
      const after = await apiRows(page, `/api/tasks?team_id=${PROTECTED_TEAM}`);
      const digestAfter = createHash('md5')
        .update(after.map((t: any) => t.task_id).sort().join(','))
        .digest('hex');
      expect(after.length,
        `the protected Aekam Inc team held ${led.protectedCountBefore} unarchived tasks when this ` +
        `run began and holds ${after.length} now`).toBe(led.protectedCountBefore);
      expect(digestAfter,
        'the protected task set has CHANGED during this run. 93 §12 guarantees it untouched; ' +
        'Dristi only reads it, so a change here means something in this suite wrote where it ' +
        'must not').toBe(led.protectedDigestBefore);

      // ── NO USER, MEMBER OR ORG UUID ON ANY DRISTI SCREEN ──────────────────
      // `check-rendered-ids.mjs` is static and positional and cannot see an id
      // the server pre-formatted into a string. ⚠ `/v1/dristi/sales` returns
      // `salesperson_id` on the wire — the screen must render only the name.
      const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
      const USERID = /\buser_[0-9a-f]{12}\b/;
      const offences: string[] = [];
      for (const [id, label] of TABS) {
        const p = await openTab(page, id, label);
        const painted = await p.innerText();
        const u = painted.match(UUID);
        const k = painted.match(USERID);
        if (u) offences.push(`${label}: a UUID is painted on screen — "${u[0]}"`);
        if (k) offences.push(`${label}: a user id is painted on screen — "${k[0]}"`);
      }
      expect(offences,
        `a user/member/org identifier reached a Dristi screen:\n     ${offences.join('\n     ')}`)
        .toEqual([]);

      // ── THE VOLUME SHEET ──────────────────────────────────────────────────
      // Read live, never from what an earlier test believed it created.
      const boards = (await apiRows(page, '/api/v1/dristi/dashboards'))
        .filter((b: any) => String(b.name || '').startsWith(`${TAG} Board `));
      const widgets = boards.reduce((a: number, b: any) => a + (Array.isArray(b.widgets) ? b.widgets.length : 0), 0);
      const views = ((await apiOne(page, '/api/v1/analytics/views?module=dristi'))?.personal || [])
        .filter((v: any) => String(v.name || '').startsWith(`${TAG} View `));
      const alerts = (await apiOne(page, '/api/v1/analytics/alerts'))?.alerts || [];
      const schedules = (await apiRows(page, '/api/v1/dristi/scheduled-reports'))
        .filter((r: any) => String(r.name || '').startsWith(`${TAG} Weekly `));
      const l = ledgerRead();

      const sheet: [string, number, number][] = [
        ['report types run', (l.reportTypes || []).length, N_REPORT_TYPES],
        ['report runs incl. window changes', Number(l.runs || 0), N_RUNS],
        ['exports downloaded', (l.exports || []).length, N_EXPORTS],
        ['dashboards', boards.length, N_DASHBOARDS],
        ['widgets', widgets, N_WIDGETS],
        ['saved views', views.length, N_VIEWS],
        ['pivots', Number(l.pivots || 0), N_PIVOTS],
        ['client reports', Number(l.clientReports || 0), N_CLIENT_REPORTS],
        ['alerts set', alerts.length, N_ALERTS],
        ['alerts breached (condition proved)', Number(l.alertsBreaching || 0), N_BREACHED],
        ['scheduled reports', schedules.length, N_SCHEDULES],
        ['dispatches', Number(l.dispatches || 0), N_DISPATCHES],
        ['figures reconciled to source', (l.reconciled || []).length, N_RECONCILED],
      ];

      console.log('\n  12.12 — §4 VOLUMES, ACHIEVED vs ASKED (live counts, not what a test believed):\n' +
        sheet.map(([name, got, want]) =>
          `     ${got >= want ? '✓' : '✗'} ${name.padEnd(36)} ${String(got).padStart(4)} / ${want}`)
          .join('\n') + '\n' +
        `     figures that did NOT reconcile: ${(l.reconciled || []).filter((r: any) => !r.ok).length}\n` +
        `     protected set: ${after.length} tasks, digest unchanged\n`);

      // A volume sheet that quietly drops the line it cannot meet is the silent
      // cap §10 warns about, so the shortfalls are named individually.
      const short = sheet.filter(([, got, want]) => got < want)
        .map(([name, got, want]) => `${name}: ${got} of ${want}`);
      expect(short,
        `§4 volumes not reached:\n     ${short.join('\n     ')}\n` +
        '     ⚠ "alerts breached" counts the CONDITION being satisfied, not an emitted event — ' +
        'emission is the Niyam sweep\'s and is blocked to this suite (12.07).')
        .toEqual([]);

      assertNoUncaught(con);
    });
});
