"""`PUT /v1/hub/org/brand` — the route an organisation's own brand profile
lives behind, which until 2026-08-29 answered 500 for every organisation on
every call.

── WHAT WAS BROKEN, MEASURED BEFORE IT WAS TOUCHED ──────────────────────────

Proposal 93 Suite 14 drove the Sahayak/Hub screens against the deployed staging
service. §10 lists "brand profile" as one of Suite 14's seventeen screens, and
`hub/BrandTab.jsx` — the ONLY brand save control anywhere in the product — puts
to `/v1/hub/clients/{id}/brand`, which is
`require_platform_role(*SAHAYAK_COMMERCIAL_ROLES)`. Probed live with an
org_admin credential: **403**, a raw list of platform role names.

The org-scoped sibling `PUT /v1/hub/org/brand` is `require_user`, so a customer
MAY call it — and `93-E-ORPHANED-CAPABILITY-SWEEP.md` §3.4 files it as
ORPHANED · LATENT, because `grep "org/brand"` across `frontend/src` returns 0.
It is worse than orphaned. Probed live, 2026-08-29:

    PUT /api/v1/hub/org/brand  {"tone":"professional"}   →  500

and the deploy log (Railway deployment 93cd7719, 2026-08-29T09:59:34Z) names it:

    ERROR - Unhandled error on PUT /api/v1/hub/org/brand
      File "/app/routers/hub.py", in update_org_brand
        "INSERT INTO staging.hub_brand_profiles (org_id) VALUES ($1::uuid)"
    asyncpg.exceptions.NotNullViolationError: null value in column "client_id"
      of relation "hub_brand_profiles" violates not-null constraint

── WHY IT COULD NEVER HAVE WORKED, FROM THE CATALOGUE ───────────────────────

Read from `information_schema` and `pg_constraint` on the live database, never
from a migration file:

    hub_brand_profiles.client_id   NOT NULL, no default
    hub_brand_profiles_client_id_key   UNIQUE (client_id)
    hub_brand_profiles.org_id      NULLABLE, FK → organisations

and the only writer of a row on this table is `get_or_create_org_client`, which
inserts `(client_id)` alone. **Both live rows carry `org_id` NULL.** So the
handler's `SELECT … WHERE org_id=$1` missed every time, the INSERT ran every
time, and the INSERT violated a NOT NULL every time.

The second half is quieter and would have survived a fix that only stopped the
crash: the UPDATE was `WHERE org_id=$1::uuid`. A row reached through the
internal-client fallback carries `org_id` NULL, so that UPDATE matches nothing,
changes nothing, and the handler still answers `{"status": "updated"}` — a save
that reports success and stores none of it.

And a third consequence, still live: `quick_generate` loads the brand with
`SELECT * FROM staging.hub_brand_profiles WHERE org_id=$1::uuid`. Nothing has
ever written that column, so **every org-level generation has run with no brand
context at all**, silently, on the one route the Generate tab uses.

── WHY THIS FILE, AND NOT A MOCK ────────────────────────────────────────────

`tests/conftest.py` hands every module a MagicMock pool, and a MagicMock answers
happily to a statement naming a column that is not there — which is exactly how
the INSERT above survived review. This file follows the two-half shape of
`test_client_billing_invoices.py` and reuses its `CapturePool`:

  1. CAPTURE, offline — the handler runs with a pool that records every
     statement and its bound arguments and answers from a script. Nothing is
     executed and nothing is written. Runs everywhere, including with no
     database.

  2. CHECK, live — `prepare()` sends Parse and Describe and STOPS: the server
     plans the statement and resolves every relation, column and parameter type
     without reading or writing a row. Plus the catalogue read directly, which
     is what keeps the NOT NULL fact under this fix honest rather than quoted.

⚠ Staging and production share ONE Supabase database. **Nothing here writes.**
"""
import asyncio
import os

import pytest
from fastapi import HTTPException

import routers.hub as hub
from tests.test_client_billing_invoices import (
    CapturePool,
    SKIP_REASON,
    _SEARCH_PATH,
    live_dsn,
    pooled,  # noqa: F401  — the fixture, re-exported by importing it
)


# ── identities ───────────────────────────────────────────────
# Values, never sources. No statement built with them is ever executed.

ORG = "11111111-1111-1111-1111-111111111111"
BRAND = "22222222-2222-2222-2222-222222222222"
USER = {"user_id": "user_admin001"}

#: The fallback SELECT — the one that finds the internal client's profile.
FALLBACK = "JOIN public.hub_clients c ON c.id = bp.client_id"
#: The primary SELECT — a row already stamped with this org.
PRIMARY = "SELECT id FROM public.hub_brand_profiles WHERE org_id"
UPDATE = "UPDATE public.hub_brand_profiles"
INSERT = "INSERT INTO public.hub_brand_profiles"


def _run(coro):
    return asyncio.run(coro)


def _body(tone="bold", voice="Plain and precise."):
    return hub.BrandProfileUpdate.model_validate({"tone": tone, "brand_voice": voice})


