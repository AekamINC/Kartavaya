/**
 * Proposal 93 · Stage 3 · WAVE 4 · SUITE 10 — Vikray (विक्रय, sales), on
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
 * RULE 1 — EVERY ROW HERE IS TYPED BY A USER
 * ═══════════════════════════════════════════════════════════════════════════
 * Every order, line item, status advance, cancellation, invoice conversion,
 * stock adjustment, low-stock threshold, sales target and payout run below is
 * made by opening the screen, filling the real inputs, choosing from the real
 * pickers and pressing the real button. No SQL. No
 * `page.request.post/put/patch/delete`.
 *
 * `page.request.get` IS used — `apiRows()` / `apiOne()` — and that is the
 * ratchet's own carve-out: asserting the row appeared IS the required evidence.
 * Both send **`X-Org-Id`** (`frontend/src/lib/api.js`), because a read helper
 * that omits it makes the server fall back to the caller's OLDEST membership
 * and answer for a different organisation than the screen beside it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 2 — STOP AND REPORT. NO VERDICT.
 * ═══════════════════════════════════════════════════════════════════════════
 * Where a control §4 requires does not exist, or an arithmetic identity every
 * money document obeys does not hold, the test FAILS and prints what it looked
 * for and what the live wire returned. Nothing is skipped and no assertion is
 * softened. 93 §14 reserves the product-bug-versus-test-bug judgement to the
 * owner. SIX fail on a run against staging as it stands on 2026-08-29, and
 * every one of them is written as a failure on purpose:
 *
 *   10.04  §4 asks every order to carry a **ship-to address**. NOTHING IN THE
 *          PRODUCT WRITES ONE. `OrderForm` holds `shipping_address: {}` in form
 *          state and renders no input for it (`OrderForm.jsx:54` is the only
 *          mention in the whole of `src/`), `OrderUpdate` accepts the field but
 *          `OrderDetail`'s edit form offers no box either, and
 *          `OrderDetail.jsx:315` renders a "Ship to" section that can therefore
 *          never appear. Live: of 380 orders in `reseed_backup_20260828`,
 *          358 carry `{}` or NULL and the 22 that do not were written by an
 *          API caller, not by a person. A column the API can write and a human
 *          cannot is the same shape as the vendor address before 8.0.
 *
 *   10.03  The order totals do not obey `subtotal + tax − discount = total`.
 *          `_compute_order_totals` (`routers/vikray.py:133`) stores `subtotal`
 *          ALREADY NET of the flat discount and then adds tax to it, so the
 *          discount is deducted once in the subtotal and shown again as its own
 *          line — `OrderDetail`'s totals block prints Subtotal, CGST, SGST,
 *          Discount and Total, and on any discounted order those five figures
 *          do not add up on screen. Ganit's `_compute_invoice`
 *          (`routers/ganit.py:313`) keeps `subtotal` GROSS and subtracts the
 *          discount from the total — the same document computed two ways by two
 *          modules. The TOTAL agrees; the taxable value does not.
 *
 *   10.08  Two things do not cross from the order to the invoice it becomes.
 *          · **The salesperson.** `vikray_orders.salesperson_id` is set by the
 *            order form; `staging.ganit_invoices.salesperson_id` EXISTS (text,
 *            confirmed by live query) and `generate_invoice_from_order`
 *            (`routers/vikray.py:842`) does not name it in its INSERT. The
 *            commission register reads turnover from
 *            `ganit_invoices.salesperson_id` and nothing else
 *            (`services/report_defs/commission_reports.py:202`), so a sale
 *            credited on the order pays nobody once it is invoiced. That
 *            module's own docstring says the column "exists so that attribution
 *            can be captured at the point of sale and CARRIED to the invoice,
 *            which is where the write path must copy it."
 *          · **The taxable value**, because of 10.03: the order's net subtotal
 *            is copied into a column Ganit's readers treat as gross, and the
 *            discount is then subtracted a second time by every reader that
 *            computes `subtotal − discount`.
 *          A third was reported-not-asserted here and is now FIXED AND
 *          ASSERTED, 2026-08-29: the conversion minted every invoice with
 *          `place_of_supply=''` — measured, 10 of 10 order-generated invoices
 *          blank and 6 of them inter-State. `services/gstr1_json.py` reads that
 *          exact column, and a blank one on an inter-State supply is not an
 *          error there: the invoice is HELD OUT OF THE RETURN altogether, so
 *          the sale never appears. `_order_place_of_supply` now derives it from
 *          the counterparty and the order's own `is_igst`, and 10.08 asserts it
 *          against the same client state this suite derives its tax split from.
 *          ⚠ Asserted on THIS RUN'S conversions only; the historical blanks are
 *          named in the log, because re-stating a Rule 46 particular on an
 *          issued tax invoice is a data change to live rows and is the owner's.
 *
 *   10.05  Opening an order drops the tab from the URL. `orderPath()`
 *          (`vikray/_shared.jsx`) is `/vikray/orders/<id>` with no query, while
 *          `VikrayPage` reads its open tab from `?tab=` — so the list behind
 *          the record silently becomes the starred default (Pipeline) for as
 *          long as the drawer is open, and a cold arrival on a shared link
 *          lands on a tab the reader has never been on. `OrderRoute.jsx`'s own
 *          header says keeping the list underneath is the entire reason the
 *          record is a nested route.
 *
 *   10.12  **Target attainment can never move.** `vikray_targets` attainment is
 *          `graha_deals.assigned_to = t.salesperson_id`
 *          (`routers/vikray.py:1080`) and NO FORM IN THE PRODUCT WRITES
 *          `assigned_to`: `grep -rn assigned_to frontend/src` finds three
 *          readers (Graha's pipeline card, the rep-performance report, the
 *          contact drawer) and no writer, and `DealsTab`'s create form carries
 *          title · client · contact · territory · stage · probability · value ·
 *          close date · notes and no assignee. Live: 30 deals on Unicode Group,
 *          **0** with an assignee. The join was moved off `owner_id` — a column
 *          nothing ever wrote — onto `assigned_to`, which nothing on a screen
 *          ever writes either. The Targets tab tells the user in prose that
 *          actuals come from deals "assigned to that salesperson".
 *
 *   10.16  The §4 volume sheet, which reports whatever the tests above could
 *          not achieve. A volume sheet that quietly drops the line it cannot
 *          meet is the silent cap §10 warns about.
 *
 * ── SPLIT SO THAT ONE FAILURE CANNOT HIDE THE REST ──────────────────────────
 * The lifecycle, the cancellations and the invoice conversions are separate
 * tests rather than sections of a longer one, and each one that can produce
 * more than one finding COLLECTS them into an array and asserts the array is
 * empty at the end. A test that aborts on its first expectation hides
 * everything after it, and reporting one defect while silently not looking for
 * the next two is the silent cap in miniature.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE STATUTORY HALF — where green can be wrong
 * ═══════════════════════════════════════════════════════════════════════════
 * GST splits on the STATE PAIR. s.7 and s.8 IGST Act: supplier's location and
 * place of supply in the same State is INTRA-state and bears CGST + SGST in
 * equal halves; anything else is INTER-state and bears IGST at the full rate.
 *
 * The supplier's state is READ FROM THE LIVE ORG PROFILE — never typed as a
 * constant — because a suite that hardcodes it cannot notice when it changes
 * underneath. `expectedSplit()` derives the answer from the pair and every
 * money assertion asks that function. Nothing here names "Gujarat" or a rupee
 * figure as an expectation.
 *
 * ⚠ THREE FACTS ABOUT THE LIVE DATA AND THE PRODUCT, measured 2026-08-29 and
 *   reported rather than worked around:
 *
 *   · **Vikray's ORDER FORM has no place-of-supply field.** Ganit's invoice
 *     form has a place-of-supply select and derives a suggestion from the two
 *     GSTINs; the order form has a bare `Inter-state supply (IGST)` CHECKBOX
 *     and derives nothing. So the split on a sales order is whatever the person
 *     ticked, and `vikray_orders` carries no record of which State the supply
 *     was into. This suite therefore derives the answer itself, ticks the box
 *     accordingly, and asserts the SERVER split against the derivation.
 *     ⚠ CHANGED 2026-08-29 for the INVOICE, not the order. The conversion no
 *     longer needs a field to carry: it resolves the state from the customer's
 *     GSTIN then their address, skipping any candidate that would contradict
 *     the `is_igst` the order already records — which is what the eight
 *     contradicting fixtures below make necessary. The ORDER still stores no
 *     state, and that remains true and untested-for.
 *   · **Suite 04's fixture GSTINs contradict their addresses.** Measured:
 *     eight of the twenty-five Unicode clients carry a GSTIN beginning `24`
 *     (Gujarat) at a Maharashtra or Karnataka address — `S04 Client 04 Pune`,
 *     `05 Bengaluru`, `10 Pune`, `11 Bengaluru`, `16 Pune`, `17 Bengaluru`,
 *     `22 Pune`, `23 Bengaluru`. Eight more carry no GSTIN at all. Reported by
 *     Suite 05 before this suite ran, and confirmed here.
 *     **This suite derives the place of supply from the client's ADDRESS
 *     STATE**, which is the physical fact and what s.12(2)(a) IGST Act points
 *     at, and prints the contradicting eight in 10.03's log so the fixture
 *     defect is not laundered into a Vikray finding.
 *   · **This suite creates no clients.** The customers a sales order is raised
 *     against are the CRM's companies — "a CRM client is the company (the
 *     customer); contacts are people who come and go, the customer stays" — so
 *     Suite 04's twenty-five are used as they stand. Had any been created here
 *     its GSTIN state prefix would have been made to agree with its address;
 *     none was, so there is nothing to declare.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 — RE-RUNNABLE, AND PROVED BY RUNNING IT TWICE
 * ═══════════════════════════════════════════════════════════════════════════
 * Every record carries a DETERMINISTIC mark built from `TAG`, so a second
 * execution recognises its own output and verifies instead of duplicating.
 *
 *   orders    the NOTES field — `S10-SO-07`, a value the form can actually
 *             carry. Read back through `?since=` and not through the plain
 *             list, because `DELETE /orders/{id}` sets `is_active=FALSE` and
 *             `GET /orders` filters on it: six of these thirty-five are
 *             cancelled, and a plain list would report them missing and type
 *             them again on every re-run. The delta endpoint deliberately does
 *             NOT apply that filter (`routers/vikray.py:183`), which is exactly
 *             the read this needs.
 *   targets   the (salesperson, period_start) pair the table's own unique index
 *             is on — `POST /targets` is `ON CONFLICT … DO UPDATE`, so it is
 *             idempotent by construction — plus a notes mark.
 *   stock     BY COUNT, because `vikray_stock_moves` is an append-only ledger
 *             with no name column and nothing to mark. The manual reasons a
 *             person can choose (restock · manual_adjustment · damage ·
 *             return) are counted and topped up to §4's forty-five; the
 *             lifecycle reasons the order flow stamps (`order_confirmed`,
 *             `order_cancelled`) are counted separately and never confused with
 *             them. Every quantity assertion is a DELTA — read before, adjust,
 *             assert after − before — so a second run over a deeper ledger is
 *             as true as the first.
 *
 * `RUN` — a per-run stamp — appears only where a value must differ run to run.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §10 — THE 12 SCREENS, NAMED, BECAUSE A SILENT CAP READS AS FULL COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════
 * `VikrayPage.jsx` declares TWELVE tabs and §10 gives Suite 10 twelve screens.
 * They are the same twelve. 10.01 opens every one and prints which branch it
 * took; 10.17 reads the painted text of every one again once the module is
 * full. The record and form surfaces sit on top of them:
 *
 *   dashboard        10.01 · 10.15 — the status mix, the attention list
 *   orders           10.01 · 10.03 · 10.05 · 10.06 · 10.07 · 10.08
 *   products         10.01 — RENDERED ONLY. The catalogue is one catalogue,
 *                    mounted here and in Ganit from one file, and Suite 05 owns
 *                    its eighteen rows. Creating more here would double them.
 *   stock            10.01 · 10.02 · 10.09 — thresholds, ±1, the Adjust dialog,
 *                    the movement history, the below-zero warning
 *   pipeline         10.01 · 10.14 — value per stage, and the stage filter
 *   targets          10.01 · 10.11 · 10.12 — the form, the table, the
 *                    leaderboard, the unattributed diagnostic
 *   clients          10.01 · 10.10 — RENDERED ONLY; Graha's component, Suite
 *                    04's rows
 *   contacts         10.01 — RENDERED ONLY, same reason, `crm={false}`
 *   customers        10.01 · 10.10 — the trading history, and the orders that
 *                    open underneath a customer
 *   billing          10.01 — RENDERED ONLY; Ganit's component, Suite 05's rows
 *   metered-usage    10.01 — RENDERED ONLY, same reason
 *   analytics        10.01 — RENDERED ONLY; the module analytics door
 *
 *   OrderForm        10.03 — customer, contact, salesperson, both dates, the
 *                    IGST checkbox, the catalogue picker, the line grid, the
 *                    discount, the notes
 *   OrderDetail      10.05 — edit · 10.06 — advance · 10.07 — cancel ·
 *                    10.08 — invoice
 *   AdjustDialog     10.09
 *   Moves            10.09
 *   TargetForm       10.11
 *   CustomerOrders   10.10
 *   ReportsPage      10.13 — the commission payout run, which §4 puts in this
 *                    suite's row and which has no door inside the module
 *
 * WHAT IS NOT DRIVEN, said rather than left to read as covered:
 *   · The order form's inline **Create company** and **Create contact** panels.
 *     They post to Graha's own endpoints and would add companies to Suite 04's
 *     twenty-five; the customers used here are the CRM's, which is what a
 *     customer is.
 *   · `POST /orders/from-deal/{deal_id}`. There is no control for it anywhere
 *     in `src/` — the deal-to-order conversion is an endpoint with no door —
 *     and §10 does not ask for it. Recorded, not asserted.
 *   · The order form's `deal_id`, which is in form state and has no input, so
 *     no order raised through a screen can ever link to a deal. Recorded in
 *     10.12, where it matters, and not separately asserted.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TRAPS THIS FILE IS WRITTEN AROUND
 * ═══════════════════════════════════════════════════════════════════════════
 * · `page.reload()` on the line after Save races the write. Everything goes
 *   through `saveAndWait()`, which returns the SERVER's status. A toast is the
 *   client's opinion.
 * · The `−1` and `+1` buttons on the stock ledger fire `api.patch(...).then(load)`
 *   with no toast and no await. Nothing on screen says the write happened, so
 *   they are pressed through `saveAndWait` and judged on the response.
 * · `fill('')` does not register with a controlled React input — clearing is
 *   select-all-then-type (`typeInto`).
 * · **Creating an order NAVIGATES.** `OrdersTab.onCreated` calls `open(o.id)`,
 *   which pushes `/vikray/orders/<id>` and opens the record drawer over the
 *   list. Every create below closes it before the next one starts, or the
 *   following click lands on a scrim.
 * · `getByRole(…, {name})` matches the ACCESSIBLE name. The customer, contact
 *   and salesperson controls are `<button aria-haspopup="listbox"
 *   aria-label="…">` with no visible text of their own, so they are found by
 *   `aria-label` and never by label text.
 * · The drawer's `×` and the module header's `+ New order` both duplicate names
 *   that exist elsewhere on the page. Every locator below is scoped to the tab
 *   panel, the form, or the drawer, and the `×` is addressed by its class.
 * · `Cancel order` names TWO controls — the drawer's danger button and the
 *   confirm dialog's confirm button. The second is scoped to `role=alertdialog`.
 * · A vacuous assertion passes for ever. EVERY loop below asserts its count
 *   BEFORE it iterates.
 * · List endpoints CAP AT 200. Nothing here reconciles a total by summing a
 *   list without saying how many rows the sum covers.
 * · No user, member or org UUID is ever rendered or asserted. 10.17 reads the
 *   PAINTED TEXT of every Vikray screen, because `check-rendered-ids.mjs` is
 *   static and positional and cannot see an id the server formatted into a
 *   string.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SENDING — this suite sends nothing, and that is measured rather than assumed
 * ═══════════════════════════════════════════════════════════════════════════
 * `GET /api/health` reports `outbound_mode=live` with
 * `suppressed_orgs_digest="0"` — NOTHING is shielded — so any suite that mails
 * would be an incident rather than a test failure. Vikray has no send surface:
 * no email control on any of its twelve screens, and the order lifecycle's only
 * outbound path is a Niyam rule, of which **Unicode Group has none** (live:
 * `staging.niyam_rules` holds 6 rows, all 6 on Aekam Inc, 0 on this org).
 * 10.01 records the fence state so the run's log says which world it ran in.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave4.config.ts --project vikray
 */
import { test, expect, Page, Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { lane, signInAs as laneSignIn, assertOrg, ORG as ORG_IDS } from './_lanes';
import { setDate } from './_helpers';

const DL = path.join(os.tmpdir(), 'kartavya-e2e-wave4', 'vikray-downloads');
fs.mkdirSync(DL, { recursive: true });

const LANE = lane('unicode');
const API = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';

const BLOCKED =
  'BLOCKED — no Unicode Group credential. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e at the repo root. ⚠ It must be an ' +
  'ORG-SCOPED account: a platform_admin token resolves to Aekam Inc via ' +
  'platform_bypass and will write there. ENVIRONMENT blocker, not a product ' +
  'or test defect.';

/** The suite's own mark. Deterministic — §6 idempotence hangs off it. */
const TAG = 'S10';
/** A per-run stamp, for the handful of values that must differ run to run. */
const RUN = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

const pad = (n: number) => String(n).padStart(2, '0');
const money = (n: any) => Math.round(Number(n || 0) * 100) / 100;
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

// ── §4 VOLUMES, stated once ─────────────────────────────────────────────────
//
// §4, row "10–11 Vikray and Prachar — sales and marketing", the Vikray half:
//   Orders                             35   cost price, salesperson, ship-to
//                                           address; 6 cancelled; 10 converted
//                                           to invoices
//   Stock items · moves           18 · 45   one driven negative to see the
//                                           warning
//   Sales targets · payout runs   10 ·  2   payout must match the band ladder
//                                           from Suite 07
// The marketing lines of that same row belong to Suite 11 and are not here.
const N_ORDERS = 35;
const N_CANCELLED = 6;
const N_INVOICED = 10;
const N_STOCK_ITEMS = 18;
const N_STOCK_MOVES = 45;
const N_TARGETS = 10;
const N_PAYOUT_RUNS = 2;

/** Suite 05's catalogue, which is what an order line is picked from. */
const N_PRODUCTS = 18;
const productName = (n: number) => `S05 Product ${pad(n)}`;
/** Twelve of the eighteen carry a cost; the rest record none, which is not zero. */
const COSTED_PRODUCTS = 12;

/** The §6 mark an order carries, in the one field the form can put it in. */
const orderMark = (n: number) => `${TAG}-SO-${pad(n)}`;
/** The §6 mark a target carries, beside the pair its unique index is on. */
const targetMark = (n: number) => `${TAG} target ${pad(n)}`;

/** Every Vikray tab, in the order `VikrayPage.jsx` declares them. §10: 12. */
const TABS: { id: string; label: string; owned: boolean }[] = [
  { id: 'dashboard', label: 'dashboard', owned: true },
  { id: 'orders', label: 'orders', owned: true },
  { id: 'products', label: 'products', owned: false },
  { id: 'stock', label: 'stock', owned: true },
  { id: 'pipeline', label: 'pipeline', owned: true },
  { id: 'targets', label: 'targets', owned: true },
  { id: 'clients', label: 'clients', owned: false },
  { id: 'contacts', label: 'contacts', owned: false },
  { id: 'customers', label: 'customers', owned: true },
  { id: 'billing', label: 'billing', owned: false },
  { id: 'metered-usage', label: 'metered usage', owned: false },
  { id: 'analytics', label: 'analytics', owned: false },
];

/**
 * The GST state codes, as the product itself carries them
 * (`frontend/src/lib/validators.js` GST_STATES). Copied rather than imported
 * because a spec importing application source drags Vite's module graph into
 * the Playwright runtime; the values are statutory and do not drift, and 10.03
 * asserts the SUPPLIER's code against the LIVE profile so a divergence between
 * this table and the product's surfaces there rather than passing silently.
 */
const GST_STATE_CODE: Record<string, string> = {
  'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', Punjab: '03',
  Chandigarh: '04', Uttarakhand: '05', Haryana: '06', Delhi: '07',
  Rajasthan: '08', 'Uttar Pradesh': '09', Bihar: '10', Sikkim: '11',
  'Arunachal Pradesh': '12', Nagaland: '13', Manipur: '14', Mizoram: '15',
  Tripura: '16', Meghalaya: '17', Assam: '18', 'West Bengal': '19',
  Jharkhand: '20', Odisha: '21', Chhattisgarh: '22', 'Madhya Pradesh': '23',
  Gujarat: '24', 'Daman and Diu': '25',
  'Dadra and Nagar Haveli and Daman and Diu': '26', Maharashtra: '27',
  Karnataka: '29', Goa: '30', Lakshadweep: '31', Kerala: '32',
  'Tamil Nadu': '33', Puducherry: '34', 'Andaman and Nicobar Islands': '35',
  Telangana: '36', 'Andhra Pradesh': '37', Ladakh: '38',
  'Other Territory': '97', 'Centre Jurisdiction': '99',
};

/**
 * THE STATUTORY RULE, in one function, derived from the PAIR.
 *
 * Nothing here hardcodes a State or a rupee figure: `homeState` is read from
 * the live org profile and the answer follows from the two codes. A money
 * assertion that names its own expected number is a money assertion that cannot
 * be wrong, and that is the failure this avoids.
 */
function expectedSplit(homeState: string, placeOfSupply: string): 'CGST+SGST' | 'IGST' {
  const a = GST_STATE_CODE[homeState];
  const b = GST_STATE_CODE[placeOfSupply];
  expect(a, `the supplier's state "${homeState}" is not a GST state — the split cannot be derived`)
    .toBeTruthy();
  expect(b, `the place of supply "${placeOfSupply}" is not a GST state — the split cannot be derived`)
    .toBeTruthy();
  return a === b ? 'CGST+SGST' : 'IGST';
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

/**
 * Sign in, point the session at Unicode Group, and REFUSE TO CONTINUE unless
 * the server agrees that is where it is.
 *
 * The org key is the switcher's own (`lib/orgContext.js`), written before the
 * app boots so `api.js`'s request interceptor puts `X-Org-Id` on every product
 * call. Without it the server resolves to the caller's OLDEST membership — and
 * this account holds more than one.
 */
async function signIn(page: Page) {
  await laneSignIn(page, LANE);
  await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), LANE.orgId);
  await assertOrg(page.request, page, LANE);
  expect(LANE.orgId, 'the lane must be Unicode Group and never Aekam Inc')
    .toBe(ORG_IDS.UNICODE);
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

/** The rows of a list endpoint, whichever envelope it answers with. */
async function apiRows(page: Page, pathAndQuery: string): Promise<any[]> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  const body = await res.json();
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

/** The response body EXACTLY as the server sent it, unwrapped by nobody. */
async function apiBody(page: Page, pathAndQuery: string): Promise<any> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  return await res.json();
}

