# Kartavya — Srijan Skills Integration Plan

> All 28 new agent skills live inside Srijan's existing skill system — no parallel infrastructure

## Why Inside Srijan?

Srijan already has: `hub_skill_templates` → `hub_client_skills` → `hub_skill_runs`
- Run history, credit billing, approval workflow — all built
- Users already go to Srijan for AI features
- Building a separate Python-only skill layer = double maintenance, confusing UX

## Skill Types (4 categories)

| Type | Count | Cost | Executor |
|------|-------|------|----------|
| **content** (existing) | 9+ templates | Credits | `ai_router.generate()` |
| **automation** (new) | 17 skills | Free | Python function via `skill_dispatcher.py` |
| **detection** (new) | 8 skills | Free | Python function, self-learning |
| **analysis** (new) | 5 skills | Credits | `ai_router.generate()` with structured input |

## Database Changes

### Extend `hub_skill_templates`

```sql
ALTER TABLE staging.hub_skill_templates
  ADD COLUMN skill_type text NOT NULL DEFAULT 'content'
    CHECK (skill_type IN ('content', 'automation', 'detection', 'analysis')),
  ADD COLUMN scope text NOT NULL DEFAULT 'client'
    CHECK (scope IN ('client', 'org')),
  ADD COLUMN module text DEFAULT NULL,
  ADD COLUMN trigger_config jsonb DEFAULT NULL,
  ADD COLUMN is_system bool DEFAULT FALSE;
```

### Allow org-level skills

```sql
ALTER TABLE staging.hub_client_skills
  ADD COLUMN org_id uuid DEFAULT NULL,
  ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE staging.hub_client_skills
  ADD CONSTRAINT client_or_org CHECK (client_id IS NOT NULL OR org_id IS NOT NULL);
```

### Self-learning feedback table

```sql
CREATE TABLE staging.hub_skill_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_template_id uuid REFERENCES staging.hub_skill_templates(id),
  org_id uuid NOT NULL,
  input_hash text,
  predicted jsonb,
  corrected jsonb,
  accepted bool DEFAULT TRUE,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_skill_feedback_lookup
  ON staging.hub_skill_feedback(skill_template_id, org_id, created_at DESC);
```

## Backend: Skill Dispatcher

New file: `backend/services/skill_dispatcher.py`

```python
SKILL_REGISTRY = {
    # automation skills — free
    "overdue_invoice_reminder": ("action.overdue_finder", "find_overdue", {"module": "invoice"}),
    "recurring_invoice_gen":    ("action.recurring_invoice_generator", "generate_due_invoices", {}),
    "campaign_scheduler":       ("action.campaign_sender", "send_due_campaigns", {}),
    "attendance_auto_mark":     ("action.attendance_auto_mark", "mark_holidays_weekends", {}),
    "low_stock_alert":          ("data.stock_scanner", "find_low_stock", {}),
    "deadline_escalation":      ("data.deadline_scanner", "scan_upcoming_deadlines", {}),
    # ... 11 more automation skills

    # detection skills — free, self-learning
    "anomaly_detector":         ("detect.anomaly_detector", "detect_anomalies", {}),
    "expense_policy_checker":   ("detect.expense_policy_checker", "check_policy", {}),
    "reconciliation_matcher":   ("detect.reconciliation_matcher", "fuzzy_match", {}),
    # ... 5 more detection skills

    # analysis skills — LLM, credits
    "text_to_task":             ("nlp.text_to_task", "parse_task", {}),
    "email_drafter":            ("nlp.email_drafter", "draft_email", {}),
    "kpi_narrator":             ("nlp.kpi_narrator", "narrate_kpis", {}),
    # ... 2 more analysis skills
}

async def dispatch_skill(pool, skill_template, variables, org_id, user_id):
    """Universal executor. Routes to Python function (free) or LLM (credits)."""
    for step in sorted(skill_template["steps"], key=lambda s: s.get("order", 0)):
        if step.get("skill_function"):
            # Deterministic: registered Python function
            module_path, fn_name, defaults = SKILL_REGISTRY[step["skill_function"]]
            mod = importlib.import_module(f"services.skills.{module_path}")
            fn = getattr(mod, fn_name)
            result = await fn(pool, org_id, **{**defaults, **variables})
            # Apply self-learning adjustments from past feedback
            feedback = await _get_recent_feedback(pool, skill_template["id"], org_id)
            if feedback:
                result = _apply_learned_adjustments(result, feedback)
        else:
            # LLM: existing ai_router.generate()
            result = await generate(prompt=step["prompt_template"], ...)
```

## Cron: One Endpoint for All Skills

```python
@router.post("/cron/skills")
async def run_due_skills():
    """Called every 5 min. Finds skills with trigger_config.type='cron'
    whose next_run_at <= NOW()."""
    pool = await get_pool()
    due = await pool.fetch("""
        SELECT cs.*, t.steps, t.skill_type, t.name
        FROM staging.hub_client_skills cs
        JOIN staging.hub_skill_templates t ON t.id = cs.template_id
        WHERE cs.is_active = TRUE
          AND t.trigger_config->>'type' = 'cron'
          AND (cs.last_run_at IS NULL
               OR cs.last_run_at + (t.trigger_config->>'interval')::interval <= NOW())
    """)
    for skill in due:
        asyncio.create_task(dispatch_skill(pool, dict(skill), {}, skill["org_id"], "system"))
    return {"triggered": len(due)}
```

Replaces the need for 8 separate `/cron/invoices`, `/cron/crm`, `/cron/hr`, etc.

## System-Seeded Skills

On org creation, seed `hub_skill_templates` with 17 system skills (`is_system=TRUE`). Users can enable/disable but not delete.

| Module | Skills Seeded |
|--------|---------------|
| Ganit | Overdue Invoice Reminder, Recurring Invoice Generator, Expense Categorizer, Reconciliation Matcher |
| Graha | Deal Stale Alert, Follow-up Reminder, Contact Dedup |
| Manav | Attendance Auto-Mark, Leave Balance Allocator, Shift Auto-Scheduler, Onboarding Chain |
| Vetana | Payroll Trigger, Payslip Delivery |
| Prachar | Campaign Scheduler, Sequence Step Runner |
| PM | Deadline Escalation, Auto-Archive Tasks |
| Vikray | Low Stock Alert |
| Dristi | Report Scheduler |
| E-Sign | E-Sign Reminder |

## Srijan UI Changes

The Skills tab in Srijan gets 4 category tabs:

1. **Content** — existing social/email/blog templates (unchanged)
2. **Automation** — 17 rule-based skills, free, toggle on/off per org
3. **Detection** — 8 pattern/scoring skills, shows accuracy trend + correction count
4. **Analysis** — 5 LLM skills, credits charged, shows learning progress

Each skill card shows: name, module, trigger type (cron/event/manual), last run, success rate, and learning indicator.

## Self-Learning Flow

```
Skill predicts → User sees result → User corrects → hub_skill_feedback row
→ Next run queries feedback first → Adjusted prediction
```

In Srijan UI: each learning skill shows "Corrections" count and "Accuracy" trend.

## File Structure

```
backend/services/
├── skill_dispatcher.py          # NEW — universal skill router
└── skills/
    ├── __init__.py
    ├── data/                    # 7 query skills
    ├── detect/                  # 6 pattern skills (4 self-learning)
    ├── action/                  # 10 execution skills
    └── nlp/                     # 5 LLM skills (3 self-learning)
```
