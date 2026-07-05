# Kartavya — Unified Business Platform Ecosystem

> **Version**: 1.0 | **Date**: July 2026 | **Owner**: Aekam Inc
> **Audience**: Investors, Stakeholders, Product Leadership, Technical Team

---

## 1. Executive Summary

Kartavya is a modular, multi-tenant business platform built for Indian SMBs. It combines project management, CRM, HRMS, payroll, marketing automation, sales operations, WhatsApp messaging, analytics, subscription billing, and AI-powered content generation into a single integrated ecosystem.

Unlike horizontal SaaS products that force businesses to stitch together 5–10 tools, Kartavya provides a unified platform where data flows seamlessly between modules. A lead captured via WhatsApp chatbot automatically enters the CRM pipeline, feeds into the marketing engine, and its revenue shows up in the sales dashboard — all within one login.

**Key Numbers:**
- 10 integrated modules (9 core + AekamHub AI portal)
- 100+ database tables across staging and production schemas
- 4 pricing tiers (Free → Enterprise) + à la carte module add-ons
- Multi-tenant architecture with Row Level Security (RLS) on every table
- Single tech stack: React 19 + FastAPI + Supabase + Cloudflare R2
- Live clients: Labofab India, Vaijnath Infra
- 2 products under Aekam Inc umbrella: Kartavya (platform) + AekamSentinel (attendance, merged into HRMS)

---

## 2. Platform Architecture

### 2.1 Technology Stack

| Layer | Technology | Hosted On |
|-------|-----------|-----------|
| Frontend | React 19 (CRA + CRACO + Tailwind CSS) | Vercel |
| Backend | FastAPI (Python 3.13) | Railway |
| Database | PostgreSQL (Supabase) | Supabase (ap-southeast-1) |
| Auth | Supabase Auth (JWT + RLS) | Supabase |
| Storage | Cloudflare R2 (bucket: `aekaminc`) | Cloudflare |
| Email | AWS SES | AWS |
| SMS | MSG91 | MSG91 |
| WhatsApp | Meta Business API (via Interakt/Wati BSP) | Third-party |
| AI | Gemini, Groq, OpenRouter (multi-provider) | External APIs |
| Mobile | Expo (Android) | Google Play |
| Domain | kartavaya.com (Hostinger DNS) | Cloudflare DNS |

### 2.2 Multi-Tenant Architecture

Every table has an `org_id` column with RLS policies enforcing data isolation at the database engine level. Client A's queries physically cannot return Client B's rows — even if application code has a bug.

```
Production: public schema (41 tables) — live clients
Staging: staging schema (64 objects) — module development
AekamHub: aekamhub schema (~23 tables) — AI portal (planned)
```

### 2.3 Database Schema Layout

| Schema | Tables | Purpose |
|--------|--------|---------|
| `public` | 41 | Core platform: users, teams, tasks, projects, channels, messages |
| `staging` | 64 | Module development: CRM, HRMS, Payroll, Marketing, Sales, Subscription, Analytics |
| `aekamhub` | ~23 | AI marketing portal: clients, brand profiles, credit wallets, content library |

---

## 3. Module Overview

### The Complete Feature Map

| # | Module | Tables | Pricing | Status | Key Capabilities |
|---|--------|--------|---------|--------|------------------|
| 1 | **Core Platform** | 41 | Free (≤5 users) | Live | Tasks, projects, Kanban, docs, approval workflow, Realtime |
| 2 | **CRM** | 11 | ₹49/user/mo | Staging | Accounts, contacts, leads, deals, pipelines, quotations, invoices, GST |
| 3 | **HRMS** | 9 | ₹39/user/mo | Staging | Employees, attendance (4 verification methods), shifts, leave management |
| 4 | **Payroll** | 8 | ₹59/user/mo | Staging | Salary structures, pay runs, PF/ESI/TDS, pay slips, Labour Code 2026 compliant |
| 5 | **Marketing** | 14 | ₹39/user/mo | Staging | Email/SMS/WhatsApp campaigns, segments, landing pages, web forms, UTM tracking |
| 6 | **Sales Ops** | 12 | ₹49/user/mo | Staging | Targets & quotas, commissions, territories, playbooks, proposals, leaderboards |
| 7 | **WhatsApp** | — | ₹29/user/mo | Staging | Samvada (internal chat) + Varta (WhatsApp Business), templates, broadcasts |
| 8 | **Analytics Pro** | 4 | ₹19/user/mo | Staging | Dashboards, widgets, reports, data cache, cross-module metrics |
| 9 | **Subscription** | 7 | Built-in | Staging | Plans, add-ons, billing cycles, manual invoicing (no payment gateway) |
| 10 | **AekamHub** | ~23 | ₹10K–20K/client/mo | Planned | AI content generation, chatbot, brand intelligence, credit system |

