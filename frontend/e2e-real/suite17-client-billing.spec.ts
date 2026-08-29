/**
 * Proposal 93 · Stage 3 · WAVE 4 · SUITE 17 — Client billing, 9 surfaces, on
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
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT "CLIENT BILLING" MEANS HERE — AND THE HALF THAT IS NOT IN THIS SUITE
 * ═══════════════════════════════════════════════════════════════════════════
 * §10's row for Suite 17 reads: *"Anchor day; pause; resume; mid-cycle
 * downgrade quoting credit and charge over the same days; billing cycle run
 * twice; outbound log, spend by person, usage by source; pay link opened as the
 * customer."* Those nine name TWO different modules, and the split has to be
 * stated rather than quietly resolved, because collapsing "not in this suite"
 * into "tested" is the silent cap §10 warns about.
 *
 *   · **The firm billing ITS clients** — `backend/routers/client_billing.py`
 *     and the six Ganit billing tabs. Every write here is org-scoped and an
 *     org_admin can drive all of it. **THAT IS THIS SUITE.**
 *
 *   · **Aekam billing the firm** — `backend/routers/subscription.py`. Read out
 *     of that file 2026-08-29: `admin/set-plan`, `admin/billing-anchor`,
 *     `admin/pause`, `admin/proration-preview`, `admin/backdated-adjustment`,
 *     `modules/activate`, `modules/deactivate`, `admin/invoices` and
 *     `admin/invoices/{id}/record-payment` EVERY ONE sits behind
 *     `require_platform_role(*BILLING_CONSOLE_ROLES)`. That is god mode, and
 *     the brief reserves god mode to **Suite 19**, whose §12 SAFE tier already
 *     says "Set a plan · build a platform invoice + lines · record a payment …
 *     on Unicode, UK AekamINC or E2E". So the platform anchor day, the platform
 *     pause/resume and the mid-cycle proration preview are **NOT DRIVABLE FROM
 *     AN ORG-SCOPED LANE AT ALL** and belong in Suite 19. They are not skipped
 *     here; they are somebody else's surfaces. `GET /v1/subscription/current`
 *     is org-scoped and IS read here (17.01) so the platform anchor day is at
 *     least observed from the lane that owns the org.
 *
 *   · **"spend by person"** is the Hub credit ledger per member — Suite 14's
 *     "credits, top-up, member ceiling, refusal past it". Not here either.
 *
 * The nine surfaces THIS suite drives, each named so nothing reads as covered
 * that is not:
 *
 *   1  BillingProfilesTab          17.02 — anchor day typed, and CHANGED
 *   2  ServiceLinesTab (create)    17.03 — retainer, subscription, one-off
 *   3  ServiceLinesTab (edit)      17.04 — pause · resume · downgrade · end
 *   4  RateCardsTab                17.05 — three cards, TWO WITH NO NOTE
 *   5  MeteredUsageTab             17.06 — usage by source, the invoiced gate
 *   6  MeteredUsageTab → invoice   17.07 — the billing cycle, run twice
 *   7  SLACreditsTab               17.08 — apply to a bill, and waive
 *   8  AgeingTab                   17.09 — where the money lands
 *   9  PayPage `/i/{token}`        17.10 — opened as the customer, logged out
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS SUITE IS WORTH RUNNING NOW — THE TWO FIXES UNDER TEST
 * ═══════════════════════════════════════════════════════════════════════════
 * Deployed SHA `c52651f2`, on BOTH halves — Railway backend deployment
 * 2acf3870 SUCCESS 2026-08-29 05:13 UTC, Vercel `staging` deployment
 * dpl_CnjDVBuEzNDDyW6Anmrexq51Bw7J READY on the same commit. Verified before a
 * line of this file was written, because a deploy 33 commits stale reads as
 * verification.
 *
 * 1. **`_NullMeansUnset`** on every `*Create` model in `client_billing.py`.
 *    Before it, `RateCardCreate.notes` was `str = ""` while `RateCardsTab`
 *    sends `notes: form.notes || null`, so a rate card with an empty Notes box
 *    was a 422 EVERY TIME. Measured on the live database 2026-08-29 05:26 UTC:
 *    `SELECT count(*) FROM staging.vendor_rate_cards WHERE org_id = <Unicode>`
 *    returned **0**, against §4's 3, while the other four billing lines were
 *    full. **17.05 types two rate cards with the Notes box LEFT EMPTY and
 *    asserts they land.** That is the customer-visible proof.
 *
 *    ⚠ THE CHECK BITES, AND HERE IS WHY IT CANNOT BE MADE TO PASS BY ACCIDENT.
 *    Card 03 carries a note; cards 01 and 02 do not, and 17.05 asserts the
 *    canonical rows for 01 and 02 hold NO note. An author who "fixed" a red
 *    test by typing something into the box would turn the assertion red, not
 *    green. The before-state is on the record as a live count of 0 rather than
 *    as a claim.
 *
 * 2. **`frontend/src/lib/apiError.js`.** FastAPI's `detail` arrives in three
 *    shapes and 184 call sites handled one; on a 422 it is an ARRAY OF
 *    OBJECTS, which is truthy, so `||` kept it and handed an array to a React
 *    child. Every refusal in this module should now read as one actionable
 *    line. 17.04, 17.05 and 17.07 each provoke a REAL refusal and read the
 *    toast, so "Failed to save" appearing alone is a finding with a screen
 *    attached rather than a suspicion.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 1 — EVERY ROW HERE IS TYPED BY A USER
 * ═══════════════════════════════════════════════════════════════════════════
 * Every profile, service line, rate card, usage row, SLA credit, generated
 * invoice and status change below is made by opening the screen, filling the
 * real inputs, choosing from the real pickers and pressing the real button. No
 * SQL. No `page.request.post/put/patch/delete`.
 *
 * `page.request.get` IS used — `apiRows()` / `apiOne()` — and that is the
 * ratchet's own carve-out: asserting the row appeared IS the required
 * evidence. Both send **`X-Org-Id`**, because a read helper that omits it makes
 * the server fall back to the caller's OLDEST membership and answer for a
 * different organisation than the screen beside it.
 *
 * ⚠ ONE PLACE A GET FEEDS A FORM, AND IT IS A FINDING, NOT A SHORTCUT. The
 * SLA-credit Apply sheet asks the person to TYPE A BILL UUID into a text box
 * with no picker in front of it (`SLACreditsTab.jsx:246-252`). There is
 * nowhere in the product that shows a bill's uuid, so the value cannot be
 * obtained by using the product. 17.08 fails on the missing picker — a missing
 * control is a FAILURE, never a skip — and then completes the apply by reading
 * the id from the list endpoint and typing it into the product's own box, so
 * the report can separate "the route is broken" from "the door is missing".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 2 — STOP AND REPORT. NO VERDICT.
 * ═══════════════════════════════════════════════════════════════════════════
 * 93 §14 reserves the product-bug-versus-test-bug judgement to the owner.
 * Where a control §4 requires does not exist, or a fence that must hold does
 * not, the test FAILS and prints what it looked for and what the live wire
 * said. FOUR failed against staging on 2026-08-29 and each was written as a
 * failure on purpose. **ALL FOUR ARE NOW FIXED** — what each one turned out to
 * be is recorded beside it, because the diagnosis was not always the one the
 * failure suggested:
 *
 *   17.04  **A PAUSED SERVICE LINE CANNOT BE RESUMED.** Ending a line is a
 *          `period_end`; resuming it is clearing that date. `ServiceLineUpdate`
 *          is a plain `BaseModel` and `update_service_line` applies a field
 *          only `if val is not None` (`client_billing.py:530-537`), while the
 *          form sends `period_end: form.period_end || null`. So the Clear
 *          button on the Period End DateInput produces a 200 that changes
 *          nothing, the row stays ended, and the screen reports success. This
 *          is the SAME asymmetry `_NullMeansUnset` fixed on the create side,
 *          surviving on the update side where a null is the only way to say
 *          "no end date".
 *          ✅ FIXED 2026-08-29, and it took THREE changes, not one. (a)
 *          `COLUMNS_ENDED` gained an action cell, so an ended line can be
 *          opened at all. (b) `client_billing._assignments` now tells an
 *          OMITTED key from an EXPLICIT null via `model_fields_set` and honours
 *          the null on the columns that are actually nullable — read from
 *          `information_schema`, not from a migration file. (c) ⚠ AND THE
 *          PICKER'S OWN Clear STILL CANNOT BE CLICKED: measured at 1280×720,
 *          the 316px popover does not fit the 314px modal, flips up to y
 *          65–381 against a panel at y 203–517, and `elementFromPoint` over
 *          Clear returns `div.modal__scrim`. That is a SHARED-picker defect
 *          (`ui/DateInput.jsx` never portals its popover) and is reported, not
 *          fixed from here — so the Ended row grew an explicit **Resume**
 *          button, which is the verb §10 asks for anyway.
 *   17.05  **The Delete button on a rate card has no route behind it.**
 *          `RateCardsTab.jsx:83` calls `DELETE /v1/ganit/billing/rate-cards/
 *          {id}`. Read out of the DEPLOYED OpenAPI on 2026-08-29,
 *          `/api/v1/ganit/billing/rate-cards/{card_id}` publishes **PATCH
 *          only** — so the path exists, the verb does not, and the button
 *          answers 405. Every other list in this module can undo a mistyped
 *          row; a price list cannot.
 *          ✅ FIXED 2026-08-29. `DELETE /rate-cards/{card_id}` exists, and it
 *          REFUSES with 409 naming the SLA credits priced off the card rather
 *          than letting the FK violation reach the database as an opaque 500 —
 *          `vendor_sla_credits_rate_card_id_fkey` has no ON DELETE clause, and
 *          2 of Unicode's 3 cards are referenced, so that path is walked. A
 *          hard delete rather than an archive because `effective_to` already
 *          expresses retirement; what was missing was undoing a MISTYPED row.
 *   17.07  **A metered-usage invoice can never be issued.**
 *          `generate_usage_invoice` writes `client_id` and NO `contact_id`
 *          (`client_billing.py:1030-1052`), and `_refuse_final_if_incomplete`
 *          resolves the recipient only through `contact_id`
 *          (`ganit.py:419-425`), so `validate_tax_invoice` sees
 *          `contact = {}` and raises the Rule 46(e) "Recipient name" gap,
 *          which is BLOCKING (`doc_validation.py:249-254`). The draft it
 *          creates therefore cannot be marked final, cannot be sent, cannot
 *          carry a pay link and cannot be paid. The invoice NAMES a company —
 *          it just names it in a column the validator never reads.
 *          ✅ FIXED 2026-08-29 in `_refuse_final_if_incomplete`, which now
 *          falls back to `graha_clients` when there is no contact and hands the
 *          company in as the `company` the validator already accepts. A CRM
 *          client IS the customer (CLAUDE.md), so a document naming one does
 *          name its recipient. Strictly additive: it runs only where there was
 *          no contact to resolve, and the only other `contact` field the tax
 *          validator reads (`gstin`) is ADVISORY, so nothing that passed before
 *          can now fail.
 *          ⚠ AND THE CONTROL WAS NEVER MISSING. The triage that reached this
 *          suite said the Metered Usage panel "offers no Generate Invoice
 *          control". It offers one per client group and always has
 *          (`MeteredUsageTab.jsx`). What hid it was a spinner that never
 *          resolves: the filter's `onChange` raised `loading` while the effect
 *          that clears it only re-runs when the filter's VALUE changes, so a
 *          change event carrying the value already selected — exactly what
 *          `selectOption` sends — replaced the whole panel with a skeleton for
 *          ever, the filter included. Measured: 7 groups and 7 Generate
 *          controls before, 0 and 37 skeleton nodes after. `setLoading(true)`
 *          now lives inside `load`, the one function that always clears it.
 *   17.07  **It also numbers itself outside the firm's own series.** Read live
 *          2026-08-29: Unicode Group's `settings->'doc_prefixes'` is
 *          `{"tax_invoice": "UNX"}` and all 53 of its invoices are
 *          `UNX-2026-nnnn`. `ganit.py` resolves that prefix per org
 *          (`_doc_prefix`), and BOTH client-billing invoice writers hardcode
 *          `"INV"` instead (`client_billing.py:744` and `:1020`). Worse,
 *          `next_doc_number` takes the last number for the org WHATEVER its
 *          prefix and adds one, so the two series interleave their numbering
 *          while disagreeing about their name. Rule 46(b) asks for one
 *          consecutive serial per financial year.
 *          ✅ FIXED 2026-08-29: both writers draw the prefix from
 *          `client_billing._tax_invoice_prefix`, which delegates to
 *          `ganit._doc_prefix` rather than keeping a second copy of the rule.
 *          ⚠ AND THE CHECK THAT WAS MEANT TO CATCH IT HAD NEVER RUN. It read
 *          the series from `GET /api/v1/org/profile`, whose body has NO
 *          `settings` key — so `series` was always `''` and the assertion was
 *          skipped every time. It now reads `GET /api/v1/org/profile/
 *          doc-prefixes` (`effective`), and is scoped to the invoices THIS
 *          execution minted: the fix cannot re-number a document already
 *          issued, and re-numbering one is a data change to live rows.
 *          Historical strays are named in the log instead of failing for ever.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §4 — WHOSE VOLUMES THESE ARE
 * ═══════════════════════════════════════════════════════════════════════════
 * §4 states the billing numbers on two rows and they belong to two suites:
 *
 *   05–06  "Service lines · billing profiles · rate cards · metered usage ·
 *           SLA credits — 6 · 4 · 3 · 12 · 3"          → **Suite 05** owns it,
 *          and on 2026-08-29 has delivered 6 · 5 · **0** · 12 · 3. The rate-card
 *          line is the 422 above and is the one line still open.
 *   13–17  "Subscription changes · billing cycles · pay links opened —
 *           5 · 2 · 2"                                 → **THIS SUITE** owns it.
 *
 * So Suite 17 delivers 5 · 2 · 2 exactly, closes the open rate-card line with
 * 3 of its own, and creates the SMALLEST scaffolding those need: 2 billing
 * profiles, 3 service lines, 6 usage rows, 2 SLA credits. Each carries an
 * `S17` mark, so it is countable apart from Suite 05's and a second execution
 * recognises its own output. **This is stated rather than folded in**: if
 * Suite 05 is re-run after this suite, the org's rate-card count goes to 6
 * against a §4 line of 3, and somebody has to decide which suite owns it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE STATUTORY HALF — where green can be wrong
 * ═══════════════════════════════════════════════════════════════════════════
 * s.7/s.8 IGST Act: a supply whose place of supply is in the supplier's own
 * State is INTRA-state and bears CGST+SGST in equal halves; anything else is
 * INTER-state and bears IGST at the full rate. Unicode Group is Gujarat, GST
 * state code 24 — READ from the live org profile here, never typed as a
 * constant, because a suite that hardcodes the supplier's state cannot notice
 * when the supplier's state changes underneath it.
 *
 * The two billing profiles are deliberately opened against ONE client whose
 * place of supply is 24 and ONE whose is not, so the two generated invoices
 * must split differently. Identical splits would mean the pair is not being
 * compared at all — which is exactly the bug `_tax_split`'s own comment records
 * ("every INTER-STATE DOMESTIC supply was taxed CGST+SGST").
 *
 * The place of supply is derived the way the SERVER derives it
 * (`_place_of_supply`): the customer's GSTIN's first two digits if they are a
 * valid state code, else the address state. GSTIN first, because those two
 * digits ARE the state of registration and that is what a return is built on.
 * ⚠ Suite 04's fixtures carry GSTINs whose prefix contradicts the address —
 * `S04 Client 05 Bengaluru` is addressed in Karnataka and its GSTIN begins 24
 * — so a suite that read the address alone would predict the wrong split and
 * report a tax bug that is a fixture fact.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OUTBOUND FENCE
 * ═══════════════════════════════════════════════════════════════════════════
 * `GET /api/health` reported `outbound_mode=live` with
 * `suppressed_orgs_digest="0"` — NOTHING shielded — on 2026-08-29 05:26 UTC.
 * **Nothing in this suite sends mail**: no invoice is emailed, no dunning is
 * run, no signer is invited. 17.01 records the fence state so the report says
 * what it was rather than implying it was checked and safe, and every test
 * that could send is simply not written. `send_email` returns True when the
 * gate suppresses, so a return value would prove nothing either way; the row
 * is the evidence and this suite creates no outbound row at all.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 — RE-RUNNABLE, AND PROVED BY RUNNING IT TWICE
 * ═══════════════════════════════════════════════════════════════════════════
 * Every record carries a DETERMINISTIC mark built from `TAG` — `S17 Rate 02`,
 * `S17 Usage 05`, `S17 Service line 01` — so `ensure()` reads the live list
 * first and types only what is missing. The two billing profiles are marked by
 * the CLIENT they attach to, chosen by a rule (first client by name whose place
 * of supply matches the org's; first whose does not) rather than by position in
 * an API response, because the product's own client picker HIDES clients that
 * already have a profile and a positional pick would choose a different client
 * on the second run. `RUN` — a per-run stamp — appears only where a value must
 * differ run to run to prove THIS run's write landed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TRAPS THIS FILE IS WRITTEN AROUND
 * ═══════════════════════════════════════════════════════════════════════════
 * · `page.reload()` on the line after Save races the write. Everything goes
 *   through `saveAndWait()`, which returns the SERVER's status. A toast is the
 *   client's opinion.
 * · `fill('')` does not register with a controlled React input — clearing is
 *   select-all-then-type (`typeInto`).
 * · ⚠ **`GanitPage` does NOT read its tab from the URL** — it keeps the open
 *   tab in local state and says so in its own comment — so `/ganit?tab=ageing`
 *   navigates nowhere. `openTab()` clicks the real strip button and falls
 *   through to the More popover, because which of the 21 tabs are inline is
 *   MEASURED at run time from the strip's client width.
 * · `getByRole(name)` matches the ACCESSIBLE name, not the visible text. A
 *   locator written against visible text fails as a MISSING CONTROL, which is
 *   the wrong diagnosis entirely.
 * · ⚠ **`DataTable` DISCARDS its `label` prop.** `ModuleUI.jsx:171` takes
 *   `{ columns, children, arrange }` and never forwards `label`, so
 *   `<DataTable label="Usage: Acme">` renders a table with NO accessible name
 *   anywhere in this product. Nothing here may address a table by its label,
 *   and the gap is reported rather than worked around silently.
 * · A vacuous assertion passes for ever. EVERY loop below asserts its count
 *   BEFORE it iterates.
 * · Lists are date-ordered and a new row is not on page one. Nothing here is
 *   confirmed by looking for it in a table; the write RESPONSE is read, and
 *   then the CANONICAL row is fetched.
 * · No user, member or org UUID is ever rendered or asserted. 17.11 reads the
 *   painted text of all six billing screens, because `check-rendered-ids.mjs`
 *   is static and positional and cannot see an id the server pre-formatted
 *   into a string.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite17.config.ts
 */
