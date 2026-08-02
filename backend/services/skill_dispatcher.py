"""
skill_dispatcher.py — Universal skill dispatcher for Srijan Skills.

Routes skill steps to Python functions or LLM generation.
Supports self-learning via hub_skill_feedback corrections.
"""
import hashlib
import importlib
import inspect
import json
import logging
import time
import uuid
from typing import Any, Optional

from db import get_pool
from services.skills.prompt import fill_prompt

log = logging.getLogger(__name__)


# ── Skill Registry ──────────────────────────────────────────
#
# Maps skill_function name → (module_path, function_name, default_params).
#
# Every entry in the previous version pointed at a module that does not exist —
# `services.skills.ganit`, `.manav`, `.vetana`, `.vikray`, `.graha`, `.pm`,
# `.dristi`, `.prachar`, none of them ever written — so `_resolve_handler` raised
# ModuleNotFoundError on any function-backed step. Meanwhile 23 real handlers sat
# in `data/`, `action/` and `detect/` referenced by nothing. The registry was
# written against a layout that was planned and the handlers against the one that
# shipped, and nothing failed loudly because no template has ever carried a
# `skill_function` step.
#
# Three kinds, and the distinction is the whole safety story:
#
#   READ    org-scoped queries. Idempotent, no writes. Safe to run on a schedule
#           and safe to hand to the model as grounding.
#   DETECT  scoring and anomaly work. Also read-only, but the output is a
#           JUDGEMENT — "this deal is unhealthy", "this expense breaks policy" —
#           so it belongs in front of a human, not wired straight to an action.
#   ACT     writes rows, sends messages, moves money. Gated in the run paths.
#
# `needs` names the params a handler cannot default. They arrive from the step's
# `params` block or from the run's `variables`; a step that omits them fails
# closed in `_run_function_step` rather than running against a silent default.

SKILL_REGISTRY: dict[str, tuple[str, str, dict]] = {
    # ── READ ────────────────────────────────────────────────
    # Ganit · receivables and payables
    "find_overdue_invoices":     ("services.skills.data", "find_overdue",  {"module": "invoices", "days_overdue": 7}),
    "find_overdue_vendor_bills": ("services.skills.data", "find_overdue",  {"module": "vendor_bills", "days_overdue": 0}),
    # Graha · CRM follow-ups
    "find_overdue_followups":    ("services.skills.data", "find_overdue",  {"module": "follow_ups", "days_overdue": 0}),
    # Core PM · tasks
    "find_overdue_tasks":        ("services.skills.data", "find_overdue",  {"module": "tasks", "days_overdue": 0}),
    # eSign · unsigned drafts
    "find_stalled_agreements":   ("services.skills.data", "find_overdue",  {"module": "esign", "days_overdue": 14}),
    # Dristi · the numbers
    "aggregate_kpis":            ("services.skills.data", "aggregate_kpis", {"period": "30d"}),
    # Vikray · stock
    "find_low_stock":            ("services.skills.data", "find_low_stock", {}),
    # Manav · rota and leave        needs: team_id
    "scan_upcoming_deadlines":   ("services.skills.data", "scan_upcoming_deadlines", {"horizon_hours": 48}),
    "get_team_workload":         ("services.skills.data", "get_team_workload", {}),
    #                              needs: week_start
    "find_coverage_gaps":        ("services.skills.data", "find_coverage_gaps", {}),
    #                              needs: dept, start_date, end_date
    "check_dept_coverage":       ("services.skills.data", "check_dept_coverage", {}),

    # ── DETECT ──────────────────────────────────────────────
    "score_deals":               ("services.skills.detect", "score_deals", {}),
    "detect_attendance_patterns":("services.skills.detect", "detect_patterns", {"lookback_days": 30}),
    #                              needs: metric
    "detect_anomalies":          ("services.skills.detect", "detect_anomalies", {"lookback_days": 90}),
    #                              needs: expense
    "check_expense_policy":      ("services.skills.detect", "check_policy", {}),
    #                              needs: bank_txns
    "match_bank_transactions":   ("services.skills.detect", "fuzzy_match_transactions", {}),
    #                              needs: candidate
    "score_candidate":           ("services.skills.detect", "score_candidate", {}),

    # ── ACT ─────────────────────────────────────────────────
    # Writes. `_run_function_step` refuses these unless the step opts in.
    "generate_due_invoices":     ("services.skills.action", "generate_due_invoices", {}),
    "mark_holidays_weekends":    ("services.skills.action", "mark_holidays_weekends", {}),
    "process_document_expiry":   ("services.skills.action", "process_expiry", {"module": "esign"}),
    #                              needs: year
    "allocate_leave_yearly":     ("services.skills.action", "allocate_yearly", {}),
    #                              needs: week_start
    "auto_schedule_week":        ("services.skills.action", "auto_schedule_week", {}),
    #                              needs: employee_id
    "execute_onboarding":        ("services.skills.action", "execute_onboarding", {}),
    #                              needs: campaign_id
    "send_campaign":             ("services.skills.action", "send_campaign", {}),
    #                              needs: enrollment_id
    "execute_sequence_step":     ("services.skills.action", "execute_step", {}),
    #                              needs: entity_type, entity_id
    "escalate":                  ("services.skills.action", "escalate", {"level": 1}),
    #                              needs: user_ids, title, body
    "notify_multi":              ("services.skills.action", "notify_multi", {}),
}

