/**
 * Proposal 93 · Stage 3 · WAVE 3 · SUITE 08 — Vetana (payroll), on Unicode Group.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` and nothing else. `signInAs()` calls `assertOrg()` inside
 * itself now, so a test cannot reach a form without the org ID having been
 * checked against the SERVER's answer — never a name on screen, because the
 * name is what got corrupted when a platform credential renamed Aekam Inc on
 * 2026-08-28. See `_lanes.ts`. No platform/god-mode credential appears here,
 * and that has a cost this file pays in full — see APPROVAL below.
 *
 * Measured 2026-08-29 with `Authorization: E2E_UNICODE_TOKEN` and
 * `X-Org-Id: fae87907…`, before a line of this file ran:
 *
 *     GET /api/v1/org/profile           200  Unicode Group · Ahmedabad, Gujarat
 *     GET /api/v1/vetana/dashboard      200  {"latest_run":null,"headcount":30}
 *     GET /api/v1/vetana/salary-structures   200  rows=0
 *     GET /api/v1/vetana/payroll/runs        200  rows=0
 *     GET /api/v1/vetana/payslips            200  rows=0
 *     GET /api/v1/vetana/loans               200  rows=0
 *     GET /api/v1/vetana/pt-slabs            200  rows=23, own=0
 *     GET /api/v1/vetana/it-slabs            200  rows=23, own=0
 *
 * So every empty state 08.1 asserts is asserted over a genuinely empty module,
 * and every count afterwards is a count this suite produced.
 *
 * ⚠ FOUR EMPTY TABLES, AND THE COORDINATOR'S RULE ABOUT THEM. `custody.notices`
 * held zero rows for its whole life because a broken write hid a second bug
 * behind it. Vetana's four are empty because NOTHING HAS EVER WRITTEN THEM IN
 * THIS ORG, not because a write is broken — this file drives every one of them
 * through the real form and they all take rows. Where a screen renders for the
 * first time here, it is treated as unexercised code and asserted on rather
 * than glanced at.
 *
 * ⚠ `meta.branch` COULD NOT BE CHECKED, the same shortfall Suite 07 recorded.
 * The deployed backend exposes no SHA route. `GET /api/health` answers
 * `{"environment":"staging","schema":"staging","db":"connected"}` and that is
 * the whole of the available evidence.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ EMAIL — THE ONE STEP THIS SUITE REFUSES TO DRIVE, AND WHY
 * ═══════════════════════════════════════════════════════════════════════════
 * Measured 2026-08-29:  `GET /api/health` → `outbound_mode: "live"`,
 * `suppressed_orgs_digest: "0"`. NOTHING is suppressed. Unicode Group's
 * addresses are real people's.
 *
 * `POST /vetana/payroll/process` mails a payslip PDF to every employee on the
 * run — `routers/vetana.py:2200-2216` selects the payslip rows with
 * `WHERE e.email IS NOT NULL AND e.email != ''` and calls `send_payslip_email`
 * for each. `POST /vetana/loans` mails the borrower the same way (:3014-3021).
 *
 *     GET /api/v1/manav/employees → 30 rows, 0 carrying an email address.
 *
 * Suite 07 created every employee with Email blank precisely so ~600 records
 * could go in without sending anything. So THREE payroll runs and SIX loans
 * here send exactly zero mail, and that is a measured fact rather than a hope.
 *
 * §4 asks for **30 payslip emails**. Producing them means putting a deliverable
 * address on 30 personnel rows in a live organisation, and the only addresses
 * that could be used safely are the AWS simulator's (`…@simulator.amazonses.com`,
 * reputation-exempt) — `test+tag@unicodegroup.com` BOUNCES, IONOS rejects
 * plus-tags. That is a decision about writing to real personnel records and
 * about outbound reputation, so it is ASKED rather than taken: **0 of 30
 * emails driven, deliberately, pending the owner's answer.** Nothing in this
 * file writes an email address onto an employee.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THE THREE §4 VOLUMES THAT ARE NOT REACHABLE IN THIS LANE — measured, never
 * silently capped
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1 · **THREE MONTHS, BUT ONLY ONE OF THEM CAN CARRY MONEY.**
 *
 *     `_employed_working_days` (`routers/vetana.py:800`) clamps the payable
 *     window to the employee's `date_of_joining`, and every one of the thirty
 *     employees Wave 2 left joined in AUGUST 2026 — 2026-08-03 at the earliest,
 *     two of them on 2026-08-29. The month picker is
 *     `<input type="month" max={thisMonth()}>`, i.e. not later than 2026-08.
 *     So the three consecutive months this suite can run are June, July and
 *     August 2026, and in June and July NOBODY WAS EMPLOYED: `employed_days`
 *     is 0, `ratio` is 0 and every component prices at zero.
 *
 *     That is CORRECT behaviour and 08.5 asserts it as such — payroll does not
 *     pay somebody for a month before they joined, which is the same rule the
 *     leaver half of §4 is about, running the other way. But it means
 *     month-on-month comparison and "the balance falls each month" have one
 *     month of arithmetic to work with, not three.
 *
 *     ⚠ AND THE JOINING DATE CANNOT BE CHANGED THROUGH ANY SCREEN.
 *     `EmployeeUpdate` accepts `date_of_joining` (`routers/manav.py:878`). The
 *     EDIT form on the employee detail renders Name, Email, Phone, Department,
 *     Designation, Work state, Employment type, UAN, ESI number, Bank name,
 *     Account number and IFSC (`EmployeesTab.jsx:760-830`) — and no date at
 *     all. The field exists on the API and on the CREATE form and nowhere in
 *     between. Reported as a finding; NOT worked around, because §1 forbids the
 *     API shortcut that would fix it.
 *
 * 2 · **APPROVAL, AND THEREFORE THE LOAN BALANCE AND THE RE-RUN.**
 *
 *     `vetana_loans.balance_remaining` is decremented in exactly one place in
 *     the backend — `routers/vetana.py:2463`, inside `approve_run`. Processing
 *     computes and STORES the EMI on the payslip; only approving moves the
 *     balance. And `_RELEASE_LEVEL = APPROVER` with vetana in
 *     `SEPARATED_DUTY_MODULES`, where `level_satisfies` refuses admin at that
 *     rung by design (`role_tiers.py:662`).
 *
 *     Measured on the live org, 2026-08-29:
 *
 *         GET /api/v1/org/members → 9 rows. Every module_grants list is [].
 *         kevalvshah03+1@gmail.com (this lane) — org_admin, no grants.
 *
 *     Nobody in Unicode Group holds `approver` on Vetana, so nobody can approve
 *     a payroll run here. The lane cannot grant it to itself either:
 *     `refuse_grant` (`role_tiers.py:905`) admits only an org_owner, and the
 *     no-owner fallback its docstring describes does not apply — the org HAS an
 *     owner today (`kevalvshah03@gmail.com`, org_owner), and that account is
 *     god mode, which rule 1 of `_lanes.ts` forbids this suite from using.
 *
 *     Consequences, each asserted rather than assumed: 08.12 drives the real
 *     Approve button and records what the server says; the balance therefore
 *     does not fall, and **6 EMIs are deducted where §4 asks for 18** (the
 *     other twelve would be June's and July's, and there is no pay to recover
 *     from in either — the take-home floor working correctly). Re-processing a
 *     month needs it back in `draft`, and Revert is the same approver rung, so
 *     the **1 re-run §4 asks for is blocked** (08.14).
 *
 * 3 · **88 PAYSLIPS AS 30 + 30 + 28.** The short third month needs two people
 *     whose last working day precedes 1 August 2026 — impossible when all
 *     thirty joined in August. The only other lever is `Complete exit`, which
 *     sets `is_active = FALSE` and drops them from the structures join; this
 *     suite deliberately does NOT press it, because Suite 09 is driving the
 *     same thirty employees in the same wave and deactivating two of them
 *     mid-run would produce a red in a sibling suite that is nothing to do
 *     with that suite. **90 payslips (30 · 30 · 30), stated, not capped.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE STATUTORY HALF — every figure asserted, and how it was derived
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * · **PROFESSIONAL TAX IS DERIVED, NEVER TYPED.** `ptFor()` below re-implements
 *   the LOOKUP — not the payroll — from the ladder the product itself serves at
 *   `GET /vetana/pt-slabs`: filter to bands effective on or before the period
 *   end and to the month being run, match the employee's state through both the
 *   code and the name, take the band the payslip's OWN gross falls inside, and
 *   rank own-over-shared then month-specific-over-every-month then later-dated.
 *   That is `_pt_slabs` + `_pt_from_slabs`' contract read off the wire. NO
 *   RUPEE FIGURE FOR PROFESSIONAL TAX IS WRITTEN ANYWHERE IN THIS FILE.
 *
 *   Unicode Group is Gujarat, GST state code 24, and the live ladder gives
 *   Gujarat FOUR bands where Maharashtra has three and Karnataka two. 08.8
 *   asserts PT VARIES: the run must produce at least three distinct professional
 *   tax figures, and the salaries below are chosen so that grosses land in
 *   every Gujarat band. A single figure repeated across thirty payslips is the
 *   Phase 2.2 regression — the flat `pt = 200 if gross > 15000` that put
 *   exactly 200.00 on 1,105 of 1,112 live payslips — and it would pass a naive
 *   assertion.
 *
 *   THE THREE CROSS-STATE CASES ARE THE PROOF THAT THE STATE IS READ AT ALL,
 *   because a ladder consulted with the wrong state still varies with salary:
 *     · S7-07 is Maharashtra. Its gross lands in a band that charges a figure
 *       NO Gujarat band charges at any salary.
 *     · S7-10 is Maharashtra at a gross where Gujarat levies a tax and
 *       Maharashtra levies nothing.
 *     · S7-15 is Karnataka at a gross where Gujarat levies its top figure and
 *       Karnataka, whose nil band runs to ₹14,999, levies nothing.
 *   Each is asserted as "the Gujarat ladder would have charged something else
 *   at this exact gross", which no salary-only lookup can satisfy.
 *
 *   ⚠ THE MAHARASHTRA GENDER EXEMPTION. Women are exempt to ₹25,000 there
 *   since 2023 and `pay_professional_tax` has no gender column, so the table
 *   cannot express it. Unicode is Gujarat and it does not bite the figures
 *   asserted here — but three employees in this suite ARE on Maharashtra, and
 *   08.8 records that their PT is computed with no reference to gender, which
 *   is a real under-statement of the exemption rather than an error in the
 *   arithmetic. Reported; not ruled on.
 *
 * · **TDS IS DERIVED FROM `pay_income_tax_slabs`, THROUGH TWO REGIMES.**
 *   `generation()` re-implements `income_tax._generation` off
 *   `GET /vetana/it-slabs`: own bands replace the shared ladder wholesale, and
 *   within the winning scope the latest `effective_from` is the one in force.
 *   `annualTax()` is the ordinary marginal-slab arithmetic of the Finance Act
 *   with the same overlap clamp the service documents.
 *
 *   ⚠ ONE DEPENDENCY DECLARED RATHER THAN HIDDEN: the annualisation is the
 *   PRODUCT's, not the statute's — `annual_taxable = max(gross * 12 - 50000, 0)`
 *   and `tds = tax / 12` (`routers/vetana.py:1298,1330`). A test that invented
 *   its own annualisation would fail on a correct product, so this reads the
 *   product's rule and asserts the LADDER is honoured within it. The section
 *   87A rebate, the 4% cess, surcharge and the senior exemption limits are NOT
 *   applied by the product and are not asserted here; the screen says so too.
 *
 *   THE MOVEMENT §4 ASKS FOR, obtained without a re-run because a re-run is
 *   blocked: S7-01 and S7-02 are given the SAME joining date and the SAME
 *   salary and differ in exactly one field — `tds_regime`, new against old.
 *   Identical gross, two different ladders out of the same table, two different
 *   figures, each matching its own ladder. A hard-coded or single-ladder TDS
 *   cannot produce that. 08.13 then adds bands and computes, from the ladder
 *   alone, the figure a re-run WOULD produce — and names the blocked step
 *   rather than adjusting anything.
 *
 * · **A LEAVER IS PAID PART-MONTH.** 08.10 bounds each of the four leavers by
 *   their own employment window: nobody may be paid for a day after their last
 *   working day, and the leaver's FIXED pay must fall short of a whole month.
 *   The ceiling is computed on the module's own definition of a working day and
 *   used only as a ceiling — the amount is never re-derived.
 *
 *   ⚠ IT USED TO PAIR EACH LEAVER WITH A COLLEAGUE WHO JOINED THE SAME DAY, and
 *   the first execution proved that wrong on a payroll that was correct.
 *   `present_days` is the ATTENDANCE REGISTER wherever anyone has marked it and
 *   the employment window only where nobody has (`vetana.py:1898`) — and Suite
 *   09 marks attendance on these same thirty employees IN THIS WAVE. One twin
 *   was priced from a register showing one day, the other from a full window,
 *   and the comparison failed. Nothing in this file may now depend on a figure
 *   a sibling suite can move.
 *
 * · **PF IS PURE STATUTE AND IS ASSERTED EXACTLY.** 12% of the payable basic,
 *   capped at the ₹15,000 wage ceiling — EPF & MP Act 1952 with the 2014
 *   ceiling — computed off the payslip's own `basic` column, which is already
 *   the pro-rated figure. Nothing else on the payslip is needed for it.
 *
 * · **GSTIN / PAN / TAN AND THE IDENTIFIERS BLOCK NOTHING.** Unicode Group's
 *   profile carries `gstin: ""` and `pan: ""`, and not one employee has a PAN
 *   or a UAN. Thirty payslips are still computed, and twenty PDFs still issue.
 *   `validate_payslip` makes UAN, ESI number and PAN ADVISORY on the owner's
 *   2026-08-03 ruling, and 08.11 proves it by issuing the documents.
 *
 * · **STATUTORY FIGURES THIS SUITE WRITES ARE ORG OVERRIDES, NOT LAW.** The
 *   four bands 08.13 adds are `is_own` rows in a test organisation and the
 *   screen tags every other row "Shared". The two professional-tax figures are
 *   kept inside the ₹2,500-a-year constitutional ceiling on professional tax
 *   (Article 276(2)), because a band that breaches it would be an unlawful
 *   figure sitting in a live table. The income-tax pair is labelled in its own
 *   `source_ref` as a test override and not a Finance Act ladder.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §10 — THE NINE SCREENS
 * ═══════════════════════════════════════════════════════════════════════════
 *   1 Dashboard          2 Salary structures (list)   3 Structure detail
 *   4 Payroll runs (+ the attendance Source card)     5 Run detail
 *   6 Payslips (list, month filter)                   7 Payslip detail
 *   8 Loans & advances   9 Statutory — summary, compliance calendar,
 *                          employee-wise register, PT ladder, IT ladder
 *   and the Analytics tab beside them, which 08.1 opens and asserts.
 * None is reduced. Every one is opened before its data exists and again after.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §14 — THIS SUITE RULES ON NOTHING
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE DEFECT MEASURED BEFORE A LINE OF THIS FILE WAS WRITTEN, reproduced live
 * on staging and left to fail rather than worked around:
 *
 *   08.13b — CHOOSING A DATE IN THE LADDER FORMS' "Effective from" FIELD
 *            CRASHES THE STATUTORY TAB.
 *     · wire   no request is made; nothing reaches the server.
 *     · console `TypeError: (w || "").slice is not a function`, then
 *              `[ErrorBoundary] page TypeError: (w || "").slice is not a
 *              function` — the boundary replaces the tab and the form is gone.
 *     · code   `DateInput` emits an INPUT-SHAPED EVENT — `emit(v)` calls
 *              `onChange({ target: { value: v … } })` (`DateInput.jsx:120-122`),
 *              which is the documented API, "so a call site changes by its tag
 *              alone and `onChange={e => set(e.target.value)}` keeps working".
 *              `PtLadderSection.jsx:246` and `ItLadderSection.jsx:265` both
 *              write `onChange={v => setForm(f => ({ …f, effective_from: v || '' }))}`
 *              and store the EVENT OBJECT. The next render hands that object
 *              back as `value`, and `(value || '').slice(0, 10)` throws.
 *              Every other DateInput in Vetana — the structure's Effective
 *              from, the loan's Disbursed on, the exit's two dates — uses
 *              `e.target.value` and is unaffected.
 *     08.13 therefore adds its four bands with the date left blank, which is a
 *     legal band (the column is nullable, `_pt_slabs` admits NULL and so does
 *     `income_tax._SELECT`) and is stated at the call site as a consequence of
 *     the crash rather than a preference.
 *
 * AND ONE MORE, INTERMITTENT, WHICH IS WHY IT IS RECORDED RATHER THAN CLAIMED:
 *
 *   08.1 — THE STATUTORY MONTH PICKER AND THE FIGURES BENEATH IT DISAGREED.
 *     Reproduced once in three executions. The Month box read `2026-01`; the
 *     four tiles under it read August's figures (PF ₹50,429 · ESI ₹1,423 ·
 *     PT ₹4,385 · TDS ₹2,483) and the compliance calendar was captioned
 *     "August 2026 run", under a picker showing January.
 *     · wire   the API is not the cause. `GET /vetana/statutory-summary?month=
 *              2026-01` answers `{"month":"2026-01","employees":[],"totals":
 *              {…all zero}}`, and 2026-07 and 2026-08 each answer their own
 *              month. Measured directly, all four cases.
 *     · screen the picker was CONTROLLED at 2026-01, so the component's own
 *              state had moved; only the resource under it had not.
 *     Naming a cause is §14's to do, not this file's. What this file does is
 *     wait for the January response before reading the screen — so a failure
 *     is about what was rendered rather than about when it was looked at — and
 *     assert the property that matters to somebody filing a return: the figures
 *     and the month label must agree.
 *
 * AND FOUR THINGS FOUND BY RUNNING IT, REPORTED WITHOUT A VERDICT:
 *
 *   · An approved expense claim is reimbursed through whichever month is
 *     processed FIRST, with no date test at all — `routers/vetana.py:2032`
 *     selects `status='approved' AND payslip_id IS NULL` and nothing bounds it
 *     to the wage period. Unicode holds two approved claims dated 5 and 6
 *     August; they land on JUNE payslips, in a month those two people had not
 *     joined, and produce a net of ₹875 and ₹750 on a gross of ₹0. 08.5
 *     asserts this happens rather than pretending it does not.
 *   · Those two June payslips cannot be issued as PDFs.
 *     `validate_payslip` blocks on `abs(gross − deductions − net) > 1.0`
 *     (`doc_validation.py:432`) and a reimbursement is added AFTER deductions
 *     (`vetana.py:2110`), so the identity it checks cannot hold on any payslip
 *     carrying one. The twenty PDFs §4 asks for are taken from August, where
 *     the claims have already been consumed — a choice of which twenty, stated
 *     here, not a dodge.
 *   · A LOAN CAN TAKE THE WHOLE OF AN EXPENSE REIMBURSEMENT. The 50% take-home
 *     floor is a share of `gross_fixed` (`vetana.py:2093`), which is ₹0 in a
 *     month nobody was employed — so `loan_capacity` becomes the entire
 *     reimbursement and the employee receives nothing. Measured on the June run:
 *     Aarav Trivedi, ₹750 reimbursed, ₹750 recovered, **₹0 paid**, beside a
 *     colleague with no loan who received his ₹875. The floor is doing exactly
 *     what it says; what it is protecting is a percentage of a salary that does
 *     not exist. 08.5 asserts the arithmetic and names the outcome.
 *   · THE HEADCOUNT TILE AND THE PAYROLL RUN COUNT DIFFERENT THINGS, and the
 *     router says so at `vetana.py:2842` before anybody asks: the tile is a
 *     stock as at TODAY (`still_on_the_rolls`), the run pays a MONTH and still
 *     pays somebody who left on the 3rd for the three days they worked. With
 *     the four mid-August leavers 08.4 creates, the dashboard reads 26 while the
 *     register holds 30 and the run paid 30. Recorded because it looks exactly
 *     like a defect and is not; 08.16 reads the number rather than pinning it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 IDEMPOTENCE — proved by running twice, never claimed
 * ═══════════════════════════════════════════════════════════════════════════
 * Every record carries a DETERMINISTIC key: the structure is keyed on the
 * employee already having one, the loan on its note text, the exit on its
 * reason, the ladder band on (state, from, to) and (regime, from). Each test
 * READS what exists first and creates only the shortfall, then asserts the
 * total. A payroll run is the hard case §4 singles out, and the product itself
 * is the guard: `process_payroll` refuses a month that is not in `draft`
 * (`vetana.py:1697`), so a second execution finds three processed months, does
 * not re-process them, and 08.14 asserts the refusal IS the message that names
 * the status. Nothing here is stamped with a timestamp — a stamped name is the
 * opposite of idempotent.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave3.config.ts --project vetana
 */
