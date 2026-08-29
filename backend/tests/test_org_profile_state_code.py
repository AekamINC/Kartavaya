"""An org's GST state code could not be set by anybody, through any route.

Found by proposal 93 on 2026-08-29, and it is the TAN failure one field over —
documented in `org_profile.py`'s own header and then repeated verbatim for the
next column along.

    `client_billing._tax_split` REFUSES to raise an invoice when
    `staging.organisations.state_code` is empty, and the refusal it prints is

        "this organisation has no state_code, so an invoice cannot be taxed as
         inter- or intra-state. Set the organisation's state in
         Settings -> Profile."

    Settings -> Profile is `TabProfile.jsx`. There was no such field, and there
    was no route behind one either: `_PROFILE_COLUMNS` is simultaneously the GET
    projection, the PATCH writable allowlist and the RETURNING list, and
    `state_code` was in none of them.

⚠ A NEW CUSTOMER COULD NEVER RAISE A GST INVOICE. `admin_orgs.py:679` — the one
INSERT that creates an organisation — does not name the column, so every org is
born NULL, and nothing in the product could change that. Measured live
2026-08-29: Aekam Inc and Demo - Kartavaya both NULL, 2 of 5. The three orgs
that do carry a code got it by migration or by hand.

Measured live before the fix, and both halves reproduce the same fault:

    GET  /api/v1/org/profile           → 17 keys, `state_code` not among them,
                                          while the column held '24'
    PATCH {"state_code": "24"}         → 400 "Nothing to update"

The PATCH is the sharper evidence. `ProfileUpdate` did not declare the name, so
`body.dict(exclude_unset=True)` dropped it before the handler saw it, leaving
`fields` empty — which is the silent-drop shape `TabProfile.jsx` refused to
build a control against for `description`/`industry`/`team_size`/`founded_year`.
It also means the probe wrote nothing, which is why it was safe to run against a
database production shares.

── The two rules this file pins ─────────────────────────────────────────────

  1. EMPTY MUST STAY SAVEABLE. Two live orgs hold NULL. Blocking a blank would
     refuse them their name, address and bank details over a field they had
     never been able to fill. Same standing rule as GSTIN/PAN/TAN, which
     block nothing.

  2. A NON-EMPTY UNRECOGNISED CODE IS A 400 NAMING THE FIELD, NEVER A 500 AND
     NEVER A 422. The column is `varchar(2)` (information_schema, live), so a
     three-character value raises StringDataRightTruncation — an instant 500
     that escapes before the CORS headers, which the browser reports as
     `net::ERR_FAILED` and the screen as "Failed to save profile". That is this
     repo's signature failure and it is what a warn-only path would have
     shipped.

The live half runs with:
    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_org_profile_state_code.py -q
"""
import asyncio
import os

import pytest

import routers.org_profile as org_profile
from services.gst_states import GST_STATES

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. `_PROFILE_COLUMNS` is interpolated into a SELECT and a "
    "RETURNING clause, and a MagicMock pool answers happily to a statement "
    "naming a column that does not exist — which is exactly how a router ships "
    "a 500. Only the real catalogue can check it."
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    return None if (not dsn or dsn == _PLACEHOLDER_DSN) else dsn


# ═════════════════════════════════════════════════════════════════════════════
# THE LIVE HALF — the real statements, parsed against the real schema
# ═════════════════════════════════════════════════════════════════════════════
#
# ⚠ NOTHING IS EXECUTED. `prepare()` sends Parse and Describe and STOPS: the
# server plans the statement and resolves every relation and column, and no
# `fetch`/`execute` is ever called on the handle. Staging shares its database
# with production, so that distinction is the whole safety story — the same one
# `test_manav_custody_write_paths_live_sql.py` rests on.
#
# The statements are COMPOSED FROM THE ROUTER'S OWN CONSTANTS rather than typed
# out here. A copy would go stale the moment somebody edits `_PROFILE_COLUMNS`,
# and a stale copy that still parses is a green test over a broken router.


