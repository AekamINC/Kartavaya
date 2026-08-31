"""`GET /v1/niyam/catalog` must serve everything the builder renders from.

── THE FINDING, SUITE 16.03 ON 2026-08-31 ─────────────────────────────────

The catalog's own docstring states the contract: *"The builder renders ONLY
from this. That is the structural half of 'a broken rule is unwritable': the
field list a person picks from and the field list the engine can evaluate are
the same list, served from one registry, so they cannot drift."*

`task.create` broke that contract from the other end. `validate._validate_action`
REQUIRES a `team_id` on that verb and says why —

    "Most events belong to no team, so the target cannot come from the event —
     the rule must name where the task goes, and a rule that names nowhere is
     unfinished."

— and the catalog served no list of projects to name one from. So the builder
could not render the field, picking the verb produced a rule that always failed
to save, and the error named a field that was not on screen.

── WHY THE LIST BELONGS HERE ──────────────────────────────────────────────

Not on a second endpoint, for exactly the reason the docstring gives: "the
builder renders ONLY from this". A separate `/teams` fetch is a second thing to
forget, and forgetting it fails the same silent way — a dropdown with no
options looks like an org with no projects.

⚠ `deleted_at IS NULL` is the guard `dristi.py` already applies to this table.
A rule aimed at a deleted project would validate cleanly and then create tasks
nobody can see — a rule that runs, reports success, and delivers nothing, which
is this codebase's documented dominant failure mode.
"""
import asyncio

import pytest

from routers import niyam_rules as nr

ORG = "00000000-0000-0000-0000-0000000000aa"


class TeamPool:
    def __init__(self, rows):
        self.rows = rows
        self.statements = []

    async def fetch(self, sql, *args):
        self.statements.append((" ".join(sql.split()), args))
        return self.rows

    async def fetchrow(self, sql, *a):
        return None

    async def fetchval(self, sql, *a):
        return 0


@pytest.fixture
def served(monkeypatch):
    pool = TeamPool([
        {"team_id": "11111111-1111-1111-1111-111111111111", "name": "Audit"},
        {"team_id": "22222222-2222-2222-2222-222222222222", "name": "Tax"},
    ])

    async def _get_pool():
        return pool
    monkeypatch.setattr(nr, "get_pool", _get_pool)
    out = asyncio.run(nr.catalog(org_id=ORG, _=None))
    return out, pool


def test_the_catalog_serves_the_projects_a_task_can_be_created_in(served):
    """THE DEFECT. RED before this: the key did not exist, so the builder had
    nothing to fill `task.create`'s required `team_id` from."""
    out, _ = served
    assert "teams" in out, (
        "the catalog serves no project list — `task.create` requires a team_id "
        "and validate.py refuses the rule without one")
    assert [t["name"] for t in out["teams"]] == ["Audit", "Tax"]


def test_the_ids_are_strings(served):
    """A uuid straight off asyncpg is not JSON-serialisable, and a 500 here
    takes the WHOLE builder down — events, actions and all — not just the one
    verb this was added for."""
    out, _ = served
    for t in out["teams"]:
        assert isinstance(t["team_id"], str)


def test_deleted_projects_are_not_offered(served):
    """`dristi.py`'s guard on the same table. A rule aimed at a deleted project
    validates and then creates tasks nobody can see."""
    _, pool = served
    sql = " ".join(s for s, _ in pool.statements if "teams" in s)
    assert "deleted_at IS NULL" in sql, sql


def test_the_list_is_scoped_to_the_callers_org(served):
    """The org id is BOUND, not interpolated, and it is the caller's."""
    _, pool = served
    stmt = next((s, a) for s, a in pool.statements if "teams" in s)
    assert "org_id = $1::uuid" in stmt[0]
    assert stmt[1] == (ORG,)


def test_events_and_actions_did_not_move(served):
    """The addition must not disturb what the builder already renders from —
    the same file's `test_niyam_catalog_only_offers_real_triggers.py` holds the
    events, and this holds that they are still there at all."""
    out, _ = served
    assert out["events"] and out["actions"]
    for verb in ("task.create", "notify.send", "report.send"):
        assert verb in out["actions"]
