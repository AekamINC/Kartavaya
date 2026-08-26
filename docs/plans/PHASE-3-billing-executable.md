# Phase 3 — Make billing executable, then arm it

**Effort:** ~2 days after decisions land · **Blocks on:** Phase 0.17 (day-count),
Phase 2.3 (the two INSERTs must already be fixed)

Proposals 86 (Aekam bills orgs) and 87 (orgs bill their clients). The engine and
schema exist; **neither can take money.** Do these in order — **arming the cron
first would fire the broken sweep.**

## The state today (verified live)

- `subscription_invoices` = 0 rows, `invoice_billing_lines` = 0, `client_invoice_lines`
  = 0. The platform invoicing loop 86 calls "Built" has **never run**.
- `subscriptions.next_billing_date` = NULL on all 5 orgs — period advancement has
  never executed.
- `/cron/billing` is armed on **no Railway service** (cron-daily runs
  `hr invoices crm stock marketing skills scraper-prices`; nothing does billing).
- `org_billing_lines.billing_direction` (migration 217) has no reader and no writer.

## Tasks, in strict order

### 3.1 · The two INSERTs — done in Phase 2.3

Prerequisite. `gst_rate` removed, `invoice_number` allocated, a test executes
the SQL. Do not proceed until `client_invoice_lines` can gain a row.

### 3.2 · Fix the proration sign

- **Fault:** the "credit for unused days at the old rate" on a mid-cycle plan
  change is written as a **positive** `org_billing_lines` row of kind `setup`,
  because `billing_lines.py:300` refuses negative amounts. A plan change raises
  **two charges** instead of a charge and a credit.
- **File:** `backend/services/proration.py:88-96`, `backend/services/billing_lines.py:300`.
- **Do:** allow a credit line (negative, or a `kind='credit'` the invoice sums
  as negative). Decide the day-count first (**Phase 0.17**) — do not add a fourth
  convention.
- **Accept:** a mid-cycle upgrade produces one debit and one credit that net to
  the prorated difference.

### 3.3 · Make recurring actually recur

- **Fault:** `period_start` is recomputed from the service line's **original**
  period start on every sweep, so even with 3.1 fixed a monthly retainer invoices
  exactly **once, forever**.
- **File:** the client-billing sweep in `backend/routers/client_billing.py` /
  the cron entry.
- **Do:** advance the period from the **last invoiced** period, not the line's
  origin. Use the join table (`invoice_billing_lines` shape) to prevent
  double-invoicing.
- **Accept:** running the sweep twice across a period boundary produces two
  invoices; running it twice inside one period produces one.

### 3.4 · Arm `/cron/billing` — LAST

- **Only after 3.1–3.3.** Add the billing job to cron-daily (or its own service),
  keeping `startCommand` literal (Railway V2 does not shell-interpret it).
- Read back the **deployed** output after the config edit — a dead backend looks
  like CORS, and staging has silently tracked `main` before (`meta.branch`).
- **Accept:** one clean nightly run that advances `next_billing_date` on an org
  whose period has expired and creates exactly the invoices due.

## Out of scope for Phase 3 (record, do not build here)

- P3 dunning workflow, P4 module settings, P6 metering/PEPM/true-up — these are
  weeks of work and several depend on Phase 0.15 (module-settings scope). Track
  separately; do not let them delay making the *existing* engine correct.

## Definition of done

- A mid-cycle change nets correctly (3.2); a retainer recurs (3.3); the cron runs
  clean and advances a real period (3.4).
- `subscription_invoices` / `client_invoice_lines` move off 0 **in staging test
  data only** — never write a probe invoice against a live customer's org.
- A test executes each new INSERT/UPDATE against the real schema.

---

## Progress

_Update as items land — tick here, flip the row in `docs/STATUS.md`, and append to `PROGRESS.md` with evidence._

- **3.1 ✅** — done in Phase 2.3. `gst_rate` gone, `invoice_number` allocated,
  `tests/test_client_billing_invoices.py` executes both INSERTs' SQL live.
- **3.2 ✅ coded, tested, deployed 2026-08-26.** The credit is `kind='credit'`
  (migration 222, verified from `pg_constraint`), the magnitude stays positive,
  and one rule signs it — `_signed_amount` / `_SIGNED_AMOUNT_SQL` in
  `services/billing_lines.py`. Day-count unified on 0.17: `proration.py` was a
  THIRD convention (31 days for August 2026 against payroll's 26). Acceptance —
  a real mid-cycle change through the UI netting one debit and one credit — is
  still owed.
- **3.3 ✅ coded, tested, deployed 2026-08-26.** The period advances from the
  last invoiced one, stepping by cadence, one period per run.
  `sweep_client_auto_invoices` gains an optional `org_id` so the acceptance can
  run in the test org without writing into a customer's books. Acceptance — a
  service line created through the UI in E2E, then swept across a boundary — is
  still owed.
- **3.4 ⛔ NOT ARMED — owner decision first.** All four `client_service_lines`
  belong to Unicode Group, two auto-invoice at ₹75,000 + ₹15,000/month since
  2026-04-01, and `client_invoice_lines` is empty. The first tick raises April
  and one more month each day after it: ten tax invoices, ₹4,50,000 + ₹81,000
  GST, serials from Unicode's live sequence. Three options and their costs are
  written up in `docs/STATUS.md` under "Open, found 26 Aug".
