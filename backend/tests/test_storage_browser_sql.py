"""Every statement the Storage tab issues, planned against the real catalogue.

── WHY THIS FILE EXISTS, WHEN THERE ARE ALREADY 19 TESTS NEXT DOOR ─────────

`tests/test_storage_browser.py` reads the router's SOURCE. It proves the
tenancy guard is written, that there is no delete, that no credential leaves
the overview. Not one of its assertions sends a statement to Postgres, and it
could not: `conftest.py` hands every module a MagicMock pool, and a MagicMock
answers happily to a SELECT naming a table that does not exist.

That is the exact hole `docs/plans/PHASE-6` and CLAUDE.md close by rule — **a
router does not ship without one test that executes its SQL against the real
schema** — and this router had no such test while shipping seven statements
across three endpoints, two of which name columns nobody had checked:

    staging.organisations         name, r2_bucket_name, storage_used_bytes,
                                  storage_limit_bytes, r2_account_id
    staging.pahchan_punches       photo_key,   org_id
    staging.sign_documents        file_key, signed_file_key,
                                  certificate_file_key, title, org_id
    staging.graha_documents       file_key,    org_id   ← `name`, NOT `title`
    staging.projects              id, name,    org_id
    staging.graha_clients         id, name,    org_id
    staging.manav_employees       id, name,    org_id
    public.users  +  staging.user_roles        the membership join
    public.teams                  team_id, name, org_id

`public.users` and `public.teams` are the two that would have bitten: there is
no `staging.users` and no `staging.teams` at all — a `staging.tasks` written
from memory raised `UndefinedTableError` while this file was being researched —
and `db.py` sets `search_path TO staging, public`, so an unqualified `users`
resolves differently depending on which schema gained a table that week
(`shadow_tables_and_search_path`).

── HOW, AND WHY NOTHING IS WRITTEN ─────────────────────────────────────────

Two halves, the same separation `test_client_billing_invoices.py` argues for.
Staging and production share one Supabase database, so NOTHING here writes a
row and nothing here reads a customer's data.

  1. CAPTURE, offline. The three handlers are driven with a pool that records
     every statement and its bound arguments and answers from a script, and
     with a fake bucket that returns a listing containing the two id shapes
     that are really in R2 today. The router's own Python builds the SQL
     exactly as it would at run time. This half runs with no database.

  2. CHECK, live. `asyncpg.Connection.prepare()` sends Parse and Describe and
     STOPS — the server plans the statement, resolves every relation, column
     and parameter type, and returns the shapes. It does not execute, does not
     read a row and does not write one. The catalogue is then read directly for
     the half `prepare()` cannot do: that every table a key or a label is
     looked up in actually carries `org_id`, which is the module's whole
     tenancy story.

Run the live half with:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_storage_browser_sql.py -q
"""
from __future__ import annotations

import asyncio
import os

import pytest

import routers.storage_browser as sb
from services import storage


# ── identities ───────────────────────────────────────────────
# Values, never sources. No statement built with them is ever executed.

ORG = "64e7bea6-6abe-490c-a2a4-27a60c6be916"      # E2E Test & Associates, in scope

#: The two id shapes a folder listing really contains — read from the live
#: buckets on 2026-08-26, where `personal/` holds `user_…` segments and
#: `pahchan/` holds a bare employee uuid. Both must drive a label lookup, or
#: the tab draws them as text and breaks the names-not-ids rule.
FOLDER_UUID = "11111111-2222-3333-4444-555555555555"
FOLDER_USER = "user_a1b2c3d4e5f6"


