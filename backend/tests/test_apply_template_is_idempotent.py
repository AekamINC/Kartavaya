"""Applying a project template twice used to hand the customer two boards.

── THE DEFECT, MEASURED ────────────────────────────────────────────────────────

On `S3 Project 05`, 2026-08-29: `To Do`, `In Progress`, `In Review`, `Approval`
and `Done` each existed **TWICE, at the SAME `sort_order`** — (0,0) (1,1) (2,2)
(3,3) (4,4). The board was duplicated AND its ordering was ambiguous. The
arithmetic closes exactly across the org: 4x9 + 3x14 + 1x5 = 83 rows.

`apply_project_template` carried `ON CONFLICT DO NOTHING`, which reads as
protection against exactly this. **It could never fire.** The conflict target is
`column_id`, minted from `uuid4` on the line above — a key that is new on every
call has no conflict to do nothing about. Nothing anywhere compared the NAME.

A new customer applies a template, does not notice it land, applies it again,
and now owns a kanban board with two "In Progress" columns in an order the
database cannot decide between. That is a first-week experience, and the board
is the first screen they open.

⚠ **Columns live in `public.project_columns`.** Not `board_columns` — and both
`public.boards` and `public.board_columns` hold ZERO rows in the whole database,
so a query against those reports that there is no problem. That is how this
survived: the obvious place to look is empty.

── THE SECOND DEFECT, IN THE SAME LOOP ─────────────────────────────────────────

`field_definitions.sort_order` was the literal `0` for every field — not the
loop index, the constant. A template with four custom fields wrote four rows all
claiming position 0, so their order was whatever the planner produced. That one
was wrong from the FIRST apply, not the second, and no test had ever looked.

── WHAT THIS FILE ASSERTS, AND WHY IN THREE HALVES ─────────────────────────────

  1. BEHAVIOUR — drive the real handler TWICE against a pool that remembers what
     the first call wrote. This is the assertion that matters: §6's idempotence
     is proved by running twice, not claimed. A test that applied once could not
     have failed on the old code either.

  2. ORDERING — `sort_order` must come out unambiguous. Idempotence alone is not
     the fix: a handler that skipped duplicates but still restarted its
     numbering at 0 would leave the second defect standing.

  3. LIVE — Parse and Describe every statement against the real catalogue.
     A mock pool answers happily to an INSERT naming a column that does not
     exist, and the new duplicate-check uses `lower(btrim($2::text))`, whose
     cast is load-bearing: without it PgBouncer turns an untyped parse into an
     instant 500 that does not reproduce on a direct connection.

NOT ASSERTED, DELIBERATELY: that the 83 existing duplicate rows are repaired.
Repairing them is a DATA CHANGE to live rows and is the owner's decision
(finding 19). This stops the bleeding; it does not clean the floor. For the same
reason there is no `UNIQUE (team_id, lower(name))` migration — it would fail on
the data that is already there.
"""
import asyncio
import inspect
import json
import os

import pytest

from routers import templates


TEAM = "team_probe_0001"
ORG = "org_probe_0001"
USER = {"user_id": "user_probe_0001"}

#: Five columns, four fields, two sample tasks. The columns are the five that
#: were actually found duplicated on `S3 Project 05`, spelled the way the
#: template spells them.
CONFIG = {
    "columns": [
        {"name": "To Do", "color": "#0082c6"},
        {"name": "In Progress", "color": "#f59e0b"},
        {"name": "In Review", "color": "#8b5cf6"},
        {"name": "Approval", "color": "#ec4899"},
        {"name": "Done", "color": "#10b981", "is_done": True},
    ],
    "fields": [
        {"name": "Client", "type": "text"},
        {"name": "Budget", "type": "number"},
        {"name": "Region", "type": "select", "config": {"options": ["N", "S"]}},
        {"name": "Signed off", "type": "checkbox"},
    ],
    "sample_tasks": [
        {"title": "Kick-off call", "description": "Agree scope"},
        {"title": "Draft proposal", "description": ""},
    ],
}


def _norm(s) -> str:
    return " ".join(str(s or "").split()).casefold()


