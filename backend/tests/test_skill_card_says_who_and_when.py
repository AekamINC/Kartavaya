"""A skill card says who it is for and when to run it — in the SQL, not just the table.

── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────

Migration 261 added `used_by` and `when_to_run` to `public.hub_skill_templates`
and backfilled all 78 rows. A column nobody selects is a column nobody sees, and
this product has shipped that exact shape before: migration 166 built the
`module` / `skill_type` taxonomy and the ASSIGNED endpoint — the list a customer
actually reads — did not return either, so 61 granted skills rendered as one
flat list for weeks while the data sat in the table.

Two of the four read paths are `SELECT *` and get the new columns for free. The
two that matter are the two that are not:

  · `GET /v1/hub/org/skills`            the org shelf
  · `GET /v1/hub/clients/{id}/skills`   the per-client shelf

plus the INSERT in `create_skill_template`, so a template created through the
API can declare both rather than being born blank.

NOTHING IS EXECUTED against the database. `asyncpg.Connection.prepare()` sends
Parse and Describe and stops: the server plans the statement, resolves every
relation and column, and returns the shapes. No row is read and none is written
— which matters more here than usual, because `staging` is a label on a second
front door and not a second place (CLAUDE.md).

WHY THE STATEMENTS COME FROM THE AST rather than being retyped here: a test that
carries its own copy of the SQL passes over a router that has since dropped the
column. `ast` also folds Python's implicit string concatenation into one
constant and ignores the `#` comments interleaved between the fragments, which
is what the router's SELECT lists actually look like.

Run the live half with:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_skill_card_says_who_and_when.py -q
"""
import ast
import asyncio
import inspect
import os
import pathlib

import pytest

import routers.hub as hub


NEW_COLUMNS = ("used_by", "when_to_run")

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO public"