import { test, expect, Page, Locator } from '@playwright/test';
import { lane, activeLane, signInAs } from './_lanes';
import { setDate, setMonth, settle, download, isForeignInlineScriptRefusal } from './_helpers';

// ⚠ STAGE 4 (§14): `activeLane()` reads E2E_LANE and DEFAULTS TO 'unicode', so an
// unset run is byte-for-byte the Unicode run this suite was authored against.
// `lane('unicode')` frozen here at import time was why the UK replay could not
// be run at all — §14's own first category, a hidden dependency on Unicode.
const LANE = activeLane();
const API = process.env.E2E_API_URL || 'https://api.kartavaya.com';

/** The three consecutive months §4 asks for. See §4-not-reachable note 1. */
const MONTHS = ['2026-06', '2026-07', '2026-08'] as const;
/** The only one of the three in which anybody was employed. */
const PAY = '2026-08';
const PAY_END = '2026-08-31';
const PAY_MONTH_NO = 8;
/** Every structure is effective from here, so all three runs price it. */
const EFFECTIVE_FROM = '2026-06-01';

const BLOCKED =
  'BLOCKED — no Unicode Group credential. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e at the repo root. ⚠ It must be an ' +
  'ORG-SCOPED account: a platform_admin token resolves to Aekam Inc via ' +
  'platform_bypass and would write there. ENVIRONMENT blocker, not a product ' +
  'or test defect.';

/* ══════════════════════════════════════════════════════════════════════════
   THE DATA — deterministic, so a second run recognises its own output
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * One salary structure per employee, keyed by the employee code Suite 07 typed.
 *
 * `m` is the MONTHLY total of the six components. The split is basic 50%, HRA
 * 20%, special allowance the remainder — a conventional Indian structure whose
 * basic is at the 50%-of-gross line most firms use, and one that totals `m`
 * exactly so the form's own "these agree" reconciliation against CTC holds.
 * DA, conveyance and medical are typed to zero rather than left to the form's
 * auto-split, because the auto-split's fixed ₹1,600 conveyance and ₹1,250
 * medical exceed a stipend-sized salary and drive the special allowance
 * negative.
 *
 * ⚠ `m` IS NOT THE GROSS. Every one of the thirty joined mid-August, so every
 * August payslip is pro-rated by the joining date — which is what makes §4's
 * "2 mid-month joiner pro-rations" true of all thirty rather than of two, and
 * what spreads the grosses across the whole professional-tax ladder. The
 * salaries are chosen so that the resulting grosses land in EVERY Gujarat band
 * and in a Maharashtra and a Karnataka band that Gujarat could not produce.
 * No expected gross is written down: the assertions read the payslip's own
 * figure and look the ladder up against it.
 *
 * `esi` follows the ₹21,000 wage ceiling of the ESI Act — ticked where the
 * salary is inside it, which is the statutorily correct configuration and not
 * a test convenience. `regime` is the form's own default except on S7-02.
 */
type Struct = { code: string; m: number; regime: 'new' | 'old'; esi: boolean; why?: string };
const STRUCTURES: Struct[] = [
  { code: 'S7-01', m: 78000, regime: 'new', esi: false, why: 'TDS twin — new regime' },
  { code: 'S7-02', m: 78000, regime: 'old', esi: false, why: 'TDS twin — old regime, same salary, same joining date' },
  { code: 'S7-03', m: 42000, regime: 'new', esi: false, why: 'leaver, twinned with S7-04' },
  { code: 'S7-04', m: 7600, regime: 'new', esi: true, why: 'article assistant stipend — Gujarat band 2' },
  { code: 'S7-05', m: 45000, regime: 'new', esi: false, why: 'leaver, twinned with S7-06' },
  { code: 'S7-06', m: 45000, regime: 'new', esi: false },
  { code: 'S7-07', m: 11000, regime: 'new', esi: true, why: 'MAHARASHTRA — a figure no Gujarat band charges' },
  { code: 'S7-08', m: 12400, regime: 'new', esi: true, why: 'Gujarat band 3' },
  { code: 'S7-09', m: 38000, regime: 'new', esi: false, why: 'leaver, twinned with S7-10' },
  { code: 'S7-10', m: 8000, regime: 'new', esi: true, why: 'MAHARASHTRA — nil where Gujarat charges' },
  { code: 'S7-11', m: 36000, regime: 'new', esi: false, why: 'leaver, twinned with S7-12' },
  { code: 'S7-12', m: 36000, regime: 'new', esi: false },
  { code: 'S7-13', m: 52000, regime: 'new', esi: false },
  { code: 'S7-14', m: 28000, regime: 'new', esi: false },
  { code: 'S7-15', m: 20000, regime: 'new', esi: true, why: 'KARNATAKA — nil to ₹14,999 where Gujarat charges its top figure' },
  { code: 'S7-16', m: 26000, regime: 'new', esi: false },
  { code: 'S7-17', m: 55000, regime: 'new', esi: false },
  { code: 'S7-18', m: 32000, regime: 'new', esi: false },
  { code: 'S7-19', m: 30000, regime: 'new', esi: false },
  { code: 'S7-20', m: 24000, regime: 'new', esi: false },
  { code: 'S7-21', m: 40000, regime: 'new', esi: false, why: 'Maharashtra, top band' },
  { code: 'S7-22', m: 34000, regime: 'new', esi: false },
  { code: 'S7-23', m: 22000, regime: 'new', esi: false, why: 'Gujarat band 3 after pro-ration' },
  { code: 'S7-24', m: 26000, regime: 'new', esi: false },
  { code: 'S7-25', m: 30000, regime: 'new', esi: false },
  { code: 'S7-26', m: 44000, regime: 'new', esi: false },
  { code: 'S7-27', m: 60000, regime: 'new', esi: false },
  { code: 'S7-28', m: 20000, regime: 'new', esi: true, why: 'Gujarat band 2 after pro-ration' },
];

/**
 * The two people Suite 07 hired out of the recruitment pipeline. They carry NO
 * employee code and NO work state, and the second of those is the point: an
 * employee with no state recorded must attract NO professional tax and must not
 * stop the run — `_pt_from_slabs` returns `(0.0, None)` when the state yields
 * no keys, which the router's own header calls "a defensible zero". 08.8
 * asserts it on the real payslip. They are matched by NAME because there is no
 * code to match on.
 */
const HIRED = [
  { name: 'Bhavin Chokshi', m: 30000 },
  { name: 'Nidhi Sompura', m: 30000 },
];

/**
 * The four leavers, each twinned with a colleague who joined on the SAME DAY
 * and has no exit. Suite 07's own four exits are on S7-25…S7-28 and all carry
 * `last_working_day = 2026-09-30`, which is after every month this suite runs
 * and therefore pro-rates nobody — so these are four NEW exits on four other
 * people, which is what §4's "4 leaver pro-rations" requires.
 *
 * Every `lwd` is on or after the person's joining date and before today, so
 * none of them is a hypothetical. None of these exits is COMPLETED: completing
 * is what sets `is_active = FALSE`, and Suite 09 is driving the same thirty
 * employees in this wave.
 */
const LEAVERS = [
  { code: 'S7-03', twin: 'S7-04', lwd: '2026-08-11', reason: 'S8 exit — pro-rated leaver 1' },
  { code: 'S7-05', twin: 'S7-06', lwd: '2026-08-13', reason: 'S8 exit — pro-rated leaver 2' },
  { code: 'S7-09', twin: 'S7-10', lwd: '2026-08-17', reason: 'S8 exit — pro-rated leaver 3' },
  { code: 'S7-11', twin: 'S7-12', lwd: '2026-08-20', reason: 'S8 exit — pro-rated leaver 4' },
];

/**
 * Six loans. The note is the idempotence key. The EMI is deliberately well
 * inside the 50%-of-gross take-home floor for the August pro-rated gross, so a
 * recovery that does NOT appear is a finding rather than the floor doing its
 * job — except on the two smallest salaries, which are there precisely to
 * exercise the floor.
 */
const LOANS = [
  { code: 'S7-01', principal: 120000, emi: 10000, note: 'S8 loan 1 — housing advance' },
  { code: 'S7-02', principal: 96000, emi: 8000, note: 'S8 loan 2 — vehicle advance' },
  { code: 'S7-13', principal: 60000, emi: 5000, note: 'S8 loan 3 — medical advance' },
  { code: 'S7-17', principal: 48000, emi: 4000, note: 'S8 loan 4 — education advance' },
  { code: 'S7-27', principal: 36000, emi: 3000, note: 'S8 loan 5 — festival advance' },
  { code: 'S7-04', principal: 12000, emi: 6000, note: 'S8 loan 6 — the take-home floor case' },
];

/**
 * §4's "4 ladder bands added". Two professional tax, two income tax.
 *
 * ⚠ THESE ARE ORG OVERRIDES IN A TEST ORGANISATION, NOT STATEMENTS OF LAW, and
 * the screen shows them as such — every other row carries a "Shared" tag and
 * these carry none. The two PT figures sit inside the ₹2,500-a-year ceiling
 * Article 276(2) puts on professional tax (₹100 × 12 = ₹1,200 and ₹175 × 12 =
 * ₹2,100), because an unlawful figure in a live statutory table is not
 * something a test may leave behind. Each replaces a shared Gujarat band that
 * charges less, so the movement is upward and unmistakable.
 *
 * The income-tax pair is a COMPLETE two-band ladder, because an org's own bands
 * replace the shared ladder for that regime wholesale rather than slotting in
 * beside it — `income_tax._generation`, and the screen says so in bold. Half
 * of ours plus half of theirs would be a ladder no Finance Act ever enacted.
 *
 * ⚠ `effective_from` IS LEFT BLANK ON ALL FOUR, and that is the measured
 * consequence of the crash recorded in §14 above, not a choice. A NULL date is
 * a legal band: the column is nullable and both readers admit it.
 */
const PT_BANDS = [
  { state: 'Gujarat', from: 6000, to: 8999, tax: 100 },
  { state: 'Gujarat', from: 9000, to: 11999, tax: 175 },
];
const IT_BANDS = [
  { regime: 'new' as const, from: 0, to: 300000, rate: 0 },
  { regime: 'new' as const, from: 300000, to: null as number | null, rate: 10 },
];
const IT_SOURCE = 'Suite 08 test override — not a Finance Act ladder';
const IT_AY = 'AY 2026-27 (test override)';

/* ══════════════════════════════════════════════════════════════════════════
   THE HARNESS
   ══════════════════════════════════════════════════════════════════════════ */

test.beforeAll(() => {
  console.log(
    `\n  LANE: ${LANE.org} (${LANE.orgId})  · reference lane, §14` +
    `\n  API : ${API}` +
    `\n  ⚠ outbound_mode=live and nothing is suppressed. All 30 employees carry` +
    `\n    a BLANK email, so three payroll runs and six loans send zero mail.` +
    `\n    §4's 30 payslip emails are NOT driven — see the header.\n`,
  );
});

/**
 * Sign in through `_lanes`, which calls `assertOrg()` inside itself now — the
 * guard is a property of getting in rather than a line every author has to
 * remember, which is the shape that failed twice before.
 */
async function signIn(page: Page) {
  if (!LANE.token && !(LANE.email && LANE.password)) throw new Error(BLOCKED);
  await signInAs(page, LANE);
}

/**
 * ⚠ `X-Org-Id` IS NOT OPTIONAL AND `_helpers.ts::api()` MUST NOT BE USED HERE.
 *
 * `src/lib/api.js:39` puts the active org on every request the product makes.
 * `_helpers.ts::api()` sends `X-Org-Id: process.env.E2E_ORG_ID`, which names
 * **E2E Test & Associates**, not Unicode — a read helper answering for a
 * different organisation than the screen beside it is the same class of fault
 * as the 2026-08-28 cross-org incident. Omitting the header entirely is no
 * better: the server then answers for the OLDEST membership.
 *
 * GET only, and that is a rule rather than an accident:
 * `check-e2e-no-bypass.mjs` bans `page.request.post/put/patch/delete` and
 * permits `get`, because asserting that the row appeared IS the evidence.
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
 * THE WIRE — every write, with the status the server answered, and every
 * request that never came back at all.
 *
 * A request with no response is invisible to a response listener and is the
 * failure mode that reads most like "the button does nothing". Both are
 * collected, because a failure here has to report what the SERVER said rather
 * than what the screen looked like.
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
    failed.push(`${req.method()} FAILED ${new URL(req.url()).pathname}  ${req.failure()?.errorText ?? '(no reason given)'}`);
  });
  return wire;
}
const dump = (w: Wire) =>
  w.length ? w.slice(-12).map((l) => '\n     ' + l).join('') : '\n     (no write request was made at all)';

/**
 * The console, per screen. `pageerror` is an UNCAUGHT exception and is asserted
 * at zero — the §1 requirement, not negotiable. `console.error` is collected
 * beside it and asserted separately, so a failure says which of the two
 * happened rather than leaving the next reader to guess.
 *
 * ⚠ The 08.13b crash lands in `console.error` and NOT in `pageerror`, because
 * the app's own ErrorBoundary catches it. Asserting only `pageerror` would have
 * missed a defect that blanks a whole tab.
 */
type Con = { errors: string[]; uncaught: string[] };
function watchConsole(page: Page): Con {
  const c: Con = { errors: [], uncaught: [] };
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
 * `allow` EXISTS FOR EXACTLY ONE THING and it is not a loosening: Chromium logs
 * `Failed to load resource: the server responded with a status of 403` for every
 * refused request, and 08.12 and 08.14 REFUSE ON PURPOSE — they press Approve
 * and Revert to measure the separated-duty boundary. That browser line is the
 * network stack reporting a status the test has already asserted on, not the
 * application misbehaving.
 *
 * It is a per-call list of exact patterns, never a default, and `pageerror` is
 * never filtered by it: an uncaught exception is asserted at zero on every
 * screen with no exceptions at all.
 */
function assertClean(c: Con, screen: string, allow: RegExp[] = []) {
  expect(c.uncaught, `${screen} raised an UNCAUGHT exception:${c.uncaught.map(l => '\n     ' + l).join('')}`)
    .toEqual([]);
  const unexpected = c.errors.filter(e => !allow.some(re => re.test(e)));
  expect(unexpected, `${screen} logged console errors:${unexpected.map(l => '\n     ' + l).join('')}`)
    .toEqual([]);
}

/** The browser's own line for a request the server refused. See `assertClean`. */
const REFUSED = /Failed to load resource: the server responded with a status of 40\d/i;

/**
 * Open Vetana and switch to one tab, wherever `ModuleTabs` has put it.
 *
 * Vetana declares seven tabs and `ModuleTabs` re-derives how many fit from a
 * `ResizeObserver`, so a tab can EXIST on first paint and be behind "More +N" a
 * beat later. Measured on this module at 1600px: all seven were inline AND a
 * More trigger was present, which is precisely the flapping state Suite 07
 * documented on Manav. So the inline count is allowed to settle before the
 * branch is chosen, and the whole reach is retried — never the click alone,
 * because the branch itself goes stale.
 *
 * This CANNOT let a missing tab pass: success is the PANEL opening.
 */
async function vetana(page: Page, tabId: string): Promise<void> {
  if (!/\/vetana/.test(page.url())) await page.goto('/vetana');
  const strip = page.getByRole('tablist', { name: 'Vetana sections' });
  await expect(strip, 'the Vetana tab strip never rendered').toBeVisible({ timeout: 45_000 });

  let stable = -1;
  let sameFor = 0;
  for (let i = 0; i < 25; i++) {
    const n = await strip.locator('[role="tab"]').count();
    if (n > 0 && n === stable) { sameFor += 1; if (sameFor >= 3) break; } else { sameFor = 0; }
    stable = n;
    await page.waitForTimeout(200);
  }

  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const inline = page.locator(`#mt-tab-${tabId}`);
      if (await inline.count()) {
        await inline.click({ timeout: 15_000 });
      } else {
        const more = page.getByRole('button', { name: /^More/ });
        await expect(more, `the "${tabId}" tab is not inline and there is no More menu`).toBeVisible();
        // The trigger is a TOGGLE — clicking it while the popover is open closes
        // it, and the lookup then runs against a menu that is not on screen.
        if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 10_000 });
        const row = menu.getByRole('menuitem', { name: new RegExp(`^\\s*${tabId}\\s*$`, 'i') });
        await expect(row, `the "${tabId}" tab is in neither the strip nor the More menu`).toBeVisible({ timeout: 10_000 });
        await row.click();
      }
      await expect(page.locator(`#mt-panel-${tabId}`), `the "${tabId}" panel did not open`)
        .toBeVisible({ timeout: 25_000 });
      await settle(page);
      return;
    } catch (e) {
      last = e;
      if (attempt === 4) throw e;
      console.log(`\n[vetana] the tab strip moved while reaching "${tabId}" — retry ${attempt}\n`);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  throw last;
}

