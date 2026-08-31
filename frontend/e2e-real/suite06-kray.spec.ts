/**
 * Proposal 93 · Stage 3 · WAVE 4 · SUITE 06 — Kray (procurement), on Unicode
 * Group, at §4 volumes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE, AND THE GUARD THAT PROVES IT
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` + `signInAs()` from `_lanes.ts`, which calls `assertOrg()`
 * itself at the end of the token branch. Read that file's header before
 * changing a line here: on 2026-08-28 a write suite renamed **Aekam Inc** —
 * the one org proposal 93 guarantees is untouched — because the credential in
 * use held `platform_admin` and every request resolved to Aekam via
 * `platform_bypass`. The save genuinely succeeded and the suite went GREEN.
 *
 * `signIn()` below re-asserts AFTER pinning the active-org key, because that
 * key is written after the door opens and it is the key that decides which org
 * `X-Org-Id` names.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 1 — EVERY ROW HERE IS TYPED BY A USER
 * ═══════════════════════════════════════════════════════════════════════════
 * Every vendor, purchase order, line, submission, approval, receipt, close and
 * budget below is made by opening the screen, filling the real inputs, choosing
 * from the real pickers and pressing the real button. No SQL. No
 * `page.request.post/put/patch/delete`.
 *
 * `page.request.get` IS used — `apiRows()` / `apiOne()` — and that is the
 * ratchet's own carve-out: asserting the row appeared IS the required evidence.
 * Both send **`X-Org-Id`** (`frontend/src/lib/api.js`), because a read helper
 * that omits it makes the server fall back to the caller's OLDEST membership
 * and answer for a different organisation than the screen beside it. This
 * account holds seats in more than one org, so that is not hypothetical.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 2 — STOP AND REPORT. NO VERDICT.
 * ═══════════════════════════════════════════════════════════════════════════
 * Where a control §4 or §10 requires does not exist, the test FAILS and prints
 * what it looked for and what the live wire returned. Nothing is skipped and no
 * assertion is softened. 93 §14 reserves the product-bug-versus-test-bug
 * judgement to the owner.
 *
 * ⚠ ONE TEST FAILS UNTIL A DEPLOY LANDS, and it is written that way on purpose:
 *
 *   06.07  §4 asks for **4 revisions** and §10 for "PO raise, REVISE, approve".
 *          `PATCH /api/v1/procurement/purchase-orders/{po_id}` is a complete,
 *          deployed feature — it snapshots the previous state whole, writes a
 *          field-by-field diff into `staging.ganit_po_revisions`, and sends the
 *          order back down the approval path when `needs_reapproval` says the
 *          rise is material (`routers/procurement.py:786-964`). And
 *          `PurchaseOrderDetail.jsx` RENDERS A "Revision history" PANEL for the
 *          rows it produces.
 *
 *          THE DEPLOYED BUILD HAS NO CONTROL THAT CALLS IT. Measured
 *          2026-08-29 by enumerating every frontend call to that path: the tab
 *          GETs the list and POSTs a create; the drawer GETs the record and the
 *          match, and POSTs to `/submit`, `/approve`, `/reject`, `/receipts`
 *          and `/close`. There was no `api.patch` and no `api.delete` on
 *          `/v1/procurement/purchase-orders` in the whole of `frontend/src`.
 *          So an order could not be edited after it was raised — not as a
 *          revision once issued, and not even in place while it was still a
 *          draft — and `ganit_po_revisions` has held **0 rows for its entire
 *          life**. That is the recurring shape this programme keeps finding: a
 *          column or a route that is API-writable, already rendered, and
 *          unreachable by a human. `ganit_vendors.address`,
 *          `ganit_expenses.receipt_urls` and `ganit_recurring.notes` are the
 *          same defect one field smaller.
 *
 *          THE CONTROL IS ADDED, in `PurchaseOrderDetail.jsx` — "Revise" on an
 *          issued order, "Edit" on a draft, neither on one that is closed or
 *          cancelled — and proved by ten cases in
 *          `pages/procurement/__tests__/purchaseOrders.test.jsx`, each of which
 *          was watched to go red with the button removed and green with it back.
 *          THIS SPEC DRIVES IT, and against a Vercel build that predates the
 *          change 06.07 fails on the missing control and 06.10 reports
 *          revisions 0 / 4. Both are the correct answer for that build. What
 *          closes them is a deploy, not another edit — and a volume sheet that
 *          quietly omitted the line it could not meet would be the silent cap
 *          §10 warns about.
 *
 * ── SPLIT SO THAT ONE FAILURE CANNOT HIDE THE REST ─────────────────────────
 * Each stage of the lifecycle is its own test. The first draft of this file put
 * raise, submit, approve, receive and close in one; the missing revise control
 * aborted it and reported four §4 lines as untested when they had simply never
 * been reached.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE STATUTORY HALF — where green can be wrong
 * ═══════════════════════════════════════════════════════════════════════════
 * A purchase order's tax split is derived from THE SUPPLIER'S STATE, not the
 * customer's: `derive_is_igst(org_state_code, vendor_gstin, fallback)` compares
 * the first two characters of the vendor's GSTIN against the org's
 * `state_code`. Unicode Group is Gujarat, GST state code **24** — and that is
 * READ from the live org profile here, never typed as a constant, because a
 * suite that hardcodes its own state cannot notice when the state changes
 * underneath it.
 *
 *   · a Gujarat supplier  → intra-state → CGST + SGST in equal halves
 *   · a Maharashtra one   → inter-state → the whole tax as IGST
 *   · a supplier with NO GSTIN → neither can be derived, so the form's own
 *     "Inter-state (IGST)" checkbox decides, and GSTIN blocks nothing. That is
 *     the standing product rule and 06.02 and 06.05 both prove it rather than
 *     restating it.
 *
 * Suite 05 left fourteen suppliers and every one of them is Gujarat or has no
 * GSTIN at all, so the IGST branch of `derive_is_igst` cannot be reached from
 * the existing register. That is the whole reason 06.02 types a Maharashtra
 * supplier, and it is one of the two vendors this suite creates.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 — RE-RUNNABLE, AND PROVED BY RUNNING IT TWICE
 * ═══════════════════════════════════════════════════════════════════════════
 * Every record carries a DETERMINISTIC mark built from `TAG`, so a second
 * execution recognises its own output and verifies instead of duplicating:
 * `ensure()` reads the live list first and types only what is missing.
 *
 *   purchase orders  `notes`  — "S06-PO-07". A PO carries no reference field a
 *                    person can type other than Notes and Terms: `po_number` is
 *                    minted by the server AT ISSUE and never before, precisely
 *                    so a discarded draft leaves no gap in the series. ⚠ The
 *                    LIST endpoint does not return `notes`, so the mark is read
 *                    from the RECORD, one GET per order — which is what a
 *                    person would have to do as well.
 *   lines            `description` — "S06-PO-07 L2"
 *   receipts         `note` — "S06-RCPT-04"
 *   vendors          `name` — "S06 Vendor 01"
 *   budgets          `department` — the budget list is keyed by it
 *   approvals        the order's own status: an issued order with an approval
 *                    row on its current revision is not approved twice.
 *
 * `RUN` — a per-run stamp — appears only where a value must differ run to run.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §10 — THE NINE SCREENS, NAMED, BECAUSE A SILENT CAP READS AS FULL COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════
 * §10 defines Suite 06 as nine screens. Each is named with the test that drives
 * it, and `KrayPage.jsx`'s ten tabs are opened and read in 06.01 and 06.11:
 *
 *   1 vendor form from the Kray side      06.02 — and the field-set comparison
 *                                                 against Ganit · Payables
 *   2 PO raise                            06.04 — 12 orders, 34 lines
 *   3 PO revise                           06.07 — NO CONTROL EXISTS. Fails.
 *   4 approve                             06.05 — from the drawer AND from the
 *                                                 approvals queue
 *   5 part receipt                        06.06
 *   6 full receipt                        06.06
 *   7 close                               06.08
 *   8 approval threshold above and below  06.05 — six each side of ₹2,00,000
 *   9 budget set and breached             06.03 (set) · 06.09 (breached, and
 *                                                 the order that crossed the
 *                                                 limit and was accepted anyway)
 *
 * Plus the record surfaces: `POSettingsPanel` (06.03), `PurchaseOrderDetail`
 * (04–08), its receipt form, its close-short form, its bill-link panel and its
 * three-way match (06.06b), `POApprovalsTab`'s queue and three exception
 * reports (06.05, 06.01), `BudgetsTab` (06.09) and `KrayReportsTab` (06.01).
 *
 * WHAT IS DELIBERATELY NOT DRIVEN, said rather than left to read as covered:
 *   · `POST /purchase-orders/{id}/issue` and `DELETE /purchase-orders/{id}`
 *     have no control either. They are reported in 06.07 alongside the PATCH
 *     and are not separately failed, because one missing-control finding on one
 *     record surface is one finding.
 *   · `/reject` IS reachable (the drawer and the queue both offer it) and is
 *     NOT exercised: rejecting one of the six above-threshold orders would
 *     spend an approval row on a decision §4 does not ask for and leave the
 *     order needing a second submit. Named here so the zero is not misread.
 *   · The bill link in 06.06b is placed on an order with NO receipts and is
 *     UNLINKED again, deliberately. Recording a receipt while a bill is linked
 *     writes `ganit_vendor_bills.acceptance_date` — a STATUTORY MSME date — and
 *     the unlink control does not clear it. Suite 05 owns those fourteen bills.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SENDING — WHY THIS SUITE NEEDS NO OUTBOUND FENCE
 * ═══════════════════════════════════════════════════════════════════════════
 * `GET /api/health` reports `outbound_mode=live` with `suppressed_orgs_digest`
 * `"0"` — nothing is shielded — so `assertOutboundFenceFor()` would fail here
 * by design, and it is deliberately NOT called. It does not need to be:
 * `backend/routers/procurement.py` and `backend/services/purchase_orders.py`
 * contain no reference to `email_service`, `send_email` or `outbound` at all
 * (measured 2026-08-29). **A purchase order cannot be sent to anybody**, which
 * `docs/STATUS.md` records as a live gap in this module and this suite neither
 * fixes nor works around. Nothing below can reach a mailbox.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TRAPS THIS FILE IS WRITTEN AROUND
 * ═══════════════════════════════════════════════════════════════════════════
 * · ⚠ **`KrayPage`'s tab ids CONTAIN A SPACE.** `TABS[0]` is
 *   `'purchase orders'`, so `ModuleTabs` renders `id="mt-tab-purchase orders"`
 *   and `id="mt-panel-purchase orders"`. `#mt-panel-purchase orders` is not a
 *   valid CSS id selector and silently matches nothing, so every locator here
 *   uses the ATTRIBUTE form `[id="mt-panel-purchase orders"]`.
 * · `KrayPage` does not read its tab from the URL — it keeps it in local state
 *   — so `/kray?tab=budgets` navigates nowhere. Tabs are CLICKED.
 * · `ModuleTabs` measures how many tabs FIT at run time and pushes the rest
 *   behind "More +N", so which of the ten is inline is not knowable from the
 *   source. `openTab()` tries the strip, then the popover, and FAILS naming the
 *   tab if it is in neither — an unreachable tab is a product finding.
 * · `page.reload()` on the line after Save races the write. Everything goes
 *   through `saveAndWait()`, which returns the SERVER's status. A toast is the
 *   client's opinion.
 * · Saving a purchase order OPENS ITS DRAWER: `savePO` sets `openId` from the
 *   write response. The lifecycle continues in that drawer rather than hunting
 *   the new row in a list ordered by `created_at`.
 * · `pickProduct` OVERWRITES `rate`, `gst_rate` and `hsn_code` from the
 *   catalogue, and keeps a description already typed. So a line picks its
 *   product FIRST and types its own figures after — the other order silently
 *   loses them.
 * · `fill('')` does not register with a controlled React input — clearing is
 *   select-all-then-type (`typeInto`).
 * · A vacuous assertion passes for ever. EVERY loop below asserts its count
 *   BEFORE it iterates.
 * · The drawer is a `createPortal` onto `document.body`, so it is NOT inside
 *   the tab panel and every drawer locator is scoped to `.dr.gnd`.
 * · `getByRole(name)` matches the ACCESSIBLE name, not the visible text.
 * · No user, member or org UUID is ever rendered or asserted. 06.11 scans the
 *   PAINTED TEXT of every Kray screen for one, because `check-rendered-ids.mjs`
 *   is static and positional and cannot see an id the server formatted into a
 *   string.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave4.config.ts --project kray
 */
import { test, expect, Page, Locator } from '@playwright/test';
import { lane, activeLane, signInAs as laneSignIn, assertOrg, ORG as ORG_IDS } from './_lanes';
import { setDate, isForeignInlineScriptRefusal } from './_helpers';

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
  'platform_bypass and will write there. ENVIRONMENT blocker, not a product ' +
  'or test defect.';

/** The suite's own mark. Deterministic — §6 idempotence hangs off it. */
const TAG = 'S06';
/** A per-run stamp, for the handful of values that must differ run to run. */
const RUN = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

const pad = (n: number) => String(n).padStart(2, '0');
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── §4 VOLUMES, stated once ─────────────────────────────────────────────────
const N_POS = 12;
const N_LINES = 34;
const N_REVISIONS = 4;
const N_RECEIPTS = 10;
const N_APPROVALS = 6;
const N_BUDGETS = 4;
const N_BREACHED = 1;
/**
 * Two, and exactly two.
 *
 * §4's fourteen vendors are Suite 05's and are NOT re-typed here — doubling
 * them would corrupt that suite's volume sheet. What §10 asks of this suite is
 * "vendor form from the Kray side (field set identical to Ganit's)", which is a
 * COMPARISON. Two rows are typed because a form that renders is not a form that
 * writes, and because the two shapes the existing fourteen cannot express are
 * exactly the two that matter here: an out-of-state supplier (the only way to
 * reach the IGST branch) and one recorded with no GSTIN at all from THIS
 * surface.
 */
const N_VENDORS_TYPED = 2;

/** The approval rule's floor, in rupees. Six orders sit each side of it. */
const THRESHOLD = 200000;
/** What this org numbers purchase orders with, typed in 06.03. */
const PO_PREFIX = 'KRY';

/**
 * The four departments and their limits.
 *
 * ⚠ A budget is keyed on `manav_employees.department`, which is FREE TEXT and
 * governed nowhere — the settings screen and `budget_state()` both say so out
 * loud, and matching is case-insensitive on the trimmed string to recover the
 * common near-misses. These four are typed identically on the budget and on
 * every order, which is the only arrangement in which the join can be trusted.
 *
 * The limits are CONSTANTS derived from the order plan below, not from a live
 * reading, so a second execution recomputes the same four numbers and types
 * nothing. Committed spend counts `issued · part_received · received` only —
 * a draft is not a commitment and a closed order has discharged its own — so
 * the arithmetic in the comment beside each is over the orders that reach an
 * open status and stay there.
 */
const BUDGETS = [
  // 42,480 + 212,400 + 56,700 = 311,580 → 62.3% → on track
  { department: 'Audit', limit: 500000, alertPct: 80 },
  // 254,880 + 84,960 + 297,360 = 637,200 → 91.0% → near limit
  { department: 'Operations', limit: 700000, alertPct: 80 },
  // 95,580 + 318,600 + 70,800 = 484,980 → 161.7% → OVER. The one breach §4
  // asks for, and it is already over on the second of the three orders.
  { department: 'IT', limit: 300000, alertPct: 80 },
  // 339,840 + 265,500 = 605,340 once PO 09 is closed short → 50.4% → on track
  { department: 'Marketing', limit: 1200000, alertPct: 80 },
];
const OVER_BUDGET_DEPT = 'IT';

/**
 * The twelve orders, and the thirty-four lines.
 *
 * `lines` is 3 on the first ten and 2 on the last two: 3×10 + 2×2 = 34, which
 * is §4's own number and not a round one. Line j carries qty j+1 (2, 3, 4) at
 * the order's rate, so every line total is distinct and the arithmetic below
 * can be checked by hand.
 *
 * `rate` is chosen so that six orders land at or above the ₹2,00,000 approval
 * threshold and six below it — §4's "one above and one below", six times over.
 * `gst` exercises three of the four slabs the Council actually levies since
 * 22 Sep 2025 (0 · 5 · 18); 12% and 28% are abolished and are deliberately
 * never used, because an order born carrying one is the exact defect the "Dead
 * Slabs" check exists to find and seeding it would be manufacturing the finding.
 *
 * `vendor` walks Suite 05's register so that most of the fourteen suppliers
 * carry an order, and finishes on the two this suite types — the Maharashtra
 * supplier (IGST) and the one with no GSTIN (the checkbox decides).
 */
