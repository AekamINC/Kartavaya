/**
 * Proposal 93 · Stage 3 · WAVE 5 · SUITE 14 — Sahayak / Hub, 17 screens, on
 * Unicode Group, at §4 volumes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE, AND THE GUARD THAT PROVES IT
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` + `signInAs()` from `_lanes.ts`. Read that file's header
 * before changing a line here: on 2026-08-28 a write suite renamed **Aekam
 * Inc** — the one org proposal 93 guarantees is untouched — because the
 * credential in use held `platform_admin` and every request resolved to Aekam
 * via `platform_bypass`. The save genuinely succeeded and the suite went GREEN.
 *
 * `signInAs()` calls `assertOrg()` itself; `signIn()` below re-asserts AFTER
 * pinning the active-org key, because that key is written after the door opens
 * and it is the key that decides which org `X-Org-Id` names.
 *
 * ⚠ THE CREDENTIAL IS NOT PLATFORM, AND THIS SUITE DEPENDS ON THAT BEING TRUE.
 * Measured 2026-08-29 against the deployed service:
 *   GET /api/v1/subscription/my-roles
 *   → {"platform_roles":[],"org_roles":[{…"Unicode Group","role":"org_admin"}],
 *      "is_platform_admin":false}
 * Half the findings below are "an org-scoped customer cannot reach this", and
 * they would every one of them evaporate under a platform token. 14.00 asserts
 * the emptiness of `platform_roles` so a credential swap fails LOUDLY rather
 * than turning this file green by removing the thing it measures.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SEVENTEEN SCREENS §10 ASKS FOR, AND WHERE EACH ONE LIVES
 * ═══════════════════════════════════════════════════════════════════════════
 * §10's row reads: *"Grounded questions citing real rows; skills run,
 * acknowledge a finding, re-run and see the count drop; KB upload then answer;
 * content generate incl. inline image, approve, schedule; credits, top-up,
 * member ceiling, refusal past it; scraper run with cost and margin; brand
 * profile; hub clients. publish / destinations / social accounts excluded —
 * §13."* Those land on two route trees and are named here so nothing reads as
 * covered that is not:
 *
 *   THE ORG'S OWN WORKSPACE — `/hub/org`, seven tab panels
 *    1  sahayak (the assistant)     14.03
 *    2  skills                      14.04 · 14.05 · 14.06
 *    3  content                     14.08
 *    4  generate                    14.07
 *    5  data catalog (scrapers)     14.09
 *    6  data runs                   14.10
 *    7  credits                     14.11
 *
 *   THE AGENCY WORKSPACE — `/hub`, `/hub/clients`, `/hub/clients/{id}`
 *    8  Sahayak Admin dashboard     14.12
 *    9  Hub clients list            14.12
 *   10  client · overview           14.13
 *   11  client · generate           14.13
 *   12  client · content (approve)  14.16
 *   13  client · chat               14.15
 *   14  client · knowledge (KB)     14.14
 *   15  client · brand              14.17
 *   16  client · credits (top-up)   14.18
 *   17  client · skill packs        14.19
 *
 *   EXCLUDED BY DECISION, §13, and NOT the same sentence as blocked:
 *      client · publish  ·  DestinationPicker  ·  AccountsPanel  ·  NetworkCard
 *      AppPanel  ·  /settings/social-accounts  ·  /settings/connectors
 *   The Publish tab is never opened by this file. `hub_publish_queue` and
 *   `hub_social_accounts` therefore END THIS RUN EMPTY, in those words, and
 *   14.21 asserts exactly that so two silent zeroes are not misread as a defect
 *   in six weeks' time.
 *
 * §4's "member ceiling" is not on either tree: the only screen in the product
 * that sets one is Organisation settings → Billing → "Who spent what"
 * (`pages/billing/BillingUsageSection.jsx` + `MemberCeilingModal.jsx`), and
 * 14.20 drives it there. That file belongs to nobody in this wave; it is read
 * and clicked, never edited.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THE ONE FACT THAT SHAPES EVERY TEST BELOW — THE WALLET IS EMPTY
 * ═══════════════════════════════════════════════════════════════════════════
 * Measured on the live database and confirmed on the deployed wire, 2026-08-29.
 *
 * ⚠ THE SERVICE REDEPLOYED TWICE WHILE THIS SUITE WAS BEING WRITTEN AND RUN, so
 * the SHA is stated per run rather than once, and BOTH HALVES were checked each
 * time — a Railway deploy without the matching Vercel one is half a deployment:
 *
 *   run 1  `1445dfc9`  Railway 93cd7719 SUCCESS 09:56:10Z · Vercel READY 09:56:12Z
 *   run 2  `82ef5b60`  Railway 820afccb SUCCESS 10:08:50Z · Vercel READY 10:08:51Z
 *
 * `git diff` across `f9d3c82f..82ef5b60` touches `client_billing.py`,
 * `ganit.py`, `vikray.py`, `server.py` and three Ganit/Kanban components, and
 * **no file this suite is about** — no `routers/hub*.py`, no
 * `routers/scrapers.py`, no `services/{credits,rag}.py`, no
 * `pages/{hub,sahayak}/**` — so every figure below holds across both. It is
 * stated because a deploy 33 commits stale reads as verification, and so does a
 * deploy that moved under the measurement.
 *
 *   staging.hub_org_credits WHERE org_id = <Unicode>
 *     balance 0 · allowance_balance 0 · purchased_balance 0
 *     period_start 2026-08-01 · credits_reset_at 2026-08-28 13:28 UTC
 *   staging.organisations.monthly_credits = 1000
 *
 * `credits.roll_period` grants the monthly allowance only when
 * `period_start < current_period()`. Unicode's period_start IS the current
 * period, so the 1,000 the plan promises is not granted until **1 September
 * 2026** — and the ledger (`hub_org_credit_transactions` for this org) holds
 * ZERO rows, so nothing was spent: the wallet was emptied by proposal 93's own
 * Stage 2 reseed and nothing has put anything back.
 *
 * There is NO screen an org-scoped account can reach that adds credits. Read
 * out of `routers/hub.py` at the deployed SHA and confirmed on the wire:
 *
 *   POST /v1/hub/org/credits/topup          require_platform_role(SAHAYAK_COMMERCIAL_ROLES)
 *                                           …and NO frontend caller at all
 *   POST /v1/hub/clients/{id}/credits/topup require_platform_role(SAHAYAK_COMMERCIAL_ROLES)
 *                                           …and `hub/CreditsTab.jsx` renders its
 *                                              form to every org user (14.18)
 *   POST /v1/admin/orgs/{id}/credits/topup  the Aekam console — Suite 19, god mode
 *
 * Live probes with the Unicode token, 2026-08-29 09:36 UTC:
 *   POST /api/v1/hub/org/quick-generate     → 402 org_credits_exhausted
 *   POST /api/v1/hub/clients/{id}/kb        → 402 org_credits_exhausted
 *   POST /api/v1/hub/clients/{id}/credits/topup → 403 role list
 *
 * So every §4 line that spends — 24 skill runs, 45 chat messages, 8 KB
 * documents, 12 KB questions, 18 content items, 4 with an inline image, 3
 * scraper runs — is **BLOCKED, not broken**, and the block is one thing:
 * an empty wallet only Aekam can fill. 14.00 fails on it deliberately and by
 * itself, naming every downstream line, because a silent cap reads as full
 * coverage.
 *
 * ── WHY THE CREDIT-BEARING TESTS ARE NOT `test.skip` ────────────────────────
 * Rule 1 of this programme: a missing control is a FAILURE, never a skip.
 * Every credit-bearing test below therefore still DRIVES ITS SCREEN as a user
 * — opens the form, fills the real inputs, presses the real button, watches the
 * wire — and then asserts the outcome against the wallet it MEASURED at 14.00:
 *
 *   balance ≥ cost   the row must appear, read back canonically
 *   balance  = 0     the refusal must be LEGIBLE: it must name credits, say
 *                    what is needed and what is held, and offer a remedy. A
 *                    bare status, a raw role list or an empty toast is a
 *                    FAILURE.
 *
 * That is not a weakened assertion, it is a branch on a measured precondition
 * — and it is what makes this file still correct the morning after Suite 19
 * tops the wallet up: the same tests then prove the rows instead. A test that
 * fails on a correct fix is a defect in the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SECOND BLOCK — NOTHING IS ON THE SKILL SHELF, AND NOBODY HERE CAN PUT IT THERE
 * ═══════════════════════════════════════════════════════════════════════════
 *   staging.hub_org_skills WHERE org_id = <Unicode>  →  0 rows  (Aekam Inc: 78)
 *   staging.hub_org_skill_runs …                     →  0 rows
 *   staging.skill_finding_ack                        →  0 rows IN THE WHOLE DB
 *
 * `POST /v1/hub/org/skills/{template_id}` is `require_platform_role(
 * *OPERATIONS_CONSOLE_ROLES)` — probed live, 403 — and `SkillsTab.jsx` knows
 * it: for a non-platform caller the catalogue card reads *"See details and ask
 * for it"* rather than offering an "Add to organisation" button that would
 * 403. That is the product being honest, and 14.04 asserts it so a future
 * edit cannot quietly reintroduce a control that refuses.
 *
 * The consequence is a chain: no assignment → no run → no finding → no
 * acknowledgement. §4's "skills run 24 · findings acknowledged 12" and
 * "a re-run must return FEWER findings" are unreachable from an org-scoped
 * lane at any wallet balance. 14.06 states the chain and fails on it.
 *
 * ⚠ 93 §14's wave order puts Suite 19 (the admin console, which assigns skills
 * and tops up credits) in **wave 6**, AFTER this suite in wave 5. Both blocks
 * above are that ordering, and they are reported rather than worked around.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OUTBOUND FENCE — AND THE ONE WRITE THIS SUITE REFUSES TO MAKE
 * ═══════════════════════════════════════════════════════════════════════════
 * `GET /api/health` on 2026-08-29 reported `outbound_mode="live"` with
 * `suppressed_orgs_digest="0"` — NOTHING is shielded.
 *
 * Exactly one Hub path this suite could reach sends mail:
 * `POST /v1/hub/skills/{template_id}/request` calls `_announce_skill_request`,
 * which mails every platform-tier account contact. Enumerated from the live
 * database before anything was written (`ACCOUNT_CONTACT_ROLES` =
 * `account_manager`, `platform_admin`, `org_id IS NULL`), 2026-08-29:
 *
 *     admin@aekaminc.com          ✗ outside the brief's allow-list
 *     bhoomi@aekaminc.com         ✗ outside the brief's allow-list
 *     sid@aekaminc.com            ✗ outside the brief's allow-list
 *     kevalvshah03@gmail.com      ✓
 *
 * The brief's constraint is literal: enumerate every recipient, admit only
 * `@simulator.amazonses.com`, `kevalvshah03+…@gmail.com`,
 * `kelisweet+…@gmail.com` and `…@unicodegroup.com`, do not sample, and **if
 * one falls outside, STOP**. Three fall outside. So 14.05 drives the request
 * drawer all the way to the button — the interaction is proved — and then does
 * NOT press it, failing on the fence with the addresses printed. That is a
 * decision for the owner, not for this file, and flipping
 * `E2E_SUITE14_ALLOW_SKILL_REQUEST_MAIL=1` in `.env.e2e` is the one thing that
 * turns it into a write. `staging.hub_skill_requests` therefore also ends this
 * run at 0 for this org, and 14.21 says so.
 *
 * Nothing else here sends: chat sessions, knowledge documents, content,
 * scraper runs and member ceilings write no outbound row at all. `send_email`
 * returns True when the gate suppresses, so a return value would prove nothing
 * either way — this suite simply creates no outbound row.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 1 — EVERY ROW HERE IS TYPED BY A USER
 * ═══════════════════════════════════════════════════════════════════════════
 * Every chat session, knowledge document, content item, scraper run and member
 * ceiling below is made by opening the screen, filling the real inputs and
 * pressing the real button. No SQL. No `page.request.post/put/patch/delete`.
 *
 * `page.request.get` IS used — `apiRows()` / `apiOne()` — and that is the
 * ratchet's own carve-out: asserting the row appeared IS the required
 * evidence. Both send **`X-Org-Id`**, because a read helper that omits it makes
 * the server fall back to the caller's OLDEST membership and answer for a
 * different organisation than the screen beside it.
 *
 * ⚠ ONE ROW IN THIS MODULE IS NOT TYPED AND CANNOT BE. `GET /v1/hub/org-client`
 * is a **GET that writes**: `get_or_create_org_client` inserts the org's
 * internal `hub_clients` row, a `hub_brand_profiles` row and a
 * `hub_credit_wallets` row at 100 the first time anything asks for it. Opening
 * `/hub/org` in a browser is what asks. So the internal client is created by
 * a page load rather than by a form, which is the product's design and not a
 * shortcut taken here — it is recorded because §4 counts rows and somebody
 * reading `hub_clients` later is owed the reason there is one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 2 — STOP AND REPORT. NO VERDICT.
 * ═══════════════════════════════════════════════════════════════════════════
 * 93 §14 reserves the product-bug-versus-test-bug judgement to the owner.
 * Where a control §10 requires does not exist, or exists and cannot work, the
 * test FAILS and prints what it looked for and what the live wire said. The
 * ones written as failures on purpose, with what each one is:
 *
 *   14.00  the wallet is empty and the shelf is bare — the two blocks above
 *   14.05  the skill-request mail fence — three recipients outside the list
 *   14.06  no assigned skill, so no finding and no acknowledgement is reachable
 *   14.12  **"+ New client" is a dead control.** `HubClientsPage.jsx:78` posts
 *          `POST /v1/hub/clients`, which is
 *          `require_platform_role(*SAHAYAK_COMMERCIAL_ROLES)`. The button and
 *          the whole seven-field form are drawn for every org user with module
 *          write. Probed live: 403 `{"detail":"This action requires one of:
 *          platform_owner, platform_admin, platform_manager, account_manager,
 *          account_finance"}` — a raw role list shown to a customer.
 *   14.16  **Approve / Reject on client content are dead controls**, same
 *          shape: `hub/ContentTab.jsx:90` patches
 *          `/v1/hub/clients/{id}/content/{cid}/review`, platform-role gated,
 *          gated on screen only by `useModuleWrite`.
 *   14.17  **An organisation can never set its own brand profile.**
 *          `BrandTab.jsx:41` is the only brand save control in the product and
 *          it puts to `/v1/hub/clients/{id}/brand`, platform-role gated. The
 *          org-scoped `PUT /v1/hub/org/brand` is `require_user`, works — probed
 *          live, 200 — and `grep "org/brand"` across `frontend/src` returns
 *          **0**. It is on the orphan matrix (93-E §3.4) and this is the screen
 *          that proves the customer consequence.
 *   14.18  **"Add credits" is a dead control**, same shape as 14.12.
 *   14.20  **A member ceiling cannot be set before anybody has spent.** The
 *          only control is one button per row of "Who spent what", and that
 *          table is built from the ledger: `GET /v1/billing/me/usage/people`
 *          answers `{"people":[]}` and `/me/balance` answers `{"members":[]}`
 *          on this org. A ceiling is a preventive control and the only door to
 *          it requires the thing it prevents to have already happened. §4's
 *          "spend past a ceiling and be refused" is unreachable in consequence.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT RUN 1 FOUND THAT WAS NOT A ROLE DECISION — AND IS FIXED
 * ═══════════════════════════════════════════════════════════════════════════
 * **EVERY CREDIT REFUSAL IN THIS MODULE THREW AWAY THE SERVER'S SENTENCE.**
 * Found by 14.07, 14.09, 14.14 and 14.15 with the wire beside the paint, and it
 * is why those four are written to read the refusal rather than the row:
 *
 *   wire  {"detail":{"error":"org_credits_exhausted","message":"This needs 1
 *          credits. Your organisation has 0 (0 allowance + 0 purchased).
 *          Allowance resets on 1 September 2026. Contact Aekam to top up.",…}}
 *   paint "This action needs more credits than the wallet holds."
 *
 * `pages/hub/_shared.errText` kept `detail` only when it was a STRING, and
 * `services/credits.CreditError` writes it as a DICT — the third FastAPI shape,
 * the one `lib/apiError.js` exists for. So the figure, the reset date and the
 * remedy never reached anybody. Worse: `credits.py` raises TWO exceptions on
 * purpose because the remedies differ — `InsufficientOrgCredits` sends you to
 * Aekam, `MemberCapExceeded` to your own org admin — and both are 402, so both
 * rendered as the SAME vague line and the distinction never existed on screen.
 * `SahayakTab.detailOf` had the same hole in a different shape and produced a
 * bare **"Not delivered — status 402"**.
 *
 * ✅ FIXED 2026-08-29 in `pages/hub/_shared.jsx` (delegate to `apiErrorText`)
 * and `pages/sahayak/SahayakTab.jsx` (`detailOf` reads `detail.message`).
 * ⚠ THE SAME BUG STANDS IN THREE MORE COPIES OF `errText` —
 * `pages/manav/_shared.jsx:114`, `pages/vetana/_shared.jsx:56` and
 * `pages/prachar/_shared.jsx:268` — which are other agents' modules this wave.
 * Reported, not edited.
 *
 * **`PUT /v1/hub/org/brand` ANSWERED 500 FOR EVERY ORGANISATION.** 14.17 probes
 * the route; the crash was read off the deploy log rather than theorised
 * (deployment 93cd7719, 2026-08-29T09:59:34Z): `NotNullViolationError: null
 * value in column "client_id"`. It inserted `(org_id)` alone into a table whose
 * `client_id` is NOT NULL with no default, on a branch that could never be
 * skipped because nothing has ever written `org_id` on that table.
 * ✅ FIXED in `routers/hub.py`, with `backend/tests/test_hub_org_brand.py`.
 *
 * ⚠ **THE FIXES CANNOT REACH STAGING FROM INSIDE AN AGENT.** Agents do not
 * commit and neither Railway nor Vercel deploys an uncommitted tree, so 14.07,
 * 14.09, 14.14 and 14.15 STAY RED on their refusal wording until this lands.
 * No assertion is weakened to hide that: each one passes the moment the deploy
 * carries the fix, which is what a test that fails on a correct fix is not.
 *
 * The role decisions above are NOT fixed from here. Which seat may create a Hub
 * client, approve a draft, set a brand or top up a wallet is a commercial
 * choice, not a bug with an obvious side.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 — RE-RUNNABLE, AND PROVED BY RUNNING IT TWICE
 * ═══════════════════════════════════════════════════════════════════════════
 * Every record carries a DETERMINISTIC mark built from `TAG` — `S14 KB 03`,
 * `S14 Chat 05` — so `ensure()` reads the live list first and types only what
 * is missing. Chat sessions are the one exception and are counted rather than
 * named, because `ChatTab.createSession` hardcodes the title `'New chat'` and
 * the screen offers no rename: the shortfall to §4's six is what gets typed.
 * `RUN` — a per-run stamp — appears only where a value must differ run to run
 * to prove THIS run's write landed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TRAPS THIS FILE IS WRITTEN AROUND
 * ═══════════════════════════════════════════════════════════════════════════
 * · `getByRole(name)` matches the ACCESSIBLE name, not the visible text. Every
 *   `ModuleTabs` button carries an English label AND a Devanagari `Secondary`,
 *   so a tab's accessible name is "sahayak सहायक" and an exact-string locator
 *   finds nothing and reports a MISSING CONTROL — the wrong diagnosis entirely.
 *   Every tab here is matched by a case-insensitive regex.
 * · `ModuleTabs` pushes tabs past the measured fit behind a "More +N" popover,
 *   and which ones is measured at run time from the strip's client width. Tabs
 *   are opened through `openTab()`, which falls through to that menu.
 * · Lists are date-ordered and a new row is not on page one. Nothing here is
 *   confirmed by looking for it in a table; the write RESPONSE is read, and
 *   then the CANONICAL row is fetched.
 * · List endpoints cap at 200 rows. Nothing here reconciles a total by summing
 *   a list; every count is a delta or comes from a server-reported `total`.
 * · A vacuous assertion passes for ever. EVERY loop below asserts its count
 *   BEFORE it iterates.
 * · One button can make TWO requests: the Sahayak composer tries
 *   `POST /v1/hub/chat/stream` first and falls back to `POST /v1/hub/chat`.
 *   14.03 waits on either and reads whichever answered.
 * · `fill('')` does not register with a controlled React input — clearing is
 *   select-all-then-type.
 * · No user, member or org UUID is ever rendered or asserted. 14.22 reads the
 *   painted text of every screen this suite opens, because
 *   `check-rendered-ids.mjs` is static and positional and cannot see an id the
 *   server pre-formatted into a string.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite14.config.ts
 */
