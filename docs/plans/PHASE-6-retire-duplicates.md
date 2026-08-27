# Phase 6 — Retire the duplicates, freeze new modules, add the one rule

**Effort:** ~3 days · **Blocks on:** owner OK to drop tables (Phase 0.30)

Four models were built twice. Retiring the dead half removes the trap where the
next reader wires the wrong one. Then one process rule closes the failure mode
that produced every blocker in Phase 2.

## The four duplicated models (verified live)

### 6.1 · Commission — two models

- **Dead:** `sales_commissions` / `sales_commission_slabs` /
  `sales_commission_assignments` — three tables whose `user_id` is **uuid** while
  `users.user_id` is **text**, so they can never join cleanly. Proposal 76 built
  the live model without naming these.
- **Live:** `manav_commission_schemes` / `manav_commission_bands`.
- **Do:** confirm the three `sales_commission*` tables are empty (they are), back
  up to a restore schema, drop them. Owner OK required (0.30).

### 6.2 · Employee / payroll — two stacks

- **Dead:** an empty `hr_*` / `pay_*` employee and payroll stack.
- **Live:** `manav_*` / `vetana_*`.
- **Do:** prove the `hr_*`/`pay_*` tables are empty, back up, drop. This is the
  single largest source of "which table do I read?" confusion in the schema.

### 6.3 · Two document-number allocators

- `next_doc_number` and `next_po_number` — decide on one allocator or document
  clearly why two exist and which owns which series.

### 6.4 · Two report schedulers

- `dristi_scheduled_reports` (7 live subscriptions — **the only scheduler that
  has ever sent mail**) vs `report_schedules` (0 rows). `routers/dristi.py:1058-1073`
  argues in code against merging them.
- **Do:** decide — merge onto the working one, or delete the empty one. Do not
  leave both.

## Housekeeping while here

- Resolve the two migration files both numbered `PROPOSED_080`
  (`080_statutory_document_identifiers` vs `080_team_members_retire`) — a number
  collision in a directory whose whole purpose is ordering.
- Correct the stale in-code assertions: `prachar.py:81` says migration 183 "IS
  NOT APPLIED" (it is — remove the dead `column_exists` scaffolding);
  `ai_router.py:2515` passes `user_id=user_id` into a function with no such param
  (a latent NameError, unreached only because nothing calls it).
- Freeze new module codes until the above is clean — a new `ALL_MODULES` entry is
  three deploys in a fixed order on a shared DB (proposal 87 §2).

## The one rule (proposal 90 §6.7) — the highest-leverage item here

Add to CI / review, and to `CLAUDE.md`:

> **No proposal may assert a table, route, or column is missing without a live
> query in the document. No router may ship without one test that executes its
> SQL against the real schema.**

Both failure modes are documented and recurring:

- Proposals **75, 78, 82, 85** each declared *built* things *missing* (columns
  that existed the day before).
- Proposal **87** shipped two endpoints that have **never once succeeded** — a
  single test running either INSERT against the real schema would have caught
  both the non-existent `gst_rate` and the missing `invoice_number`.

Neither rule is expensive. Neither has been in place. Every 🔴 blocker in Phase 2
is one or the other.

## Definition of done

- The two dead table-stacks dropped (owner-approved, backed up, counts verified
  after).
- One report scheduler; one documented allocator story; no `PROPOSED_080`
  collision.
- The stale in-code assertions removed.
- The SQL-execution test rule is in CI and in `CLAUDE.md`.

---

## Progress

_Update as items land — tick here, flip the row in `docs/STATUS.md`, and append to `PROGRESS.md` with evidence._

**Everything below is an exact `count(*)` read live on 2026-08-27. `n_live_tup`
was tried first and is a LIE here — it reports 0 for `pay_professional_tax`
(9 real rows) and 0 for `dristi_scheduled_reports` (7). A planner statistic is
not a row count, and a DROP decided from one would have been catastrophic.**

- **6.1 commission — THE OWNER CHOSE SEEDING OVER DROPPING, and he was right.**
  The dead half is confirmed empty — `sales_commissions` 0 ·
  `sales_commission_slabs` 0 · `sales_commission_assignments` 0 — and is still
  not dropped: a DROP is named and confirmed regardless of the standing
  migration approval, and 0.30 is where that OK belongs.

  What the confirmation surfaced is the more useful fact. The LIVE half held
  **2 schemes and 4 bands, every one of them Unicode Group's**. E2E Test &
  Associates had **83 people on the register and not one arrangement between
  them**, so the model could not be driven end to end in the org every spec
  runs against — 🟡 by this project's own definition, however much code stands
  behind it. Seeding was the answer to a question the audit had framed as a
  deletion.

  `frontend/e2e-real/commission-seed.spec.ts` (2 tests) drives the real screen:
  the register, a person, the form, the ladder editor, the button. E2E now holds
  **1 scheme / 3 bands** on the owner's own ladder of 2026-08-21 — 3% from ₹1L,
  4% from ₹5L, 7.5% from ₹10L. The rungs are typed **7.5 / 3 / 4** and come back
  **3 / 4 / 7.5**, which is the assertion worth having: `Scheme.__post_init__`
  sorts and de-duplicates once, so a payout cannot depend on which row was read
  first. The spec recognises its own ladder on a re-run and verifies instead of
  writing again — a test that accumulated pay agreements in a live database
  every time it ran would be a worse thing than the gap it closed.

  THE DEAD THREE COULD NOT HAVE BEEN THE ONES SEEDED. Their `user_id` is `uuid`
  where `public.users.user_id` is `text`; there is no join to make, so there was
  never a version of 6.1 in which they were the half worth keeping.
