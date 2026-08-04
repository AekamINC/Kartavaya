"""
scheduler.py — Cron-triggered endpoints for background jobs.

These endpoints are called by Railway cron or an external scheduler.
Protected by a shared secret, not user auth.
"""
import os
import logging
from fastapi import APIRouter, HTTPException, Header

import asyncio
import json
from services.reminder_service import scan_and_create_reminders, process_pending_reminders
from services.social_publisher import process_scheduled_posts
from services.skill_dispatcher import dispatch_skill
from db import get_pool

router = APIRouter(prefix="/api/internal", tags=["scheduler"])
log = logging.getLogger(__name__)

_background_tasks: set = set()

CRON_SECRET = os.getenv("CRON_SECRET", "")


async def _verify_cron(x_cron_secret: str = Header("")):
    # Constant-time. `!=` on a str short-circuits at the first differing byte,
    # so the time to fail leaks how many leading bytes were correct — and a cron
    # endpoint can be called as often as an attacker likes.
    from utils import secret_matches

    if not secret_matches(x_cron_secret, CRON_SECRET):
        raise HTTPException(403, "Invalid cron secret")


@router.post("/cron/reminders", dependencies=[])
async def run_reminders(x_cron_secret: str = Header("")):
    """Scan for due items, create reminders, then send them. Called every 15 min."""
    await _verify_cron(x_cron_secret)
    scanned = await scan_and_create_reminders()
    sent = await process_pending_reminders()
    log.info("Cron reminders: scanned=%s sent=%s", scanned, sent)
    return {"scanned": scanned, "sent": sent}


@router.post("/cron/publish", dependencies=[])
async def run_publish(x_cron_secret: str = Header("")):
    """Process scheduled social media posts. Called every 5 min."""
    await _verify_cron(x_cron_secret)
    result = await process_scheduled_posts()
    log.info("Cron publish: %s", result)
    return {"result": result}


@router.post("/cron/retention", dependencies=[])
async def run_retention(x_cron_secret: str = Header("")):
    """Delete old log/activity data per retention policy. Called daily."""
    await _verify_cron(x_cron_secret)
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM staging.cleanup_old_data()")
    cleaned = {r["table_name"]: r["rows_deleted"] for r in rows}
    log.info("Cron retention: %s", cleaned or "nothing to clean")
    return {"cleaned": cleaned}


@router.post("/cron/pahchan-retention", dependencies=[])
async def run_pahchan_retention_cron(x_cron_secret: str = Header("")):
    """
    Pahchan's three retention deletions. Called daily.

    Separate from /cron/retention on purpose. That job trims logs and activity —
    losing a day of it costs nothing. This one deletes photographs of employees'
    faces and payroll records on a promise made to a client, so it needs its own
    result in the logs and its own failure to be visible rather than buried in
    another job's summary.

    Registered as its own Railway cron entry. 07 §5's three windows are
    independent and per-org; see services/pahchan_retention.py.
    """
    await _verify_cron(x_cron_secret)
    from services.pahchan_retention import run_pahchan_retention
    result = await run_pahchan_retention()
    log.info("Cron pahchan-retention: %s", result)
    return result


# ---------------------------------------------------------------------------
# Extended cron jobs — each calls skill/agent functions.
# Skill modules are built separately; imports are guarded so the endpoints
# still register even if the skill module isn't deployed yet.
# ---------------------------------------------------------------------------


@router.post("/cron/invoices", dependencies=[])
async def run_invoices(x_cron_secret: str = Header("")):
    """Daily: detect overdue invoices, generate recurring invoices."""
    await _verify_cron(x_cron_secret)
    pool = await get_pool()
    results = {}
    try:
        from services.skills.invoice_skills import detect_overdue_invoices, generate_recurring_invoices
        results["overdue"] = await detect_overdue_invoices(pool)
        results["recurring"] = await generate_recurring_invoices(pool)
    except ImportError:
        results["error"] = "invoice_skills not available yet"
    log.info("Cron invoices: %s", results)
    return results


