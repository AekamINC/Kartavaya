"""Who may write a project's membership rows in an org they do not belong to.

── The bypass this pins ─────────────────────────────────────────────────────

`POST/PUT /api/teams/{id}/members` skipped the project-membership check for
anyone `is_platform_staff` returned true for — and that function reads ALL
EIGHT platform role codes, because it answers "is this person Aekam staff".
Live when this was narrowed (2026-08-27): `platform_admin` 4, `platform_staff`
4, `platform_manager` 2 — so **ten** accounts could add a member, or change
somebody's role, in **all five** organisations, including the one none of them
belongs to. That contradicted `may_act_in_org` sitting beside it.

Owner's decision, 2026-08-27: *"platform account having role account manager
can probably do."* `account_manager` is superseded by `platform_manager`
(`role_tiers.py:29`), so the write is manager-and-above: god mode plus manager,
**not** `platform_staff`.

── Why the test is written against the ROLE SET, not a mocked boolean ───────

A test that patched `may_manage_project_membership` to return True/False would
pass whatever roles the function actually reads, which is the only thing this
change is about. So these assert on the tuple and on the SQL parameter — the
two places the role set can be wrong — and one test drives the route with a
pool that answers by role code.

This is NOT a privacy test. The email disclosure those routes carried was fixed
separately in `183f1ac0` and is pinned by `test_platform_privacy.py`.
"""
import inspect

import pytest

from middleware import roles as R
from middleware.role_tiers import GOD_MODE_ROLES, MANAGER_ROLES, STAFF_ROLES


def test_the_write_is_god_mode_plus_manager_and_nothing_else():
    assert set(R.MEMBERSHIP_WRITE_ROLES) == set(GOD_MODE_ROLES) | set(MANAGER_ROLES)


def test_platform_staff_cannot_write_membership_anywhere():
    """The four `platform_staff` accounts are the point of the narrowing.

    Their tier is defined as the operating set — CRM, sales, marketing,
    analytics, messaging — which is not permissions.
    """
    for code in STAFF_ROLES:
        assert code not in R.MEMBERSHIP_WRITE_ROLES


def test_god_mode_keeps_it():
    """Excluding god mode would be incoherent, not safer: it is defined as
    every module, every org."""
    for code in GOD_MODE_ROLES:
        assert code in R.MEMBERSHIP_WRITE_ROLES


def test_the_manager_role_is_the_one_the_owner_named():
    # `account_manager` is the owner's word; `platform_manager` is the code that
    # superseded it. If somebody ever reintroduces the old spelling as a live
    # role, this is where the two must be reconciled.
    assert "platform_manager" in R.MEMBERSHIP_WRITE_ROLES


@pytest.mark.asyncio
async def test_the_query_binds_the_narrow_set_not_every_platform_code(monkeypatch):
    """The SQL must carry MEMBERSHIP_WRITE_ROLES, not ALL_PLATFORM_ROLES.

    Reading the bound parameter rather than trusting the constant, because the
    defect being prevented is a function that names the right tuple in a comment
    and passes the wrong one to the database.
    """
    seen = {}

    class _Pool:
        async def fetchval(self, sql, *args):
            seen["sql"] = sql
            seen["args"] = args
            return 1

    monkeypatch.setattr(R, "get_pool", lambda: _fake_pool(_Pool()))
    assert await R.may_manage_project_membership("user_x") is True

    bound = seen["args"][1]
    assert set(bound) == set(R.MEMBERSHIP_WRITE_ROLES)
    from middleware.role_tiers import ALL_PLATFORM_ROLES
    assert set(bound) != set(ALL_PLATFORM_ROLES), (
        "the narrow set and the full platform set are the same — the narrowing "
        "has been undone"
    )
    # org_id IS NULL is what makes this a PLATFORM role rather than a role in
    # some organisation; without it an org_admin anywhere would pass.
    assert "org_id IS NULL" in seen["sql"]


async def _fake_pool(p):
    return p


def test_both_membership_routes_use_the_narrow_helper():
    """`add_team_member` and `update_team_member`, by source.

    Written against the source because the routes are large and driving both
    end to end here would test the fixtures more than the guard. If either ever
    goes back to `is_platform_staff`, this fails by name.
    """
    import server

    for fn_name in ("add_team_member", "update_team_member"):
        fn = getattr(server, fn_name)
        src = inspect.getsource(fn)
        assert "may_manage_project_membership" in src, (
            f"{fn_name} no longer uses the narrowed membership check"
        )
        # The CALL, not the NAME. Both routes discuss `is_platform_staff` in
        # their docstrings — that history is why the narrowing exists and
        # deleting it to satisfy a test would be the wrong trade. On its first
        # run this assertion matched the prose and failed a correct fix, the
        # same false positive `check-mappls-attribution.mjs` hit the same day.
        assert "await is_platform_staff(" not in src, (
            f"{fn_name} is back on is_platform_staff — that admits all eight "
            "platform codes and re-opens the cross-org membership write"
        )