import { test, expect, Page, Locator, Browser } from '@playwright/test';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { lane, activeLane, signInAs as laneSignIn, assertOrg, ORG as ORG_IDS } from './_lanes';
import { setDate } from './_helpers';

// ⚠ STAGE 4 (§14): `activeLane()` reads E2E_LANE and DEFAULTS TO 'unicode', so an
// unset run is byte-for-byte the Unicode run this suite was authored against.
// `lane('unicode')` frozen here at import time was why the UK replay could not
// be run at all — §14's own first category, a hidden dependency on Unicode.
const LANE = activeLane();
const API = process.env.E2E_API_URL || 'https://kartavaya-staging.up.railway.app';
const DL = path.join(os.tmpdir(), 'kartavya-e2e-suite17', 'downloads');

const BLOCKED =
  'BLOCKED — no credential for the Unicode Group lane. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e. ⚠ It must be an ORG-SCOPED account: a ' +
  'platform_admin token resolves to Aekam Inc via platform_bypass and would write there.';

const TAG = 'S17';
/** A per-run stamp, used only where a value must differ to prove THIS run wrote it. */
const RUN = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

const pad = (n: number) => String(n).padStart(2, '0');

// ── §4 volumes ──────────────────────────────────────────────────────────────
//
// The 13–17 row is this suite's own and is exact. The rest is the smallest
// scaffolding those three numbers need, plus the rate-card line §4 asks for and
// Suite 05 could not deliver. See the header for who owns what.
const N_PROFILES = 2;          // one intra-state, one inter-state
const N_SERVICE_LINES = 3;     // the subjects of the five subscription changes
const N_RATE_CARDS = 3;        // §4 05–06 · standing at 0 on this org
const N_BLANK_NOTES = 2;       // of the three — THE FIX UNDER TEST
const N_USAGE = 6;             // three per profile — the fuel for the two cycles
const N_SLA = 2;               // one applied to a bill, one waived
const N_SUB_CHANGES = 5;       // §4 13–17 · anchor · arm · pause · downgrade · end
const N_CYCLES = 2;            // §4 13–17
const N_PAY_LINKS = 2;         // §4 13–17

// ── marks ───────────────────────────────────────────────────────────────────
const serviceLineDesc = (n: number) => `${TAG} Service line ${pad(n)}`;
const rateCardCategory = (n: number) => `${TAG} Rate ${pad(n)}`;
const usageMetric = (n: number) => `${TAG} Usage ${pad(n)}`;
const slaMetric = (n: number) => `${TAG} SLA ${pad(n)}`;
/** The source a usage row came from — §10's "usage by source". */
const usageSource = (n: number) => `${TAG}/timesheet/${pad(n)}`;

const SERVICE_LINE_KIND = ['retainer', 'subscription', 'one_off'];
const SERVICE_LINE_CADENCE = ['monthly', 'quarterly', 'one_off'];
const SERVICE_LINE_AMOUNT = [48000, 22500, 15750];
/** Line 02 is downgraded mid-cycle; this is what it goes down to. */
const DOWNGRADE_AMOUNT = 12500;

const TABS: { id: string; label: string }[] = [
  { id: 'billing-profiles', label: 'billing profiles' },
  { id: 'service-lines', label: 'service lines' },
  { id: 'metered-usage', label: 'metered usage' },
  { id: 'rate-cards', label: 'rate cards' },
  { id: 'sla-credits', label: 'sla credits' },
  { id: 'ageing', label: 'ageing' },
];

/**
 * State name → GST state code, for `_place_of_supply`'s address fallback.
 *
 * The server collapses '27', 'MH' and 'Maharashtra' onto one canonical code
 * through `services/gst_states.norm_state`. This is the same mapping for the
 * names Suite 04's fixtures actually use; a state that is not here makes the
 * derivation FAIL LOUDLY rather than silently defaulting to intra-state, which
 * is the guess that produced the original tax bug.
 */
const GST_STATE_CODE: Record<string, string> = {
  'Andhra Pradesh': '37', 'Arunachal Pradesh': '12', Assam: '18', Bihar: '10',
  Chhattisgarh: '22', Delhi: '07', Goa: '30', Gujarat: '24', Haryana: '06',
  'Himachal Pradesh': '02', Jharkhand: '20', Karnataka: '29', Kerala: '32',
  'Madhya Pradesh': '23', Maharashtra: '27', Manipur: '14', Meghalaya: '17',
  Mizoram: '15', Nagaland: '13', Odisha: '21', Puducherry: '34', Punjab: '03',
  Rajasthan: '08', Sikkim: '11', 'Tamil Nadu': '33', Telangana: '36',
  Tripura: '16', 'Uttar Pradesh': '09', Uttarakhand: '05', 'West Bengal': '19',
  'Jammu and Kashmir': '01', Chandigarh: '04', Ladakh: '38',
  'Andaman and Nicobar Islands': '35', Lakshadweep: '31',
  'Dadra and Nagar Haveli and Daman and Diu': '26',
};
const ALL_STATE_CODES = new Set(Object.values(GST_STATE_CODE));

/**
 * The two-digit state a supply to this customer is made INTO — derived exactly
 * the way `client_billing._place_of_supply` derives it.
 *
 * GSTIN FIRST, because its opening two digits ARE the state of registration and
 * that is the figure a return is built on; the address is the fallback for an
 * unregistered customer, who genuinely has no GSTIN and must still be
 * invoiceable. Returns '' when neither answers, which is the case the server
 * REFUSES rather than defaults — see `_tax_split`.
 */
function placeOfSupply(client: any): string {
  const code = String(client?.gstin || '').trim().slice(0, 2);
  if (ALL_STATE_CODES.has(code)) return code;
  let addr: any = client?.address;
  if (typeof addr === 'string') { try { addr = JSON.parse(addr); } catch { addr = null; } }
  const state = String(addr?.state || '').trim();
  return GST_STATE_CODE[state] || '';
}

/** s.7/s.8 IGST Act, from the PAIR. Never from a hardcoded state or figure. */
function expectedSplit(homeCode: string, posCode: string): 'CGST+SGST' | 'IGST' {
  expect(homeCode, 'the supplier has no GST state code, so no split can be derived — ' +
    'and the server refuses to invoice at all in that state (`_tax_split`)').toBeTruthy();
  expect(posCode, 'this customer has neither a usable GSTIN nor an address state, so the ' +
    'place of supply is unknown and no split can be derived').toBeTruthy();
  return homeCode === posCode ? 'CGST+SGST' : 'IGST';
}