import { test, expect, Page, Locator } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lane, activeLane, signInAs as laneSignIn, assertOrg, ORG as ORG_IDS } from './_lanes';
import { openTab } from './_helpers';

// ⚠ STAGE 4 (§14): `activeLane()` reads E2E_LANE and DEFAULTS TO 'unicode', so an
// unset run is byte-for-byte the Unicode run this suite was authored against.
// `lane('unicode')` frozen here at import time was why the UK replay could not
// be run at all — §14's own first category, a hidden dependency on Unicode.
const LANE = activeLane();
const API = process.env.E2E_API_URL || 'https://kartavaya-staging.up.railway.app';

const BLOCKED =
  'BLOCKED — no credential for the Unicode Group lane. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e. ⚠ It must be an ORG-SCOPED account: a ' +
  'platform_admin token resolves to Aekam Inc via platform_bypass and would write there.';

const TAG = 'S14';
/** A per-run stamp, used only where a value must differ to prove THIS run wrote it. */
const RUN = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

const pad = (n: number) => String(n).padStart(2, '0');

// ── §4 volumes — the Sahayak/Hub rows of the "13–17" table ──────────────────
//
// The chat, eSign, automation and billing rows of that table belong to Suites
// 13, 15, 16 and 17. These nine numbers are this suite's own.
const N_SKILL_RUNS = 24;
const N_FINDINGS_ACK = 12;
const N_CHAT_SESSIONS = 6;
const N_CHAT_MESSAGES = 45;
const N_KB_DOCS = 8;
const N_KB_QUESTIONS = 12;
const N_CONTENT = 18;
const N_CONTENT_IMAGE = 4;
const N_CONTENT_APPROVED = 12;
const N_CONTENT_SCHEDULED = 6;
const N_TOPUPS = 3;
const N_CEILINGS = 4;
const N_SCRAPER_RUNS = 3;

/**
 * What this run actually achieved, printed once at the end.
 *
 * A number that only exists in a passing assertion is a number nobody reads.
 * §4 asks for volumes achieved-vs-asked per entity as LIVE COUNTS, so they are
 * collected as the suite goes and dumped by 14.23.
 *
 * ⚠ ON DISK, NOT IN A MODULE VARIABLE, AND THAT IS NOT TIDINESS. Playwright
 * DISCARDS THE WORKER AFTER A FAILING TEST and starts a fresh process for the
 * next one — deliberate isolation, and it takes module state with it. Measured
 * on run 1 of this suite, 2026-08-29: fifteen tests failed, and 14.23 read TWO
 * entries out of the fourteen that had been recorded, because everything before
 * the last surviving worker was gone. A ledger that quietly loses the failed
 * tests' figures is the silent cap this programme exists to catch, and every
 * figure worth reporting here comes from a test that is EXPECTED to fail.
 *
 * One JSON line per entry, appended; 14.23 reads the file and keeps the LAST
 * line per entity, so a re-measurement wins.
 *
 * ⚠ THE FILENAME IS FIXED, AND `RUN` IS NOT IN IT. `RUN` is computed at module
 * load, and the worker restart above RELOADS THE MODULE — so a run-stamped name
 * produced a NEW ledger per restart and 14.23 read the last fragment. Measured
 * on run 2: FIVE files, holding 1 · 6 · 7 · 7 · 2 entries, and 14.23 reported
 * the 2. The file is truncated once, by 14.00, which `workers: 1` guarantees
 * runs first. Running a single test with `--grep` therefore reads whatever the
 * previous full run left, which is the right trade: stale-but-labelled beats a
 * ledger that silently drops the failed tests, and every figure worth reporting
 * here comes from a test expected to fail.
 */
const LEDGER = path.join(os.tmpdir(), 'kartavya-e2e-suite14', 'volumes.jsonl');
type Volume = { entity: string; asked: number; typed: number; present: number; why: string };

function record(entity: string, asked: number, typed: number, present: number, why = '') {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.appendFileSync(LEDGER, `${JSON.stringify({ entity, asked, typed, present, why })}\n`, 'utf8');
}

function readLedger(): Volume[] {
  if (!fs.existsSync(LEDGER)) return [];
  const seen = new Map<string, Volume>();
  for (const line of fs.readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const v = JSON.parse(line) as Volume; seen.set(v.entity, v); } catch { /* partial write */ }
  }
  return [...seen.values()];
}

/**
 * The eight knowledge documents, and the twelve questions only they can answer.
 *
 * §5 is explicit: *"Real prose with answerable facts, or the KB test is
 * unfalsifiable."* A placeholder ("lorem ipsum", "test document") makes a
 * search that returns nothing indistinguishable from a search that works — and
 * "the KB has never returned a result" is the claim this suite exists to
 * settle, so the corpus has to be capable of settling it.
 *
 * Each document is Unicode Group's own prose carrying a fact that appears
 * NOWHERE ELSE in the database — a policy number, a window in days, a named
 * desk. The question paired with it is answerable only from that document, and
 * the `needle` is the string that must come back. `services/rag.py` scores with
 * `ts_rank(setweight(title,'A') || setweight(content,'B'), q_any, 32)` against
 * `KB_MIN_SCORE = 0.10`, measured on a four-document corpus on 2026-08-19; the
 * assertions below read `similarity` and the returned `doc_title`, never a
 * hardcoded score.
 */
const KB_CORPUS: { title: string; content: string; question: string; needle: RegExp }[] = [
  {
    title: `${TAG} KB 01 — Unicode Group refund window`,
    content:
      'Unicode Group refund policy, revision UG-REF-7. A client may ask for a refund of a ' +
      'retainer instalment within twenty-one working days of the invoice date. Refunds are ' +
      'returned to the originating bank account and never as a credit note. The finance desk ' +
      'that approves a refund is the Ahmedabad accounts desk, and no refund is released ' +
      'without a written approval from that desk. Refunds of a one-off engagement fee are ' +
      'not offered at all once the engagement letter has been countersigned.',
    question: 'How many working days does a client have to ask for a refund of a retainer instalment?',
    needle: /twenty-one working days/i,
  },
  {
    title: `${TAG} KB 02 — Engagement letter checklist`,
    content:
      'Every Unicode Group engagement begins with an engagement letter carrying the scope, the ' +
      'fee basis and the escalation path. The letter is signed by the engagement partner and ' +
      'countersigned by the client. An engagement letter that has not been countersigned within ' +
      'thirty days lapses and must be reissued with a fresh date. The checklist requires four ' +
      'attachments: the scope note, the fee schedule, the data-handling annexure and the ' +
      'conflict declaration.',
    question: 'What happens to a Unicode Group engagement letter that is not countersigned in thirty days?',
    needle: /lapses|reissued/i,
  },
  {
    title: `${TAG} KB 03 — Document retention at Unicode Group`,
    content:
      'Working papers for a statutory audit are retained for eight years from the date the ' +
      'report is signed. Correspondence with a client that is not part of the working papers is ' +
      'retained for three years. Anything carrying a client bank detail is held in the ' +
      'restricted store and is purged on the same eight-year clock. The retention register is ' +
      'reviewed every April by the Ahmedabad accounts desk.',
    question: 'For how many years does Unicode Group retain statutory audit working papers?',
    needle: /eight years/i,
  },
  {
    title: `${TAG} KB 04 — Escalation path for a client complaint`,
    content:
      'A client complaint is acknowledged within one working day by the engagement manager. If ' +
      'it is not resolved within five working days it escalates to the engagement partner, and ' +
      'after ten working days to the managing partner. Every complaint is logged in the ' +
      'complaints register with a UG-CMP reference before it is acknowledged, and the register ' +
      'reference is quoted in every reply.',
    question: 'After how many working days does an unresolved client complaint reach the managing partner?',
    needle: /ten working days/i,
  },
  {
    title: `${TAG} KB 05 — Out-of-scope work and change notes`,
    content:
      'Work outside the engagement letter is never started on a verbal instruction. A change ' +
      'note is raised, priced and countersigned first. A change note carries its own UG-CHG ' +
      'reference and is billed on the next monthly invoice rather than the current one. Change ' +
      'notes below fifteen thousand rupees may be approved by the engagement manager alone.',
    question: 'What reference does a Unicode Group change note carry?',
    needle: /UG-CHG/i,
  },
  {
    title: `${TAG} KB 06 — Travel and disbursements`,
    content:
      'Travel undertaken for a client is recharged at actuals with the ticket attached. Local ' +
      'conveyance inside Ahmedabad is not recharged. Overnight stays are recharged at actuals ' +
      'up to a ceiling of six thousand rupees a night, and anything above that ceiling needs ' +
      'the engagement partner to countersign the claim before it is billed.',
    question: 'What is the nightly ceiling for a recharged overnight stay?',
    needle: /six thousand/i,
  },
  {
    title: `${TAG} KB 07 — Who signs what`,
    content:
      'A statutory audit report is signed by the engagement partner. A tax computation is ' +
      'signed by the tax partner. A management letter is signed by the engagement manager and ' +
      'countersigned by the engagement partner. Nothing leaves Unicode Group over the signature ' +
      'of a person who did not do the work, and the signing register records the pairing for ' +
      'every deliverable.',
    question: 'Who signs a Unicode Group management letter?',
    needle: /engagement manager/i,
  },
  {
    title: `${TAG} KB 08 — Client onboarding data`,
    content:
      'A new Unicode Group client supplies the certificate of incorporation, the last two ' +
      'filed returns, the board resolution appointing the firm and a list of authorised ' +
      'signatories. Onboarding is not marked complete until the conflict check has cleared, ' +
      'which is run by the Ahmedabad accounts desk and takes two working days.',
    question: 'How long does the Unicode Group conflict check take?',
    needle: /two working days/i,
  },
];

/** The four extra questions §4 asks for beyond one per document. */
const KB_EXTRA_QUESTIONS: { question: string; needle: RegExp }[] = [
  { question: 'Which desk approves a refund at Unicode Group?', needle: /Ahmedabad accounts desk/i },
  { question: 'Is local conveyance inside Ahmedabad recharged to a client?', needle: /conveyance/i },
  { question: 'How many attachments does the engagement letter checklist require?', needle: /four attachments/i },
  { question: 'What reference is logged before a complaint is acknowledged?', needle: /UG-CMP/i },
];

/**
 * The questions the ASSISTANT is asked, and the value that proves grounding.
 *
 * §10 asks for *"grounded questions citing real rows"* and the brief adds:
 * *"assert on a value that exists only in Unicode Group's data"*. So none of
 * these is a general-knowledge question — every one names a fact the org's own
 * records carry and nothing else does, and the assertion is on the org's own
 * name or state appearing in the ANSWER, not on the answer being plausible.
 */
const ASSISTANT_QUESTIONS = [
  'Which state is this organisation registered in, and what is its GST state code?',
  'How many CRM companies does this organisation have on file?',
  'List the invoices raised by this organisation that are still unpaid.',
  'How many employees are on the payroll of this organisation?',
  'What is the registered address of this organisation?',
  'Which projects does this organisation currently have open?',
];

/** Recipients of a skill-request mail, enumerated from the live database. */
const SKILL_REQUEST_RECIPIENTS = [
  'admin@aekaminc.com',
  'bhoomi@aekaminc.com',
  'kevalvshah03@gmail.com',
  'sid@aekaminc.com',
];

