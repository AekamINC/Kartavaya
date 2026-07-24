# Kartavya — Skills Architecture

> 42 skills total: 14 already exist + 28 new to build
> 8 skills are self-learning (no LLM needed — feedback table + SQL lookup)
> 5 skills use LLM (OpenRouter)

## Concept: Agent vs Skill

- **Agent** = orchestrator. Decides WHAT to do based on triggers/events. Has a goal.
- **Skill** = executor. Does ONE thing well. Stateless, composable, testable.
- **Self-learning** = skill stores outcomes and adapts. Predict → act → user corrects → store → adjust next prediction.

## Existing Skills (14 services already built)

| Service | Category | What It Does |
|---------|----------|--------------|
| `contact_dedupe` | DETECT | Trigram similarity + normalized phone/email dedup |
| `lead_parser` | DATA | Regex extraction from IndiaMART/JustDial emails |
| `ai_router` | NLP | Multi-provider LLM routing with cost tracking |
| `rag` | DATA | Cosine similarity search over pgvector embeddings |
| `automation_engine` | ACTION | Evaluate rules on events, 6 action types |
| `employee_email` | ACTION | HR notification emails (leave, expense, announcement) |
| `reminder_service` | ACTION | Cross-module due reminder scanner |
| `activity_logger` | DATA | Audit trail for all mutations |
| `mentions` | ACTION | @mention parsing + notification fan-out |
| `invoice_pdf` / `payslip_pdf` / `cost_report_pdf` | ACTION | WeasyPrint PDF generation |
| `report_generator` | ACTION | 5-page editorial PDF + Excel reports |
| `social_publisher` | ACTION | Publish to 13 platforms via OAuth |
| `push_service` / `web_push` / `expo_push` | ACTION | Push notifications (Web, Expo, internal) |
| `storage` | ACTION | S3/R2 file upload + presigned URLs |

## New Skills to Build (28)

### Data & Query Skills (7)

| Skill | Signature | Used By |
|-------|-----------|---------|
| `workload_calculator` | `get_team_workload(pool, team_id) → dict[user_id, {open, due_soon, overdue, capacity_pct}]` | Workload Agent, Shift Scheduler |
| `deadline_scanner` | `scan_upcoming_deadlines(pool, team_id, horizon_hours=48) → list[task]` | Deadline Agent |
| `overdue_finder` | `find_overdue(pool, org_id, module, days_overdue=0) → list[entity]` | Invoice, Follow-up, E-Sign, Deadline agents |
| `leave_conflict_checker` | `check_dept_coverage(pool, org_id, dept, start, end) → {pct, blocked}` | Leave Balance Agent |
| `kpi_aggregator` | `aggregate_kpis(pool, org_id, period='30d') → {revenue, deals_won, ...}` | Insight Narrator, Report Agent |
| `stock_scanner` | `find_low_stock(pool, org_id) → list[{item, quantity, threshold}]` | Low Stock Alert Agent |
| `schedule_gap_finder` | `find_coverage_gaps(pool, org_id, week) → list[{date, shift, gap}]` | Shift Auto-Scheduler |

### Detection & Pattern Skills (6)

| Skill | Self-Learning? | Used By |
|-------|---------------|---------|
| `anomaly_detector` | Yes — adjusts σ threshold from false-positive dismissals | Narrator, Attendance, Ad Insights |
| `attendance_pattern` | No | Attendance Agent |
| `deal_health_scorer` | Yes — recalculates stage thresholds from closed deal outcomes | Deal Stale Agent |
| `expense_policy_checker` | Yes — auto-approves after 3+ admin overrides for same pattern | Expense Categorizer |
| `reconciliation_matcher` | Yes — builds vendor→payment behavior map from accept/reject | Reconciliation Agent |
| `candidate_scorer` | Yes — adjusts scoring weights from hire + retention outcomes | Onboarding Agent |

### Action & Execution Skills (10)

