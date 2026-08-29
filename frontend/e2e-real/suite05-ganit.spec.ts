/**
 * Proposal 93 · Stage 3 · WAVE 3 · SUITE 05 — Ganit (Finance / books), on
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
 * `signInAs()` now calls `assertOrg()` itself (measured 2026-08-29, the guard
 * sits at the end of the token branch), and `signIn()` below re-asserts AFTER
 * pinning the active-org key — because that key is written after the door
 * opens, and it is the key that decides which org `X-Org-Id` names.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 1 — EVERY ROW HERE IS TYPED BY A USER
 * ═══════════════════════════════════════════════════════════════════════════
 * Every product, vendor, expense, invoice, payment, bill, statement import,
 * reconciliation, schedule, contract, service line, rate card, usage row and
 * challan below is made by opening the screen, filling the real inputs,
 * choosing from the real pickers, uploading the real file and pressing the real
 * button. No SQL. No `page.request.post/put/patch/delete`.
 *
 * `page.request.get` IS used — `apiRows()` / `apiOne()` — and that is the
 * ratchet's own carve-out: asserting the row appeared IS the required evidence.
 * Both send **`X-Org-Id`** (`frontend/src/lib/api.js:39`), because a read
 * helper that omits it makes the server fall back to the caller's OLDEST
 * membership and answer for a different organisation than the screen beside it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 2 — STOP AND REPORT. NO VERDICT.
 * ═══════════════════════════════════════════════════════════════════════════
 * Where a control §4 requires does not exist, or a fence that must hold does
 * not hold, the test FAILS and prints what it looked for and what the live wire
 * returned. Nothing is skipped and no assertion is softened. 93 §14 reserves
 * the product-bug-versus-test-bug judgement to the owner. SEVEN fail on a run
 * against staging as it stands on 2026-08-29, and every one of them is written
 * as a failure on purpose:
 *
 *   05.05  Ganit expenses have **no approval state and no attachment control**.
 *          `staging.ganit_expenses` carries no status column, `routers/ganit.py`
 *          offers no approve or reject route for it (that pair exists only on
 *          `manav_expense_claims`, `routers/manav.py:4232` and `:4279`), and
 *          `ExpensesTab.jsx` renders no file input at all — `receipt_urls` is a
 *          field on `ExpenseCreate` with no box in front of it, the same shape
 *          as the vendor-address defect. §4's "with attachment; 6 rejected" has
 *          no door in this module.
 *   05.08  15 invoice emails. `GET /api/health` reports `outbound_mode=live`
 *          with `suppressed_orgs_digest="0"` — NOTHING is shielded — and all 53
 *          Unicode contacts carry `@example.com` addresses (RFC 2606,
 *          unroutable). Sending would be ~15 hard bounces at the verified
 *          sender domain: an incident, not a test failure. The fence assertion
 *          fails first, which is exactly what `_helpers.ts` says it is for:
 *          "a FAILURE, never a skip".
 *   05.15  The 9 signers. `send-for-signature` emails each of them, same fence,
 *          same reason. The five contracts are still created and asserted.
 *   05.13  §4 asks for **24 statement lines reconciled to invoices** plus **6
 *          left unmatched** = 30 lines. The three committed fixtures import
 *          **24 lines in total** — 10 credits and 14 debits (measured by
 *          `fixtures/verify-bank-fixtures.mjs`, which runs the product's own
 *          parser). A credit is the only line that can reconcile to a customer
 *          receipt — `choose_bank_match` picks the ledger by SIGN — so **10**
 *          is an arithmetic ceiling, not a choice. This suite reconciles all 10
 *          credits to invoice receipts and 8 debits to vendor payments and
 *          leaves exactly 6 unmatched; the test asserts what it achieved and
 *          then FAILS on §4's 24 with the count and the reason.
 *   05.16c `POST /v1/ganit/billing/rate-cards` answers **422** to every rate
 *          card created without a note. `RateCardsTab.save()` sends
 *          `notes: form.notes || null` and `RateCardCreate.notes` is `str = ""`
 *          — not `str | None` (`routers/client_billing.py:239`) — while its
 *          sibling `RateCardUpdate.notes` IS `str | None` (`:249`). So a blank
 *          note is refused on create and accepted on edit, and the screen
 *          reports it as "Failed to save" naming no field. The note is
 *          deliberately NOT typed to get past it: leaving one blank is the
 *          ordinary case for a price list, and filling it in would turn a
 *          shipped blocker into a green test.
 *   05.17  Both TDS challans are REFUSED with 422 `document_incomplete`,
 *          blocking on TAN · Deduction detail · Amount deposited. Unicode Group
 *          has no TAN, and `validate_tds_challan` treats a missing one as
 *          BLOCKING (s.203A — the PAN is not a substitute on ITNS-281), while
 *          the standing product rule is that GSTIN, PAN and TAN are
 *          non-mandatory and must block nothing. Both readings are defensible —
 *          one is about CAPTURE, the other about EMISSION — and this suite does
 *          not choose. The other two blockers say there is no TDS to deposit
 *          for the period at all, this org running no payroll.
 *   05.19  The §4 volume sheet, which is exact on nineteen of twenty lines and
 *          reports **rate cards 0 / 3**. That is 05.16c's 422 seen from the
 *          other end, and it is deliberately not excused: a volume sheet that
 *          quietly drops the line it cannot meet is the silent cap §10 warns
 *          about.
 *
 * ── SPLIT SO THAT ONE FAILURE CANNOT HIDE THE REST ──────────────────────────
 * 05.05 and 05.16a–e are separate tests rather than sections of a longer one,
 * because a test that aborts hides everything after it: the first version of
 * the billing test died on the rate-card 422 and took metered usage and SLA
 * credits with it, reporting two §4 lines as untested when they had simply
 * never been reached.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE STATUTORY HALF — where green can be wrong
 * ═══════════════════════════════════════════════════════════════════════════
 * GST splits on the STATE PAIR. Unicode Group is Gujarat, GST state code 24 —
 * and that is READ from the live org profile here, never typed as a constant,
 * because a suite that hardcodes the supplier's state cannot notice when the
 * supplier's state changes underneath it. Supply into Gujarat is CGST + SGST;
 * supply into any other state is IGST. `expectedSplit()` derives it from the
 * pair and every money assertion asks that function.
 *
 * ⚠ TWO THINGS ABOUT THE LIVE DATA THAT WOULD MAKE A DERIVED ASSERTION WRONG,
 *   measured 2026-08-29 and reported rather than worked around:
 *
 *   · Unicode Group's OWN `gstin` is **empty**. `InvoiceForm`'s derivation
 *     needs both GSTINs, so `derived.igst` comes back null and the form cannot
 *     work the split out. That is not a blocker — GSTIN is non-mandatory by
 *     owner rule and must block nothing, and 05.06 proves it does not — but it
 *     is why this suite sets the place of supply EXPLICITLY, through the
 *     product's own select, on every single invoice.
 *   · Suite 04's clients and contacts carry GSTINs whose state prefix
 *     contradicts their address. `S04 Client 23 Bengaluru` is addressed in
 *     Karnataka and its GSTIN begins `24` (Gujarat); every S04 CONTACT's GSTIN
 *     begins `27` (Maharashtra) whatever company they belong to. s.12(2)(a)
 *     IGST Act puts the place of supply at the recipient's registered address,
 *     which is what the prefix encodes — so the form's derived note disagrees
 *     with the address on most of the register. It is a fixture fact, not a
 *     product fault, and it is why nothing here trusts the derived note.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 — RE-RUNNABLE, AND PROVED BY RUNNING IT TWICE
 * ═══════════════════════════════════════════════════════════════════════════
 * Every record carries a DETERMINISTIC mark built from `TAG`, so a second
 * execution recognises its own output and verifies instead of duplicating:
 * `ensure()` reads the live list first and types only what is missing.
 * Invoices are marked in `customer_ref` ("Their ref" — a real Rule 46
 * particular and a real column on the register), bills in `bill_number`,
 * statement lines by the bank's own date-and-description pair. `RUN` — a
 * per-run stamp — appears only where a value must differ run to run to prove
 * THIS run's write landed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §10 — THE 22 SCREENS, NAMED, BECAUSE A SILENT CAP READS AS FULL COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════
 * `GanitPage.jsx` declares TWENTY-ONE tabs. 05.01 opens every one of them and
 * prints which branch it took; 05.20 reads the painted text of every one again
 * once the module is full. The 22nd screen and beyond are the record and form
 * surfaces, each driven by the test named beside it:
 *
 *   the 21 tabs                   05.01 (opened) · 05.20 (read back)
 *   InvoiceForm  (create)         05.06 — 45 invoices, both the final and the
 *                                        draft door, the Rule 46 banner, the
 *                                        product picker and the optional fold
 *   InvoiceDetail (record drawer) 05.07 · 05.08 · 05.09 — PDF, email
 *                                        affordance, receipts, the draft guard
 *   VendorForm                    05.03 — from the PAYABLES screen, on purpose
 *   PayablesTab's bill form       05.10
 *   VendorBillDetail (drawer)     05.11 — release payment
 *   BankTab's import form         05.12 — file, preview, column map, submit
 *   BankTab's match panel         05.13 — 18 reconciliations, both ledgers
 *   RecurringTab's form           05.14
 *   ContractsTab's form           05.15
 *   ContractDetail (drawer)       05.15 — the record, not the signature sheet
 *   SignatureDetail (drawer)      05.15 — signers typed, send fenced
 *   five billing Modals           05.16a–e
 *   StatsTab's challan panel      05.17
 *   ProductsTab's form            05.02
 *   ExpensesTab's two forms       05.04 (expense + category) · 05.05
 *
 * That is 21 tabs plus fifteen record and form surfaces. Nothing is capped, and
 * where a surface is NOT driven it is said: `ESignTab`'s cancel-signature path
 * and `SLACreditsTab`'s Apply sheet are untouched — the first needs an
 * outstanding request, which the fence prevents, and the second asks the user
 * to type a bill UUID by hand with no picker in front of it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TRAPS THIS FILE IS WRITTEN AROUND
 * ═══════════════════════════════════════════════════════════════════════════
 * · `page.reload()` on the line after Save races the write. Everything goes
 *   through `saveAndWait()`, which returns the SERVER's status. A toast is the
 *   client's opinion.
 * · `fill('')` does not register with a controlled React input — clearing is
 *   select-all-then-type (`typeInto`).
 * · ⚠ **`GanitPage` does NOT read its tab from the URL.** Unlike `GrahaPage`
 *   it keeps the open tab in local state and says so in its own comment
 *   ("no URL param, no route state"), so `/ganit?tab=bank` navigates nowhere.
 *   `openTab()` clicks the real strip button and falls through to the More
 *   popover when `ModuleTabs` has pushed that tab into the tail — which of the
 *   21 are inline is MEASURED at runtime from the strip's own client width, so
 *   it is not knowable from the source and must not be assumed.
 * · `.or()` chains resolve in DOM order and match the sidebar. Every locator
 *   below is scoped to the tab panel, the form, or the drawer.
 * · A vacuous assertion passes for ever — 02.3 looped over
 *   `input[type=checkbox]` where the product renders `<button role="switch">`.
 *   EVERY loop below asserts its count BEFORE it iterates.
 * · `getByRole(…, {name})` matches the ACCESSIBLE name. The pickers here are
 *   `<button aria-haspopup="listbox" aria-label="Customer">` with no visible
 *   text of their own, so they are found by `aria-label` and never by label.
 * · Record-shaped labels are not controls: a product may legitimately be called
 *   anything, so control detection is scoped to `.gn-bar`, `.gn-form__acts` or
 *   the drawer's own action row and can never match a row of data.
 * · No user, member or org UUID is ever rendered or asserted. 05.20 scans the
 *   PAINTED TEXT of every Ganit screen for one, because
 *   `check-rendered-ids.mjs` is static and positional and cannot see an id the
 *   server pre-formatted into a string.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave3.config.ts --project ganit
 */
import { test, expect, Page, Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { lane, signInAs as laneSignIn, assertOrg, ORG as ORG_IDS } from './_lanes';
import { setDate } from './_helpers';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANK_DIR = path.join(HERE, 'fixtures', 'bank');
const DL = path.join(os.tmpdir(), 'kartavya-e2e-wave3', 'ganit-downloads');
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
const TAG = 'S05';
/** A per-run stamp, for the handful of values that must differ run to run. */
const RUN = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

const pad = (n: number) => String(n).padStart(2, '0');
const money = (n: number) => Math.round(Number(n) * 100) / 100;

// ── §4 VOLUMES, stated once ─────────────────────────────────────────────────
const N_PRODUCTS = 18;
const N_COSTED_PRODUCTS = 12;
const N_VENDORS = 14;
const N_INVOICES = 45;
const N_FINAL = 32;
const N_DRAFT = 13;              // 32 + 13 = 45
const N_COST_INVOICES = 12;      // lines taken from a costed catalogue entry
const N_SALESPERSON = 12;
const N_PDF = 20;
const N_EMAIL = 15;
const N_PAYMENTS = 32;           // 12 partial-then-completed (24) + 8 single (8)
const N_PARTIAL = 12;
const N_SINGLE_PAY = 8;
const N_EXPENSES = 28;
const N_CATEGORIES = 8;
const N_EXPENSES_REJECTED = 6;
const N_BILLS = 14;
const N_VENDOR_PAYMENTS = 10;
const N_BANK_FILES = 3;
const N_RECONCILED_TARGET = 24;  // §4 — see 05.13; the fixtures hold 10 credits
const N_UNMATCHED_TARGET = 6;
const N_RECURRING = 4;
const N_CYCLES = 2;
const N_CONTRACTS = 5;
const N_SIGNERS = 9;
const N_SERVICE_LINES = 6;
const N_PROFILES = 4;
const N_RATE_CARDS = 3;
const N_USAGE = 12;
const N_SLA = 3;
const N_CHALLANS = 2;

/**
 * The ten CREDIT amounts the three committed statements carry, in file order.
 *
 * Recorded from `node frontend/e2e-real/fixtures/verify-bank-fixtures.mjs`,
 * which runs the PRODUCT'S OWN parser (`src/lib/bankCsv.js`) over the files and
 * prints every line it derives — so these are measured, not predicted. They are
 * the amounts a customer receipt must equal EXACTLY for the reconciliation
 * screen to offer it first: `rank_bank_candidates` sorts on the paise gap and
 * tags an exact hit, and `choose_bank_match` refuses to guess between two.
 */
const BANK_CREDITS = [
  118000, 236000, 88500,                 // hdfc-current-aug2026.csv
  412500, 35000, 590000, 4318,           // sbi-current-aug2026.csv
  247500, 318600, 455000,                // icici-current-aug2026.csv
];

/**
 * Eight DEBIT amounts, likewise measured, that vendor payments are sized to.
 *
 * SIX debits are deliberately left alone so the statement finishes with exactly
 * six unmatched lines, which is §4's own number. The six omitted are 4,720 ·
 * 177 · 2,500 · 9,840 · 7,670 · 52,300 — office supplies paid by UPI, bank
 * charges, professional tax, a courier bill, broadband, and a TDS remittance:
 * money that leaves the account against no vendor bill at all, which is exactly
 * why a real reconciliation ends with lines still open.
 */
const BANK_DEBITS = [185000, 32450, 14160, 268400, 196740, 88920, 163000, 31480];

/** Every Ganit tab, in the order `GanitPage.jsx` declares them. §10: 22 screens. */
const TABS: { id: string; label: string }[] = [
  { id: 'invoices', label: 'invoices' },
  { id: 'clients', label: 'clients' },
  { id: 'contacts', label: 'contacts' },
  { id: 'products', label: 'products' },
  { id: 'expenses', label: 'expenses' },
  { id: 'payables', label: 'payables' },
  { id: 'contracts', label: 'contracts' },
  { id: 'e-sign', label: 'e sign' },
  { id: 'collections', label: 'collections' },
  { id: 'billing-profiles', label: 'billing profiles' },
  { id: 'service-lines', label: 'service lines' },
  { id: 'metered-usage', label: 'metered usage' },
  { id: 'rate-cards', label: 'rate cards' },
  { id: 'sla-credits', label: 'sla credits' },
  { id: 'ageing', label: 'ageing' },
  { id: 'recurring', label: 'recurring' },
  { id: 'bank', label: 'bank' },
  { id: 'timesheet', label: 'timesheet' },
  { id: 'stats', label: 'GST filing' },
  { id: 'analytics', label: 'analytics' },
  { id: 'settings', label: 'settings' },
];

// ── the record marks §6 finds its own output by ─────────────────────────────
const productName = (n: number) => `${TAG} Product ${pad(n)}`;
const vendorName = (n: number) => `${TAG} Vendor ${pad(n)}`;
const categoryName = (n: number) => `${TAG} Category ${pad(n)}`;
const expenseTitle = (n: number) => `${TAG} Expense ${pad(n)}`;
/** "Their ref" — a real Rule 46 particular AND this suite's invoice key. */
const invoiceRef = (n: number) => `${TAG}-INV-${pad(n)}`;
const billNumber = (n: number) => `${TAG}-BILL-${pad(n)}`;
const contractTitle = (n: number) => `${TAG} Contract ${pad(n)}`;
/**
 * A recurring schedule's §6 mark is its SUBTOTAL, and that is a finding.
 *
 * Every other record here is marked by a name this suite types. A recurring
 * schedule cannot be: `RecurringCreate` carries `notes` and `terms`
 * (`routers/ganit.py:303-304`), `BLANK` in `RecurringTab.jsx:17` carries
 * `notes: ''`, the list endpoint SELECTS `r.notes, r.terms` — and the form
 * renders no box for either. Two more columns that are API-writable and
 * unenterable by a human, the same shape as the vendor address before 8.0 and
 * the expense receipt in 05.05.
 *
 * A first draft typed into a Notes field it had guessed was there, guarded by
 * `if (await count())` — which is the vacuous branch this programme keeps
 * finding: zero iterations, always green, and the mark silently never written.
 * So the mark is a value the form CAN carry: four amounts, distinct from each
 * other and from anything else on this org's books.
 */
const recurringAmount = (n: number) => 9000 + n * 1100;
const recurringMark = (n: number) => String(recurringAmount(n));
const serviceLineDesc = (n: number) => `${TAG} Service line ${pad(n)}`;
const rateCardCategory = (n: number) => `${TAG} Rate ${pad(n)}`;
const usageMetric = (n: number) => `${TAG} Usage ${pad(n)}`;
const slaMetric = (n: number) => `${TAG} SLA ${pad(n)}`;

/**
 * The place of supply each invoice is raised into.
 *
 * Alternating, so BOTH halves of the split are exercised across the register
 * and neither is a special case: odd numbers stay in the supplier's own state
 * (CGST + SGST), even numbers go to one of four others (IGST). The EXPECTATION
 * is never read from this list — it is derived from the pair by
 * `expectedSplit()`, which is the whole point.
 */
const OUT_OF_STATE = ['Maharashtra', 'Karnataka', 'Tamil Nadu', 'Delhi'];
const placeOfSupplyFor = (n: number, home: string) =>
  (n % 2 === 1 ? home : OUT_OF_STATE[(n >> 1) % OUT_OF_STATE.length]);

/**
 * The eighteen catalogue entries. Twelve carry a cost price; six do not, and a
 * blank cost is NULL rather than zero — "not recorded", which is what the
 * margin column must render as a dash. A figure that is unknown must look
 * unknown.
 *
 * GST rates come from the slabs the Council actually levies since 22 Sep 2025
 * (`ProductsTab.jsx` GST_RATES = [0, 5, 18, 40]). 12% and 28% are abolished and
 * are deliberately never used here: a product born carrying one is the exact
 * defect the "Dead Slabs" check exists to find, and seeding two of them would
 * be manufacturing the finding.
 */
const CATALOGUE = Array.from({ length: N_PRODUCTS }, (_, i) => {
  const n = i + 1;
  const isService = n > 12;
  return {
    n,
    name: productName(n),
    isService,
    // Goods take an HSN, services take a SAC. The form offers both boxes and
    // the invoice line reads whichever is filled.
    hsn: isService ? '' : String(84713010 + n),
    sac: isService ? String(998311 + n) : '',
    unit: isService ? 'HRS' : 'NOS',
    price: 1000 * n + 500,
    // Twelve costed, six not. The costed twelve are what stamps `cost_price`
    // onto an invoice line: `InvoiceForm` never sends a cost and never shows
    // one — the SERVER looks it up from `product_id` (migration 184).
    cost: n <= N_COSTED_PRODUCTS ? 600 * n + 100 : null,
    gst: [18, 5, 18, 0, 18, 40][i % 6],
  };
});

/**
 * The GST state codes, as the product itself carries them
 * (`frontend/src/lib/validators.js` GST_STATES). Copied rather than imported
 * because a spec importing application source drags Vite's module graph into
 * the Playwright runtime; the values are statutory and do not drift, and 05.06
 * asserts the supplier's code against the LIVE profile so a divergence between
 * this table and the product's would surface there rather than pass silently.
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
 * A GSTIN that is actually VALID, built rather than invented.
 *
 * The first attempt at this suite typed plausible-looking numbers and every
 * vendor save came back `400 GSTIN check digit does not match — the number is
 * mistyped`. That refusal is correct: the shape regex alone accepts any fifteen
 * characters in the right arrangement, so a transposed pair — the commonest
 * typing error in a code this long — would sail through, and the GSTN checksum
 * is what catches it. `validators.js::gstinChecksum` and the server's own
 * validator both compute it, so a fixture that ignores it is testing nothing
 * except the error path.
 *
 * The algorithm is the published GSTN one, reproduced here so the fixture is
 * self-contained: weight alternating 1 and 2 over base-36 values, sum the
 * quotient and remainder of each product, and the check character is the
 * complement of the total modulo 36.
 *
 * ⚠ Every number this builds is SYNTHETIC. The PAN block is `AAACV*****`
 * against invented serials for companies that do not exist; nothing here is a
 * real registration.
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

/**
 * THE STATUTORY RULE, in one function, derived from the PAIR.
 *
 * s.7 and s.8 of the IGST Act: a supply where the supplier's location and the
 * place of supply are in the same State or Union Territory is INTRA-state and
 * bears CGST + SGST in equal halves; anything else is INTER-state and bears
 * IGST at the full rate. Nothing here hardcodes "Gujarat" or a rupee figure —
 * `home` is read from the live org profile and the answer follows from the two
 * codes. A money assertion that names its own expected number is a money
 * assertion that cannot be wrong, and that is the failure this avoids.
 */
function expectedSplit(homeState: string, placeOfSupply: string): 'CGST+SGST' | 'IGST' {
  const a = GST_STATE_CODE[homeState];
  const b = GST_STATE_CODE[placeOfSupply];
  expect(a, `the supplier's state "${homeState}" is not a GST state — the split cannot be derived`).toBeTruthy();
  expect(b, `the place of supply "${placeOfSupply}" is not a GST state — the split cannot be derived`).toBeTruthy();
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

/** One object from an endpoint that answers a record rather than a list. */
async function apiOne(page: Page, pathAndQuery: string): Promise<any> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  const body = await res.json();
  return body?.data ?? body;
}

/**
 * Every invoice this suite has ever made, keyed by its "Their ref" mark.
 *
 * ⚠ THE REGISTER DOES NOT RETURN `doc_status` OR `salesperson_id`.
 * `GET /v1/ganit/invoices` selects sixteen columns and neither is among them
 * (`routers/ganit.py`, `list_invoices`), so a caller reading the LIST cannot
 * tell a draft from an issued invoice, nor see who is credited with the sale.
 * The screen has the same gap: `InvoicesTab`'s Status column renders
 * `payment_status`, and a draft's payment status is `unpaid` — identical to an
 * issued invoice nobody has paid yet. `InvoiceDetail` shows `doc_status`,
 * so the fact exists one click away and not on the register.
 *
 * That is reported, not worked around by pretending the list is enough: this
 * asks the RECORD for the two fields, per invoice, which is what a person
 * would have to do as well. `opts.deep` is false where the list's own columns
 * suffice, so the extra reads are paid for only when they are needed.
 */
async function myInvoices(page: Page, opts: { deep?: boolean } = {}): Promise<Map<string, any>> {
  const rows = await apiRows(page, '/api/v1/ganit/invoices');
  const out = new Map<string, any>();
  for (const r of rows) {
    const ref = String(r?.customer_ref || '').trim();
    if (ref.startsWith(`${TAG}-INV-`)) out.set(ref, r);
  }
  if (opts.deep) {
    for (const [ref, r] of out) {
      const d = await apiOne(page, `/api/v1/ganit/invoices/${r.id}`);
      out.set(ref, { ...r, ...(d?.invoice || {}), _payments: d?.payments || [] });
    }
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
 * Every API response the page got back that was NOT 2xx, whatever the verb.
 *
 * A console error reading "Failed to load resource: the server responded with a
 * status of 422" names neither the request nor the reason, and a report that
 * repeats it is a report the reader cannot act on. This records the method, the
 * path, the query and the body — so a failure says WHICH call broke and what
 * the server said about it, which is the difference between a finding and a
 * complaint.
 */
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
 * `console.error` is reported and asserted only on the read-only sweeps (05.01
 * and 05.18), because a single noisy log on one of forty-five form submissions
 * would otherwise mask the data finding underneath it — and the data finding is
 * what this wave is for. Both are printed either way, so nothing is hidden.
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
const panel = (page: Page, tab: string) => page.locator(`#mt-panel-${tab}`);

/**
 * Open one Ganit tab by clicking it, inline or out of the More popover.
 *
 * ⚠ NOT by URL. `GanitPage` keeps the open tab in local state and reads it from
 * "nowhere deeper" — no `?tab=`, no route state — so a `goto('/ganit?tab=bank')`
 * silently lands on whatever the user's starred default is and every assertion
 * afterwards is about the wrong screen. Graha's suite can address tabs by URL;
 * this one cannot, and that difference is a product fact worth stating rather
 * than a helper worth copying.
 *
 * `ModuleTabs` measures how many tabs FIT and pushes the rest behind
 * "More +N", so which of the twenty-one is inline depends on the viewport at
 * run time. Inline first, popover second, and a failure that names the tab if
 * it is in neither — an unreachable tab is a product finding, not a selector
 * problem.
 */
async function openTab(page: Page, id: string, label: string) {
  if (!/\/ganit/.test(new URL(page.url()).pathname)) {
    await page.goto('/ganit');
  }
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
      'it is unreachable, which is a product finding and not a selector problem')
      .toBeVisible();
    await row.first().click();
  }

  await expect(
    panel(page, id),
    `the Finance "${id}" panel never rendered after its tab was clicked`,
  ).toBeVisible({ timeout: 60_000 });
  await settle(page);
  return panel(page, id);
}

/** Land on Finance from scratch, whatever tab the account's prefs open on. */
async function gotoGanit(page: Page) {
  await page.goto('/ganit');
  await expect(page.locator('.mt__wrap')).toBeVisible({ timeout: 60_000 });
  await settle(page);
}

/**
 * Press a control that writes, and WAIT FOR THE SERVER before going on.
 *
 * This is the fix for three of Suite 02's four failures on 2026-08-28: each
 * clicked Save and called `page.reload()` on the very next line, the reload tore
 * the page down with the request still in flight, the value read back empty, and
 * the suite reported "the product did not save it" about a product that had.
 *
 * Returns the response so a caller asserts on the STATUS.
 */
async function saveAndWait(
  page: Page,
  act: () => Promise<void>,
  urlRe: RegExp,
  what: string,
  methods: string[] = ['POST', 'PUT', 'PATCH'],
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
 * reports "no clients to pick" against an org holding twenty-five — a false
 * product finding, which is worse than a flake. Polls, matches on the option
 * TEXT, then selects by the option's `value`: option text carries the trailing
 * whitespace of a JSX fragment and an exact-label match misses it. The value is
 * an id and is never rendered or asserted.
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
 * is `.pk__pop` holding `[role="listbox"]` of `[role="option"]` buttons
 * (`Picker.jsx:190, 268, 326`). `ServerPicker` fetches for whatever is typed
 * into the popup's own search box and merges the answer into its items, so this
 * TYPES rather than scrolling: `GET /v1/graha/contacts` is `LIMIT 200` and this
 * org has 53, but the invoice form narrows the list to the chosen company and a
 * suite that only reads page one would miss half of them the day it does not.
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
      await page.waitForTimeout(500);
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

/** The set of marks already on a list, for `ensure()`. */
const marksOf = (rows: any[], key = 'name') =>
  new Set(rows.map((r) => String(r?.[key] ?? '').trim()).filter(Boolean));

/**
 * Assert a download HAPPENS and produces bytes, and hand them back.
 *
 * A 200 with an empty body is the failure this checks for, and it is a real
 * one: the invoice PDF route answers a blob, `documents.js` hands it to an
 * anchor and revokes the object URL in a `finally`, so a download that never
 * started leaves a silent zero-byte file rather than an error.
 */
async function downloadBytes(page: Page, trigger: () => Promise<void>, name: string) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), trigger()]);
  const dest = path.join(DL, name);
  await dl.saveAs(dest);
  const buf = fs.readFileSync(dest);
  expect(buf.length, `${name} downloaded as an empty file — the route answered but the body was blank`)
    .toBeGreaterThan(400);
  return buf;
}

