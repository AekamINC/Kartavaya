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
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

# `_onboarding_column_exists` is imported rather than re-probed so BOTH the read
# path (`GET /api/auth/me`, which the onboarding gate depends on) and the write
# path below share ONE cached answer about whether migration 116 has been
# applied. Two independent probes would disagree for up to one process lifetime
# after the migration runs — the gate seeing the column while the writer still
# refuses, or the reverse — and the user-visible shape of that is a wizard that
# will not stay finished.
from auth_router import _onboarding_column_exists, require_user
from db import get_pool
from middleware.roles import require_org_role
from middleware.role_tiers import ORG_SETTINGS_ROLES
from middleware.org_resolver import get_org_id
from services import email_senders
from services.gstin import GSTINError
from services.gstin import validate as validate_gstin

router = APIRouter(prefix="/api/v1/org/profile", tags=["org-profile"])

#: Every column this router reads back, in one place, so GET and the PATCH
#: RETURNING clause cannot drift apart. They did not drift before only because
#: nobody had added a column since they were written.
#:
#: `logo_key` is SELECTed by GET but is not here: it is the storage key GET uses
#: to mint a fresh signed `logo_url`, and it is not part of the profile a caller
#: edits.
_PROFILE_COLUMNS = (
    # `tan` sits beside gstin/pan because it is the same kind of thing — a
    # statutory registration number printed on documents the firm issues.
    #
    # It was missing, and the consequence was not cosmetic: the TDS challan
    # (ITNS-281) refuses without a TAN and told the user "Set it in Settings →
    # Organisation → Company Profile", where there was no such field. The form
    # was otherwise complete and correct, so the challan could be filled in full
    # and then never issued — the same shape as the invoice that cannot be
    # edited. Measured live on 2026-07-29.
    #
    # `staging.organisations.tan` already existed as a column; nothing was wired
    # to it. `documents.py` still carried a comment saying TAN had no column and
    # read it out of `settings` instead — that is now stale and is corrected
    # there.
    "name", "gstin", "pan", "tan", "billing_address", "logo_url", "email", "phone",
    "website", "bank_details", "invoice_note",
    "description", "industry", "team_size", "founded_year",
)