#: Registry entries from the previous version that have NO implementation
#: anywhere in the tree. Recorded rather than deleted so the gap stays visible:
#: each was a promise the catalog could reference and nothing could honour.
#:
#:   ganit_categorize_expenses   no categoriser exists. `check_policy` judges one
#:                               expense against policy; it does not classify.
#:   vetana_trigger_payroll      no handler. Payroll is run from its own module.
#:   vetana_deliver_payslips     no handler.
#:   graha_contact_dedup         `contact_dedupe.find_duplicates` needs an email,
#:                               phone or name to match against — it is a
#:                               per-contact check, not an org-wide sweep.
#:   pm_auto_archive             no handler.
#:   dristi_scheduled_reports    `report_generator` renders a PDF from data it is
#:                               handed; it does not select or schedule reports.
UNIMPLEMENTED_SKILL_FUNCTIONS: frozenset[str] = frozenset({
    "ganit_categorize_expenses",
    "vetana_trigger_payroll",
    "vetana_deliver_payslips",
    "graha_contact_dedup",
    "pm_auto_archive",
    "dristi_scheduled_reports",
})

#: Handlers that WRITE. A step naming one of these must set
#: `"allow_writes": true` to run — see `_run_function_step`.
WRITE_SKILL_FUNCTIONS: frozenset[str] = frozenset({
    "generate_due_invoices",
    "mark_holidays_weekends",
    "process_document_expiry",
    "allocate_leave_yearly",
    "auto_schedule_week",
    "execute_onboarding",
    "send_campaign",
    "execute_sequence_step",
    "escalate",
    "notify_multi",
})


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


