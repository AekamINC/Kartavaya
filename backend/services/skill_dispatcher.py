"""
skill_dispatcher.py — Universal skill dispatcher for Srijan Skills.

Routes skill steps to Python functions or LLM generation.
Supports self-learning via hub_skill_feedback corrections.
"""
import hashlib
import json
import logging
import time
import uuid
from typing import Any, Optional

from db import get_pool

log = logging.getLogger(__name__)


# ── Skill Registry ──────────────────────────────────────────
# Maps skill_function name → (module_path, function_name, default_params)
# Actual handler functions are stubs that will be implemented per module.
SKILL_REGISTRY: dict[str, tuple[str, str, dict]] = {
    # Ganit
    "ganit_overdue_invoices":    ("services.skills.ganit",   "detect_overdue_invoices",   {"days_overdue": 7}),
    "ganit_recurring_invoices":  ("services.skills.ganit",   "generate_recurring_invoices", {}),
    "ganit_categorize_expenses": ("services.skills.ganit",   "categorize_expenses",       {}),
    # Manav
    "manav_auto_mark_attendance":("services.skills.manav",   "auto_mark_attendance",      {}),
    "manav_sync_leave_balances": ("services.skills.manav",   "sync_leave_balances",       {}),
    "manav_schedule_shifts":     ("services.skills.manav",   "schedule_shifts",           {}),
    "manav_onboarding_checklist":("services.skills.manav",   "create_onboarding_checklist", {}),
    # Vetana
    "vetana_trigger_payroll":    ("services.skills.vetana",   "trigger_payroll",           {}),
    "vetana_deliver_payslips":   ("services.skills.vetana",   "deliver_payslips",          {}),
    # Vikray
    "vikray_low_stock_alert":    ("services.skills.vikray",   "low_stock_alert",           {}),
    # Graha
    "graha_stale_deals":         ("services.skills.graha",    "detect_stale_deals",        {"stale_days": 14}),
    "graha_followup_reminders":  ("services.skills.graha",    "create_followup_reminders", {"inactive_days": 30}),
    "graha_contact_dedup":       ("services.skills.graha",    "scan_duplicate_contacts",   {}),
    # PM
    "pm_deadline_escalation":    ("services.skills.pm",       "escalate_deadlines",        {}),
    "pm_auto_archive":           ("services.skills.pm",       "auto_archive_completed",    {"days_completed": 90}),
    # Dristi
    "dristi_scheduled_reports":  ("services.skills.dristi",   "run_scheduled_reports",     {}),
    # Prachar
    "prachar_campaign_scheduler":("services.skills.prachar",  "schedule_campaigns",        {}),
}


