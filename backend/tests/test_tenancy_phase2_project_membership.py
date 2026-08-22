"""Phase 2 of the tenancy cutover, for the modules in `services/`.

WHAT PHASE 2 IS
───────────────
`backend/migrations/PROPOSED_080_team_members_retire.sql` records a six-step
retirement for `public.team_members`, and step 2 is "replace the call sites with
`project_assignments` (or `user_roles` where the check is really about ORG
membership)". Step 1 — migration 195, applied to the live database 2026-08-22 —
is what makes step 2 safe: it copied the 127 active `team_members` rows that had
no counterpart into `project_assignments`, so the second table became a strict
superset of the first at identical roles.

Re-measured read-only against the live database immediately before these changes
were written:

    public.team_members                                  198   (all 'active')
    public.project_assignments                           219
    active team_members with no project_assignments row     0
    rows where the two disagree about ROLE                  0
    users reachable in an org via tm but not via pa         0

That last line is the one that licenses the reads to move. A read switched from
`team_members` to `project_assignments` can only widen, never revoke — and the
widening is 21 rows that were always real grants made through the newer path.

THE RULE THESE TESTS EXIST TO HOLD
──────────────────────────────────
  · READS move to `public.project_assignments`.
  · WRITES AND DELETES KEEP TOUCHING BOTH. That is a requirement, not a
    preference: PROPOSED_080's step 4 renames the table rather than dropping it
    precisely so the step is reversible, and it is only reversible while
    `team_members` is still maintained. The day a writer stops writing it, the
    rollback stops restoring a usable table and starts restoring a stale one.
  · Every table name is SCHEMA-QUALIFIED. This database contains a
    `qa_cleanup_20260822.team_members` shadow copy; migration 142 is the
    incident this project learned that from.

WHAT A MOCK CAN AND CANNOT PROVE
────────────────────────────────
These are largely source assertions. A mock pool hides bad SQL — it will happily
"run" a query naming a column that does not exist — so nothing here proves a
statement parses. Every statement changed in this phase was executed read-only
against the live Supabase database on 2026-08-22 with real ids, and each
returned rows; that is the parse evidence, and it lives in the commit message
and in the comments at each call site rather than in an assertion, because a
test cannot re-derive it without writing to a shared production database.

What these assertions DO catch is the regression that has actually happened to
this codebase before: a call site quietly reverting to the legacy table, or a
new one being added against it, long after everybody has stopped thinking about
the cutover.
"""
import inspect
import pathlib

import pytest

from services import mentions as mentions_mod
from services import project_purge
from services import task_actor
from services.skills.data import firm_flow, my_desk


def _src(fn) -> str:
    return " ".join(inspect.getsource(fn).split())


BACKEND = pathlib.Path(__file__).resolve().parents[1]


# ── reads: project membership now has exactly one table ──────────────────────

@pytest.mark.parametrize("label, fn", [
    ("task_actor.project_role", task_actor.project_role),
    ("mentions._resolve_mentions", mentions_mod._resolve_mentions),
    ("my_desk.get_my_desk", my_desk.get_my_desk),
    ("firm_flow.check_approvals_that_sit", firm_flow.check_approvals_that_sit),
])
def test_the_project_membership_reads_name_project_assignments(label, fn):
    """Each of these asked "is this person on this project, and as what".

    They are grouped because they used to disagree in a way that was visible to
    users: `my_desk`'s two approval legs read different tables as each other,
    so the same desk both listed and hid approvals by the same person on the
    same project depending on which leg produced the row.
    """
    src = _src(fn)
    assert "public.project_assignments" in src, \
        f"{label} no longer reads the project-membership table"


@pytest.mark.parametrize("label, fn", [
    ("task_actor.project_role", task_actor.project_role),
    ("mentions._resolve_mentions", mentions_mod._resolve_mentions),
    ("my_desk.get_my_desk", my_desk.get_my_desk),
    ("firm_flow.check_approvals_that_sit", firm_flow.check_approvals_that_sit),
])
def test_no_project_membership_read_falls_back_to_team_members(label, fn):
    """A fallback is invisible until the day it fires, and then it is the whole
    answer.

    `team_members` stays WRITTEN — see the deleter test below — so this is not
    "the table is gone". It is that a read which consults both tables cannot be
    reasoned about: it makes the answer depend on which half of the invite flow
    ran, which is the exact defect migration 195 removed.

    Matched on `FROM team_members` and `public.team_members` rather than on the
    bare name, because the word also appears in prose and in the
    'team_membership' access_kind that `services/custody/offboarding.py` emits.
    """
    src = _src(fn)
    assert "FROM team_members" not in src, f"{label} kept a legacy fallback"
    assert "FROM public.team_members" not in src, f"{label} kept a legacy fallback"


