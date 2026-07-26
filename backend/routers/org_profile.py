"""
org_profile.py — Company profile (self-service).
Powers the invoice PDF letterhead: name, GSTIN/PAN, address, logo, contact
details, bank/UPI details for payment, and a custom invoice footer note.

── The four fields the frontend deliberately refused to render ───────────────
`TabProfile.jsx` omits `description`, `industry`, `team_size` and `founded_year`
and says why, in its own header:

    "`ProfileUpdate` in `backend/routers/org_profile.py` does not carry them and
    pydantic drops unknown keys without complaining, so a field for any of them
    would accept what the user typed, report "saved", and lose it on reload."

That was true and is verified: `staging.organisations` had no such columns, and
`ProfileUpdate` had no such names — a PATCH naming them returned 200 and wrote
nothing, because `body.dict(exclude_unset=True)` can only contain keys the model
declares. Both halves are fixed together, and they must stay together:

  · the four names below, and
  · `migrations/PROPOSED_068_org_profile_fields.sql`, which adds the columns.

── Why the columns are PROBED rather than assumed ───────────────────────────
Staging and production share one Supabase project, so the migration is proposed
as a file and is NOT applied by whoever merges this. This code therefore reaches
a running database that still has ten profile columns, not fourteen — and naming
a missing column in SELECT or RETURNING raises `UndefinedColumnError`, which
would take the ENTIRE company profile down (GET and PATCH both) for a feature
nobody has switched on yet. Landing that would be strictly worse than the
silent-drop bug it replaces.

So `_available_columns()` asks the catalogue once which of the four exist, and:

  · GET returns the four keys as `null` while they are absent, so the response
    shape never changes under the frontend.
  · PATCH naming an absent field returns **503 naming the field and the
    migration** — it does NOT drop the value. That is the whole point: the
    frontend's objection was to a save that reports success and loses the text.
    A refusal that says why is honest; a silent 200 is not.

The day `PROPOSED_068` is applied the probe re-runs and the fields start working
with no code change. Nothing here needs a redeploy to notice.
"""
import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from auth_router import require_user
from db import get_pool
from middleware.roles import require_org_role
from middleware.org_resolver import get_org_id

router = APIRouter(prefix="/api/v1/org/profile", tags=["org-profile"])

#: Every column this router reads back, in one place, so GET and the PATCH
#: RETURNING clause cannot drift apart. They did not drift before only because
#: nobody had added a column since they were written.
#:
#: `logo_key` is SELECTed by GET but is not here: it is the storage key GET uses
#: to mint a fresh signed `logo_url`, and it is not part of the profile a caller
#: edits.
_PROFILE_COLUMNS = (
    "name", "gstin", "pan", "billing_address", "logo_url", "email", "phone",
    "website", "bank_details", "invoice_note",
    "description", "industry", "team_size", "founded_year",
)

#: Columns held as jsonb. Anything here is dumped and cast; everything else is
#: passed as-is.
_JSONB_COLUMNS = frozenset({"billing_address", "bank_details"})

#: Free text caps. These are not arbitrary politeness — `description` prints on
#: nothing yet but is stored per org, and an unbounded TEXT accepted from a form
#: is a row-size problem waiting to be found by whoever pastes a document into
#: it. The DB has a matching CHECK; this bound exists so the failure is a 400
#: that names the field rather than a 500 from a constraint violation.
_MAX_DESCRIPTION = 2000
_MAX_INDUSTRY = 120
_MAX_TEAM_SIZE = 40

#: Nothing was founded before this, and a year in the future is a typo.
_MIN_FOUNDED_YEAR = 1800

#: The columns `PROPOSED_068_org_profile_fields.sql` adds. Everything in
#: `_PROFILE_COLUMNS` that is NOT in here has existed since 047 and is assumed.
_PENDING_COLUMNS = frozenset({"description", "industry", "team_size", "founded_year"})

#: Probe result, or None until the first probe succeeds. Columns are never
#: dropped, so once all four are seen this is final and the probe stops.
_columns_present: frozenset[str] | None = None


async def _available_columns(pool) -> frozenset[str]:
    """
    Which of `_PENDING_COLUMNS` the live table actually has.

    Cached, but NOT cached permanently while the answer is incomplete: the
    migration may be applied against a long-running process, and a stale "no"
    would silently drop exactly the fields this change exists to stop dropping.
    A complete answer is cached forever — `ALTER TABLE ... DROP COLUMN` is not
    something a migration in this project does, and re-asking on every request
    for the rest of time is a query per page load.
    """
    global _columns_present
    if _columns_present is not None and _columns_present == _PENDING_COLUMNS:
        return _columns_present
    rows = await pool.fetch(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema='staging' AND table_name='organisations' "
        "AND column_name = ANY($1::text[])",
        list(_PENDING_COLUMNS),
    )
    _columns_present = frozenset(r["column_name"] for r in rows)
    return _columns_present


def _selectable(available: frozenset[str]) -> tuple[str, ...]:
    """`_PROFILE_COLUMNS` minus the pending ones the table does not have yet."""
    return tuple(
        c for c in _PROFILE_COLUMNS
        if c not in _PENDING_COLUMNS or c in available
    )