- **6.2 employee/payroll — THE PLAN IS WRONG HERE, AND DANGEROUSLY.**
  The instruction reads "prove the `hr_*`/`pay_*` tables are empty, back up,
  drop". Seventeen of the eighteen are empty — all ten `hr_*`, and `pay_runs`,
  `pay_slips`, `pay_esi_records`, `pay_pf_records`, `pay_tds_records`,
  `pay_loans`, `pay_it_declarations`. **`pay_professional_tax` holds 9 rows and
  is LIVE**: it is the shared national PT ladder (`org_id IS NULL`) that
  `vetana.py::_pt_slabs` reads for every payroll run in both in-scope orgs, and
  migration 221 added a `month` column to it last week. Dropping the `pay_*`
  stack as written would take professional tax to **₹0 for every employee**.
  It is not part of the dead stack and must be excluded by name from any drop.

  **RE-READ 2026-08-27, AND THERE ARE NOW TWO SUCH TABLES, NOT ONE.**
  `pay_income_tax_slabs` holds **23 rows** and did not exist when the paragraph
  above was written — migration 230 created it during Phase 5.2b and it is the
  income-tax ladder that `services/income_tax.py::ladder_for` reads for every
  TDS figure on every payslip, with a full CRUD router behind it
  (`routers/income_tax_slabs.py`) and a screen. `pay_professional_tax` has
  meanwhile grown from 9 rows to **23** as 0.24's states were entered.

  So the exclusion list is `pay_professional_tax` AND `pay_income_tax_slabs`,
  and the general lesson is the one this plan keeps re-learning: a prefix is
  not a stack. Anything reading a `count(*)` older than the last deploy is
  reading a different database. Exact counts, live, 2026-08-27:

      hr_* (all ten)                    0
      pay_esi_records                   0     pay_it_declarations       0
      pay_loans                         0     pay_pf_records            0
      pay_runs                          0     pay_slips                 0
      pay_tds_records                   0
      pay_professional_tax             23     <-- LIVE, EXCLUDE
      pay_income_tax_slabs             23     <-- LIVE, EXCLUDE
      sales_commissions                 0
      sales_commission_slabs            0
      sales_commission_assignments      0

  **AND NONE OF IT IS APPROVED TO DROP.** 0.30 reads "DROP the three restore
  schemas" and names them: `qa_cleanup_20260822`, `punch_cleanup_20260823`,
  `owner_actions_20260823`. All three are **already gone** (checked live
  2026-08-27 — that item is done, and a later reader should not go hunting for
  them). What 0.30 does NOT name is a single one of the **22** tables above —
  written "twenty" until 2026-08-27, and a DROP list that is short by two is a
  list with two tables nobody named. Count them: 10 `hr_*` + 7 empty `pay_*` +
  2 LIVE `pay_*` + 3 `sales_commission*` = 22. **`public.report_schedules`
  makes 23**, added by 6.4's correction above.

  Phase 6's header reads "Blocks on: owner OK to drop tables (Phase 0.30)" and
  0.30's answer says "Unblocks Phase 6", but an OK for three backup schemas is
  not an OK for 23 product tables, and stretching one into the other is exactly
  how a `pay_*` drop takes professional tax and income tax with it.
  **The 23 need naming to the owner as 23** — two of them, `pay_professional_tax`
  and `pay_income_tax_slabs`, are LIVE and belong on the list only so they can be
  visibly excluded from it.
- **6.3 two allocators — DECIDED: KEEP BOTH, and the boundary is now a test.**
  `next_po_number` is not a duplicate of `next_doc_number`; it is a different
  algorithm for a different lifecycle. A purchase order is numbered at ISSUE,
  so every draft carries NULL, so `next_doc_number`'s `ORDER BY created_at`
  reads a draft as the newest row and **restarts the series at 0001**. The
  reasoning was already written out in `services/purchase_orders.py:330`; what
  was missing was anything holding the line. `tests/test_two_serial_allocators.py`
  (5 tests) now fails if a purchase-order table enters `_ALLOWED_DOC_TABLES`,
  if the allowlist changes without a decision, if either allocator stops
  zero-padding to four, or if either takes its advisory lock outside a
  transaction.