/**
 * The brief's allow-list for anything this suite could cause to be mailed.
 *
 * The plus tag is OPTIONAL on the two gmail mailboxes. The brief writes them as
 * `kevalvshah03+…@gmail.com` because §3 tags every SEEDED address so a message
 * traces back to the row that caused it — but these four are not seeded rows,
 * they are the platform accounts that already exist, and `kevalvshah03@gmail.com`
 * is the owner's own untagged mailbox. Requiring the tag counted it as an
 * offender on run 1, which overstated the problem by one.
 */
const MAILABLE = [
  /@simulator\.amazonses\.com$/i,
  /^kevalvshah03(\+[^@]*)?@gmail\.com$/i,
  /^kelisweet(\+[^@]*)?@gmail\.com$/i,
  /@unicodegroup\.com$/i,
];

const ALLOW_SKILL_REQUEST_MAIL = process.env.E2E_SUITE14_ALLOW_SKILL_REQUEST_MAIL === '1';

/** The seven panels of `/hub/org`, in `OrgSahayakPage.TABS` order. */
const ORG_TABS = [
  'sahayak', 'skills', 'content', 'generate', 'data catalog', 'data runs', 'credits',
];

/** The nine panels of `/hub/clients/{id}`, in `HubClientDetailPage.TABS` order. */
const CLIENT_TABS = [
  'overview', 'generate', 'content', 'chat', 'knowledge', 'publish', 'brand', 'credits', 'skills',
];

/** §13 — never opened by this file. */
const EXCLUDED_TAB = 'publish';

test.beforeAll(() => {
  if (!LANE.token && !LANE.password) throw new Error(BLOCKED);
  console.log(
    `\n  LANE: ${LANE.org}  (reference lane, §14)` +
    `${LANE.token ? '  · door opened by TOKEN, every row still typed' : '  · real form login'}` +
    `\n  RUN STAMP: ${RUN}` +
    `\n  §13 EXCLUDED, never opened: publish · destinations · social accounts\n`,
  );
});

// ════════════════════════════════════════════════════════════════════════════
// THE DOOR
// ════════════════════════════════════════════════════════════════════════════

async function signIn(page: Page) {
  await laneSignIn(page, LANE);
  await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), LANE.orgId);
  await assertOrg(page.request, page, LANE);
  expect(LANE.orgId, 'the lane must be Unicode Group and never Aekam Inc').toBe(ORG_IDS.UNICODE);
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
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  const body = await res.json();
  return body?.data ?? body;
}

async function apiRows(page: Page, pathAndQuery: string): Promise<any[]> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  const body = await res.json();
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.results)) return body.results;
  return [];
}

/** The whole body, status included — for the routes whose refusal IS the fact. */
async function apiRaw(page: Page, pathAndQuery: string) {
  const res = await apiGet(page, pathAndQuery);
  let body: any = null;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status(), body, text };
}

const orgCredits = (page: Page) => apiOne(page, '/api/v1/hub/org/credits');
const orgSkills = (page: Page) => apiRows(page, '/api/v1/hub/org/skills');
const hubClients = (page: Page) => apiRows(page, '/api/v1/hub/clients');
const skillTemplates = (page: Page) => apiRows(page, '/api/v1/hub/skills/templates');
const scraperCatalog = (page: Page) => apiRows(page, '/api/v1/scrapers/catalog');

/** The org's own internal Hub client — the subject of every agency-side tab. */
async function orgClientId(page: Page): Promise<string> {
  const body = await apiOne(page, '/api/v1/hub/org-client');
  const id = String(body?.client?.id || body?.id || '');
  expect(id, 'GET /v1/hub/org-client returned no client — the whole agency-side ' +
    'half of this suite has no subject').toMatch(/^[0-9a-f-]{36}$/i);
  return id;
}

// ════════════════════════════════════════════════════════════════════════════
// THE WIRE, THE CONSOLE, AND THE REFUSALS
// ════════════════════════════════════════════════════════════════════════════

type Wire = string[];

/**
 * Every write this suite makes, with the status the server answered.
 *
 * Memory's rule, learned from the bank-import bug: watch the requests before
 * blaming the UI. That defect presented as "the button does nothing"; it was a
 * 500 on a `batch_id` that was not a UUID, and only a request listener told the
 * two apart — the browser even reported it as CORS, because FastAPI attaches
 * no CORS headers to an unhandled 500.
 */
function watchWire(page: Page): Wire {
  const wire: Wire = [];
  page.on('response', async (r) => {
    const req = r.request();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return;
    if (!/\/api\//.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 260); } catch { /* consumed */ }
    wire.push(`${req.method()} ${r.status()} ${new URL(r.url()).pathname}  ${body}`);
  });
  return wire;
}

const dumpWire = (w: Wire) =>
  w.length ? w.slice(-25).map((l) => '\n     ' + l).join('') : '\n     (no write request was made at all)';

type Watcher = { errors: { where: string; text: string }[]; at: (where: string) => void };

function watchConsole(page: Page): Watcher {
  const errors: { where: string; text: string }[] = [];
  let where = 'boot';
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    errors.push({ where, text: m.text().slice(0, 240) });
  });
  page.on('pageerror', (e) => {
    errors.push({ where, text: `UNCAUGHT ${String(e?.message ?? e).slice(0, 240)}` });
  });
  return { errors, at: (w: string) => { where = w; } };
}

const dumpConsole = (c: Watcher) =>
  c.errors.map((e) => `\n     [${e.where}] ${e.text}`).join('') || '\n     (none)';

/** An UNCAUGHT exception is a broken screen and is asserted everywhere. */
function assertNoUncaught(c: Watcher) {
  const uncaught = c.errors.filter((e) => e.text.startsWith('UNCAUGHT'));
  expect(uncaught, `uncaught exception(s) on screen:${dumpConsole(c)}`).toHaveLength(0);
}

/** The newest toast's title and message, as one string. '' when there is none. */
async function toastText(page: Page): Promise<string> {
  const toasts = page.locator('.k-toasts .tst');
  const n = await toasts.count();
  if (!n) return '';
  return (await toasts.nth(n - 1).innerText()).replace(/\s+/g, ' ').trim();
}

/** Dismiss whatever is on screen so the next assertion reads its own toast. */
async function clearToasts(page: Page) {
  const closers = page.locator('.k-toasts .tst__a');
  for (let i = await closers.count(); i > 0; i -= 1) {
    await closers.first().click({ timeout: 2_000 }).catch(() => {});
  }
  await page.locator('.k-toasts .tst').first()
    .waitFor({ state: 'detached', timeout: 8_000 }).catch(() => {});
}

/**
 * A refusal a customer can act on.
 *
 * The two sentences this product must never show a tenant are a bare status
 * line and a raw list of role codes — "Method Not Allowed" was shown to a user
 * this week, and `require_platform_role` answers *"This action requires one of:
 * platform_owner, platform_admin, …"*, which names ten things the reader cannot
 * become. Either is a FAILURE here, and the message says which was seen.
 */
/*
 * ⚠ SOFT, AND DELIBERATELY. `expect.soft` still FAILS the test — nothing is
 * weakened — but it does not abort it, so one execution reports every finding
 * instead of the first one. Run 1 stopped 14.14 on the wording of a refusal and
 * never reached the sentence that settles "the KB has never returned a result",
 * which is the whole reason that test exists. A suite whose most valuable
 * output is only produced after its first failure has to keep going.
 */
function assertLegibleRefusal(text: string, where: string, wire: Wire) {
  expect.soft(text.trim(), `${where}: the refusal was SILENT — nothing was said on screen. ` +
    `wire:${dumpWire(wire)}`).not.toBe('');

  expect.soft(text, `${where}: the refusal is a RAW ROLE LIST, which names role codes the ` +
    `reader cannot become and no action they can take. Seen: "${text}"`)
    .not.toMatch(/requires one of:\s*platform_/i);

  expect.soft(text, `${where}: the refusal is a bare HTTP status with no sentence. Seen: "${text}"`)
    .not.toMatch(/^(status\s*)?\d{3}$|^(Method Not Allowed|Forbidden|Bad Request|Not Found)\.?$/i);
}

/** A credit refusal has to name the shortfall AND a remedy. */
function assertCreditRefusal(text: string, where: string, wire: Wire) {
  assertLegibleRefusal(text, where, wire);
  expect.soft(text, `${where}: the wallet is empty, so the refusal must SAY SO — name the ` +
    `credits needed, the credits held and what to do next. Seen: "${text}"`)
    .toMatch(/credit/i);
  expect.soft(text, `${where}: the credit refusal names no remedy. A customer who cannot see ` +
    `what to do next opens a support ticket. The SERVER composed one — ` +
    `"…Allowance resets on 1 September 2026. Contact Aekam to top up." — and the screen ` +
    `replaced it. Seen: "${text}"`)
    .toMatch(/top up|contact aekam|resets on|ask an (org )?admin|raise your limit/i);
}

/**
 * Wait for the write this click makes and hand back status + body.
 *
 * Deliberately NOT `submitting()` from `_helpers`: that helper asserts a 2xx,
 * and on this org every credit-bearing write is a 402 BY MEASUREMENT. The
 * status is the fact under test, not an error to be raised over.
 */
async function pressAndRead(
  page: Page,
  urlPart: string | RegExp,
  act: () => Promise<void>,
  timeout = 120_000,
) {
  const match = (u: string) => (typeof urlPart === 'string' ? u.includes(urlPart) : urlPart.test(u));
  const [res] = await Promise.all([
    page.waitForResponse((r) => match(r.url()) && r.request().method() !== 'GET', { timeout }),
    act(),
  ]);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status(), body, text, url: res.url(), method: res.request().method() };
}

/** Type into a controlled React input — clearing needs select-all, not `fill('')`. */
async function typeInto(field: Locator, value: string) {
  await field.click();
  await field.press('ControlOrMeta+a').catch(() => {});
  await field.fill(value);
}

/**
 * Wait for a `ModuleTabs` strip to exist before asking it anything.
 *
 * ⚠ `openTab()` reads `await inline.count()` ONCE and falls straight through to
 * the More menu when it is zero — so calling it on the line after `page.goto`
 * races the render and reports "the tab is neither inline nor behind a More
 * menu", which is a MISSING CONTROL, which is the wrong diagnosis entirely.
 * Run 1 lost 14.03 to exactly that on a tab that was on screen a second later.
 */
async function tabsReady(page: Page) {
  await expect(page.getByRole('tab').first(), 'no tab strip ever rendered on this screen')
    .toBeVisible({ timeout: 45_000 });
}

/**
 * Is this tab reachable at all — inline, or in the overflow menu?
 *
 * ⚠ `ModuleTabs` renders only as many tabs as MEASURE fit and pushes the rest
 * behind "More +N". The client workspace has NINE, so at least one is always in
 * the tail, and a bare `getByRole('tab', …)` finds nothing for it. Run 1
 * reported the `skills` tab "missing from the client workspace" while it sat in
 * the More menu — the same false diagnosis, one screen over.
 *
 * Reads the menu and CLOSES it again without clicking a row, so this can be
 * asked about §13's `publish` tab without ever opening its panel.
 */
async function tabExists(page: Page, label: RegExp): Promise<boolean> {
  if (await page.getByRole('tab', { name: label }).count()) return true;
  const more = page.getByRole('button', { name: /^More/ });
  if (!(await more.count())) return false;
  await more.first().click();
  const found = await page.getByRole('menuitem', { name: label }).count() > 0;
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem').first(),
    'the More popover did not close on Escape — every modal and popover in this product ' +
    'must, and a trapped one blocks every later click on this screen')
    .toBeHidden({ timeout: 5_000 });
  return found;
}

// ════════════════════════════════════════════════════════════════════════════
// THE WALLET, MEASURED ONCE AND BRANCHED ON EVERYWHERE
// ════════════════════════════════════════════════════════════════════════════

type Wallet = { total: number; allowance: number; purchased: number; plan: number; prices: Record<string, number> };

let WALLET: Wallet | null = null;

async function wallet(page: Page): Promise<Wallet> {
  const body = await orgCredits(page);
  const b = body?.org_balance || {};
  const w: Wallet = {
    total: Number(b.balance ?? 0),
    allowance: Number(b.allowance ?? 0),
    purchased: Number(b.purchased ?? 0),
    plan: Number(b.plan_credits ?? 0),
    prices: body?.credit_costs || {},
  };
  WALLET = w;
  return w;
}

/** Can the org afford `kind`? Reads the SERVER's price table, never a constant. */
function affords(w: Wallet, kind: string, fallback: number) {
  const cost = Number(w.prices?.[kind] ?? fallback);
  return w.total >= cost;
}

// ════════════════════════════════════════════════════════════════════════════
// 14.00 — THE PRECONDITIONS, AND THE TWO THAT DO NOT HOLD
// ════════════════════════════════════════════════════════════════════════════

test('14.00 preconditions — the lane, the wallet, and the skill shelf', async ({ page }) => {
  // The volume ledger starts empty, once per run. `workers: 1` and the numeric
  // ordering of these test names make this the first test in the file, and it
  // is the only place the file is truncated.
  fs.rmSync(LEDGER, { force: true });
  console.log(`  LEDGER: ${LEDGER}`);

  const con = watchConsole(page);
  await signIn(page);

  // ── The credential must be ORG-SCOPED, or half this suite measures nothing ──
  const roles = await apiOne(page, '/api/v1/subscription/my-roles');
  expect(roles?.platform_roles ?? [], 'the Unicode lane credential now holds PLATFORM ' +
    'roles. Every "an org-scoped customer cannot reach this" finding below would ' +
    'silently evaporate under it, and a write could resolve to Aekam Inc via ' +
    'platform_bypass. Use an org-scoped account.').toHaveLength(0);
  expect(roles?.is_platform_admin, 'the lane credential is a platform admin').toBeFalsy();
  const orgRoles = (roles?.org_roles || []).filter((r: any) => r.org_id === LANE.orgId);
  expect(orgRoles.length, 'the lane credential holds no role in Unicode Group').toBeGreaterThan(0);
  console.log(`  ROLE: ${orgRoles.map((r: any) => r.role).join(', ')} on ${LANE.org}`);

  // ── The outbound fence, recorded rather than assumed ────────────────────────
  const health = await (await page.request.get(`${API}/api/health`)).json();
  console.log(`  OUTBOUND: mode=${health.outbound_mode} suppressed_orgs_digest=${health.suppressed_orgs_digest}`);

  // ── The wallet ─────────────────────────────────────────────────────────────
  const w = await wallet(page);
  console.log(
    `  WALLET: balance ${w.total} (allowance ${w.allowance} + purchased ${w.purchased}), ` +
    `plan gives ${w.plan}/month`,
  );
  console.log(`  PRICES: ${Object.entries(w.prices).map(([k, v]) => `${k}=${v}`).join(' ')}`);

  const shelf = await orgSkills(page);
  const catalogue = await skillTemplates(page);
  console.log(`  SKILLS: ${shelf.length} on the shelf, ${catalogue.length} in the catalogue`);

  // ── The two blocks, each failing on its own so the report can tell them apart ─
  expect(w.total,
    `\n  ⚠ THE ORG WALLET IS EMPTY, AND NO SCREEN THIS ACCOUNT CAN REACH ADDS TO IT.\n` +
    `     balance ${w.total} = allowance ${w.allowance} + purchased ${w.purchased};\n` +
    `     the plan promises ${w.plan} a month but credits.roll_period grants it only when\n` +
    `     period_start < the current period, and this org's period_start IS the current\n` +
    `     period — so the next grant is 1 September 2026.\n` +
    `     POST /v1/hub/org/credits/topup and POST /v1/hub/clients/{id}/credits/topup are\n` +
    `     both require_platform_role(SAHAYAK_COMMERCIAL_ROLES). The only door is the Aekam\n` +
    `     console, i.e. SUITE 19 — which §14 schedules in WAVE 6, after this suite.\n` +
    `     BLOCKED BY THIS, in §4 lines: skill runs ${N_SKILL_RUNS} · findings acknowledged\n` +
    `     ${N_FINDINGS_ACK} · chat messages ${N_CHAT_MESSAGES} · KB documents ${N_KB_DOCS} ·\n` +
    `     KB questions ${N_KB_QUESTIONS} · content ${N_CONTENT} (${N_CONTENT_IMAGE} with an\n` +
    `     inline image, ${N_CONTENT_APPROVED} approved, ${N_CONTENT_SCHEDULED} scheduled) ·\n` +
    `     scraper runs ${N_SCRAPER_RUNS}.\n` +
    `     Every one of those screens is still DRIVEN below; what cannot be proved is the row.\n`)
    .toBeGreaterThan(0);

  expect(shelf.length,
    `\n  ⚠ NOTHING IS ON THIS ORGANISATION'S SKILL SHELF, AND A CUSTOMER CANNOT PUT IT THERE.\n` +
    `     staging.hub_org_skills for this org: 0 rows. The catalogue offers ${catalogue.length}\n` +
    `     templates, and POST /v1/hub/org/skills/{template_id} is\n` +
    `     require_platform_role(*OPERATIONS_CONSOLE_ROLES) — probed live, 403.\n` +
    `     The chain that follows: no assignment → no run → no finding → no acknowledgement.\n` +
    `     BLOCKED BY THIS: §4's "skills run ${N_SKILL_RUNS} · findings acknowledged\n` +
    `     ${N_FINDINGS_ACK}", and "a re-run must return FEWER findings".\n` +
    `     14.04 asserts the product is HONEST about it (it offers a request, not a\n` +
    `     button that 403s) and 14.05 drives that request to its button.\n`)
    .toBeGreaterThan(0);

  assertNoUncaught(con);
});

