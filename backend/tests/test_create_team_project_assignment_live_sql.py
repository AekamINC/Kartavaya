"""Creating a project 500'd for every customer, and left the project behind.

Found by proposal 93 Suite 03 on 2026-08-29, by pressing "Create project" on
`/projects` as an ordinary org admin of Unicode Group.

    POST /api/teams  →  500
    the browser  →  net::ERR_FAILED, and the toast "Could not create project"
    the database →  the project, its two `team_members` rows and its
                    `project_assignments` row for the creator ALL COMMITTED

`server._ensure_default_owner` binds `$2` twice in one statement — once as the
value of `project_assignments.team_id`, and once inside
`WHERE teams.team_id=$2`. Read from `pg_attribute` on 2026-08-29, never from a
migration file:

    teams.team_id                text
    team_members.team_id         text           ← the INSERT above it is safe
    project_assignments.team_id  varchar(255)   ← THIS ONE IS NOT

`project_assignments` is the ONLY relation in either product schema carrying a
`team_id` that is not `text`; seventeen tables were swept. So Postgres deduced
two different types for one parameter and refused to plan the statement:

    42P08  inconsistent types deduced for parameter $2
    DETAIL: text versus character varying

⚠ THE SHAPE THAT MADE IT INVISIBLE. asyncpg raises that at `prepare()`, which is
the LAST thing `create_team` does before `ensure_default_columns` — so the three
INSERTs before it had already committed. The customer got an error toast over a
project that existed, with no kanban columns, and creating it again made a
second one. `GET /projects/{id}/columns` lazily backfills the five defaults, so
opening the board hides the evidence.

⚠ AND WHY IT SURVIVED. `_ensure_default_owner` returns early when the creator
IS `DEFAULT_OWNER_EMAIL`, so it never fired for Aekam staff — only for a
customer creating their first project. Two live victims when this was written:
`team_921428b4cb2f` "Demo Kartavaya" (2026-08-23, still 0 columns) and
`team_c55f3960bf2f` "S3 Project 01" (2026-08-29).

`tests/test_teams.py` covers `POST /api/teams` four ways and passes on the
broken code, because `tests/conftest.py` hands it a MagicMock pool and the
`owner` lookup returns None, so `_ensure_default_owner` bails before the
statement it is testing. Nothing that mocks a pool can see a parameter-type
deduction; only the real planner can.

⚠ NOTHING IS EXECUTED. `prepare()` sends Parse and Describe and STOPS. Staging
shares its database with production, so that distinction is the whole safety
story — the statement is planned against the real catalogue and no row moves.

Run the live half with:
    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_create_team_project_assignment_live_sql.py -q
"""
import asyncio
import inspect
import os
import re

import pytest

import server

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. A parameter-type deduction is the PLANNER's opinion and "
    "cannot be checked offline — which is why the offline half below asserts "
    "the cast in the source instead."
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    return None if (not dsn or dsn == _PLACEHOLDER_DSN) else dsn


def _statements_as_shipped() -> dict[str, str]:
    """The SQL `_ensure_default_owner` actually issues, read out of the function.

    ⚠ NOT a copy of it. The first draft of this file pasted the two statements
    in as constants — and a constant is a statement that stays correct while
    the code beside it regresses, which is the whole failure this file exists
    to stop. `ast` resolves the adjacent-literal concatenation the source uses,
    so what gets planned below is what ships.
    """
    import ast

    tree = ast.parse(inspect.getsource(server._ensure_default_owner).lstrip())
    out: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            sql = node.value
            if sql.startswith("INSERT INTO team_members"):
                out["team_member"] = sql
            elif sql.startswith("INSERT INTO project_assignments"):
                out["project_assignment"] = sql
    return out


#: The statement as it shipped, kept as a literal on purpose so the live half
#: proves the check BITES rather than only that the fix parses. Postgres must
#: refuse this one for as long as the column stays `varchar(255)`.
BROKEN_PROJECT_ASSIGNMENT = (
    "INSERT INTO project_assignments (assignment_id,team_id,user_id,role,assigned_by,org_id) "
    "VALUES ($1,$2,$3,'owner',$4,(SELECT org_id FROM teams WHERE team_id=$2))"
)


def _describe(statements):
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            out = {}
            for label, sql in statements:
                try:
                    await conn.prepare(sql)
                    out[label] = None
                except Exception as exc:                      # noqa: BLE001
                    out[label] = f"{type(exc).__name__}: {exc}"
            return out
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def planned():
    if not live_dsn():
        pytest.skip(SKIP_REASON)
    shipped = _statements_as_shipped()
    assert set(shipped) == {"team_member", "project_assignment"}, (
        f"could not find both INSERTs in _ensure_default_owner: found {sorted(shipped)}"
    )
    # `team_member` is the CONTROL: identical shape, and it always worked
    # because `team_members.team_id` is `text`. A "fix" that breaks it is
    # caught here rather than in production.
    return _describe([
        ("team_member", shipped["team_member"]),
        ("project_assignment", shipped["project_assignment"]),
        ("project_assignment_before_the_fix", BROKEN_PROJECT_ASSIGNMENT),
    ])


def test_both_default_owner_writes_plan_against_the_real_catalogue(planned):
    bad = {k: v for k, v in planned.items() if k != "project_assignment_before_the_fix" and v}
    assert not bad, "\n".join(f"  {k}: {v}" for k, v in bad.items())


def test_the_uncast_form_is_still_refused_by_the_planner(planned):
    """The mutation proof, run by the test rather than claimed in a comment.

    If Postgres ever stops refusing the shipped form — because the column was
    aligned to `text` by a migration — this goes red, and the right response is
    to delete the cast and this file, not to loosen the assertion.
    """
    err = planned["project_assignment_before_the_fix"] or ""
    assert "42P08" in err or "inconsistent types" in err, (
        "the uncast statement planned cleanly. Either `project_assignments."
        "team_id` has been migrated to `text` (check pg_attribute, then remove "
        "the `::text` casts and this file), or this check no longer bites."
    )


def test_the_project_assignment_insert_casts_its_shared_parameter():
    """The offline half, so CI catches a revert without a database.

    Anchored on the sub-select rather than on the whole statement: the
    parameter is only ambiguous because it appears in BOTH a varchar column's
    VALUES slot and a `text` column's predicate, so the predicate is the unique
    place the cast has to survive.
    """
    src = inspect.getsource(server._ensure_default_owner)
    code = "\n".join(re.sub(r"#.*$", "", ln) for ln in src.splitlines())

    # The project_assignments statement only — `team_members` in the same
    # function carries the identical UNCAST sub-select and is CORRECT, so a
    # check over the whole function would pass on either one and prove nothing.
    assert "INSERT INTO project_assignments" in code, (
        "_ensure_default_owner no longer writes project_assignments. If the "
        "dual write ended, delete this file; do not leave it passing vacuously."
    )
    stmt = code[code.index("INSERT INTO project_assignments"):]

    assert "WHERE team_id=$2::text" in stmt, (
        "the `::text` cast is gone from the `SELECT org_id FROM teams` "
        "sub-select in _ensure_default_owner's project_assignments INSERT. "
        "`project_assignments.team_id` is varchar(255) and `teams.team_id` is "
        "text, so Postgres deduces two types for $2 and raises 42P08 at "
        "prepare() — AFTER the three INSERTs above have committed. Every "
        "project a customer creates then 500s and is left half-built."
    )
    assert re.search(r"VALUES \(\$1,\$2::text,", stmt), (
        "the `::text` cast is gone from the VALUES slot. Both uses of $2 must "
        "agree or the deduction is ambiguous again."
    )