class FakePool:
    """Remembers what it was told to write, so a SECOND apply can see it.

    This is the whole point. A pool that forgets — a MagicMock, or one that
    returns `[]` to every read — makes the second apply look exactly like the
    first, and the duplicate board is invisible. The old code passes against a
    forgetful pool.
    """

    def __init__(self, cfg=CONFIG, columns=None, fields=None, tasks=None):
        self.cfg = cfg
        self.columns = list(columns or [])      # dicts: name, sort_order
        self.fields = list(fields or [])
        self.tasks = list(tasks or [])          # titles
        self.calls = []                         # (sql, args) — for the live half

    async def fetchrow(self, sql, *args):
        flat = " ".join(sql.split())
        self.calls.append((sql, args))
        if "project_templates" in flat:
            return {"config": self.cfg, "created_by": USER["user_id"]}
        if "FROM tasks WHERE team_id" in flat:
            # The duplicate check. `args[1]` is the title being offered.
            return {"exists": 1} if _norm(args[1]) in {_norm(t) for t in self.tasks} else None
        return None

    async def fetch(self, sql, *args):
        flat = " ".join(sql.split())
        self.calls.append((sql, args))
        if "FROM project_columns" in flat:
            return [dict(c) for c in self.columns]
        if "FROM field_definitions" in flat:
            return [dict(f) for f in self.fields]
        return []

    async def execute(self, sql, *args):
        flat = " ".join(sql.split())
        self.calls.append((sql, args))
        if "INSERT INTO project_columns" in flat:
            self.columns.append({"name": args[2], "sort_order": args[4]})
        elif "INSERT INTO field_definitions" in flat:
            self.fields.append({"name": args[2], "sort_order": args[5]})
        elif "INSERT INTO tasks" in flat:
            self.tasks.append(args[3])
        return "INSERT 0 1"


@pytest.fixture(autouse=True)
def _no_auth(monkeypatch):
    """The gates are proved elsewhere; this file is about what gets written.

    `test_project_templates_org_scoped.py` owns the tenancy assertions for this
    same handler — that `_org_scope` is present and that the SOURCE template is
    scoped as well as the destination project. Re-asserting them here would put
    the same rule in two places, which is the shape that let three copies of one
    drawer rule drift apart.
    """
    async def yes(*a, **k):
        return True

    monkeypatch.setattr(templates, "is_platform_staff", yes)


def apply_once(pool):
    return asyncio.run(templates.apply_project_template(
        "tmpl_probe", TEAM, pool=pool, user=USER, org_id=ORG,
    ))


# ══════════════════════════════════════════════════════════════════════════════
#  1 · Behaviour — the second apply must write nothing
# ══════════════════════════════════════════════════════════════════════════════

def test_a_second_apply_does_not_duplicate_the_board():
    """THE ASSERTION THE DEFECT REDUCES TO. Five columns, not ten."""
    pool = FakePool()
    first = apply_once(pool)
    second = apply_once(pool)

    assert first["created"]["columns"] == 5
    assert second["created"]["columns"] == 0, (
        "the second apply wrote columns again — this is the duplicated board "
        "measured on S3 Project 05, five names each present twice"
    )
    assert second["skipped"]["columns"] == 5, (
        "the handler must SAY it recognised them; a silent 0 is indistinguishable "
        "from a template that had no columns in it"
    )
    names = [_norm(c["name"]) for c in pool.columns]
    assert len(names) == len(set(names)) == 5, f"duplicate columns: {names}"


def test_a_second_apply_does_not_duplicate_fields_or_sample_tasks():
    pool = FakePool()
    apply_once(pool)
    second = apply_once(pool)

    assert second["created"]["fields"] == 0
    assert second["created"]["tasks"] == 0
    assert len(pool.fields) == 4
    assert len(pool.tasks) == 2


def test_the_counts_report_what_was_written_not_the_size_of_the_template():
    """`created` was incremented once per config item whatever the database did.

    The page turns it straight into "Applied — 5 columns created", so on the
    second apply the old code told the customer it had made five columns it had
    in fact made — which was true, and that was the bug. Now the number has to
    be the effect of THIS call.
    """
    pool = FakePool()
    apply_once(pool)
    second = apply_once(pool)
    assert second["created"] == {"columns": 0, "fields": 0, "tasks": 0}
    assert second["skipped"] == {"columns": 5, "fields": 4, "tasks": 2}