// ════════════════════════════════════════════════════════════════════════════
// THE ORG'S OWN WORKSPACE — /hub/org
// ════════════════════════════════════════════════════════════════════════════

test('14.01 Sahayak opens, and its four figures are the wallet the server refuses against', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  con.at('/hub/org');
  await page.goto('/hub/org');

  await expect(page.getByRole('tab', { name: /sahayak/i }).first(),
    'the Sahayak tab strip never rendered').toBeVisible({ timeout: 45_000 });

  // Four tiles, and they must be tiles rather than a shimmer or an error note.
  const tiles = page.locator('.mk .mk__c');
  await expect.poll(async () => tiles.count(), {
    message: 'the KPI strip never resolved into figures — a strip that shimmers for ever ' +
      'is indistinguishable from one that failed',
    timeout: 30_000,
  }).toBe(4);

  const w = await wallet(page);

  // ⚠ THE FIGURE IS THE SERVER'S, NOT A SECOND COMPUTATION OF IT. This strip
  // once read 744 while the wallet held 324, because the page recomputed the
  // balance from the month's usage instead of reading `org_balance.balance` —
  // the number `deduct_org_credits` holds FOR UPDATE and actually refuses
  // against. Asserting the painted figure against the API is what makes a
  // third disagreement impossible rather than merely unlikely.
  const balanceTile = tiles.filter({ hasText: /Org balance/i }).first();
  await expect(balanceTile, 'no "Org balance" tile on the Sahayak strip').toBeVisible();
  await expect(balanceTile.locator('.mk__v'),
    `the painted org balance disagrees with GET /v1/hub/org/credits (${w.total})`)
    .toHaveText(String(w.total));

  const planTile = tiles.filter({ hasText: /Org balance/i }).locator('.mk__s').first();
  if (w.plan > 0) {
    await expect(planTile, 'the balance tile does not say what the plan gives, so a zero ' +
      'balance is indistinguishable from a plan of zero').toContainText(String(w.plan));
  }

  // Seven tabs, every one of them present.
  for (const t of ORG_TABS) {
    await expect(page.getByRole('tab', { name: new RegExp(t.replace(/ /g, '\\s+'), 'i') }).first(),
      `the "${t}" tab is missing from /hub/org — §10 asks for all seven`)
      .toBeVisible();
  }

  assertNoUncaught(con);
});

test('14.02 every one of the seven Sahayak panels renders a state IN WORDS', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  await page.goto('/hub/org');
  await expect(page.getByRole('tab', { name: /sahayak/i }).first()).toBeVisible({ timeout: 45_000 });

  const panel = page.locator('[role="tabpanel"]');

  for (const t of ORG_TABS) {
    con.at(`/hub/org?tab=${t}`);
    await openTab(page, new RegExp(t.replace(/ /g, '\\s+'), 'i'));
    await expect(panel.first(), `the "${t}" panel never rendered`).toBeVisible({ timeout: 30_000 });

    // A panel that says nothing is the day-one screen nobody has looked at.
    // "Loading…" is not a state; it is the absence of one.
    await expect.poll(async () => {
      const text = (await panel.first().innerText()).replace(/\s+/g, ' ').trim();
      return text.length >= 20 && !/^(Loading|Searching)…?$/i.test(text);
    }, {
      message: `the "${t}" panel never resolved into words — a spinner that never ends and ` +
        'a blank screen read the same to a customer on their first morning',
      timeout: 40_000,
    }).toBe(true);

    const text = (await panel.first().innerText()).replace(/\s+/g, ' ').trim();
    console.log(`  ${t.padEnd(14)} ${text.slice(0, 140)}`);

    // No panel may open on a raw failure the reader cannot act on.
    expect(text, `the "${t}" panel opened on a raw role list`)
      .not.toMatch(/requires one of:\s*platform_/i);
  }

  assertNoUncaught(con);
});

test('14.03 the assistant — a grounded question, and what happens when the wallet is empty', async ({ page }) => {
  const con = watchConsole(page);
  const wire = watchWire(page);
  await signIn(page);
  const w = await wallet(page);

  // The value grounding must reach: this org's own state code, read from its
  // own profile rather than typed as a constant.
  const profile = await apiOne(page, '/api/v1/org/profile');
  const orgState = String(profile?.state_code || '');
  expect(orgState, 'the org has no state code, so there is no value that exists only in ' +
    'its data to ground an answer against').toBeTruthy();

  con.at('/hub/org?tab=sahayak');
  await page.goto('/hub/org');
  await tabsReady(page);
  await openTab(page, /sahayak/i);

  const box = page.locator('#sh-ask');
  await expect(box, 'the Sahayak composer is missing — §10\'s "grounded questions" screen ' +
    'has no way to ask one').toBeVisible({ timeout: 45_000 });

  const ask = page.getByRole('button', { name: /^Ask$/ });
  await expect(ask, 'the Ask button is missing from the composer').toBeVisible();

  let answered = 0;
  let refused = 0;
  const asked = affords(w, 'chatbot_message', 2) ? ASSISTANT_QUESTIONS.length : 1;

  for (let i = 0; i < asked; i += 1) {
    const q = ASSISTANT_QUESTIONS[i];
    await typeInto(box, q);
    await expect(ask, 'Ask stayed disabled with a question in the box').toBeEnabled();

    // ⚠ ONE BUTTON, TWO POSSIBLE REQUESTS. The composer tries
    // `POST /v1/hub/chat/stream` and falls back to `POST /v1/hub/chat` when the
    // stream cannot start. Waiting on only one of them times out on a screen
    // that worked.
    const r = await pressAndRead(page, /\/v1\/hub\/chat(\/stream)?$/, () => ask.click());
    console.log(`  ask ${i + 1}: ${r.method} ${r.status} ${new URL(r.url).pathname}`);

    if (r.status >= 200 && r.status < 300) {
      answered += 1;
      // GROUNDED, not merely plausible. The answer has to carry a value that
      // exists only in this organisation's rows.
      const thread = page.locator('.sh__a').last();
      await expect(thread, 'the answer bubble never appeared').toBeVisible({ timeout: 90_000 });
      const answer = (await thread.innerText()).replace(/\s+/g, ' ');
      expect(answer, `the answer to "${q}" cites nothing from this organisation's own ` +
        `records — it names neither the org nor its state code ${orgState}. An answer ` +
        `that is plausible and ungrounded is the failure mode. Got: "${answer.slice(0, 300)}"`)
        .toMatch(new RegExp(`${orgState}|Unicode`, 'i'));
    } else {
      refused += 1;
      const fail = page.locator('.sh__fail').last();
      await expect(fail, `the assistant answered ${r.status} and said NOTHING on screen — ` +
        `the question bubble is left looking delivered. wire:${dumpWire(wire)}`)
        .toBeVisible({ timeout: 20_000 });
      const text = (await fail.innerText()).replace(/\s+/g, ' ').trim();
      console.log(`     refusal: ${text.slice(0, 200)}`);

      if (r.status === 402) assertCreditRefusal(text, 'the assistant', wire);
      else assertLegibleRefusal(text, `the assistant (${r.status})`, wire);

      // A question nothing on the server ever took must be re-askable.
      await expect(page.getByRole('button', { name: /Send it again/i }).last(),
        'a question that was never delivered offers no way to send it again').toBeVisible();
      break;
    }
  }

  record('sahayak chat messages', N_CHAT_MESSAGES, answered, answered,
    answered ? '' : 'blocked — 402 org_credits_exhausted, an answer is 2 credits');

  // The measurement is the finding. Grounding cannot be proved on an empty
  // wallet, and saying so is not the same as saying it is broken.
  expect(refused,
    `\n  §10 asks for GROUNDED QUESTIONS CITING REAL ROWS and the answer was refused ${refused}\n` +
    `  time(s) before one could be read. An answer costs ${w.prices?.chatbot_message ?? 2} credits and\n` +
    `  this organisation holds ${w.total}. The composer, the send, the failure state and the\n` +
    `  re-ask control are all proved above; GROUNDING IS NOT, and cannot be from this lane.\n`)
    .toBe(0);

  assertNoUncaught(con);
});

test('14.04 the skill shelf is bare, and the catalogue is HONEST about who can fill it', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  con.at('/hub/org?tab=skills');
  await page.goto('/hub/org?tab=skills');

  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel).toBeVisible({ timeout: 45_000 });

  const shelf = await orgSkills(page);
  const catalogue = await skillTemplates(page);
  expect(catalogue.length, 'the skill catalogue is empty, so there is nothing to ask for ' +
    'and nothing this screen can be about').toBeGreaterThan(0);

  // Active pane — the empty state has to be a sentence, not an empty grid.
  const active = page.getByRole('button', { name: /^Active/ });
  await expect(active, 'the Active/Catalog switch is missing from the Skills tab').toBeVisible();
  await active.click();
  if (shelf.length === 0) {
    await expect(panel, 'an empty shelf renders no explanation — the day-one state of this ' +
      'screen for every new customer').toContainText(/No skills added yet/i);
  }

  // Catalog pane.
  const catalogBtn = page.getByRole('button', { name: /^Catalog/ });
  await expect(catalogBtn, 'the Catalog pane cannot be opened').toBeVisible();
  await catalogBtn.click();

  const cards = panel.locator('.sk-card');
  await expect.poll(async () => cards.count(), {
    message: 'the catalogue rendered no cards although the server returned ' +
      `${catalogue.length} templates`,
    timeout: 30_000,
  }).toBeGreaterThan(0);
  console.log(`  catalogue cards on screen: ${await cards.count()} of ${catalogue.length} templates`);

  // ⚠ THE CONTROL THAT MUST *NOT* BE THERE.
  //
  // `POST /v1/hub/org/skills/{template_id}` is
  // require_platform_role(*OPERATIONS_CONSOLE_ROLES) — 403 for this account,
  // probed live. A button reading "Add to organisation" would be a control
  // that refuses, which this file elsewhere reports as a defect three times
  // over. Here the product gets it right and offers a REQUEST instead, and
  // that is asserted so nobody can quietly put the refusing button back.
  await expect(panel.getByRole('button', { name: /Add to organisation/i }),
    'the catalogue offers an "Add to organisation" button to an account that CANNOT add ' +
    'one — POST /v1/hub/org/skills/{id} is require_platform_role(OPERATIONS_CONSOLE_ROLES) ' +
    'and answers 403. A control that refuses is worse than an absent one.')
    .toHaveCount(0);

  await expect(panel.getByRole('button', { name: /See details and ask for it|Why this cannot run|Requested/i }).first(),
    'the catalogue offers neither a way to add a skill nor a way to ask for one — which is ' +
    'the dead end "Ask your account contact" used to be')
    .toBeVisible();

  record('skills on the org shelf', 0, 0, shelf.length,
    shelf.length ? '' : 'assignment is platform-only (OPERATIONS_CONSOLE_ROLES) — Suite 19');
  record('skill runs', N_SKILL_RUNS, 0, 0, 'blocked — nothing is assigned to run');

  assertNoUncaught(con);
});

test('14.05 a skill is asked for through the drawer — and the mail fence stops the press', async ({ page }) => {
  const con = watchConsole(page);
  const wire = watchWire(page);
  await signIn(page);
  await page.goto('/hub/org?tab=skills');

  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: /^Catalog/ }).click();

  const open = panel.getByRole('button', { name: /See details and ask for it|Requested — see details/i }).first();
  await expect(open, 'no catalogue card offers its detail drawer, so a skill cannot be asked for')
    .toBeVisible({ timeout: 30_000 });
  await open.click();

  const drawer = page.getByRole('dialog').first();
  await expect(drawer, 'the skill drawer did not open').toBeVisible({ timeout: 15_000 });

  // The drawer's whole job: say what a run reads, what it changes and what it
  // costs, before anybody asks for it.
  const drawerText = (await drawer.innerText()).replace(/\s+/g, ' ');
  expect(drawerText, 'the skill drawer says nothing about what the skill reads or changes — ' +
    'which is the question a requester actually has').toMatch(/reads|changes|cost|credit/i);

  const note = drawer.getByRole('textbox', { name: /What should this skill do for you/i });
  const requestBtn = drawer.getByRole('button', { name: /Request this skill/i });

  const already = await drawer.getByText(/Requested/i).count();

  if (already > 0) {
    // §6 — the second run recognises its own output and types nothing.
    console.log('  IDEMPOTENT: a request for this skill is already open; nothing typed.');
    record('skill requests', 1, 0, 1, 'already present — the drawer says "Requested"');
  } else {
    await expect(note, 'the request drawer has no note box — the note is the whole point of ' +
      'the interaction, and without it a request carries no context').toBeVisible();
    await typeInto(note,
      `${TAG} ${RUN} — Unicode Group would use this against its own ledger monthly, ` +
      'before the GST return goes out.');
    await expect(requestBtn, 'the "Request this skill" button is missing or disabled, so the ' +
      'catalogue still dead-ends the way it used to').toBeEnabled();

    // ── ⚠ THE FENCE ────────────────────────────────────────────────────────
    // `_announce_skill_request` mails every platform-tier account contact.
    // Enumerated from the live database before a line of this file was written;
    // three of the four are outside the brief's allow-list, and the brief's
    // instruction on that is literal: STOP.
    const outside = SKILL_REQUEST_RECIPIENTS.filter(
      (a) => !MAILABLE.some((re) => re.test(a)),
    );

    if (!ALLOW_SKILL_REQUEST_MAIL) {
      record('skill requests', 1, 0, 0,
        `not sent — ${outside.length} recipient(s) outside the allow-list`);
      expect(outside,
        `\n  ⚠ NOT PRESSED. POST /v1/hub/skills/{id}/request mails every platform-tier account\n` +
        `     contact through _announce_skill_request. Enumerated from staging.user_roles\n` +
        `     (org_id IS NULL, role_code IN account_manager|platform_admin) on 2026-08-29:\n` +
        SKILL_REQUEST_RECIPIENTS.map((a) => `\n       ${MAILABLE.some((re) => re.test(a)) ? '✓' : '✗'} ${a}`).join('') +
        `\n     ${outside.length} fall outside the brief's allow-list, and staging runs\n` +
        `     outbound_mode=live with suppressed_orgs_digest="0" — nothing is shielded.\n` +
        `     The brief: "Do not sample. If one falls outside, STOP." So the drawer was\n` +
        `     opened, the note typed and the button proved ENABLED, and the button was NOT\n` +
        `     pressed. staging.hub_skill_requests therefore ends this run at 0 for this org.\n` +
        `     To let it write, the owner clears these addresses and sets\n` +
        `     E2E_SUITE14_ALLOW_SKILL_REQUEST_MAIL=1 in .env.e2e.\n`)
        .toHaveLength(0);
    } else {
      const r = await pressAndRead(page, /\/v1\/hub\/skills\/[^/]+\/request$/, () => requestBtn.click());
      console.log(`  request: ${r.method} ${r.status}`);
      // 201 on a genuine insert, 200 on a repeat — the partial unique index
      // `idx_hub_skill_requests_one_open` makes the second press idempotent.
      expect([200, 201], `POST …/request → ${r.status}: ${r.text.slice(0, 300)}`)
        .toContain(r.status);
      const requestId = String(r.body?.request_id || r.body?.id || '');
      expect(requestId, 'the request write returned no id, so nothing can be read back')
        .toBeTruthy();

      // THEN THE CANONICAL ROW. A POST echoes a few fields; the list is where
      // the org's own open requests actually live.
      const mine = await apiOne(page, '/api/v1/hub/org/skills');
      const openReqs = mine?.skill_requests || [];
      expect(openReqs.map((x: any) => String(x.id ?? x.request_id)),
        'the request is not in GET /v1/hub/org/skills → skill_requests, so the drawer ' +
        'reported a request the org cannot see').toContain(requestId);
      record('skill requests', 1, r.status === 201 ? 1 : 0, openReqs.length,
        r.status === 200 ? 'already present — 200, same request_id' : '');
    }
  }

  assertNoUncaught(con);
});