def _get_sql() -> str:
    """`get_profile`'s SELECT, built the way the handler builds it.

    `_selectable(frozenset())` is the WORST case — the pending-column migration
    unapplied — which is the projection most likely to be wrong and the one a
    fresh deploy uses.
    """
    cols = ", ".join(org_profile._selectable(frozenset()))
    return (f"SELECT {cols}, logo_key FROM staging.organisations "
            "WHERE id=$1::uuid")


def _patch_sql() -> str:
    """`update_profile`'s UPDATE ... RETURNING, for a body naming state_code.

    The RETURNING list is the half that hides: a column it omits is invisible to
    every read path, because reads select from the real table. Only executing
    the write finds it, and that is what `prepare()` does without writing.
    """
    cols = ", ".join(org_profile._selectable(frozenset()))
    return ("UPDATE staging.organisations SET state_code=$1 WHERE id=$2::uuid "
            f"RETURNING {cols}")


def _describe(statements):
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            out = []
            for label, sql in statements:
                try:
                    await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    out.append((label, f"{type(exc).__name__}: {exc}"))
            return out
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def failures():
    if not live_dsn():
        pytest.skip(SKIP_REASON)
    return _describe([
        ("get_profile_select", _get_sql()),
        ("update_profile_returning", _patch_sql()),
    ])


def test_both_profile_statements_parse_against_the_live_schema(failures):
    """`state_code` is on `staging.organisations`, in both directions.

    ⚠ It is asserted rather than assumed even though two routers already SELECT
    it unguarded (`client_billing.py:132`, `procurement.py:575`): this is the
    first statement to name it in a RETURNING clause, and a RETURNING list is
    the one place a wrong column never surfaces on a read.
    """
    assert not failures, "\n".join(f"  {label}: {err}" for label, err in failures)


@pytest.mark.asyncio
async def test_the_column_is_two_characters_so_a_long_code_must_never_reach_it():
    """The 500 the 400 exists to prevent, read off the live catalogue.

    `varchar(2)`. Anything longer is StringDataRightTruncation, which escapes
    before the CORS headers are attached — the browser sees `net::ERR_FAILED`
    and the screen says "Failed to save profile", losing the whole form with it.
    """
    if not live_dsn():
        pytest.skip(SKIP_REASON)
    import asyncpg

    conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
    try:
        row = await conn.fetchrow(
            "SELECT data_type, character_maximum_length AS len "
            "FROM information_schema.columns "
            "WHERE table_schema='staging' AND table_name='organisations' "
            "AND column_name='state_code'")
    finally:
        await conn.close()

    assert row is not None, (
        "staging.organisations.state_code does not exist. Two routers SELECT it "
        "unguarded and this one now RETURNs it — every profile read would 500.")
    assert row["len"] == 2, (
        f"state_code is now {row['data_type']}({row['len']}). The handler "
        "refuses anything `norm_state` cannot resolve to a two-digit code; if "
        "the column has widened, re-read whether that refusal is still right.")


# ═════════════════════════════════════════════════════════════════════════════
# THE OFFLINE HALF — what value reaches the column, and what the caller is told
# ═════════════════════════════════════════════════════════════════════════════


async def test_the_state_code_is_readable_and_writable_at_all(
        api_client, mock_pool, as_admin, with_org_id):
    """The bug itself: the field had no route, in either direction.

    Asserted against `_PROFILE_COLUMNS` because that ONE tuple is the GET
    projection, the PATCH allowlist and the RETURNING list — being absent from
    it is all three failures at once, and it is the shape that recurs.
    """
    assert "state_code" in org_profile._PROFILE_COLUMNS, (
        "state_code is off _PROFILE_COLUMNS again, so it can be neither read "
        "back nor written. `client_billing._tax_split` refuses an invoice "
        "without it and tells the user to set it on a screen that then has no "
        "field — which is what this test exists to stop recurring.")

    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "state_code": "27"}

    resp = await api_client.patch("/api/v1/org/profile", json={"state_code": "27"})
    assert resp.status_code == 200, resp.text
    assert "27" in mock_pool.fetchrow.await_args.args, (
        "the value never reached the UPDATE. Before the fix a PATCH naming "
        "state_code answered 400 'Nothing to update', because pydantic dropped "
        "the undeclared key and left `fields` empty.")