---

## 4. Module Deep Dives

### 4.1 Core Platform (Live)

The foundation every other module builds on. Already in production with paying clients.

**Features:**
- Role-based access control (Admin, Member, Client views)
- Project and task management with Kanban, Table, Calendar views
- Approval workflow (unique differentiator vs generic task managers)
- Document management
- Email notifications (AWS SES)
- Supabase Realtime (live Kanban updates, presence indicators)
- Custom fields on tasks
- Time tracking
- Activity events and mentions
- Native Android app (Expo)

**Database:** 41 tables in `public` schema including `users`, `teams`, `team_members`, `projects`, `tasks`, `field_definitions`, `field_values`, `saved_views`, `dashboards`, `automations`, `project_templates`, `task_templates`, `activity_events`, `time_entries`, `mentions`

**Pricing:**
- Free: ₹0 (up to 5 users)
- Professional: ₹99/user/month
- Business: ₹149/user/month
- Enterprise: ₹249/user/month

---

### 4.2 CRM Module (Staging)

Full customer relationship management with India-specific features: GST-compliant quotations/invoices, IndiaMART and JustDial lead webhooks, multi-pipeline deal tracking.

**11 Tables:** `crm_accounts`, `crm_contacts`, `crm_pipelines`, `crm_leads`, `crm_deals`, `crm_products`, `crm_quotations`, `crm_invoices`, `crm_activities`, `crm_deal_stage_history`, `crm_sequences`

**Key Features:**
- **Contact & Account Management**: Companies and people with custom fields, source tracking (WhatsApp, IndiaMART, JustDial, web form, referral, LinkedIn)
- **Pipeline Management**: Configurable stages with probability weighting, Kanban drag-and-drop (reuses existing KanbanView engine)
- **Lead Lifecycle**: New Lead → Qualified → Proposal → Negotiation → Won/Lost, with auto-conversion to deals
- **Lead Import Webhooks**: IndiaMART and JustDial webhook endpoints for automatic lead capture
- **GST-Compliant Quotations**: Line items with HSN/SAC codes, auto-detection of CGST+SGST (intra-state) vs IGST (inter-state) based on state codes
- **Invoice Generation**: One-click quotation → invoice conversion with auto-numbering (KQ-2026-0001, KINV-2026-0001)
- **Weighted Revenue Forecast**: Pipeline value × probability per stage
- **Activity Timeline**: Call logs, emails, WhatsApp messages, meetings, notes per contact/deal

**India-Specific:**
- GSTIN (15-char) and PAN (10-char) on accounts
- State code mapping for GST calculation
- HSN (goods) / SAC (services) code support
- CGST + SGST (same state) vs IGST (different state) auto-split

---

### 4.3 HRMS Module (Staging) — AekamSentinel Merged

Complete human resource management with AekamSentinel's attendance verification capabilities merged in.

**9 Tables:** `hr_employees`, `hr_shifts`, `hr_attendance`, `hr_leave_types`, `hr_leave_requests`, `hr_leave_balances`, `hr_holidays`, `hr_documents`, `hr_announcements`