def test_a_template_that_names_the_same_column_twice_writes_it_once():
    """A single apply can duplicate a board too, and re-run protection misses it.

    Nothing validates a template's config on the way in, so two columns called
    "To Do" is a shape the product accepts. Without the in-loop bookkeeping this
    writes both, on the FIRST apply, where no amount of idempotence helps.
    """
    pool = FakePool(cfg={"columns": [
        {"name": "To Do"}, {"name": "Doing"}, {"name": "to do "},
    ]})
    res = apply_once(pool)
    assert res["created"]["columns"] == 2, [c["name"] for c in pool.columns]
    assert res["skipped"]["columns"] == 1


def test_a_column_the_customer_already_made_themselves_is_left_alone():
    """Their colour and their position are theirs. Apply must not reach in.

    This is why the fix is idempotent-by-name and NOT "refuse on a non-empty
    board": a new customer's project very often already has a column or two of
    their own, and refusing would break the legitimate case to fix the accident.
    """
    pool = FakePool(columns=[{"name": "to do ", "sort_order": 7}])
    res = apply_once(pool)
    assert res["skipped"]["columns"] == 1, (
        "'to do ' and 'To Do' are the same column to everybody except `=`; "
        "trailing space is what a paste produces"
    )
    survivor = [c for c in pool.columns if _norm(c["name"]) == "to do"]
    assert len(survivor) == 1 and survivor[0]["sort_order"] == 7, (
        "apply overwrote or re-positioned a column the customer had already made"
    )


# ══════════════════════════════════════════════════════════════════════════════
#  2 · Ordering — a kanban board's column order is not cosmetic
# ══════════════════════════════════════════════════════════════════════════════

def test_sort_order_is_unambiguous_after_two_applies():
    """The other half of the finding, and it does not follow from idempotence.

    A handler that skipped duplicates but still numbered from 0 would leave two
    columns sharing a position wherever the board had any of its own.
    """
    pool = FakePool()
    apply_once(pool)
    apply_once(pool)
    orders = [c["sort_order"] for c in pool.columns]
    assert len(orders) == len(set(orders)), f"two columns share a position: {orders}"
    assert orders == sorted(orders) == [0, 1, 2, 3, 4]


def test_new_columns_land_after_the_ones_already_on_the_board():
    """`sort_order` was the loop index — which is HOW two columns shared 0.

    On a board already using 0..4, the template restarted its own numbering at
    0 and wrote straight on top.
    """
    pool = FakePool(columns=[
        {"name": "Backlog", "sort_order": 0},
        {"name": "Shipped", "sort_order": 1},
    ])
    apply_once(pool)
    orders = sorted(c["sort_order"] for c in pool.columns)
    assert orders == [0, 1, 2, 3, 4, 5, 6], orders


def test_every_custom_field_gets_its_own_position():
    """`sort_order` was the constant 0 for all of them, from the first apply."""
    pool = FakePool()
    apply_once(pool)
    orders = [f["sort_order"] for f in pool.fields]
    assert orders == [0, 1, 2, 3], (
        f"four fields at positions {orders} — the literal 0 is back, and their "
        f"order on screen is whatever the planner returns"
    )


def test_a_board_with_a_null_sort_order_does_not_crash_the_arithmetic():
    """`project_columns.sort_order` is nullable, and `max()` over a NULL raises.

    A board carrying one is not hypothetical — every column written before
    `sort_order` existed carries NULL.
    """
    pool = FakePool(columns=[{"name": "Odd one", "sort_order": None}])
    res = apply_once(pool)
    assert res["created"]["columns"] == 5
    assert [c["sort_order"] for c in pool.columns][1:] == [0, 1, 2, 3, 4]


# ══════════════════════════════════════════════════════════════════════════════
#  3 · The dead guard is gone, and stays gone
# ══════════════════════════════════════════════════════════════════════════════

def test_no_on_conflict_guards_a_freshly_minted_primary_key():
    """`ON CONFLICT DO NOTHING` on a `uuid4` key is not protection.

    It can only ever fire on a `uuid4().hex[:10]` birthday collision, and
    silently dropping a column on one of those is worse than the 500 that now
    happens: a 500 is reported, a missing column is found weeks later by the
    person who cannot locate their work.

    Comments are stripped first — this repo has shipped a test that matched the
    explanatory comment written above its own fix.
    """
    code = "\n".join(
        line for line in inspect.getsource(templates.apply_project_template).splitlines()
        if not line.lstrip().startswith("#")
    )
    assert "ON CONFLICT" not in code.upper(), (
        "an ON CONFLICT is back in `apply`. If it guards `column_id` or "
        "`field_id` it guards a key minted from uuid4 two lines above and "
        "cannot fire; the duplicate-name check is the guard."
    )