@router.post("/cron/crm", dependencies=[])
async def run_crm(x_cron_secret: str = Header("")):
    """Daily: flag stale deals and overdue follow-ups."""
    await _verify_cron(x_cron_secret)
    pool = await get_pool()
    results = {}
    try:
        from services.skills.crm_skills import flag_stale_deals, flag_overdue_followups
        results["stale_deals"] = await flag_stale_deals(pool)
        results["overdue_followups"] = await flag_overdue_followups(pool)
    except ImportError:
        results["error"] = "crm_skills not available yet"
    log.info("Cron crm: %s", results)
    return results


@router.post("/cron/hr", dependencies=[])
async def run_hr(x_cron_secret: str = Header("")):
    """Daily: auto-mark absent employees who didn't check in."""
    await _verify_cron(x_cron_secret)
    pool = await get_pool()
    results = {}
    try:
        from services.skills.hr_skills import auto_mark_attendance
        results["attendance"] = await auto_mark_attendance(pool)
    except ImportError:
        results["error"] = "hr_skills not available yet"
    log.info("Cron hr: %s", results)
    return results


@router.post("/cron/marketing", dependencies=[])
async def run_marketing(x_cron_secret: str = Header("")):
    """Every 5min: process scheduled campaigns and sequence steps."""
    await _verify_cron(x_cron_secret)
    pool = await get_pool()
    results = {}
    try:
        from services.skills.marketing_skills import process_scheduled_campaigns, process_sequence_steps
        results["campaigns"] = await process_scheduled_campaigns(pool)
        results["sequences"] = await process_sequence_steps(pool)
    except ImportError:
        results["error"] = "marketing_skills not available yet"
    log.info("Cron marketing: %s", results)
    return results


@router.post("/cron/reports", dependencies=[])
async def run_reports(x_cron_secret: str = Header("")):
    """Hourly: execute scheduled report deliveries."""
    await _verify_cron(x_cron_secret)
    pool = await get_pool()
    results = {}
    try:
        from services.skills.report_skills import execute_scheduled_reports
        results["reports"] = await execute_scheduled_reports(pool)
    except ImportError:
        results["error"] = "report_skills not available yet"
    log.info("Cron reports: %s", results)
    return results


@router.post("/cron/esign", dependencies=[])
async def run_esign(x_cron_secret: str = Header("")):
    """Daily: send signing reminders for pending documents."""
    await _verify_cron(x_cron_secret)
    pool = await get_pool()
    results = {}
    try:
        from services.skills.esign_skills import send_signing_reminders
        results["reminders"] = await send_signing_reminders(pool)
    except ImportError:
        results["error"] = "esign_skills not available yet"
    log.info("Cron esign: %s", results)
    return results


@router.post("/cron/stock", dependencies=[])
async def run_stock(x_cron_secret: str = Header("")):
    """Daily: alert on low stock items."""
    await _verify_cron(x_cron_secret)
    pool = await get_pool()
    results = {}
    try:
        from services.skills.stock_skills import alert_low_stock
        results["alerts"] = await alert_low_stock(pool)
    except ImportError:
        results["error"] = "stock_skills not available yet"
    log.info("Cron stock: %s", results)
    return results


@router.post("/cron/agents", dependencies=[])
async def run_agents(x_cron_secret: str = Header("")):
    """Hourly: run deadline agent and workload checks across all orgs."""
    await _verify_cron(x_cron_secret)
    pool = await get_pool()
    results = {"deadline": [], "errors": []}

    # Get all active orgs
    orgs = await pool.fetch("SELECT id AS org_id FROM staging.organisations")

    from services.agents.deadline_agent import DeadlineAgent
    agent = DeadlineAgent()

    for org in orgs:
        try:
            r = await agent.execute(pool, org["org_id"], {})
            results["deadline"].append({"org": org["org_id"], **r})
        except Exception as exc:
            results["errors"].append({"org": org["org_id"], "error": str(exc)})

    log.info("Cron agents: %d orgs processed", len(orgs))
    return results


