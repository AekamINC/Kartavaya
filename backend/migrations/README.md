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
| New credit column (`hub_org_credits`, `org_member_credits`, `hub_org_credit_transactions`, `credit_prices`) | `services/credits.py` is the **ONLY** reader/writer. No router may name a credit column directly — `tests/test_credits_isolation.py` walks the tree and fails if any of those four table names appears in a second file. Add the column, then add the accessor there |