test('14.06 a finding cannot be acknowledged, and the chain that says why', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  await page.goto('/hub/org?tab=skills');
  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel).toBeVisible({ timeout: 45_000 });

  const shelf = await orgSkills(page);

  if (shelf.length > 0) {
    // The wallet may be empty and the shelf full — 59 of the 78 templates are
    // `skill_function`-only and cost NOTHING, so a check skill runs on a zero
    // balance. If anything is assigned, the §4 line is live and is driven.
    await page.getByRole('button', { name: /^Active/ }).click();
    const runBtn = panel.getByRole('button', { name: /^Run$/ }).first();
    await expect(runBtn, 'a skill is on the shelf but no card offers a Run control')
      .toBeVisible({ timeout: 20_000 });
    await runBtn.click();
    const runNow = panel.getByRole('button', { name: /^Run now$/ }).first();
    await expect(runNow, 'the run form opened with no "Run now" button').toBeVisible();
    const r = await pressAndRead(page, /\/v1\/hub\/org\/skills\/[^/]+\/run$/, () => runNow.click(), 180_000);
    console.log(`  run: ${r.status}`);
    expect(r.status, `the skill run answered ${r.status}: ${r.text.slice(0, 300)}`).toBeLessThan(300);

    const ack = panel.getByRole('button', { name: /dismiss|acknowledge/i }).first();
    await expect(ack, 'the run reported findings with no way to acknowledge one — which is ' +
      'how an alert catalogue turns into wallpaper').toBeVisible({ timeout: 30_000 });
  }

  const acks = await apiRaw(page, '/api/v1/hub/org/skills');
  console.log(`  shelf: ${shelf.length} · GET /v1/hub/org/skills → ${acks.status}`);

  record('findings acknowledged', N_FINDINGS_ACK, 0, 0,
    shelf.length ? '' : 'blocked — no assigned skill, so no run and no finding');

  expect(shelf.length,
    `\n  §10 asks: "skills run, acknowledge a finding, re-run and see the count drop".\n` +
    `  THE CHAIN BREAKS AT THE FIRST LINK, and every step of it is measured:\n` +
    `    staging.hub_org_skills for this org      0 rows\n` +
    `    the catalogue                            available, and offered\n` +
    `    POST /v1/hub/org/skills/{template_id}    403, require_platform_role(\n` +
    `                                             OPERATIONS_CONSOLE_ROLES)\n` +
    `    staging.skill_finding_ack                0 rows in the whole database\n` +
    `  So no run exists to produce a finding, no finding exists to acknowledge, and no\n` +
    `  re-run can show a count dropping. The ACK MECHANISM ITSELF IS COMPLETE — the\n` +
    `  endpoint, the identity/material split in services/skill_ack.py, and the control in\n` +
    `  components/skills/findings — and none of it can be reached from an org-scoped seat\n` +
    `  until Aekam assigns a skill. That is SUITE 19, wave 6.\n`)
    .toBeGreaterThan(0);

  assertNoUncaught(con);
});

test('14.07 content generation, inline image included — the form, the press, and the outcome', async ({ page }) => {
  const con = watchConsole(page);
  const wire = watchWire(page);
  await signIn(page);
  const w = await wallet(page);

  con.at('/hub/org?tab=generate');
  await page.goto('/hub/org?tab=generate');
  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel).toBeVisible({ timeout: 45_000 });

  const before = await apiOne(page, '/api/v1/hub/org/content?limit=1');
  const countBefore = Number(before?.total ?? 0);

  // The seven presets, then the form. Nothing is typed until a preset is
  // chosen — the form does not exist before that, so a spec that went straight
  // for a textbox would report a missing control on a working screen.
  const presets = panel.locator('.sr-pick');
  await expect.poll(async () => presets.count(), {
    message: 'the Generate tab offers no content presets at all',
    timeout: 30_000,
  }).toBeGreaterThan(0);
  console.log(`  presets: ${(await presets.allInnerTexts()).map((t) => t.split('\n')[0]).join(' · ')}`);

  const socialPost = presets.filter({ hasText: /Social post/i }).first();
  await expect(socialPost, 'the "Social post" preset — the only one §4\'s inline-image line ' +
    'can be proved on — is missing').toBeVisible();
  await socialPost.click();

  const topic = panel.locator('form.hb-form textarea').first();
  await expect(topic, 'choosing a preset opened no brief box').toBeVisible({ timeout: 20_000 });
  await typeInto(topic, `${TAG} ${RUN} — a LinkedIn post announcing Unicode Group's ` +
    'monthly GST filing clinic for small manufacturers in Ahmedabad.');

  // ⚠ THE INLINE IMAGE. `POST /v1/hub/org/quick-generate` used to make the
  // picture for free — the image was charged on the two OTHER generation routes
  // and not on the one the Generate tab actually uses — and the inline path has
  // its own history of raising NameError. The checkbox is exercised whether or
  // not the wallet can pay for what it asks for.
  const imageToggle = panel.locator('.sk-check input[type="checkbox"]').first();
  expect(await imageToggle.count(), '§4 asks for 4 generated items WITH AN INLINE IMAGE and ' +
    'the "Social post" preset offers no way to ask for one').toBeGreaterThan(0);
  await imageToggle.check();
  await expect(imageToggle, 'the inline-image checkbox does not stay checked').toBeChecked();

  // The foot must quote what the run spends BEFORE it is pressed — text and
  // image are two charges on one press, and the strip once quoted one of them.
  const foot = panel.locator('.hb-form__foot').first();
  await expect(foot, 'the generate form quotes no cost, so a person is asked to spend ' +
    'without being told what').toContainText(/spends|Balance/i);
  console.log(`  cost line: ${(await foot.innerText()).replace(/\s+/g, ' ')}`);

  const go = panel.getByRole('button', { name: /^Generate /i }).first();
  await expect(go, 'the Generate tab has no button that generates anything').toBeEnabled();

  const r = await pressAndRead(page, /\/v1\/hub\/org\/(quick-)?generate$/, () => go.click(), 180_000);
  console.log(`  generate: ${r.method} ${r.status} ${new URL(r.url).pathname}`);

  let typed = 0;
  if (r.status >= 200 && r.status < 300) {
    typed = 1;
    // Read the WRITE RESPONSE, then the CANONICAL row.
    const after = await apiOne(page, '/api/v1/hub/org/content?limit=1');
    expect(Number(after?.total ?? 0),
      'the generate call answered 2xx and the content library did not grow — a POST that ' +
      'reports success and stores nothing is the worst of the three outcomes')
      .toBe(countBefore + 1);
    const rows = await apiRows(page, '/api/v1/hub/org/content?limit=5&sort=created_at&order=desc');
    expect(rows.length, 'the content list came back empty right after a successful write')
      .toBeGreaterThan(0);
    const item = rows[0];
    expect(String(item.body || ''), 'the generated item has an empty body').not.toBe('');
    console.log(`  stored: status=${item.status} credits_used=${item.credits_used} image=${item.image_url ? 'yes' : 'no'}`);
  } else {
    // GenerateTab renders its failure as a note on the page — "Generation
    // failed. {error}" — rather than as a toast, so that is what is read.
    const note = panel.locator('.hb-err').last();
    await expect(note, `the generate call answered ${r.status} and the screen said NOTHING. ` +
      `wire:${dumpWire(wire)}`).toBeVisible({ timeout: 20_000 });
    const text = (await note.innerText()).replace(/\s+/g, ' ').trim();
    console.log(`  refusal: ${text.slice(0, 220)}`);
    if (r.status === 402) assertCreditRefusal(text, 'org content generation', wire);
    else assertLegibleRefusal(text, `org content generation (${r.status})`, wire);

    // The library must not have grown on a refusal.
    const after = await apiOne(page, '/api/v1/hub/org/content?limit=1');
    expect(Number(after?.total ?? 0),
      'the generate call was REFUSED and the content library grew anyway — a refused write ' +
      'must leave nothing behind').toBe(countBefore);
  }

  const total = Number((await apiOne(page, '/api/v1/hub/org/content?limit=1'))?.total ?? 0);
  record('content generated', N_CONTENT, typed, total,
    typed ? '' : `blocked — 402, a ${w.prices?.content ?? 2}-credit charge against a balance of ${w.total}`);
  record('content with an inline image', N_CONTENT_IMAGE, 0, 0,
    typed ? 'not separately proved' : 'blocked — the image is a second 3-credit charge');

  expect(r.status, `\n  §4 asks for ${N_CONTENT} generated items, ${N_CONTENT_IMAGE} of them with an inline\n` +
    `  image. The brief, the topic box, the image toggle and the Generate button are all\n` +
    `  proved above; the write answered ${r.status}. On an empty wallet that is the only\n` +
    `  outcome available, and it is BLOCKED rather than broken.\n`)
    .toBeLessThan(300);

  assertNoUncaught(con);
});

test('14.08 the content library — filters, grouping and a pager that agree with the server', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  con.at('/hub/org?tab=content');
  await page.goto('/hub/org?tab=content');
  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel).toBeVisible({ timeout: 45_000 });

  const facets = await apiOne(page, '/api/v1/hub/org/content/facets');
  const total = Number(facets?.total ?? 0);
  console.log(`  content library: ${total} items`);

  // ⚠ THE CHIP COUNTS ARE FACETS, NOT PAGE ARITHMETIC. They used to be
  // `items.filter(...).length`, which once the list pages is the size of the
  // CURRENT PAGE — every chip showing the same number on every page.
  const allChip = panel.getByRole('button', { name: /^All/ }).first();
  await expect(allChip, 'the agent-type filter row is missing from the content library')
    .toBeVisible();
  if (total > 0) {
    await expect(allChip, 'the "All" chip does not carry the library-wide total, so it is ' +
      'counting the page rather than the library').toContainText(String(total));
  }

  // The status filter and the group-by are both §10 controls on this screen.
  const selects = panel.locator('select');
  await expect.poll(async () => selects.count(), {
    message: 'the content library offers neither a status filter nor a group-by',
    timeout: 20_000,
  }).toBeGreaterThanOrEqual(2);

  await selects.nth(0).selectOption('approved').catch(() => {});
  await selects.nth(0).selectOption('').catch(() => {});

  if (total === 0) {
    await expect(panel, 'an empty content library says nothing — the day-one state')
      .toContainText(/Nothing generated yet/i);
  }

  record('content approved', N_CONTENT_APPROVED, 0,
    Number(facets?.facets?.status?.approved ?? 0),
    'blocked — nothing is generated to approve, and the only review control is platform-gated (14.16)');
  record('content scheduled', N_CONTENT_SCHEDULED, 0, 0,
    'blocked — scheduling is on the Publish tab, EXCLUDED BY DECISION §13');

  assertNoUncaught(con);
});

test('14.09 the data catalogue — a scraper run, its cost, and what it cost this run', async ({ page }) => {
  const con = watchConsole(page);
  const wire = watchWire(page);
  await signIn(page);
  const w = await wallet(page);

  con.at('/hub/org?tab=data catalog');
  await page.goto('/hub/org?tab=data%20catalog');
  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel).toBeVisible({ timeout: 45_000 });

  const catalog = await scraperCatalog(page);
  expect(catalog.length, 'the scraper catalogue is empty, so §10\'s "scraper run with cost ' +
    'and margin" has nothing to run').toBeGreaterThan(0);

  // ⚠ THE CHEAPEST ACTOR THAT PROVES THE PATH. Scrapers are sold below cost and
  // actors reprice silently, so the tool is chosen by the SERVER's own
  // `credit_cost` at run time rather than by name — a hardcoded pick would
  // become the most expensive tool in the catalogue the day it repriced.
  const priced = catalog
    .filter((s) => Number.isFinite(Number(s.credit_cost)))
    .sort((a, b) => Number(a.credit_cost) - Number(b.credit_cost));
  expect(priced.length, 'no scraper in the catalogue carries a credit_cost, so nothing here ' +
    'can quote a price before it is pressed').toBeGreaterThan(0);
  const cheapest = priced[0];
  console.log(`  cheapest tool: "${cheapest.name}" at ${cheapest.credit_cost} credits ` +
    `(catalogue of ${catalog.length}; balance ${w.total})`);

  const card = panel.getByRole('button', { name: new RegExp(String(cheapest.name).slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
  await expect(card, `the "${cheapest.name}" card is not on the Data catalog screen although ` +
    'the server returned it').toBeVisible({ timeout: 20_000 });
  await card.click();

  const dialog = page.getByRole('dialog').first();
  await expect(dialog, 'the run dialog did not open').toBeVisible({ timeout: 15_000 });

  // The dialog must quote a price BEFORE the button, not after the charge.
  const dialogText = (await dialog.innerText()).replace(/\s+/g, ' ');
  expect(dialogText, 'the run dialog quotes no cost — a person is being asked to spend ' +
    `without being told what. Saw: "${dialogText.slice(0, 200)}"`)
    .toMatch(/credit|free/i);

  // Fill every required input the schema declares. `required` was rendered as a
  // red asterisk and never enforced, so a run could start with a mandatory box
  // empty and fail server-side AFTER the credits were charged.
  const inputs = dialog.locator('input:not([type="checkbox"]), textarea');
  const n = await inputs.count();
  for (let i = 0; i < n; i += 1) {
    const f = inputs.nth(i);
    if (!(await f.isVisible().catch(() => false))) continue;
    const type = await f.getAttribute('type');
    if (type === 'number') { await f.fill('1'); continue; }
    if (!(await f.inputValue())) await f.fill('Ahmedabad chartered accountant');
  }

  const start = dialog.getByRole('button', { name: /Start|Run/i }).first();
  await expect(start, 'the run dialog has no button that starts a run').toBeEnabled();

  const r = await pressAndRead(page, '/v1/scrapers/run', () => start.click(), 120_000);
  console.log(`  scrapers/run: ${r.status} ${r.text.slice(0, 200)}`);

  let typed = 0;
  let spent = 0;
  if (r.status >= 200 && r.status < 300) {
    typed = 1;
    spent = Number(r.body?.credits_charged ?? cheapest.credit_cost ?? 0);
    const runId = String(r.body?.run_id || '');
    expect(runId, 'the run started and returned no run_id').toBeTruthy();
    const row = await apiOne(page, `/api/v1/scrapers/runs/${runId}`);
    console.log(`  RUN COST: ${spent} credits · status=${row?.status} ` +
      `cost_usd=${row?.cost_usd ?? '—'} billed_inr=${row?.billed_inr ?? '—'}`);
  } else {
    const text = (await toastText(page)) || dialogText;
    console.log(`  refusal: ${text.slice(0, 220)}`);
    if (r.status === 402) assertCreditRefusal(text, 'a scraper run', wire);
    else assertLegibleRefusal(text, `a scraper run (${r.status})`, wire);

    // ⚠ A REFUSED RUN MUST COST NOTHING AND LEAVE NOTHING. `run_scraper` writes
    // the run row and takes the debit in ONE transaction, so a 402 rolls the
    // row back too and no actor is ever started. That is the assertion that
    // makes "keep scraper runs to three" safe to have not spent at all.
    const runs = await apiRows(page, '/api/v1/scrapers/runs');
    console.log(`  RUN COST: 0 credits, 0 rupees — refused before the actor was called. ` +
      `hub_scraper_runs for this org: ${runs.length}`);
  }

  const runs = await apiRows(page, '/api/v1/scrapers/runs');
  record('scraper runs', N_SCRAPER_RUNS, typed, runs.length,
    typed ? `cost ${spent} credits` : 'blocked — 402 before the actor was called; 0 credits, 0 rupees');

  expect(r.status, `\n  §4 asks for ${N_SCRAPER_RUNS} scraper runs. The catalogue, the card, the run\n` +
    `  dialog, its price quote and its required inputs are all proved above; the run itself\n` +
    `  answered ${r.status}. A refusal here is FREE — the run row and the debit share one\n` +
    `  transaction, so nothing was charged and no Apify actor was called.\n`)
    .toBeLessThan(300);

  assertNoUncaught(con);
});

test('14.10 data runs — the history, and what it says when there is none', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  con.at('/hub/org?tab=data runs');
  await page.goto('/hub/org?tab=data%20runs');
  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel).toBeVisible({ timeout: 45_000 });

  const runs = await apiRows(page, '/api/v1/scrapers/runs');
  console.log(`  scraper runs on file for this org: ${runs.length}`);

  await expect.poll(async () => {
    const t = (await panel.innerText()).replace(/\s+/g, ' ').trim();
    return t.length >= 20 && !/^Loading/i.test(t);
  }, {
    message: 'the Data runs panel never resolved into words',
    timeout: 30_000,
  }).toBe(true);

  const text = (await panel.innerText()).replace(/\s+/g, ' ').trim();
  console.log(`  ${text.slice(0, 200)}`);
  expect(text, 'the Data runs panel opened on a raw failure').not.toMatch(/requires one of:\s*platform_/i);

  assertNoUncaught(con);
});

