# Kartavya AI Agent Architecture — Implementation Plan & Handoff

## Overview

Add AI automation to Kartavya via **12 agents** (8 deterministic + 4 LLM-powered), **RAG upgrades**, and an **evals framework**. All work branches from `staging`.

**Core principle:** If the input is structured data and the logic can be expressed as rules, use a deterministic agent (zero API cost). LLM is only for when a human wrote free-text and you need to understand or generate natural language.

---

## Current State (as of 24 Jul 2026)

### What staging already has
- `backend/services/ai_router.py` (667 lines) — OpenRouter multi-provider routing with Gemini/Groq/Qwen fallbacks
- `backend/services/rag.py` (172 lines) — RAG pipeline with pgvector (768-dim Gemini embeddings), sentence-aware chunking, cosine similarity search
- `backend/routers/hub_chat.py` — Chatbot with RAG-grounded answers
- `backend/routers/hub.py` (2023 lines) — AI content generation (social, blog, email, ads, WhatsApp, proposals)
- AI image generation with 4-provider fallback cascade
- Credit billing system (INR) with cost tracking per generation
- `backend/services/automation_engine.py` — Rule-based automation (6 action types)
- `backend/services/activity_logger.py` — Event stream logging all mutations

### What's missing (this plan covers)
- No evals for any AI feature
- No multi-agent orchestration
- RAG missing: hybrid search, re-ranking, citations, hallucination guard, incremental re-indexing
- AI siloed in Hub/Srijan — CRM (Graha), Accounting (Ganit), HRMS (Manav) have no AI

---

## Architecture: The Agent Split

### Deterministic Agents (8) — Pure Python/SQL, zero API cost

| Agent | Trigger | What it does | Key files it reads |
|-------|---------|-------------|-------------------|
| **Status** | Daily cron 8 AM IST | Queries overdue/stale/ready-to-close tasks via SQL | tasks, subtasks |
| **Deadline** | Hourly cron | Due in 24h → warn, 1h → urgent, past → escalate | tasks.due_date |
| **Finance** | New expense/vendor bill | Vendor→category lookup, anomaly detection (2x avg), duplicate check | Ganit tables |
| **Workload** | Task assigned/estimate changed | SUM hours per person, flag >40h/week, suggest rebalancing | time_entries, Manav employees |
| **Dedupe** | New contact in Graha | pg_trgm similarity on name, exact match email/phone | Graha contacts |
| **Review** | Task status → "done" | Check subtasks complete, required fields filled, time logged | tasks, field_values, time_entries |
| **Reminder** | Cron every 15 min | Process task_reminders, nudge stale approvals (>48h), follow-up | task_reminders, approvals |
| **Report** | Weekly cron or manual | SQL aggregation: tasks/hours/revenue/pipeline → structured JSON | all modules |

**Self-learning:** Deterministic agents improve from user corrections, not LLMs. Example: Finance Agent stores vendor→category mappings when users override suggestions (`vendor_category_rules` table).

### LLM Agents (4) — OpenRouter, only for natural language

| Agent | Trigger | Why LLM needed | Model tier |
|-------|---------|---------------|------------|
| **Intake** | New client message/approval request | Free-text → structured tasks. Rules can't parse natural language variety. | Maverick ($0.50/M) |
| **Planning** | Complex task approved (>1 para desc) | Creative subtask decomposition from prose description | Sonnet ($3/M) |
| **Comms** | Weekly cron or manual | Structured data → polished client email. Templates = robotic. | Sonnet ($3/M) |
| **Triage** | New task/support with free-text | Priority/category classification from natural language | Scout ($0.15/M) |

**LLM agents are simple:** prompt → structured JSON output → Pydantic validate → act. No tool-use loops, no LangChain. ~150 lines for the runner.

---

## Week 1 Sprint Plan (28 Jul – 1 Aug)