async def _org_can_spend(pool, org_id: str) -> bool:
    """Can this org afford anything at all right now?

    A damper, not an enforcement. `credits.spend` inside the dispatcher is what
    actually refuses; this exists so that an org sitting at zero produces ONE
    log line per cron tick instead of one failed run row per scheduled skill per
    tick, forever. A skill is never disabled for it — a top-up resumes
    everything on the next tick with nobody re-enabling anything.

    Reads the ORG balance and nothing else. A member ceiling is deliberately not
    damped here — see `run_skills`. Skipping a dispatch is not free: a skill
    whose steps are all function-backed charges nothing at all, and this damper
    stops it running too. That is an accepted cost when the org has no credits
    and the whole wallet is empty; it is not one worth paying for one member's
    monthly limit while the org is solvent.

    Fails OPEN. If the balance cannot be read the skill is dispatched anyway and
    the spend decides; a damper that refuses work because it could not read a
    number is worse than the noise it prevents.
    """
    from services import credits

    try:
        async with pool.acquire() as conn:
            bal = await credits.balance_of(conn, org_id)
    except Exception as exc:                                   # noqa: BLE001
        log.warning("Cron skills: could not read the balance for org %s (%s) — "
                    "dispatching anyway", org_id, exc)
        return True
    # A platform org skips the balance check and nothing else, so a zero balance
    # there is not a refusal. Its spends are still metered into the ledger.
    return bal.is_platform_org or bal.total > 0


@router.post("/cron/skills", dependencies=[])
async def run_skills(x_cron_secret: str = Header("")):
    """Dispatch cron-triggered skills whose interval has elapsed. Called every 15 min.

    Every LLM step this dispatches is now CHARGED — see
    services/skill_dispatcher._run_llm_step. Until this change a scheduled skill
    generated content forever and billed nothing, while the identical skill run
    by hand from the Skills screen deducted before it generated. The provider
    invoice arrived either way.

    The spend is attributed to `hub_client_skills.assigned_by`: a timer bills the
    person who scheduled it. That column has existed since migration 012 and was
    simply never selected here. Where it is NULL the org balance still applies
    and the member ceiling does not — an unattributable spend cannot be counted
    against anyone's ceiling, and refusing it instead would stop every skill
    assigned before that column was populated.

    WHICH MEANS: the assignee's MONTHLY CEILING now applies to a timer they may
    have set months ago, and it is charged against the same ceiling as the work
    they do by hand. A skill ticking hourly can therefore consume the ceiling
    that their interactive work needs. That is kept, because the alternative —
    passing no user_id for scheduled runs — makes a schedule the one channel a
    capped member can spend the org's balance through without it counting
    anywhere, and a ceiling with a documented way around it is not a ceiling.
    The remedy stays where the ceiling is: an org admin raises the limit.

    A ceiling refusal STOPS the run — `_run_llm_step` charges before it
    generates, so nothing is produced free — and is written onto the run row.
    Nothing on this path notifies anyone; the outputs are the run row and one
    WARNING below.

    It is NOT damped like an empty org wallet, and that is a choice rather than
    an oversight. `_org_can_spend` reads the org balance, sees a solvent org and
    dispatches, so a capped-out member's skill fails once per its own interval
    until the period rolls over or the limit is raised. Damping it would mean
    skipping the dispatch, which also skips the skill's function-backed steps —
    and those charge nothing, so a data-only skill would stop running to save a
    refusal that would never have happened. `last_run_at` is what bounds this:
    the recurrence is the customer's own interval, not the 15-minute tick.
    """
    await _verify_cron(x_cron_secret)
    pool = await get_pool()

    # Find active client_skills with cron trigger whose interval has passed
    rows = await pool.fetch("""
        SELECT cs.id AS client_skill_id, cs.org_id, cs.client_id,
               cs.custom_config, cs.last_run_at, cs.assigned_by,
               t.id AS template_id, t.name, t.description, t.skill_type,
               t.scope, t.module, t.steps, t.trigger_config, t.is_system
        FROM staging.hub_client_skills cs
        JOIN staging.hub_skill_templates t ON t.id = cs.template_id
        WHERE cs.is_active = TRUE
          AND t.trigger_config IS NOT NULL
          AND (t.trigger_config->>'type') = 'cron'
          AND (
            cs.last_run_at IS NULL
            OR cs.last_run_at + make_interval(
              mins := (t.trigger_config->>'interval_minutes')::int
            ) <= now()
          )
    """)

    if not rows:
        log.info("Cron skills: nothing due")
        return {"dispatched": 0, "skipped_no_credits": 0}

    dispatched = 0
    skipped_no_credits = 0
    #: org_id -> affordable. One balance read per ORG per tick, not per skill.
    affordable: dict = {}

    for r in rows:
        template = {
            "id": str(r["template_id"]),
            "name": r["name"],
            "description": r["description"],
            "skill_type": r["skill_type"],
            "scope": r["scope"],
            "module": r["module"],
            "steps": r["steps"],
            "trigger_config": r["trigger_config"],
            "is_system": r["is_system"],
        }
        variables = r["custom_config"] if r["custom_config"] else {}
        org_id = str(r["org_id"]) if r["org_id"] else None

        if not org_id:
            log.warning("Skipping skill %s — no org_id", r["client_skill_id"])
            continue

        if org_id not in affordable:
            affordable[org_id] = await _org_can_spend(pool, org_id)
        if not affordable[org_id]:
            skipped_no_credits += 1
            continue

        task = asyncio.create_task(
            _run_and_update_skill(
                pool, r["client_skill_id"], template, variables, org_id,
                # `str()` normalises, it does not convert. assigned_by is text in
                # the live catalog and holds `user_{hex12}`, so this is a no-op
                # there; migration 012 declares the column UUID, so a database
                # built from this repo hands back a uuid.UUID object instead.
                # One string type reaches the dispatcher and the ledger either
                # way. Do NOT re-coerce it to uuid.UUID downstream — that is the
                # bug this line's previous comment asserted into existence.
                user_id=str(r["assigned_by"]) if r["assigned_by"] else None,
            )
        )
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
        dispatched += 1

    if skipped_no_credits:
        # ONE line, naming the count and the orgs — not one per skill. This is
        # the "must not spam" half of the out-of-credits decision.
        broke = sorted(o for o, ok in affordable.items() if not ok)
        log.warning(
            "Cron skills: %d scheduled skill(s) not dispatched — %d organisation(s) "
            "have no credits (%s). Nothing was disabled; they resume on a top-up.",
            skipped_no_credits, len(broke), ", ".join(broke),
        )

    log.info("Cron skills: dispatched=%d skipped_no_credits=%d",
             dispatched, skipped_no_credits)
    return {"dispatched": dispatched, "skipped_no_credits": skipped_no_credits}


