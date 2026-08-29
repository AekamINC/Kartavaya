"""The report-passphrase routes' SQL, parsed against the REAL schema.

`docs/plans/PHASE-6`'s rule, and the reason it exists: **never ship a router
without one test that executes its SQL against the real schema.** A MagicMock
pool answers happily to a statement naming a column that is not there, which is
exactly how this repo has shipped a live 500 more than once — and
`routers/org_profile.py` itself carries the scar, in the note about
`PROPOSED_068` and the four columns that had to be PROBED rather than assumed.

Three statements are new on 2026-08-29 with the encrypted-PDF report delivery:

  · `services/report_delivery.load_passphrase` — the two-step jsonb read
    `settings->'reports'->>'passphrase'`.
  · `routers/org_profile.put_report_passphrase` — the merge read, and the
    `settings || jsonb_build_object(...)` write with its RETURNING clause.

⚠ NOTHING IS EXECUTED. `prepare()` sends Parse and Describe and stops: the
server plans the statement and resolves every relation, column, operator and
cast, and no `fetch`/`execute` is ever called on the handle. **That matters more
here than anywhere else in this package** — one of these three is an UPDATE
against `staging.organisations`, and staging shares its database with
production. Parse-only is the whole safety story.

⚠ THE WRITE IS THE ONE THAT HAD TO BE CHECKED. `COALESCE(settings, '{}'::jsonb)`
is not defensive decoration: `settings` is NULLABLE even though it DEFAULTS to
`'{}'`, and `NULL || jsonb_build_object(...)` is NULL — so a row inserted with an
explicit NULL would have had every other setting it holds (`doc_prefixes`,
`purchase_orders`, `lead_capture_email`, `publish_batch_limit`) erased by a
passphrase save. Confirmed nullable from `information_schema` below rather than
from the migration file.

Run against the real schema:

    cd backend && DATABASE_URL=... python -m pytest tests/test_report_passphrase_sql.py -q
"""
import asyncio
import os

import pytest

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. These statements do a two-step jsonb traversal and a "
    "`jsonb_build_object` merge against `staging.organisations`. A MagicMock "
    "pool accepts any of it, including a column that does not exist."
)

#: The statements the two routes actually run, written HERE rather than
#: imported, because both are inline string literals in their handlers and
#: there is no constant to import. That makes this the one copy that can go
#: stale — so each is quoted from its call site with the file and function
#: named, and `test_the_statements_still_match_their_call_sites` below re-reads
#: the source and fails if either handler's text no longer contains it.
READ_SQL = (
    "SELECT settings->$2::text->>$3::text "
    "  FROM staging.organisations WHERE id = $1::uuid"
)
MERGE_READ_SQL = (
    "SELECT COALESCE(settings->$2::text, '{}'::jsonb) "
    "  FROM staging.organisations WHERE id = $1::uuid"
)
WRITE_SQL = (
    "UPDATE staging.organisations "
    "   SET settings = COALESCE(settings, '{}'::jsonb) "
    "                  || jsonb_build_object($2::text, $3::jsonb) "
    " WHERE id = $1::uuid "
    " RETURNING id"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    return None if (not dsn or dsn == _PLACEHOLDER_DSN) else dsn


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
        ("load_passphrase read", READ_SQL),
        ("put_report_passphrase merge read", MERGE_READ_SQL),
        ("put_report_passphrase write", WRITE_SQL),
    ])


def test_all_three_passphrase_statements_parse(failures):
    assert not failures, "\n".join(f"  {label}: {err}" for label, err in failures)


@pytest.mark.asyncio
async def test_settings_is_nullable_which_is_why_the_coalesce_is_there():
    """The COALESCE is load-bearing, and this is the fact it rests on.

    `NULL || jsonb_build_object(...)` is NULL. Without the COALESCE, saving a
    passphrase on an org whose `settings` is NULL would write NULL over the
    whole column — erasing `doc_prefixes` (the GST document number series),
    `purchase_orders` (approval rules and budgets), `lead_capture_email` and
    `publish_batch_limit` in one statement, silently, on a screen that says
    "Saved".
    """
    if not live_dsn():
        pytest.skip(SKIP_REASON)
    import asyncpg

    conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
    try:
        row = await conn.fetchrow(
            "SELECT is_nullable, data_type, column_default "
            "  FROM information_schema.columns "
            " WHERE table_schema='staging' AND table_name='organisations' "
            "   AND column_name='settings'")
    finally:
        await conn.close()

    assert row is not None, (
        "staging.organisations.settings does not exist. The report passphrase "
        "lives in it, and so do doc_prefixes and the purchase-order settings.")
    assert row["data_type"] == "jsonb"
    assert row["is_nullable"] == "YES", (
        "settings is no longer nullable. That does not make the COALESCE "
        "wrong, but re-read this test's reasoning before removing it.")


def test_the_statements_still_match_their_call_sites():
    """The copies above are the only thing here that can rot.

    Both handlers build their SQL as inline literals, so there is no constant to
    import and this file necessarily holds a second copy. Whitespace is
    normalised before comparing, because the handlers wrap their strings to fit
    a line width and that is not a change in meaning.

    ⚠ DOUBLE QUOTES ARE STRIPPED TOO, and that is not laziness. Python's
    adjacent-literal concatenation means the SOURCE of a wrapped statement reads
    `"SELECT x " "  FROM y"` — with the closing and opening quotes sitting
    between the two runs. Normalising whitespace alone leaves those quotes in
    the haystack, so the needle never matches and this check passes vacuously
    forever while looking like enforcement. That is the third time a check in
    this repo has been caught comparing a string it could never find.
    """
    import inspect

    import routers.org_profile as org_profile
    from services import report_delivery

    def norm(s):
        return " ".join(s.replace('"', " ").split())

    read_src = norm(inspect.getsource(report_delivery.load_passphrase))
    assert norm(READ_SQL) in read_src, (
        "`load_passphrase`'s statement has changed and this file still parses "
        "the old one — which is a green live-SQL test over an unchecked query.")

    write_src = norm(inspect.getsource(org_profile.put_report_passphrase))
    for label, sql in (("merge read", MERGE_READ_SQL), ("write", WRITE_SQL)):
        assert norm(sql) in write_src, (
            f"`put_report_passphrase`'s {label} statement has changed and this "
            f"file still parses the old one.")


def test_the_passphrase_is_not_on_the_org_profile_surface():
    """`settings` must stay OFF `_PROFILE_COLUMNS`, and this is why.

    That tuple is simultaneously the GET projection, the PATCH allowlist and the
    RETURNING list, so a name added to it is returned by
    `GET /api/v1/org/profile` — a route `middleware/org_resolver.py` records as
    reachable by a support operator the customer approved for nothing, with no
    module gate. The passphrase lives in a jsonb KEY that tuple does not name.

    Verified live 2026-08-29 against the deployed staging build (`1f31641e`):
    that endpoint returned 18 keys and `settings` was not among them.
    """
    import routers.org_profile as org_profile

    assert "settings" not in org_profile._PROFILE_COLUMNS
    assert "settings" not in org_profile._WRITABLE_COLUMNS
