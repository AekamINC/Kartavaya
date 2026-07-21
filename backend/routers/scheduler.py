"""
scheduler.py — Cron-triggered endpoints for background jobs.

These endpoints are called by Railway cron or an external scheduler.
Protected by a shared secret, not user auth.
"""
import os
import logging
from fastapi import APIRouter, HTTPException, Header

from services.reminder_service import scan_and_create_reminders, process_pending_reminders
from services.social_publisher import process_scheduled_posts

router = APIRouter(prefix="/api/internal", tags=["scheduler"])
log = logging.getLogger(__name__)

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
