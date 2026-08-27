# Kartavya — live status ledger

**This file is the single source of truth for what is built, half-built, and
broken. Keep it current.** It exists so the team never again has to spend a
session reconstructing state from thirty scattered status proposals — which is
exactly how proposals 00, 07, 21, 27, 82 and 90 each came to be written.

- **Update this file the moment a phase item lands or a status changes.** It is
  part of "done", not an afterthought (see `CLAUDE.md` → *Keeping status current*).
- The deep history lives in `docs/proposals/`; the plan in `docs/plans/`; the
  arc in `docs/FINAL-VERDICT-00-90.md`. **This is the dashboard, not the archive.**

Last updated: **2026-08-26**. **BOTH deploys verified — check both, always.**
Backend: Railway staging at `cc371297`, SUCCESS 12:25 UTC (thirteen deploys
after the 04:14 `120d106c` build this line used to name; `1963c128` went live
08:45:24 and the Phase-2 acceptance ran against it 84 seconds later). Frontend: Vercel
serves the current branch build, confirmed from OUTSIDE by hashing the assets
`staging.kartavaya.com` actually returns — every Vercel deployment here has
`target: null`, so "READY" alone never establishes what the domain serves.
Everything below marked "fixed 26 Aug" is therefore **running**.

Legend: ✅ done · 🟡 half (code but no data/screen, or partial) · 🔴 wrong now
(broken in the running product) · ⬜ not started · 🔵 research/decision · ➖ n/a

---

## Live blockers — wrong in the running product (fix first: `PHASE-2`)

| | Blocker | Where | Status |
|---|---|---|---|
| 🟢 | Dunning chased 54 documents nobody owes money on | `reminder_service.py:_INVOICE_SCAN` | **FIXED 26 Aug.** Phase 2 closed "draft invoices dunned" across four surfaces and **missed the one that sends the email**. Live before the guard: **359** `invoice_overdue` rows against drafts, credit notes and zero-balance invoices — 347 in E2E where the outbound fence suppressed them, **12 in Unicode Group where it did not**. One went out at 13:04 UTC reading *"Invoice INV-2026-0007 is overdue. Balance: ₹0.00"*. Three guards added; 228 dunnable → 174 |
| 🟢 | Payroll pays 10 leavers | `vetana.py:1221` | **DEPLOYED 26 Aug** — guard live at `120d106c`, mirrors `metrics/manav.py:79`. **PROVEN BY A RUN, not a dry-read.** The E2E 2026-08 run executed 08:46:48 UTC against the deploy: **51 payslips, not 60**, `present_days` spanning 2 to 26 — the mid-month leaver credited 2 days, not a month |
| 🟢 | Professional tax is now settable, not hardcoded | `vetana.py`, `PtLadderSection.jsx` | **Migration 221 APPLIED** — `month smallint NULL` (NULL = every month), verified from `pg_constraint`. Nothing could write `pay_professional_tax` before: every backend reference was a read. Now a per-org ladder with a settings screen, resolving `org+month → org+all → shared+month → shared+all → ₹0` — falls back, never refuses. A shared row is read by everyone and editable by nobody. The Maharashtra February figure is deliberately NOT seeded: `statute_calendar` has no PT rows to check it against |
| 🟢 | Flat ₹200 professional tax, every state | `vetana.py:746` | **DEPLOYED 26 Aug** — slab read live. All 9 `pay_professional_tax` rows re-pointed to `org_id IS NULL` (shared): MH `27`×3, GJ `24`×4, KA `29`×2 — verified live. Employee states backfilled for BOTH payroll orgs (Unicode 25/26 → `'24'`, E2E **71/71 → `'27'`**), so PT does NOT drop to ₹0. **The run happened.** Actual: **₹10,000** across 51 — not the ₹10,200 predicted, because pro-rating drops the leaver's gross into the ₹0 band. The two fixes composing correctly, which a prediction from either one alone could not have got right. Phase 0.24 seeding is no longer the blocker it was |
| 🟡 | Two billing endpoints 500 | `client_billing.py:459,705` | **DEPLOYED 26 Aug** — `gst_rate` dropped, `invoice_number` allocated, `balance_due` bound (2nd bug found). Row on the board still owed — needs one real create |
| 🟡 | Draft invoices dunned + counted as revenue | `documents.py:307`, `dristi.py:354` | **DEPLOYED 26 Aug** — 4 surfaces. ⚠ The statement had ALSO been 500ing on a date bind since it shipped; fixed. Still open: project report dead on `staging.time_entries` (exists only in `public`); `dristi.py` `/overview` + the pivot dashboard still count drafts and the pivot carries the same date-bind bug |
| 🟢 | Cross-tenant leak — profile create/list not org-scoped | `client_billing.py:220` | **DEPLOYED 26 Aug** — ownership check + **7** id-alone joins (plan named 2); AST ratchet added. 0 rows had leaked |
| 🟢 | Inline pre-paint bootstrap blocked by a stale CSP hash | `vercel.json`, `index.html` | FIXED + DEPLOYED 26 Aug (`2ef060a9`) — one inline script, one allowed sha256, no match, so `data-theme`/`data-conv-*`/`data-platform` never ran: wrong-theme flash every load, and on Windows a frame of blurred sidebar. Found in the DEPLOYED console, invisible to build and tests. `check-csp-hash.mjs` now first in `npm run check` |
| 🔴 | `/security` page claims no MFA (TOTP shipped 23 Aug); 3 undisclosed sub-processors | `SecurityPage.jsx:161`, `legalFacts.js` | OPEN |