| Skill | Description | Used By |
|-------|-------------|---------|
| `escalation_chain` | Multi-level: L1=assignee, L2=manager, L3=org admin | Deadline, Follow-up, Invoice agents |
| `notification_fan_out` | Unified push + email + in-app with dedup | All alerting agents |
| `sequence_step_executor` | Execute one Prachar sequence step (email/WhatsApp) | Campaign Scheduler |
| `campaign_sender` | Resolve audience, filter unsubs, batch send, transition status | Campaign Scheduler |
| `leave_balance_manager` | Year-start allocation + carry-forward batch | Leave Balance Agent |
| `onboarding_chain` | Chain: balances → assets → welcome email → task checklist | Onboarding Agent |
| `recurring_invoice_generator` | Clone template into new invoice, advance next_date | Recurring Invoice Agent |
| `shift_auto_assign` | Greedy fill: preference + availability + fairness | Shift Auto-Scheduler |
| `attendance_auto_mark` | Mark holidays/weekends for all employees | Attendance Agent |
| `document_expiry` | Remind at 3/7/14 days, auto-expire past deadline | E-Sign Reminder |

### NLP & Generation Skills (5) — LLM-powered via OpenRouter

| Skill | Model Tier | Self-Learning? | Used By |
|-------|-----------|---------------|---------|
| `text_to_task` | Scout ($0.15/M) | Yes — user corrections become few-shot examples | Intake Agent |
| `email_drafter` | Maverick ($0.50/M) | Yes — learns user editing patterns (length, tone, greeting) | Comms Agent |
| `kpi_narrator` | Scout ($0.15/M) | No | Insight Narrator |
| `campaign_copywriter` | Maverick ($0.50/M) | No | Campaign Content Agent |
| `text_classifier` | Scout ($0.15/M) | Yes — corrections become few-shot training data | Expense Categorizer, Intake priority |

## Self-Learning Database Tables

One migration creates all 8 feedback tables:

```sql
CREATE TABLE skill_expense_overrides (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, category text, amount numeric, override_reason text, created_at timestamptz DEFAULT now());
CREATE TABLE skill_recon_feedback (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, vendor text, match_type text, accepted bool, payment_pattern jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE skill_task_corrections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, input_text text, predicted jsonb, corrected jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE skill_email_edits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, draft_hash text, patterns jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE skill_classification_feedback (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, taxonomy text, input_text text, predicted text, corrected text, created_at timestamptz DEFAULT now());
CREATE TABLE skill_anomaly_feedback (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, metric text, was_true bool, created_at timestamptz DEFAULT now());
CREATE TABLE skill_deal_outcomes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, deal_id uuid, predicted_health text, actual_outcome text, created_at timestamptz DEFAULT now());
CREATE TABLE skill_hire_outcomes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, candidate_id uuid, predicted_score numeric, hired bool, retained_6mo bool, created_at timestamptz DEFAULT now());
```

## File Structure

```
backend/services/skills/
├── __init__.py
├── data/
│   ├── workload_calculator.py
│   ├── deadline_scanner.py
│   ├── overdue_finder.py
│   ├── leave_conflict_checker.py
│   ├── kpi_aggregator.py
│   ├── stock_scanner.py
│   └── schedule_gap_finder.py
├── detect/
│   ├── anomaly_detector.py
│   ├── attendance_pattern.py
│   ├── deal_health_scorer.py
│   ├── expense_policy_checker.py
│   ├── reconciliation_matcher.py
│   └── candidate_scorer.py
├── action/
│   ├── escalation_chain.py
│   ├── notification_fan_out.py
│   ├── sequence_step_executor.py
│   ├── campaign_sender.py
│   ├── leave_balance_manager.py
│   ├── onboarding_chain.py
│   ├── recurring_invoice_generator.py
│   ├── shift_auto_assign.py
│   ├── attendance_auto_mark.py
│   └── document_expiry.py
└── nlp/
    ├── text_to_task.py
    ├── email_drafter.py
    ├── kpi_narrator.py
    ├── campaign_copywriter.py
    └── text_classifier.py
```

## Agent → Skill Composition Examples

**Overdue Invoice Agent** (daily cron):
`overdue_finder` → `escalation_chain` → `notification_fan_out` → `activity_logger`

**Intake Agent** (on new message):
`text_to_task` → `contact_dedupe` → `workload_calculator` → `automation_engine`

**Campaign Scheduler** (5min cron):
`overdue_finder` → `campaign_sender` → `sequence_step_executor` → `activity_logger`

**Insight Narrator** (weekly):
`kpi_aggregator` → `anomaly_detector` → `kpi_narrator` → `report_generator`
