"""The income-tax slab ladder, as something a person can set.

Phase 5.2b. A separate router file rather than four more routes in
`routers/vetana.py`, for one reason worth stating: 5.1 is rewiring
`_compute_statutory` in that file at the same time as this lands, and two
authors editing one 2,700-line module is how a merge silently drops a branch of
a payroll computation. The prefix is `/api/v1/vetana` either way, so the API
surface is identical to what it would have been — `GET /v1/vetana/it-slabs`
sits beside `GET /v1/vetana/pt-slabs` and the frontend cannot tell which file
served it.

── THE TWO RULES, WHICH ARE THE PROFESSIONAL-TAX RULES ─────────────────────

1. A SHARED ROW IS READ BY EVERYONE AND EDITABLE BY NOBODY. `org_id IS NULL`
   is national reference data seeded by migration 228; letting one firm PATCH
   it would change every other firm's deductions from inside their own settings
   screen. So the write endpoints are scoped `org_id = $1::uuid` with no NULL
   branch, and an organisation that wants a different ladder ADDS ITS OWN
   BANDS. A 404 on somebody else's row is the same answer a row that does not
   exist gets, which is the only answer that does not confirm it is there.

2. NOTHING HERE IS REQUIRED AND NOTHING HERE BLOCKS A RUN. An org that sets
   nothing keeps the shared ladder; an org that sets none at all deducts ₹0.
   The validation below refuses an UNINTERPRETABLE BAND at the moment somebody
   types it — a band whose top is at or beneath its own bottom is zero rupees
   wide and can never tax anything — and that is a refusal to SAVE, never a
   refusal to run payroll.

── WHERE THIS DEPARTS FROM `pt-slabs`, AND WHY THE SCREEN NEEDS IT ─────────

Professional tax picks ONE band. Income tax slices across all of them, so a
ladder with a hole in it silently untaxes a slice of somebody's salary and a
ladder with an overlap would double-tax one were the clamp in
`services/income_tax.py::annual_tax` not there. Neither may ever refuse a run,
so neither is a validation error — but an administrator looking at the ladder
is exactly the person who can fix it. `GET` therefore returns, beside the rows,
WHICH GENERATION IS IN FORCE and WHERE IT DOES NOT JOIN UP. A settings screen
that shows twelve bands without saying which six of them apply today is a
screen that will be misread.

⚠ AN ORG'S OWN BANDS REPLACE THE SHARED LADDER WHOLESALE, not band by band.
Adding a single band for the new regime means that band IS the org's entire new
regime ladder and the shared seven are no longer read. That is the correct
reading of "this firm has said something more specific", it is what
`_generation` implements, and it is the one thing about this screen that will
surprise somebody — so the response says so and the screen prints it.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.role_tiers import (
    ADMIN, any_level_satisfies, require_module_or_self,
)
# The resolution rule, imported rather than reimplemented. If this screen
# decided for itself which generation was in force, the screen and the payroll
# run would be two implementations of one rule — and a disagreement between
# them would be invisible, because both would show a plausible ladder.
from services import income_tax

router = APIRouter(prefix="/api/v1/vetana", tags=["vetana-payroll"])

MODULE = "vetana"

#: The same gate `routers/vetana.py` puts on every one of its routes. Its value
#: is the caller's Tier-4 level set, resolved once per request.
_gate = require_module_or_self(MODULE)

#: Every column the screen reads. Listed rather than `SELECT *`.
_COLS = (
    "id, org_id, regime, slab_from, slab_to, rate_percent, effective_from, "
    "assessment_year, source_ref, notes, (org_id IS NOT NULL) AS is_own"
)


def _require_admin(levels) -> None:
    if any_level_satisfies(levels, ADMIN, MODULE):
        return
    raise HTTPException(
        403,
        "Setting the income-tax ladder needs 'admin' on Vetana. Without a "
        "grant you can see which rate applies to you and nothing else.",
    )


class ItSlabCreate(BaseModel):
    regime: str = income_tax.DEFAULT_REGIME
    #: The annual taxable figure the rate applies ABOVE — a contiguous
    #: threshold, not an inclusive bound. See migration 228's column COMMENT.
    slab_from: float = 0
    #: …and the figure it applies UP TO. None means "and above".
    slab_to: Optional[float] = None
    rate_percent: float = 0
    effective_from: str = ""
    assessment_year: str = ""
    source_ref: str = ""
    notes: str = ""


class ItSlabUpdate(BaseModel):
    regime: Optional[str] = None
    slab_from: Optional[float] = None
    slab_to: Optional[float] = None
    rate_percent: Optional[float] = None
    effective_from: Optional[str] = None
    assessment_year: Optional[str] = None
    source_ref: Optional[str] = None
    notes: Optional[str] = None


def _check_band(regime, slab_from, slab_to, rate_percent) -> None:
    """Refuse a band that could never mean anything. SAVE-TIME ONLY.

    Every message names the fix rather than the rule. A settings screen that
    says "constraint violated" has told an administrator nothing they can act
    on, and this is the screen where acting on it means somebody's pay.
    """
    if regime is not None and str(regime).strip().lower() not in income_tax.REGIMES:
        raise HTTPException(
            400,
            "A band belongs to either the new regime or the old one. "
            f"'{regime}' is neither, and a band filed under a regime nothing "
            "reads would deduct nothing while looking set.",
        )
    if slab_from is not None and float(slab_from) < 0:
        raise HTTPException(400, "A band cannot start below zero.")
    if (slab_to is not None and slab_from is not None
            and float(slab_to) <= float(slab_from)):
        raise HTTPException(
            400,
            "This band ends at or below where it starts, so it is zero rupees "
            "wide and could never tax anything. The upper figure is the income "
            "the rate applies UP TO — leave it blank for 'and above'.",
        )
    if rate_percent is not None and not (0 <= float(rate_percent) <= 100):
        raise HTTPException(400, "A rate must be between 0 and 100 per cent.")


@router.get("/it-slabs")
async def list_it_slabs(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """The whole ladder this org resolves against, plus what is actually in force.

    Returns every band — the org's own AND the shared ones, each flagged —
    because a screen showing only the org's own rows would present an empty
    ladder as "no tax is deducted" while twenty-three shared bands were in fact
    doing the work. That is the mistake `pt-slabs` documents having avoided.

    `resolved` is the answer `services/income_tax.py` would give a payroll run
    dated today: which generation wins per regime, whether it is the org's own,
    and where it fails to join up. Not gated to ADMIN — seeing which rate
    applies to you is not privileged.
    """
    from datetime import date as _date

    pool = await get_pool()
    rows = await pool.fetch(
        f"SELECT {_COLS} FROM public.pay_income_tax_slabs "
        " WHERE org_id = $1::uuid OR org_id IS NULL "
        " ORDER BY regime, effective_from NULLS FIRST, slab_from",
        org_id,
    )
    today = _date.today()
    in_force = await income_tax.ladders(pool, org_id, today)

    resolved = {}
    for regime in income_tax.REGIMES:
        bands = in_force.get(regime) or []
        resolved[regime] = {
            "as_at": str(today),
            "band_count": len(bands),
            "effective_from": (str(bands[0]["effective_from"])
                               if bands and bands[0].get("effective_from")
                               else None),
            "assessment_year": (bands[0].get("assessment_year")
                                if bands else None),
            # TRUE means this org has replaced the shared ladder WHOLESALE for
            # this regime. The screen prints that sentence, because adding one
            # band and expecting the other six to survive is the one wrong
            # model somebody will arrive with.
            "is_own": bool(bands and bands[0].get("is_own")),
            "advisories": income_tax.gaps_and_overlaps(bands),
        }

    return {"data": [dict(r) for r in rows], "resolved": resolved}


@router.post("/it-slabs")
async def create_it_slab(
    body: ItSlabCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Add a band to THIS organisation's ladder. Never touches a shared row."""
    pool = await get_pool()
    _require_admin(levels)
    _check_band(body.regime, body.slab_from, body.slab_to, body.rate_percent)
    row = await pool.fetchrow(
        "INSERT INTO public.pay_income_tax_slabs "
        "(org_id, regime, slab_from, slab_to, rate_percent, effective_from, "
        " assessment_year, source_ref, notes, created_by) "
        # `::text::date`, never a bare `::date` on an ISO string — that bind is
        # the asyncpg DataError this repo has already paid for twice.
        "VALUES ($1::uuid, $2, $3, $4, $5, NULLIF($6,'')::text::date, "
        "        NULLIF($7,''), NULLIF($8,''), NULLIF($9,''), $10) "
        f"RETURNING {_COLS}",
        org_id,
        str(body.regime or income_tax.DEFAULT_REGIME).strip().lower(),
        body.slab_from, body.slab_to, body.rate_percent,
        body.effective_from or "",
        str(body.assessment_year or "").strip(),
        str(body.source_ref or "").strip(),
        str(body.notes or "").strip(),
        user["user_id"],
    )
    return dict(row)


