# Kartavya — Module-by-Module Agent & Automation Plan

> 28 agents total: 21 deterministic (zero API cost) + 7 LLM-powered (OpenRouter)
> Generated from full staging codebase audit on 2026-07-24

## PM / Tasks (Core) — 5 agents

| Agent | Type | Description |
|-------|------|-------------|
| Status Agent | DET | Auto-transition status on subtask completion, approval outcomes, overdue |
| Deadline Agent | DET+CRON | Proactive warnings at 48h/24h/overdue with escalation chain |
| Workload Agent | DET | Balance assignments by counting open tasks per assignee |
| Intake Agent | LLM | Parse free-text into structured tasks (title, priority, category) |
| Auto-Archive Agent | DET+CRON | Archive completed tasks >N days old (endpoint exists, needs cron) |

**Gaps found:** `auto_archive_tasks` exists but manual. `automation_engine.py` has `change_status` action but no subtask-completion trigger. `reminder_service.py` sends reminders but no escalation.

## Graha · CRM — 4 agents

| Agent | Type | Description |
|-------|------|-------------|
| Deal Stale Agent | DET+CRON | Detect deals stuck >14 days in a stage |
| Follow-up Agent | DET+CRON | Auto-remind on overdue follow-ups |
| Dedup Agent | DET | Normalize contacts on import (phone/email/company) |
| Comms Agent | LLM | Generate personalized client emails from deal context |

**Gaps found:** `deal_stale` and `followup_overdue` triggers defined but never fired (dead code). `send_notification` action has no implementation. Web form dedup uses raw equality.

## Ganit · Accounting — 4 agents

| Agent | Type | Description |
|-------|------|-------------|
| Overdue Invoice Agent | DET+CRON | Detect overdue invoices, send reminders at 7/14/30 days |
| Recurring Invoice Agent | DET+CRON | Auto-generate from recurring templates (endpoint exists, needs cron) |
| Expense Categorizer | DET | Auto-categorize by vendor history, self-learning from corrections |
| Smart Reconciliation | DET | Fuzzy-match bank transactions (date window, partial amount, ref extraction) |

**Gaps found:** No overdue detection. Recurring invoices manual only. Bank reconciliation is exact-match only. No expense auto-categorization.

## Vikray · Sales — 2 agents

| Agent | Type | Description |
|-------|------|-------------|
| Low Stock Alert | DET+CRON | Alert when quantity <= low_stock_threshold |
| Order-to-Invoice | DET | Auto-create Ganit invoice on order confirmation |

**Gaps found:** `low_stock_threshold` column exists but never checked proactively.

## Vetana · Payroll — 2 agents

| Agent | Type | Description |
|-------|------|-------------|
| Payroll Scheduler | DET+CRON | Auto-trigger monthly payroll run on configured date |
| Payslip Delivery | DET | Auto-email PDF payslips after approval |

**Gaps found:** Payroll requires manual `POST /payroll/run`.

## Manav · HRMS — 4 agents

| Agent | Type | Description |
|-------|------|-------------|
| Attendance Agent | DET+CRON | Auto-mark holidays/weekends, detect late patterns |
| Leave Balance Agent | DET+CRON | Year-start allocation, carry-forward, conflict blocking |
| Onboarding Agent | DET | Candidate hired → employee + leave balances + welcome email + asset checklist |
| Shift Auto-Scheduler | DET | Generate weekly schedules from availability + preferences |

**Gaps found:** Attendance 100% manual. No year-start batch for leave balances (created on-the-fly). No onboarding chain after `POST /candidates/{id}/hire`. No auto-scheduling.

## Prachar · Marketing — 3 agents

| Agent | Type | Description |
|-------|------|-------------|
| Campaign Scheduler | DET+CRON | Send campaigns on `scheduled_at`, process sequence `next_step_at` |
| Prachar Automation Engine | DET | Execute stored trigger/action configs (currently dead config) |
| Campaign Content Agent | LLM | Generate subject lines, body copy, A/B variants |

**Gaps found:** CRITICAL — `scheduled_at` on campaigns and `next_step_at` on sequences are stored but NO worker processes them. `prachar_automations` table has trigger/action config but NO execution engine. These are dead features.

## Dristi · Analytics — 2 agents

| Agent | Type | Description |
|-------|------|-------------|
| Scheduled Report Agent | DET+CRON | Execute reports on configured frequency (daily/weekly/monthly) |
| Insight Narrator | LLM | Natural-language KPI summaries with trend analysis |

**Gaps found:** `dristi_scheduled_reports` stores full schedule config but NO executor. `run-now` endpoint works but nothing polls the table.

## Hub · AI Content — 1 agent

| Agent | Type | Description |
|-------|------|-------------|
| Feedback Learning Agent | DET | Track user edits to AI output, feed correction patterns back into prompts |

## E-Sign — 1 agent

| Agent | Type | Description |
|-------|------|-------------|
| Signing Reminder Agent | DET+CRON | Auto-remind pending signers at 3/7/14 days, expire past deadline |

---

## Cross-Module Infrastructure

### Automation Engine v2
Expand `automation_engine.py` beyond task-only events:
- **New events:** `deal_stage_changed`, `invoice_overdue`, `leave_requested`, `campaign_sent`, `expense_submitted`, `candidate_stage_changed`
- **New actions:** `create_task`, `update_deal`, `enroll_sequence`, `create_invoice`, `webhook`
- **Extended filters:** Add `gt`, `lt`, `contains`, `date_before`, `date_after` operators

### Unified Cron Scheduler
Expand `scheduler.py` (currently 3 endpoints) with 8 new cron jobs:
- `/cron/invoices` — daily: overdue + recurring
- `/cron/crm` — daily: stale deals + overdue follow-ups
- `/cron/hr` — daily: attendance auto-mark + shift bid closure
- `/cron/marketing` — 5min: campaign scheduler + sequence processor
- `/cron/reports` — hourly: scheduled report executor
- `/cron/esign` — daily: signing reminders + document expiry
- `/cron/stock` — daily: low stock alerts
- `/cron/payroll` — monthly: payroll run trigger

### RAG Upgrades
- Hybrid search (pgvector cosine + tsvector full-text)
- Re-ranking with cross-encoder
- Citations with chunk source/section
- Metadata pre-filtering (module, team, date)
- Incremental re-indexing on document updates

### Evals Framework
- Pytest-based, runs in CI on PRs touching `backend/services/ai/`
- Intake Agent: F1 on field extraction
- Comms Agent: LLM-as-judge scoring
- RAG: Recall@K, MRR on curated Q&A pairs
- Threshold: ≥0.8 to merge

---

## Implementation Priority

**Week 1 — Critical Infrastructure:** Unified cron, campaign scheduler (prachar dead features), overdue/recurring invoices, wire stale deal/follow-up triggers

**Week 2 — HR & Core PM:** Attendance auto-mark, leave balance allocation, deadline escalation, low stock alerts, e-sign reminders

**Week 3 — Intelligence Layer:** Automation engine v2, expense categorizer, scheduled reports, onboarding chain

**Week 4 — LLM Agents + Evals:** Intake/Comms/Narrator agents, RAG upgrades, evals framework with CI