**Key Features:**
- **Employee Management**: Full profile with employee codes, reporting hierarchy, department/designation, employment types (full-time, part-time, contract, intern)
- **4 Attendance Verification Methods** (from AekamSentinel):
  - Facial Recognition: Photo URL + confidence score + model version
  - Fingerprint: Device ID + template hash + match score
  - Geo-Tagged Photo: Photo + GPS coordinates + distance from office
  - PIN + GPS: PIN verification + GPS location validation
- **Shift Management**: Configurable shifts with start/end times, grace periods, night shift support, break duration
- **Leave Management**: Custom leave types (CL, SL, PL, ML), annual quotas, carry-forward, encashment, half-day support
- **Leave Balances**: Auto-calculated with opening + accrued - taken formula
- **Attendance Regularization**: Request → Approve/Reject workflow for missed punches
- **Late/Early Tracking**: Automatic calculation of late arrivals and early exits
- **Overtime Tracking**: Hours beyond shift duration

**Statutory Compliance:**
- PF number, ESI number, UAN storage
- PAN on employee record
- Aadhaar stored as SHA-256 hash only (DPDP Act compliance)
- Bank account details (account number, IFSC, bank name, branch)

---

### 4.4 Payroll & Compliance Module (Staging)

Full payroll processing with Indian statutory compliance.

**8 Tables:** `hr_salary_structures`, `pay_runs`, `pay_slips`, `pay_slip_adjustments`, `pay_statutory_config`, `pay_tds_declarations`, `pay_reimbursements`, `pay_bank_files`

**Key Features:**
- **Salary Structures**: Component-wise breakdown — Basic (≥50% CTC per Labour Code 2026), HRA, Conveyance, Medical, Special Allowance, custom components
- **Pay Run Processing**: Draft → Processing → Computed → Approved → Paid workflow with bulk processing
- **Pay Slip Generation**: Detailed earnings/deductions breakdown with PDF generation
- **Loss of Pay**: Automatic LOP calculation based on attendance data
- **Adjustments**: Bonuses, advances, reimbursements mid-cycle

**Statutory Compliance:**
- **PF (Provident Fund)**: 12% employer + 12% employee contribution on basic
- **ESI (Employee State Insurance)**: 3.25% employer + 0.75% employee (for salary ≤ ₹21,000/month)
- **Professional Tax**: State-wise slab calculation
- **TDS (Tax Deducted at Source)**: Investment declaration (80C, 80D, HRA), regime selection (old vs new), monthly TDS computation
- **Labour Code 2026 Compliance**: Basic salary minimum 50% of CTC enforced at database level

---

### 4.5 Marketing Module (Staging)

Multi-channel campaign engine for Indian SMBs.

**14 Tables:** `mkt_segments`, `mkt_campaigns`, `mkt_email_templates`, `mkt_campaign_recipients`, `mkt_campaign_events`, `mkt_landing_pages`, `mkt_web_forms`, `mkt_form_submissions`, `mkt_utm_links`, `mkt_utm_clicks`, `mkt_referral_programs`, `mkt_referral_codes`, `mkt_referrals`, `mkt_campaign_ab_tests`

**Key Features:**
- **Contact Segmentation**: Dynamic segments based on filter rules (industry, source, last activity, deal stage, location)
- **Multi-Channel Campaigns**: Email (AWS SES), SMS (MSG91), WhatsApp (Meta Business API), multi-channel sequences
- **Email Templates**: HTML template builder with merge fields, preview, A/B testing
- **Campaign Automation**: Schedule, send, pause, A/B test with statistical significance tracking
- **Campaign Analytics**: Open rates, click rates, bounce tracking, unsubscribe handling, per-recipient event log
- **Landing Page Builder**: Self-hosted on Vercel, drag-and-drop builder, custom domains
- **Web Forms**: Embeddable forms with auto-lead-creation in CRM
- **UTM Tracking**: Custom UTM links with click tracking and source attribution
- **Referral Programs**: Referral codes, reward tracking, automated referral attribution

**Channel Costs:**
- Email: ~₹0.07/email (AWS SES)
- SMS: ₹0.15–0.25/SMS (MSG91)
- WhatsApp: ₹0.50–0.85/conversation (Meta Business API)
- Landing Pages & Forms: Free (self-hosted)