test('14.11 credits — four figures, the price table, and a ledger that does not lie', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  con.at('/hub/org?tab=credits');
  await page.goto('/hub/org?tab=credits');
  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel).toBeVisible({ timeout: 45_000 });

  const body = await orgCredits(page);
  const w = await wallet(page);
  const txns = body?.recent_transactions || [];

  const figs = panel.locator('.sr-fig');
  await expect.poll(async () => figs.count(), {
    message: 'the Credits tab never rendered its four figures',
    timeout: 30_000,
  }).toBe(4);

  await expect(figs.filter({ hasText: /Organisation balance/i }).locator('.sr-fig__v'),
    `the painted organisation balance disagrees with the server's (${w.total})`)
    .toHaveText(String(w.total));

  // The price table — §10's "credits" screen has to say what an action spends.
  const priceCount = Object.keys(w.prices || {}).length;
  expect(priceCount, 'the server returned no credit_costs, so this screen cannot say what ' +
    'anything spends').toBeGreaterThan(0);
  await expect(panel, 'the Credits tab does not list what each action spends')
    .toContainText(/What each action spends/i);

  // ⚠ THE LEDGER'S THREE STATES ARE NOT ONE. `catch {}` followed by
  // `transactions.length === 0` once printed "No transactions yet." over a
  // wallet that had been spending all month — a false statement about the
  // account, on the one surface someone opens specifically to reconcile it.
  if (txns.length === 0) {
    await expect(panel, 'an empty credit ledger renders no sentence at all')
      .toContainText(/Nothing has moved through the org wallet yet/i);
  } else {
    const rows = panel.locator('table tbody tr');
    await expect.poll(async () => rows.count(), {
      message: `the server returned ${txns.length} transactions and the ledger drew none`,
      timeout: 20_000,
    }).toBeGreaterThan(0);
  }

  // ⚠ THE CONTROL THAT IS NOT HERE, AND THAT IS CORRECT. There is no top-up on
  // this screen, because `POST /v1/hub/org/credits/topup` is platform-only. It
  // is asserted so nobody adds one that would 403 — and 14.18 shows what
  // happens on the client-side tab, where exactly that control DOES exist.
  await expect(panel.getByRole('button', { name: /Add credits|Top up/i }),
    'the org Credits tab now offers a top-up control. POST /v1/hub/org/credits/topup is ' +
    'require_platform_role(SAHAYAK_COMMERCIAL_ROLES) and has no frontend caller at all ' +
    '(93-E §3.4), so any button here would refuse.')
    .toHaveCount(0);

  record('credit top-ups', N_TOPUPS, 0, txns.filter((t: any) => t.tx_type === 'topup').length,
    'blocked — every top-up route is require_platform_role; the org screen correctly offers none');

  assertNoUncaught(con);
});

// ════════════════════════════════════════════════════════════════════════════
// THE AGENCY WORKSPACE — /hub, /hub/clients, /hub/clients/{id}
// ════════════════════════════════════════════════════════════════════════════

test('14.12 Sahayak Admin and Hub clients — and "+ New client" is a control that refuses', async ({ page }) => {
  const con = watchConsole(page);
  const wire = watchWire(page);
  await signIn(page);

  // ── /hub — the Sahayak Admin dashboard ─────────────────────────────────────
  con.at('/hub');
  await page.goto('/hub');
  await expect.poll(async () => (await page.locator('main, .k-screen, body').first().innerText()).length, {
    message: 'the Sahayak Admin dashboard never rendered anything',
    timeout: 45_000,
  }).toBeGreaterThan(40);
  const dash = await apiOne(page, '/api/v1/hub/dashboard');
  console.log(`  dashboard: clients=${dash?.stats?.total_clients} content=${dash?.stats?.total_content} ` +
    `credits=${dash?.stats?.total_credits}`);

  // ── /hub/clients ───────────────────────────────────────────────────────────
  con.at('/hub/clients');
  await page.goto('/hub/clients');
  const clients = await hubClients(page);
  expect(clients.length, 'the org has no Hub client at all, so every agency-side tab in ' +
    'this suite has no subject. GET /v1/hub/org-client creates one on first read.')
    .toBeGreaterThan(0);

  const cards = page.locator('.hcl-card');
  await expect.poll(async () => cards.count(), {
    message: `the server returned ${clients.length} Hub clients and the grid drew none`,
    timeout: 30_000,
  }).toBe(clients.length);
  console.log(`  hub clients: ${clients.length} — ${clients.map((c) => c.name).join(', ')}`);

  // ── ⚠ THE DEAD CONTROL ─────────────────────────────────────────────────────
  const newClient = page.getByRole('button', { name: /New client/i }).first();
  await expect(newClient, 'the Hub clients page offers no way to add a client at all')
    .toBeVisible();
  await newClient.click();

  const name = page.locator('#hcl-name');
  await expect(name, 'the New client form did not open').toBeVisible({ timeout: 10_000 });
  await typeInto(name, `${TAG} Client ${RUN}`);
  await expect(page.locator('#hcl-slug'), 'the slug did not auto-fill from the name')
    .not.toHaveValue('');

  const create = page.getByRole('button', { name: /^Create client$/ });
  await expect(create, 'the New client form has no submit button').toBeEnabled();

  await clearToasts(page);
  const r = await pressAndRead(page, '/v1/hub/clients', () => create.click());
  console.log(`  POST /v1/hub/clients → ${r.status} ${r.text.slice(0, 200)}`);

  if (r.status >= 200 && r.status < 300) {
    const after = await hubClients(page);
    expect(after.length, 'the client was created and the list did not grow')
      .toBe(clients.length + 1);
    record('hub clients', 0, 1, after.length);
  } else {
    const text = await toastText(page);
    record('hub clients', 0, 0, clients.length,
      `"+ New client" answered ${r.status} — the control cannot work for this account`);
    expect(r.status,
      `\n  ⚠ "+ NEW CLIENT" IS A DEAD CONTROL. HubClientsPage draws the button and the whole\n` +
      `     seven-field form for every org user with module write, and posts\n` +
      `     POST /v1/hub/clients — which is require_platform_role(*SAHAYAK_COMMERCIAL_ROLES).\n` +
      `     This account is org_admin with no platform role, so the answer is ${r.status}:\n` +
      `       ${r.text.slice(0, 200)}\n` +
      `     and the toast reads: "${text}"\n` +
      `     §10 lists "hub clients" as one of Suite 14's seventeen screens. A customer can\n` +
      `     see it, fill it, submit it, and never create a client.\n`)
      .toBeLessThan(400);
    // The refusal, whatever the verdict on the control, must at least be legible.
    assertLegibleRefusal(text, '"+ New client"', wire);
  }

  assertNoUncaught(con);
});

test('14.13 the client workspace — nine tabs, eight opened, one excluded by decision', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  const cid = await orgClientId(page);

  con.at(`/hub/clients/${'{id}'}`);
  await page.goto(`/hub/clients/${cid}`);

  await expect(page.getByRole('tab').first(), 'the client workspace never rendered its tabs')
    .toBeVisible({ timeout: 45_000 });

  const tiles = page.locator('.mk .mk__c');
  await expect.poll(async () => tiles.count(), {
    message: 'the client KPI strip never resolved into figures',
    timeout: 30_000,
  }).toBe(4);

  // The brand tile is the one that tells a customer their output will be
  // generic — 14.17 is about why they cannot do anything about it.
  const brandTile = tiles.filter({ hasText: /Brand profile/i }).first();
  await expect(brandTile, 'the client strip does not say whether a brand profile is set')
    .toBeVisible();
  console.log(`  brand tile: ${(await brandTile.innerText()).replace(/\s+/g, ' ')}`);

  // Presence first, for all NINE — including §13's `publish`, which is proved
  // to EXIST and is then never opened. `tabExists` reads the overflow menu too:
  // nine tabs never all fit, so at least one is always in the tail.
  for (const t of CLIENT_TABS) {
    expect(await tabExists(page, new RegExp(t, 'i')),
      `the "${t}" tab is on neither the strip nor the More menu of the client workspace`)
      .toBe(true);
  }

  const panel = page.locator('[role="tabpanel"]').first();
  for (const t of CLIENT_TABS) {
    if (t === EXCLUDED_TAB) {
      // §13. Named, not skipped — "we chose not to test this" and "we could not
      // test this" must never read the same in the final report.
      console.log(`  ${t.padEnd(10)} EXCLUDED BY DECISION (§13) — not opened`);
      continue;
    }
    con.at(`/hub/clients/{id}?tab=${t}`);
    await openTab(page, new RegExp(t, 'i'));
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const x = (await panel.innerText()).replace(/\s+/g, ' ').trim();
      return x.length >= 15 && !/^Loading…?$/i.test(x);
    }, {
      message: `the client "${t}" panel never resolved into words`,
      timeout: 40_000,
    }).toBe(true);
    const text = (await panel.innerText()).replace(/\s+/g, ' ').trim();
    console.log(`  ${t.padEnd(10)} ${text.slice(0, 120)}`);
    expect(text, `the client "${t}" panel opened on a raw role list`)
      .not.toMatch(/requires one of:\s*platform_/i);
  }

  assertNoUncaught(con);
});

