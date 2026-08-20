"""Dated Indian statute, served to the browser.

── Why this file did not exist ─────────────────────────────────────────────

`staging.statute_calendar` holds 45 rows of dated law — form numbers, sections,
due days, thresholds, rates — each with `effective_from`/`effective_to`, each
carrying a `verified_on`. It is read by `services/statute.py` and by nine skill
handlers through it, and **by no router at all**. Grepped: `statute` appeared
in `backend/routers/` exactly once, in a code comment.

So a 45-row table of the law this whole product exists to help firms obey was
reachable only as a side effect of running a skill. The corner dock's "Due"
tab, the firm's own filing calendar, and any statutory circular a firm might
print all wanted it, and none of them could ask.

── The one rule this surface must not break ────────────────────────────────

`services/statute.py` is the ONLY way to read a statutory fact, and `as_of` is
keyword-only with NO DEFAULT — deliberately, because the alternative is a
caller who forgets it and silently gets whichever version happens to sort
first. The Income-tax Act 2025 transition makes that concrete: 24Q becomes
138, 26Q becomes 140, 16 becomes 130, all on 2026-04-01. A form number without
a date attached is not an answer, it is a coin flip.

So this router NEVER computes a date of its own and never hardcodes a form
number. It takes `as_of` from the caller, defaults it to today when absent —
which is the honest reading of "what applies now" — and ECHOES IT BACK in the
response so that whatever renders the answer can print the date the answer was
true on. A statutory table with no date on the page is the thing this codebase
already has a test against.

── What it does not do ─────────────────────────────────────────────────────

No writes. No arming. No per-client obligations — `staging.client_obligations`
holds zero rows and has no writer anywhere in the product, so a per-client
calendar here would be a confident empty page. The firm-level answer is real
and is what ships.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from db import get_pool
from auth_router import require_user
from services import statute

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/statute", tags=["statute"])

#: The authorities the table actually carries, live: income_tax 22, gst 18,
#: esic 4, epfo 1. Validated against a fixed set rather than passed through,
#: because `authority` reaches a SQL predicate and an allowlist is how every
#: other dynamic identifier in this codebase is handled.
_AUTHORITIES = ("gst", "income_tax", "epfo", "esic")

#: Likewise. `standing` is the interesting one — 18 of the 45 rows are rules
#: with no date at all (rates, ceilings, thresholds), and a "due dates" screen
#: that silently included them would print a deadline for the ESI wage ceiling.
_PERIODICITIES = ("monthly", "quarterly", "annual", "event", "standing")


def _parse_as_of(raw: str | None) -> date:
    """`as_of`, or today. Never a silent wrong date.

    Defaulting to today is the honest reading of an absent parameter — the
    caller is asking what applies now. Guessing at a malformed one is not: a
    caller who sends `31-03-2026` and gets today's answer has been told
    something false about the law, so it is refused.
    """
    if not raw:
        return datetime.now(timezone.utc).date()
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(
            422, f"as_of must be an ISO date (YYYY-MM-DD); got {raw!r}"
        )


@router.get("/obligations")
async def list_obligations(
    as_of: str | None = Query(None, description="ISO date. Defaults to today."),
    authority: str | None = Query(None),
    periodicity: str | None = Query(None),
    state_code: str | None = Query(None),
    key_prefix: str | None = Query(None),
    user=Depends(require_user),
):
    """Every obligation in force on `as_of`, one row per obligation key.

    NOT ORG-SCOPED, and that is correct rather than an oversight: the law is
    the same for every tenant. There is no org predicate to add because there
    is no org column — `statute_calendar` carries `state_code`, not `org_id`.
    `require_user` is here because this is a product surface and not a public
    one, not because the rows are anybody's data.

    One row per key, resolved through `services.statute` so that a caller
    cannot render both the 24Q row and its 138 successor in one table and leave
    a reader to work out which applies.
    """
    stamp = _parse_as_of(as_of)

    if authority and authority not in _AUTHORITIES:
        raise HTTPException(422, f"authority must be one of {list(_AUTHORITIES)}")
    if periodicity and periodicity not in _PERIODICITIES:
        raise HTTPException(422, f"periodicity must be one of {list(_PERIODICITIES)}")

    pool = await get_pool()
    rows = await statute.obligations(
        pool,
        as_of=stamp,
        authority=authority,
        periodicity=periodicity,
        state_code=state_code,
        key_prefix=key_prefix,
    )

    return {
        # Echoed back so the renderer can print the date the answer was true
        # on. A statutory table with no date on the page is exactly what the
        # form renumbering made dangerous.
        "as_of": stamp.isoformat(),
        "filters": {
            "authority": authority, "periodicity": periodicity,
            "state_code": state_code, "key_prefix": key_prefix,
        },
        "data": rows,
        "count": len(rows),
        # Said out loud rather than left for a reader to infer from an empty
        # `due_day`. 18 of the 45 live rows are standing rules — rates,
        # ceilings, thresholds — which have no date and must not be rendered
        # as though they were deadlines.
        "note": (
            "Rows with periodicity 'standing' are rules in force, not "
            "deadlines: they carry a rate, a threshold or a ceiling and no due "
            "date. Filter on periodicity to separate them."
        ),
    }