---

### 4.6 Sales Operations Module (Staging)

Full sales ops engine for managing targets, commissions, territories, and forecasting.

**12 Tables:** `sales_territories`, `sales_targets`, `sales_commissions`, `sales_commission_slabs`, `sales_payouts`, `sales_playbooks`, `sales_playbook_steps`, `sales_proposals`, `sales_proposal_templates`, `sales_proposal_signatures`, `sales_forecasts`, `sales_leaderboards`

**Key Features:**
- **Targets & Quotas**: Monthly/quarterly/annual targets per rep, team, or territory with actual vs target tracking
- **Commission Engine**: Slab-based commission calculation (e.g., 5% on first ₹5L, 8% on next ₹5L, 12% above ₹10L), incentive tracking, payout reports
- **Territory Management**: Region → State → City hierarchy, state code and pincode mapping, geo-based lead routing to assigned reps
- **Sales Playbooks**: Step-by-step guides per deal stage — pitch scripts, objection handling, demo checklists, closing techniques
- **Proposal Templates**: Branded proposal generation with dynamic fields (client name, pricing, scope), PDF export
- **E-Signatures**: Digital signature capture on proposals and contracts (Aadhaar eSign integration path)
- **Revenue Forecasting**: Weighted pipeline forecast + historical trend analysis
- **Leaderboards**: Real-time rep rankings by revenue, deals closed, conversion rate, activity volume

---

### 4.7 WhatsApp & Messaging Module (Staging)

Two sub-products: **Samvada** (internal team messaging) and **Varta** (WhatsApp Business integration).

**Key Features — Samvada (Internal):**
- Channels (public, private, DM)
- Threaded conversations
- Reactions
- File sharing (via R2)
- Real-time via Supabase Realtime

**Key Features — Varta (WhatsApp Business):**
- WhatsApp Business API integration via BSP (Interakt/Wati initially, Meta Cloud API direct later)
- Message templates (text, image, document, video)
- Template approval management
- Broadcast messaging to contact segments
- Auto-reply rules (keyword-based + off-hours)
- Conversation inbox (team view with assignment)
- CRM integration: WhatsApp leads auto-create contacts + leads
- Chatbot capability (extended via AekamHub AI)

**Migration Path:**
1. Phase 1: BSP (Interakt/Wati) for quick setup
2. Phase 2: Direct Meta Cloud API integration for lower cost and more control

---

### 4.8 Analytics Pro Module (Staging)

Cross-module dashboards, custom widgets, scheduled reports.

**4 Tables:** `analytics_dashboards`, `analytics_widgets`, `analytics_reports`, `analytics_cache`

**Key Features:**
- **Custom Dashboards**: Drag-and-drop dashboard builder, per-module or cross-module views
- **Widget Types**: Metric cards, line charts, bar charts, pie charts, tables, funnels, heatmaps
- **Data Sources**: CRM (pipeline, forecast, conversion), HRMS (attendance, leave), Payroll (salary distribution, statutory), Marketing (campaign performance), Sales (targets, leaderboards)
- **Scheduled Reports**: Auto-email daily/weekly/monthly reports to stakeholders
- **Data Cache**: Pre-computed aggregations for fast dashboard loading

---

### 4.9 Subscription & Billing Module (Staging)

Internal billing engine — no payment gateway (directors and sales team handle invoicing and payment collection manually).

**7 Tables:** `plans`, `add_on_modules`, `subscriptions`, `module_subscriptions`, `invoices`, `payments`, `usage_logs`

**Key Features:**
- **Plan Management**: 4 tiers (Free, Professional, Business, Enterprise) with user limits and feature flags
- **Module Add-Ons**: À la carte module activation with dependency checking (e.g., Payroll requires HRMS)
- **Subscription Lifecycle**: Active → Trial → Past Due → Cancelled → Paused
- **Manual Billing**: Invoice generation for directors, payment recording with UTR/cheque references
- **Usage Tracking**: Per-org API call and storage tracking for fair-use enforcement