### Monday 28 Jul — Foundation
- [ ] Create `backend/services/agents/` directory structure with `__init__.py`, `base.py`, `orchestrator.py` shell
- [ ] Migration 051: IVFFlat index on embeddings, tsvector GIN index on chunk_text, `indexed_at` column
- [ ] Modify `services/rag.py` → add hybrid search (0.7*cosine + 0.3*ts_rank blend)
- [ ] Modify `services/rag.py` → add project_id, content_type, date_from/to metadata filters to `search_knowledge()`
- [ ] Create `backend/evals/` scaffold: conftest.py, scorers.py (F1, Recall@K, MRR, LLM-judge), runner.py shell

### Tuesday 29 Jul — RAG Quality
- [ ] Create `services/ai/reranker.py` — top-20 → Scout scores relevance 1-10 → top-5. Wire into rag.py
- [ ] Update chatbot system prompt in hub_chat.py: cite sources as [1][2], "I don't know" for unsupported claims. Post-gen: verify cited chunk IDs exist
- [ ] Create `services/ai/chunker.py` — content-type strategies: tasks as units, docs as paragraphs, comments by thread
- [ ] Create `evals/datasets/rag_retrieval.json` — 30 question→relevant_chunk_ids pairs

### Wednesday 30 Jul — First Agents + Re-indexing
- [ ] Create `services/ai/embed_worker.py` — hook into activity_logger, queue re-embed on mutations, nightly catch-up
- [ ] Create `services/agents/status_agent.py` — SQL: overdue (due_date < NOW()), stale (no update 3+ days), ready-to-close (all subtasks done)
- [ ] Create `services/agents/deadline_agent.py` — hourly cron, priority-aware warning tiers
- [ ] Create `evals/test_rag_answers.py` — faithfulness scoring, citation verification, unanswerable detection (20 cases)

### Thursday 31 Jul — More Agents + Orchestrator
- [ ] Create `services/agents/review_agent.py` — completeness checklist on status→done
- [ ] Create `services/agents/workload_agent.py` — capacity calc from Manav + time_entries
- [ ] Create `services/agents/orchestrator.py` — event_type → agent_class mapping, asyncio background tasks, agent_runs table
- [ ] Create `evals/test_status_agent.py`, `test_deadline_agent.py` — mock DB states, edge cases

### Friday 1 Aug — First LLM Agent
- [ ] Create `services/agents/llm_runner.py` — shared runner: prompt → structured JSON → validate
- [ ] Create `services/agents/intake_agent.py` — free-text → tasks, Graha contact linking
- [ ] Create `evals/datasets/intake_extraction.json` — 20 client emails → expected tasks (incl. Hindi, multi-task)
- [ ] Create `evals/test_intake_agent.py` — F1 on extracted fields
- [ ] Integration test: event → orchestrator → agent → output. Run full eval suite. Push + PR.

### Week 2 Preview (4–8 Aug)
- Remaining deterministic agents: Finance, Dedupe, Reminder, Report
- Remaining LLM agents: Planning, Comms, Triage
- Model comparison evals
- `/api/agents/*` router for manual trigger, run history, config
- End-to-end integration across Graha → Tasks → Ganit pipeline

---

## File Structure to Create

```
backend/
├── services/
│   ├── ai/
│   │   ├── reranker.py          # LLM-based re-ranking (Scout model)
│   │   ├── chunker.py           # Content-type-specific chunking
│   │   └── embed_worker.py      # Incremental re-indexing worker
│   └── agents/
│       ├── __init__.py
│       ├── base.py              # BaseAgent class
│       ├── orchestrator.py      # Event → agent routing
│       ├── llm_runner.py        # Shared LLM agent runner (~150 lines)
│       ├── status_agent.py      # [RULE] Overdue/stale detection
│       ├── deadline_agent.py    # [RULE] Time-based escalation
│       ├── finance_agent.py     # [RULE] Expense categorization
│       ├── workload_agent.py    # [RULE] Capacity tracking
│       ├── dedupe_agent.py      # [RULE] Contact deduplication
│       ├── review_agent.py      # [RULE] Task completeness check
│       ├── reminder_agent.py    # [RULE] Scheduled reminders
│       ├── report_agent.py      # [RULE] SQL aggregation
│       ├── intake_agent.py      # [LLM] Free-text → tasks
│       ├── planning_agent.py    # [LLM] Task → subtasks
│       ├── comms_agent.py       # [LLM] Data → client email
│       └── triage_agent.py      # [LLM] Text → priority/category
├── routers/
│   └── agents.py                # /api/agents/* endpoints
├── migrations/
│   └── 051_rag_agents.py        # pgvector indexes, agent_runs table
└── evals/
    ├── conftest.py
    ├── runner.py
    ├── scorers.py
    ├── datasets/
    │   ├── rag_retrieval.json
    │   ├── rag_answers.json
    │   └── intake_extraction.json
    ├── test_rag_retrieval.py
    ├── test_rag_answers.py
    ├── test_intake_agent.py
    ├── test_status_agent.py
    └── test_deadline_agent.py
```

