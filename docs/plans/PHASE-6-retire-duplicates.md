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

- **6.1 commission — CONFIRMED, awaiting the owner's OK (0.30).**
  `sales_commissions` 0 · `sales_commission_slabs` 0 · `sales_commission_assignments`
  0. Safe to back up and drop. Not dropped: a DROP is named and confirmed
  regardless of the standing migration approval.
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
  `staging.report_schedules` **does not exist** (`42P01` on a live query).
  There is one scheduler: `dristi_scheduled_reports`, 7 rows, the only one that
  has ever sent mail. The `dristi.py:1058-1073` argument against merging is
  therefore arguing with something that is already gone.
- **The process rule — SHIPPED as a ratchet, not a sentence.**
  `tests/test_every_writer_has_a_live_sql_test.py` (4 tests). 36 routers write
  to `staging.*`; 6 have a test that PREPAREs their statements against the real
  schema. The other 30 are baselined by name, and the baseline **only shrinks**
  — a new writing router with no live test fails immediately, a baselined one
  that gains a test must be removed, and a name that no longer writes must be
  deleted. That third check is why this cannot rot the way
  `migrations/README.md`'s status column did.