def describe_skill_functions() -> list[dict]:
    """The registry, as the step editor needs to see it.

    Built by introspection rather than written out a second time. A hand-kept
    list in the UI is a list that drifts, and the drift is silent until someone
    authors a template naming a function that moved — which is the failure this
    whole area already had once, in the other direction.

    `needs` is what the author must supply: a parameter with no default that the
    registry's own defaults do not already fill. `org_id` and `user_id` are
    excluded because the run path supplies both, and `org_id` deliberately
    cannot be set from a template at all.
    """
    out: list[dict] = []
    for name, (module_path, fn_name, defaults) in sorted(SKILL_REGISTRY.items()):
        try:
            handler = getattr(importlib.import_module(module_path), fn_name)
            params = inspect.signature(handler).parameters
        except Exception:                                 # noqa: BLE001
            # A broken entry is reported as such rather than omitted. Hiding it
            # is how the previous registry looked healthy while every one of its
            # entries pointed at a module nobody had written.
            out.append({"name": name, "available": False, "needs": [],
                        "writes": name in WRITE_SKILL_FUNCTIONS, "kind": "unknown"})
            continue

        needs = [
            p for p, spec in params.items()
            if p not in ("pool", "org_id", "user_id")
            and spec.default is inspect.Parameter.empty
            and p not in defaults
        ]
        kind = ("act" if name in WRITE_SKILL_FUNCTIONS
                else "detect" if ".detect" in module_path else "read")
        out.append({
            "name": name,
            "available": True,
            "kind": kind,
            "writes": name in WRITE_SKILL_FUNCTIONS,
            "needs": needs,
            "defaults": defaults,
        })
    return out


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

    # `.format(**variables)` was the third substitution dialect in this codebase
    # and the most brittle of them: it raises KeyError on any placeholder the
    # caller did not supply — one optional variable takes the whole run down —
    # and it reads `{{` as an escaped literal, so `{{brand_name}}` collapsed to
    # the string `{brand_name}` no matter what was passed. Both dialects now go
    # through one helper. See services/skills/prompt.py.
    prompt = fill_prompt(step.get("prompt_template", ""), variables)
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
    """Run a step backed by a Python function.

    The previous version called `handler(pool=, org_id=, user_id=, **params)`
    unconditionally. Not one of the 23 handlers accepts `user_id`, and several
    take `team_id` or an entity id rather than `org_id`, so every function-backed
    step would have raised TypeError before it reached a query — on top of the
    ModuleNotFoundError from the registry. Neither was ever observed because
    nothing has ever run a function-backed step.

    So the arguments are matched to the signature rather than assumed. Three
    rules, in order:

      · `org_id` is forced LAST and cannot be overridden by step params or run
        variables. It is the tenant boundary — a template that could set its own
        `org_id` would read another customer's invoices, and templates are org
        data that customers can author.
      · a handler is given only what its signature names, so adding a param to
        one handler cannot break the others.
      · a required param with nothing to fill it raises here, before the call.
        The alternative is a handler running against a silent default, which for
        `find_overdue` means scanning the wrong table and for anything in
        WRITE_SKILL_FUNCTIONS means writing the wrong rows.
    """
    skill_function = step["skill_function"]

    # Writes are opt-in per step. A read-only skill that acquires a write step
    # through a template edit is the failure this prevents: `send_campaign` and
    # `generate_due_invoices` reach customers and money, and a skill template is
    # editable by any org admin.
    if skill_function in WRITE_SKILL_FUNCTIONS and not step.get("allow_writes"):
        raise PermissionError(
            f"'{skill_function}' writes data and the step did not set "
            f"allow_writes. Refusing to run it."
        )

    handler = await _resolve_handler(skill_function)
    _, _, defaults = SKILL_REGISTRY[skill_function]

    supplied: dict[str, Any] = {**defaults, **(step.get("params") or {}), **(variables or {})}
    supplied["org_id"] = org_id          # tenant boundary — never overridable
    if user_id is not None:
        supplied.setdefault("user_id", user_id)

    sig = inspect.signature(handler)
    params = sig.parameters
    takes_var_kw = any(p.kind is p.VAR_KEYWORD for p in params.values())

    if takes_var_kw:
        kwargs = {k: v for k, v in supplied.items() if k != "pool"}
    else:
        kwargs = {k: v for k, v in supplied.items() if k in params and k != "pool"}

    missing = [
        name for name, p in params.items()
        if name != "pool"
        and p.default is inspect.Parameter.empty
        and p.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
        and name not in kwargs
    ]
    if missing:
        raise ValueError(
            f"'{skill_function}' needs {', '.join(sorted(missing))}, which the "
            f"step's params and the run's variables did not supply."
        )

    result = await handler(pool=pool, **kwargs)
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
