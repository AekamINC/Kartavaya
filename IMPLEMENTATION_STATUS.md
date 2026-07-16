# Implementation Status — Kartavya by Aekam Inc

**Last Updated:** 2026-07-16  
**Branch:** `staging`  
**Domain:** kartavaya.com

---

## Completed Modules

### Core Platform
| Module | Status | Description |
|--------|--------|-------------|
| Auth & JWT | Done | HS256 tokens, PBKDF2 passwords, role-based (admin/member/client) |
| Kanban Boards | Done | Real-time DnD (@hello-pangea/dnd), project switcher, column management |
| Task Management | Done | CRUD, subtasks, checklists, file attachments, activity feed |
| Approvals | Done | Owner + client approval workflow with magic-link emails |
| Templates | Done | Task + project templates, apply-on-create |
| Automations | Done | Trigger → filter → action rules engine |
| Time Reports | Done | Daily/weekly/monthly PDF+Excel via Railway cron |
| Inbox & Notifications | Done | VAPID web push + Expo push, in-app inbox |
| Teams & Roles | Done | Admin/member/client access, team-scoped data |
| Customize Settings | Done | Color picker, fonts, layout, language (EN/HI/GU), dark mode |

### Phase 0 — Multi-Tenant Middleware
| Component | Status | Description |
|-----------|--------|-------------|
| org_resolver | Done | Middleware resolves org_id from JWT |
| require_module | Done | Gate endpoints by org's subscription modules |
| require_role | Done | Role-based endpoint access |

### Phase 1 — Subscription & Billing
| Component | Status | Description |
|-----------|--------|-------------|
| Migration 010 | Done | Subscription tables, billing, module registry |
| Backend routes | Done | Plans, subscriptions, invoicing |
| Frontend pages | Done | BillingPage, AdminBillingPage |

### Srijan (सृजन) — AI Marketing Hub
| Phase | Status | Description |
|-------|--------|-------------|
| P1 — Foundation | Done | AI router (smart model routing), hub router, 3 frontend pages |
| P2 — Content | Done | Content library, brand profiles, credit system, skill packs |
| P3 — Chatbot | Done | RAG with pgvector, Gemini grounding (free web search), chat sessions |
| P4 — Publishing | Done | Meta/LinkedIn/GBP API, scheduler, per-client OAuth |

### Business Modules
| Module | Sanskrit | Route | Status | Description |
|--------|----------|-------|--------|-------------|
| Graha | ग्राह | /graha | Done | CRM — leads, deals, contacts, quotations, lead scoring, automations, territories, custom fields, web forms, reports |
| Ganit | गणित | /ganit | Done | GST invoicing — CGST/SGST/IGST, HSN, e-invoicing |
| Manav | मानव | /manav | Done | HRMS — employees, attendance, leave management |
| Vikray | विक्रय | /vikray | Done | Sales — pipeline, quotations, orders, fulfilment |
| Vetana | वेतन | /vetana | Done | Payroll — salary, PF/ESI/TDS, payslips |
| Dristi | दृष्टि | /dristi | Done | Analytics — dashboards, reports, export |
| Prachar | प्रचार | /prachar | Done | Marketing — campaigns, email, automation |
| Sanvaad | संवाद | — | **Not started** | WhatsApp — Business API, templates, broadcasts |
| Pahchan | पहचान | — | **Not started** | Biometric — face/fingerprint, geo-fenced attendance |

---

## Remaining Work (2 items)

### 1. Sanvaad (संवाद) — WhatsApp Module
- WhatsApp Business API integration
- Message templates (HSM)
- Broadcast campaigns
- Two-way messaging
- Per-client WhatsApp Business Account

### 2. Pahchan (पहचान) — Biometric Module
- Face recognition attendance
- Fingerprint integration
- Geo-fenced check-in/check-out
- Integration with Manav (HRMS) attendance

---

## Infrastructure

### Current Stack & Costs
| Service | Provider | Cost/mo | Notes |
|---------|----------|---------|-------|
| Backend | Railway Hobby | $5 (credit) | 2 workers, ~$1.70 actual usage |
| Database | Supabase Free | $0 | Used as pure Postgres only |
| Frontend | Vercel Free | $0 | React SPA, CDN-served |
| File Storage | Cloudflare R2 | $0 | Per-client accounts |
| AI Generation | OpenRouter | $5-15 | Smart routing, mostly free models |
| Web Search | Gemini API | $0 | Chatbot grounding, 1,500 req/day free |
| **TOTAL** | | **$10-20** | For 6 clients, 40 peak users |

### Optimizations Applied (2026-07-12)
- Gunicorn workers: 4 → 2 (saves ~170 MB RAM)
- asyncpg pool: min=3/max=15 → min=1/max=8 (saves connections)
- WEB_CONCURRENCY env var for tuning without redeploy
- AI routing: free models first, premium only when needed

### Pending Infra Tasks
- [ ] Set `GEMINI_API_KEY` in Railway dashboard
- [ ] Set `SENTRY_DSN` in Railway dashboard
- [ ] Migrate database from Supabase → Neon (connection string swap)

---

## Security
All Phase 1–6 vulnerabilities resolved (commit 212f867, 2026-06-21). See `security_issues.md` in memory for full list.

Key conventions:
- Email templates: always wrap user vars with `_h()` (html.escape)
- Auth endpoints: always apply `@limiter.limit()` decorator
- Background tasks: always use `_bg(coro, label=)`, never bare `asyncio.create_task()`

---

## CI/CD
- **GitHub Actions:** Python import smoke test + `tsc --noEmit` on push/PR
- **Railway:** Auto-deploys from `main` branch
- **Vercel:** Auto-deploys from GitHub (preview on branch, production on main)
