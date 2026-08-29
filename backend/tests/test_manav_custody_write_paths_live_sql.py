"""Two write paths that had never once succeeded, parsed against the real schema.

Both found by proposal 93 Suite 07 on 2026-08-29, by driving the real screens.
Both were invisible to the existing suite for the same reason: `tests/conftest.py`
hands every module a MagicMock pool, and a MagicMock answers happily to a
statement naming a column that is not there.

    1 · POST /manav/assets/{id}/return
        `routers/manav.py` selected `a.asset_type`. There is no such column on
        `staging.manav_assets` and there never has been — migration 043 calls it
        `category`. The 500 escaped before the CORS headers, so the browser saw
        `net::ERR_FAILED` and the screen said "No response from the server".
        ⚠ RETURNING AN ASSET HAD NEVER WORKED: 24 issued, 0 returnable.

    2 · POST /custody/notices
        `_WRITE_RETURNING` omitted `created_at`/`updated_at`, and
        `_SELECT_WRITTEN` reads `r.created_at` off that CTE. Every CREATE raised
        `UndefinedColumnError`; every READ worked, because reads select from the
        real table, which has both columns.
        ⚠ THAT IS WHY THE NOTICE REGISTER HELD ZERO ROWS IN ITS ENTIRE LIFE.

The second is the more interesting shape and the reason this file exists rather
than two one-line fixes: **a RETURNING list narrower than the SELECT over it is
invisible to every read path.** Nothing that queries the table can see it. Only
executing the write does — which is what `prepare()` does here without writing.

⚠ NOTHING IS EXECUTED. `prepare()` sends Parse and Describe and STOPS: the
server plans the statement and resolves every relation and column, and no
`fetch`/`execute` is ever called on the handle. Staging shares its database with
production, so that distinction is the whole safety story.

Run it with:
    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_manav_custody_write_paths_live_sql.py -q
"""
import asyncio
import os

import pytest

import routers.manav as manav_router  # noqa: F401  (names the router for the ratchet)
from services.custody import notices as notices_svc

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. These statements are parsed against the real catalogue "
    "and cannot be checked offline — a MagicMock pool answers happily to a "
    "SELECT naming a column that does not exist, which is how both of these "
    "survived."
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    return None if (not dsn or dsn == _PLACEHOLDER_DSN) else dsn


#: The asset-return pre-read, exactly as the router composes it.
ASSET_RETURN_PREREAD = (
    "SELECT a.assigned_to, a.name AS asset_name, a.category, e.name, e.email "
    "FROM staging.manav_assets a "
    "LEFT JOIN staging.manav_employees e ON e.id = a.assigned_to "
    "WHERE a.id=$1::uuid AND a.org_id=$2::uuid AND a.is_active=TRUE"
)


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
    return _describe([("asset_return_preread", ASSET_RETURN_PREREAD)])


def test_the_asset_return_preread_parses(failures):
    assert not failures, "\n".join(f"  {l}: {e}" for l, e in failures)


def test_manav_assets_has_no_asset_type_column():
    """Offline half — the catalogue fact, so CI catches a reintroduction.

    Asserted as an ABSENCE rather than by re-reading the column list, because
    the failure mode is somebody 'restoring' `asset_type` in a query rather than
    the column reappearing.
    """
    import inspect
    import re

    # ⚠ COMMENTS STRIPPED FIRST, and that is not fussiness: the first draft of
    # this assertion matched the explanatory comment written directly above the
    # fix, so it failed on correct code. A check that cannot tell a fix from its
    # own description is worse than no check.
    src = inspect.getsource(manav_router)
    code = "\n".join(re.sub(r"#.*$", "", ln) for ln in src.splitlines())

    assert "asset_type" not in code, (
        "`asset_type` is back in routers/manav.py. There is no such column on "
        "staging.manav_assets — migration 043 calls it `category`. In a SELECT "
        "it 500s (the return path); read off a `RETURNING *` row it silently "
        "yields '' and sends a notification naming no asset type (the assign "
        "path). The quiet one is the half nobody reports."
    )


def test_the_notice_write_returns_every_column_the_select_reads():
    """The general form, and the reason this bug was invisible.

    `_SELECT_WRITTEN` selects `r.<col>` from the `written` CTE, whose columns
    are exactly `_WRITE_RETURNING`. Any `r.<col>` the RETURNING list omits is an
    UndefinedColumn on the CREATE path ONLY — every read selects from the real
    table and is unaffected. So no amount of reading the register can surface
    it, and the register simply stays empty.

    Parsed out of the two constants rather than hardcoded, so a column added to
    the SELECT later is checked automatically.
    """
    import re

    returning = {c.strip() for c in notices_svc._WRITE_RETURNING.replace('"', "").split(",") if c.strip()}
    read = set(re.findall(r"\br\.([a-z_]+)\b", notices_svc._SELECT_WRITTEN))

    missing = sorted(read - returning)
    assert not missing, (
        f"_SELECT_WRITTEN reads r.{{{','.join(missing)}}} off the `written` CTE, "
        f"and _WRITE_RETURNING does not return them. Every CREATE will raise "
        f"UndefinedColumnError while every READ keeps working — which is how "
        f"the notice register stayed at zero rows for its entire life."
    )
