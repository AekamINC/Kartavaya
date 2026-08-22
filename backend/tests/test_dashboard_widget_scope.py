"""The dashboard `deadlines` widget must not read across organisations.

This route had no test of any kind, and it carried a cross-tenant read that
needed no privilege at all — only a saved widget with no project selected.

Two lines made it. The membership guard fires only when the widget names a team:

    if _allowed_teams is not None and widget_team and widget_team not in _allowed_teams:

so a widget saved WITHOUT one skipped the check entirely and fell into

    AND ($1::text IS NULL OR t.team_id=$1)

where a NULL `$1` makes the whole clause TRUE and disables the team filter. The
route then returned the fifteen nearest upcoming task TITLES and ASSIGNEE NAMES
from every team in every organisation to any authenticated user.

The sibling widgets were never affected, and the contrast is the point: `count`
and `chart` compare `team_id=$1`, which matches no row when `$1` is NULL, so
they fail CLOSED. Only `deadlines` inverted the pattern and failed OPEN. That
asymmetry is what these tests pin — a future edit that "tidies" the three into
one shape must not tidy them into the open one.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

import routers.dashboards as dash


def _row(**kw):
    return kw


def _pool_for(widgets, member_of):
    """A pool that owns one dashboard and reports `member_of` team rows."""
    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value={"widgets": widgets})
    pool.fetchval = AsyncMock(return_value=0)
    pool.execute = AsyncMock()

    calls = []

    async def _fetch(sql, *args):
        calls.append((sql, args))
        # The membership query. It read `team_members` UNION
        # `project_assignments` until phase 2 of the retirement recorded in
        # `PROPOSED_080_team_members_retire.sql`; migration 195 made
        # `project_assignments` a strict superset at identical roles, so the
        # route now asks one table. Matching on the wrong name here does not
        # fail loudly — it returns [], `_allowed_teams` comes back EMPTY, and
        # the deadlines widget short-circuits to no tasks at all. The test then
        # reports "the deadlines widget never queried", which is a fixture
        # miss wearing the costume of a product bug.
        if "project_assignments" in sql:
            return [_row(team_id=t) for t in member_of]
        return []

    pool.fetch = AsyncMock(side_effect=_fetch)
    pool.calls = calls
    return pool


def _deadlines_call(pool):
    """The deadlines query and its args, or None if it never ran."""
    for sql, args in pool.calls:
        if "due_at" in sql and "assignee_name" in sql:
            return sql, args
    return None


USER = {"user_id": "u_staff"}
DEADLINES_NO_TEAM = [{"type": "deadlines", "id": "w1", "config": {}}]


@pytest.mark.asyncio
async def test_a_widget_with_no_team_is_scoped_to_the_callers_own_teams(monkeypatch):
    """The leak: this used to run with no team filter at all."""
    monkeypatch.setattr(dash, "is_platform_staff", AsyncMock(return_value=False))
    pool = _pool_for(DEADLINES_NO_TEAM, member_of=["t_mine", "t_also_mine"])

    await dash.get_dashboard_data("d1", pool=pool, user=USER)

    found = _deadlines_call(pool)
    assert found, "the deadlines widget never queried"
    sql, args = found

    # $2 carries the caller's own teams. If it is None the filter is disabled
    # and every org's tasks come back — which is exactly the bug.
    assert args[1] is not None, "the deadlines query ran unscoped across every organisation"
    assert set(args[1]) == {"t_mine", "t_also_mine"}
    assert "$2::text[]" in sql, "the scoping clause is missing from the query"


@pytest.mark.asyncio
async def test_a_caller_in_no_teams_gets_nothing_rather_than_everything(monkeypatch):
    """The empty set must fail CLOSED. An empty IN-list that is treated as
    'no filter' is the same bug wearing a different hat."""
    monkeypatch.setattr(dash, "is_platform_staff", AsyncMock(return_value=False))
    pool = _pool_for(DEADLINES_NO_TEAM, member_of=[])

    out = await dash.get_dashboard_data("d1", pool=pool, user=USER)

    assert _deadlines_call(pool) is None, "it queried tasks for a user who is in no team"
    assert out["w1"] == {"tasks": []}


@pytest.mark.asyncio
async def test_platform_staff_keep_the_unrestricted_view(monkeypatch):
    """They have it everywhere else; the fix must not quietly remove it."""
    monkeypatch.setattr(dash, "is_platform_staff", AsyncMock(return_value=True))
    pool = _pool_for(DEADLINES_NO_TEAM, member_of=[])

    await dash.get_dashboard_data("d1", pool=pool, user=USER)

    found = _deadlines_call(pool)
    assert found, "platform staff lost the deadlines widget entirely"
    assert found[1][1] is None, "platform staff were scoped when they should not be"


@pytest.mark.asyncio
async def test_a_widget_naming_someone_elses_team_still_returns_nothing(monkeypatch):
    """The original guard was correct for this case; it must survive."""
    monkeypatch.setattr(dash, "is_platform_staff", AsyncMock(return_value=False))
    pool = _pool_for(
        [{"type": "deadlines", "id": "w1", "config": {"team_id": "t_theirs"}}],
        member_of=["t_mine"],
    )

    out = await dash.get_dashboard_data("d1", pool=pool, user=USER)

    assert out["w1"] == {}
    assert _deadlines_call(pool) is None


@pytest.mark.asyncio
async def test_a_widget_naming_the_callers_own_team_still_works(monkeypatch):
    """Guard against over-correcting into refusing everything."""
    monkeypatch.setattr(dash, "is_platform_staff", AsyncMock(return_value=False))
    pool = _pool_for(
        [{"type": "deadlines", "id": "w1", "config": {"team_id": "t_mine"}}],
        member_of=["t_mine"],
    )

    await dash.get_dashboard_data("d1", pool=pool, user=USER)

    found = _deadlines_call(pool)
    assert found, "a legitimate widget stopped querying"
    assert found[1][0] == "t_mine"


@pytest.mark.asyncio
async def test_the_sibling_widgets_still_fail_closed_on_a_null_team(monkeypatch):
    """`count` and `chart` compare `team_id=$1`, which matches nothing when NULL.

    Pinned because the obvious 'tidy-up' is to make all three widgets share one
    filter, and picking the deadlines shape would reopen the leak on two more.
    """
    monkeypatch.setattr(dash, "is_platform_staff", AsyncMock(return_value=False))
    src = open(dash.__file__, encoding="utf-8").read()
    count_and_chart = [
        line for line in src.splitlines()
        if "FROM tasks WHERE team_id=$1" in line
    ]
    assert len(count_and_chart) == 2, "count/chart no longer use the closed comparison"
    for line in count_and_chart:
        # Only the TEAM filter matters here. `count` legitimately carries
        # `($2::text IS NULL OR status=$2)` for an optional status, which is a
        # filter over rows the caller may already see — not a tenant boundary.
        assert "IS NULL OR t.team_id" not in line and "IS NULL OR team_id" not in line, (
            "a sibling widget put its TEAM filter behind `IS NULL OR`, which is "
            "the exact shape that leaked across organisations"
        )