def _drive(pool, body=None):
    return _run(hub.update_org_brand(
        body=body or _body(), user=USER, org_id=ORG, _=None,
    ))


def _script_fallback_hits():
    """The live state of every organisation: no `org_id` row, one internal one.

    Order matters — `CapturePool._answer` takes the FIRST needle found in the
    statement, and both SELECTs name `staging.hub_brand_profiles`.
    """
    return [(FALLBACK, {"id": BRAND}), (PRIMARY, None)]


def _set_clause(sql: str, field: str) -> str | None:
    """The `field=$n[::cast]` fragment from an UPDATE's SET list, or None."""
    body = sql.split(" SET ", 1)[1].split(" WHERE ", 1)[0]
    for frag in body.split(", "):
        if frag.strip().startswith(f"{field}="):
            return frag.strip()
    return None


# ══════════════════════════════════════════════════════════════════════════════
#  1 · THE CRASH — the INSERT that could not succeed
# ══════════════════════════════════════════════════════════════════════════════

def test_no_row_is_ever_inserted_on_this_path(pooled):
    """THE FIX. The handler writes no `hub_brand_profiles` row at all.

    `client_id` is NOT NULL with no default and the old INSERT named only
    `org_id`, so the statement could not be planned against a real database
    whatever the org. There is nothing to insert here in the first place: the
    profile is created beside the internal client by `get_or_create_org_client`,
    and a second row for the same organisation is how the read and the write
    come to disagree.
    """
    pool = pooled(_script_fallback_hits())
    _drive(pool)
    assert not pool.any(INSERT), (
        "the handler inserts into hub_brand_profiles again. `client_id` is NOT "
        "NULL with no default (live catalogue, 2026-08-29), so any INSERT that "
        "does not name it is a NotNullViolationError and an unhandled 500:\n  "
        + "\n  ".join(s for s in pool.statements() if INSERT in s)
    )


def test_the_internal_client_profile_is_what_gets_written(pooled):
    """When no row carries this `org_id` — which is EVERY org today — the
    handler falls back to the internal client's profile, exactly as
    `GET /org/brand` already does. Two readers of one row, or they drift."""
    pool = pooled(_script_fallback_hits())
    _drive(pool)
    assert pool.any(FALLBACK), (
        "the org_id lookup missed and nothing looked for the internal client's "
        "profile, so the handler has no row to write and the 404 below is the "
        "only outcome left. Statements issued:\n  " + "\n  ".join(pool.statements())
    )


def test_the_update_is_keyed_on_the_row_not_on_org_id(pooled):
    """THE QUIET HALF. A row found through the fallback has `org_id` NULL, so
    `WHERE org_id=$1` matches nothing — the handler would answer
    `{"status": "updated"}` over a row it never touched."""
    pool = pooled(_script_fallback_hits())
    _drive(pool)
    sql, args = pool.one(UPDATE)
    where = sql.split(" WHERE ", 1)[1]
    assert where.startswith("id=$1"), (
        "the UPDATE is keyed on something other than the row id, so a profile "
        f"whose org_id is NULL is not reached by it. WHERE clause: {where!r}"
    )
    assert args[0] == BRAND, (
        f"the UPDATE names {args[0]!r} where the row found above is {BRAND!r}"
    )


def test_the_update_stamps_org_id(pooled):
    """`hub_brand_profiles.org_id` is the column `quick_generate` reads the
    brand by, and nothing has ever written it — so org-level generation has
    always run with no brand context. Writing it here is what turns that on."""
    pool = pooled(_script_fallback_hits())
    _drive(pool)
    sql, args = pool.one(UPDATE)
    frag = _set_clause(sql, "org_id")
    assert frag == "org_id=$2::uuid", (
        "the UPDATE does not stamp org_id, so `quick_generate`'s "
        "`WHERE org_id=$1::uuid` brand lookup keeps finding nothing and every "
        f"org-level generation keeps running unbranded. SET fragment: {frag!r}"
    )
    assert args[1] == ORG, f"org_id is bound as {args[1]!r}, not {ORG!r}"


def test_the_typed_fields_are_bound_after_the_two_keys(pooled):
    """`$1` is the row and `$2` the org, so the caller's fields start at `$3`.
    An off-by-one here binds a tone into a uuid slot, which PgBouncer turns
    into an instant 500 rather than a readable error."""
    pool = pooled(_script_fallback_hits())
    _drive(pool, _body(tone="witty", voice="Plain and precise."))
    sql, args = pool.one(UPDATE)
    assert _set_clause(sql, "tone") in ("tone=$3", "tone=$4"), (
        f"tone is bound outside the $3.. range: {_set_clause(sql, 'tone')!r}"
    )
    assert set(args[2:]) == {"witty", "Plain and precise."}, (
        f"the typed values are not the trailing arguments: {args!r}"
    )