test.beforeAll(() => {
  if (!LANE.token && !LANE.password) throw new Error(BLOCKED);
  console.log(
    `\n  LANE: ${LANE.org}  (reference lane, §14)` +
    `${LANE.token ? '  · door opened by TOKEN, every row still typed' : '  · real form login'}` +
    `\n  RUN STAMP: ${RUN}\n`,
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

async function apiRows(page: Page, pathAndQuery: string): Promise<any[]> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  const body = await res.json();
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

async function apiOne(page: Page, pathAndQuery: string): Promise<any> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  const body = await res.json();
  return body?.data ?? body;
}

const profiles = (page: Page) => apiRows(page, '/api/v1/ganit/billing/profiles');
const serviceLines = (page: Page) => apiRows(page, '/api/v1/ganit/billing/service-lines');
const rateCards = (page: Page) => apiRows(page, '/api/v1/ganit/billing/rate-cards');
const usageRows = (page: Page) => apiRows(page, '/api/v1/ganit/billing/metered-usage?invoiced=');
const slaCredits = (page: Page) => apiRows(page, '/api/v1/ganit/billing/sla-credits');

/** This suite's own rows, told apart from Suite 05's by their mark. */
const mine = (rows: any[], key: string) =>
  rows.filter((r) => String(r?.[key] ?? '').startsWith(`${TAG} `));

/**
 * The two clients this suite bills — chosen by a RULE, not by position.
 *
 * The profile modal's client `<select>` offers only companies that have no
 * profile yet, so a positional pick ("the first client in the list") chooses a
 * DIFFERENT company on the second run, once the first one has a profile. The
 * rule below is stable across runs and across Suite 05's own picks: sort by
 * name, take the first company whose place of supply equals the org's, and the
 * first whose does not.
 *
 * Both must exist or the GST half of this suite is untestable, and that is a
 * FAILURE naming what is missing rather than a quiet fallback to one client.
 */
async function billingTargets(page: Page, homeCode: string) {
  const clients = (await apiRows(page, '/api/v1/graha/clients'))
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  expect(clients.length, 'no CRM companies exist, so nothing can be billed — Suite 04 must run first')
    .toBeGreaterThan(0);

  const intra = clients.find((c) => placeOfSupply(c) === homeCode);
  const inter = clients.find((c) => placeOfSupply(c) && placeOfSupply(c) !== homeCode);

  expect(intra, `no client resolves to a place of supply of ${homeCode} (the org's own state), ` +
    'so the CGST+SGST half of the split cannot be exercised at all').toBeTruthy();
  expect(inter, `every client resolves to place of supply ${homeCode}, so the IGST half of the ` +
    'split cannot be exercised — which is the exact condition under which an inter-state ' +
    'supply was silently taxed CGST+SGST').toBeTruthy();
  expect(String(intra.name), 'the two billing targets must be different companies')
    .not.toBe(String(inter.name));

  return {
    intra: { name: String(intra.name), pos: placeOfSupply(intra), split: 'CGST+SGST' as const },
    inter: {
      name: String(inter.name),
      pos: placeOfSupply(inter),
      split: expectedSplit(homeCode, placeOfSupply(inter)),
    },
  };
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
 * two apart — the browser even reported it as CORS, because FastAPI attaches no
 * CORS headers to an unhandled 500.
 */
function watchWire(page: Page): Wire {
  const wire: Wire = [];
  page.on('response', async (r) => {
    const req = r.request();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return;
    if (!/\/api\//.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 220); } catch { /* consumed */ }
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

/**
 * An UNCAUGHT exception is a broken screen and is asserted everywhere.
 *
 * ⚠ React error #31 — "Objects are not valid as a React child" — is precisely
 * what a 422 `detail` array produced before `apiError.js`, so this assertion is
 * half the proof of fix 2: every refusal this suite provokes must leave the
 * page standing.
 */
function assertNoUncaught(c: Watcher) {
  const uncaught = c.errors.filter((e) => e.text.startsWith('UNCAUGHT'));
  expect(uncaught, `uncaught exception(s) on screen:${dumpConsole(c)}`).toHaveLength(0);
}

/**
 * The text of the error toast the product actually painted.
 *
 * This is fix 2 read from the screen rather than from the source. A refusal
 * that still says only "Failed to save" is a call site the codemod missed, and
 * the caller reports it with the file and the line.
 */
async function errorToast(page: Page): Promise<string> {
  const toast = page.locator('.tst--err .tst__t').last();
  await expect(toast, 'the product refused the write but painted no error toast at all — ' +
    'a refusal nobody can see is worse than one nobody can read').toBeVisible({ timeout: 20_000 });
  return (await toast.innerText()).trim();
}

/**
 * A refusal must NAME something. "Failed to …" alone is the pre-fix message and
 * is reported as a finding, not tolerated.
 */
function assertActionable(text: string, where: string) {
  expect(text.length, `${where}: the refusal toast was empty`).toBeGreaterThan(0);
  expect(
    /^(Failed to (save|delete|apply|generate|waive)[.\s]*|Something went wrong[.\s]*)$/i.test(text),
    `${where}: the refusal read "${text}" — that is apiError.js's FALLBACK, which means the ` +
    'server said nothing usable OR this call site still passes the raw `detail`. Either way ' +
    'the person typing cannot learn which field was wrong. Report the file and line.',
  ).toBe(false);
}

// ════════════════════════════════════════════════════════════════════════════
// SCREEN MACHINERY
// ════════════════════════════════════════════════════════════════════════════

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
}

const panel = (page: Page, tab: string) => page.locator(`#mt-panel-${tab}`);

/**
 * Open one Ganit tab by clicking it, inline or out of the More popover.
 *
 * ⚠ NOT by URL. `GanitPage` keeps the open tab in local state and reads it from
 * "nowhere deeper" — no `?tab=`, no route state — so a `goto('/ganit?tab=ageing')`
 * lands on whatever the user's starred default is and every assertion afterwards
 * is about the wrong screen. `ModuleTabs` measures how many tabs FIT and pushes
 * the rest behind "More +N", so which of the twenty-one is inline depends on the
 * viewport at run time. A tab in neither place is a product finding, not a
 * selector problem, and fails saying so.
 */
async function openTab(page: Page, id: string, label: string): Promise<Locator> {
  if (!/\/ganit/.test(new URL(page.url()).pathname)) await page.goto('/ganit');
  const strip = page.locator('.mt__wrap');
  await expect(strip, 'the Finance tab strip never rendered').toBeVisible({ timeout: 60_000 });

  if (await panel(page, id).count() && await panel(page, id).isVisible().catch(() => false)) {
    await settle(page);
    return panel(page, id);
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
    await expect(row.first(), `tab "${label}" is neither on the strip nor in the More menu — ` +
      'it is unreachable, which is a product finding and not a selector problem').toBeVisible();
    await row.first().click();
  }

  await expect(panel(page, id),
    `the Finance "${id}" panel never rendered after its tab was clicked`)
    .toBeVisible({ timeout: 60_000 });
  await settle(page);
  return panel(page, id);
}

/**
 * Press a control that writes, and WAIT FOR THE SERVER before going on.
 *
 * Clicking Save and calling `page.reload()` on the very next line tears the
 * page down with the request in flight, the value reads back empty, and the
 * suite reports "the product did not save it" about a product that had. Returns
 * the parsed response so a caller asserts on the STATUS.
 *
 * ⚠ `allowError` is NOT a softened assertion. It is for the three places this
 * suite deliberately provokes a refusal it wants to READ — the rate-card
 * delete, the mark-final and the resume. Asserting `< 400` inside this helper
 * would throw before the toast could be read, and the failure message would
 * then be a bare status code instead of the sentence the customer sees. Every
 * caller that passes it asserts the status ITSELF, immediately, with the wire
 * and the toast in the message. Nothing is skipped and no expectation is
 * dropped; the assertion simply moves to where the evidence is.
 */
async function saveAndWait(
  page: Page,
  act: () => Promise<void>,
  urlRe: RegExp,
  what: string,
  opts: { methods?: string[]; expectStatus?: number; allowError?: boolean } = {},
) {
  const methods = opts.methods ?? ['POST', 'PUT', 'PATCH', 'DELETE'];
  const [res] = await Promise.all([
    page.waitForResponse((r) => urlRe.test(r.url()) && methods.includes(r.request().method()),
      { timeout: 90_000 }),
    act(),
  ]);
  const body = await res.text().catch(() => '');
  const line = `${what}: ${res.request().method()} ${new URL(res.url()).pathname} → ` +
    `${res.status()}\n     ${body.slice(0, 500)}`;
  if (opts.expectStatus != null) expect(res.status(), line).toBe(opts.expectStatus);
  else if (!opts.allowError) expect(res.status(), line).toBeLessThan(400);
  let json: any = {};
  try { json = JSON.parse(body); } catch { /* not json */ }
  return { status: res.status(), body, json };
}

/**
 * Type into a controlled React input the way a person does.
 *
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
 * Choose an option by its VISIBLE TEXT from a `<select>` that a fetch fills in.
 *
 * Reading the options straight after `settle()` catches the empty mount and
 * reports "no clients to pick" against an org holding twenty-five — a false
 * product finding, which is worse than a flake.
 */
async function pickByLabel(select: Locator, label: string | RegExp, what: string) {
  const hit = (t: string) => (typeof label === 'string' ? t.includes(label) : label.test(t));
  await expect
    .poll(async () => (await select.locator('option').allTextContents()).filter(hit).length, {
      message: `the ${what} picker never offered ${String(label)}`,
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  const texts = await select.locator('option').allTextContents();
  const idx = texts.findIndex(hit);
  const value = await select.locator('option').nth(idx).getAttribute('value');
  await select.selectOption(value!);
  return texts[idx].trim();
}

async function inModal(page: Page, title: string | RegExp): Promise<Locator> {
  const m = page.getByRole('dialog', { name: title });
  await expect(m, `the "${String(title)}" dialog did not open`).toBeVisible({ timeout: 30_000 });
  return m;
}

/** One labelled field inside an open dialog. Scoped, because module headers duplicate names. */
const mfld = (m: Locator, label: string) =>
  m.locator('label.fld').filter({ hasText: label }).first();

async function saveModal(page: Page, m: Locator, urlRe: RegExp, what: string) {
  await saveAndWait(page, async () => {
    await m.getByRole('button', { name: /^Save$/ }).click();
  }, urlRe, what);
  await expect(m, 'the dialog stayed open after a successful save').toBeHidden({ timeout: 20_000 });
}

/**
 * Clear a `<DateInput>` through the product's own affordance.
 *
 * The native input is still in the DOM — form serialisation depends on it — but
 * it is clipped and out of the tab order, so `fill('')` is refused, correctly.
 * The popover carries a "Clear" quick-action whenever the field holds a value
 * and is not required (`DateInput.jsx:210`), and driving that is both the only
 * way and the truer test: it is what the user does to resume an ended line.
 */
async function clearDate(scope: Locator, labelText: string | RegExp) {
  const label = scope.locator('label', { hasText: labelText }).first();
  await label.locator('.pk--dt button.pk__tr').first().click();
  const pop = label.locator('.pk__pop');
  await expect(pop, 'the date picker did not open').toBeVisible();
  const clear = pop.getByRole('button', { name: 'Clear' });
  await expect(clear, 'the date picker offers no Clear, so a date once set can never be removed')
    .toBeVisible();
  await clear.click();
  await expect(pop).toBeHidden();
}

async function setCheckbox(box: Locator, on: boolean) {
  await expect(box).toBeVisible();
  if ((await box.isChecked()) !== on) await box.click();
  expect(await box.isChecked()).toBe(on);
}

/**
 * §6 — create only what is missing.
 *
 * Reads the live list first. A mark already present is VERIFIED and not typed
 * again, which is what makes a second execution recognise its own output rather
 * than double it. Returns how many it had to type, so a test can say which half
 * of §6 it exercised.
 */
async function ensure(
  wanted: number[],
  present: Set<string>,
  markOf: (n: number) => string,
  create: (n: number) => Promise<void>,
): Promise<{ typed: number; found: number }> {
  let typed = 0;
  let found = 0;
  for (const n of wanted) {
    if (present.has(markOf(n))) { found++; continue; }
    await create(n);
    typed++;
  }
  return { typed, found };
}

const marksOf = (rows: any[], key: string) =>
  new Set(rows.map((r) => String(r?.[key] ?? '').trim()).filter(Boolean));

/** The outbound fence, reported rather than assumed. Nothing here sends. */
async function outboundFence(page: Page) {
  const res = await page.request.get(`${API}/api/health`);
  expect(res.status(), `GET /api/health → ${res.status()}`).toBe(200);
  const meta = await res.json();
  const mode = String(meta.outbound_mode ?? '');
  const digest = String(meta.suppressed_orgs_digest ?? '');
  const all = [ORG_IDS.UNICODE, ORG_IDS.E2E, ORG_IDS.UK, ORG_IDS.AEKAM].map((o) => o.toLowerCase());
  let shielded = mode === 'dry';
  for (let mask = 1; !shielded && mask < (1 << all.length); mask++) {
    const set = all.filter((_, i) => mask & (1 << i));
    if (!set.includes(LANE.orgId.toLowerCase())) continue;
    if (createHash('sha256').update([...set].sort().join(',')).digest('hex').slice(0, 16) === digest) {
      shielded = true;
    }
  }
  return { mode, digest, shielded };
}

/** The org's own GST state code, read live. Never a constant. */
async function homeStateCode(page: Page): Promise<string> {
  const org = await apiOne(page, '/api/v1/org/profile');
  const raw = String(org?.state_code ?? '').trim();
  const code = ALL_STATE_CODES.has(raw) ? raw : (GST_STATE_CODE[raw] || '');
  expect(code, `this organisation's state_code reads "${raw}", which is not a GST state — ` +
    'every money path in this product is Indian statute and nothing can be taxed without it')
    .toBeTruthy();
  return code;
}

/**
 * Every invoice this module GENERATED, found by its own notes line.
 *
 * ⚠ NOT by looking on page one of the register: `list_invoices` orders by
 * `created_at DESC`, the org holds 50+ invoices, and a generated one is not
 * where a naive click would look. It is also not findable from the LIST at all
 * — the register returns neither `notes` nor `billing_profile_id` — so this
 * narrows to the drafts (a generated usage invoice is written `doc_status =
 * 'draft'` explicitly) and asks each RECORD, which is what a person would have
 * to do as well. Bounded and deterministic; no id is rendered or asserted.
 */
async function generatedUsageInvoices(page: Page): Promise<any[]> {
  // ⚠ NO `doc_status` PRE-FILTER, AND THAT IS THE POINT. CHANGED 2026-08-29.
  //
  // This used to narrow the list to `doc_status === 'draft'` before fetching
  // each row's detail — and a generated invoice IS born a draft, so it looked
  // right. But 17.07 ISSUES one of these invoices, which is the whole claim it
  // proves, and `draft → final` is one-way. The moment marking final started
  // working, the issued invoice stopped matching the filter and 17.11 counted
  // "billing cycles (invoices generated) 1 / 2" — a red on the fix succeeding.
  //
  // The mistake was defining "generated" by a MUTABLE STATUS rather than by the
  // invariant that actually marks it: the `notes` line the two writers in
  // `client_billing.py` stamp on every invoice they raise. Status is now not
  // consulted at all.
  //
  // The pre-filter existed for cost, and the cost is real — neither `notes` nor
  // `billing_profile_id` is on the LIST payload (checked live 2026-08-29: the
  // list returns 27 fields and neither is among them), so the marker can only
  // be read from each record. So the detail reads are made CONCURRENTLY in
  // small batches instead, which is where the pre-filter's speed came from
  // without borrowing a status to do it.
  const rows = await apiRows(page, '/api/v1/ganit/invoices');
  const out: any[] = [];
  const BATCH = 6;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const recs = await Promise.all(
      batch.map((r) => apiOne(page, `/api/v1/ganit/invoices/${r.id}`)),
    );
    for (const rec of recs) {
      const inv = rec?.invoice ?? rec;
      if (String(inv?.notes || '').startsWith('Metered usage invoice for ')) out.push(inv);
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// THE SUITE
// ════════════════════════════════════════════════════════════════════════════

test.describe('Suite 17 — Client billing · Unicode Group', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 17.01 · all six billing screens open, each states its state IN WORDS, and
  //         the platform half of §10's row is located rather than assumed
  // ──────────────────────────────────────────────────────────────────────────
  test('17.01 all six client-billing screens open and say in words what they hold', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    const fence = await outboundFence(page);
    console.log(`\n  17.01 — outbound fence: mode=${fence.mode} digest=${fence.digest} ` +
      `shielded=${fence.shielded}\n     Nothing in Suite 17 sends mail: no invoice is emailed, ` +
      'no dunning runs, no signer is invited. The state is recorded, not relied on.\n');

    const seen: string[] = [];
    for (const t of TABS) {
      con.at(t.id);
      const p = await openTab(page, t.id, t.label);

      // Either a table with rows, or an empty state IN WORDS. A spinner that
      // never resolves and a blank panel are the two states a new customer
      // cannot tell from a broken product, and neither is acceptable.
      const table = p.locator('table.tbl');
      const empty = p.locator('.es, .gn-note').first();
      await expect
        .poll(async () => (await table.count()) + (await empty.count()), {
          message: `the "${t.label}" screen rendered neither a table nor an empty state — ` +
            'a panel that is blank is indistinguishable from one that is broken',
          timeout: 45_000,
        })
        .toBeGreaterThan(0);

      const rows = await p.locator('table.tbl tbody tr').count();
      const words = (await p.innerText()).replace(/\s+/g, ' ').trim().slice(0, 90);
      seen.push(`${t.label.padEnd(18)} ${String(rows).padStart(3)} row(s)  ${words}`);
      expect(words.length, `the "${t.label}" screen paints no text at all`).toBeGreaterThan(0);
    }

    // ── THE PLATFORM HALF OF §10's ROW, LOCATED RATHER THAN SKIPPED ──────────
    //
    // The org's own subscription anchor day is an ORG-SCOPED READ and belongs
    // in the report even though nothing here may change it: every write that
    // moves it is `require_platform_role`, i.e. Suite 19. Reading it is how the
    // report can say "the platform anchor day exists and is N" rather than
    // leaving a silent zero for somebody to misread as a defect.
    const sub = await apiOne(page, '/api/v1/subscription/current');
    const anchor = sub?.billing_anchor_day ?? sub?.anchor_day ?? sub?.subscription?.billing_anchor_day;
    console.log('\n  17.01 — the six client-billing screens:\n     ' + seen.join('\n     ') +
      `\n\n  17.01 — the PLATFORM subscription, read only (Suite 19 owns its writes):` +
      `\n     plan=${sub?.plan?.name ?? sub?.plan_name ?? '(none)'} ` +
      `status=${sub?.status ?? sub?.subscription?.status ?? '(none)'} anchor_day=${anchor ?? '(not reported)'}\n`);

    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 17.02 · SURFACE 1 — billing profiles, and the ANCHOR DAY
  // ──────────────────────────────────────────────────────────────────────────
  test('17.02 two billing profiles are opened, one supplying into this state and one out of it', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const home = await homeStateCode(page);
    const target = await billingTargets(page, home);
    console.log(`\n  17.02 — supplier state ${home}; billing ` +
      `"${target.intra.name}" (place of supply ${target.intra.pos} → ${target.intra.split}) and ` +
      `"${target.inter.name}" (place of supply ${target.inter.pos} → ${target.inter.split})\n`);

    const p = await openTab(page, 'billing-profiles', 'billing profiles');
    const before = await profiles(page);
    const withProfile = new Set(before.map((r) => String(r.client_name)));

    // The anchor day is the WHOLE POINT of this record: it is the day of the
    // month every period of every service line beneath it starts on. 1–28 is
    // the product's own bound and it is a real one — a 29th, 30th or 31st falls
    // off the end of February and the period would silently move.
    const ANCHOR = { [target.intra.name]: 5, [target.inter.name]: 28 };
    const CYCLE = { [target.intra.name]: 'monthly', [target.inter.name]: 'quarterly' };
    const TERMS = { [target.intra.name]: 15, [target.inter.name]: 45 };

    let typed = 0;
    for (const t of [target.intra, target.inter]) {
      if (withProfile.has(t.name)) continue;
      await p.getByRole('button', { name: /^\+ Billing Profile$/ }).first().click();
      const m = await inModal(page, /Billing Profile/);
      await pickByLabel(mfld(m, 'Client').locator('select.inp'), t.name, 'client');
      await mfld(m, 'Billing Cycle').locator('select.inp').selectOption(CYCLE[t.name]);
      await typeInto(mfld(m, 'Anchor Day').locator('input.inp'), String(ANCHOR[t.name]));
      await typeInto(mfld(m, 'Payment Terms').locator('input.inp'), String(TERMS[t.name]));
      await mfld(m, 'GST Treatment').locator('select.inp').selectOption('registered');
      await typeInto(mfld(m, 'Credit Limit').locator('input.inp'), '250000');
      // The Notes box is left EMPTY on purpose. `ProfileCreate.notes` was
      // `str = ""` before `_NullMeansUnset`, and `BillingProfilesTab` spreads
      // the form straight through — so this is the same asymmetry the rate card
      // died of, on a second screen, and it must land.
      await saveModal(page, m, /\/v1\/ganit\/billing\/profiles$/,
        `billing profile for ${t.name} — with the Notes box LEFT EMPTY`);
      await settle(page);
      typed++;
    }

    const after = await profiles(page);
    for (const t of [target.intra, target.inter]) {
      const row = after.find((r) => String(r.client_name) === t.name);
      expect(row, `no billing profile exists for ${t.name} after typing one${dumpWire(wire)}`)
        .toBeTruthy();
      expect(Number(row.anchor_day), `${t.name}: the anchor day must sit in 1–28, so a monthly ` +
        'cycle cannot fall off the end of February').toBeGreaterThanOrEqual(1);
      expect(Number(row.anchor_day)).toBeLessThanOrEqual(28);
      expect(String(row.client_name || ''), 'a billing profile that names no client bills nobody')
        .not.toBe('');
    }

    console.log(`\n  17.02 — billing profiles: ${typed} typed, ${N_PROFILES - typed} already present ` +
      `(org total ${after.length})\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 17.03 · SURFACE 2 — service lines, and the auto-invoice flag
  // ──────────────────────────────────────────────────────────────────────────
  test('17.03 three service lines hang off those profiles, one of every kind', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const home = await homeStateCode(page);
    const target = await billingTargets(page, home);
    const live = await profiles(page);
    expect(live.length, '17.02 must run first — a service line hangs off a billing profile')
      .toBeGreaterThan(0);

    const p = await openTab(page, 'service-lines', 'service lines');
    const present = marksOf(await serviceLines(page), 'description');

    // Lines 01 and 02 sit on the intra-state customer (01 is armed and paused,
    // 02 is downgraded); line 03 sits on the inter-state one and is the one
    // that gets ended. Cadence and kind are one of each so the "Ended"/"Active"
    // split and the one_off branch of the sweep are both real.
    const lineClient = (n: number) => (n === 3 ? target.inter.name : target.intra.name);

    const { typed, found } = await ensure(
      [1, 2, 3], present, serviceLineDesc,
      async (n) => {
        await p.getByRole('button', { name: /^\+ Service Line$/ }).first().click();
        const m = await inModal(page, /Service Line/);
        await pickByLabel(mfld(m, 'Billing Profile').locator('select.inp'),
          lineClient(n), 'billing profile');
        await mfld(m, 'Kind').locator('select.inp').selectOption(SERVICE_LINE_KIND[n - 1]);
        await typeInto(mfld(m, 'Description').locator('input.inp'), serviceLineDesc(n));
        await typeInto(mfld(m, 'Amount').locator('input.inp'), String(SERVICE_LINE_AMOUNT[n - 1]));
        await mfld(m, 'Cadence').locator('select.inp').selectOption(SERVICE_LINE_CADENCE[n - 1]);
        await setDate(m, /Period Start/, '2026-08-01');
        // Period End is LEFT EMPTY — an open-ended retainer is the ordinary
        // case, and it is also the state 17.04 has to be able to return the
        // line to after ending it.
        await saveModal(page, m, /\/v1\/ganit\/billing\/service-lines$/,
          `service line ${n} (${SERVICE_LINE_KIND[n - 1]}) — with no end date`);
        await settle(page);
      },
    );

    const rows = mine(await serviceLines(page), 'description');
    expect(rows.length, `wanted ${N_SERVICE_LINES} S17 service lines, the list holds ` +
      `${rows.length}${dumpWire(wire)}`).toBe(N_SERVICE_LINES);
    for (const r of rows) {
      expect(String(r.client_name || ''), `${r.description} is billed to nobody`).not.toBe('');
      expect(Number(r.amount), `${r.description} is worth nothing, so it can never be invoiced`)
        .toBeGreaterThan(0);
    }
    // The "Active" table is the one a person reads; a line with no end date
    // belongs in it and nowhere else.
    const active = p.locator('h3.gn-section-head', { hasText: /^Active/ });
    await expect(active, 'three open-ended service lines exist and the screen shows no Active section')
      .toBeVisible();

    console.log(`\n  17.03 — service lines: ${typed} typed, ${found} already present\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 17.04 · SURFACE 3 — the five subscription changes, and the resume that is
  //         reported as a success and is not one
  // ──────────────────────────────────────────────────────────────────────────
  test('17.04 five subscription changes land — and a paused line cannot be resumed', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const home = await homeStateCode(page);
    const target = await billingTargets(page, home);

    const lineByDesc = async (desc: string) => {
      const row = (await serviceLines(page)).find((r) => String(r.description) === desc);
      expect(row, `${desc} does not exist — 17.03 must run first`).toBeTruthy();
      return row;
    };
    const openLineEditor = async (p: Locator, desc: string) => {
      const tr = p.locator('tbody tr').filter({ hasText: desc }).first();
      await expect(tr, `"${desc}" is not on the service-lines screen, so it cannot be edited`)
        .toBeVisible({ timeout: 30_000 });
      await tr.getByRole('button', { name: /^Edit$/ }).click();
      return inModal(page, /Edit Service Line/);
    };

    const changes: string[] = [];

    // ── CHANGE 1 · THE ANCHOR DAY ────────────────────────────────────────────
    // The day of the month every period starts on. Changing it is the smallest
    // real subscription change there is, and it is the one §10 names first.
    {
      const p = await openTab(page, 'billing-profiles', 'billing profiles');
      const before = (await profiles(page)).find((r) => String(r.client_name) === target.intra.name);
      expect(before, `no billing profile for ${target.intra.name}`).toBeTruthy();
      const wanted = Number(before.anchor_day) === 15 ? 5 : 15;

      const tr = p.locator('tbody tr').filter({ hasText: target.intra.name }).first();
      await expect(tr, `${target.intra.name} is not on the billing-profiles screen`).toBeVisible();
      await tr.getByRole('button', { name: /^Edit$/ }).click();
      const m = await inModal(page, /Edit Billing Profile/);
      await typeInto(mfld(m, 'Anchor Day').locator('input.inp'), String(wanted));
      await saveModal(page, m, /\/v1\/ganit\/billing\/profiles\//, 'anchor day change');
      await settle(page);

      const after = (await profiles(page)).find((r) => String(r.client_name) === target.intra.name);
      expect(Number(after.anchor_day), 'the anchor day was changed on screen and the canonical ' +
        `row still reads ${after.anchor_day}${dumpWire(wire)}`).toBe(wanted);
      changes.push(`anchor day ${before.anchor_day} → ${wanted} on ${target.intra.name}`);
    }

    // ── CHANGES 2 AND 3 · ARM, THEN PAUSE ────────────────────────────────────
    // `auto_invoice` is the only switch in this module that decides whether a
    // subscription bills itself. `auto_invoice: false` is NOT null, so the
    // update path applies it — which is why the pause works while the resume
    // below does not.
    {
      const p = await openTab(page, 'service-lines', 'service lines');

      let m = await openLineEditor(p, serviceLineDesc(1));
      await setCheckbox(m.locator('input[type="checkbox"]').first(), true);
      await saveModal(page, m, /\/v1\/ganit\/billing\/service-lines\//, 'arm auto-invoice');
      await settle(page);
      let row = await lineByDesc(serviceLineDesc(1));
      expect(row.auto_invoice, 'the Auto-generate invoices box was ticked and the canonical row ' +
        `still reads auto_invoice=${row.auto_invoice}${dumpWire(wire)}`).toBe(true);
      changes.push('auto-invoice ARMED on service line 01');

      // ⚠ AND THEN TURNED BACK OFF, DELIBERATELY, AND THE REPORT SAYS SO.
      // `POST /cron/billing` runs `sweep_client_auto_invoices()` with NO org
      // argument — a nightly sweep is for everybody — so a line left armed here
      // would raise an unattended TAX INVOICE with a serial drawn from a live
      // sequence at the next tick. Whether this programme wants that first
      // `client_invoice_lines` row is a decision for the lead, not for a suite:
      // arming it is a data change to live rows and those are raised first.
      m = await openLineEditor(p, serviceLineDesc(1));
      await setCheckbox(m.locator('input[type="checkbox"]').first(), false);
      await saveModal(page, m, /\/v1\/ganit\/billing\/service-lines\//, 'pause auto-invoice');
      await settle(page);
      row = await lineByDesc(serviceLineDesc(1));
      expect(row.auto_invoice, 'the Auto-generate invoices box was unticked and the canonical ' +
        `row still reads auto_invoice=${row.auto_invoice} — a subscription that cannot be paused ` +
        `keeps billing a customer who asked it to stop${dumpWire(wire)}`).toBe(false);
      changes.push('auto-invoice PAUSED on service line 01');
    }

    // ── CHANGE 4 · THE MID-CYCLE DOWNGRADE ───────────────────────────────────
    {
      const p = await openTab(page, 'service-lines', 'service lines');
      const before = await lineByDesc(serviceLineDesc(2));
      const m = await openLineEditor(p, serviceLineDesc(2));
      await typeInto(mfld(m, 'Amount').locator('input.inp'), String(DOWNGRADE_AMOUNT));
      await saveModal(page, m, /\/v1\/ganit\/billing\/service-lines\//, 'mid-cycle downgrade');
      await settle(page);
      const after = await lineByDesc(serviceLineDesc(2));
      expect(Number(after.amount), `the amount was reduced to ${DOWNGRADE_AMOUNT} and the ` +
        `canonical row still reads ${after.amount}${dumpWire(wire)}`).toBe(DOWNGRADE_AMOUNT);
      // The constant, not the previous row: on a SECOND execution the line is
      // already downgraded and `before` equals the target, so comparing against
      // it would either pass vacuously or fail on a correct re-run. The fact
      // that matters is that the new figure is below what the line was SOLD at.
      expect(DOWNGRADE_AMOUNT, 'a downgrade must be below the original subscription amount')
        .toBeLessThan(SERVICE_LINE_AMOUNT[1]);
      changes.push(`downgrade ₹${before.amount} → ₹${DOWNGRADE_AMOUNT} on service line 02`);

      // ⚠ NO CREDIT AND NO CHARGE ARE QUOTED, AND THAT IS §10's ACTUAL WORDS.
      //
      // §10 asks for a "mid-cycle downgrade quoting credit and charge over the
      // same days". `services/proration.py::plan_change_lines` computes exactly
      // that pair — but its only caller is `routers/subscription.py`, the
      // PLATFORM subscription, behind `require_platform_role`. On the CLIENT
      // side an amount change is a bare UPDATE: nothing prorates the days
      // already served, nothing credits them, and the customer's next invoice
      // simply carries the new figure for the whole period. That is stated
      // here rather than asserted, because it is a missing capability and not a
      // broken one — a scoping question for the lead, per §7's "the fix is
      // large" row.
      const preview = await apiGet(page, '/api/v1/ganit/billing/quota-proration' +
        '?target=100000&start_date=2026-08-01&end_date=2026-09-01&join_date=2026-08-15');
      console.log(`\n  17.04 — mid-cycle proration: the client-billing module has no credit/charge ` +
        `engine. The only proration route it publishes is /quota-proration, which prorates a ` +
        `SALES QUOTA, not a subscription — it answered ${preview.status()} and is reported for ` +
        'completeness. `services/proration.py` (the real one) is reachable only through ' +
        'routers/subscription.py, behind require_platform_role — Suite 19.\n');
    }

    // ── CHANGE 5 · END THE LINE ──────────────────────────────────────────────
    //
    // The date is YESTERDAY, not a date inside the term. `ServiceLinesTab`
    // splits Active from Ended on `new Date(period_end) > new Date()`, so an end
    // date in the future leaves the line in the Active table and the "Ended"
    // section never appears — a suite that used a future date would assert a
    // section that legitimately should not exist and report a defect that is
    // its own arithmetic.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    {
      const p = await openTab(page, 'service-lines', 'service lines');
      const already = await lineByDesc(serviceLineDesc(3));
      if (!already.period_end) {
        const m = await openLineEditor(p, serviceLineDesc(3));
        await setDate(m, /Period End/, yesterday);
        await saveModal(page, m, /\/v1\/ganit\/billing\/service-lines\//, 'end the service line');
        await settle(page);
      }
      const after = await lineByDesc(serviceLineDesc(3));
      expect(String(after.period_end || ''), 'an end date was set and the canonical row still ' +
        `reads period_end=${after.period_end}${dumpWire(wire)}`).toBeTruthy();
      expect(new Date(String(after.period_end)).getTime(), 'the end date must be in the past for ' +
        'the line to read as ended').toBeLessThan(Date.now());
      changes.push(`service line 03 ENDED on ${after.period_end}`);

      // The ended line must move to its own dimmed table, or a person reading
      // "Active" is reading a subscription that has stopped.
      const ended = p.locator('h3.gn-section-head', { hasText: /^Ended/ });
      await expect(ended, 'a service line was given an end date in the past and the screen still ' +
        'shows no Ended section — the Active table is now lying about what is being billed')
        .toBeVisible({ timeout: 30_000 });
    }

    expect(changes.length, `§4 asks for ${N_SUB_CHANGES} subscription changes and this run made ` +
      `${changes.length}`).toBe(N_SUB_CHANGES);
    console.log('\n  17.04 — the five subscription changes:\n     ' + changes.join('\n     ') + '\n');

    // ── AND NOW THE RESUME, WHICH IS THE ONE THAT DOES NOT WORK ──────────────
    //
    // ⚠ EXPECTED TO FAIL, TWICE OVER, AND BOTH FAILURES ARE THE PRODUCT'S.
    //
    // A subscription that can be paused and not resumed is not a subscription.
    // Ending a line writes `period_end`; resuming it means clearing that date,
    // and the Period End DateInput offers a real Clear button to do it with.
    // What happens then:
    //
    //   ServiceLinesTab.save()      → { period_end: form.period_end || null }
    //   ServiceLineUpdate           → plain BaseModel, `period_end: str | None`
    //   update_service_line         → `if val is not None:` — the null is DROPPED
    //
    // So the request is a 200, the toast says "Service line updated", the row is
    // unchanged, and the only way to bill that customer again is to create a
    // second service line and lose the first one's history. `_NullMeansUnset`
    // fixed exactly this asymmetry on the CREATE models; on the UPDATE models a
    // null is the only spelling of "remove this value" and it still means
    // "leave it alone".
    //
    // Before that can even be reached there is a second wall: the ENDED table
    // renders no Edit control at all. `COLUMNS_ENDED` is Client · Description ·
    // Amount · Period and nothing else (`ServiceLinesTab.jsx:29-34`), so a line
    // that has ended cannot be OPENED from the screen it is drawn on.
    //
    // `expect.soft` on the first, so the second is still exercised when the door
    // is there and the run still ends RED when it is not. This is not a skip —
    // the failure is recorded either way, and where the door is genuinely
    // missing the report says the resume could not be attempted rather than
    // implying it was tried and passed.
    {
      const p = await openTab(page, 'service-lines', 'service lines');
      await expect(p.locator('h3.gn-section-head', { hasText: /^Ended/ })).toBeVisible();
      const tr = p.locator('tbody tr').filter({ hasText: serviceLineDesc(3) }).first();
      await expect(tr, `${serviceLineDesc(3)} is not on the screen`).toBeVisible();

      const editable = await tr.getByRole('button', { name: /^Edit$/ }).count();
      expect.soft(editable, 'THE ENDED SERVICE-LINES TABLE HAS NO EDIT CONTROL. A subscription ' +
        'that has been paused cannot be reopened from the screen that shows it: `COLUMNS_ENDED` ' +
        'in ServiceLinesTab.jsx is Client · Description · Amount · Period, with no action cell. ' +
        'Ending a line is therefore a one-way door in the UI as well as in the API.')
        .toBeGreaterThan(0);

      if (editable > 0) {
        // ── THE RESUME IS DRIVEN FROM THE ENDED ROW'S OWN "Resume" BUTTON ────
        //
        // ⚠ CHANGED 2026-08-29, AND THE REASON IS A SECOND PRODUCT DEFECT, NOT
        //   A CONVENIENCE.
        //
        // This block used to open the editor and press the Period End picker's
        // Clear. **That button cannot be clicked, by a test or by a person.**
        // Measured in a real browser at 1280×720 on this exact modal:
        //
        //     modal panel   y 203 → 517  (.modal__panel overflow:hidden,
        //                                 .modal__body overflow:auto)
        //     date popover  y  65 → 381  ('pk__pop pk__pop--up')
        //     Clear button  y 106 → 133  — ABOVE the panel, outside both clips
        //     document.elementFromPoint(centre) → div.modal__scrim
        //
        // The popover is 316px tall against a 314px panel, so it does not fit
        // below, flips up, and lands in a region its clipping ancestors do not
        // paint. Playwright reported `<div class="modal__scrim"> intercepts
        // pointer events` forty times before timing out — and a person clicking
        // there closes the modal. It is a defect in the SHARED picker
        // (`ui/DateInput.jsx` positions the popover absolutely inside a clipped
        // container rather than portalling it), it reaches every DateInput in
        // any modal shorter than the popover, and it is REPORTED SEPARATELY
        // rather than fixed from a billing suite.
        //
        // So the product grew the affordance §10 actually asks for — "pause;
        // resume" — and this drives it. The claim under test is unchanged: a
        // paused subscription can be put back into billing, proved by
        // `period_end` reaching null on the canonical row.
        const resumeBtn = tr.getByRole('button', { name: /^Resume$/ });
        await expect(resumeBtn, 'the ended service line offers no Resume control, and the ' +
          "Period End picker's Clear cannot be clicked inside the modal (see above), so a " +
          'paused subscription cannot be put back into billing by any route a person has')
          .toBeVisible({ timeout: 30_000 });
        const res = await saveAndWait(page, async () => {
          await resumeBtn.click();
        }, /\/v1\/ganit\/billing\/service-lines\//, 'RESUME — clear the end date',
          { methods: ['PATCH'], allowError: true });
        await settle(page);

        const after = await lineByDesc(serviceLineDesc(3));
        expect(after.period_end, 'RESUME IS A SILENT NO-OP. The Period End date was cleared ' +
          `through the product's own Clear button, the server answered ${res.status}, the screen ` +
          `reported success — and the canonical row still reads period_end=${after.period_end}. ` +
          '`update_service_line` (client_billing.py:530-537) applies a field only `if val is not ' +
          'None`, and `period_end: form.period_end || null` is the ONLY way the form can say ' +
          '"there is no end date". A paused subscription therefore cannot be resumed at all.' +
          dumpWire(wire)).toBeNull();

        // The screen must agree: a resumed line belongs in Active, not Ended.
        // A row that reads as running on the wire and as stopped on the screen
        // is the same lie in the other direction.
        await settle(page);
        // Scoped to the ACTIVE section's own table, not to the panel: both
        // tables carry a row with this description while the move is what is
        // being asserted. `DataTable` renders `div.tbl__wrap > table`
        // (`components/ui/Table.jsx:17`), so the section's table is the h3's
        // next such sibling.
        const activeTable = p.locator('h3.gn-section-head', { hasText: /^Active/ })
          .locator('xpath=following-sibling::div[contains(@class,"tbl__wrap")][1]');
        await expect(activeTable.locator('tbody tr').filter({ hasText: serviceLineDesc(3) }),
          'the end date was cleared, the canonical row reads period_end=null, and the line is ' +
          'still not in the Active table — the customer is being billed again and the screen ' +
          'says they are not').toHaveCount(1, { timeout: 30_000 });

        // ── AND END IT AGAIN, BECAUSE THE RESUME IS A SIXTH CHANGE ────────────
        //
        // ⚠ ADDED 2026-08-29 WHEN THE RESUME WAS MADE TO WORK.
        //
        // §4 asks for FIVE subscription changes and 17.11 checks each one by
        // the STATE it left behind — for line 03 that state is "ended, in the
        // past". The resume above is a sixth change and it deliberately undoes
        // the fifth. While it was a no-op that cost nothing; the moment it
        // works, 17.11's `subscription changes still evidenced` drops to 4 and
        // goes red on a transition the suite itself reversed.
        //
        // That is a defect in the suite, not in the product, so the fixture is
        // restored rather than the count lowered. Both facts survive: the
        // resume is proved by `period_end` reaching null above, and the five
        // changes are still evidenced afterwards.
        const back = p.locator('tbody tr').filter({ hasText: serviceLineDesc(3) }).first();
        await back.getByRole('button', { name: /^Edit$/ }).click();
        const m2 = await inModal(page, /Edit Service Line/);
        await setDate(m2, /Period End/, yesterday);
        await saveModal(page, m2, /\/v1\/ganit\/billing\/service-lines\//,
          're-end service line 03 after proving the resume');
        await settle(page);
        const reEnded = await lineByDesc(serviceLineDesc(3));
        expect(String(reEnded.period_end || ''), 'service line 03 was re-ended after the resume ' +
          'probe and the canonical row carries no end date').toBeTruthy();
        console.log('\n  17.04 — ✅ RESUME WORKS: the end date was cleared through the Ended ' +
          "row's own Resume control, the canonical row read period_end=null, and the line " +
          'moved back into Active. It was then re-ended so the five changes above stay ' +
          "evidenced for 17.11. (NOT through the date picker's Clear — that button is " +
          'unclickable inside this modal; see the note above.)\n');
      } else {
        console.log('\n  17.04 — RESUME COULD NOT BE ATTEMPTED: the Ended table offers no Edit ' +
          'control, so the clear-the-end-date path is unreachable from the product. The API-side ' +
          'no-op documented above is therefore unproven BY THIS RUN and is reported as read ' +
          'from the source, not as measured.\n');
      }
    }

    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 17.05 · SURFACE 4 — THE FIX UNDER TEST: a rate card with an EMPTY note
  // ──────────────────────────────────────────────────────────────────────────
  test('17.05 three vendor rate cards, two of them with the Notes box left empty', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const vendors = await apiRows(page, '/api/v1/ganit/vendors');
    expect(vendors.length, 'no suppliers exist, so no price list can be locked in — ' +
      'Suite 05 (vendors) must run first').toBeGreaterThanOrEqual(N_RATE_CARDS);
    const vendorName = (n: number) => String(vendors[(n - 1) % vendors.length].name);

    const p = await openTab(page, 'rate-cards', 'rate cards');
    const present = marksOf(await rateCards(page), 'item_category');

    /**
     * ⚠ THE NOTES BOX IS DELIBERATELY LEFT EMPTY ON CARDS 01 AND 02.
     *
     * Before `_NullMeansUnset` (deployed in c52651f2, 2026-08-29 05:13 UTC)
     * this exact sequence answered:
     *
     *   POST /api/v1/ganit/billing/rate-cards → 422
     *   {"detail":[{"type":"string_type","loc":["body","notes"],
     *               "msg":"Input should be a valid string","input":null}]}
     *
     * because `RateCardsTab.save()` sends `notes: form.notes || null` — the
     * ordinary JavaScript spelling of "the box is empty" — and
     * `RateCardCreate.notes` was `str = ""`. Rate cards stood at 0 of 3 on this
     * org while every other Ganit volume filled, and the screen said only
     * "Failed to save".
     *
     * Card 03 carries a note so the two paths are compared in one run. The
     * assertion below counts the cards whose canonical `notes` is genuinely
     * empty and requires exactly two, which is what stops this test from being
     * made to pass by typing something into the box.
     */
    /**
     * Typing ONE rate card, hoisted out of `ensure` so the delete probe below
     * can put back what it removes. See the restore step at the end of this
     * test for why that matters.
     */
    const typeCard = async (n: number) => {
        await p.getByRole('button', { name: /^\+ Rate Card$/ }).first().click();
        const m = await inModal(page, /Rate Card/);
        await pickByLabel(mfld(m, 'Vendor').locator('select.inp'), vendorName(n), 'vendor');
        await typeInto(mfld(m, 'Item Category').locator('input.inp'), rateCardCategory(n));
        await typeInto(mfld(m, 'Rate').locator('input.inp'), String(1250 * n));
        await typeInto(mfld(m, 'Unit').locator('input.inp'), ['hours', 'units', 'kg'][n - 1]);
        await setDate(m, /Effective From/, `2026-08-0${n}`);
        await setDate(m, /Effective To/, `2027-07-0${n}`);
        // The proration clause: a real field on a real price list, and the only
        // thing in this module that even mentions proration.
        if (n === 2) {
          await setCheckbox(m.locator('input[type="checkbox"]').first(), true);
        }
        if (n === 3) {
          await typeInto(mfld(m, 'Notes').locator('textarea.inp'),
            `${TAG} negotiated ${RUN}`);
        }
        await saveModal(page, m, /\/v1\/ganit\/billing\/rate-cards$/,
          n === 3 ? 'rate card 03 — WITH a note'
                  : `rate card ${pad(n)} — with the Notes box LEFT EMPTY, which is the ` +
                    'ordinary case for a price list and was a 422 for its entire life');
        await settle(page);
    };

    const { typed, found } = await ensure([1, 2, 3], present, rateCardCategory, typeCard);

    const cards = mine(await rateCards(page), 'item_category');
    expect(cards.length, `wanted ${N_RATE_CARDS} S17 rate cards, the list holds ${cards.length}. ` +
      'A shortfall here is the empty-Notes 422 back again — the whole reason this suite exists.' +
      dumpWire(wire)).toBe(N_RATE_CARDS);

    const blank = cards.filter((c) => !String(c.notes ?? '').trim());
    expect(blank.length, `${N_BLANK_NOTES} of the ${N_RATE_CARDS} rate cards were typed with the ` +
      `Notes box empty and ${blank.length} came back with no note. If this is short, either the ` +
      'refusal is back or somebody typed a note to make the test pass — both are failures and ' +
      'the second is the worse one.').toBe(N_BLANK_NOTES);

    const prorated = cards.filter((c) => c.proration_clause === true);
    expect(prorated.length, 'the proration clause was ticked on exactly one card and the ' +
      `canonical rows report ${prorated.length}`).toBe(1);
    for (const c of cards) {
      expect(Number(c.rate), `${c.item_category} locks in no rate, so it prices nothing`)
        .toBeGreaterThan(0);
      expect(String(c.vendor_name || ''), `${c.item_category} names no supplier`).not.toBe('');
    }

    console.log(`\n  17.05 — rate cards: ${typed} typed, ${found} already present; ` +
      `${blank.length} of ${cards.length} carry NO note.\n` +
      '     ✅ A RATE CARD WITH AN EMPTY NOTES BOX NOW SAVES.\n');

    // ── AND THE DELETE BUTTON, WHICH HAS NO ROUTE BEHIND IT ─────────────────
    //
    // ⚠ EXPECTED TO FAIL, AND THE FAILURE IS THE PRODUCT'S.
    //
    // `RateCardsTab.jsx:83` calls `DELETE /v1/ganit/billing/rate-cards/{id}`.
    // Read out of the DEPLOYED OpenAPI on 2026-08-29, that path publishes
    // **PATCH only** — so the path resolves, the verb does not, and FastAPI
    // answers 405. A mistyped price list is permanent.
    //
    // The card deleted is 03 — the one carrying a note — so a run where the
    // route DOES appear leaves the two blank-note cards, which are the evidence
    // this suite exists for, untouched.
    {
      const doomed = cards.find((c) => String(c.item_category) === rateCardCategory(3));
      expect(doomed, 'rate card 03 is missing').toBeTruthy();
      const tr = p.locator('tbody tr').filter({ hasText: rateCardCategory(3) }).first();
      await expect(tr, 'rate card 03 is not on the screen').toBeVisible({ timeout: 30_000 });
      await tr.getByRole('button', { name: /^Delete$/ }).click();
      const confirm = page.getByRole('alertdialog');
      await expect(confirm, 'the Delete button opened no confirmation').toBeVisible();

      const res = await saveAndWait(page, async () => {
        await confirm.getByRole('button', { name: /^Delete$/ }).click();
      }, /\/v1\/ganit\/billing\/rate-cards\//, 'delete a rate card',
        { methods: ['DELETE'], allowError: true });

      const text = res.status >= 400 ? await errorToast(page) : '';
      if (text) assertActionable(text, 'rate-card delete');
      expect(res.status, 'THE DELETE BUTTON ON A RATE CARD HAS NO ROUTE BEHIND IT. ' +
        `DELETE /v1/ganit/billing/rate-cards/{id} answered ${res.status}; the deployed OpenAPI ` +
        'publishes PATCH and nothing else for that path (measured 2026-08-29). The screen ' +
        `reported "${text}", which a customer can do nothing with. Every other list in this ` +
        'module can undo a mistyped row; a supplier price list cannot.' + dumpWire(wire))
        .toBeLessThan(400);

      // The row really left, and that is the half a 2xx does not prove.
      await settle(page);
      expect(mine(await rateCards(page), 'item_category')
        .map((c) => String(c.item_category)),
        'the delete answered 2xx and the canonical list still holds rate card 03 — a success ' +
        'status is the server\'s opinion, the row is the evidence')
        .not.toContain(rateCardCategory(3));

      // ── AND PUT IT BACK, BECAUSE THE PROBE IS DESTRUCTIVE AND §4 IS NOT ────
      //
      // ⚠ ADDED 2026-08-29 WHEN THE DELETE WAS GIVEN ITS ROUTE, AND THE REASON
      // IS WORTH READING BEFORE ANYONE REMOVES IT.
      //
      // While the verb 405'd, this probe changed nothing and card 03 survived,
      // so 17.11's `rate cards: 3` held. The moment the route works, the probe
      // leaves the org on TWO — and 17.11 would go red on a §4 volume that the
      // suite itself had just spent. That is a defect in the suite, not in the
      // product, and the honest repair is to restore the fixture rather than
      // to lower the count: the org still ends the run with the three rate
      // cards §4 asks for, and the delete is still proved by a 2xx and by the
      // row's absence above.
      //
      // It is also what makes THIS test idempotent on its own terms — run
      // twice, `ensure` finds three, the probe removes one and types it back,
      // and the count is three at the end of both executions.
      //
      // Card 03 is the one carrying a note, so re-typing it restores
      // `blank.length === 2` as well as the total.
      await typeCard(3);
      await settle(page);
      const restored = mine(await rateCards(page), 'item_category');
      expect(restored.length, 'rate card 03 was deleted to prove the route and did not come ' +
        `back: the list holds ${restored.length}. §4 asks this org to end the run with ` +
        `${N_RATE_CARDS} rate cards.`).toBe(N_RATE_CARDS);
      expect(restored.filter((c) => !String(c.notes ?? '').trim()).length,
        'the restore changed how many cards carry no note').toBe(N_BLANK_NOTES);
      console.log('\n  17.05 — rate card 03 was DELETED (route proved) and typed back, so the ' +
        `org ends on ${restored.length} and §4 is not spent by the probe.\n`);
    }

    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 17.06 · SURFACE 5 — metered usage, BY SOURCE, and the invoiced gate
  // ──────────────────────────────────────────────────────────────────────────
  test('17.06 six usage entries are metered, each naming the source it came from', async ({ page }) => {
    test.setTimeout(45 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const home = await homeStateCode(page);
    const target = await billingTargets(page, home);
    expect((await profiles(page)).length, '17.02 must run first — usage is metered against a profile')
      .toBeGreaterThan(0);

    const p = await openTab(page, 'metered-usage', 'metered usage');
    const present = marksOf(await usageRows(page), 'metric');

    // 01–03 on the intra-state customer, 04–06 on the inter-state one: two
    // groups on screen, and the two billing cycles of 17.07.
    const usageClient = (n: number) => (n <= 3 ? target.intra.name : target.inter.name);

    const { typed, found } = await ensure(
      [1, 2, 3, 4, 5, 6], present, usageMetric,
      async (n) => {
        await p.getByRole('button', { name: /^\+ Usage Entry$/ }).first().click();
        const m = await inModal(page, /Usage Entry/);
        await pickByLabel(mfld(m, 'Billing Profile').locator('select.inp'),
          usageClient(n), 'billing profile');
        await typeInto(mfld(m, 'Metric').locator('input.inp'), usageMetric(n));
        await typeInto(mfld(m, 'Quantity').locator('input.inp'), String(4 + n));
        await typeInto(mfld(m, 'Unit').locator('input.inp'), 'hours');
        await typeInto(mfld(m, 'Rate').locator('input.inp'), String(1100 + n * 50));
        await setDate(m, /^Date/, `2026-08-${pad(((n - 1) % 27) + 1)}`);
        // §10's "usage by source". Every row says where it came from, so a
        // customer disputing a line can be shown the timesheet behind it.
        await typeInto(mfld(m, 'Source Reference').locator('input.inp'), usageSource(n));
        await saveModal(page, m, /\/v1\/ganit\/billing\/metered-usage$/, `usage ${n}`);
        await settle(page);
      },
    );

    const rows = mine(await usageRows(page), 'metric');
    expect(rows.length, `wanted ${N_USAGE} S17 usage rows, the list holds ${rows.length}` +
      dumpWire(wire)).toBe(N_USAGE);
    for (const r of rows) {
      expect(Number(r.quantity), `${r.metric} records no quantity`).toBeGreaterThan(0);
      expect(Number(r.rate), `${r.metric} carries no rate, so it can never be billed`)
        .toBeGreaterThan(0);
      expect(String(r.source_ref || ''), `${r.metric} names no source, so a disputed line on the ` +
        'invoice traces back to nothing').not.toBe('');
    }

    // BY SOURCE — the sources are distinct, so a row can be traced to one
    // timesheet rather than to a category.
    const sources = new Set(rows.map((r) => String(r.source_ref)));
    expect(sources.size, `${N_USAGE} usage rows carry only ${sources.size} distinct sources`)
      .toBe(N_USAGE);

    // The screen's own three-way filter. Each is a REFETCH, not a client-side
    // slice (`load()` is keyed on `filter`), so each is a real server round trip
    // and a broken one shows up here rather than in a report six weeks later.
    const filter = p.locator('select.gn-bar__sel').first();
    for (const [value, label] of [['invoiced', 'Invoiced'], ['all', 'All'], ['unbilled', 'Unbilled']]) {
      await filter.selectOption(value);
      await settle(page);
      await expect(p, `the "${label}" usage filter left the panel unrendered`)
        .toBeVisible({ timeout: 30_000 });
    }

    console.log(`\n  17.06 — metered usage: ${typed} typed, ${found} already present; ` +
      `${sources.size} distinct sources\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 17.07 · SURFACE 6 — the billing cycle, run twice, and what it mints
  // ──────────────────────────────────────────────────────────────────────────
  test('17.07 two billing cycles run, the GST split follows the state pair, and neither invoice can be issued', async ({ page }) => {
    test.setTimeout(45 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const home = await homeStateCode(page);
    const target = await billingTargets(page, home);
    // ── THE FIRM'S OWN DOCUMENT SERIES ──────────────────────────────────────
    //
    // ⚠ THIS READ WAS WRONG AND THE ASSERTION BELOW HAD NEVER ONCE RUN.
    //   Corrected 2026-08-29.
    //
    // It was `(await apiOne(page, '/api/v1/org/profile'))?.settings?.
    // doc_prefixes?.tax_invoice`, and **`GET /api/v1/org/profile` does not
    // return a `settings` key at all** — measured live: 'settings' in body is
    // false. So `series` was always `''`, the `if (series)` below was always
    // false, and the numbering check the header describes at length was a
    // vacuous assertion that passed for ever. It is exactly the failure mode
    // this file's own trap list names ("A vacuous assertion passes for ever").
    //
    // The prefix has a route of its own — `GET /api/v1/org/profile/doc-prefixes`
    // — which answers `{invoice_type, prefix, default, effective}` per type.
    // `effective` is the one to read: it is the org's override where there is
    // one and the built-in where there is not, which is precisely what
    // `ganit._doc_prefix` resolves server-side.
    const prefixRows = await apiRows(page, '/api/v1/org/profile/doc-prefixes');
    const taxRow = prefixRows.find((r) => String(r.invoice_type) === 'tax_invoice');
    expect(taxRow, 'GET /api/v1/org/profile/doc-prefixes returned no tax_invoice row, so this ' +
      'firm\'s invoice series cannot be read and the numbering check below cannot run — ' +
      'which is the state it was silently in until 2026-08-29').toBeTruthy();
    const series = String(taxRow.effective || '').trim().toUpperCase();
    expect(series, 'the tax-invoice series resolved to an empty string').not.toBe('');

    const p = await openTab(page, 'metered-usage', 'metered usage');
    await p.locator('select.gn-bar__sel').first().selectOption('unbilled');
    await settle(page);

    /**
     * The Generate control for ONE customer's group.
     *
     * `MeteredUsageTab` groups rows by profile and puts a Generate Invoice
     * button in each group's own `.gn-bar`. ⚠ It is NOT addressable by the
     * table's label: `DataTable` takes `{ columns, children, arrange }` and
     * DROPS the `label` prop entirely (`ModuleUI.jsx:171`), so
     * `<DataTable label="Usage: Acme">` renders a table with no accessible name.
     * The group is found from its heading and the bar above it instead.
     */
    const generateFor = (client: string) =>
      p.locator('h3.gn-section-head', { hasText: client }).first()
        .locator('xpath=ancestor::div[contains(@class,"gn-bar")][1]')
        .getByRole('button', { name: /Generate Invoice|Generating/ });

    const cycles: { client: string; number: string; total: number }[] = [];
    let ran = 0;

    for (const t of [target.intra, target.inter]) {
      const unbilled = mine(await usageRows(page), 'metric')
        .filter((r) => String(r.client_name) === t.name && !r.invoiced);

      if (!unbilled.length) {
        // §6 — a second execution recognises its own output. Nothing unbilled
        // means this cycle already ran; the Generate control must be GONE, and
        // that absence IS the product's double-billing guard working.
        await expect(generateFor(t.name), `${t.name} has no unbilled usage and the screen still ` +
          'offers Generate Invoice — pressing it would raise a second tax invoice for supplies ' +
          'already billed').toHaveCount(0);
        continue;
      }

      const btn = generateFor(t.name);
      await expect(btn, `${t.name} has ${unbilled.length} unbilled usage rows and the screen ` +
        'offers no Generate Invoice control — there is no way to bill them at all')
        .toBeVisible({ timeout: 30_000 });

      const res = await saveAndWait(page, async () => { await btn.click(); },
        /\/v1\/ganit\/billing\/metered-usage\/generate-invoice$/,
        `billing cycle for ${t.name}`, { methods: ['POST'] });
      await settle(page);
      ran++;

      // Rule 2 — read the WRITE RESPONSE, not the list. Then rule 3 — fetch the
      // CANONICAL row, because a POST echoes five fields and asserting on the
      // response turns every other one into NaN.
      expect(res.json?.invoice_number, `the generate response carried no invoice number: ` +
        `${res.body.slice(0, 200)}`).toBeTruthy();
      cycles.push({
        client: t.name,
        number: String(res.json.invoice_number),
        total: Number(res.json.total),
      });

      // And the usage rows must be marked, or the next run bills them again.
      const after = mine(await usageRows(page), 'metric')
        .filter((r) => String(r.client_name) === t.name);
      const stillOpen = after.filter((r) => !r.invoiced);
      expect(stillOpen.map((r) => r.metric), `${t.name}: the cycle ran and ` +
        `${stillOpen.length} usage rows are still marked unbilled, so the next cycle would ` +
        'bill the same supplies twice' + dumpWire(wire)).toEqual([]);

      // The guard, seen on screen: nothing unbilled, no button.
      await expect(generateFor(t.name), `${t.name}: the cycle ran and the Generate Invoice ` +
        'control is still offered').toHaveCount(0);
    }

    // ── WHAT THE CYCLE ACTUALLY MINTED ───────────────────────────────────────
    const invoices = await generatedUsageInvoices(page);
    const forClient = (name: string) =>
      invoices.find((i) => String(i.notes || '') === `Metered usage invoice for ${name}`);

    for (const t of [target.intra, target.inter]) {
      const inv = forClient(t.name);
      expect(inv, `no generated invoice exists for ${t.name}${dumpWire(wire)}`).toBeTruthy();

      // s.7/s.8 IGST Act, derived from the pair rather than named.
      const igst = Number(inv.igst || 0);
      const cgst = Number(inv.cgst || 0);
      const sgst = Number(inv.sgst || 0);
      const got = igst > 0 && cgst === 0 && sgst === 0 ? 'IGST'
        : cgst > 0 && sgst > 0 && igst === 0 ? 'CGST+SGST' : `neither (${cgst}/${sgst}/${igst})`;
      expect(got, `${t.name}: place of supply ${t.pos} against a supplier in ${home} is a ` +
        `${t.split} supply and the invoice was taxed ${got}. One supply cannot be taxed both ` +
        'ways, and a wrongly-taxed document that has gone into a GSTR-1 is not recoverable in ' +
        'a minute the way an uninvoiced period is.').toBe(t.split);
      expect(cgst === 0 || Math.abs(cgst - sgst) < 0.01, `${t.name}: CGST ₹${cgst} and SGST ` +
        `₹${sgst} must be equal halves`).toBeTruthy();

      // The body of the document. A tax invoice with an empty `line_items` is
      // a total with nothing explaining it — the customer opens the pay link
      // and sees a figure and no particulars.
      const items = Array.isArray(inv.line_items) ? inv.line_items
        : JSON.parse(String(inv.line_items || '[]'));
      expect(items.length, `${t.name}: the generated invoice has NO line items, so it states a ` +
        'total and no supply. Rule 46(f)–(j) are the particulars of each line.').toBeGreaterThan(0);
      for (const li of items) {
        expect(String(li.description || ''), 'a line with no description').not.toBe('');
        expect(Number(li.gst_rate), 'a line with no GST rate — `ganit_invoices` has no gst_rate ' +
          'column, so the rate has nowhere else to live and pay.py reads it from here')
          .toBeGreaterThan(0);
      }

      // `balance_due` DEFAULTS to 0: an invoice that omits it reads as FULLY
      // PAID against a non-zero total — invisible in receivables and ₹0 on the
      // customer's payment link.
      expect(Number(inv.balance_due), `${t.name}: the invoice totals ₹${inv.total} and its ` +
        `balance due is ₹${inv.balance_due}`).toBeCloseTo(Number(inv.total), 2);
      // There is no payment gateway and never will be: a freshly raised
      // document is unpaid until a bank statement says otherwise.
      expect(String(inv.payment_status), `${t.name}: a newly generated invoice reads ` +
        `"${inv.payment_status}". "Paid" only ever comes from bank reconciliation.`).toBe('unpaid');
      // A draft, explicitly — `doc_status` DEFAULTS to 'final', so this is a
      // real decision and not an omission.
      //
      // ⚠ ONLY FOR AN INVOICE THIS EXECUTION MINTED, AND THAT MATTERS FROM
      // 2026-08-29. This suite ISSUES the intra-state invoice at the end of
      // this test, and `draft → final` is one-way, so on a second execution
      // the flat assertion would fail on a document the suite itself advanced
      // — a red on correct behaviour, which is how people learn to edit tests.
      // Born-as-draft is still asserted, on the run that does the borning; a
      // pre-existing one is held to the weaker, still-real rule that it can
      // only be somewhere DOWNSTREAM of draft and never somewhere impossible.
      if (cycles.some((c) => c.number === String(inv.invoice_number))) {
        expect(String(inv.doc_status), `${t.name}: the invoice this run generated is ` +
          `"${inv.doc_status}". It must be born a draft — nobody has reviewed it, and ` +
          '`doc_status` DEFAULTS to \'final\', so a draft here is a real decision.')
          .toBe('draft');
      } else {
        expect(['draft', 'final', 'sent', 'viewed'], `${t.name}: ${inv.invoice_number} reads ` +
          `doc_status="${inv.doc_status}", which is not a state this document can be in`)
          .toContain(String(inv.doc_status));
      }
    }

    console.log(`\n  17.07 — billing cycles run this execution: ${ran} (§4 wants ${N_CYCLES} in ` +
      `total). Invoices generated: ${invoices.length}\n` +
      cycles.map((c) => `     ${c.client}: ${c.number}  ₹${c.total}`).join('\n') + '\n');

    // ── THE SERIAL, AND WHOSE SERIES IT BELONGS TO ───────────────────────────
    //
    // ⚠ EXPECTED TO FAIL, AND THE FAILURE IS THE PRODUCT'S.
    //
    // `ganit.py` resolves the document prefix PER ORG (`_doc_prefix`, reading
    // `organisations.settings->'doc_prefixes'`), which is why every invoice this
    // firm has raised by hand is `UNX-2026-nnnn`. Both client-billing writers —
    // `generate_usage_invoice` and `sweep_client_auto_invoices` — hardcode
    // `"INV"` instead. And `next_doc_number` takes the last number for the org
    // WHATEVER its prefix and adds one, so the two series interleave their
    // numbering while disagreeing about their name. Rule 46(b) asks for one
    // consecutive serial per financial year.
    // ⚠ ASSERTED ON WHAT THIS EXECUTION MINTED, AND REPORTED ON THE REST.
    //
    // The fix makes every FUTURE generated invoice carry the org's series; it
    // cannot re-number one already minted, and re-numbering issued tax
    // documents is a data change to live rows, which is the lead's call and
    // not a suite's. So the assertion is scoped to this run's own output —
    // where it bites — and any historical stray is NAMED in the log rather
    // than either failing for ever or passing silently.
    const mintedNow = new Set(cycles.map((c) => c.number));
    const strayNow = [...mintedNow].filter((n) => !n.startsWith(`${series}-`));
    expect(strayNow,
      `THE BILLING CYCLE NUMBERS ITSELF OUTSIDE THE FIRM'S OWN SERIES. This organisation's ` +
      `configured tax-invoice prefix is "${series}" and every invoice it raises by hand is ` +
      `${series}-YYYY-NNNN, but this run generated the numbers above. ` +
      '`client_billing.py` must draw the prefix from `ganit._doc_prefix`, not the literal "INV" ' +
      '— `next_doc_number` increments the last number for the org whatever its prefix, so two ' +
      'writers that disagree about the name share one counter and Rule 46(b) asks for one ' +
      'consecutive serial per financial year.').toEqual([]);

    const strayEver = invoices
      .filter((i) => !String(i.invoice_number).startsWith(`${series}-`))
      .map((i) => `${i.invoice_number} (${i.doc_status})`);
    console.log(`\n  17.07 — series "${series}": ${mintedNow.size} invoice(s) minted this run, ` +
      `${strayNow.length} outside the series.\n` +
      (strayEver.length
        ? `     ⚠ ${strayEver.length} generated invoice(s) from BEFORE the fix still carry the ` +
          `wrong prefix and cannot be re-numbered from here: ${strayEver.join(', ')}. ` +
          'Re-numbering an issued tax document is a data change to live rows — raised, not done.\n'
        : '     No generated invoice is outside the series.\n'));

    // ── AND THE DRAFT THAT CAN NEVER BE ISSUED ───────────────────────────────
    //
    // ⚠ EXPECTED TO FAIL, AND THE FAILURE IS THE PRODUCT'S.
    //
    // `generate_usage_invoice` writes `client_id` and NO `contact_id`.
    // `_refuse_final_if_incomplete` resolves the recipient only through
    // `contact_id`, so `validate_tax_invoice` receives `contact = {}` and
    // raises the Rule 46(e) "Recipient name" gap — which is BLOCKING. The
    // invoice NAMES a company; it names it in a column the validator never
    // reads. So the draft cannot be marked final, cannot be sent, cannot carry
    // a pay link, and cannot be paid.
    {
      const inv = forClient(target.intra.name);
      const ip = await openTab(page, 'invoices', 'invoices');
      const search = ip.locator('input.tv__input');
      await expect(search, 'the invoice register has no search box').toBeVisible({ timeout: 30_000 });
      await typeInto(search, String(inv.invoice_number));
      const link = ip.getByRole('button', { name: String(inv.invoice_number), exact: true });
      await expect(link, `${inv.invoice_number} is on the wire and not on the register`)
        .toBeVisible({ timeout: 30_000 });
      await link.click();
      const drawer = page.getByRole('dialog', { name: `Invoice ${inv.invoice_number}` });
      await expect(drawer, 'the record drawer did not open').toBeVisible({ timeout: 30_000 });

      // A draft carries no pay link, and the product says WHY in words — the
      // refusal a person can act on, rather than a missing button.
      // ── §6 — A SECOND EXECUTION VERIFIES RATHER THAN REPEATS ───────────────
      //
      // ⚠ ADDED 2026-08-29, WHEN MARKING FINAL STARTED WORKING.
      //
      // `draft → final` is a ONE-WAY transition (`allowed_transitions` in
      // `ganit.py` offers no way back), so once run 1 issues this invoice, run
      // 2 opens a document that is already final: no `.gnd__nolink`, no "Mark
      // final" button. While the transition was refused the question never
      // arose and the block was re-runnable by accident.
      //
      // The assertion is not weakened — it is the same fact read from the
      // state instead of from the transition. An invoice that reached `final`
      // is an invoice that could be issued, which is the whole claim; and on a
      // second run the evidence is stronger, because it survived a reload.
      const already = String(inv.doc_status) === 'final'
        || ['sent', 'viewed'].includes(String(inv.doc_status));
      if (already) {
        await expect(drawer.locator('.gnd__nolink'),
          `${inv.invoice_number} is "${inv.doc_status}" and the drawer still shows the ` +
          'no-payment-link notice a DRAFT gets').toHaveCount(0);
        console.log(`\n  17.07 — ${inv.invoice_number} was already issued by an earlier ` +
          `execution (doc_status="${inv.doc_status}"). A METERED-USAGE INVOICE CAN BE ISSUED, ` +
          'and this run verified it rather than repeating it — draft → final is one-way.\n');
        assertNoUncaught(con);
        return;
      }

      const blocker = drawer.locator('.gnd__nolink');
      await expect(blocker, 'a draft invoice offers no payment link and the drawer says nothing ' +
        'about why — a missing control with no sentence beside it reads as a broken screen')
        .toBeVisible();
      expect((await blocker.innerText()).toLowerCase(),
        'the no-link sentence does not mention the draft state').toContain('draft');

      const mark = drawer.getByRole('button', { name: /^Mark final$/ });
      await expect(mark, 'a draft invoice offers no way to issue it').toBeVisible();
      const res = await saveAndWait(page, async () => { await mark.click(); },
        /\/v1\/ganit\/invoices\/[^/]+\/status$/, 'mark the usage invoice final',
        { methods: ['PATCH'], allowError: true });
      const said = res.status >= 400 ? await errorToast(page) : '';
      if (said) assertActionable(said, 'mark-final on a metered-usage invoice');

      expect(res.status, 'A METERED-USAGE INVOICE CAN NEVER BE ISSUED. Marking it final answered ' +
        `${res.status} and the screen said "${said}". \`generate_usage_invoice\` writes ` +
        '`client_id` and no `contact_id`; `_refuse_final_if_incomplete` resolves the recipient ' +
        'only through `contact_id`, so `validate_tax_invoice` sees an empty contact and raises ' +
        'the Rule 46(e) "Recipient name" gap, which is BLOCKING. The invoice names a company — ' +
        'in a column the validator never reads. So this document is a permanent draft: it ' +
        'cannot be sent, cannot carry a pay link, and cannot be paid.' + dumpWire(wire))
        .toBeLessThan(400);
    }

    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 17.08 · SURFACE 7 — SLA credits: applied to a bill, and waived
  // ──────────────────────────────────────────────────────────────────────────
  test('17.08 an SLA credit is applied to a vendor bill and another is waived', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const vendors = await apiRows(page, '/api/v1/ganit/vendors');
    expect(vendors.length, 'no suppliers exist — Suite 05 (vendors) must run first')
      .toBeGreaterThanOrEqual(N_SLA);
    const bills = await apiRows(page, '/api/v1/ganit/vendor-bills');
    expect(bills.length, 'no vendor bills exist, so a credit has nothing to be applied to — ' +
      'Suite 05 (vendor bills) must run first').toBeGreaterThan(0);

    const p = await openTab(page, 'sla-credits', 'sla credits');
    const present = marksOf(await slaCredits(page), 'sla_metric');
    const cards = mine(await rateCards(page), 'item_category');

    const { typed, found } = await ensure(
      [1, 2], present, slaMetric,
      async (n) => {
        await p.getByRole('button', { name: /^\+ SLA Credit$/ }).first().click();
        const m = await inModal(page, 'New SLA Credit');
        await pickByLabel(mfld(m, 'Vendor').locator('select.inp'),
          String(vendors[(n - 1) % vendors.length].name), 'vendor');
        await typeInto(mfld(m, 'SLA Metric').locator('input.inp'), slaMetric(n));
        await typeInto(mfld(m, 'Threshold').locator('input.inp'), '99.5');
        // Below the threshold on purpose — a credit exists because the supplier
        // missed it, so an "actual" above it would be a credit with no cause.
        await typeInto(mfld(m, 'Actual').locator('input.inp'), String(96 + n * 0.5));
        await typeInto(mfld(m, 'Credit Amount').locator('input.inp'), String(7500 * n));
        await setDate(m, /Period/, `2026-08-0${n}`);
        if (cards.length >= n) {
          await pickByLabel(mfld(m, 'Rate Card').locator('select.inp'),
            rateCardCategory(n), 'rate card');
        }
        await saveModal(page, m, /\/v1\/ganit\/billing\/sla-credits$/, `SLA credit ${n}`);
        await settle(page);
      },
    );

    let rows = mine(await slaCredits(page), 'sla_metric');
    expect(rows.length, `wanted ${N_SLA} S17 SLA credits, the list holds ${rows.length}` +
      dumpWire(wire)).toBe(N_SLA);
    for (const r of rows) {
      expect(Number(r.actual), `${r.sla_metric}: a credit is owed because the actual fell BELOW ` +
        'the threshold, and this one did not').toBeLessThan(Number(r.threshold));
      expect(Number(r.credit_amount), `${r.sla_metric} credits nothing`).toBeGreaterThan(0);
    }

    // ── WAIVE ────────────────────────────────────────────────────────────────
    const two = rows.find((r) => String(r.sla_metric) === slaMetric(2));
    if (String(two.status) === 'pending') {
      const tr = p.locator('tbody tr').filter({ hasText: slaMetric(2) }).first();
      await tr.getByRole('button', { name: /^Waive$/ }).click();
      const confirm = page.getByRole('alertdialog');
      await expect(confirm, 'Waive opened no confirmation').toBeVisible();

      // ⚠ THE CONFIRM BUTTON OF A WAIVE SAYS "Delete". `SLACreditsTab` passes
      // `{ message, intent: 'warn' }` and no `confirmLabel`, and `ConfirmDialog`
      // defaults that to 'Delete' (`ConfirmDialog.jsx:82`). Waiving a credit is
      // not deleting it — the row survives with `status='waived'` — so the
      // dialog names an action the product does not take. Reported, and the
      // button is still pressed by the name it actually carries, because a
      // locator written against the intended text would fail as a MISSING
      // CONTROL, which is the wrong diagnosis entirely.
      const label = (await confirm.locator('.modal__foot button').last().innerText()).trim();
      console.log(`\n  17.08 — the Waive confirmation's action button reads "${label}"\n`);

      await saveAndWait(page, async () => {
        await confirm.locator('.modal__foot button').last().click();
      }, /\/v1\/ganit\/billing\/sla-credits\/[^/]+\/waive$/, 'waive an SLA credit',
        { methods: ['PATCH'] });
      await settle(page);
    }
    rows = mine(await slaCredits(page), 'sla_metric');
    expect(String(rows.find((r) => String(r.sla_metric) === slaMetric(2)).status),
      'the credit was waived and the canonical row does not say so' + dumpWire(wire)).toBe('waived');

    // ── APPLY, AND THE PICKER THAT IS NOT THERE ─────────────────────────────
    //
    // ⚠ EXPECTED TO FAIL, AND THE FAILURE IS THE PRODUCT'S.
    //
    // The Apply sheet is a single free-text box labelled "Bill ID"
    // (`SLACreditsTab.jsx:246-252`). It wants a vendor bill's UUID, and NOTHING
    // in this product ever shows a bill's uuid — the payables screen renders the
    // bill NUMBER, which is what a person knows their bill by. So the control
    // cannot be completed by using the product.
    //
    // The verdict this suite applies, stated because the two rules are easy to
    // confuse: this is NOT a names-not-IDs violation. That rule forbids DRAWING
    // a user, member or org id, and nothing is drawn here — a bill id is not a
    // person. It is an UNUSABLE CONTROL: a required value the product provides
    // no way to obtain. Both need fixing and they are different fixes — the
    // first would be "stop rendering it", this one is "give it a picker".
    {
      const one = rows.find((r) => String(r.sla_metric) === slaMetric(1));
      const bill = bills[0];

      if (String(one.status) === 'pending') {
        const tr = p.locator('tbody tr').filter({ hasText: slaMetric(1) }).first();
        await tr.getByRole('button', { name: /^Apply$/ }).click();
        const m = await inModal(page, 'Apply SLA Credit');

        const picker = m.locator('select.inp');
        const pickerCount = await picker.count();

        // Complete the apply anyway, so the report can tell "the route is
        // broken" from "the door is missing". The id is read from the list
        // endpoint — a GET, which is this suite's own carve-out — and TYPED into
        // the product's own box. A person could not have obtained it.
        await typeInto(m.locator('input.inp').first(), String(bill.id));
        await saveAndWait(page, async () => {
          await m.getByRole('button', { name: /^Apply$/ }).click();
        }, /\/v1\/ganit\/billing\/sla-credits\/[^/]+\/apply$/, 'apply an SLA credit to a bill',
          { methods: ['POST'] });
        await settle(page);

        expect(pickerCount, 'THE APPLY SHEET HAS NO BILL PICKER. It is one free-text box asking ' +
          'for a vendor bill\'s UUID, and no screen in this product ever shows one — the ' +
          'payables register renders the bill NUMBER, which is what a person knows their bill ' +
          'by. The credit below WAS applied, by reading the id from the list endpoint and ' +
          'typing it in, so the route works: what is missing is the door. This is an unusable ' +
          'control rather than a names-not-IDs breach — nothing is rendered, a bill id is not a ' +
          'person, and the two need different fixes.').toBeGreaterThan(0);
      }

      rows = mine(await slaCredits(page), 'sla_metric');
      const applied = rows.find((r) => String(r.sla_metric) === slaMetric(1));
      expect(String(applied.status), 'the credit was applied to a bill and the canonical row does ' +
        'not say so' + dumpWire(wire)).toBe('applied');

      // And the money must actually move on the BILL, or "applied" is a label
      // with nothing behind it.
      const after = await apiOne(page, `/api/v1/ganit/vendor-bills/${bill.id}`);
      const on = after?.bill ?? after;
      expect(Number(on?.sla_credit_applied || 0), `the credit reads "applied" and bill ` +
        `${on?.bill_number} carries an SLA credit of ₹${on?.sla_credit_applied}. A status that ` +
        'moves without the money moving is worse than a refusal.')
        .toBeGreaterThanOrEqual(Number(applied.credit_amount));
    }

    console.log(`\n  17.08 — SLA credits: ${typed} typed, ${found} already present; ` +
      'one applied to a bill, one waived\n');
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 17.09 · SURFACE 8 — ageing: where this module's money lands
  // ──────────────────────────────────────────────────────────────────────────
  test('17.09 the ageing report carries what was billed, and counts drafts nobody has issued', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    const home = await homeStateCode(page);
    const target = await billingTargets(page, home);
    const p = await openTab(page, 'ageing', 'ageing');

    const recv = await apiOne(page, '/api/v1/ganit/billing/ageing?direction=receivable');
    const pay = await apiOne(page, '/api/v1/ganit/billing/ageing?direction=payable');
    expect(Array.isArray(recv?.by_client), 'the receivables ageing returned no party breakdown')
      .toBeTruthy();
    expect(Array.isArray(pay?.by_client), 'the payables ageing returned no party breakdown')
      .toBeTruthy();

    // ⚠ A DELTA, NEVER A TOTAL SUMMED FROM A LIST. List endpoints cap at 200
    // rows whatever limit is asked, and reconciling a total by summing one gave
    // ₹1.06 Cr against a true ₹3.58 Cr. The assertion is that the two customers
    // this suite billed APPEAR with an outstanding balance, which is a fact
    // about their own rows.
    for (const t of [target.intra, target.inter]) {
      const row = recv.by_client.find((r: any) => String(r.party_name) === t.name);
      expect(row, `${t.name} was invoiced by this suite and does not appear in the receivables ` +
        'ageing at all — an invoice that is not in ageing is an invoice nobody chases').toBeTruthy();
      expect(Number(row.total_outstanding), `${t.name} appears in ageing with nothing outstanding`)
        .toBeGreaterThan(0);
    }

    // The screen must paint the same two sections a person reads.
    await expect(p.getByRole('heading', { name: /^Receivables/ }),
      'the ageing screen shows no Receivables section').toBeVisible();
    await expect(p.getByRole('heading', { name: /^Payables/ }),
      'the ageing screen shows no Payables section').toBeVisible();

    // ── AND A NOTE THE LEAD HAS TO RULE ON ──────────────────────────────────
    //
    // `payment_ageing` filters on `i.payment_status != 'paid'` and NOTHING
    // else, so a DRAFT — a document nobody has reviewed and which, per 17.07,
    // can never even be issued — is counted in this firm's receivables. The
    // dunning path deliberately excludes drafts. Two readings of the same
    // register disagree, and this suite does not choose between them: it
    // reports the number, because a receivables figure that includes documents
    // that cannot be sent is a figure somebody will quote to a bank.
    const drafts = (await apiRows(page, '/api/v1/ganit/invoices'))
      .filter((r) => String(r.doc_status) === 'draft' && String(r.payment_status) !== 'paid');
    const draftValue = drafts.reduce((s, r) => s + Number(r.balance_due || 0), 0);
    console.log(`\n  17.09 — receivables ageing counts ${drafts.length} DRAFT invoice(s) worth ` +
      `₹${draftValue.toFixed(2)}. \`payment_ageing\` filters on payment_status only; the dunning ` +
      'path excludes drafts. One of the two is wrong and the lead decides which.\n');

    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 17.10 · SURFACE 9 — the pay link, opened as the customer, logged out
  // ──────────────────────────────────────────────────────────────────────────
  test('17.10 two payment links are opened as the customer, and neither offers a gateway', async ({ page, browser }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    // A link exists only for an ISSUED, unsettled document — `routers/pay.py`
    // refuses a draft and refuses a settled invoice, so the product does not
    // render a button that would hand somebody a URL that 404s. 17.07 proves
    // this module's own invoices can never reach that state, so the two links
    // opened here are on invoices this firm issued through the ordinary
    // path — which is what a customer of this firm would actually receive.
    const candidates = (await apiRows(page, '/api/v1/ganit/invoices'))
      .filter((r) => ['final', 'sent', 'viewed'].includes(String(r.doc_status))
        && ['unpaid', 'partial'].includes(String(r.payment_status))
        && Number(r.balance_due || 0) > 0)
      .sort((a, b) => String(a.invoice_number).localeCompare(String(b.invoice_number)))
      .slice(0, N_PAY_LINKS);

    expect(candidates.length, `§4 asks for ${N_PAY_LINKS} pay links opened and this org holds ` +
      `${candidates.length} issued, unsettled invoice(s) to open one for. An invoice must be ` +
      'issued before it has a payable link at all.').toBe(N_PAY_LINKS);

    // The link is COPIED from the product, not built here: `payLink()` is the
    // product's own rule about which invoices have one, and reading the token
    // out of the database would test a URL no customer was ever given.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    const opened: string[] = [];
    for (const inv of candidates) {
      const ip = await openTab(page, 'invoices', 'invoices');
      const search = ip.locator('input.tv__input');
      await expect(search, 'the invoice register has no search box').toBeVisible({ timeout: 30_000 });
      await typeInto(search, String(inv.invoice_number));
      const link = ip.getByRole('button', { name: String(inv.invoice_number), exact: true });
      await expect(link, `${inv.invoice_number} is not on the register`).toBeVisible({ timeout: 30_000 });
      await link.click();
      const drawer = page.getByRole('dialog', { name: `Invoice ${inv.invoice_number}` });
      await expect(drawer, 'the record drawer did not open').toBeVisible({ timeout: 30_000 });

      const copy = drawer.getByRole('button', { name: /Copy pay link|Link copied/ });
      await expect(copy, `${inv.invoice_number} is issued and unsettled and the drawer offers no ` +
        '"Copy pay link" — the whole payments programme is that link').toBeVisible();
      await copy.click();
      const url = String(await page.evaluate(() => navigator.clipboard.readText())).trim();
      expect(url, `the Copy pay link button put nothing on the clipboard for ${inv.invoice_number}`)
        .toMatch(/\/i\/[A-Za-z0-9_-]{16}$/);
      opened.push(`${inv.invoice_number} → ${url.replace(/\/i\/.*$/, '/i/…')}`);

      // ── NOW AS THE CUSTOMER: a stranger with a link, and nothing else ──────
      const ctx = await browser.newContext();
      const cust = await ctx.newPage();
      const custErrors: string[] = [];
      cust.on('pageerror', (e) => custErrors.push(String(e?.message ?? e)));
      try {
        await cust.goto(url, { waitUntil: 'domcontentloaded' });

        // The doorstep: who sent it, the number, the amount. Nothing here may
        // require a session — this page has no visitor but a stranger.
        await expect(cust.getByText(String(inv.invoice_number), { exact: false }).first(),
          `the payment page for ${inv.invoice_number} does not name the document`)
          .toBeVisible({ timeout: 45_000 });
        const painted = (await cust.locator('body').innerText()).replace(/\s+/g, ' ');

        expect(painted, 'the payment page names no supplier — the customer cannot tell who is ' +
          'asking them for money').toContain('Unicode Group');

        // ⚠ NO GATEWAY, AND THE PAGE SAYS SO IN WORDS. There is no payment
        // gateway and there never will be: the customer pays the firm's own UPI
        // address directly and "paid" only ever comes from bank reconciliation.
        // The sentence is bound to `settlement.instant_confirmation` from the
        // API, so if a gateway ever appears the copy changes because the DATA
        // changed. Asserting the sentence is asserting the product rule.
        expect(painted, 'the payment page does not tell the customer that payment is confirmed ' +
          'against the bank statement rather than automatically. There is no gateway and no ' +
          'callback, so a page that implies a receipt will appear by itself is lying.')
          .toContain('confirmed against the bank statement');
        for (const forbidden of [/\bcard number\b/i, /\bcvv\b/i, /\bnet ?banking\b/i,
                                 /\bpay (?:securely )?(?:with|by) card\b/i]) {
          expect(forbidden.test(painted), `the payment page offers "${forbidden}". There is no ` +
            'payment gateway in this product and there will not be one.').toBe(false);
        }

        // A stranger with a forwarded link must not be handed a uuid either.
        expect(painted, 'the public payment page paints a UUID')
          .not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        expect(custErrors, `the payment page threw: ${custErrors.join(' | ')}`).toHaveLength(0);

        // Opening a link is not paying, and the register must not pretend it is.
        const still = (await apiRows(page, '/api/v1/ganit/invoices'))
          .find((r) => String(r.invoice_number) === String(inv.invoice_number));
        expect(String(still.payment_status), `${inv.invoice_number} was OPENED by the customer ` +
          `and its payment status moved to "${still.payment_status}". Opening a link is not ` +
          'paying; "paid" comes only from bank reconciliation.')
          .toBe(String(inv.payment_status));
      } finally {
        await ctx.close();
      }

      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden({ timeout: 20_000 });
    }

    expect(opened.length, `§4 asks for ${N_PAY_LINKS} pay links opened`).toBe(N_PAY_LINKS);
    console.log('\n  17.10 — pay links opened as the customer:\n     ' + opened.join('\n     ') + '\n');
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 17.11 · the §4 sheet, and what the auto-invoice sweep has ever produced
  // ──────────────────────────────────────────────────────────────────────────
  test('17.11 every §4 count is exact, so a second execution verifies rather than duplicates', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    await signIn(page);

    const home = await homeStateCode(page);
    const target = await billingTargets(page, home);

    const counts: { what: string; got: number; want: number }[] = [];
    const push = (what: string, got: number, want: number) => counts.push({ what, got, want });

    const prof = await profiles(page);
    push('billing profiles (S17 clients)',
      [target.intra.name, target.inter.name]
        .filter((n) => prof.some((r) => String(r.client_name) === n)).length, N_PROFILES);
    push('service lines', mine(await serviceLines(page), 'description').length, N_SERVICE_LINES);

    const cards = mine(await rateCards(page), 'item_category');
    push('rate cards', cards.length, N_RATE_CARDS);
    push('rate cards carrying NO note',
      cards.filter((c) => !String(c.notes ?? '').trim()).length, N_BLANK_NOTES);

    const usage = mine(await usageRows(page), 'metric');
    push('metered usage rows', usage.length, N_USAGE);
    push('usage rows marked invoiced', usage.filter((u) => u.invoiced).length, N_USAGE);
    push('distinct usage sources', new Set(usage.map((u) => String(u.source_ref))).size, N_USAGE);

    const sla = mine(await slaCredits(page), 'sla_metric');
    push('SLA credits', sla.length, N_SLA);
    push('SLA credits applied', sla.filter((s) => String(s.status) === 'applied').length, 1);
    push('SLA credits waived', sla.filter((s) => String(s.status) === 'waived').length, 1);

    push('billing cycles (invoices generated)', (await generatedUsageInvoices(page)).length, N_CYCLES);

    // Subscription changes are not a table — they are transitions, and the
    // evidence is the STATE they left behind. Each of the five is asserted as
    // the fact it produced, so a second execution verifies rather than repeats.
    const lines = mine(await serviceLines(page), 'description');
    const l = (n: number) => lines.find((r) => String(r.description) === serviceLineDesc(n));
    let landed = 0;
    if (prof.find((r) => String(r.client_name) === target.intra.name)) landed++;       // anchor day
    if (l(1) && l(1).auto_invoice === false) landed += 2;                              // armed, then paused
    if (l(2) && Number(l(2).amount) === DOWNGRADE_AMOUNT) landed++;                    // downgrade
    if (l(3) && l(3).period_end
        && new Date(String(l(3).period_end)).getTime() < Date.now()) landed++;          // ended
    push('subscription changes still evidenced', landed, N_SUB_CHANGES);

    console.log('\n  17.11 — §4 volumes against the live database:\n' +
      counts.map((c) => `     ${c.got === c.want ? '✓' : '✗'} ${c.what.padEnd(36)} ` +
        `${String(c.got).padStart(4)} / ${c.want}`).join('\n') + '\n');

    // ── WHAT THE AUTO-INVOICE SWEEP HAS EVER PRODUCED, FOR ANYBODY ──────────
    //
    // `sweep_client_auto_invoices` is the other half of this module and it has
    // NO user-reachable trigger: it is called from `POST /cron/billing` alone,
    // which is `CRON_SECRET`-gated and takes no org argument, so running it
    // would raise tax invoices in every organisation in a database production
    // shares. Nothing in this suite calls it, and the `auto_invoice` checkbox is
    // therefore provable only as far as the flag round-tripping (17.04).
    //
    // `client_invoice_lines` is the sweep's own record of what it has billed —
    // one row per line per period, the thing that stops double-billing. It is
    // reported here rather than asserted, because whether the programme wants
    // to arm a line and wait for a tick is the lead's decision, not a suite's.
    const lineRows = await apiGet(page, '/api/v1/ganit/billing/service-lines');

    // ── AND WHAT THE SWEEP WRITES WHEN IT DOES RUN ─────────────────────────
    //
    // The sweep INSERTed without naming `doc_status`, which DEFAULTS to
    // `'final'` (read from `pg_attrdef` 2026-08-29, not from a migration
    // file). So the ONE invoice writer in this product that nobody is
    // watching minted a FINISHED tax invoice, with a Rule 46(b) serial spent
    // on it, and never passed `ganit._refuse_final_if_incomplete` — the gate
    // every hand-issued invoice clears, whose refusal reads "Nothing has been
    // invented to fill the gap." Fixed 2026-08-29: it writes `'draft'`, the
    // same as its sibling `generate_usage_invoice` (17.07), and a person
    // issues it with `Mark final`, which DOES run the gate.
    //
    // ⚠ THIS CANNOT BE PROVED BY DRIVING THE PRODUCT, and that is the finding
    // as much as the fix is. There is no control anywhere that runs the
    // sweep. So the check below is over whatever the sweep has ever left
    // behind — nothing today — and it says so rather than reporting a
    // vacuous pass. It bites the first time a tick of `/cron/billing`
    // produces a row, which is exactly when it is wanted.
    // ⚠ `has_updater` IS WHAT MAKES THIS ASSERTABLE AT ALL. A swept invoice
    // that is `final` is not automatically wrong — the whole point of writing
    // a draft is that a PERSON can issue it, and `Mark final` stamps
    // `updated_by`. A test that went red the moment somebody did the right
    // thing would be a defect in the test. So the failure is the narrow one
    // that can only be the cron: not a draft, and nobody ever touched it.
    const swept = (await apiRows(page, '/api/v1/ganit/invoices'))
      .filter((i) => String(i.notes || '').startsWith('Auto-invoice: '));
    const sweptIssued = swept.filter((i) => String(i.doc_status || '') !== 'draft');
    const sweptFinal = sweptIssued
      .filter((i) => !i.has_updater)
      .map((i) => `${i.invoice_number} (${i.doc_status}, nobody has ever touched it)`);

    console.log('  17.11 — AUTO-INVOICE, stated plainly rather than left as a silent zero:\n' +
      '     · The sweep has no user-reachable trigger. Its only caller is POST /cron/billing,\n' +
      '       which passes no org_id, so it runs for EVERY organisation at once.\n' +
      '     · The `auto_invoice` checkbox on a service line therefore has no effect any person\n' +
      '       can produce or observe from inside the product.\n' +
      `     · GET /service-lines answered ${lineRows.status()}; ` +
      `${lines.filter((r) => r.auto_invoice).length} of this suite's ${lines.length} lines are armed ` +
      '(deliberately none — see 17.04).\n' +
      `     · Invoices the sweep has EVER written in this org: ${swept.length}` +
      `${swept.length === 0
        ? '. So the draft check below PROVED NOTHING this run — it bites on the first tick of '
          + '/cron/billing that produces a row.'
        : `, of which ${sweptIssued.length} have been issued and ${sweptFinal.length} were `
          + 'issued by nobody.'}\n`);

    expect(sweptFinal,
      'AN UNATTENDED CRON ISSUED A TAX INVOICE. `sweep_client_auto_invoices` must write ' +
      '`doc_status = \'draft\'`: the column DEFAULTS to \'final\', nobody reviews a cron\'s ' +
      'output, and a document reaching `final` without passing `_refuse_final_if_incomplete` ' +
      'is precisely what that gate exists to prevent. A draft is not a document withheld — it ' +
      'is created, numbered, on the register, and issued by a person with `Mark final`, which ' +
      'runs the gate and stamps the person. These carry no updater at all, so no person issued ' +
      'them.').toEqual([]);

    const wrong = counts.filter((c) => c.got !== c.want);
    expect(wrong.map((c) => `${c.what}: ${c.got} (wanted ${c.want})`),
      'a §4 volume is not exact. A count ABOVE the target on a second execution means `ensure()` ' +
      'failed to recognise this suite\'s own marks and duplicated them; a count BELOW it means ' +
      'the run that made them did not finish, or a refusal this suite is written to expose is ' +
      'still refusing. All three are reported, none is ruled on here.').toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 17.12 · not one UUID on any client-billing screen
  // ──────────────────────────────────────────────────────────────────────────
  test('17.12 no client-billing screen paints a UUID', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    // `check-rendered-ids.mjs` is static and positional: it reads NAMES in JSX
    // and cannot see an id the server pre-formatted into a string, nor one that
    // arrives inside a value. This reads the PAINTED TEXT of every screen in
    // the module, which is the only place the rule is actually about.
    const found: string[] = [];
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    for (const t of TABS) {
      con.at(t.id);
      const p = await openTab(page, t.id, t.label);
      const text = await p.innerText();
      for (const hit of text.match(UUID) || []) found.push(`${t.label}: ${hit}`);
    }

    // ⚠ AND THE ONE PLACE A UUID IS ASKED FOR RATHER THAN DRAWN. The Apply
    // sheet's "Bill ID" box is empty until somebody types into it, so this scan
    // cannot see it and 17.08 is what reports it. A ratchet that only looks at
    // what is painted misses a control that DEMANDS an id, and the two failures
    // are worth keeping apart.
    expect(found, `a client-billing screen paints a UUID:\n     ${found.join('\n     ')}\n` +
      'A person is identified by their name, and a record by the number printed on it.')
      .toEqual([]);
    assertNoUncaught(con);
  });
});