## Files to Modify

| File | Changes |
|------|---------|
| `services/rag.py` | Add hybrid search (tsvector blend), metadata filters, citation output |
| `services/activity_logger.py` | Add embedding queue hook after logging mutations |
| `routers/hub_chat.py` | Update system prompt for citations + hallucination guard |
| `server.py` | Mount agents router, register cron jobs for Status/Deadline/Reminder agents |
| `requirements.txt` | Add: `numpy`, `tiktoken` (pgvector + httpx already present) |

## Key Decisions Made

1. **No LangChain** — lightweight runner with httpx + OpenRouter tool-use API
2. **No new infra** — pgvector in existing Postgres, agents run as asyncio tasks
3. **Only 2 new deps** — numpy (vector ops), tiktoken (token counting). httpx already exists.
4. **Human-in-the-loop** — agents create drafts, not final actions. Owner approves via existing approval pipeline.
5. **Deterministic first** — rule-based agents are faster, cheaper, more reliable, and auditable.
6. **Cost** — estimated ~$2.45/month for LLM agents (10-person team, 500 tasks/month). Deterministic agents = $0.

## Database Tables to Add (Migration 051)

```sql
-- Upgrade existing pgvector setup
CREATE INDEX IF NOT EXISTS idx_kb_chunks_fts
  ON staging.hub_kb_chunks USING gin (to_tsvector('english', chunk_text));

ALTER TABLE staging.hub_kb_chunks ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ;

-- Agent run history
CREATE TABLE IF NOT EXISTS staging.agent_runs (
    id            BIGSERIAL PRIMARY KEY,
    agent_name    TEXT NOT NULL,
    agent_type    TEXT NOT NULL,  -- 'rule' or 'llm'
    trigger_event TEXT,
    context       JSONB DEFAULT '{}',
    result        JSONB DEFAULT '{}',
    status        TEXT DEFAULT 'running',  -- running, completed, failed
    tokens_used   INT DEFAULT 0,
    cost_usd      NUMERIC(10,6) DEFAULT 0,
    duration_ms   INT,
    team_id       TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Finance agent self-learning
CREATE TABLE IF NOT EXISTS staging.vendor_category_rules (
    vendor_name   TEXT PRIMARY KEY,
    category_id   TEXT NOT NULL,
    confidence    NUMERIC(3,2) DEFAULT 0.5,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Embedding queue for incremental re-indexing
CREATE TABLE IF NOT EXISTS staging.embed_queue (
    id            BIGSERIAL PRIMARY KEY,
    content_type  TEXT NOT NULL,
    content_id    TEXT NOT NULL,
    team_id       TEXT NOT NULL,
    action        TEXT DEFAULT 'upsert',  -- upsert or delete
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    processed_at  TIMESTAMPTZ
);
```

## Artifacts Created This Session

- **Architecture plan** (artifact): 12-agent split with cost comparison, RAG gap analysis, full file structure
- **Weekly sprint plan** (artifact): Day-by-day breakdown for Week 1 (28 Jul – 1 Aug), 20 tasks, ~38 hours
- Both published to claude.ai/code/artifacts under this user's account
