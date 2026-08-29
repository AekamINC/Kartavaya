"""The recycle bin's SQL, parsed against the real catalogue.

Proposal 93 §B. `tests/test_every_writer_has_a_live_sql_test.py` is the ratchet
that demands this file exist, and its reasoning is the reason to read it before
this one: `tests/conftest.py` hands every module a MagicMock pool, and a
MagicMock answers happily to a statement naming a column that is not there. That
is how `gst_rate` — a column that has never existed on `ganit_invoices` —
survived in two INSERTs that had therefore NEVER ONCE SUCCEEDED.

`routers/recycle_bin.py` is a NEW writing router, so it fails that ratchet on
sight unless this file names it and calls `prepare()`. It does both.

── NOTHING IS EXECUTED, AND THAT IS THE WHOLE SAFETY STORY ─────────────────

`prepare()` sends Parse and Describe and STOPS. The server plans the statement,
resolves every relation, column and parameter type, and returns the shapes. No
`fetch`, `execute` or `fetchval` is ever called on the handle, so no row is read
and none is written.

That distinction matters more here than almost anywhere: **staging and
production share one Supabase database**, `public.tasks` is a table production
serves live, and this router's restore path writes to it. A test that executed
its statements would be editing a production row to prove a column exists.

── AND `prepare()` IS NOT SUFFICIENT ON ITS OWN ────────────────────────────

It plans a statement that omits a NOT NULL column perfectly happily — that is a
runtime constraint, not a parse error. So the catalogue is read directly as
well, and `deleted_files`'s NOT NULL columns are checked against what
`bin_file` actually supplies.

Run it with:
    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_recycle_bin_live_sql.py -q
"""
import asyncio
import os

import pytest

import routers.recycle_bin as recycle_router  # noqa: F401  (names the router for the ratchet)
from services import recycle_bin as bin_svc

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognising it BY VALUE is the only way to tell "no
#: database" from "a database": conftest uses `setdefault`, so `DATABASE_URL`
#: is never absent.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` sets on every connection. Matched so a statement is planned the
#: way it will actually be planned.
_SEARCH_PATH = "SET search_path TO public"