## Seeded-data integrity — repaired 26 Aug

Owner confirmed **"no live users or legal payslip, all are seeded"**, which
released seven items the sweep's adversarial brake had held. All reversible from
schema `ledger_repair_20260826`.

| Repaired | Detail |
|---|---|
| ✅ 6 payments deleted | 4 receipts against DRAFT invoices (₹2,06,500 + ₹5,000 + ₹5,000 + ₹590), 1 against a CREDIT NOTE (₹2,950), 1 of ₹60,000 against a ₹0 invoice. Their invoices reset to unpaid. `record_payment` now refuses all three shapes, so none can recur |
| ✅ 1 born-paid invoice | INV-2026-0048 — ₹53,100 total, ₹0 balance, no payment row — now owes its full amount |
| ✅ 3 expense claims detached | Approved claims (₹800 + ₹1,200 + ₹5,000, Unicode) pointing at payslips that were voided and never disbursed |
| ✅ 1 phantom payroll run | Jan 2020, 0 payslips, 0 employees. `org.spec.ts:197-211` asserts a **refusal** (≥400) for that month, so nothing depended on the row existing |
| ➖ holiday "duplicates" | Not duplicates — distinct names sharing a date (Dussehra and Gandhi Jayanti both 2025-10-02). 0 exact `(org, date, name)` twins remain |

**Verified after, both orgs:** 0 payments against a draft / credit note / ₹0
invoice · 0 invoices where `balance_due <> total − Σpayments` · 0 born-paid · 0
claims on a voided payslip · 0 phantom runs.

**Nikhil Desai — CLOSED by removal, owner's instruction 26 Aug.** He was
missing July and August pay (≈₹73,077 on the product's six-day basis, not the
₹72,322 first published — every August payslip uses `working_days=26`). Rather
than build a re-run path for a `processed` month, the owner chose to delete the
seeded employee outright. Removed: the employee, 3 payslips, 1 salary structure,
1 offboarding row, 4 leave balances, 1 leave request, 1 exit interview — 12 rows,
all backed up to `ledger_repair_20260826.nikhil_*`. Unicode headcount 27 → 26.

**Six junk vendors removed** — four named `p`, two named `probe`, a 72-second
burst of write probes from 2026-07-28, 6 of Unicode's 15 and all six live in the
vendor picker. Verified orphaned across every vendor-referencing column *before*
deleting. Nine real suppliers remain.

## Open, found 26–27 Aug, NOT fixed

**🟢 Biometric attendance now reaches payroll — FIXED 27 Aug.**
`services/attendance_bridge.MARKED_BY_BRIDGE` was `'pahchan'` and
`manav_attendance_marked_by_check` admits only
`('system','manual','biometric','geo')`, so every row `POST /v1/pahchan/publish`
ever tried to write raised CheckViolation. Read live 2026-08-27 before the fix:
**699 punches, 518 attendance rows, `marked_by='pahchan'` = 0**. A firm could
enrol faces, punch in all month, and the payroll run saw none of it.

