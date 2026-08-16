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