**Pricing Model:**

| Tier | Base Price | Module Add-Ons Available |
|------|-----------|--------------------------|
| Free | ₹0 (5 users max) | None |
| Professional | ₹99/user/mo | CRM (₹49), HRMS (₹39), Payroll (₹59), WhatsApp (₹29), Marketing (₹39), Sales (₹49), Analytics (₹19) |
| Business | ₹149/user/mo | All above + priority support |
| Enterprise | ₹249/user/mo | All included + custom integrations |

---

### 4.10 AekamHub — AI-Powered Marketing Portal (Planned)

White-labeled AI content generation portal for Aekam's SMM clients. Each client gets a branded subdomain (e.g., keyadesigns.kartavaya.com).

**~23 Tables:** `hub_clients`, `hub_users`, `hub_brand_profiles`, `hub_ai_agents`, `hub_content_library`, `hub_content_approvals`, `hub_skill_packs`, `hub_credit_wallets`, `hub_credit_transactions`, `hub_chatbot_configs`, `hub_chatbot_conversations`, `hub_chatbot_messages`, `hub_knowledge_base`, `hub_kb_embeddings`, `hub_analytics`, `hub_scheduled_posts`, `hub_templates`, `hub_campaigns`, `hub_audit_logs`, `hub_api_keys`, `hub_webhooks`, `hub_notifications`, `hub_settings`

**Key Features:**
- **Multi-Tenant Subdomain Architecture**: Single React app + single FastAPI backend. Wildcard DNS `*.kartavaya.com → Vercel`. New client = 1 DB row.
- **Brand Intelligence Engine**: Aekam configures brand voice, colors, audience, competitors, content pillars per client. Every AI call includes this as system prompt context — the moat.
- **6 AI Content Agents**: Social Media, Blog Writing, Ad Copy, Email Marketing, WhatsApp Business, Lead Magnet
- **Credit-Based Usage System**:
  - Starter: 1,000 credits/month (₹10,000)
  - Growth: 1,500 credits/month (₹15,000)
  - Pro: 2,000 credits/month (₹20,000)
  - Top-up: 500 credits for ₹500 (never expire)
- **AI Chatbot (Growth+)**: RAG-powered, pgvector knowledge base, English/Hindi/Gujarati, 24/7 on website + WhatsApp
- **Multi-Provider AI Routing**: Gemini 2.5 Flash-Lite (bulk), Gemini Flash (quality), Groq Llama 3.3 (fallback). No Claude API — too expensive for Indian SMB pricing.
- **Skill Packs**: Pre-built AI workflows (Festival Calendar, Product Launch, Testimonial Collector, Monthly Report, Reels Script, Local SEO, Crisis Response)
- **Content Library & Approval Workflow**: Generate → Review → Edit → Approve → Schedule
- **Admin Portal**: admin.kartavaya.com — all clients, usage stats, billing, brand configs, cost-per-client analysis

**Unit Economics:**
- Infrastructure cost: ₹8,050/month for 10 clients
- API cost per client: ₹100–400/month
- Gross margin: 80–94%
- Break-even: 1 Starter client

---

## 5. Cross-Module Integration Map

This is the power of Kartavya — modules don't exist in silos. Data flows between them automatically.

### 5.1 Integration Flows