type PoPlan = {
  n: number; dept: string; cat: string; lines: number;
  rate: number; gst: number; vendor: string; igst: boolean;
};
const PO_PLAN: PoPlan[] = [
  { n: 1, dept: 'Audit', cat: 'Stationery', lines: 3, rate: 4000, gst: 18, vendor: 'S05 Vendor 01', igst: false },
  { n: 2, dept: 'Audit', cat: 'Software', lines: 3, rate: 20000, gst: 18, vendor: 'S05 Vendor 02', igst: false },
  { n: 3, dept: 'Audit', cat: 'Stationery', lines: 3, rate: 6000, gst: 5, vendor: 'S05 Vendor 03', igst: false },
  { n: 4, dept: 'Operations', cat: 'Consumables', lines: 3, rate: 24000, gst: 18, vendor: 'S05 Vendor 04', igst: false },
  { n: 5, dept: 'Operations', cat: 'Consumables', lines: 3, rate: 8000, gst: 18, vendor: 'S05 Vendor 05', igst: false },
  { n: 6, dept: 'Operations', cat: 'Machinery', lines: 3, rate: 28000, gst: 18, vendor: 'S05 Vendor 06', igst: false },
  { n: 7, dept: 'IT', cat: 'Hardware', lines: 3, rate: 9000, gst: 18, vendor: 'S05 Vendor 07', igst: false },
  { n: 8, dept: 'IT', cat: 'Hardware', lines: 3, rate: 30000, gst: 18, vendor: 'S05 Vendor 08', igst: false },
  { n: 9, dept: 'Marketing', cat: 'Print', lines: 3, rate: 10000, gst: 0, vendor: 'S05 Vendor 09', igst: false },
  { n: 10, dept: 'Marketing', cat: 'Print', lines: 3, rate: 32000, gst: 18, vendor: 'S05 Vendor 10', igst: false },
  // The Maharashtra supplier. `derive_is_igst` reads '27' off its GSTIN against
  // this org's '24' and answers IGST — the checkbox is NOT touched, so what is
  // proved is the DERIVATION and not the fallback.
  { n: 11, dept: 'Marketing', cat: 'Events', lines: 2, rate: 45000, gst: 18, vendor: `${TAG} Vendor 01`, igst: true },
  // No GSTIN at all. Neither side of the comparison exists, so the form's own
  // checkbox is the whole answer — left unticked, which is intra-state.
  { n: 12, dept: 'IT', cat: 'Hardware', lines: 2, rate: 12000, gst: 18, vendor: `${TAG} Vendor 02`, igst: false },
];

/** Orders that must clear an approval before they can be issued. */
const aboveThreshold = (p: PoPlan) => poTotals(p).total >= THRESHOLD;

/**
 * ── THE FOUR REVISIONS §4 ASKS FOR ─────────────────────────────────────────
 *
 * One per order, on four orders nothing has been delivered against — a line
 * something has arrived against cannot be removed and a quantity cannot be cut
 * below what turned up, and both are the SERVER's refusals rather than this
 * suite's preference.
 *
 * The four are chosen to walk every arm of `needs_reapproval`, and to do it
 * WITHOUT spending a seventh approval on a decision §4 does not ask for:
 *
 *   R1  S06-PO-12 · a line quantity doubles. ₹70,800 → ₹99,120, a rise of
 *       ₹28,320 against this organisation's ₹10,000 flat threshold, so it IS
 *       material. And the order is still under the ₹2,00,000 approval rule
 *       afterwards, so `match_rule` finds nobody to ask — the revision records
 *       that the change WAS material while the order stays issued, which is the
 *       one branch of that function a reader would otherwise never see.
 *   R2  S06-PO-03 · the expected date moves. No money changes, so `delta <= 0`
 *       and the change flows through the authorisation already given.
 *   R3  S06-PO-06 · the category is corrected on an order ABOVE the threshold.
 *       Proves that a non-monetary edit to a big order does NOT drag it back
 *       through approval — the failure mode that makes people stop editing.
 *   R4  S06-PO-01 · the terms are rewritten. `terms` is one of the eleven
 *       fields `DIFFED_FIELDS` records, so the revision must carry it.
 *
 * ⚠ The mark lives in `notes` and NOTHING here touches it.
 */
type RevisionPlan = {
  r: number; po: number; reason: string; material: boolean;
  qty?: { line: number; to: number };
  expected?: string;
  category?: string;
  terms?: string;
};
const REVISION_PLAN: RevisionPlan[] = [
  {
    r: 1, po: 12, material: true, qty: { line: 1, to: 4 },
    reason: 'The site needs twice the quantity on line 1',
  },
  {
    r: 2, po: 3, material: false, expected: '2026-09-15',
    reason: 'The supplier asked for three more weeks',
  },
  {
    r: 3, po: 6, material: false, category: 'Machinery · plant',
    reason: 'Booked to the wrong category when it was raised',
  },
  {
    r: 4, po: 1, material: false,
    terms: 'Payment 45 days from acceptance. Delivery to the Audit store, in one consignment.',
    reason: 'Terms renegotiated with the supplier',
  },
];

/** The quantity a revision leaves on a line, when it changes one. */
const revisedQty = (po: number, line: number): number | null => {
  const rev = REVISION_PLAN.find((x) => x.po === po && x.qty?.line === line);
  return rev ? rev.qty!.to : null;
};

/**
 * The category a revision leaves on an order, when it changes one.
 *
 * ⚠ THE SAME SHAPE AS `revisedQty`, AND IT WAS MISSING. 06.04 asserted every
 * order still carries the category it was RAISED with — while REVISION_PLAN
 * r:3 deliberately re-categorises PO 6 to 'Machinery · plant', and 06.07 drives
 * that revision. So the two tests disagreed about the same order by design, and
 * whichever ran second lost.
 *
 * Quantity already had this helper for exactly the same reason. Category did
 * not, which is the whole defect.
 */
const revisedCategory = (po: number): string | null => {
  const rev = REVISION_PLAN.find((x) => x.po === po && x.category);
  return rev ? rev.category! : null;
};

/**
 * The order total, computed the way the SERVER computes it.
 *
 * Same order of operations as `services/purchase_orders.compute_po_totals` and
 * as the form's own `previewTotals`: the line total is rounded first, GST is
 * taken on the rounded figure, and CGST and SGST are each half of that rounded
 * again. A money assertion that names its own expected number cannot be wrong;
 * this derives it, and 06.04 asserts the server agrees to the paisa.
 *
 * `revised` selects the figures AFTER this order's planned revision, because a
 * revision that changes a quantity changes the total and therefore the
 * committed-spend reconciliation in 06.09 as well. Which of the two applies is
 * decided by the LIVE `revision` counter on the record, never assumed.
 */
function poTotals(p: PoPlan, revised = false) {
  let subtotal = 0; let cgst = 0; let sgst = 0; let igst = 0;
  for (let j = 1; j <= p.lines; j++) {
    const qty = (revised ? revisedQty(p.n, j) : null) ?? (j + 1);
    const lineTotal = r2(qty * p.rate);
    const gst = r2((lineTotal * p.gst) / 100);
    if (p.igst) igst += gst;
    else { cgst += r2(gst / 2); sgst += r2(gst / 2); }
    subtotal += lineTotal;
  }
  return {
    subtotal: r2(subtotal), cgst: r2(cgst), sgst: r2(sgst), igst: r2(igst),
    total: r2(subtotal + cgst + sgst + igst),
  };
}

/**
 * The ten receipts, and which order each lands on.
 *
 * PO 05 is the part-then-full journey §10 names: one receipt short of the first
 * line's quantity leaves the order `part_received`, and three more complete
 * every line and take it to `received`. PO 07 is received in one pass per line.
 * PO 02 is left deliberately part-received, and PO 09 takes a single delivery
 * and is then closed short in 06.08 — which is exactly the case close-short
 * exists for.
 */
type Receipt = { r: number; po: number; line: number; qty: number };
const RECEIPTS: Receipt[] = [
  { r: 1, po: 5, line: 1, qty: 1 },   // line 1 ordered 2 → part_received
  { r: 2, po: 5, line: 1, qty: 1 },   // completes line 1
  { r: 3, po: 5, line: 2, qty: 3 },
  { r: 4, po: 5, line: 3, qty: 4 },   // every line full → received
  { r: 5, po: 7, line: 1, qty: 2 },
  { r: 6, po: 7, line: 2, qty: 3 },
  { r: 7, po: 7, line: 3, qty: 4 },   // received
  { r: 8, po: 2, line: 1, qty: 2 },
  { r: 9, po: 2, line: 2, qty: 1 },   // stays part_received
  { r: 10, po: 9, line: 1, qty: 2 },  // one delivery, then closed short
];

/** The order closed short, and the reason — which must come from the org's list. */
const CLOSE_PO = 9;
const CLOSE_REASON = 'Vendor cannot supply the balance';

/** `KrayPage.jsx`'s ten tabs, in the order it declares them. */
const TABS: { id: string; label: string }[] = [
  { id: 'purchase orders', label: 'purchase orders' },
  { id: 'vendors', label: 'vendors' },
  { id: 'payables', label: 'payables' },
  { id: 'approvals', label: 'approvals' },
  { id: 'budgets', label: 'budgets' },
  { id: 'rate-cards', label: 'rate cards' },
  { id: 'sla-credits', label: 'sla credits' },
  { id: 'ageing', label: 'ageing' },
  { id: 'reports', label: 'reports' },
  { id: 'settings', label: 'settings' },
];

// ── the record marks §6 finds its own output by ─────────────────────────────
const poMark = (n: number) => `${TAG}-PO-${pad(n)}`;
const lineDesc = (n: number, j: number) => `${TAG}-PO-${pad(n)} L${j}`;
const receiptNote = (r: number) => `${TAG}-RCPT-${pad(r)}`;
const vendorName = (n: number) => `${TAG} Vendor ${pad(n)}`;

/** Order dates, so the register is not twelve rows all dated today. */
const poDate = (n: number) => `2026-08-${pad(n)}`;
const expectedDate = (n: number) => `2026-08-${pad(n + 7)}`;

/**
 * A GSTIN that is actually VALID, built rather than invented.
 *
 * The shape regex alone accepts any fifteen characters in the right
 * arrangement, so a transposed pair — the commonest typing error in a code this
 * long — would sail through, and the GSTN checksum is what catches it. Both
 * `validators.js::gstinChecksum` and the server's validator compute it, so a
 * fixture that ignores it tests nothing except the error path.
 *
 * ⚠ Every number this builds is SYNTHETIC. The PAN block is `AAACK*****`
 * against invented serials for companies that do not exist.
 */
const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstin(stateCode: string, panBody: string): string {
  const first14 = `${stateCode}${panBody}`;
  expect(first14.length, `a GSTIN's first fourteen characters are ${first14.length}: ${first14}`)
    .toBe(14);
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARSET.indexOf(first14[i]);
    expect(value, `"${first14[i]}" is not a GSTIN character`).toBeGreaterThanOrEqual(0);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return first14 + GSTIN_CHARSET[(36 - (sum % 36)) % 36];
}

/** GST state codes for the two states this suite names. Statutory; they do not drift. */
const GUJARAT = '24';
const MAHARASHTRA = '27';

/**
 * The GST state codes, as the product itself carries them
 * (`frontend/src/lib/validators.js` GST_STATES). Copied rather than imported
 * because a spec importing application source drags Vite's module graph into
 * the Playwright runtime; the values are statutory and do not drift.
 *
 * ⚠ THIS TABLE IS A FALLBACK AND IT SHOULD NOT HAVE TO BE. `state_code` — the
 * numeric GST code of the place this firm supplies FROM — is a real column on
 * `staging.organisations` and Unicode Group's holds '24'. Measured against the
 * DEPLOYED staging build on 2026-08-29: `GET /api/v1/org/profile` returns
 * `name · gstin · pan · tan · billing_address · logo_url · email · phone ·
 * website · bank_details · invoice_note · logo_key · description · industry ·
 * team_size · founded_year · id` and NO `state_code` key at all. The working
 * tree's `routers/org_profile.py` adds it to `_PROFILE_COLUMNS` — with a long
 * comment about exactly this — but that change is UNCOMMITTED, so the deployed
 * build cannot answer the question and this suite reads the state NAME off the
 * billing address instead. When the fix lands, `state_code` is preferred and
 * this table stops being consulted; the assertion is written to take either.
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
 * The two suppliers this suite types, from the KRAY side of the shared form.
 *
 * Every one of the six MSME/TDS columns is filled on both, because that is what
 * owner decision 0.20 closed and the regression it closed is a form that
 * silently drops half its fields. `S06 Vendor 02` carries NO GSTIN, which is
 * the standing product rule proved rather than restated.
 */
const VENDOR_PLAN = [
  {
    n: 1, gstinState: MAHARASHTRA, pan: 'AAACK0100A1Z',
    city: 'Pune', state: 'Maharashtra', pincode: '411001',
    isMsme: 'yes', cls: 'small', kind: 'manufacturer',
    udyam: 'UDYAM-MH-26-0000101', tds: '194C', terms: '45',
  },
  {
    n: 2, gstinState: '', pan: '',
    city: 'Surat', state: 'Gujarat', pincode: '395002',
    isMsme: 'no', cls: 'medium', kind: 'trader',
    udyam: 'UDYAM-GJ-03-0000202', tds: '194Q', terms: '30',
  },
];

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
 * this account holds more than one seat.
 */
async function signIn(page: Page) {
  /* ONE retry, and only around the door.
     `_lanes.signInAs` does `goto('/login')` and then `page.evaluate` to write
     the token, and the SPA can redirect out of /login in between — which throws
     "Execution context was destroyed, most likely because of a navigation".
     Measured on this suite's first execution: it took 06.09 down and reported a
     budget failure that was nothing of the kind. It is an ENVIRONMENT flake in
     the shared helper, not a product fault and not this suite's to fix, so it is
     absorbed HERE rather than by editing a file eight other specs depend on
     mid-wave. A second failure is not absorbed — it is thrown. */
  try {
    await laneSignIn(page, LANE);
  } catch (e) {
    if (!/Execution context was destroyed|navigation/i.test(String(e))) throw e;
    await laneSignIn(page, LANE);
  }
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

/** The whole envelope of an endpoint that answers a record rather than a list. */
async function apiEnvelope(page: Page, pathAndQuery: string): Promise<any> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  return await res.json();
}

/**
 * Every purchase order this suite has ever made, keyed by its Notes mark.
 *
 * ⚠ `GET /v1/procurement/purchase-orders` SELECTS seventeen columns and `notes`
 * is not among them (`routers/procurement.py:508-517`), so the mark cannot be
 * read from the register. Neither can `department`'s sibling `notes` be seen on
 * the screen: the list row paints the supplier, the number, the value, the
 * badge, the dates and the department. So this asks the RECORD, one GET per
 * order, which is what a person would have to do as well.
 *
 * Returns the full record envelope — `data`, `lines`, `receipts`, `revisions`,
 * `approvals`, `bills`, `approval`, `editable` — because every later assertion
 * wants a different part of it and re-reading is the more expensive mistake.
 */
async function myOrders(page: Page): Promise<Map<string, any>> {
  const list = await apiRows(page, '/api/v1/procurement/purchase-orders');
  const out = new Map<string, any>();
  for (const row of list) {
    const env = await apiEnvelope(page, `/api/v1/procurement/purchase-orders/${row.id}`);
    const mark = String(env?.data?.notes || '').trim();
    if (mark.startsWith(`${TAG}-PO-`)) out.set(mark, env);
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
 * CORS middleware attaches no headers to an unhandled 500.
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
    const full = m.text();
    // Cloudflare injects its own `__CF$cv$` loader carrying a per-request token,
    // so its hash differs on every load and can never be allowed by hash.
    // CLASSIFIED, not ignored: a refusal of OUR bootstrap still fails. _helpers.
    if (isForeignInlineScriptRefusal(full)) return;
    errors.push({ where, text: full.slice(0, 240) });
  });
  page.on('pageerror', (e) => {
    errors.push({ where, text: `UNCAUGHT ${String(e?.message ?? e).slice(0, 240)}` });
  });
  return { errors, at: (w: string) => { where = w; } };
}

const dumpConsole = (c: Watcher) =>
  c.errors.map((e) => `\n     [${e.where}] ${e.text}`).join('') || '\n     (none)';

/**
 * The one console assertion every heavy write test makes.
 *
 * An UNCAUGHT exception is a broken screen and is asserted everywhere. A plain
 * `console.error` is reported and asserted only on the read-only sweeps, because
 * a single noisy log on one of thirty-four line entries would otherwise mask the
 * data finding underneath it. Both are printed either way, so nothing is hidden.
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

/**
 * The panel the active tab renders into.
 *
 * ⚠ ATTRIBUTE SELECTOR, NOT `#id`. `KrayPage`'s first tab id is
 * `purchase orders` — with a space — so `#mt-panel-purchase orders` is not a
 * valid CSS id selector. Playwright would not throw; it would match nothing,
 * and every assertion after it would fail against an element that was on the
 * screen the whole time.
 */
const panel = (page: Page, tab: string) => page.locator(`[id="mt-panel-${tab}"]`);

/**
 * Open one Kray tab by clicking it, inline or out of the More popover.
 *
 * NOT by URL: `KrayPage` keeps the open tab in local state, so a
 * `goto('/kray?tab=budgets')` lands on whatever the account's starred default
 * is and every assertion afterwards is about the wrong screen.
 *
 * A tab that is neither on the strip nor in the menu is UNREACHABLE, which is a
 * product finding and not a selector problem, so it fails naming the tab.
 */
async function openTab(page: Page, id: string, label: string) {
  if (!/\/kray/.test(new URL(page.url()).pathname)) {
    await page.goto('/kray');
  }
  const strip = page.locator('.mt__wrap');
  await expect(strip, 'the Procurement tab strip never rendered').toBeVisible({ timeout: 60_000 });

  if (await panel(page, id).count() && await panel(page, id).isVisible().catch(() => false)) {
    await settle(page);
    return panel(page, id);
  }

  const inline = page.locator(`[id="mt-tab-${id}"]`);
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
    panel(page, id),
    `the Procurement "${id}" panel never rendered after its tab was clicked`,
  ).toBeVisible({ timeout: 60_000 });
  await settle(page);
  return panel(page, id);
}

/**
 * Press a control that writes, and WAIT FOR THE SERVER before going on.
 *
 * This is the fix for three of Suite 02's four failures on 2026-08-28: each
 * clicked Save and called `page.reload()` on the very next line, the reload tore
 * the page down with the request still in flight, the value read back empty, and
 * the suite reported "the product did not save it" about a product that had.
 *
 * Returns the parsed response so a caller asserts on the STATUS and on what the
 * server actually stored — never on the toast, which is the client's opinion.
 */