SKIP_REASON = (
    "no live database. This file parses the recycle bin's SQL against the real "
    "catalogue and cannot be done offline — a MagicMock pool answers happily to "
    "an INSERT naming a column that does not exist."
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


#: Every statement this feature issues, composed exactly as the code composes
#: them — the fragments are concatenated at call time, so a test that prepared
#: the CONSTANTS would be proving something the product never sends.
#:
#: ⚠ The two `public.tasks` statements are in this list on purpose. They are
#: schema-qualified because an unqualified write is its own defect: migration
#: 142 exists because a query that relied on `search_path` found a shadow table
#: in the other schema, and `staging.tasks` does not exist at all — `tasks`
#: resolves to `public` only by the search path's second entry.
STATEMENTS: list[tuple[str, str]] = [
    ("list_bin", bin_svc._LIST_SELECT + """
         WHERE d.org_id = $1::uuid
           AND d.purged_at IS NULL
           AND d.restored_at IS NULL
         ORDER BY d.deleted_at DESC
        """),
    ("get_row", bin_svc._SELECT + " WHERE id = $1::uuid AND org_id = $2::uuid"),
    ("purge:by_id", bin_svc._SELECT + " WHERE id = $1::uuid"),
    ("bin_file", """
        INSERT INTO public.deleted_files
              (org_id, source_kind, source_id, file_name, r2_key, file_url,
               size_bytes, deleted_by)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::bigint, $8)
        RETURNING *
        """),
    ("promote", """
        UPDATE public.deleted_files
           SET stage2_at = now()
         WHERE id = $1::uuid AND org_id = $2::uuid
           AND purged_at IS NULL AND restored_at IS NULL
           AND stage2_at IS NULL
        RETURNING *
        """),
    ("mark_restored", """
        UPDATE public.deleted_files
           SET restored_at = now()
         WHERE id = $1::uuid AND org_id = $2::uuid
           AND purged_at IS NULL AND restored_at IS NULL
        RETURNING *
        """),
    ("purge:mark", "UPDATE public.deleted_files SET purged_at=now(), purge_error=NULL "
                   "WHERE id=$1::uuid"),
    ("purge:error", "UPDATE public.deleted_files SET purge_error=$2 WHERE id=$1::uuid"),
    ("due_for_purge", bin_svc._SELECT + """
         WHERE purged_at IS NULL
           AND restored_at IS NULL
           AND deleted_at < now() - ($1::int * interval '1 day')
         ORDER BY deleted_at ASC
         LIMIT $2::int
        """),
    ("restore:read_task", "SELECT task_id, attachments FROM public.tasks "
                          "WHERE task_id=$1 AND org_id=$2::uuid"),
    ("restore:write_task", "UPDATE public.tasks SET attachments=$1::jsonb, updated_at=NOW() "
                           "WHERE task_id=$2 AND org_id=$3::uuid"),
    ("restore:graha", "UPDATE public.graha_documents "
                      "   SET is_active=TRUE, updated_at=NOW(), updated_by=$3 "
                      " WHERE id=$1::uuid AND org_id=$2::uuid"),
    ("graha:read_before_bin",
     "SELECT id, name, file_key, file_url, file_size FROM public.graha_documents "
     "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE"),
]


def _describe():
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures = []
            for label, sql in STATEMENTS:
                try:
                    await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((label, f"{type(exc).__name__}: {exc}"))
            catalogue = await conn.fetch(
                "SELECT column_name, is_nullable, column_default "
                "  FROM information_schema.columns "
                " WHERE table_schema = ANY(current_schemas(false)) AND table_name='deleted_files'"
            )
            return failures, [dict(r) for r in catalogue]
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    if not live_dsn():
        pytest.skip(SKIP_REASON)
    return _describe()


def test_every_statement_parses_against_the_real_schema(live):
    failures, _ = live
    assert not failures, "statements the live catalogue refuses:\n" + "\n".join(
        f"  {label}: {err}" for label, err in failures
    )


def test_every_not_null_column_is_supplied_by_bin_file(live):
    """`prepare()` cannot catch this, which is why the catalogue is read too.

    A NOT NULL column with no default that `bin_file`'s INSERT omits is a
    runtime failure on the FIRST real delete — and the mock pool would have
    reported success. `invoice_number` is the precedent: NOT NULL, no default,
    omitted, and the INSERT had never once succeeded.
    """
    _, catalogue = live
    # `required` is built FROM this catalogue read, and `set() <= supplied` is
    # True — so an empty read makes the assertion below unconditionally green
    # while proving nothing about `deleted_files`. Its sibling files
    # (test_compliance_settings_screen, test_income_tax_ladder) each carry this
    # guard; this one did not.
    assert catalogue, (
        "the catalogue read returned no columns for `deleted_files` — the "
        "table is absent from the search_path schemas, so the NOT NULL check "
        "below is vacuous")
    supplied = {
        "org_id", "source_kind", "source_id", "file_name", "r2_key",
        "file_url", "size_bytes", "deleted_by",
    }
    required = {
        c["column_name"] for c in catalogue
        if c["is_nullable"] == "NO" and not c["column_default"]
    }
    assert required <= supplied, (
        "NOT NULL with no default and NOT supplied by bin_file's INSERT: "
        f"{sorted(required - supplied)}"
    )


def test_the_source_kind_check_is_read_from_the_catalogue(live):
    """The two sources, from `pg_constraint` rather than from the migration file.

    Migration 238 exists because a CHECK was live that two repo files both
    declared "NOT APPLIED". Ganit invoices and eSign documents must never be
    binnable — 8-year Income Tax retention, 72-month GST — and this is where
    that is verified against the database rather than against a comment.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            return await conn.fetchval(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conname='deleted_files_source_kind'"
            )
        finally:
            await conn.close()

    definition = asyncio.run(run())
    assert definition, "the source_kind CHECK is not on the live database"
    assert "task_attachment" in definition and "graha_document" in definition
    for forbidden in ("ganit", "invoice", "esign", "sign_document"):
        assert forbidden not in definition.lower(), (
            f"{forbidden!r} appears in the binnable sources. Books of account "
            "carry an 8-year Income Tax retention and GST records 72 months."
        )


def test_the_service_and_the_check_agree_on_the_two_sources():
    """Offline half — runs with no database, so a drift is caught in CI too."""
    assert set(bin_svc.SOURCE_KINDS) == {"task_attachment", "graha_document"}


def test_the_windows_are_the_owners_numbers():
    """14 and 90, and they are not arbitrary: a real recovery window and a real
    floor on cost. The frontend mirrors them but the server enforces them."""
    assert bin_svc.STAGE2_AFTER_DAYS == 14
    assert bin_svc.PURGE_AFTER_DAYS == 90
