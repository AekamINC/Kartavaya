"""A sales target could never be saved by anyone, in any org.

`staging.vikray_targets.salesperson_id` was a **uuid** column. The Targets tab
fills its picker from `GET /v1/org/members` and stores `p.user_id`, and a user
id in this product is TEXT — `user_549c9cac35aa` — because `public.users.user_id`
is text. Casting that to uuid throws, so the INSERT 500'd on every attempt.

The screen said "Could not save the target" and nothing more, because the
browser gets a 500 with no CORS headers and so has no response body to report.
Identical failure signature to the bank-statement import: the console blames
CORS, the network tab shows a failed request with no body, and the actual cause
is a type error in SQL.

The read paths already knew the answer and had been quietly returning nothing:
both `vikray.list_targets` and `dristi` joined with
`u.user_id = t.salesperson_id::text` — casting a uuid to text to match a text
user id, which cannot match for any value. Measured on live data before the fix:
**20 targets, 0 attached to a real person.** Every salesperson cell was blank.

Migration 092 makes the column text. These tests pin the SQL so it cannot drift
back, because the failure is invisible until someone tries to save one.
"""
import inspect
import re

import pytest

import routers.dristi as dristi
import routers.vikray as vikray


def _sql(fn) -> str:
    return re.sub(r"\s+", " ", inspect.getsource(fn))


def test_the_salesperson_is_stored_without_a_uuid_cast():
    """The regression. `$2::uuid` on a text user id is the whole bug."""
    sql = _sql(vikray.create_target)
    assert "$2::uuid" not in sql, \
        "salesperson_id is being cast to uuid again — every save will 500"
    assert "VALUES ($1::uuid, $2," in sql


def test_the_user_join_no_longer_casts_the_salesperson_to_text():
    """`u.user_id = t.salesperson_id::text` compares a uuid's text form against
    `user_xxxxxxxx`. It never matched, so the name column was always blank."""
    for fn in (vikray.list_targets, vikray.targets_leaderboard, dristi.sales_analytics):
        sql = _sql(fn)
        if "salesperson_id" not in sql:
            continue
        assert "t.salesperson_id::text" not in sql, \
            f"{fn.__name__} still casts a text column to text to match a user id"
        assert "u.user_id = t.salesperson_id" in sql


def test_the_deal_owner_side_is_cast_instead():
    """`graha_deals.owner_id` is STILL a uuid, so with salesperson_id as text the
    comparison needs the cast on the other side or the query raises."""
    for fn in (vikray.list_targets, vikray.targets_leaderboard, dristi.sales_analytics):
        sql = _sql(fn)
        if "owner_id" not in sql or "salesperson_id" not in sql:
            continue
        assert "owner_id::text = t.salesperson_id" in sql, \
            f"{fn.__name__} compares uuid owner_id against text salesperson_id"


@pytest.mark.asyncio
async def test_a_target_accepts_a_real_user_id(monkeypatch):
    """The shape the picker actually produces: `user_` + hex, not a uuid."""
    captured = {}

    class _Pool:
        async def fetchrow(self, q, *a):
            captured["sql"] = q
            captured["args"] = a
            return {"id": "t1", "salesperson_id": a[1]}

    async def _get_pool():
        return _Pool()

    monkeypatch.setattr(vikray, "get_pool", _get_pool)

    body = vikray.TargetCreate(
        salesperson_id="user_549c9cac35aa",
        period_start="2026-08-01", period_end="2026-08-31",
        target_amount=1500000, target_deals=12,
    )
    out = await vikray.create_target(body, user={"user_id": "user_f1a0a472b98f"}, org_id="org1")

    assert captured["args"][1] == "user_549c9cac35aa", \
        "the user id was mangled on its way to SQL"
    assert out["salesperson_id"] == "user_549c9cac35aa"


def test_the_migration_explains_why_graha_deals_owner_id_is_left_alone():
    """It has the same mismatch and is deliberately NOT changed: nothing writes
    it, so there is no broken flow to fix and no data to migrate. The note has
    to survive, or the next person changes it on a guess."""
    from pathlib import Path
    sql = Path(__file__).resolve().parents[1] / "migrations" / \
        "092_sales_target_salesperson_is_a_user_id.sql"
    # Normalised: the note is wrapped across comment lines, so a literal
    # substring search matches nothing and proves nothing.
    text = re.sub(r"\s+", " ", sql.read_text(encoding="utf-8").replace("--", " "))
    assert "graha_deals.owner_id" in text
    assert "nothing in the codebase writes it" in text
    assert "0 deals carry an owner" in text