@router.patch("/it-slabs/{slab_id}")
async def update_it_slab(
    slab_id: int,
    body: ItSlabUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Amend one of THIS organisation's own bands.

    `model_fields_set` rather than a truthiness test, so a figure entered by
    mistake can be cleared back: `rate_percent = 0` is a real answer — the nil
    band of every ladder in the country is exactly that — and must stay
    distinguishable from "not mentioned". The pattern `billing.py:1187`
    documents and `vetana.py::update_pt_slab` follows.
    """
    pool = await get_pool()
    _require_admin(levels)
    named = getattr(body, "model_fields_set", set())
    if not named:
        raise HTTPException(400, "Nothing to change.")

    current = await pool.fetchrow(
        "SELECT regime, slab_from, slab_to, rate_percent "
        "  FROM public.pay_income_tax_slabs WHERE id=$1 AND org_id=$2::uuid",
        slab_id, org_id,
    )
    # 404, not 403 — the same answer a row that does not exist gets, because a
    # distinct refusal would confirm somebody else's row is there.
    if not current:
        raise HTTPException(404, "Income-tax band not found")
    _check_band(
        body.regime if "regime" in named else current["regime"],
        body.slab_from if "slab_from" in named else current["slab_from"],
        body.slab_to if "slab_to" in named else current["slab_to"],
        body.rate_percent if "rate_percent" in named else current["rate_percent"],
    )

    sets, params = [], []
    for col in ("slab_from", "slab_to", "rate_percent"):
        if col in named:
            params.append(getattr(body, col))
            sets.append(col + "=$" + str(len(params)))
    if "regime" in named:
        params.append(str(body.regime or "").strip().lower())
        sets.append("regime=$" + str(len(params)))
    for col in ("assessment_year", "source_ref", "notes"):
        if col in named:
            params.append(str(getattr(body, col) or "").strip())
            sets.append(col + "=NULLIF($" + str(len(params)) + ",'')")
    if "effective_from" in named:
        params.append(body.effective_from or "")
        sets.append("effective_from=NULLIF($" + str(len(params))
                    + ",'')::text::date")
    if not sets:
        raise HTTPException(400, "Nothing to change.")
    params.append(user["user_id"])
    sets.append("updated_by=$" + str(len(params)))
    sets.append("updated_at=NOW()")

    params.extend([slab_id, org_id])
    row = await pool.fetchrow(
        "UPDATE public.pay_income_tax_slabs SET " + ", ".join(sets) +
        " WHERE id=$" + str(len(params) - 1) +
        " AND org_id=$" + str(len(params)) + "::uuid "
        f"RETURNING {_COLS}",
        *params,
    )
    if not row:
        raise HTTPException(404, "Income-tax band not found")
    return dict(row)


@router.delete("/it-slabs/{slab_id}")
async def delete_it_slab(
    slab_id: int,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    levels=Depends(_gate),
):
    """Remove one of THIS organisation's own bands.

    A hard delete, because the table carries no `is_active` and a soft-deleted
    band that `ladders()` still read would tax a slice of somebody's salary
    nobody could see a reason for.

    ⚠ REMOVING THE LAST OF AN ORG'S OWN BANDS FOR A REGIME HANDS THAT REGIME
    BACK TO THE SHARED LADDER, which is the fallback working as designed and is
    a bigger change than "one row went away". The screen says so before it asks.
    """
    pool = await get_pool()
    _require_admin(levels)
    result = await pool.execute(
        "DELETE FROM public.pay_income_tax_slabs "
        " WHERE id=$1 AND org_id=$2::uuid",
        slab_id, org_id,
    )
    if result == "DELETE 0":
        raise HTTPException(404, "Income-tax band not found")
    return {"ok": True}