/** A PDF is a PDF, checked at the magic number rather than at the extension. */
function assertPdf(buf: Buffer, what: string) {
  expect(buf.subarray(0, 5).toString('latin1'), `${what} is not a PDF — it begins ` +
    `${JSON.stringify(buf.subarray(0, 16).toString('latin1'))}`).toBe('%PDF-');
  expect(buf.subarray(-1024).toString('latin1'), `${what} has no EOF marker — it is truncated`)
    .toContain('%%EOF');
}

/**
 * THE OUTBOUND FENCE, and why it is asked a question with sixteen answers.
 *
 * `GET /api/health` publishes `suppressed_orgs_digest`: sha256 of the
 * comma-joined SORTED lowercase org ids on `OUTBOUND_SUPPRESSED_ORGS`, first 16
 * hex characters, or the literal "0" for the empty set. A digest and never the
 * ids, because the endpoint is public and an org id obeys the names-not-ids
 * rule as much as a user id.
 *
 * `_helpers.assertOutboundFenceFor` hashes ONE org and compares — which is
 * right when exactly one org is shielded and WRONG the moment two are, because
 * the digest is a function of the whole set. So this hashes every subset of the
 * four known orgs that CONTAINS the lane's, and passes if any of them matches:
 * that is a proof of membership rather than a proof of the exact list, which is
 * the question that actually matters before a send.
 *
 * Returns the health body so the caller can print what the deployed process
 * actually reported. Throws nothing — the CALLER decides whether an unshielded
 * org is a failure, because for a suite that sends it is, and for one that only
 * counts rows it is not.
 */
async function outboundFence(page: Page) {
  const res = await page.request.get(`${API}/api/health`);
  expect(res.status(), `GET /api/health → ${res.status()} — the fence cannot be verified, ` +
    'so nothing that sends may run').toBe(200);
  const meta = await res.json();
  const mode = String(meta.outbound_mode ?? '');
  const digest = String(meta.suppressed_orgs_digest ?? '');

  const all = [ORG_IDS.UNICODE, ORG_IDS.E2E, ORG_IDS.UK, ORG_IDS.AEKAM].map((o) => o.toLowerCase());
  let shielded = false;
  for (let mask = 1; mask < (1 << all.length); mask++) {
    const set = all.filter((_, i) => mask & (1 << i));
    if (!set.includes(LANE.orgId.toLowerCase())) continue;
    const d = createHash('sha256').update([...set].sort().join(',')).digest('hex').slice(0, 16);
    if (d === digest) { shielded = true; break; }
  }
  return { mode, digest, shielded: mode === 'dry' || shielded, meta };
}

/**
 * Open one invoice's record drawer BY ITS DOCUMENT NUMBER, through the
 * product's own search.
 *
 * ⚠ NOT by clicking a row on page one. `useTableView` pages at 25 and
 * `list_invoices` orders `created_at DESC`, so with forty-five invoices the
 * first one raised is on page two and a naive click finds nothing. The toolbar
 * search filters every loaded row and is also the path a person takes.
 *
 * An invoice NUMBER is a business document reference, not an id — it is printed
 * on the document the customer holds — so asserting on it breaks no rule. No
 * UUID is typed, matched or rendered anywhere here.
 */
async function openInvoice(page: Page, p: Locator, invoiceNumber: string): Promise<Locator> {
  const search = p.locator('input.tv__input');
  await expect(search, 'the invoice register has no search box, so a document cannot be found')
    .toBeVisible({ timeout: 30_000 });
  await typeInto(search, invoiceNumber);
  const link = p.getByRole('button', { name: invoiceNumber, exact: true });
  await expect(link, `${invoiceNumber} is on the wire and not on the register`)
    .toBeVisible({ timeout: 30_000 });
  await link.click();
  const drawer = page.getByRole('dialog', { name: `Invoice ${invoiceNumber}` });
  await expect(drawer, `the record drawer for ${invoiceNumber} did not open`)
    .toBeVisible({ timeout: 30_000 });
  return drawer;
}

/**
 * Close a record drawer and wait for it to finish animating out.
 *
 * ⚠ `getByRole('button', { name: 'Close' })` inside this drawer matches TWO
 * controls and is a strict-mode violation: the header's `×`, whose accessible
 * name is the `aria-label` "Close", and the payment section's own toggle, whose
 * VISIBLE text is "Close" while the payment form is open. They are different
 * controls that happen to share a name — the header's shuts the record, the
 * other one shuts a form inside it — so the drawer's is addressed by its class
 * as well. This is the accessible-name trap in miniature, and guessing wrong
 * here reads as "the drawer would not close" rather than as two matches.
 */
async function closeDrawer(page: Page, drawer: Locator) {
  /* ⚠ AND A TOAST CAN SIT ON TOP OF IT. Measured: after the draft-payment
     refusal in 05.09, `.tst--err` renders over the drawer header and
     intercepts the pointer, so the `×` is visible, enabled and unclickable
     until the toast expires. Escape is the product's own second way out
     (`InvoiceDetail` listens for it on window), so the fallback is a real
     affordance rather than a workaround — but a toast covering the close
     control of the panel it is reporting on is worth saying out loud. */
  const close = drawer.locator('button.dr__ico[aria-label="Close"]');
  const clicked = (await close.count())
    ? await close.first().click({ timeout: 5_000 }).then(() => true).catch(() => false)
    : false;
  if (!clicked) await page.keyboard.press('Escape');
  await expect(drawer, 'the drawer did not close — the next click would land on its scrim')
    .toBeHidden({ timeout: 20_000 });
}

// ════════════════════════════════════════════════════════════════════════════
// THE SUITE
// ════════════════════════════════════════════════════════════════════════════

