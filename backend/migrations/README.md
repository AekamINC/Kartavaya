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