def test_an_already_stamped_row_skips_the_fallback(pooled):
    """The second save, once `org_id` is on the row. One SELECT, not two."""
    pool = pooled([(PRIMARY, {"id": BRAND}), (FALLBACK, None)])
    _drive(pool)
    assert not pool.any(FALLBACK), (
        "the org_id lookup HIT and the fallback ran anyway — a second query per "
        "save, and one that could pick a different row"
    )
    sql, args = pool.one(UPDATE)
    assert args[0] == BRAND


def test_an_org_with_no_workspace_is_told_so_rather_than_crashing(pooled):
    """No internal client means no profile. That is a 404 with a sentence, not
    a constraint violation escaping as `{"detail":"Internal server error"}` —
    which is what the reader saw, with no way to learn what to do."""
    pool = pooled([(FALLBACK, None), (PRIMARY, None)])
    with pytest.raises(HTTPException) as exc:
        _drive(pool)
    assert exc.value.status_code == 404
    assert "Sahayak" in str(exc.value.detail), (
        f"the refusal names no remedy: {exc.value.detail!r}"
    )
    assert not pool.any(UPDATE), "it wrote anyway after refusing"
    assert not pool.any(INSERT), "it inserted anyway after refusing"


def test_an_empty_body_is_still_refused_before_anything_is_read(pooled):
    """Unchanged behaviour, pinned: `PUT {}` is a 400 and touches nothing."""
    pool = pooled(_script_fallback_hits())
    with pytest.raises(HTTPException) as exc:
        _run(hub.update_org_brand(
            body=hub.BrandProfileUpdate.model_validate({}),
            user=USER, org_id=ORG, _=None,
        ))
    assert exc.value.status_code == 400
    assert pool.statements() == [], (
        f"an empty body still queried the database: {pool.statements()!r}"
    )


# ══════════════════════════════════════════════════════════════════════════════
#  2 · LIVE — the catalogue is the witness, not a reading of a migration
# ══════════════════════════════════════════════════════════════════════════════


def _captured_statements() -> list[str]:
    """Every statement the handler issues, on the branch every org is on."""
    async def run():
        import db
        pool = CapturePool(_script_fallback_hits())
        original = db._pool
        db._pool = pool
        try:
            await hub.update_org_brand(
                body=_body(), user=USER, org_id=ORG, _=None,
            )
        finally:
            db._pool = original
        return pool.statements()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    """Plan every captured statement against the real catalogue. ONE connection.

    `prepare()` sends Parse and Describe and returns the shapes. No `fetch`, no
    `execute`, no `fetchval` is ever called on the handle, so no row is read and
    none is written.
    """
    dsn = live_dsn()
    if not dsn:
        pytest.skip(SKIP_REASON)
    import asyncpg

    # Captured BEFORE the loop opens: `_captured_statements` drives the handler
    # with `asyncio.run`, and `asyncio.run` inside a running loop is a
    # RuntimeError rather than a nested run.
    statements = _captured_statements()

    async def run():
        # `statement_cache_size=0` because the connection goes through PgBouncer
        # in transaction mode.
        conn = await asyncpg.connect(dsn, statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures = []
            for sql in statements:
                try:
                    await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((sql, f"{type(exc).__name__}: {exc}"))
            cols = await conn.fetch(
                "SELECT column_name, is_nullable, column_default "
                "FROM information_schema.columns "
                "WHERE table_schema = ANY(current_schemas(false)) AND table_name='hub_brand_profiles' "
                "  AND column_name IN ('client_id','org_id')"
            )
            return (failures, {r["column_name"]: dict(r) for r in cols},
                    len(statements))
        finally:
            await conn.close()

    return asyncio.run(run())


def test_every_statement_parses_against_the_real_schema(live):
    failures, _, described = live
    # `assert not failures` is green against an EMPTY capture. The count is
    # what separates "all three statements parse" from "the handler was never
    # driven, so nothing was parsed and nothing could fail".
    assert described >= 3, \
        f"only {described} statements were captured, not 3 — the capture rotted"
    assert not failures, "statements the live catalogue refused:\n" + "\n".join(
        f"  {err}\n    {sql}" for sql, err in failures)


def test_client_id_is_still_not_null_which_is_why_the_insert_had_to_go(live):
    """THE RATCHET. If somebody later makes `client_id` nullable, or gives it a
    default, the reasoning above changes and this test is where they find that
    out — rather than in a review of a handler that looks fine either way."""
    _, cols, _ = live
    assert cols, "the catalogue read returned nothing at all"
    client_id = cols.get("client_id")
    assert client_id, "hub_brand_profiles has no client_id column any more"
    assert client_id["is_nullable"] == "NO", (
        "client_id is nullable now. The INSERT this fix removed would work "
        "again — but a brand row with no client is still a SECOND profile for "
        "one organisation, and `GET /org/brand` reads the internal client's. "
        "Decide which row is the org's brand before putting the INSERT back."
    )
    assert client_id["column_default"] is None, (
        "client_id has a default now, which changes the same reasoning"
    )
    assert cols["org_id"]["is_nullable"] == "YES", (
        "org_id is NOT NULL now — every existing row carries NULL there "
        "(measured 2026-08-29), so that migration cannot have run cleanly"
    )