test('14.14 the knowledge base — real prose in, and a question only that prose can answer', async ({ page }) => {
  const con = watchConsole(page);
  const wire = watchWire(page);
  test.setTimeout(20 * 60_000);
  await signIn(page);
  const w = await wallet(page);
  const cid = await orgClientId(page);

  con.at('/hub/clients/{id}?tab=knowledge');
  await page.goto(`/hub/clients/${cid}?tab=knowledge`);
  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel).toBeVisible({ timeout: 45_000 });

  // ── The state before ───────────────────────────────────────────────────────
  const before = await apiRows(page, `/api/v1/hub/clients/${cid}/kb`);
  console.log(`  knowledge base before: ${before.length} documents`);
  const have = new Set(before.map((d: any) => String(d.title)));

  if (before.length === 0) {
    await expect(panel, 'an empty knowledge base renders no explanation')
      .toContainText(/Nothing indexed yet/i);
  }

  const addDoc = panel.getByRole('button', { name: /^Add document$/ });
  await expect(addDoc, 'the Knowledge tab offers no way to add a document — §10\'s ' +
    '"KB upload then answer" has no upload').toBeVisible();

  let typed = 0;
  let refusedStatus = 0;
  let refusalText = '';

  for (const doc of KB_CORPUS) {
    if (have.has(doc.title)) {
      console.log(`  already present: ${doc.title}`);
      continue;
    }
    await addDoc.click();
    const title = panel.locator('form.hb-form input.k-input').first();
    await expect(title, 'the add-document form did not open').toBeVisible({ timeout: 10_000 });
    await typeInto(title, doc.title);
    const content = panel.locator('form.hb-form textarea').first();
    await expect(content, 'the add-document form has no content box').toBeVisible();
    await typeInto(content, doc.content);

    const submit = panel.getByRole('button', { name: /Add and index|Indexing/i }).first();
    await expect(submit, 'the add-document form has no submit button').toBeEnabled();

    await clearToasts(page);
    const r = await pressAndRead(page, new RegExp(`/v1/hub/clients/${cid}/kb$`), () => submit.click(), 180_000);
    console.log(`  kb "${doc.title.slice(0, 34)}…" → ${r.status}`);

    if (r.status >= 200 && r.status < 300) {
      typed += 1;
    } else {
      refusedStatus = r.status;
      refusalText = (await toastText(page)) || '';
      break;
    }
  }

  const after = await apiRows(page, `/api/v1/hub/clients/${cid}/kb`);
  console.log(`  knowledge base after: ${after.length} documents (typed this run: ${typed})`);
  record('KB documents uploaded', N_KB_DOCS, typed, after.length,
    refusedStatus ? `blocked — ${refusedStatus} on document ${typed + 1}` : '');

  if (refusedStatus) {
    if (refusedStatus === 402) assertCreditRefusal(refusalText, 'a knowledge document', wire);
    else assertLegibleRefusal(refusalText, `a knowledge document (${refusedStatus})`, wire);
    // A refused ingest must leave NOTHING — the document row and the charge are
    // one transaction, so a 402 must not leave a document that lists in the
    // customer's knowledge base and retrieves nothing.
    expect(after.length, 'a REFUSED knowledge ingest left a document row behind. It would ' +
      'list in the customer\'s knowledge base, hold no chunks, and answer every question ' +
      'with silence.').toBe(before.length + typed);
  }

  // ── THE QUESTION. This is where "the KB has never returned a result" is settled ──
  const search = panel.getByRole('searchbox', { name: /Search the knowledge base/i })
    .or(panel.locator('input.hb-kb__q')).first();
  await expect(search, 'the Knowledge tab has no search box, so a document can be uploaded ' +
    'and never asked about').toBeVisible();

  const questions = [
    ...KB_CORPUS.map((d) => ({ q: d.question, needle: d.needle, title: d.title })),
    ...KB_EXTRA_QUESTIONS.map((x) => ({ q: x.question, needle: x.needle, title: '' })),
  ].slice(0, N_KB_QUESTIONS);

  expect(questions.length, 'no questions were composed, so this assertion would pass ' +
    'vacuously').toBe(N_KB_QUESTIONS);

  let hits = 0;
  const misses: string[] = [];
  for (const item of questions) {
    await typeInto(search, item.q);
    await panel.getByRole('button', { name: /^Search$/ }).click();
    await expect(panel.locator('.hb-card--lit'), 'the search produced no results panel at all')
      .toBeVisible({ timeout: 30_000 });

    // The wire is the evidence, not the paint — a rendered "0 results" and a
    // failed request read the same to a screenshot.
    const res = await apiRaw(page, `/api/v1/hub/clients/${cid}/kb/search?q=${encodeURIComponent(item.q)}`);
    const results = res.body?.results || [];
    if (results.length) {
      hits += 1;
      const top = results[0];
      console.log(`  Q "${item.q.slice(0, 46)}…" → "${top.doc_title}" @ ${top.similarity}`);
      // ⚠ The floor is `rag.KB_MIN_SCORE = 0.10`, measured against a
      // four-document corpus on 2026-08-19 over `ts_rank(…, 32)`. The score is
      // READ, never hardcoded — and it has to clear the floor or the answer
      // path would discard the hit even though the search found it.
      expect(Number(top.similarity), `the top hit for "${item.q}" scored ${top.similarity}, ` +
        'below rag.KB_MIN_SCORE = 0.10 — `kb_hit_is_citable` would drop it, so the search ' +
        'finding it changes nothing for the reader').toBeGreaterThanOrEqual(0.10);
      const joined = results.map((x: any) => `${x.doc_title} ${x.content}`).join(' ');
      expect(joined, `the knowledge base answered "${item.q}" with content that does not ` +
        `contain the fact only its own document carries (${item.needle})`)
        .toMatch(item.needle);
    } else {
      misses.push(item.q);
    }
  }

  console.log(`  KB questions: ${hits} of ${questions.length} returned a citable result`);
  record('KB questions asked', N_KB_QUESTIONS, questions.length, hits,
    after.length === 0 ? 'the corpus is empty — no document could be ingested' : '');

  // THE SETTLEMENT, stated either way.
  if (after.length === 0) {
    expect(after.length,
      `\n  "THE KB HAS NEVER RETURNED A RESULT" — SETTLED. THE CORPUS WAS NEVER CHUNKED.\n` +
      `\n     All ${questions.length} questions were asked. The search answered 200 {"results":[]}\n` +
      `     every time, which is the honest answer to a question about an empty corpus:\n` +
      `     staging.hub_kb_documents holds 0 rows for this org and 0 in the whole database,\n` +
      `     and an ingest is charged 1 credit as channel/kb_ingest against a wallet of ${w.total}.\n` +
      `\n     BUT THE HISTORY IS THE FINDING, and it is not "nothing was ever uploaded".\n` +
      `     Read out of proposal 93's own pre-reseed backup on 2026-08-29 —\n` +
      `     reseed_backup_20260828, which carries every hub table under a staging__ prefix:\n` +
      `\n       staging__hub_kb_documents               60 rows\n` +
      `       staging__hub_kb_chunks                   0 rows\n` +
      `       …of which carrying an embedding          0\n` +
      `\n     SIXTY DOCUMENTS EXISTED AND NOT ONE WAS EVER CHUNKED. And they were not typed\n` +
      `     by anybody: all 60 were created on 2026-08-02, every one of them 53 or 54\n` +
      `     characters long, across 25 clients — a SQL seed, not an upload, so it never\n` +
      `     went through services/rag.ingest_document and no chunk row was ever written.\n` +
      `     search_hybrid reads staging.hub_kb_chunks and joins UP to the documents, so a\n` +
      `     corpus with no chunks returns [] for every question however good the prose is.\n` +
      `     That is the mechanism, and rag.py measured the same thing independently:\n` +
      `     "not one vector has ever been stored".\n` +
      `\n     THE RANKING HALF WAS A SECOND, INDEPENDENT LOCK, and it is already repaired\n` +
      `     (2026-08-19): the text branch matched the WHOLE QUESTION as one ILIKE literal\n` +
      `     and then labelled whatever survived a constant 0.0 against KB_MIN_SCORE = 0.30.\n` +
      `     It is now websearch_to_tsquery over setweight(title,'A')||setweight(body,'B')\n` +
      `     with a measured floor of 0.10. Untested against data, because there has never\n` +
      `     been any — 53 characters of placeholder could not have settled it either, which\n` +
      `     is exactly what §5 means by "a placeholder makes the KB test unfalsifiable".\n` +
      `\n     SO ONE CREDITED UPLOAD IS ALL THAT IS MISSING. This test carries eight real\n` +
      `     documents of Unicode Group's own prose and twelve questions each of which only\n` +
      `     its own document can answer, and it asserts the returned similarity against\n` +
      `     rag.KB_MIN_SCORE rather than a hardcoded number. Top the wallet up and it\n` +
      `     proves the other half on the next run.\n`)
      .toBeGreaterThan(0);
  } else {
    expect(misses, `the knowledge base holds ${after.length} documents and returned nothing ` +
      `for ${misses.length} question(s) that only those documents can answer:\n     ` +
      misses.join('\n     ')).toHaveLength(0);
  }

  assertNoUncaught(con);
});

test('14.15 the client assistant — sessions typed, and a message either answered or refused legibly', async ({ page }) => {
  const con = watchConsole(page);
  const wire = watchWire(page);
  await signIn(page);
  const cid = await orgClientId(page);

  con.at('/hub/clients/{id}?tab=chat');
  await page.goto(`/hub/clients/${cid}?tab=chat`);
  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel).toBeVisible({ timeout: 45_000 });

  const before = await apiRows(page, `/api/v1/hub/clients/${cid}/chat/sessions`);
  console.log(`  chat sessions before: ${before.length}`);

  const newChat = panel.getByRole('button', { name: /^New chat$/ });
  await expect(newChat, 'the client chat tab offers no way to start a conversation')
    .toBeVisible();

  // ⚠ SESSIONS ARE FREE AND ARE COUNTED, NOT NAMED. `createSession` hardcodes
  // the title 'New chat' and the screen offers no rename, so a mark cannot be
  // typed into one. §6 idempotence is therefore the SHORTFALL to §4's six:
  // run two types nothing because six already exist.
  let typed = 0;
  for (let i = before.length; i < N_CHAT_SESSIONS; i += 1) {
    const r = await pressAndRead(page, new RegExp(`/v1/hub/clients/${cid}/chat/sessions$`),
      () => newChat.click());
    expect(r.status, `POST …/chat/sessions → ${r.status}: ${r.text.slice(0, 200)}`)
      .toBeLessThan(300);
    typed += 1;
  }

  const after = await apiRows(page, `/api/v1/hub/clients/${cid}/chat/sessions`);
  console.log(`  chat sessions after: ${after.length} (typed this run: ${typed})`);
  expect(after.length, `§4 asks for ${N_CHAT_SESSIONS} chat sessions and the org now holds ` +
    `${after.length}`).toBeGreaterThanOrEqual(N_CHAT_SESSIONS);
  record('sahayak chat sessions (client)', N_CHAT_SESSIONS, typed, after.length,
    typed === 0 ? 'already present' : '');

  // ── One message, to prove the send path and whatever answers it ────────────
  await panel.locator('.hb-chat__pick').first().click();
  const box = panel.locator('input.hb-chat__in');
  await expect(box, 'the open conversation has no composer').toBeVisible({ timeout: 15_000 });
  await typeInto(box, 'Which state is this organisation registered in, and what is its GST state code?');

  const send = panel.locator('form.hb-chat__compose').getByRole('button', { name: /^Send$/ });
  await expect(send, 'the client chat composer has no Send button').toBeEnabled();
  const r = await pressAndRead(page, /\/v1\/hub\/chat\/sessions\/[^/]+\/send$/,
    () => send.click(), 180_000);
  const sessionId = new URL(r.url).pathname.split('/').slice(-2)[0];
  console.log(`  send: ${r.status}`);

  let answered = 0;
  if (r.status >= 200 && r.status < 300) {
    answered = 1;
    const msgs = await apiRows(page, `/api/v1/hub/chat/sessions/${sessionId}/messages`);
    expect(msgs.length, 'the send answered 2xx and the session holds no messages — a reply ' +
      'that is only in React state is a reply the customer loses on reload')
      .toBeGreaterThan(0);
    console.log(`  messages on the session: ${msgs.length}`);
  } else {
    // ⚠ A FAILED SEND MUST BE MARKED IN THE THREAD. A toast alone leaves a
    // bubble that looks delivered, which is the defect this tab already fixed
    // once — so it is asserted rather than assumed.
    const failed = panel.locator('.hb-msg__fail').last();
    await expect(failed, `the send answered ${r.status} and the message bubble is not marked ` +
      `as undelivered — it looks sent. wire:${dumpWire(wire)}`).toBeVisible({ timeout: 20_000 });
    const text = (await failed.innerText()).replace(/\s+/g, ' ').trim();
    console.log(`  refusal: ${text.slice(0, 220)}`);
    if (r.status === 402) assertCreditRefusal(text, 'a client chat message', wire);
    else assertLegibleRefusal(text, `a client chat message (${r.status})`, wire);
  }

  record('chat messages (client)', 0, answered, answered,
    answered ? '' : `blocked — ${r.status}, an answer is 2 credits`);

  assertNoUncaught(con);
});

test('14.16 approve and reject on client content are controls this account cannot use', async ({ page }) => {
  const con = watchConsole(page);
  const wire = watchWire(page);
  await signIn(page);
  const cid = await orgClientId(page);

  con.at('/hub/clients/{id}?tab=content');
  await page.goto(`/hub/clients/${cid}?tab=content`);
  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel).toBeVisible({ timeout: 45_000 });

  const items = await apiRows(page, `/api/v1/hub/clients/${cid}/content?limit=25`);
  console.log(`  client content items: ${items.length}`);

  const approve = panel.getByRole('button', { name: /^Approve$/ }).first();
  const reviewable = items.filter((i: any) => i.status === 'draft' || i.status === 'pending_review');

  if (reviewable.length === 0) {
    // Nothing to review is not the same as a broken review. Say which.
    record('content approved', N_CONTENT_APPROVED, 0, 0,
      'nothing to review — no content could be generated (14.07)');
    expect(items.length,
      `\n  §10 asks for "content generate … approve". There is nothing on this client to\n` +
      `  approve, because generation is refused for want of credits (14.07). The review\n` +
      `  control itself is examined below on its route rather than on a row.\n` +
      `  ⚠ AND THE ROUTE IS THE FINDING: hub/ContentTab.jsx:90 patches\n` +
      `    /v1/hub/clients/{id}/content/{cid}/review, which is\n` +
      `    require_platform_role(*SAHAYAK_COMMERCIAL_ROLES). The Approve and Reject buttons\n` +
      `    are gated ON SCREEN only by useModuleWrite, which an org_admin passes — so the\n` +
      `    moment a draft exists, this account will see two buttons that answer 403.\n` +
      `    Nothing in this suite can prove that on a row, and it is reported rather than\n` +
      `    asserted into a green.\n`)
      .toBeGreaterThan(0);
    return;
  }

  await expect(approve, 'content is waiting for review and the tab offers no Approve control')
    .toBeVisible({ timeout: 20_000 });
  await clearToasts(page);
  const r = await pressAndRead(page, /\/content\/[^/]+\/review$/, () => approve.click());
  console.log(`  review: ${r.status} ${r.text.slice(0, 200)}`);

  if (r.status >= 200 && r.status < 300) {
    const after = await apiRows(page, `/api/v1/hub/clients/${cid}/content?status=approved&limit=25`);
    expect(after.length, 'the review answered 2xx and no item became approved')
      .toBeGreaterThan(0);
    record('content approved', N_CONTENT_APPROVED, 1, after.length);
  } else {
    const text = await toastText(page);
    record('content approved', N_CONTENT_APPROVED, 0, 0,
      `Approve answered ${r.status} — the control cannot work for this account`);
    assertLegibleRefusal(text, 'Approve on client content', wire);
    expect(r.status,
      `\n  ⚠ APPROVE / REJECT ARE DEAD CONTROLS FOR AN ORG-SCOPED ACCOUNT.\n` +
      `     hub/ContentTab.jsx:90 patches /v1/hub/clients/{id}/content/{cid}/review, which is\n` +
      `     require_platform_role(*SAHAYAK_COMMERCIAL_ROLES); the buttons are gated on screen\n` +
      `     only by useModuleWrite. Answer: ${r.status} ${r.text.slice(0, 160)}\n` +
      `     Toast: "${text}"\n`)
      .toBeLessThan(400);
  }

  assertNoUncaught(con);
});

test('14.17 the brand profile — the only save control refuses, and the one that works has no screen', async ({ page }) => {
  const con = watchConsole(page);
  const wire = watchWire(page);
  await signIn(page);
  const cid = await orgClientId(page);

  con.at('/hub/clients/{id}?tab=brand');
  await page.goto(`/hub/clients/${cid}?tab=brand`);
  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel).toBeVisible({ timeout: 45_000 });

  const before = await apiOne(page, `/api/v1/hub/clients/${cid}/brand`);
  console.log(`  brand before: voice="${before?.brand_voice ?? ''}" tone="${before?.tone ?? ''}"`);

  // The brand profile is what stops every generated line reading generic, so
  // the form has to be there and it has to take words.
  const voice = panel.locator('textarea, input.k-input').first();
  await expect(voice, 'the Brand tab has no field to describe the brand with — §10 lists ' +
    '"brand profile" as one of Suite 14\'s screens').toBeVisible({ timeout: 20_000 });
  await typeInto(voice, `${TAG} ${RUN} — plain, precise, and never salesy. Unicode Group ` +
    'writes the way a chartered accountant speaks to a client who is busy.');

  const save = panel.getByRole('button', { name: /^Save brand profile$|^Saving/i }).first();
  await expect(save, 'the Brand tab has no save button, or it stayed disabled with the form ' +
    'dirty').toBeEnabled();

  await clearToasts(page);
  const r = await pressAndRead(page, new RegExp(`/v1/hub/clients/${cid}/brand$`), () => save.click());
  console.log(`  PUT brand → ${r.status} ${r.text.slice(0, 200)}`);

  // ⚠ THE ORPHAN, PROVED FROM BOTH ENDS. The route an org CAN call works and
  // has no caller; the route the screen calls cannot be called by an org.
  const orgBrand = await apiRaw(page, '/api/v1/hub/org/brand');
  console.log(`  GET /v1/hub/org/brand → ${orgBrand.status} (org-scoped, require_user, and ` +
    'grep "org/brand" across frontend/src returns 0)');
  expect(orgBrand.status, 'GET /v1/hub/org/brand does not answer an org-scoped caller, so ' +
    'the orphan claim in 93-E §3.4 needs re-measuring').toBeLessThan(400);

  if (r.status >= 200 && r.status < 300) {
    const after = await apiOne(page, `/api/v1/hub/clients/${cid}/brand`);
    expect(String(after?.brand_voice || ''), 'the brand save answered 2xx and the canonical ' +
      'row did not change').toContain(TAG);
    record('brand profile', 1, 1, 1);
  } else {
    const text = await toastText(page);
    record('brand profile', 1, 0, 0, `the only save control answered ${r.status}`);
    assertLegibleRefusal(text, 'Save on the brand profile', wire);
    expect(r.status,
      `\n  ⚠ AN ORGANISATION CAN NEVER SET A BRAND PROFILE.\n` +
      `     The ONLY brand save control in the product is BrandTab.jsx:41, which puts to\n` +
      `     /v1/hub/clients/{id}/brand — require_platform_role(*SAHAYAK_COMMERCIAL_ROLES).\n` +
      `     It answered ${r.status}: ${r.text.slice(0, 160)}   toast: "${text}"\n` +
      `     PUT /v1/hub/org/brand IS org-scoped (require_user) and works — GET answered\n` +
      `     ${orgBrand.status} above — and \`grep "org/brand"\` across frontend/src returns 0.\n` +
      `     93-E §3.4 files it as ORPHANED · LATENT. It is not latent from a customer's\n` +
      `     seat: the KPI strip on this very page says "Not set — output will be generic\n` +
      `     until it is", and there is no door.\n`)
      .toBeLessThan(400);
  }

  assertNoUncaught(con);
});

