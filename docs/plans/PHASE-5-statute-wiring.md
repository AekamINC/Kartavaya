# Phase 5 — Wire the dated-law store into payroll & invoicing

**Effort:** ~1 week · **Blocks on:** Phase 1.5 (employee `state`) for the PT read

Proposal 79 calls the `statute_calendar` mechanism "the best idea in the product."
It is real — 45 rows, read by **eight skill modules** — and it protects **nothing
a customer is billed on**, because the payroll and invoicing engines hardcode
their constants instead of reading it.

## The disconnect

`backend/routers/vetana.py` hardcodes:

- the ESI ceiling (21000)
- professional tax (the flat 200 — Phase 2.2)
- PF rates
- both TDS slab ladders

`statute_calendar` — the dated store that would supersede all of these, with a
mandatory `as_of` — is read by the AI shelf and by no engine. TDS forms
renumbered on 1 Apr 2026; a hardcoded ladder does not know that.

## Tasks

### 5.1 · Route the payroll constants through `statute_calendar`

- **Do:** replace each hardcoded constant in `vetana.py` with a lookup against
  `statute_calendar` at the run's `as_of` date. ESI ceiling, PF rates, PT slabs
  (Phase 1.5/2.2), TDS ladders.
- **Accept:** changing a rate in `statute_calendar` with a future `as_of` changes
  the next payroll run and leaves prior runs untouched. A run dated before a rate
  change uses the old rate.

### 5.2 · Add the missing statutory keys

- **Do:** while wiring, add `gratuity`, `statutory_bonus` and `LWF` keys to the
  calendar and the payroll computation — none of these exists as a column or as
  code today (proposal 79/84 gap).
- **Accept:** a gratuity-eligible employee's F&F (Phase 84 work) can read a rate.

### 5.3 · Invoicing dates

- **Do:** where invoicing derives a statutory date (GST period boundaries, TDS
  thresholds), read it from the calendar rather than a literal.
- **Accept:** the GSTR builders and the 194Q watch agree with the dated store.

## Guardrails

- `statute_calendar.as_of` is **mandatory** — never read a rate without a date.
- This touches the payroll write path. Write the migration risk report first; run
  no probe that writes a payslip to a live org.
- Cast ambiguous parameter expressions (`$1::int + $2::int`) — PgBouncer turns an
  untyped parse error into an instant 500.

## Definition of done

- No rate constant remains hardcoded in `vetana.py` that `statute_calendar` could
  supply.
- A dated rate change is proven to affect only runs on/after its `as_of`.
- `cd backend && python -m pytest -q` green, including a test that a pre-change
  run keeps the old rate.

---

## Progress

_Update as items land — tick here, flip the row in `docs/STATUS.md`, and append to `PROGRESS.md` with evidence. Nothing in this phase has landed yet._
