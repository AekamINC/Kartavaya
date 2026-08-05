"""Sales target attainment counted a column nothing writes, so it was always Rs 0.

Both Vikray reads and `GET /v1/dristi/sales` matched a target's salesperson
against `staging.graha_deals.owner_id`. Measured on the live database:

    649 deals · **0** with a non-null owner_id · 120 with assigned_to,
    all 120 of which match a real public.users.user_id

26 targets across 13 people, 5 live for the current period, Rs 9,00,000 to
Rs 18,00,000 each — every one rendering "Rs 0 of Rs 15,00,000" and "0 of N
deals". The join could not match for any value, in any org, ever.

The second defect in the same LATERAL was the date column. `updated_at` moves
on ANY edit, so it does not merely under-report — it teleports revenue between
quarters. Measured live on one rep whose 20 won deals span 2025-05-08 to
2026-08-07 but were all last touched on 2026-08-02:

    Q3-2026 target Rs 14,75,310 → collected all 20 deals, Rs 2,43,86,460 (1653%)
    Q2-2025 target             → collected 0, though 3 deals worth
                                 Rs 12,67,290 actually closed in that quarter

These tests pin the four rules of the attainment window. They assert against
the GENERATED SQL — a plain string with no commentary in it — and, where they
must read handler source, against source with comments and docstrings
tokenized away. This repo has shipped four checks that passed by matching their
own explanation; `test_the_comment_stripper_actually_strips` below exists to
prove that cannot happen here.
"""
import inspect
import io
import re
import textwrap
import tokenize

import pytest

import routers.vikray as vikray


# ── Reading source without reading the commentary ────────────

def _code(obj) -> str:
    """Source of `obj` with every comment and docstring removed.

    `inspect.getsource` returns the prose too, and this file's subject is a
    module whose prose says "owner_id" a dozen times while explaining why the
    query must never say it again. A substring check over raw source would
    match the explanation and report success.
    """
    src = textwrap.dedent(inspect.getsource(obj))
    toks = list(tokenize.generate_tokens(io.StringIO(src).readline))

    kept = []
    # A STRING that opens a logical line and is immediately followed by a
    # newline is a bare string statement — a docstring. Anything else is a
    # value the code actually uses, and SQL lives in those.
    at_line_start = True
    for i, tok in enumerate(toks):
        if tok.type == tokenize.COMMENT:
            continue
        if tok.type == tokenize.STRING and at_line_start:
            nxt = next(
                (t for t in toks[i + 1:] if t.type not in (tokenize.COMMENT,)),
                None,
            )
            if nxt is not None and nxt.type in (tokenize.NEWLINE, tokenize.ENDMARKER):
                continue
        if tok.type in (tokenize.NEWLINE, tokenize.NL, tokenize.INDENT, tokenize.DEDENT):
            at_line_start = True
        elif tok.type != tokenize.ENCODING:
            at_line_start = False
        kept.append(tok.string)

    return re.sub(r"\s+", " ", " ".join(kept)).strip()


def test_the_comment_stripper_actually_strips():
    """The guard on every other assertion in this file.

    If `_code` leaked comments or docstrings, every "the SQL no longer says X"
    test below would be satisfiable by a comment saying X — which is exactly
    the failure mode this repo has shipped four times.
    """
    def _sample():
        """owner_id in a docstring."""
        # owner_id in a comment
        return "assigned_to in real code"

    out = _code(_sample)
    assert "owner_id" not in out, "comments/docstrings survived the stripper"
    assert "assigned_to in real code" in out, "the stripper ate the actual code"

    # And against the real subject: the module's prose discusses owner_id at
    # length, so this proves the stripper works on the file under test and not
    # only on a toy.
    assert "owner_id" in inspect.getsource(vikray), \
        "the module no longer explains owner_id — this test's premise is stale"


# ── The four rules, read off the generated SQL ───────────────

_RULES = {
    "org scope": "d.org_id = $1::uuid",
    "not deleted": "d.is_active = TRUE",
    "won only": "d.stage = 'Won'",
    "dated by close date": "COALESCE(d.won_at, d.updated_at)",
}


@pytest.mark.parametrize("sql_name", ["_ATTAINMENT_SQL", "_UNATTRIBUTED_SQL"])
@pytest.mark.parametrize("rule", list(_RULES), ids=list(_RULES))
def test_every_attainment_rule_is_in_the_generated_sql(sql_name, rule):
    sql = getattr(vikray, sql_name)
    assert _RULES[rule] in sql, f"{sql_name} lost the '{rule}' rule"


def test_the_dead_column_is_gone_from_the_generated_sql():
    """`owner_id` is 0/649 populated on live data. It must not appear."""
    for name in ("_ATTAINMENT_SQL", "_UNATTRIBUTED_SQL"):
        assert "owner_id" not in getattr(vikray, name), \
            f"{name} is back on the column nothing writes"


def test_the_owner_join_needs_no_cast():
    """Both sides are text — `vikray_targets.salesperson_id` since migration
    092, `graha_deals.assigned_to` always. The old join needed `owner_id::text`
    precisely BECAUSE it was reaching for a uuid column, so a cast reappearing
    here is the fingerprint of the wrong column coming back."""
    sql = vikray._ATTAINMENT_SQL
    assert "d.assigned_to = t.salesperson_id" in sql
    assert "::text" not in sql, "a cast means the join found a uuid column again"