| From | To | Integration | How |
|------|-----|-------------|-----|
| **WhatsApp** | **CRM** | WhatsApp messages create contacts + leads | `crm_contacts.source = 'whatsapp'`, webhook auto-creates lead |
| **IndiaMART/JustDial** | **CRM** | External lead webhooks | `/api/v1/crm/leads/webhook/indiamart` endpoint |
| **CRM** | **Marketing** | Contact segments feed campaigns | `mkt_segments` filter on `crm_contacts` fields |
| **CRM** | **Sales** | Deals feed targets & commissions | `sales_targets.revenue_actual` updated from `crm_deals.won_at` |
| **Marketing** | **CRM** | Web form submissions create leads | `mkt_form_submissions` → auto-create `crm_contacts` + `crm_leads` |
| **HRMS** | **Payroll** | Attendance feeds pay calculation | `hr_attendance.present_days` → `pay_slips.loss_of_pay_days` |
| **HRMS** | **Analytics** | Attendance/leave dashboards | Analytics widgets query `hr_attendance`, `hr_leave_balances` |
| **CRM** | **Analytics** | Pipeline & forecast dashboards | Analytics widgets query `crm_deals`, `crm_pipelines` |
| **Sales** | **Analytics** | Target vs actual dashboards | Analytics widgets query `sales_targets`, `sales_leaderboards` |
| **Subscription** | **All Modules** | Feature gating per org | `module_subscriptions` checked on every module API call |
| **AekamHub** | **CRM** | Chatbot leads flow to CRM | `crm_contacts.source = 'aekamhub_chatbot'` |
| **AekamHub** | **Marketing** | AI content feeds campaigns | Generated content → `mkt_campaigns`, `mkt_email_templates` |
| **AekamHub** | **WhatsApp** | Chatbot on WhatsApp | AekamHub AI chatbot processes via Varta WhatsApp integration |
| **AekamHub** | **Subscription** | AekamHub tiers as add-on modules | Registered in `add_on_modules` table |
| **Core Platform** | **All** | Auth, users, teams, org context | Every module table references `organisations(id)` with RLS |

### 5.2 Data Flow Diagram (Text)

```
External Leads                    Client Self-Service
(IndiaMART, JustDial,             (AekamHub Portal)
 Web Forms, WhatsApp)                    │
        │                                │
        ▼                                ▼
┌──────────────────────────────────────────────────┐
│                    CRM MODULE                     │
│  Contacts → Leads → Deals → Quotations → Invoices│
│                    │     │                        │
│                    │     └──── GST Calculation ───┤
└────────┬───────────┼─────────────────────────────┘
         │           │
    ┌────▼────┐ ┌────▼────────────┐
    │MARKETING│ │ SALES OPS       │
    │Segments │ │ Territories     │
    │Campaigns│ │ Targets/Quotas  │
    │Email/SMS│ │ Commissions     │
    │WhatsApp │ │ Leaderboards    │
    └────┬────┘ └────┬────────────┘
         │           │
         └─────┬─────┘
               │
        ┌──────▼──────┐
        │ ANALYTICS   │
        │ Dashboards  │
        │ Reports     │
        └─────────────┘

┌─────────────────┐    ┌─────────────────┐
│      HRMS       │───▶│    PAYROLL      │
│ Employees       │    │ Salary Structs  │
│ Attendance (4x) │    │ Pay Runs        │
│ Shifts & Leaves │    │ PF/ESI/TDS      │
└─────────────────┘    └─────────────────┘

┌──────────────────────────────────────────┐
│            WHATSAPP MODULE               │
│  Samvada (Internal) + Varta (Business)   │
│  Templates, Broadcasts, Auto-Replies     │
│  ◄──── CRM Lead Sync ────►              │
│  ◄──── AekamHub Chatbot ────►           │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│          SUBSCRIPTION MODULE             │
│  Plans, Add-Ons, Billing, Feature Gates  │
│  Controls access to all paid modules     │
└──────────────────────────────────────────┘
```

---

## 6. Pricing & Revenue Model

### 6.1 Kartavya Platform (Per-User SaaS)

| Revenue Stream | Unit | Price Range |
|---------------|------|-------------|
| Base subscription | per user/month | ₹0 – ₹249 |
| CRM add-on | per user/month | ₹49 |
| HRMS add-on | per user/month | ₹39 |
| Payroll add-on | per user/month | ₹59 |
| WhatsApp add-on | per user/month | ₹29 |
| Marketing add-on | per user/month | ₹39 |
| Sales Ops add-on | per user/month | ₹49 |
| Analytics Pro | per user/month | ₹19 |

