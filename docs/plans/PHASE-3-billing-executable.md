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
  THIRD convention (31 days for August 2026 against payroll's 26).
  **ACCEPTANCE PASSED 2026-08-27 00:24:12, on live rows**, once `real.config.ts`
  gained `channel: 'chrome'` — Vercel's bot mitigation had been fingerprinting
  Playwright's bundled `chromium-headless-shell` and 403ing every navigation,
  which is what "still owed" had meant. A real mid-cycle change through the UI
  produced exactly one debit and one credit in E2E Test & Associates:
  `credit` **₹3,200** ("unused 4 days at ₹20,000/mo") against `setup` **₹2,400**
  ("4 days at ₹15,000/mo"), both `cadence='one_off'`, both stamped the same
  microsecond, netting **−₹800**. `kind='credit'` is the only credit row in the
  table and `_SIGNED_AMOUNT_SQL` negates exactly that kind. The `set-plan` fix
  is in the same evidence: the subscription carries an `activated_by` and a
  `next_billing_date` of 2026-10-01, written 16 seconds later — that endpoint
  had 500'd on every call it had ever received.
- **3.3 ✅ ACCEPTANCE PASSED 2026-08-26, on live rows.** The period advances
  from the last invoiced one, stepping by cadence, one period per run.
  `/cron/billing` fired twice against the deploy: **`client_invoice_lines`
  0 → 2, auto-invoices 0 → 2** (`INV-2026-0093` ₹88,500, `INV-2026-0094`
  ₹17,700, both 2026-08-01 – 2026-09-01, intra-state Gujarat, unpaid, bodies
  populated), then **`created 0, skipped 2`** on the second run. Both halves of
  the written criterion. April–July were not raised — migration 223's
  `invoice_from`, set on Unicode's two lines on the owner's decision, held.
  `sweep_client_auto_invoices` also gained an optional `org_id` so a run can be
  scoped to the test org without writing into a customer's books.
- **3.4 🟡 VERIFIED, NOT SCHEDULED.** The endpoint has been run by hand twice
  and behaves — the second run created nothing. What remains is one config
  change: add `billing` to `cron-daily`'s curl loop, which today reads
  `hr invoices crm stock marketing skills scraper-prices`. Keep `startCommand`
  literal (Railway V2 does not shell-interpret it) and force a FRESH deploy —
  a redeploy reuses the old config snapshot — then read the deployed output
  back, because a dead backend looks like CORS.