SKIP_REASON = (
    "no live database. This half plans the router's SQL against the real "
    "catalogue and cannot be done offline — conftest hands every module a "
    "MagicMock, and a MagicMock answers happily to a statement naming a column "
    "that does not exist. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_skill_card_says_who_and_when.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


@pytest.fixture
def live():
    dsn = live_dsn()
    if not dsn:
        pytest.skip(SKIP_REASON)
    return dsn


# ══════════════════════════════════════════════════════════════════════════════
#  Collecting the statements
# ══════════════════════════════════════════════════════════════════════════════

def _statements() -> list[str]:
    """Every plain SQL literal in `routers/hub.py` that names the template table.

    Read from the source file rather than from `hub.__doc__` or a captured call:
    the point is what the module WILL send, including paths this test does not
    know how to drive.
    """
    src = pathlib.Path(inspect.getfile(hub)).read_text(encoding="utf-8")
    tree = ast.parse(src)
    out: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
            continue
        sql = node.value
        if "hub_skill_templates" not in sql:
            continue
        head = sql.lstrip().upper()
        if not head.startswith(("SELECT", "INSERT", "UPDATE", "DELETE")):
            continue
        # An f-string or `.format` fragment is not a statement a server can
        # plan; those are built elsewhere and belong to whatever test owns them.
        if "{" in sql:
            continue
        out.append(sql)
    return out


def _card_selects(stmts: list[str]) -> list[str]:
    """The SELECTs that render a skill CARD, named by columns one at a time.

    Five statements join a grant onto the template table and only two of them
    draw anything a person reads:

      1. the client shelf          card   ← must carry the new columns
      2. a client skill's steps    run    — steps + brand_instructions
      3. the org shelf             card   ← must carry the new columns
      4. an org skill's steps      run    — steps + brand_instructions
      5. the skill-requests list   admin  — who asked for what

    `t.icon` is the discriminator, and it is a fact about the query rather than
    a name this test made up: the glyph is fetched only when something is going
    to draw a card with it. The run paths and the requests list have no icon
    because they render no card, and adding these two columns to them would be
    fetching text that nothing displays.
    """
    return [
        s for s in stmts
        if s.lstrip().upper().startswith("SELECT")
        and "JOIN public.hub_skill_templates" in s
        and "t.icon" in s
    ]


# ══════════════════════════════════════════════════════════════════════════════
#  1 · Offline — the router asks for the columns at all
# ══════════════════════════════════════════════════════════════════════════════

def test_there_are_statements_to_check():
    """Anti-vacuity floor.

    Every assertion below is a loop over `_statements()`. If the collector
    silently stops matching — the table is renamed, the SQL moves to an
    f-string, `ast` stops folding concatenation — each of those loops runs zero
    times and reports success about nothing. Five statements name the table
    today: two `SELECT *`, the two joined selects, and the INSERT.
    """
    stmts = _statements()
    assert len(stmts) >= 5, (
        f"only {len(stmts)} statements naming hub_skill_templates were found in "
        "routers/hub.py; the collector has stopped seeing them and every other "
        "test in this file is now vacuous"
    )
    assert len(_card_selects(stmts)) == 2, (
        "expected exactly two card-rendering SELECTs (the org shelf and the "
        "client shelf). A third has appeared, or one has gone — either way it "
        "needs deciding about, because a query that fetches t.icon is a query "
        "that draws a card, and a card has to say who the skill is for."
    )


@pytest.mark.parametrize("column", NEW_COLUMNS)
def test_every_assigned_shelf_select_names_the_column(column):
    """The failure 166 shipped: the data is there and the shelf never asks.

    `SELECT *` paths are deliberately not asserted on — they cannot regress this
    way, and pinning them would fail the day somebody narrows one for good
    reason.
    """
    for sql in _card_selects(_statements()):
        assert f"t.{column}" in sql, (
            f"a card-rendering SELECT does not ask for t.{column}, "
            "so the shelf renders without it while the column sits filled in "
            f"the table:\n\n{sql}"
        )


@pytest.mark.parametrize("column", NEW_COLUMNS)
def test_a_template_can_be_created_with_the_column(column):
    """Otherwise every template made through the API is born blank."""
    inserts = [s for s in _statements() if s.lstrip().upper().startswith("INSERT")]
    assert inserts, "no INSERT into hub_skill_templates found"
    assert any(column in s for s in inserts), (
        f"create_skill_template does not write {column}, so a template created "
        "through the API can never say who it is for"
    )


def test_the_create_model_accepts_both():
    """The SQL can write a column the request body has no way to carry."""
    fields = hub.SkillTemplateCreate.model_fields
    for column in NEW_COLUMNS:
        assert column in fields, (
            f"SkillTemplateCreate has no `{column}` field, so the INSERT binds "
            "a value nothing can supply"
        )


def test_blank_is_stored_as_absent_not_as_empty():
    """An empty box is "nobody has said", which is NULL — not a confident "".

    `Findings.jsx` and the catalogue card both treat NULL as unknown and render
    nothing; an empty string is a value, and it would draw a label with nothing
    after it. 261's verify query counts the two separately for this reason, and
    the source is the only place the distinction is visible — the pool in this
    suite is a mock that would accept either.
    """
    src = inspect.getsource(hub.create_skill_template)
    for column in NEW_COLUMNS:
        assert f"body.{column} or" in src and ".strip() or None" in src, (
            f"{column} is not normalised to NULL when blank; an empty string "
            "will be stored and rendered as an answer"
        )


# ══════════════════════════════════════════════════════════════════════════════
#  2 · Live — the columns exist and every statement plans
# ══════════════════════════════════════════════════════════════════════════════

def test_every_statement_plans_on_the_real_schema(live):
    """Parse + Describe only. A MagicMock cannot do this; the server can."""
    import asyncpg

    stmts = _statements()
    assert len(stmts) >= 5, "nothing to plan — see test_there_are_statements_to_check"

    async def run():
        conn = await asyncpg.connect(live, statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures = []
            for sql in stmts:
                try:
                    await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((sql, f"{type(exc).__name__}: {exc}"))
            return failures
        finally:
            await conn.close()

    failures = asyncio.run(run())
    assert not failures, "\n\n".join(
        f"{why}\n{sql}" for sql, why in failures
    )


def test_the_columns_are_on_the_table(live):
    """261 applied, and applied as text.

    Read from `information_schema`, never from the migration file: an inline
    CHECK on `ADD COLUMN IF NOT EXISTS` is skipped entirely when the column
    already exists, and 059 is the scar — the file said one thing and the
    catalogue another for months.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live, statement_cache_size=0)
        try:
            return await conn.fetch(
                "SELECT column_name, data_type, is_nullable "
                "FROM information_schema.columns "
                "WHERE table_schema='public' AND table_name='hub_skill_templates' "
                "AND column_name = ANY($1::text[])",
                list(NEW_COLUMNS),
            )
        finally:
            await conn.close()

    rows = {r["column_name"]: r for r in asyncio.run(run())}
    for column in NEW_COLUMNS:
        assert column in rows, f"{column} is not on public.hub_skill_templates"
        assert rows[column]["data_type"] == "text"
        # Nullable on purpose: a template nobody has placed yet is a real
        # state, and NOT NULL would force an empty string to stand in for it.
        assert rows[column]["is_nullable"] == "YES"


def test_the_backfill_left_nothing_blank(live):
    """A blank is not a NULL, and 261 must not have created either.

    This is the check the migration's own guard cannot make after the fact: the
    guard counted NOT NULL, and an empty string satisfies that while rendering
    as a label with nothing after it.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live, statement_cache_size=0)
        try:
            return await conn.fetchrow(
                "SELECT count(*) AS total, "
                "       count(used_by) AS with_seat, "
                "       count(when_to_run) AS with_cadence, "
                "       count(*) FILTER (WHERE btrim(used_by) = '' "
                "                           OR btrim(when_to_run) = '') AS blank "
                "FROM public.hub_skill_templates WHERE is_active = TRUE"
            )
        finally:
            await conn.close()

    row = asyncio.run(run())
    assert row["total"] > 0, "no active templates — this assertion would be vacuous"
    assert row["blank"] == 0, f"{row['blank']} template(s) carry an empty string"
    assert row["with_seat"] == row["total"], (
        f"{row['total'] - row['with_seat']} active template(s) have no used_by. "
        "A template added after 261 needs both columns filled in the same "
        "commit that adds it."
    )
    assert row["with_cadence"] == row["total"], (
        f"{row['total'] - row['with_cadence']} active template(s) have no "
        "when_to_run — and when_to_run is what tells somebody what schedule to "
        "arm, so a blank one stays unscheduled by default."
    )