**Example: 20-user Business org, all modules:**
- Base: 20 × ₹149 = ₹2,980/month
- All add-ons: 20 × (₹49 + ₹39 + ₹59 + ₹29 + ₹39 + ₹49 + ₹19) = 20 × ₹283 = ₹5,660/month
- **Total: ₹8,640/month per org**

### 6.2 AekamHub (Per-Client B2B)

| Tier | Monthly Fee | Credits | Target Client |
|------|------------|---------|---------------|
| Starter | ₹10,000 | 1,000 | Small businesses, personal brands |
| Growth | ₹15,000 | 1,500 | Growing SMBs, e-commerce |
| Pro | ₹20,000 | 2,000 | Established brands, multi-location |
| Top-Up | ₹500 | 500 | Any tier (credits never expire) |

### 6.3 Combined Revenue Potential

| Scenario | Kartavya | AekamHub | Total MRR |
|----------|----------|----------|-----------|
| Year 1 (conservative) | 5 orgs × ₹5K avg = ₹25K | 10 clients × ₹12.5K avg = ₹1.25L | ₹1.50L |
| Year 2 (target) | 20 orgs × ₹6K avg = ₹1.2L | 25 clients × ₹14K avg = ₹3.5L | ₹4.7L |
| Year 3 (scale) | 50 orgs × ₹7K avg = ₹3.5L | 50 clients × ₹15K avg = ₹7.5L | ₹11L |

---

## 7. Infrastructure & Cost

### 7.1 Current Production Stack

| Service | Spec | Monthly Cost |
|---------|------|-------------|
| Vercel (Frontend) | Pro plan, 1TB bandwidth | $20 (₹1,700) |
| Railway (Backend) | 1 vCPU + 1GB RAM | $30 (₹2,500) |
| Supabase (Database) | Pro plan, 8GB DB | $25 (₹2,100) |
| Cloudflare R2 (Storage) | 5GB, free egress | ~₹50 |
| Cloudflare DNS | Free plan | ₹0 |
| AWS SES (Email) | ~3,000 emails/month | ~₹200 |
| MSG91 (SMS) | Pay-per-SMS | ~₹500 (variable) |
| AI APIs (AekamHub) | ~5M tokens/month | ~₹1,500 |
| **Total** | | **~₹8,550/month** |

### 7.2 Scaling Path

| Milestone | Change | Additional Cost |
|-----------|--------|----------------|
| 20+ Kartavya orgs | Railway 2 vCPU + 2GB | +₹2,500/mo |
| 50+ combined users | Add Redis cache | +₹400/mo |
| 100+ AekamHub clients | Supabase Team plan | +₹40,000/mo |
| Mobile app launch | App Store fees | ₹2,100/year (Google) |

---

## 8. Security & Compliance

### 8.1 Data Isolation
- Row Level Security (RLS) enabled on every staging table
- `org_id = current_setting('app.current_org_id')::uuid` policy on each table
- AekamHub: additional `client_id` scoping with RLS for multi-tenant portal
- Admin bypasses RLS via `service_role` key

### 8.2 Indian Regulatory Compliance
- **DPDP Act**: Aadhaar stored as SHA-256 hash only — no raw Aadhaar in database
- **GST Compliance**: Full CGST/SGST/IGST calculation with state code mapping, HSN/SAC codes
- **Labour Code 2026**: Basic salary ≥ 50% of CTC enforced at database level (CHECK constraint)
- **PF/ESI**: Statutory contribution rates configurable per org
- **TDS**: Old and new regime support with 80C/80D/HRA declarations

### 8.3 Known Security Backlog
- 41 `public` schema tables have RLS **disabled** — critical item to address before scaling
- Migration `007_rls_and_indexes.sql` written but not yet applied to production
- All `staging` schema tables have RLS properly enabled

---

## 9. Build Roadmap

### Phase 1: Foundation (Completed)
- Core platform (tasks, projects, Kanban, approval workflow)
- User auth, team management, role-based access
- Vercel + Railway + Supabase deployment
- Android mobile app (Expo)
- Live clients onboarded

