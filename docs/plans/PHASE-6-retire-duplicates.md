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