test('14.18 "Add credits" on the client wallet is a control that refuses', async ({ page }) => {
  const con = watchConsole(page);
  const wire = watchWire(page);
  await signIn(page);
  const cid = await orgClientId(page);

  con.at('/hub/clients/{id}?tab=credits');
  await page.goto(`/hub/clients/${cid}?tab=credits`);
  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel).toBeVisible({ timeout: 45_000 });

  const before = await apiOne(page, `/api/v1/hub/clients/${cid}/credits`);
  const balBefore = Number(before?.wallet?.balance ?? 0);
  console.log(`  client wallet: ${balBefore}`);

  const amount = panel.locator('input[type="number"]').first();
  await expect(amount, 'the client Credits tab offers no top-up field — §10 asks for ' +
    '"credits, top-up"').toBeVisible({ timeout: 20_000 });
  await typeInto(amount, '50');
  const add = panel.getByRole('button', { name: /Add credits|Adding/i }).first();
  await expect(add, 'the top-up form has no submit button').toBeEnabled();

  await clearToasts(page);
  const r = await pressAndRead(page, new RegExp(`/v1/hub/clients/${cid}/credits/topup$`), () => add.click());
  console.log(`  topup → ${r.status} ${r.text.slice(0, 200)}`);

  if (r.status >= 200 && r.status < 300) {
    const after = await apiOne(page, `/api/v1/hub/clients/${cid}/credits`);
    expect(Number(after?.wallet?.balance ?? 0), 'the top-up answered 2xx and the wallet did ' +
      'not move').toBe(balBefore + 50);
    record('credit top-ups', N_TOPUPS, 1, 1);
  } else {
    const text = await toastText(page);
    const after = await apiOne(page, `/api/v1/hub/clients/${cid}/credits`);
    expect(Number(after?.wallet?.balance ?? 0), 'a REFUSED top-up moved the wallet')
      .toBe(balBefore);
    record('credit top-ups', N_TOPUPS, 0, 0,
      `"Add credits" answered ${r.status} — the control cannot work for this account`);
    assertLegibleRefusal(text, '"Add credits"', wire);
    expect(r.status,
      `\n  ⚠ "ADD CREDITS" IS A DEAD CONTROL. hub/CreditsTab.jsx renders the whole top-up\n` +
      `     form to every org user with module write and posts\n` +
      `     /v1/hub/clients/{id}/credits/topup, which is\n` +
      `     require_platform_role(*SAHAYAK_COMMERCIAL_ROLES). Answer: ${r.status}\n` +
      `       ${r.text.slice(0, 200)}\n` +
      `     toast: "${text}"\n` +
      `     ⚠ AND IT WOULD NOT HAVE HELPED IF IT WORKED. The wallet this form tops up is\n` +
      `     staging.hub_credit_wallets — the per-CLIENT pot — while every spend in the\n` +
      `     module goes through credits.spend against staging.hub_org_credits, the ORG\n` +
      `     wallet. So the one top-up control a customer can see funds a balance nothing\n` +
      `     charges against. §4's "credit top-ups 3" has no door at all.\n`)
      .toBeLessThan(400);
  }

  assertNoUncaught(con);
});

test('14.19 the client skill-pack screen — five tabs, and what each says with an empty shelf', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  const cid = await orgClientId(page);

  con.at('/hub/clients/{id}/skills');
  await page.goto(`/hub/clients/${cid}/skills`);

  await expect.poll(async () => (await page.locator('body').innerText()).length, {
    message: 'the client skill-pack screen never rendered',
    timeout: 45_000,
  }).toBeGreaterThan(80);

  const tabs = page.getByRole('tab');
  const n = await tabs.count();
  expect(n, 'the client skill-pack screen rendered no tabs at all').toBeGreaterThan(0);
  const names: string[] = [];
  for (let i = 0; i < n; i += 1) names.push((await tabs.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  console.log(`  skill-pack tabs: ${names.join(' · ')}`);

  const assigned = await apiRows(page, `/api/v1/hub/clients/${cid}/skills`);
  console.log(`  skills assigned to this client: ${assigned.length}`);

  const panel = page.locator('[role="tabpanel"]').first();
  for (let i = 0; i < n; i += 1) {
    con.at(`/hub/clients/{id}/skills#${names[i]}`);
    await tabs.nth(i).click();
    await expect.poll(async () => {
      const t = (await panel.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      return t.length >= 15 && !/^Loading…?$/i.test(t);
    }, {
      message: `the "${names[i]}" skill-pack panel never resolved into words`,
      timeout: 30_000,
    }).toBe(true);
    const t = (await panel.innerText()).replace(/\s+/g, ' ').trim();
    console.log(`  ${names[i].padEnd(14)} ${t.slice(0, 110)}`);
    expect(t, `the "${names[i]}" panel opened on a raw role list`)
      .not.toMatch(/requires one of:\s*platform_/i);
  }

  assertNoUncaught(con);
});

// ════════════════════════════════════════════════════════════════════════════
// THE CEILING, AND THE REFUSAL PAST IT
// ════════════════════════════════════════════════════════════════════════════

test('14.20 a member ceiling cannot be set before anybody has spent', async ({ page }) => {
  const con = watchConsole(page);
  const wire = watchWire(page);
  await signIn(page);

  // The two facts the screen is built from, read before it is opened.
  const balance = await apiOne(page, '/api/v1/billing/me/balance');
  const people = await apiOne(page, '/api/v1/billing/me/usage/people');
  const members = balance?.members || [];
  const spenders = people?.people || [];
  console.log(`  /me/balance members: ${members.length} · /me/usage/people people: ${spenders.length}`);

  con.at('/settings/organisation?tab=billing');
  await page.goto('/settings/organisation?tab=billing');

  const card = page.locator('section, .k-card, [class*="card"]').filter({ hasText: /Who spent what/i }).first();
  await expect(card, 'the Billing tab has no "Who spent what" card, which is the only place ' +
    'in the product a member ceiling can be set').toBeVisible({ timeout: 60_000 });

  const setCeiling = card.getByRole('button', { name: /^Set ceiling$/ });
  const buttons = await setCeiling.count();
  console.log(`  "Set ceiling" buttons on screen: ${buttons}`);

  let typed = 0;
  if (buttons > 0) {
    const want = Math.min(N_CEILINGS, buttons);
    for (let i = 0; i < want; i += 1) {
      await setCeiling.nth(i).click();
      const modal = page.getByRole('dialog').first();
      await expect(modal, 'the ceiling modal did not open').toBeVisible({ timeout: 10_000 });
      const field = page.locator('#ceiling-value');
      await expect(field, 'the ceiling modal has no ceiling field').toBeVisible();
      await typeInto(field, String(20 * (i + 1)));
      const r = await pressAndRead(page, /\/members\/[^/]+\/cap$/, () =>
        modal.getByRole('button', { name: /^Set ceiling$/ }).click());
      expect(r.status, `PUT …/cap → ${r.status}: ${r.text.slice(0, 200)}`).toBeLessThan(300);
      typed += 1;
    }
    const after = await apiOne(page, '/api/v1/billing/me/balance');
    console.log(`  ceilings after: ${(after?.members || []).length}`);
  }

  record('member ceilings', N_CEILINGS, typed, (balance?.members || []).length + typed,
    buttons ? '' : 'no control — the only screen lists one button per person who has SPENT');
  record('refusal past a ceiling', 1, 0, 0,
    buttons ? 'not reached' : 'blocked — no ceiling could be set');

  expect(buttons,
    `\n  ⚠ A MEMBER CEILING CANNOT BE SET BEFORE ANYBODY HAS SPENT.\n` +
    `     The only control in the product is one "Set ceiling" button per ROW of\n` +
    `     "Who spent what" (SpendByPerson.jsx:222), and that table is\n` +
    `     \`rows = ordered(people)\` where \`people\` comes from\n` +
    `     GET /v1/billing/me/usage/people — which is derived from the credit LEDGER\n` +
    `     (credits.usage_by_person). On this org it answers {"people":[]}, and\n` +
    `     /me/balance answers {"members":[]}, so the table renders "Nobody spent anything\n` +
    `     here" and there is no row to press.\n` +
    `     A ceiling is a PREVENTIVE control and the only door to it requires the thing it\n` +
    `     prevents to have already happened. Every new customer, and every org after a\n` +
    `     reseed, is in this state.\n` +
    `     The routes exist and this account may call them —\n` +
    `       PUT/DELETE /v1/billing/me/members/{u}/cap   require_org_role(ORG_SETTINGS_ROLES)\n` +
    `       POST/DELETE /v1/hub/org/credits/allocate/{u} require_user + org admin check,\n` +
    `                                                    and NO frontend caller at all (93-E §3.4)\n` +
    `     — but rule 1 forbids reaching a WRITE through an API when the door is what is\n` +
    `     missing, so nothing was written.\n` +
    `     §4's "member ceilings ${N_CEILINGS}" and "spend past a ceiling and be refused" are\n` +
    `     BLOCKED by this. The org-exhaustion refusal — the other half — IS proved, in\n` +
    `     14.03, 14.07, 14.09, 14.14 and 14.15.\n` +
    `     wire:${dumpWire(wire)}\n`)
    .toBeGreaterThan(0);

  assertNoUncaught(con);
});

// ════════════════════════════════════════════════════════════════════════════
// §13, THE CROSS-CUTTING RULES, AND THE LEDGER OF WHAT THIS RUN ACHIEVED
// ════════════════════════════════════════════════════════════════════════════

test('14.21 §13 — publish and social accounts end this run EMPTY, by decision', async ({ page }) => {
  await signIn(page);
  const cid = await orgClientId(page);

  // These are read, never driven. §13 removes the step that hands a post to an
  // external network and the OAuth plumbing behind it: PublishTab,
  // DestinationPicker, AccountsPanel, NetworkCard, AppPanel,
  // /settings/social-accounts, /settings/connectors. Nothing in this file opens
  // any of them.
  const queue = await apiRaw(page, `/api/v1/hub/clients/${cid}/publish/queue`);
  const accounts = await apiRaw(page, `/api/v1/hub/clients/${cid}/social-accounts`);

  const queueRows = Array.isArray(queue.body?.data) ? queue.body.data : [];
  const accountRows = Array.isArray(accounts.body?.data) ? accounts.body.data : [];

  console.log(
    `\n  §13 EXCLUDED BY DECISION — not blocked, not broken, NOT RUN:\n` +
    `     hub_publish_queue for this client   : ${queueRows.length} rows  (GET → ${queue.status})\n` +
    `     hub_social_accounts for this client : ${accountRows.length} rows  (GET → ${accounts.status})\n` +
    `     Both END THIS RUN EMPTY. That is the decision recorded in 93 §13, in those\n` +
    `     words, so two silent zeroes are not misread as a defect in six weeks' time.\n` +
    `     Generation, approval and scheduling stay IN SCOPE; only the step that hands a\n` +
    `     post to an external network, and the OAuth account plumbing behind it, is out.\n`,
  );

  expect(queueRows.length, 'this suite never opened the Publish tab, so the publish queue ' +
    'must be exactly as it was — a row here means something drove an excluded surface')
    .toBe(0);
  expect(accountRows.length, 'this suite never opened the social-accounts screen, so no ' +
    'account can have been connected').toBe(0);

  record('hub_publish_queue', 0, 0, queueRows.length, 'EXCLUDED BY DECISION §13 — ends the run empty');
  record('hub_social_accounts', 0, 0, accountRows.length, 'EXCLUDED BY DECISION §13 — ends the run empty');
});

test('14.22 cross-cutting — no UUID is rendered on any Sahayak or Hub screen', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  const cid = await orgClientId(page);

  // ⚠ `check-rendered-ids.mjs` is STATIC and POSITIONAL. It cannot see an id the
  // server pre-formatted into a string, and a memory note records it staying
  // GREEN over a real violation. This reads the painted text instead.
  const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
  const USERID_RE = /\buser_[0-9a-f]{8,}\b/i;

  const screens: string[] = [
    '/hub',
    '/hub/clients',
    '/hub/org',
    ...ORG_TABS.map((t) => `/hub/org?tab=${encodeURIComponent(t)}`),
    `/hub/clients/${cid}`,
    ...CLIENT_TABS.filter((t) => t !== EXCLUDED_TAB).map((t) => `/hub/clients/${cid}?tab=${t}`),
    `/hub/clients/${cid}/skills`,
  ];
  expect(screens.length, 'the screen list is empty, so this assertion would pass vacuously')
    .toBeGreaterThan(15);

  const offenders: string[] = [];
  for (const url of screens) {
    con.at(url);
    await page.goto(url);
    await page.waitForTimeout(1_200);
    const body = await page.locator('body').innerText().catch(() => '');
    // The client id is IN THE URL by design (`hub/clients/:clientId` is a route)
    // and that is not a rendered id. Only painted text is read here.
    if (UUID_RE.test(body)) offenders.push(`${url}  →  ${body.match(UUID_RE)![0]}`);
    if (USERID_RE.test(body)) offenders.push(`${url}  →  ${body.match(USERID_RE)![0]}`);
  }

  expect(offenders, 'a UUID or a user id is PAINTED on these screens. Names, not ids — and ' +
    `the static ratchet cannot see this:\n     ${offenders.join('\n     ')}`)
    .toHaveLength(0);

  assertNoUncaught(con);
});

test('14.23 the ledger — §4 volumes achieved against asked, as live counts', async ({ page }) => {
  await signIn(page);
  const w = await wallet(page);
  const cid = await orgClientId(page);

  // Read every figure again, live, at the end of the run. A number collected
  // mid-suite is a number that may have moved.
  const live = {
    'skills on the org shelf': (await orgSkills(page)).length,
    'content items (org)': Number((await apiOne(page, '/api/v1/hub/org/content?limit=1'))?.total ?? 0),
    'KB documents': (await apiRows(page, `/api/v1/hub/clients/${cid}/kb`)).length,
    'chat sessions (client)': (await apiRows(page, `/api/v1/hub/clients/${cid}/chat/sessions`)).length,
    'scraper runs': (await apiRows(page, '/api/v1/scrapers/runs')).length,
    'hub clients': (await hubClients(page)).length,
    'member ceilings': ((await apiOne(page, '/api/v1/billing/me/balance'))?.members || []).length,
    'org credit ledger rows': ((await orgCredits(page))?.recent_transactions || []).length,
  };

  const volumes = readLedger();
  const lines = volumes.map((v) =>
    `    ${v.entity.padEnd(34)} asked ${String(v.asked).padStart(3)} · typed ${String(v.typed).padStart(3)} · ` +
    `present ${String(v.present).padStart(3)}${v.why ? `   ${v.why}` : ''}`);

  console.log(
    `\n  ══ SUITE 14 · §4 VOLUMES, ACHIEVED vs ASKED ══════════════════════════\n` +
    lines.join('\n') +
    `\n\n  ══ LIVE COUNTS AT THE END OF THE RUN ═════════════════════════════════\n` +
    Object.entries(live).map(([k, v]) => `    ${k.padEnd(34)} ${v}`).join('\n') +
    `\n\n  WALLET: ${w.total} credits (allowance ${w.allowance} + purchased ${w.purchased}); ` +
    `plan ${w.plan}/month\n`,
  );

  // Not an assertion about the product — an assertion that the ledger was
  // actually collected. A report of zero entries reads as full coverage, and
  // Playwright discards the worker after every failing test, so a ledger held
  // in memory would report only whatever the last surviving process saw.
  expect(volumes.length,
    `only ${volumes.length} volume(s) were recorded, so this run is reporting less than it ` +
    `measured. Ledger file: ${LEDGER}`)
    .toBeGreaterThan(8);
});
