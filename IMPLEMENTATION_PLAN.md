# Kartavya · Master Implementation Plan

**Last updated:** 2026-07-17 (P0.3 + P1.1–P1.3 shipped)  
**Branch:** staging  
**Stack:** Vite+React / FastAPI+asyncpg / Supabase Postgres (Singapore) / Railway+Vercel  

---

## What Kartavya Is

All-in-one SaaS for Indian SMBs: CRM, invoicing, HR, payroll, AI content, marketing, project management — one login, flat INR pricing, no per-credit meters. Built by Aekam Inc.

---

## Modules — Current Status

| Module | Code | Router | Status | Notes |
|---|---|---|---|---|
| **Project Management** | core | server.py | ✅ Production | Kanban, tasks, comments, attachments, approvals |
| **Graha · CRM** | graha | graha.py | ✅ Production | Contacts, deals, pipeline, labels, web forms, lead scoring, dedupe/merge |
| **Ganit · Invoicing** | ganit | ganit.py | ✅ Production | Invoices, payments, GST, e-signature on contracts (OTP + SHA-256 audit trail) |
| **Manav · HRMS** | manav | manav.py | ✅ Production | Employees, documents, leave, shift scheduling + bidding + swaps |
| **Vetana · Payroll** | vetana | vetana.py | ✅ Production | Salary, payslips, compliance |
| **Vikray · Sales** | vikray | vikray.py | ✅ Production | Sales pipeline, territories, forecasts |
| **Srijan · AI Hub** | srijan | hub.py, hub_chat.py, hub_publish.py | ✅ Production | Multi-provider AI (Gemini/OpenRouter/Groq), RAG chatbot, social publishing (Meta/Instagram/LinkedIn/Google Business), content generation, skill packs, credit system |
| **Prachar · Marketing** | prachar | prachar.py, prachar_ads.py | ⚠️ Partial | Campaign CRUD + audience + ad insights + sequences/cadences (multi-channel). Send is a stub. |
| **Dristi · Analytics** | dristi | dristi.py | ⚠️ Partial | Dashboards + scheduled report delivery + CSV/JSON export. No frontend yet. |
| **Sanvaad · Messaging** | — | — | 📋 Planned | Internal messaging + WhatsApp. Docs only (MESSAGING_WHATSAPP_PLAN.md, WHATSAPP_MODULE.md) |
| **Pahchan · Attendance** | — | — | 📋 Planned | PWA biometric attendance, offline-first face-api.js. Spec in memory. |

---

## Architecture

### Backend
- **FastAPI** with asyncpg connection pool
- **Supabase Postgres** (project `toacecaewujfxjfrjwco`, region `ap-southeast-1` Singapore)
- All module tables in `staging` schema
- Custom JWT auth (not Supabase Auth) — `auth_router.py`
- Cloudflare R2 for file storage (not Supabase Storage)
- Email via Resend (primary) / AWS SES (fallback) — `email_service.py`

### Frontend
- **Vite + React** (JSX, not TypeScript)
- k-* design system (`editorial.css` tokens)
- Bilingual labels (English + Sanskrit)
- All pages fluid, left-aligned (no fixed-width centering)

### AI Routing (`services/ai_router.py`)
- Indic languages → Gemini 2.5 Flash Lite (free)
- English bulk → GLM-4.5-Air (free via OpenRouter)
- English quality → Qwen3.6 Flash
- Chatbot/RAG → Gemini direct with grounding (free web search)
- Premium → Gemini 2.5 Pro
- Cost tracked in `hub_ai_logs`, credits in `hub_credit_wallets`

---

## RBAC — Five-Layer Permission Model

Implemented 2026-07-16. Tables: `users`, `staging.user_roles`, `staging.org_member_modules`.

| Layer | Table | Roles | Purpose |
|---|---|---|---|
| **Platform** | `user_roles` (org_id NULL) | platform_admin, account_manager, account_finance, developer, srijan_admin | Who works at Aekam, what they can do across all orgs |
| **Org** | `user_roles` (org_id set) | org_owner, org_admin, org_member | Which company you belong to, your rank |
| **Module** | `org_member_modules` | per-user per-module grants | Which modules a user can access within their org |
| **Project** | `team_members` | owner, admin, member, client | Which boards you can open (cross-org for clients) |
| **Job Title** | `users.member_role` | free text | Display only, never a permission |

### Module Sensitivity
- 🟢 **Auto-granted** to new org_members: graha, vikray, prachar, srijan, dristi
- 🔴 **Require explicit grant**: vetana (payroll), ganit (finance), manav (HR)
- org_owner/org_admin: auto-access to all enabled modules

### Superadmins (all identical)
- admin@aekaminc.com
- bhoomi@aekaminc.com
- sid@aekaminc.com
- kevalvshah03@gmail.com

### Org Resolution (`middleware/org_resolver.py`)
1. `X-Org-Id` header (validated against user_roles)
2. Fallback: first org from `user_roles` (ORDER BY granted_at)
3. Legacy fallback: `team_members` (excludes `role='client'`)

---

## Tenancy Model

**Current state:** 31 orgs exist but are really project folders from PM-tool era. There is exactly one real tenant: Aekam Inc. All 31 orgs were bulk-created 12 July, 0 module data in any of them.

**Target:** Invert the FK — `teams.org_id` (many projects : 1 org) instead of `organisations.team_id` (1:1). Selling to a customer = create org #2.