@pytest.mark.parametrize("typed,stored", [
    ("27", "27"),          # already canonical
    ("MH", "27"),          # the alphabetic form
    ("mh", "27"),          # nobody types it in caps
    ("Maharashtra", "27"), # the name, as a person would say it
    ("4", "04"),           # unpadded — '4' is Chandigarh, not nothing
    (" 24 ", "24"),        # a paste with whitespace
])
async def test_every_spelling_of_a_state_is_stored_as_the_numeric_code(
        api_client, mock_pool, as_admin, with_org_id, typed, stored):
    """One canonical form on the column, because every reader assumes one.

    `manav` and `vetana` already normalise these same three spellings through
    `norm_state`; this router disagreeing with them is how `_tax_split` ends up
    comparing 'MH' with '27' and silently never matching.
    """
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "state_code": stored}

    resp = await api_client.patch("/api/v1/org/profile", json={"state_code": typed})
    assert resp.status_code == 200, resp.text
    assert stored in mock_pool.fetchrow.await_args.args, (
        f"{typed!r} reached the column unnormalised; every reader goes through "
        f"norm_state and expects {stored!r}")


@pytest.mark.parametrize("blank", ["", "   ", None])
async def test_an_empty_state_code_still_saves_and_is_written_as_NULL(
        api_client, mock_pool, as_admin, with_org_id, blank):
    """⚠ THE RULE THAT MATTERS MOST. Two live orgs are empty TODAY.

    Blocking a blank would refuse Aekam Inc and Demo - Kartavaya their name,
    address and bank details over a field neither has ever been able to fill in.
    That is the same standing rule as GSTIN/PAN/TAN — "non-mandatory and must
    block nothing" — and it has drifted back more than once.

    NULL rather than "", so "nobody has said" has one representation. There is
    no CHECK forcing it here as there is on `tan`; the reason is the other one —
    a column holding both NULL and '' for a single meaning is how an `IS NULL`
    filter starts lying.
    """
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "state_code": None}

    resp = await api_client.patch("/api/v1/org/profile", json={"state_code": blank})
    assert resp.status_code == 200, (
        f"clearing the state code was refused ({resp.status_code}): {resp.text}")

    args = mock_pool.fetchrow.await_args.args
    assert "" not in args and "   " not in args, (
        f"{blank!r} reached the column unnormalised")
    assert None in args, "a cleared state code must be written as NULL"


async def test_a_blank_state_code_does_not_block_the_rest_of_the_form(
        api_client, mock_pool, as_admin, with_org_id):
    """The blast radius, stated as a test: the PATCH carries the whole form.

    This is what the TAN bug actually cost — a firm clearing one field lost its
    name, address and bank details in the same click. The check is that the
    OTHER fields still reach the UPDATE.
    """
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "Whole Form Ltd", "state_code": None}

    resp = await api_client.patch("/api/v1/org/profile", json={
        "name": "Whole Form Ltd", "state_code": "", "gstin": "", "tan": "",
    })
    assert resp.status_code == 200, resp.text
    assert "Whole Form Ltd" in mock_pool.fetchrow.await_args.args, (
        "an empty state code took the rest of the form down with it")


