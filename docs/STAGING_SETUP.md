# Kartavya — Staging Environment Setup Guide

> **Created**: July 2026 | **DB Project**: `kartavya-sg` (`toacecaewujfxjfrjwco`)
> **Architecture**: PostgreSQL schema isolation (`staging` schema within same Supabase DB)

---

## 1. Architecture Overview

Staging uses a **separate PostgreSQL schema** (`staging`) within the same Supabase project. This means:

- **Zero extra cost** — no additional Supabase project or branch needed
- **Shared auth** — `public.users` and `public.teams` are shared (login works seamlessly)
- **Isolated data** — all new module tables live in `staging.*`, completely separate from `public.*`
- **No cross-contamination** — staging module data never touches live tables

```
┌─────────────────────────────────────────────────┐
│  Supabase: kartavya-sg (toacecaewujfxjfrjwco)  │
│                                                  │
│  ┌──────────────┐    ┌────────────────────────┐ │
│  │ public schema│    │   staging schema        │ │
│  │              │    │                          │ │
│  │ users ◄──────┼────┤── organisations (bridge) │ │
│  │ teams ◄──────┼────┤   crm_* (11 tables)     │ │
│  │ tasks        │    │   hr_* (9 tables)        │ │
│  │ projects     │    │   pay_* (8 tables)       │ │
│  │ channels     │    │   plans, subscriptions   │ │
│  │ messages     │    │   module_subscriptions   │ │
│  │ ... (41 tbl) │    │   ... (37 objects)       │ │
│  └──────────────┘    └────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### Key Table: `staging.organisations`

The module MDs reference `organisations(id)` with UUID `org_id`. The live DB uses `teams` with `team_id` (text). The bridge table maps between them:

```sql
staging.organisations (
    id UUID PRIMARY KEY,           -- new UUID for module FKs
    team_id TEXT NOT NULL,         -- maps to public.teams.team_id
    name TEXT NOT NULL,
    gstin, pan, state_code, ...   -- org-level fields needed by modules
)
```

A view `staging.user_org_context` joins `public.users` → `public.team_members` → `staging.organisations` for easy lookups.

---

## 2. Git Branching

| Branch | Purpose | Deploys To |
|--------|---------|------------|
| `main` | Production code | Vercel production, Railway production |
| `staging` | New module development | Vercel preview, Railway staging |
| `feature/*` | Individual module work | Local dev only |

Workflow:
1. Create feature branch from `staging`: `git checkout -b feature/crm-module staging`
2. Develop and test locally against `staging` schema
3. PR into `staging` branch → Vercel preview auto-deploys
4. When phase is complete, PR from `staging` → `main` (with DB migration promotion)

---

## 3. Environment Variables

### `.env.staging` (Backend — Railway)

```env
# Database — same Supabase project, staging schema via search_path
SUPABASE_URL=https://toacecaewujfxjfrjwco.supabase.co
SUPABASE_ANON_KEY=<same-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<same-service-role-key>
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?options=-c%20search_path%3Dstaging%2Cpublic

# Schema config — tells the app to use staging
DB_SCHEMA=staging
ENVIRONMENT=staging

# API
API_BASE_URL=https://staging-api.kartavaya.com

# R2 (same bucket, staging prefix)
R2_BUCKET=aekaminc
R2_PREFIX=staging/

# WhatsApp (test number)
WHATSAPP_PHONE_ID=<test-phone-id>
WHATSAPP_TOKEN=<test-token>

# KBY-AI (facial verification — test endpoint)
KBYAI_API_URL=https://api.kby-ai.com
KBYAI_API_KEY=<test-key>
```

### `.env.staging` (Frontend — Vercel)

```env
REACT_APP_API_URL=https://staging-api.kartavaya.com
REACT_APP_SUPABASE_URL=https://toacecaewujfxjfrjwco.supabase.co
REACT_APP_SUPABASE_ANON_KEY=<same-anon-key>
REACT_APP_ENVIRONMENT=staging
```

### Critical: `search_path` for Schema Routing

The backend must set `search_path` to `staging, public` so that:
- Queries to module tables (`crm_accounts`, `hr_employees`) resolve to `staging.*`
- Queries to auth tables (`users`, `teams`) resolve to `public.*`

In FastAPI, set this on each DB session:

```python
# backend/database.py
import os

SCHEMA = os.getenv("DB_SCHEMA", "public")

async def get_db():
    async with pool.acquire() as conn:
        if SCHEMA == "staging":
            await conn.execute(f"SET search_path TO staging, public")
        yield conn
```

Or via Supabase client with `options`:

```python
from supabase import create_client
supabase = create_client(url, key)
# For staging, use schema parameter:
supabase.schema("staging").table("crm_accounts").select("*").execute()
```

---

## 4. Vercel Setup (Frontend)

### Preview Deployments for `staging` Branch

1. In Vercel project settings (`prj_RAQVCxQFFq51jDvvUbp2b1MV8ZN2`):
   - Go to **Settings → Git**
   - Production Branch: `main` (already set)
   - Preview branches: all non-production branches auto-deploy

2. Set staging environment variables:
   - Go to **Settings → Environment Variables**
   - Add all `.env.staging` vars with scope: **Preview**
   - This ensures only preview deployments (staging branch) use staging config

3. Custom domain (optional):
   - Add `staging.kartavaya.com` as a preview domain
   - Or use Vercel's auto-generated preview URLs

---

## 5. Railway Setup (Backend)

### Create Staging Service

1. In Railway project, create a new **Service** named `kartavya-api-staging`
2. Connect to GitHub repo `kevalvshah/Kartavya`, branch: `staging`
3. Set all `.env.staging` backend variables
4. Deploy — Railway auto-deploys on push to `staging`

Alternatively, use Railway environments:
- Create a `staging` environment in the existing Railway project
- Override env vars for staging
- Each environment gets its own deployment

---

## 6. Database Schema Details

### Staging Tables Created (64 objects total)

**CRM Module** (11 tables):
`crm_accounts`, `crm_contacts`, `crm_pipelines`, `crm_leads`, `crm_deals`, `crm_products`, `crm_quotations`, `crm_invoices`, `crm_activities`, `crm_deal_stage_history`, `crm_sequences`

**HRMS Module** (9 tables):
`hr_employees`, `hr_shifts`, `hr_attendance`, `hr_leave_types`, `hr_leave_requests`, `hr_leave_balances`, `hr_documents`, `hr_holidays`, `hr_office_locations`

**Payroll Module** (8 tables):
`hr_salary_structures`, `pay_runs`, `pay_slips`, `pay_pf_records`, `pay_esi_records`, `pay_tds_records`, `pay_it_declarations`, `pay_loans`, `pay_professional_tax`

**Marketing Module** (14 tables):
`mkt_segments`, `mkt_campaigns`, `mkt_campaign_messages`, `mkt_email_templates`, `mkt_landing_pages`, `mkt_web_forms`, `mkt_form_submissions`, `mkt_tracked_links`, `mkt_link_clicks`, `mkt_unsubscribes`, `mkt_social_links`, `mkt_referral_codes`, `mkt_referrals`, `mkt_campaign_stats`

**Sales Operations Module** (12 tables):
`sales_territories`, `sales_targets`, `sales_commission_slabs`, `sales_commission_assignments`, `sales_commissions`, `sales_playbooks`, `sales_proposal_templates`, `sales_proposals`, `sales_proposal_sequences`, `sales_leaderboard`, `sales_forecasts`, `sales_routing_rules`

**Subscription Module** (7 tables):
`plans`, `add_on_modules`, `subscriptions`, `module_subscriptions`, `subscription_invoices`, `usage_tracking`, `subscription_events`

**Bridge** (1 table + 1 view):
`organisations`, `user_org_context`

### RLS Status

All staging tables have RLS **enabled** with org-isolation policies using `current_setting('app.current_org_id')::uuid`.

All 41 public tables have RLS **disabled** — this is a critical security issue to address separately.

### Functions & Triggers

| Function | Schema | Purpose |
|----------|--------|---------|
| `staging.crm_next_number()` | staging | Auto-increment quotation/invoice numbers |
| `staging.crm_calculate_gst()` | staging | CGST/SGST/IGST calculation |
| `staging.hr_calculate_attendance_metrics()` | staging | Auto-compute late/hours/overtime on check-in |
| `staging.hr_deduct_leave_balance()` | staging | Deduct leave on approval |
| `staging.sales_next_proposal_number()` | staging | Auto-increment proposal numbers |
| `staging.sales_update_target_on_deal_close()` | staging | Update target actuals when deal won |

### Seed Data

- `staging.plans`: 4 rows (Free, Professional, Business, Enterprise)
- `staging.add_on_modules`: 9 rows (CRM, GST Invoicing, HRMS, Biometric, Payroll, WhatsApp, Analytics Pro, Marketing, Sales Operations)
- `staging.pay_professional_tax`: 9 rows (Maharashtra, Gujarat, Karnataka slabs)

---

## 7. Promotion Workflow (Staging → Production)

When a module phase is complete and tested:

### Step 1: Promote DB Tables

```sql
-- Example: promoting CRM tables from staging to public
-- Run in Supabase SQL Editor

-- Option A: Move tables (rename schema)
ALTER TABLE staging.crm_accounts SET SCHEMA public;
-- Repeat for each table...

-- Option B: Create in public and migrate data (safer)
-- 1. Run the original migration SQL (from CRM_MODULE.md) against public schema
-- 2. INSERT INTO public.crm_accounts SELECT * FROM staging.crm_accounts;
-- 3. Verify data integrity
-- 4. DROP TABLE staging.crm_accounts;
```

### Step 2: Merge Code

```bash
# Create PR from staging → main
git checkout main
git pull origin main
git merge staging --no-ff -m "Promote CRM module to production"
git push origin main
```

### Step 3: Update Environment

- Switch backend from `search_path = staging, public` to just `public`
- Or keep `search_path` if some modules are still in staging

### Step 4: Verify

- Run integration tests against production
- Verify RLS policies work correctly
- Check Razorpay webhook URLs point to production

---

## 8. Local Development

### Prerequisites

- Node.js 18+, Python 3.13+, PostgreSQL client
- Access to Supabase project (connection string)

### Running Locally Against Staging

```bash
# Backend
cd backend
cp .env.staging .env
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
cp .env.staging .env.local
npm start
```

### Creating a New Organisation for Testing

```sql
-- 1. Find your team_id
SELECT team_id, name FROM public.teams WHERE name ILIKE '%test%';

-- 2. Create org bridge record
INSERT INTO staging.organisations (team_id, name, gstin, state_code)
VALUES ('your-team-id', 'Test Company Pvt Ltd', '27AABCU9603R1ZM', '27');

-- 3. Create a default subscription (Free plan)
INSERT INTO staging.subscriptions (org_id, plan_id, status)
SELECT o.id, p.id, 'active'
FROM staging.organisations o, staging.plans p
WHERE o.team_id = 'your-team-id' AND p.code = 'free';
```

---

## 9. Applied Migrations Log

| # | Migration Name | Date | Tables Created |
|---|---------------|------|----------------|
| 1 | `create_staging_schema` | 2026-07-04 | Schema + grants |
| 2 | `staging_organisations_bridge` | 2026-07-04 | organisations, user_org_context view |
| 3 | `staging_crm_tables` | 2026-07-04 | 11 CRM tables + functions |
| 4 | `staging_hrms_tables` | 2026-07-04 | 9 HRMS tables + trigger + function |
| 5 | `staging_payroll_tables` | 2026-07-04 | 9 Payroll tables + PT seed data |
| 6 | `staging_subscription_tables` | 2026-07-04 | 7 Subscription tables + seed data |
| 7 | `staging_remove_razorpay_manual_billing` | 2026-07-04 | Dropped Razorpay cols, added manual billing fields |
| 8 | `staging_marketing_tables` | 2026-07-04 | 14 Marketing tables + RLS |
| 9 | `staging_sales_tables` | 2026-07-04 | 12 Sales tables + triggers + functions |
| 10 | `staging_add_marketing_sales_addons` | 2026-07-04 | 2 new add-on module seeds |

---

## 10. Security Reminders

1. **Public schema RLS**: All 41 production tables have RLS disabled. This must be fixed before launch — it's a critical vulnerability.
2. **Billing**: Manual billing only — sales/directors create invoices and record payments. No payment gateway integration.
3. **WhatsApp**: Use Meta's test phone number in staging. Real messages cost money.
4. **R2 prefix**: All staging file uploads go to `staging/` prefix in the `aekaminc` bucket to avoid polluting production files.
5. **DPDP Act**: Aadhaar is stored as SHA-256 hash only (`aadhaar_hash`), never in plain text. This applies in both staging and production.
