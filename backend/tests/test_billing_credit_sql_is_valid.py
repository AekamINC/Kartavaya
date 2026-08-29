"""The credit line's SQL, parsed against the real catalogue.

── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────

Phase 3.2 gave `staging.org_billing_lines` a sixth kind, `credit` (migration
222), and with it a sign: the column still stores a magnitude — `amount >= 0`
is unchanged and load-bearing — while `kind` says which way the figure points.
Three statements in `services/billing_lines.py` changed to say so:

  · `list_lines`' two totals, which now SUM a signed CASE
  · `lines_due_in_period`'s ORDER BY, which names 'credit' last
  · `record_billed`'s INSERT, whose fallback is the signed amount, plus the
    kind lookup that refuses a sign contradicting the line

`tests/test_billing_lines.py` covers all three offline, with 84 tests and a
recording pool. It cannot cover the one thing that matters here: `conftest.py`
hands every module a MagicMock, and a MagicMock answers happily to a statement
naming a column that is not there. That is precisely how `gst_rate` survived in
`routers/client_billing.py` until it had never once succeeded — written up in
`tests/test_client_billing_invoices.py`, whose live half this file copies.

NOTHING IS EXECUTED. `asyncpg.Connection.prepare()` sends Parse and Describe
and stops: the server plans the statement, resolves every relation, column and
parameter type, and returns the shapes. No row is read, none is written, and
staging shares its database with production (CLAUDE.md), so that distinction is
the whole safety story.

Run the live half with:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_billing_credit_sql_is_valid.py -q
"""
import asyncio
import os
from datetime import date
from decimal import Decimal

import pytest

import services.billing_lines as bl


ORG = "11111111-1111-1111-1111-111111111111"
LINE = "55555555-5555-5555-5555-555555555555"
INVOICE = "77777777-7777-7777-7777-777777777777"
PERIOD = date(2026, 8, 1)


# ══════════════════════════════════════════════════════════════════════════════
#  1 · The sign rule, offline — one rule, two languages
# ══════════════════════════════════════════════════════════════════════════════

def test_only_a_credit_is_negative():
    assert bl._signed_amount("credit", Decimal("4000.00")) == Decimal("-4000.00")
    for kind in ("platform", "support", "setup", "ongoing", "topup"):
        assert bl._signed_amount(kind, Decimal("4000.00")) == Decimal("4000.00")


def test_the_python_and_the_sql_name_the_same_kind():
    """`_SIGNED_AMOUNT_SQL` is built from `CREDIT_KIND`, so it cannot drift from
    `_signed_amount` — asserted rather than assumed, because a literal 'credit'
    typed into the SQL by hand is exactly the copy that would."""
    assert bl.CREDIT_KIND in bl.KINDS
    assert f"l.kind = '{bl.CREDIT_KIND}'" in bl._SIGNED_AMOUNT_SQL
    assert "-l.amount" in bl._SIGNED_AMOUNT_SQL


def test_a_credit_is_not_an_operator_kind():
    """The billing block must not offer a box that forgives money. See
    `OPERATOR_KINDS` — the proration path writes credits, nobody types one."""
    assert bl.CREDIT_KIND not in bl.OPERATOR_KINDS


def test_the_magnitude_column_still_refuses_a_negative():
    """`amount >= 0` on `org_billing_lines` is unchanged, and `_money` still
    says so. Only `record_billed` passes `signed=True`, and only because
    `invoice_billing_lines.amount` carries no such CHECK."""
    with pytest.raises(bl.InvalidLine):
        bl._money(Decimal("-1.00"))
    assert bl._money(Decimal("-1.00"), signed=True) == Decimal("-1.00")


# ══════════════════════════════════════════════════════════════════════════════
#  2 · The live half
# ══════════════════════════════════════════════════════════════════════════════

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO public"