async function saveAndWait(
  page: Page,
  act: () => Promise<void>,
  urlRe: RegExp,
  what: string,
  methods: string[] = ['POST', 'PUT', 'PATCH'],
  expectStatus?: number,
) {
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => urlRe.test(r.url()) && methods.includes(r.request().method()),
      { timeout: 90_000 },
    ),
    act(),
  ]);
  const body = await res.text().catch(() => '');
  const where = `${res.request().method()} ${new URL(res.url()).pathname} → ${res.status()}`;
  if (expectStatus != null) {
    expect(res.status(), `${what}: ${where}\n     ${body.slice(0, 400)}`).toBe(expectStatus);
  } else {
    expect(res.status(), `${what}: ${where}\n     ${body.slice(0, 400)}`).toBeLessThan(400);
  }
  try { return JSON.parse(body); } catch { return {}; }
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
 * reports "no suppliers to order from" against an org holding sixteen — a false
 * product finding, which is worse than a flake. Polls, matches on the option
 * TEXT, then selects by the option's `value`, which is an id and is never
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

/** Set a checkbox to a state, by clicking only when it is not already there. */
async function setCheckbox(box: Locator, on: boolean) {
  await expect(box).toBeVisible();
  if ((await box.isChecked()) !== on) await box.click();
  expect(await box.isChecked(), 'the checkbox did not take the state it was set to').toBe(on);
}

/**
 * §6 — create only what is missing.
 *
 * Reads the live list first. A mark already present is VERIFIED and not typed
 * again, which is what makes a second execution recognise its own output rather
 * than double it. Returns how many it actually had to type, so a test can say
 * which half of §6 it exercised.
 */
async function ensure<T>(
  wanted: T[],
  present: (item: T) => boolean,
  create: (item: T) => Promise<void>,
): Promise<{ typed: number; found: number }> {
  let typed = 0;
  let found = 0;
  for (const item of wanted) {
    if (present(item)) { found++; continue; }
    await create(item);
    typed++;
  }
  return { typed, found };
}

/** The record drawer, which is a portal onto document.body and NOT in the panel. */
const drawer = (page: Page) => page.locator('.dr.gnd').last();

async function closeDrawer(page: Page) {
  const d = drawer(page);
  if (!(await d.count())) return;
  await page.keyboard.press('Escape');
  await expect(d, 'the purchase-order drawer did not close on Escape — a drawer that ' +
    'traps focus and will not dismiss is a live bug no row count would show')
    .toBeHidden({ timeout: 15_000 });
}

/** Open one order's drawer from the list, by the number or the word on its row. */
async function openOrder(page: Page, p: Locator, rowText: string) {
  const row = p.locator('button.gn-row', { hasText: rowText }).first();
  await expect(row, `no purchase-order row reading "${rowText}" on the register`)
    .toBeVisible({ timeout: 30_000 });
  await row.click();
  const d = drawer(page);
  await expect(d, `the record drawer did not open for "${rowText}"`).toBeVisible({ timeout: 30_000 });
  await expect(d.locator('.gnd__num'), 'the drawer opened with no title').toBeVisible();
  return d;
}