#: TAN — four letters, five digits, one letter (e.g. `AHMA12345B`). Unlike a
#: GSTIN it carries no check digit, so shape is the only thing that can be
#: verified at entry; that still catches the transposition and length mistakes
#: which are what people actually make.
_TAN_RE = re.compile(r"^[A-Z]{4}[0-9]{5}[A-Z]$")

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
    tan: str | None = None
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

    #: TEXT, not an integer, and the design reference settles what was a guess
    #: when this was written: `SetOrg.jsx` renders team size as a select of
    #: BANDS — 1-10, 11-50, 51-200, 200+ — never a count. TEXT accepts a band;
    #: INTEGER rejects it and there is no migration back from a rejected save.
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
    # jsonb comes back as a STRING whenever the codec in `db.py` failed to
    # register — `_init_conn` retries three times and then only warns, because
    # PgBouncer drops connections mid-handshake. `documents.py:101` already
    # carries this same guard for the same columns; without it here, the client
    # receives a string where it declared a dict and spreads it character by
    # character. Parse defensively so the response shape is the contract
    # regardless of how the connection was set up.
    for col in _JSONB_COLUMNS:
        if isinstance(d.get(col), str):
            try:
                d[col] = json.loads(d[col] or "{}")
            except json.JSONDecodeError:
                d[col] = {}
        # A doubly-encoded row written before the `::text::jsonb` fix decodes to
        # a string a second time. Unwrap it rather than handing the caller the
        # same broken shape the fix exists to prevent.
        if isinstance(d.get(col), str):
            try:
                d[col] = json.loads(d[col] or "{}")
            except json.JSONDecodeError:
                d[col] = {}
        # Strip the character-indexed keys a previous spread-of-a-string left
        # behind, so an already-corrupted row renders its real fields instead of
        # 122 junk ones.
        if isinstance(d.get(col), dict):
            d[col] = {k: v for k, v in d[col].items() if not k.isdigit()}
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
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
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

    # The GSTIN carries a check digit exactly so a typo is catchable at entry.
    # `ganit._checked_gstin` has validated vendor and customer numbers for a
    # while; this path — the org's OWN number, the one that goes on every
    # invoice and into every return — did not, and accepted whatever was typed.
    #
    # Measured on staging 2026-07-28: the live org holds `24AAAAA0000A1Z5`,
    # whose correct check digit is `8`. That is the common dummy number so it is
    # very likely test data, but it could only have been stored because nothing
    # here checked. GSTR-1 emits this value as `gstin`, so an unvalidated number
    # does not surface until the portal rejects the return — the same
    # months-later failure `_checked_gstin` was written to prevent, on the one
    # number that appears in every document the firm sends.
    #
    # Blank stays legal, as it is for vendors: an unregistered firm has no
    # GSTIN, and the Tally and GSTR-1 exports already refuse without one and say
    # so. Refusing loudly here matches what this handler does two blocks above
    # for a missing column — it never writes a partial update.
    if "gstin" in fields:
        raw = fields["gstin"]
        if raw and str(raw).strip():
            try:
                fields["gstin"] = validate_gstin(raw)
            except GSTINError as exc:
                raise HTTPException(400, str(exc)) from exc
        else:
            fields["gstin"] = ""

    # Same treatment as the GSTIN above, and blank stays legal for the same
    # reason: a firm that deducts no tax at source has no TAN, and the challan
    # already refuses without one and says so. Uppercased before checking
    # because a TAN is conventionally written in caps and nobody types it that
    # way reliably — rejecting `ahma12345b` would be pedantry, not validation.
    if "tan" in fields:
        raw = fields["tan"]
        if raw and str(raw).strip():
            candidate = str(raw).strip().upper().replace(" ", "")
            if not _TAN_RE.match(candidate):
                raise HTTPException(
                    400,
                    "TAN must be four letters, five digits and one letter — "
                    f"for example AHMA12345B. Got '{str(raw).strip()}'.",
                )
            fields["tan"] = candidate
        else:
            fields["tan"] = ""

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
            # `::text::jsonb`, NOT `::jsonb`. `db.py` registers a jsonb codec
            # whose encoder IS `json.dumps`, so binding an already-dumped string
            # to a `$n::jsonb` parameter dumps it a SECOND time: the column ends
            # up holding a JSON *string* scalar rather than an object, and the
            # matching decoder hands that string back on read.
            #
            # That is not theoretical — it corrupted this org's address live.
            # `TabProfile.jsx` merges the response with
            # `{...EMPTY.billing_address, ...r.data.billing_address}`; spreading
            # a STRING in JS yields `{0:'{', 1:'"', …}`, so the saved value came
            # back with 122 character-indexed keys beside the six real ones, and
            # every address field rendered blank while reporting "saved".
            #
            # Casting through `text` makes asyncpg infer the parameter as text,
            # so the jsonb codec never applies and Postgres does the parse. That
            # is correct whether or not the codec registered — which matters,
            # because `_init_conn` only WARNS when PgBouncer defeats it.
            sets.append(f"{key}=${idx}::text::jsonb")
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


# ═════════════════════════════════════════════════════════════════════════════
# ONBOARDING — THE WRITE THAT LETS A USER OUT OF THE WIZARD
# ═════════════════════════════════════════════════════════════════════════════
#
# `Protected.jsx` redirects an org whose `onboarding_complete` is false onto
# `/onboarding`, and until this endpoint existed NOTHING in the product could
# set that field: `OnboardingPage.finish()` removed a localStorage key and
# navigated, and `skipAll()` did not touch the network at all. A gate with no
# exit is a trap, and this is the exit.
#
# It lives on the org profile router because that is the router that owns
# `staging.organisations` — the same table, the same `get_org_id` resolution,
# the same `ORG_SETTINGS_ROLES` guard as `PATCH /api/v1/org/profile` above.
#
# ── WHY IT ANSWERS 200 WHEN MIGRATION 116 IS UNAPPLIED ───────────────────────
#
# Every other pending-migration path in this file refuses with a 503 that names
# the migration, and that is right THERE because the alternative is reporting
# success over a value that was silently dropped. Here nothing is dropped. While
# the column is absent `auth_router._org_for` reports every org as
# `onboarding_complete: true`, so the state this call is trying to reach is
# already the state the caller is in — and when 116 is eventually applied its
# backfill writes TRUE into this org's row anyway. There is nothing to lose and
# nothing to come back for.
#
# So it answers honestly instead of loudly: `recorded: false` says the write did
# not happen, `onboarding_complete: true` says the caller is nonetheless out of
# the wizard, and the note says why. A 503 here would push the wizard into its
# failure toast on every single completion for as long as 116 sits unapplied —
# alarming the user about a condition that has no effect on them.