### Phase 2: Module Development (Current — Q3 2026)
- Staging schema with 64 objects across 9 modules
- CRM with GST compliance (11 tables)
- HRMS with AekamSentinel merge (9 tables)
- Payroll with PF/ESI/TDS (8 tables)
- Subscription & billing engine (7 tables)
- WhatsApp messaging (Samvada + Varta)

### Phase 3: Marketing & Sales (Q4 2026)
- Marketing automation (14 tables)
- Sales operations (12 tables)
- Analytics Pro dashboards (4 tables)
- Apply migrations to production
- Fix RLS on public schema tables

### Phase 4: AekamHub (Q4 2026 – Q1 2027)
- AekamHub MVP (auth, subdomain, Brand Engine, Social Agent, credits)
- AI chatbot with pgvector
- Content library and approval workflow
- Admin portal
- Re-acquire 5–6 departed SMM clients

### Phase 5: Scale (2027)
- Meta/LinkedIn direct publishing
- Mobile app for AekamHub
- Advanced analytics and reporting
- Payment gateway integration (if needed)
- White-label licensing

---

## 10. Competitive Positioning

### Kartavya vs Competitors (India)

| Feature | Zoho One | Freshworks | Kartavya |
|---------|----------|------------|----------|
| Price (20 users) | ~₹60K/mo | ~₹40K/mo | ~₹8.6K/mo |
| India-specific (GST, PF) | Partial | Partial | Built-in |
| WhatsApp native | Add-on | Add-on | Integrated |
| AI content portal | No | No | AekamHub |
| Custom modules | Limited | No | Full flexibility |
| Self-hosted option | No | No | Planned |

### AekamHub vs Alternatives

| Feature | DIY (ChatGPT+Canva) | Agency | AekamHub |
|---------|---------------------|--------|----------|
| Monthly cost | ₹1,500–3,000 | ₹15,000–50,000 | ₹10,000–20,000 |
| Brand voice | No | Maybe | Yes (built-in) |
| Self-service | Yes (generic) | No | Yes (brand-aware) |
| AI Chatbot | No | Rarely | Yes |
| Switching cost | Zero | Low | High |

---

## 11. Team & Execution

**Kev Shah — Founder & Technical Lead**
- Sole builder of entire Kartavya ecosystem and AekamSentinel
- Full-stack: React, FastAPI, PostgreSQL, Supabase, Vercel, Railway, Expo
- Manages all infrastructure, deployments, and client relationships

**Existing SMM Team**
- Transitions from execution to brand configuration + strategy for AekamHub
- Handles client onboarding, brand voice setup, strategy calls

**Key Execution Advantages:**
- Single tech stack across all modules — no integration overhead
- Shared infrastructure — adding a module costs near-zero in infra
- Deep domain knowledge of Indian SMB workflows (GST, PF/ESI, state codes)
- Live clients providing real-world feedback loop

---

## 12. Summary — Why Kartavya Wins

1. **Unified platform** — CRM + HRMS + Payroll + Marketing + Sales + WhatsApp + Analytics + AI in one login. Competitors make you buy and integrate 5–10 separate tools.

2. **India-first** — GST calculation, PF/ESI compliance, IndiaMART/JustDial webhooks, state code mapping, Labour Code 2026 compliance. Not an afterthought — built into the foundation.

3. **Affordable** — A 20-user org gets the full stack for ~₹8,600/month. Zoho One charges 7× that. Freshworks charges 5×.

4. **AI-powered revenue stream** — AekamHub adds a second revenue engine (₹10–20K/client/month) with 80–94% gross margins, using the same infrastructure.

5. **High switching cost** — Months of brand configuration, trained chatbots, captured leads, content history, and team workflows all locked into the platform. Leaving means starting from scratch.

6. **Capital efficient** — Total infrastructure: ₹8,550/month. Scales to 50+ clients before any major infrastructure changes. Break-even at 1 AekamHub client or 3 Kartavya orgs.

---

*Aekam Inc — July 2026 — Confidential*