// ════════════════════════════════════════════════════════════════════════════
test.describe('Suite 06 — Kray (procurement) · Unicode Group', () => {
  /**
   * ⚠ DELIBERATELY NOT `mode: 'serial'`.
   *
   * These tests DO depend on each other's output — 06.05 submits what 06.04
   * raised — and serial mode is the obvious way to say so. It is the wrong one
   * here: serial mode SKIPS every remaining test the moment one fails, and
   * 06.07 is written to fail on a control the product does not have. Under
   * serial mode that one known failure would take the close, the budgets, the
   * volume sheet and the UUID sweep with it and report four §4 lines as
   * untested when they had simply never been reached — which is the silent cap
   * §10 warns about, produced by the test harness rather than by the suite.
   *
   * Playwright runs the tests of ONE FILE in declaration order in ONE worker
   * unless `fullyParallel` is set, and `real.config.ts` does not set it. So the
   * order is guaranteed and a failure stops nothing.
   */

  // ──────────────────────────────────────────────────────────────────────────
  // 06.01 · all ten Procurement tabs open, and each states its state in words
  // ──────────────────────────────────────────────────────────────────────────
  test('06.01 all ten Procurement tabs open, and each states its state in words', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    /* The module gate first. `routers/procurement.py` is gated
       `require_module("kray")` — the docstring says "ganit" and the code says
       "kray", and the CODE is what runs. An org without the subscription gets
       403 on every call and the screens render as errors, which reads exactly
       like a broken module. Proving the gate is open before anything else is
       what stops a whole suite of red being filed as a procurement defect. */
    // ⚠ `GET /v1/org/modules` answers `{ modules: [...] }`, not the `{ data: [] }`
    // envelope the rest of the product uses, so `apiRows` reads it as empty.
    const modBody = await apiEnvelope(page, '/api/v1/org/modules');
    const modules: any[] = modBody?.modules || modBody?.data || [];
    expect(modules.length, 'GET /v1/org/modules answered no modules at all').toBeGreaterThan(0);
    const kray = modules.find((m) => String(m.code || m.module_code) === 'kray');
    expect(kray, 'this organisation has no `kray` module row at all, so every ' +
      'procurement call answers 403 and nothing below can be driven. That is a ' +
      'PROVISIONING blocker, not a procurement defect: turn the module on from ' +
      `Settings → Modules.\n     saw: ${modules.map((m) => m.code).join(', ')}`).toBeTruthy();
    expect(kray.active, 'the `kray` module is subscribed but not active, so ' +
      '`require_module("kray")` refuses every procurement call with a 403 and every ' +
      'screen below renders as an error — which reads exactly like a broken module')
      .toBe(true);

    await page.goto('/kray');
    await expect(page.locator('.mt__wrap'), 'the Procurement page never rendered a tab strip')
      .toBeVisible({ timeout: 60_000 });

    const opened: string[] = [];
    const silentLoaders: string[] = [];
    for (const t of TABS) {
      con.at(t.id);
      const p = await openTab(page, t.id, t.label);

      /* ⚠ EVERY LOADING CHECK HERE IS A POLL, NOT A READING.
         The first version read `[aria-busy="true"]` once, straight after
         `settle()`, and reported the payables panel as a spinner that never
         resolves. It was not: `waitForLoadState('networkidle')` RETURNS
         IMMEDIATELY when the page is already idle, and it is — in the tick
         between the panel mounting and its `useEffect` firing the fetch. So the
         count was taken before the request had even left, and the endpoint
         answers in 0.3s. A false product finding, which is worse than a flake.

         ⚠ AND THE LOADING STATE CANNOT BE DETECTED THE SAME WAY ON EVERY TAB.
         `Skeleton.jsx` exports `SkeletonRegion`, whose entire job is the
         `role="status" aria-busy="true" aria-live="polite"` contract, and
         `PurchaseOrdersTab`, `PayablesTab` and `BudgetsTab` all use it. Three of
         the tabs Kray hosts return a BARE `<SkeletonList />` with no wrapper —
         `RateCardsTab` does `if (loading) return <SkeletonList />;` — so while
         they load there is no accessible status, nothing to announce, and no
         text on the panel at all. That is what made the first version report
         "rate-cards painted nothing": it had not painted nothing, it had not
         painted YET, and there was no aria contract to tell the difference.
         Reported below, and worked around here by polling for TEXT first. */
      /* Snapshotted the instant the panel mounts, BEFORE the polls below wait
         for it: a panel that at this moment has neither text nor a `role=status`
         is loading silently. Recorded, never asserted — the tabs that do it are
         Ganit's components hosted here, so the fix belongs to that surface and
         to Suite 20's cross-cutting sweep, not to a procurement suite. */
      const silentAtMount = (await p.innerText().catch(() => '')).trim().length === 0
        && (await p.locator('[role="status"]').count()) === 0;

      const t0 = Date.now();
      await expect
        .poll(async () => (await p.innerText().catch(() => '')).trim().length, {
          message: `the Procurement "${t.id}" panel never painted a word. A blank panel and ` +
            'a broken one look identical to a customer, which is exactly what §1\'s ' +
            'empty-state rule exists to catch — every screen must say what it holds, in ' +
            'words, including when it holds nothing',
          timeout: 45_000,
        })
        .toBeGreaterThan(0);
      await expect
        .poll(async () => await p.locator('[role="status"][aria-busy="true"]').count(), {
          message: `the Procurement "${t.id}" panel never stopped loading. ` +
            'SkeletonRegion holds role="status" aria-busy="true" until its list ' +
            'arrives, so a spinner still up here is one that never resolves — the ' +
            'failure a screenshot cannot tell from a slow one',
          timeout: 45_000,
        })
        .toBe(0);
      const ms = Date.now() - t0;
      if (silentAtMount) silentLoaders.push(t.id);

      const text = (await p.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

      /* And no error state where a list belongs. `ErrorState` renders
         `<div class="k-err" data-kind=… role="alert">` — the selector is taken
         from the component, not guessed, because a selector that matches
         nothing is an assertion that can never fail. "No purchase orders yet"
         after a FAILED fetch tells a firm it has ordered nothing, which is a
         different and much worse statement than "we could not load this". */
      /* ⚠ THE MESSAGE IS BUILT ONLY WHEN THERE IS SOMETHING TO SAY.
         The first version read `errs.first().innerText()` INTO the assertion
         message, and a Playwright expect message is built BEFORE the assertion
         runs — so on every clean panel it waited the full 20s `actionTimeout`
         for an element that was correctly absent. Ten tabs, 200 seconds, and
         the test looked like a slow product rather than a slow test. */
      const errs = p.locator('.k-err[role="alert"]');
      const nErrs = await errs.count();
      const errText = nErrs
        ? (await errs.first().innerText().catch(() => '')).replace(/\s+/g, ' ')
        : '';
      expect(nErrs, `the Procurement "${t.id}" panel rendered an error state, so whatever it ` +
        `shows below is not this firm's data: ${errText}`).toBe(0);

      opened.push(`${t.id}: settled in ${ms}ms — ${text.slice(0, 80)}`);
    }

    // ── the interaction vocabulary §1 asks for, on the strip itself ─────────
    // The tabs are a `role="tablist"` with a documented keyboard contract:
    // arrows walk the strip, and the active tab is the only tab stop. A control
    // reachable only by mouse is unreachable to somebody who does not use one.
    /* ⚠ ARROW MOVEMENT IS RELATIVE TO THE SELECTED TAB, NOT THE FOCUSED ONE.
       `ModuleTabs.onKeyDown` reads `head.findIndex(t => t.id === value)` — the
       tab that is CURRENTLY OPEN — so a test that focuses a tab it has not
       opened and presses ArrowRight watches the selection move from somewhere
       else entirely and wraps back onto the tab it started from. The first
       version of this check did exactly that and reported "the tablist keyboard
       contract is not honoured" about a contract that is. Open the tab first.
       And read the selection from the tab's ID, never its text: the default tab
       carries a ★ and the words "Opens here", so a text comparison is comparing
       against decoration. */
    await openTab(page, 'purchase orders', 'purchase orders');
    const first = page.locator('[id="mt-tab-purchase orders"]');
    await expect(first, 'the purchase-orders tab is not on the strip').toBeVisible();
    await first.focus();
    await expect(first, 'the purchase-orders tab could not take focus. The active tab is the ' +
      'strip\'s one tab stop, so if it cannot be focused the strip cannot be reached by ' +
      'keyboard at all').toBeFocused();
    await page.keyboard.press('ArrowRight');
    await settle(page);
    const movedTo = await page.locator('[role="tab"][aria-selected="true"]').first()
      .getAttribute('id');
    expect(movedTo, 'ArrowRight on the tab strip did not move the selection — the tablist ' +
      'keyboard contract is not honoured, and this product fixed keyboard access by hand ' +
      'once already (React Aria was rejected), so it regresses silently')
      .not.toBe('mt-tab-purchase orders');
    expect(String(movedTo || ''), 'ArrowRight moved the selection to something that is not a ' +
      'Procurement tab').toMatch(/^mt-tab-/);

    console.log(`\n  06.01 — ${TABS.length} Procurement screens opened and read:\n     ` +
      opened.join('\n     ') + '\n' +
      (silentLoaders.length
        ? `     ⚠ REPORTED, NOT ASSERTED — ${silentLoaders.length} tab(s) load SILENTLY: ` +
          `${silentLoaders.join(', ')}. At mount they paint no text and expose no ` +
          '`role="status"`, because they return a bare <SkeletonList /> rather than the ' +
          '<SkeletonRegion> wrapper whose whole job is the role=status aria-busy aria-live ' +
          'contract. A screen reader is told nothing while they load, and to anything ' +
          'automated "loading" and "empty" are the same screen. They are Ganit components ' +
          'hosted by Kray, so the fix is that surface\'s and Suite 20\'s, not this one\'s.\n'
        : '     every tab announced its loading state with role=status\n'));

    /* THE CONSOLE, ON THE ONE SWEEP WHERE IT CAN BE ASSERTED.
       §1: zero uncaught errors across the whole run, collected per screen — an
       exception that does not visibly break anything today is a defect that
       will. This is a read-only pass over ten screens with no form submissions
       to drown a log, so a plain `console.error` is asserted here as well as
       reported; the write tests below assert only the uncaught ones, because a
       single noisy log on one of thirty-four line entries would otherwise mask
       the data finding underneath it. */
    console.log(`  06.01 — console: ${con.errors.length} error(s)${dumpConsole(con)}\n`);
    expect(con.errors.map((e) => `[${e.where}] ${e.text}`),
      'a Procurement screen logged an error while merely being opened').toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 06.02 · the Kray-side vendor form, and the field set it must share
  // ──────────────────────────────────────────────────────────────────────────
  test('06.02 the Kray vendor form carries Ganit\'s exact field set, and writes every one of them', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    /**
     * ── THE COMPARISON §10 ACTUALLY ASKS FOR ────────────────────────────────
     *
     * Owner decision 0.20: vendors are reachable from two places and both are
     * correct — Kray owns the master list, Ganit · Payables lets a firm record
     * a supplier without abandoning the bill it is halfway through typing. What
     * was wrong is that the two had FORKED: Kray's form carried ten fields
     * including all six MSME/TDS columns; Payables carried four, so every
     * supplier created from the payables screen was born with `is_msme`,
     * `enterprise_class`, `vendor_kind`, `udyam_number`, `tds_section` and
     * `payment_terms_days` all NULL.
     *
     * `frontend/src/__tests__/vendorFormShared.test.jsx` is the static ratchet.
     * This is the live one: it reads the labels the DEPLOYED BUILD paints on
     * both surfaces and asserts they are the same set. A static test proves the
     * two tabs import the same module; only this proves the two SCREENS render
     * the same form.
     *
     * The label name is taken from the label's FIRST CHILD NODE, not its
     * innerText. The `Hi` component appends " · नाम" and a `<select>` inside a
     * label contributes its selected option's text, so innerText would compare
     * "MSME registered · एमएसएमई Not recorded" against itself and drift the
     * moment a default changed.
     */
    const labelsOf = async (form: Locator) =>
      (await form.locator('label.gn-form__field').evaluateAll(
        (els) => els.map((e) => (e.childNodes[0]?.textContent || '').trim()),
      )).filter(Boolean).sort();

    con.at('kray/vendors');
    const kp = await openTab(page, 'vendors', 'vendors');
    await kp.locator('.gn-bar').getByRole('button', { name: /^\+ Vendor$/ }).click();
    const kForm = kp.locator('form.gn-form').filter({ hasText: 'New vendor' }).first();
    await expect(kForm, 'the vendor form did not open on the Kray vendors screen — ' +
      'a missing control is a FAILURE, never a skip').toBeVisible();
    const krayLabels = await labelsOf(kForm);
    await kForm.getByRole('button', { name: /^Cancel$/ }).click();

    con.at('kray/payables');
    const pp = await openTab(page, 'payables', 'payables');
    await pp.locator('.gn-bar').getByRole('button', { name: /^\+ Vendor$/ }).click();
    const gForm = pp.locator('form.gn-form').filter({ hasText: 'New vendor' }).first();
    await expect(gForm, 'the vendor form did not open on the Payables screen').toBeVisible();
    const ganitLabels = await labelsOf(gForm);
    await gForm.getByRole('button', { name: /^Cancel$/ }).click();

    expect(krayLabels, 'the Kray vendor form and the Ganit · Payables vendor form paint ' +
      'DIFFERENT field sets on the deployed build. That is owner decision 0.20 come ' +
      'back: the last time these forked, every supplier recorded from the thinner ' +
      'screen was born with all six MSME/TDS columns NULL.\n' +
      `     Kray  : ${krayLabels.join(' | ')}\n` +
      `     Ganit : ${ganitLabels.join(' | ')}`).toEqual(ganitLabels);

    // And the set must actually CONTAIN the six. Two identical four-field forms
    // would satisfy the equality above and be exactly the defect 0.20 closed —
    // an assertion that cannot fail is the failure this programme exists to stop.
    const SIX_LABELS = ['MSME registered', 'Enterprise class', 'Vendor kind',
      'Udyam number', 'TDS section', 'Payment terms'];
    for (const l of SIX_LABELS) {
      expect(krayLabels, `the shared vendor form has no "${l}" box. Set equality alone ` +
        'would pass two identically-stripped forms, which is the 0.20 defect wearing ' +
        `a different hat.\n     saw: ${krayLabels.join(' | ')}`).toContain(l);
    }
    // The address block, which was API-writable and unenterable by a human
    // until 8.0 and is the same failure shape one field smaller.
    for (const l of ['Address line 1', 'City', 'State', 'Pincode', 'Country']) {
      expect(krayLabels, `the shared vendor form has no "${l}" box`).toContain(l);
    }

    // ── two suppliers, typed FROM KRAY ──────────────────────────────────────
    const before = new Set((await apiRows(page, '/api/v1/ganit/vendors'))
      .map((v) => String(v.name || '').trim()));

    const CLASS_LABEL: Record<string, string> = { micro: 'Micro', small: 'Small', medium: 'Medium' };

    async function createVendor(v: typeof VENDOR_PLAN[number]) {
      const p = await openTab(page, 'vendors', 'vendors');
      await p.locator('.gn-bar').getByRole('button', { name: /^\+ Vendor$/ }).click();
      const form = p.locator('form.gn-form').filter({ hasText: 'New vendor' }).first();
      await expect(form, 'the Kray vendor form did not open').toBeVisible();
      const field = (label: string) =>
        form.locator('label.gn-form__field', { hasText: label }).first();

      await typeInto(field('Name').locator('input.inp'), vendorName(v.n));
      if (v.gstinState) {
        await typeInto(field('GSTIN').locator('input.inp'), gstin(v.gstinState, v.pan));
      }
      await typeInto(field('Email').locator('input.inp'), `s06.vendor${pad(v.n)}@example.com`);
      // Ofcom's reserved drama range: unassignable by definition, so it cannot
      // reach a person however this row is later used. §3's decision.
      await typeInto(field('Phone').locator('input.inp'), `+4477009003${pad(v.n)}`);

      await typeInto(field('Address line 1').locator('input.inp'), `${v.n} Kray Industrial Estate`);
      await typeInto(field('Address line 2').locator('input.inp'), `Unit ${v.n}`);
      await typeInto(field('City').locator('input.inp'), v.city);
      await typeInto(field('State').locator('input.inp'), v.state);
      await typeInto(field('Pincode').locator('input.inp'), v.pincode);
      await typeInto(field('Country').locator('input.inp'), 'India');

      await field('MSME registered').locator('select.inp').selectOption(v.isMsme);
      await field('Enterprise class').locator('select.inp').selectOption(v.cls);
      await field('Vendor kind').locator('select.inp').selectOption(v.kind);
      await typeInto(field('Udyam number').locator('input.inp'), v.udyam);
      await typeInto(field('TDS section').locator('input.inp'), v.tds);
      await typeInto(field('Payment terms').locator('input.inp'), v.terms);

      await saveAndWait(page, async () => {
        await form.getByRole('button', { name: /^Save vendor$/ }).click();
      }, /\/v1\/ganit\/vendors$/, `creating ${vendorName(v.n)} from the Kray screen`);
      await settle(page);
    }

    const made = await ensure(VENDOR_PLAN, (v) => before.has(vendorName(v.n)), createVendor);

    // ── the canonical rows, not the list card ───────────────────────────────
    const rows = await apiRows(page, '/api/v1/ganit/vendors');
    const mine = rows.filter((r) => String(r.name || '').startsWith(`${TAG} Vendor `));
    expect(mine.length, `wanted ${N_VENDORS_TYPED} suppliers typed from the Kray screen, the ` +
      `master list holds ${mine.length}${dumpWire(wire)}`).toBe(N_VENDORS_TYPED);

    const SIX = ['is_msme', 'enterprise_class', 'vendor_kind', 'udyam_number',
      'tds_section', 'payment_terms_days'];
    for (const v of mine) {
      for (const col of SIX) {
        expect(v[col], `${v.name} was created from the KRAY screen and its ${col} is ` +
          '"nobody has said" — that is the forked-form defect owner decision 0.20 ' +
          'closed, come back on the other surface').not.toBeNull();
        expect(v[col], `${v.name}.${col} is missing entirely from the read-back`).toBeDefined();
      }
      expect([true, false], `${v.name}.is_msme must be a real yes or no, not ${v.is_msme}`)
        .toContain(v.is_msme);
      const addr = typeof v.address === 'string' ? JSON.parse(v.address) : (v.address || {});
      for (const k of ['line1', 'line2', 'city', 'state', 'pincode', 'country']) {
        expect(String(addr[k] || '').trim(), `${v.name} has no ${k}. The address block was ` +
          'API-writable and unenterable by a human until 8.0; this is the check that ' +
          'it is not again, on the Kray surface').not.toBe('');
      }
    }

    // GSTIN blocks nothing — proved on THIS surface, with a row.
    const noGstin = mine.filter((v) => !String(v.gstin || '').trim());
    expect(noGstin.length, 'a supplier could not be recorded from Kray without a GSTIN. ' +
      'GSTIN, PAN and TAN are non-mandatory by owner rule and must block nothing — ' +
      'this has drifted back more than once').toBe(1);

    // The one out-of-state supplier, which is what unlocks IGST in 06.04.
    const mh = mine.find((v) => String(v.gstin || '').startsWith(MAHARASHTRA));
    expect(mh, `no supplier carries a ${MAHARASHTRA} (Maharashtra) GSTIN, so ` +
      '`derive_is_igst` can never answer inter-state and the IGST half of the split ' +
      'is untestable from this register').toBeTruthy();

    // ── the EDIT path, from Kray, with no new row ───────────────────────────
    const p2 = await openTab(page, 'vendors', 'vendors');
    const editRow = p2.locator('tr', { hasText: vendorName(2) }).first();
    await expect(editRow, `${vendorName(2)} is not on the Kray master list`).toBeVisible();
    await editRow.getByRole('button', { name: /^Edit$/ }).click();
    const editForm = p2.locator('form.gn-form').filter({ hasText: 'Edit vendor' }).first();
    await expect(editForm, 'the Kray master list offers no way to correct a supplier — ' +
      'a missing control is a FAILURE, never a skip').toBeVisible();
    // ⚠ THE NEW VALUE IS DERIVED FROM THE OLD ONE, NOT FROM THE RUN STAMP.
    //
    // It was `30 + (RUN.slice(-1) % 3) * 15`, which lands on 30, 45 or 60
    // depending on the last digit of the clock. `VENDOR_PLAN[1].terms` is '30'
    // — so one run in three "edited" the field to the value it already held.
    //
    // Two things went wrong with that, and the second is the worse one:
    //
    //   · the read-back `expect(payment_terms_days).toBe(newTerms)` then
    //     PASSED WITHOUT THE EDIT DOING ANYTHING. A test that agrees with the
    //     database about a number neither of them changed proves nothing, and
    //     it is green — this suite's own recurring fault class.
    //   · and `saveAndWait` hung its full 90s in wave 4 waiting for a PATCH
    //     that a no-op submit need never send, which is how it surfaced at all.
    //
    // Read live and step off it, so the write is always a real change.
    const beforeTerms = String((await apiRows(page, '/api/v1/ganit/vendors'))
      .find((v) => String(v.name) === vendorName(2))?.payment_terms_days ?? '');
    const newTerms = ['30', '45', '60'].find((t) => t !== beforeTerms) as string;
    expect(newTerms, 'no payment-terms value differs from the one already stored, so this ' +
      'edit would be a no-op and the read-back would agree with itself').toBeTruthy();
    await typeInto(
      editForm.locator('label.gn-form__field', { hasText: 'Payment terms' }).first().locator('input.inp'),
      newTerms,
    );
    await saveAndWait(page, async () => {
      await editForm.getByRole('button', { name: /^Update vendor$/ }).click();
    }, /\/v1\/ganit\/vendors\//, `editing ${vendorName(2)} from Kray`, ['PATCH']);
    await settle(page);

    const after = (await apiRows(page, '/api/v1/ganit/vendors'))
      .find((v) => String(v.name) === vendorName(2));
    expect(String(after?.payment_terms_days), 'the Kray edit did not reach the row. The ' +
      `PATCH answered 2xx, so this is the read-back disagreeing with the write — ` +
      `which is the only way to tell a saved edit from a discarded one. It held ` +
      `${beforeTerms} before this edit and was set to ${newTerms}.`)
      .toBe(newTerms);
    // ⚠ And the address must have SURVIVED an edit that never touched it.
    // `vendorPayload` omits the whole `address` key unless a box was typed in,
    // which is the non-destruction guarantee; asserting it here is what would
    // catch that guarantee being replaced by a merge.
    const afterAddr = typeof after?.address === 'string'
      ? JSON.parse(after.address) : (after?.address || {});
    expect(String(afterAddr.city || ''), 'editing the payment terms wiped the supplier\'s ' +
      'address. `vendorPayload` omits the `address` key when no box was touched, and ' +
      'that omission is the whole of the non-destruction guarantee').toBe(VENDOR_PLAN[1].city);

    console.log(`\n  06.02 — vendors: ${made.typed} typed, ${made.found} already present; ` +
      `${krayLabels.length} fields on both forms and the sets are identical; ` +
      `1 supplier with no GSTIN; 1 Maharashtra supplier for the IGST branch; ` +
      `payment terms edited to ${newTerms} days from the Kray list\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 06.03 · purchase-order settings, typed
  // ──────────────────────────────────────────────────────────────────────────
  test('06.03 the approval rule, the numbering prefix, the over-receipt policy and four department budgets are typed', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    /**
     * Everything here is an ORGANISATION decision, so the route is
     * `ORG_SETTINGS_ROLES` = org_admin / org_owner (`routers/procurement.py:257`)
     * and the panel only reveals a 403 once the SERVER has refused — the controls
     * are not hidden on a guess about the caller's role. This lane's account is
     * org_admin on Unicode Group, which is why the save is expected to land.
     *
     * ⚠ `self_approval` IS DELIBERATELY NOT TOUCHED HERE. It starts false (the
     * built-in default) and 06.05 owns the flip, because the refusal it produces
     * — "You raised this purchase order, and this organisation does not allow
     * self-approval" — is a sentence the drawer must say, and it can only be
     * read while the setting is still off.
     */
    /* What self-approval was BEFORE this test touched anything. On the run that
       creates the orders it is the built-in default, false; on every run after
       it, 06.05 has already switched it on. Either is correct — what must be
       true is that saving the numbering, the rule and the budgets does not
       move it, because a settings form that clobbers a neighbouring flag is a
       real defect and an unconditional `toBe(false)` here would have hidden it
       behind a re-run failure instead. */
    const wasSelfApproval = Boolean(
      ((await apiEnvelope(page, '/api/v1/procurement/settings'))?.data || {}).self_approval);

    con.at('settings');
    const p = await openTab(page, 'settings', 'settings');
    const form = p.locator('form.gn-form--accent').first();
    await expect(form, 'the purchase-order settings panel did not render on its own tab')
      .toBeVisible({ timeout: 60_000 });

    // Numbering. Two to eight letters, no digits, no hyphens — the series is
    // read back as PREFIX-YYYY-NNNN and a prefix carrying a hyphen makes it
    // unreadable by its own reader.
    await typeInto(
      form.locator('label.fld', { hasText: 'Prefix' }).first().locator('input.inp'),
      PO_PREFIX,
    );

    // Approval on, and one rule. `match_rule` reads rules IN ORDER and the
    // FIRST match decides; a blank department matches every department, which
    // is what makes "over two lakh, anywhere" writable as one rule.
    await setCheckbox(form.locator('label.gn-chk', { hasText: 'Require approval on purchase orders' })
      .locator('input[type="checkbox"]'), true);

    const ruleCard = form.locator('.gn-panel').filter({ hasText: /^Rule 1/ });
    if (!(await ruleCard.count())) {
      await form.getByRole('button', { name: /^\+ Add rule$/ }).click();
    }
    const rule = form.locator('.gn-panel').filter({ hasText: /Rule 1/ }).first();
    await expect(rule, 'the approval editor offers no rule card even after "+ Add rule"')
      .toBeVisible();
    const rf = (label: string) => rule.locator('label.fld', { hasText: label }).first();
    await typeInto(rf('Name it').locator('input.inp'), `Anything at or over ₹${THRESHOLD / 100000} lakh`);
    await typeInto(rf('Order value at least').locator('input.inp'), String(THRESHOLD));
    await typeInto(rf('Department').locator('input.inp'), '');
    await typeInto(rf('Category').locator('input.inp'), '');

    /* WHO approves, by NAME. The id is the key the rule is written with and is
       never drawn — `check-rendered-ids.mjs` is the ratchet and the owner's
       rule behind it is that a person is identified by their name, everywhere.
       So the approver is chosen by ticking a box labelled with a name, and this
       test never learns, prints or asserts an id. */
    const approvers = rule.locator('.gn-chk__list label.gn-chk');
    const nApprovers = await approvers.count();
    expect(nApprovers, 'the approval rule offers nobody to approve. `/approver-candidates` ' +
      'answers every member of this organisation by name, so an empty list means the ' +
      'call failed or the org has no members — either way the rule could never be ' +
      'satisfied and every order matching it would freeze at awaiting_approval')
      .toBeGreaterThan(0);

    /* The account driving this suite must be the approver, because it is the
       only account this lane holds — so the ONE name to tick has to be resolved.
       ⚠ It cannot be read off `/api/auth/me`: that route answers `users.name`
       while `/procurement/approver-candidates` answers
       `COALESCE(full_name, name)`, and for this very account those are two
       DIFFERENT strings — the shell's account menu says one thing and the
       approver list says another about the same person. Reported, not fixed
       here. So the id is used as a KEY to look the name up, exactly as
       `POSettingsPanel.nameOf()` does, and the name is what drives the click.
       No id is ever printed, rendered or asserted. */
    const me = await apiEnvelope(page, '/api/auth/me');
    const myId = String(me?.user_id || me?.id || '').trim();
    expect(myId, 'the signed-in session resolves to no account at all').not.toBe('');
    const candidates = await apiRows(page, '/api/v1/procurement/approver-candidates');
    expect(candidates.length, '`/approver-candidates` names nobody, so no rule could ever ' +
      'be satisfied and every order matching one would freeze at awaiting_approval')
      .toBeGreaterThan(0);
    const myName = String(candidates.find((c) => String(c.user_id) === myId)?.full_name || '').trim();
    expect(myName, 'the signed-in account is not among the people this organisation could ' +
      'name as an approver, so this lane cannot approve anything and §4\'s six approvals ' +
      'are unreachable').not.toBe('');

    /* ⚠ A PERSON WITH TWO SEATS IS OFFERED TWICE. `/approver-candidates` selects
       from `staging.user_roles` with no DISTINCT, so an account holding both
       `org_admin` and `org_owner` in this org comes back on two rows — and
       `POSettingsPanel` maps them with `key={p.user_id}`, which is a duplicate
       React key and two checkboxes for one human. Measured on this org
       2026-08-29: 9 rows for 8 people. It is not this suite's finding to fix,
       but the tick below must survive it, so the approver is matched by name and
       every OTHER box is cleared by state rather than by count. */
    const mine = rule.locator('.gn-chk__list label.gn-chk', { hasText: myName }).first();
    await expect(mine, `"${myName}" is not offered as an approver, so this lane cannot ` +
      'approve anything and §4\'s six approvals are unreachable').toBeVisible();
    await setCheckbox(mine.locator('input[type="checkbox"]'), true);

    // Untick everyone else, so the rule names exactly one approver and
    // `approvers_required: 1` is satisfiable by this lane alone.
    for (let i = 0; i < nApprovers; i++) {
      const box = approvers.nth(i);
      const text = (await box.innerText()).trim();
      if (text.includes(myName)) continue;
      await setCheckbox(box.locator('input[type="checkbox"]'), false);
    }
    await typeInto(rule.locator('label.fld', { hasText: 'How many must approve' })
      .first().locator('input.inp'), '1');

    // Receiving: refuse a delivery larger than the order. That is the built-in
    // default and it is set explicitly, because 06.06 proves the refusal and a
    // test that depends on an unstated default is a test that breaks silently.
    await form.locator('label.fld', { hasText: 'Delivery of more than was ordered' })
      .first().locator('select.inp').selectOption('refuse');

    // Budgets on, and the four departments.
    await setCheckbox(
      form.locator('label.gn-chk', { hasText: 'Track committed spend against a departmental budget' })
        .locator('input[type="checkbox"]'), true);

    /* The budget rows and the rule card wear the SAME classes
       (`gn-form__grid gn-form__grid--2 gn-form__grid--flush`). They are told
       apart by "Warn at", which only a budget row carries — the rule card has
       "How many must approve" in the same slot. Scoping on the class alone
       would have typed a department into the approval rule. */
    const budgetRows = () => form.locator('div.gn-form__grid--flush')
      .filter({ hasText: 'Warn at' });

    for (let i = 0; i < BUDGETS.length; i++) {
      if ((await budgetRows().count()) <= i) {
        await form.getByRole('button', { name: /^\+ Add budget$/ }).click();
      }
      const row = budgetRows().nth(i);
      await expect(row, `budget row ${i + 1} did not appear after "+ Add budget"`).toBeVisible();
      const bf = (label: string | RegExp) => row.locator('label.fld', { hasText: label }).first();
      await typeInto(bf('Department').locator('input.inp'), BUDGETS[i].department);
      await typeInto(bf('Limit (₹)').locator('input.inp'), String(BUDGETS[i].limit));
      await typeInto(bf('Warn at (%)').locator('input.inp'), String(BUDGETS[i].alertPct));
      // The period is captured through the product's own DateInput — never a
      // native `<input type="date">`, which this product does not use anywhere.
      await setDate(row, /^From/, '2026-04-01');
      await setDate(row, /^To/, '2027-03-31');
    }
    // Exactly four, not four-or-more: a second execution that appended rather
    // than recognising its own would show five and must fail here, not later.
    expect(await budgetRows().count(), 'the budget editor holds a different number of rows ' +
      'than §4 asks for. More than four on a second execution means this test appended ' +
      'instead of overwriting, which is a §6 idempotence failure in the suite itself')
      .toBe(BUDGETS.length);

    const saved = await saveAndWait(page, async () => {
      await form.getByRole('button', { name: /^Save settings$/ }).click();
    }, /\/v1\/procurement\/settings$/, 'saving the purchase-order settings', ['PUT']);

    // ── the canonical settings, not the form's own state ────────────────────
    const live = (await apiEnvelope(page, '/api/v1/procurement/settings'))?.data || {};
    expect(live.prefix, 'the numbering prefix did not stick').toBe(PO_PREFIX);
    expect(live.approval_required, 'approval is still off after being switched on').toBe(true);
    expect(live.over_receipt, 'the over-receipt policy did not save').toBe('refuse');
    expect(live.budgets_enabled, 'budgets are still off after being switched on').toBe(true);
    expect((live.rules || []).length, 'the approval rule did not save. `put_settings` refuses a ' +
      'rule naming nobody with a 400 rather than sanitising it silently, so a 2xx with no ' +
      `rule stored is a different fault${dumpWire(wire)}`).toBe(1);
    expect(Number(live.rules[0].min_amount), 'the approval threshold did not save').toBe(THRESHOLD);
    expect(Number(live.rules[0].approvers_required), 'the rule wants a different number of ' +
      'approvers than was typed').toBe(1);
    expect((live.rules[0].approver_ids || []).length, 'the rule names a different number of ' +
      'approvers than was ticked').toBe(1);

    const byDept = new Map((live.budgets || []).map((b: any) => [String(b.department), b]));
    expect([...byDept.keys()].sort(), `the four department budgets did not save${dumpWire(wire)}`)
      .toEqual(BUDGETS.map((b) => b.department).sort());
    for (const b of BUDGETS) {
      expect(Number((byDept.get(b.department) as any).limit),
        `the ${b.department} limit did not save`).toBe(b.limit);
      expect(Number((byDept.get(b.department) as any).alert_pct),
        `the ${b.department} warn-at did not save`).toBe(b.alertPct);
      // ⚠ REPORTED, NOT ASSERTED: `period_start` and `period_end` are captured
      // here and `budget_state()` never reads them — committed spend is summed
      // over every OPEN order regardless of date, so a budget for FY 2026-27
      // counts an order raised in 2025. Two columns the form writes and nothing
      // consults. Recorded for the owner; this suite does not rule on it.
    }
    expect(Boolean(live.self_approval), 'saving the numbering, the approval rule and the ' +
      'budgets MOVED the self-approval flag. Every key of this blob travels in one PUT, so ' +
      'a form that sends a stale value for a control it does not own silently reverses ' +
      'somebody else\'s decision — and this particular one decides whether the person who ' +
      'raised an order may sign it off').toBe(wasSelfApproval);

    console.log(`\n  06.03 — settings saved: prefix ${live.prefix}, approval on at ` +
      `₹${THRESHOLD.toLocaleString('en-IN')} with 1 approver, over-receipt ${live.over_receipt}, ` +
      `${(live.close_reasons || []).length} close reasons, budgets on with ` +
      `${(live.budgets || []).length} departments, self-approval ${live.self_approval}\n`);
    expect(saved, 'the settings PUT answered nothing at all').toBeTruthy();
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 06.04 · twelve purchase orders, thirty-four lines
  // ──────────────────────────────────────────────────────────────────────────
  test('06.04 twelve purchase orders are raised with thirty-four lines, and the tax split follows the supplier\'s state', async ({ page }) => {
    test.setTimeout(60 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    /* This firm's own state, READ LIVE. A suite that hardcodes it cannot notice
       when the organisation's registration changes underneath it, and the whole
       GST assertion below is derived from this one value.

       Two sources, in order of authority: the `state_code` column, which is
       what `derive_is_igst` actually compares against — and which the deployed
       build does not yet return (see GST_STATE_CODE above) — then the state
       NAME on the billing address, mapped through the statutory table. */
    const profile = await apiEnvelope(page, '/api/v1/org/profile');
    const stateName = String(profile?.billing_address?.state || '').trim();
    const homeState = String(profile?.state_code || '').trim()
      || GST_STATE_CODE[stateName] || '';
    expect(homeState, 'this organisation\'s GST state cannot be established from anything the ' +
      'product will tell a user. `GET /v1/org/profile` returns no `state_code` on the ' +
      `deployed build and its billing address reads "${stateName}", which is not a GST ` +
      'state. `client_billing._tax_split` REFUSES outright when the column is empty, so ' +
      'this is not cosmetic — it is the difference between an invoice that can be taxed ' +
      'and one that cannot.').toBe(GUJARAT);

    const existing = await myOrders(page);
    con.at('purchase orders');

    async function createOrder(plan: PoPlan) {
      const p = await openTab(page, 'purchase orders', 'purchase orders');
      const form = p.locator('form.gn-form').filter({ hasText: 'New purchase order' }).first();
      /* The button TOGGLES (`setShowForm(v => !v)`), so clicking it when the
         form is already up closes it. Open only when it is not. */
      if (!(await form.count())) {
        await p.locator('.gn-bar').getByRole('button', { name: /^\+ Purchase order$/ }).click();
      }
      await expect(form, 'the purchase-order form did not open').toBeVisible();

      const f = (label: string | RegExp) => form.locator('label.fld', { hasText: label }).first();
      await pickByLabel(f(/^Supplier/).locator('select.inp'), plan.vendor, 'supplier');
      await setDate(form, /^Order date/, poDate(plan.n));
      await setDate(form, /^Expected by/, expectedDate(plan.n));
      await typeInto(f('Department').locator('input.inp'), plan.dept);
      await typeInto(f('Category').locator('input.inp'), plan.cat);
      // The checkbox is only touched for the supplier with no GSTIN, where it
      // is the whole answer. On the other eleven the SERVER derives the split
      // from the supplier's registration and this box is deliberately left as
      // it is, so what the assertion proves is the derivation.
      if (!String(plan.vendor).includes(`${TAG} Vendor 02`)) {
        // left alone on purpose
      } else {
        await setCheckbox(form.locator('label.gn-chk', { hasText: 'Inter-state (IGST)' })
          .locator('input[type="checkbox"]'), plan.igst);
      }

      // ── the lines ────────────────────────────────────────────────────────
      const lineRows = () => form.locator('.gn-li');
      for (let j = 1; j <= plan.lines; j++) {
        if ((await lineRows().count()) < j) {
          await form.getByRole('button', { name: /^\+ Add line$/ }).click();
        }
        const li = lineRows().nth(j - 1);
        await expect(li, `line ${j} did not appear after "+ Add line"`).toBeVisible();

        /* Line 1 of every order names a CATALOGUE product, and the other lines
           are free text — which is the ordinary case in procurement and the
           reason `product_id` is nullable. `pickProduct` fills the rate, the GST
           and the HSN from the catalogue and keeps a description already typed,
           so the product is chosen FIRST and this line's own figures are typed
           after; the other order silently loses them. */
        if (j === 1) {
          const productSel = li.locator('select.inp');
          const chosen = await pickByLabel(productSel, `S05 Product ${pad(plan.n)}`, 'catalogue product');
          expect(chosen, 'the catalogue picker chose nothing').not.toBe('');
          // The fill actually happened: the rate box now carries the catalogue's
          // cost price rather than the zero it mounted with. An interaction that
          // is asserted only by "it did not throw" is an interaction nobody has
          // checked.
          await expect
            .poll(async () => Number(await li.locator('input.inp').nth(2).inputValue()), {
              message: 'choosing a catalogue product did not fill the line rate — ' +
                '`pickProduct` reads `cost_price ?? price` and one of them must land',
              timeout: 10_000,
            })
            .toBeGreaterThan(0);
        }

        const inputs = li.locator('input.inp');
        await typeInto(inputs.nth(0), lineDesc(plan.n, j));   // Description
        await typeInto(inputs.nth(1), String(j + 1));          // Qty
        await typeInto(inputs.nth(2), String(plan.rate));      // Rate
        await typeInto(inputs.nth(3), String(plan.gst));       // GST %
        await typeInto(inputs.nth(4), `8471${pad(plan.n)}${j}0`); // HSN/SAC
      }
      expect(await lineRows().count(), `order ${plan.n} wanted ${plan.lines} lines`)
        .toBe(plan.lines);

      // The form's own preview must agree with the server before Save. A form
      // that shows a total the server then disagrees with is worse than a form
      // that shows nothing, so `previewTotals` mirrors `compute_po_totals` — and
      // this is the check that the mirror is still true.
      const want = poTotals(plan);
      const shown = (await form.locator('.gn-tot__r--sum .gn-tot__v').innerText())
        .replace(/[^\d.]/g, '');
      expect(Number(shown), `the form previews ${shown} for order ${plan.n} and the ` +
        `arithmetic in services/purchase_orders.compute_po_totals gives ${want.total}`)
        .toBeCloseTo(want.total, 2);

      await typeInto(form.locator('label.fld', { hasText: 'Terms' }).first().locator('textarea.inp'),
        `Payment ${plan.n % 2 ? 30 : 45} days from acceptance. Delivery to the ${plan.dept} store.`);
      await typeInto(form.locator('label.fld', { hasText: 'Notes' }).first().locator('textarea.inp'),
        poMark(plan.n));

      const res = await saveAndWait(page, async () => {
        await form.getByRole('button', { name: /^Save draft$/ }).click();
      }, /\/v1\/procurement\/purchase-orders$/, `raising ${poMark(plan.n)}`);

      // ── READ THE WRITE RESPONSE, not the list ────────────────────────────
      // The register is ordered by `created_at DESC` and capped at 200, and a
      // draft carries no number to find it by. The response says what happened.
      expect(res?.data?.id, `raising ${poMark(plan.n)} answered 2xx with no order in the ` +
        `body${dumpWire(wire)}`).toBeTruthy();
      expect(String(res.data.status), `${poMark(plan.n)} was not born a draft. A serial spent ` +
        'on a draft is a gap in the series and a gap is what an auditor asks about')
        .toBe('draft');
      expect(res.data.po_number, `${poMark(plan.n)} was minted a number while still a draft`)
        .toBeFalsy();

      /* ⚠ WAIT FOR THE DRAWER, DO NOT RACE IT.
         `savePO` closes the form, then `await load()`, then
         `await loadCommitted()`, and only THEN opens the drawer on the record it
         just made. The POST response therefore lands two round trips before the
         drawer does — so closing on the next line found nothing to close,
         returned, and the drawer mounted afterwards. Its `.dr__scrim` then
         swallowed every click on the NEXT order's form, and the run died on a
         DateInput that was on screen the whole time. Asserting the drawer opens
         is also the truer check: it is the product's own answer to "what did I
         just make?", and a create that shows you nothing is a create nobody can
         confirm. */
      const d = drawer(page);
      await expect(d, `saving ${poMark(plan.n)} did not open its record. The write answered ` +
        '2xx, so this is the screen not following the server').toBeVisible({ timeout: 60_000 });
      await expect(d.locator('.gnd__num'), 'the new draft\'s drawer does not say it is ' +
        'unnumbered — a draft carries no serial and the screen has to say so rather than ' +
        'showing an empty title').toHaveText(/Not yet numbered/i, { timeout: 30_000 });
      await closeDrawer(page);
      await settle(page);
    }

    const made = await ensure(PO_PLAN, (p) => existing.has(poMark(p.n)), createOrder);

    // ── the canonical records ───────────────────────────────────────────────
    const orders = await myOrders(page);
    expect(orders.size, `wanted ${N_POS} purchase orders, the register holds ${orders.size}` +
      `${dumpWire(wire)}`).toBe(N_POS);

    let lines = 0;
    const igstOrders: string[] = [];
    for (const plan of PO_PLAN) {
      const env = orders.get(poMark(plan.n));
      expect(env, `${poMark(plan.n)} is not on the register`).toBeTruthy();
      const o = env.data;
      /* AFTER any revision this order has been through, decided by the LIVE
         counter and never assumed: 06.07 changes a quantity on one of the
         twelve, and a figure that was right at raise is not right afterwards. */
      const wasRevised = Number(o.revision) > 0;
      const want = poTotals(plan, wasRevised);

      expect(env.lines.length, `${poMark(plan.n)} carries ${env.lines.length} active lines, ` +
        `not the ${plan.lines} that were typed`).toBe(plan.lines);
      lines += env.lines.length;

      for (let j = 1; j <= plan.lines; j++) {
        const l = env.lines.find((x: any) => Number(x.line_no) === j);
        expect(l, `${poMark(plan.n)} has no line ${j}`).toBeTruthy();
        expect(String(l.description), `line ${j} of ${poMark(plan.n)} lost its description`)
          .toBe(lineDesc(plan.n, j));
        expect(Number(l.qty_ordered), `line ${j} of ${poMark(plan.n)} ordered the wrong quantity`)
          .toBe((wasRevised ? revisedQty(plan.n, j) : null) ?? (j + 1));
        expect(Number(l.rate), `line ${j} of ${poMark(plan.n)} took the wrong rate`).toBe(plan.rate);
      }
      // Line 1 carries a catalogue id; the rest deliberately do not. ONE
      // CATALOGUE — `_validate_products` refuses a product that is not this
      // org's own, and a line with no product is entirely legal.
      const withProduct = env.lines.filter((l: any) => l.product_id).length;
      expect(withProduct, `${poMark(plan.n)} should carry exactly one catalogue-backed line`)
        .toBe(1);

      // ── THE STATUTORY ASSERTION ────────────────────────────────────────
      // Derived from the pair, never named: `derive_is_igst` compares the first
      // two characters of the supplier's GSTIN against this org's state code.
      expect(Boolean(o.is_igst), `${poMark(plan.n)} is against ${plan.vendor} and the split is ` +
        `${o.is_igst ? 'IGST' : 'CGST+SGST'}. This org is state ${homeState}; s.7 and s.8 ` +
        'of the IGST Act put a supply within the same state on CGST+SGST and any other ' +
        'on IGST').toBe(plan.igst);
      if (plan.igst) igstOrders.push(poMark(plan.n));

      expect(Number(o.subtotal), `${poMark(plan.n)} subtotal`).toBeCloseTo(want.subtotal, 2);
      expect(Number(o.cgst), `${poMark(plan.n)} CGST`).toBeCloseTo(want.cgst, 2);
      expect(Number(o.sgst), `${poMark(plan.n)} SGST`).toBeCloseTo(want.sgst, 2);
      expect(Number(o.igst), `${poMark(plan.n)} IGST`).toBeCloseTo(want.igst, 2);
      expect(Number(o.total), `${poMark(plan.n)} total`).toBeCloseTo(want.total, 2);
      // CGST and SGST are equal halves, always. A split that drifted by a paisa
      // is a filing error, not a rounding one.
      if (!plan.igst) {
        expect(Number(o.cgst), `${poMark(plan.n)} splits CGST and SGST unequally`)
          .toBeCloseTo(Number(o.sgst), 2);
      }

      expect(String(o.department), `${poMark(plan.n)} lost its department, and a budget keyed ` +
        'on one cannot match what is not there').toBe(plan.dept);
      // A revised order carries the category the REVISION left, not the one it
      // was raised with. See `revisedCategory` — 06.07 does that on purpose.
      const wantCat = revisedCategory(plan.n) ?? plan.cat;
      expect(String(o.category),
        `${poMark(plan.n)} lost its category — expected ${wantCat}` +
        (revisedCategory(plan.n) ? ' (set by revision r3, not the original)' : ''))
        .toBe(wantCat);
    }

    expect(lines, `wanted ${N_LINES} purchase-order lines across the twelve, counted ${lines}`)
      .toBe(N_LINES);
    expect(igstOrders.length, 'no order came out inter-state, so the IGST branch of ' +
      '`derive_is_igst` was never reached and half the split is unproven').toBe(1);

    const above = PO_PLAN.filter(aboveThreshold).length;
    console.log(`\n  06.04 — purchase orders: ${made.typed} typed, ${made.found} already present; ` +
      `${orders.size} on the register, ${lines} lines; ${above} at or above the ` +
      `₹${THRESHOLD.toLocaleString('en-IN')} threshold and ${N_POS - above} below; ` +
      `${igstOrders.length} inter-state (${igstOrders.join(', ')})\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 06.05 · the threshold, the self-approval refusal, and six approvals
  // ──────────────────────────────────────────────────────────────────────────
  test('06.05 six orders issue without asking anyone and six go for approval, which is refused before it is allowed', async ({ page }) => {
    test.setTimeout(45 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const orders = await myOrders(page);
    expect(orders.size, '06.04 has not left twelve orders to submit').toBe(N_POS);

    const settingsBefore = (await apiEnvelope(page, '/api/v1/procurement/settings'))?.data || {};
    expect(settingsBefore.approval_required, '06.03 did not leave approval switched on')
      .toBe(true);

    /* ── SUBMIT ─────────────────────────────────────────────────────────────
       `submit` is the only door: if a rule matches, the order goes to
       `awaiting_approval` and the rule is SNAPSHOTTED onto it; if no rule
       matches the order is ISSUED IMMEDIATELY — the approval step is skipped
       entirely rather than auto-approved, because an approval record naming
       nobody is a lie about who agreed to the spend. Both halves are asserted. */
    let issuedDirectly = 0;
    let sentForApproval = 0;
    let refusalSeen = '';

    for (const plan of PO_PLAN) {
      const env = orders.get(poMark(plan.n))!;
      if (!['draft', 'rejected'].includes(String(env.data.status))) continue;

      const p = await openTab(page, 'purchase orders', 'purchase orders');
      // A draft has no number, so its row is found by the supplier plus the
      // word the product itself paints for an unnumbered order.
      const d = await openOrder(page, p, plan.vendor);
      await expect(d.locator('.gnd__num'), 'the drawer of an unissued order must say so in ' +
        'words rather than showing an empty title').toHaveText(/Not yet numbered|Draft/i);

      const res = await saveAndWait(page, async () => {
        await d.getByRole('button', { name: /^Submit$/ }).click();
      }, /\/purchase-orders\/[^/]+\/submit$/, `submitting ${poMark(plan.n)}`);

      if (aboveThreshold(plan)) {
        expect(String(res.status), `${poMark(plan.n)} totals ₹${poTotals(plan).total} — at or ` +
          `above this organisation's ₹${THRESHOLD} rule — and was issued without anyone being ` +
          `asked${dumpWire(wire)}`).toBe('awaiting_approval');
        expect(String(res.rule || ''), `${poMark(plan.n)} went for approval without naming the ` +
          'rule that sent it there').not.toBe('');
        sentForApproval++;

        /* ── THE REFUSAL, READ OFF THE SCREEN ────────────────────────────
           `may_approve` refuses the raiser of an order while `self_approval`
           is off, and the drawer must SAY WHY rather than simply not offering
           the button — a person told "you cannot approve this" without being
           told why raises a support ticket. This is the only moment the
           sentence is readable, which is why 06.03 leaves the setting alone. */
        if (!refusalSeen && settingsBefore.self_approval === false) {
          await expect(d.locator('.gn-bar .gn-row__meta').first(),
            'the drawer neither offers Approve nor says why not. `may_approve` returns a ' +
            'reason on every refusal precisely so the screen can print it')
            .toBeVisible({ timeout: 20_000 });
          refusalSeen = (await d.locator('.gn-bar .gn-row__meta').first().innerText()).trim();
          expect(refusalSeen.toLowerCase(), 'the refusal does not say that self-approval is ' +
            `what stopped it. It said: "${refusalSeen}"`).toContain('self-approval');
          await expect(d.getByRole('button', { name: /^Approve$/ }),
            'the Approve button is offered to the person who raised the order while this ' +
            'organisation does not allow self-approval').toHaveCount(0);
        }
      } else {
        expect(String(res.status), `${poMark(plan.n)} totals ₹${poTotals(plan).total} — below ` +
          `the ₹${THRESHOLD} rule — and should have been issued directly${dumpWire(wire)}`)
          .toBe('issued');
        expect(String(res.po_number || ''), `${poMark(plan.n)} was issued without a number. The ` +
          'serial is minted at issue, inside an advisory lock, and this is the only ' +
          'moment it can be checked').toMatch(new RegExp(`^${PO_PREFIX}-\\d{4}-\\d{4}$`));
        issuedDirectly++;
      }
      await closeDrawer(page);
      await settle(page);
    }

    /* ── SELF-APPROVAL, TURNED ON THROUGH THE REAL SCREEN ───────────────────
       This lane holds ONE account, and `may_approve` refuses the raiser unless
       the organisation allows it. The setting is a real control on a real
       screen and is typed, not patched — and the fact that it must be turned on
       is itself the finding worth stating: a single-administrator org cannot
       use purchase-order approval at all without it. */
    const s = (await apiEnvelope(page, '/api/v1/procurement/settings'))?.data || {};
    if (!s.self_approval) {
      const sp = await openTab(page, 'settings', 'settings');
      const form = sp.locator('form.gn-form--accent').first();
      await expect(form).toBeVisible({ timeout: 60_000 });
      await setCheckbox(
        form.locator('label.gn-chk', { hasText: 'Allow someone to approve a purchase order they raised' })
          .locator('input[type="checkbox"]'), true);
      await saveAndWait(page, async () => {
        await form.getByRole('button', { name: /^Save settings$/ }).click();
      }, /\/v1\/procurement\/settings$/, 'allowing self-approval', ['PUT']);
      const after = (await apiEnvelope(page, '/api/v1/procurement/settings'))?.data || {};
      expect(after.self_approval, 'self-approval did not save, so nothing can be approved ' +
        'by the only account this lane holds').toBe(true);
    }

    /* ── APPROVE — from BOTH surfaces ───────────────────────────────────────
       The queue and the drawer are two screens onto the same decision and both
       are §10 surfaces. The first half of the pending orders are approved from
       the drawer, the rest from the approvals queue. */
    const pending = PO_PLAN.filter(aboveThreshold);
    let approvedInDrawer = 0;
    let approvedInQueue = 0;

    for (let i = 0; i < pending.length; i++) {
      const plan = pending[i];
      const env = await apiEnvelope(page,
        `/api/v1/procurement/purchase-orders/${orders.get(poMark(plan.n))!.data.id}`);
      if (String(env.data.status) !== 'awaiting_approval') continue;

      if (i % 2 === 0) {
        const p = await openTab(page, 'purchase orders', 'purchase orders');
        const d = await openOrder(page, p, plan.vendor);
        await expect(d.locator('.gn-panel', { hasText: 'Approval' }).first(),
          'the drawer of an order awaiting approval does not show the approval panel, so a ' +
          'person cannot see which rule stopped it or how many signatures it needs')
          .toBeVisible();
        const res = await saveAndWait(page, async () => {
          await d.getByRole('button', { name: /^Approve$/ }).click();
        }, /\/purchase-orders\/[^/]+\/approve$/, `approving ${poMark(plan.n)} from the drawer`);
        expect(String(res.status), `${poMark(plan.n)} was approved and not issued. One approval ` +
          'satisfies a rule that requires one, and `_decide` issues on the spot')
          .toBe('issued');
        approvedInDrawer++;
        await closeDrawer(page);
      } else {
        const p = await openTab(page, 'approvals', 'approvals');
        const row = p.locator('tr.gn-tbl__row', { hasText: plan.vendor }).first();
        await expect(row, `${poMark(plan.n)} is not in the approval queue. The queue shows only ` +
          'what this organisation\'s own rules put in front of THIS caller, so an absent row ' +
          'means `may_approve` refused and the reason is on the record')
          .toBeVisible({ timeout: 30_000 });
        const res = await saveAndWait(page, async () => {
          await row.getByRole('button', { name: /^Approve$/ }).click();
        }, /\/purchase-orders\/[^/]+\/approve$/, `approving ${poMark(plan.n)} from the queue`);
        expect(String(res.status), `${poMark(plan.n)} was approved from the queue and not issued`)
          .toBe('issued');
        approvedInQueue++;
      }
      await settle(page);
    }

    // ── the canonical state ─────────────────────────────────────────────────
    const after = await myOrders(page);
    let approvals = 0;
    let numbered = 0;
    const numbers = new Set<string>();
    for (const plan of PO_PLAN) {
      const env = after.get(poMark(plan.n))!;
      expect(['issued', 'part_received', 'received', 'closed'],
        `${poMark(plan.n)} is ${env.data.status} and should have reached the supplier by now`)
        .toContain(String(env.data.status));
      expect(String(env.data.po_number || ''), `${poMark(plan.n)} carries no serial`)
        .toMatch(new RegExp(`^${PO_PREFIX}-\\d{4}-\\d{4}$`));
      numbers.add(String(env.data.po_number));
      numbered++;
      approvals += (env.approvals || []).length;
      if (aboveThreshold(plan)) {
        expect((env.approvals || []).length, `${poMark(plan.n)} is above the threshold and ` +
          'carries no approval record — an order issued past a rule with nobody named ' +
          'against it is exactly the lie `submit` refuses to tell').toBe(1);
        expect(String(env.approvals[0].decision)).toBe('approved');
        // The decision names a PERSON, never an id: `get_purchase_order` drops
        // `approver_id` on the way out and the screen renders `approver_name`.
        expect(String(env.approvals[0].approver_name || '').trim(),
          'the approval record names nobody').not.toBe('');
        expect(env.approvals[0].approver_id, 'the approval response still carries a member id. ' +
          'Names, never ids — the detail route drops it deliberately').toBeUndefined();
      } else {
        expect((env.approvals || []).length, `${poMark(plan.n)} is below the threshold and ` +
          'somebody was asked to approve it anyway').toBe(0);
      }
    }
    expect(numbers.size, `${numbered} orders share only ${numbers.size} distinct serials. The ` +
      'partial unique index on (org_id, po_number) is the backstop and the advisory lock is ' +
      'the mechanism; a duplicate here means one of them failed').toBe(numbered);
    expect(approvals, `wanted ${N_APPROVALS} approval decisions${dumpWire(wire)}`)
      .toBe(N_APPROVALS);

    console.log(`\n  06.05 — submitted: ${issuedDirectly} issued directly (below ` +
      `₹${THRESHOLD.toLocaleString('en-IN')}), ${sentForApproval} sent for approval (at or above); ` +
      `approved ${approvedInDrawer} from the drawer and ${approvedInQueue} from the queue; ` +
      `${approvals} approval rows in all; ${numbers.size} distinct serials.\n` +
      `           self-approval refusal: ${refusalSeen
        ? `"${refusalSeen}"`
        : 'NOT RE-PROVABLE on this execution — every above-threshold order was already ' +
          'approved by an earlier run, so there was nothing awaiting a decision to read the ' +
          'refusal from. It is proved on the run that creates the orders, and this line is ' +
          'here so the gap is visible rather than silent.'}\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 06.06 · ten deliveries, part then full, and the one that is refused
  // ──────────────────────────────────────────────────────────────────────────
  test('06.06 ten deliveries are recorded, one order goes part-received then received, and an over-delivery is refused', async ({ page }) => {
    test.setTimeout(45 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const orders = await myOrders(page);
    expect(orders.size, '06.04 has not left twelve orders to receive against').toBe(N_POS);

    const notesPresent = new Set<string>();
    for (const env of orders.values()) {
      for (const r of env.receipts || []) notesPresent.add(String(r.note || '').trim());
    }

    async function recordReceipt(rec: Receipt) {
      const p = await openTab(page, 'purchase orders', 'purchase orders');
      const env = orders.get(poMark(rec.po))!;
      const d = await openOrder(page, p, String(env.data.po_number));

      const form = d.locator('form.gn-form').filter({ hasText: 'Record a delivery' }).first();
      await expect(form, `no way to record a delivery against ${poMark(rec.po)}, which is ` +
        `${env.data.status}. A missing control is a FAILURE, never a skip`).toBeVisible();

      /* The line picker names the line by its DESCRIPTION and its running
         total — "2. S06-PO-05 L2 — 0 of 3 NOS" — so it is chosen by the mark
         this suite typed, never by index. An index would silently move the day
         a line is added. */
      await pickByLabel(form.locator('label.fld', { hasText: /^Line/ }).first().locator('select.inp'),
        lineDesc(rec.po, rec.line), 'delivery line');
      await typeInto(form.locator('label.fld', { hasText: /^Quantity/ }).first().locator('input.inp'),
        String(rec.qty));
      await setDate(form, /^Received on/, `2026-08-${pad(Math.min(28, rec.po + 10))}`);
      await typeInto(form.locator('label.fld', { hasText: /^Note/ }).first().locator('input.inp'),
        receiptNote(rec.r));

      const res = await saveAndWait(page, async () => {
        await form.getByRole('button', { name: /^Record receipt$/ }).click();
      }, /\/purchase-orders\/[^/]+\/receipts$/, `recording ${receiptNote(rec.r)} on ${poMark(rec.po)}`);
      expect(res?.data?.id, `${receiptNote(rec.r)} answered 2xx with no receipt in the body` +
        `${dumpWire(wire)}`).toBeTruthy();
      expect(Number(res.data.qty), `${receiptNote(rec.r)} stored the wrong quantity`).toBe(rec.qty);
      await closeDrawer(page);
      await settle(page);
    }

    const made = await ensure(
      RECEIPTS, (rec) => notesPresent.has(receiptNote(rec.r)), recordReceipt);

    // ── PART THEN FULL, asserted on the order's own status ──────────────────
    const after = await myOrders(page);
    const five = after.get(poMark(5))!;
    expect(String(five.data.status), `${poMark(5)} took four deliveries covering every line and ` +
      'is not `received`. `po_status_after_receipts` calls an order received when every line ' +
      'has `received >= ordered`, so a `part_received` here means a receipt did not land')
      .toBe('received');
    const seven = after.get(poMark(7))!;
    expect(String(seven.data.status), `${poMark(7)} is not fully received`).toBe('received');
    const two = after.get(poMark(2))!;
    expect(String(two.data.status), `${poMark(2)} took two of its three lines and must sit at ` +
      '`part_received` — the gap between ordered and received is the whole point of this module')
      .toBe('part_received');

    // The three quantities, on the screen and not only in the payload. The
    // drawer's entire reason to exist is showing ordered / received / billed
    // side by side.
    const p = await openTab(page, 'purchase orders', 'purchase orders');
    const d = await openOrder(page, p, String(five.data.po_number));
    /* ⚠ CASE-INSENSITIVE, AND THAT IS NOT A SOFTENING.
       `DataTable` renders its headers through CSS `text-transform: uppercase`,
       and `innerText` reports the RENDERED case — so the panel reads
       "# DESCRIPTION HSN/SAC ORDERED RECEIVED BILLED RATE LINE TOTAL" while the
       component declares "Ordered". Comparing the declared spelling against
       painted text is the same class of mistake as matching `getByRole(name)`
       on visible text instead of the accessible name: it fails as a missing
       control, which is the wrong diagnosis entirely. */
    const head = (await d.locator('table thead').first().innerText())
      .replace(/\s+/g, ' ').toUpperCase();
    for (const col of ['Ordered', 'Received', 'Billed']) {
      expect(head, `the record drawer does not paint a "${col}" column. Three quantities per ` +
        'line — ordered, received, billed — is what makes this a procurement module rather ' +
        `than a document generator.\n     header reads: ${head}`)
        .toContain(col.toUpperCase());
    }
    await expect(d.locator('.gn-panel', { hasText: 'Deliveries' }).first(),
      'four deliveries were recorded and the drawer shows no Deliveries panel').toBeVisible();

    /* ── THE REFUSAL ────────────────────────────────────────────────────────
       This organisation refuses a delivery larger than the order (06.03 set it
       explicitly). The attempt below WRITES NOTHING: `receipt_allowed` is a
       pure guard and `record_receipt` raises the 400 before it opens a
       transaction, so no row is created and no status moves. That is what makes
       this safe against the standing rule that validation is never tested by
       writing to the live database — the point is that the write is refused. */
    const line3 = five.lines.find((l: any) => Number(l.line_no) === 3)!;
    const over = Number(line3.qty_ordered) + 5;
    const form = d.locator('form.gn-form').filter({ hasText: 'Record a delivery' }).first();
    await expect(form, 'a fully received order can still take a late delivery, so the form ' +
      'must still be there').toBeVisible();
    await pickByLabel(form.locator('label.fld', { hasText: /^Line/ }).first().locator('select.inp'),
      lineDesc(5, 3), 'delivery line');
    await typeInto(form.locator('label.fld', { hasText: /^Quantity/ }).first().locator('input.inp'),
      String(over));
    await saveAndWait(page, async () => {
      await form.getByRole('button', { name: /^Record receipt$/ }).click();
    }, /\/purchase-orders\/[^/]+\/receipts$/, 'an over-delivery on a refusing organisation',
    ['POST'], 400);
    // And the person is TOLD, in words, on the screen. `.tst` is the toast the
    // product actually renders (`components/ui/toast.jsx`), and `apiErrorText`
    // is what puts the server's own sentence into its title.
    const toast = page.locator('.k-toasts .tst').filter({
      hasText: /exceed|over-receipt|ordered/i,
    }).first();
    await expect(toast, 'the over-delivery was refused by the server and the screen said ' +
      'nothing a person could act on. A 400 with no sentence is "the button does nothing", ' +
      'which is how the batch_id 500 went unnoticed for a whole module')
      .toBeVisible({ timeout: 15_000 });
    await closeDrawer(page);

    // Nothing was created by the refusal.
    const final = await myOrders(page);
    let receipts = 0;
    for (const env of final.values()) receipts += (env.receipts || []).length;
    expect(receipts, `wanted ${N_RECEIPTS} deliveries and the register holds ${receipts}. A ` +
      `count above ${N_RECEIPTS} means the refused over-delivery was written after all` +
      `${dumpWire(wire)}`).toBe(N_RECEIPTS);

    console.log(`\n  06.06 — deliveries: ${made.typed} typed, ${made.found} already present; ` +
      `${receipts} in all. ${poMark(5)} went part_received then received across four; ` +
      `${poMark(7)} received; ${poMark(2)} left part_received. One over-delivery of ` +
      `${over} against ${line3.qty_ordered} ordered was refused with a 400 and wrote nothing.\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 06.06b · a bill against an order, and the three-way match
  // ──────────────────────────────────────────────────────────────────────────
  test('06.06b a vendor bill links to its order, the three-way match names the gap, and the link is taken back', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    /**
     * ⚠ THE ORDER CHOSEN HERE HAS NO RECEIPTS, AND THAT IS THE POINT.
     *
     * Recording a delivery against an order with a bill linked to it WRITES
     * `ganit_vendor_bills.acceptance_date` — the date a STATUTORY MSME payment
     * clock runs from — on every linked bill that does not already carry one,
     * and the unlink control does not clear it again. Those fourteen bills are
     * Suite 05's rows. So this drives the link, the match and the unlink on an
     * order that has taken no delivery, which leaves nothing behind but
     * `updated_by` on one bill.
     */
    const orders = await myOrders(page);
    const target = PO_PLAN.find((p) => !RECEIPTS.some((r) => r.po === p.n)
      && p.vendor.startsWith('S05 '))!;
    expect(target, 'no order was raised against a Suite 05 supplier without receipts, so the ' +
      'bill-link panel cannot be driven without touching a statutory acceptance date')
      .toBeTruthy();
    const env = orders.get(poMark(target.n))!;

    const p = await openTab(page, 'purchase orders', 'purchase orders');
    const d = await openOrder(page, p, String(env.data.po_number));

    const panelBills = d.locator('.gn-panel', { hasText: 'Bills against this order' }).first();
    await expect(panelBills, 'the record drawer has no panel for the bills raised against the ' +
      'order, so the three-way match has no third leg').toBeVisible();

    const linkForm = panelBills.locator('form.gn-bar');
    await expect(linkForm, `no way to link a bill to ${poMark(target.n)}. The picker offers only ` +
      'unlinked bills for THIS supplier, so an absent form means the supplier has none — ' +
      'which for a Suite 05 vendor would itself be a finding').toBeVisible({ timeout: 20_000 });
    const sel = linkForm.locator('select.inp');
    const chosen = await pickByLabel(sel, /VB-/, 'unlinked vendor bill');
    await saveAndWait(page, async () => {
      await linkForm.getByRole('button', { name: /^Link$/ }).click();
    }, /\/vendor-bills\/[^/]+\/link$/, `linking ${chosen} to ${poMark(target.n)}`);
    await settle(page);

    // The match panel must now say something a person can act on. Nothing is
    // approved on the strength of a match — the exceptions are the deliverable.
    const match = d.locator('.gn-panel', { hasText: 'Three-way match' }).first();
    await expect(match, 'a bill is linked and the drawer shows no three-way match')
      .toBeVisible({ timeout: 20_000 });
    const matchText = (await match.innerText()).replace(/\s+/g, ' ');
    expect(matchText.length, 'the three-way match panel painted nothing').toBeGreaterThan(20);

    const live = await apiEnvelope(page,
      `/api/v1/procurement/purchase-orders/${env.data.id}/match`);
    expect(live, 'GET /match answered nothing').toBeTruthy();
    expect(String(live.basis || ''), 'the match does not state the basis it was computed on, ' +
      'so a reader cannot tell what it compared').not.toBe('');
    // Billed with nothing received is a real exception and must be raised, not
    // smoothed over: a vendor charging for goods that never came is the case
    // this module exists to surface.
    expect((live.exceptions || []).length, 'a bill was charged against an order that has ' +
      'received nothing and the three-way match raised no exception at all. Ordered > ' +
      'received is a late supplier; billed > received is a supplier charging for goods ' +
      `that never arrived.\n     match said: ${JSON.stringify(live).slice(0, 400)}`)
      .toBeGreaterThan(0);

    // ── and take it back ────────────────────────────────────────────────────
    const linkedRow = panelBills.locator('.gn-pay__row', { hasText: 'VB-' }).first();
    await expect(linkedRow, 'the linked bill is not listed on the order').toBeVisible();
    await saveAndWait(page, async () => {
      await linkedRow.getByRole('button', { name: /^Unlink$/ }).click();
    }, /\/vendor-bills\/[^/]+\/link$/, `unlinking ${chosen}`);
    await settle(page);

    const bills = await apiRows(page, '/api/v1/ganit/vendor-bills');
    const stillLinked = bills.filter((b) => b.po_id).length;
    expect(stillLinked, 'a Suite 05 vendor bill is still pointed at a Suite 06 purchase order. ' +
      'Unlinking is a first-class operation, not an undo, and leaving one linked would move ' +
      'a row on somebody else\'s volume sheet').toBe(0);
    const stamped = bills.filter((b) => b.acceptance_date).length;
    expect(stamped, 'a vendor bill came away carrying an acceptance date. That column feeds a ' +
      'STATUTORY MSME deadline and the unlink control cannot clear it, which is why this ' +
      'test deliberately chose an order with no deliveries').toBe(0);

    await closeDrawer(page);
    console.log(`\n  06.06b — ${chosen} linked to ${poMark(target.n)}, the three-way match raised ` +
      `${(live.exceptions || []).length} exception(s), and the link was taken back leaving ` +
      `${stillLinked} linked and ${stamped} acceptance dates written${dumpWire(wire)}\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 06.07 · REVISE — four change orders, and the control that has to exist
  // ──────────────────────────────────────────────────────────────────────────
  test('06.07 four issued orders are revised, the previous version is kept, and only a material rise goes back for approval', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    /**
     * ── WHY THIS TEST FAILS ON THE CONTROL BEFORE IT FAILS ON THE ROWS ──────
     *
     * §10 defines Suite 06 as "PO raise, REVISE, approve, part then full
     * receipt, close" and §4 asks for FOUR revisions.
     * `full-journey.spec.ts` once wrote `test.skip(!opened, 'no affordance')`
     * for a control it could not find, and that is how the e-sign journey
     * reported green for weeks while the whole module returned 403. So a
     * missing control is a FAILURE, and this test looks in every place a person
     * would look and names all of them.
     *
     * ⚠ MEASURED 2026-08-29 AGAINST THE DEPLOYED BUILD: there was no such
     * control anywhere. `PATCH /api/v1/procurement/purchase-orders/{po_id}` is
     * complete and deployed — its own docstring calls "can I edit a PO after it
     * has been approved?" the most-asked question at every vendor in this
     * market. It snapshots the previous state whole into
     * `ganit_po_revisions.snapshot`, records the change field by field in
     * `diff`, refuses to remove a line something has already arrived against,
     * and sends the order back down the approval path when `needs_reapproval`
     * says the rise is material. `PurchaseOrderDetail.jsx` RENDERS a "Revision
     * history" panel for the rows it produces. And no frontend call reached it:
     * the whole of `frontend/src` held no `api.patch` and no `api.delete` on
     * that path, so an issued order could not be amended and a draft raised by
     * mistake could not be corrected. `staging.ganit_po_revisions` held ZERO
     * rows for its entire life — the same shape as `ganit_vendors.address`,
     * `ganit_expenses.receipt_urls` and `ganit_recurring.notes`, every one of
     * them API-writable, already rendered, and unenterable by a human.
     *
     * The control is added in `PurchaseOrderDetail.jsx` and proved by
     * `pages/procurement/__tests__/purchaseOrders.test.jsx`. Until that lands
     * and Vercel deploys it, THIS TEST FAILS on the missing control — which is
     * the correct answer for a build that does not have it, and is why the
     * failure below names the deploy rather than the feature.
     *
     * Nothing here reaches for `page.request.patch`. Manufacturing the four
     * rows over HTTP would satisfy §4's count and prove nothing a customer could
     * reproduce, which is precisely the green-over-broken this programme exists
     * to stop.
     */
    const orders = await myOrders(page);
    expect(orders.size, '06.04 has not left twelve orders to revise').toBe(N_POS);

    // ── the control, before anything else ───────────────────────────────────
    const firstPlan = PO_PLAN.find((p) => p.n === REVISION_PLAN[0].po)!;
    const firstEnv = orders.get(poMark(firstPlan.n))!;
    const p0 = await openTab(page, 'purchase orders', 'purchase orders');
    const d0 = await openOrder(page, p0, String(firstEnv.data.po_number));

    const looked: string[] = [];
    const candidates: { where: string; loc: Locator }[] = [
      { where: 'drawer button named Revise', loc: d0.getByRole('button', { name: /^Revise$/i }) },
      { where: 'drawer button named Edit', loc: d0.getByRole('button', { name: /^Edit$/i }) },
      { where: 'drawer button named Amend', loc: d0.getByRole('button', { name: /Amend/i }) },
      { where: 'drawer button named Change order', loc: d0.getByRole('button', { name: /Change order/i }) },
      { where: 'drawer header icon with an edit label', loc: d0.locator('.dr__acts [aria-label*="dit" i]') },
      { where: 'a form headed Revise/Amend/Edit this order', loc: d0.locator('form.gn-form').filter({ hasText: /Revise this order|Amend|Edit this order/i }) },
      { where: 'register row action named Edit', loc: p0.locator('.gn-list').getByRole('button', { name: /^Edit/i }) },
    ];
    let found = 0;
    for (const c of candidates) {
      const n = await c.loc.count();
      looked.push(`${c.where}: ${n}`);
      found += n;
    }
    const historyPanel = await d0.locator('.gn-panel', { hasText: 'Revision history' }).count();
    await closeDrawer(page);

    expect(found,
      '\n  ⚠ NO CONTROL CHANGES A PURCHASE ORDER ON THE DEPLOYED BUILD.\n' +
      `     Looked at, on ${firstEnv.data.po_number} (${firstEnv.data.status}):\n       ` +
      looked.join('\n       ') +
      '\n     PATCH /api/v1/procurement/purchase-orders/{po_id} is deployed and complete: it\n' +
      '     snapshots the previous state into ganit_po_revisions.snapshot, records a\n' +
      '     field-by-field diff, refuses to remove a line goods have arrived against, and\n' +
      '     re-opens approval when needs_reapproval() says the rise is material\n' +
      '     (routers/procurement.py:786-964). No deployed frontend call reaches it: the tab\n' +
      '     GETs the list and POSTs a create, and the drawer posts only to /submit /approve\n' +
      '     /reject /receipts /close. There is no api.patch and no api.delete on that path.\n' +
      `     The drawer renders ${historyPanel} "Revision history" panel(s) for rows that\n` +
      '     cannot exist — staging.ganit_po_revisions has held 0 rows for its entire life.\n' +
      '     §4 asks for 4 revisions and §10 for "PO raise, REVISE, approve"; neither is\n' +
      '     reachable, so neither is produced here.\n' +
      '     PRODUCT BUG. The control is added in\n' +
      '     frontend/src/pages/procurement/PurchaseOrderDetail.jsx and proved by\n' +
      '     frontend/src/pages/procurement/__tests__/purchaseOrders.test.jsx. If this\n' +
      '     assertion is still red, that change has not been committed and deployed —\n' +
      '     a Vercel deploy is what closes it, not another edit.\n')
      .toBeGreaterThan(0);

    // ── the four change orders ──────────────────────────────────────────────
    async function revise(rev: RevisionPlan) {
      const plan = PO_PLAN.find((x) => x.n === rev.po)!;
      const env = await apiEnvelope(page,
        `/api/v1/procurement/purchase-orders/${orders.get(poMark(rev.po))!.data.id}`);
      const p = await openTab(page, 'purchase orders', 'purchase orders');
      const d = await openOrder(page, p, String(env.data.po_number));

      const open = d.getByRole('button', { name: /^Revise$/ });
      await expect(open, `${poMark(rev.po)} is ${env.data.status} and offers no way to change ` +
        'it. An issued order is amended as a REVISION, never overwritten, and that is what ' +
        'this button is for').toBeVisible();
      await open.click();

      const form = d.locator('form.gn-form').filter({ hasText: 'Revise this order' }).first();
      await expect(form, 'the revise form did not open').toBeVisible();

      if (rev.qty) {
        /* Line rows on the revise form are Description · Qty · Rate · GST% ·
           HSN, in that order — one fewer column than the create form, which
           also carries the catalogue picker. The quantity is the second input. */
        const li = form.locator('.gn-li').nth(rev.qty.line - 1);
        await expect(li, `the revise form has no line ${rev.qty.line}`).toBeVisible();
        await typeInto(li.locator('input.inp').nth(1), String(rev.qty.to));
      }
      if (rev.expected) await setDate(form, /^Expected by/, rev.expected);
      if (rev.category) {
        await typeInto(form.locator('label.fld', { hasText: 'Category' }).first()
          .locator('input.inp'), rev.category);
      }
      if (rev.terms) {
        await typeInto(form.locator('label.fld', { hasText: 'Terms' }).first()
          .locator('textarea.inp'), rev.terms);
      }
      await typeInto(form.locator('label.fld', { hasText: 'Why is it changing?' }).first()
        .locator('input.inp'), rev.reason);

      // What the form says it will become, before it is saved. A form that
      // previews a total the server then disagrees with is worse than one that
      // previews nothing.
      const want = poTotals(plan, true);
      if (rev.qty) {
        const becomes = (await form.locator('.gn-tot__r--sum .gn-tot__v').innerText())
          .replace(/[^\d.]/g, '');
        expect(Number(becomes), `the revise form previews ${becomes} and the server's own ` +
          `arithmetic gives ${want.total}`).toBeCloseTo(want.total, 2);
      }

      const res = await saveAndWait(page, async () => {
        await form.getByRole('button', { name: /^Record revision$/ }).click();
      }, /\/v1\/procurement\/purchase-orders\/[^/]+$/, `revising ${poMark(rev.po)}`, ['PATCH']);

      expect(res.changed, `revising ${poMark(rev.po)} recorded no change at all. A PATCH that ` +
        'moves nothing deliberately mints no revision — so this means the form sent the ' +
        `order back exactly as it found it${dumpWire(wire)}`).toBe(true);
      expect(Boolean(res.re_approval_required),
        `${poMark(rev.po)} ${rev.material ? 'raises the total materially and did NOT go back ' +
          'for approval' : 'changed nothing about the money and was sent back for approval ' +
          'anyway — which is the failure mode that makes people stop correcting orders'}. ` +
        `The server said: ${res.re_approval_reason || res.note || '(nothing)'}`)
        .toBe(rev.material);
      await closeDrawer(page);
      await settle(page);
    }

    const made = await ensure(
      REVISION_PLAN,
      (rev) => Number(orders.get(poMark(rev.po))!.data.revision) > 0,
      revise,
    );

    // ── the canonical revisions ─────────────────────────────────────────────
    const after = await myOrders(page);
    let revisions = 0;
    const notes: string[] = [];
    for (const rev of REVISION_PLAN) {
      const env = after.get(poMark(rev.po))!;
      expect(Number(env.data.revision), `${poMark(rev.po)} was revised and its revision ` +
        'counter did not move').toBe(1);
      expect((env.revisions || []).length, `${poMark(rev.po)} has no revision row. The counter ` +
        'moved, so the header was written and the history was not — which is the half of ' +
        'this feature that cannot be reconstructed afterwards').toBe(1);
      const rv = env.revisions[0];
      revisions += 1;
      expect(String(rv.reason), `${poMark(rev.po)}'s revision recorded no reason. A change ` +
        'order nobody can explain later is what the reason box exists to prevent')
        .toBe(rev.reason);
      expect(Boolean(rv.re_approved), `${poMark(rev.po)}'s revision records re_approved=` +
        `${rv.re_approved} and the change ${rev.material ? 'was' : 'was not'} material`)
        .toBe(rev.material);
      // It names a PERSON, never an id.
      expect(String(rv.changed_by_name || '').trim(), 'the revision names nobody')
        .not.toBe('');
      expect(String(JSON.stringify(rv)), 'a revision row carries a raw member id')
        .not.toMatch(/user_[0-9a-f]{8,}/i);

      // The previous version is KEPT — that is the promise the screen makes.
      const plan = PO_PLAN.find((x) => x.n === rev.po)!;
      const want = poTotals(plan, true);
      expect(Number(env.data.total), `${poMark(rev.po)} total after its revision`)
        .toBeCloseTo(want.total, 2);
      notes.push(`${poMark(rev.po)} rev ${env.data.revision} · ` +
        `${rev.material ? 'material' : 'within authorisation'} · "${rv.reason}"`);
    }
    expect(revisions, `wanted ${N_REVISIONS} revisions${dumpWire(wire)}`).toBe(N_REVISIONS);

    /* AND THE MATERIAL ONE STAYED ISSUED. S06-PO-12 rises by ₹28,320 against a
       ₹10,000 threshold, so `needs_reapproval` says yes — and at ₹99,120 it is
       still below the ₹2,00,000 rule, so `match_rule` finds nobody to ask. The
       order therefore stays issued with `approval_required` false while the
       revision still records that the change WAS material, which is the branch
       the router's own comment describes and which no other test reaches. */
    const material = after.get(poMark(REVISION_PLAN[0].po))!;
    expect(String(material.data.status), 'the materially-revised order was sent to ' +
      'awaiting_approval even though its new total is below this organisation\'s approval ' +
      'rule — an order nobody is required to approve cannot sit waiting for an approval')
      .not.toBe('awaiting_approval');
    expect(Boolean(material.data.approval_required), 'the materially-revised order came back ' +
      'requiring approval against a rule that does not match its new total').toBe(false);
    // ⚠ THIS ASSERTED 1 WHILE ITS OWN MESSAGE SAYS IT MUST NOT. The line above
    // requires `approval_required === false` — no rule matches the new total —
    // and then this demanded an approval row anyway. An approval against a rule
    // that matches nobody is an approval nobody is required to give, and §4
    // counts exactly six, so creating a seventh would make 06.10 unsatisfiable.
    // The message was right and the number was wrong.
    expect((material.approvals || []).length, 'the material revision spent an approval row. ' +
      'It must not: no rule matches the new total, and §4 counts exactly six').toBe(0);

    // The history is PAINTED, not merely stored. The panel existed for the
    // whole life of the module with nothing to put in it.
    const p = await openTab(page, 'purchase orders', 'purchase orders');
    const d = await openOrder(page, p, String(material.data.po_number));
    const hist = d.locator('.gn-panel', { hasText: 'Revision history' }).first();
    await expect(hist, 'the order carries a revision and the drawer paints no history panel')
      .toBeVisible();
    const histText = (await hist.innerText()).replace(/\s+/g, ' ');
    expect(histText, 'the revision history does not name the reason the change was made')
      .toContain(REVISION_PLAN[0].reason);
    expect(histText, 'the revision history does not say the change went back for approval')
      .toMatch(/Revision 1/);
    await closeDrawer(page);

    console.log(`\n  06.07 — revisions: ${made.typed} typed, ${made.found} already present; ` +
      `${revisions} recorded:\n     ` + notes.join('\n     ') + '\n');
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 06.08 · closing an order short, with a reason a report can group by
  // ──────────────────────────────────────────────────────────────────────────
  test('06.08 a part-received order is closed short with a reason from the organisation\'s own list', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const orders = await myOrders(page);
    const env = orders.get(poMark(CLOSE_PO))!;
    expect(env, `${poMark(CLOSE_PO)} is not on the register`).toBeTruthy();

    const settings = (await apiEnvelope(page, '/api/v1/procurement/settings'))?.data || {};
    expect(settings.close_reasons, 'this organisation has no close-short reasons at all, so an ' +
      'order can never be closed and the committed-spend figure is permanently wrong')
      .toContain(CLOSE_REASON);

    if (String(env.data.status) !== 'closed') {
      const p = await openTab(page, 'purchase orders', 'purchase orders');
      const d = await openOrder(page, p, String(env.data.po_number));
      const form = d.locator('form.gn-form').filter({ hasText: 'Close this order short' }).first();
      await expect(form, `no way to close ${poMark(CLOSE_PO)} short. Without it a partly ` +
        'fulfilled order sits open for ever and committed spend never comes back down')
        .toBeVisible();

      /* The reason comes from the firm's OWN list and a free-text box here
         would produce a reason nothing can report on. The select is driven by
         its visible text, which is the reason itself. */
      await pickByLabel(form.locator('label.fld', { hasText: /^Reason/ }).first().locator('select.inp'),
        CLOSE_REASON, 'close-short reason');
      const res = await saveAndWait(page, async () => {
        await form.getByRole('button', { name: /^Close short$/ }).click();
      }, /\/purchase-orders\/[^/]+\/close$/, `closing ${poMark(CLOSE_PO)} short`);
      expect(String(res.status), `${poMark(CLOSE_PO)} did not close${dumpWire(wire)}`).toBe('closed');
      await closeDrawer(page);
      await settle(page);
    }

    const after = await myOrders(page);
    const closed = after.get(poMark(CLOSE_PO))!;
    expect(String(closed.data.status), `${poMark(CLOSE_PO)} is not closed`).toBe('closed');
    expect(String(closed.data.closed_reason), 'the order closed without recording why, so no ' +
      'report can group by it — which is the entire reason the reason comes from a list')
      .toBe(CLOSE_REASON);
    // The delivery it did take is still on the record. Closing short is "we are
    // not going to receive the rest", not "none of this happened".
    expect((closed.receipts || []).length, 'closing the order short discarded the delivery it ' +
      'had already taken').toBeGreaterThan(0);

    /* And the commitment is DISCHARGED — a closed order must leave committed
       spend, or the figure is permanently wrong for ever. The expectation is
       counted from the LIVE statuses rather than from a constant, because the
       point is that this one order left the open set and the others did not. */
    const dept = PO_PLAN.find((q) => q.n === CLOSE_PO)!.dept;
    const OPEN: string[] = ['issued', 'part_received', 'received'];
    const wantOpen = PO_PLAN.filter((q) => q.dept === dept)
      .filter((q) => OPEN.includes(String(after.get(poMark(q.n))!.data.status))).length;
    const spend = await apiEnvelope(page, '/api/v1/procurement/reports/committed-spend');
    const row = (spend.data || []).find((r: any) => String(r.department) === dept);
    expect(row, `committed spend has no ${dept} row at all`).toBeTruthy();
    expect(Number(row.orders), `committed spend counts ${row.orders} open orders in ${dept} and ` +
      `${wantOpen} are actually open. Closed short or fully billed, the commitment is ` +
      'discharged, and leaving a closed order in is exactly how the figure becomes ' +
      'permanently wrong').toBe(wantOpen);

    console.log(`\n  06.08 — ${poMark(CLOSE_PO)} (${closed.data.po_number}) closed short: ` +
      `"${closed.data.closed_reason}", with ${(closed.receipts || []).length} delivery kept ` +
      'and the commitment discharged\n');
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 06.09 · four budgets, one breached, and the order it did not block
  // ──────────────────────────────────────────────────────────────────────────
  test('06.09 four department budgets track committed spend, exactly one is over, and being over blocks nothing', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    con.at('budgets');
    const p = await openTab(page, 'budgets', 'budgets');

    const report = await apiEnvelope(page, '/api/v1/procurement/reports/budget');
    expect(report.enabled, 'budgets are switched off, so the screen shows "Budgets are off" and ' +
      '§4\'s four cannot be set').toBe(true);
    const rows = report.data || [];
    expect(rows.length, `wanted ${N_BUDGETS} department budgets, the report answers ${rows.length}`)
      .toBe(N_BUDGETS);

    // ── the committed figure, reconciled to the orders that produced it ─────
    // Not summed off a list — `budget_state` groups in SQL and a list endpoint
    // caps at 200. This recomputes the expectation from the LIVE statuses and
    // this suite's own arithmetic, so it is a reconciliation rather than a
    // restatement.
    const orders = await myOrders(page);
    const OPEN = ['issued', 'part_received', 'received'];
    const expectedCommitted = new Map<string, number>();
    for (const plan of PO_PLAN) {
      const env = orders.get(poMark(plan.n));
      if (!env || !OPEN.includes(String(env.data.status))) continue;
      // AFTER any revision, decided by the live counter — 06.07 raises a
      // quantity on one of the three IT orders and the committed figure has to
      // follow it, or this reconciliation would report the product wrong for
      // having done exactly what it was asked.
      expectedCommitted.set(plan.dept, r2((expectedCommitted.get(plan.dept) || 0)
        + poTotals(plan, Number(env.data.revision) > 0).total));
    }

    const byDept = new Map(rows.map((r: any) => [String(r.department), r]));
    let over = 0;
    const lines: string[] = [];
    for (const b of BUDGETS) {
      const row: any = byDept.get(b.department);
      expect(row, `the budget report has no row for ${b.department}. Matching is ` +
        'case-insensitive on the trimmed department string and the orders carry it verbatim, ' +
        'so a missing row means the join failed').toBeTruthy();
      expect(Number(row.limit), `${b.department}'s limit is not what was typed`).toBe(b.limit);
      expect(Number(row.committed), `${b.department} committed spend does not reconcile to the ` +
        'orders that produced it. This is summed in SQL over open orders; the expectation is ' +
        'recomputed from the live statuses and compute_po_totals\' own rounding')
        .toBeCloseTo(expectedCommitted.get(b.department) || 0, 2);
      if (String(row.state) === 'over') over++;
      lines.push(`${b.department.padEnd(11)} ₹${Number(row.committed).toLocaleString('en-IN')} of ` +
        `₹${b.limit.toLocaleString('en-IN')} — ${row.used_pct}% — ${row.state}`);
    }
    expect(over, `wanted exactly ${N_BREACHED} department over its budget and ${over} are. ` +
      `The limits are constants sized against the order plan, so a different count means the ` +
      'orders or their statuses moved').toBe(N_BREACHED);
    expect(String((byDept.get(OVER_BUDGET_DEPT) as any).state),
      `${OVER_BUDGET_DEPT} is the department the plan sizes to breach`).toBe('over');

    /* ── AND THE BREACH BLOCKED NOTHING ─────────────────────────────────────
     *
     * ⚠ THE CLAIM HAS TO BE THE ONE THE DATA SUPPORTS. An earlier draft of this
     * said "an order was raised AFTER the department went over", and that is
     * not what happened: the serial is minted at issue, the below-threshold
     * orders issue on submit and the rest only when they are approved, so the
     * order that takes IT past its limit is the LAST of the three to be issued.
     * Nothing was raised after the breach, and asserting that it was would have
     * been a green test making a false statement.
     *
     * What IS true, and is the substance of "warns, never blocks", is stronger
     * and simpler: THE ORDER THAT CROSSED THE LIMIT WAS ACCEPTED. It was
     * numbered, issued and committed like any other, and the budget said "Over
     * budget" afterwards rather than refusing it. Which order that is, is
     * computed here from the LIVE serials — the series is monotonic within the
     * year and minted at issue, so sorting on it recovers the real order of
     * events — and from the same arithmetic the budget itself uses.
     *
     * Nothing in `create_purchase_order`, `submit` or `_issue` consults
     * `budget_state` at all. That is the decision §10 records, and this is the
     * evidence for it rather than a restatement of the intention.
     */
    const inDept = PO_PLAN.filter((x) => x.dept === OVER_BUDGET_DEPT);
    expect(inDept.length, 'the plan puts fewer than two orders in the over-budget department, ' +
      'so no single order can be shown to have crossed the limit').toBeGreaterThanOrEqual(2);

    const serialOf = (env: any) => {
      const n = Number(String(env.data.po_number || '').split('-').pop());
      expect(Number.isFinite(n), `${env.data.po_number} is not a PREFIX-YYYY-NNNN serial, so ` +
        'the order of events cannot be recovered').toBeTruthy();
      return n;
    };
    const byIssue = inDept
      .map((plan) => ({ plan, env: orders.get(poMark(plan.n))! }))
      .filter((x) => x.env)
      .sort((a, b) => serialOf(a.env) - serialOf(b.env));

    const limit = BUDGETS.find((b) => b.department === OVER_BUDGET_DEPT)!.limit;
    let running = 0;
    let crossed: typeof byIssue[number] | null = null;
    for (const x of byIssue) {
      running = r2(running + poTotals(x.plan, Number(x.env.data.revision) > 0).total);
      if (!crossed && running > limit) crossed = x;
    }
    expect(crossed, `no single ${OVER_BUDGET_DEPT} order takes the department past its ` +
      `₹${limit.toLocaleString('en-IN')} limit, so the breach cannot be attributed and ` +
      '"never blocks" is unproven').toBeTruthy();

    for (const { plan, env } of byIssue) {
      expect(['issued', 'part_received', 'received', 'closed'],
        `${poMark(plan.n)} is in ${OVER_BUDGET_DEPT}, which is over budget, and its status is ` +
        `${env.data.status}. A budget must WARN and never BLOCK — an order refused because a ` +
        'free-text department string crossed a limit would stop a firm buying')
        .toContain(String(env.data.status));
      expect(String(env.data.po_number || ''), `${poMark(plan.n)} was raised into an ` +
        'over-budget department and never got a serial, which is a block in all but name')
        .toMatch(new RegExp(`^${PO_PREFIX}-`));
    }
    expect(String(crossed!.env.data.po_number || ''), `${poMark(crossed!.plan.n)} is the order ` +
      `that took ${OVER_BUDGET_DEPT} past ₹${limit.toLocaleString('en-IN')}, and it carries no ` +
      'serial — an order that crosses a budget and is then refused a number has been blocked ' +
      'in all but name').toMatch(new RegExp(`^${PO_PREFIX}-`));
    expect(['issued', 'part_received', 'received', 'closed'],
      `${poMark(crossed!.plan.n)} crossed the ${OVER_BUDGET_DEPT} budget and its status is ` +
      `${crossed!.env.data.status}. The budget must warn and never block, and this is the one ` +
      'order where the difference is visible').toContain(String(crossed!.env.data.status));

    // ── and the SCREEN says so, in words ────────────────────────────────────
    const painted = (await p.innerText()).replace(/\s+/g, ' ');
    expect(painted, 'the budgets screen does not say a department is over its limit. A warning ' +
      'nobody can see is not a warning').toMatch(/Over budget/i);
    expect(painted, `the budgets screen does not name ${OVER_BUDGET_DEPT}`)
      .toContain(OVER_BUDGET_DEPT);
    expect(painted, 'the budgets screen does not carry the caveat that a department is free ' +
      'text and governed nowhere — which is the one thing a reader has to know to trust it')
      .toMatch(/free text/i);

    console.log('\n  06.09 — department budgets:\n     ' + lines.join('\n     ') +
      `\n     exactly ${over} over. ${poMark(crossed!.plan.n)} (${crossed!.env.data.po_number}) ` +
      `is the order that took ${OVER_BUDGET_DEPT} past ₹${limit.toLocaleString('en-IN')}, and ` +
      `it was accepted, numbered and ${crossed!.env.data.status} like any other — the budget ` +
      `warned and blocked nothing. All ${byIssue.length} ${OVER_BUDGET_DEPT} orders carry a ` +
      'serial.\n');
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 06.10 · every §4 count is exact, so a second execution verifies
  // ──────────────────────────────────────────────────────────────────────────
  test('06.10 every §4 count is exact, so a second execution verifies rather than duplicates', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    await signIn(page);

    /**
     * §6 is proved by RUNNING THE SUITE TWICE, not by claiming it — and this is
     * the test that makes the second run mean something. Every count below is an
     * EQUALITY against the §4 target, so a second execution that duplicated
     * anything reports a number that is too high rather than passing on a
     * "greater than zero" that could never fail.
     */
    const counts: { what: string; got: number; want: number }[] = [];
    const push = (what: string, got: number, want: number) => counts.push({ what, got, want });

    const orders = await myOrders(page);
    push('purchase orders', orders.size, N_POS);

    let lines = 0; let receipts = 0; let revisions = 0; let approvals = 0;
    for (const env of orders.values()) {
      lines += (env.lines || []).length;
      receipts += (env.receipts || []).length;
      revisions += (env.revisions || []).length;
      approvals += (env.approvals || []).length;
    }
    push('purchase-order lines', lines, N_LINES);
    push('revisions', revisions, N_REVISIONS);
    push('receipts', receipts, N_RECEIPTS);
    push('approvals', approvals, N_APPROVALS);

    const budget = await apiEnvelope(page, '/api/v1/procurement/reports/budget');
    push('budgets set', (budget.data || []).length, N_BUDGETS);
    push('budgets breached', (budget.data || []).filter((b: any) => b.state === 'over').length,
      N_BREACHED);

    const vendors = (await apiRows(page, '/api/v1/ganit/vendors'))
      .filter((v) => String(v.name || '').startsWith(`${TAG} Vendor `));
    push('vendors typed from the Kray form', vendors.length, N_VENDORS_TYPED);

    // Lifecycle shape, so a count that is right for the wrong reason is caught.
    const byStatus = (s: string) =>
      [...orders.values()].filter((e) => String(e.data.status) === s).length;
    push('orders closed short', byStatus('closed'), 1);
    push('orders fully received', byStatus('received'), 2);
    push('orders part received', byStatus('part_received'), 1);
    push('orders still draft', byStatus('draft'), 0);

    console.log('\n  06.10 — §4 volumes against the live database:\n' +
      counts.map((c) => `     ${c.got === c.want ? '✓' : '✗'} ${c.what.padEnd(34)} ` +
        `${String(c.got).padStart(4)} / ${c.want}`).join('\n') + '\n');

    const wrong = counts.filter((c) => c.got !== c.want);
    expect(wrong.map((c) => `${c.what}: ${c.got} (wanted ${c.want})`),
      'a §4 volume is not exact. A count ABOVE the target on a second execution means ' +
      '`ensure()` failed to recognise this suite\'s own marks and duplicated them; a count ' +
      'BELOW it means the run that made them did not finish, or — for `revisions` — that the ' +
      'control which would produce them does not exist (06.07). Neither is ruled on here.')
      .toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 06.11 · not one UUID on any Procurement screen
  // ──────────────────────────────────────────────────────────────────────────
  test('06.11 no Procurement screen paints a UUID', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    /**
     * ⚠ `frontend/scripts/check-rendered-ids.mjs` IS STATIC AND POSITIONAL.
     *
     * It reads JSX and cannot see an id the SERVER pre-formatted into a string.
     * So this reads the PAINTED TEXT of every Procurement screen, now that the
     * module holds twelve orders, thirty-four lines and ten deliveries, and
     * looks for the shape of a uuid in what a person can actually see. The
     * approval rule is written with member ids and the approvals panel resolves
     * them to names, which makes this module a likelier place than most.
     *
     * A hit is reported with the screen and the surrounding words. No verdict.
     */
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const found: string[] = [];

    for (const t of TABS) {
      con.at(t.id);
      const p = await openTab(page, t.id, t.label);
      const text = await p.innerText().catch(() => '');
      const m = text.match(new RegExp(UUID.source, 'gi'));
      if (m) {
        for (const hit of [...new Set(m)].slice(0, 3)) {
          const at = text.indexOf(hit);
          found.push(`${t.id}: …${text.slice(Math.max(0, at - 60), at + hit.length + 20)
            .replace(/\s+/g, ' ')}…`);
        }
      }
    }

    // And the record drawer — the surface most likely to carry one, because it
    // renders a single row's every field rather than a chosen set of columns,
    // and because the approvals it lists are keyed by member id underneath.
    const orders = await myOrders(page);
    const first = [...orders.values()][0];
    if (first) {
      const p = await openTab(page, 'purchase orders', 'purchase orders');
      const d = await openOrder(page, p, String(first.data.po_number));
      const text = await d.innerText();
      const m = text.match(new RegExp(UUID.source, 'gi'));
      if (m) found.push(`purchase-order drawer: ${[...new Set(m)].slice(0, 3).join(', ')}`);
      // Names, and nothing but names, wherever a person is shown.
      const approvalPanel = d.locator('.gn-panel', { hasText: 'Approval' }).first();
      if (await approvalPanel.count()) {
        const at = await approvalPanel.innerText();
        expect(at, 'the approval panel paints a member id where a name belongs')
          .not.toMatch(/user_[0-9a-f]{8,}/i);
      }
      await closeDrawer(page);
    }

    expect(found, 'a UUID is painted on a Procurement screen. Names, never ids — and the ' +
      'ratchet cannot catch this one, because it is static and positional and cannot see an ' +
      `id the server formatted into a string:\n     ${found.join('\n     ')}`).toEqual([]);

    console.log(`\n  06.11 — ${TABS.length} Procurement screens and one record drawer scanned, ` +
      'no UUID painted\n');
    assertNoUncaught(con);
  });
});