class OnboardingComplete(BaseModel):
    #: TRUE when the user pressed "Skip setup entirely" rather than walking the
    #: steps. It does NOT change whether they get out — a skip that left the flag
    #: false would bounce them straight back onto the wizard they just dismissed.
    #: It records which of StepDone's endings actually happened, so a later
    #: "finish setting up" prompt can find the orgs that skipped.
    skipped: bool = False


#: First call wins, and a second call is a no-op rather than a 409.
#:
#: The wizard RETRIES — `finish()` navigates whether or not this POST lands, and
#: a user who was told "we could not record it" and comes back tomorrow presses
#: the button again. A conflict status on the second press would be an error
#: message about a thing that is already correct.
#:
#: `onboarding_skipped` is guarded by the CASE rather than overwritten, so a
#: replay cannot rewrite history in either direction: an org that genuinely
#: walked the steps is not later marked skipped, and an org that skipped is not
#: later marked as having completed. `COALESCE` does the same job for the
#: timestamp, and leaves it NULL for the orgs migration 116 backfilled — which is
#: a real third state meaning "this org predates the flag".
_COMPLETE_ONBOARDING = """
UPDATE staging.organisations
   SET onboarding_complete     = TRUE,
       onboarding_completed_at = COALESCE(onboarding_completed_at, NOW()),
       onboarding_skipped      = CASE WHEN onboarding_complete
                                      THEN onboarding_skipped ELSE $1 END
 WHERE id = $2::uuid
RETURNING id::text AS id, name, onboarding_complete, onboarding_skipped,
          onboarding_completed_at
"""