Now `'biometric'`, which the CHECK already admits — the column records HOW a day
was marked (auto, typed, biometric, location) and `'pahchan'` is a module name,
a different kind of fact. No migration. It stays distinct from `'manual'`, which
is load-bearing twice over: the upsert's `IS DISTINCT FROM` guard is what stops
the bridge overwriting a hand-typed day AND what lets it re-write its own
earlier rows, which is how the module is meant to be used.
`tests/test_attendance_bridge_marked_by.py` reads the CHECK **from the live
catalogue** and pins both halves — the only assertion that would have caught it,
since a MagicMock pool accepts a value a CHECK refuses.

⚠ Still owed: **nothing has been published yet.** The fix means the next
publish can write; it does not backfill the 699 punches already taken.

**Correction to the record: `manav_employees.user_id` is NOT null on every
row.** The cloud session's Pahchan clock-in commit says it is, and this ledger
repeated it. Live 2026-08-27: **5 of 109 carry a `user_id`**. The web clock and
mobile punch work for those accounts today; the gap is that almost nobody else
has one, which is 0.23's job — not that the feature is dead.



**`/cron/billing` is verified but NOT SCHEDULED — one Railway config change
away.** The endpoint has been run twice by hand against the deploy and behaves
(see 3.3's acceptance below); what has not happened is adding `billing` to
`cron-daily`'s curl loop, which currently reads
`hr invoices crm stock marketing skills scraper-prices`. Until it does, client
auto-invoicing only happens when somebody fires it. Railway V2 does not
shell-interpret `startCommand` — keep it literal — and a redeploy reuses the OLD
config snapshot, so the change needs a FRESH deploy (`DEPLOY_NUDGE`) to take
effect. Read the deployed output back afterwards: a dead backend looks like CORS.

**Resolved on the way there — the back-billing question.** All four
`client_service_lines` in the product belong to **Unicode Group**, the real
customer, and two auto-invoice (₹75,000 + ₹15,000 monthly, running since
2026-04-01) with nothing recording them as billed. Armed as it stood, the first
tick would have raised **April**, then one more month each day — ten tax
invoices, ₹4,50,000 + ₹81,000 GST, into a customer's books unattended.
**Owner's decision, 2026-08-26: start the clock in August.** Migration 223's
`invoice_from` is the mechanism, and it was chosen over moving `period_start`
because `period_start` is when the SERVICE began — the firm's own contract term,
shown on its screen — and rewriting it would have left the true date nowhere.
Set to `2026-08-01` on those two lines only; reversal is
`SET invoice_from = NULL` on the same two ids, which restores the April backlog.

**Unicode's payroll run headers have never matched their payslips.** Five of
their eight runs disagree with the rows beneath them; **E2E is clean on all 17**,
so this is not a code path everyone hits.

**🟡 Pahchan can now be clocked from a browser — and still nobody can use it.**
`POST /v1/pahchan/punch` has been complete for months and had exactly ONE
caller, `mobile/src/screens/pahchan/ClockScreen.tsx`. There is no iOS build of
that app, so an employee on an iPhone could not clock in from anywhere, while
the web carried every reviewer screen and no way to punch. The missing caller
now exists (Pahchan → **Clock in** tab): selfie, compression to fit the 768 KB
cap, geolocation, idempotent retry. No new endpoint, no new table, **no
migration** — `captured_at`/`received_at` and `flags TEXT[]` already carried
everything this needed.

It is 🟡 and not ✅, and the reason is not the code. `create_punch` resolves the
employee through `manav_employees.user_id`, and `routers/pahchan.py` and
`History.jsx` both record that **no employee row on this database carries one**
(`pahchan.py`: "0 of 81 employee rows carry a user_id today, so `_employee_for`
returns None for everybody"). Every account therefore gets the 409 and the
screen says so in words rather than offering a button that always fails. **This
flips to ✅ when HR links one employee to one login and a punch row appears —
that link, not this screen, is the last thing between the module and its first
real clock-in.** It blocks the mobile app identically, so it was never a
web-only gap.

| Run | Header says | Payslips actually |
|---|---|---|
| 2026-04 `disbursed` | 23 / ₹12,80,846.14 | **28** / ₹15,58,196.14 |
| 2026-05 `disbursed` | 23 / ₹12,79,538.45 | **28** / ₹15,56,888.45 |
| 2026-06 `disbursed` | 24 / ₹13,27,000.00 | **30** / ₹16,19,350.00 |
| 2026-07 `approved` | 24 / ₹14,12,055.56 | **30** / ₹14,65,334.87 |
| 2026-09 `draft` | 0 / ₹0.00 | **6** / ₹2,92,350.00 |

**This predates today and was not caused by the Nikhil removal** — proven from
the pre-deletion snapshot in `ledger_repair_20260826.nikhil_runs_before`: the
April header already said 24 against 29 payslips. The removal decremented three
headers by exactly his contribution, which was correct arithmetic on a number
that was already wrong.

A run header is what every payroll list, cost tile and analytics band reads —
nobody re-sums the payslips. So five Unicode runs report a headcount and a gross
that the payslips beneath them contradict. **Not fixed, and deliberately not
fixed today:** the right repair is not obvious (is the header wrong, or are
there payslips that should never have been written?) and it needs the same
treatment the ledger repair got — a written risk report first.

## Phase progress (`docs/plans/`)

| Phase | What | State |
|---|---|---|
| 0 | Owner unblocks (31 items) | 🟢 **all 31 answered 26 Aug** — 19 decided, 12 parked by the owner. Nothing here awaits him. **0.20 ✅ 27 Aug** — Ganit's stripped 4-field vendor form is gone; Ganit and Kray now share ONE `components/VendorForm.jsx`, so all six MSME/TDS columns are capturable from Payables and the field set cannot fork (a set-equality test across both tabs is the ratchet). Live: E2E 75 vendors, 12 carrying all six; Unicode 9 and 0. **0.22 ✅ 27 Aug** — migration 226 adds `public.tasks.client_id` (nullable, partial index), with the ownership check on the write path rather than a foreign key: `graha_clients.id` is unique table-wide, so an FK would admit another org's customer. A client picker on the task drawer, `ServerPicker` because the clients endpoint is LIMIT 200. 483 tasks, all NULL — no backfill, because a task names a team, not a customer, and guessing bills the wrong firm. **0.24 ✅ 27 Aug** — migration 224: the shared ladder goes **9 rows → 23**, 3 states → 7 (Assam, West Bengal, Telangana, Andhra Pradesh), each band cited to its own notification and checked against the Art. 276(2) ₹2,500/yr ceiling. **Nobody moved**: E2E still ₹11,800 across 60 payslips and Unicode ₹4,800 across 24, 84 of 84 agreeing. Fifteen states left out with a written reason each — seven band on ANNUAL income, three are half-yearly and set by the local body (Tamil Nadu is the valuable one still owed). ⚠ **Three findings for you, all zero live exposure today**: Gujarat's shared ladder is 4 years stale, Karnataka's is stale, and Maharashtra has a gender dimension the table cannot express (women exempt to ₹25,000 since 2023) — the first two are live-row edits, the third needs a column. **0.23 ✅ 27 Aug** — 12 employees linked in E2E (0 of 73 → 12) through the real screens, 11 distinct role shapes, zero INSERTs; `pahchan_punches` got its **first ever row in E2E**, so the cloud session's web clock-in is unblocked. **0.27 ✅** — migration 227 seeds the WhatsApp rate card as estimate data that cannot be read as fact (four mechanisms, incl. a CHECK that makes an uncited figure uninsertable). Build halves still open: **0.29 fresh APK only** — 0.27 is ✅ above, and this trailing line still named it until 2026-08-27 |
| 1 | Six write-paths (turns ~18 features on) | ✅ **ACCEPTANCE PASSED 26 Aug** — all six counters are live non-zero, every set row created through the UI today. Live, both orgs: invoices `salesperson_id` **5**/800 · orders **3**/380 · vendors MSME/TDS **12**/90 · expenses `contact_id` **9**/385 · employees `state` **110**/110 · holidays `state_code` **11**/48. The old "0/790, five of six still need a real create" table was written at 06:48 and never refreshed after `775b1bcc` landed at 08:36 |
| 2 | Six correctness fixes (the blockers above) | ✅ **ACCEPTANCE PASSED 26 Aug — 10/10, driven as a real user against the deploy.** Payroll run for 2026-08: **51 paid, not 60**; the mid-month leaver credited **2 present days of 26**, not a whole month; PT **₹10,000** from the Maharashtra ladder (not ₹10,200 — pro-rating drops that leaver's gross into the ₹0 band, which is the two fixes composing correctly); Dristi overview **₹11,14,93,756.12** invoiced against ₹12,29,86,008.58 before, outstanding **₹2,71,54,767** against ₹3,86,36,429.46, with ₹54,78,968.92 of drafts on the books and excluded; cross-tenant profile create refused; pahchan metrics computing. All six are coded and deployed, and **nine further defects found by verifying them are now fixed**: payroll paid a part-month as a whole one (₹41,262 on one payslip), `/cron/hr` marked attendance for leavers, Dristi `/overview` carried a **₹1,14,92,252.46 draft phantom**, a draft could be marked *paid* (Unicode, ₹2,06,500), the 2.5 ratchet covered one module of 42 id-alone joins, two user-facing claims were false, 2.3's writer violated 1.3, and analytics banded 60 where payroll pays 51. |
| 3 | Billing executable + arm cron | 🟢 **3.1 ✅ · 3.2 ✅ ACCEPTANCE PASSED 27 Aug · 3.3 ✅ ACCEPTANCE PASSED · 3.4 verified, not scheduled.** 3.2 driven through the admin console as an operator: a mid-cycle downgrade wrote **credit ₹3,200** ("unused 4 days at ₹20,000/mo") and **charge ₹2,400** ("4 days at ₹15,000/mo"), both `one_off`, both quoting the same 4 days — **net −₹800**, where the two-debit shape billed ₹5,600. ⚠ **And the acceptance found why it had never run: `POST /admin/set-plan` has ALWAYS 500'd** — it bound `users.user_id` (text) into `subscriptions.activated_by` (uuid, FK to `users(id)`; `public.users` has both columns). 5 subscriptions, 0 with `activated_by` set. Fixed by resolving the id, keeping the FK. 3.3: `/cron/billing` fired twice — `client_invoice_lines` 0 → 2, auto-invoices 0 → 2 (INV-2026-0093 ₹88,500, INV-2026-0094 ₹17,700, both Aug, intra-state Gujarat), then `created 0, skipped 2`. April–July not raised: `invoice_from` held. **3.4 is the only thing left**: `billing` still needs adding to `cron-daily`'s loop |
| 4 | Eight invisible-feature screens | 🟢 **ALL EIGHT LANDED 27 Aug — every one an endpoint that had no caller at all.** **4.3 ✅ ACCEPTED**: `skill_finding_ack` **0 → 1** through the deployed endpoint, and re-running the skill then returned 2 findings instead of 3. It was empty for a reason no frontend could fix — `apply_wiring` returns the output untouched when the org holds no acks, so no finding ever carried a key and no client could ask for the FIRST one. A door locked from the inside. **4.1** compliance settings, **4.2** Pahchan consent, **4.4** storage browser, **4.5** the dock Due tab (the `income_tax` typo was worth 22 rows; Finance 7 → 13), **4.6** billing anchor, **4.7** pause/resume, **4.8** quota proration. ⚠ **Two are 🟡 until a first row exists**: `module_compliance_settings` is still 0 and `pahchan_employee_consents` is still 0 — one click each on staging. Storage and Due are read-only surfaces with no row to write |
| 5 | Statute calendar → payroll/invoicing | 🟢 **COMPLETE 27 Aug — 5.1, 5.2, 5.2b and 5.3 all landed.** **5.1**: the ESI ceiling (26 Aug), then PF's rate and ceiling (migration 228) and the ESI rates (232). Each stayed a literal for a real reason — **the store held no key for them**: `epf.remittance` and the ESI rows are DUE-DATE rows with NULL figures, and of 45 rows exactly one carried a payroll number. The law is seeded and cited now, and **no payslip moves**: 12% of ₹15,000 is the ₹1,800 the literal carried, and 0.75/3.25 are the same rates. **5.2**: gratuity and statutory bonus — seven keys, each with its section. **LWF deliberately NOT seeded**: it is state law with different rates, periodicity and splits per state and only ~15 states operate one, so a national row would be wrong everywhere; it needs the PT ladder shape, and a test stops anyone adding one to tick the box. **5.2b ⚠ THIS ONE MOVES MONEY**: the hardcoded new-regime ladder was **a year out of date** — AY 2025-26 bands against an FY 2026-27 run — so the product has been **over-deducting TDS**. At ₹2,00,000/month that is ₹8,958 too much every month. Migration 230 puts both regimes in `pay_income_tax_slabs`, one row per band, cited to each Finance Act; the next run deducts the correct figure. An absent ladder deducts ₹0 and **never** falls back to a literal. **5.3**: GST thresholds and the 194Q watch read the dated store, degrading rather than refusing when a row is absent |
| 6 | Retire 4 duplicate models + SQL-test rule | 🟡 **the rule is shipped and two of the four "duplicates" turned out not to be, one of them dangerously.** ⚠ **TWO `pay_*` tables are live, not one** (re-read 2026-08-27): `pay_professional_tax` **23 rows** and `pay_income_tax_slabs` **23 rows** — the latter created by migration 230 during Phase 5.2b, read by `income_tax.ladder_for` for every TDS figure on every payslip. Neither is part of the dead stack: PT is the shared ladder every payroll run reads (9 rows when this was written, 23 now that 0.24's states are in), and the plan's "drop the `hr_*`/`pay_*` stack" would take professional tax **and** income tax to **₹0 for every employee**. The other 17 are genuinely empty. 6.4 is a stale premise: `report_schedules` **does not exist**, so there is one scheduler, not two. 6.3 decided — KEEP BOTH allocators, because a PO is numbered at ISSUE and `next_doc_number`'s `ORDER BY created_at` would restart the series at 0001 on the next draft; the boundary is now `test_two_serial_allocators.py` (5). **The process rule is a ratchet**: `test_every_writer_has_a_live_sql_test.py` (4) — 36 routers write to `staging.*`, 6 have a live-schema test, 30 baselined and the baseline only shrinks. **6.1 was answered by seeding, not dropping**: the owner's call. The live half worked and E2E Test & Associates had **0 schemes across 83 people** — a model nobody in the test org could exercise. `commission-seed.spec.ts` drives the real screen and E2E now holds **1 scheme / 3 bands** on the owner's own ladder (3% from ₹1L, 4% from ₹5L, 7.5% from ₹10L, typed 7.5/3/4 and stored 3/4/7.5). The dead `sales_commission*` three stay 0/0/0 and stay put — they cannot be seeded either, their `user_id` is `uuid` where `users.user_id` is `text` — and the DROP is still **not approved**: 0.30 named three restore schemas (`qa_cleanup_20260822`, `punch_cleanup_20260823`, `owner_actions_20260823` — all three already gone, checked live) and named none of the twenty product tables, so the twenty need putting to the owner as twenty. Housekeeping done in the same pass: the `PROPOSED_080` collision is renumbered (090) with `test_migration_numbers_are_unique.py` (4) holding it, migration 183's "IS NOT APPLIED" scaffolding is removed after a live check found it fully applied, and `generate_rich_content` read a `user_id` it never took — a `NameError` on its first inline image, now a parameter with 2 tests that fail without it. Counts are exact `count(*)` — `n_live_tup` reports 0 for both live tables and is not usable here |
| 7 | Territories ROUTE + Indian address capture | ⬜ **plan rewritten from a live audit 26 Aug** — every claim re-measured. `rules.pincodes` still has ZERO backend consumers, and `assign-next` has zero callers anywhere. **But nothing can route even with a perfect resolver: no contact form captures a PIN, `territory_id` is unreachable from every API path, and no territory edit form exists.** Live: 17 territories, **0 with a PIN, 0 with a member**, 0 of 289 contacts routed. New 7.0 (capture) precedes 7.1; 7.1a closes three cross-tenant territory joins that 7.1 would otherwise activate **Researched 26 Aug (`9c211b28`, proposal 92, ~40 sources) — plan amended, still nothing built.** Three of the amendments are Mappls licence text, not opinion: attribution must be the **“Powered by Mappls” LOGO**, not the `© Mappls` string 7.5 specified; their terms forbid a Mappls map “with or near a non-Mappls Map”, which closes off any MapLibre/OSM/Google fallback anywhere in the app; and content submitted to Mappls carries a **perpetual sub-licensable licence back to them** — an autosuggest call on a client's premises is a submission, so 7.6 now sends the query fragment only and never runs on the public form. Fourth: Google was rejected on “USD billing, card required”, but India bills in **INR** with **70,000 free events per Essentials SKU/month** — the standing no-Google-spend rule still decides it, the stale reasons are gone. Market finding: the most-requested map feature is **not a map** — it is plot-the-list plus postcode routing, and routing is the half vendors charge for (Badger sells it as four add-ons; Salesforce Maps $75–150/user/mo). **The three open questions still need the owner** — recommendations in proposal 92 §8: priority-int for overlapping PINs, territory-always/rep-only-when-unassigned, and yes to an optional six-digit PIN on the public form after 7.0. Migration number is **not** 222 any more — a peer session took 222 and 223 mid-session; the plan now teaches `ls backend/migrations/` instead of naming a number |
| 8 | Maps across the other six modules | 🔵 **planned 26 Aug (`9c211b28`), nothing built.** Phase 7 is **100% Graha**; this is every module it does not touch. Front-loads the parts needing **no vendor, no API key and no CSP change**: `<AddressBlock>` across Graha / Ganit / Kray / Manav / Vikray / Pahchan using Google **Maps URLs** (no key, no quota, an anchor not a fetch). Then the **Pahchan geofence map** — a real defect, not a view: a geofence is configured today by typing two decimals and a radius with no way to see it, and `Sites.jsx:31` names that risk itself. Then the free PIN-area popover (reuses 7.3's geometry, **zero vendor calls**), autosuggest reuse, and last a stored coordinate with `geo_source` + `geo_fetched_at`, which is what unlocks DIGIPIN. **Altitude on attendance is NOT in this phase — it is already built** (migration 193 + `routers/pahchan.py` + the mobile offline queue + three screens + `test_pahchan_altitude.py`); the only open item there is data, not code: **does any live site actually carry an `altitude_m`?** 9 sites / 1,659 punches were all NULL when 193 landed |

## Module / proposal state (condensed — full detail in proposal 90)

| Area | Proposals | State |
|---|---|---|
| Core PM (tasks, boards, board-arrange, pulse) | 67, 68 | ✅ |
| Niyam automation | 55–59, 66 | 🟡 armed; 20/35 event types |
| Analytics suite | 60–65 | ✅ through S6 (mobile S7 deferred) |
| Skills / dock / Sahayak | 69–72 | 🟡 dock built, Due tab dead; ack 32/78, 0 rows, no UI |
| Reports | 70, 73, 75 | 🟡 15 registers; ~23 of 34 defs missing |
| Commission & P&L | 76 | 🟡 built; rate uneditable, `salesperson_id` NULL |
| Procurement / Kray | 77, 85 | 🟡 built; can't send a PO; vendor MSME now enterable (26 Aug, 0 rows yet) |
| Compliance settings | 80 | 🟡 table+API, no screen, 0 rows |
| Legal / MFA docs | 81 | 🟡 4 pages, not in prod, 9 owner facts |
| R2 storage | 83 | 🟡 grammar+verifier; no tab, 0 objects |
| Employee onboarding | 84 | ⬜ ~95% unbuilt |
| Platform billing | 86 | 🟡 P1/P2 code; P3/P4/P6 absent, cron unarmed |
| Org-client billing | 87 | 🔴 router 500s; recurring doesn't recur; leak |
| Liquid glass | 88, 89 | ✅ record; rescope done; enriched 2026-08-25; Apple-pass (buttons/tiles/modal) 2026-08-25 |
| WhatsApp channel | 38, 39 | ⬜ owner creds (Phase 0.26) |
| RAG / KB index | 08 | 🔴 empty always; answers grounded on nothing |
| Employee↔login join | 05 | 🔴 0 of 98 linked; gates payslips + payroll |

## Structural debt (`PHASE-6`)

- 48 zero-row tables · 16 NULL feature columns with no write path
- 4 models built twice (sales_commission* / hr_*+pay_* / 2 doc allocators / 2 report schedulers)
- `statute_calendar` read by skills and by payroll's ESI ceiling; PF, PT and both TDS ladders still literal (5.2)
- No router test executes its own SQL ← the rule that would catch every 🔴 above

---

## How to keep this file honest

1. Every landed change: flip the relevant row here, and append a line to
   `docs/plans/PROGRESS.md` with the evidence (file:line, table + row count, or
   commit).
2. Never mark a row ✅ on "the code shipped" alone — this whole document exists
   because "DONE" was claimed on code with no data. ✅ means **a customer can
   complete the flow end to end**, proven by a row appearing where there were
   zero. Otherwise it is 🟡.
3. Verify status claims against the live DB, not the migration folder.