def test_the_period_window_is_not_last_touched():
    """`updated_at` alone is the 1653%-attainment bug. It may appear only
    inside the COALESCE fallback, never as the window column itself."""
    for name in ("_ATTAINMENT_SQL", "_UNATTRIBUTED_SQL"):
        sql = getattr(vikray, name)
        assert "d.updated_at >=" not in sql and "d.updated_at <" not in sql, \
            f"{name} windows on last-touched again"
        assert sql.count("COALESCE(d.won_at, d.updated_at)") == 2, \
            f"{name} must bound both ends of the period on the close date"


def test_attainment_and_the_diagnostic_differ_only_in_who_owns_the_deal():
    """The structural guarantee, and the reason `_won_in_period` is a function
    rather than two literals.

    The unattributed figure is only meaningful if it is measured over exactly
    the window attainment is measured over — otherwise "Rs 0 for you, Rs 2.5L
    unassigned" is comparing two different periods and is worse than silence.
    Two hand-maintained copies is how that stops being true, so the test is
    that the two strings are IDENTICAL apart from the owner predicate.
    """
    a = vikray._ATTAINMENT_SQL.replace("d.assigned_to = t.salesperson_id", "«OWNER»")
    u = vikray._UNATTRIBUTED_SQL.replace("d.assigned_to IS NULL", "«OWNER»")
    assert a == u, "the two aggregates have drifted apart on something other than the owner"


def test_won_in_period_is_pure():
    """No pool, no request, no clock — it is a string builder, which is why the
    rules above can be proved without a database at all."""
    sig = inspect.signature(vikray._won_in_period)
    assert list(sig.parameters) == ["owner_predicate"]
    once = vikray._won_in_period("d.assigned_to = 'x'")
    twice = vikray._won_in_period("d.assigned_to = 'x'")
    assert once == twice
    assert "d.assigned_to = 'x'" in once


# ── The handlers ask for the right thing ─────────────────────
#
# Rule of this repo, learned in routers/messaging.py: a mocked cursor resolves
# any table name handed to it, so an HTTP test proves only that the handler
# ASKED for something. The rules themselves are proved above against the pure
# string. These tests prove the handlers embed that exact string rather than a
# private copy of it, and nothing more.

class _Pool:
    def __init__(self):
        self.calls = []

    async def fetch(self, q, *a):
        self.calls.append((q, a))
        return []

    async def fetchrow(self, q, *a):
        self.calls.append((q, a))
        return None

    async def execute(self, q, *a):
        self.calls.append((q, a))
        return "UPDATE 1"


@pytest.fixture
def pool(monkeypatch):
    p = _Pool()

    async def _get_pool():
        return p

    monkeypatch.setattr(vikray, "get_pool", _get_pool)
    return p


@pytest.mark.asyncio
@pytest.mark.parametrize("handler", ["list_targets", "targets_leaderboard"])
async def test_both_reads_use_the_shared_aggregate_verbatim(pool, handler):
    await getattr(vikray, handler)(user={"user_id": "u1"}, org_id="org1")
    sql = pool.calls[0][0]
    assert vikray._ATTAINMENT_SQL in sql, f"{handler} hand-rolled its own attainment query"
    assert vikray._UNATTRIBUTED_SQL in sql, f"{handler} does not report unattributed won revenue"
    assert pool.calls[0][1][0] == "org1", f"{handler} did not scope to the caller's org"


@pytest.mark.asyncio
@pytest.mark.parametrize("handler", ["list_targets", "targets_leaderboard"])
async def test_neither_read_mentions_owner_id_anywhere(pool, handler):
    await getattr(vikray, handler)(user={"user_id": "u1"}, org_id="org1")
    assert "owner_id" not in pool.calls[0][0]
    # …and not in the handler's code either, comments discounted.
    assert "owner_id" not in _code(getattr(vikray, handler))


# ── Closing an order records WHEN the deal was won ───────────

@pytest.mark.asyncio
async def test_closing_an_order_stamps_the_deal_close_date(monkeypatch):
    """This module marks a linked deal Won when its order closes. It set the
    stage and not `won_at`, so such a deal fell back to last-touched and any
    later edit moved its revenue into a different quarter."""
    p = _Pool()

    async def _get_pool():
        return p

    async def _fetchrow(q, *a):
        p.calls.append((q, a))
        if "vikray_orders" in q and "SELECT" in q:
            return {"status": "delivered", "deal_id": "d1", "line_items": "[]"}
        return {"id": "o1", "status": "closed"}

    p.fetchrow = _fetchrow
    monkeypatch.setattr(vikray, "get_pool", _get_pool)

    await vikray.update_order_status(
        "o1", vikray.OrderStatusUpdate(status="closed"),
        user={"user_id": "u1"}, org_id="org1",
    )

    deal_writes = [q for q, _ in p.calls if "graha_deals" in q and "UPDATE" in q]
    assert deal_writes, "closing an order no longer marks the linked deal Won"
    stamp = deal_writes[0]
    assert "won_at" in stamp, "the deal is marked Won with no close date"
    assert "won_at=COALESCE(won_at, NOW())" in stamp, \
        "a re-close must not rewrite the original close date"
