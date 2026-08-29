"""
audit.py — Structured audit logging for security-critical events.
All writes are fire-and-forget (background) so they never block request handling.
"""
import asyncio
import logging
from typing import Optional

from fastapi import Request

from db import get_pool

log = logging.getLogger(__name__)


async def _write(
    action: str,
    *,
    org_id: Optional[str] = None,
    user_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    detail: Optional[dict] = None,
    severity: str = "info",
):
    try:
        pool = await get_pool()
        await pool.execute(
            """INSERT INTO public.audit_log
                   (org_id, user_id, action, resource_type, resource_id,
                    ip, user_agent, detail, severity)
               VALUES ($1::uuid, $2, $3, $4, $5, $6::inet, $7, $8::jsonb, $9)""",
            org_id, user_id, action, resource_type, resource_id,
            ip, user_agent,
            __import__("json").dumps(detail) if detail else "{}",
            severity,
        )
    except Exception:
        log.warning("audit write failed for action=%s", action, exc_info=True)


def emit(
    action: str,
    request: Optional[Request] = None,
    *,
    org_id: Optional[str] = None,
    user_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    detail: Optional[dict] = None,
    severity: str = "info",
):
    ip = None
    ua = None
    if request:
        ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or request.client.host if request.client else None
        ua = request.headers.get("user-agent", "")[:512]
    asyncio.ensure_future(_write(
        action,
        org_id=org_id,
        user_id=user_id,
        resource_type=resource_type,
        resource_id=resource_id,
        ip=ip,
        user_agent=ua,
        detail=detail,
        severity=severity,
    ))