async def _run_and_update_skill(pool, client_skill_id, template, variables, org_id,
                                user_id=None):
    """Run a skill and update last_run_at.

    `last_run_at` is bumped for EVERY outcome, including an out-of-credits
    refusal, and that is deliberate. Not bumping it would make the skill due
    again on the very next tick, so an org holding 1 credit against a 2-credit
    step would produce a failed run row every 15 minutes indefinitely — a retry
    storm dressed up as diligence. The interval is the customer's own setting
    and it is respected whatever the outcome.

    What stops the slot being consumed SILENTLY is the other half: the refusal
    is written onto the run row by `dispatch_skill` with the sentence naming what
    was needed and what is held, it is logged here at WARNING with the skill
    named, and `run_skills` stops dispatching the org entirely once its balance
    reaches zero.
    """
    try:
        result = await dispatch_skill(
            pool=pool,
            skill_template=template,
            variables=variables,
            org_id=org_id,
            user_id=user_id,
            client_skill_id=str(client_skill_id),
        )
        if (result or {}).get("status") == "insufficient_credits":
            # The CODE and the person billed, not the sentence alone. Two
            # different refusals arrive here under one status:
            # org_credits_exhausted, whose remedy is a top-up from Aekam, and
            # member_cap_exceeded, whose remedy is an org admin raising one
            # person's limit while the org's balance sits untouched. They are
            # also distinguishable by their recurrence — the org one stops
            # dispatching entirely on the next tick, the member one does not —
            # so an operator who cannot tell them apart chases the wrong remedy
            # for the one that keeps reappearing.
            log.warning(
                "Scheduled skill '%s' (client_skill=%s, org=%s, billed=%s) "
                "stopped after %s step(s) [%s]: %s",
                template.get("name"), client_skill_id, org_id, user_id,
                result.get("steps_completed"),
                result.get("credit_error"), result.get("error"),
            )
    except Exception:
        log.exception("Skill dispatch error: client_skill=%s", client_skill_id)
    finally:
        await pool.execute(
            "UPDATE staging.hub_client_skills SET last_run_at = now() WHERE id = $1",
            client_skill_id,
        )