**Founder rules (2026-07-16, do not relitigate):**
- Aekam toggles modules on client request after payment agreement
- Orgs are sales-provisioned, never self-signup
- One person CAN work for two orgs → org switcher required
- Clients must NOT see plan pricing (only integration costs + AI credits)

---

## Security — Resolved & Active

### Resolved (2026-06-21)
All Phase 1–6 vulnerabilities fixed: SQL injection, XSS, CSRF, rate limiting, email escaping, column allowlists.

### Active Issues
| ID | Issue | Severity | Status |
|---|---|---|---|
| G1 | Guest escalation: client role resolves to tenant org | Critical | **Mitigated** — `get_org_id` now rejects `role='client'` in team_members fallback |
| L1 | `GET /users` returns all users across all orgs (no WHERE) | High | Open — needs org filter |
| L2 | `PUT /users/{id}/role` has no ownership check | High | Open |
| L3 | `require_module` admin bypass is load-bearing (0 subscriptions exist) | Medium | Open — need subscription row before removing |
| L4 | `/subscription/current` leaks `price_monthly` | Medium | Open |
| L5 | `/hub/analytics/spend` exposes AI cost_usd to any user | Medium | Open — move behind require_platform_role |

---

## Migrations

| # | File | What | Applied |
|---|---|---|---|
| 001–015 | Various | Core tables, teams, tasks, auth, projects | ✅ |
| 016 | `016_multi_role_org_admin.sql` | user_roles table, platform role seeding | ✅ |
| 017 | `017_srijan_p3_p4_chatbot_publishing.sql` | KB, chat, social accounts, publish queue | ✅ |
| 018–020 | Various | Lead scoring, automations, reports, territories | ✅ |
| 021 | `021_dristi_prachar.sql` | Dristi dashboards, Prachar tables | ✅ |
| 022–023 | Various | Graha fields, web forms | ✅ |
| 024 | `024_graha_dedupe_merge.sql` | pg_trgm, contact dedup, merge audit | ✅ |
| 025 | `025_org_member_modules.sql` | Per-user module access, developer role | ✅ |
| 026 | `026_prachar_ad_insights.sql` | Ad accounts, campaigns, insights | ✅ |
| 027 | `027_esign_shifts_sequences_report_delivery.sql` | E-sign tables, shift scheduling, sequences, scheduled reports | ✅ |

---

## What's Next — Priority Order

### P0 — In Progress / Scheduled

| Task | Status | ETA |
|---|---|---|
| Prachar ad insights pipeline (Meta ingest + AI analysis) | ✅ Done 17 July | — |
| Tenancy fix steps 1–6 (stop leaks, invert FK, org_members, org admin console) | Step 0 done, step 1 scheduled 1am 17 July | ~26h |
| Replace `require_role("admin")` → `require_platform_role` across 20+ endpoints | Open | ~3h |

### P1 — Next Up

| Task | Notes |
|---|---|
| Prachar campaign send worker | Wire SES/Resend into send flow (currently a stub) |
| Prachar automations engine | Triggers exist in DB but nothing watches/executes them |
| Google Ads ingest | Same pipeline as Meta, add adwords scope to Google OAuth |
| Email white-label (org branding) | org_email_settings table, thread brand through send_email |
| `internal_only` flag on tasks/comments | Required before first real client invitation |
| Review-queue UI in GrahaPage | Contact dedupe review frontend |
| E-sign frontend (signing page + status UI) | Backend done, needs React signing flow |
| Shift scheduling frontend (ManavPage) | Backend done, needs calendar/grid UI |
| Sequences frontend (PracharPage) | Backend done, needs step builder + enrollment UI |
| Scheduled reports frontend (DristiPage) | Backend done, needs config form + logs view |

### P2 — Future

| Task | Notes |
|---|---|
| Sanvaad (internal messaging) | Slack-like channels, DMs, threads |
| WhatsApp integration (Meta Cloud API direct) | Not through BSP. Outbound notifications + inbound replies |
| Pahchan (biometric attendance) | PWA, offline-first face-api.js |
| In-house e-signature | IT Act §10A, OTP + SHA-256 + audit trail |
| Mumbai migration | Move Supabase from Singapore to Mumbai (ap-south-1). pg_dump → restore. |
| Click-to-call (Exotel/Knowlarity) | India VoIP providers |
| Business card scan (on-device OCR) | Tesseract.js / Google Vision |
| Data enrichment (BYO-key) | Apollo/Clay API integration, customer pays vendor |

---

## Related Planning Docs

| File | What |
|---|---|
| `PLAN_ALL_IN_ONE.md` | Competitive research (12 products), build/integrate/skip verdicts |
| `PLAN_ROLES.md` | Four-level role model spec, client collaboration gaps |
| `PLAN_VIKRAY.md` | Sales module spec |
| `PLAN_VETANA.md` | Payroll module spec |
| `docs/MARKETING_MODULE.md` | Ambitious marketing plan (not implemented) |
| `docs/WHATSAPP_MODULE.md` | WhatsApp implementation guide (code in doc, not deployed) |
| `docs/ANALYTICS_MODULE.md` | Analytics module plan (not implemented) |

---

## Dev Workflow

- **Branch:** `staging` for all development
- **Deploy:** Push to staging → Railway auto-deploys backend, Vercel auto-deploys frontend
- **Tests:** `python -m pytest backend/tests/ -x -q` (138 tests, all passing)
- **Build check:** `cd frontend && npx vite build --logLevel error`
- **DB access:** Supabase MCP or direct asyncpg via DATABASE_URL
