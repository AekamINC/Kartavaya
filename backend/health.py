import hashlib
import logging
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


logger = logging.getLogger(__name__)


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

    # ── THE TWO DRIFT VIEWS, WHICH NOTHING HAS EVER READ ────────────────────
    #
    # `v_org_platform_line_drift` and `v_org_credit_drift` were built to prove
    # an invariant that `services/billing_lines.py` states in its own words:
    # "the scalar is a mirror of this line, `v_org_platform_line_drift` must
    # always return zero rows, and either the fee moves in both places or it
    # moves in neither."
    #
    # ⚠ THEY EXISTED ONLY IN THE MIGRATION FILES THAT CREATED THEM. A grep for
    # either name across every .py, .mjs and .js in this repository returned
    # nothing outside migrations 095 and 096 — no route, no cron, no test, no
    # health field. Migration 096 calls the query "the single query to run after
    # each change" and nobody ran it.
    #
    # Measured 2026-08-31: it returns FOUR rows. Four organisations carry a
    # monthly price between Rs 10,000 and Rs 20,000 with no platform line to
    # bill it from - Rs 54,000 a month that no invoice can reach. It has been
    # red the whole time and nothing said so.
    #
    # That is the same family as this programme's dominant finding. An assertion
    # satisfied by its own shape cannot fail because of how it is written; a
    # check nothing executes cannot fail because it never runs. Both are green
    # forever, and both are worse than no check, because somebody believed the
    # invariant was being watched.
    #
    # Reported as a COUNT, never as the rows: this endpoint is unauthenticated,
    # and the rows carry org names and what each is charged. A number says
    # "something has drifted, go and look" without saying whose.
    #
    # Failure to read is reported as null rather than as zero. A view that
    # cannot be queried and a view that is clean must not answer the same way -
    # that is the exact shape of the silence this whole entry exists to end.
    drift = {"platform_line": None, "credits": None}
    for key, view in (("platform_line", "v_org_platform_line_drift"),
                      ("credits", "v_org_credit_drift")):
        try:
            drift[key] = await pool.fetchval(
                f"SELECT count(*) FROM public.{view}")
        except Exception:
            logger.exception("health: %s could not be read", view)

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
        # 0 is the only healthy value for either. A non-zero platform_line count
        # means an organisation is being charged a fee that no invoice can
        # reach; a non-zero credits count means a wallet and its ledger
        # disagree. `null` means the view could not be read at all.
        "billing_drift": drift,
        "app": "Kartavaya",
        "by": "Aekam Inc",
        "time": datetime.now(timezone.utc).isoformat()
    }