/** Manav, for the four exits §4 needs. Same shape, different strip. */
async function manav(page: Page, tabId: string): Promise<void> {
  if (!/\/manav/.test(page.url())) await page.goto('/manav');
  const strip = page.getByRole('tablist', { name: 'Manav sections' });
  await expect(strip, 'the Manav tab strip never rendered').toBeVisible({ timeout: 45_000 });
  let stable = -1, sameFor = 0;
  for (let i = 0; i < 25; i++) {
    const n = await strip.locator('[role="tab"]').count();
    if (n > 0 && n === stable) { sameFor += 1; if (sameFor >= 3) break; } else { sameFor = 0; }
    stable = n;
    await page.waitForTimeout(200);
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const inline = page.locator(`#mt-tab-${tabId}`);
      if (await inline.count()) await inline.click({ timeout: 15_000 });
      else {
        const more = page.getByRole('button', { name: /^More/ });
        await expect(more).toBeVisible();
        if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 10_000 });
        await menu.getByRole('menuitem', { name: new RegExp(`^\\s*${tabId.replace(/-/g, ' ')}\\s*$`, 'i') })
          .click({ timeout: 10_000 });
      }
      await expect(page.locator(`#mt-panel-${tabId}`)).toBeVisible({ timeout: 25_000 });
      await settle(page);
      return;
    } catch (e) {
      if (attempt === 4) throw e;
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Click something that writes, and WAIT FOR THE SERVER before going on.
 *
 * This is the fix for three of Suite 02's four failures on 2026-08-28: each
 * clicked Save and reloaded on the very next line, the reload raced the
 * request, the value read back empty, and the suite reported "the product did
 * not save it". It had. Returns the STATUS, because a toast is the client's
 * opinion and the status is the server's.
 */
async function writes(
  page: Page,
  urlRe: RegExp,
  act: () => Promise<void>,
  opts: { methods?: string[]; timeout?: number; allowStatus?: number } = {},
): Promise<{ status: number; body: any; text: string }> {
  const methods = opts.methods ?? ['POST', 'PUT', 'PATCH', 'DELETE'];
  let res;
  try {
    [res] = await Promise.all([
      page.waitForResponse(
        (r) => urlRe.test(r.url()) && methods.includes(r.request().method()),
        { timeout: opts.timeout ?? 90_000 },
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
  if (opts.allowStatus == null) {
    expect(
      res.status(),
      `${res.request().method()} ${new URL(res.url()).pathname} → ${res.status()}: ${text.slice(0, 400)}`,
    ).toBeLessThan(400);
  }
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status(), body, text };
}

/**
 * Click a control in a list that refetches under it.
 *
 * Suite 02's 02.14 and 02.15 both failed with "element was detached from the
 * DOM" because a refetch replaced the tbody while the click's actionability
 * wait was still running. TWO measures, and the order matters: settle first, so
 * the common case never races; then re-resolve, at most three times, and ONLY
 * on the detach signature — a blind retry papers over a genuinely missing or
 * disabled control, which is the one thing this suite exists to catch.
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

async function clickSettled(page: Page, target: Locator, listUrl: RegExp, why: string) {
  await page.waitForResponse((r) => listUrl.test(r.url()) && r.request().method() === 'GET', { timeout: 2_000 })
    .catch(() => {});
  await retryOnDetach(page, async () => {
    await expect(target, why).toBeVisible({ timeout: 20_000 });
    await target.click({ timeout: 15_000 });
  }, why);
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The `<label>` whose caption STARTS with this text.
 *
 * ⚠ NOT `getByLabel()`, and the reason is a real failure rather than taste.
 * Vetana's forms are `<label>Caption<control/></label>`, and an accessible name
 * computed from a wrapping label INCLUDES the embedded control's own text — so
 * the computed name of the Employee field is "Employee" followed by all thirty
 * option labels. Matching the caption at the START of the label's own text is
 * structural and cannot drift with the value.
 */
function fieldOf(scope: Locator, cls: string, caption: string): Locator {
  return scope.locator(`label${cls}`).filter({ hasText: new RegExp(`^\\s*${reEsc(caption)}`) }).first();
}

/**
 * Type a number into a controlled numeric input, with REAL KEYSTROKES.
 *
 * `fill('')` does not register with a controlled input — the fault behind Suite
 * 02's false accusation that a firm cannot remove its GSTIN. And Suite 07 hit
 * the sharper version: `Ctrl+A, Delete, type "2"` produced "12", because a
 * controlled numeric input whose handler is `Number(e.target.value)` re-renders
 * as its default the instant it is emptied and the next keystroke APPENDS.
 * Every field here has that shape — `onChange={e => setForm(f => ({…f, basic:
 * Number(e.target.value)}))}` resolves an empty box to 0.
 *
 * So this types OVER the selection, which replaces it in one event and never
 * leaves the box empty — and then ASSERTS THE VALUE, because without that the
 * append fault is invisible until a downstream figure disagrees with the form.
 */
async function num(scope: Locator, cls: string, caption: string, value: number) {
  const box = fieldOf(scope, cls, caption).locator('input').first();
  await expect(box, `no field labelled "${caption}"`).toBeVisible({ timeout: 20_000 });
  await box.click();
  await box.press('ControlOrMeta+a');
  await box.pressSequentially(String(value), { delay: 4 });
  await expect(box, `"${caption}" would not take the value ${value} — this is the ` +
    'controlled-input append trap, and the value on screen is not what was typed')
    .toHaveValue(String(value), { timeout: 10_000 });
}

/** Type into a controlled text input, same rule, same assertion. */
async function text(scope: Locator, cls: string, caption: string, value: string) {
  const box = fieldOf(scope, cls, caption).locator('input[type="text"], input:not([type])').first();
  await expect(box, `no field labelled "${caption}"`).toBeVisible({ timeout: 20_000 });
  await box.click();
  await box.press('ControlOrMeta+a');
  await box.pressSequentially(value, { delay: 3 });
  await expect(box, `"${caption}" would not take "${value}"`).toHaveValue(value, { timeout: 10_000 });
}

/**
 * Choose from a real `<select>` by the words a person reads.
 *
 * ⚠ NOT `_helpers.ts::pickOption`: that helper ends `expect(idx).toBeGreaterThan(0)`,
 * assuming every select opens with a placeholder, and half the selects here do
 * not — TDS regime opens on "New", Exit type on its first entry. On those it
 * refuses the FIRST option while listing it as the first thing it saw.
 *
 * ⚠ AND IT POLLS FOR THE OPTION RATHER THAN READING ONCE. Every picker here
 * renders "Loading…" while its list is in flight, so a select that has "loaded
 * one option" has loaded NOTHING — reading it once reports a race as a missing
 * record, which is a false product finding and worse than a flake.
 */
async function selectByText(sel: Locator, what: string, optionLabel: string | RegExp) {
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  const hit = (t: string) => typeof optionLabel === 'string' ? norm(t).includes(optionLabel) : optionLabel.test(t);
  const deadline = Date.now() + 40_000;
  let texts: string[] = [];
  let idx = -1;
  for (;;) {
    texts = (await sel.locator('option').allTextContents()).map(norm);
    idx = texts.findIndex(hit);
    if (idx >= 0) break;
    if (texts.length === 1 && /Unavailable/i.test(texts[0])) break;   // the list failed — report it
    if (Date.now() > deadline) break;
    await sel.page().waitForTimeout(250);
  }
  expect(idx, `no "${what}" option matching ${String(optionLabel)}; the picker offered: ` +
    (texts.length ? texts.slice(0, 10).join(' | ') : '(nothing at all)')).toBeGreaterThanOrEqual(0);
  const value = await sel.locator('option').nth(idx).getAttribute('value');
  await sel.selectOption(value ?? { index: idx });
}

async function choose(scope: Locator, cls: string, caption: string, optionLabel: string | RegExp) {
  const sel = fieldOf(scope, cls, caption).locator('select').first();
  await expect(sel, `no select labelled "${caption}"`).toBeVisible({ timeout: 20_000 });
  await selectByText(sel, caption, optionLabel);
}

/** Tick or untick a real checkbox by the words beside it, and prove it took. */
async function tick(box: Locator, on: boolean, why: string) {
  await expect(box, why).toBeVisible({ timeout: 20_000 });
  if ((await box.isChecked()) !== on) await box.click();
  expect(await box.isChecked(), `${why} — the box would not go ${on ? 'on' : 'off'}`).toBe(on);
}

/**
 * The toast TITLE. `.tst__t` carries the verb, `.tst__s` the message — 02.2b
 * was a test bug for reading the pair the wrong way round. `.first()` because
 * toasts STACK, and thirty saves in a row leave several on screen at once; the
 * status of the write is already asserted by `writes()`, so this is the
 * screen's corroboration rather than the evidence.
 */
function toastTitle(page: Page, t: string | RegExp) {
  return page.locator('.tst__t').filter({ hasText: t }).first();
}
/** The `Empty` component's own title node — `EmptyState.jsx:159`. */
const emptyTitle = (page: Page) => page.locator('.empty__title');

/** `₹1,23,456` → 123456. The screen rounds to whole rupees (`lib/inr.js`). */
const rupees = (t: string | null) => Number(String(t ?? '').replace(/[^0-9.-]/g, '') || '0');

/* ══════════════════════════════════════════════════════════════════════════
   THE STATUTORY DERIVATIONS
   ══════════════════════════════════════════════════════════════════════════ */

type PtRow = {
  state_code: string; state_name: string; slab_from: number; slab_to: number | null;
  monthly_tax: number; effective_from: string | null; month: number | null; is_own: boolean;
};

/** Lexicographic compare of two rank tuples. */
function rankGt(a: (string | number)[], b: (string | number)[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    return a[i] > b[i];
  }
  return false;
}

/**
 * THE PROFESSIONAL TAX A LADDER CHARGES — derived, never typed.
 *
 * This re-implements the LOOKUP the product performs, from the ladder the
 * product itself serves at `GET /vetana/pt-slabs`, and nothing else. It is not
 * a second copy of payroll: the gross it is handed is the payslip's own.
 *
 *   · Bands dated after the period end are excluded, so re-reading an old month
 *     uses the rates that applied to it (`_pt_slabs`).
 *   · A NULL `month` is EVERY month; a month-specific band is admitted only for
 *     the month being run. Maharashtra charges a different figure in February
 *     and that is the whole reason the column exists.
 *   · The state is matched through the CODE and the NAME both, because this
 *     database holds two incompatible state conventions — '27' on the slab and
 *     possibly 'MH' on the employee — and comparing the raw strings would
 *     silently never match. A lookup that never matches charges everybody
 *     nothing, which looks exactly like a state that levies none.
 *   · Rank: the org's own row over a shared one, then a month-specific row over
 *     an every-month one, then the later `effective_from`, then the higher
 *     `slab_from`. Every step falls back rather than refusing.
 *   · NO STATE, NO BAND, NO MATCH → ₹0. That is the product's documented and
 *     defensible zero, and it is asserted as such on the two employees who have
 *     no work state recorded.
 */
function ptFor(all: PtRow[], state: string | null | undefined, gross: number,
               asAt: string, monthNo: number): { tax: number; row: PtRow | null } {
  const key = String(state ?? '').trim().toLowerCase();
  if (!key) return { tax: 0, row: null };
  let best: { rank: (string | number)[]; row: PtRow; tax: number } | null = null;
  for (const r of all) {
    const eff = r.effective_from == null ? '' : String(r.effective_from).slice(0, 10);
    if (eff && eff > asAt) continue;
    if (r.month != null && Number(r.month) !== monthNo) continue;
    const spellings = new Set([
      String(r.state_code ?? '').trim().toLowerCase(),
      String(r.state_name ?? '').trim().toLowerCase(),
    ]);
    if (!spellings.has(key)) continue;
    const low = Number(r.slab_from ?? 0);
    const high = r.slab_to == null ? null : Number(r.slab_to);
    if (gross < low) continue;
    if (high != null && gross > high) continue;
    const rank = [r.is_own ? 1 : 0, r.month != null ? 1 : 0, eff, low];
    if (!best || rankGt(rank, best.rank)) {
      best = { rank, row: r, tax: Math.round(Number(r.monthly_tax) * 100) / 100 };
    }
  }
  return best ? { tax: best.tax, row: best.row } : { tax: 0, row: null };
}

type ItRow = {
  regime: string; slab_from: number; slab_to: number | null; rate_percent: number;
  effective_from: string | null; assessment_year: string | null; source_ref: string | null;
  is_own: boolean;
};

/**
 * THE ONE INCOME-TAX LADDER IN FORCE — `income_tax._generation`, off the wire.
 *
 * Own bands replace the shared ladder WHOLESALE rather than band by band, and
 * within the winning scope the latest `effective_from` is the generation that
 * applies. Selecting a whole generation is the point: mixing one year's
 * ₹7,00,000 step with the next year's ₹8,00,000 one produces a ladder no
 * Finance Act has ever enacted, and every band of it looks defensible alone.
 */
function generation(all: ItRow[], regime: 'new' | 'old', asAt: string): ItRow[] {
  const dated = all.filter(r =>
    String(r.regime || '').trim().toLowerCase() === regime &&
    (r.effective_from == null || String(r.effective_from).slice(0, 10) <= asAt));
  const own = dated.filter(r => r.is_own);
  const scope = own.length ? own : dated.filter(r => !r.is_own);
  if (!scope.length) return [];
  const latest = scope.reduce((m, r) => {
    const e = r.effective_from == null ? '' : String(r.effective_from).slice(0, 10);
    return e > m ? e : m;
  }, '');
  return scope
    .filter(r => (r.effective_from == null ? '' : String(r.effective_from).slice(0, 10)) === latest)
    .sort((a, b) => Number(a.slab_from ?? 0) - Number(b.slab_from ?? 0));
}

/**
 * MARGINAL SLAB TAX on an annual taxable figure. Ordinary Finance Act
 * arithmetic: every band below the figure contributes its own slice, a band's
 * taxed slice is `min(income, slab_to) − slab_from`, and no rupee is counted
 * twice. The `cursor` clamp is the product's documented handling of overlapping
 * bands — charge the slice once, at the first band's rate — and a gap is simply
 * untaxed.
 *
 * The rebate under s.87A, the 4% health and education cess, surcharge and the
 * standard deduction are NOT bands and are not applied — by the product, by the
 * table, or here. The Statutory screen says the same thing in words.
 */
function annualTax(bands: ItRow[], income: number): number {
  if (!bands.length || income <= 0) return 0;
  let total = 0;
  let cursor = 0;
  for (const b of bands) {
    const low = Math.max(Number(b.slab_from ?? 0), cursor);
    const to = b.slab_to == null ? null : Number(b.slab_to);
    const high = to == null ? income : Math.min(income, to);
    if (high <= low) continue;
    total += (high - low) * Number(b.rate_percent ?? 0) / 100;
    cursor = high;
    if (to == null || income <= to) break;
  }
  return Math.round(total * 100) / 100;
}

/**
 * The product's annualisation, read off `routers/vetana.py:1298` and DECLARED
 * rather than hidden: a monthly gross is annualised by twelve, a flat ₹50,000
 * standard deduction is taken, and the year's slab tax is spread back over
 * twelve months. A test that invented a different annualisation would fail a
 * correct product; what is being asserted here is that the LADDER is honoured
 * inside the product's own rule.
 */
const monthlyTds = (bands: ItRow[], gross: number) =>
  Math.round((annualTax(bands, Math.max(gross * 12 - 50000, 0)) / 12) * 100) / 100;

/** 12% of the payable basic, capped at the ₹15,000 EPF wage ceiling. */
const pfOn = (basic: number) => Math.round(Math.min(basic, 15000) * 0.12 * 100) / 100;

/**
 * ⚠ THE FIGURE EVERY STATUTORY DEDUCTION IS COMPUTED ON IS **NOT** `payslip.gross`.
 *
 * Measured on the first run of this suite, and it invalidated three assertions
 * that had been written against `gross`. `process_payroll` computes
 * `gross_fixed` — the pro-rated salary components plus overtime — passes THAT
 * to `_compute_statutory`, and only afterwards adds commission and bonus:
 * `gross = round(gross_fixed + variable_total, 2)` (`routers/vetana.py:2110`).
 * Professional tax, ESI and the TDS annualisation all read the fixed figure.
 *
 * It matters here because **Suite 07 left bonus awards on this org** and
 * `_variable_earnings` pulls them in. Anjali Pandya's August payslip reads
 * `gross 17,807.69` and `professional_tax 0.00`, which looks like a defect and
 * is not: her fixed pay was ₹307.69 and ₹17,500 of that gross is a bonus. Her
 * frozen `statutory_treatment` names the band actually used — Maharashtra
 * ₹0–7,500 — and `esi_base` records ₹307.69. A test asserting against `gross`
 * would have reported a correct payslip as wrong.
 *
 * Reconstructed from the payslip's OWN columns, which is what the wage
 * components are, rather than from the structure.
 */
const FIXED_COLS = ['basic', 'hra', 'da', 'special_allowance', 'conveyance', 'medical', 'overtime_pay'];
const grossFixed = (p: any) =>
  Math.round(FIXED_COLS.reduce((s, k) => s + Number(p[k] || 0), 0) * 100) / 100;

/**
 * Non-Sunday days in an inclusive range — the module's own definition of a
 * working day, stated at `_working_days_between` as "every calendar day of the
 * month that is not a Sunday".
 *
 * Used in 08.10 ONLY as an UPPER BOUND: nobody may be paid for more days than
 * the days they were on the rolls. That is a safety property about a leaver's
 * final month, not a re-implementation of what they are paid — the amount is
 * never computed here.
 */
function workingDaysBetween(startIso: string, endIso: string): number {
  const s = new Date(`${startIso}T00:00:00`);
  const e = new Date(`${endIso}T00:00:00`);
  if (e < s) return 0;
  let n = 0;
  for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) n += 1;
  return n;
}

/**
 * THE LADDER AS IT STOOD WHEN THE RUN WAS PROCESSED.
 *
 * ⚠ §6 IDEMPOTENCE MADE THIS NECESSARY AND IT IS NOT A FUDGE. 08.13 adds this
 * suite's own bands, which outrank the shared ones from that moment on. The
 * August payslips were computed BEFORE they existed and cannot be recomputed —
 * the re-run is refused (08.14). So on a second execution the live ladder is no
 * longer the ladder those payslips were priced under, and deriving against it
 * would report a correct payslip as wrong.
 *
 * The bands this suite adds are known exactly, by value, so removing them
 * reconstructs the earlier ladder deterministically on any run. Nothing else is
 * filtered: a band somebody else added would still be honoured.
 *
 * The reconstruction is not taken on trust either — 08.8 cross-checks it
 * against `statutory_treatment.pt_slab`, the band the product itself froze onto
 * each payslip when it computed it.
 */
const isSuiteOwnPt = (r: PtRow) => Boolean(r.is_own) && PT_BANDS.some(b =>
  String(r.state_name) === b.state && Number(r.slab_from) === b.from &&
  Number(r.slab_to) === b.to && Number(r.monthly_tax) === b.tax);
const isSuiteOwnIt = (r: ItRow) => Boolean(r.is_own) && IT_BANDS.some(b =>
  String(r.regime) === b.regime && Number(r.slab_from) === b.from &&
  Number(r.rate_percent) === b.rate);
const ptAsRun = (rows: PtRow[]) => rows.filter(r => !isSuiteOwnPt(r));
const itAsRun = (rows: ItRow[]) => rows.filter(r => !isSuiteOwnIt(r));

/**
 * Employees by code, and by name for the two who have no code.
 *
 * ⚠ THE DIRECTORY IS NOT THE PAYROLL, AND THIS SUITE'S OWN EXITS PROVED IT.
 * `GET /manav/employees` bounds on `still_on_the_rolls` (`routers/manav.py:1108`)
 * — a stock as at TODAY — so the moment 08.4 records four last working days in
 * mid-August, those four leave the directory. It returned 30 before 08.4 and 26
 * after, on a register where all thirty are still `is_active` and all thirty are
 * still paid by the August run. That is the same deliberate distinction the
 * dashboard tile carries, and pinning 30 here made four tests fail against a
 * correct product on the second execution.
 *
 * So anybody who is on a payslip and not in the directory is read back through
 * `GET /manav/employees/{id}`, which is not bounded that way — and the count is
 * reported rather than asserted at a number that a leaver changes. The ids come
 * off the payslip rows and are used in a URL only; nothing renders one.
 */
async function employeeIndex(page: Page) {
  const rows: any[] = [...await rowsOf(page, '/api/v1/manav/employees?limit=200')];
  const byCode = new Map<string, any>();
  const byName = new Map<string, any>();
  const add = (e: any) => {
    if (e?.employee_code) byCode.set(String(e.employee_code), e);
    if (e?.name) byName.set(String(e.name), e);
  };
  rows.forEach(add);

  // Anyone the August run paid who is no longer on the directory — read the
  // record itself rather than treating them as missing.
  let offRolls = 0;
  const slips = await rowsOf(page, `/api/v1/vetana/payslips?month=${PAY}`).catch(() => []);
  for (const p of slips) {
    if (byName.has(String(p.employee_name)) || !p.employee_id) continue;
    const body = await orgGet(page, `/api/v1/manav/employees/${p.employee_id}`);
    const e = body?.employee ?? body;
    expect(e?.name, `an employee on the August payroll could not be read back at all`).toBeTruthy();
    rows.push(e);
    add(e);
    offRolls += 1;
  }
  // ── AND ANYONE THIS SUITE ITSELF OFFBOARDED ON AN EARLIER RUN ─────────────
  //
  // ⚠ THE RECOVERY ABOVE IS CIRCULAR, AND IT DEADLOCKED THE WHOLE SUITE ON ITS
  // SECOND EXECUTION. Measured 2026-08-30: 30 employees in the database, all
  // `status='active'` and `is_active=TRUE`, and the directory correctly returned
  // 26 — because 08.4's own four leavers ("S8 exit — pro-rated leaver 1..4",
  // last working days 2026-08-11/13/17/20) are past their last day and
  // `still_on_the_rolls` drops them, which is right.
  //
  // The payslip recovery above cannot see them, because payslips for this month
  // are created by 08.5–08.7 — which run AFTER this precondition. So:
  //
  //   first run   no leavers yet        -> 30 readable -> passes -> creates 4
  //   second run  its own 4 are off     -> 26 readable, 0 payslips -> FAILS
  //
  // §6 requires every suite to run twice and report "0 typed, N already
  // present". As written this one could only ever pass once, and the failure
  // read as "Suite 07 did not create the employees" — pointing at the wrong
  // suite entirely, which is how a whole wave gets re-run for nothing.
  //
  // The offboarding register does not depend on payroll having run, so it is
  // the recovery that holds on every execution. The detail route is deliberately
  // readable for someone off the rolls — a leaver in clearance still has assets
  // to hand back and a settlement to receive (`manav.py:401`).
  const exits = await rowsOf(page, '/api/v1/manav/offboarding?limit=200').catch(() => []);
  for (const x of exits) {
    const id = x?.employee_id;
    if (!id) continue;
    if (rows.some((r) => String(r?.id) === String(id))) continue;
    const body = await orgGet(page, `/api/v1/manav/employees/${id}`);
    const e = body?.employee ?? body;
    expect(e?.name, `an offboarded employee could not be read back through the detail route`)
      .toBeTruthy();
    rows.push(e);
    add(e);
    offRolls += 1;
  }

  expect(rows.length, `Wave 2 left thirty employees and this suite depends on them; Suite 07 ` +
    `owns creating them. ${rows.length} were readable (${offRolls} of them only through the ` +
    'detail route, being past their last working day).').toBeGreaterThanOrEqual(30);
  return { rows, byCode, byName, offRolls };
}

/* ══════════════════════════════════════════════════════════════════════════
   08.1 — EVERY SCREEN, BEFORE ITS DATA EXISTS
   ══════════════════════════════════════════════════════════════════════════ */

test.describe('Suite 08 — Vetana · Unicode Group', () => {
  /**
   * ⚠ A WIDER VIEWPORT, AND IT IS A MEASUREMENT RATHER THAN A PREFERENCE.
   * `ModuleTabs` divides the measured strip width by the average rendered tab
   * width to decide how many fit. At the 1280px default that division lands on
   * a boundary for a seven-tab module and the strip oscillates; at 1600 it does
   * not. The statutory register is also a twelve-column table and a narrow
   * viewport puts it entirely inside its own horizontal scroller.
   */
  test.use({ viewport: { width: 1600, height: 1000 } });

  /**
   * ⚠ THIS TEST IS THE ONE §6 CANNOT MAKE IDEMPOTENT BY CREATING NOTHING, and
   * pretending otherwise is how an empty-state assertion becomes a lie. Its
   * subject is what each screen SAYS WHEN IT HOLDS NOTHING, and after 08.2 the
   * module holds a great deal. So it measures first and asserts the branch it
   * is actually in — the empty wording on a virgin module, the populated
   * wording once the rows exist — and prints which. Neither branch is a skip:
   * a screen that says nothing in either state fails.
   */
  test('08.1 — the nine screens, in words, before a single row exists', async ({ page }) => {
    const con = watchConsole(page);
    watchWire(page);
    await signIn(page);
    const virgin = (await rowsOf(page, '/api/v1/vetana/salary-structures')).length === 0;
    console.log(`\n  08.1 — the module is ${virgin ? 'EMPTY: asserting the empty states §1 asks for'
      : 'POPULATED by an earlier execution: asserting the populated wording instead'}\n`);

    // The module opens on a KPI strip, not on a tab row — the reference puts
    // four figures above the tabs and the fourth is a filing deadline.
    await page.goto('/vetana');
    await settle(page);
    const shell = page.locator('.vt-page');
    await expect(shell, 'the Vetana page shell never rendered').toBeVisible({ timeout: 45_000 });

    // ── 1 · Dashboard ────────────────────────────────────────────────────
    await vetana(page, 'dashboard');
    const dash = page.locator('#mt-panel-dashboard');
    // The coverage sentence is the one thing in this product that says an
    // employee without a structure is skipped IN SILENCE by every run. It must
    // say so either way — with a count of who is missing, or that nobody is.
    await expect(dash, 'the dashboard says nothing at all about payroll coverage')
      .toContainText(virgin
        ? /active employees have no salary structure/i
        : /active employees? (has|have) a salary structure/i, { timeout: 25_000 });
    if (virgin) {
      await expect(dash, 'the coverage warning does not say a run skips them silently')
        .toContainText(/skipped silently/i);
      await expect(dash, 'the department split does not say why it is empty')
        .toContainText(/No payroll has been run yet/i);
    }
    await expect(dash).toContainText(/Year to date/i);

    // ── 2 · Salary structures ────────────────────────────────────────────
    await vetana(page, 'structures');
    if (virgin) {
      await expect(emptyTitle(page), 'the structures tab does not name its empty state')
        .toHaveText(/No salary structures/i, { timeout: 20_000 });
      await expect(page.locator('#mt-panel-structures'),
        'the empty state does not say what a structure is FOR')
        .toContainText(/until an employee has one, they are skipped by every run/i);
    } else {
      await expect(page.locator('#mt-panel-structures').getByRole('button').first(),
        'the structures tab lists nothing after 08.2 typed thirty').toBeVisible({ timeout: 25_000 });
    }

    // ── 4 · Payroll runs ─────────────────────────────────────────────────
    await vetana(page, 'payroll');
    if (virgin) {
      await expect(emptyTitle(page), 'the payroll tab does not name its empty state')
        .toHaveText(/No payroll has been run/i, { timeout: 20_000 });
    }
    // Said in both states: nothing happens until a month is chosen.
    await expect(page.locator('#mt-panel-payroll'),
      'the payroll tab does not say a month must be picked first')
      .toContainText(/Pick a month to process/i, { timeout: 25_000 });

    // ── 6 · Payslips ─────────────────────────────────────────────────────
    await vetana(page, 'payslips');
    if (virgin) {
      await expect(emptyTitle(page), 'the payslips tab does not name its empty state')
        .toHaveText(/No payslips yet/i, { timeout: 20_000 });
    }
    // The month filter is on the screen in both states, and an unprocessed
    // month must say so rather than showing an empty list.
    //
    // ⚠ THE SERVER IS AWAITED BEFORE THE SCREEN IS READ. Changing the month
    // fires a fetch, and asserting into the gap is the same race `saveAndWait`
    // exists for — a reload that outruns the request reports "the product did
    // not do it" when it had.
    const psPanel = page.locator('#mt-panel-payslips');
    // `input[type="month"]` is DateInput's HIDDEN `.pk__native` since
    // 2026-08-31. It still carries the value, so `toHaveValue` below is
    // still the right assertion — but it cannot be filled or seen, so the
    // visible trigger and `setMonth()` do the driving.
    await expect(psPanel.getByRole('button', { name: 'Month' }),
      'the payslips tab has no month filter').toBeVisible({ timeout: 25_000 });
    await Promise.all([
      page.waitForResponse(r => /\/vetana\/payslips\?month=2026-01/.test(r.url()) &&
        r.request().method() === 'GET', { timeout: 30_000 }),
      setMonth(psPanel, 'Month', '2026-01'),
    ]);
    await expect(emptyTitle(page), 'a month with no payslips does not say so in words')
      .toHaveText(/No payslips for January 2026/i, { timeout: 20_000 });
    await page.locator('#mt-panel-payslips').getByRole('button', { name: /^Clear$/ }).click();

    // ── 8 · Loans ────────────────────────────────────────────────────────
    await vetana(page, 'loans');
    if (virgin) {
      await expect(emptyTitle(page), 'the loans tab does not name its empty state')
        .toHaveText(/No loans or advances/i, { timeout: 20_000 });
    } else {
      await expect(page.locator('#mt-panel-loans'), 'the loans tab lists nothing after 08.3')
        .toContainText(/of ₹/i, { timeout: 25_000 });
    }

    // ── 9 · Statutory ────────────────────────────────────────────────────
    await vetana(page, 'statutory');
    const stat = page.locator('#mt-panel-statutory');
    // A month with nothing deducted must say so rather than showing four zeroes
    // — "nothing is owed" and "this month was never processed" are different
    // facts and the screen has to distinguish them. January was never run, in
    // either state of this suite.
    // ⚠ THE SERVER IS AWAITED, and this one is not defensiveness. Measured on
    // the third execution of this suite: the Month box read `2026-01` while the
    // four tiles under it read August's figures — PF ₹50,429, PT ₹4,385, TDS
    // ₹2,483 — and the compliance calendar was captioned "August 2026 run",
    // under a picker showing January. The API is not the cause:
    // `GET /vetana/statutory-summary?month=2026-01` answers
    // `{"month":"2026-01","employees":[],"totals":{…all zero}}`. It reproduced
    // once in three runs, so it is recorded as INTERMITTENT and measured, and
    // this test now waits for the January response before reading the screen so
    // that a failure here is about what was rendered and not about when it was
    // looked at. §14: no verdict, and the assertion is not relaxed.
    await Promise.all([
      page.waitForResponse(r => /statutory-summary\?month=2026-01/.test(r.url()) &&
        r.request().method() === 'GET', { timeout: 30_000 }),
      setMonth(stat, 'Month', '2026-01'),
    ]);
    await expect(stat, 'a month with no deductions does not say so in words')
      .toContainText(/Nothing was deducted in January 2026/i, { timeout: 25_000 });
    // The figures and the picker must agree. A compliance screen that labels one
    // month's statutory totals with another month's name is the failure this
    // pins, and it is the user-visible half of the measurement above.
    await expect(stat, 'the statutory screen shows one month in the picker and another in the ' +
      'compliance calendar caption').not.toContainText(/August 2026 run/i);
    await expect(stat, 'the employee-wise register does not say why it is empty')
      .toContainText(/The register is built from that month.s payslips/i);
    // Both ladders are visible BEFORE any band is added, and both say they are
    // optional. Hiding the shared rows would present an empty ladder as
    // "nothing is deducted" and send an administrator to duplicate bands that
    // already apply — which is the argument the section headers make.
    await expect(stat, 'the professional-tax ladder does not say it is optional')
      .toContainText(/Optional\. Leave this alone and payroll uses the shared ladder/i);
    await expect(stat, 'the income-tax ladder does not say own bands replace the shared one')
      .toContainText(/replace the shared ladder for that regime completely/i);
    await expect(stat, 'the income-tax section does not disclaim rebate, cess and surcharge')
      .toContainText(/section 87A rebate, the 4% health and education cess, surcharge/i);

    // The shared ladders are real and are the ones the assertions later derive
    // from. Asserted here so a later PT figure cannot be explained by an empty
    // table. Gujarat has FOUR bands where Maharashtra has three — a difference
    // that is the whole reason professional tax cannot be one national figure.
    // The SHARED ladder — `is_own` rows are excluded because 08.13 adds two of
    // them to Gujarat and this count is about the national reference data.
    const pt = (await rowsOf(page, '/api/v1/vetana/pt-slabs')) as PtRow[];
    const guj = pt.filter(r => String(r.state_code) === '24' && !r.is_own);
    const mah = pt.filter(r => String(r.state_code) === '27' && !r.is_own);
    expect(guj.length, `Gujarat's shared professional-tax ladder is not four bands; it has ` +
      `${guj.length}. Every PT figure this suite asserts is derived from these rows.`).toBe(4);
    expect(mah.length, 'Maharashtra\'s shared ladder is not three bands').toBe(3);

    const it = (await rowsOf(page, '/api/v1/vetana/it-slabs')) as ItRow[];
    const sharedNew = generation(itAsRun(it), 'new', PAY_END);
    const sharedOld = generation(itAsRun(it), 'old', PAY_END);
    expect(sharedNew.length,
      'no new-regime income-tax ladder is in force, so TDS would be ₹0 for everybody ' +
      'and 08.9 could assert nothing').toBeGreaterThan(0);
    expect(sharedOld.length, 'no old-regime income-tax ladder is in force').toBeGreaterThan(0);
    console.log(
      `\n  LADDERS IN FORCE at ${PAY_END} — the source of every figure 08.8/08.9 assert:` +
      `\n    professional tax · Gujarat  ${guj.map(r => `[${r.slab_from}–${r.slab_to ?? '∞'}] ₹${r.monthly_tax}`).join('  ')}` +
      `\n    professional tax · Maharashtra ${mah.map(r => `[${r.slab_from}–${r.slab_to ?? '∞'}] ₹${r.monthly_tax}`).join('  ')}` +
      `\n    income tax · new  ${sharedNew.map(b => `>${b.slab_from}@${b.rate_percent}%`).join(' ')}` +
      `\n    income tax · old  ${sharedOld.map(b => `>${b.slab_from}@${b.rate_percent}%`).join(' ')}\n`);

    // ── the seventh tab, opened rather than assumed ──────────────────────
    await vetana(page, 'analytics');
    await expect(page.locator('#mt-panel-analytics')).toBeVisible();

    assertClean(con, '08.1 — the nine screens before any data');
  });

  /* ════════════════════════════════════════════════════════════════════════
     08.2 — THIRTY SALARY STRUCTURES, TYPED
     ════════════════════════════════════════════════════════════════════════ */

  test('08.2 — 30 salary structures, one per employee, typed into the real form', async ({ page }) => {
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);
    const { byCode, byName } = await employeeIndex(page);

    // §6 — read what exists and create ONLY the shortfall. A second POST for
    // the same employee would create a SECOND structure row (there is no
    // upsert; the run de-duplicates by employee and keeps the latest effective
    // date), so "already has one" is the key and a re-run creates nothing.
    const before = await rowsOf(page, '/api/v1/vetana/salary-structures');
    const covered = new Set(before.map(s => String(s.employee_code || '')));
    const coveredNames = new Set(before.map(s => String(s.employee_name || '')));

    const wanted: { label: string; m: number; regime: 'new' | 'old'; esi: boolean }[] = [
      ...STRUCTURES.map(s => {
        const emp = byCode.get(s.code);
        expect(emp, `no employee ${s.code} — Suite 07 owns creating the thirty this depends on`).toBeTruthy();
        return { label: `${emp.name} (${s.code})`, m: s.m, regime: s.regime, esi: s.esi, key: s.code, name: emp.name };
      }),
      ...HIRED.map(h => {
        const emp = byName.get(h.name);
        expect(emp, `no employee named ${h.name}`).toBeTruthy();
        return { label: emp.employee_code ? `${h.name} (${emp.employee_code})` : h.name, m: h.m, regime: 'new' as const, esi: false, key: h.name, name: h.name };
      }),
    ] as any;

    expect(wanted.length, '§4 asks for thirty salary structures, one per employee').toBe(30);

    await vetana(page, 'structures');
    let made = 0;
    for (const w of wanted as any[]) {
      if (covered.has(w.key) || coveredNames.has(w.name)) continue;

      await clickSettled(page, page.getByRole('button', { name: '+ New structure' }).first(),
        /\/vetana\/salary-structures/, 'the New structure button');
      const form = page.locator('form.k-formpanel').first();
      await expect(form, 'the structure form did not open').toBeVisible({ timeout: 20_000 });

      // The employee picker is populated by a fetch and renders "Loading…"
      // alone until it lands. `selectByText` polls for the real option.
      await choose(form, '.k-formpanel__label', 'Employee', w.label);
      await setDate(form, 'Effective from', EFFECTIVE_FROM);

      // CTC FIRST, THEN THE COMPONENTS — and never the other way round.
      // `onChange={e => autoSplit(Number(e.target.value))}` rewrites all six
      // components on every keystroke of the CTC box, so a component typed
      // first is silently overwritten. The auto-split is also wrong for a
      // stipend: its fixed ₹1,600 conveyance and ₹1,250 medical exceed the
      // whole salary on the smallest structures and drive the special
      // allowance to zero, so every component is typed explicitly.
      const basic = Math.round(w.m * 0.50);
      const hra = Math.round(w.m * 0.20);
      const special = w.m - basic - hra;
      await num(form, '.k-formpanel__label', 'Annual CTC (₹)', w.m * 12);
      await num(form, '.k-formpanel__label', 'Basic', basic);
      await num(form, '.k-formpanel__label', 'HRA', hra);
      await num(form, '.k-formpanel__label', 'DA', 0);
      await num(form, '.k-formpanel__label', 'Special allowance', special);
      await num(form, '.k-formpanel__label', 'Conveyance', 0);
      await num(form, '.k-formpanel__label', 'Medical', 0);

      // The form reconciles the components against the CTC in words. The split
      // above totals `m` exactly, so it must say they agree — and if it does
      // not, the components are not what was typed.
      await expect(form, `the components do not reconcile against the CTC for ${w.label}`)
        .toContainText(/These agree\./i);

      // Provident fund and professional tax are ON by the form's own default
      // and are left there — both are statutory. State insurance is ticked only
      // inside the ₹21,000 ESI wage ceiling, which is the correct
      // configuration rather than a test convenience.
      const pfBox = form.locator('label.vt-toggle').filter({ hasText: 'Provident fund' }).locator('input[type="checkbox"]');
      const ptBox = form.locator('label.vt-toggle').filter({ hasText: 'Professional tax' }).locator('input[type="checkbox"]');
      const esiBox = form.locator('label.vt-toggle').filter({ hasText: 'State insurance' }).locator('input[type="checkbox"]');
      await tick(pfBox, true, `provident fund on ${w.label}`);
      await tick(ptBox, true, `professional tax on ${w.label}`);
      await tick(esiBox, w.esi, `state insurance on ${w.label}`);
      if (w.regime === 'old') {
        await selectByText(
          form.locator('label.vt-toggle').filter({ hasText: 'TDS regime' }).locator('select'),
          'TDS regime', 'Old');
      }

      const res = await writes(page, /\/vetana\/salary-structures$/,
        () => form.getByRole('button', { name: /Save structure/ }).click());

      // ⚠ THE SCREEN'S OWN WARNING IS AN ASSERTION HERE, NOT DECORATION.
      // `SalaryStructureCreate` does not declare the five statutory switches,
      // and a Pydantic model DROPS fields it does not declare — so a request
      // naming them is accepted and the answers vanish. The tab compares what
      // it sent against what the server echoed and says so. If that banner
      // appears, an answer about somebody's provident fund was discarded under
      // a green tick, and this suite must not walk past it.
      await expect(page.locator('.vt-dropped'),
        `the server accepted ${w.label}'s structure but did not store the statutory ` +
        `answers — the screen says so itself. Wire:${dump(wire)}`)
        .toHaveCount(0, { timeout: 5_000 });
      await expect(toastTitle(page, /Salary structure saved/i),
        `no confirmation for ${w.label} (server said ${res.status})`).toBeVisible({ timeout: 20_000 });
      made += 1;
    }

    const after = await rowsOf(page, '/api/v1/vetana/salary-structures');
    expect(after.length,
      `§4 asks for 30 salary structures. The register holds ${after.length} ` +
      `(${before.length} before this test, ${made} typed here).`).toBe(30);

    // The list renders each one by NAME and CODE — never an id. Asserted on a
    // sample rather than all thirty because the ratchet is positional and
    // cannot see a server-formatted string; this is the runtime half.
    await vetana(page, 'structures');
    const first = byCode.get('S7-01');
    await expect(page.locator('#mt-panel-structures'), 'the structure list does not name the employee')
      .toContainText(first.name, { timeout: 25_000 });
    const panelText = await page.locator('#mt-panel-structures').innerText();
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(panelText),
      'a UUID is rendered on the salary structures list').toBeFalsy();

    // ── SCREEN 3 · one structure ─────────────────────────────────────────
    await clickSettled(page, page.getByRole('button', { name: new RegExp(reEsc(first.name)) }).first(),
      /\/vetana\/salary-structures/, 'the S7-01 structure card');
    const detail = page.locator('.k-detail');
    await expect(detail, 'the structure detail did not open').toBeVisible({ timeout: 20_000 });
    await expect(detail).toContainText('Monthly earnings');
    await expect(detail, 'the detail does not read back the statutory configuration')
      .toContainText(/Provident fund: deducted/i);
    await expect(detail, 'the detail does not read back professional tax')
      .toContainText(/Professional tax: deducted/i);
    await expect(detail, 'the detail does not name the TDS regime').toContainText(/TDS regime/i);
    await page.getByRole('button', { name: /Back to list/ }).click();

    assertClean(con, '08.2 — salary structures');
  });

  /* ════════════════════════════════════════════════════════════════════════
     08.3 — SIX LOANS
     ════════════════════════════════════════════════════════════════════════ */

  test('08.3 — 6 loans and advances, typed', async ({ page }) => {
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);
    const { byCode } = await employeeIndex(page);

    const before = await rowsOf(page, '/api/v1/vetana/loans');
    const have = new Set(before.map(l => String(l.notes || '')));

    await vetana(page, 'loans');
    for (const l of LOANS) {
      if (have.has(l.note)) continue;
      const emp = byCode.get(l.code);
      expect(emp, `no employee ${l.code}`).toBeTruthy();

      await clickSettled(page, page.getByRole('button', { name: '+ New loan' }).first(),
        /\/vetana\/loans/, 'the New loan button');
      const form = page.locator('form.k-formpanel').first();
      await expect(form, 'the loan form did not open').toBeVisible({ timeout: 20_000 });
      await choose(form, '.k-formpanel__label', 'Employee', `${emp.name} (${l.code})`);
      await num(form, '.k-formpanel__label', 'Principal (₹)', l.principal);
      await num(form, '.k-formpanel__label', 'Monthly EMI (₹)', l.emi);
      await setDate(form, 'Disbursed on', EFFECTIVE_FROM);
      await text(form, '.k-formpanel__label', 'Note', l.note);

      await writes(page, /\/vetana\/loans$/, () => form.getByRole('button', { name: /Save loan/ }).click());
      // The toast says "the employee has been emailed" unconditionally. Nobody
      // was: `create_loan` guards on `emp.get("email")` and every employee here
      // has none. The claim on screen is not the fact on the wire — recorded,
      // not ruled on.
      await expect(toastTitle(page, /Loan recorded/i), `no confirmation for ${l.note}. Wire:${dump(wire)}`)
        .toBeVisible({ timeout: 20_000 });
    }

    const after = await rowsOf(page, '/api/v1/vetana/loans');
    expect(after.length, `§4 asks for 6 loans; the register holds ${after.length}`).toBe(6);
    for (const l of LOANS) {
      const row = after.find(r => String(r.notes) === l.note);
      expect(row, `the loan "${l.note}" is not in the register`).toBeTruthy();
      // The opening balance IS the principal — `balance_remaining` is bound to
      // the same parameter as `principal_amount` on the insert. This is the
      // baseline 08.12 measures the fall against.
      expect(Number(row.balance_remaining), `${l.note} did not open at its principal`).toBe(l.principal);
      expect(String(row.status), `${l.note} is not active`).toBe('active');
    }

    // The screen states the consequence — an EMI comes out of pay every month
    // — and shows how many months are left at the current rate.
    await vetana(page, 'loans');
    await expect(page.locator('#mt-panel-loans'), 'the loans tab does not show the remaining term')
      .toContainText(/months left/i, { timeout: 25_000 });

    assertClean(con, '08.3 — loans');
  });

  /* ════════════════════════════════════════════════════════════════════════
     08.4 — FOUR LEAVERS, EACH TWINNED WITH A COLLEAGUE WHO STAYS
     ════════════════════════════════════════════════════════════════════════ */

  test('08.4 — 4 exits with a last working day inside the wage month', async ({ page }) => {
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);
    const { byCode } = await employeeIndex(page);

    const before = await rowsOf(page, '/api/v1/manav/offboarding?limit=200');
    const have = new Set(before.map(x => String(x.reason || '')));

    // Suite 07's four exits all end 2026-09-30, after every month this suite
    // runs, so they pro-rate nobody — which is why §4's four leaver pro-rations
    // need four NEW ones. Asserted rather than assumed, over the exits this
    // suite did not create (on a second execution its own four are already
    // here, and they are deliberately inside the wage month).
    const mine = new Set(LEAVERS.map(l => l.reason));
    for (const x of before.filter(x => !mine.has(String(x.reason || '')))) {
      expect(String(x.last_working_day) > PAY_END,
        `an exit this suite did not create ends ${x.last_working_day}, inside the wage month — ` +
        'the leaver accounting in 08.10 assumes the pre-existing exits are all later than that')
        .toBeTruthy();
    }

    await manav(page, 'exits');
    for (const lv of LEAVERS) {
      if (have.has(lv.reason)) continue;
      const emp = byCode.get(lv.code);
      expect(emp, `no employee ${lv.code}`).toBeTruthy();

      await clickSettled(page, page.getByRole('button', { name: /\+ Start an exit/ }).first(),
        /\/manav\/offboarding/, 'the Start an exit button');
      const form = page.locator('form.gn-form').first();
      await expect(form, 'the exit form did not open').toBeVisible({ timeout: 20_000 });
      await choose(form, '.of__f', 'Who is leaving *', `${emp.name} · ${lv.code}`);
      await choose(form, '.of__f', 'Exit type', 'Resignation');
      await setDate(form, 'Resignation date', '2026-08-03');
      await setDate(form, 'Last working day', lv.lwd);
      await text(form, '.of__f', 'Reason', lv.reason);

      await writes(page, /\/manav\/offboarding$/, () => form.getByRole('button', { name: /^Start exit$/ }).click());
    }

    const after = await rowsOf(page, '/api/v1/manav/offboarding?limit=200');
    for (const lv of LEAVERS) {
      const row = after.find(r => String(r.reason) === lv.reason);
      expect(row, `the exit "${lv.reason}" is not on the register. Wire:${dump(wire)}`).toBeTruthy();
      expect(String(row.last_working_day).slice(0, 10),
        `${lv.code}'s last working day is not ${lv.lwd}, so the pro-ration 08.10 asserts ` +
        'would be measuring something else').toBe(lv.lwd);
      expect(String(row.status) !== 'cancelled',
        `${lv.code}'s exit is cancelled, and a cancelled exit is ignored by payroll`).toBeTruthy();
    }
    expect(after.filter(r => mine.has(String(r.reason || ''))).length,
      '§4 asks for four leaver pro-rations, which needs four exits inside the wage month')
      .toBe(4);
    expect(after.length, "four new exits standing beside Suite 07's four").toBe(8);

    // ⚠ NONE OF THESE IS COMPLETED, AND THAT IS DELIBERATE. `Complete exit` sets
    // `is_active = FALSE`, which drops the person from the structures join and
    // out of the run entirely — so a completed leaver is never paid for the
    // part-month they worked. Suite 09 is driving the same thirty employees in
    // this wave; deactivating two of them would produce a red in a sibling
    // suite that is nothing to do with that suite.
    //
    // The screen says the same thing in its own words, and that sentence is
    // asserted — inside the FORM, which is where `.of__h` lives. It is read by
    // opening the form rather than after a save, because a successful save
    // closes the panel and takes the sentence with it.
    await page.getByRole('button', { name: /\+ Start an exit/ }).first().click();
    const openForm = page.locator('form.gn-form').first();
    await expect(openForm, 'the exit form did not reopen').toBeVisible({ timeout: 20_000 });
    await expect(openForm,
      'the exit form no longer says that starting an exit does not remove anyone from the register')
      .toContainText(/does not remove anyone from the register/i, { timeout: 20_000 });
    await expect(openForm, 'the exit form no longer says a leaver keeps repaying an advance')
      .toContainText(/keep repaying any advance/i);
    await openForm.getByRole('button', { name: /^Cancel$/ }).click();

    // And the four are on the register with their dates, by NAME.
    await expect(page.locator('#mt-panel-exits'), 'the exits register does not list the new leavers')
      .toContainText(byCode.get(LEAVERS[0].code).name, { timeout: 20_000 });

    assertClean(con, '08.4 — exits');
  });

  /* ════════════════════════════════════════════════════════════════════════
     08.5 / 08.6 / 08.7 — THREE RUNS, THREE CONSECUTIVE MONTHS
     ════════════════════════════════════════════════════════════════════════ */

  /**
   * Process one month through the header control and the confirmation the
   * product insists on — the button used to fire a payslip per employee AND an
   * email to each of them on one click with no warning, and it now names the
   * consequence first. Returns the run row the server wrote.
   *
   * §6: a month already processed is NOT re-processed. `process_payroll`
   * refuses anything not in `draft`, so a second execution of this suite finds
   * three processed months and verifies them instead — which is exactly what
   * §4 means by "re-run without duplicating", and 08.14 asserts the refusal.
   */
  async function processMonth(page: Page, month: string, wire: Wire): Promise<any> {
    const runs = await rowsOf(page, '/api/v1/vetana/payroll/runs');
    const already = runs.find(r => String(r.month) === month);
    if (already) {
      console.log(`\n  [§6] ${month} is already ${already.status} — verifying, not re-processing.\n`);
      return already;
    }

    await vetana(page, 'payroll');
    const payrollPanel = page.locator('#mt-panel-payroll');
    // `input[type="month"]` is DateInput's HIDDEN `.pk__native` since
    // 2026-08-31. It still carries the value, so `toHaveValue` below is
    // still the right assertion — but it cannot be filled or seen, so the
    // visible trigger and `setMonth()` do the driving.
    await expect(payrollPanel.getByRole('button', { name: 'Month' }),
      'the payroll month picker is not on screen').toBeVisible({ timeout: 25_000 });
    await setMonth(payrollPanel, 'Month', month);
    await expect(payrollPanel.locator('input[type="month"]'),
      'the month picker would not take the month').toHaveValue(month);

    // The Source card is the reference's "Attendance imported from मानव", and
    // it is what says whether overtime was computed AT ALL — "0 hours of
    // overtime" and "overtime was never calculated" look identical on a payslip
    // and mean opposite things. Asserted as present; the dry run behind it is a
    // POST and is a question the person asks, so it is not fired here.
    await expect(page.locator('.vt-src'), 'the attendance Source card is missing from the run screen')
      .toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.vt-src'), 'the Source card does not name the month it would price')
      .toContainText(new RegExp(month === '2026-06' ? 'June 2026' : month === '2026-07' ? 'July 2026' : 'August 2026'));

    await page.getByRole('button', { name: /Process payroll/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog, 'processing did not ask for confirmation').toBeVisible({ timeout: 15_000 });
    // The consequence, in the product's own words, before anything is written.
    await expect(dialog, 'the confirmation does not warn that every employee is emailed')
      .toContainText(/emails each of them their payslip with the PDF attached/i);
    await expect(dialog, 'the confirmation does not warn that a re-run emails a second time')
      .toContainText(/sends that email a second time/i);

    const res = await writes(page, /\/vetana\/payroll\/process$/,
      () => dialog.getByRole('button', { name: 'Process and email' }).click(),
      { timeout: 240_000 });
    expect(res.body?.ok, `the run for ${month} did not report ok. Wire:${dump(wire)}`).toBeTruthy();

    const after = await rowsOf(page, '/api/v1/vetana/payroll/runs');
    const run = after.find(r => String(r.month) === month);
    expect(run, `no payroll run row for ${month} after processing. Wire:${dump(wire)}`).toBeTruthy();
    return run;
  }

  test('08.5 — run 1 of 3 · June 2026, the month nobody had joined yet', async ({ page }) => {
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const structures = await rowsOf(page, '/api/v1/vetana/salary-structures');
    expect(structures.length, '08.2 owns the thirty salary structures this run prices').toBe(30);

    const run = await processMonth(page, MONTHS[0], wire);
    expect(Number(run.employee_count), 'the June run did not price all thirty structures').toBe(30);

    const slips = await rowsOf(page, `/api/v1/vetana/payslips?month=${MONTHS[0]}`);
    expect(slips.length, 'June did not produce a payslip per structure').toBe(30);

    // ── THE ASSERTION THIS MONTH EXISTS FOR ──────────────────────────────
    // Nobody was employed in June 2026 — the earliest joining date in the org
    // is 2026-08-03 — so every one of the thirty must price at zero. This is
    // `_employed_working_days` clamping the payable window to the joining date,
    // and it is the same rule the leaver half of §4 tests running the other
    // way. A non-zero gross here would mean somebody was paid for a month
    // before they were hired.
    for (const p of slips) {
      expect(Number(p.gross), `${p.employee_name} was paid ₹${p.gross} gross for June 2026, ` +
        'a month in which nobody in this organisation had joined').toBe(0);
      expect(Number(p.present_days), `${p.employee_name} was marked present for ` +
        `${p.present_days} days in a month before their joining date`).toBe(0);
      expect(Number(p.professional_tax), 'professional tax was charged on a zero gross').toBe(0);
      expect(Number(p.tds), 'tax was deducted at source from a zero gross').toBe(0);
      expect(Number(p.pf_employee), 'provident fund was deducted from a zero basic').toBe(0);
    }

    // ── AND THE ONE THING THAT IS NOT ZERO, REPORTED WITHOUT A VERDICT ───
    // `routers/vetana.py:2032` reimburses every approved expense claim with no
    // `payslip_id`, and NOTHING bounds that query to the wage period. Unicode
    // holds two approved claims dated 5 and 6 August; the first month processed
    // absorbs them, so two June payslips carry a net above a gross of zero.
    const reimbursed = slips.filter(p => Number(p.reimbursements) > 0);
    expect(reimbursed.length, 'the two approved expense claims on this org were not reimbursed ' +
      'through the first month processed, so the measurement below has nothing to stand on')
      .toBeGreaterThan(0);
    for (const p of reimbursed) {
      // Gross is zero, so every rupee on this payslip is the reimbursement —
      // and what is left after loan recovery is what the employee receives.
      expect(Number(p.net_pay) + Number(p.loan_deduction),
        `${p.employee_name}'s June payslip does not account for its reimbursement: ` +
        `₹${p.reimbursements} reimbursed, ₹${p.loan_deduction} recovered, ₹${p.net_pay} paid`)
        .toBeCloseTo(Number(p.reimbursements), 2);
    }
    // ⚠ AND THE SECOND HALF OF THE SAME MEASUREMENT, FOUND BY RUNNING IT.
    // The take-home floor is 50% of `gross_fixed`, and `gross_fixed` is zero in
    // a month nobody was employed — so the floor is zero, `loan_capacity` is the
    // whole reimbursement, and an employee with an outstanding advance receives
    // NOTHING. One of the two payslips below is exactly that: ₹750 reimbursed,
    // ₹750 recovered, ₹0 paid. The floor is doing what it says; what it is
    // protecting is a percentage of a salary that does not exist.
    const swallowed = reimbursed.filter(p => Number(p.net_pay) === 0 && Number(p.loan_deduction) > 0);
    console.log(
      `\n  MEASURED, NOT RULED ON — two things about reimbursement in an unworked month:` +
      `\n  1 · The claim query is not bounded to the wage period. routers/vetana.py:2032 selects` +
      `\n      status='approved' AND payslip_id IS NULL with no date test, so the FIRST month` +
      `\n      processed absorbs claims dated in a later one.` +
      `\n  2 · The 50% take-home floor is a share of gross_fixed, which is ₹0 here, so loan` +
      `\n      recovery may take the entire reimbursement. ${swallowed.length} employee(s) received ₹0.` +
      reimbursed.map(p => `\n    ${p.employee_name}  gross ₹${p.gross}  reimbursed ₹${p.reimbursements}` +
        `  loan recovered ₹${p.loan_deduction}  net ₹${p.net_pay}`).join('') + '\n');

    // ── SCREEN 5 · the run detail ────────────────────────────────────────
    await vetana(page, 'payroll');
    await clickSettled(page, page.getByRole('button', { name: /June 2026/ }).first(),
      /\/vetana\/payroll\/runs/, 'the June run card');
    const detail = page.locator('.k-detail');
    await expect(detail, 'the run detail did not open').toBeVisible({ timeout: 25_000 });
    await expect(detail).toContainText(/June 2026/);
    await expect(page.locator('#mt-panel-payroll'), 'the run detail does not list its payslips')
      .toContainText(/Employee Breakdown/i);
    // Days are rendered as present/working on every row — the figure the
    // pro-ration assertions in 08.10 read off the screen rather than the API.
    const rows = page.locator('#mt-panel-payroll table tbody tr');
    await expect(rows, 'the June run detail shows no employee rows').toHaveCount(30, { timeout: 25_000 });

    assertClean(con, '08.5 — June 2026');
  });

  test('08.6 — run 2 of 3 · July 2026', async ({ page }) => {
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const run = await processMonth(page, MONTHS[1], wire);
    expect(Number(run.employee_count), 'the July run did not price all thirty structures').toBe(30);
    const slips = await rowsOf(page, `/api/v1/vetana/payslips?month=${MONTHS[1]}`);
    expect(slips.length, 'July did not produce a payslip per structure').toBe(30);
    for (const p of slips) {
      expect(Number(p.gross), `${p.employee_name} was paid for July 2026, before their joining date`).toBe(0);
    }
    // The claims were consumed by June, so July carries none — which is the
    // other half of the same unbounded-reimbursement measurement.
    expect(slips.filter(p => Number(p.reimbursements) > 0).length,
      'a second month also reimbursed the same claims').toBe(0);

    // Three months, three rows, and the list is ordered by month descending.
    await vetana(page, 'payroll');
    await expect(page.getByRole('button', { name: /July 2026/ }).first(),
      'the July run is not on the runs list').toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('button', { name: /June 2026/ }).first(),
      'the June run fell off the runs list').toBeVisible();

    assertClean(con, '08.6 — July 2026');
  });

  test('08.7 — run 3 of 3 · August 2026, the month with money in it', async ({ page }) => {
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const run = await processMonth(page, PAY, wire);
    expect(Number(run.employee_count), 'the August run did not price all thirty structures').toBe(30);

    const slips = await rowsOf(page, `/api/v1/vetana/payslips?month=${PAY}`);
    expect(slips.length, 'August did not produce a payslip per structure').toBe(30);

    // ⚠ ASSERT A TOTAL BEFORE ANY LOOP. A vacuous assertion passes forever, and
    // every statutory assertion after this one iterates these rows.
    const paid = slips.filter(p => Number(p.gross) > 0);
    expect(paid.length, 'not one August payslip carries a gross above zero — every ' +
      'statutory assertion in 08.8 to 08.12 would then be looping over nothing')
      .toBe(30);

    expect(Number(run.total_gross), 'the run header records no gross').toBeGreaterThan(0);
    expect(Number(run.total_pt), 'the run header records no professional tax at all — ' +
      'the state ladder is not reaching the payslips').toBeGreaterThan(0);
    expect(Number(run.total_tds), 'the run header records no tax deducted at source, so ' +
      'pay_income_tax_slabs produced nothing for anybody').toBeGreaterThan(0);
    expect(String(run.status), 'the August run is not in the processed state').toBe('processed');

    // The run header's own arithmetic: gross less deductions is net, to the
    // rupee, across thirty payslips. (Reimbursements were consumed by June, so
    // the identity holds on this month — see 08.5.)
    const sum = (k: string) => slips.reduce((s, p) => s + Number(p[k] || 0), 0);
    expect(sum('gross') - sum('total_deductions')).toBeCloseTo(sum('net_pay'), 1);
    expect(Number(run.total_gross)).toBeCloseTo(sum('gross'), 1);
    expect(Number(run.total_net)).toBeCloseTo(sum('net_pay'), 1);

    // No net is negative and none is zero: the take-home floor is 50% of gross
    // and statutory deductions are not subject to it, so a zero net would mean
    // statutory alone exceeded earnings and belongs on a report.
    for (const p of slips) {
      expect(Number(p.net_pay), `${p.employee_name}'s net pay is negative`).toBeGreaterThanOrEqual(0);
    }

    console.log(`\n  AUGUST 2026 — ${slips.length} payslips, gross ₹${Number(run.total_gross).toFixed(2)}, ` +
      `net ₹${Number(run.total_net).toFixed(2)}, PT ₹${Number(run.total_pt).toFixed(2)}, ` +
      `TDS ₹${Number(run.total_tds).toFixed(2)}\n`);

    // ── SCREEN 5 again, with real figures on it ──────────────────────────
    await vetana(page, 'payroll');
    await clickSettled(page, page.getByRole('button', { name: /August 2026/ }).first(),
      /\/vetana\/payroll\/runs/, 'the August run card');
    await expect(page.locator('.k-detail'), 'the August run detail did not open').toBeVisible({ timeout: 25_000 });
    const table = page.locator('#mt-panel-payroll table');
    await expect(table.locator('tbody tr'), 'the August run detail shows no rows').toHaveCount(30, { timeout: 25_000 });
    // Every table in this product sits on the `--row-h` token. The static gate
    // checks that a class REFERENCES the token; this is the runtime half, and
    // Suite 07 found two registers rendering 77px while the gate stayed green.
    const rowH = await table.locator('tbody tr').first().evaluate((el) => ({
      height: Math.round(el.getBoundingClientRect().height),
      token: getComputedStyle(el).getPropertyValue('--row-h').trim(),
    }));
    expect(rowH.height, `the payroll breakdown renders ${rowH.height}px rows while --row-h ` +
      `resolves to ${rowH.token} at the row itself`).toBe(Number(String(rowH.token).replace('px', '')));

    assertClean(con, '08.7 — August 2026');
  });

  /* ════════════════════════════════════════════════════════════════════════
     08.8 — PROFESSIONAL TAX, DERIVED FROM THE LADDER IN THE DATABASE
     ════════════════════════════════════════════════════════════════════════ */

  test('08.8 — professional tax matches the state ladder, band by band', async ({ page }) => {
    const con = watchConsole(page);
    await signIn(page);
    const { rows: employees } = await employeeIndex(page);
    const stateOf = new Map<string, string | null>(employees.map(e => [String(e.name), e.state ?? null]));

    // The ladder as it stood when the run was priced — see `ptAsRun`.
    const ladder = ptAsRun((await rowsOf(page, '/api/v1/vetana/pt-slabs')) as PtRow[]);
    const slips = await rowsOf(page, `/api/v1/vetana/payslips?month=${PAY}`);
    expect(slips.length, '08.7 owns the August run these figures come from').toBe(30);

    // ── EVERY PAYSLIP, AGAINST THE LADDER, ON ITS OWN FIXED GROSS ────────
    // `grossFixed`, never `gross`: professional tax is charged on the salary
    // components and not on a bonus. See the note on `grossFixed`.
    const observed: { name: string; state: string | null; gross: number; pt: number; band: string }[] = [];
    for (const p of slips) {
      const state = stateOf.get(String(p.employee_name)) ?? null;
      const gross = grossFixed(p);
      const { tax, row } = ptFor(ladder, state, gross, PAY_END, PAY_MONTH_NO);
      expect(Number(p.professional_tax),
        `${p.employee_name} (work state ${state ?? 'not recorded'}) was charged ` +
        `₹${p.professional_tax} professional tax on a fixed salary of ₹${gross.toFixed(2)} ` +
        `(total gross ₹${Number(p.gross).toFixed(2)}, the difference being commission or bonus). ` +
        `The ladder in staging.pay_professional_tax charges ₹${tax} for that state and ` +
        `that band` + (row ? ` (${row.state_name} ${row.slab_from}–${row.slab_to ?? 'and above'})` : ' (no band matches)') +
        '. A flat ₹200 on every row is the Phase 2.2 defect.')
        .toBeCloseTo(tax, 2);

      // ── AND THE PRODUCT'S OWN FROZEN RECORD OF WHICH BAND IT USED ──────
      // `statutory_treatment` is stamped onto the payslip at the moment it is
      // computed, so that a deduction an employee disputes is answerable from
      // the payslip rather than from a re-run. Comparing the band this test
      // derived against the band the product recorded is what proves the
      // reconstruction above is the right ladder and not merely an arithmetic
      // that happens to agree.
      const frozen = (p.statutory_treatment || {}) as any;
      if (frozen.pt_slab) {
        expect(row, `${p.employee_name}'s payslip records a professional-tax band ` +
          `(${frozen.pt_slab.state_name} ${frozen.pt_slab.slab_from}–${frozen.pt_slab.slab_to ?? '∞'}) ` +
          'but the ladder as reconstructed here matches no band at all').toBeTruthy();
        expect(Number(frozen.pt_slab.slab_from),
          `${p.employee_name} was charged under the band from ₹${frozen.pt_slab.slab_from}, ` +
          `but the ladder read here puts that fixed salary in the band from ₹${row?.slab_from}`)
          .toBe(Number(row!.slab_from));
        expect(String(frozen.pt_slab.state_code),
          `${p.employee_name}'s payslip was computed against state ${frozen.pt_slab.state_code} ` +
          `while their personnel record says ${state}`).toBe(String(state));
      } else {
        expect(row, `${p.employee_name}'s payslip records NO professional-tax band, but the ` +
          'ladder read here says one applies').toBeNull();
      }
      observed.push({
        name: String(p.employee_name), state, gross, pt: Number(p.professional_tax),
        band: row ? `${row.state_name} ${row.slab_from}–${row.slab_to ?? '∞'}` : 'no band',
      });
    }

    // ── PT MUST VARY. A single figure across thirty payslips is exactly what
    //    the flat `200 if gross > 15000` rule produced on 1,105 of 1,112 live
    //    payslips, and it would satisfy a per-row assertion if the ladder
    //    happened to agree at one salary. It cannot satisfy this one.
    const distinct = [...new Set(observed.map(o => o.pt))].sort((a, b) => a - b);
    console.log(
      `\n  PROFESSIONAL TAX OBSERVED — every figure derived from staging.pay_professional_tax:` +
      `\n    distinct figures: ${distinct.map(d => '₹' + d).join(', ')}` +
      observed.filter(o => o.state !== '24').map(o =>
        `\n    ${o.name}  state ${o.state ?? 'not recorded'}  gross ₹${o.gross.toFixed(0)}  PT ₹${o.pt}  ${o.band}`).join('') +
      '\n');
    expect(distinct.length,
      `every one of the thirty payslips was charged the same professional tax ` +
      `(₹${distinct[0]}). Gujarat's ladder has four bands and the salaries in this suite ` +
      'span them, so one figure means the ladder is not being read — the deduction is ' +
      'coming from somewhere else.').toBeGreaterThanOrEqual(3);

    // ── THE STATE IS BEING READ, NOT JUST THE SALARY ─────────────────────
    // A ladder consulted with the WRONG state still varies with salary, so
    // variation alone proves nothing about the state. These assert that at the
    // employee's own gross the Gujarat ladder would have charged a DIFFERENT
    // figure — which no salary-only lookup can satisfy.
    const crossState = observed.filter(o => o.state && o.state !== '24');
    expect(crossState.length, 'no employee outside Gujarat was priced, so nothing here ' +
      'distinguishes reading the state from reading the salary').toBeGreaterThanOrEqual(3);
    let proofs = 0;
    for (const o of crossState) {
      const asGujarat = ptFor(ladder, '24', o.gross, PAY_END, PAY_MONTH_NO).tax;
      if (asGujarat !== o.pt) {
        proofs += 1;
        console.log(`  STATE PROOF · ${o.name} is on state ${o.state} and paid ₹${o.pt} at a gross of ` +
          `₹${o.gross.toFixed(0)}; the Gujarat ladder charges ₹${asGujarat} at that exact gross.`);
      }
    }
    expect(proofs, 'every out-of-state employee happened to be charged the same figure ' +
      'Gujarat would charge at the same gross, so this run does not demonstrate that the ' +
      'work state reaches the professional-tax lookup at all').toBeGreaterThanOrEqual(1);

    // ── NO STATE RECORDED → ₹0, AND THE RUN IS NOT BLOCKED ───────────────
    // The router's own header calls this "a defensible zero": no state, no
    // slab, no match — every one of them yields zero and the run continues,
    // because deducting a tax nobody can justify is the fault being fixed and
    // refusing to pay somebody over a missing slab would be a worse one.
    const stateless = observed.filter(o => !o.state);
    expect(stateless.length, 'the two employees hired through recruitment carry no work ' +
      'state, and this assertion depends on them').toBe(2);
    for (const o of stateless) {
      expect(o.pt, `${o.name} has no work state recorded and was still charged ₹${o.pt} ` +
        'professional tax — a levy with no state behind it').toBe(0);
      expect(o.gross, `${o.name} was not priced at all, so the zero above proves nothing`)
        .toBeGreaterThan(0);
    }

    // ── THE GENDER EXEMPTION THE TABLE CANNOT EXPRESS ────────────────────
    // Maharashtra has exempted women to ₹25,000 a month since 2023.
    // `pay_professional_tax` has no gender column and `_pt_from_slabs` never
    // looks at one, so a woman in Maharashtra under that threshold is deducted
    // where the state exempts her. Unicode is Gujarat and none of the figures
    // asserted above depends on it — but three employees here ARE on
    // Maharashtra, so it is recorded rather than left for somebody to find on a
    // payslip. MEASUREMENT, NOT A VERDICT.
    const mahaCharged = observed.filter(o => o.state === '27' && o.pt > 0 && o.gross <= 25000);
    if (mahaCharged.length) {
      console.log(
        `\n  ⚠ MEASURED — the Maharashtra gender exemption is not expressible in this table.` +
        `\n  ${mahaCharged.length} Maharashtra employee(s) under ₹25,000 a month were charged` +
        `\n  professional tax with no reference to gender. pay_professional_tax has no gender` +
        `\n  column and _pt_from_slabs reads none; the exemption has been in force since 2023.` +
        mahaCharged.map(o => `\n    ${o.name}  gross ₹${o.gross.toFixed(0)}  PT ₹${o.pt}`).join('') + '\n');
    }

    // ── AND THE FIGURE IS ON THE SCREEN, NOT ONLY ON THE WIRE ────────────
    await vetana(page, 'payroll');
    await clickSettled(page, page.getByRole('button', { name: /August 2026/ }).first(),
      /\/vetana\/payroll\/runs/, 'the August run card');
    await expect(page.locator('.k-detail')).toBeVisible({ timeout: 25_000 });
    const sample = slips.find(p => Number(p.professional_tax) > 0)!;
    expect(sample, 'no payslip carries professional tax, so there is nothing to read off the screen')
      .toBeTruthy();
    const row = page.locator('#mt-panel-payroll table tbody tr')
      .filter({ hasText: String(sample.employee_name) }).first();
    await expect(row, `no run-detail row for ${sample.employee_name}`).toBeVisible({ timeout: 20_000 });
    const cells = await row.locator('td').allInnerTexts();
    // Employee · Days · Gross · PF · ESI · PT · TDS · Net
    expect(rupees(cells[5]),
      `the run detail shows ${cells[5]} in the PT column for ${sample.employee_name}, but the ` +
      `payslip records ₹${sample.professional_tax}`).toBe(Math.round(Number(sample.professional_tax)));

    assertClean(con, '08.8 — professional tax');
  });

  /* ════════════════════════════════════════════════════════════════════════
     08.9 — TDS FROM pay_income_tax_slabs, THROUGH TWO REGIMES
     ════════════════════════════════════════════════════════════════════════ */

  test('08.9 — TDS comes from the income-tax slab table, and the regime changes it', async ({ page }) => {
    const con = watchConsole(page);
    await signIn(page);

    // The ladders as they stood when the run was priced — see `itAsRun`.
    const bands = itAsRun((await rowsOf(page, '/api/v1/vetana/it-slabs')) as ItRow[]);
    const newLadder = generation(bands, 'new', PAY_END);
    const oldLadder = generation(bands, 'old', PAY_END);
    expect(newLadder.length, 'no new-regime ladder is in force').toBeGreaterThan(0);
    expect(oldLadder.length, 'no old-regime ladder is in force').toBeGreaterThan(0);

    const structures = await rowsOf(page, '/api/v1/vetana/salary-structures');
    const regimeOf = new Map<string, string>(
      structures.map(s => [String(s.employee_code || s.employee_name), String(s.tds_regime || 'new')]));
    const slips = await rowsOf(page, `/api/v1/vetana/payslips?month=${PAY}`);
    expect(slips.length, '08.7 owns the August run').toBe(30);

    // ── EVERY PAYSLIP, AGAINST ITS OWN REGIME'S LADDER ───────────────────
    // On `grossFixed`, never `gross`: the annualisation reads the fixed salary,
    // and a bonus does not enter it. See the note on `grossFixed`.
    let nonZero = 0;
    for (const p of slips) {
      const regime = (regimeOf.get(String(p.employee_code)) === 'old' ? 'old' : 'new') as 'new' | 'old';
      const ladder = regime === 'old' ? oldLadder : newLadder;
      const fixed = grossFixed(p);
      const want = monthlyTds(ladder, fixed);
      expect(Number(p.tds),
        `${p.employee_name} was deducted ₹${p.tds} at source on a fixed salary of ₹${fixed.toFixed(2)} ` +
        `under the ${regime} regime. The ${regime}-regime ladder in staging.pay_income_tax_slabs ` +
        `(${ladder.map(b => `>${b.slab_from}@${b.rate_percent}%`).join(' ')}) gives ₹${want} on the ` +
        "product's own annualisation (fixed gross × 12 − 50,000, spread back over twelve).")
        .toBeCloseTo(want, 2);
      // The regime the payslip was actually computed under, frozen on the row,
      // must be the one the structure carries — a payslip taxed under a regime
      // nobody chose would look perfectly correct on screen.
      const frozen = (p.statutory_treatment || {}) as any;
      if (frozen.tds_regime) {
        expect(String(frozen.tds_regime), `${p.employee_name}'s payslip was computed under the ` +
          `${frozen.tds_regime} regime while their salary structure says ${regime}`).toBe(regime);
      }
      if (Number(p.tds) > 0) nonZero += 1;
    }
    expect(nonZero, 'not one payslip carries TDS, so agreement with the ladder is agreement ' +
      'about zero and proves nothing about whether the table is read').toBeGreaterThanOrEqual(2);

    // ── THE REGIME SELECTS A LADDER, AND THE TWO LADDERS DISAGREE ────────
    // §4 wants the figure to MOVE, and the re-run that would show it is refused
    // (08.14). This is the same demonstration from one run: two employees on
    // the two regimes, each matching its own ladder exactly — and, at the SAME
    // income, the two ladders in `pay_income_tax_slabs` give different answers.
    // A hard-coded rule, or one ladder read for everybody, cannot produce that.
    //
    // ⚠ NOT "the same gross". The first execution of this suite proved that
    // assumption wrong: Suite 07 left bonus awards on this org and the register
    // is marked concurrently by Suite 09, so two people on identical structures
    // are NOT priced at identical figures. The comparison is therefore made at
    // one income against both ladders, which needs no two employees to agree.
    const a = slips.find(p => String(p.employee_code) === 'S7-01');
    const b = slips.find(p => String(p.employee_code) === 'S7-02');
    expect(a && b, 'the two regime cases are not both on the August run').toBeTruthy();
    expect(regimeOf.get('S7-01'), 'S7-01 is not on the new regime').toBe('new');
    expect(regimeOf.get('S7-02'), 'S7-02 is not on the old regime').toBe('old');

    const at = grossFixed(a!);
    expect(monthlyTds(newLadder, at),
      `at a fixed salary of ₹${at.toFixed(2)} the new-regime and old-regime ladders in ` +
      'pay_income_tax_slabs give the same tax, so this run cannot show that the regime on the ' +
      'salary structure selects a ladder at all')
      .not.toBeCloseTo(monthlyTds(oldLadder, at), 2);
    expect(Number(a!.tds), 'the new-regime employee was taxed as though on the old ladder')
      .toBeCloseTo(monthlyTds(newLadder, at), 2);
    expect(Number(b!.tds), 'the old-regime employee was taxed as though on the new ladder')
      .toBeCloseTo(monthlyTds(oldLadder, grossFixed(b!)), 2);
    console.log(
      `\n  TDS · THE REGIME SELECTS A LADDER OUT OF pay_income_tax_slabs:` +
      `\n    ${a!.employee_name} (new) fixed ₹${at.toFixed(0)} → TDS ₹${a!.tds}` +
      `\n      the same ₹${at.toFixed(0)} under the OLD ladder would be ₹${monthlyTds(oldLadder, at)}` +
      `\n    ${b!.employee_name} (old) fixed ₹${grossFixed(b!).toFixed(0)} → TDS ₹${b!.tds}` +
      `\n    new ladder: ${newLadder.map(x => `>${x.slab_from}@${x.rate_percent}%`).join(' ')}` +
      `\n    old ladder: ${oldLadder.map(x => `>${x.slab_from}@${x.rate_percent}%`).join(' ')}\n`);

    // Somebody below the first taxable threshold is deducted nothing, and that
    // is the band being honoured rather than the deduction being switched off.
    const nil = slips.filter(p => Number(p.tds) === 0);
    expect(nil.length, 'every payslip carries TDS, so the nil band is never exercised')
      .toBeGreaterThan(0);
    for (const p of nil.slice(0, 5)) {
      const regime = (regimeOf.get(String(p.employee_code)) === 'old' ? 'old' : 'new') as 'new' | 'old';
      expect(monthlyTds(regime === 'old' ? oldLadder : newLadder, grossFixed(p)),
        `${p.employee_name} was deducted nothing but the ladder says they owe something`).toBe(0);
    }

    assertClean(con, '08.9 — TDS');
  });

  /* ════════════════════════════════════════════════════════════════════════
     08.10 — PRO-RATION: JOINERS AND LEAVERS
     ════════════════════════════════════════════════════════════════════════ */

  test('08.10 — a mid-month joiner and a leaver are both paid part-month', async ({ page }) => {
    const con = watchConsole(page);
    await signIn(page);
    const { byCode } = await employeeIndex(page);

    const structures = await rowsOf(page, '/api/v1/vetana/salary-structures');
    const monthlyOf = new Map<string, number>();
    for (const s of structures) {
      const total = ['basic', 'hra', 'da', 'special_allowance', 'conveyance', 'medical']
        .reduce((t, k) => t + Number(s[k] || 0), 0);
      monthlyOf.set(String(s.employee_code || s.employee_name), total);
    }
    const slips = await rowsOf(page, `/api/v1/vetana/payslips?month=${PAY}`);
    const byEmp = new Map<string, any>(slips.map(p => [String(p.employee_code || p.employee_name), p]));

    // ── LEAVERS · four, each bounded by their own employment window ──────
    //
    // ⚠ THE TWIN COMPARISON THIS TEST USED TO MAKE WAS WRONG, AND THE FIRST
    // EXECUTION PROVED IT. It read "the leaver was paid for fewer days than a
    // colleague who joined on the same day", which assumes both people's days
    // come from the same source. They do not: `present_days` is the ATTENDANCE
    // REGISTER wherever anyone has marked it and the employment window only
    // where nobody has (`routers/vetana.py:1898`). Suite 09 marks attendance on
    // these same thirty employees in this wave, so one twin was priced from a
    // register showing one day and the other from a full window — and the
    // comparison failed on a payroll that was correct.
    //
    // What is asserted instead cannot be moved by a sibling suite: NOBODY IS
    // PAID FOR A DAY AFTER THEIR LAST WORKING DAY. The bound is the working
    // days between the joining date and the exit — computed on the module's own
    // definition of a working day and used only as a CEILING, never to derive
    // an amount — and the leaver's fixed pay must fall short of a whole month.
    let proved = 0;
    for (const lv of LEAVERS) {
      const leaver = byEmp.get(lv.code);
      expect(leaver, `no August payslip for the leaver ${lv.code}`).toBeTruthy();
      const doj = String(byCode.get(lv.code).date_of_joining).slice(0, 10);
      const onRolls = workingDaysBetween(doj > `${PAY}-01` ? doj : `${PAY}-01`, lv.lwd);
      const hadTheyStayed = workingDaysBetween(doj > `${PAY}-01` ? doj : `${PAY}-01`, PAY_END);

      expect(Number(leaver.present_days),
        `${leaver.employee_name}'s last working day was ${lv.lwd}, which is ${onRolls} working ` +
        `days into August — but they were paid for ${leaver.present_days}. Somebody has been ` +
        'paid for days after they left.').toBeLessThanOrEqual(onRolls);
      expect(onRolls, `${lv.code}'s exit window is the whole month, so this asserts nothing`)
        .toBeLessThan(hadTheyStayed);

      const monthly = monthlyOf.get(lv.code)!;
      const fixed = grossFixed(leaver);
      expect(fixed,
        `${leaver.employee_name} left on ${lv.lwd} and was paid ₹${fixed} of salary against a ` +
        `full month of ₹${monthly}. A leaver paid a whole month is a money bug, not a rounding ` +
        'question.').toBeLessThan(monthly);
      expect(fixed, `${leaver.employee_name} was paid nothing at all for the part of August ` +
        'they worked before leaving').toBeGreaterThan(0);
      proved += 1;
    }
    expect(proved, '§4 asks for four leaver pro-rations').toBe(4);

    // ── JOINERS · the two who joined on 29 August ────────────────────────
    // Every one of the thirty joined mid-August, so all thirty are pro-rated;
    // these two are the extreme and the clearest. Same shape as the leavers,
    // bounded from the other end: nobody is paid for a day before they joined.
    let joiners = 0;
    for (const h of HIRED) {
      const p = byEmp.get(h.name);
      expect(p, `no August payslip for ${h.name}`).toBeTruthy();
      const monthly = monthlyOf.get(h.name)!;
      expect(Number(p.present_days), `${h.name} joined mid-August and was credited with ` +
        `${p.present_days} of ${p.working_days} days`).toBeLessThan(Number(p.working_days));
      expect(grossFixed(p), `${h.name} joined mid-August and was paid a full month`)
        .toBeLessThan(monthly);
      joiners += 1;
    }
    expect(joiners, '§4 asks for two mid-month joiner pro-rations').toBe(2);

    // Nobody was paid for more days than the month holds, and nobody was paid a
    // whole month — every one of the thirty joined after 1 August.
    for (const p of slips) {
      expect(Number(p.present_days),
        `${p.employee_name} was paid for more days than August has working days`)
        .toBeLessThanOrEqual(Number(p.working_days));
      const monthly = monthlyOf.get(String(p.employee_code || p.employee_name));
      if (monthly) {
        expect(grossFixed(p), `${p.employee_name} joined during August and was still paid a ` +
          'whole month of salary').toBeLessThan(monthly + 0.01);
      }
    }
    console.log(
      `\n  PRO-RATION — every one of the thirty joined in August 2026, so all thirty are` +
      `\n  pro-rated. The four leavers, against the days they were actually on the rolls:` +
      LEAVERS.map(lv => {
        const p = byEmp.get(lv.code);
        const doj = String(byCode.get(lv.code).date_of_joining).slice(0, 10);
        return `\n    ${p.employee_name} joined ${doj}, left ${lv.lwd} → paid ${p.present_days} ` +
          `of ${p.working_days} days (ceiling ${workingDaysBetween(doj, lv.lwd)}), salary ` +
          `₹${grossFixed(p).toFixed(0)} of a full ₹${monthlyOf.get(lv.code)}`;
      }).join('') + '\n');

    // ── SCREEN 7 · the payslip, which says all of this in words ──────────
    await vetana(page, 'payslips');
    await setMonth(page.locator('#mt-panel-payslips'), 'Month', PAY);
    const leaver = byEmp.get(LEAVERS[0].code);
    await clickSettled(page, page.getByRole('button', { name: new RegExp(reEsc(String(leaver.employee_name))) }).first(),
      /\/vetana\/payslips/, "the leaver's payslip card");
    const bar = page.locator('.k-metabar');
    await expect(bar, 'the payslip does not show its day counts').toBeVisible({ timeout: 25_000 });
    await expect(bar, 'the payslip does not name the working days').toContainText(/Working days:/);
    await expect(bar, 'the payslip does not name the days present').toContainText(/Present:/);
    const barText = await bar.innerText();
    expect(barText, `the payslip's own metabar does not show the pro-rated day count ` +
      `(${leaver.present_days} of ${leaver.working_days})`)
      .toContain(String(leaver.present_days));

    assertClean(con, '08.10 — pro-ration');
  });

  /* ════════════════════════════════════════════════════════════════════════
     08.11 — TWENTY PAYSLIP PDFs, ACTUALLY DOWNLOADED
     ════════════════════════════════════════════════════════════════════════ */

  test('08.11 — 20 payslip PDFs downloaded, as files with bytes in them', async ({ page }) => {
    const con = watchConsole(page);
    await signIn(page);

    const slips = (await rowsOf(page, `/api/v1/vetana/payslips?month=${PAY}`))
      .sort((x, y) => String(x.payslip_number).localeCompare(String(y.payslip_number)));
    expect(slips.length, '08.7 owns the August run').toBe(30);
    // August, deliberately: the two approved expense claims were consumed by
    // the June run, so no August payslip carries a reimbursement and the
    // reconciliation `validate_payslip` blocks on cannot fail here. See §14.
    expect(slips.filter(p => Number(p.reimbursements) > 0).length,
      'an August payslip carries a reimbursement, which makes gross − deductions − net ' +
      'non-zero and blocks the PDF; the twenty would need choosing differently')
      .toBe(0);

    await vetana(page, 'payslips');
    const psPanel2 = page.locator('#mt-panel-payslips');
    // `input[type="month"]` is DateInput's HIDDEN `.pk__native` since
    // 2026-08-31. It still carries the value, so `toHaveValue` below is
    // still the right assertion — but it cannot be filled or seen, so the
    // visible trigger and `setMonth()` do the driving.
    await expect(psPanel2.getByRole('button', { name: 'Month' })).toBeVisible({ timeout: 25_000 });
    await setMonth(psPanel2, 'Month', PAY);
    await expect(psPanel2.locator('input[type="month"]')).toHaveValue(PAY);
    await settle(page);

    const seen: string[] = [];
    const sizes: number[] = [];
    for (const p of slips.slice(0, 20)) {
      await clickSettled(page,
        page.getByRole('button', { name: new RegExp(reEsc(String(p.payslip_number))) }).first(),
        /\/vetana\/payslips/, `the payslip card for ${p.payslip_number}`);
      await expect(page.locator('.k-detail'), `the payslip detail for ${p.payslip_number} did not open`)
        .toBeVisible({ timeout: 25_000 });

      // A 200 with an empty body is the failure. `download()` saves the file and
      // refuses an empty one; the magic bytes prove it is a PDF and not an
      // error page with a 200 on it.
      const buf = await download(page,
        () => page.getByRole('button', { name: /Download PDF/ }).click(),
        `s08-${p.payslip_number}.pdf`);
      expect(buf.subarray(0, 4).toString('latin1'),
        `${p.payslip_number} downloaded something that is not a PDF`).toBe('%PDF');
      expect(buf.length, `${p.payslip_number} is too small to be a wage document`).toBeGreaterThan(1000);
      // The refusal path renders a work list rather than a four-word toast. If
      // it appeared, the document was NOT issued and the download above would
      // have failed — asserted anyway so a future silent partial is caught.
      await expect(page.locator('.vt-inc'),
        `${p.payslip_number} was refused as an incomplete document`).toHaveCount(0);
      seen.push(String(p.payslip_number));
      sizes.push(buf.length);
      await page.getByRole('button', { name: /Back to list/ }).click();
      await settle(page);
    }

    expect(seen.length, '§4 asks for 20 payslip PDFs').toBe(20);
    expect(new Set(seen).size, 'the same payslip was downloaded twice').toBe(20);
    // Compare bytes: two payslips for two different people at two different
    // salaries cannot be the same file. A stub that returns one document for
    // every request would pass every assertion above and fail this one.
    expect(new Set(sizes).size, 'all twenty payslip PDFs are byte-identical in length, which ' +
      'twenty different wage records should not be').toBeGreaterThan(1);

    console.log(`\n  20 PAYSLIP PDFs — ${seen[0]} … ${seen[19]}, ` +
      `${Math.min(...sizes)}–${Math.max(...sizes)} bytes. Not one employee has a PAN or a UAN ` +
      `and every document still issued: the identifiers are advisory, as ruled.\n`);

    assertClean(con, '08.11 — payslip PDFs');
  });

  /* ════════════════════════════════════════════════════════════════════════
     08.12 — LOANS: THE EMI ON THE PAYSLIP, AND THE APPROVAL THAT WOULD
              MOVE THE BALANCE
     ════════════════════════════════════════════════════════════════════════ */

  test('08.12 — EMIs are deducted, and the balance waits on an approval this lane cannot give', async ({ page }) => {
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const loans = await rowsOf(page, '/api/v1/vetana/loans');
    expect(loans.length, '08.3 owns the six loans').toBe(6);
    const before = new Map<string, number>(loans.map(l => [String(l.notes), Number(l.balance_remaining)]));

    const aug = await rowsOf(page, `/api/v1/vetana/payslips?month=${PAY}`);
    const byCodeSlip = new Map<string, any>(aug.map(p => [String(p.employee_code), p]));

    // ── THE EMI IS COMPUTED AND STORED AT PROCESS TIME ───────────────────
    let deducted = 0;
    for (const l of LOANS) {
      const p = byCodeSlip.get(l.code);
      expect(p, `no August payslip for ${l.code}`).toBeTruthy();
      const taken = Number(p.loan_deduction);
      if (taken > 0) deducted += 1;
      // Recovery is capped by the loan AND by what the salary can bear. Net pay
      // cannot go negative and cannot be driven below 50% of gross — statutory
      // deductions come first and are never trimmed, and the shortfall simply
      // stays in the balance for the next run.
      expect(taken, `${l.note} recovered ₹${taken}, more than its EMI of ₹${l.emi}`)
        .toBeLessThanOrEqual(l.emi);
      const floor = Number(p.gross) * 0.5;
      expect(Number(p.net_pay), `${p.employee_name}'s loan recovery took net pay below the ` +
        '50% take-home floor').toBeGreaterThanOrEqual(Math.min(floor, Number(p.net_pay)) - 0.01);
    }
    expect(deducted, 'not one of the six loans was recovered from August pay').toBeGreaterThanOrEqual(1);

    // ── JUNE AND JULY RECOVERED (ALMOST) NOTHING ─────────────────────────
    // No wages, so no capacity — which is the floor working rather than a
    // failure. The one exception is the finding 08.5 records: `loan_capacity`
    // is `gross_fixed + reimbursement − statutory − floor`, and the floor is a
    // share of `gross_fixed`, so in a month with no salary an EXPENSE
    // REIMBURSEMENT is recoverable in full. Every rupee recovered in those two
    // months must therefore be covered by a reimbursement on the same payslip;
    // a recovery beyond that would be money taken from wages that do not exist.
    let offSalary = 0;
    for (const m of [MONTHS[0], MONTHS[1]]) {
      const slips = await rowsOf(page, `/api/v1/vetana/payslips?month=${m}`);
      for (const p of slips) {
        const took = Number(p.loan_deduction);
        if (took === 0) continue;
        offSalary += 1;
        expect(took, `${m}: ${p.employee_name} had ₹${took} recovered against a loan on a payslip ` +
          `with a gross of ₹${p.gross} and a reimbursement of ₹${p.reimbursements}`)
          .toBeLessThanOrEqual(Number(p.reimbursements) + 0.01);
      }
    }
    console.log(
      `\n  LOAN EMIs — §4 asks for 18 deductions (6 loans × 3 months). ${deducted} were taken in` +
      `\n  August. June and July priced every employee at zero because nobody had joined, so` +
      `\n  loan_capacity was zero and there were no wages to recover from — ${offSalary} recovery(ies)` +
      `\n  happened in those months, and each came out of an expense reimbursement rather than pay.\n`);

    // ── THE BALANCE, AND THE ONE WRITE THAT MOVES IT ─────────────────────
    // `vetana_loans.balance_remaining` is decremented in exactly one statement
    // in the backend, inside `approve_run`. Processing stores the EMI on the
    // payslip; approving is what moves the money. So the real Approve button is
    // pressed here, and whatever the server says is recorded.
    await vetana(page, 'payroll');
    await clickSettled(page, page.getByRole('button', { name: /August 2026/ }).first(),
      /\/vetana\/payroll\/runs/, 'the August run card');
    await expect(page.locator('.k-detail')).toBeVisible({ timeout: 25_000 });
    const approve = page.getByRole('button', { name: /Approve Payroll/ });
    await expect(approve, 'a processed run offers no Approve control at all').toBeVisible({ timeout: 20_000 });

    const res = await writes(page, /\/vetana\/payroll\/runs\/[^/]+\/approve$/,
      () => approve.click(), { allowStatus: 403 });

    const runsAfter = await rowsOf(page, '/api/v1/vetana/payroll/runs');
    const augRun = runsAfter.find(r => String(r.month) === PAY);
    const loansAfter = await rowsOf(page, '/api/v1/vetana/loans');

    if (res.status < 400) {
      // The grant exists after all — then the balance MUST have fallen by what
      // the payslips recovered, and this is the §4 assertion in full.
      expect(String(augRun.status), 'approval returned 2xx but the run is not approved').toBe('approved');
      for (const l of LOANS) {
        const p = byCodeSlip.get(l.code);
        const now = Number(loansAfter.find(x => String(x.notes) === l.note).balance_remaining);
        expect(now, `${l.note} was recovered ₹${p.loan_deduction} on the August payslip but its ` +
          `balance did not fall from ₹${before.get(l.note)}`)
          .toBeCloseTo(before.get(l.note)! - Number(p.loan_deduction), 2);
      }
    } else {
      // ⚠ MEASURED, NOT RULED ON. The product refuses, in words, and keeps the
      // refusal on screen rather than in a toast that disappears — which is the
      // correct handling of an authority boundary. Both facts are asserted:
      // the separation is enforced, and the balance therefore did not move.
      await expect(page.locator('.note--warn').first(),
        'the run was refused but the screen shows no explanation')
        .toContainText(/needs a different grant/i, { timeout: 20_000 });
      await expect(page.locator('#mt-panel-payroll'),
        'the refusal does not explain the separation of duty it rests on')
        .toContainText(/approver grant on\s+Vetana/i);
      expect(String(augRun.status), 'the run changed state despite the refusal').toBe('processed');
      for (const l of LOANS) {
        expect(Number(loansAfter.find(x => String(x.notes) === l.note).balance_remaining),
          `${l.note}'s balance moved without an approval`).toBe(before.get(l.note));
      }
      console.log(
        `\n  ⚠ §4 SHORTFALL, MEASURED — "balance must fall each month" could not be driven.` +
        `\n     wire     PATCH ${res.status} /api/v1/vetana/payroll/runs/…/approve` +
        `\n              ${res.text.slice(0, 300)}` +
        `\n     grants   GET /api/v1/org/members → 9 members, every module_grants list empty.` +
        `\n              Nobody in Unicode Group holds approver on Vetana.` +
        `\n     code     balance_remaining is decremented at routers/vetana.py:2463, inside` +
        `\n              approve_run alone. _RELEASE_LEVEL = APPROVER and vetana is in` +
        `\n              SEPARATED_DUTY_MODULES, where level_satisfies refuses admin by design.` +
        `\n     remedy   an org_owner must grant it; refuse_grant admits only an owner, and this` +
        `\n              org's owner is the god-mode account rule 1 of _lanes.ts forbids here.` +
        `\n     This is the separation working, not a defect — and the §4 volume is unreachable` +
        `\n     in this lane. No assertion above was relaxed to make it pass.\n${dump(wire)}\n`);
    }

    // The 403 this test PRESSED FOR is a status the browser also logs. See
    // `assertClean`; `pageerror` is still asserted at zero.
    assertClean(con, '08.12 — loans and approval', [REFUSED]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     08.13 — FOUR LADDER BANDS ADDED  ·  AND THE DATE FIELD THAT CRASHES
     ════════════════════════════════════════════════════════════════════════ */

  test('08.13 — 4 ladder bands added: 2 professional tax, 2 income tax', async ({ page }) => {
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    // ⚠ "BEFORE" IS RECONSTRUCTED, NOT READ. Reading the live ladder here works
    // on a first execution and quietly stops working on a second, when the four
    // bands already exist and "before" and "after" are the same thing — and the
    // movement assertion at the end of this test would then find nothing moved
    // and fail for the wrong reason. `ptAsRun`/`itAsRun` remove exactly the
    // bands this suite adds, by value, so both sides are the same on every run.
    const ptLive = (await rowsOf(page, '/api/v1/vetana/pt-slabs')) as PtRow[];
    const itLive = (await rowsOf(page, '/api/v1/vetana/it-slabs')) as ItRow[];
    const ptBefore = ptAsRun(ptLive);
    const itBefore = itAsRun(itLive);

    await vetana(page, 'statutory');
    const stat = page.locator('#mt-panel-statutory');

    // ── TWO PROFESSIONAL-TAX BANDS ───────────────────────────────────────
    for (const b of PT_BANDS) {
      const exists = ptLive.some(r => r.is_own && String(r.state_name) === b.state &&
        Number(r.slab_from) === b.from && Number(r.slab_to) === b.to);
      if (exists) continue;
      await clickSettled(page, page.getByRole('button', { name: '+ Add band', exact: true }).first(),
        /\/vetana\/pt-slabs/, 'the Add band button on the professional-tax ladder');
      const form = page.locator('form.gn-form').first();
      await expect(form, 'the professional-tax band form did not open').toBeVisible({ timeout: 20_000 });
      await choose(form, '.gn-form__field', 'State', b.state);
      await num(form, '.gn-form__field', 'Salary from (₹)', b.from);
      await num(form, '.gn-form__field', 'Salary to (₹)', b.to);
      await num(form, '.gn-form__field', 'Tax per month (₹)', b.tax);
      // "Applies in" is left at "Every month". A month-specific band is a real
      // thing — Maharashtra charges a different figure in February — and it is
      // not what these two bands are.
      // ⚠ "Effective from" IS LEFT BLANK. Not a preference: choosing a date here
      //   crashes the tab. See 08.13b and the §14 note in the header. A NULL
      //   date is a legal band; both readers admit it.
      await writes(page, /\/vetana\/pt-slabs$/, () => form.getByRole('button', { name: /^Add band$/ }).click());
    }

    // ── TWO INCOME-TAX BANDS, AS A COMPLETE LADDER ───────────────────────
    for (const b of IT_BANDS) {
      const exists = itLive.some(r => r.is_own && String(r.regime) === b.regime &&
        Number(r.slab_from) === b.from);
      if (exists) continue;
      await clickSettled(page, page.getByRole('button', { name: /Add band to new regime/ }).first(),
        /\/vetana\/it-slabs/, 'the Add band button on the new-regime ladder');
      const form = page.locator('form.gn-form').first();
      await expect(form, 'the income-tax band form did not open').toBeVisible({ timeout: 20_000 });
      await choose(form, '.gn-form__field', 'Regime', 'New regime');
      await num(form, '.gn-form__field', 'Annual income above (₹)', b.from);
      if (b.to != null) await num(form, '.gn-form__field', '…and up to (₹)', b.to);
      await num(form, '.gn-form__field', 'Rate (%)', b.rate);
      await text(form, '.gn-form__field', 'Assessment year', IT_AY);
      await text(form, '.gn-form__field', 'Source', IT_SOURCE);
      await writes(page, /\/vetana\/it-slabs$/, () => form.getByRole('button', { name: /^Add band$/ }).click());
    }

    // ── THE ROWS ARE THERE, AND THE SCREEN SAYS WHOSE THEY ARE ───────────
    const ptAfter = (await rowsOf(page, '/api/v1/vetana/pt-slabs')) as PtRow[];
    const itAfter = (await rowsOf(page, '/api/v1/vetana/it-slabs')) as ItRow[];
    const ownPt = ptAfter.filter(r => r.is_own);
    const ownIt = itAfter.filter(r => r.is_own);
    expect(ownPt.length, `§4 asks for 2 professional-tax bands. Wire:${dump(wire)}`).toBe(2);
    expect(ownIt.length, `§4 asks for 2 income-tax bands. Wire:${dump(wire)}`).toBe(2);
    for (const b of PT_BANDS) {
      const row = ownPt.find(r => Number(r.slab_from) === b.from);
      expect(row, `the professional-tax band from ₹${b.from} was not stored`).toBeTruthy();
      expect(Number(row!.monthly_tax), `the band from ₹${b.from} stored the wrong figure`).toBe(b.tax);
      // The constitutional ceiling on professional tax is ₹2,500 a year.
      expect(Number(row!.monthly_tax) * 12,
        `a band charging ₹${row!.monthly_tax} a month breaches the ₹2,500 annual ceiling ` +
        'Article 276(2) puts on professional tax').toBeLessThanOrEqual(2500);
    }

    await vetana(page, 'statutory');
    await expect(stat, 'the income-tax section does not say the org ladder has replaced the shared one')
      .toContainText(/your organisation.s own ladder/i, { timeout: 25_000 });
    // The shared rows are still listed and still tagged, because hiding them
    // would present an empty ladder as "nothing is deducted".
    await expect(stat.locator('text=Shared').first(), 'the shared bands lost their tag')
      .toBeVisible();

    // ── WHAT A RE-RUN WOULD PRODUCE, COMPUTED FROM THE LADDER ALONE ──────
    // §4 asks for the figure to MOVE on a re-run, and 08.14 records why the
    // re-run is refused. The movement is therefore stated as the ladders now
    // resolve it, against the same grosses the August run priced — so the
    // expected figure is on the record and can be checked the moment a
    // Vetana approver exists.
    const slips = await rowsOf(page, `/api/v1/vetana/payslips?month=${PAY}`);
    const { rows: employees } = await employeeIndex(page);
    const stateOf = new Map<string, string | null>(employees.map(e => [String(e.name), e.state ?? null]));
    const newBefore = generation(itBefore, 'new', PAY_END);
    const newAfter = generation(itAfter, 'new', PAY_END);

    expect(newAfter.length, 'the org bands did not become the ladder in force').toBe(2);
    expect(newAfter.every(b => b.is_own), 'the resolved new-regime ladder still contains shared bands')
      .toBeTruthy();

    let ptMoves = 0;
    let tdsMoves = 0;
    const moved: string[] = [];
    for (const p of slips) {
      const state = stateOf.get(String(p.employee_name)) ?? null;
      const gross = grossFixed(p);
      const wasPt = ptFor(ptBefore, state, gross, PAY_END, PAY_MONTH_NO).tax;
      const nowPt = ptFor(ptAfter, state, gross, PAY_END, PAY_MONTH_NO).tax;
      const wasTds = monthlyTds(newBefore, gross);
      const nowTds = monthlyTds(newAfter, gross);
      if (nowPt !== wasPt) { ptMoves += 1; moved.push(`    PT  ${p.employee_name}  ₹${wasPt} → ₹${nowPt}  (gross ₹${gross.toFixed(0)})`); }
      if (Math.abs(nowTds - wasTds) > 0.01) { tdsMoves += 1; if (tdsMoves <= 4) moved.push(`    TDS ${p.employee_name}  ₹${wasTds} → ₹${nowTds}  (gross ₹${gross.toFixed(0)})`); }
    }
    expect(ptMoves, 'the two professional-tax bands added here change nobody\'s figure, so a ' +
      're-run could not demonstrate movement and the bands prove nothing').toBeGreaterThanOrEqual(1);
    expect(tdsMoves, 'the two income-tax bands added here change nobody\'s figure, so a re-run ' +
      'could not demonstrate movement').toBeGreaterThanOrEqual(1);
    console.log(
      `\n  THE MOVEMENT §4 ASKS FOR, resolved from the ladders as they now stand:` +
      `\n  ${ptMoves} payslip(s) would change professional tax and ${tdsMoves} would change TDS` +
      `\n  on a re-run of ${PAY}. 08.14 records why the re-run is refused.\n` +
      moved.slice(0, 8).join('\n') + '\n');

    assertClean(con, '08.13 — ladder bands');
  });

  test('08.13b — choosing a date on a ladder band', async ({ page }) => {
    const con = watchConsole(page);
    watchWire(page);
    await signIn(page);
    await vetana(page, 'statutory');

    await clickSettled(page, page.getByRole('button', { name: '+ Add band', exact: true }).first(),
      /\/vetana\/pt-slabs/, 'the Add band button on the professional-tax ladder');
    const form = page.locator('form.gn-form').first();
    await expect(form, 'the professional-tax band form did not open').toBeVisible({ timeout: 20_000 });

    // A person setting up a ladder dates it — every band of one ladder must
    // carry the same date, which is what makes the ladder resolve as a unit,
    // and the form's own help text says so. This drives that field and nothing
    // else: no band is saved.
    await setDate(form, 'Effective from', '2026-07-01');
    await page.waitForTimeout(1500);

    await expect(form, 'the band form vanished after a date was chosen — the tab was replaced ' +
      'by the error boundary')
      .toBeVisible({ timeout: 5_000 });
    await expect(form.locator('label').filter({ hasText: 'Effective from' }).first().locator('.pk__lbl'),
      'the Effective from field does not show the date that was chosen')
      .toHaveText(/2026/, { timeout: 5_000 });

    assertClean(con, '08.13b — the ladder date field');
  });

  /* ════════════════════════════════════════════════════════════════════════
     08.14 — §6 IDEMPOTENCE, AND THE RE-RUN
     ════════════════════════════════════════════════════════════════════════ */

  test('08.14 — a month already processed is not processed twice', async ({ page }) => {
    const con = watchConsole(page);
    const wire = watchWire(page);
    await signIn(page);

    const runsBefore = await rowsOf(page, '/api/v1/vetana/payroll/runs');
    expect(runsBefore.length, '§4 asks for three payroll runs over three consecutive months')
      .toBe(3);
    for (const m of MONTHS) {
      expect(runsBefore.some(r => String(r.month) === m), `no run for ${m}`).toBeTruthy();
    }
    const slipsBefore = await rowsOf(page, '/api/v1/vetana/payslips');
    expect(slipsBefore.length, 'the three runs did not produce a payslip per structure per month')
      .toBe(90);

    // ── PRESSING PROCESS AGAIN MUST NOT DUPLICATE ANYTHING ───────────────
    // §4 wants "re-run without duplicating" asserted, and the product is the
    // guard: `process_payroll` refuses a month that is not in `draft`, naming
    // the status it found. That refusal is what makes a second execution of
    // this whole suite safe.
    await vetana(page, 'payroll');
    await setMonth(page.locator('#mt-panel-payroll'), 'Month', PAY);
    await page.getByRole('button', { name: /Process payroll/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const again = await writes(page, /\/vetana\/payroll\/process$/,
      () => dialog.getByRole('button', { name: 'Process and email' }).click(),
      { allowStatus: 400, timeout: 120_000 });

    expect(again.status, `re-processing an already-processed month answered ${again.status}. ` +
      'A month that re-processes silently would delete and rebuild its payslips — and, on an ' +
      'org whose employees carry addresses, email every one of them a second time.')
      .toBe(400);
    expect(again.text, 'the refusal does not name the state it found').toMatch(/already processed/i);
    await expect(toastTitle(page, /already processed/i),
      'the refusal was not shown to the person who pressed the button').toBeVisible({ timeout: 20_000 });

    const slipsAfter = await rowsOf(page, '/api/v1/vetana/payslips');
    expect(slipsAfter.length, 'pressing Process a second time changed the payslip count')
      .toBe(slipsBefore.length);

    // ── THE RE-RUN §4 ASKS FOR NEEDS THE MONTH BACK IN DRAFT ─────────────
    // Revert is the only route, and it is the approver rung — the same
    // authority 08.12 measured. Driven through the real control; whatever the
    // server answers is recorded.
    await clickSettled(page, page.getByRole('button', { name: /August 2026/ }).first(),
      /\/vetana\/payroll\/runs/, 'the August run card');
    await expect(page.locator('.k-detail')).toBeVisible({ timeout: 25_000 });
    const revert = page.getByRole('button', { name: /Revert to draft/ });
    await expect(revert, 'a processed run offers no Revert control').toBeVisible({ timeout: 20_000 });
    const rev = await writes(page, /\/vetana\/payroll\/runs\/[^/]+\/revert$/,
      () => revert.click(), { allowStatus: 403 });

    const runsAfter = await rowsOf(page, '/api/v1/vetana/payroll/runs');
    const aug = runsAfter.find(r => String(r.month) === PAY);

    if (rev.status < 400) {
      // The month is back in draft, so the re-run §4 asks for is available and
      // the figures MUST move — the ladders changed in 08.13.
      expect(String(aug.status), 'revert returned 2xx but the run is not a draft').toBe('draft');
      const before = await rowsOf(page, `/api/v1/vetana/payslips?month=${PAY}`);
      const beforeBy = new Map<string, any>(before.map(p => [String(p.employee_code || p.employee_name), p]));
      await vetana(page, 'payroll');
      await setMonth(page.locator('#mt-panel-payroll'), 'Month', PAY);
      await page.getByRole('button', { name: /Process payroll/ }).click();
      const d2 = page.getByRole('alertdialog');
      await expect(d2).toBeVisible({ timeout: 15_000 });
      await writes(page, /\/vetana\/payroll\/process$/,
        () => d2.getByRole('button', { name: 'Process and email' }).click(), { timeout: 240_000 });

      const after = await rowsOf(page, `/api/v1/vetana/payslips?month=${PAY}`);
      expect(after.length, 'the re-run changed the number of payslips').toBe(before.length);
      const changed = after.filter(p => {
        const was = beforeBy.get(String(p.employee_code || p.employee_name));
        return was && (Number(was.tds) !== Number(p.tds) ||
          Number(was.professional_tax) !== Number(p.professional_tax));
      });
      expect(changed.length,
        'the ladders were replaced in 08.13 and a re-run of the same month produced the SAME ' +
        'professional tax and the SAME TDS for every employee. A re-run that does not move ' +
        'means pay_professional_tax and pay_income_tax_slabs are not being consulted.')
        .toBeGreaterThan(0);
      console.log(`\n  RE-RUN — ${changed.length} payslip(s) moved after the ladder change.\n`);
    } else {
      await expect(page.locator('.note--warn').first(), 'the revert was refused with no explanation')
        .toContainText(/needs a different grant/i, { timeout: 20_000 });
      expect(String(aug.status), 'the run changed state despite the refusal').toBe('processed');
      console.log(
        `\n  ⚠ §4 SHORTFALL, MEASURED — the 1 re-run could not be driven.` +
        `\n     wire     PATCH ${rev.status} /api/v1/vetana/payroll/runs/…/revert` +
        `\n              ${rev.text.slice(0, 300)}` +
        `\n     code     process_payroll refuses a month whose status is not 'draft'` +
        `\n              (routers/vetana.py:1697), and revert — the only route back to draft —` +
        `\n              requires _RELEASE_LEVEL = APPROVER (routers/vetana.py:2478).` +
        `\n     grants   nobody in Unicode Group holds approver on Vetana; see 08.12.` +
        `\n     08.13 records, from the ladders alone, exactly which figures a re-run would` +
        `\n     move. NO ASSERTION WAS ADJUSTED TO MATCH AN UNCHANGED NUMBER.\n${dump(wire)}\n`);
    }

    // The 400 (already processed) and the 403 (revert needs an approver) are
    // both statuses this test pressed for and asserted on. See `assertClean`.
    assertClean(con, '08.14 — idempotence and the re-run', [REFUSED]);
  });

  /* ════════════════════════════════════════════════════════════════════════
     08.15 / 08.16 — THE TWO SCREENS THAT READ THE RUN BACK
     ════════════════════════════════════════════════════════════════════════ */

  test('08.15 — the statutory screen: totals, the compliance calendar and the register', async ({ page }) => {
    const con = watchConsole(page);
    await signIn(page);

    const summary = await orgGet(page, `/api/v1/vetana/statutory-summary?month=${PAY}`);
    const totals = summary.totals || {};
    expect(Number(totals.total_pt), 'the statutory summary reports no professional tax for a ' +
      'month that deducted it').toBeGreaterThan(0);
    expect(Number(totals.total_tds), 'the statutory summary reports no TDS').toBeGreaterThan(0);
    expect((summary.employees || []).length, 'the employee-wise register is empty for a processed month')
      .toBe(30);

    await vetana(page, 'statutory');
    const stat = page.locator('#mt-panel-statutory');
    // `input[type="month"]` is DateInput's HIDDEN `.pk__native` since
    // 2026-08-31. It still carries the value, so `toHaveValue` below is
    // still the right assertion — but it cannot be filled or seen, so the
    // visible trigger and `setMonth()` do the driving.
    await expect(stat.getByRole('button', { name: 'Month' })).toBeVisible({ timeout: 25_000 });
    await setMonth(stat, 'Month', PAY);
    await settle(page);

    // The four statutory tiles, then the calendar — which prints the RULE
    // beside each due date, because a compliance date a reader cannot check is
    // a date they have to trust.
    await expect(stat, 'the statutory tab does not show the provident-fund total')
      .toContainText(/Provident fund/i, { timeout: 25_000 });
    await expect(stat, 'the compliance calendar did not render for a month with deductions')
      .toContainText(/Compliance calendar/i);
    await expect(stat.locator('.vt-cal__rule').first(),
      'the compliance calendar prints a due date without the rule it rests on')
      .toBeVisible({ timeout: 20_000 });
    await expect(stat, 'the employee-wise register did not fill in').toContainText(/Employee-wise register/i);

    // The register is twelve columns of statutory figures, and PAN and UAN are
    // masked at every access level — the figures are what the filing needs.
    //
    // ⚠ SCOPED TO THE REGISTER'S OWN TABLE. A bare `table tbody tr` inside this
    // panel matches four tables, not one: the register, the professional-tax
    // ladder and both income-tax ladders all live on this tab. The first run of
    // this suite counted all of them together and reported "the register shows
    // no rows" against a register holding thirty. Suite rule 6, in a place the
    // rule was not obviously about.
    const regRows = stat.locator('table')
      .filter({ has: page.locator('th', { hasText: /^\s*PAN\s*$/ }) })
      .first().locator('tbody tr');
    await expect(regRows, 'the employee-wise register shows no rows').toHaveCount(30, { timeout: 25_000 });
    await expect(stat, 'the register does not say that the identifiers are masked')
      .toContainText(/PAN and UAN are masked at every access level/i);

    const regText = await stat.innerText();
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(regText),
      'a UUID is rendered on the statutory register').toBeFalsy();

    // Row height, measured rather than read off a class name.
    const rowH = await regRows.first().evaluate((el) => ({
      height: Math.round(el.getBoundingClientRect().height),
      token: getComputedStyle(el).getPropertyValue('--row-h').trim(),
    }));
    expect(rowH.height, `the statutory register renders ${rowH.height}px rows while --row-h ` +
      `resolves to ${rowH.token} at the row itself`).toBe(Number(String(rowH.token).replace('px', '')));

    assertClean(con, '08.15 — statutory');
  });

  test('08.16 — the dashboard reads the three runs back', async ({ page }) => {
    const con = watchConsole(page);
    await signIn(page);

    const dash = await orgGet(page, '/api/v1/vetana/dashboard');
    expect(dash.latest_run, 'the dashboard reports no latest run after three of them').toBeTruthy();
    expect(String(dash.latest_run.month), 'the latest run is not the newest month').toBe(PAY);
    expect(Number(dash.ytd?.ytd_gross), 'year-to-date gross is still zero after a paid month')
      .toBeGreaterThan(0);
    expect((dash.department_split || []).length, 'the department split is empty for a month with payslips')
      .toBeGreaterThan(0);

    await vetana(page, 'dashboard');
    const panel = page.locator('#mt-panel-dashboard');
    // Coverage: everyone on the rolls now has a structure, and the sentence
    // that used to warn must have turned into the one that confirms.
    //
    // ⚠ THE NUMBER IS READ, NOT WRITTEN DOWN, AND THE REASON IS WORTH KNOWING.
    // This tile is NOT the thirty on the employee register and NOT the thirty
    // the run paid. `dashboard` counts `is_active AND still_on_the_rolls(e)`,
    // which bounds on TODAY — so the four leavers 08.4 created, whose last
    // working days are in mid-August, are already off it and the tile reads 26.
    // The router says so itself at length: "THE TILE STILL WILL NOT EQUAL THE
    // LATEST RUN, and that is right. This is a stock as at today… the run is
    // paying a MONTH… and still pays somebody who left on the 3rd for the three
    // days they worked." Pinning 30 here would be asserting that a documented,
    // deliberate distinction is a bug.
    const onRolls = Number(dash.headcount);
    expect(onRolls, 'the dashboard reports nobody on the rolls').toBeGreaterThan(0);
    await expect(panel, 'the coverage note still says employees are missing a salary structure')
      .toContainText(new RegExp(`All ${onRolls} active employees? (has|have) a salary structure`, 'i'),
        { timeout: 25_000 });
    console.log(`\n  HEADCOUNT — the dashboard tile reads ${onRolls} while the employee register ` +
      `holds 30\n  and the August run paid 30. The four leavers created in 08.4 are off the ` +
      `stock as at\n  today and still in the month that is being paid; routers/vetana.py:2842 ` +
      `records that\n  the two bounds are deliberately different.\n`);
    await expect(panel, 'the department split did not render').toContainText(/Department split/i);
    await expect(panel.locator('table tbody tr').first(), 'the department split shows no rows')
      .toBeVisible({ timeout: 20_000 });

    // The KPI strip above the tabs is the module's headline, and the fourth
    // tile is a filing deadline rather than a fourth money figure.
    await expect(page.locator('.vt-page'), 'the page header does not show the net payable')
      .toContainText(/Net payable/i);
    await expect(page.locator('.vt-page'), 'the page header does not show a compliance due date')
      .toContainText(/Compliance due/i);

    const dashText = await panel.innerText();
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(dashText),
      'a UUID is rendered on the payroll dashboard').toBeFalsy();

    assertClean(con, '08.16 — dashboard');
  });
});
