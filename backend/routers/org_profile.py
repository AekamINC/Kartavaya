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
import logging
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response
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
from services import email_senders, upi
from services.gst_states import GST_STATES, RETIRED_STATE_CODES, norm_state
from services.gstin import GSTINError
from services.gstin import normalise as normalise_gstin
from services.gstin import validate as validate_gstin

log = logging.getLogger(__name__)

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
    # `state_code` is the numeric GST state code of the place this firm supplies
    # FROM — '24' Gujarat, '27' Maharashtra. It sits with gstin/pan/tan because
    # it is the same kind of thing, and it was missing for the same reason and
    # with the same consequence, one field over from the TAN note above.
    #
    # ⚠ THIS TUPLE IS THREE THINGS AT ONCE — the GET projection, the PATCH
    # writable allowlist and the RETURNING list — so a column absent from it can
    # be neither read back nor written through this router. Nothing else in the
    # product writes `organisations.state_code` either: `grep` finds only
    # SELECTs (`client_billing.py:132`, `procurement.py:575`), and the one
    # INSERT that creates an organisation (`admin_orgs.py:679`) does not name the
    # column, so every org is born with it NULL.
    #
    # The consequence is not cosmetic. `client_billing._tax_split` REFUSES
    # outright when it is empty — "this organisation has no state_code, so an
    # invoice cannot be taxed as inter- or intra-state. Set the organisation's
    # state in Settings -> Profile." — pointing at this screen, where there was
    # no such field. That is the TDS-challan failure repeated exactly: a form
    # that is otherwise complete, a document that can be filled in full and then
    # never issued, and a message naming a control that does not exist.
    #
    # Measured live 2026-08-29: 2 of 5 organisations (Aekam Inc, Demo -
    # Kartavaya) hold NULL and could not raise a GST invoice by any route. The
    # three that carry a code got it by migration or by hand, never through the
    # product — `GET /api/v1/org/profile` returned no `state_code` key at all
    # while the column held '24', and a PATCH naming it answered
    # "Nothing to update" because pydantic had already dropped the key.
    "name", "gstin", "pan", "tan", "state_code", "billing_address", "logo_url",
    "email", "phone",
    "website", "bank_details", "invoice_note",
    "description", "industry", "team_size", "founded_year",
)

#: Everything above, plus the one column this handler writes without the caller
#: ever naming it. `logo_key` stays out of `_PROFILE_COLUMNS` because that tuple
#: is also the RETURNING list and the GET projection, and it stays off
#: `ProfileUpdate` on purpose — see `_logo_key_from_url`.
_WRITABLE_COLUMNS = _PROFILE_COLUMNS + ("logo_key",)

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

#: `logo_url` is a URL and nothing else. It carried no validator at all while
#: the three fields above it each carried one, so a PATCH could put
#: `data:image/png;base64,…` — the whole image — into `staging.organisations`.
#: Nothing has to be broken for that to happen: this is a JSON field taking a
#: client-supplied string, so the file lands in the column while object storage
#: is perfectly healthy. A presigned R2 URL is around 500 characters, so 2048 is
#: a URL's bound rather than an image's.
_MAX_LOGO_URL = 2048

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
        "WHERE table_schema = ANY(current_schemas(false)) AND table_name='organisations' "
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


async def _logo_key_from_url(org_id: str, url: str) -> str:
    """The object key behind one of our own storage URLs — verified, not guessed.

    `logo_key` is the durable half of the company logo and NOTHING has ever
    written it: migration 057 backfilled it once and no router has touched it
    since. So a firm that uploads a logo stores only the presigned URL
    `POST /api/upload` handed back, that URL expires in nine hours, and by the
    evening `GET` below and `pay.py:_logo_url` have nothing to re-sign from and
    the letterhead is a broken image. It is the same missing pointer that left
    five executed e-sign PDFs unservable.

    The key is RECOVERED here rather than accepted from the body deliberately:
    `ProfileUpdate` does not declare `logo_key`, so an org admin cannot aim the
    profile at an arbitrary object in the org's bucket and have this API sign it
    for them.

    Verified by round trip. The candidate comes off the URL path — R2 is
    addressed path-style, `/<bucket>/<key>`, the assumption
    `storage.refresh_signed_url` has always made — and is then RE-SIGNED, and
    accepted only when the fresh signature addresses the same object. A wrong
    key is worse than no key, because `GET` prefers `logo_key`: it would replace
    a URL that works for nine hours with one that never works at all.
    """
    from urllib.parse import urlparse
    from services.storage import sign_key

    want = urlparse(url).path
    path = want.lstrip("/")
    if not path:
        return ""
    # Bucket-first (R2), then whole (local disk, whose URLs carry no bucket).
    candidates = ([path.split("/", 1)[1]] if "/" in path else []) + [path]
    for key in candidates:
        if not key:
            continue
        signed = await sign_key(org_id, key)
        if signed and urlparse(signed).path == want:
            return key
    return ""


