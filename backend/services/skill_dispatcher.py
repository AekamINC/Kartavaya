"""
skill_dispatcher.py — Universal skill dispatcher for Sahayak Skills.

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
    # Core PM · Phase 2. Every one verified read-only against the live catalog.
    "weekly_project_brief":       ("services.skills.data", "weekly_project_brief", {"days": 7}),
    #                              needs: user_id
    "get_my_desk":                ("services.skills.data", "get_my_desk", {"horizon_days": 7}),
    # Graha · Phase 2
    "triage_new_leads":           ("services.skills.data", "triage_new_leads", {"days": 30}),
    #                              needs: contact_id — and graha + ganit + vikray
    "get_account_brief":          ("services.skills.data", "get_account_brief", {"activity_limit": 50}),
    # Ganit · statutory. Phase 3.  needs: period
    "check_gstr1_readiness":      ("services.skills.data", "check_gstr1_readiness", {"limit": 200}),
    #                              needs: period. Computes nothing of its own —
    #                              same path as the filing screen and the PDF.
    "brief_gstr3b_liability":     ("services.skills.data", "brief_gstr3b_liability", {}),
    # Ganit · the pre-3B pack. Rule 37: vendor bills unpaid 180 days from the
    # INVOICE date, and the credit that puts at risk of reversal, by vendor.
    # Registered on the submodule path rather than the `services.skills.data`
    # package so it needs no line in that package's `__init__`, which other work
    # is editing tonight; `_resolve_handler` imports whatever path it is given.
    "brief_itc_reversal_risk":    ("services.skills.data.itc_reversal",
                                   "brief_itc_reversal_risk", {"limit": 200}),
    # Manav + Vetana · payroll. Reads SALARY — see modules.py.
    "check_payroll_readiness":    ("services.skills.data", "check_payroll_readiness", {"limit": 200}),
    # Vetana · month-on-month pay movement. Defaults to the latest month that
    # HAS payslips, never the wall clock — see the handler docstring.
    "compare_payroll_months":     ("services.skills.data", "compare_payroll_months",
                                   {"threshold_pct": 10.0, "threshold_amount": 1000.0, "limit": 200}),
    # Ganit · a payment PROPOSAL. Cannot record a payment.
    "propose_payment_run":        ("services.skills.data", "propose_payment_run", {"horizon_days": 7, "limit": 200}),
    # Vikray · stock
    "find_low_stock":            ("services.skills.data", "find_low_stock", {}),
    # Manav · rota and leave        needs: team_id
    "scan_upcoming_deadlines":   ("services.skills.data", "scan_upcoming_deadlines", {"horizon_hours": 48}),
    "get_team_workload":         ("services.skills.data", "get_team_workload", {}),
    #                              needs: week_start
    "find_coverage_gaps":        ("services.skills.data", "find_coverage_gaps", {}),
    #                              needs: dept, start_date, end_date
    "check_dept_coverage":       ("services.skills.data", "check_dept_coverage", {}),

    # ── READ · the first-tier operational fourteen ──────────
    #
    # Folio 2 of docs/proposals/70-the-night-ledger.html. Every one is a CHECK,
    # a BRIEF or a PACK in the sense migration 166 gives those words: it finds a
    # problem in the org's own records, says what is happening, or assembles a
    # working paper. NOT ONE calls a model, which is why the templates that
    # carry them are the first in the catalogue whose "0 credits" is true.
    #
    # Registered on their own submodule paths, following `brief_itc_reversal_risk`
    # above, so `services/skills/data/__init__.py` needs no line for any of them.
    # `_resolve_handler` imports whatever path it is given.
    #
    # Every handler here defaults EVERY parameter — see
    # `tests/test_a_skill_can_run_unattended.py`. A period, a month, a financial
    # year and a horizon all have an answer a schedule can work out at 6am, and
    # a handler that makes a person type one is a handler nobody automates.

    # Ganit · the GST cliffs. Three deadlines that arrive without a screen.
    #                              period defaults to the month being FILED.
    "brief_ims_expectations":     ("services.skills.data.gst_cliffs",
                                   "brief_ims_expectations", {"limit": 200}),
    #                              financial_year defaults to the last one ENDED
    #                              — s.16(4) bites on the year you have left.
    "brief_itc_at_risk_of_lapse": ("services.skills.data.gst_cliffs",
                                   "brief_itc_at_risk_of_lapse", {"limit": 200}),
    #                              as_at defaults to today, read through
    #                              services/statute.py rather than a literal.
    "check_dead_gst_slabs":       ("services.skills.data.gst_cliffs",
                                   "check_dead_gst_slabs", {"limit": 200}),

    # Ganit (+ Graha for the customer's name) · the four ledger checks.
    "check_retainers_that_stopped_billing":
                                  ("services.skills.data.ganit_ops",
                                   "check_retainers_that_stopped_billing",
                                   {"horizon_days": 7, "limit": 200}),
    "check_duplicate_vendor_bills":
                                  ("services.skills.data.ganit_ops",
                                   "check_duplicate_vendor_bills", {"limit": 200}),
    #                              A PACK: drafts the chase, sends nothing. Not
    #                              in WRITE_SKILL_FUNCTIONS, and must not be —
    #                              see the test that pins the distinction.
    "pack_collection_messages":   ("services.skills.data.ganit_ops",
                                   "pack_collection_messages",
                                   {"min_days_overdue": 1, "limit": 100}),
    #                              Caps rather than truncating: a capped series
    #                              scan INVENTS holes, so it refuses instead.
    "check_invoice_series_and_splits":
                                  ("services.skills.data.ganit_ops",
                                   "check_invoice_series_and_splits", {"limit": 200}),

    # Manav + Vetana · either side of the payroll run. Reads SALARY and PAN —
    # see modules.py for why the gate is both grants and not one.
    "check_statutory_records_gate":
                                  ("services.skills.data.people_checks",
                                   "check_statutory_records_gate", {"limit": 200}),
    #                              month defaults to the month already RUN.
    "brief_statutory_dues":       ("services.skills.data.people_checks",
                                   "brief_statutory_dues", {"limit": 12}),
    "check_attendance_exceptions":("services.skills.data.people_checks",
                                   "check_attendance_exceptions", {"limit": 200}),
    "brief_unpaid_reimbursements":("services.skills.data.people_checks",
                                   "brief_unpaid_reimbursements", {"limit": 200}),

    # Vikray + Ganit (the product master is Ganit's) · stock and the retainers
    # that quietly went stale.
    "check_impossible_stock":     ("services.skills.data.stock_and_crm",
                                   "check_impossible_stock", {"limit": 200}),
    "check_unfillable_orders":    ("services.skills.data.stock_and_crm",
                                   "check_unfillable_orders", {"limit": 400}),
    "check_stale_retainer_rates": ("services.skills.data.stock_and_crm",
                                   "check_stale_retainer_rates",
                                   {"horizon_days": 60, "stale_months": 12, "limit": 200}),

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
    #                              needs: year
    #                              needs: week_start
    #                              needs: employee_id
    "execute_onboarding":        ("services.skills.action", "execute_onboarding", {}),
    #                              needs: campaign_id
    "send_campaign":             ("services.skills.action", "send_campaign", {}),
    #                              needs: enrollment_id
    "execute_sequence_step":     ("services.skills.action", "execute_step", {}),
    #                              needs: entity_type, entity_id
    #                              needs: user_ids, title, body
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

#: Parameters a template may NEVER open to the person pressing Run, whatever
#: its `runtime_params` says.
#:
#: The rule that makes runtime parameters safe at all: a runtime value may
#: select WHICH ROW, never WHICH SOURCE.
#:
#: Selecting a row is safe because the handler still filters on org_id inside
#: its own query — asking for another tenant's `contact_id` returns nothing.
#: Selecting a source is not, and `module` is the proof: it chooses which TABLE
#: `find_overdue` reads, so a run variable of {"module": "invoices"} turned a
#: tasks skill into a read of the receivables ledger. That hole is why run
#: variables were cut off from handler arguments in the first place; this list
#: is what stops the mechanism that reopens the door from reopening that one.
#:
#:   org_id       the tenant boundary. Forced by the dispatcher, never supplied.
#:   user_id      the dispatcher injects the CALLER's own. Opening it would let
#:                a "my desk" skill report a colleague's desk.
#:   module       selects the table. See above.
#:   allow_writes a step flag, not a handler argument. Listed defensively: it is
#:                the author's consent to write, and consent that the runner can
#:                grant themselves is not consent.
RUNTIME_FORBIDDEN_PARAMS: frozenset[str] = frozenset({
    "org_id", "user_id", "module", "allow_writes",
})

#: Handlers that WRITE. A step naming one of these must set
#: `"allow_writes": true` to run — see `_run_function_step`.
WRITE_SKILL_FUNCTIONS: frozenset[str] = frozenset({
    "generate_due_invoices",
    "mark_holidays_weekends",
    "execute_onboarding",
    "send_campaign",
    "execute_sequence_step",
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

        # A handler that cannot be scoped to one tenant is reported UNAVAILABLE
        # rather than merely flagged. `_run_function_step` refuses it, so
        # offering it in the step editor would let someone author a template
        # that saves cleanly and can never run — the failure arriving at run
        # time, in front of whoever pressed the button rather than whoever made
        # the mistake.
        scopable = (
            any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values())
            or "org_id" in params
        )
        # Which parameters an author may open to the person running the skill.
        # Derived from the signature rather than listed by hand, so a handler
        # gaining a parameter cannot silently become un-askable — and filtered
        # through the same forbidden set the dispatcher enforces, so the editor
        # can never offer something the run guard would strip.
        runtime_eligible = [
            p for p in params
            if p not in ("pool",) and p not in RUNTIME_FORBIDDEN_PARAMS
        ]

        out.append({
            "name": name,
            "available": scopable,
            "kind": kind,
            "writes": name in WRITE_SKILL_FUNCTIONS,
            "needs": needs,
            "runtime_eligible": runtime_eligible,
            "defaults": defaults,
            **({} if scopable else {
                "unavailable_reason": "cannot be scoped to one organisation — "
                                      "its handler does not take org_id",
            }),
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


async def _run_llm_step(
    step: dict, variables: dict, org_id: str,
    *, user_id: Optional[str] = None, run_id: Optional[str] = None,
) -> dict:
    """Run a step that uses LLM generation (content-type skills), and CHARGE it.

    This function is the whole reason a scheduled skill was free. `dispatch_skill`
    is reached from exactly one place — the cron in `routers/scheduler.py` — and
    nothing on that path ever touched a wallet, while the same LLM work run by
    hand from `hub.py` deducts before it generates. A timer that produces content
    forever and bills nothing is not a discount, it is an unmetered channel: the
    provider still invoices Aekam per call.

    The order is charge-then-generate, matching every other LLM site in the
    product. It is what stops concurrent runs raiding a wallet. The missing half
    everywhere else was the refund, so it is here from the start: if `generate`
    raises, the debit comes straight back before the exception continues up.

    The idempotency key names the STEP, not the attempt —
    `skillrun:{run_id}:step:{order}`. A run row is created once per dispatch, so
    a retried dispatch is a new run and charges again (correctly, it generates
    again), while a retry INSIDE one dispatch cannot double-charge.

    `user_id` is the person the spend is attributed to and capped against. From
    the cron it is `hub_client_skills.assigned_by` — a timer bills the person who
    scheduled it. When it is None the member ceiling does not apply and the org
    balance check still does; see the module note in routers/scheduler.py.
    """
    from services import credits
    from services.ai_router import generate

    # `.format(**variables)` was the third substitution dialect in this codebase
    # and the most brittle of them: it raises KeyError on any placeholder the
    # caller did not supply — one optional variable takes the whole run down —
    # and it reads `{{` as an escaped literal, so `{{brand_name}}` collapsed to
    # the string `{brand_name}` no matter what was passed. Both dialects now go
    # through one helper. See services/skills/prompt.py.
    prompt = fill_prompt(step.get("prompt_template", ""), variables)
    agent_type = step.get("agent_type", "social_media")

    receipt = await credits.spend_standalone(
        org_id=org_id,
        user_id=user_id,
        kind="skill_step",
        ref_id=agent_type,
        idempotency_key=f"skillrun:{run_id}:step:{step.get('order', 0)}",
        description=f"skill step {step.get('order', 0)}: {agent_type}",
    )

    try:
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
    except Exception:
        # A replayed receipt was charged by an earlier attempt that may well have
        # produced output; reversing it here would refund work the customer
        # already has. Only a debit this call actually took is given back.
        if not receipt.replayed:
            await credits.refund_standalone(
                tx_id=receipt.tx_id,
                reason=f"skill step {step.get('order', 0)} ({agent_type}) did not complete",
                user_id=user_id,
            )
        raise

    result["credits_charged"] = receipt.credits
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

    So the arguments are matched to the signature rather than assumed. Four
    rules, in order:

      · a handler that does not ACCEPT `org_id` is refused outright. See below —
        this is a tenant boundary, not a convenience.
      · run variables never reach a handler. See below.
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

    sig = inspect.signature(handler)
    params = sig.parameters
    takes_var_kw = any(p.kind is p.VAR_KEYWORD for p in params.values())

    # ── Tenant boundary, enforced rather than asserted ──────────────────────
    #
    # The previous version set `supplied["org_id"] = org_id` under a comment
    # reading "never overridable", and then filtered the arguments down to the
    # handler's signature — which silently DROPPED org_id again for the
    # handlers that do not name it: execute_sequence_step, get_team_workload,
    # scan_upcoming_deadlines, score_candidate, send_campaign. Every one of
    # those selects by a team or entity id with no org filter of its own, so a
    # template naming another tenant's entity id read another tenant's row.
    # (The worst offenders in this list — escalate and notify_multi — were
    # deleted with the old automation estate in the Niyam demolition; they were
    # broken at the call level as well as unscoped.)
    # That is cross-TENANT, strictly worse than the cross-module gap it was
    # written to prevent.
    #
    # Refusing is the only safe answer available here. Passing org_id to a
    # handler that does not accept it is a TypeError; scoping it from the
    # outside is impossible because the filter belongs inside the handler's own
    # query. So these seven stay unavailable until each one takes org_id and
    # filters on it, and the refusal names the reason.
    if not takes_var_kw and "org_id" not in params:
        raise PermissionError(
            f"'{skill_function}' does not accept org_id, so it cannot be scoped "
            f"to one tenant. Refusing to run it until its handler takes org_id "
            f"and filters on it."
        )

    # ── Run variables reach a handler ONLY where the author allowed it ──────
    #
    # Variables used to be merged LAST, over both the registry defaults and the
    # step's own params, so a step authored as {"skill_function":
    # "find_overdue_tasks", "params": {"module": "tasks"}} was redirected by a
    # run variable of {"module": "invoices"} into the receivables ledger.
    #
    # Cutting them off entirely fixed that and broke something real: a handler
    # like `get_account_brief` needs to know WHICH contact, and only the person
    # running it knows. So the author opts a named parameter in:
    #
    #     {"skill_function": "get_account_brief",
    #      "runtime_params": ["contact_id"],
    #      "params": {"activity_limit": 50}}
    #
    # An allowlist, not a filter: a variable not named here cannot reach the
    # handler however it is spelled. RUNTIME_FORBIDDEN_PARAMS then removes the
    # names that must never be opened even deliberately — the difference being
    # that a runtime value may select which ROW, never which SOURCE.
    supplied: dict[str, Any] = {**defaults, **(step.get("params") or {})}

    allowed = [
        p for p in (step.get("runtime_params") or [])
        if p not in RUNTIME_FORBIDDEN_PARAMS
    ]
    for name in allowed:
        if variables and name in variables:
            supplied[name] = variables[name]

    supplied["org_id"] = org_id          # forced last; never overridable
    if user_id is not None:
        supplied.setdefault("user_id", user_id)

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
            f"'{skill_function}' needs {', '.join(sorted(missing))}, which "
            f"neither the step's params nor its runtime_params supplied. Add it "
            f"to params to fix the value, or to runtime_params to ask the person "
            f"running the skill for it."
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

    ── WHAT HAPPENS WHEN THE ORG IS OUT OF CREDITS ─────────────────────────────
    This runs from a timer. There is nobody sitting in front of it to be told
    "top up", so the refusal has to behave itself. Three rules, decided
    deliberately:

      1. THE RUN STOPS AT THE FIRST REFUSAL. It does not skip the step and
         continue, and it does not run the remaining steps unbilled. Steps
         already completed keep their outputs — they were paid for and they
         produced something — and `steps_completed` says how far it got.

      2. THE REFUSAL IS RECORDED, NOT SWALLOWED. The run row is marked
         'failed' with the refusal's own sentence, which names what was needed
         and what is held. `status` in the return is 'insufficient_credits'
         rather than 'failed', so the caller can tell a wallet from a bug.

      3. IT DOES NOT SPAM. The caller (`routers/scheduler.py`) is what enforces
         this: it checks the org balance once per tick and does not dispatch at
         all for an org that cannot afford anything, so a flat-broke org
         produces one log line per cron tick instead of one failed run row per
         skill. The skill is never auto-disabled — a top-up must resume it
         without an admin re-enabling anything.
    """
    from services import credits

    template_id = str(skill_template["id"])
    steps = skill_template.get("steps") or []
    if isinstance(steps, str):
        steps = json.loads(steps)

    skill_type = skill_template.get("skill_type", "content")
    outputs = []
    steps_completed = 0

    # Create run record.
    #
    # The two ids here are NOT the same kind of thing and must not be made to
    # look alike. `client_skill_id` is a row id — gen_random_uuid(), a real uuid,
    # coerced so a malformed one fails here rather than as a cast error inside
    # the statement. `triggered_by` is a USER id, and a user id in this product
    # is text: auth_router mints `user_{hex12}`, and every column that stores one
    # is text — hub_client_skills.assigned_by, hub_org_skill_runs.triggered_by,
    # org_member_credits.user_id (whose lookup has no ::uuid cast for exactly
    # this reason). hub.py has always written `user["user_id"]` here raw.
    #
    # It was coerced with uuid.UUID() while the cron passed no user_id at all, so
    # the branch was dead and the mistake invisible. The moment metering gave the
    # cron a user to bill, every scheduled skill with a non-null assigned_by
    # raised ValueError on this line — before the try below, so `dispatch_skill`
    # never recorded it and the caller's bare except swallowed it. A silent stop,
    # on the path whose entire purpose is to run unattended.
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
        user_id,
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
                # Only LLM steps are charged. A function-backed step runs a
                # scoped SQL read against tables the org already pays for; there
                # is no provider invoice behind it and no price row for one.
                result = await _run_llm_step(
                    step, variables, org_id,
                    user_id=user_id, run_id=str(run_id),
                )
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

    except credits.CreditError as e:
        # A wallet is not a bug, and it must not be logged as one. `log.exception`
        # on a scheduled skill that simply ran out of credits fills the error
        # channel with something no engineer can act on, and buries the failures
        # that need one.
        message = getattr(e, "message", None) or str(e)
        log.warning(
            "Skill run refused for credits: template=%s org=%s user=%s step=%s — %s",
            template_id, org_id, user_id, steps_completed + 1, message,
        )
        await pool.execute(
            """
            UPDATE staging.hub_skill_runs
            SET status = 'failed', steps_completed = $2,
                error_message = $3, outputs = $4::jsonb, completed_at = now()
            WHERE id = $1
            """,
            run_id, steps_completed, message[:2000],
            json.dumps(outputs, default=str),
        )
        return {
            # Its own status, not 'failed'. A caller deciding whether to alert an
            # engineer or an accounts manager cannot tell those apart from a
            # sentence, and this is the one failure whose remedy is a top-up.
            "status": "insufficient_credits",
            "run_id": str(run_id),
            "steps_completed": steps_completed,
            "outputs": outputs,
            "error": message,
            "credit_error": getattr(e, "code", "credit_error"),
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
