import hashlib
import os
from fastapi import APIRouter
from datetime import datetime, timezone
from db import get_pool

# The module, not the names: `outbound.MODE` and `outbound.SUPPRESSED_ORGS` are
# read through the module attribute on every request, the same "read now, so a
# test may patch it" contract `outbound.begin()` uses for DRY_RUN. A `from`
# import would freeze whatever the values were when this file loaded and the
# endpoint would keep reporting it after a test (or a future hot path) patched
# the module.
import outbound

router = APIRouter(tags=["health"])


def suppressed_orgs_digest(orgs) -> str:
    """sha256 hex, first 16 chars, of the comma-joined SORTED lowercase org ids;
    the empty set is "0".

    A DIGEST AND NEVER THE IDS. This rides an unauthenticated endpoint, and the
    names-not-ids rule covers org ids as much as user ids: publishing the
    tenant uuids on OUTBOUND_SUPPRESSED_ORGS would hand any visitor a valid org
    id to aim other requests at, to learn which tenants exist, and to watch the
    list change. The digest exposes none of that — but a caller that already
    KNOWS an org id (the e2e suite knows its own) can hash the set it expects
    and compare, which is exactly the attestation the suite needs: "the
    deployed process is shielding precisely the set I think it is", verified
    before a payroll re-run turns ~60 seeded @example.com addresses into ~60
    hard bounces at the verified sender domain.

    Sorted so the digest is a function of the SET and not of how the operator
    happened to order the env var; lowercased defensively even though
    `outbound._parse_suppressed_orgs` already canonicalises through
    `uuid.UUID`; "0" for the empty set so "nothing is shielded" is one
    unmistakable literal rather than the (valid, computable) hash of "".
    """
    if not orgs:
        return "0"
    joined = ",".join(sorted(str(o).lower() for o in orgs))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def _rate_limit_store() -> str:
    """Which store the limiter is ACTUALLY using, proved by a round trip.

    Same reasoning as `current_schema()` below: reporting `REDIS_URL` would
    report an INTENTION. This reports the fact, and it is the only thing that
    settles the question from outside the container.

    ⚠ It exists because three separate outside-in inferences got this wrong on
    2026-08-30 — blaming worker count, then IPv6 egress, then a missing private
    endpoint — while the one honest signal (a rate-limit threshold probe) kept
    saying the counters were not shared. Railway's network metrics do not appear
    to count private-network traffic, so "zero bytes" proved nothing either.

    `check()` on a limits storage is a real ping, so `redis-unreachable` means
    the URI is set and the host did not answer — which is a DIFFERENT fault from
    the URI never being set at all, and the two need different fixes.
    """
    try:
        from limiter import _STORAGE_URI, limiter
        if not _STORAGE_URI.startswith("redis"):
            return "memory"
        storage = getattr(limiter, "_storage", None)
        if storage is None:
            return "unknown"
        return "redis" if storage.check() else "redis-unreachable"
    except Exception:
        # Never let a diagnostic take the health endpoint down with it.
        return "unknown"


@router.get("/api/health")
async def health():
    db_ok = False
    live_schema = None
    try:
        pool = await get_pool()
        await pool.fetchval("SELECT 1")
        db_ok = True
        # The schema this CONNECTION resolves, read from the connection itself.
        # Reporting the env var instead would report an intention; this reports
        # the fact, and it is what the e2e fence and every cutover check read.
        live_schema = await pool.fetchval("SELECT current_schema()")
    except Exception:
        pass
    return {
        "status": "ok" if db_ok else "degraded",
        "db": "connected" if db_ok else "unreachable",
        "schema": live_schema,
        "environment": os.getenv("ENVIRONMENT", "production"),
        # What THIS process actually runs with — not what the Railway dashboard
        # says the variable is. A config edit is not a deployment (the cron-niyam
        # lesson), so the e2e fence reads the running value here instead of
        # trusting that a var set yesterday reached the service.
        "outbound_mode": outbound.MODE,
        "suppressed_orgs_digest": suppressed_orgs_digest(outbound.SUPPRESSED_ORGS),
        # "memory" means every limit is multiplied by the process count and is
        # non-deterministic; "redis" means a limit means what it says.
        "rate_limit_store": _rate_limit_store(),
        "app": "Kartavaya",
        "by": "Aekam Inc",
        "time": datetime.now(timezone.utc).isoformat()
    }