class CapturePool:
    """Records every statement and its arguments; answers nothing.

    THE ONLY THING IT IS ALLOWED TO DO. It holds no connection, so nothing
    reached through it can touch the shared database.
    """

    #: The one answer a handler cannot proceed without: `storage_overview`
    #: raises 404 on an empty read, so the statement after it would never be
    #: captured. E2E Test & Associates' real configuration, read 2026-08-26 —
    #: no own account, no limit set, nothing used.
    ORGANISATION = {
        "name": "E2E Test & Associates",
        "r2_bucket_name": None,
        "storage_used_bytes": 0,
        "storage_limit_bytes": 0,
        "own_account": False,
    }

    def __init__(self):
        self.calls: list[tuple[str, tuple]] = []

    async def fetch(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return []

    async def fetchrow(self, sql, *args, **kw):
        self.calls.append((sql, args))
        if "public.organisations" in sql:
            return dict(self.ORGANISATION)
        return None

    async def fetchval(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return None


class FakeBucket:
    """One page of a listing, in the shape botocore returns.

    Deliberately NOT a mock: the folder names are the two live id shapes, so
    `_folder_labels` runs its real branch instead of returning early on an
    empty list — which is how a label statement would otherwise never be
    captured and never be planned.
    """

    def list_objects_v2(self, **kw):
        prefix = kw.get("Prefix", "")
        return {
            "CommonPrefixes": [
                {"Prefix": f"{prefix}{FOLDER_UUID}/"},
                {"Prefix": f"{prefix}{FOLDER_USER}/"},
            ],
            "Contents": [
                {"Key": f"{prefix}01M0PD8DD09QVSEPMHQ7M6RN91--supply-agreement.pdf",
                 "Size": 12345, "LastModified": None},
            ],
            "IsTruncated": False,
        }

    def head_object(self, **kw):
        raise RuntimeError("no object")          # the "record without a file" case


def _captured() -> list[tuple[str, str, tuple]]:
    """(endpoint, sql, args) for every statement the three handlers issue."""

    async def run():
        import db

        pool = CapturePool()
        original_pool, db._pool = db._pool, pool
        org_r2, client_for_key = storage._get_org_r2, storage._client_for_key

        # An org on the PLATFORM bucket — `_tenant_root` returns
        # `org/{org_id}/`, which is E2E Test & Associates' real configuration
        # (`r2_account_id IS NULL`, verified 2026-08-26).
        async def _no_own_account(_org_id):
            return None, None

        async def _fake_client(_org_id, _key):
            return FakeBucket(), "aekaminc"

        storage._get_org_r2 = _no_own_account
        storage._client_for_key = _fake_client
        try:
            out: list[tuple[str, str, tuple]] = []

            await sb.storage_overview(user={"user_id": "user_test"}, org_id=ORG, _g=None)
            out += [("overview", sql, args) for sql, args in pool.calls]
            pool.calls.clear()

            await sb.browse(prefix="pahchan/", limit=200, cursor="",
                            user={"user_id": "user_test"}, org_id=ORG, _g=None)
            out += [("browse", sql, args) for sql, args in pool.calls]
            pool.calls.clear()

            await sb.resolve_key(body=sb.ResolveBody(key="staging/esign/originals/x.pdf"),
                                 user={"user_id": "user_test"}, org_id=ORG, _g=None)
            out += [("resolve", sql, args) for sql, args in pool.calls]
            return out
        finally:
            db._pool = original_pool
            storage._get_org_r2 = org_r2
            storage._client_for_key = client_for_key

    return asyncio.run(run())


# ══════════════════════════════════════════════════════════════════════════
#  1 · The offline half — what the router actually issues
# ══════════════════════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def captured():
    return _captured()


def test_the_three_endpoints_between_them_issue_every_statement(captured):
    """A guard on the guard: the live half below must be describing this
    router's statements and not an empty list."""
    by_endpoint = {}
    for endpoint, _sql, _args in captured:
        by_endpoint[endpoint] = by_endpoint.get(endpoint, 0) + 1
    assert by_endpoint.get("overview") == 1, by_endpoint
    # four uuid sources + the member join + the team lookup
    assert by_endpoint.get("browse") == 6, by_endpoint
    # five key columns, and the second spelling of the key is not tried once a
    # row is found — no row is found here, so both spellings are: 5 × 2.
    assert by_endpoint.get("resolve") == 10, by_endpoint


def test_every_label_lookup_carries_the_org_in_the_predicate(captured):
    """The same rule `_KEY_COLUMNS` follows, applied to the label lookups this
    tab added: a folder label must not be able to confirm that another org's
    record exists. In the predicate, never filtered afterwards."""
    for endpoint, sql, args in captured:
        if endpoint != "browse":
            continue
        assert "org_id = $1::uuid" in sql, sql
        assert args[0] == ORG, sql


def test_a_folder_that_is_an_id_never_reaches_the_screen_as_one():
    """The one rule this product does not bend. `is_id` is what tells the
    screen the segment may not be drawn; `label` is what it draws instead."""
    labelled = sb._describe_folder(FOLDER_USER, "personal/", {})
    assert labelled["is_id"] is True
    assert labelled["label"] is None
    assert labelled["kind"] == "A member's own files"

    named = sb._describe_folder(FOLDER_UUID, "pahchan/",
                                {FOLDER_UUID: {"label": "Ramesh Patel", "kind": "Employee"}})
    assert named["label"] == "Ramesh Patel"
    assert named["is_id"] is True

    plain = sb._describe_folder("esign", "", {})
    assert plain["is_id"] is False
    assert plain["label"] == "Signed documents"


def test_a_key_stored_without_the_tenant_root_is_still_looked_up(captured):
    """The 137 keys that exist. Every one is stored WITHOUT `org/{org}/`, so a
    single root-prepended candidate matched none of them and the tab answered
    "nothing at this key" about the only keys there are."""
    bound = {args[0] for endpoint, _sql, args in captured if endpoint == "resolve"}
    assert "staging/esign/originals/x.pdf" in bound, (
        "the key as pasted is no longer looked up — a legacy key resolves to "
        "nothing again")
    assert f"org/{ORG}/staging/esign/originals/x.pdf" in bound, (
        "the root-prefixed spelling is no longer tried — a key copied out of a "
        "browse listing stops resolving")


def test_the_display_path_replaces_every_id_with_what_it_names():
    """`relative` still carries a member's user id and an employee's uuid — the
    grammar puts them INSIDE the path. `display` is what a screen draws."""
    rel = f"pahchan/attendance/{FOLDER_UUID}/2026/08/01M0PD8--clock-in.jpg"
    out = sb._display_path(rel, {FOLDER_UUID: {"label": "Ramesh Patel", "kind": "Employee"}})
    assert out == "Attendance photographs / attendance / Ramesh Patel / 2026-08 / clock-in.jpg"
    assert FOLDER_UUID not in out

    # An id that resolves to nothing — a member who left, an employee deleted.
    # The object is still there and still counts, so the row must render.
    orphan = sb._display_path(f"personal/{FOLDER_USER}/2026/08/01M0--shot.png", {})
    assert FOLDER_USER not in orphan
    assert orphan == "Personal uploads / A member's own files / 2026-08 / shot.png"

    # A LEGACY key, which is 137 of the 137 keys that exist: no grammar, no
    # date pair, no `--`. It still has to come out as something readable.
    assert sb._display_path("staging/e2e/sign-doc-9.pdf", {}) == "staging / e2e / sign-doc-9.pdf"


def test_the_used_figure_says_where_it_came_from():
    """`storage_used_bytes` is a running total two upload paths maintain, and
    it read 20,182 bytes against a bucket holding 89,591,092 on 2026-08-27. A
    meter over that number without a provenance line is a wrong answer given
    confidently."""
    import inspect

    code = inspect.getsource(sb.storage_overview)
    assert '"used_note"' in code
    assert "not added to this figure yet" in code


def test_the_relative_key_a_screen_draws_never_carries_the_org():
    """`parsed.relative` is the only spelling of a key the UI may render, and
    an org uuid inside it would be an org id on screen."""
    root = f"org/{ORG}/"
    out = sb._parse_key(f"{root}personal/user_abc/2026/08/01M0--shot.png", root)
    assert ORG not in out["relative"]
    assert out["matches_grammar"] is True


# ══════════════════════════════════════════════════════════════════════════
#  2 · The live half — the only thing a mock pool cannot prove
# ══════════════════════════════════════════════════════════════════════════

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognising it BY VALUE is the only way to tell "no
#: database" from "a database": conftest uses `setdefault`, so `DATABASE_URL`
#: is never absent.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` sets on every connection. Matched so a statement is planned the
#: way it will actually be planned — and it is load-bearing here, because two
#: of this router's relations are in `public` and the rest are in `staging`.
_SEARCH_PATH = "SET search_path TO public"

SKIP_REASON = (
    "no live database. This half parses the router's SQL against the real "
    "catalogue and cannot be done offline — a MagicMock pool answers happily "
    "to a SELECT naming a table that does not exist. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_storage_browser_sql.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def _describe(calls):
    """Parse and Describe every statement. NOTHING IS EXECUTED.

    `prepare()` returns a handle; no `fetch`, no `execute` and no `fetchval` is
    ever called on it, so no row is read and none is written. The only
    statements that DO execute are two reads of `information_schema`, which
    holds no customer data.

    `statement_cache_size=0` because the connection goes through PgBouncer in
    transaction mode, where a cached server-side statement belongs to a session
    that will not be there next time.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures, params = [], []
            for endpoint, sql, args in calls:
                try:
                    stmt = await conn.prepare(sql)
                except Exception as exc:                          # noqa: BLE001
                    failures.append((endpoint, sql, f"{type(exc).__name__}: {exc}"))
                    continue
                params.append((endpoint, sql, len(stmt.get_parameters()), len(args)))
            catalogue = await conn.fetch(
                "SELECT table_schema, table_name, column_name "
                "FROM information_schema.columns "
                "WHERE (table_schema, table_name) IN ("
                "  ('public','organisations'), ('public','pahchan_punches'),"
                "  ('public','sign_documents'), ('public','graha_documents'),"
                "  ('public','graha_clients'), ('public','manav_employees'),"
                "  ('public','projects'), ('public','user_roles'),"
                "  ('public','users'), ('public','teams'))"
            )
            return failures, params, [dict(r) for r in catalogue]
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live(captured):
    """Captured statements, described once for the whole file. Connects ONCE.

    A synchronous fixture running its own loop, deliberately: the suite pins
    `asyncio_default_fixture_loop_scope = function`, so a module-scoped async
    fixture would be sharing a loop it does not own.
    """
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    try:
        return _describe(captured)
    except Exception as exc:                                      # noqa: BLE001
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


def test_every_statement_the_router_issues_plans_on_the_real_schema(live):
    """UndefinedColumn / UndefinedTable means the statement has never worked.
    IndeterminateDatatype means `$1 + $2` with no cast, which PgBouncer turns
    into an instant 500."""
    failures, params, _ = live
    # `assert not failures` is green against an EMPTY capture, so the count of
    # statements actually described is what separates "all seventeen plan"
    # from "the capture broke and nothing was checked". 1 overview + 6 browse
    # + 10 resolve.
    assert len(params) + len(failures) >= 17, (
        f"only {len(params) + len(failures)} statements were described, not 17 "
        f"— the capture rotted")
    assert not failures, "\n\n".join(
        f"[{endpoint}] {err}\n{sql}" for endpoint, sql, err in failures)


def test_every_statement_binds_as_many_arguments_as_it_declares(live):
    """Postgres counts the placeholders; the code counts the arguments. A
    statement whose placeholders were renumbered by hand is exactly where the
    two part company, and no offline check can see it."""
    _, params, _ = live
    wrong = [(e, sql, declared, bound)
             for e, sql, declared, bound in params if declared != bound]
    assert not wrong, "\n\n".join(
        f"[{e}] declares ${declared} but binds {bound} arguments\n{sql}"
        for e, sql, declared, bound in wrong)


def test_every_table_a_key_resolves_against_carries_the_org(live):
    """`prepare()` plans `WHERE org_id = $2::uuid` happily on a table that has
    no such column only because it would raise — this asserts it from the
    catalogue as well, so a table added to `_KEY_COLUMNS` without `org_id`
    fails here rather than at the first support request."""
    _, _, catalogue = live
    have = {(c["table_schema"], c["table_name"], c["column_name"]) for c in catalogue}
    for table, column, _label in sb._KEY_COLUMNS:
        schema, name = table.split(".", 1)
        assert (schema, name, column) in have, f"{table}.{column} does not exist"
        assert (schema, name, "org_id") in have, f"{table} carries no org_id"


def test_every_label_source_exists_with_the_columns_it_names(live):
    """The label lookups this tab added, from the catalogue rather than from
    the migration ledger — migrations are applied by hand here and the ledger
    has been wrong before."""
    _, _, catalogue = live
    have = {(c["table_schema"], c["table_name"], c["column_name"]) for c in catalogue}
    for table, name_col, _kind in sb._UUID_SOURCES:
        schema, name = table.split(".", 1)
        for column in ("id", "org_id", name_col):
            assert (schema, name, column) in have, f"{table}.{column} does not exist"
    # Core product relations, alongside the module tables consolidated into
    # `public` by 241. `search_path` still matters: these are read qualified.
    assert ("public", "users", "user_id") in have
    assert ("public", "teams", "team_id") in have
    assert ("public", "teams", "org_id") in have
    assert ("public", "user_roles", "org_id") in have


def test_the_overview_reads_only_the_five_columns_it_returns(live):
    """No credential is returned, and none is read. `r2_account_id` appears
    once, inside `IS NOT NULL`."""
    _, params, catalogue = live
    have = {c["column_name"] for c in catalogue
            if c["table_schema"] == "public" and c["table_name"] == "organisations"}
    overview = [sql for endpoint, sql, _d, _b in params if endpoint == "overview"]
    assert len(overview) == 1
    for column in ("name", "r2_bucket_name", "storage_used_bytes",
                   "storage_limit_bytes", "r2_account_id"):
        assert column in have, f"public.organisations has no {column}"
    assert "r2_access_key_id" not in overview[0]
    assert "r2_secret_access_key" not in overview[0]