SKIP_REASON = (
    "no live database. This half parses the module's SQL against the real "
    "catalogue and cannot be done offline — a MagicMock pool answers happily "
    "to a statement naming a column that does not exist. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_billing_credit_sql_is_valid.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


class CaptureConn:
    """Records every statement and its arguments; answers empty.

    Holds no connection, so nothing reached through it can touch the shared
    database. The three functions under test are driven with it purely to
    collect the SQL they build — `record_billed` raises `UnknownLine` at the end
    because no row comes back, which is caught at the call site: the statements
    are captured before the raise, and they are the whole point.
    """

    def __init__(self):
        self.calls: list[tuple[str, tuple]] = []

    async def fetch(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return []

    async def fetchrow(self, sql, *args, **kw):
        self.calls.append((sql, args))
        # `list_lines` subscripts its totals row, so that one statement gets a
        # shape rather than a None. Zeros: this half is about whether the SQL
        # parses, and `tests/test_billing_lines.py` owns the arithmetic.
        if "monthly_total" in sql:
            return {"monthly_total": 0, "one_off_total": 0}
        return None

    async def fetchval(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return None

    async def execute(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return "INSERT 0 1"


def _captured() -> list[tuple[str, tuple]]:
    """Every statement the three changed readers and the writer issue."""
    async def run():
        conn = CaptureConn()
        await bl.list_lines(conn, ORG, period=PERIOD)
        await bl.lines_due_in_period(conn, ORG, PERIOD)
        try:
            await bl.record_billed(
                conn, invoice_id=INVOICE, org_id=ORG, line_ids=[LINE],
                period=PERIOD, amounts={LINE: Decimal("-4000.00")},
            )
        except bl.BillingLineError:
            pass                      # no rows came back from a pool with none
        return conn.calls

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    dsn = live_dsn()
    if not dsn:
        pytest.skip(SKIP_REASON)
    return dsn


def test_every_statement_plans_on_the_real_schema(live):
    import asyncpg

    # CAPTURED FIRST, on its own loop. `_captured` runs the module under test
    # through `asyncio.run`, and calling that from inside the loop below is a
    # RuntimeError, not a nesting that merely works slowly.
    calls = _captured()

    async def run():
        conn = await asyncpg.connect(live, statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures, params = [], []
            for sql, args in calls:
                try:
                    stmt = await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((sql, f"{type(exc).__name__}: {exc}"))
                    continue
                params.append((sql, len(stmt.get_parameters()), len(args)))
            return failures, params
        finally:
            await conn.close()

    failures, params = asyncio.run(run())
    # `assert not failures` is green against an EMPTY capture: if `_captured`
    # stops driving the module, nothing is described, nothing can fail, and
    # this test reports success about zero statements. Nine today.
    assert len(calls) >= 9, \
        f"only {len(calls)} statements were captured, not 9 — the capture rotted"
    assert not failures, "\n\n".join(
        f"{err}\n    {sql}" for sql, err in failures
    )
    # An off-by-one from a hand-renumbered placeholder is the other half of what
    # a parse can prove, and Postgres is the only honest witness to it.
    wrong = [(sql, declared, bound) for sql, declared, bound in params
             if declared != bound]
    assert not wrong, "\n\n".join(
        f"declares ${d} but binds {b} argument(s)\n    {sql}"
        for sql, d, b in wrong
    )


def test_the_credit_kind_is_in_the_live_check_constraint(live):
    """Migration 222, read from `pg_constraint` rather than from the file.

    An inline CHECK on `ADD COLUMN IF NOT EXISTS` is skipped whole when the
    column already exists, so a migration file is never evidence a constraint
    is there. This is the same rule applied to a DROP/re-ADD.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live, statement_cache_size=0)
        try:
            return await conn.fetch(
                "SELECT conname, pg_get_constraintdef(oid) AS def "
                "FROM pg_constraint "
                "WHERE conrelid = 'public.org_billing_lines'::regclass "
                "  AND conname IN ('org_billing_lines_kind_check', "
                "                  'org_billing_lines_credit_ck')",
            )
        finally:
            await conn.close()

    rows = {r["conname"]: r["def"] for r in asyncio.run(run())}
    assert "credit" in rows.get("org_billing_lines_kind_check", ""), \
        "migration 222 has not been applied — the backend would 500 on a plan change"
    assert "org_billing_lines_credit_ck" in rows, \
        "a credit could be written as a monthly line, i.e. a discount for ever"


def test_the_amount_column_is_still_non_negative(live):
    """The fix must not have loosened the column. A signed `org_billing_lines`
    would make every SUM in the product ambiguous; the sign lives in `kind`."""
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live, statement_cache_size=0)
        try:
            return await conn.fetchval(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conrelid = 'public.org_billing_lines'::regclass "
                "  AND conname = 'org_billing_lines_amount_check'",
            )
        finally:
            await conn.close()

    assert "amount >= (0)::numeric" in (asyncio.run(run()) or "")
