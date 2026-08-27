"""pincodes.py — what a six-digit Indian PIN actually is, in one request.

Phase 8.2's missing half. Two agents building on 7.2 and 7.3 independently
reported the same gap, in the same words: there is no per-PIN route, so a
screen that has a pincode and wants to say anything true about it has to walk
the CRM's territories to find one that claims it, and then ask that territory
for its shapes.

That workaround is not merely awkward, it is EMPTY where it matters. Measured
live 2026-08-27, read-only:

    E2E Test & Associates    17 territories    0 client pincodes
    Unicode Group             0 territories   21 client pincodes

Every client pincode in the product belongs to the organisation with no
territory. The territory route draws nothing for the only org that has
addresses to draw. This endpoint is what makes 8.2 work at all.

── IT IS NOT A CRM FEATURE, AND IT IS NOT A MAPPLS FEATURE ──────────────────

Its own router rather than `graha.py`, for the reason `maps.py` already gives:
Manav employees, Kray vendors, Vikray shipping addresses and Pahchan sites all
carry a PIN, and none of them should ask the CRM for permission to name a
district. Graha's module `_gate` is genuinely lost by that choice.

And NOT in `maps.py` either, though the prefix would have fitted: nothing here
touches Mappls. There is no key, no allocation, no quota and no vendor licence
over anything submitted, because nothing is submitted — both datasets are
Government of India releases we already hold, one in a table (7.2) and one in
our own R2 bucket (7.3). A route under `/maps` would imply a vendor cost that
this one does not have, and the first person to reason about the Mappls
allocation would have to read the code to find that out.

── THE TWO DATASETS DISAGREE, IN BOTH DIRECTIONS ────────────────────────────

This is the fact the response shape exists to carry, and merging it away is
the whole risk here:

    58 PINs in the directory have NO published boundary.
    531 PINs WITH a boundary are absent from the directory.

So `directory` and `boundary_status` are independent, and neither is derived
from the other. A PIN can be named "SURAT, GUJARAT" with no shape to draw, and
a PIN can draw perfectly while this product cannot say which district it is
in. Both are ordinary. Reporting one as evidence about the other would be
inventing an answer out of a dataset that does not contain it.

── A PIN IS NOT UNIQUE, AND `directory` IS A LIST FOR THAT REASON ───────────

1,229 PINs span more than one district and 51 span more than one state.
`110020` is both SOUTH DELHI and SOUTH EAST DELHI. There is no "the" district
for a PIN, so there is no single-object shape this response could honestly
take, and `services/pin_directory.LOOKUP_SQL` carries no `LIMIT 1`.
"""
import logging

from fastapi import APIRouter, Depends, Request

from auth_router import require_user
from db import get_pool
from limiter import limiter
from services import pin_boundaries, pin_directory
from services.territory_routing import normalise_pin

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/pincodes", tags=["pincodes"])


@router.get("/{pincode}")
@limiter.limit("60/minute")
async def pincode_detail(request: Request, pincode: str, user=Depends(require_user)):
    """One PIN: which districts it covers, and its postal boundary.

    ── ALWAYS 200 ───────────────────────────────────────────────────────────

    The same rule as `/territories/{id}/geometry` and `/maps/token`, and here
    it carries more than usual: a caller needs to distinguish four states that
    a 4xx would collapse into one broken panel.

        valid            false -> this is not a PIN at all. `NW1 245` is live
                         in Unicode Group's `INC UK`. Nothing else is
                         populated, and the value is NOT corrected.
        directory        the rows, possibly several, possibly NONE. Empty
                         means "this release does not list it" and never
                         "no such place".
        boundary_status  drawn / unmatched / unavailable — 7.3's buckets,
                         unmerged. `unavailable` means R2 did not answer and
                         WE DO NOT KNOW whether a shape exists; saying
                         `unmatched` there would be this product telling a
                         customer their pincode has no area during an outage
                         of ours.

    A PIN that is in neither dataset answers 200 with an empty `directory` and
    `unmatched`, which is the true and complete answer: we hold two government
    releases and neither mentions it.

    ── WHY `require_user` AND A LIMIT, FOR PUBLIC GOVERNMENT DATA ───────────

    Not to protect the data — it is published, and GODL-India is why we may
    serve it at all. The limit is because the boundary half streams shards out
    of R2, and an unauthenticated loop over six-digit numbers would be a bill
    for egress on somebody else's public dataset. 60/minute is roughly twice
    the address-suggest limit because this costs us bandwidth rather than a
    metered third-party allocation.
    """
    raw = "" if pincode is None else str(pincode).strip()
    pin = normalise_pin(raw)

    if not pin:
        # ONE definition of "is this a PIN" — routing's — so this endpoint
        # accepts exactly the set that `staging.pin_directory`'s CHECK stores
        # and that `pin_boundaries` looks up. A laxer answer here would offer
        # a lookup the rest of the product refuses.
        return {
            "pincode": raw[:32],
            "valid": False,
            "directory": [],
            "boundary": None,
            "boundary_status": "invalid",
            "vintage": pin_boundaries.VINTAGE,
            "attribution": pin_boundaries.ATTRIBUTION,
        }

    pool = await get_pool()
    rows = await pin_directory.lookup(pool, pin)

    # `blocks` is jsonb. Through the pool it arrives decoded, because `db.py`
    # registers the codecs; through a bare `asyncpg.connect()` — every
    # `railway run` script and every live test — it arrives as a string. This
    # route only ever holds a pool, so the decoded shape is what ships; the
    # guard is here because the two shapes are the documented trap in
    # `tests/helpers.py` and a reader copying this line may not have a pool.
    directory = [
        {
            "state": r["state"],
            "district": r["district"],
            "blocks": r["blocks"] if isinstance(r["blocks"], list) else [],
            "state_lgd": r["state_lgd"],
            "district_lgd": r["district_lgd"],
            "source_vintage": r["source_vintage"],
        }
        for r in rows
    ]

    # One PIN, through the same function the territory map uses, so the two
    # cannot disagree about what a boundary is or which bucket a failure lands
    # in. It takes RAW entries and normalises them itself.
    cover = await pin_boundaries.geometry_for_pins([pin])

    if cover.features:
        status = "drawn"
    elif cover.unavailable:
        status = "unavailable"
    else:
        status = "unmatched"

    return {
        "pincode": pin,
        "valid": True,
        # Empty is a real answer and is NOT an error: 531 PINs that draw are
        # absent from this release.
        "directory": directory,
        "boundary": cover.features[0] if cover.features else None,
        "boundary_status": status,
        "vintage": pin_boundaries.VINTAGE,
        "attribution": pin_boundaries.ATTRIBUTION,
    }