def test_project_role_asks_once_and_not_twice():
    """It used to be two round trips: `project_assignments`, then, on a miss,
    `team_members`. The second can no longer return anything the first did not,
    so it is a query issued to be told the same thing — on a path that runs up
    to once per project per bulk task write.
    """
    src = _src(task_actor.project_role)
    assert src.count("SELECT role FROM") == 1, \
        "project_role issues more than one membership read"


@pytest.mark.asyncio
async def test_project_role_binds_the_team_and_the_user_and_casts_both():
    """`project_assignments.user_id` is `character varying` and
    `team_members.user_id` is `text`.

    While one query spanned both tables asyncpg had no single type to deduce,
    and an undeduced parameter is a parse error that PgBouncer returns as an
    instant, message-less 500 — the failure mode that cost this repo the credits
    incident. Explicit `::text` casts mean the deduction never has to happen.
    """
    seen = []

    class _Pool:
        async def fetchrow(self, sql, *args):
            seen.append((" ".join(sql.split()), args))
            return {"role": "member"}

    assert await task_actor.project_role(_Pool(), "team_1", "user_1") == "member"
    sql, args = seen[0]
    assert "$1::text" in sql and "$2::text" in sql
    assert args == ("team_1", "user_1")


@pytest.mark.asyncio
async def test_a_personal_task_still_asks_nothing_at_all():
    """`team_id=None` is a personal task: no project, so no project role. The
    guard's default-allow depends on this returning None WITHOUT a query — 193
    live `todo` rows are personal, and a membership query on a NULL team would
    answer None slowly rather than quickly, or worse, match a NULL team_id row.
    """
    class _Explodes:
        async def fetchrow(self, sql, *args):
            raise AssertionError(f"queried the database for a personal task: {sql[:60]}")

    assert await task_actor.project_role(_Explodes(), None, "user_1") is None


# ── writes and deletes: still both tables ────────────────────────────────────

def test_the_project_purge_still_deletes_from_both_membership_tables():
    """The deleter is the one place the cutover must NOT simplify.

    `team_members` rows carry no foreign key to `teams` — only `task_reminders`
    declares one anywhere in this cascade — so a row left behind after its team
    is gone raises nothing and is found by nobody. It is also the specific thing
    that would make PROPOSED_080's rename un-rollback-able: roll back to a
    `team_members` that has been silently diverging from `project_assignments`
    for a business cycle and the restored table grants the wrong people access.
    """
    src = _src(project_purge.purge_project)
    assert "DELETE FROM public.project_assignments WHERE team_id=$1" in src
    assert "DELETE FROM public.team_members WHERE team_id=$1" in src


def test_both_membership_deletes_run_before_the_team_row():
    """Children before parents. The docstring on this cascade says so, and the
    order is load-bearing rather than tidy: `teams` is what every other DELETE
    here is keyed through.
    """
    src = _src(project_purge.purge_project)
    assert (src.index("DELETE FROM public.project_assignments")
            < src.index("DELETE FROM teams"))
    assert (src.index("DELETE FROM public.team_members")
            < src.index("DELETE FROM teams"))


def test_the_local_dev_seed_writes_both_membership_tables():
    """A fixture that reproduces a state which has never existed live is worse
    than one that is merely out of date.

    The seed wrote `project_assignments` only, so a local database matched
    neither the old world (both tables) nor the new one (a superset of the
    active rows). Anything still reading `team_members` — `server.py`'s
    membership predicates, at the time of writing — found nothing locally and
    everything in production.
    """
    src = (BACKEND / "scripts" / "setup_local_db.py").read_text(encoding="utf-8")
    assert "INSERT INTO project_assignments (team_id, user_id, role)" in src
    assert "INSERT INTO team_members (team_id, user_id, role, status)" in src
    assert "CREATE TABLE IF NOT EXISTS team_members" in src, \
        "the local schema must keep the table the write paths still write"


# ── schema qualification ─────────────────────────────────────────────────────

@pytest.mark.parametrize("label, fn", [
    ("task_actor.project_role", task_actor.project_role),
    ("mentions._resolve_mentions", mentions_mod._resolve_mentions),
    ("project_purge.purge_project", project_purge.purge_project),
])
def test_the_membership_tables_are_never_named_bare(label, fn):
    """`qa_cleanup_20260822.team_members` exists in this database right now.

    An unqualified name is one `search_path` away from resolving to it, and the
    statement does not fail — it returns rows, from a snapshot. Migration 142 is
    where this project met that failure and it is the reason every membership
    statement touched in this phase carries its schema.
    """
    src = _src(fn)
    for table in ("project_assignments", "team_members"):
        for keyword in ("FROM ", "INTO ", "UPDATE "):
            assert f"{keyword}{table}" not in src, \
                f"{label} names {table} without a schema after {keyword.strip()!r}"
