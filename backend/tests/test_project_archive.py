"""Archiving a finished project is not deleting it.

`public.teams` already had `deleted_at`/`deleted_by`, and the endpoints behind
them say what they mean: delete_team is "Soft-delete: move project to bin.
Hard-purged after 30 days", restore_team refuses past that window, purge_team
erases the rows.

So the existing second state is a THIRTY-DAY COUNTDOWN TO ERASURE. That is right
for "this project was a mistake" and wrong for "this engagement finished". A
completed audit is the firm's record: it must leave the project list and must
never acquire a deletion date.

THE ASYMMETRY IS THE WHOLE FEATURE, and it is what a status column would have
got wrong: archived projects are HIDDEN from pickers, lists and boards, and are
still COUNTED by every report and export. A year-end total that silently drops
every completed engagement is worse than no total.
"""
import inspect
import pathlib
import re

import server

SRC = pathlib.Path(server.__file__).read_text(encoding="utf-8")


def _code(fn) -> str:
    src = inspect.getsource(fn)
    return " ".join("\n".join(
        l for l in src.splitlines() if not l.strip().startswith("#")).split())


def test_archiving_does_not_touch_the_deletion_columns():
    """THE regression this feature exists to avoid. An archive that sets
    `deleted_at` puts a finished engagement on a 30-day countdown to erasure."""
    code = _code(server.archive_team)
    assert "deleted_at=NOW()" not in code and "deleted_by" not in code, \
        "archiving is writing the deletion columns — the project would be purged in 30 days"
    assert "archived_at=NOW()" in code


def test_archiving_refuses_a_project_already_in_the_bin():
    """A project on its way out is not a project being filed away."""
    assert "deleted_at IS NULL" in _code(server.archive_team)


def test_archiving_twice_does_not_move_the_date():
    """The stamp is a fact about when the engagement finished, not about the
    last time somebody clicked."""
    assert "archived_at IS NULL" in _code(server.archive_team)


def test_unarchiving_clears_both_columns():
    code = _code(server.unarchive_team)
    assert "archived_at=NULL" in code and "archived_by=NULL" in code


def test_unarchiving_refuses_a_project_that_is_not_archived():
    assert "archived_at IS NOT NULL" in _code(server.unarchive_team)


def test_both_endpoints_refuse_loudly_before_the_migration_is_applied():
    """
    Migrations here are applied BY HAND and the deploy is separate, so both
    orders happen. Before the column exists this must answer 503 naming the
    migration — not 500 on UndefinedColumn, and above all not appear to succeed.
    """
    for fn in (server.archive_team, server.unarchive_team):
        code = _code(fn)
        assert "archive_column_ready" in code, f"{fn.__name__} does not probe for the column"
        assert "503" in code and "104" in code, f"{fn.__name__} does not name the migration"


def test_the_probe_caches_asymmetrically():
    """
    TRUE forever because a column does not un-exist; FALSE briefly so applying
    the migration takes effect without a redeploy. Caching FALSE forever would
    mean the feature stays dead until someone restarts the service.
    """
    code = _code(server.archive_column_ready)
    assert 'recheck_after' in code and '60' in code


def test_the_delete_endpoints_are_unchanged():
    """The bin still works, and still means erasure. Archiving is a third state,
    not a replacement for the second."""
    assert "Hard-purged after 30 days" in _code(server.delete_team)
    assert "restore window expired" in _code(server.restore_team)


def test_the_migration_adds_no_default():
    """A default on archived_at archives every project in the product."""
    sql = (pathlib.Path(__file__).resolve().parent.parent / "migrations"
           / "104_project_archive.sql").read_text(encoding="utf-8")
    body = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
    add = body[body.index("ADD COLUMN IF NOT EXISTS archived_at"):][:200]
    assert "DEFAULT" not in add.upper()
    assert "NOT NULL" not in add.upper()


# ── The read side: hidden from pickers, counted by reports ───────────────────

import pytest


class _P:
    def __init__(self, teams, archived=(), has_column=True):
        self.teams = teams
        self.archived = set(archived)
        self.has_column = has_column
        self.queries = []

    async def fetch(self, sql, *a):
        self.queries.append(" ".join(sql.split()))
        if "archived_at IS NOT NULL" in sql:
            return [{"team_id": t} for t in a[0] if t in self.archived]
        return [{"team_id": t} for t in self.teams]

    async def fetchval(self, sql, *a):
        if "information_schema" in sql:
            return 1 if self.has_column else None
        return None


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    server._team_ids_request_cache.clear()
    server._archive_ready.clear()

    async def _no(uid, org_id=None):
        return False
    monkeypatch.setattr(server, "is_org_admin", _no)
    yield
    server._team_ids_request_cache.clear()
    server._archive_ready.clear()


@pytest.mark.asyncio
async def test_reports_still_count_an_archived_project():
    """THE property. Revenue and hours for a finished engagement are exactly the
    numbers a firm looks back at."""
    pool = _P(["t_live", "t_done"], archived=["t_done"])
    got = await server.get_visible_team_ids(pool, "u1")          # default
    assert "t_done" in got


@pytest.mark.asyncio
async def test_a_picker_can_ask_for_it_to_be_hidden():
    pool = _P(["t_live", "t_done"], archived=["t_done"])
    got = await server.get_visible_team_ids(pool, "u1", include_archived=False)
    assert got == ["t_live"]


@pytest.mark.asyncio
async def test_the_default_is_the_safe_direction():
    """
    A caller that forgets the flag keeps counting everything — wrong on a picker
    in a way somebody complains about, wrong on a report in a way nobody
    notices. Given one has to be the default, it is the one that fails loudly.
    """
    import inspect
    sig = inspect.signature(server.get_visible_team_ids)
    assert sig.parameters["include_archived"].default is True


@pytest.mark.asyncio
async def test_the_two_answers_do_not_share_a_cache_entry():
    """A report and a board genuinely run in the same request. Without the flag
    in the key, whichever asked first would decide for the other."""
    pool = _P(["t_live", "t_done"], archived=["t_done"])
    hidden = await server.get_visible_team_ids(pool, "u1", include_archived=False)
    shown = await server.get_visible_team_ids(pool, "u1", include_archived=True)
    assert hidden == ["t_live"] and "t_done" in shown


@pytest.mark.asyncio
async def test_it_does_not_raise_before_the_migration_is_applied():
    """A picker briefly showing a finished project is cosmetic. A 500 in the
    helper that decides visibility takes the product down."""
    pool = _P(["t_live", "t_done"], archived=["t_done"], has_column=False)
    got = await server.get_visible_team_ids(pool, "u1", include_archived=False)
    assert got == ["t_live", "t_done"]
    assert not any("archived_at IS NOT NULL" in q for q in pool.queries)


@pytest.mark.asyncio
async def test_no_extra_query_when_nothing_is_hidden():
    """The default path is on every request in the product; it must not pay for
    a feature it did not ask for."""
    pool = _P(["t_live"])
    await server.get_visible_team_ids(pool, "u1")
    assert not any("archived_at" in q for q in pool.queries)