/**
 * One object from an endpoint that answers a RECORD rather than a list.
 *
 * ⚠ NOT FOR AN ENVELOPE WHOSE `data` IS AN ARRAY. `?? ` falls through on null
 * and undefined only, so `{data: [...], stages: [...]}` unwraps to the ARRAY and
 * every sibling key is thrown away — which is exactly how 10.14 came to report
 * "the pipeline answered no stages at all" about an endpoint that builds its
 * stages from a CONSTANT (`_PIPELINE_STAGES`) and therefore cannot answer none.
 * That read would have been wrong on a full order book too, so it was never the
 * cascade it looked like. Use `apiBody` for those.
 */
async function apiOne(page: Page, pathAndQuery: string): Promise<any> {
  const body = await apiBody(page, pathAndQuery);
  if (Array.isArray(body?.data)) {
    throw new Error(
      `apiOne("${pathAndQuery}") was handed a LIST envelope — its \`data\` is an array, so ` +
      'unwrapping it would silently discard every sibling key. Use apiBody() and read the ' +
      'envelope, or apiRows() if the rows are all you want.');
  }
  return body?.data ?? body;
}

/**
 * "Everything", said the only way the delta contract will accept it.
 *
 * ⚠ THE 2020 SENTINEL WAS A TEST BUG AND IT COST SEVEN TESTS ON THE FIRST RUN.
 * `?since=2020-01-01T00:00:00Z` answered
 *   400 {"detail":"`since` is more than 365 days old. Resync in full."}
 * and the product was RIGHT: `services/delta_sync.parse_since` refuses a window
 * older than `MAX_SINCE_DAYS = 365` — "a `since` far in the past means the
 * client believes it is doing a delta while actually asking for everything,
 * which is the most expensive query in the product dressed as the cheapest".
 * It is rejected outright rather than clamped, deliberately, and it says so in
 * the body. Seven tests read that refusal as a Vikray defect.
 *
 * 364 days, computed at call time, is the widest window the contract allows.
 * What that CANNOT see is an order last touched more than a year ago — stated
 * rather than papered over. It does not reach this suite: every mark below is
 * written by this run or a recent one, and 10.16 asserts the count it expects
 * rather than trusting the window, so a row that fell off the back would fail
 * loudly instead of being quietly absent.
 *
 * Whole seconds, no milliseconds: `parse_since` hands the string to
 * `datetime.fromisoformat` and there is no reason to make it work harder.
 */
function deltaSince(): string {
  return new Date(Date.now() - 364 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * EVERY order this suite has ever made, keyed by its §6 mark — INCLUDING the
 * cancelled ones.
 *
 * ⚠ NOT `GET /v1/vikray/orders`. Cancelling sets `is_active=FALSE` and the
 * plain list filters on it, so six of these thirty-five are invisible there and
 * a second execution would report them missing and type them again. The delta
 * door deliberately drops that filter — "the delta must NOT apply the
 * `is_active=TRUE` filter, that row is exactly the change the device needs"
 * (`routers/vikray.py:183`) — so it is the only read that can see the whole
 * set. The window is `deltaSince()` above; the cap is 200 and thirty-five is
 * well inside it, which is asserted rather than assumed.
 */
async function myOrders(page: Page): Promise<Map<string, any>> {
  const rows = await apiRows(page, `/api/v1/vikray/orders?since=${encodeURIComponent(deltaSince())}`);
  expect(rows.length,
    'the delta list came back at its 200-row cap, so it is a page and not the whole set — ' +
    'every count below would be a floor rather than a total')
    .toBeLessThan(200);
  const out = new Map<string, any>();
  for (const r of rows) {
    const m = String(r?.notes || '').match(new RegExp(`${TAG}-SO-\\d{2}`));
    if (m) out.set(m[0], r);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// THE WIRE, AND THE CONSOLE
// ════════════════════════════════════════════════════════════════════════════

type Wire = string[];

/**
 * Every write this suite makes, with the status the server answered.
 *
 * Memory's rule, learned from the bank-import bug: watch the requests before
 * blaming the UI. That defect presented as "the button does nothing"; it was a
 * 500 on a `batch_id` that was not a UUID, and only a request listener told the
 * two apart. The browser even reported it as a CORS failure, because FastAPI's
 * CORS middleware attaches no headers to an unhandled 500. `vikray_targets`
 * .salesperson_id was the same shape and is one of the four shipped instances,
 * so this module is exactly where the listener earns its keep.
 */
function watchWire(page: Page): Wire {
  const wire: Wire = [];
  page.on('response', async (r) => {
    const req = r.request();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return;
    if (!/\/api\//.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 180); } catch { /* consumed */ }
    wire.push(`${req.method()} ${r.status()} ${new URL(r.url()).pathname}  ${body}`);
  });
  return wire;
}

const dumpWire = (w: Wire) =>
  w.length ? w.slice(-25).map((l) => '\n     ' + l).join('') : '\n     (no write request was made at all)';

type Watcher = { errors: { where: string; text: string }[]; at: (where: string) => void };

/** Console errors and uncaught exceptions, tagged with the screen they fell on. */
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

/** Every API response the page got back that was NOT 2xx, whatever the verb. */
type Failures = string[];
function watchFailures(page: Page): Failures {
  const out: Failures = [];
  page.on('response', async (r) => {
    if (r.status() < 400) return;
    if (!/\/api\//.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 300); } catch { /* consumed */ }
    const u = new URL(r.url());
    out.push(`${r.request().method()} ${r.status()} ${u.pathname}${u.search}  ${body}`);
  });
  return out;
}

const dumpFailures = (f: Failures) =>
  f.length ? f.map((l) => '\n     ' + l).join('') : '\n     (none)';

/**
 * The one console assertion every heavy write test makes.
 *
 * An UNCAUGHT exception is a broken screen and is asserted everywhere. A plain
 * `console.error` is reported and asserted only on the read-only sweeps,
 * because a single noisy log on one of thirty-five form submissions would
 * otherwise mask the data finding underneath it. Both are printed either way,
 * so nothing is hidden.
 */
function assertNoUncaught(c: Watcher) {
  const uncaught = c.errors.filter((e) => e.text.startsWith('UNCAUGHT'));
  expect(uncaught, `uncaught exception(s) on screen:${dumpConsole(c)}`).toHaveLength(0);
}

// ════════════════════════════════════════════════════════════════════════════
// SCREEN MACHINERY
// ════════════════════════════════════════════════════════════════════════════

/** Settle, but never fail on it — the shell polls, so networkidle may not come. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
}

/** The panel the active tab renders into — every locator is scoped to it. */
const panelOf = (page: Page, tab: string) => page.locator(`#mt-panel-${tab}`);

/** Land on Sales from scratch, whatever tab the account's prefs open on. */
async function gotoVikray(page: Page) {
  await page.goto('/vikray');
  await expect(page.locator('.mt__wrap'), 'the Sales tab strip never rendered')
    .toBeVisible({ timeout: 60_000 });
  await settle(page);
}

/**
 * Open one Vikray tab BY CLICKING IT, inline or out of the More popover.
 *
 * `ModuleTabs` measures how many tabs FIT and pushes the rest behind "More +N",
 * so which of the twelve is inline depends on the viewport at run time and is
 * not knowable from the source. Inline first, popover second, and a failure
 * that names the tab if it is in neither — an unreachable tab is a product
 * finding, not a selector problem.
 *
 * `VikrayPage` DOES read `?tab=` from the URL, unlike Ganit, and 10.01 proves
 * that door separately. It is not used here: clicking is what a person does,
 * and a tab reachable only by URL would still be a finding.
 */
async function openTab(page: Page, id: string, label: string) {
  if (!/^\/vikray\/?$/.test(new URL(page.url()).pathname)) {
    await gotoVikray(page);
  }
  const strip = page.locator('.mt__wrap');
  await expect(strip, 'the Sales tab strip never rendered').toBeVisible({ timeout: 60_000 });

  const already = panelOf(page, id);
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
    await expect(row.first(), `tab "${label}" is neither on the strip nor in the More menu — ` +
      'it is unreachable, which is a product finding and not a selector problem')
      .toBeVisible();
    await row.first().click();
  }

  await expect(
    panelOf(page, id),
    `the Sales "${id}" panel never rendered after its tab was clicked`,
  ).toBeVisible({ timeout: 60_000 });
  await settle(page);
  return panelOf(page, id);
}

/**
 * Press a control that writes, and WAIT FOR THE SERVER before going on.
 *
 * This is the fix for three of Suite 02's four failures on 2026-08-28: each
 * clicked Save and called `page.reload()` on the very next line, the reload
 * tore the page down with the request still in flight, the value read back
 * empty, and the suite reported "the product did not save it" about a product
 * that had. Returns the response so a caller asserts on the STATUS.
 */
async function saveAndWait(
  page: Page,
  act: () => Promise<void>,
  urlRe: RegExp,
  what: string,
  methods: string[] = ['POST', 'PUT', 'PATCH', 'DELETE'],
) {
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => urlRe.test(r.url()) && methods.includes(r.request().method()),
      { timeout: 90_000 },
    ),
    act(),
  ]);
  const body = await res.text().catch(() => '');
  expect(
    res.status(),
    `${what}: ${res.request().method()} ${new URL(res.url()).pathname} → ${res.status()}\n     ${body.slice(0, 400)}`,
  ).toBeLessThan(400);
  try { return JSON.parse(body); } catch { return {}; }
}

/** The same, but the caller EXPECTS a refusal and asserts on which one. */
async function refusal(
  page: Page,
  act: () => Promise<void>,
  urlRe: RegExp,
  methods: string[] = ['POST', 'PUT', 'PATCH', 'DELETE'],
) {
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => urlRe.test(r.url()) && methods.includes(r.request().method()),
      { timeout: 90_000 },
    ),
    act(),
  ]);
  return { status: res.status(), body: await res.text().catch(() => '') };
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
  if (value === '') {
    await input.press('Backspace');
    return;
  }
  await input.fill(value);
}

/**
 * Choose an option by its VISIBLE TEXT from a `<select>` that a fetch fills in.
 *
 * Reading the options straight after `settle()` catches the empty mount and
 * reports "no products to pick" against an org holding eighteen — a false
 * product finding, which is worse than a flake. Polls, matches on the option
 * TEXT, then selects by the option's `value`. The value is an id and is never
 * rendered or asserted.
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

/**
 * Choose a row from a `Picker` / `ServerPicker`, which is NOT a `<select>`.
 *
 * The control is `<button aria-haspopup="listbox" aria-label=…>` and the popup
 * is `.pk__pop` holding `[role="listbox"]` of `[role="option"]` buttons.
 * `ServerPicker` fetches for whatever is typed into the popup's own search box
 * and merges the answer into its items, so this TYPES rather than scrolling:
 * `GET /v1/graha/clients` is `LIMIT 200` and this org has 25, but a suite that
 * only reads page one would miss half of them the day it does not. The plain
 * `Picker` (the salesperson) has no search box and the branch is skipped.
 *
 * Returns the chosen row's visible text, so a caller asserts on the NAME it
 * picked without ever touching an id.
 */
async function pickInPicker(
  page: Page, scope: Locator, ariaLabel: string, what: string, match?: string,
): Promise<string> {
  const trigger = scope.locator(`button[aria-label="${ariaLabel}"]`).first();
  await expect(trigger, `the ${what} picker (aria-label "${ariaLabel}") is not on the form`)
    .toBeVisible();
  await trigger.click();

  const pop = page.locator('.pk__pop:not(.is-closing)').last();
  await expect(pop, `the ${what} picker did not open`).toBeVisible();

  if (match) {
    const search = pop.locator('input[aria-label="Search options"]');
    if (await search.count()) {
      await search.fill(match);
      // `ServerPicker` debounces at 250ms and merges what comes back. Waiting
      // for the ROW rather than for the request keeps this correct for the
      // plain `Picker`, which has no request to wait for.
      await page.waitForTimeout(600);
    }
  }

  const rows = pop.locator('[role="option"]');
  await expect
    .poll(async () => await rows.count(),
      { message: `the ${what} picker never loaded a single option`, timeout: 25_000 })
    .toBeGreaterThan(0);

  let row = rows.first();
  if (match) {
    const texts = await rows.allTextContents();
    const idx = texts.findIndex((t) => t.includes(match));
    expect(idx, `no ${what} option matching "${match}"; saw: ${texts.slice(0, 8).join(' | ')}`)
      .toBeGreaterThanOrEqual(0);
    row = rows.nth(idx);
  }
  const chosen = (await row.textContent() || '').trim();
  await row.click();
  await expect(pop, `the ${what} picker did not close after choosing`).toBeHidden({ timeout: 10_000 });
  return chosen;
}

/** Set a checkbox to a state, by clicking only when it is not already there. */
async function setCheckbox(box: Locator, on: boolean) {
  await expect(box).toBeVisible();
  if ((await box.isChecked()) !== on) await box.click();
  expect(await box.isChecked()).toBe(on);
}

/**
 * Set a `<DateInput>` from its own quick row — "Today" or "Next week".
 *
 * Faster than driving the calendar and just as real: they are the product's own
 * affordances and they are what a person actually presses for "today" and "a
 * week out". `setDate` from `_helpers` drives the grid and is used where the
 * target is neither.
 */
async function quickDate(scope: Locator, labelText: string, which: 'Today' | 'Tomorrow' | 'Next week') {
  const label = scope.locator('label', { hasText: labelText }).first();
  await label.locator('.pk--dt button.pk__tr').first().click();
  const pop = label.locator('.pk__pop');
  await expect(pop, `the "${labelText}" date picker did not open`).toBeVisible();
  await pop.locator('button.pk__q', { hasText: new RegExp(`^${which}$`) }).click();
  await expect(pop, `the "${labelText}" date picker did not close after "${which}"`)
    .toBeHidden({ timeout: 10_000 });
}