# ══════════════════════════════════════════════════════════════════════════════
#  4 · The live half — the only thing a fake pool cannot prove
# ══════════════════════════════════════════════════════════════════════════════

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognising it BY VALUE is the only way to tell "no
#: database" from "a database": conftest uses `setdefault`.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` sets on every connection, so a statement is planned the way it
#: will actually be planned.
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. This half parses the router's SQL against the real "
    "catalogue and cannot be done offline — a fake pool answers happily to an "
    "INSERT naming a column that does not exist. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_apply_template_is_idempotent.py -q"
)


def live_dsn():
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


def _describe(calls):
    """Parse and Describe every statement. NOTHING IS EXECUTED.

    `prepare()` sends the statement to be planned and described and returns a
    handle. No `fetch`, `execute` or `fetchval` is called on that handle, so no
    row is read and none is written — which matters more here than usual,
    because these statements INSERT and this database is production's.

    `statement_cache_size=0` because the connection goes through PgBouncer in
    transaction mode, where a cached server-side statement belongs to a session
    that will not be there next time.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures, described = [], []
            for sql, args in calls:
                try:
                    stmt = await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((sql, f"{type(exc).__name__}: {exc}"))
                    continue
                described.append((sql, args, list(stmt.get_parameters())))
            return failures, described
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    # Patched by hand rather than through `_no_auth`: that fixture is
    # function-scoped and this one is not, so pytest tears the monkeypatch down
    # before this ever runs and the handler 403s on a team that does not exist.
    # Module scope is deliberate — it connects to production's database once for
    # the whole file rather than once per test.
    original = templates.is_platform_staff

    async def yes(*a, **k):
        return True

    templates.is_platform_staff = yes
    try:
        pool = FakePool()
        apply_once(pool)
    finally:
        templates.is_platform_staff = original
    try:
        return _describe(pool.calls)
    except Exception as exc:                                  # noqa: BLE001
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


def test_every_statement_apply_issues_plans_on_the_real_schema(live):
    """UndefinedColumn / UndefinedTable means the statement has never worked.

    IndeterminateDatatype means a `$n` with no cast, which PgBouncer turns into
    an instant 500 — the failure this repo has shipped six times.
    """
    failures, _ = live
    assert not failures, "\n\n".join(f"{err}\n{sql}" for sql, err in failures)


def test_the_duplicate_check_binds_the_title_as_text(live):
    """`$2` must arrive as `text`, however that comes about.

    ⚠ MEASURED, AND IT CORRECTED ME. The comment first written above this
    statement said the `::text` cast was load-bearing. It is not: removing it
    and re-planning against the live server, Postgres still infers `text`, since
    `btrim` has a single one-argument candidate and an unknown resolves to it.
    This is not the `$1::int + $2::int` shape the conventions warn about, where
    two candidates make the expression genuinely ambiguous.

    So this test asserts the type the SERVER inferred rather than the characters
    in the string — which is what makes it worth having either way. It stays
    green if somebody tidies the cast away, and goes red if the column or the
    function around `$2` ever changes into something that infers differently.
    A test matching `'::text' in sql` would have done the opposite of both.
    """
    _, described = live
    dup = [(s, a, p) for s, a, p in described if "lower(btrim(title))" in s]
    assert dup, "the duplicate-title check is gone — apply can duplicate tasks"
    for sql, _args, params in dup:
        assert params[1].name == "text", (
            f"$2 came back as {params[1].name!r}, not 'text'. The `::text` cast "
            f"has been removed and this statement is a PgBouncer 500:\n{sql}"
        )


def test_apply_reads_the_board_before_it_writes_to_it(live):
    """The read that makes idempotence possible must actually be issued.

    A refactor that kept the skip logic but computed it from the template alone
    would pass every test above — the fake pool would still remember — and be
    wrong against a board it never looked at.
    """
    _, described = live
    reads = [s for s, _, _ in described if "FROM project_columns" in s]
    assert reads, (
        "apply never SELECTs from project_columns, so it cannot know what is "
        "already on the board"
    )
