"""
Task @mentions — the half of D that had never fired.

MEASURED on the live database, 2026-08-23, and this is the whole reason the
file exists:

    public.mentions                              0 rows, all time
    notifications type='mention', in Sanvaad    22  (real people, #general)
    notifications type='mention', on a task      5  — every one of them
                                                    'Seeded E2E notification #N'
    task comments containing a real @name       10  (6 Jun – 23 Jul, four
                                                    different people named)

So ten times somebody summoned a colleague on a task and nothing whatsoever
happened, while Sanvaad worked. "@mention only works in Sanvaad" was not an
impression — it is what the data says.

These tests hold the three things that were wrong. They exercise
`_resolve_mentions` against a fake pool rather than a live database, because
the rule in this project is that validation is never tested by writing to the
one Supabase instance that production also uses.
"""
import pytest

from services.mentions import _resolve_mentions


class FakePool:
    """Answers `fetch` from a script, and records what it was asked."""

    def __init__(self, members=None, by_handle=None):
        self._members = members or []
        self._by_handle = by_handle or {}
        self.queries = []

    async def fetch(self, sql, *args):
        self.queries.append((" ".join(sql.split()), args))
        return list(self._members)

    async def fetchrow(self, sql, *args):
        self.queries.append((" ".join(sql.split()), args))
        return self._by_handle.get(args[0].lower() if args else None)


def member(uid, display, email="x@example.com"):
    return {"user_id": uid, "email": email, "display": display}


@pytest.mark.asyncio
async def test_a_personal_task_can_still_name_a_colleague():
    """The gap that was left.

    `team_id` is NULL for a personal task — 36 of them live. Pass 1 was skipped
    for every one, so only the single-token regex remained, and that cannot
    match a display name containing a space. The composer still offered the
    picker and still inserted the full name.
    """
    pool = FakePool(members=[member("u1", "Keval Shah")])
    found = await _resolve_mentions(pool, "@Keval Shah can you look", None, actor_id="u2")
    assert [f["user_id"] for f in found] == ["u1"]


@pytest.mark.asyncio
async def test_the_personal_task_pool_excludes_platform_grants():
    """`org_id IS NULL` in user_roles is a PLATFORM grant — a value, not an
    absence. Without the predicate, every Aekam staff account becomes
    mentionable from inside a customer's private task, and vice versa."""
    pool = FakePool(members=[member("u1", "Keval Shah")])
    await _resolve_mentions(pool, "@Keval Shah", None, actor_id="u2")
    sql, args = pool.queries[0]
    assert "mine.org_id IS NOT NULL" in sql
    assert args == ("u2",)


@pytest.mark.asyncio
async def test_a_personal_task_with_no_actor_asks_nothing():
    """No actor, no organisation to scope to — and the right answer to "who may
    be named here" is nobody, never everybody."""
    pool = FakePool(members=[member("u1", "Keval Shah")])
    found = await _resolve_mentions(pool, "@Keval Shah", None, actor_id=None)
    assert found == []
    assert pool.queries == [] or all("user_roles" not in q for q, _ in pool.queries)


@pytest.mark.asyncio
async def test_a_project_task_still_reads_project_assignments():
    """Phase 2 of the tenancy cutover. Unchanged by the fallback above."""
    pool = FakePool(members=[member("u1", "Keval Shah")])
    await _resolve_mentions(pool, "@Keval Shah", "team_7", actor_id="u2")
    sql, args = pool.queries[0]
    assert "project_assignments" in sql
    assert "team_members" not in sql
    assert args == ("team_7",)


@pytest.mark.asyncio
async def test_the_longest_display_name_wins():
    """A member called "Keval" must not shadow "Keval Shah"."""
    pool = FakePool(members=[member("short", "Keval"), member("long", "Keval Shah")])
    found = await _resolve_mentions(pool, "@Keval Shah please", "t1", actor_id="a")
    assert [f["user_id"] for f in found] == ["long"]


@pytest.mark.asyncio
async def test_nobody_is_resolved_from_an_email_domain():
    """Pass 2's single-token regex must not turn a pasted address into a
    summons for whoever happens to be called by its local part."""
    pool = FakePool(members=[])
    found = await _resolve_mentions(pool, "write to bhumi@example.com", "t1", actor_id="a")
    assert found == []


@pytest.mark.asyncio
async def test_a_full_name_is_not_re_read_as_somebody_elses_handle():
    """The half of "longest wins" that a fake pool hides.

    Pass 1 resolves "@Keval Shah" correctly. Pass 2 then used to scan the RAW
    body, find the bare token "Keval" inside those same words, and add a
    different colleague who happens to be called that — telling them they were
    named somewhere they were not.
    """
    pool = FakePool(
        members=[member("long", "Keval Shah")],
        by_handle={"keval": {"user_id": "someone_else", "email": "k@e.com",
                             "display": "Keval"}},
    )
    found = await _resolve_mentions(pool, "@Keval Shah please look", "t1", actor_id="a")
    assert [f["user_id"] for f in found] == ["long"]


@pytest.mark.asyncio
async def test_a_genuine_second_handle_still_resolves():
    """The consumption must take the matched span and nothing more."""
    pool = FakePool(
        members=[member("long", "Keval Shah")],
        by_handle={"bhumi": {"user_id": "u_b", "email": "b@e.com", "display": "bhumi"}},
    )
    found = await _resolve_mentions(pool, "@Keval Shah and @bhumi", "t1", actor_id="a")
    assert sorted(f["user_id"] for f in found) == ["long", "u_b"]