/** The ISO date `days` from today, in the browser's own calendar terms. */
function isoFromToday(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Close a record drawer and wait for it to finish animating out.
 *
 * ⚠ `getByRole('button', { name: 'Close' })` inside this drawer matches TWO
 * controls and is a strict-mode violation: the header's `×`, whose accessible
 * name is the `aria-label` "Close", and the advance button on a `delivered`
 * order, whose VISIBLE text is "Close order". They are different controls that
 * happen to share a word — one shuts the record, the other ends the ledger line
 * — so the drawer's is addressed by its class. This is the accessible-name trap
 * in miniature, and guessing wrong here reads as "the drawer would not close"
 * rather than as two matches.
 *
 * A toast can also sit on top of the header and swallow the click, so Escape —
 * which `OrderDetail` listens for on `window` — is the fallback, and it is a
 * real affordance rather than a workaround.
 */
async function closeDrawer(page: Page, drawer: Locator) {
  const close = drawer.locator('button.dr__ico[aria-label="Close"]');
  const clicked = (await close.count())
    ? await close.first().click({ timeout: 5_000 }).then(() => true).catch(() => false)
    : false;
  if (!clicked) await page.keyboard.press('Escape');
  await expect(drawer, 'the drawer did not close — the next click would land on its scrim')
    .toBeHidden({ timeout: 20_000 });
}

/**
 * Open one order's record drawer BY ITS DOCUMENT NUMBER, from the list.
 *
 * An order NUMBER is a business document reference, not an id — it is what the
 * customer is quoted and what the firm files under — so asserting on it breaks
 * no rule. No UUID is typed, matched or rendered anywhere here.
 *
 * `:text-is()` and not `hasText`: `hasText` is a substring match and
 * `SO-2026-0003` would also be found inside a longer number the day the series
 * passes four digits.
 */
async function openOrder(page: Page, p: Locator, orderNumber: string): Promise<Locator> {
  const row = p.locator(`button.vko__row:has(.vko__id:text-is("${orderNumber}"))`);
  await expect(row, `${orderNumber} is on the wire and not on the orders list`)
    .toBeVisible({ timeout: 30_000 });
  await row.click();
  const drawer = page.getByRole('dialog', { name: `Sales order ${orderNumber}` });
  await expect(drawer, `the record drawer for ${orderNumber} did not open`)
    .toBeVisible({ timeout: 30_000 });
  // The record fetches by id; the skeleton clears when the row lands.
  await expect(drawer.locator('.vkd__num'), `${orderNumber}'s record never loaded`)
    .toBeVisible({ timeout: 30_000 });
  return drawer;
}

/**
 * §6 — create only what is missing.
 *
 * Reads the live list first. A mark already present is VERIFIED and not typed
 * again, which is what makes a second execution recognise its own output rather
 * than double it. Returns how many it actually had to type, so a test can say
 * which half of §6 it exercised.
 */
async function ensure(
  wanted: number[],
  existing: Set<string>,
  markOf: (n: number) => string,
  create: (n: number) => Promise<void>,
): Promise<{ typed: number; found: number }> {
  let typed = 0;
  let found = 0;
  for (const n of wanted) {
    if (existing.has(markOf(n))) { found++; continue; }
    await create(n);
    typed++;
  }
  return { typed, found };
}

// ════════════════════════════════════════════════════════════════════════════
// THE PLAN — thirty-five orders, decided once, deterministically
// ════════════════════════════════════════════════════════════════════════════

type Lifecycle = 'draft' | 'confirmed' | 'dispatched' | 'delivered' | 'closed';

type OrderPlan = {
  n: number;
  mark: string;
  clientName: string;
  clientState: string;
  /** What the pair implies, derived — never a constant. */
  split: 'CGST+SGST' | 'IGST';
  salesperson: string;
  lines: { product: string; productIndex: number; qty: number }[];
  discount: number;
  /**
   * WHERE THE GOODS GO. §4: "Orders — cost price, salesperson, ship-to
   * address". `vikray_orders.shipping_address` is a live jsonb column that
   * `OrderCreate` has always accepted and that NO SCREEN COULD WRITE — the
   * defect 10.04 was written to report and that `_shared.shipToFields` now
   * closes. Derived from the customer's own city and state, because that is
   * where a delivery to that firm actually goes, with a per-order door number
   * so the address is distinct and deterministic run to run.
   */
  shipTo: { line1: string; line2: string; city: string; state: string; pincode: string };
  /** Where the order is left standing at the end of 10.06. */
  lifecycle: Lifecycle;
  cancel: boolean;
  invoice: boolean;
};

/**
 * The thirty-five orders, as a function of the live data rather than a table.
 *
 * The customers are Suite 04's twenty-five CRM companies, sorted by name and
 * cycled, so which company an order belongs to is the same on every run. The
 * salespeople are the org's own members, deduplicated by login and sorted by
 * name, likewise — `GET /org/members` returns nine rows for eight people
 * because one of them holds both `org_owner` and `org_admin`, and a target or
 * an order credited twice to one person would be the kind of double-count this
 * whole programme exists to catch.
 *
 * ── WHERE THE PLACE OF SUPPLY COMES FROM, AND WHY NOT THE GSTIN ────────────
 * From the client's ADDRESS state. s.12(2)(a) IGST Act puts the place of supply
 * at the recipient's location, and the address is the recipient's location as
 * this database records it. The GSTIN prefix encodes the same fact and would
 * normally agree — but on eight of Suite 04's twenty-five it does NOT (a `24`
 * Gujarat prefix at a Pune or Bengaluru address), and eight more carry no GSTIN
 * at all. Deriving from the prefix would therefore raise CGST+SGST on a supply
 * into Maharashtra and call it correct. The contradicting eight are printed by
 * 10.03 so the fixture defect is visible rather than absorbed.
 *
 * ── THE LIFECYCLE SPREAD ───────────────────────────────────────────────────
 * §4 asks for 6 cancelled and 10 converted to invoices out of 35. An order must
 * leave `draft` before it can be invoiced ("Confirm the order before generating
 * an invoice"), and only `draft` or `confirmed` may be cancelled — so the two
 * sets are disjoint by construction and the rest are spread across all five
 * states so that every stage of the pipeline has rows in it and the board in
 * 10.14 has something to reconcile.
 *
 *    1–10   confirmed (1–5 dispatched as well) → invoiced
 *   11–13   cancelled from DRAFT
 *   14–16   confirmed, then cancelled — the path that RETURNS stock
 *   17–21   confirmed
 *   22–25   dispatched
 *   26–29   delivered, and deliberately NOT invoiced, so the dashboard's
 *           "Delivered, not yet invoiced" attention flag has subjects
 *   30–32   closed
 *   33–35   left in draft, so the edit path in 10.05 has one to edit
 */
function planOrders(clients: any[], members: string[], homeState: string): OrderPlan[] {
  const usable = clients
    .filter((c) => String(c?.name || '').trim())
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  expect(usable.length, 'there are no CRM companies to raise an order against — Suite 04 ' +
    'creates twenty-five and this suite raises orders against them rather than making more')
    .toBeGreaterThan(0);
  expect(members.length, 'the member directory came back empty, so no order can credit a ' +
    'salesperson — `GET /v1/org/members` is org_admin+ and this lane holds org_admin')
    .toBeGreaterThan(0);

  const out: OrderPlan[] = [];
  for (let n = 1; n <= N_ORDERS; n++) {
    const c = usable[(n - 1) % usable.length];
    const clientState = String(c?.address?.state || '').trim();
    expect(clientState, `${c?.name} has no address state, so the place of supply cannot be ` +
      'derived and the GST split would be a guess').toBeTruthy();

    const productIndex = ((n - 1) % N_PRODUCTS) + 1;
    const lines = [{ product: productName(productIndex), productIndex, qty: 1 + (n % 4) }];
    // Every fifth order carries a second line, from the OTHER half of the
    // catalogue — so a document with a costed line and an uncosted line exists,
    // which is where "absent, never zero" is actually visible.
    if (n % 5 === 0) {
      const second = productIndex <= COSTED_PRODUCTS
        ? COSTED_PRODUCTS + ((n / 5) % (N_PRODUCTS - COSTED_PRODUCTS)) + 1
        : ((n / 5) % COSTED_PRODUCTS) + 1;
      lines.push({ product: productName(second), productIndex: second, qty: 2 });
    }

    const lifecycle: Lifecycle =
      n <= 5 ? 'dispatched'
        : n <= 10 ? 'confirmed'
          : n <= 13 ? 'draft'
            : n <= 16 ? 'confirmed'
              : n <= 21 ? 'confirmed'
                : n <= 25 ? 'dispatched'
                  : n <= 29 ? 'delivered'
                    : n <= 32 ? 'closed'
                      : 'draft';

    const addr = c?.address || {};
    out.push({
      n,
      mark: orderMark(n),
      clientName: String(c.name),
      clientState,
      shipTo: {
        // The mark rides in `line1`, so a stored address is traceable to the
        // order that carries it without a join — and §6 can tell its own
        // output from anybody else's.
        line1: `Unit ${pad(n)}, ${orderMark(n)} Receiving Bay`,
        line2: String(addr.line2 || addr.line1 || 'Industrial Estate').slice(0, 60),
        city: String(addr.city || clientState),
        // The customer's OWN state. Deliberately the same fact the GST split
        // is derived from, so an order whose ship-to contradicts its tax
        // treatment would be visible rather than plausible.
        state: clientState,
        pincode: String(addr.pincode || '').replace(/\D/g, '').slice(0, 6) || '395002',
      },
      split: expectedSplit(homeState, clientState),
      salesperson: members[(n - 1) % members.length],
      lines,
      // A flat order discount on every seventh, because that is the figure the
      // totals identity in 10.03 turns on and an order book with none of them
      // would never have asked the question.
      discount: n % 7 === 0 ? 5000 : 0,
      lifecycle,
      cancel: n >= 11 && n <= 16,
      invoice: n <= 10,
    });
  }
  return out;
}

/** The member directory, deduplicated by login and sorted, as NAMES. */
async function memberNames(page: Page): Promise<string[]> {
  const rows = await apiRows(page, '/api/v1/org/members');
  const byLogin = new Map<string, string>();
  for (const m of rows) {
    const id = String(m?.user_id || '');
    const name = String(m?.full_name || '').trim();
    // No email fallback, ever. A display-name ladder must never end at an
    // email (owner, 2026-08-23) and a suite that types one into a picker would
    // be putting a contact detail on a sales order.
    if (id && name && !byLogin.has(id)) byLogin.set(id, name);
  }
  return [...byLogin.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * A stored `shipping_address`, as an object, whichever shape it arrives in.
 *
 * `db.py` installs a jsonb decoder so this is normally a dict — but it logs
 * "set_type_codec failed after 3 attempts (PgBouncer)" as a real possibility,
 * and `AddressBlock` decodes the string case for exactly that reason. A suite
 * that read only the dict shape would report "the form is not sending it"
 * about a form that was, which is the wrong diagnosis.
 */
function asAddress(v: any): Record<string, any> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
  }
  return {};
}

/** The gross value of one planned line, before tax and before any discount. */
const lineGross = (li: { qty: number }, rate: number) => money(li.qty * rate);

// ════════════════════════════════════════════════════════════════════════════
// THE SUITE
// ════════════════════════════════════════════════════════════════════════════

test.describe('Suite 10 — Vikray (sales) · Unicode Group', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 10.01 · every screen is reachable, and every one says in words what it is
  // ──────────────────────────────────────────────────────────────────────────
  test('10.01 all 12 Sales tabs open, each says in words what it is, and the tab survives a link',
    async ({ page }) => {
      test.setTimeout(15 * 60_000);
      const con = watchConsole(page);
      const fails = watchFailures(page);
      await signIn(page);

      // The fence, recorded rather than asserted: this suite has no send
      // surface, and the log should say which world the run happened in.
      const health = await page.request.get(`${API}/api/health`);
      expect(health.status(), `GET /api/health → ${health.status()}`).toBe(200);
      const meta = await health.json();
      console.log(`\n  10.01 — outbound fence: mode=${meta.outbound_mode} ` +
        `digest=${meta.suppressed_orgs_digest}. Vikray has no send control on any of its ` +
        'twelve screens and Unicode Group has no armed Niyam rule, so this suite sends ' +
        'nothing either way.\n');

      await gotoVikray(page);

      const report: string[] = [];
      const unreadable: string[] = [];

      for (const t of TABS) {
        con.at(t.id);
        const p = await openTab(page, t.id, t.label);
        // A skeleton that never resolves is the defect this looks for: the
        // panel must settle into rows, or into words, and never stay a shimmer.
        await expect
          .poll(async () => {
            const text = (await p.innerText().catch(() => '')).trim();
            const skeleton = await p.locator('[class*="sk-"], .skeleton').count();
            return text.length > 0 && skeleton === 0 ? 'settled' : 'loading';
          }, {
            message: `the "${t.id}" panel never finished loading — a skeleton that never ` +
              'resolves is a lie that never stops telling itself',
            timeout: 45_000,
          })
          .toBe('settled');

        const text = (await p.innerText()).replace(/\s+/g, ' ').trim();
        if (text.length < 12) {
          unreadable.push(`${t.id}: the panel painted ${text.length} characters — ` +
            'a blank screen is indistinguishable from a broken one');
        }
        report.push(`     ${t.id.padEnd(14)} ${text.slice(0, 90)}`);
      }

      expect(unreadable, 'a Sales screen rendered nothing a person could read:\n     ' +
        unreadable.join('\n     ')).toEqual([]);

      // THE URL DOOR. `VikrayPage` reads its open tab from `?tab=`, which is
      // what makes a tab linkable and what makes a refresh keep the reader
      // where they were. Ganit does NOT do this and its suite says so; here it
      // is a real feature and it gets a real check.
      for (const t of ['stock', 'targets', 'customers']) {
        await page.goto(`/vikray?tab=${t}`);
        await expect(panelOf(page, t),
          `/vikray?tab=${t} did not open the ${t} panel — the tab is in the URL and the page ` +
          'is supposed to read it, so a shared link lands somewhere else')
          .toBeVisible({ timeout: 45_000 });
      }

      console.log(`\n  10.01 — 12 Sales screens opened:\n${report.join('\n')}\n` +
        `     non-2xx responses:${dumpFailures(fails)}\n` +
        `     console:${dumpConsole(con)}\n`);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.02 · a stock row for every catalogue entry, made by setting its threshold
  // ──────────────────────────────────────────────────────────────────────────
  test('10.02 eighteen catalogue entries each get a low-stock threshold, so the ledger has a row for each',
    async ({ page }) => {
      test.setTimeout(30 * 60_000);
      const con = watchConsole(page);
      const wire = watchWire(page);
      await signIn(page);
      con.at('stock');
      const p = await openTab(page, 'stock', 'stock');

      const catalogue = await apiRows(page, '/api/v1/products');
      const mine = catalogue.filter((r) => String(r.name || '').startsWith('S05 Product '));
      expect(mine.length,
        `the stock ledger is kept per product from the shared catalogue and Suite 05's ` +
        `${N_PRODUCTS} entries are what it is kept for; the catalogue holds ${mine.length} of them. ` +
        'This suite creates no products — the catalogue is one catalogue, mounted here and in ' +
        'Finance from one file.')
        .toBe(N_PRODUCTS);

      // ⚠ `GET /vikray/stock` LEFT JOINs the ledger onto the catalogue and
      // COALESCEs both numbers to 0, so a product with NO `vikray_stock` row is
      // indistinguishable from one holding nothing. A threshold is the field
      // that proves the row exists: it is only ever written by a person, and
      // the upsert that stores it is what creates the row.
      const threshold = (n: number) => 5 + n;   // distinct per product, never 0

      const before = await apiRows(page, '/api/v1/vikray/stock');
      expect(before.length, 'the stock ledger listed nothing at all').toBe(N_PRODUCTS);

      let typed = 0;
      let found = 0;
      for (let n = 1; n <= N_PRODUCTS; n++) {
        const name = productName(n);
        const row = before.find((r) => String(r.name) === name);
        expect(row, `${name} is in the catalogue and not on the stock ledger`).toBeTruthy();
        if (Number(row.low_stock_threshold) === threshold(n)) { found++; continue; }

        const input = p.locator(`input[aria-label="Low-stock threshold for ${name}"]`);
        await expect(input, `${name} has no threshold field on the ledger`).toBeVisible();
        await typeInto(input, String(threshold(n)));
        // The field commits on BLUR and shows its own saving/saved state — the
        // §8 point-2 fix. Blur it the way a person does and judge the server.
        await saveAndWait(page, async () => { await input.blur(); },
          /\/v1\/vikray\/stock\//, `setting the low-stock threshold on ${name}`, ['PATCH']);
        await expect(input.locator('xpath=..').locator('.vk-th__s'),
          `${name}'s threshold field did not say it saved`).toContainText(/Saved|Saving/);
        typed++;
      }

      const after = await apiRows(page, '/api/v1/vikray/stock');
      const withThreshold = after.filter((r) =>
        String(r.name || '').startsWith('S05 Product ') && Number(r.low_stock_threshold) > 0);
      expect(withThreshold.length,
        `§4 asks for ${N_STOCK_ITEMS} stock items and ${withThreshold.length} carry a threshold. ` +
        'A threshold is the only field on this screen that proves a `vikray_stock` row exists ' +
        `at all, because the list COALESCEs a missing row to zero.${dumpWire(wire)}`)
        .toBe(N_STOCK_ITEMS);

      // And the screen marks the ones that need somebody. A product at or below
      // its threshold carries the row class AND a Tag — §8 point 1 is that the
      // ROW is marked, not just a badge beside the name.
      await openTab(page, 'stock', 'stock');
      const low = after.filter((r) =>
        Number(r.low_stock_threshold) > 0 &&
        Number(r.quantity_on_hand) <= Number(r.low_stock_threshold));
      if (low.length) {
        await expect(p.locator('tr.is-low').first(),
          `${low.length} products are at or below their threshold and no row is marked low`)
          .toBeVisible({ timeout: 20_000 });
        const lowOnly = p.locator('.vk-bar__chk input[type=checkbox]');
        await setCheckbox(lowOnly, true);
        await settle(page);
        await expect
          .poll(async () => await p.locator('tbody tr:not(.vk-stk__exp)').count(),
            { message: 'the "Low stock only" filter did not narrow the ledger', timeout: 20_000 })
          .toBe(low.length);
        await setCheckbox(lowOnly, false);
      }

      console.log(`\n  10.02 — thresholds: ${typed} typed, ${found} already present ` +
        `(§6 idempotence); ${withThreshold.length}/${N_STOCK_ITEMS} stock rows; ` +
        `${low.length} at or below threshold\n`);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.03 · thirty-five sales orders, typed
  // ──────────────────────────────────────────────────────────────────────────
  test('10.03 thirty-five sales orders are typed, each crediting a salesperson and splitting GST on the state pair',
    async ({ page }) => {
      test.setTimeout(120 * 60_000);
      const con = watchConsole(page);
      const wire = watchWire(page);
      const fails = watchFailures(page);
      await signIn(page);

      // THE SUPPLIER'S STATE, READ LIVE. Never a constant — a suite that
      // hardcodes it cannot notice when the org's own registration changes.
      const profile = await apiOne(page, '/api/v1/org/profile');
      const homeState = String(profile?.billing_address?.state || '').trim();
      expect(homeState, 'the organisation profile carries no billing state, so the place of ' +
        'supply pair cannot be formed and every GST assertion below would be a guess')
        .toBeTruthy();
      const homeCode = GST_STATE_CODE[homeState];
      expect(homeCode, `"${homeState}" is not a GST state`).toBeTruthy();
      // The profile's own state code, cross-checked against the table above, so
      // a divergence between this spec's copy and the product's surfaces here.
      if (profile?.state_code) {
        expect(String(profile.state_code).padStart(2, '0'),
          `the org profile reports state_code ${profile.state_code} for ${homeState}, and the ` +
          `statutory code for ${homeState} is ${homeCode}`).toBe(homeCode);
      }

      const clients = await apiRows(page, '/api/v1/graha/clients');
      const members = await memberNames(page);
      const catalogue = await apiRows(page, '/api/v1/products');
      const rateOf = new Map<string, number>();
      const gstOf = new Map<string, number>();
      const costedNames = new Set<string>();
      for (const r of catalogue) {
        rateOf.set(String(r.name), Number(r.price) || 0);
        gstOf.set(String(r.name), Number(r.gst_rate) || 0);
        if (r.cost_price != null) costedNames.add(String(r.name));
      }

      const PLAN = planOrders(clients, members, homeState);

      // The fixture contradiction, printed rather than absorbed. It is Suite
      // 04's and it is already on the record; naming it here stops a reader
      // concluding that Vikray computed the split wrongly.
      const contradicting = clients
        .filter((c) => {
          const g = String(c?.gstin || '').trim();
          const st = String(c?.address?.state || '').trim();
          return g.length >= 2 && GST_STATE_CODE[st] && g.slice(0, 2) !== GST_STATE_CODE[st];
        })
        .map((c) => `${c.name} — GSTIN ${String(c.gstin).slice(0, 2)} at a ${c.address.state} address`);

      con.at('orders');
      let p = await openTab(page, 'orders', 'orders');

      const existing = await myOrders(page);

      async function createOrder(n: number) {
        const plan = PLAN[n - 1];
        p = await openTab(page, 'orders', 'orders');

        const bar = p.locator('.vk-bar__new');
        if (await bar.count()) {
          await bar.click();
        } else {
          // The very first order is raised from the empty state's own button,
          // which is the affordance a firm with no order book actually meets.
          await p.locator('.empty__act').getByRole('button', { name: /New order/ }).click();
        }
        const form = p.locator('form.vk-form').first();
        await expect(form, 'the new-order form did not open').toBeVisible({ timeout: 30_000 });

        // THE CUSTOMER IS THE COMPANY. A contact is who you speak to; contacts
        // leave and the customer stays.
        const chose = await pickInPicker(page, form, 'Customer', 'customer company', plan.clientName);
        expect(chose, `the customer picker chose "${chose}" and the plan asked for ` +
          `"${plan.clientName}"`).toContain(plan.clientName);

        // WHO MADE THE SALE. `vikray_orders.salesperson_id` is TEXT holding a
        // `users.user_id` — confirmed by live query, which matters because
        // `vikray_targets.salesperson_id` was a uuid column fed exactly this
        // kind of value and is one of the four shipped instances of that fault.
        await pickInPicker(page, form, 'Salesperson', 'salesperson', plan.salesperson);

        await quickDate(form, 'Order date', 'Today');
        // Three orders are given a delivery date in the PAST, so the dashboard's
        // "Delivery date passed" flag has a subject and the danger tone is
        // exercised as well as the warn one.
        if (n >= 33) {
          await setDate(form, 'Expected delivery', isoFromToday(-9));
        } else {
          await quickDate(form, 'Expected delivery', 'Next week');
        }

        // THE ONE PIECE OF GST LOGIC THAT MUST NOT BE GOT WRONG. Vikray offers
        // a bare checkbox and derives nothing; the derivation is this suite's.
        await setCheckbox(
          form.locator('label.vk-form__chk input[type=checkbox]'),
          plan.split === 'IGST');

        for (let i = 0; i < plan.lines.length; i++) {
          if (i > 0) {
            await form.getByRole('button', { name: '+ Add line item' }).click();
          }
          const li = plan.lines[i];
          // The catalogue picker writes `product_id` FIRST and that is the
          // whole point: `_apply_stock_moves` skips any line without one, so an
          // order typed by hand looks catalogued and moves nothing.
          await pickByLabel(
            form.locator(`select[aria-label="Line ${i + 1} — pick from catalogue"]`),
            li.product, `line ${i + 1} catalogue`);
          await typeInto(form.locator(`input[aria-label="Line ${i + 1} quantity"]`), String(li.qty));
        }

        // ── WHERE THE GOODS GO ────────────────────────────────────────────
        // §4 asks every order to carry a ship-to address. The column has always
        // been writable and no screen could write it, which is what 10.04
        // reported; these are the five inputs that closed it. Scoped to the
        // form's own `Ship to` group, because "Address line 1" and "City" are
        // words that appear on other surfaces of this page.
        const ship = form.locator('[role="group"][aria-label="Ship to"]');
        await expect(ship, 'the new-order form offers no ship-to address. §4 asks every order ' +
          'to carry one and `OrderCreate.shipping_address` has always accepted it — a column ' +
          'the API can write and a human cannot is a MISSING CONTROL, not a skip.')
          .toBeVisible({ timeout: 20_000 });
        for (const [label, value] of [
          ['address line 1', plan.shipTo.line1],
          ['address line 2', plan.shipTo.line2],
          ['city', plan.shipTo.city],
          ['state', plan.shipTo.state],
          ['pincode', plan.shipTo.pincode],
        ] as [string, string][]) {
          await typeInto(ship.locator(`input[aria-label="Ship to ${label}"]`), value);
        }

        if (plan.discount) {
          await typeInto(
            form.locator('label.fld', { hasText: 'Order discount' }).locator('input.inp'),
            String(plan.discount));
        }

        await typeInto(
          form.locator('label.fld', { hasText: 'Notes' }).locator('textarea'),
          `${plan.mark} · ${plan.clientState} · seeded ${RUN}`);

        const made = await saveAndWait(page, async () => {
          await form.locator('button[type=submit]').click();
        }, /\/v1\/vikray\/orders$/, `raising ${plan.mark}`, ['POST']);
        expect(made?.order_number, `${plan.mark} was created and the response carried no order ` +
          'number, so nothing on the list can be found by it').toBeTruthy();

        // ⚠ CREATING AN ORDER NAVIGATES. `onCreated` opens the record over the
        // list; the next create would click its scrim.
        const drawer = page.getByRole('dialog', { name: `Sales order ${made.order_number}` });
        await expect(drawer, `the record for ${made.order_number} did not open after it was raised`)
          .toBeVisible({ timeout: 30_000 });
        await closeDrawer(page, drawer);
      }

      const made = await ensure(
        PLAN.map((o) => o.n), new Set(existing.keys()), orderMark, createOrder);

      // ── the read-back, which is the evidence ────────────────────────────
      const orders = await myOrders(page);
      expect(orders.size, `§4 asks for ${N_ORDERS} sales orders and the delta list holds ` +
        `${orders.size} carrying this suite's mark${dumpWire(wire)}`).toBe(N_ORDERS);

      const problems: string[] = [];
      /** Plan slots that no longer name the company their order was raised for. */
      const drifted: string[] = [];
      /** The CRM companies by id, so the pair comes off the STORED order. */
      const clientById = new Map<string, any>(clients.map((c) => [String(c.id), c]));
      let costedLines = 0;
      let uncostedLines = 0;
      let intra = 0;
      let inter = 0;
      let nilRated = 0;

      for (const plan of PLAN) {
        const row = orders.get(plan.mark);
        if (!row) { problems.push(`${plan.mark}: not on the register at all`); continue; }
        const full = await apiOne(page, `/api/v1/vikray/orders/${row.id}`);
        const items = Array.isArray(full.line_items)
          ? full.line_items
          : JSON.parse(String(full.line_items || '[]'));

        // ── the salesperson ────────────────────────────────────────────────
        if (!full.salesperson_id) {
          problems.push(`${plan.mark}: no salesperson recorded, though one was chosen from the ` +
            'picker — this is the column the leaderboard and commission read');
        }

        // ── the cost price: ABSENT, NEVER ZERO ─────────────────────────────
        for (const li of items) {
          const name = String(li.description || '');
          const shouldCost = costedNames.has(name);
          const has = Object.prototype.hasOwnProperty.call(li, 'cost_price');
          if (shouldCost) {
            costedLines++;
            if (!has || typeof li.cost_price !== 'number') {
              problems.push(`${plan.mark}: "${name}" comes from a costed catalogue entry and the ` +
                `line carries cost_price=${JSON.stringify(li.cost_price)}. Migration 184's ` +
                'contract is a number stamped at the moment the line was written.');
            }
          } else {
            uncostedLines++;
            if (has) {
              problems.push(`${plan.mark}: "${name}" has no recorded cost and the line carries ` +
                `cost_price=${JSON.stringify(li.cost_price)}. Absent means NOT RECORDED and must ` +
                'never be read as zero — a zero reports the whole catalogue as pure profit.');
            }
          }
        }

        // ── the GST split, taken from the pair ON THE STORED ORDER ───────
        //
        // ⚠ NOT FROM `plan.split`, AND THAT WAS A TEST BUG.
        //
        // `planOrders` cycles the CRM companies by sorted name, and that
        // mapping is only true at the moment an order is created. Let the
        // client list change by one row — a company added, renamed or archived
        // by any suite — and every later slot shifts, so a second execution
        // compares an order against a customer it was never raised for.
        // Measured 2026-08-29 across two runs: the list went from 25 companies
        // to 26, the plan then said `S10-SO-32` was for a Tamil Nadu customer
        // and demanded IGST, and the stored order names `S04 Client 07 Surat`
        // — Gujarat — carrying CGST=SGST correctly. The product was right and
        // the expectation had drifted underneath it.
        //
        // `plan.clientState` survives only in the drift log below, where a
        // divergence is worth SEEING and is not something to assert on.
        const soldTo = clientById.get(String(full.client_id || ''));
        const soldToState = String(soldTo?.address?.state || '').trim();
        if (!soldToState) {
          problems.push(`${plan.mark}: the stored order names no company with an address ` +
            'state, so the place of supply cannot be derived from the row itself');
          continue;
        }
        if (soldToState !== plan.clientState) {
          drifted.push(`${plan.mark}: raised for ${soldTo?.name} (${soldToState}); this run's ` +
            `plan slot names ${plan.clientName} (${plan.clientState})`);
        }
        const split = expectedSplit(homeState, soldToState);

        const cgst = money(full.cgst);
        const sgst = money(full.sgst);
        const igst = money(full.igst);

        // ⚠ A NIL-RATED SUPPLY BEARS NO TAX, AND DEMANDING A POSITIVE ONE IS
        //   AN ASSERTION THAT IS RED AND WRONG.
        //
        // Six of Suite 05's eighteen catalogue entries carry `gst_rate = 0`.
        // An order whose every line is zero-rated correctly stores CGST 0,
        // SGST 0 and IGST 0 — there is no tax to place in any column — and
        // this demanded `igst > 0` and reported five such orders as defects.
        // What the split is about is WHICH column carries the tax when there
        // is some; where the lines carry none, the only true assertion is
        // that all three are nil.
        const taxDue = money(items.reduce((n: number, li: any) =>
          n + (Number(li.quantity) || 0) * (Number(li.rate) || 0) *
          (1 - (Number(li.discount_pct) || 0) / 100) * (Number(li.gst_rate) || 0) / 100, 0));

        if (taxDue === 0) {
          nilRated++;
          if (cgst !== 0 || sgst !== 0 || igst !== 0) {
            problems.push(`${plan.mark}: every line is zero-rated, so the supply bears no GST ` +
              `at all. Stored: CGST ${cgst}, SGST ${sgst}, IGST ${igst}.`);
          }
        } else if (split === 'CGST+SGST') {
          intra++;
          if (!(cgst > 0 && sgst > 0) || !near(cgst, sgst, 0.01) || igst !== 0) {
            problems.push(`${plan.mark}: supplier in ${homeState}, customer in ${soldToState} ` +
              `— an INTRA-State supply bearing CGST=SGST with IGST nil (s.8 IGST Act). ` +
              `Stored: CGST ${cgst}, SGST ${sgst}, IGST ${igst}.`);
          }
        } else {
          inter++;
          if (!(igst > 0) || cgst !== 0 || sgst !== 0) {
            problems.push(`${plan.mark}: supplier in ${homeState}, customer in ${soldToState} ` +
              `— an INTER-State supply bearing IGST alone (s.7 IGST Act). ` +
              `Stored: CGST ${cgst}, SGST ${sgst}, IGST ${igst}.`);
          }
        }

        // ── the tax is the sum of the lines' own tax ───────────────────────
        const gross = items.reduce((s: number, li: any) =>
          s + (Number(li.quantity) || 0) * (Number(li.rate) || 0) *
          (1 - (Number(li.discount_pct) || 0) / 100), 0);
        const lineTax = items.reduce((s: number, li: any) =>
          s + (Number(li.quantity) || 0) * (Number(li.rate) || 0) *
          (1 - (Number(li.discount_pct) || 0) / 100) * (Number(li.gst_rate) || 0) / 100, 0);
        if (!near(cgst + sgst + igst, money(lineTax), 0.05)) {
          problems.push(`${plan.mark}: the tax stored is ${money(cgst + sgst + igst)} and the ` +
            `lines carry ${money(lineTax)}`);
        }

        // ── THE IDENTITY EVERY MONEY DOCUMENT OBEYS ───────────────────────
        // subtotal + tax − discount = total. Ganit's invoices obey it
        // (`_compute_invoice`: subtotal is GROSS and the discount is taken off
        // the total). Vikray's `_compute_order_totals` stores `subtotal`
        // ALREADY NET of the discount and then adds tax to it, so the discount
        // is deducted in the subtotal and shown a second time as its own line —
        // and `OrderDetail`'s totals block prints all five figures together.
        const disc = money(full.discount);
        const sub = money(full.subtotal);
        const total = money(full.total);
        if (!near(sub + cgst + sgst + igst - disc, total, 0.05)) {
          problems.push(`${plan.mark}: subtotal ${sub} + tax ${money(cgst + sgst + igst)} − ` +
            `discount ${disc} = ${money(sub + cgst + sgst + igst - disc)}, and the order's ` +
            `total is ${total}. The gross line value is ${money(gross)}, so the stored subtotal ` +
            'is already net of the discount and the discount is then shown again — the five ' +
            "figures in the record drawer's totals block do not add up on screen.");
        }
      }

      console.log(`\n  10.03 — orders: ${made.typed} typed, ${made.found} already present ` +
        `(§6 idempotence); ${orders.size}/${N_ORDERS} on the register\n` +
        `     supplier state: ${homeState} (${homeCode}), read from the live org profile\n` +
        `     GST split from the pair ON THE STORED ORDER: ${intra} intra-State, ${inter} inter-State, ${nilRated} bearing no GST (every line zero-rated)\n` +
        `     line costs: ${costedLines} from costed catalogue entries, ${uncostedLines} from ` +
        'entries with no recorded cost\n' +
        (drifted.length
          ? `     ⚠ ${drifted.length} plan slots no longer name the company their order was raised for — the client\n       cycle shifted between runs, so the pair was taken from the ROW:\n       ${drifted.join('\n       ')}\n`
          : '') +
        (contradicting.length
          ? `     ⚠ Suite 04 fixture, NOT a Vikray fault — ${contradicting.length} clients whose ` +
            `GSTIN state prefix contradicts their address:\n       ${contradicting.join('\n       ')}\n` +
            '       This suite derives the place of supply from the ADDRESS (s.12(2)(a) IGST Act).\n'
          : '') +
        `     non-2xx responses:${dumpFailures(fails)}\n`);

      expect(problems, `an order was stored differently from what the pair, the catalogue or the ` +
        `arithmetic requires:\n     ${problems.join('\n     ')}`).toEqual([]);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.04 · the ship-to address §4 requires
  // ──────────────────────────────────────────────────────────────────────────
  test('10.04 every order carries the ship-to address §4 asks for, and the record can correct it',
    async ({ page }) => {
      test.setTimeout(30 * 60_000);
      const con = watchConsole(page);
      const wire = watchWire(page);
      await signIn(page);
      con.at('orders');
      const p = await openTab(page, 'orders', 'orders');

      // ── THE CONTROL ON THE CREATE FORM ────────────────────────────────
      // A missing control is a FAILURE, never a skip (suite rule 1). Until
      // 2026-08-29 this test reported the ABSENCE: `OrderForm` held
      // `shipping_address: {}` in form state and rendered no input for it, so
      // `OrderDetail`'s "Ship to" section — guarded on `addressLines(...)` —
      // could never appear for a row a person created. Live at the time: of
      // 380 orders in `reseed_backup_20260828`, 358 carried `{}` or NULL and
      // the 22 that did not were written by an API caller. A column the API can
      // write and a human cannot is the same shape as the vendor address
      // before 8.0. It now has five inputs; this is what holds them there.
      await p.locator('.vk-bar__new').click();
      const form = p.locator('form.vk-form').first();
      await expect(form, 'the new-order form did not open').toBeVisible({ timeout: 30_000 });

      const FIELDS = ['address line 1', 'address line 2', 'city', 'state', 'pincode'];
      const missingOnCreate: string[] = [];
      const createGroup = form.locator('[role="group"][aria-label="Ship to"]');
      if (!await createGroup.count()) {
        missingOnCreate.push('the whole Ship to group');
      } else {
        for (const f of FIELDS) {
          if (!await createGroup.locator(`input[aria-label="Ship to ${f}"]`).count()) {
            missingOnCreate.push(f);
          }
        }
      }
      await form.getByRole('button', { name: 'Cancel' }).click();

      // ── AND ON THE RECORD, WHICH IS WHERE AN ADDRESS IS CORRECTED ─────
      const orders = await myOrders(page);
      expect(orders.size, `10.03 raises ${N_ORDERS} orders and ${orders.size} carry its mark — ` +
        'this test reads them rather than raising its own').toBe(N_ORDERS);
      const draft = orders.get(orderMark(34));
      expect(draft, `${orderMark(34)} is meant to be left in draft by 10.03 and is not on the ` +
        'register, so the edit path has nothing to open').toBeTruthy();

      const drawer = await openOrder(page, p, String(draft.order_number));
      await drawer.getByRole('button', { name: 'Edit', exact: true }).click();
      const editForm = drawer.locator('form.dr__sec');
      await expect(editForm, 'the edit form did not open on the record').toBeVisible();

      const editGroup = editForm.locator('[role="group"][aria-label="Ship to"]');
      const missingOnEdit: string[] = [];
      if (!await editGroup.count()) {
        missingOnEdit.push('the whole Ship to group');
      } else {
        for (const f of FIELDS) {
          if (!await editGroup.locator(`input[aria-label="Ship to ${f}"]`).count()) {
            missingOnEdit.push(f);
          }
        }
      }

      expect([...missingOnCreate.map((f) => `create form: ${f}`),
        ...missingOnEdit.map((f) => `record edit form: ${f}`)],
      '§4 asks every sales order to carry a SHIP-TO ADDRESS, and a screen that cannot write ' +
      'one leaves `vikray_orders.shipping_address` reachable only by an API caller. ' +
      '`OrderCreate` and `OrderUpdate` have both accepted the field since they were written and ' +
      '`OrderDetail` already renders a "Ship to" block off it — the input is the only thing that ' +
      'was ever missing:').toEqual([]);

      // ── THE EDIT IS A REAL EDIT, judged on the CANONICAL ROW ──────────
      // A per-run city, so this proves a WRITE rather than re-reading what
      // 10.03 typed. The address is otherwise left as the plan made it.
      const corrected = `Ship-corrected ${RUN}`;
      await typeInto(editGroup.locator('input[aria-label="Ship to address line 2"]'), corrected);
      await saveAndWait(page, async () => {
        await editForm.getByRole('button', { name: /^Save changes/ }).click();
      }, new RegExp(`/v1/vikray/orders/${draft.id}$`), `correcting ${orderMark(34)}'s ship-to`,
      ['PATCH']);
      await closeDrawer(page, drawer);

      // Suite rule 3: the POST/PATCH echo is not the record. Fetch the row.
      const after = await apiOne(page, `/api/v1/vikray/orders/${draft.id}`);
      expect(String(asAddress(after?.shipping_address).line2 || ''),
        `${orderMark(34)}'s ship-to line 2 was corrected on the record's own edit form and the ` +
        'stored row does not carry it — `OrderUpdate.shipping_address` is accepted by the ' +
        'endpoint, so a value that does not arrive means the form is not sending it')
        .toBe(corrected);

      // ── AND EVERY ORDER §4 ASKED FOR CARRIES ONE ──────────────────────
      const problems: string[] = [];
      for (const [mark, row] of orders) {
        const a = asAddress(row?.shipping_address);
        const usable =
          ['line1', 'line2', 'city', 'state', 'pincode'].some((k) => String(a[k] ?? '').trim());
        if (!usable) {
          problems.push(`${mark}: no ship-to address on the stored row ` +
            `(${JSON.stringify(a)})`);
        }
      }

      // The section that could never appear, seen on a real record.
      const shown = await openOrder(page, p, String(draft.order_number));
      await expect(shown.locator('.dr__lbl', { hasText: /^Ship to/ }).first(),
        `${orderMark(34)} carries a ship-to address and the record does not print it — ` +
        '`OrderDetail` guards the block on `addressLines(...).length`, so a heading that never ' +
        'appears means nothing readable reached the column')
        .toBeVisible({ timeout: 20_000 });
      await closeDrawer(page, shown);

      console.log('\n  10.04 — the ship-to address:\n' +
        `     create form fields present: ${FIELDS.length - missingOnCreate.length}/${FIELDS.length}\n` +
        `     record edit fields present: ${FIELDS.length - missingOnEdit.length}/${FIELDS.length}\n` +
        `     orders carrying an address: ${orders.size - problems.length}/${orders.size}\n`);

      expect(problems, '§4 asks EVERY order to carry a ship-to address:\n     ' +
        problems.join('\n     ') + dumpWire(wire)).toEqual([]);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.05 · editing a draft, refusing to edit anything else
  // ──────────────────────────────────────────────────────────────────────────
  test('10.05 a draft order can be edited, a confirmed one cannot, and the list behind the record stays put',
    async ({ page }) => {
      test.setTimeout(30 * 60_000);
      const con = watchConsole(page);
      const wire = watchWire(page);
      await signIn(page);
      con.at('orders');
      const p = await openTab(page, 'orders', 'orders');

      const orders = await myOrders(page);
      const draft = orders.get(orderMark(33));
      expect(draft, `${orderMark(33)} is meant to be left in draft by 10.03 and is not on the ` +
        'register').toBeTruthy();

      const findings: string[] = [];

      // ── THE TAB BEHIND THE RECORD ─────────────────────────────────────
      // `OrderRoute.jsx` exists so the list stays mounted underneath: "the list
      // behind the record is the same one the reader left". `orderPath()` is
      // `/vikray/orders/<id>` with NO query, and `VikrayPage` reads its open tab
      // from `?tab=` — so opening an order from the orders list drops the tab
      // and the page underneath falls back to the starred default.
      const drawer = await openOrder(page, p, String(draft.order_number));
      const stillOrders = await panelOf(page, 'orders').count()
        && await panelOf(page, 'orders').isVisible().catch(() => false);
      const url = new URL(page.url());
      if (!stillOrders) {
        const openPanel = await page.locator('[id^="mt-panel-"]').first().getAttribute('id');
        findings.push(
          `opening an order navigated to ${url.pathname}${url.search || ' (no query)'} and the ` +
          `panel behind the drawer is now "${openPanel}" rather than the orders list the reader ` +
          'came from. `orderPath()` drops the `?tab=` the page reads its open tab from, so a ' +
          'shared link and a refresh both land on the starred default — which is the exact loss ' +
          "`OrderRoute.jsx`'s own header says the nested route exists to prevent.");
      }

      // ── the edit itself ────────────────────────────────────────────────
      await drawer.getByRole('button', { name: 'Edit', exact: true }).click();
      const editForm = drawer.locator('form.dr__sec');
      await expect(editForm, 'Edit did not open a form on the record').toBeVisible();

      const newNotes = `${orderMark(33)} · amended ${RUN}`;
      await typeInto(editForm.locator('textarea.vkd__ta'), newNotes);
      const newQty = 9;
      await typeInto(editForm.locator('input[aria-label="Line 1 quantity"]'), String(newQty));

      const saved = await saveAndWait(page, async () => {
        await editForm.getByRole('button', { name: /^Sav/ }).click();
      }, /\/v1\/vikray\/orders\/[0-9a-f-]+$/, `editing ${draft.order_number}`, ['PATCH']);

      // THE CANONICAL ROW, not the echo. A PATCH answers the row here, but the
      // rule stands: what is asserted is what the record endpoint returns.
      const after = await apiOne(page, `/api/v1/vikray/orders/${draft.id}`);
      expect(String(after.notes), 'the amended notes did not survive the edit').toContain(newNotes);
      const items = Array.isArray(after.line_items)
        ? after.line_items : JSON.parse(String(after.line_items || '[]'));
      expect(Number(items[0]?.quantity), 'the amended quantity did not survive the edit')
        .toBe(newQty);
      expect(saved?.id, 'the edit answered no row').toBeTruthy();

      // The cost carried rather than being re-resolved: an edit REPLACES every
      // line, and re-reading the catalogue would re-price a January order at
      // today's cost. A product already on the order keeps what it was written
      // with — asserted by the key still being a number, on the same product.
      const cataloguedLine = items.find((li: any) => li.product_id);
      if (cataloguedLine && Object.prototype.hasOwnProperty.call(cataloguedLine, 'cost_price')) {
        expect(typeof cataloguedLine.cost_price,
          'the line carried a cost before the edit and no longer carries a number')
          .toBe('number');
      }
      await closeDrawer(page, drawer);

      // ── and a confirmed order refuses ──────────────────────────────────
      const confirmed = [...orders.values()]
        .find((o) => o.status === 'confirmed' || o.status === 'dispatched');
      if (confirmed) {
        const d2 = await openOrder(page, await openTab(page, 'orders', 'orders'),
          String(confirmed.order_number));
        const edit = d2.getByRole('button', { name: 'Edit', exact: true });
        expect(await edit.count(),
          `${confirmed.order_number} is ${confirmed.status} and the record still offers Edit. ` +
          'The server refuses a PATCH on anything but a draft ("Only draft orders can be edited"), ' +
          'so an Edit button here is a control that can only ever 400.')
          .toBe(0);
        await closeDrawer(page, d2);
      }

      console.log(`\n  10.05 — ${draft.order_number} edited in place; ` +
        `${confirmed ? `${confirmed.order_number} (${confirmed.status}) offers no Edit` : 'no non-draft order to check'}` +
        `${dumpWire(wire)}\n`);

      expect(findings, `the record route lost the reader's place:\n     ${findings.join('\n     ')}`)
        .toEqual([]);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.06 · the lifecycle
  // ──────────────────────────────────────────────────────────────────────────
  test('10.06 an order walks draft → confirmed → dispatched → delivered → closed, and no step may be skipped',
    async ({ page }) => {
      test.setTimeout(120 * 60_000);
      const con = watchConsole(page);
      const wire = watchWire(page);
      await signIn(page);
      con.at('orders');
      let p = await openTab(page, 'orders', 'orders');

      const FLOW: Lifecycle[] = ['draft', 'confirmed', 'dispatched', 'delivered', 'closed'];
      const ADVANCE: Record<string, string> = {
        draft: 'Confirm order',
        confirmed: 'Mark dispatched',
        dispatched: 'Mark delivered',
        delivered: 'Close order',
      };

      const clients = await apiRows(page, '/api/v1/graha/clients');
      const members = await memberNames(page);
      const profile = await apiOne(page, '/api/v1/org/profile');
      const PLAN = planOrders(clients, members, String(profile?.billing_address?.state || ''));

      const orders = await myOrders(page);
      const problems: string[] = [];
      let advanced = 0;

      for (const plan of PLAN) {
        // The cancelled six are 10.07's; a closed order has nowhere to go.
        if (plan.cancel) continue;
        const row = orders.get(plan.mark);
        if (!row) { problems.push(`${plan.mark}: not on the register`); continue; }
        if (row.status === plan.lifecycle) continue;      // §6 — already there

        p = await openTab(page, 'orders', 'orders');
        const drawer = await openOrder(page, p, String(row.order_number));

        let status = String(row.status);
        while (FLOW.indexOf(status as Lifecycle) < FLOW.indexOf(plan.lifecycle)) {
          const label = ADVANCE[status];
          const btn = drawer.getByRole('button', { name: label, exact: true });
          await expect(btn, `${row.order_number} is ${status} and offers no "${label}" — the ` +
            'pipeline is shown as a line and the only legal move is the next one, so its ' +
            'control has to be there').toBeVisible({ timeout: 20_000 });
          await saveAndWait(page, async () => { await btn.click(); },
            /\/v1\/vikray\/orders\/[0-9a-f-]+\/status$/,
            `advancing ${row.order_number} out of ${status}`, ['PATCH']);
          status = FLOW[FLOW.indexOf(status as Lifecycle) + 1];
          advanced++;
          // The record refetches after the write; the pipeline bar is the
          // reader's evidence that it moved, so it is what is waited on.
          await expect(drawer.locator('.dr__pipe-wrap'),
            `${row.order_number}'s pipeline bar disappeared after an advance`)
            .toBeVisible({ timeout: 20_000 });
        }
        await closeDrawer(page, drawer);
      }

      // ── the read-back ──────────────────────────────────────────────────
      const after = await myOrders(page);
      const byState: Record<string, number> = {};
      for (const plan of PLAN) {
        const row = after.get(plan.mark);
        if (!row) { problems.push(`${plan.mark}: not on the register after the walk`); continue; }
        if (plan.cancel) continue;
        byState[String(row.status)] = (byState[String(row.status)] || 0) + 1;
        if (String(row.status) !== plan.lifecycle) {
          problems.push(`${plan.mark}: left at "${row.status}" and the plan walks it to ` +
            `"${plan.lifecycle}"`);
        }
      }

      // ── AND NO STEP MAY BE SKIPPED ─────────────────────────────────────
      // The UI offers exactly one forward move, which is the point of drawing
      // the pipeline rather than one button whose label changes. That the
      // SERVER refuses the others is asserted on a real order rather than
      // assumed from `_VALID_TRANSITIONS`: a screen that only shows the legal
      // move and a server that only accepts it are two different guarantees.
      const closed = [...after.values()].find((o) => o.status === 'closed');
      if (closed) {
        const p2 = await openTab(page, 'orders', 'orders');
        const d = await openOrder(page, p2, String(closed.order_number));
        const anyAdvance = await d.locator('.vkd__acts button.btn--fill').count();
        expect(anyAdvance, `${closed.order_number} is closed — the end of the line — and the ` +
          'record still offers a forward move').toBe(0);
        await closeDrawer(page, d);
      }

      console.log(`\n  10.06 — ${advanced} advances typed; order book by state: ` +
        `${Object.entries(byState).map(([k, v]) => `${k} ${v}`).join(' · ')}${dumpWire(wire)}\n`);

      expect(problems, `the lifecycle did not land where it was walked:\n     ` +
        problems.join('\n     ')).toEqual([]);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.07 · cancellation, and the stock it returns
  // ──────────────────────────────────────────────────────────────────────────
  test('10.07 six orders are cancelled, and cancelling a confirmed one returns its stock',
    async ({ page }) => {
      test.setTimeout(60 * 60_000);
      const con = watchConsole(page);
      const wire = watchWire(page);
      await signIn(page);
      con.at('orders');
      let p = await openTab(page, 'orders', 'orders');

      const clients = await apiRows(page, '/api/v1/graha/clients');
      const members = await memberNames(page);
      const profile = await apiOne(page, '/api/v1/org/profile');
      const PLAN = planOrders(clients, members, String(profile?.billing_address?.state || ''));
      const toCancel = PLAN.filter((o) => o.cancel);
      expect(toCancel.length, '§4 asks for six cancelled orders and the plan names ' +
        `${toCancel.length}`).toBe(N_CANCELLED);

      const orders = await myOrders(page);
      const stockBefore = new Map<string, number>(
        (await apiRows(page, '/api/v1/vikray/stock'))
          .map((r) => [String(r.name), Number(r.quantity_on_hand)]));

      const problems: string[] = [];
      let cancelled = 0;
      let alreadyCancelled = 0;
      const restocked: string[] = [];

      for (const plan of toCancel) {
        const row = orders.get(plan.mark);
        if (!row) { problems.push(`${plan.mark}: not on the register`); continue; }
        if (String(row.status) === 'cancelled') { alreadyCancelled++; continue; }

        // 14–16 are confirmed FIRST, so the cancellation walks the path that
        // returns stock. 11–13 are cancelled straight out of draft, where there
        // is nothing to return.
        p = await openTab(page, 'orders', 'orders');
        let drawer = await openOrder(page, p, String(row.order_number));
        if (plan.n >= 14 && String(row.status) === 'draft') {
          await saveAndWait(page, async () => {
            await drawer.getByRole('button', { name: 'Confirm order', exact: true }).click();
          }, /\/v1\/vikray\/orders\/[0-9a-f-]+\/status$/,
            `confirming ${row.order_number} before cancelling it`, ['PATCH']);
          await expect(drawer.getByRole('button', { name: 'Mark dispatched', exact: true }),
            `${row.order_number} did not move to confirmed`).toBeVisible({ timeout: 20_000 });
        }

        const wasConfirmed = plan.n >= 14;
        if (wasConfirmed) restocked.push(plan.lines[0].product);

        // ⚠ "Cancel order" NAMES TWO CONTROLS — the drawer's danger button and
        // the confirm dialog's confirm button. The second is scoped to the
        // alertdialog, or the click re-opens the dialog it is meant to accept.
        await drawer.getByRole('button', { name: 'Cancel order', exact: true }).click();
        const confirmDialog = page.getByRole('alertdialog');
        await expect(confirmDialog, 'cancelling did not ask for confirmation — a soft delete ' +
          'with no confirmation is one misclick from a withdrawn order')
          .toBeVisible({ timeout: 20_000 });
        await expect(confirmDialog, 'the confirmation does not say what cancelling does')
          .toContainText(/cannot be undone/i);
        await saveAndWait(page, async () => {
          await confirmDialog.getByRole('button', { name: 'Cancel order', exact: true }).click();
        }, /\/v1\/vikray\/orders\/[0-9a-f-]+$/, `cancelling ${row.order_number}`, ['DELETE']);
        cancelled++;
        await expect(drawer, 'the record stayed open after the order was withdrawn')
          .toBeHidden({ timeout: 30_000 });
      }

      // ── the read-back ──────────────────────────────────────────────────
      const after = await myOrders(page);
      const nowCancelled = toCancel.filter((plan) => {
        const row = after.get(plan.mark);
        return row && String(row.status) === 'cancelled' && row.is_active === false;
      });
      expect(nowCancelled.length,
        `§4 asks for ${N_CANCELLED} cancelled orders and ${nowCancelled.length} are cancelled ` +
        `and soft-deleted${dumpWire(wire)}`).toBe(N_CANCELLED);

      // A cancelled order must LEAVE the list, because `GET /orders` filters on
      // `is_active` — and it must still be reachable by the delta door, which
      // is what a phone needs to remove it locally.
      const live = await apiRows(page, '/api/v1/vikray/orders');
      const liveMarks = new Set(live.map((o) => String(o.notes || '').match(/S10-SO-\d{2}/)?.[0]));
      for (const plan of toCancel) {
        if (liveMarks.has(plan.mark)) {
          problems.push(`${plan.mark} is cancelled and still on the active order list`);
        }
      }

      // ── AND THE STOCK CAME BACK ────────────────────────────────────────
      if (restocked.length) {
        const stockAfter = new Map<string, number>(
          (await apiRows(page, '/api/v1/vikray/stock'))
            .map((r) => [String(r.name), Number(r.quantity_on_hand)]));
        // A DELTA, never an absolute: this ledger is deeper on every run, and a
        // second execution over a different opening balance must be as true as
        // the first. Confirming deducted and cancelling returned, so the pair
        // nets to zero for every product that was only touched by this test.
        for (const name of new Set(restocked)) {
          const before = stockBefore.get(name) ?? 0;
          const now = stockAfter.get(name) ?? 0;
          if (!near(before, now, 0.001)) {
            problems.push(`${name}: confirming then cancelling should net to nothing and the ` +
              `ledger moved from ${before} to ${now}. The restock is what protects the count a ` +
              'firm reorders against.');
          }
        }
      }

      console.log(`\n  10.07 — ${cancelled} cancelled this run, ${alreadyCancelled} already ` +
        `cancelled (§6 idempotence); ${nowCancelled.length}/${N_CANCELLED} withdrawn; ` +
        `${new Set(restocked).size} products checked for the restock\n`);

      expect(problems, `cancellation did not behave:\n     ${problems.join('\n     ')}`).toEqual([]);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.08 · ten orders become invoices
  // ──────────────────────────────────────────────────────────────────────────
  test('10.08 ten orders become invoices — the company crosses, the balance is real, the salesperson does not',
    async ({ page }) => {
      test.setTimeout(60 * 60_000);
      const con = watchConsole(page);
      const wire = watchWire(page);
      await signIn(page);
      con.at('orders');
      let p = await openTab(page, 'orders', 'orders');

      const clients = await apiRows(page, '/api/v1/graha/clients');
      const members = await memberNames(page);
      const profile = await apiOne(page, '/api/v1/org/profile');
      const homeState = String(profile?.billing_address?.state || '');
      const PLAN = planOrders(clients, members, homeState);
      const toInvoice = PLAN.filter((o) => o.invoice);
      expect(toInvoice.length, `§4 asks for ${N_INVOICED} orders converted to invoices and the ` +
        `plan names ${toInvoice.length}`).toBe(N_INVOICED);

      const orders = await myOrders(page);
      const problems: string[] = [];
      let raised = 0;
      let already = 0;
      /** The orders THIS execution converted — the only ones whose document
       *  was written by the code under test. §6 makes a second run find them
       *  all already present, so a check scoped to this set proves nothing on
       *  a re-run and says so rather than passing silently. */
      const raisedNow = new Set<string>();
      /** Blanks on documents raised BEFORE the fix. Named, never asserted on:
       *  re-stating a Rule 46 particular on an issued tax invoice is a data
       *  change to live rows and is the owner's. */
      const preexistingBlank: string[] = [];

      for (const plan of toInvoice) {
        const row = orders.get(plan.mark);
        if (!row) { problems.push(`${plan.mark}: not on the register`); continue; }
        if (row.invoice_id) { already++; continue; }

        expect(String(row.status), `${plan.mark} must leave draft before it can be invoiced — ` +
          '"Confirm the order before generating an invoice" — and 10.06 walks it out')
          .not.toBe('draft');

        p = await openTab(page, 'orders', 'orders');
        const drawer = await openOrder(page, p, String(row.order_number));
        const btn = drawer.getByRole('button', { name: 'Generate invoice', exact: true });
        await expect(btn, `${row.order_number} is ${row.status}, carries no invoice, and offers ` +
          'no Generate invoice. The control is gated on a Finance grant and this lane holds one; ' +
          'if the gate note is showing instead, the entitlement probe is the finding')
          .toBeVisible({ timeout: 20_000 });
        await saveAndWait(page, async () => { await btn.click(); },
          /\/v1\/vikray\/orders\/[0-9a-f-]+\/invoice$/,
          `invoicing ${row.order_number}`, ['POST']);
        raised++;
        raisedNow.add(plan.mark);
        await expect(drawer.locator('.vkd__title'), `${row.order_number} was invoiced and the ` +
          'record does not show the Invoiced tag').toContainText('Invoiced', { timeout: 30_000 });
        await closeDrawer(page, drawer);
      }

      // ── the read-back, on the CANONICAL row of BOTH documents ──────────
      const after = await myOrders(page);
      let converted = 0;

      for (const plan of toInvoice) {
        const row = after.get(plan.mark);
        if (!row?.invoice_id) {
          problems.push(`${plan.mark}: no invoice recorded against the order`);
          continue;
        }
        converted++;
        const order = await apiOne(page, `/api/v1/vikray/orders/${row.id}`);
        const inv = await apiOne(page, `/api/v1/ganit/invoices/${row.invoice_id}`);
        const invoice = inv?.invoice ?? inv;

        // ── the company crosses the module boundary ────────────────────
        if (!invoice.client_id) {
          problems.push(`${plan.mark}: the invoice carries no company. An order knows which firm ` +
            'it is for; an invoice that drops it is filed under "Unlinked client" in receivables ' +
            'ageing and is invisible to that company\'s Client 360.');
        }

        // ── the money owed is real ─────────────────────────────────────
        if (!near(money(invoice.balance_due), money(invoice.total), 0.05)) {
          problems.push(`${plan.mark}: the invoice totals ${money(invoice.total)} and its ` +
            `balance_due is ${money(invoice.balance_due)}. A new invoice is owed in full; a zero ` +
            'balance reads as PAID and takes the money out of ageing and out of editability.');
        }

        // ── THE SALESPERSON ────────────────────────────────────────────
        if (order.salesperson_id && !invoice.salesperson_id) {
          problems.push(`${plan.mark}: the ORDER credits a salesperson and the invoice raised ` +
            'from it credits nobody. `staging.ganit_invoices.salesperson_id` exists (text, live ' +
            'query) and `generate_invoice_from_order` (routers/vikray.py:842) does not name it in ' +
            'its INSERT. The commission register reads turnover from that column and nothing ' +
            'else, so a sale credited at the point of sale pays no one once it is billed — which ' +
            'is precisely what commission_reports.py\'s own docstring says must not happen: the ' +
            'order column "exists so that attribution can be captured at the point of sale and ' +
            'CARRIED to the invoice, which is where the write path must copy it".');
        }

        // ── THE TAXABLE VALUE ──────────────────────────────────────────
        // Every Ganit reader computes turnover as `subtotal − discount` and
        // Ganit's own writer stores `subtotal` GROSS. Vikray stores it NET, and
        // this conversion copies it across verbatim, so the discount is
        // subtracted a second time by every reader downstream.
        const orderGross = money(Number(order.subtotal) + Number(order.discount || 0));
        const invoiceTaxable = money(Number(invoice.subtotal) - Number(invoice.discount || 0));
        const expectedTaxable = money(orderGross - Number(order.discount || 0));
        if (!near(invoiceTaxable, expectedTaxable, 0.05)) {
          problems.push(`${plan.mark}: the order's taxable value is ${expectedTaxable} ` +
            `(gross ${orderGross} less a discount of ${money(order.discount)}) and the invoice ` +
            `reports ${invoiceTaxable} as subtotal − discount. Vikray stores subtotal NET of the ` +
            'discount and Ganit stores it GROSS, so the conversion hands a net figure to every ' +
            'reader that will subtract the discount again.');
        }

        // ── THE PLACE OF SUPPLY ────────────────────────────────────────
        //
        // ⚠ ASSERTED ON WHAT THIS EXECUTION MINTED, AND REPORTED ON THE REST
        // — the same rule 17.07 applies to the invoice series, and for the
        // same reason: the fix reaches every FUTURE conversion and cannot
        // re-write a document already issued. Re-stating the place of supply
        // on a tax invoice that has gone out is a data change to live rows
        // and is the owner's call (`docs/OWNER-ACTIONS.md` item 22), not a
        // suite's. So the strict check is scoped to the orders invoiced in
        // THIS run, where it bites, and a historical blank is NAMED in the
        // log rather than either failing for ever or passing silently.
        //
        // WHAT IT USED TO BE. `generate_invoice_from_order` wrote the literal
        // `''`, and `services/gstr1_json.py` reads that exact column. On an
        // INTRA-state supply the return builder falls back to the supplier's
        // own state and is right anyway; on an INTER-state one there is
        // nothing to fall back on and the invoice is HELD OUT OF GSTR-1
        // entirely, silently, with the money still on the books.
        //
        // WHAT IT MUST BE. The customer's own state — and this suite already
        // derives that, from the client's ADDRESS, for the tax split it
        // asserts a few lines above. So the check reuses `plan.clientState`
        // rather than re-deriving: if the invoice's place of supply and the
        // suite's own split were ever computed from different facts, the two
        // assertions could pass while contradicting each other.
        const posRaw = String(invoice.place_of_supply || '').trim();
        if (!raisedNow.has(plan.mark)) {
          if (!posRaw) preexistingBlank.push(`${plan.mark} → ${invoice.invoice_number}`);
        } else if (!posRaw) {
          problems.push(`${plan.mark}: the invoice raised this run carries NO place of supply. ` +
            'Rule 46(n) asks for it, and `gstr1_json.parse_state_code` reads this exact column: ' +
            'an inter-State supply with a blank one is held out of the GST return altogether ' +
            'rather than reported wrongly, so the sale never appears.');
        } else {
          const posCode = GST_STATE_CODE[posRaw];
          const wantCode = GST_STATE_CODE[plan.clientState];
          if (!posCode) {
            problems.push(`${plan.mark}: the invoice's place of supply reads "${posRaw}", which ` +
              'is not a GST state this product knows. `services/gst_states.py` is the one ' +
              'codelist and every writer must draw its spelling from it, because ' +
              '`gstr1_json.parse_state_code` is what has to read the value back.');
          } else if (posCode !== wantCode) {
            problems.push(`${plan.mark}: the customer is in ${plan.clientState} and the invoice ` +
              `says the supply was into "${posRaw}". Place of supply is the field that decides ` +
              'CGST/SGST against IGST on the return, so naming the wrong one moves tax between ' +
              'two state governments.');
          } else if ((posCode !== GST_STATE_CODE[homeState]) !== Boolean(invoice.is_igst)) {
            problems.push(`${plan.mark}: the invoice is marked ` +
              `${invoice.is_igst ? 'inter' : 'intra'}-State and its place of supply is ` +
              `"${posRaw}" against a supplier in ${homeState}. The document states one ` +
              'treatment and carries another, which is `doc_validation`\'s blocking "Tax ' +
              'split" gap — one supply cannot be taxed both ways.');
          }
        }
      }

      // A second conversion must be refused, or one sale becomes two documents.
      const first = after.get(orderMark(1));
      if (first?.invoice_id) {
        const pp = await openTab(page, 'orders', 'orders');
        const d = await openOrder(page, pp, String(first.order_number));
        expect(await d.getByRole('button', { name: 'Generate invoice', exact: true }).count(),
          `${first.order_number} already carries an invoice and the record still offers to ` +
          'generate one — a second tax invoice for one sale is a serial nobody can explain')
          .toBe(0);
        await closeDrawer(page, d);
      }

      console.log(`\n  10.08 — ${raised} invoices raised this run, ${already} already present ` +
        `(§6 idempotence); ${converted}/${N_INVOICED} orders carry an invoice${dumpWire(wire)}\n`);

      // ── WHAT THE PLACE-OF-SUPPLY CHECK ACTUALLY PROVED THIS RUN ───────────
      // Said out loud, because a check scoped to this run's own output proves
      // NOTHING on a second execution — every order is already invoiced — and
      // a silent zero there reads exactly like a pass.
      console.log(`  10.08 — place of supply: ASSERTED on ${raisedNow.size} invoice(s) raised ` +
        `this run${raisedNow.size === 0
          ? '. NOTHING WAS PROVED THIS EXECUTION — every order was already invoiced (§6), so '
            + 'the check bites only on a run that converts, i.e. against a rebuilt org'
          : ` (supplier ${homeState || 'UNKNOWN'})`}.\n` +
        (preexistingBlank.length
          ? `     ⚠ ${preexistingBlank.length} invoice(s) raised BEFORE the fix still carry a `
            + 'blank place_of_supply. `gstr1_json` holds every inter-State one out of the return '
            + 'entirely. NOT corrected here: re-stating a Rule 46 particular on an issued tax '
            + 'invoice is a data change to live rows and is the owner\'s (OWNER-ACTIONS item 22).'
            + `\n       ${preexistingBlank.join('\n       ')}\n`
          : '     No historical blanks among this suite\'s converted orders.\n'));

      expect(converted, `§4 asks for ${N_INVOICED} orders converted to invoices and ${converted} ` +
        'carry one').toBe(N_INVOICED);
      expect(problems, `the conversion did not carry what the order held:\n     ` +
        problems.join('\n     ')).toEqual([]);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.09 · forty-five stock movements
  // ──────────────────────────────────────────────────────────────────────────
  test('10.09 forty-five stock movements are recorded, one of them below zero, and the ledger reads them back',
    async ({ page }) => {
      test.setTimeout(90 * 60_000);
      const con = watchConsole(page);
      const wire = watchWire(page);
      await signIn(page);
      con.at('stock');
      let p = await openTab(page, 'stock', 'stock');

      const catalogue = (await apiRows(page, '/api/v1/products'))
        .filter((r) => String(r.name || '').startsWith('S05 Product '))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      expect(catalogue.length, 'the catalogue is not the eighteen entries the ledger is kept for')
        .toBe(N_PRODUCTS);

      /** The reasons a PERSON chooses. The order lifecycle stamps two more —
       *  `order_confirmed` and `order_cancelled` — and they are counted apart,
       *  because §4's forty-five are movements somebody typed. */
      const HUMAN = new Set(['restock', 'manual_adjustment', 'damage', 'return']);

      async function movesOf(product: any) {
        return await apiRows(page, `/api/v1/vikray/stock/${product.id}/moves`);
      }

      async function census() {
        let human = 0;
        let lifecycle = 0;
        for (const prod of catalogue) {
          for (const m of await movesOf(prod)) {
            if (HUMAN.has(String(m.reason))) human++; else lifecycle++;
          }
        }
        return { human, lifecycle };
      }

      const before = await census();
      const problems: string[] = [];
      let typed = 0;

      /** One adjustment through the real dialog, judged on the server. */
      async function adjust(product: any, delta: number, reason: string, expectNegative = false) {
        p = await openTab(page, 'stock', 'stock');
        const name = String(product.name);
        // ⚠ NOT `p.locator('tr', { has: p.locator(…) })`, which is what this
        // was and which matched NOTHING. Playwright re-roots a `has:` locator
        // at the OUTER element, so an inner locator carrying its own ancestor
        // prefix becomes `tr >> #mt-panel-stock >> button…` — and the panel is
        // the row's ancestor, never its descendant. The row was on screen the
        // whole time (the failure snapshot shows `button "S05 Product 01"`),
        // and the suite reported a MISSING CONTROL, which is the wrong
        // diagnosis entirely. Anchor on the button and climb to its row.
        const nameBtn = p.locator(`button.vk-stk__name:text-is("${name}")`).first();
        await expect(nameBtn, `${name} is not on the stock ledger`).toBeVisible({ timeout: 30_000 });
        const row = nameBtn.locator('xpath=ancestor::tr[1]');
        await row.getByRole('button', { name: 'Adjust…' }).click();

        const dialog = page.locator('[data-testid="vk-adjust"]');
        await expect(dialog, 'the Adjust stock dialog did not open').toBeVisible({ timeout: 20_000 });
        // ⚠ `fill`, NOT `typeInto`. `typeInto` CLICKS first so it can select
        // and replace an existing value, and `Modal` animates in — the click
        // landed while the dialog was still moving ("element is not stable"),
        // then the node was swapped underneath it ("element was detached") and
        // the suite reported a 20s timeout against a dialog that had opened
        // perfectly. The Change field starts EMPTY by construction
        // (`useState('')`), so there is nothing to select and the click bought
        // nothing. `fill` waits for actionability and retries through a
        // re-render, which is exactly the difference.
        await dialog.locator('#vk-adjust-form input[type=number]').fill(String(delta));
        await dialog.locator('#vk-adjust-form select.inp').selectOption(reason);

        // The dialog previews the resulting balance and WARNS when the change
        // takes the ledger below zero. §4: "one driven negative to see the
        // warning" — so the warning is what is asserted, not the number.
        const preview = dialog.locator('.vk-adj__after');
        await expect(preview, 'the Adjust dialog previews no resulting balance').toBeVisible();
        if (expectNegative) {
          await expect(dialog.locator('.vk-adj__neg'),
            `${name} is being driven below zero and the dialog says nothing about it`)
            .toBeVisible({ timeout: 10_000 });
        }

        await saveAndWait(page, async () => {
          await dialog.getByRole('button', { name: 'Record adjustment' }).click();
        }, /\/v1\/vikray\/stock\/[0-9a-f-]+$/, `adjusting ${name} by ${delta} (${reason})`, ['PATCH']);
        await expect(dialog, 'the Adjust dialog stayed open after the movement was recorded')
          .toBeHidden({ timeout: 20_000 });
        typed++;
      }

      /** The ±1 buttons, which fire with no toast and no await of their own. */
      async function nudge(product: any, direction: 1 | -1) {
        p = await openTab(page, 'stock', 'stock');
        const name = String(product.name);
        const label = direction === 1 ? `Add one ${name}` : `Remove one ${name}`;
        const btn = p.getByRole('button', { name: label, exact: true });
        await expect(btn, `the ${direction === 1 ? '+1' : '−1'} control for ${name} is missing`)
          .toBeVisible({ timeout: 30_000 });
        await saveAndWait(page, async () => { await btn.click(); },
          /\/v1\/vikray\/stock\/[0-9a-f-]+$/, `${label}`, ['PATCH']);
        typed++;
      }

      // §6: top up to §4's forty-five rather than adding forty-five more.
      // `vikray_stock_moves` is append-only with no name column, so the mark is
      // the COUNT and the shortfall is what gets typed.
      let owed = Math.max(0, N_STOCK_MOVES - before.human);

      // 1 · an opening restock on every product, which is what a firm does
      //     first and what gives the ledger depth for everything after it.
      const opening = catalogue.slice(0, Math.min(owed, N_PRODUCTS));
      for (let i = 0; i < opening.length; i++) {
        const qtyBefore = Number(
          (await apiRows(page, '/api/v1/vikray/stock'))
            .find((r) => String(r.name) === String(opening[i].name))?.quantity_on_hand ?? 0);
        await adjust(opening[i], 40 + i, 'restock');
        const qtyAfter = Number(
          (await apiRows(page, '/api/v1/vikray/stock'))
            .find((r) => String(r.name) === String(opening[i].name))?.quantity_on_hand ?? 0);
        // A DELTA. The absolute balance depends on how many orders have been
        // confirmed against this product, which is not this test's business.
        if (!near(qtyAfter - qtyBefore, 40 + i, 0.001)) {
          problems.push(`${opening[i].name}: a restock of ${40 + i} moved the ledger from ` +
            `${qtyBefore} to ${qtyAfter}`);
        }
      }
      owed -= opening.length;

      // 2 · the ±1 controls, in pairs so the ledger nets out.
      for (let i = 0; owed > 0 && i < catalogue.length; i++) {
        await nudge(catalogue[i], 1); owed--;
        if (owed <= 0) break;
        await nudge(catalogue[i], -1); owed--;
      }

      // 3 · the remaining human reasons, and the one deliberate negative.
      const REASONS = ['damage', 'return', 'manual_adjustment'];
      let ri = 0;
      while (owed > 1) {
        const prod = catalogue[ri % catalogue.length];
        await adjust(prod, ri % 2 === 0 ? -3 : 6, REASONS[ri % REASONS.length]);
        owed--; ri++;
      }

      // 4 · §4's "one driven negative to see the warning". Chosen as a delta
      //     that is unambiguously below the current balance, read live.
      if (owed > 0) {
        const target = catalogue[catalogue.length - 1];
        const held = Number(
          (await apiRows(page, '/api/v1/vikray/stock'))
            .find((r) => String(r.name) === String(target.name))?.quantity_on_hand ?? 0);
        await adjust(target, -(held + 25), 'damage', true);
        const now = Number(
          (await apiRows(page, '/api/v1/vikray/stock'))
            .find((r) => String(r.name) === String(target.name))?.quantity_on_hand ?? 0);
        if (!(now < 0)) {
          problems.push(`${target.name} was driven ${-(held + 25)} against a balance of ${held} ` +
            `and the ledger reads ${now}. §4 asks for one product driven negative so the warning ` +
            'is seen against a real row.');
        }
        owed--;
      }

      // ── the read-back, and the history screen that reads it ────────────
      const after = await census();
      expect(after.human,
        `§4 asks for ${N_STOCK_MOVES} stock movements a person recorded and the ledger holds ` +
        `${after.human}. The ${after.lifecycle} movements stamped by the order lifecycle ` +
        '(`order_confirmed`, `order_cancelled`) are counted apart, because nobody typed them.' +
        dumpWire(wire))
        .toBe(N_STOCK_MOVES);

      // `GET /stock/{id}/moves` existed since migration 036 with NO caller —
      // every adjustment was written to an audit trail nobody could read.
      // Expanding a row is the door, and it is driven here.
      p = await openTab(page, 'stock', 'stock');
      const first = catalogue[0];
      await p.locator(`button.vk-stk__name:text-is("${String(first.name)}")`).click();
      const history = p.locator('ol.vk-mv');
      await expect(history, `${first.name}'s movement history did not open under its row`)
        .toBeVisible({ timeout: 20_000 });
      await expect(history.locator('li').first(), 'the movement history opened empty on a ' +
        'product this suite has just adjusted').toBeVisible();
      // A raw enum reaching the user is the defect, not the missing option: the
      // lifecycle reasons must read as sentences too.
      const historyText = await history.innerText();
      expect(historyText, 'the movement history is printing a raw enum at the reader')
        .not.toMatch(/order_confirmed|order_cancelled|manual_adjustment/);

      console.log(`\n  10.09 — movements: ${typed} typed this run; ` +
        `${before.human} → ${after.human} recorded by a person (§4 asks ${N_STOCK_MOVES}); ` +
        `${after.lifecycle} stamped by the order lifecycle\n`);

      expect(problems, `the stock ledger did not move as it was told:\n     ` +
        problems.join('\n     ')).toEqual([]);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.10 · customers derive from clients and orders
  // ──────────────────────────────────────────────────────────────────────────
  test('10.10 customers derive from clients and orders, and a company with no order is not one',
    async ({ page }) => {
      test.setTimeout(30 * 60_000);
      const con = watchConsole(page);
      await signIn(page);
      con.at('customers');
      const p = await openTab(page, 'customers', 'customers');

      const customers = await apiRows(page, '/api/v1/vikray/customers');
      const clients = await apiRows(page, '/api/v1/graha/clients');
      const orders = await apiRows(page, '/api/v1/vikray/orders');
      expect(orders.length, 'the active order list came back at its 200-row cap, so the ' +
        'reconciliation below would be over a page rather than the book')
        .toBeLessThan(200);

      const problems: string[] = [];

      // ── WHICH COMPANIES HAVE ACTUALLY ORDERED ─────────────────────────
      //
      // ⚠ BY `client_id`, AND READING IT OFF THE CONTACT WAS A TEST BUG.
      // This derived the set from `o.contact_company || o.contact_name` — the
      // CRM contact's employer. Every order this suite raises names a COMPANY
      // and no individual, which is the ordinary B2B case and the one this
      // product's own rule describes ("a CRM client is the company; contacts
      // are people who come and go, the customer stays"). So `contact_company`
      // was null on all thirty-five, the set came back EMPTY, and the suite
      // accused the module of listing twenty-five companies that had "never
      // ordered" while the endpoint was grouping them correctly by
      // `client_id`. Measured 2026-08-29: 19 customers from 29 active orders
      // over 25 companies — exactly 25 less the six whose only order was
      // cancelled. The product was right and the derivation was wrong.
      //
      // `contact_company` survives only as the fallback for orders that
      // predate migration 136 and whose contact belonged to no company, which
      // is the same fallback `list_customers` itself keeps.
      const nameOfClient = new Map<string, string>(
        clients.map((c) => [String(c.id), String(c.name || '')]));
      const companyOf = (o: any) => (o.client_id && nameOfClient.get(String(o.client_id)))
        || String(o.contact_company || o.contact_name || '');
      const orderedCompanies = new Set(orders.map(companyOf).filter(Boolean));
      const customerNames = new Set(customers.map((c) => String(c.customer_name || '')));

      for (const name of orderedCompanies) {
        if (!customerNames.has(name)) {
          problems.push(`"${name}" has an order on the books and is not a customer`);
        }
      }

      // ── AND NOTHING IS A CUSTOMER WITHOUT ONE ─────────────────────────
      // This is the distinction the tab exists for: Graha owns the contact,
      // Vikray owns the trading history. Asserted from the CUSTOMER side, so
      // it holds whether or not the fixture happens to leave a company
      // unordered — a precondition that "some company has never ordered"
      // would be a check that stops biting the day the fixture changes, and
      // it is not the property under test. The count is REPORTED either way.
      const never = clients.filter((c) => !orderedCompanies.has(String(c.name)));
      for (const c of never) {
        if (customerNames.has(String(c.name))) {
          problems.push(`"${c.name}" has never placed an order and is listed as a customer — ` +
            'this tab is trading history and not a second contact list');
        }
      }
      // Every customer the tab lists must be a company with an order behind it.
      for (const name of customerNames) {
        if (name && !orderedCompanies.has(name)) {
          problems.push(`"${name}" is listed as a customer and no order on the register names ` +
            'it — this tab is built by grouping this module\'s own orders, so a row with ' +
            'nothing behind it is a second contact list wearing a sales label');
        }
      }

      // ── the figures reconcile to the orders behind them ───────────────
      for (const cust of customers) {
        const name = String(cust.customer_name || '');
        const mine = orders.filter((o) => companyOf(o) === name);
        if (!mine.length) continue;
        if (Number(cust.order_count) !== mine.length) {
          problems.push(`"${name}": the customers table counts ${cust.order_count} orders and the ` +
            `order list holds ${mine.length}`);
        }
        const value = money(mine.reduce((s, o) => s + Number(o.total || 0), 0));
        if (!near(money(cust.order_value), value, 1)) {
          problems.push(`"${name}": ordered value reads ${money(cust.order_value)} and the ` +
            `orders behind it total ${value}`);
        }
      }

      // ── and the screen ────────────────────────────────────────────────
      await expect(p.locator('table.vk-cu__t'), 'the customers table did not render')
        .toBeVisible({ timeout: 30_000 });
      const firstName = String(customers[0]?.customer_name || '');
      expect(firstName, 'there are no customers to open').toBeTruthy();

      // Search is SERVER-side here and debounced. Typing is not searching, and
      // the fault it guards against is exactly the Phase 8.0 one: an unfiltered
      // table clicked, the wrong record opened.
      const search = p.locator('.vk-cu__search input.inp');
      await typeInto(search, firstName);
      await expect
        .poll(async () => (await p.locator('button.vk-cu__name').allTextContents())
          .filter((t) => t.trim() === firstName).length,
          { message: `searching for "${firstName}" never narrowed the table to it`, timeout: 30_000 })
        .toBeGreaterThan(0);

      // The customer name IS the action: it opens that company's orders in place.
      await p.locator(`button.vk-cu__name:text-is("${firstName}")`).click();
      const opened = p.locator('tr.vk-cu__exp');
      await expect(opened, `${firstName}'s orders did not open underneath the row`)
        .toBeVisible({ timeout: 20_000 });
      await expect
        .poll(async () => (await opened.innerText()).trim().length,
          { message: 'the expanded customer row never resolved into orders or into words' })
        .toBeGreaterThan(3);

      // GSTIN is not mandatory anywhere in this product and a customer without
      // one is normal. The cell must SAY so rather than looking like a fault.
      await typeInto(search, '');
      const blanks = customers.filter((c) => !String(c.gstin || '').trim());
      if (blanks.length) {
        await expect(p.locator('.vk-cu__nogst').first(),
          'a customer with no GSTIN must read "Not recorded" — GSTIN, PAN and TAN are ' +
          'non-mandatory and must block nothing').toBeVisible({ timeout: 20_000 });
      }

      console.log(`\n  10.10 — ${customers.length} customers derived from ${orders.length} ` +
        `active orders over ${clients.length} CRM companies; ${never.length} companies have ` +
        `never ordered and none of them is listed; ${blanks.length} carry no GSTIN\n`);

      expect(problems, `the customers list is not what its orders say:\n     ` +
        problems.join('\n     ')).toEqual([]);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.11 · ten sales targets
  // ──────────────────────────────────────────────────────────────────────────
  test('10.11 ten sales targets are set, and every rupee of won revenue is accounted for',
    async ({ page }) => {
      test.setTimeout(60 * 60_000);
      const con = watchConsole(page);
      const wire = watchWire(page);
      await signIn(page);
      con.at('targets');
      let p = await openTab(page, 'targets', 'targets');

      const members = await memberNames(page);
      expect(members.length, 'a target needs a person, and the member directory is empty')
        .toBeGreaterThanOrEqual(5);
      const people = members.slice(0, 5);

      /**
       * The two periods, taken from the form's own QUICK PERIOD buttons.
       *
       * A target is almost always quarterly and the form offers this quarter,
       * last quarter and next quarter as one press each. Using them rather than
       * driving two calendars keeps the periods aligned with what the product
       * itself calls a quarter — which is the thing the leaderboard's
       * "current period" filter and the attainment window are computed from.
       */
      function quarterLabel(offsetMonths: number) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() + offsetMonths);
        return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
      }
      const PERIODS = [quarterLabel(0), quarterLabel(3)];

      // ten targets = five people × two quarters, indexed so the mark is stable
      const planned = Array.from({ length: N_TARGETS }, (_, i) => ({
        n: i + 1,
        person: people[i % people.length],
        period: PERIODS[Math.floor(i / people.length)],
        amount: 500000 + (i + 1) * 100000,
        deals: 3 + i,
      }));

      const before = await apiRows(page, '/api/v1/vikray/targets');
      const markSet = new Set(before.map((t) => String(t.notes || '').trim()));

      let typed = 0;
      let found = 0;

      for (const t of planned) {
        if (markSet.has(targetMark(t.n))) { found++; continue; }
        p = await openTab(page, 'targets', 'targets');
        const open = p.locator('.vk-bar__new');
        if (await open.count()) {
          await open.click();
        } else {
          await p.locator('.empty__act').getByRole('button', { name: /Set target/ }).click();
        }
        const form = p.locator('form.vk-form').first();
        await expect(form, 'the set-target form did not open').toBeVisible({ timeout: 30_000 });

        // ⚠ THE RECURRING BUG SHAPE'S OWN COLUMN.
        // `vikray_targets.salesperson_id` is one of the four shipped instances
        // — a uuid column fed a text `user_xxx` id — and it is TEXT today
        // (live query, 2026-08-29, migration 092). The select's option VALUE is
        // that id and its option TEXT is the name; this picks by NAME and never
        // touches the value, which is also what keeps an id off the screen.
        const chosen = await pickByLabel(
          form.locator('label.fld', { hasText: 'Salesperson' }).locator('select.inp'),
          t.person, 'salesperson');
        expect(chosen, `the salesperson picker chose "${chosen}" for "${t.person}"`)
          .toContain(t.person);

        await form.getByRole('button', { name: t.period, exact: true }).click();

        await typeInto(
          form.locator('label.fld', { hasText: 'Target amount' }).locator('input.inp'),
          String(t.amount));
        await typeInto(
          form.locator('label.fld', { hasText: 'Target deals' }).locator('input.inp'),
          String(t.deals));
        await typeInto(
          form.locator('label.fld', { hasText: 'Notes' }).locator('input.inp'),
          targetMark(t.n));

        await saveAndWait(page, async () => {
          await form.getByRole('button', { name: /^Sav/ }).click();
        }, /\/v1\/vikray\/targets$/, `setting ${targetMark(t.n)}`, ['POST']);
        typed++;
      }

      // ── the read-back ──────────────────────────────────────────────────
      const targets = await apiRows(page, '/api/v1/vikray/targets');
      const mine = targets.filter((t) => /^S10 target \d{2}$/.test(String(t.notes || '').trim()));
      expect(mine.length, `§4 asks for ${N_TARGETS} sales targets and the table holds ` +
        `${mine.length} carrying this suite's mark${dumpWire(wire)}`).toBe(N_TARGETS);

      const problems: string[] = [];

      // NAMES, NEVER IDS. The cell used to fall back to `salesperson_id`, which
      // put a raw `users.user_id` on screen — the ratchet is positional and did
      // not catch it.
      for (const t of mine) {
        if (!String(t.salesperson_name || '').trim()) {
          problems.push(`${t.notes}: the target resolves no salesperson NAME. A target is ` +
            'assigned to somebody by definition — the form requires it — so a blank name means ' +
            'the login behind it no longer resolves.');
        }
        if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(String(t.salesperson_name || '')) ||
            /^user_/.test(String(t.salesperson_name || ''))) {
          problems.push(`${t.notes}: the salesperson NAME is "${t.salesperson_name}", which is an ` +
            'identifier and not a name');
        }
      }

      // ── ATTAINMENT AND THE UNATTRIBUTED REMAINDER ─────────────────────
      //
      // Attainment is won deals inside the period ASSIGNED to the person; the
      // unattributed figure is won deals inside the same period assigned to
      // NOBODY. The two are built from one SQL fragment on purpose, so the
      // second is the honest account of the first's zero — and together they
      // must add up to the won book for that window. Read from Graha's own
      // list, not from a number this spec invents.
      const deals = await apiRows(page, '/api/v1/graha/deals?limit=200');
      expect(deals.length, 'the deals list came back at its cap, so the reconciliation below ' +
        'would be over a page').toBeLessThan(200);
      const won = deals.filter((d) => String(d.stage) === 'Won');
      const wonUnassigned = won.filter((d) => !d.assigned_to);
      const wonValue = money(won.reduce((s, d) => s + Number(d.value || 0), 0));
      const unassignedValue = money(wonUnassigned.reduce((s, d) => s + Number(d.value || 0), 0));

      // The current quarter's targets are the ones whose window the won deals
      // actually fall in — every won deal on this org was closed inside it.
      const current = mine.filter((t) => {
        const s = new Date(`${t.period_start}T00:00:00`);
        const e = new Date(`${t.period_end}T23:59:59`);
        const now = new Date();
        return s <= now && now <= e;
      });
      expect(current.length, 'no target covers today, so the leaderboard has nothing to show ' +
        'and the attainment window cannot be checked').toBeGreaterThan(0);

      for (const t of current) {
        const claimed = money(t.unattributed_amount);
        if (!near(claimed, unassignedValue, 1)) {
          problems.push(`${t.notes}: the unattributed diagnostic reports ${claimed} of won ` +
            `revenue in ${t.period_start} → ${t.period_end} and Graha holds ${unassignedValue} ` +
            `across ${wonUnassigned.length} won deals with no assignee. The two are built from ` +
            'one SQL fragment so they cannot legitimately disagree.');
        }
        if (Number(t.unattributed_deals) !== wonUnassigned.length) {
          problems.push(`${t.notes}: the diagnostic counts ${t.unattributed_deals} unassigned won ` +
            `deals and Graha holds ${wonUnassigned.length}`);
        }
      }

      // ── the screen ────────────────────────────────────────────────────
      p = await openTab(page, 'targets', 'targets');
      await expect(p.locator('table.vk-tg'), 'the targets table did not render')
        .toBeVisible({ timeout: 30_000 });
      // The bar is derived from Target and Actual and must render for every row.
      await expect
        .poll(async () => await p.locator('.vk-tg__bar, .vk-tg__nopct').count(),
          { message: 'no achievement bar rendered on any target row' })
        .toBeGreaterThanOrEqual(current.length);
      // "This period" — `GET /targets/leaderboard` had no caller before this tab.
      await expect(p.locator('.vk-lead'),
        `${current.length} targets cover today and the leaderboard card did not render — ` +
        'it answers "who is ahead right now", which is the question this tab is opened to ask')
        .toBeVisible({ timeout: 30_000 });
      // And the zero must be EXPLAINED rather than left bare, which is the
      // whole reason the diagnostic exists.
      if (unassignedValue > 0) {
        await expect(p.locator('.vk-tg__unclaimed'),
          `${unassignedValue} of won revenue counts towards nobody's target and the screen says ` +
          'nothing about it — a bare zero beside a target reads as the old broken join')
          .toBeVisible({ timeout: 20_000 });
      }

      console.log(`\n  10.11 — targets: ${typed} typed, ${found} already present ` +
        `(§6 idempotence); ${mine.length}/${N_TARGETS} on the table over ` +
        `${PERIODS.join(' and ')}\n` +
        `     won deals in Graha: ${won.length} worth ${wonValue}; ` +
        `${wonUnassigned.length} worth ${unassignedValue} have no assignee\n`);

      expect(problems, `the targets table is not what the deals behind it say:\n     ` +
        problems.join('\n     ')).toEqual([]);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.12 · attainment can never move
  // ──────────────────────────────────────────────────────────────────────────
  test('10.12 a deal is assigned from the deal record, and target attainment moves',
    async ({ page }) => {
      test.setTimeout(45 * 60_000);
      const con = watchConsole(page);
      const wire = watchWire(page);
      await signIn(page);

      // ══════════════════════════════════════════════════════════════════
      // WHAT THIS TEST USED TO REPORT, AND WHY IT NOW DRIVES INSTEAD
      // ══════════════════════════════════════════════════════════════════
      // Sales-target attainment is `graha_deals.assigned_to =
      // vikray_targets.salesperson_id` (`routers/vikray.py` `_ATTAINMENT_SQL`)
      // and NOTHING IN THE PRODUCT WROTE `assigned_to`. A sweep of
      // `frontend/src` and `mobile/` on 2026-08-29 found three readers —
      // Graha's pipeline card, the rep-performance report and the contact
      // drawer — and no writer anywhere. Live the same day: 30 deals on this
      // org, 0 with an assignee, 8 of them Won, 10 people holding targets and
      // all 10 reading Rs 0. The Targets tab tells the user in prose that
      // actuals arrive this way.
      //
      // It was the THIRD instance of one shape inside `DealCreate`/`_DEAL_COLS`
      // — `routers/graha.py` documents `territory_id` and `contact_id` as the
      // other two, in its own comments, in the same model.
      //
      // The deal record now carries an "Assigned to" select, so this test does
      // what §1 asks of every other row in this programme: it TYPES the value
      // into the real form and asserts the number moves. The deals are Suite
      // 04's and none is created here — only assigned, which is the act the
      // Targets tab is asking for. ⚠ NOTHING IS BACKFILLED BY SQL.
      // ══════════════════════════════════════════════════════════════════

      const targets = await apiRows(page, '/api/v1/vikray/targets');
      expect(targets.length, '10.11 sets ten targets and none is on the table, so there is ' +
        'nothing whose attainment could move').toBeGreaterThan(0);

      // Only the targets whose window covers today can be moved by a deal won
      // today, which is every won deal on this org.
      const now = new Date();
      const current = targets.filter((t) => {
        const a = new Date(`${t.period_start}T00:00:00`);
        const b = new Date(`${t.period_end}T23:59:59`);
        return a <= now && now <= b;
      });
      expect(current.length, 'no target covers today, so no deal closed today can attain ' +
        'against one and this test would pass vacuously').toBeGreaterThan(0);

      const deals = await apiRows(page, '/api/v1/graha/deals?limit=200');
      expect(deals.length, 'the deals list came back at its 200-row cap, so the reconciliation ' +
        'below would be over a page rather than the book').toBeLessThan(200);
      const won = deals.filter((d) => String(d.stage) === 'Won');
      expect(won.length, 'no deal on this org stands at Won, so there is no revenue for a ' +
        'target to claim — Suite 04 closes eight').toBeGreaterThan(0);

      // ── THE CONTROL, ON THE RECORD ────────────────────────────────────
      // A missing control is a FAILURE, never a skip. Opened by CLICKING the
      // deal on the board, which is the door a person uses.
      const board = page.locator('#mt-panel-deals');

      /** Open one deal by its title, assign it to `person`, and save. */
      async function assign(deal: any, person: string) {
        await page.goto('/graha?tab=deals');
        await expect(board, 'the CRM deals tab did not open').toBeVisible({ timeout: 60_000 });
        await settle(page);
        const card = board.locator('button.gr__link', { hasText: String(deal.title) }).first();
        await expect(card, `the deal "${deal.title}" is not on the board, so its record ` +
          'cannot be opened by clicking it').toBeVisible({ timeout: 30_000 });
        await card.click();

        const record = page.getByRole('dialog').first();
        await expect(record, `the record for "${deal.title}" did not open`)
          .toBeVisible({ timeout: 30_000 });
        await record.getByRole('button', { name: 'Edit deal' }).click();

        const sel = record.locator('select[aria-label="Assigned to"]');
        await expect(sel,
          'THE DEAL RECORD OFFERS NO WAY TO ASSIGN THE DEAL. `graha_deals.assigned_to` is ' +
          'written by `create_deal`, sits in `update_deal`’s `_DEAL_COLS`, is read by three ' +
          'screens — and is the join sales-target attainment stands on, so with no writer every ' +
          'target in every org reads Rs 0 for ever. A missing control is a failure, not a skip.')
          .toBeVisible({ timeout: 20_000 });
        const chose = await pickByLabel(sel, person, 'deal assignee');
        expect(chose, `the assignee picker chose "${chose}" and the target belongs to "${person}"`)
          .toContain(person);

        await saveAndWait(page, async () => {
          await record.getByRole('button', { name: /^Sav/ }).click();
        }, new RegExp(`/v1/graha/deals/${deal.id}$`), `assigning "${deal.title}" to ${person}`,
        ['PATCH']);
        await closeDrawer(page, record);
      }

      // ── ONE WON DEAL PER TARGET-HOLDER WHOSE PERIOD IS OPEN ───────────
      // §6: a deal already assigned to the right person is recognised, not
      // re-typed. `salesperson_name` is what the target carries and what the
      // picker offers — an id is never read, matched on, or printed.
      const holders = [...new Set(current
        .map((t) => String(t.salesperson_name || '').trim())
        .filter(Boolean))];
      expect(holders.length, 'no target resolves a salesperson NAME, so no deal can be ' +
        'assigned to the person who holds it').toBeGreaterThan(0);

      const byName = new Map<string, string>();
      for (const m of await apiRows(page, '/api/v1/org/members')) {
        const n = String(m?.full_name || '').trim();
        if (n && !byName.has(n)) byName.set(n, String(m.user_id));
      }

      let typed = 0;
      let found = 0;
      const unclaimed = won.filter((d) => !d.assigned_to);
      let next = 0;
      for (const person of holders) {
        const id = byName.get(person);
        if (!id) continue;                       // reported by 10.11, not here
        if (won.some((d) => String(d.assigned_to || '') === id)) { found++; continue; }
        const deal = unclaimed[next];
        if (!deal) break;                        // fewer won deals than holders
        next++;
        await assign(deal, person);
        typed++;
      }
      expect(typed + found, 'no won deal was assigned to anybody, so attainment could not ' +
        'move and this test would prove nothing').toBeGreaterThan(0);

      // ── AND THE NUMBER MOVED ──────────────────────────────────────────
      const dealsAfter = await apiRows(page, '/api/v1/graha/deals?limit=200');
      const wonAfter = dealsAfter.filter((d) => String(d.stage) === 'Won');
      const assignedAfter = wonAfter.filter((d) => d.assigned_to);
      expect(assignedAfter.length,
        'won deals were assigned through the deal record and the stored rows carry no ' +
        'assignee — `update_deal` binds `assigned_to=NULLIF($n,’’)`, so a value that ' +
        'does not arrive means the form is not sending it' + dumpWire(wire))
        .toBeGreaterThan(0);

      const after = await apiRows(page, '/api/v1/vikray/targets');
      const currentAfter = after.filter((t) => {
        const a = new Date(`${t.period_start}T00:00:00`);
        const b = new Date(`${t.period_end}T23:59:59`);
        return a <= new Date() && new Date() <= b;
      });

      // ⚠ THE CLOSE DATE IS NOT ON THE LIST ENDPOINT, AND READING IT THERE
      //   MADE THIS TEST ACCUSE THE PRODUCT OF ITS OWN BUG.
      //
      // `GET /v1/graha/deals` selects a NAMED column list — id, title, value,
      // stage, probability, expected_close_date, assigned_to, created_at,
      // tags, client_id, territory, the joined names — and neither `won_at`
      // nor `updated_at` is in it. Reading `d.won_at` off a list row therefore
      // yielded `undefined`, `new Date('')` is Invalid Date, every deal fell
      // out of every window, the expected figure was 0 for everyone and the
      // test reported "ATTAINMENT STILL READS ZERO FOR EVERYONE" — about a
      // join that was working. Verified against the live database the same
      // moment it failed: running `_ATTAINMENT_SQL` by hand matched exactly
      // one won deal to each of the five current-period targets.
      //
      // That is suite rule 3 in its purest form: a partial payload turns every
      // field it omits into NaN, and the failure message sounds like a defect
      // in the thing being measured. The close date comes from the RECORD.
      const closedAt = new Map<string, string>();
      for (const d of wonAfter.filter((x) => x.assigned_to)) {
        const rec = await apiOne(page, `/api/v1/graha/deals/${d.id}`);
        const full = rec?.deal ?? rec;
        const when = String(full?.won_at || full?.updated_at || '');
        expect(when, `deal "${d.title}" stands at Won and its record carries no close date, so ` +
          'no target period can contain it — `PATCH /deals/{id}` stamps `won_at` when the stage ' +
          'flips to Won').toBeTruthy();
        closedAt.set(String(d.id), when);
      }

      const problems: string[] = [];
      let moved = 0;
      for (const t of currentAfter) {
        const name = String(t.salesperson_name || '').trim();
        const id = byName.get(name);
        if (!id) continue;
        // What THIS person actually closed inside THIS window, computed from
        // Graha's own rows rather than from a figure this spec invents.
        const theirs = wonAfter.filter((d) => {
          if (String(d.assigned_to || '') !== id) return false;
          const closed = new Date(closedAt.get(String(d.id)) || '');
          if (Number.isNaN(closed.getTime())) return false;
          const a = new Date(`${t.period_start}T00:00:00`);
          const b = new Date(`${t.period_end}T23:59:59`);
          return a <= closed && closed <= b;
        });
        const expected = money(theirs.reduce((s2, d) => s2 + Number(d.value || 0), 0));
        const actual = money(t.actual_amount);
        if (!near(actual, expected, 1)) {
          problems.push(`${name}: the target reports ${actual} attained over ` +
            `${t.period_start} → ${t.period_end} and Graha holds ${expected} across ` +
            `${theirs.length} won deals assigned to them in that window`);
        }
        if (expected > 0 && actual > 0) moved++;
      }

      expect(moved,
        'ATTAINMENT STILL READS ZERO FOR EVERYONE. Deals were assigned through the real form ' +
        'and the stored rows carry the assignee, so a target still reading Rs 0 means the join ' +
        '`d.assigned_to = t.salesperson_id` is not finding them — the two sides are both TEXT ' +
        '(`vikray_targets.salesperson_id` since migration 092, `graha_deals.assigned_to` ' +
        'always), and a cast on either is the fingerprint of the wrong column.')
        .toBeGreaterThan(0);

      // ── AND THE SCREEN SAYS SO ────────────────────────────────────────
      const p = await openTab(page, 'targets', 'targets');
      await expect(p.locator('table.vk-tg'), 'the targets table did not render')
        .toBeVisible({ timeout: 30_000 });
      await expect
        .poll(async () => await p.locator('.vk-tg__bar').count(),
          { message: 'no achievement bar rendered on any target row', timeout: 20_000 })
        .toBeGreaterThan(0);

      console.log(`\n  10.12 — the assignee: ${typed} deals assigned this run, ${found} already ` +
        `assigned (§6 idempotence)\n` +
        `     won deals: ${wonAfter.length}, ${assignedAfter.length} carrying an assignee\n` +
        `     targets covering today: ${currentAfter.length}, ${moved} now reporting a ` +
        'non-zero attainment\n');

      expect(problems, 'a target’s attainment is not what the deals behind it say:\n     ' +
        problems.join('\n     ')).toEqual([]);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.13 · two commission payout runs
  // ──────────────────────────────────────────────────────────────────────────
  test('10.13 two commission payout runs, and the payout matches the ladder printed beside it',
    async ({ page }) => {
      test.setTimeout(45 * 60_000);
      const con = watchConsole(page);
      await signIn(page);

      /**
       * WHERE A "COMMISSION PAYOUT RUN" ACTUALLY LIVES.
       *
       * §4 puts "commission payout runs · 2" in this suite's row, and there is
       * no such control anywhere in Vikray. The commission a scheme produces is
       * the `core.consultant_pnl` register — "Consultant figures and
       * commission" — and its only door in the product is the Registers panel
       * on `/reports`. So that is where this drives, and it is recorded here
       * rather than filed as a Vikray gap: the payout is not a Vikray screen
       * and never was.
       *
       * ⚠ THE REGISTER IS BEHIND A PROJECT LIST. `ReportsPage` early-returns
       * "No projects found" when `GET /api/teams` is empty, and the Registers
       * panel is inside the branch it returns before. On an org with no
       * projects the commission register is therefore unreachable — which is a
       * finding about the page, not about the register, and it is named in the
       * failure below if it bites.
       */
      const teams = await apiRows(page, '/api/teams');
      const sections = await apiOne(page, '/api/v1/analytics/report-sections');
      const hasSection = (sections?.sections || [])
        .some((s: any) => String(s.key) === 'core.consultant_pnl');
      expect(hasSection,
        'the commission register is not offered to this account. `/report-sections` gates on the ' +
        'definition\'s own `reads` set — core, ganit, vikray and manav, ALL of them — so a ' +
        'caller missing any one module is not offered the firm\'s turnover per head. ' +
        `${sections?.withheld_count ?? 0} definitions were withheld.`)
        .toBeTruthy();
      expect(teams.length,
        'the commission register has exactly one door — the Registers panel on /reports — and ' +
        'that page early-returns "No projects found" when `GET /api/teams` is empty, before the ' +
        'panel is rendered at all. With no project this organisation cannot reach its own ' +
        'commission figures.')
        .toBeGreaterThan(0);

      await page.goto('/reports');
      await expect(page.locator('.gr__regs'),
        'the Registers panel did not render on /reports')
        .toBeVisible({ timeout: 60_000 });
      await settle(page);

      const card = page.locator('.gr__reg', { hasText: 'Consultant figures and commission' });
      await expect(card, 'the "Consultant figures and commission" register is not on the page')
        .toBeVisible({ timeout: 30_000 });

      /** The whole calendar month a MONTHLY scheme settles over. */
      function monthWindow(d = new Date()) {
        const y = d.getFullYear();
        const m = d.getMonth();
        const last = new Date(y, m + 1, 0).getDate();
        return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
      }
      /** The financial quarter containing `d` — a window no monthly scheme settles over. */
      function quarterWindow(d = new Date()) {
        const q = Math.floor(d.getMonth() / 3);
        const s = new Date(d.getFullYear(), q * 3, 1);
        const e = new Date(d.getFullYear(), q * 3 + 3, 0);
        const iso = (x: Date) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
        return { from: iso(s), to: iso(e) };
      }

      const RUNS = [
        { name: 'the month a monthly scheme settles over', ...monthWindow() },
        { name: 'the quarter, which no monthly scheme settles over', ...quarterWindow() },
      ];
      expect(RUNS.length, `§4 asks for ${N_PAYOUT_RUNS} commission payout runs`)
        .toBe(N_PAYOUT_RUNS);

      /**
       * The ladder as the report itself prints it, parsed back.
       *
       * `describe_bands` writes "3% on ₹100,000.00–₹500,000.00; 5% above
       * ₹750,000.00". Reading the ladder off the SAME ROW as the payout is what
       * makes this check self-contained: the assertion is that the Commission
       * column equals the Rate % column applied to the Turnover column, and
       * nothing about it is a number this spec invented.
       */
      function parseLadder(rate: string): { from: number; pct: number }[] {
        const out: { from: number; pct: number }[] = [];
        const re = /([\d.]+)%\s+(?:on|above)\s+₹([\d,]+(?:\.\d+)?)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(rate)) !== null) {
          out.push({ pct: Number(m[1]), from: Number(m[2].replace(/,/g, '')) });
        }
        return out.sort((a, b) => a.from - b.from);
      }

      /**
       * EACH BAND PAYS ON ITS OWN PORTION — decided, not configured.
       * `services/commission.commission_due`: the entry band's floor earns
       * nothing, every band runs to the next band's floor, and the total is
       * rounded ONCE at the end.
       */
      function ladderPayout(bands: { from: number; pct: number }[], basis: number): number {
        if (!bands.length) return NaN;
        const entry = bands[0].from;
        if (basis < entry) return 0;
        const reached = bands.filter((b) => basis >= b.from);
        let exact = 0;
        for (let i = 0; i < reached.length; i++) {
          const ceiling = Math.min(
            i + 1 < reached.length ? reached[i + 1].from : basis, basis);
          const slice = ceiling - reached[i].from;
          if (slice > 0) exact += slice * reached[i].pct / 100;
        }
        return Math.round(exact * 100) / 100;
      }

      const problems: string[] = [];
      const log: string[] = [];

      for (const r of RUNS) {
        // ── THE RUN ITSELF, DRIVEN AS A PERSON DRIVES IT ────────────────
        await setDate(page.locator('.gr__range'), 'From', r.from);
        await setDate(page.locator('.gr__range'), 'To', r.to);
        await expect(page.locator('.gr__range-pill'), 'the window pill did not follow the dates')
          .toBeVisible();

        const [dl] = await Promise.all([
          page.waitForEvent('download', { timeout: 120_000 }),
          card.getByRole('button', { name: 'CSV', exact: true }).click(),
        ]);
        const dest = path.join(DL, `commission-${r.from}-${r.to}.csv`);
        await dl.saveAs(dest);
        const csv = fs.readFileSync(dest, 'utf8');
        expect(csv.length, `the commission register for ${r.from} → ${r.to} downloaded as an ` +
          'empty file — a 200 with a blank body is the failure this checks for')
          .toBeGreaterThan(50);

        // ── AND THE SAME WINDOW, READ BACK ──────────────────────────────
        // The download proves the door; the JSON is what an assertion can be
        // made on without re-implementing a CSV parser badly. Same route, same
        // parameters, GET only.
        const body = await apiOne(page,
          '/api/v1/analytics/module-report?module=core&report=core.consultant_pnl' +
          `&date_from=${r.from}&date_to=${r.to}&format=json`);
        const widget = (body?.widgets || body?.sections || [body])
          .flat()
          .find((w: any) => Array.isArray(w?.data) && w.data.length) || body;
        const rows: any[] = Array.isArray(widget?.data) ? widget.data
          : Array.isArray(body?.data) ? body.data : [];
        expect(rows.length, `the commission register answered no rows for ${r.from} → ${r.to}: ` +
          `${JSON.stringify(body).slice(0, 400)}`).toBeGreaterThan(0);

        let checked = 0;
        let payable = 0;
        for (const row of rows) {
          const person = String(row?.Person ?? '');
          if (!person || person === 'All people') continue;
          const turnover = row?.Turnover;
          const commission = row?.Commission;
          const rate = String(row?.['Rate %'] ?? '');
          if (typeof turnover !== 'number' || typeof commission !== 'number') continue;

          const bands = typeof row?.['Rate %'] === 'number'
            ? [{ pct: Number(row['Rate %']), from: Number(row?.Threshold ?? 0) }]
            : parseLadder(rate);
          if (!bands.length) {
            problems.push(`${r.from}→${r.to} · ${person}: the row pays ${commission} and its ` +
              `"Rate %" cell reads ${JSON.stringify(rate)}, which states no ladder to check it ` +
              'against');
            continue;
          }
          const expectedPayout = ladderPayout(bands, turnover);
          checked++;
          if (commission > 0) payable++;
          if (!near(commission, expectedPayout, 0.05)) {
            problems.push(`${r.from}→${r.to} · ${person}: turnover ${turnover} through the ladder ` +
              `printed on the same row (${rate}) pays ${expectedPayout}, and the register says ` +
              `${commission}. Each band pays on its own portion and the entry floor earns ` +
              'nothing — services/commission.commission_due, and the owner decided it rather ' +
              'than making it configurable.');
          }
          log.push(`     ${r.from}→${r.to}  ${person.padEnd(22)} turnover ${String(turnover).padStart(12)}  ` +
            `commission ${String(commission).padStart(10)}  ${String(row?.Status ?? '')}`);
        }

        // A window that no scheme settles over must print a REASON, never a
        // zero: zero would say the ladders were reached and paid nothing.
        const nonSettling = rows.filter((row: any) =>
          typeof row?.Commission === 'string' && /none over this window/.test(row.Commission));
        log.push(`     ${r.from}→${r.to}  (${r.name}) — ${rows.length} rows, ${checked} with a ` +
          `computable payout, ${payable} paying, ${nonSettling.length} saying no scheme settles ` +
          'over this window');
      }

      console.log(`\n  10.13 — ${N_PAYOUT_RUNS} commission payout runs, downloaded from the ` +
        `Registers panel:\n${log.join('\n')}\n`);

      expect(problems, `a payout does not match the ladder printed beside it:\n     ` +
        problems.join('\n     ')).toEqual([]);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.14 · the pipeline board
  // ──────────────────────────────────────────────────────────────────────────
  test('10.14 the pipeline board values every stage, and each stage filters to the orders behind it',
    async ({ page }) => {
      test.setTimeout(30 * 60_000);
      const con = watchConsole(page);
      await signIn(page);
      con.at('pipeline');
      const p = await openTab(page, 'pipeline', 'pipeline');

      // ⚠ `apiBody`, NOT `apiOne`. `GET /pipeline` answers
      // `{data: [orders…], stages: [stages…]}` — a two-key envelope whose
      // `data` is a LIST — and `apiOne` unwraps `body.data`, which discards
      // `stages` and made this test report "no stages at all" against an
      // endpoint that builds them from a constant and cannot answer none.
      const board = await apiBody(page, '/api/v1/vikray/pipeline');
      const stages: any[] = Array.isArray(board?.stages) ? board.stages : [];
      const rows: any[] = Array.isArray(board?.data) ? board.data : [];
      expect(stages.length, 'the pipeline answered no stages at all').toBeGreaterThan(0);
      expect(rows.length, 'the pipeline answered no orders, and this org has an order book')
        .toBeGreaterThan(0);

      const problems: string[] = [];

      // Every stage's count and value must be the orders standing at it. A
      // board that disagrees with the list beneath it is the most expensive
      // false statement in the module.
      for (const s of stages) {
        const at = rows.filter((o) => String(o.status) === String(s.stage));
        if (Number(s.count) !== at.length) {
          problems.push(`stage "${s.stage}": the board counts ${s.count} and ${at.length} orders ` +
            'are standing there');
        }
        const value = money(at.reduce((n, o) => n + Number(o.total || 0), 0));
        if (!near(money(s.value), value, 1)) {
          problems.push(`stage "${s.stage}": the board values it at ${money(s.value)} and the ` +
            `orders behind it total ${value}`);
        }
      }

      // ── and the board FILTERS, in place ───────────────────────────────
      await expect(p.locator('.vk-pl__board'), 'the pipeline board did not render')
        .toBeVisible({ timeout: 30_000 });
      const buttons = p.locator('.vk-pl__st');
      await expect
        .poll(async () => await buttons.count(), { message: 'the board rendered no stages' })
        .toBeGreaterThan(1);

      // The busiest stage, so the filter has something to prove.
      const busiest = [...stages].sort((a, b) => Number(b.count) - Number(a.count))[0];
      if (busiest && Number(busiest.count) > 0) {
        const btn = p.locator('.vk-pl__st', { hasText: new RegExp(`\\b${busiest.count}\\b`) }).first();
        const target = p.locator('.vk-pl__st').filter({ hasText: /./ });
        // Address the stage by its own label rather than by position.
        const labelled = target.filter({ hasText: new RegExp(String(busiest.stage), 'i') }).first();
        const use = await labelled.count() ? labelled : btn;
        await use.click();
        await expect(use, 'the stage did not report itself pressed').toHaveAttribute('aria-pressed', 'true');
        await expect
          .poll(async () => await p.locator('button.vko__row').count(),
            { message: `filtering to "${busiest.stage}" did not narrow the list`, timeout: 20_000 })
          .toBe(Number(busiest.count));
        await p.getByRole('button', { name: 'Show all' }).first().click();
        await expect
          .poll(async () => await p.locator('button.vko__row').count(),
            { message: '"Show all" did not restore the whole board', timeout: 20_000 })
          .toBe(rows.length);
      }

      // The lede is a claim about money in flight and it must be the board's.
      const openValue = money(stages.filter((s) => s.stage !== 'closed')
        .reduce((n, s) => n + Number(s.value || 0), 0));
      const lede = await p.locator('.vk-pl__lede').innerText();
      console.log(`\n  10.14 — pipeline: ${rows.length} orders across ${stages.length} stages; ` +
        `open value ${openValue}\n     lede: ${lede.replace(/\s+/g, ' ')}\n`);

      expect(problems, `the pipeline board does not agree with the orders behind it:\n     ` +
        problems.join('\n     ')).toEqual([]);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.15 · the dashboard
  // ──────────────────────────────────────────────────────────────────────────
  test('10.15 the dashboard\'s status mix reconciles, and every count opens the rows it counts',
    async ({ page }) => {
      test.setTimeout(30 * 60_000);
      const con = watchConsole(page);
      await signIn(page);
      con.at('dashboard');
      const p = await openTab(page, 'dashboard', 'dashboard');

      const mix = await apiOne(page, '/api/v1/vikray/dashboard');
      const orders = await apiRows(page, '/api/v1/vikray/orders');
      expect(orders.length, 'the order list came back at its 200-row cap').toBeLessThan(200);

      const problems: string[] = [];
      const COUNT_KEY: Record<string, string> = {
        draft: 'draft_orders', confirmed: 'confirmed_orders',
        dispatched: 'dispatched_orders', delivered: 'delivered_orders',
      };
      for (const [status, key] of Object.entries(COUNT_KEY)) {
        const actual = orders.filter((o) => String(o.status) === status).length;
        if (Number(mix[key] ?? 0) !== actual) {
          problems.push(`the dashboard counts ${mix[key]} ${status} orders and the list holds ` +
            `${actual}`);
        }
      }
      // ⚠ "ORDER VALUE" IS THE COMMITTED BOOK, AND IT EXCLUDES DRAFTS.
      //
      // `GET /vikray/dashboard` sums `status NOT IN ('cancelled','draft')`,
      // deliberately: a draft is what somebody is still typing, and counting
      // it as order value would tell a firm it has sold something it has not
      // even quoted. This summed EVERY active order and accused the endpoint
      // of being short. Measured 2026-08-29: dashboard 791,875, all active
      // 1,101,435, the three drafts exactly 309,560 — the product was right
      // to the rupee and the expectation was wrong.
      //
      // Both figures are reported below, so a reader sees the committed book
      // and the drafts standing behind it rather than one number.
      const committed = orders.filter((o) => String(o.status) !== 'draft');
      const totalValue = money(committed.reduce((s, o) => s + Number(o.total || 0), 0));
      const draftValue = money(orders.filter((o) => String(o.status) === 'draft')
        .reduce((s, o) => s + Number(o.total || 0), 0));
      if (!near(money(mix.order_value), totalValue, 1)) {
        problems.push(`the dashboard values the order book at ${money(mix.order_value)} and the ` +
          `${committed.length} active NON-DRAFT orders total ${totalValue} ` +
          `(${draftValue} more sits in drafts, which this figure excludes on purpose)`);
      }

      // ── A COUNT IS ONLY USEFUL IF IT TAKES YOU TO THE ROWS IT COUNTS ──
      await expect(p.locator('.vk-mix'), 'the status mix did not render')
        .toBeVisible({ timeout: 30_000 });
      const draftCount = orders.filter((o) => String(o.status) === 'draft').length;
      if (draftCount > 0) {
        await p.locator('.vk-mix__b', { hasText: 'Draft' }).first().click();
        const ordersPanel = panelOf(page, 'orders');
        await expect(ordersPanel, 'clicking a dashboard count did not open the orders list')
          .toBeVisible({ timeout: 30_000 });
        await expect
          .poll(async () => await ordersPanel.locator('button.vko__row').count(),
            { message: 'the drill-in did not filter the orders list to drafts', timeout: 30_000 })
          .toBe(draftCount);
        // The filter is a real select and it must SAY which stage it is on.
        await expect(ordersPanel.locator('select.inp').first(), 'the orders list is filtered and ' +
          'its status control does not say so').toHaveValue('draft');
      }

      // ── the attention list, which is derived and not fetched ──────────
      await openTab(page, 'dashboard', 'dashboard');
      const flagged = orders.filter((o) => {
        if (o.status === 'cancelled' || o.status === 'closed') return false;
        if (o.status === 'delivered' && !o.invoice_id) return true;
        const due = o.expected_delivery ? new Date(`${o.expected_delivery}T00:00:00`) : null;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (due && due < today && (o.status === 'draft' || o.status === 'confirmed')) return true;
        return false;
      });
      if (flagged.length) {
        await expect(p.locator('ul.vk-att li').first(),
          `${flagged.length} orders need somebody and the "Needs attention" card lists none`)
          .toBeVisible({ timeout: 20_000 });
        // Colour is never the sole carrier of meaning: the reason is TEXT.
        await expect(p.locator('.vk-att__why').first(),
          'an attention row carries a tone and no reason in words')
          .toBeVisible();
      } else {
        await expect(p.locator('.vk-att__none'),
          'nothing has stalled and the card does not say so in words').toBeVisible();
      }

      console.log(`\n  10.15 — dashboard: ${orders.length} active orders, ` +
        `${committed.length} committed worth ${totalValue} plus ${draftValue} in drafts; ` +
        `${flagged.length} need somebody\n`);

      expect(problems, `the dashboard is not what the orders say:\n     ` +
        problems.join('\n     ')).toEqual([]);
      assertNoUncaught(con);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.16 · the §4 volume sheet
  // ──────────────────────────────────────────────────────────────────────────
  test('10.16 every §4 count is exact, so a second execution verifies rather than duplicates',
    async ({ page }) => {
      test.setTimeout(30 * 60_000);
      await signIn(page);

      /**
       * §6 is proved by RUNNING THE SUITE TWICE, not by claiming it — and this
       * is the test that makes the second run mean something. Every count below
       * is an EQUALITY against the §4 target, so a second execution that
       * duplicated anything reports a number that is too high rather than
       * passing on a "greater than zero" that could never fail.
       */
      const counts: { what: string; got: number; want: number }[] = [];
      const push = (what: string, got: number, want: number) => counts.push({ what, got, want });

      const orders = await myOrders(page);
      push('orders', orders.size, N_ORDERS);
      push('orders cancelled',
        [...orders.values()].filter((o) => String(o.status) === 'cancelled').length, N_CANCELLED);
      push('orders converted to an invoice',
        [...orders.values()].filter((o) => o.invoice_id).length, N_INVOICED);
      push('orders crediting a salesperson',
        [...orders.values()].filter((o) => o.salesperson_id).length, N_ORDERS);
      push('orders carrying a ship-to address',
        [...orders.values()].filter((o) => {
          const a = asAddress(o.shipping_address);
          return ['line1', 'line2', 'city', 'state', 'pincode']
            .some((k) => String(a[k] ?? '').trim());
        }).length, N_ORDERS);

      const stock = (await apiRows(page, '/api/v1/vikray/stock'))
        .filter((r) => String(r.name || '').startsWith('S05 Product '));
      push('stock items with a threshold',
        stock.filter((r) => Number(r.low_stock_threshold) > 0).length, N_STOCK_ITEMS);
      push('stock items below zero',
        stock.filter((r) => Number(r.quantity_on_hand) < 0).length, 1);

      const products = (await apiRows(page, '/api/v1/products'))
        .filter((r) => String(r.name || '').startsWith('S05 Product '));
      let humanMoves = 0;
      let lifecycleMoves = 0;
      const HUMAN = new Set(['restock', 'manual_adjustment', 'damage', 'return']);
      for (const prod of products) {
        for (const m of await apiRows(page, `/api/v1/vikray/stock/${prod.id}/moves`)) {
          if (HUMAN.has(String(m.reason))) humanMoves++; else lifecycleMoves++;
        }
      }
      push('stock movements recorded by a person', humanMoves, N_STOCK_MOVES);

      const targets = (await apiRows(page, '/api/v1/vikray/targets'))
        .filter((t) => /^S10 target \d{2}$/.test(String(t.notes || '').trim()));
      push('sales targets', targets.length, N_TARGETS);

      // The payout runs leave no row — a register is read, not written — so the
      // count is what 10.13 downloaded, and it is stated rather than inferred.
      const payouts = fs.existsSync(DL)
        ? fs.readdirSync(DL).filter((f) => /^commission-.*\.csv$/.test(f)).length
        : 0;
      push('commission payout runs downloaded', payouts, N_PAYOUT_RUNS);

      console.log('\n  10.16 — §4 volumes against the live database:\n' +
        counts.map((c) => `     ${c.got === c.want ? '✓' : '✗'} ${c.what.padEnd(38)} ` +
          `${String(c.got).padStart(4)} / ${c.want}`).join('\n') +
        `\n     (plus ${lifecycleMoves} stock movements stamped by the order lifecycle, which ` +
        'nobody typed and §4 does not count)\n');

      const wrong = counts.filter((c) => c.got !== c.want);
      expect(wrong.map((c) => `${c.what}: ${c.got} (wanted ${c.want})`),
        'a §4 volume is not exact. A count ABOVE the target on a second execution means ' +
        '`ensure()` failed to recognise this suite\'s own marks and duplicated them; a count ' +
        'BELOW it means the run that made them did not finish, or a control it needed does not ' +
        'exist. All three are reported here and none is ruled on.').toEqual([]);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 10.17 · not one UUID on any Sales screen
  // ──────────────────────────────────────────────────────────────────────────
  test('10.17 no Sales screen paints a UUID', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    /**
     * ⚠ `frontend/scripts/check-rendered-ids.mjs` IS STATIC AND POSITIONAL.
     *
     * It reads JSX and cannot see an id the SERVER pre-formatted into a string
     * — two blind spots of exactly that shape have already been found, and one
     * of them was this module's own targets table falling back to
     * `salesperson_id` when the name did not resolve. So this reads the PAINTED
     * TEXT of every Sales screen, now that the module holds thirty-five orders,
     * a stock ledger and ten targets, and looks for the shape of a uuid — and
     * for the shape of a `user_xxx` login id, which is not a uuid and is just
     * as much a machine string in a place a human name belongs.
     */
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const LOGIN = /\buser_[0-9a-f]{8,}\b/i;
    const found: string[] = [];

    for (const t of TABS) {
      con.at(t.id);
      const p = await openTab(page, t.id, t.label);
      const text = await p.innerText().catch(() => '');
      for (const [what, re] of [['uuid', UUID], ['login id', LOGIN]] as const) {
        const m = text.match(new RegExp(re.source, 'gi'));
        if (!m) continue;
        for (const hit of [...new Set(m)].slice(0, 3)) {
          const at = text.indexOf(hit);
          found.push(`${t.id} (${what}): …${text.slice(Math.max(0, at - 60), at + hit.length + 20)
            .replace(/\s+/g, ' ')}…`);
        }
      }
    }

    // One record drawer as well — the surface most likely to carry one, because
    // it renders a single row's every field rather than a chosen set of columns.
    const p = await openTab(page, 'orders', 'orders');
    const orders = await apiRows(page, '/api/v1/vikray/orders');
    if (orders.length) {
      const drawer = await openOrder(page, p, String(orders[0].order_number));
      const text = await drawer.innerText();
      for (const [what, re] of [['uuid', UUID], ['login id', LOGIN]] as const) {
        const m = text.match(new RegExp(re.source, 'gi'));
        if (m) found.push(`order drawer (${what}): ${[...new Set(m)].slice(0, 3).join(', ')}`);
      }
      await closeDrawer(page, drawer);
    }

    expect(found, 'a machine identifier is painted on a Sales screen. Names, never ids — and the ' +
      'ratchet cannot catch this one, because it is static and positional and cannot see an id ' +
      `the server formatted into a string:\n     ${found.join('\n     ')}`).toEqual([]);

    console.log(`\n  10.17 — ${TABS.length} Sales screens and one record drawer scanned, ` +
      'no identifier painted\n');
    assertNoUncaught(con);
  });
});