@router.post("/onboarding-complete")
async def complete_onboarding(
    body: OnboardingComplete,
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """Mark this organisation's setup as finished (or deliberately skipped).

    `ORG_SETTINGS_ROLES` — org_owner and org_admin — is the same guard the
    profile PATCH above carries, and it is the same set `Protected.jsx` requires
    before it will redirect anyone. Those two must agree: the gate may only trap
    a caller who is able to make this call, or an ordinary member of an org whose
    owner never finished setup is stuck on the wizard permanently with every
    button on it 403ing.
    """
    pool = await get_pool()

    if not await _onboarding_column_exists(pool):
        return {
            "id": org_id,
            "onboarding_complete": True,
            "onboarding_skipped": body.skipped,
            "onboarding_completed_at": None,
            "recorded": False,
            "note": (
                "staging.organisations.onboarding_complete does not exist yet, "
                "so nothing was written. Nothing is lost: every org reports as "
                "complete while the column is absent, and applying "
                "migrations/116_onboarding_complete.sql backfills this one to "
                "complete as well. Setup is finished either way."
            ),
        }

    row = await pool.fetchrow(_COMPLETE_ONBOARDING, body.skipped, org_id)
    if not row:
        raise HTTPException(404, "Organisation not found")
    d = dict(row)
    d["recorded"] = True
    return d


# ═════════════════════════════════════════════════════════════════════════════
# PER-PURPOSE SENDER ADDRESSES
# ═════════════════════════════════════════════════════════════════════════════
#
# Today every message in the product leaves as `FROM_EMAIL`, one Railway
# environment variable. A payslip, a marketing campaign and a password reset all
# arrive from the same address, so a recipient who blocks the marketing blocks
# their payslip with it. `services/email_senders.py` carries the full argument
# and the map from ~30 notification purposes onto these nine buckets.
#
# ── THIS SCREEN SITS ON A TABLE THAT DOES NOT EXIST YET ──────────────────────
#
# `staging.org_email_senders` is migration 110, which is a FILE and is NOT
# applied — `to_regclass` returns NULL on the live database as this ships.
#
# The precedent for what to do about that is 300 lines above, in this same file:
# `_available_columns` probes for `PROPOSED_068`'s four columns, GET keeps a
# stable response shape while they are missing, and PATCH refuses with a 503
# that names the migration rather than accepting a value it would silently
# drop. The reasoning transfers exactly, and so does the reason it matters:
# naming a missing relation in a SELECT raises `UndefinedTableError`, and an
# unguarded handler here would 500 the sender screen for a feature nobody has
# switched on.
#
# So:
#   · GET always returns all nine buckets, with `available: false` when the
#     table is absent, so the screen renders its nine rows either way and can
#     say plainly why they are disabled.
#   · PUT refuses with 503 naming migration 110. It does NOT report success
#     over a write it did not make — which is the whole complaint TabProfile.jsx
#     raised about the four profile fields, in its own words.
#
# ── is_verified IS NOT ON THIS FORM, AND MUST NEVER BE ───────────────────────
#
# An unverified From does not degrade delivery, it fails it: Resend answers 403
# "the domain is not verified" and SES answers MessageRejected. Verification is
# DKIM/SPF records published in DNS and confirmed in the provider's dashboard —
# there is no API call this product can make to perform it and no webhook wired
# up to learn that it happened.
#
# A checkbox an org can tick to assert their DNS is correct is a control that
# lies, and the thing it lies about is whether payslips arrive. So `SenderRow`
# has no `is_verified` field, pydantic drops the key if a client sends one, and
# the flag is set by Aekam by hand after looking at the dashboard — the
# statement is in migration 110's verification block. Until then the row is
# stored, shown on this screen, and NOT USED: `email_senders.pick_from` treats
# unverified as unconfigured and returns FROM_EMAIL.

#: Whether `staging.org_email_senders` exists. Cached only once the answer is
#: YES, for `_available_columns`'s reason: the migration may be applied under a
#: long-running process, and a permanently cached "no" would keep the screen
#: disabled until the next redeploy.
_senders_table: bool = False


async def _senders_table_exists(pool) -> bool:
    global _senders_table
    if _senders_table:
        return True
    row = await pool.fetchrow(
        "SELECT to_regclass('staging.org_email_senders') IS NOT NULL AS ok"
    )
    _senders_table = bool(row and row["ok"])
    return _senders_table


class SenderRow(BaseModel):
    """One bucket's address. Deliberately three fields and not four."""
    purpose: str
    #: Empty or whitespace CLEARS the row — that is how a bucket goes back to
    #: FROM_EMAIL. A separate DELETE endpoint would mean the form had two ways
    #: to say the same thing and the frontend had to choose between them.
    from_email: str | None = None
    from_name: str | None = None

    @field_validator("purpose")
    @classmethod
    def _known_purpose(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in email_senders.SENDER_PURPOSES:
            # The DB CHECK would refuse this too, but as a 500. Refusing here
            # names the value and the nine legal ones.
            raise ValueError(
                f"'{v}' is not a sender purpose. One of: "
                f"{', '.join(email_senders.SENDER_PURPOSES)}"
            )
        return v

    @field_validator("from_email")
    @classmethod
    def _shape(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        addr = v.strip()
        # The same expression migration 110 CHECKs and `email_senders` re-checks
        # on read. Three layers on purpose: this one produces a 400 the user can
        # act on, the CHECK stops a hand-written row, and the read-side strip is
        # the boundary — the value lands in an RFC 5322 `From:` header and a CR
        # or LF in it splits that header open.
        if not email_senders.is_address(addr):
            raise ValueError(
                f"'{addr}' is not a plain email address. Enter the address "
                "only - the display name goes in its own field, so "
                "'Payroll <payroll@example.com>' belongs in two fields, not one."
            )
        return addr

    @field_validator("from_name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        name = v.strip()
        if email_senders.has_control_chars(name):
            raise ValueError("The display name cannot contain line breaks.")
        if len(name) > email_senders.MAX_NAME:
            raise ValueError(
                f"The display name is limited to {email_senders.MAX_NAME} characters."
            )
        return name


class SendersUpdate(BaseModel):
    senders: list[SenderRow]


#: VERIFICATION SURVIVES A DISPLAY-NAME EDIT AND DIES WITH A DOMAIN CHANGE.
#:
#: Both providers verify the DOMAIN, so moving payroll@acme.com to
#: payroll2@acme.com is still covered by the same DNS records, while moving it
#: to payroll@other.com is not — and carrying the old TRUE across would send the
#: next payslip from an address the provider rejects outright.
#:
#: Written as an expression rather than a flat `is_verified = FALSE` because the
#: alternative makes every typo fix in a display name silently switch the
#: feature off for that bucket, with nothing on the screen explaining why the
#: address stopped being used.
_UPSERT_SENDER = """
INSERT INTO staging.org_email_senders (org_id, purpose, from_email, from_name)
VALUES ($1::uuid, $2, $3, $4)
ON CONFLICT (org_id, purpose) DO UPDATE
   SET from_email  = EXCLUDED.from_email,
       from_name   = EXCLUDED.from_name,
       is_verified = (
           staging.org_email_senders.is_verified
           AND split_part(EXCLUDED.from_email, '@', 2)
             = split_part(staging.org_email_senders.from_email, '@', 2)
       )
"""


def _empty_senders() -> list[dict]:
    """All nine buckets, unconfigured. The response shape, always."""
    return [
        {
            "purpose": p,
            "label": email_senders.PURPOSE_LABELS[p],
            "from_email": None,
            "from_name": None,
            # Split from "configured" deliberately. An org can have entered an
            # address that is not being used, and collapsing the two into one
            # boolean is how a screen ends up claiming a feature is on when it
            # is not.
            "is_verified": False,
        }
        for p in email_senders.SENDER_PURPOSES
    ]


@router.get("/senders")
async def get_senders(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """The nine buckets and what this org has put in them.

    `fallback` is what every unconfigured — and every unverified — bucket
    actually sends from, and it is returned so the screen can show it rather
    than leave the user guessing what "not configured" resolves to.
    """
    import email_service

    pool = await get_pool()
    rows_by_purpose: dict[str, dict] = {}
    available = await _senders_table_exists(pool)
    if available:
        for row in await pool.fetch(
            "SELECT purpose, from_email, from_name, is_verified "
            "FROM staging.org_email_senders WHERE org_id=$1::uuid",
            org_id,
        ):
            rows_by_purpose[str(row["purpose"])] = dict(row)

    senders = _empty_senders()
    for entry in senders:
        row = rows_by_purpose.get(entry["purpose"])
        if row:
            entry["from_email"] = row["from_email"]
            entry["from_name"] = row["from_name"]
            entry["is_verified"] = bool(row["is_verified"])

    return {
        "senders": senders,
        # From `email_service`, not from the environment directly: that module
        # owns the constant and the senders read it at call time, so reading it
        # anywhere else here would let the screen show one address while the
        # product sends from another.
        "fallback": email_service.FROM_EMAIL,
        "available": available,
        # What the screen must tell the user, in the one place that knows it.
        # Neither half of it is something the product can do for them.
        "verification_note": (
            "Addresses are stored but not used until the domain is verified "
            "with the email provider. That is DNS - DKIM and SPF records "
            "published at your registrar and confirmed in the provider's "
            "dashboard - and it cannot be done from inside Kartavaya. Tell "
            "Aekam once the domain shows as verified and we will switch it on."
        ),
    }


@router.put("/senders")
async def put_senders(
    body: SendersUpdate,
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """Save the addresses. Blank clears a bucket back to the default sender."""
    pool = await get_pool()
    if not await _senders_table_exists(pool):
        raise HTTPException(
            503,
            "Sender addresses cannot be saved yet: staging.org_email_senders "
            "does not exist. Apply migrations/110_org_email_senders.sql, then "
            "retry. Nothing was saved.",
        )

    seen: set[str] = set()
    for row in body.senders:
        if row.purpose in seen:
            # Two rows for one bucket means the form disagrees with itself and
            # whichever lands last silently wins. Refuse before writing any of
            # them — the profile handler above never writes a partial update
            # either.
            raise HTTPException(400, f"'{row.purpose}' appears twice.")
        seen.add(row.purpose)

    async with pool.acquire() as conn:
        # ONE TRANSACTION FOR THE WHOLE FORM. A partial save here is worse than
        # no save: the buckets would be split across two sending identities with
        # nothing on the screen saying which half took.
        async with conn.transaction():
            for row in body.senders:
                if row.from_email is None:
                    await conn.execute(
                        "DELETE FROM staging.org_email_senders "
                        "WHERE org_id=$1::uuid AND purpose=$2",
                        org_id, row.purpose,
                    )
                    continue
                await conn.execute(_UPSERT_SENDER,
                                   org_id, row.purpose, row.from_email, row.from_name)

    # The resolver caches an org's nine rows for five minutes. Clearing here is
    # what makes a save visible to the next send instead of to the send after
    # the TTL — and it is scoped to this org, because one org saving a form must
    # not cost every other org a fresh query.
    email_senders.invalidate(org_id)

    return await get_senders(user=user, org_id=org_id)
