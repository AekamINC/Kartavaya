"""HTTP surface for the Niyam sweep. Auth and dispatch, and nothing else.

WHY THERE IS NO LOGIC HERE
--------------------------
`tests/test_niyam_import_discipline.py` scopes itself to `services/niyam/**`.
A sweep implemented in this file would be invisible to both ratchets — it could
import an AI client or a raw sender and CI would stay green. So the router is a
shell and every line of behaviour lives in `services/niyam/sweep.py`, where the
checks reach it.

AUTHENTICATION IS A LINE IN THE BODY, NOT A DECORATOR
-----------------------------------------------------
Every cron endpoint in `scheduler.py` is written `@router.post(..., dependencies=[])`
and authenticated by `await _verify_cron(...)` as the first statement of the
handler. `dependencies=[]` is an EMPTY LIST — a no-op that reads like a security
control. Omitting the body line would leave this endpoint open to the internet,
and it would look exactly like its sixteen neighbours.

The secret is read AT CALL TIME, not at import. `scheduler.py:23` reads it into
a module constant, so rotating it needs a redeploy — which contradicts the whole
premise of an off switch someone can flip from a Railway shell at 2am.
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Header, HTTPException

from db import get_pool
from utils import secret_matches

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/internal/niyam", tags=["niyam"])


def _verify(secret: str | None) -> None:
    expected = os.getenv("CRON_SECRET", "")
    if not expected:
        # No secret configured means the endpoint cannot be authenticated, so
        # it is closed rather than open. The opposite default is how an internal
        # endpoint becomes a public one during a botched deploy.
        raise HTTPException(503, "CRON_SECRET is not configured")
    if not secret_matches(secret, expected):
        raise HTTPException(403, "Invalid cron secret")


@router.post("/sweep")
async def sweep(x_cron_secret: str | None = Header(None)):
    """One tick: drain the event outbox, then resume elapsed waits.

    ALWAYS ANSWERS 200 ON A COMPLETED TICK, including a tick that found
    nothing. The Railway cron loops turn any non-200 red, and "nothing was due"
    is not a failure — conflating it with "could not do it" is how a real
    failure gets ignored. The COUNTS in the body are the signal; the status code
    only says the tick ran.
    """
    _verify(x_cron_secret)
    from services.niyam.sweep import tick
    result = await tick(await get_pool())
    if result.get("errors"):
        # Errors are reported, loudly, in a 200 body. A 500 here would make the
        # cron red for a partial failure and would tell a human nothing about
        # which part — and the work that DID succeed is already committed.
        log.warning("niyam sweep: %s error(s) this tick: %s",
                    result["errors"], result)
    return result


@router.get("/status")
async def status(x_cron_secret: str | None = Header(None)):
    """Counts beside flags — the answer to "why is nothing happening?".

    Authenticated the same way, because it reports how many rules an org has
    armed and when the last event arrived. Neither is secret exactly, and
    neither belongs on an unauthenticated internal endpoint either.
    """
    _verify(x_cron_secret)
    from services.niyam.sweep import status as engine_status
    return await engine_status(await get_pool())


@router.post("/prune")
async def prune(keep_days: int = 180, x_cron_secret: str | None = Header(None)):
    """Delete events older than `keep_days`. Deliberately NOT on a schedule.

    ── WHY A ROUTE, AND WHY NOT A CRON ────────────────────────────────────────

    Migration 146 wrote `staging.niyam_prune_events` and said plainly that
    nothing calls it "by design: it is armed deliberately once there is a week
    of real traffic to size it against". That reasoning stands and this route
    does not overturn it — it only makes the function REACHABLE. A function that
    exists in the database and in no code path is one nobody can run without a
    psql session and one nobody will remember exists; that is how migration 081
    ended up with no SQL and nobody noticing.

    So: callable now, scheduled by a human later. Arming it is a Railway edit
    (add `-X POST .../api/internal/niyam/prune` to `cron-daily`), which is the
    same shape every other job here uses and the same shape the owner checklist
    documents for `scraper-prices`.

    ── WHY IT CANNOT BE ARMED CASUALLY ────────────────────────────────────────

    Deleting an event RE-ARMS its dedupe key. `tasks_overdue` is `window="once"`,
    which means "once per retention window" and not "once ever" — so pruning too
    aggressively makes every overdue task notify its assignee a second time
    about a fact they were already told. The function refuses anything under 90
    days by RAISING rather than clamping; this route does not soften that, and
    the error text reaches the caller intact.

    Today the whole table is ~190 rows at roughly 10 a day. Nothing is close to
    needing this, which is why it stays off a timer.
    """
    _verify(x_cron_secret)
    pool = await get_pool()
    try:
        row = await pool.fetchrow(
            "SELECT * FROM staging.niyam_prune_events($1::int)", keep_days)
    except Exception as exc:
        # The floor is a deliberate refusal, not a fault: report it as a 422 the
        # caller can read rather than a 500 that says only "something broke".
        if "below the" in str(exc) and "day floor" in str(exc):
            raise HTTPException(422, str(exc).split("CONTEXT:")[0].strip())
        raise
    return {"keep_days": keep_days,
            "deleted_events": row["deleted_events"],
            "kept_for_runs": row["kept_for_runs"]}