@pytest.mark.parametrize("bad", ["55", "00", "ZZ", "Wakanda", "024", "2 7", "-1"])
async def test_an_unrecognised_code_is_a_400_naming_the_field_never_a_500(
        api_client, mock_pool, as_admin, with_org_id, bad):
    """Refused, and refused as a 400 — not 422, and above all not 500.

    Why this one refuses where a bad GSTIN only warns: the GSTIN is judged by
    OUR regex and OUR check digit, and being wrong about a legitimate number
    costs a real firm its afternoon. The state codes are a CLOSED PUBLISHED
    codelist of 40 values, the column is varchar(2), and storing an
    unrecognised code is worse than refusing it — `norm_state` answers None on
    read, so `_tax_split` refuses the invoice saying the org "has no
    state_code" while this screen displays one.

    NOT 422: a pydantic `field_validator` would have produced pydantic's own
    envelope, which is the failure "an empty box was a 422, and 184 sites could
    not read the reason" already cost this repo a day.
    """
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "state_code": None}

    resp = await api_client.patch("/api/v1/org/profile", json={"state_code": bad})

    assert resp.status_code == 400, (
        f"{bad!r} answered {resp.status_code}. 422 means the check drifted into "
        f"a pydantic validator; 500 means it reached varchar(2). Body: {resp.text}")
    detail = str(resp.json().get("detail", "")).lower()
    assert "gst state code" in detail, (
        f"the refusal must name the field and say what a good value looks like; "
        f"got {resp.text}")
    assert "nothing was saved" in detail, (
        "this handler never writes a partial update and its refusals say so")
    mock_pool.fetchrow.assert_not_awaited()


@pytest.mark.parametrize("retired,name", [("25", "Daman and Diu"),
                                          ("28", "Andhra Pradesh (undivided)")])
async def test_a_retired_code_is_SAVED_and_warned_about_never_refused(
        api_client, mock_pool, as_admin, with_org_id, retired, name):
    """25 merged into 26 in 2020; 28 died with the 2014 bifurcation.

    Both still appear on old registrations, so both RESOLVE — refusing them
    would refuse a firm its own historic GSTIN prefix, which is why
    `gst_states` keeps them and flags them rather than dropping them. Neither is
    issued today, so a fresh one is almost certainly a typo, and that travels
    back in `code_warnings` exactly as the GSTIN and TAN complaints do.
    """
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "state_code": retired}

    resp = await api_client.patch("/api/v1/org/profile", json={"state_code": retired})
    assert resp.status_code == 200, (
        f"a retired code was refused: {resp.text}. It resolves to {name} and a "
        "firm may legitimately still carry it")
    assert retired in mock_pool.fetchrow.await_args.args, "stored as chosen"

    warning = resp.json().get("code_warnings", {}).get("state_code", "")
    assert name in warning, (
        f"the warning must name the state, not just the digits; got {warning!r}")


async def test_a_good_code_carries_no_warning(
        api_client, mock_pool, as_admin, with_org_id):
    """An empty `code_warnings` is how the screen CLEARS a previous complaint.

    `TabProfile` sets `errors.state_code` from this key on every save, so a
    warning that lingered after the value was corrected would leave the user
    reading a complaint about something they had already fixed — F37, one field
    over.
    """
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "state_code": "24"}

    resp = await api_client.patch("/api/v1/org/profile", json={"state_code": "24"})
    assert resp.status_code == 200
    assert not resp.json().get("code_warnings", {}).get("state_code")


def test_the_codelist_is_the_published_one_and_not_simply_01_to_38():
    """The statutory shape, pinned so a 'tidy-up' cannot narrow it.

    The obvious wrong version of this validator is `01 <= int(code) <= 38`. It
    would refuse **97 Other Territory** and **99 Centre Jurisdiction**, both of
    which are real and both of which appear on real GSTINs — 97 on supplies in
    territorial waters and outside any state, 99 where the Centre holds
    jurisdiction. An org on either could not save.
    """
    assert "97" in GST_STATES and "99" in GST_STATES, (
        "97 and 99 are published GST state codes and a range check would refuse "
        "both")
    # Everything from 01 to 38 is assigned; nothing between 39 and 96 is.
    assert all(f"{n:02d}" in GST_STATES for n in range(1, 39))
    assert not any(str(n) in GST_STATES for n in range(39, 97))
    assert len(GST_STATES) == 40