class ProfileUpdate(BaseModel):
    name: str | None = None
    gstin: str | None = None
    pan: str | None = None
    billing_address: dict | None = None
    logo_url: str | None = None
    email: str | None = None
    phone: str | None = None
    website: str | None = None
    bank_details: dict | None = None
    invoice_note: str | None = None

    # ── The four from 10-org-settings.md §4 ────────────────────────────────
    description: str | None = None
    industry: str | None = None

    #: TEXT, not an integer. The control for this has not been built, and the
    #: design calls it "team size" without saying whether it is a count or a
    #: band. TEXT accepts "12" and "11-50"; INTEGER rejects the band and there is
    #: no migration back from a rejected save. A column that accepts what the
    #: eventual control produces is the one that cannot be wrong here.
    team_size: str | None = None

    #: A real year, so it is a real integer and is range-checked. Stored
    #: SMALLINT — 32767 is comfortably past any founding date.
    founded_year: int | None = None

    @field_validator("description")
    @classmethod
    def _cap_description(cls, v: str | None) -> str | None:
        if v is not None and len(v) > _MAX_DESCRIPTION:
            raise ValueError(f"description is limited to {_MAX_DESCRIPTION} characters")
        return v

    @field_validator("industry")
    @classmethod
    def _cap_industry(cls, v: str | None) -> str | None:
        if v is not None and len(v) > _MAX_INDUSTRY:
            raise ValueError(f"industry is limited to {_MAX_INDUSTRY} characters")
        return v

    @field_validator("team_size")
    @classmethod
    def _cap_team_size(cls, v: str | None) -> str | None:
        if v is not None and len(v) > _MAX_TEAM_SIZE:
            raise ValueError(f"team_size is limited to {_MAX_TEAM_SIZE} characters")
        return v

    @field_validator("founded_year")
    @classmethod
    def _check_founded_year(cls, v: int | None) -> int | None:
        # None is how the field is cleared, and must stay legal.
        if v is None:
            return v
        # +1 because a company registered in December for the coming year is a
        # real thing and refusing it would be the more annoying error.
        latest = date.today().year + 1
        if v < _MIN_FOUNDED_YEAR or v > latest:
            raise ValueError(
                f"founded_year must be between {_MIN_FOUNDED_YEAR} and {latest}"
            )
        return v


@router.get("")
async def get_profile(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()
    available = await _available_columns(pool)
    row = await pool.fetchrow(
        f"SELECT {', '.join(_selectable(available))}, logo_key "
        "FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )
    if not row:
        raise HTTPException(404, "Organisation not found")
    d = dict(row)
    # A stable response shape whether or not the migration has run. TabProfile
    # merges the response over a fixed EMPTY object and diffs against it on
    # save, so a key that appears and disappears between deploys would make a
    # field look "changed" the first time it is seen.
    for col in _PENDING_COLUMNS:
        d.setdefault(col, None)
    if d.get("logo_key"):
        from services.storage import sign_key
        d["logo_url"] = await sign_key(org_id, d["logo_key"]) or d.get("logo_url", "")
    return d


@router.patch("")
async def update_profile(
    body: ProfileUpdate,
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()
    fields = body.dict(exclude_unset=True)
    if not fields:
        raise HTTPException(400, "Nothing to update")

    # Refuse before writing anything, and name the field. The alternative — drop
    # the key and UPDATE the rest — is the exact behaviour TabProfile.jsx
    # refused to build a control against.
    available = await _available_columns(pool)
    missing = sorted(set(fields) & (_PENDING_COLUMNS - available))
    if missing:
        raise HTTPException(
            503,
            f"{', '.join(missing)} cannot be saved yet: the column"
            f"{'s are' if len(missing) > 1 else ' is'} not on "
            "staging.organisations. Apply "
            "migrations/PROPOSED_068_org_profile_fields.sql, then retry. "
            "Nothing was saved — your other edits were not written either.",
        )

    sets, params, idx = [], [], 1
    for key, val in fields.items():
        # `key` is interpolated into SQL, so it must be a name this file chose,
        # never one the caller did. It always is: `fields` comes from
        # `body.dict(exclude_unset=True)`, whose keys can only be the fields
        # declared on ProfileUpdate. The belt-and-braces check keeps that true
        # if the model ever grows a `model_config` that admits extras.
        if key not in _PROFILE_COLUMNS:
            raise HTTPException(400, f"Unknown profile field: {key}")
        if key in _JSONB_COLUMNS:
            sets.append(f"{key}=${idx}::jsonb")
            params.append(json.dumps(val or {}))
        else:
            sets.append(f"{key}=${idx}")
            params.append(val)
        idx += 1

    params.append(org_id)
    row = await pool.fetchrow(
        f"UPDATE staging.organisations SET {', '.join(sets)} WHERE id=${idx}::uuid "
        f"RETURNING {', '.join(_selectable(available))}",
        *params,
    )
    if not row:
        # An org_admin whose org row vanished between the guard and the UPDATE.
        # Returning dict(None) raised TypeError here before, which reached the
        # client as a 500 with no explanation.
        raise HTTPException(404, "Organisation not found")
    d = dict(row)
    for col in _PENDING_COLUMNS:
        d.setdefault(col, None)
    return d