class ProfileUpdate(BaseModel):
    name: str | None = None
    gstin: str | None = None
    pan: str | None = None
    tan: str | None = None

    #: The numeric GST state code, and it is NOT validated here.
    #:
    #: A `field_validator` that raises produces a **422** with pydantic's own
    #: envelope, and this project has already paid for that once — "an empty box
    #: was a 422, and 184 sites could not read the reason". The rule the owner
    #: set for this field is a **400 naming the field**, so the check lives in
    #: the handler beside the GSTIN and TAN ones, which are there for the same
    #: reason: they need to speak in this router's voice, not pydantic's.
    #:
    #: Declared `str` rather than a constrained type so 'MH', 'Maharashtra' and
    #: '4' all reach `norm_state` and are canonicalised, instead of being
    #: refused by a shape rule before anything has tried to understand them.
    state_code: str | None = None

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

    @field_validator("logo_url")
    @classmethod
    def _check_logo_url(cls, v: str | None) -> str | None:
        # Clearing the logo stays legal — it is how a firm removes it, and the
        # handler clears `logo_key` with it.
        if v is None:
            return v
        url = v.strip()
        if not url:
            return ""
        if url.lower().startswith("data:"):
            raise ValueError(
                "logo_url must be the URL of an uploaded file, not the file "
                "itself. Upload the image to POST /api/upload and send back the "
                "url it returns."
            )
        if len(url) > _MAX_LOGO_URL:
            raise ValueError(f"logo_url is limited to {_MAX_LOGO_URL} characters")
        return url

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
        "FROM public.organisations WHERE id=$1::uuid",
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
    # WHICH organisation this request actually resolved to, echoed back.
    #
    # It is here because on 2026-08-28 an E2E suite renamed Aekam Inc while
    # believing it was editing Unicode Group: the credential held
    # `platform_admin`, every request resolved to Aekam via `platform_bypass`,
    # and the save succeeded — so the suite went green. Nothing on this screen,
    # and nothing in this response, could have told it otherwise.
    #
    # `org_id` is the resolver's own answer — the same value the UPDATE below
    # writes against — so a caller can assert the target BEFORE it writes
    # instead of discovering it in someone else's audit log. That is what
    # `frontend/e2e-real/_lanes.ts::assertOrg` reads.
    #
    # It does not breach the names-not-IDs rule: that rule is about what a
    # screen RENDERS, and this is a field no component displays. TabProfile
    # merges the response over a fixed EMPTY object and diffs the two on save,
    # so an unchanged key is never sent back on PATCH.
    d["id"] = org_id
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
            "public.organisations. Apply "
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
    # ── GSTIN, PAN AND TAN NEVER BLOCK A SAVE. Owner's ruling, 2026-08-08 ──
    #
    # "all gst, pan, tan needs to be non mandatory so no check on org page",
    # after "not all indian company needs GST" — which is the law rather than a
    # preference. GST registration starts at the turnover threshold; a firm
    # below it has none. TAN exists only if the firm deducts tax at source. PAN
    # is near-universal but is still not this product's business to demand.
    #
    # Blank was already legal for all three. What was NOT was a non-empty value
    # our own pattern disagreed with: that returned 400 and refused the WHOLE
    # profile save, including every unrelated field on the form. The failure
    # mode of that is the expensive one — if our check digit or our regex is
    # wrong for some legitimate number, a real firm cannot save its real
    # details and has nothing to argue with. Guessing wrong in that direction
    # costs a customer their afternoon; the other direction costs a typo that
    # someone corrects later.
    #
    # So values are STORED as typed (normalised) and the complaints travel back
    # in `code_warnings` for the screen to show beside each field. The reason to
    # keep the messages at all is unchanged: GSTR-1 emits the GSTIN and the TDS
    # challan emits the TAN, so a typo otherwise surfaces months later when a
    # portal rejects a return. A warning catches that; a refusal was never
    # needed to.
    code_warnings: dict[str, str] = {}

    #
    # "org GST is not mandatory so it doesn't need to match the database of
    # GST" / "not all indian company needs GST" — which is the law: registration
    # is required only above the turnover threshold.
    #
    # Blank was already legal. What was NOT was a non-empty number our check
    # digit disagreed with: that returned 400 and the whole profile save was
    # refused. The failure mode of that is the expensive one — if our checksum
    # implementation is wrong for some legitimate number, a real firm cannot
    # save its real GSTIN and cannot proceed, and it has nothing to argue with.
    # Guessing wrong in that direction costs a customer their afternoon; the
    # other direction costs a corrected typo.
    #
    # So the value is STORED as typed (normalised), and the complaint travels
    # back as `gstin_warning` for the screen to show beside the field. The
    # reason to keep the message at all is unchanged: GSTR-1 emits this number,
    # and a typo otherwise surfaces months later when the portal rejects the
    # return. A warning catches that; a refusal was never needed to.
    if "gstin" in fields:
        raw = fields["gstin"]
        if raw and str(raw).strip():
            try:
                fields["gstin"] = validate_gstin(raw)
            except GSTINError as exc:
                fields["gstin"] = normalise_gstin(raw)
                code_warnings["gstin"] = str(exc)
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
            # Stored either way — see the note above. A TAN carries no check
            # digit, so shape is all that can be verified at entry, and a shape
            # rule is exactly the kind of thing that is wrong about some real
            # number nobody anticipated.
            if not _TAN_RE.match(candidate):
                code_warnings["tan"] = (
                    "A TAN is four letters, five digits and one letter — for "
                    f"example AHMA12345B. '{str(raw).strip()}' does not look "
                    "like one. It has been saved as typed."
                )
            fields["tan"] = candidate
        else:
            # NULL, NOT "". The database models "this firm has no TAN" as NULL:
            #
            #   organisations_tan_format
            #   CHECK ((tan IS NULL) OR (tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'))
            #
            # read from pg_constraint on 2026-08-28, not from a migration file.
            # An empty string satisfies neither arm, so clearing the field wrote
            # a value the column refuses and asyncpg raised CheckViolationError
            # — a 500 that escaped before the CORS headers were attached, so the
            # browser reported `net::ERR_FAILED` and the screen said only
            # "Failed to save profile".
            #
            # The cost of that was not one field. The PATCH carries the whole
            # form, so a firm clearing a TAN it no longer needs lost its name,
            # address and bank details in the same click, and was told nothing
            # about why. Found by driving the real form on 2026-08-28; the
            # intent in the comment above was always right ("blank stays legal")
            # and only the encoding of "blank" was wrong.
            fields["tan"] = None

    # ── THE GST STATE CODE ────────────────────────────────────────────────────
    #
    # ⚠ EMPTY MUST STAY SAVEABLE, AND THAT IS THE HALF THAT MATTERS MOST HERE.
    #
    # Two live organisations hold NULL today. Blocking a blank would lock both
    # of them out of saving their NAME, their address and their bank details —
    # the whole form, over a field they have never been able to fill in. That is
    # the identical failure the TAN block above exists to prevent, and it is the
    # standing rule this product keeps re-learning: a statutory code never
    # blocks a save. Blank is written as **NULL, not ""**, so "nobody has said"
    # has one representation on the column rather than two — the same reasoning
    # as the TAN, arrived at from the opposite direction: there is no CHECK
    # here forcing the issue, and a column holding both NULL and '' for one
    # meaning is how an `IS NULL` filter starts lying.
    #
    # ── WHY A NON-EMPTY BAD VALUE IS REFUSED, WHERE A BAD GSTIN IS NOT ────────
    #
    # The GSTIN and TAN warn instead of blocking because the thing judging them
    # is OUR regex and OUR check digit, and being wrong about a legitimate
    # number costs a real firm its afternoon with nothing to argue with. That
    # asymmetry does not exist here, for three reasons:
    #
    #   · The state codes are a CLOSED, PUBLISHED codelist of 40 values — not
    #     our guess at a format. `services/gst_states.GST_STATES` is that list.
    #   · The column is `varchar(2)` (information_schema, live, 2026-08-29). A
    #     three-character value does not warn, it raises
    #     StringDataRightTruncation — an instant 500 that escapes before the
    #     CORS headers, so the browser reports `net::ERR_FAILED` and the screen
    #     says only "Failed to save profile". That is this repo's signature
    #     failure and it is what a warning-only path would have shipped.
    #   · Storing an unrecognised code is WORSE than refusing it. Every reader
    #     goes through `norm_state`, which answers None for anything off the
    #     list, and `_tax_split` then refuses the invoice with "this
    #     organisation has no state_code" — while this screen displays a value.
    #     The user would be told to set a field they can see is already set.
    #
    # So: refused, as a 400 that names the field and says nothing was saved —
    # the same shape as the doc-prefix refusals below, and never a 422.
    #
    # A SELECT is the only control that writes this, so the refusal is
    # unreachable from the product; it is the guard for a hand-made request.
    if "state_code" in fields:
        raw = fields["state_code"]
        if raw is None or not str(raw).strip():
            fields["state_code"] = None
        else:
            # Accepts '27', 27, 'MH', 'mh' and 'Maharashtra'; canonicalises all
            # of them to '27'. Generous on the way in precisely so the refusal
            # below fires only on something genuinely unrecognisable, and so
            # this router agrees with `manav` and `vetana`, which already
            # normalise the same three spellings for the same reason.
            code = norm_state(raw)
            if code is None:
                raise HTTPException(
                    400,
                    f"'{str(raw).strip()}' is not a GST state code. It is a "
                    "two-digit code from the published list — 24 Gujarat, 27 "
                    "Maharashtra, 29 Karnataka, and so on, plus 97 Other "
                    "Territory and 99 Centre Jurisdiction. Leave it empty if "
                    "you would rather not say. Nothing was saved.",
                )
            fields["state_code"] = code
            # 25 (Daman and Diu) merged into 26 on 26 January 2020 and 28
            # (undivided Andhra Pradesh) died with the 2014 bifurcation. Both
            # still appear on old registrations, so they RESOLVE — refusing
            # them would refuse a firm its own historic GSTIN prefix. Neither
            # can be issued today though, so a new one is almost certainly a
            # typo, and that travels back in `code_warnings` exactly as the
            # GSTIN and TAN complaints do.
            if code in RETIRED_STATE_CODES:
                code_warnings["state_code"] = (
                    f"{GST_STATES[code][1]} ({code}) is no longer issued on new "
                    "GST registrations. It has been saved as chosen — check it "
                    "against your GSTIN if this firm registered recently."
                )

    # ── The logo's durable half ───────────────────────────────────────────────
    #
    # The upload endpoint answers with a presigned URL that lapses in nine hours
    # and with the KEY that signed it; the profile has only ever stored the URL,
    # which is why `logo_key` has not been written by any router since migration
    # 057 backfilled it, and why the letterhead goes blank overnight. The key is
    # recovered from the URL the caller just received — see `_logo_key_from_url`
    # for why it is derived and verified rather than taken from the body.
    #
    # Clearing the logo clears BOTH halves, or GET would keep re-signing the
    # removed one for ever and the logo could never be taken off.
    #
    # A derivation that fails does not fail the save: this handler's whole
    # posture is that one field must not refuse a form, and a missing pointer
    # leaves the profile exactly where it already was.
    if "logo_url" in fields:
        submitted = (fields.get("logo_url") or "").strip()
        if not submitted:
            fields["logo_key"] = ""
        else:
            try:
                derived = await _logo_key_from_url(org_id, submitted)
            except Exception as exc:                 # noqa: BLE001 — logged, not swallowed
                derived = ""
                log.warning("org profile: could not derive logo_key for org %s: %s",
                            org_id, exc)
            if derived:
                fields["logo_key"] = derived

    sets, params, idx = [], [], 1
    for key, val in fields.items():
        # `key` is interpolated into SQL, so it must be a name this file chose,
        # never one the caller did. It always is: `fields` comes from
        # `body.dict(exclude_unset=True)`, whose keys can only be the fields
        # declared on ProfileUpdate — plus `logo_key`, which this handler puts
        # there itself and which `ProfileUpdate` deliberately does not declare.
        # The belt-and-braces check keeps that true if the model ever grows a
        # `model_config` that admits extras.
        if key not in _WRITABLE_COLUMNS:
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
        f"UPDATE public.organisations SET {', '.join(sets)} WHERE id=${idx}::uuid "
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
    # Always present so the screen can clear previous complaints without having
    # to remember them — an empty object means "saved, and nothing looks wrong".
    d["code_warnings"] = code_warnings
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
UPDATE public.organisations
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
                "public.organisations.onboarding_complete does not exist yet, "
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
        "SELECT to_regclass('org_email_senders') IS NOT NULL AS ok"
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
INSERT INTO public.org_email_senders (org_id, purpose, from_email, from_name)
VALUES ($1::uuid, $2, $3, $4)
ON CONFLICT (org_id, purpose) DO UPDATE
   SET from_email  = EXCLUDED.from_email,
       from_name   = EXCLUDED.from_name,
       is_verified = (
           public.org_email_senders.is_verified
           AND split_part(EXCLUDED.from_email, '@', 2)
             = split_part(public.org_email_senders.from_email, '@', 2)
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
            "FROM public.org_email_senders WHERE org_id=$1::uuid",
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
            "Sender addresses cannot be saved yet: public.org_email_senders "
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
                        "DELETE FROM public.org_email_senders "
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


# ═════════════════════════════════════════════════════════════════════════════
# RECEIVING UPI ADDRESSES — ONE PER PLATFORM
# ═════════════════════════════════════════════════════════════════════════════
#
# `staging.organisations.upi_vpa` holds one address. A firm holds separate
# accounts with Paytm, PhonePe and Google Pay, each settling separately, and
# picks which one receives. Migration 129 moves that into a row per platform and
# keeps the column as the default row's mirror — `routers/pay.py`,
# `admin_orgs.py` and `subscription.py` all still read it.
#
# ── This screen moves real money and has no gateway behind it ────────────────
#
# A wrong character in a VPA does not fail. It pays a stranger who happens to
# hold that handle, silently, with no callback and nothing to reverse. That
# single fact shapes the design:
#
#   · The QR preview is not decoration. It is the only check in the entire flow
#     that the address belongs to the org — scanning it shows the account
#     holder's name as their own bank reports it, which a form cannot.
#   · Suffixes are NOT validated. A PhonePe user may hold `@ybl`, `@ibl`,
#     `@axl` or a bank handle registered years ago; rejecting a working address
#     for the sake of tidiness leaves the user with nothing to argue with.
#   · Addresses are normalised to lower case before storage, because UPI
#     handles are case-insensitive and an org would otherwise be able to store
#     what is really one address twice.
#
# The table follows the `TabSenders` precedent for a migration that may not be
# applied: GET answers with `available: false` rather than 500ing the settings
# page, and PUT refuses with a 503 naming the file rather than reporting a save
# it did not make.

_upi_table: bool = False


async def _upi_table_exists(pool) -> bool:
    """Cached only once the answer is YES — `_senders_table_exists`'s reason:
    a permanently cached NO would keep the screen disabled until a redeploy."""
    global _upi_table
    if _upi_table:
        return True
    row = await pool.fetchrow(
        "SELECT to_regclass('org_upi_accounts') IS NOT NULL AS ok"
    )
    _upi_table = bool(row and row["ok"])
    return _upi_table


class UpiRow(BaseModel):
    platform: str
    #: Blank CLEARS the row, exactly as it does for sender addresses. One way
    #: to say a thing, so there is nothing for a separate DELETE to disagree
    #: with.
    vpa: str | None = None
    payee_name: str | None = None
    is_active: bool = True
    is_default: bool = False

    @field_validator("platform")
    @classmethod
    def _known(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in upi.PLATFORMS:
            raise ValueError(
                f"'{v}' is not a UPI platform. One of: {', '.join(upi.PLATFORMS)}"
            )
        return v

    @field_validator("vpa")
    @classmethod
    def _shape(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        addr = upi.normalise(v)
        if not upi.is_vpa(addr):
            raise ValueError(
                f"'{v.strip()}' is not a UPI ID. It looks like "
                "'yourname@bank' - one '@', no spaces."
            )
        return addr

    @field_validator("payee_name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        name = " ".join(v.split())          # collapses any control character
        if len(name) > upi.MAX_PAYEE_NAME:
            raise ValueError(
                f"The payee name is limited to {upi.MAX_PAYEE_NAME} characters."
            )
        return name


class UpiUpdate(BaseModel):
    accounts: list[UpiRow]


#: Said on the screen and returned from the API so the two cannot drift. Every
#: word of it is a consequence the org cannot discover from the form itself.
UPI_NOTICE = (
    "These IDs appear on every invoice link you share, to anyone who holds the "
    "link. That is what the link is for, and it is worth knowing before you "
    "save. Scan each code with your own phone before sending an invoice: a "
    "mistyped UPI ID does not fail, it pays whoever does hold that ID, and "
    "there is no gateway to reverse it."
)


def _upi_shape() -> list[dict]:
    """Every platform, in order, unconfigured. The response shape, always."""
    return [
        {
            "platform": p,
            "label": upi.PLATFORM_LABELS[p],
            "hint": upi.PLATFORM_HINTS[p],
            "vpa": None,
            "payee_name": None,
            "is_active": True,
            "is_default": False,
        }
        for p in upi.PLATFORMS
    ]


@router.get("/upi-accounts")
async def get_upi_accounts(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()
    org = await pool.fetchrow(
        "SELECT name FROM public.organisations WHERE id=$1::uuid", org_id
    )
    org_name = (org["name"] if org else "") or ""

    available = await _upi_table_exists(pool)
    stored: dict[str, dict] = {}
    if available:
        for row in await pool.fetch(
            "SELECT platform, vpa, payee_name, is_active, is_default "
            "FROM public.org_upi_accounts WHERE org_id=$1::uuid",
            org_id,
        ):
            stored[str(row["platform"])] = dict(row)

    accounts = _upi_shape()
    for entry in accounts:
        row = stored.get(entry["platform"])
        if row:
            entry["vpa"] = row["vpa"]
            entry["payee_name"] = row["payee_name"]
            entry["is_active"] = bool(row["is_active"])
            entry["is_default"] = bool(row["is_default"])

    return {
        "accounts": accounts,
        "available": available,
        # So the screen can show what an unnamed row will actually display to
        # the payer, rather than leaving "optional" to be guessed at.
        "org_name": org_name,
        "notice": UPI_NOTICE,
    }


#: The document types a firm can renumber. Anything outside this set is
#: refused rather than stored: an unknown key would sit in `settings` looking
#: configured and be read by nothing.
DOC_TYPES = ("tax_invoice", "proforma", "credit_note", "debit_note", "quotation")

#: What each is called when a firm has said nothing. Mirrors
#: `routers/ganit.DEFAULT_DOC_PREFIXES`; the test keeps them equal.
BUILTIN_PREFIXES = {
    "tax_invoice": "INV", "proforma": "PI", "credit_note": "CN",
    "debit_note": "DN", "quotation": "QTN",
}


class DocPrefixUpdate(BaseModel):
    #: {"tax_invoice": "AEK"} — only the types being overridden need appear.
    #: An empty string CLEARS the override and returns that type to the
    #: built-in, which is different from omitting the key (leave as-is).
    prefixes: dict[str, str]


@router.get("/doc-prefixes")
async def get_doc_prefixes(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """What this org numbers each document type with, and the built-in beside
    it — so the screen can show "INV (default)" rather than an empty box that
    looks unset when it is merely unchanged."""
    pool = await get_pool()
    raw = await pool.fetchval(
        "SELECT settings->'doc_prefixes' FROM public.organisations "
        "WHERE id = $1::uuid", org_id)
    stored = {}
    if raw:
        try:
            stored = json.loads(raw) if isinstance(raw, str) else dict(raw)
        except Exception:
            # A malformed value is reported as "nothing set" rather than 500ing
            # the settings page. `ganit._doc_prefix` falls back the same way.
            stored = {}
    return {
        "data": [
            {"invoice_type": t,
             "prefix": (stored.get(t) or "").strip().upper() or None,
             "default": BUILTIN_PREFIXES[t],
             "effective": ((stored.get(t) or "").strip().upper()
                           or BUILTIN_PREFIXES[t])}
            for t in DOC_TYPES
        ],
        "note": (
            "Changing a prefix starts a NEW number series at 0001. Documents "
            "already issued keep the number they were issued with — a GST "
            "serial is not renumbered after the fact."
        ),
    }


@router.put("/doc-prefixes")
async def put_doc_prefixes(
    body: DocPrefixUpdate,
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """Set this org's document prefixes.

    THE VALUE REACHES A GST DOCUMENT SERIAL, so it is validated rather than
    stored as typed. `next_doc_number` builds `PREFIX-YYYY-NNNN` by string
    concatenation and parses the last one back out to increment it — a prefix
    containing a hyphen or a digit makes the series unreadable by its own
    reader, and the next invoice would restart at 0001 for ever.

    Letters only, upper-cased, 2-8 characters. An empty value clears the
    override; an omitted key is left alone.
    """
    pool = await get_pool()

    unknown = sorted(set(body.prefixes) - set(DOC_TYPES))
    if unknown:
        raise HTTPException(
            400,
            f"Not a document type: {', '.join(unknown)}. "
            f"Expected one of {', '.join(DOC_TYPES)}. Nothing was saved.")

    cleaned: dict[str, str] = {}
    for doc_type, value in body.prefixes.items():
        raw = (value or "").strip().upper()
        if not raw:
            cleaned[doc_type] = ""          # explicit clear
            continue
        if not raw.isalpha():
            raise HTTPException(
                400,
                f"'{value}' cannot be used for {doc_type}: a prefix is letters "
                f"only. Digits and hyphens would break the number series, "
                f"which is read back as PREFIX-YYYY-NNNN. Nothing was saved.")
        if not 2 <= len(raw) <= 8:
            raise HTTPException(
                400,
                f"'{value}' cannot be used for {doc_type}: a prefix is 2 to 8 "
                f"letters. Nothing was saved.")
        cleaned[doc_type] = raw

    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchval(
                "SELECT COALESCE(settings->'doc_prefixes', '{}'::jsonb) "
                "FROM public.organisations WHERE id = $1::uuid", org_id)
            merged = {}
            if current:
                try:
                    merged = json.loads(current) if isinstance(current, str) else dict(current)
                except Exception:
                    merged = {}
            for doc_type, value in cleaned.items():
                if value:
                    merged[doc_type] = value
                else:
                    merged.pop(doc_type, None)

            await conn.execute(
                "UPDATE public.organisations "
                "SET settings = COALESCE(settings, '{}'::jsonb) "
                "                || jsonb_build_object('doc_prefixes', $2::jsonb) "
                "WHERE id = $1::uuid",
                org_id, json.dumps(merged))

    return {
        "status": "saved",
        "prefixes": merged,
        "note": (
            "Documents already issued keep their numbers. The next document of "
            "each changed type starts a new series at 0001."
        ),
    }


class ReportPassphraseUpdate(BaseModel):
    #: The plaintext the recipient will type into their PDF reader. An empty
    #: string CLEARS it, which is a real choice and not the same as omitting a
    #: field: cleared means "stop attaching reports", and the dispatcher then
    #: sends the link shape and says so.
    passphrase: str


#: The one place the two sentences about who may READ and who may WRITE this
#: value are written down, so a future edit cannot widen one by copying the
#: other's decorator.
#:
#: BOTH are `ORG_SETTINGS_ROLES` — org_admin and org_owner. The read is gated
#: as tightly as the write DELIBERATELY, and the trade is worth stating because
#: it is visible to customers:
#:
#: `middleware/role_tiers.REPORT_RECIPIENT_ROLES` is `org_owner, org_admin,
#: org_member, hr_admin` — so an `org_member` or an `hr_admin` can be ON a
#: schedule's recipient list, receive the encrypted PDF, and NOT be able to read
#: the passphrase in the product. They have to be told by an admin.
#:
#: That is deliberate and it is the conservative half of a genuine trade. The
#: argument for widening it is good: a member who can log in and holds the
#: module grant can already open the report on screen, so showing them the
#: passphrase gives them nothing new. The argument against is that an
#: `org_member` does NOT necessarily hold the ganit or graha grant — module
#: access is a per-member grant, not a role — so a member without the finance
#: module could read the passphrase and then open a finance PDF that reached
#: them some other way. Narrow now, widen on request; the reverse is a
#: regression for whoever came to rely on it.
_PASSPHRASE_ROLES = ORG_SETTINGS_ROLES


@router.get("/report-passphrase")
async def get_report_passphrase(
    user=Depends(require_org_role(*_PASSPHRASE_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """This org's report passphrase, IN PLAINTEXT, for an administrator to read.

    ⚠ IT RETURNS THE VALUE, AND THAT IS THE WHOLE POINT. This is a document
    passphrase, not a login credential: the server has to hold the plaintext in
    order to encrypt with it, so it cannot be hashed, and an administrator who
    cannot read it back has no way to tell anybody what it is. "Forgot it" is
    therefore answered by looking at this screen, not by a reset flow — for an
    administrator. For everybody else the answer is "ask an administrator",
    which is stated on the screen rather than left to be discovered.

    ROTATING IT DOES NOT RE-KEY DOCUMENTS ALREADY SENT. A PDF sitting in a
    mailbox was encrypted with the passphrase that was current when it was
    mailed and still opens with that one. The screen says so; a customer who
    assumed otherwise would think they had revoked access they had not.

    `settings` is NOT in `_PROFILE_COLUMNS`, so this value has never been part
    of `GET /api/v1/org/profile` and is not reachable through the support-
    operator surface `middleware/org_resolver.py` documents. Keeping it off that
    tuple is load-bearing, not incidental.
    """
    from services.report_delivery import load_passphrase

    pool = await get_pool()
    value = await load_passphrase(pool, org_id)
    return {
        "passphrase": value,
        "is_set": bool(value),
        "note": (
            "Recipients need this to open the report PDF. It is never included "
            "in the email — a passphrase sent beside the document it protects "
            "protects nothing. Tell recipients out of band. Changing it does "
            "not change reports already delivered; those still open with the "
            "passphrase that was set when they were sent."
        ),
    }


@router.put("/report-passphrase")
async def put_report_passphrase(
    body: ReportPassphraseUpdate,
    user=Depends(require_org_role(*_PASSPHRASE_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """Set or clear the passphrase scheduled report PDFs are encrypted with.

    Stored ENCRYPTED AT REST through `services/encryption` (Fernet), in
    `settings->'reports'->>'passphrase'` — a jsonb key rather than a column, for
    the reason `services/purchase_orders.py` already states about
    `settings->'purchase_orders'`: code ships on merge and migrations are
    applied by hand afterwards, so a column that does not exist yet 500s the
    whole screen for the gap between. It also means this feature needs no
    migration at all.

    ⚠ THE VALUE IS NEVER LOGGED — not here, not in `report_delivery`, and not in
    the audit row. `resource_id` is the org, and the action says that a
    passphrase changed, never what it changed to.

    An EMPTY string clears it, and clearing is a supported choice rather than an
    error: an org that clears it goes back to receiving a link instead of an
    attachment, and the dispatcher says so in the mail.
    """
    from services import encryption
    from services.report_delivery import (PASSPHRASE_FIELD, SETTINGS_KEY,
                                          passphrase_problem)

    pool = await get_pool()
    raw = body.passphrase or ""

    if raw == "":
        stored = None
    else:
        problem = passphrase_problem(raw)
        if problem:
            # The sentence, not a code — it is shown to the person typing.
            # "Nothing was saved" mirrors `put_doc_prefixes`, because a 400
            # that leaves the reader unsure whether a partial write landed is
            # the thing that makes people press Save twice.
            raise HTTPException(400, f"{problem} Nothing was saved.")
        stored = encryption.encrypt(raw)

    async with pool.acquire() as conn:
        async with conn.transaction():
            # `jsonb_build_object` over the whole `reports` key, merged into
            # `settings` with `||` — the same shape `put_doc_prefixes` uses one
            # function up, so the two cannot drift about how a settings key is
            # written. `COALESCE(settings, '{}')` because the column is
            # nullable even though it defaults to '{}': a row inserted with an
            # explicit NULL would otherwise make `||` return NULL and erase
            # every other setting the org holds.
            current = await conn.fetchval(
                "SELECT COALESCE(settings->$2::text, '{}'::jsonb) "
                "  FROM public.organisations WHERE id = $1::uuid",
                org_id, SETTINGS_KEY)
            merged = {}
            if current:
                try:
                    merged = (json.loads(current) if isinstance(current, str)
                              else dict(current))
                except Exception:
                    merged = {}
            if stored is None:
                merged.pop(PASSPHRASE_FIELD, None)
            else:
                merged[PASSPHRASE_FIELD] = stored

            updated = await conn.fetchval(
                "UPDATE public.organisations "
                "   SET settings = COALESCE(settings, '{}'::jsonb) "
                "                  || jsonb_build_object($2::text, $3::jsonb) "
                " WHERE id = $1::uuid "
                " RETURNING id",
                org_id, SETTINGS_KEY, json.dumps(merged))

    if not updated:
        raise HTTPException(404, "Organisation not found. Nothing was saved.")

    log.info("report passphrase %s for org=%s by=%s",
             "cleared" if stored is None else "set", org_id, user["user_id"])
    return {
        "status": "saved",
        "is_set": stored is not None,
        "note": (
            "Reports already delivered keep the passphrase they were sent with."
            if stored is not None else
            "Cleared. Scheduled reports will now arrive as a link to open in "
            "Kartavaya rather than as an attachment, and the email says so."
        ),
    }


@router.put("/upi-accounts")
async def put_upi_accounts(
    body: UpiUpdate,
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()
    if not await _upi_table_exists(pool):
        raise HTTPException(
            503,
            "UPI IDs cannot be saved yet: public.org_upi_accounts does not "
            "exist. Apply migrations/129_org_upi_accounts.sql, then retry. "
            "Nothing was saved.",
        )

    seen: set[str] = set()
    for row in body.accounts:
        if row.platform in seen:
            raise HTTPException(400, f"'{row.platform}' appears twice.")
        seen.add(row.platform)

    filled = [r for r in body.accounts if r.vpa]

    # TWO DEFAULTS IS NOT A PREFERENCE, IT IS A BUG THAT MOVES MONEY: "Other UPI
    # app" would pay whichever row came back first. The partial unique index
    # refuses it too; refusing here says which platforms clashed.
    defaults = [r.platform for r in filled if r.is_default and r.is_active]
    if len(defaults) > 1:
        raise HTTPException(
            400, f"Only one ID can be the default. Chosen: {', '.join(defaults)}."
        )

    # An org with addresses and no default would leave "Other UPI app" and the
    # desktop QR with nothing to encode, so the first usable row takes it rather
    # than the page rendering a dead button.
    active = [r for r in filled if r.is_active]
    if active and not defaults:
        active[0].is_default = True

    async with pool.acquire() as conn:
        # ONE TRANSACTION. A partial save leaves the org publishing some of the
        # addresses it just reviewed and not others, with nothing on the screen
        # saying which half took.
        async with conn.transaction():
            # Cleared first, so a form that moves the default from PhonePe to
            # Paytm does not trip the one-default index halfway through.
            await conn.execute(
                "UPDATE public.org_upi_accounts SET is_default = FALSE, "
                "updated_at = NOW() WHERE org_id=$1::uuid AND is_default",
                org_id,
            )
            for row in body.accounts:
                if row.vpa is None:
                    await conn.execute(
                        "DELETE FROM public.org_upi_accounts "
                        "WHERE org_id=$1::uuid AND platform=$2",
                        org_id, row.platform,
                    )
                    continue
                await conn.execute(
                    """
                    INSERT INTO public.org_upi_accounts
                        (org_id, platform, vpa, payee_name, is_active, is_default, sort_order)
                    VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (org_id, platform) DO UPDATE
                       SET vpa        = EXCLUDED.vpa,
                           payee_name = EXCLUDED.payee_name,
                           is_active  = EXCLUDED.is_active,
                           is_default = EXCLUDED.is_default,
                           updated_at = NOW()
                    """,
                    org_id, row.platform, row.vpa, row.payee_name,
                    row.is_active, bool(row.is_default and row.is_active),
                    upi.PLATFORMS.index(row.platform),
                )

            # THE MIRROR. `pay.py` and the billing screens still read
            # `organisations.upi_vpa`; leaving it stale would mean the settings
            # screen showing one address while the invoice link pays another.
            # Written inside the same transaction so the two cannot disagree
            # even for a moment.
            chosen = next(
                (r for r in body.accounts if r.vpa and r.is_default and r.is_active), None
            )
            await conn.execute(
                "UPDATE public.organisations SET upi_vpa=$2, upi_payee_name=$3 "
                "WHERE id=$1::uuid",
                org_id,
                chosen.vpa if chosen else None,
                (chosen.payee_name if chosen else None),
            )

    return await get_upi_accounts(user=user, org_id=org_id)


@router.get("/upi-accounts/qr.svg")
async def upi_account_qr(
    platform: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """The verification code for ONE of this org's own addresses.

    Takes a PLATFORM, never a string to encode. `?data=` would be an open
    redirect in QR form — a kartavaya.com URL rendering a code that pays
    somebody else's account, with our domain lending it credibility. The same
    rule `routers/pay.py` follows for the public code.

    Carries NO amount: the org is scanning this to read back the account name
    their own bank reports, and a code with a real figure in it is one
    accidental confirm away from the firm paying itself.
    """
    platform = (platform or "").strip().lower()
    if platform not in upi.PLATFORMS:
        raise HTTPException(404, "No such UPI platform")

    pool = await get_pool()
    if not await _upi_table_exists(pool):
        raise HTTPException(404, "No UPI ID is saved for that app")

    row = await pool.fetchrow(
        "SELECT a.vpa, a.payee_name, o.name AS org_name "
        "  FROM public.org_upi_accounts a "
        "  JOIN public.organisations o ON o.id = a.org_id "
        " WHERE a.org_id=$1::uuid AND a.platform=$2",
        org_id, platform,
    )
    if row is None:
        raise HTTPException(404, "No UPI ID is saved for that app")

    import io

    import segno

    uri = upi.pay_uri(
        row["vpa"], row["payee_name"] or row["org_name"], None,
        f"{row['org_name']} verification",
    )
    buf = io.BytesIO()
    segno.make(uri, error="m").save(buf, kind="svg", scale=5, border=2)
    return Response(
        content=buf.getvalue(),
        media_type="image/svg+xml",
        # `no-store`: this is checked immediately after a save, and a cached
        # code for the OLD address is the one thing this preview must never do.
        headers={"Cache-Control": "no-store"},
    )