- **6.4 two report schedulers — STALE PREMISE, nothing to do.**
  ~~`staging.report_schedules` **does not exist** (`42P01` on a live query).
  There is one scheduler.~~ **THAT WAS WRONG, and it is the most instructive
  mistake in this phase. Corrected 2026-08-27.**

  The query was real and its output was real; the reading was not. `42P01` from
  `SELECT ... FROM staging.report_schedules` means **not in that schema** — not
  "nowhere". Live, both schemas, 2026-08-27:

      public.report_schedules            EXISTS · 15 columns · 0 rows
      staging.dristi_scheduled_reports   EXISTS ·             · 7 rows
      staging.report_schedules           42P01  — and only this was checked

  **6.4 IS OPEN.** `public.report_schedules` is not a leftover model: it has an
  `org_id` from migration 212, three indexes, RLS policies from migration 008,
  and a complete CRUD in `routers/reports.py` (`:454` list, `:480` INSERT,
  `:506` DELETE, `:619`/`:684` UPDATE). `invite_router.py:519-520` writes it
  unqualified on user deletion. And `POST /api/reports/dispatch` (`:510`) runs
  on an **armed hourly Railway cron** — staging `cron-report-dispatch`,
  `7 * * * *`. An empty table is not an idle one: that endpoint runs 24 times a
  day and finds nothing to do, which is exactly why nobody noticed.

  So `dristi.py:1058-1073` is not arguing with something already gone. It is
  arguing with a live second scheduler, and the decision this phase asked for —
  merge onto the working one, or delete the empty one — has not been made.

  **THIS IS THE WORST PLACE THE MISTAKE COULD HAVE BEEN MADE.** Phase 6 exists
  to install one rule: *no proposal may assert a table, route or column is
  missing without a live query in the document*. There **was** a live query in
  the document. It looked in one of the two schemas this database has, and the
  rule does not say which — so the rule was followed and the wrong answer was
  published into three documents anyway. The rule needs its other half:

  > A negative result from a schema-qualified query is a fact about **that
  > schema**. Reading it as a fact about the database is how a phase item gets
  > closed on nothing.

  Held open by `backend/tests/test_two_report_schedulers.py` (4 tests), which
  pins the second scheduler into existence and fails if any ledger goes back to
  claiming the table is missing. The same blindness is fixed in
  `test_every_writer_has_a_live_sql_test.py`, whose `_WRITES` pattern matched
  `staging.` alone and could not see `reports`, `org_invites` or `templates`
  writing to `public.` at all.

  **NOT DECIDED HERE.** Retiring `public.report_schedules` means dropping a
  table, and a DROP is named and confirmed by the owner. It joins the list.
- **Housekeeping — all three items closed, each behind a live check.**
  - **The `PROPOSED_080` collision is gone.** Two unrelated proposals shared the
    one number in a directory whose only job is ordering; proposal 82 reported
    it, Phase 6 reported it again, and neither report moved a file.
    `PROPOSED_080_statutory_document_identifiers.sql` is now `PROPOSED_090_…`
    (it had four references to the other's nine), with the four updated in the
    same commit and the move recorded in the file's own header. Neither file is
    applied, so no database changed. `tests/test_migration_numbers_are_unique.py`
    (4 tests) now fails on any duplicate number in either series — the applied
    one and the PROPOSED one are checked apart, because they have always
    numbered independently and `063_` beside `PROPOSED_063_` is not a collision.
  - **Migration 183 IS applied, and the code saying otherwise is removed.**
    Live 2026-08-27: `compliance_class` on both `prachar_templates` and
    `prachar_campaigns`, both CHECK constraints present, all three tables
    created, `prachar_compliance_rules` seeded with 6 rows, **57 of 60 templates
    classed**. `services/prachar_compliance.py::column_exists` and its four
    guards in `routers/prachar.py` were therefore a per-process query defending
    a state that cannot occur — under comments telling every later reader the
    column was missing. Removed. `table_exists` STAYS: it degrades two audit
    writes rather than guarding a column, but its log lines no longer blame 183,
    because a log that names the wrong cause sends the next reader to the wrong
    place. `_col` also stays — the schema half of its reason was false, the test
    -fixture half was always true.
  - **`ai_router.py`'s latent `NameError` is real, and worse than reported.**
    The plan said it "passes `user_id=user_id` into a function with no such
    param". `upload_file` takes `user_id` perfectly well; the fault is that
    **`generate_rich_content` does not** — it read a name that was not a
    parameter, not a global and not a local, so the first inline image the rich
    model ever returned would raise `NameError` before the picture was touched.
    Unreached only because `routers/hub.py` imports the function and no route
    calls it. Now a parameter defaulting to `""` (unowned is honest; an upload
    attributed to a user who did not ask for it is not), with two tests in
    `test_image_brief.py` — one executing the whole inline-image branch against
    a real one-pixel PNG, one checking the signature — **both verified failing
    against the old code before the fix went in**.

- **The process rule — SHIPPED as a ratchet, not a sentence.**
  `tests/test_every_writer_has_a_live_sql_test.py` (4 tests). 36 routers write
  to `staging.*`; 6 have a test that PREPAREs their statements against the real
  schema. The other 30 are baselined by name, and the baseline **only shrinks**
  — a new writing router with no live test fails immediately, a baselined one
  that gains a test must be removed, and a name that no longer writes must be
  deleted. That third check is why this cannot rot the way
  `migrations/README.md`'s status column did.
