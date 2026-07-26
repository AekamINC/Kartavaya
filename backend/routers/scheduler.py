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
    if not CRON_SECRET or x_cron_secret != CRON_SECRET:
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


@router.post("/cron/skills", dependencies=[])
async def run_skills(x_cron_secret: str = Header("")):
    """Dispatch cron-triggered skills whose interval has elapsed. Called every 15 min."""
    await _verify_cron(x_cron_secret)
    pool = await get_pool()

    # Find active client_skills with cron trigger whose interval has passed
    rows = await pool.fetch("""
        SELECT cs.id AS client_skill_id, cs.org_id, cs.client_id,
               cs.custom_config, cs.last_run_at,
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
        return {"dispatched": 0}

    dispatched = 0
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

        task = asyncio.create_task(
            _run_and_update_skill(pool, r["client_skill_id"], template, variables, org_id)
        )
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
        dispatched += 1

    log.info("Cron skills: dispatched=%d", dispatched)
    return {"dispatched": dispatched}


async def _run_and_update_skill(pool, client_skill_id, template, variables, org_id):
    """Run a skill and update last_run_at regardless of outcome."""
    try:
        await dispatch_skill(
            pool=pool,
            skill_template=template,
            variables=variables,
            org_id=org_id,
            client_skill_id=str(client_skill_id),
        )
    except Exception:
        log.exception("Skill dispatch error: client_skill=%s", client_skill_id)
    finally:
        await pool.execute(
            "UPDATE staging.hub_client_skills SET last_run_at = now() WHERE id = $1",
            client_skill_id,
        )