def _hash_input(variables: dict) -> str:
    """Deterministic hash of input variables for feedback lookup."""
    raw = json.dumps(variables, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


async def _get_feedback_corrections(
    pool, skill_template_id: str, org_id: str, input_hash: str
) -> Optional[dict]:
    """Look up past corrections for this skill+org+input combo."""
    row = await pool.fetchrow(
        """
        SELECT corrected FROM staging.hub_skill_feedback
        WHERE skill_template_id = $1 AND org_id = $2 AND input_hash = $3
          AND accepted = FALSE
        ORDER BY created_at DESC LIMIT 1
        """,
        uuid.UUID(skill_template_id), uuid.UUID(org_id), input_hash,
    )
    return json.loads(row["corrected"]) if row and row["corrected"] else None


async def _resolve_handler(skill_function: str):
    """Dynamically import and return the handler function."""
    if skill_function not in SKILL_REGISTRY:
        raise ValueError(f"Unknown skill function: {skill_function}")

    module_path, fn_name, _ = SKILL_REGISTRY[skill_function]
    import importlib
    mod = importlib.import_module(module_path)
    return getattr(mod, fn_name)


async def _run_llm_step(step: dict, variables: dict, org_id: str) -> dict:
    """Run a step that uses LLM generation (content-type skills)."""
    from services.ai_router import generate

    prompt_template = step.get("prompt_template", "")
    prompt = prompt_template.format(**variables) if prompt_template else ""
    agent_type = step.get("agent_type", "social_media")

    result = await generate(
        prompt=prompt,
        system="",
        max_tokens=step.get("max_tokens", 2048),
        language=variables.get("language", "en"),
        agent_type=agent_type,
        task="content",
        # `org_id` was already a parameter of this function and was not being
        # handed on, so every skill step charged an org and logged to nobody.
        org_id=org_id,
    )
    return result


async def _run_function_step(
    pool, step: dict, variables: dict, org_id: str, user_id: Optional[str]
) -> dict:
    """Run a step backed by a Python function."""
    skill_function = step["skill_function"]
    handler = await _resolve_handler(skill_function)

    # Merge default params with step-level params and runtime variables
    _, _, defaults = SKILL_REGISTRY[skill_function]
    params = {**defaults, **(step.get("params") or {}), **variables}

    result = await handler(pool=pool, org_id=org_id, user_id=user_id, **params)
    return result if isinstance(result, dict) else {"result": result}


async def dispatch_skill(
    pool,
    skill_template: dict,
    variables: dict,
    org_id: str,
    user_id: Optional[str] = None,
    client_skill_id: Optional[str] = None,
) -> dict:
    """
    Execute all steps of a skill template sequentially.

    For self-learning skills, checks hub_skill_feedback for past corrections
    before prediction.

    Returns {"status", "steps_completed", "outputs", "error"}.
    """
    template_id = str(skill_template["id"])
    steps = skill_template.get("steps") or []
    if isinstance(steps, str):
        steps = json.loads(steps)

    skill_type = skill_template.get("skill_type", "content")
    outputs = []
    steps_completed = 0

    # Create run record
    run_id = await pool.fetchval(
        """
        INSERT INTO staging.hub_skill_runs
          (client_skill_id, client_id, status, steps_total, triggered_by)
        VALUES ($1, $2, 'running', $3, $4)
        RETURNING id
        """,
        uuid.UUID(client_skill_id) if client_skill_id else None,
        None,  # client_id may be null for org-scoped
        len(steps),
        uuid.UUID(user_id) if user_id else None,
    )

    try:
        # For self-learning: check corrections
        input_hash = _hash_input(variables)
        corrections = None
        if skill_type in ("detection", "analysis"):
            corrections = await _get_feedback_corrections(
                pool, template_id, org_id, input_hash
            )

        for step in sorted(steps, key=lambda s: s.get("order", 0)):
            start = time.monotonic()

            if "skill_function" in step:
                # Inject corrections into variables if available
                step_vars = {**variables}
                if corrections:
                    step_vars["_corrections"] = corrections

                result = await _run_function_step(
                    pool, step, step_vars, org_id, user_id
                )
            elif "prompt_template" in step or "agent_type" in step:
                result = await _run_llm_step(step, variables, org_id)
            else:
                log.warning("Skipping step with no handler: %s", step)
                continue

            elapsed = round(time.monotonic() - start, 2)
            outputs.append({
                "order": step.get("order", 0),
                "result": result,
                "elapsed_s": elapsed,
            })
            steps_completed += 1

        # Mark completed
        await pool.execute(
            """
            UPDATE staging.hub_skill_runs
            SET status = 'completed', steps_completed = $2,
                outputs = $3::jsonb, completed_at = now()
            WHERE id = $1
            """,
            run_id, steps_completed, json.dumps(outputs, default=str),
        )

        return {
            "status": "completed",
            "run_id": str(run_id),
            "steps_completed": steps_completed,
            "outputs": outputs,
        }

    except Exception as e:
        log.exception("Skill dispatch failed: template=%s", template_id)
        await pool.execute(
            """
            UPDATE staging.hub_skill_runs
            SET status = 'failed', steps_completed = $2,
                error_message = $3, completed_at = now()
            WHERE id = $1
            """,
            run_id, steps_completed, str(e),
        )
        return {
            "status": "failed",
            "run_id": str(run_id),
            "steps_completed": steps_completed,
            "error": str(e),
        }
