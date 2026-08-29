"""services/email_caps.py — per-org email cap enforcement.

Counts sent emails from `staging.outbound_log` and checks against the caps
stored on `staging.organisations`. Called from `outbound.begin()` on every
email send.

NULL cap columns mean unlimited — no enforcement. When a cap is exceeded and
`email_overage_rate` is NULL, the send is blocked (hard cap). When a rate is
set, the send proceeds as overage.
"""
import logging
from dataclasses import dataclass

log = logging.getLogger(__name__)


@dataclass
class CapVerdict:
    allowed: bool
    is_overage: bool = False
    daily_usage: int = 0
    daily_cap: int | None = None
    monthly_usage: int = 0
    monthly_cap: int | None = None
    overage_rate: float | None = None
    daily_pct: float = 0.0
    monthly_pct: float = 0.0


async def email_usage(pool, org_id: str) -> dict:
    """Return {"daily": int, "monthly": int} of sent emails for this org."""
    row = await pool.fetchrow(
        """
        SELECT
          COUNT(*) FILTER (
            WHERE ts >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata')
                         AT TIME ZONE 'Asia/Kolkata'
          ) AS daily,
          COUNT(*) FILTER (
            WHERE ts >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata')
                         AT TIME ZONE 'Asia/Kolkata'
          ) AS monthly
        FROM public.outbound_log
        WHERE org_id = $1::uuid
          AND channel = 'email'
          AND status = 'sent'
        """,
        org_id,
    )
    if not row:
        return {"daily": 0, "monthly": 0}
    return {"daily": row["daily"], "monthly": row["monthly"]}


async def check_email_cap(pool, org_id: str) -> CapVerdict:
    """Check if an org can send another email. Never raises."""
    try:
        org = await pool.fetchrow(
            "SELECT email_cap_daily, email_cap_monthly, email_overage_rate "
            "FROM public.organisations WHERE id = $1::uuid",
            org_id,
        )
        if not org:
            return CapVerdict(allowed=True)

        daily_cap = org["email_cap_daily"]
        monthly_cap = org["email_cap_monthly"]
        overage_rate = float(org["email_overage_rate"]) if org["email_overage_rate"] is not None else None

        if daily_cap is None and monthly_cap is None:
            return CapVerdict(allowed=True)

        usage = await email_usage(pool, org_id)
        daily_usage = usage["daily"]
        monthly_usage = usage["monthly"]

        daily_pct = (daily_usage / daily_cap * 100) if daily_cap else 0.0
        monthly_pct = (monthly_usage / monthly_cap * 100) if monthly_cap else 0.0

        exceeded = False
        if daily_cap is not None and daily_usage >= daily_cap:
            exceeded = True
        if monthly_cap is not None and monthly_usage >= monthly_cap:
            exceeded = True

        if exceeded:
            if overage_rate is not None:
                return CapVerdict(
                    allowed=True, is_overage=True,
                    daily_usage=daily_usage, daily_cap=daily_cap,
                    monthly_usage=monthly_usage, monthly_cap=monthly_cap,
                    overage_rate=overage_rate,
                    daily_pct=daily_pct, monthly_pct=monthly_pct,
                )
            return CapVerdict(
                allowed=False,
                daily_usage=daily_usage, daily_cap=daily_cap,
                monthly_usage=monthly_usage, monthly_cap=monthly_cap,
                daily_pct=daily_pct, monthly_pct=monthly_pct,
            )

        return CapVerdict(
            allowed=True,
            daily_usage=daily_usage, daily_cap=daily_cap,
            monthly_usage=monthly_usage, monthly_cap=monthly_cap,
            overage_rate=overage_rate,
            daily_pct=daily_pct, monthly_pct=monthly_pct,
        )
    except Exception:
        log.debug("email_caps: check failed, allowing send", exc_info=True)
        return CapVerdict(allowed=True)


async def record_alert(pool, org_id: str, cap_type: str, period_key: str) -> bool:
    """Record that the 80% alert was sent. Returns True if this is the first
    alert for this period (i.e. the INSERT succeeded, not a conflict)."""
    try:
        result = await pool.execute(
            "INSERT INTO public.email_cap_alerts (org_id, cap_type, period_key) "
            "VALUES ($1::uuid, $2, $3) "
            "ON CONFLICT (org_id, cap_type, period_key) DO NOTHING",
            org_id, cap_type, period_key,
        )
        return result == "INSERT 0 1"
    except Exception:
        log.debug("email_caps: recording alert failed", exc_info=True)
        return False
