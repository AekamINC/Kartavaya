# backend/migrations/

Database schema changes. Run against Railway Postgres in order.

## Numbering convention

`NNN_description.sql` — three-digit prefix, ascending. Never re-number.
Python migration scripts (`*.py`) are for one-off data migrations only;
schema changes must be `.sql`.

## Current migrations

| File | Status | What it does |
|---|---|---|
| `001_role_based_access.py` | ✅ Applied | Creates `project_assignments`, `task_clients` tables; adds `role` column to `users` |
| `002_custom_fields.sql` | ⏳ Pending | `field_definitions` + `field_values` tables (V2_PLAN §4) |
| `003_views_and_dashboards.sql` | ⏳ Pending | `saved_views` + `dashboards` tables |
| `004_automations_and_templates.sql` | ⏳ Pending | `automations`, `project_templates`, `task_templates` tables |
| `005_activity_and_time.sql` | ⏳ Pending | `activity_events` + `time_entries` tables |
| `006_mentions.sql` | ⏳ Pending | `mentions` table |
| `007_rls_and_indexes.sql` | ✅ Applied | Row-level security policies + performance indexes |
| `046_leadgen_catalog.sql` | ⏳ Pending | Seeds `hub_scraper_catalog` with LinkedIn/Ads/SEO/social/e-commerce/GovIndia/WhatsApp/enrichment scrapers; adds `graha_field_map` + import-tracking columns |
| `047_invoice_pdf.sql` | ⏳ Pending | Adds company-profile fields (logo/email/phone/website/bank_details/invoice_note) to `organisations` + `is_export`/`currency` to `ganit_invoices` for PDF generation |
| `093_sanvaad_slack_parity.sql` | ⏳ Pending | `samvada_mentions` (the mention record that never existed), `pinned_at`/`pinned_by` + generated `search_tsv` on `samvada_messages`, `samvada_typing` / `samvada_presence` for the `/live` poll, and **both** GIN indexes `GET /search` needs: `search_tsv` for word matches and `content gin_trgm_ops` (pg_trgm) for the ILIKE arm — that query ORs the two arms, and an OR with one unindexed branch is a sequential scan, so the tsvector index does nothing until the trigram index exists |
| `095_credit_model.sql` | ⏳ Pending | **One credit ledger.** Two buckets on `hub_org_credits` (`allowance_balance` resets monthly with no carry-over, `purchased_balance` carries over forever, spend draws allowance first so paid credits survive the roll); `balance` kept as the maintained sum, deliberately **not** generated. New `org_member_credits` — a period-scoped **ceiling on the shared org balance**, not a second wallet, replacing `hub_user_credits` whose only writer was additive-only so a ceiling could never be lowered. New `credit_prices`, seeded byte-for-byte from `CREDIT_COSTS` so no price moves on migration day, which turns an unlisted kind into an error instead of a silent 2 credits. `organisations.is_platform_org` — a flag, not a fake plan number — skips the org balance check only. Nine columns on `hub_org_credit_transactions` (`kind`, `ref_id`, `quantity`, `allowance_delta`, `purchased_delta`, `idempotency_key`, `reverses_tx_id`, `metered_only`, `period_start`) so reports stop parsing free-text descriptions, a retry cannot charge twice, and a spend can be refunded exactly once — both enforced by partial unique indexes, not by code. Gives **every** org a wallet row, ending the dead-org bug where an org negotiated to 0 credits got no row and a permanent 402. Backfill puts every existing balance into **purchased**: the history cannot distinguish the two, and calling a credit `allowance` would destroy it at the next roll. Also `staging.v_org_credit_drift`, which must always return zero rows |
| `096_billing_lines.sql` | ⏳ Pending | **What an org is billed, as rows instead of as a number typed into a form.** Requires 095 — section 6 seeds into `credit_prices`, and GUARD 0 names that dependency rather than letting you read "relation does not exist" six sections later. New `org_billing_lines`: the five things a client is billed for (`platform`, always present with no toggle; `support`/`setup`/`ongoing`, the one repeating `{enabled, description, amount}` shape with a checkbox that is OFF until ticked; `topup`, born from the top-up dialog in the same transaction as the credit grant, never typed), each carrying a description, a start month and an author — so "and ₹8,000/mo for support since March" is finally expressible, which a single scalar never could be. New `invoice_billing_lines`: the machine-readable half of an invoice, which turns an invoice from a hand-typed total into **a query over the lines due in a period**, with `uq_ibl_line_period` making no-double-charge an index rather than a code path. `subscription_invoices` gains `generated_from` (`manual` stays legal permanently — Kartavaya's clients agree terms verbally, an invoice must be creatable standalone, and nothing may gate provisioning on one existing) plus a snapshotted `upi_vpa`/`upi_payee_name`, because there is no payment gateway and there will not be one; `organisations` gains the same two so the platform org can be the payee. Seven `social_send:{platform}` price rows, **all 0 credits, identical to the `social_send` row they split — this migration moves no price**, so "per source" can mean per platform: `price_of` resolves a `channel` spend by exact `ref_id` and raises `UnknownPrice` rather than guessing, so the ref_id cannot be split until the prices exist. **Reconciliation rule, stated once:** `org_billing_lines` is authoritative for what an org is charged; `organisations.monthly_price` is **not dropped** but demoted to a denormalised mirror of the single open `platform` line, display-and-compatibility only, charged by nothing (four endpoints select it, three screens render it); `PATCH /admin/orgs/{id}/settings` must write **both in one transaction**; and **if the two ever disagree the line wins and `monthly_price` is the bug** — repair by rewriting the scalar from the line, never the reverse, because the line carries a description, a start date and an author that a scalar cannot reconstruct. **It does backfill**, one open `platform` line per org with `monthly_price > 0`, at `date_trunc('month', NOW())` so no past month becomes billable; idempotent via `NOT EXISTS` over *any* platform line (open **or** ended) as well as `ON CONFLICT DO NOTHING`, so a replay cannot mint a second platform fee — and its `WHERE` must stay in lockstep with the drift view's predicate. **`staging.v_org_platform_line_drift` must always return zero rows**, the same contract 095 gave `v_org_credit_drift`. `created_by`/`ended_by` are **TEXT, not UUID** — a user id here is `user_xxxxxxxx` and 030 and 092 both exist because that was forgotten before. **Locks:** everything is a catalog operation or a write to an empty/16-row table except the two `ALTER TABLE … ADD COLUMN`s, which take `ACCESS EXCLUSIVE` on `subscription_invoices` and `organisations` for a catalog update **without a table rewrite** (constant/NULL defaults, PG 11+) — safe, but they queue behind any open long transaction and block everything else on those tables while queued, and `organisations` is read on nearly every request. `SET LOCAL lock_timeout='5s'` turns that into a clean rollback. Run it when the app is quiet. **`hub_org_credit_transactions` is not touched at all** |

> Migrations 002–006 are defined in `V2_PLAN.md §4`. The SQL is the
> source of truth — this table is a summary.

## Running a migration

```bash
# Apply a single file against Railway Postgres
psql "$DATABASE_URL" -f backend/migrations/007_rls_and_indexes.sql
```

Or use the Railway console for one-off scripts.

## Rules

- **Never edit an applied migration.** Create a new numbered file instead.
- Every new table needs a matching entry in `seed.py` for dev data.
- Every new column that is read in Python needs a `row_to_task()` or
  equivalent Pydantic model update in `server.py` or the relevant router.
- After applying a migration, update the Status column above.

## Cross-folder impact

| When you add a migration… | Also update… |
|---|---|
| New table | `seed.py` (dev data), relevant router, relevant frontend hook/page |
| New column on `tasks` | `row_to_task()` in `server.py`, `TaskOut` model, relevant frontend page |
| New column on `users` | `auth_router.py` `/auth/me` response, `AppShell.jsx` if user data is cached |
| New index | No code change needed, but note it here |
| New billing-line column (`org_billing_lines`, `invoice_billing_lines`) | `services/billing_lines.py` is the only writer — a router may read, none may INSERT/UPDATE. A line is **ended by setting `period_end`, never DELETEd**; `invoice_billing_lines.line_id` is `ON DELETE RESTRICT` so the database refuses it. If the column changes what an org is charged, check `staging.v_org_platform_line_drift` is still empty afterwards |
| New credit column (`hub_org_credits`, `org_member_credits`, `hub_org_credit_transactions`, `credit_prices`) | `services/credits.py` is the **ONLY** reader/writer. No router may name a credit column directly — `tests/test_credits_isolation.py` walks the tree and fails if any of those four table names appears in a second file. Add the column, then add the accessor there |