test.describe('Suite 05 — Ganit (Finance, books) · Unicode Group', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 05.01 · every screen is reachable, and every list says in words what it is
  // ──────────────────────────────────────────────────────────────────────────
  test('05.01 all 21 Finance tabs open, and each list states its state in words', async ({ page }) => {
    const con = watchConsole(page);
    const fail = watchFailures(page);
    await signIn(page);
    await gotoGanit(page);

    /**
     * ⚠ THIS TEST HAS TWO BRANCHES AND NEITHER IS A SKIP.
     *
     * §6 says the suite must be re-runnable, and an empty-state assertion is
     * true exactly once. So each screen is checked against the LIVE count first
     * and then asserted for the state it is genuinely in: the empty state's own
     * words when there are no rows, the populated surface when there are. Both
     * are specific and both can fail. The branch taken is printed, because "the
     * empty state was proved" is only ever a claim about the run that found
     * zero — and on the very first execution against this org, Ganit held
     * nothing at all, which is the run that proves them.
     */
    const screens: {
      id: string; label: string; endpoint?: string;
      empty: RegExp; populated: (p: Locator) => Locator;
    }[] = [
      { id: 'invoices', label: 'invoices', endpoint: '/api/v1/ganit/invoices', empty: /No invoices yet/i, populated: (p) => p.locator('table.tbl tbody tr') },
      { id: 'clients', label: 'clients', endpoint: '/api/v1/graha/clients', empty: /No clients yet/i, populated: (p) => p.locator('table.tbl tbody tr') },
      { id: 'contacts', label: 'contacts', endpoint: '/api/v1/graha/contacts', empty: /No contacts yet/i, populated: (p) => p.locator('table.tbl tbody tr') },
      { id: 'products', label: 'products', endpoint: '/api/v1/products', empty: /No products yet/i, populated: (p) => p.locator('table.tbl tbody tr') },
      { id: 'expenses', label: 'expenses', endpoint: '/api/v1/ganit/expenses', empty: /No expenses recorded/i, populated: (p) => p.locator('table.tbl tbody tr') },
      { id: 'payables', label: 'payables', endpoint: '/api/v1/ganit/vendor-bills', empty: /No vendor bills yet/i, populated: (p) => p.locator('.gn-list .gn-row') },
      { id: 'contracts', label: 'contracts', endpoint: '/api/v1/ganit/contracts', empty: /No contracts yet/i, populated: (p) => p.locator('.gn-list .gn-row') },
      { id: 'e-sign', label: 'e sign', endpoint: '/api/v1/ganit/contracts', empty: /No contracts to sign/i, populated: (p) => p.locator('.gn-list .gn-row') },
      { id: 'billing-profiles', label: 'billing profiles', endpoint: '/api/v1/ganit/billing/profiles', empty: /No billing profiles/i, populated: (p) => p.locator('table tbody tr') },
      { id: 'service-lines', label: 'service lines', endpoint: '/api/v1/ganit/billing/service-lines', empty: /No service lines/i, populated: (p) => p.locator('table tbody tr') },
      { id: 'metered-usage', label: 'metered usage', endpoint: '/api/v1/ganit/billing/metered-usage', empty: /No usage entries/i, populated: (p) => p.locator('table tbody tr') },
      { id: 'rate-cards', label: 'rate cards', endpoint: '/api/v1/ganit/billing/rate-cards', empty: /No vendor rate cards/i, populated: (p) => p.locator('table tbody tr') },
      { id: 'sla-credits', label: 'sla credits', endpoint: '/api/v1/ganit/billing/sla-credits', empty: /No SLA credits/i, populated: (p) => p.locator('table tbody tr') },
      { id: 'recurring', label: 'recurring', endpoint: '/api/v1/ganit/recurring', empty: /No recurring invoices/i, populated: (p) => p.locator('.gn-list .gn-row') },
      { id: 'bank', label: 'bank', endpoint: '/api/v1/ganit/bank-statements', empty: /No bank statements imported/i, populated: (p) => p.locator('table.tbl tbody tr') },
    ];

    const took: string[] = [];
    for (const s of screens) {
      con.at(s.id);
      const p = await openTab(page, s.id, s.label);
      const live = s.endpoint ? (await apiRows(page, s.endpoint)).length : -1;
      if (live === 0) {
        await expect(
          p.locator('.empty__title'),
          `${s.id} holds no rows and its empty state does not say so in words`,
        ).toHaveText(s.empty, { timeout: 30_000 });
        took.push(`${s.id}: EMPTY STATE proved (0 rows)`);
      } else {
        await expect
          .poll(async () => await s.populated(p).count(), {
            message: `${s.id} has ${live} rows on the wire and paints none of them`,
            timeout: 30_000,
          })
          .toBeGreaterThan(0);
        took.push(`${s.id}: populated (${live} rows)`);
      }
    }

    /* The six remaining tabs carry no list of their own — ageing, collections,
       the GST filing screen, analytics, the timesheet-to-invoice form and the
       document-number settings. They are asserted for REACHABILITY here (the
       21st screen is the point of §10's count) and for content in 05.18, once
       there is content for them to have. */
    for (const id of ['ageing', 'collections', 'timesheet', 'stats', 'analytics', 'settings']) {
      con.at(id);
      const label = TABS.find((t) => t.id === id)!.label;
      const p = await openTab(page, id, label);
      await expect(p, `the Finance "${id}" screen is unreachable`).toBeVisible();
      // Settle BEFORE moving on, or a request still in flight is attributed to
      // whichever screen the loop reached next — the first run of this test
      // reported the GST filing screen's GSTR-1 preview under "analytics".
      await settle(page);
      took.push(`${id}: reached`);
    }

    console.log(`\n  05.01 — 21 Finance screens:\n     ${took.join('\n     ')}\n`);
    expect(took, 'not every declared Finance tab was visited').toHaveLength(TABS.length);

    /**
     * WHAT COUNTS AS A CONSOLE FAILURE HERE, AND WHY IT IS NOT "ANY RED LINE".
     *
     * Chromium logs "Failed to load resource: the server responded with a
     * status of 4xx" for EVERY 4xx, including one the product raises on purpose
     * and renders as a sentence. On this org the GST filing screen's GSTR-1
     * preview answers 422 `supplier_gstin_missing` — Unicode Group has no GSTIN
     * on its profile, and a return is reported under one registration, so there
     * is genuinely nothing to attribute the supplies to. Failing the whole
     * sweep on that would be failing on correct behaviour, which is the mirror
     * image of a vacuous assertion: an assertion that can never pass.
     *
     * So the gate is: NO uncaught exception, and NO 5xx. Every 4xx is printed
     * by method, path and body, so a deliberate refusal and a broken call are
     * told apart by a reader rather than by this file — 93 §14.
     */
    const fourxx = fail.filter((l) => /\s4\d\d\s/.test(l));
    const fivexx = fail.filter((l) => /\s5\d\d\s/.test(l));
    if (fourxx.length) {
      console.log(`  05.01 — refusals the Finance screens received (reported, not ruled on):` +
        `${dumpFailures(fourxx)}\n`);
    }
    expect(fivexx, `a Finance screen received a SERVER error:${dumpFailures(fivexx)}` +
      `\n   console:${dumpConsole(con)}`).toHaveLength(0);
    assertNoUncaught(con);
    const notResource = con.errors.filter((e) => !/Failed to load resource/i.test(e.text));
    expect(notResource, 'console errors on the Finance screens that are not a browser resource ' +
      `notice for a request the product handled:${dumpConsole(con)}` +
      `\n   the non-2xx responses behind them:${dumpFailures(fail)}`).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.02 · the catalogue — 18 products and services, 12 of them costed
  // ──────────────────────────────────────────────────────────────────────────
  test('05.02 eighteen catalogue entries are typed, twelve carrying a cost price', async ({ page }) => {
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);
    con.at('products');
    const p = await openTab(page, 'products', 'products');

    const before = marksOf(await apiRows(page, '/api/v1/products'));

    async function createProduct(n: number) {
      const c = CATALOGUE[n - 1];
      const bar = p.locator('.gn-bar');
      const open = bar.getByRole('button', { name: /Add product or service/ });
      if (await open.count()) {
        await open.click();
      } else {
        // The very first entry is created from the empty state's own button,
        // which is the affordance a firm with no catalogue actually meets.
        await p.locator('.empty__act').getByRole('button', { name: /Add product or service/ }).click();
      }
      const form = p.locator('form.gn-form').first();
      await expect(form, 'the new-product form did not open').toBeVisible();

      await typeInto(form.locator('label.fld', { hasText: 'Name' }).locator('input.inp'), c.name);
      await setCheckbox(form.locator('label.gn-chk', { hasText: 'This is a service' }).locator('input[type=checkbox]'), c.isService);
      if (c.hsn) await typeInto(form.locator('label.fld', { hasText: 'HSN code' }).locator('input.inp'), c.hsn);
      if (c.sac) await typeInto(form.locator('label.fld', { hasText: 'SAC code' }).locator('input.inp'), c.sac);
      await typeInto(form.locator('label.fld', { hasText: 'Unit' }).locator('input.inp'), c.unit);
      await typeInto(form.locator('label.fld', { hasText: 'Sale price' }).locator('input.inp'), String(c.price));
      // A blank cost is left blank. It becomes NULL, not zero — zero would say
      // "this costs us nothing" and render every one of the six as pure profit.
      if (c.cost != null) {
        await typeInto(form.locator('label.fld', { hasText: 'Cost price' }).locator('input.inp'), String(c.cost));
      }
      await form.locator('label.fld', { hasText: 'GST rate' }).locator('select.inp')
        .selectOption(String(c.gst));
      await typeInto(form.locator('label.fld', { hasText: 'Description' }).locator('input.inp'),
        `${c.isService ? 'Service' : 'Goods'} · seeded ${RUN}`);

      await saveAndWait(page, async () => {
        await form.locator('button[type=submit]').click();
      }, /\/v1\/products$/, `creating ${c.name}`);
      await settle(page);
    }

    const made = await ensure(
      CATALOGUE.map((c) => c.n), before, productName, createProduct,
    );

    // ── the read-back, which is the evidence ────────────────────────────────
    const rows = await apiRows(page, '/api/v1/products');
    const mine = rows.filter((r) => String(r.name || '').startsWith(`${TAG} Product `));
    expect(mine.length, `wanted ${N_PRODUCTS} catalogue entries, the register holds ${mine.length}` +
      `${dumpWire(wire)}`).toBe(N_PRODUCTS);

    const costed = mine.filter((r) => r.cost_price != null);
    expect(costed.length, `${N_COSTED_PRODUCTS} entries must carry a cost price and ` +
      `${costed.length} do — a blank cost must store NULL, never 0`).toBe(N_COSTED_PRODUCTS);
    const uncosted = mine.filter((r) => r.cost_price == null);
    expect(uncosted.length, 'the six entries with no cost must read as "not recorded"')
      .toBe(N_PRODUCTS - N_COSTED_PRODUCTS);

    // Margin is generated by the database (migration 137). A costed row must
    // have one and an uncosted row must not — that is what makes the dash in
    // the Margin column mean "unknown" rather than "zero".
    for (const r of costed) {
      expect(r.margin, `${r.name} carries a cost of ${r.cost_price} and no margin`).not.toBeNull();
    }
    for (const r of uncosted) {
      expect(r.margin, `${r.name} has no cost and must therefore have no margin`).toBeNull();
    }

    // No abolished slab may have been born here.
    const dead = mine.filter((r) => [12, 28].includes(Number(r.gst_rate)));
    expect(dead.map((r) => r.name), 'a catalogue entry was created carrying a GST slab ' +
      'withdrawn on 22 Sep 2025').toHaveLength(0);

    // And the screen shows them. The name is a BUTTON because it opens the
    // editor; asserting it is a button is asserting the record is reachable.
    await openTab(page, 'products', 'products');
    const search = p.locator('input.tv__input');
    await search.fill(productName(1));
    await expect(p.getByRole('button', { name: productName(1), exact: true }),
      'the catalogue does not show the entry that was just typed').toBeVisible({ timeout: 20_000 });

    console.log(`\n  05.02 — catalogue: ${made.typed} typed, ${made.found} already present ` +
      `(§6 idempotence), ${mine.length} on the register, ${costed.length} costed\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.03 · fourteen vendors, with all six MSME/TDS fields and the address
  // ──────────────────────────────────────────────────────────────────────────
  test('05.03 fourteen vendors carry all six MSME/TDS fields and a full address', async ({ page }) => {
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);
    con.at('payables');
    const p = await openTab(page, 'payables', 'payables');

    /* Created from GANIT — Payables → "+ Vendor" — and not from Kray, because
       that is the surface owner decision 0.20 was about: this screen used to
       carry a stripped four-field copy of the form, so every supplier recorded
       here was born with all six MSME/TDS columns NULL while the identical
       action in Kray captured them. Both tabs render `components/VendorForm`
       now, and proving it on THIS one is the regression that matters. */
    const before = marksOf(await apiRows(page, '/api/v1/ganit/vendors'));

    const CLASSES = ['micro', 'small', 'medium'];
    const KINDS = ['manufacturer', 'service', 'trader'];
    const SECTIONS = ['194C', '194J', '194Q', '194H'];

    async function createVendor(n: number) {
      await p.locator('.gn-bar').getByRole('button', { name: /^\+ Vendor$/ }).click();
      const form = p.locator('form.gn-form').filter({ hasText: 'New vendor' }).first();
      await expect(form, 'the vendor form did not open on the payables screen').toBeVisible();

      const field = (label: string) => form.locator('label.gn-form__field', { hasText: label }).first();

      await typeInto(field('Name').locator('input.inp'), vendorName(n));
      // GSTIN stays deliberately BLANK on four of them. It is non-mandatory by
      // owner rule and must block nothing — 05.03 proves the save goes through
      // without it rather than asserting the rule from a comment.
      if (n % 4 !== 0) {
        await typeInto(field('GSTIN').locator('input.inp'),
          // 12 characters: a five-letter PAN prefix, four digits, the PAN's
          // final letter, the entity digit, and the fixed 'Z'.
          gstin(GST_STATE_CODE.Gujarat, `AAACV${pad(n)}00A1Z`));
      }
      await typeInto(field('Email').locator('input.inp'), `s05.vendor${pad(n)}@example.com`);
      await typeInto(field('Phone').locator('input.inp'), `9812${String(340000 + n)}`);

      // ── the address block, the half that had no boxes until 8.0 ──────────
      await typeInto(field('Address line 1').locator('input.inp'), `${n} Udyog Estate`);
      await typeInto(field('Address line 2').locator('input.inp'), `Block ${String.fromCharCode(64 + (n % 26 || 1))}`);
      await typeInto(field('City').locator('input.inp'), n % 2 ? 'Surat' : 'Ahmedabad');
      await typeInto(field('State').locator('input.inp'), 'Gujarat');
      await typeInto(field('Pincode').locator('input.inp'), n % 2 ? '395002' : '380015');
      await typeInto(field('Country').locator('input.inp'), 'India');

      // ── the six compliance columns, every one of them ────────────────────
      await field('MSME registered').locator('select.inp').selectOption(n % 3 === 0 ? 'no' : 'yes');
      await field('Enterprise class').locator('select.inp').selectOption(CLASSES[n % 3]);
      await field('Vendor kind').locator('select.inp').selectOption(KINDS[(n + 1) % 3]);
      await typeInto(field('Udyam number').locator('input.inp'), `UDYAM-GJ-03-00${pad(n)}123`);
      await typeInto(field('TDS section').locator('input.inp'), SECTIONS[n % 4]);
      await typeInto(field('Payment terms').locator('input.inp'), String([0, 15, 30, 45, 60][n % 5]));

      await saveAndWait(page, async () => {
        await form.getByRole('button', { name: /^Save vendor$/ }).click();
      }, /\/v1\/ganit\/vendors$/, `creating ${vendorName(n)}`);
      await settle(page);
    }

    const made = await ensure(
      Array.from({ length: N_VENDORS }, (_, i) => i + 1), before, vendorName, createVendor,
    );

    const rows = await apiRows(page, '/api/v1/ganit/vendors');
    const mine = rows.filter((r) => String(r.name || '').startsWith(`${TAG} Vendor `));
    expect(mine.length, `wanted ${N_VENDORS} vendors, the master list holds ${mine.length}` +
      `${dumpWire(wire)}`).toBe(N_VENDORS);

    // ── THE ASSERTION THE FORKED FORM WOULD HAVE FAILED ─────────────────────
    // Six columns, on every one of the fourteen. `is_msme` is a TRI-STATE, so
    // `null` (nobody has said) is checked apart from `false` (they said no) —
    // the 43B(h) skill counts those two differently and a truthiness test here
    // would call them the same.
    const SIX = ['is_msme', 'enterprise_class', 'vendor_kind', 'udyam_number',
      'tds_section', 'payment_terms_days'];
    for (const v of mine) {
      for (const col of SIX) {
        expect(v[col], `${v.name} was created from the PAYABLES screen and its ` +
          `${col} is "nobody has said" — that is the forked-form defect owner ` +
          'decision 0.20 closed, come back').not.toBeNull();
        expect(v[col], `${v.name}.${col} is missing entirely from the read-back`).toBeDefined();
      }
      expect([true, false], `${v.name}.is_msme must be a real yes or no, not ${v.is_msme}`)
        .toContain(v.is_msme);
      expect(['micro', 'small', 'medium'], `${v.name}.enterprise_class is ${v.enterprise_class}`)
        .toContain(v.enterprise_class);
      // 0 days is a real answer (paid on delivery) and must survive as 0.
      expect(typeof v.payment_terms_days, `${v.name}.payment_terms_days is not a number`)
        .toBe('number');

      const addr = typeof v.address === 'string' ? JSON.parse(v.address) : (v.address || {});
      for (const k of ['line1', 'line2', 'city', 'state', 'pincode', 'country']) {
        expect(String(addr[k] || '').trim(), `${v.name} has no ${k} — the address block was ` +
          'API-writable and unenterable by a human until 8.0, and this is the check that it is not again')
          .not.toBe('');
      }
    }

    // GSTIN blocks nothing: the four vendors deliberately created without one
    // exist, and that is the product rule proved rather than restated.
    const noGstin = mine.filter((v) => !String(v.gstin || '').trim());
    expect(noGstin.length, 'a vendor could not be recorded without a GSTIN — GSTIN, PAN and ' +
      'TAN are non-mandatory by owner rule and must block nothing').toBeGreaterThan(0);

    // And the master list PAINTS the address, which is the other half of 8.0.
    await openTab(page, 'payables', 'payables');
    console.log(`\n  05.03 — vendors: ${made.typed} typed, ${made.found} already present, ` +
      `${mine.length} on the master list, all six compliance columns filled, ` +
      `${noGstin.length} deliberately without a GSTIN\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.04 · eight categories and twenty-eight expenses, with contact + vendor
  // ──────────────────────────────────────────────────────────────────────────
  test('05.04 eight expense categories and twenty-eight expenses, each naming a client and a vendor', async ({ page }) => {
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);
    con.at('expenses');
    const p = await openTab(page, 'expenses', 'expenses');

    /* ⚠ A GET ON `/v1/ganit/expense-categories` CREATES ROWS.
       `list_expense_categories` seeds ten defaults when the org has none
       (`routers/ganit.py:1894`), so this org's category list is never empty
       once anyone has looked at it — including from a read-only probe. §4's
       eight are therefore eight ON TOP of the ten the product seeds, and the
       count below says which are this suite's rather than asserting a total
       that the act of measuring would change. */
    const catsBefore = await apiRows(page, '/api/v1/ganit/expense-categories');
    const seeded = catsBefore.filter((c) => !String(c.name || '').startsWith(`${TAG} `));

    async function createCategory(n: number) {
      await p.locator('.gn-bar').getByRole('button', { name: /^\+ Category$/ }).click();
      const form = p.locator('form.gn-form').filter({ hasText: 'New category' }).first();
      await expect(form, 'the new-category form did not open').toBeVisible();
      await typeInto(form.locator('label.fld', { hasText: 'Name' }).locator('input.inp'), categoryName(n));
      await typeInto(form.locator('label.fld', { hasText: 'Icon' }).locator('input.inp'), '🧾');
      await saveAndWait(page, async () => {
        await form.getByRole('button', { name: /^Create$/ }).click();
      }, /\/v1\/ganit\/expense-categories$/, `creating ${categoryName(n)}`);
      await settle(page);
    }

    const cats = await ensure(
      Array.from({ length: N_CATEGORIES }, (_, i) => i + 1),
      marksOf(catsBefore), categoryName, createCategory,
    );

    // Contacts are Wave 2's; this suite creates none and re-uses what is there,
    // which is what §4 means by "use the ones that exist".
    const contacts = await apiRows(page, '/api/v1/graha/contacts');
    expect(contacts.length, 'there are no contacts to attribute an expense to — Wave 2 left 53')
      .toBeGreaterThan(0);

    const before = marksOf(await apiRows(page, '/api/v1/ganit/expenses'), 'title');

    async function createExpense(n: number) {
      await p.locator('.gn-bar').getByRole('button', { name: /^\+ Add expense$/ }).click();
      const form = p.locator('form.gn-form').filter({ hasText: 'Record an expense' }).first();
      await expect(form, 'the expense form did not open').toBeVisible();

      const fld = (label: string) => form.locator('label.fld', { hasText: label }).first();

      await typeInto(fld('Title').locator('input.inp'), expenseTitle(n));
      // Matched on the option's visible TEXT and selected by its `value`, not
      // by `{ label }`: the option renders `{c.icon} {c.name}`, so an exact
      // label match has to reproduce the emoji and the spacing around it, and
      // the categories arrive from a fetch that may not have landed yet.
      await pickByLabel(fld('Category').locator('select.inp'),
        categoryName(((n - 1) % N_CATEGORIES) + 1), 'category');
      // Dates go through `ui/DateInput` — there is no native date input in this
      // product and Playwright cannot fill the clipped shadow one.
      await setDate(form, /^Date/, `2026-08-${pad(((n - 1) % 27) + 1)}`);
      await typeInto(fld('Amount').locator('input.inp'), String(1200 + n * 137));
      await typeInto(fld('Tax').locator('input.inp'), String(Math.round((1200 + n * 137) * 0.18)));
      // A free-text supplier name — this column is `ganit_expenses.vendor`, a
      // string, and is NOT the `ganit_vendors` master list. Naming it after one
      // of this suite's real vendors keeps the two readable side by side
      // without claiming a foreign key the schema does not have.
      await typeInto(fld('Vendor').locator('input.inp'), vendorName(((n - 1) % N_VENDORS) + 1));
      await typeInto(fld('Reference').locator('input.inp'), `${TAG}/EXP/${pad(n)}/${RUN.slice(-4)}`);

      // The client contact — `ganit_expenses.contact_id`. 0 of 378 expenses
      // carried one before the key was added to `BLANK`, so this is the
      // assertion that the object literal still has it.
      const contact = contacts[(n - 1) % contacts.length];
      await pickInPicker(page, form, 'Client contact', 'client contact', String(contact.name));
      await setCheckbox(form.locator('label.gn-chk', { hasText: 'Billable to a customer' })
        .locator('input[type=checkbox]'), n % 3 === 0);

      await saveAndWait(page, async () => {
        await form.getByRole('button', { name: /^Record$/ }).click();
      }, /\/v1\/ganit\/expenses$/, `recording ${expenseTitle(n)}`);
      await settle(page);
    }

    const made = await ensure(
      Array.from({ length: N_EXPENSES }, (_, i) => i + 1), before, expenseTitle, createExpense,
    );

    const rows = await apiRows(page, '/api/v1/ganit/expenses');
    const mine = rows.filter((r) => String(r.title || '').startsWith(`${TAG} Expense `));
    expect(mine.length, `wanted ${N_EXPENSES} expenses, the books hold ${mine.length}` +
      `${dumpWire(wire)}`).toBe(N_EXPENSES);

    const withContact = mine.filter((r) => r.contact_id);
    expect(withContact.length, 'every expense must name the client it was spent for — ' +
      '`contact_id` was absent from the form object literal once and 0 of 378 rows carried it')
      .toBe(N_EXPENSES);
    const withVendor = mine.filter((r) => String(r.vendor || '').trim());
    expect(withVendor.length, 'every expense must name who was paid').toBe(N_EXPENSES);

    const myCats = (await apiRows(page, '/api/v1/ganit/expense-categories'))
      .filter((c) => String(c.name || '').startsWith(`${TAG} Category `));
    expect(myCats.length, `wanted ${N_CATEGORIES} categories of this suite's own`).toBe(N_CATEGORIES);
    const used = new Set(mine.map((r) => String(r.category)));
    expect(used.size, 'the twenty-eight expenses must be spread across all eight categories')
      .toBe(N_CATEGORIES);

    console.log(`\n  05.04 — categories: ${cats.typed} typed, ${cats.found} already present ` +
      `(the product itself seeds ${seeded.length} defaults on the first GET); ` +
      `expenses: ${made.typed} typed, ${made.found} already present, ${mine.length} on the books, ` +
      `all naming a client and a vendor\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.05 · §4's "with attachment; 6 rejected" — THE DOOR DOES NOT EXIST
  // ──────────────────────────────────────────────────────────────────────────
  test('05.05 an expense can be given an attachment and can be rejected', async ({ page }) => {
    const con = watchConsole(page);
    await signIn(page);
    con.at('expenses');
    const p = await openTab(page, 'expenses', 'expenses');

    /**
     * ⚠ THIS TEST IS EXPECTED TO FAIL AND IT IS NOT SOFTENED.
     *
     * §4 asks for twenty-eight expenses "with contact, vendor, attachment;
     * 6 rejected". The first two are proved in 05.04. The other two have no
     * door in this module, and the evidence is on three levels:
     *
     *   SCHEMA   `staging.ganit_expenses` carries no status, state or approval
     *            column at all. `list_expenses` selects id, title, category,
     *            amount, tax_amount, total, expense_date, vendor, reference,
     *            notes, receipt_urls, is_billable, contact_id, project_id and
     *            the audit stamps — and nothing else.
     *   ROUTES   `routers/ganit.py` exposes exactly five expense endpoints:
     *            GET/POST /expenses, PATCH and DELETE /expenses/{id}, and
     *            GET/POST /expense-categories plus GET /expense-stats. There is
     *            no approve and no reject. The approve/reject pair that DOES
     *            exist belongs to a different table in a different module —
     *            `PATCH /v1/manav/expense-claims/{id}/approve` and `/reject`
     *            (`routers/manav.py:4232`, `:4279`) — and those write
     *            `manav_expense_claims.status`, which no Ganit screen reads.
     *   SCREEN   `ExpensesTab.jsx` renders nine fields and no file input.
     *            `receipt_urls` is a field on `ExpenseCreate` with no box in
     *            front of it — API-writable, already on the model, unenterable
     *            by a human. It is the same shape as the vendor-address defect
     *            8.0 closed, one column smaller.
     *
     * Rule 2: this suite does NOT rule on whether §4 is aimed at the wrong
     * module or the module is missing a feature. It states what it looked for,
     * where, and what was there instead. 93 §14 keeps the verdict.
     */
    await p.locator('.gn-bar').getByRole('button', { name: /^\+ Add expense$/ }).click();
    const form = p.locator('form.gn-form').filter({ hasText: 'Record an expense' }).first();
    await expect(form).toBeVisible();

    const fileInputs = await form.locator('input[type=file]').count();
    const fieldLabels = (await form.locator('span.fld__l').allTextContents())
      .map((t) => t.trim()).filter(Boolean);

    // Control detection is scoped to the FORM and to real controls, so an
    // expense a user happened to call "Receipt" could never be mistaken for one.
    const attachControls = await form
      .getByRole('button', { name: /attach|upload|receipt|file/i }).count();

    await p.locator('.gn-bar').getByRole('button', { name: /^Close form$/ }).click();

    // The row's own action set, on a real expense. Edit and Delete and nothing
    // else — no Approve, no Reject, no status badge that could carry one.
    const rowActions = await p.locator('.gn-tbl__acts').first()
      .locator('button').allTextContents().catch(() => [] as string[]);

    console.log(
      `\n  05.05 — what the expense screen actually offers:` +
      `\n     form fields : ${fieldLabels.join(' · ')}` +
      `\n     file inputs : ${fileInputs}` +
      `\n     attach-ish controls: ${attachControls}` +
      `\n     row actions : ${rowActions.map((t) => t.trim()).filter(Boolean).join(' · ') || '(none)'}\n`,
    );

    expect(fileInputs + attachControls,
      'THE ATTACHMENT HAS NO DOOR. §4 asks for an expense "with attachment". ' +
      '`ExpensesTab.jsx` renders no `input[type=file]` and no upload control, ' +
      'while `ExpenseCreate.receipt_urls` exists on the API model — a column ' +
      'that is API-writable and unenterable by a human. Fields actually on the ' +
      `form: ${fieldLabels.join(' · ')}. No verdict offered: 93 §14.`,
    ).toBeGreaterThan(0);

    expect(rowActions.map((t) => t.trim().toLowerCase()),
      `THE REJECTION HAS NO DOOR. §4 asks for ${N_EXPENSES_REJECTED} rejected ` +
      'expenses. `staging.ganit_expenses` has no status column, `routers/ganit.py` ' +
      'exposes no approve or reject route for it, and the row offers only ' +
      `${rowActions.join('/')}. The approve/reject pair lives on ` +
      '`manav_expense_claims` in a different module. No verdict offered: 93 §14.',
    ).toContain('reject');

    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.06 · forty-five invoices — 32 final, 13 draft, both sides of the split
  // ──────────────────────────────────────────────────────────────────────────
  test('05.06 forty-five invoices are raised, and the GST split follows the state pair', async ({ page }) => {
    /* MEASURED, not guessed: 80 seconds per invoice against the deployed app —
       two pickers, two calendars, a state select, two or three line rows and a
       round trip, forty-five times. The config's 60-minute default is not
       enough for a cold run that has to type all of them, and a suite that
       times out at 40 leaves the register half-built and reports it as a
       product failure. A warm run finishes in minutes, because §6's `ensure()`
       finds its own marks and types nothing. */
    test.setTimeout(3 * 60 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    // ── THE SUPPLIER'S STATE, READ LIVE ────────────────────────────────────
    // Never a constant. `expectedSplit()` is only as good as the state it is
    // handed, and hardcoding "Gujarat" would make the whole statutory half of
    // this suite untestable the day the profile changes.
    const profile = await apiOne(page, '/api/v1/org/profile');
    const billing = typeof profile.billing_address === 'string'
      ? JSON.parse(profile.billing_address) : (profile.billing_address || {});
    const home = String(billing.state || '').trim();
    expect(home, 'the org profile carries no billing state, so no supply can be classified')
      .not.toBe('');
    expect(GST_STATE_CODE[home], `the supplier's state "${home}" has no GST state code`)
      .toBeTruthy();
    console.log(`\n  05.06 — supplier: ${profile.name} · ${home} (GST state code ` +
      `${GST_STATE_CODE[home]}) · own GSTIN ${profile.gstin ? 'set' : 'BLANK'}\n`);

    const contacts = await apiRows(page, '/api/v1/graha/contacts');
    expect(contacts.length, 'no contacts to invoice — Wave 2 left 53').toBeGreaterThan(0);
    const products = await apiRows(page, '/api/v1/ganit/products');
    const costed = products.filter((x) => String(x.name || '').startsWith(`${TAG} Product `)
      && x.cost_price != null);
    expect(costed.length, '05.02 must run first — there are no costed catalogue entries to ' +
      'take an invoice line from, so `cost_price` could never be stamped')
      .toBeGreaterThanOrEqual(N_COST_INVOICES);

    const members = await apiRows(page, '/api/v1/org/members');
    expect(members.length, 'no org members to credit a sale to').toBeGreaterThan(0);

    let p = await openTab(page, 'invoices', 'invoices');

    /** Reveal the place-of-supply controls, whichever way the form is showing. */
    async function supplyGrid(form: Locator) {
      const sel = form.locator('label.fld', { hasText: 'Place of supply' }).locator('select.inp');
      if (await sel.isVisible().catch(() => false)) return sel;
      // The design keeps the derivation out of sight behind a "Change". When a
      // customer GSTIN was readable the note is there instead of the fields.
      const change = form.locator('.gn-supply').getByRole('button', { name: /^Change$/ });
      await expect(change, 'neither the place-of-supply select nor the Change control that ' +
        'reveals it is on the invoice form').toBeVisible();
      await change.click();
      await expect(sel).toBeVisible();
      return sel;
    }

    async function openForm(): Promise<Locator> {
      const bar = p.locator('.gn-bar');
      const open = bar.getByRole('button', { name: /^\+ New invoice$/ });
      if (await open.count()) await open.click();
      else await p.locator('.empty__act').getByRole('button', { name: /New invoice/ }).click();
      const form = p.locator('form.gn-form').first();
      await expect(form, 'the create-invoice form did not open').toBeVisible();
      await expect(form.locator('.gn-form__t'), 'a different form opened').toHaveText(/Create invoice/);
      return form;
    }

    async function createInvoice(n: number) {
      const isFinal = n <= N_FINAL;
      const contact = contacts[(n - 1) % contacts.length];
      const pos = placeOfSupplyFor(n, home);
      const form = await openForm();

      await form.locator('label.fld', { hasText: 'Type' }).locator('select.inp')
        .selectOption('tax_invoice');

      // Pick the PERSON. The form adopts their company by itself
      // (`pickCustomer` fills a blank `client_id` from the contact's employer),
      // which is the behaviour that put invoices onto a company ledger at all —
      // `client_id` was never written by any invoice path before 2026-08-20.
      const chosen = await pickInPicker(page, form, 'Customer', 'customer', String(contact.name));
      expect(chosen, 'the customer picker chose somebody else').toContain(String(contact.name));
      const company = form.locator('button[aria-label="Company"]');
      await expect(company, 'picking the customer did not adopt their company — the invoice ' +
        'would be filed against no company at all').not.toHaveText(/Select company/, { timeout: 15_000 });

      // Twelve invoices are credited to a salesperson. Chosen POSITIONALLY and
      // never by name: two of this org's nine members share a display name, and
      // a suite that matched on it would be asserting about whichever row came
      // back first.
      if (n > N_FINAL - 20 && n <= N_FINAL - 20 + N_SALESPERSON) {
        await pickInPicker(page, form, 'Salesperson', 'salesperson');
      }

      await setDate(form, /Invoice date/, `2026-08-${pad(((n - 1) % 27) + 1)}`);
      await setDate(form, /Due date/, `2026-09-${pad(((n - 1) % 27) + 1)}`);
      await typeInto(
        form.locator('label.fld', { hasText: 'Customer reference' }).locator('input.inp'),
        invoiceRef(n),
      );

      const sel = await supplyGrid(form);
      const igstBox = form.locator('label.gn-chk', { hasText: 'Inter-state (IGST)' })
        .locator('input[type=checkbox]');

      if (isFinal) {
        // THE STATUTORY CHOICE, made explicitly and then asserted from the pair.
        await sel.selectOption({ label: `${pos} (${GST_STATE_CODE[pos]})` });
        await setCheckbox(igstBox, expectedSplit(home, pos) === 'IGST');
      } else {
        /* THE ONLY DOOR TO A DRAFT.
           `doc_status` defaults to 'final' and the ladder walks one way
           (draft → final → sent → viewed), so an invoice cannot be demoted. The
           single path to a draft in this product is the Rule 46 banner's
           "Save as draft instead", and the banner only appears when
           `localGaps()` finds something — a tax document with no recipient, or
           an inter-State supply with no place of supply. The second keeps the
           customer on the document, so that is the gap these thirteen carry:
           they are IGST invoices whose place of supply is deliberately blank,
           which is a genuinely incomplete document rather than a contrived one. */
        await sel.selectOption('');
        await setCheckbox(igstBox, true);
      }

      // ── the lines ─────────────────────────────────────────────────────────
      if (n <= N_COST_INVOICES) {
        // From the catalogue, which is what carries `product_id` — and
        // `product_id` is the only reason the server can stamp what the line
        // cost us. The form never sends a cost and never shows one.
        const pick = form.locator('select.gn-lines__picks');
        await expect(pick, 'the "From product" picker is absent, so no invoice line can ever ' +
          'carry a cost').toBeVisible();
        await pickByLabel(pick, productName(n), 'product');
        // A second, hand-typed line, so the invoice is not purely catalogue.
        await form.getByRole('button', { name: /^\+ Add line$/ }).click();
        const i = 1;
        const rate = n <= BANK_CREDITS.length ? BANK_CREDITS[n - 1] : 50000;
        await typeInto(form.locator(`input[aria-label="Line ${i + 1} description"]`), `${TAG} Retainer ${pad(n)}`);
        await typeInto(form.locator(`input[aria-label="Line ${i + 1} HSN or SAC code"]`), '998311');
        await typeInto(form.locator(`input[aria-label="Line ${i + 1} quantity"]`), '1');
        await typeInto(form.locator(`input[aria-label="Line ${i + 1} rate"]`), String(rate));
        await typeInto(form.locator(`input[aria-label="Line ${i + 1} GST percentage"]`), '18');
      } else {
        const lines = 1 + (n % 2);
        for (let i = 0; i < lines; i++) {
          if (i > 0) await form.getByRole('button', { name: /^\+ Add line$/ }).click();
          await typeInto(form.locator(`input[aria-label="Line ${i + 1} description"]`),
            `${TAG} Service ${pad(n)}-${i + 1}`);
          await typeInto(form.locator(`input[aria-label="Line ${i + 1} HSN or SAC code"]`),
            i === 0 ? '998312' : '998313');
          await typeInto(form.locator(`input[aria-label="Line ${i + 1} quantity"]`), String(i + 1));
          await typeInto(form.locator(`input[aria-label="Line ${i + 1} rate"]`), String(5000 + n * 210));
          await typeInto(form.locator(`input[aria-label="Line ${i + 1} GST percentage"]`), '18');
        }
      }

      // Notes and terms live behind the optional fold, and `terms` went out as
      // a hard-coded sentence on every invoice the UI ever made until it had a
      // box. Opening it on one in five proves the fold and the two fields.
      if (n % 5 === 0) {
        await form.getByRole('button', { name: /Optional — notes, terms, flat discount/ }).click();
        await typeInto(form.locator('label.fld', { hasText: 'Notes' }).locator('textarea.inp'),
          `${TAG} run ${RUN}`);
        await typeInto(form.locator('label.fld', { hasText: 'Terms' }).locator('textarea.inp'),
          'Payment due within 15 days of invoice date.');
      }

      if (isFinal) {
        await saveAndWait(page, async () => {
          await form.locator('button[type=submit]').click();
        }, /\/v1\/ganit\/invoices$/, `raising ${invoiceRef(n)}`);
      } else {
        // The submit does NOT reach the server: `localGaps()` returns early and
        // paints the banner. Waiting on a response here would time out on a
        // request that was never made, so the click and the wait are separated.
        await form.locator('button[type=submit]').click();
        const gaps = form.locator('.gn-gaps');
        await expect(gaps, 'the Rule 46 banner did not appear for an inter-State supply with ' +
          'no place of supply — Rule 46(n) makes it mandatory, and without the banner there ' +
          'is no way to save a draft at all').toBeVisible({ timeout: 20_000 });
        await expect(gaps, 'the banner does not name the rule it is enforcing')
          .toContainText(/46\(n\)/);
        await saveAndWait(page, async () => {
          await gaps.getByRole('button', { name: /Save as draft instead/ }).click();
        }, /\/v1\/ganit\/invoices$/, `saving ${invoiceRef(n)} as a draft`);
      }
      await settle(page);
    }

    const before = await myInvoices(page);
    const made = await ensure(
      Array.from({ length: N_INVOICES }, (_, i) => i + 1),
      new Set(before.keys()), invoiceRef, createInvoice,
    );

    // ── the read-back, which is the evidence ────────────────────────────────
    const mine = await myInvoices(page, { deep: true });
    expect(mine.size, `wanted ${N_INVOICES} invoices marked ${TAG}-INV-*, the register holds ` +
      `${mine.size}${dumpWire(wire)}`).toBe(N_INVOICES);

    const finals = [...mine.values()].filter((r) => r.doc_status !== 'draft');
    const drafts = [...mine.values()].filter((r) => r.doc_status === 'draft');
    expect(finals.length, `wanted ${N_FINAL} issued invoices`).toBe(N_FINAL);
    expect(drafts.length, `wanted ${N_DRAFT} drafts`).toBe(N_DRAFT);

    // ── THE STATUTORY ASSERTION ─────────────────────────────────────────────
    // Derived from the pair, invoice by invoice. Never a hardcoded rupee figure
    // and never a hardcoded head: the question asked of every issued document
    // is "given where this was supplied FROM and TO, which heads may be
    // non-zero", and the answer comes from `expectedSplit`.
    let intra = 0;
    let inter = 0;
    for (let n = 1; n <= N_FINAL; n++) {
      const inv = mine.get(invoiceRef(n));
      expect(inv, `${invoiceRef(n)} is not on the register`).toBeTruthy();
      const pos = String(inv.place_of_supply || '').trim();
      expect(pos, `${inv.invoice_number} (${invoiceRef(n)}) was issued with NO place of supply — ` +
        'Rule 46(n), and a GSTR-1 blocker').not.toBe('');

      const want = expectedSplit(home, pos);
      const cgst = Number(inv.cgst || 0);
      const sgst = Number(inv.sgst || 0);
      const igst = Number(inv.igst || 0);
      const taxable = Number(inv.subtotal || 0);
      const where = `${inv.invoice_number} · ${home} → ${pos} · taxable ${taxable} · ` +
        `cgst ${cgst} sgst ${sgst} igst ${igst}`;

      if (want === 'CGST+SGST') {
        expect(igst, `INTRA-state supply charged IGST. ${where}. Supplier and place of supply ` +
          `are both ${pos} (code ${GST_STATE_CODE[pos]}), so s.8 IGST Act makes this an ` +
          'intra-State supply bearing CGST and SGST.').toBe(0);
        expect(inv.is_igst, `${where} — the invoice is flagged inter-state but is not`).toBeFalsy();
        if (taxable > 0) {
          expect(cgst, `${where} — an intra-State supply with no CGST`).toBeGreaterThan(0);
          expect(money(cgst), `CGST and SGST must be equal halves of the same rate. ${where}`)
            .toBe(money(sgst));
        }
        intra++;
      } else {
        expect(cgst + sgst, `INTER-state supply charged CGST/SGST. ${where}. The supplier is in ` +
          `${home} (code ${GST_STATE_CODE[home]}) and the place of supply is ${pos} (code ` +
          `${GST_STATE_CODE[pos]}), so s.7 IGST Act makes this an inter-State supply bearing IGST.`)
          .toBe(0);
        expect(inv.is_igst, `${where} — an inter-State supply not flagged as one`).toBeTruthy();
        if (taxable > 0) {
          expect(igst, `${where} — an inter-State supply with no IGST`).toBeGreaterThan(0);
        }
        inter++;
      }

      // Every issued invoice adds up. `total` is the server's figure and the
      // form's own footer says so — "a preview; the server computes what it
      // stores" — so this is the check that the two agree.
      const sum = money(taxable + cgst + sgst + igst - Number(inv.discount || 0));
      expect(money(Number(inv.total)), `${inv.invoice_number} does not add up: taxable + tax − ` +
        `discount = ${sum}, stored total = ${inv.total}`).toBe(sum);
    }
    expect(intra, 'the register must exercise BOTH sides of the split — no intra-State invoice')
      .toBeGreaterThan(0);
    expect(inter, 'the register must exercise BOTH sides of the split — no inter-State invoice')
      .toBeGreaterThan(0);

    // ── cost price on twelve, from the catalogue, stamped by the server ─────
    let withCost = 0;
    for (let n = 1; n <= N_COST_INVOICES; n++) {
      const inv = mine.get(invoiceRef(n));
      const detail = await apiOne(page, `/api/v1/ganit/invoices/${inv.id}`);
      // `line_items` is jsonb and can come back as an object OR as a string —
      // `db.py:_json_encoder` documents the double-encode that produced rows of
      // the second kind, and `_shared.jsx::safeArray` exists on the client for
      // exactly this. A helper that only handles the object would read "no
      // lines" on a row that has them.
      const raw = detail?.invoice?.line_items ?? detail?.line_items;
      const items: any[] = Array.isArray(raw) ? raw
        : (typeof raw === 'string' ? (() => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } })() : []);
      expect(items.length, `${inv.invoice_number} carries no lines`).toBeGreaterThan(0);
      if (items.some((li) => li.cost_price != null && Number(li.cost_price) > 0)) withCost++;
    }
    expect(withCost, `${N_COST_INVOICES} invoices took a line from a COSTED catalogue entry, and ` +
      `${withCost} of them carry a cost on that line. \`product_id\` is what lets the server look ` +
      'the cost up (migration 184); without it gross profit, item margin and product margin have ' +
      'nothing to compute from.').toBe(N_COST_INVOICES);

    // ── salesperson on twelve ──────────────────────────────────────────────
    const attributed = [...mine.values()].filter((r) => r.salesperson_id);
    expect(attributed.length, `${N_SALESPERSON} invoices must credit a salesperson — ` +
      '`ganit_invoices.salesperson_id` feeds the leaderboard, per-person turnover and commission, ' +
      `and ${attributed.length} carry one`).toBe(N_SALESPERSON);

    // ── GSTIN blocks nothing ───────────────────────────────────────────────
    // The supplier's own GSTIN is blank on this org and thirty-two tax invoices
    // were nonetheless issued. That is the product rule proved, not restated.
    if (!String(profile.gstin || '').trim()) {
      expect(finals.length, 'the supplier has no GSTIN and could not issue an invoice — GSTIN is ' +
        'non-mandatory by owner rule and must block nothing').toBe(N_FINAL);
    }

    // ── and the register SHOWS them ────────────────────────────────────────
    p = await openTab(page, 'invoices', 'invoices');
    const first = mine.get(invoiceRef(1));
    /* Searched by the DOCUMENT NUMBER, not by "Their ref".
       `useTableView` is given `searchKeys: ['invoice_number','contact_name','status']`
       (`InvoicesTab.jsx`), so the toolbar search does NOT look in `customer_ref`
       — even though Their ref is one of the sixteen columns and is precisely
       the string a customer's accounts-payable team quotes when they ring up
       about an invoice. Reported; the register is otherwise correct. */
    await p.locator('input.tv__input').fill(String(first.invoice_number));
    await expect(p.getByRole('button', { name: String(first.invoice_number), exact: true }),
      'the ledger does not show an invoice that is on the wire').toBeVisible({ timeout: 20_000 });

    console.log(`\n  05.06 — invoices: ${made.typed} typed, ${made.found} already present; ` +
      `${finals.length} final · ${drafts.length} draft; ${intra} intra-State (CGST+SGST) · ` +
      `${inter} inter-State (IGST); ${withCost} carrying a stamped cost; ` +
      `${attributed.length} crediting a salesperson\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.07 · twenty invoice PDFs, downloaded and proved to be PDFs
  // ──────────────────────────────────────────────────────────────────────────
  test('05.07 twenty invoice PDFs download as real files', async ({ page }) => {
    test.setTimeout(60 * 60_000);
    const con = watchConsole(page);
    await signIn(page);
    const p = await openTab(page, 'invoices', 'invoices');

    const mine = await myInvoices(page, { deep: true });
    expect(mine.size, '05.06 must run first — there are no invoices to render').toBeGreaterThan(0);

    // Issued documents only. A draft has no number spent on it yet and the PDF
    // route is entitled to refuse one; asking for twenty drafts and calling the
    // refusals failures would be manufacturing a finding.
    const issued = [...mine.entries()]
      .filter(([, r]) => r.doc_status !== 'draft')
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(0, N_PDF);
    expect(issued.length, `wanted ${N_PDF} issued invoices to render`).toBe(N_PDF);

    const sizes: number[] = [];
    const digests = new Set<string>();
    for (const [ref, inv] of issued) {
      con.at(`pdf ${ref}`);
      const drawer = await openInvoice(page, p, String(inv.invoice_number));
      const btn = drawer.getByRole('button', { name: /^Download PDF$/ });
      await expect(btn, `no Download PDF control on ${inv.invoice_number}`).toBeVisible();
      const buf = await downloadBytes(page, () => btn.click(), `${ref}.pdf`);
      assertPdf(buf, `${inv.invoice_number} (${ref})`);
      // The document must be ABOUT this invoice. A route that answers the same
      // bytes for every id is a 200 that proves nothing, and comparing the
      // digests is what tells that apart from twenty real documents.
      digests.add(createHash('sha256').update(buf).digest('hex'));
      sizes.push(buf.length);
      await closeDrawer(page, drawer);
    }

    expect(digests.size, `${N_PDF} invoices rendered ${digests.size} distinct documents — ` +
      'identical bytes for different invoices would mean the route ignores which one was asked for')
      .toBe(N_PDF);
    console.log(`\n  05.07 — ${sizes.length} PDFs, ${Math.min(...sizes)}–${Math.max(...sizes)} bytes, ` +
      `${digests.size} distinct\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.08 · fifteen invoices emailed — THE FENCE IS DOWN
  // ──────────────────────────────────────────────────────────────────────────
  test('05.08 fifteen invoices are emailed to their customers', async ({ page }) => {
    const con = watchConsole(page);
    await signIn(page);
    const p = await openTab(page, 'invoices', 'invoices');

    const mine = await myInvoices(page, { deep: true });
    const issued = [...mine.entries()].filter(([, r]) => r.doc_status !== 'draft');
    expect(issued.length, '05.06 must run first').toBeGreaterThanOrEqual(N_EMAIL);

    // The affordance itself is checked WITHOUT sending: the button must exist
    // and must be enabled for a customer who has an address, because "the
    // control is missing" and "the control is fenced" are different findings
    // and only one of them is the product's.
    const first = issued[0][1];
    const drawer = await openInvoice(page, p, String(first.invoice_number));
    const emailBtn = drawer.getByRole('button', { name: /^Email invoice$/ });
    await expect(emailBtn, 'there is no "Email invoice" control on the invoice record')
      .toBeVisible();
    await expect(emailBtn, 'the Email control is disabled — the customer carries no address, ' +
      'so the send path cannot be reached at all').toBeEnabled();
    await closeDrawer(page, drawer);

    const fence = await outboundFence(page);
    const contacts = await apiRows(page, '/api/v1/graha/contacts');
    const example = contacts.filter((c) => /@example\.(com|org|net)$/i.test(String(c.email || '')));

    /**
     * ⚠ THIS TEST IS EXPECTED TO FAIL, AND FAILING IS THE SAFE OUTCOME.
     *
     * `_helpers.ts` states the standing rule for this exact state: a missing or
     * wrong digest is "a FAILURE, never a skip", because the state must never
     * be passed through silently. Measured 2026-08-29 the deployed staging
     * process reports `outbound_mode=live` and `suppressed_orgs_digest="0"` —
     * the literal for the EMPTY SET. Nothing is shielded.
     *
     * Unicode Group holds 53 contacts and every one of them carries an
     * `@example.com` address (RFC 2606, permanently unroutable). Fifteen sends
     * is fifteen hard bounces at the verified sender domain — an incident, not
     * a test failure, and the reason this suite refuses to press the button
     * rather than pressing it and reporting the bounces afterwards.
     *
     * The send is not attempted. Rule 2: no verdict is offered on whether the
     * remedy is the Railway variable, a different lane, or a dry-run mode.
     */
    expect(fence.shielded,
      `THE OUTBOUND FENCE IS DOWN — ${N_EMAIL} invoice emails NOT sent, deliberately.\n` +
      `     GET /api/health reports outbound_mode='${fence.mode}' and ` +
      `suppressed_orgs_digest='${fence.digest}'.\n` +
      `     '0' is the literal for the EMPTY SET: no organisation is suppressed, so a send ` +
      'from this lane leaves the building.\n' +
      `     ${example.length} of ${contacts.length} contacts in ${LANE.org} carry an ` +
      '@example.com address (RFC 2606, unroutable), so those sends would hard-bounce at the ' +
      'verified sender domain.\n' +
      '     The "Email invoice" control IS present and IS enabled — the affordance is not the ' +
      'problem. Nothing was sent. 93 §14 keeps the verdict.',
    ).toBeTruthy();

    // Only reachable once the fence holds. Left in place so the day it does,
    // the suite sends and counts rather than needing to be rewritten.
    let sent = 0;
    for (const [ref, inv] of issued.slice(0, N_EMAIL)) {
      con.at(`email ${ref}`);
      const d = await openInvoice(page, p, String(inv.invoice_number));
      await saveAndWait(page, async () => {
        await d.getByRole('button', { name: /^Email invoice$/ }).click();
      }, /\/v1\/ganit\/invoices\/[^/]+\/email$/, `emailing ${inv.invoice_number}`);
      await expect(page.locator('.tst__t').last(), 'the send reported no recipient')
        .toContainText(/Sent to/, { timeout: 20_000 });
      await closeDrawer(page, d);
      sent++;
    }
    expect(sent, `wanted ${N_EMAIL} sends`).toBe(N_EMAIL);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.09 · thirty-two receipts — twelve partial, then completed
  // ──────────────────────────────────────────────────────────────────────────
  test('05.09 thirty-two payments are recorded, twelve of them partial and then completed', async ({ page }) => {
    test.setTimeout(90 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);
    const p = await openTab(page, 'invoices', 'invoices');

    const mine = await myInvoices(page, { deep: true });
    expect(mine.size, '05.06 must run first').toBe(N_INVOICES);

    /**
     * The amounts are not arbitrary.
     *
     * The first ten PARTIAL receipts are sized to the ten credit lines the
     * committed bank statements carry, so 05.13 has something exact to
     * reconcile them against — `rank_bank_candidates` tags an exact amount and
     * sorts it first, and `choose_bank_match` refuses to guess between two of
     * the same size. Everything else follows from the balance the server
     * reports, never from arithmetic done here: an expected figure computed in
     * the test is a figure that cannot disagree with the product.
     */
    const partialAmount = (n: number) =>
      (n <= BANK_CREDITS.length ? BANK_CREDITS[n - 1] : 50000);

    /** Record one receipt through the drawer, and return what the server stored. */
    async function recordPayment(inv: any, amount: number, reference: string) {
      const drawer = await openInvoice(page, p, String(inv.invoice_number));
      const open = drawer.getByRole('button', { name: /^Record payment$/ });
      await expect(open, `${inv.invoice_number} offers no way to record a payment`).toBeVisible();
      await open.click();
      // The drawer remounts its sub-tabs on `showPay` so the form is the thing
      // the reader lands on; the form is inside the Payments tab either way.
      const form = drawer.locator('form.gn-form--accent');
      await expect(form, 'the payment form did not open').toBeVisible({ timeout: 20_000 });

      await typeInto(form.locator('label.fld', { hasText: 'Amount' }).locator('input.inp'),
        String(amount));
      await form.locator('label.fld', { hasText: 'Method' }).locator('select.inp')
        .selectOption('bank_transfer');
      await typeInto(form.locator('label.fld', { hasText: 'Reference' }).locator('input.inp'),
        reference);
      await typeInto(form.locator('label.fld', { hasText: 'Notes' }).locator('input.inp'),
        `${TAG} receipt · run ${RUN}`);

      await saveAndWait(page, async () => {
        await form.getByRole('button', { name: /^Record$/ }).click();
      }, /\/v1\/ganit\/invoices\/[^/]+\/payments$/, `receipt on ${inv.invoice_number}`);
      await settle(page);
      await closeDrawer(page, drawer);
      return await apiOne(page, `/api/v1/ganit/invoices/${inv.id}`);
    }

    const paymentsOn = async (id: string) => {
      const d = await apiOne(page, `/api/v1/ganit/invoices/${id}`);
      return (d?.payments || []) as any[];
    };

    let recorded = 0;
    let partials = 0;
    let completed = 0;

    // ── the twelve that are paid in two steps ──────────────────────────────
    for (let n = 1; n <= N_PARTIAL; n++) {
      const inv = mine.get(invoiceRef(n));
      expect(inv, `${invoiceRef(n)} is missing`).toBeTruthy();
      const already = await paymentsOn(inv.id);
      if (already.length >= 2) { recorded += 0; partials++; completed++; continue; }

      const want = partialAmount(n);
      expect(Number(inv.total), `${inv.invoice_number} totals ${inv.total}, which is not more ` +
        `than the ${want} this step is meant to pay in PART — the receipt would settle it and ` +
        'the two-step path would never be exercised').toBeGreaterThan(want);

      let detail = already.length === 1
        ? await apiOne(page, `/api/v1/ganit/invoices/${inv.id}`)
        : await recordPayment(inv, want, `${TAG}/RCPT/${pad(n)}/1`);
      if (already.length !== 1) recorded++;

      const midway = detail.invoice;
      expect(midway.payment_status, `${inv.invoice_number} took a receipt of ${want} against a ` +
        `total of ${inv.total} and reads "${midway.payment_status}" — a part payment is 'partial'`)
        .toBe('partial');
      expect(money(Number(midway.amount_paid)), 'the invoice did not absorb the receipt')
        .toBe(money(want));
      expect(Number(midway.balance_due), 'a part-paid invoice must still show a balance')
        .toBeGreaterThan(0);
      partials++;

      // …and then completed, for exactly what the SERVER says is left.
      const rest = money(Number(midway.total) - Number(midway.amount_paid));
      detail = await recordPayment(inv, rest, `${TAG}/RCPT/${pad(n)}/2`);
      recorded++;
      const settled = detail.invoice;
      expect(settled.payment_status, `${inv.invoice_number} was paid in full and reads ` +
        `"${settled.payment_status}"`).toBe('paid');
      expect(money(Number(settled.balance_due)), 'a settled invoice still shows a balance').toBe(0);
      completed++;
    }

    // ── the eight that are paid in one ─────────────────────────────────────
    for (let n = N_PARTIAL + 1; n <= N_PARTIAL + N_SINGLE_PAY; n++) {
      const inv = mine.get(invoiceRef(n));
      const already = await paymentsOn(inv.id);
      if (already.length >= 1) continue;
      const detail = await recordPayment(inv, money(Number(inv.total)), `${TAG}/RCPT/${pad(n)}/1`);
      recorded++;
      expect(detail.invoice.payment_status, `${inv.invoice_number} was paid in full`).toBe('paid');
    }

    // ── the count, from the ledger rather than from the loop ───────────────
    let total = 0;
    for (let n = 1; n <= N_PARTIAL + N_SINGLE_PAY; n++) {
      total += (await paymentsOn(mine.get(invoiceRef(n)).id)).length;
    }
    expect(total, `wanted ${N_PAYMENTS} receipts on the ledger (${N_PARTIAL} invoices paid in two ` +
      `steps plus ${N_SINGLE_PAY} paid in one), the ledger holds ${total}${dumpWire(wire)}`)
      .toBe(N_PAYMENTS);
    expect(partials, `${N_PARTIAL} invoices must have passed through 'partial'`).toBe(N_PARTIAL);
    expect(completed, `${N_PARTIAL} of them must have been completed`).toBe(N_PARTIAL);

    // A DRAFT CANNOT BE PAID, and the product says so rather than absorbing it.
    // Four such payments exist live across the two orgs, which is why the guard
    // is worth a test of its own: nobody has been asked for this money.
    const draft = [...mine.values()].find((r) => r.doc_status === 'draft');
    expect(draft, 'no draft to test the guard with').toBeTruthy();
    const draftDrawer = await openInvoice(page, p, String(draft.invoice_number));
    const payBtn = draftDrawer.getByRole('button', { name: /^Record payment$/ });
    if (await payBtn.count()) {
      await payBtn.click();
      const form = draftDrawer.locator('form.gn-form--accent');
      await expect(form).toBeVisible({ timeout: 20_000 });
      await typeInto(form.locator('label.fld', { hasText: 'Amount' }).locator('input.inp'), '100');
      const [res] = await Promise.all([
        page.waitForResponse((r) => /\/payments$/.test(r.url()) && r.request().method() === 'POST',
          { timeout: 45_000 }),
        form.getByRole('button', { name: /^Record$/ }).click(),
      ]);
      expect(res.status(), 'a receipt was accepted against a DRAFT invoice. Nobody has been asked ' +
        'for this money, so it can be reconciled to nothing the customer ever saw, and the ' +
        'document reads settled while still unsent.').toBe(400);
      expect(await res.text(), 'the refusal does not say why').toMatch(/draft/i);
    }
    await closeDrawer(page, draftDrawer);

    console.log(`\n  05.09 — receipts: ${recorded} recorded this run, ${total} on the ledger; ` +
      `${partials} invoices went partial → paid; the draft guard answered 400\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.10 · fourteen vendor bills
  // ──────────────────────────────────────────────────────────────────────────
  test('05.10 fourteen vendor bills are recorded against real suppliers', async ({ page }) => {
    test.setTimeout(60 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);
    const p = await openTab(page, 'payables', 'payables');

    const vendors = (await apiRows(page, '/api/v1/ganit/vendors'))
      .filter((v) => String(v.name || '').startsWith(`${TAG} Vendor `));
    expect(vendors.length, '05.03 must run first — there are no suppliers to owe').toBe(N_VENDORS);

    const before = marksOf(await apiRows(page, '/api/v1/ganit/vendor-bills'), 'bill_number');

    /** Bills 1–8 are sized so a payment of exactly one bank DEBIT is partial. */
    const billRate = (n: number) => (n <= BANK_DEBITS.length ? BANK_DEBITS[n - 1] : 20000 + n * 1300);

    async function createBill(n: number) {
      await p.locator('.gn-bar').getByRole('button', { name: /^\+ Vendor bill$/ }).click();
      const form = p.locator('form.gn-form').filter({ hasText: 'New vendor bill' }).first();
      await expect(form, 'the vendor-bill form did not open').toBeVisible();

      await pickByLabel(
        form.locator('label.fld', { hasText: 'Vendor' }).locator('select.inp'),
        vendorName(((n - 1) % N_VENDORS) + 1), 'vendor',
      );
      await typeInto(
        form.locator('label.fld', { hasText: "Vendor's bill no." }).locator('input.inp'),
        billNumber(n),
      );
      await setDate(form, /Bill date/, `2026-08-${pad(((n - 1) % 27) + 1)}`);
      await setDate(form, /Due date/, `2026-09-${pad(((n - 1) % 27) + 1)}`);
      await setCheckbox(
        form.locator('label.gn-chk', { hasText: 'Inter-state (IGST)' }).locator('input[type=checkbox]'),
        n % 3 === 0,
      );

      /* ⚠ These line inputs carry NO aria-label — unlike the invoice form's,
         which name every box "Line 1 rate" and so on. They are addressed
         positionally within their own row, in the order the markup declares
         them: description, quantity, rate, GST%, HSN. Positional addressing is
         a last resort and it is recorded as one: the asymmetry between the two
         line editors is a real accessibility gap in the payables form, where a
         screen-reader user meets five unlabelled boxes per row. */
      const row = form.locator('.gn-li').first();
      const box = (i: number) => row.locator('input.inp').nth(i);
      await typeInto(box(0), `${TAG} Supply ${pad(n)}`);
      await typeInto(box(1), '1');
      await typeInto(box(2), String(billRate(n)));
      await typeInto(box(3), '18');
      await typeInto(box(4), '998311');

      await typeInto(form.locator('label.fld', { hasText: 'Notes' }).locator('textarea.inp'),
        `${TAG} payable · run ${RUN}`);

      await saveAndWait(page, async () => {
        await form.getByRole('button', { name: /^Save bill$/ }).click();
      }, /\/v1\/ganit\/vendor-bills$/, `recording ${billNumber(n)}`);
      await settle(page);
    }

    const made = await ensure(
      Array.from({ length: N_BILLS }, (_, i) => i + 1), before, billNumber, createBill,
    );

    const bills = await apiRows(page, '/api/v1/ganit/vendor-bills');
    const mine = bills.filter((b) => String(b.bill_number || '').startsWith(`${TAG}-BILL-`));
    expect(mine.length, `wanted ${N_BILLS} vendor bills, payables holds ${mine.length}` +
      `${dumpWire(wire)}`).toBe(N_BILLS);
    for (const b of mine) {
      expect(String(b.vendor_name || ''), `${b.bill_number} names no supplier — a payable with ` +
        'nobody to pay is not a payable').toContain(`${TAG} Vendor `);
      expect(Number(b.total), `${b.bill_number} totals nothing`).toBeGreaterThan(0);
    }

    // The ageing profile the screen exists for. `GET /payables-summary` returns
    // the buckets and the panel discarded them once — "₹4L outstanding" and
    // "₹4L outstanding, all of it 90+ days" are different businesses.
    const summary = await apiOne(page, '/api/v1/ganit/payables-summary');
    expect(Number(summary.open_bills), 'payables reports no open bills after fourteen were recorded')
      .toBeGreaterThan(0);
    await expect(p.locator('.gn-panel__h').filter({ hasText: 'Ageing' }),
      'the payables screen shows no ageing profile').toBeVisible({ timeout: 20_000 });

    console.log(`\n  05.10 — vendor bills: ${made.typed} typed, ${made.found} already present, ` +
      `${mine.length} on payables · outstanding ${summary.outstanding} across ` +
      `${summary.open_bills} open bills\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.11 · ten vendor payments
  // ──────────────────────────────────────────────────────────────────────────
  test('05.11 ten vendor payments are released against those bills', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);
    const p = await openTab(page, 'payables', 'payables');

    const bills = (await apiRows(page, '/api/v1/ganit/vendor-bills'))
      .filter((b) => String(b.bill_number || '').startsWith(`${TAG}-BILL-`));
    expect(bills.length, '05.10 must run first').toBe(N_BILLS);
    const byNumber = new Map(bills.map((b) => [String(b.bill_number), b]));

    /** Eight sized to a bank DEBIT so 05.13 can reconcile them exactly. */
    const payAmount = (n: number) => (n <= BANK_DEBITS.length ? BANK_DEBITS[n - 1] : 7500 + n * 90);

    let released = 0;
    let denied = '';
    for (let n = 1; n <= N_VENDOR_PAYMENTS; n++) {
      const bill = byNumber.get(billNumber(n));
      expect(bill, `${billNumber(n)} is missing`).toBeTruthy();
      const detail = await apiOne(page, `/api/v1/ganit/vendor-bills/${bill.id}`);
      if ((detail?.payments || []).length >= 1) continue;   // §6 — already done

      // The row is a button carrying the supplier's name and the bill's
      // INTERNAL reference; the drawer is titled by that reference.
      const row = p.locator('.gn-list .gn-row').filter({ hasText: String(bill.internal_ref) }).first();
      await expect(row, `${bill.bill_number} (${bill.internal_ref}) is not on the payables list`)
        .toBeVisible({ timeout: 30_000 });
      await row.click();
      const drawer = page.getByRole('dialog', { name: `Vendor bill ${bill.internal_ref}` });
      await expect(drawer, 'the vendor-bill drawer did not open').toBeVisible({ timeout: 30_000 });

      const form = drawer.locator('form.gn-payline');
      /* SEPARATED DUTY. Paying a vendor is gated on the `approver` level in
         Ganit and an `admin` grant does NOT climb into it — administering the
         books and releasing money are deliberately different authorities. The
         screen does not GUESS: it renders the form and disables it only once
         the server has actually said no. So a 403 here is a real finding about
         this credential's authority and is reported as one rather than being
         pre-empted by a skip. */
      if (!(await form.count())) {
        const note = await drawer.locator('.note--warn').innerText().catch(() => '');
        denied = note || 'the release-payment form is absent and no reason is on screen';
        await closeDrawer(page, drawer);
        break;
      }

      await typeInto(form.locator('input.gn-payline__in'), String(payAmount(n)));
      const [res] = await Promise.all([
        page.waitForResponse((r) => /\/vendor-bills\/[^/]+\/payments$/.test(r.url())
          && r.request().method() === 'POST', { timeout: 60_000 }),
        form.getByRole('button', { name: /^Record payment$/ }).click(),
      ]);
      if (res.status() === 403) {
        denied = `POST ${new URL(res.url()).pathname} → 403: ${(await res.text()).slice(0, 300)}`;
        await closeDrawer(page, drawer);
        break;
      }
      expect(res.status(), `releasing ${payAmount(n)} against ${bill.bill_number}: ` +
        `${res.status()} ${(await res.text()).slice(0, 300)}`).toBeLessThan(400);
      released++;
      await settle(page);
      await closeDrawer(page, drawer);
    }

    expect(denied,
      'VENDOR PAYMENT WAS REFUSED. Ganit is a separated-duty module: releasing money needs the ' +
      '`approver` level and an org_admin grant does not carry it (`middleware/module_levels.py`, ' +
      'active only once `staging.org_module_approvers` exists). The lane credential is org-scoped ' +
      'by design — 93 rule 1 forbids a platform token — so this is a statement about what that ' +
      `account may do, not about the screen.\n     ${denied}\n     ${released} of ` +
      `${N_VENDOR_PAYMENTS} released before the refusal.${dumpWire(wire)}`).toBe('');

    let total = 0;
    for (let n = 1; n <= N_VENDOR_PAYMENTS; n++) {
      const bill = byNumber.get(billNumber(n));
      const d = await apiOne(page, `/api/v1/ganit/vendor-bills/${bill.id}`);
      total += (d?.payments || []).length;
    }
    expect(total, `wanted ${N_VENDOR_PAYMENTS} vendor payments, the ledger holds ${total}` +
      `${dumpWire(wire)}`).toBe(N_VENDOR_PAYMENTS);

    console.log(`\n  05.11 — vendor payments: ${released} released this run, ${total} on the ledger\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.12 · three real bank statements, uploaded as files and parsed by name
  // ──────────────────────────────────────────────────────────────────────────
  test('05.12 three bank statements import, with the column map guessed from the headers', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);
    const p = await openTab(page, 'bank', 'bank');

    /**
     * ⚠ 93 §5 SAYS THE PARSER IS POSITIONAL. IT IS NOT, AND HAS NOT BEEN SINCE
     * 2026-08-09.
     *
     * `frontend/src/lib/bankCsv.js` replaced `split(',')`-by-position with
     * `guessMapping`, which reads the HEADER ROW. Column ORDER is now
     * irrelevant and column NAMES are the entire contract, so the thing worth
     * proving is that three DIFFERENT banks' real headings each resolve to the
     * right columns — which is exactly what these three committed fixtures are
     * for, and why none of them is hand-written here.
     *
     * There is also no XLS path: the file input accepts `.csv,text/csv` only.
     * And the BROWSER parses — `POST /bank-statements/import` takes
     * already-parsed JSON lines, so a file never reaches the backend at all.
     */
    /* `marker` is one narration that appears in THIS file and in no other, so
       §6 can tell whether a statement is already on the books without
       re-reading and re-parsing it. The bank's own wording is the only stable
       key a statement line has: there is no batch label column to look it up
       by — the import endpoint echoes the label back precisely because the
       table has nowhere to keep it. */
    const FILES = [
      { file: 'hdfc-current-aug2026.csv', bank: 'HDFC current account', lines: 8, skipped: 2, marker: 'VEDANTA TEXTILES' },
      { file: 'sbi-current-aug2026.csv', bank: 'State Bank of India current', lines: 8, skipped: 0, marker: 'ANANTA CERAMICS' },
      { file: 'icici-current-aug2026.csv', bank: 'ICICI Bank current', lines: 8, skipped: 0, marker: 'TUNGABHADRA FOODS' },
    ];
    expect(FILES.length, `§4 asks for ${N_BANK_FILES} statement files`).toBe(N_BANK_FILES);

    const existing = await apiRows(page, '/api/v1/ganit/bank-statements');
    const narrations = existing.map((l) => String(l.description || '').toUpperCase());

    let imported = 0;
    let importedThisRun = 0;
    for (const f of FILES) {
      con.at(f.file);
      const full = path.join(BANK_DIR, f.file);
      expect(fs.existsSync(full), `the committed fixture ${f.file} is missing`).toBeTruthy();

      // §6 — a statement already on the books is verified, not imported twice.
      // A second import would double every line and the reconciliation counts
      // below would still add up, which is exactly the kind of duplication a
      // row count cannot see.
      expect(fs.readFileSync(full, 'utf8').toUpperCase(), `${f.file} no longer contains its own ` +
        `marker "${f.marker}" — the fixture changed and §6 can no longer recognise it`)
        .toContain(f.marker);
      if (narrations.some((d) => d.includes(f.marker))) { imported += f.lines; continue; }

      await p.locator('.gn-bar').getByRole('button', { name: /^Import CSV$/ }).click();
      const form = p.locator('form.gn-form').filter({ hasText: 'Import a bank statement' }).first();
      await expect(form, 'the import form did not open').toBeVisible();

      /* Addressed by its `list` attribute, not by its label. `hasText` is a
         case-INSENSITIVE substring match, and the word "bank" appears in the
         hint under the Bank box AND in the hint under the Statement file box
         ("The CSV your bank exports, as it comes"), so `label.fld` filtered on
         'Bank' resolves to two labels and two inputs. The datalist is what
         makes this control unique, and it is also what the control IS: a box
         that offers the banks already imported. */
      await typeInto(form.locator('input[list="gn-banks"]'), f.bank);
      await typeInto(form.locator('label.fld', { hasText: 'Batch label' }).locator('input.inp'),
        `${TAG} ${f.bank} Aug-2026`);

      // THE REAL FILE, THROUGH THE REAL FILE INPUT.
      await form.locator('input[type=file]').setInputFiles(full);

      // The guess, shown before anything is imported — which is the whole point
      // of the screen: "money out belongs in Withdrawal, not in Amount; read
      // the wrong way round, every payment imports as income".
      const note = form.locator('p.note[role=status]');
      await expect(note, 'the import form never previewed what it had read')
        .toBeVisible({ timeout: 30_000 });
      await expect(note, `${f.file} should preview ${f.lines} readable rows`)
        .toContainText(new RegExp(`${f.lines} row`));
      if (f.skipped) {
        await expect(note, `${f.file} carries ${f.skipped} undated rows (an opening balance and a ` +
          'statement total) that must be skipped rather than imported as transactions')
          .toContainText(new RegExp(`${f.skipped} skipped`));
      }

      // The mapping the header row produced, read off the screen. Debit and
      // credit must BOTH be mapped: `mapping.credit != null` alone is enough
      // for `toLines` to take the two-column branch, which is how the ICICI
      // file once dropped five of its eight withdrawals silently.
      /* Matched on the field's own CAPTION, not on the label's text.
         Every one of the seven selects lists the same column headings as its
         options, so a `hasText: 'Date'` filter over `label.fld` matches all
         seven — the word is in each one's option list. The caption is the only
         part that differs, and `FIELDS` appends " *" to the required one. */
      const mapSel = (label: string) =>
        form.locator('div.gn-map label.fld')
          .filter({
            has: page.locator('span.fld__l').filter({
              hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*\\*?$`),
            }),
          })
          .locator('select.inp');
      for (const label of ['Date', 'Description', 'Withdrawal / Debit', 'Deposit / Credit']) {
        const v = await mapSel(label).inputValue();
        expect(v, `${f.file}: the "${label}" column was not resolved from the header row. ` +
          'Column NAMES are the whole contract since 2026-08-09 and an unmapped withdrawal ' +
          'column nets every payment to zero and drops it.').not.toBe('');
      }

      const submit = form.locator('button[type=submit]');
      await expect(submit, 'the import button does not say how many rows it will import')
        .toHaveText(new RegExp(`Import ${f.lines} rows`));

      const body = await saveAndWait(page, async () => { await submit.click(); },
        /\/v1\/ganit\/bank-statements\/import$/, `importing ${f.file}`);
      expect(Number(body.imported), `${f.file} reported ${body.imported} imported`).toBe(f.lines);
      imported += f.lines;
      importedThisRun += f.lines;
      await settle(page);
    }

    const lines = await apiRows(page, '/api/v1/ganit/bank-statements');
    expect(lines.length, `wanted ${FILES.reduce((s, f) => s + f.lines, 0)} statement lines from ` +
      `${N_BANK_FILES} files, the books hold ${lines.length}${dumpWire(wire)}`)
      .toBe(FILES.reduce((s, f) => s + f.lines, 0));

    // THE SIGNS ARE THE MONEY ASSERTION. A withdrawal read as income is the
    // defect this screen's own hint warns about, and it is invisible in a row
    // count: ten credits and fourteen debits is what these three files hold.
    const credits = lines.filter((l) => Number(l.amount) > 0);
    const debits = lines.filter((l) => Number(l.amount) < 0);
    expect(credits.length, 'the three statements carry ten credit lines between them; a different ' +
      'number means a withdrawal column was read as a deposit').toBe(BANK_CREDITS.length);
    expect(debits.length, 'the three statements carry fourteen debit lines between them')
      .toBe(24 - BANK_CREDITS.length);
    for (const want of BANK_CREDITS) {
      expect(credits.some((l) => money(Number(l.amount)) === money(want)),
        `no credit line of ${want} was imported — the amounts are what a receipt reconciles against`)
        .toBeTruthy();
    }

    console.log(`\n  05.12 — bank: ${importedThisRun} lines imported this run, ${lines.length} on ` +
      `the books (${credits.length} credits, ${debits.length} debits) from ${N_BANK_FILES} real formats\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.13 · reconciliation — the only route to "paid" this product has
  // ──────────────────────────────────────────────────────────────────────────
  test('05.13 statement lines are reconciled to receipts and vendor payments, and six are left open', async ({ page }) => {
    test.setTimeout(90 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);
    const p = await openTab(page, 'bank', 'bank');

    /**
     * ⚠ EVERY ASSERTION BELOW IS A MONEY ASSERTION.
     *
     * There is no payment gateway in this product and there never will be:
     * "paid" only ever comes from bank reconciliation. A line matched to the
     * wrong receipt is not a test failure, it is a wrong set of books — and the
     * server agrees, announcing `invoice.paid` with `via='reconciliation'` the
     * moment a match settles an invoice in full.
     */
    const lines = await apiRows(page, '/api/v1/ganit/bank-statements');
    expect(lines.length, '05.12 must run first — there are no statement lines').toBe(24);

    const invoices = await myInvoices(page);
    const bills = (await apiRows(page, '/api/v1/ganit/vendor-bills'))
      .filter((b) => String(b.bill_number || '').startsWith(`${TAG}-BILL-`));
    const billByNumber = new Map(bills.map((b) => [String(b.bill_number), b]));

    // Show every line on one page. `useTableView` pages at 25 and there are 24,
    // but a per-page default that changes would silently hide the tail.
    const perPage = p.locator('label.tv__size select.inp');
    if (await perPage.count()) await perPage.selectOption('100');
    await settle(page);

    /** The table row for one statement line, found by the bank's own wording. */
    function rowFor(line: any): Locator {
      const snippet = String(line.description || '').slice(0, 28);
      expect(snippet.length, 'a statement line with no description cannot be found on screen')
        .toBeGreaterThan(4);
      return p.locator('table.tbl tbody tr').filter({ hasText: snippet }).first();
    }

    /** Reconcile one line against the candidate whose DOCUMENT is `document`. */
    async function matchLine(line: any, document: string, what: string) {
      const row = rowFor(line);
      await expect(row, `the ${what} line "${String(line.description).slice(0, 40)}" is not on ` +
        'the reconciliation screen').toBeVisible({ timeout: 30_000 });

      const open = row.getByRole('button', { name: /^Match$/ });
      await expect(open, `the ${what} line offers no Match control — manual matching had a ` +
        'working endpoint and no way to reach it for a long time').toBeVisible();
      await open.click();

      const pane = p.locator('.gn-match');
      await expect(pane, 'the match panel did not open').toBeVisible({ timeout: 30_000 });
      // The panel names WHICH ledger it is offering, from the sign of the line.
      await expect(pane.locator('.gn-match__h'), 'the match panel does not say which ledger it ' +
        'is offering, so a debit could be reconciled against a receipt')
        .toHaveText(Number(line.amount) < 0 ? /Payments you sent/ : /Payments you received/);

      const rows = pane.locator('li.gn-match__row');
      await expect
        .poll(async () => await rows.count(), {
          message: `no candidate payments were offered for the ${what} line of ${line.amount}. ` +
            'An empty candidate list here means the receipt or the vendor payment it should be ' +
            'was never recorded, or is already claimed by another line.',
          timeout: 30_000,
        })
        .toBeGreaterThan(0);

      const target = rows.filter({ hasText: document }).first();
      await expect(target, `no candidate naming ${document} was offered for a line of ` +
        `${line.amount}; the panel listed: ${(await rows.allTextContents()).slice(0, 6).join(' | ')}`)
        .toBeVisible();
      // The screen must SAY the amounts agree rather than making the reader
      // compare two numbers by eye — that tag is `amount_matches` on the wire.
      await expect(target.locator('.gn-match__exact'),
        `the candidate for ${document} is not flagged as an exact amount, so the payment does ` +
        `not equal the line's ${line.amount}`).toBeVisible();

      await saveAndWait(page, async () => {
        await target.getByRole('button', { name: /^Match this$/ }).click();
      }, /\/bank-statements\/[^/]+\/match/, `matching ${what} ${line.amount} to ${document}`);
      await settle(page);
    }

    let creditsMatched = 0;
    let debitsMatched = 0;

    // ── the ten credits → customer receipts ────────────────────────────────
    for (let i = 0; i < BANK_CREDITS.length; i++) {
      const amount = BANK_CREDITS[i];
      const line = lines.find((l) => money(Number(l.amount)) === money(amount));
      expect(line, `no imported credit line of ${amount}`).toBeTruthy();
      const inv = invoices.get(invoiceRef(i + 1));
      expect(inv, `${invoiceRef(i + 1)} is missing, so its receipt cannot be reconciled`).toBeTruthy();

      // §6 — a line this suite already reconciled is verified, not matched twice
      // (a second match answers 409, "that line is already reconciled").
      const fresh = await apiRows(page, '/api/v1/ganit/bank-statements');
      if (fresh.find((l) => l.id === line.id)?.is_reconciled) { creditsMatched++; continue; }

      con.at(`match credit ${amount}`);
      await matchLine(line, String(inv.invoice_number), 'credit');
      creditsMatched++;
    }

    // ── eight debits → vendor payments ─────────────────────────────────────
    for (let i = 0; i < BANK_DEBITS.length; i++) {
      const amount = -BANK_DEBITS[i];
      const line = lines.find((l) => money(Number(l.amount)) === money(amount));
      expect(line, `no imported debit line of ${amount}`).toBeTruthy();
      const bill = billByNumber.get(billNumber(i + 1));
      expect(bill, `${billNumber(i + 1)} is missing`).toBeTruthy();

      const after = await apiRows(page, '/api/v1/ganit/bank-statements');
      if (after.find((l) => l.id === line.id)?.is_reconciled) { debitsMatched++; continue; }

      con.at(`match debit ${amount}`);
      await matchLine(line, String(bill.bill_number), 'debit');
      debitsMatched++;
    }

    // ── what the books now say ─────────────────────────────────────────────
    const after = await apiRows(page, '/api/v1/ganit/bank-statements');
    const reconciled = after.filter((l) => l.is_reconciled);
    const open = after.filter((l) => !l.is_reconciled);
    const stats = await apiOne(page, '/api/v1/ganit/bank-statements/stats');

    expect(creditsMatched, 'every credit line must be reconciled to a customer receipt')
      .toBe(BANK_CREDITS.length);
    expect(debitsMatched, 'eight debit lines must be reconciled to vendor payments')
      .toBe(BANK_DEBITS.length);
    expect(reconciled.length, 'the reconciled count on the wire disagrees with what was matched')
      .toBe(BANK_CREDITS.length + BANK_DEBITS.length);
    expect(open.length, `${N_UNMATCHED_TARGET} lines must be left open deliberately — bank ` +
      'charges, professional tax, broadband, a courier and a TDS remittance are money that left ' +
      'the account against no vendor bill, which is why a real reconciliation ends with lines still open')
      .toBe(N_UNMATCHED_TARGET);
    expect(Number(stats.matched), 'the stat tile disagrees with the ledger')
      .toBe(reconciled.length);
    expect(Number(stats.unmatched), 'the stat tile disagrees with the ledger').toBe(open.length);

    // The whole point: reconciliation is what makes an invoice PAID. Every
    // invoice whose receipt was matched must now read paid or partial, and the
    // ten that were settled in full must read paid.
    for (let i = 0; i < BANK_CREDITS.length; i++) {
      const ref = invoiceRef(i + 1);
      const now = (await myInvoices(page)).get(ref);
      expect(['paid', 'partial'], `${now.invoice_number} (${ref}) had a receipt reconciled ` +
        `against it and reads "${now.payment_status}"`).toContain(now.payment_status);
    }

    // And the screen agrees with the wire — a matched line offers Unmatch.
    await openTab(page, 'bank', 'bank');
    const firstMatched = reconciled[0];
    await expect(rowFor(firstMatched).getByRole('button', { name: /^Unmatch$/ }),
      'a reconciled line still offers Match rather than Unmatch').toBeVisible({ timeout: 30_000 });

    console.log(`\n  05.13 — reconciled ${reconciled.length} of ${after.length} lines ` +
      `(${creditsMatched} credits → receipts, ${debitsMatched} debits → vendor payments); ` +
      `${open.length} left open; matched amount ${stats.matched_amount}\n`);

    /**
     * ⚠ AND NOW THE §4 TARGET, WHICH THESE FIXTURES CANNOT REACH.
     *
     * This assertion is last on purpose: everything above it is what the run
     * actually achieved and passes on its own evidence. §4 asks for 24 lines
     * reconciled TO INVOICES. A line reconciles to a customer receipt only when
     * it is a CREDIT — `choose_bank_match` and `bank_line_candidates` both pick
     * the ledger from the sign, because a debit is money that left and can only
     * be a payment to a supplier. The three committed fixtures carry TEN
     * credits between them, so 24 is unreachable by 14, and no amount of
     * clicking closes the gap.
     *
     * Rule 2: no verdict. The options — more credit rows in the fixtures, a
     * lower number in §4, or counting vendor-payment matches towards it — are
     * the owner's to pick, and this suite states the arithmetic rather than
     * silently capping the number, because a silent cap reads as full coverage.
     */
    expect(creditsMatched,
      `§4 asks for ${N_RECONCILED_TARGET} statement lines reconciled TO INVOICES and this run ` +
      `reconciled ${creditsMatched}.\n` +
      '     The three committed fixtures import 24 lines in total: 10 credits and 14 debits ' +
      '(measured by fixtures/verify-bank-fixtures.mjs, which runs the product\'s own parser).\n' +
      '     Only a CREDIT can be an invoice receipt — the sign picks the ledger — so 10 is an ' +
      'arithmetic ceiling, not a choice this suite made.\n' +
      `     ${debitsMatched} debits were additionally reconciled to vendor payments and ` +
      `${open.length} lines were left open, so ${reconciled.length} of 24 are matched in all.\n` +
      '     93 §14 keeps the verdict: the fixtures, the §4 number, or the counting rule.',
    ).toBeGreaterThanOrEqual(N_RECONCILED_TARGET);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.14 · four recurring schedules, two cycles run — the period ADVANCES
  // ──────────────────────────────────────────────────────────────────────────
  test('05.14 four recurring schedules exist and two cycles advance the period rather than duplicating it', async ({ page }) => {
    test.setTimeout(25 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);
    const p = await openTab(page, 'recurring', 'recurring');

    const contacts = await apiRows(page, '/api/v1/graha/contacts');
    const FREQ = ['monthly', 'quarterly', 'weekly', 'yearly'];

    const before = new Set(
      (await apiRows(page, '/api/v1/ganit/recurring'))
        .map((r) => String(Number(r.subtotal) || 0)),
    );

    async function createSchedule(n: number) {
      const bar = p.locator('.gn-bar');
      const open = bar.getByRole('button', { name: /^\+ New recurring invoice$/ });
      if (await open.count()) await open.click();
      else await p.locator('.empty__act').getByRole('button', { name: /New recurring invoice/ }).click();
      const form = p.locator('form.gn-form').filter({ hasText: 'Recurring invoice' }).first();
      await expect(form, 'the recurring-invoice form did not open').toBeVisible();

      await pickByLabel(form.locator('label.fld', { hasText: 'Customer' }).locator('select.inp'),
        String(contacts[(n - 1) % contacts.length].name), 'customer');
      await form.locator('label.fld', { hasText: 'Frequency' }).locator('select.inp')
        .selectOption(FREQ[(n - 1) % FREQ.length]);
      await setDate(form, /Next date/, `2026-09-${pad(n + 4)}`);
      /* An END DATE far enough out that two cycles cannot cross it — the
         generator deactivates a schedule whose next date would pass its end,
         and a deactivated schedule drops off this list entirely — but NOT
         further than thirteen months from today, because `setDate` walks the
         calendar a month at a time and gives up after thirteen steps rather
         than spinning on a wrong date. Two monthly cycles from September 2026
         reach November 2026; June 2027 clears that with room. */
      await setDate(form, /End date/, '2027-06-15');
      await setCheckbox(form.locator('label.gn-chk', { hasText: 'Flag for sending' })
        .locator('input[type=checkbox]'), n % 2 === 0);
      await setCheckbox(form.locator('label.gn-chk', { hasText: 'Inter-state (IGST)' })
        .locator('input[type=checkbox]'), n % 3 === 0);

      const row = form.locator('.gn-li').first();
      await typeInto(row.locator('input.inp').nth(0), `${TAG} Retainer line ${pad(n)}`);
      await typeInto(row.locator('input.inp').nth(1), '1');
      // Quantity 1 at this rate, so the schedule's stored `subtotal` IS the
      // mark — `save()` computes it as the sum of quantity times rate.
      await typeInto(row.locator('input.inp').nth(2), String(recurringAmount(n)));
      await typeInto(row.locator('input.inp').nth(3), '18');

      await saveAndWait(page, async () => {
        await form.getByRole('button', { name: /^Create$/ }).click();
      }, /\/v1\/ganit\/recurring$/, `creating the schedule marked ${recurringMark(n)}`);
      await settle(page);
    }

    const made = await ensure(
      Array.from({ length: N_RECURRING }, (_, i) => i + 1), before, recurringMark, createSchedule,
    );

    let schedules = await apiRows(page, '/api/v1/ganit/recurring');
    expect(schedules.length, `wanted ${N_RECURRING} active schedules, the list holds ` +
      `${schedules.length}${dumpWire(wire)}`).toBeGreaterThanOrEqual(N_RECURRING);

    // ── TWO CYCLES, ON THE SAME SCHEDULE, AND THE PERIOD MUST MOVE ─────────
    // Running twice on ONE schedule is the only shape that can tell "advanced"
    // apart from "raised the same invoice twice": two runs on two schedules
    // would look identical whether the date moved or not.
    const target = schedules[0];
    const monthlyish = schedules.find((s) => s.frequency === 'monthly') || target;
    const before2 = (await apiRows(page, '/api/v1/ganit/invoices')).length;

    const raised: string[] = [];
    const dates: string[] = [String(monthlyish.next_date)];
    for (let cycle = 1; cycle <= N_CYCLES; cycle++) {
      await openTab(page, 'recurring', 'recurring');
      const row = p.locator('.gn-list .gn-row')
        .filter({ hasText: String(monthlyish.contact_name || '') }).first();
      await expect(row, 'the schedule to generate from is not on the list')
        .toBeVisible({ timeout: 30_000 });
      const body = await saveAndWait(page, async () => {
        await row.getByRole('button', { name: /^Generate now$/ }).click();
      }, /\/v1\/ganit\/recurring\/[^/]+\/generate$/, `cycle ${cycle}`);
      expect(String(body.invoice_number || ''), `cycle ${cycle} raised no invoice number`).not.toBe('');
      raised.push(String(body.invoice_number));
      await settle(page);

      schedules = await apiRows(page, '/api/v1/ganit/recurring');
      const now = schedules.find((s) => s.id === monthlyish.id);
      expect(now, `the schedule vanished after cycle ${cycle} — it can only deactivate when the ` +
        'next date passes its end date, and the end date was set well beyond two cycles').toBeTruthy();
      dates.push(String(now.next_date));
    }

    expect(new Set(raised).size, `two cycles raised ${raised.join(' and ')} — the same document ` +
      'twice is a duplicate, which is the failure this test exists for').toBe(N_CYCLES);
    expect(new Set(dates).size, `the schedule's next date went ${dates.join(' → ')} — a period ` +
      'that does not move means the next run raises the same invoice again').toBe(N_CYCLES + 1);
    for (let i = 1; i < dates.length; i++) {
      expect(new Date(dates[i]).getTime(), `the next date went backwards: ${dates[i - 1]} → ${dates[i]}`)
        .toBeGreaterThan(new Date(dates[i - 1]).getTime());
    }
    const after2 = (await apiRows(page, '/api/v1/ganit/invoices')).length;
    expect(after2 - before2, `${N_CYCLES} cycles must add exactly ${N_CYCLES} invoices to the ledger`)
      .toBe(N_CYCLES);

    console.log(`\n  05.14 — schedules: ${made.typed} typed, ${made.found} already present; ` +
      `${N_CYCLES} cycles raised ${raised.join(', ')}; next date ${dates.join(' → ')}\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.15 · five contracts, and the nine signers the fence will not let out
  // ──────────────────────────────────────────────────────────────────────────
  test('05.15 five contracts are recorded and nine signers are sent their links', async ({ page }) => {
    test.setTimeout(25 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);
    let p = await openTab(page, 'contracts', 'contracts');

    const contacts = await apiRows(page, '/api/v1/graha/contacts');
    const before = marksOf(await apiRows(page, '/api/v1/ganit/contracts'), 'title');

    async function createContract(n: number) {
      const bar = p.locator('.gn-bar');
      const open = bar.getByRole('button', { name: /^\+ New contract$/ });
      if (await open.count()) await open.click();
      else await p.locator('.empty__act').getByRole('button', { name: /New contract/ }).click();
      const form = p.locator('form.gn-form').filter({ hasText: 'New contract' }).first();
      await expect(form, 'the contract form did not open').toBeVisible();

      await typeInto(form.locator('label.fld', { hasText: 'Title' }).locator('input.inp'),
        contractTitle(n));
      await pickByLabel(form.locator('label.fld', { hasText: 'Customer' }).locator('select.inp'),
        String(contacts[(n - 1) % contacts.length].name), 'customer');
      await typeInto(form.locator('label.fld', { hasText: 'Value' }).locator('input.inp'),
        String(250000 * n));
      await typeInto(form.locator('label.fld', { hasText: 'Reminder' }).locator('input.inp'),
        String([15, 30, 45, 60, 90][n - 1]));
      await setDate(form, /Start date/, `2026-08-${pad(n)}`);
      await setDate(form, /End date/, `2027-07-${pad(n + 10)}`);
      await typeInto(form.locator('label.fld', { hasText: 'Description' }).locator('textarea.inp'),
        `${TAG} engagement · run ${RUN}`);

      await saveAndWait(page, async () => {
        await form.getByRole('button', { name: /^Create$/ }).click();
      }, /\/v1\/ganit\/contracts$/, `creating ${contractTitle(n)}`);
      await settle(page);
    }

    const made = await ensure(
      Array.from({ length: N_CONTRACTS }, (_, i) => i + 1), before, contractTitle, createContract,
    );

    const contracts = (await apiRows(page, '/api/v1/ganit/contracts'))
      .filter((c) => String(c.title || '').startsWith(`${TAG} Contract `));
    expect(contracts.length, `wanted ${N_CONTRACTS} contracts, the register holds ` +
      `${contracts.length}${dumpWire(wire)}`).toBe(N_CONTRACTS);
    for (const c of contracts) {
      expect(String(c.contact_name || ''), `${c.title} names no customer`).not.toBe('');
      expect(Number(c.contract_value), `${c.title} is worth nothing`).toBeGreaterThan(0);
    }

    // ── the contract RECORD, which is a screen of its own ─────────────────
    // `ContractDetail` is not the same surface as the signature drawer, and it
    // is where the status ladder and the invoices raised against the agreement
    // live. Opened here so the record is exercised and not merely created.
    const listRow = p.locator('.gn-list .gn-row').filter({ hasText: contractTitle(1) }).first();
    await expect(listRow, 'a contract that exists is not on the register').toBeVisible({ timeout: 30_000 });
    await listRow.click();
    const record = page.getByRole('dialog', { name: `Contract ${contractTitle(1)}` });
    await expect(record, 'the contract record drawer did not open').toBeVisible({ timeout: 30_000 });
    await expect(record.locator('.gnd__num'), 'the contract record opened a different agreement')
      .toHaveText(contractTitle(1));
    // The four facts an agreement IS, and the ladder that moves it. `Related
    // invoices` is deliberately NOT asserted: that section is conditional on
    // there being invoices raised against the contract, and this suite raises
    // none against one — asserting it would be asserting a state nothing here
    // creates.
    await expect(record.locator('.gn-facts'), 'the contract record states none of its own terms')
      .toContainText(/Value/);
    await expect(record.getByRole('button', { name: /^Mark active$/ }),
      'the contract record offers no way to move a draft agreement to active')
      .toBeVisible();
    await closeDrawer(page, record);

    // ── the e-sign surface, and the affordance, WITHOUT sending ────────────
    p = await openTab(page, 'e-sign', 'e sign');
    const row = p.locator('.gn-list .gn-row').filter({ hasText: contractTitle(1) }).first();
    await expect(row, 'a contract that exists is not offered for signature').toBeVisible({ timeout: 30_000 });
    await row.click();
    const drawer = page.getByRole('dialog', { name: `Signatures for ${contractTitle(1)}` });
    await expect(drawer, 'the signature drawer did not open').toBeVisible({ timeout: 30_000 });

    const form = drawer.locator('form.dr__sec');
    await expect(form, 'there is no way to send a contract for signature').toBeVisible();
    // Nine signers across five contracts: two apiece on four of them and one on
    // the fifth. The BOXES are filled here so the affordance is proved to take
    // them; the send itself is fenced below.
    await form.getByRole('button', { name: /^\+ Add signer$/ }).click();
    const rows = form.locator('.gn-li');
    await expect.poll(async () => await rows.count(), { message: '"+ Add signer" added no row' })
      .toBe(2);
    for (let i = 0; i < 2; i++) {
      await typeInto(rows.nth(i).locator('input.inp').nth(0), `${TAG} Signer ${i + 1}`);
      await typeInto(rows.nth(i).locator('input.inp').nth(1), `s05.signer${i + 1}@example.com`);
    }
    await expect(form.getByRole('button', { name: /^Send for signature$/ }),
      'the send control is missing or disabled').toBeEnabled();
    await expect(form.locator('.gn-est__note'), 'the screen does not warn that signers are emailed')
      .toContainText(/emailed their own link/);
    await closeDrawer(page, drawer);

    /**
     * ⚠ EXPECTED TO FAIL, AND FAILING IS THE SAFE OUTCOME — same fence as 05.08.
     *
     * `POST /contracts/{id}/send-for-signature` mails every signer their own
     * link. The deployed staging process reports `outbound_mode=live` with
     * `suppressed_orgs_digest="0"` — the empty set — so nine sends leave the
     * building. Nothing was sent. The five contracts above are real and are
     * asserted; only the signers are withheld.
     */
    const fence = await outboundFence(page);
    expect(fence.shielded,
      `THE OUTBOUND FENCE IS DOWN — ${N_SIGNERS} signature invitations NOT sent, deliberately.\n` +
      `     GET /api/health reports outbound_mode='${fence.mode}' and ` +
      `suppressed_orgs_digest='${fence.digest}' ('0' is the literal for the EMPTY SET).\n` +
      '     Sending for signature emails each signer a link; nothing shields this org, so those ' +
      'nine messages would be delivered for real.\n' +
      `     The affordance itself is present and enabled and takes the names — ${N_CONTRACTS} ` +
      'contracts were created and asserted. 93 §14 keeps the verdict.').toBeTruthy();

    // Reachable once the fence holds.
    let signers = 0;
    for (let n = 1; n <= N_CONTRACTS; n++) {
      const want = n <= 4 ? 2 : 1;
      const r = p.locator('.gn-list .gn-row').filter({ hasText: contractTitle(n) }).first();
      await r.click();
      const d = page.getByRole('dialog', { name: `Signatures for ${contractTitle(n)}` });
      await expect(d).toBeVisible({ timeout: 30_000 });
      const f = d.locator('form.dr__sec');
      for (let i = 1; i < want; i++) await f.getByRole('button', { name: /^\+ Add signer$/ }).click();
      const rr = f.locator('.gn-li');
      for (let i = 0; i < want; i++) {
        await typeInto(rr.nth(i).locator('input.inp').nth(0), `${TAG} Signer ${pad(n)}-${i + 1}`);
        await typeInto(rr.nth(i).locator('input.inp').nth(1), `s05.signer${pad(n)}${i + 1}@example.com`);
      }
      // Two steps, deliberately: the form opens a `ConfirmDialog` naming every
      // address the link will go to, and nothing is sent until it is confirmed.
      // The screen's own note says so, and skipping the dialog would be testing
      // a send the product does not make.
      await saveAndWait(page, async () => {
        await f.getByRole('button', { name: /^Send for signature$/ }).click();
        const confirm = page.getByRole('alertdialog');
        await expect(confirm, 'sending for signature did not ask for confirmation, and it ' +
          'emails every signer').toBeVisible({ timeout: 20_000 });
        await confirm.getByRole('button', { name: /^Send$/ }).click();
      }, /\/send-for-signature$/, `sending ${contractTitle(n)} to ${want} signer(s)`);
      signers += want;
      await closeDrawer(page, d);
    }
    expect(signers, `wanted ${N_SIGNERS} signers across ${N_CONTRACTS} contracts`).toBe(N_SIGNERS);

    console.log(`\n  05.15 — contracts: ${made.typed} typed, ${made.found} already present, ` +
      `${contracts.length} on the register\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.16 · the billing spine — SPLIT INTO FIVE, BECAUSE ONE OF THEM IS BROKEN
  // ──────────────────────────────────────────────────────────────────────────
  //
  // These five surfaces were one test until the first run, when
  // `POST /v1/ganit/billing/rate-cards` answered 422 on every attempt and took
  // metered usage and SLA credits down with it — two §4 lines reported as
  // untested when they had simply never been reached. A test that aborts is a
  // test that hides everything after it, so each surface is now its own, and
  // 05.16c fails alone with the wire that refused it.
  //
  // The five share `inModal` / `mfld` / `saveModal` below: all five tabs edit
  // inside `ui/Modal`, which is a real `role="dialog"` with the sheet's title
  // as its accessible name.

  /** The five billing tabs all edit inside `ui/Modal` — a real role="dialog". */
  async function inModal(page: Page, title: RegExp) {
    const m = page.getByRole('dialog', { name: title });
    await expect(m, `the "${title}" dialog did not open`).toBeVisible({ timeout: 30_000 });
    return m;
  }
  const mfld = (m: Locator, label: string) =>
    m.locator('label.fld').filter({ hasText: label }).first();
  async function saveModal(page: Page, m: Locator, urlRe: RegExp, what: string) {
    await saveAndWait(page, async () => {
      await m.getByRole('button', { name: /^Save$/ }).click();
    }, urlRe, what);
    await expect(m, 'the dialog stayed open after a successful save').toBeHidden({ timeout: 20_000 });
  }

  test('05.16a four billing profiles, one per client', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const clients = await apiRows(page, '/api/v1/graha/clients');
    expect(clients.length, 'no CRM companies to bill').toBeGreaterThanOrEqual(N_PROFILES);

    const p = await openTab(page, 'billing-profiles', 'billing profiles');
    const existing = await apiRows(page, '/api/v1/ganit/billing/profiles');
    const profileClient = (n: number) => String(clients[n - 1].name);

    for (let n = 1; n <= N_PROFILES; n++) {
      if (existing.some((r) => String(r.client_name) === profileClient(n))) continue;
      await p.getByRole('button', { name: /^\+ Billing Profile$/ }).first().click();
      const m = await inModal(page, /Billing Profile/);
      // The client select offers only companies that have no profile yet, so
      // this is also the check that a second profile cannot be opened against
      // the same customer.
      await pickByLabel(mfld(m, 'Client').locator('select.inp'), profileClient(n), 'client');
      await mfld(m, 'Billing Cycle').locator('select.inp')
        .selectOption(['monthly', 'quarterly', 'annual', 'monthly'][n - 1]);
      await typeInto(mfld(m, 'Anchor Day').locator('input.inp'), String([1, 5, 15, 28][n - 1]));
      await typeInto(mfld(m, 'Payment Terms').locator('input.inp'), String([15, 30, 45, 60][n - 1]));
      await mfld(m, 'GST Treatment').locator('select.inp').selectOption({ index: (n - 1) % 2 });
      await typeInto(mfld(m, 'Credit Limit').locator('input.inp'), String(500000 * n));
      await typeInto(mfld(m, 'Notes').locator('textarea.inp'), `${TAG} profile ${pad(n)} · ${RUN}`);
      await saveModal(page, m, /\/v1\/ganit\/billing\/profiles$/, `billing profile ${n}`);
      await settle(page);
    }

    const profiles = await apiRows(page, '/api/v1/ganit/billing/profiles');
    expect(profiles.length, `wanted at least ${N_PROFILES} billing profiles, the list holds ` +
      `${profiles.length}${dumpWire(wire)}`).toBeGreaterThanOrEqual(N_PROFILES);
    for (const r of profiles.slice(0, N_PROFILES)) {
      expect(String(r.client_name || ''), 'a billing profile names no client — the whole record ' +
        'is "how this customer is billed", so an unattached one bills nobody').not.toBe('');
      expect(Number(r.anchor_day), `${r.client_name}: the anchor day must sit in 1–28, so a ` +
        'monthly cycle cannot fall off the end of February').toBeGreaterThanOrEqual(1);
      expect(Number(r.anchor_day)).toBeLessThanOrEqual(28);
    }
    console.log(`\n  05.16a — billing profiles: ${profiles.length} on the list\n`);
    assertNoUncaught(con);
  });

  test('05.16b six service lines against those profiles', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const profiles = await apiRows(page, '/api/v1/ganit/billing/profiles');
    expect(profiles.length, '05.16a must run first — a service line hangs off a billing profile')
      .toBeGreaterThan(0);

    const p = await openTab(page, 'service-lines', 'service lines');
    const existing = await apiRows(page, '/api/v1/ganit/billing/service-lines');
    const KINDS = ['retainer', 'subscription', 'one_off'];

    for (let n = 1; n <= N_SERVICE_LINES; n++) {
      if (existing.some((r) => String(r.description) === serviceLineDesc(n))) continue;
      await p.getByRole('button', { name: /^\+ Service Line$/ }).first().click();
      const m = await inModal(page, /Service Line/);
      await pickByLabel(mfld(m, 'Billing Profile').locator('select.inp'),
        String(profiles[(n - 1) % profiles.length].client_name), 'billing profile');
      await mfld(m, 'Kind').locator('select.inp').selectOption(KINDS[(n - 1) % KINDS.length]);
      await typeInto(mfld(m, 'Description').locator('input.inp'), serviceLineDesc(n));
      await typeInto(mfld(m, 'Amount').locator('input.inp'), String(15000 + n * 2500));
      await mfld(m, 'Cadence').locator('select.inp').selectOption({ index: (n - 1) % 2 });
      await setDate(m, /Period Start/, `2026-08-${pad(n)}`);
      // Ended lines render in their own dimmed table, so half of these are
      // given an end date inside the year and half are left open — both
      // sections have to be real for the split to mean anything.
      if (n % 2 === 0) await setDate(m, /Period End/, `2027-06-${pad(n + 10)}`);
      await saveModal(page, m, /\/v1\/ganit\/billing\/service-lines$/, `service line ${n}`);
      await settle(page);
    }

    const serviceLines = (await apiRows(page, '/api/v1/ganit/billing/service-lines'))
      .filter((r) => String(r.description || '').startsWith(`${TAG} Service line `));
    expect(serviceLines.length, `wanted ${N_SERVICE_LINES} service lines, the list holds ` +
      `${serviceLines.length}${dumpWire(wire)}`).toBe(N_SERVICE_LINES);
    for (const r of serviceLines) {
      expect(String(r.client_name || ''), `${r.description} is billed to nobody`).not.toBe('');
      expect(Number(r.amount), `${r.description} is worth nothing`).toBeGreaterThan(0);
    }
    console.log(`\n  05.16b — service lines: ${serviceLines.length}\n`);
    assertNoUncaught(con);
  });

  test('05.16c three vendor rate cards', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const vendors = (await apiRows(page, '/api/v1/ganit/vendors'))
      .filter((v) => String(v.name || '').startsWith(`${TAG} Vendor `));
    expect(vendors.length, '05.03 must run first — a rate card is a supplier\'s price list')
      .toBeGreaterThanOrEqual(N_RATE_CARDS);

    const p = await openTab(page, 'rate-cards', 'rate cards');
    const existing = await apiRows(page, '/api/v1/ganit/billing/rate-cards');

    /**
     * ⚠ EXPECTED TO FAIL, AND THE FAILURE IS THE PRODUCT'S, NOT THE FIXTURE'S.
     *
     * Measured 2026-08-29 against the deployed service:
     *
     *   POST /api/v1/ganit/billing/rate-cards → 422
     *   {"detail":[{"type":"string_type","loc":["body","notes"],
     *               "msg":"Input should be a valid string","input":null}]}
     *
     * `RateCardsTab.save()` builds `notes: form.notes || null`, and
     * `RateCardCreate.notes` is `str = ""` — not `str | None`
     * (`routers/client_billing.py:239`). So a rate card created without a note
     * is refused every single time, and the screen reports it as "Failed to
     * save" with no field named. Its sibling `RateCardUpdate.notes` IS
     * `str | None` (`:249`), so the same blank note is accepted on an edit and
     * refused on a create — which is why this cannot be read as a deliberate
     * requirement.
     *
     * The note is deliberately NOT typed here to get past it. Leaving a note
     * blank is the ordinary case for a price list, and filling one in would
     * turn a shipped blocker into a green test — the single failure mode
     * proposal 93 §14 reserves the judgement for. No verdict is offered on
     * whether the fix belongs in the model or in the form.
     */
    for (let n = 1; n <= N_RATE_CARDS; n++) {
      if (existing.some((r) => String(r.item_category) === rateCardCategory(n))) continue;
      await p.getByRole('button', { name: /^\+ Rate Card$/ }).first().click();
      const m = await inModal(page, /Rate Card/);
      await pickByLabel(mfld(m, 'Vendor').locator('select.inp'), vendorName(n), 'vendor');
      await typeInto(mfld(m, 'Item Category').locator('input.inp'), rateCardCategory(n));
      await typeInto(mfld(m, 'Rate').locator('input.inp'), String(750 * n));
      await typeInto(mfld(m, 'Unit').locator('input.inp'), ['hours', 'units', 'kg'][n - 1]);
      await setDate(m, /Effective From/, `2026-08-0${n}`);
      await setDate(m, /Effective To/, `2027-06-0${n}`);
      await saveModal(page, m, /\/v1\/ganit\/billing\/rate-cards$/,
        `rate card ${n} — with NO note, which is the ordinary case for a price list`);
      await settle(page);
    }

    const rateCards = (await apiRows(page, '/api/v1/ganit/billing/rate-cards'))
      .filter((r) => String(r.item_category || '').startsWith(`${TAG} Rate `));
    expect(rateCards.length, `wanted ${N_RATE_CARDS} rate cards, the list holds ` +
      `${rateCards.length}${dumpWire(wire)}`).toBe(N_RATE_CARDS);
    console.log(`\n  05.16c — rate cards: ${rateCards.length}\n`);
    assertNoUncaught(con);
  });

  test('05.16d twelve metered usage rows', async ({ page }) => {
    test.setTimeout(45 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const profiles = await apiRows(page, '/api/v1/ganit/billing/profiles');
    expect(profiles.length, '05.16a must run first — usage is metered against a billing profile')
      .toBeGreaterThan(0);

    const p = await openTab(page, 'metered-usage', 'metered usage');
    const existing = await apiRows(page, '/api/v1/ganit/billing/metered-usage');

    for (let n = 1; n <= N_USAGE; n++) {
      if (existing.some((r) => String(r.metric) === usageMetric(n))) continue;
      await p.getByRole('button', { name: /^\+ Usage Entry$/ }).first().click();
      const m = await inModal(page, /Usage Entry/);
      await pickByLabel(mfld(m, 'Billing Profile').locator('select.inp'),
        String(profiles[(n - 1) % profiles.length].client_name), 'billing profile');
      await typeInto(mfld(m, 'Metric').locator('input.inp'), usageMetric(n));
      await typeInto(mfld(m, 'Quantity').locator('input.inp'), String(4 + n));
      await typeInto(mfld(m, 'Unit').locator('input.inp'), 'hours');
      await typeInto(mfld(m, 'Rate').locator('input.inp'), String(900 + n * 25));
      await setDate(m, /^Date/, `2026-08-${pad(((n - 1) % 27) + 1)}`);
      await typeInto(mfld(m, 'Source Reference').locator('input.inp'), `${TAG}/USAGE/${pad(n)}`);
      await saveModal(page, m, /\/v1\/ganit\/billing\/metered-usage$/, `usage ${n}`);
      await settle(page);
    }

    const usage = (await apiRows(page, '/api/v1/ganit/billing/metered-usage'))
      .filter((r) => String(r.metric || '').startsWith(`${TAG} Usage `));
    expect(usage.length, `wanted ${N_USAGE} metered usage rows, the list holds ${usage.length}` +
      `${dumpWire(wire)}`).toBe(N_USAGE);
    for (const r of usage) {
      expect(Number(r.quantity), `${r.metric} records no quantity`).toBeGreaterThan(0);
      expect(Number(r.rate), `${r.metric} carries no rate, so it can never be billed`)
        .toBeGreaterThan(0);
    }
    console.log(`\n  05.16d — metered usage: ${usage.length} rows\n`);
    assertNoUncaught(con);
  });

  test('05.16e three SLA credits', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const vendors = (await apiRows(page, '/api/v1/ganit/vendors'))
      .filter((v) => String(v.name || '').startsWith(`${TAG} Vendor `));
    expect(vendors.length, '05.03 must run first').toBeGreaterThanOrEqual(N_SLA);
    // Rate cards are OPTIONAL on a credit and 05.16c is expected to fail, so
    // this reads what is actually there rather than assuming three.
    const rateCards = (await apiRows(page, '/api/v1/ganit/billing/rate-cards'))
      .filter((r) => String(r.item_category || '').startsWith(`${TAG} Rate `));

    const p = await openTab(page, 'sla-credits', 'sla credits');
    const existing = await apiRows(page, '/api/v1/ganit/billing/sla-credits');

    for (let n = 1; n <= N_SLA; n++) {
      if (existing.some((r) => String(r.sla_metric) === slaMetric(n))) continue;
      await p.getByRole('button', { name: /^\+ SLA Credit$/ }).first().click();
      const m = await inModal(page, /SLA Credit/);
      await pickByLabel(mfld(m, 'Vendor').locator('select.inp'), vendorName(n), 'vendor');
      await typeInto(mfld(m, 'SLA Metric').locator('input.inp'), slaMetric(n));
      await typeInto(mfld(m, 'Threshold').locator('input.inp'), '99.5');
      // Below the threshold on purpose — a credit exists because the supplier
      // missed it, so an "actual" above it would be a credit with no cause.
      await typeInto(mfld(m, 'Actual').locator('input.inp'), String(97 + n * 0.1));
      await typeInto(mfld(m, 'Credit Amount').locator('input.inp'), String(5000 * n));
      await setDate(m, /Period/, `2026-08-0${n}`);
      if (rateCards.length >= n) {
        await pickByLabel(mfld(m, 'Rate Card').locator('select.inp'),
          rateCardCategory(n), 'rate card');
      }
      await saveModal(page, m, /\/v1\/ganit\/billing\/sla-credits$/, `sla credit ${n}`);
      await settle(page);
    }

    const sla = (await apiRows(page, '/api/v1/ganit/billing/sla-credits'))
      .filter((r) => String(r.sla_metric || '').startsWith(`${TAG} SLA `));
    expect(sla.length, `wanted ${N_SLA} SLA credits, the list holds ${sla.length}${dumpWire(wire)}`)
      .toBe(N_SLA);
    for (const r of sla) {
      expect(Number(r.actual), `${r.sla_metric}: a credit is owed because the actual fell BELOW ` +
        'the threshold, and this one did not').toBeLessThan(Number(r.threshold));
      expect(Number(r.credit_amount), `${r.sla_metric} credits nothing`).toBeGreaterThan(0);
    }
    console.log(`\n  05.16e — SLA credits: ${sla.length}` +
      `${rateCards.length ? '' : ' (no rate card linked — 05.16c could not create one)'}\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.17 · two TDS challans, ITNS-281, rendered as PDFs
  // ──────────────────────────────────────────────────────────────────────────
  test('05.17 two TDS challan counterfoils generate as PDFs', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    const fail = watchFailures(page);
    await signIn(page);
    const p = await openTab(page, 'stats', 'GST filing');

    /**
     * ITNS-281's own vocabulary, and the reason each field is typed rather than
     * defaulted: the MAJOR HEAD is a property of the DEDUCTEE (0020 company,
     * 0021 not a company) and can never be inferred from the deductor, and the
     * CIN — BSR code, tender date and challan serial — is issued by the
     * collecting bank, so Kartavaya does not hold it and must be given it.
     *
     * The two challans are deliberately one of each major head, which is the
     * distinction a preparer gets wrong.
     */
    const CHALLANS = [
      { period: '2026-07', head: '0020', type: '200', bsr: '0004329', serial: '00021', bank: 'HDFC Bank', deposit: '2026-08-07' },
      { period: '2026-08', head: '0021', type: '200', bsr: '0510043', serial: '00022', bank: 'State Bank of India', deposit: '2026-09-05' },
    ];
    expect(CHALLANS.length, `§4 asks for ${N_CHALLANS} challans`).toBe(N_CHALLANS);

    const made: string[] = [];
    for (const c of CHALLANS) {
      con.at(`challan ${c.period}`);
      const period = p.locator('input.gn-bar__sel[type=month]').first();
      await expect(period, 'the GST filing screen offers no tax-period control').toBeVisible({ timeout: 30_000 });
      await period.fill(c.period);
      await settle(page);

      const open = p.getByRole('button', { name: /^Prepare counterfoil$/ });
      await expect(open, 'there is no way to prepare a TDS challan').toBeVisible({ timeout: 30_000 });
      await open.click();

      const fld = (label: string) => p.locator('label.fld').filter({ hasText: label }).first();
      await setDate(p, /Deposit date/, c.deposit);
      await setDate(p, /Tender date/, c.deposit);
      await fld('Major head').locator('select.inp').selectOption(c.head);
      await fld('Type of payment').locator('select.inp').selectOption(c.type);
      await typeInto(fld('BSR code').locator('input.inp'), c.bsr);
      await typeInto(fld('Challan serial').locator('input.inp'), c.serial);
      await typeInto(fld('Challan number').locator('input.inp'), `${TAG}${c.serial}`);
      await typeInto(fld('Collecting bank').locator('input.inp'), c.bank);

      const btn = p.getByRole('button', { name: /^Download challan$/ });
      await expect(btn, 'the challan cannot be generated').toBeVisible();
      // The button is disabled while a shape is wrong — a seven-digit BSR and a
      // five-digit serial are the two the form checks before spending a round
      // trip, and a preparer should learn a mistyped BSR from the field.
      await expect(btn, `the challan form still reports a problem with ${c.period}: the BSR code ` +
        'must be seven digits and the challan serial five').toBeEnabled({ timeout: 20_000 });

      /* A refusal here is NOT a missing download — it is a document the server
         declines to emit, and it says which particular is missing in an inline
         `role="alert"` block rather than a toast, precisely because these are a
         worklist. Waiting only for the file turns that into "no download after
         90 seconds", which names nothing. So both outcomes are awaited and the
         refusal is read off the screen the user is looking at. */
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 60_000 }).catch(() => null),
        btn.click(),
      ]);
      if (!dl) {
        const said = await p.locator('.docerr').innerText().catch(() => '');
        expect(dl, `the ${c.period} TDS challan was REFUSED, not generated.
` +
          `     the screen says: ${said.replace(/\s+/g, ' ').trim() || '(nothing)'}
` +
          `     the wire said:${dumpFailures(fail)}
` +
          '     ⚠ Unicode Group has no TAN on its company profile, and ' +
          '`validate_tds_challan` treats a missing TAN as BLOCKING (s.203A — the PAN is ' +
          'not a substitute on ITNS-281). The standing product rule is that GSTIN, PAN ' +
          'and TAN are non-mandatory and must block nothing. Those two can both be read ' +
          'as correct — a rule about CAPTURE against a rule about EMISSION — and this ' +
          'suite does not choose between them. 93 §14 keeps the verdict.').toBeTruthy();
      }
      const dest = path.join(DL, `${TAG}-challan-${c.period}.pdf`);
      await dl!.saveAs(dest);
      const buf = fs.readFileSync(dest);
      expect(buf.length, `the ${c.period} challan downloaded as an empty file`).toBeGreaterThan(400);
      assertPdf(buf, `TDS challan ${c.period}`);
      made.push(`${c.period} head ${c.head} · ${buf.length} bytes`);

      // Scoped to the challan panel's own head. A bare /^Close$/ across the
      // page matches every collapsible on the GST filing screen, and the first
      // in DOM order is not this one.
      await p.locator('.gn-panel').filter({ hasText: 'TDS challan' })
        .getByRole('button', { name: /^Close$/ }).click();
    }

    expect(made.length, `wanted ${N_CHALLANS} challans`).toBe(N_CHALLANS);
    console.log(`\n  05.17 — TDS challans: ${made.join(' · ')}\n`);
    assertNoUncaught(con);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.18 · the read-only screens, now that there is something to read
  // ──────────────────────────────────────────────────────────────────────────
  test('05.18 ageing, collections, GST filing, analytics, timesheet and settings all render real figures', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    const fail = watchFailures(page);
    await signIn(page);

    // ── ageing, both directions ────────────────────────────────────────────
    con.at('ageing');
    let p = await openTab(page, 'ageing', 'ageing');
    const receivable = await apiOne(page, '/api/v1/ganit/billing/ageing?direction=receivable');
    const payable = await apiOne(page, '/api/v1/ganit/billing/ageing?direction=payable');
    await expect(p.locator('.gn-section-head').filter({ hasText: 'Receivables' }),
      'the ageing screen shows no receivables section after 45 invoices were raised')
      .toBeVisible({ timeout: 30_000 });
    await expect(p.locator('.gn-section-head').filter({ hasText: 'Payables' }),
      'the ageing screen shows no payables section after 14 bills were recorded').toBeVisible();
    expect(receivable, 'the receivable ageing endpoint answered nothing').toBeTruthy();
    expect(payable, 'the payable ageing endpoint answered nothing').toBeTruthy();

    // ── collections ────────────────────────────────────────────────────────
    con.at('collections');
    p = await openTab(page, 'collections', 'collections');
    const coll = await apiRows(page, '/api/v1/ganit/collections?days=365');
    await expect(p.locator('.gn-coll__lede'), 'the collections screen does not say what is outstanding')
      .toBeVisible({ timeout: 30_000 });
    if (coll.length > 0) {
      await expect(p.locator('.gn-coll__lede'), 'the collections lede does not count the unpaid invoices')
        .toContainText(new RegExp(`${coll.length} unpaid`));
      // The sentence that keeps "opened" honest: a link opened is not a payment,
      // and a payment appears only once it is matched against the bank.
      await expect(p.locator('.gn-coll__note'), 'the collections screen no longer explains that ' +
        'opening a link is not paying — the only route to paid is reconciliation')
        .toContainText(/matched against your bank statement/i);
    } else {
      await expect(p.locator('.empty__title')).toHaveText(/Nothing outstanding/i);
    }

    // ── GST filing, the claim this product actually makes ──────────────────
    con.at('stats');
    p = await openTab(page, 'stats', 'GST filing');
    await p.locator('input.gn-bar__sel[type=month]').first().fill('2026-08');
    await settle(page);
    await expect(p.locator('.gn-panel__h').first(),
      'the GST filing screen rendered no panel at all').toBeVisible({ timeout: 40_000 });
    const filingText = await p.innerText();
    expect(filingText.length, 'the GST filing screen painted nothing').toBeGreaterThan(200);

    // ── analytics, timesheet, settings ─────────────────────────────────────
    for (const id of ['analytics', 'timesheet', 'settings']) {
      con.at(id);
      const label = TABS.find((t) => t.id === id)!.label;
      const q = await openTab(page, id, label);
      /* POLLED, not read once. Each of these panels paints a skeleton first and
         fills in when its fetch lands, and a single read straight after
         `settle()` catches the skeleton — which has no text — and reports "the
         screen painted nothing" about a screen that paints plenty. Same trap
         `pickOption` documents for a picker read too early: a false product
         finding is worse than a flake. */
      await expect
        .poll(async () => (await q.innerText().catch(() => '')).trim().length, {
          message: `the Finance "${id}" screen painted nothing at all`,
          timeout: 30_000,
        })
        .toBeGreaterThan(20);
    }

    // The timesheet screen's whole purpose is raising an invoice from time
    // entries, so the control has to be there even when there is no time to bill.
    const ts = await openTab(page, 'timesheet', 'timesheet');
    await expect(ts.locator('.gn-form__t'), 'the timesheet screen offers no way to invoice from time')
      .toContainText(/Invoice from timesheets/i, { timeout: 30_000 });

    // Same gate as 05.01, for the same reason: the GSTR-1 preview's deliberate
    // 422 on an unregistered supplier logs a browser resource notice, and
    // failing on it would be failing on correct behaviour. Uncaught exceptions
    // and 5xx are the failures; every 4xx is printed for the reader.
    const fourxx = fail.filter((l) => /\s4\d\d\s/.test(l));
    const fivexx = fail.filter((l) => /\s5\d\d\s/.test(l));
    if (fourxx.length) {
      console.log(`  05.18 — refusals received (reported, not ruled on):${dumpFailures(fourxx)}\n`);
    }
    expect(fivexx, `a read-only Finance screen received a SERVER error:${dumpFailures(fivexx)}`)
      .toHaveLength(0);
    assertNoUncaught(con);
    expect(con.errors.filter((e) => !/Failed to load resource/i.test(e.text)),
      `console errors on the read-only Finance screens:${dumpConsole(con)}` +
      `\n   the non-2xx responses behind them:${dumpFailures(fail)}`).toHaveLength(0);
    console.log('\n  05.18 — ageing, collections, GST filing, analytics, timesheet and settings all render\n');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.19 · §6 — the second execution must recognise its own output
  // ──────────────────────────────────────────────────────────────────────────
  test('05.19 every §4 count is exact, so a second execution verifies rather than duplicates', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    await signIn(page);

    /**
     * §6 is proved by RUNNING THE SUITE TWICE, not by claiming it — and this is
     * the test that makes the second run mean something. Every count below is
     * an EQUALITY against the §4 target, so a second execution that duplicated
     * anything reports a number that is too high rather than passing on a
     * "greater than zero" that could never fail.
     *
     * The marks are what make that possible: `S05 Product 07`, `S05-INV-31`,
     * `S05-BILL-04` and the rest are deterministic, so `ensure()` reads the
     * live list first and types only what is missing.
     */
    const counts: { what: string; got: number; want: number }[] = [];
    const push = (what: string, got: number, want: number) => counts.push({ what, got, want });

    const products = (await apiRows(page, '/api/v1/products'))
      .filter((r) => String(r.name || '').startsWith(`${TAG} Product `));
    push('products', products.length, N_PRODUCTS);
    push('products carrying a cost', products.filter((r) => r.cost_price != null).length, N_COSTED_PRODUCTS);

    const vendors = (await apiRows(page, '/api/v1/ganit/vendors'))
      .filter((r) => String(r.name || '').startsWith(`${TAG} Vendor `));
    push('vendors', vendors.length, N_VENDORS);

    const cats = (await apiRows(page, '/api/v1/ganit/expense-categories'))
      .filter((r) => String(r.name || '').startsWith(`${TAG} Category `));
    push('expense categories', cats.length, N_CATEGORIES);

    const expenses = (await apiRows(page, '/api/v1/ganit/expenses'))
      .filter((r) => String(r.title || '').startsWith(`${TAG} Expense `));
    push('expenses', expenses.length, N_EXPENSES);

    const invoices = await myInvoices(page, { deep: true });
    push('invoices', invoices.size, N_INVOICES);
    push('final invoices', [...invoices.values()].filter((r) => r.doc_status !== 'draft').length, N_FINAL);
    push('draft invoices', [...invoices.values()].filter((r) => r.doc_status === 'draft').length, N_DRAFT);
    push('invoices crediting a salesperson',
      [...invoices.values()].filter((r) => r.salesperson_id).length, N_SALESPERSON);

    let receipts = 0;
    for (let n = 1; n <= N_PARTIAL + N_SINGLE_PAY; n++) {
      const inv = invoices.get(invoiceRef(n));
      if (!inv) continue;
      const d = await apiOne(page, `/api/v1/ganit/invoices/${inv.id}`);
      receipts += (d?.payments || []).length;
    }
    push('receipts', receipts, N_PAYMENTS);

    const bills = (await apiRows(page, '/api/v1/ganit/vendor-bills'))
      .filter((r) => String(r.bill_number || '').startsWith(`${TAG}-BILL-`));
    push('vendor bills', bills.length, N_BILLS);

    let vendorPayments = 0;
    for (const b of bills) {
      const d = await apiOne(page, `/api/v1/ganit/vendor-bills/${b.id}`);
      vendorPayments += (d?.payments || []).length;
    }
    push('vendor payments', vendorPayments, N_VENDOR_PAYMENTS);

    const lines = await apiRows(page, '/api/v1/ganit/bank-statements');
    push('bank statement lines', lines.length, 24);
    push('bank lines left open', lines.filter((l) => !l.is_reconciled).length, N_UNMATCHED_TARGET);

    const recurring = (await apiRows(page, '/api/v1/ganit/recurring'))
      .filter((r) => Array.from({ length: N_RECURRING }, (_, i) => recurringAmount(i + 1))
        .includes(Number(r.subtotal)));
    push('recurring schedules', recurring.length, N_RECURRING);

    const contracts = (await apiRows(page, '/api/v1/ganit/contracts'))
      .filter((r) => String(r.title || '').startsWith(`${TAG} Contract `));
    push('contracts', contracts.length, N_CONTRACTS);

    const serviceLines = (await apiRows(page, '/api/v1/ganit/billing/service-lines'))
      .filter((r) => String(r.description || '').startsWith(`${TAG} Service line `));
    push('service lines', serviceLines.length, N_SERVICE_LINES);
    const rateCards = (await apiRows(page, '/api/v1/ganit/billing/rate-cards'))
      .filter((r) => String(r.item_category || '').startsWith(`${TAG} Rate `));
    push('rate cards', rateCards.length, N_RATE_CARDS);
    const usage = (await apiRows(page, '/api/v1/ganit/billing/metered-usage'))
      .filter((r) => String(r.metric || '').startsWith(`${TAG} Usage `));
    push('metered usage rows', usage.length, N_USAGE);
    const sla = (await apiRows(page, '/api/v1/ganit/billing/sla-credits'))
      .filter((r) => String(r.sla_metric || '').startsWith(`${TAG} SLA `));
    push('SLA credits', sla.length, N_SLA);

    console.log('\n  05.19 — §4 volumes against the live database:\n' +
      counts.map((c) => `     ${c.got === c.want ? '✓' : '✗'} ${c.what.padEnd(34)} ` +
        `${String(c.got).padStart(4)} / ${c.want}`).join('\n') + '\n');

    const wrong = counts.filter((c) => c.got !== c.want);
    expect(wrong.map((c) => `${c.what}: ${c.got} (wanted ${c.want})`),
      'a §4 volume is not exact. A count ABOVE the target on a second execution means ' +
      '`ensure()` failed to recognise this suite\'s own marks and duplicated them; a count BELOW ' +
      'it means the run that made them did not finish. Both are §6 failures and neither is ' +
      'ruled on here.').toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 05.20 · not one UUID on any Finance screen
  // ──────────────────────────────────────────────────────────────────────────
  test('05.20 no Finance screen paints a UUID', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    /**
     * ⚠ `frontend/scripts/check-rendered-ids.mjs` IS STATIC AND POSITIONAL.
     *
     * It reads JSX and cannot see an id the SERVER pre-formatted into a string
     * — two blind spots of exactly that shape have already been found. So this
     * reads the PAINTED TEXT of every Finance screen, now that the module holds
     * forty-five invoices, fourteen suppliers and a reconciled bank statement,
     * and looks for the shape of a uuid in what a person can actually see.
     *
     * A hit is reported with the screen and the surrounding words. No verdict:
     * some ids legitimately appear in a URL and this does not read URLs.
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

    // One record drawer as well — the surface most likely to carry one, because
    // it renders a single row's every field rather than a chosen set of columns.
    const p = await openTab(page, 'invoices', 'invoices');
    const invoices = await myInvoices(page);
    if (invoices.size) {
      const inv = [...invoices.values()][0];
      const drawer = await openInvoice(page, p, String(inv.invoice_number));
      const text = await drawer.innerText();
      const m = text.match(new RegExp(UUID.source, 'gi'));
      if (m) found.push(`invoice drawer: ${[...new Set(m)].slice(0, 3).join(', ')}`);
      await closeDrawer(page, drawer);
    }

    expect(found, 'a UUID is painted on a Finance screen. Names, never ids — and the ratchet ' +
      'cannot catch this one, because it is static and positional and cannot see an id the ' +
      `server formatted into a string:\n     ${found.join('\n     ')}`).toEqual([]);

    console.log(`\n  05.20 — ${TABS.length} Finance screens and one record drawer scanned, ` +
      'no UUID painted\n');
    assertNoUncaught(con);
  });
});
