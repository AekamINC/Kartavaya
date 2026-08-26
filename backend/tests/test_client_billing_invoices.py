"""The two billing INSERTs, and the tenant boundary the newest router skipped.

── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────

`routers/client_billing.py` shipped with zero tests. Both of its
`INSERT INTO staging.ganit_invoices` statements named a column, `gst_rate`,
that has never existed on that table, and both omitted `invoice_number`, which
is NOT NULL with no default and no trigger. So the auto-invoice sweep and the
metered-usage invoice raised on the first statement of every call they have
ever received — measured on the live database on 2026-08-25, SELECT-only:

    client_invoice_lines                                  0 rows
    ganit_invoices WHERE billing_profile_id IS NOT NULL   0 rows

against 4 billing profiles, 4 service lines (2 with `auto_invoice`) and 5
metered-usage entries. Not "rarely used" — never once succeeded.

Nothing in the suite could have caught it, and the reason is written up in
`tests/test_skill_sql_is_valid.py`: `conftest.py` hands every module a
MagicMock pool, and a MagicMock answers happily to a statement naming a column
that is not there. A test that calls the sweep with that pool and gets
`{"created": 1}` back has proved that the mock returned what the test told it
to return.

── HOW, EXACTLY ─────────────────────────────────────────────────────────────

Two halves, and the separation is the safety story. Staging and production
share one Supabase database (CLAUDE.md), so NOTHING here writes a row.

  1. CAPTURE, offline. Both functions are driven with a pool that records every
     statement and its bound arguments and answers from a small script. The
     handler's own Python — the anchor math, the GST split, the serial
     allocation through `utils.next_doc_number` — builds the SQL exactly as it
     would at run time. This half runs everywhere, including with no database.

  2. CHECK, live. Two things the offline half cannot know:

       · `asyncpg.Connection.prepare()` sends Parse and Describe and STOPS. The
         server plans the statement, resolves every relation, column and
         parameter type, and returns the shapes — it does not execute, does not
         read a row and does not write one. This is what fails on `gst_rate`,
         with `UndefinedColumnError`. It also yields the parameter count, which
         is asserted against the number of arguments actually bound: an INSERT
         whose placeholders were renumbered by hand is exactly where an
         off-by-one lands, and Postgres is the only honest witness to it.

       · THE CATALOGUE, read directly. `prepare()` plans a statement that omits
         a NOT NULL column perfectly happily — the violation is a runtime
         constraint, not a parse error — so it would NOT have caught the
         missing `invoice_number`. So every column of `staging.ganit_invoices`
         that is NOT NULL with no default is required to appear in each
         INSERT's column list, and every column named in the list is required
         to exist. Between them those two rules catch both halves of the
         original defect and any future one of either shape.

When there is no database this half skips, loudly, with the command in the
message:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_client_billing_invoices.py -q
"""
import ast
import asyncio
import inspect
import os
import pathlib
import re
from datetime import date

import pytest
from fastapi import HTTPException

import routers.client_billing as client_billing


# ── identities ───────────────────────────────────────────────
# Values, never sources. No statement built with them is ever executed.

ORG = "11111111-1111-1111-1111-111111111111"
OTHER_ORG = "22222222-2222-2222-2222-222222222222"
CLIENT = "33333333-3333-3333-3333-333333333333"
PROFILE = "44444444-4444-4444-4444-444444444444"
LINE = "55555555-5555-5555-5555-555555555555"
USAGE = "66666666-6666-6666-6666-666666666666"

TODAY = date(2026, 8, 25)

SERVICE_LINE = {
    "id": LINE,
    "org_id": ORG,
    "profile_id": PROFILE,
    "client_id": CLIENT,
    "kind": "retainer",
    "description": "Monthly retainer",
    "amount": 25000,
    "cadence": "monthly",
    "period_start": date(2026, 8, 1),
    "period_end": None,
    "billing_direction": "advance",
    "auto_invoice": True,
    "billing_cycle": "monthly",
    "anchor_day": 1,
    "payment_terms_days": 30,
    "currency": "INR",
    "gst_treatment": "registered",
    "client_name": "A Client Pvt Ltd",
    # The customer's registration and address: `place_of_supply` is
    # derived from them, and a tax invoice carrying none cannot be
    # classified as inter- or intra-state on the GST return.
    "client_gstin": "27AABCU9603R1ZM",
    "client_address": {"state": "Maharashtra"},
}

BILLING_PROFILE = {
    "id": PROFILE,
    "org_id": ORG,
    "client_id": CLIENT,
    "billing_cycle": "monthly",
    "anchor_day": 1,
    "payment_terms_days": 30,
    "currency": "INR",
    "gst_treatment": "registered",
    "client_name": "A Client Pvt Ltd",
    # The customer's registration and address: `place_of_supply` is
    # derived from them, and a tax invoice carrying none cannot be
    # classified as inter- or intra-state on the GST return.
    "client_gstin": "27AABCU9603R1ZM",
    "client_address": {"state": "Maharashtra"},
}

USAGE_ROW = {
    "id": USAGE,
    "org_id": ORG,
    "profile_id": PROFILE,
    "metric": "storage",
    "quantity": 120,
    "unit": "GB",
    "rate": 12,
    "recorded_date": date(2026, 8, 12),
    "invoiced": False,
}


# ── the capture pool ─────────────────────────────────────────

class CapturePool:
    """Records every statement and its arguments; answers from a script.

    THE ONLY THING IT IS ALLOWED TO DO. It holds no connection, so nothing
    reached through it can touch the shared database. `acquire()` and
    `transaction()` exist because both write paths run inside an explicit
    transaction and because `utils.next_doc_number` takes a connection of its
    own to hold its advisory lock.
    """

    def __init__(self, script: list[tuple[str, object]] | None = None):
        #: (needle, answer) — first needle found in the statement wins.
        self.script = script or []
        #: (sql, args) in the order they were issued.
        self.calls: list[tuple[str, tuple]] = []

    # -- ledger -------------------------------------------------
    def _answer(self, sql: str, default):
        for needle, value in self.script:
            if needle in sql:
                return value
        return default

    def _record(self, sql, args):
        self.calls.append((sql, args))

    def statements(self) -> list[str]:
        return [sql for sql, _ in self.calls]

    def one(self, needle: str) -> tuple[str, tuple]:
        """The single statement containing `needle`. Fails loudly on 0 or 2."""
        hits = [c for c in self.calls if needle in c[0]]
        assert len(hits) == 1, (
            f"expected exactly one statement containing {needle!r}, "
            f"found {len(hits)}"
        )
        return hits[0]

    def any(self, needle: str) -> bool:
        return any(needle in sql for sql in self.statements())

    # -- asyncpg surface ---------------------------------------
    async def fetch(self, sql, *args, **kw):
        self._record(sql, args)
        return self._answer(sql, [])

    async def fetchrow(self, sql, *args, **kw):
        self._record(sql, args)
        return self._answer(sql, None)

    async def fetchval(self, sql, *args, **kw):
        self._record(sql, args)
        return self._answer(sql, None)

    async def execute(self, sql, *args, **kw):
        self._record(sql, args)
        return "INSERT 0 1"

    def acquire(self):
        pool = self

        class _Acquired:
            async def __aenter__(self):
                return pool

            async def __aexit__(self, *exc):
                return False

        return _Acquired()

    def transaction(self, **kw):
        return self.acquire()


@pytest.fixture
def pooled(monkeypatch):
    """Install a CapturePool as `db._pool`.

    `get_pool()` short-circuits on `if _pool is not None`, so every
    `await get_pool()` in the module under test gets this and nothing else.
    """
    import db

    def _install(script=None):
        pool = CapturePool(script)
        monkeypatch.setattr(db, "_pool", pool)
        return pool

    return _install


# ── driving the two write paths ──────────────────────────────

#: The supplier's own state. Without it `_tax_split` REFUSES to guess the
#: tax heads rather than defaulting to intra-state, so every happy-path run
#: has to supply it — which is the point: the refusal is not an edge case
#: bolted on, it is the default answer when either end of the supply is
#: unknown. '24' (Gujarat) against a Maharashtra customer makes the fixture
#: an INTER-state supply, so the happy path exercises the IGST branch.
SUPPLIER_STATE = ("SELECT state_code FROM staging.organisations", {"state_code": "24"})

SWEEP_SCRIPT = [
    SUPPLIER_STATE,
    ("FROM staging.client_service_lines sl", [SERVICE_LINE]),
    # Not billed for this period yet — the sweep proceeds.
    ("FROM staging.client_invoice_lines", None),
    # `next_doc_number` reads the newest serial; none yet, so it mints 0001.
    ("SELECT invoice_number FROM staging.ganit_invoices", None),
]

USAGE_SCRIPT = [
    SUPPLIER_STATE,
    ("FROM staging.client_billing_profiles p", BILLING_PROFILE),
    ("FROM staging.client_metered_usage ", [USAGE_ROW]),
    ("SELECT invoice_number FROM staging.ganit_invoices", None),
]


async def _run_sweep(pooled) -> CapturePool:
    pool = pooled(SWEEP_SCRIPT)
    out = await client_billing.sweep_client_auto_invoices(today=TODAY)
    assert out["created"] == 1, f"the sweep did not create an invoice: {out}"
    return pool


async def _run_usage_invoice(pooled) -> CapturePool:
    pool = pooled(USAGE_SCRIPT)
    out = await client_billing.generate_usage_invoice(
        body=client_billing.GenerateUsageInvoice(profile_id=PROFILE),
        user={"user_id": "user_admin001"},
        org_id=ORG,
    )
    assert out["entries"] == 1, f"no usage rolled into the invoice: {out}"
    return pool


INVOICE_INSERT = "INSERT INTO staging.ganit_invoices"


def _column_list(sql: str) -> list[str]:
    """The column names an INSERT names, in order."""
    m = re.search(
        r"INSERT INTO staging\.ganit_invoices\s*\((.*?)\)\s*VALUES", sql, re.S)
    assert m, f"could not read the column list out of:\n{sql}"
    return [c.strip() for c in m.group(1).split(",")]


def _value_list(sql: str) -> list[str]:
    m = re.search(r"\)\s*VALUES\s*\((.*)\)\s*$", sql.strip(), re.S)
    assert m, f"could not read the VALUES list out of:\n{sql}"
    return [v.strip() for v in m.group(1).split(",")]


# ══════════════════════════════════════════════════════════════════════════════
#  1 · The capture half — runs everywhere, including with no database
# ══════════════════════════════════════════════════════════════════════════════

async def test_both_invoice_inserts_are_reached(pooled):
    """Guard on the harness itself.

    If capture silently stopped working, every check below would pass by
    checking nothing — the exact failure this file exists to end, reproduced
    inside the file that ends it.
    """
    sweep = await _run_sweep(pooled)
    sweep.one(INVOICE_INSERT)
    sweep.one("INSERT INTO staging.client_invoice_lines")

    usage = await _run_usage_invoice(pooled)
    usage.one(INVOICE_INSERT)
    usage.one("UPDATE staging.client_metered_usage")


@pytest.mark.parametrize("path", ["sweep", "usage"])
async def test_neither_insert_names_gst_rate(pooled, path):
    """`staging.ganit_invoices` has no `gst_rate` column and never has.

    The rate is a per-LINE fact in this schema — `line_items[].gst_rate`, which
    is where `routers/ganit.py` writes it and `routers/pay.py` reads it. Naming
    it as an invoice column is what raised UndefinedColumnError on every call.
    """
    pool = await (_run_sweep(pooled) if path == "sweep"
                  else _run_usage_invoice(pooled))
    sql, _ = pool.one(INVOICE_INSERT)
    assert "gst_rate" not in _column_list(sql), (
        "gst_rate is not a column of staging.ganit_invoices — this INSERT "
        "cannot ever have succeeded"
    )


@pytest.mark.parametrize("path", ["sweep", "usage"])
async def test_every_invoice_is_born_with_a_serial(pooled, path):
    """`invoice_number` is NOT NULL with no default and no trigger.

    And the value is drawn from `utils.next_doc_number`, the ONE allocator —
    not a scheme invented here. Its product is `PREFIX-YYYY-NNNN`.
    """
    pool = await (_run_sweep(pooled) if path == "sweep"
                  else _run_usage_invoice(pooled))
    sql, args = pool.one(INVOICE_INSERT)
    cols = _column_list(sql)
    assert "invoice_number" in cols, (
        "invoice_number is NOT NULL with no default — an INSERT that omits it "
        "raises NotNullViolationError on every call"
    )

    # It came through the shared allocator, which is the statement the pool saw.
    assert pool.any("SELECT invoice_number FROM staging.ganit_invoices"), \
        "the serial was not drawn through utils.next_doc_number"

    placeholder = _value_list(sql)[cols.index("invoice_number")]
    bound = args[int(placeholder.lstrip("$").split("::")[0]) - 1]
    assert re.fullmatch(r"INV-\d{4}-\d{4}", bound), \
        f"invoice_number is not a next_doc_number serial: {bound!r}"


@pytest.mark.parametrize("path", ["sweep", "usage"])
async def test_the_invoice_records_what_is_still_owed(pooled, path):
    """`balance_due` DEFAULTS to 0 — an omitted column makes the invoice read
    as FULLY PAID against a non-zero total.

    The same defect `vikray.generate_invoice_from_order` carried and paid for:
    invisible in receivables and ageing, ₹0 on the customer's payment link
    (`pay.py` serves `balance_due` as `amount_due`), nothing for a payment to
    reduce, and un-editable because editing is bounded by payment. Both columns
    are bound from the SAME placeholder, so the whole amount is outstanding
    until a payment is recorded against it.
    """
    pool = await (_run_sweep(pooled) if path == "sweep"
                  else _run_usage_invoice(pooled))
    sql, _ = pool.one(INVOICE_INSERT)
    cols, vals = _column_list(sql), _value_list(sql)
    assert "balance_due" in cols, \
        "balance_due DEFAULTs to 0 — an omitted column makes the invoice read as paid"
    assert vals[cols.index("balance_due")] == vals[cols.index("total")], \
        "balance_due must be bound from the same placeholder as total"


@pytest.mark.parametrize("path", ["sweep", "usage"])
async def test_the_invoice_is_filed_under_a_company_and_a_profile(pooled, path):
    """A CRM client is the COMPANY, and it is what files money owed under the
    party that owes it. `billing_profile_id` is the only link back from the
    invoice to the arrangement that generated it."""
    pool = await (_run_sweep(pooled) if path == "sweep"
                  else _run_usage_invoice(pooled))
    sql, _ = pool.one(INVOICE_INSERT)
    cols = _column_list(sql)
    assert "client_id" in cols
    assert "billing_profile_id" in cols
    assert "org_id" in cols


async def test_a_line_already_billed_spends_no_serial(pooled):
    """A refusal AFTER `next_doc_number` leaves a permanent gap in the invoice
    sequence, which is the thing a tax auditor asks about. Every skip in the
    sweep therefore happens before the allocator is called."""
    pool = pooled([
        ("FROM staging.client_service_lines sl", [SERVICE_LINE]),
        # This period is already on an invoice.
        ("FROM staging.client_invoice_lines", 1),
    ])
    out = await client_billing.sweep_client_auto_invoices(today=TODAY)
    assert out == {"date": str(TODAY), "created": 0, "skipped": 1}
    assert not pool.any("SELECT invoice_number FROM staging.ganit_invoices"), \
        "a serial was drawn for a line the sweep then skipped — permanent gap"
    assert not pool.any(INVOICE_INSERT)


async def test_the_usage_invoice_returns_the_serial(pooled):
    """The number is the only handle a firm can quote to its customer."""
    pool = pooled(USAGE_SCRIPT)
    out = await client_billing.generate_usage_invoice(
        body=client_billing.GenerateUsageInvoice(profile_id=PROFILE),
        user={"user_id": "user_admin001"},
        org_id=ORG,
    )
    assert re.fullmatch(r"INV-\d{4}-\d{4}", out["invoice_number"])
    assert out["total"] == 1699.2      # 120 × 12 = 1440, +18% GST
    assert out["subtotal"] == 1440.0


# ══════════════════════════════════════════════════════════════════════════════
#  2 · The tenant boundary
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_profile_for_another_orgs_client_is_404(pooled):
    """`create_profile` took `client_id` from the request body and stored it
    without ever asking whose company it was.

    The duplicate check below it cannot stand in for the ownership check: it is
    scoped `WHERE org_id = $1`, so a foreign `client_id` matches nothing there
    and falls straight through to the INSERT. `list_profiles` then joined
    `graha_clients` on the id ALONE and rendered the other org's company name.
    """
    pool = pooled([
        # Scoped to THIS org, the client is not found — it is another org's.
        ("FROM staging.graha_clients", None),
    ])
    with pytest.raises(HTTPException) as exc:
        await client_billing.create_profile(
            body=client_billing.ProfileCreate(client_id=CLIENT),
            user={"user_id": "user_admin001"},
            org_id=ORG,
        )
    assert exc.value.status_code == 404
    assert not pool.any("INSERT INTO staging.client_billing_profiles"), \
        "the profile was written anyway"


async def test_the_ownership_check_runs_before_the_duplicate_check(pooled):
    """A client this org cannot see is NOT FOUND, whatever else is true of it.
    Answering 409 first would confirm the existence of another org's row."""
    pool = pooled([("FROM staging.graha_clients", None)])
    with pytest.raises(HTTPException):
        await client_billing.create_profile(
            body=client_billing.ProfileCreate(client_id=CLIENT),
            user={"user_id": "user_admin001"},
            org_id=ORG,
        )
    assert not pool.any("SELECT id FROM staging.client_billing_profiles"), \
        "the duplicate lookup ran for a client that is not this org's"


async def test_the_orgs_own_client_still_creates(pooled):
    """The negative control. The check refuses a foreigner, not everyone."""
    pool = pooled([
        ("FROM staging.graha_clients", {"id": CLIENT}),
        ("SELECT id FROM staging.client_billing_profiles", None),
        ("INSERT INTO staging.client_billing_profiles", {"id": PROFILE}),
    ])
    out = await client_billing.create_profile(
        body=client_billing.ProfileCreate(client_id=CLIENT),
        user={"user_id": "user_admin001"},
        org_id=ORG,
    )
    assert out == {"id": PROFILE}
    assert pool.any("INSERT INTO staging.client_billing_profiles")


async def test_a_second_profile_for_the_same_client_is_still_409(pooled):
    """The duplicate rule survived the new check being put in front of it."""
    pool = pooled([
        ("FROM staging.graha_clients", {"id": CLIENT}),
        ("SELECT id FROM staging.client_billing_profiles", PROFILE),
    ])
    with pytest.raises(HTTPException) as exc:
        await client_billing.create_profile(
            body=client_billing.ProfileCreate(client_id=CLIENT),
            user={"user_id": "user_admin001"},
            org_id=ORG,
        )
    assert exc.value.status_code == 409


def test_the_ownership_check_is_the_siblings_pattern():
    """Not a second implementation that can drift from the first.

    `create_service_line`, `create_metered_usage`, `create_rate_card` and
    `create_sla_credit` all read the parent row `WHERE id = $1::uuid AND
    org_id = $2::uuid` and 404 when it is absent. `create_profile` now does
    the same thing to `graha_clients`.
    """
    shape = "WHERE id = $1::uuid AND org_id = $2::uuid"
    for fn in (client_billing.create_profile,
               client_billing.create_service_line,
               client_billing.create_metered_usage,
               client_billing.create_rate_card,
               client_billing.create_sla_credit):
        src = inspect.getsource(fn)
        assert shape in src, f"{fn.__name__} does not scope its parent lookup"
        assert "HTTPException(404" in src, f"{fn.__name__} does not 404"


# ── the ratchet: no join on an id alone ──────────────────────

_PARTY_TABLES = ("graha_clients", "graha_contacts")

_NEXT_CLAUSE = re.compile(
    r"\b(WHERE|JOIN|LEFT|RIGHT|INNER|CROSS|ORDER\s+BY|GROUP\s+BY|LIMIT|UNION)\b",
    re.I,
)


def _module_sql() -> list[str]:
    """Every SQL string literal in the router.

    Read through the AST, not with grep: adjacent string literals are folded
    into one Constant by the parser, so a query assembled across six lines
    arrives here whole — and a query quoted inside a comment does not arrive at
    all.
    """
    tree = ast.parse(inspect.getsource(client_billing))
    return [n.value for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)
            and "JOIN staging." in n.value]


def test_no_party_table_is_joined_on_the_id_alone():
    """THE DOCUMENTED LEAK SHAPE. `JOIN staging.graha_clients c ON c.id = x`
    is scoped by nothing: the row it reaches is whichever organisation's client
    holds that uuid, and the NAME it carries is what the page renders.

    SEVEN joins in this file had it — the plan named two. Each now carries the
    org predicate as well, so a row that should not be visible drops out of the
    result instead of appearing under someone else's name.
    """
    offenders = []
    for sql in _module_sql():
        for table in _PARTY_TABLES:
            for m in re.finditer(
                    rf"JOIN\s+staging\.{table}\s+(\w+)\s+ON\b", sql, re.I):
                alias = m.group(1)
                rest = sql[m.end():]
                stop = _NEXT_CLAUSE.search(rest)
                clause = rest[:stop.start()] if stop else rest
                if f"{alias}.org_id" not in clause:
                    offenders.append(f"{table} AS {alias}: ON{clause}")
    assert not offenders, (
        "these joins are scoped by the id alone and can surface another "
        f"organisation's row:\n  " + "\n  ".join(offenders)
    )


# ══════════════════════════════════════════════════════════════════════════════
#  3 · The live half — the only thing a mock pool cannot prove
# ══════════════════════════════════════════════════════════════════════════════

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognising it BY VALUE is the only way to tell "no
#: database" from "a database": conftest uses `setdefault`, so `DATABASE_URL`
#: is never absent.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` sets on every connection. Matched so a statement is planned the
#: way it will actually be planned.
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. This half parses the router's SQL against the real "
    "catalogue and cannot be done offline — a MagicMock pool answers happily "
    "to an INSERT naming a column that does not exist, which is exactly how "
    "`gst_rate` survived. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_client_billing_invoices.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def _captured_calls() -> list[tuple[str, str, tuple]]:
    """(path, sql, args) for every statement both write paths issue."""
    async def run():
        import db
        out = []
        for name, script, drive in (
            ("sweep", SWEEP_SCRIPT,
             lambda: client_billing.sweep_client_auto_invoices(today=TODAY)),
            ("usage", USAGE_SCRIPT,
             lambda: client_billing.generate_usage_invoice(
                 body=client_billing.GenerateUsageInvoice(profile_id=PROFILE),
                 user={"user_id": "user_admin001"}, org_id=ORG)),
        ):
            pool = CapturePool(script)
            original, db._pool = db._pool, pool
            try:
                await drive()
            finally:
                db._pool = original
            out.extend((name, sql, args) for sql, args in pool.calls)
        return out

    return asyncio.run(run())


def _describe(calls):
    """Parse and Describe every statement. NOTHING IS EXECUTED.

    `prepare()` sends the statement to the server to be planned and described
    and returns a handle. No `fetch`, no `execute`, no `fetchval` is ever
    called on that handle, so no row is read and none is written.

    `statement_cache_size=0` because the connection goes through PgBouncer in
    transaction mode, where a cached server-side statement belongs to a session
    that will not be there next time.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures, params = [], []
            for path, sql, args in calls:
                try:
                    stmt = await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((path, sql, f"{type(exc).__name__}: {exc}"))
                    continue
                params.append((path, sql, len(stmt.get_parameters()), len(args)))
            catalogue = await conn.fetch(
                "SELECT column_name, is_nullable, column_default "
                "FROM information_schema.columns "
                "WHERE table_schema = 'staging' AND table_name = 'ganit_invoices'"
            )
            return failures, params, [dict(r) for r in catalogue]
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    """Captured statements, described once for the whole file. Connects ONCE.

    A synchronous fixture running its own loop, deliberately: the suite pins
    `asyncio_default_fixture_loop_scope = function`, so a module-scoped async
    fixture would be sharing a loop it does not own.
    """
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    calls = _captured_calls()
    try:
        return _describe(calls)
    except Exception as exc:                                  # noqa: BLE001
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


def test_every_statement_the_router_issues_plans_on_the_real_schema(live):
    """UndefinedColumn / UndefinedTable means the statement has never worked.
    IndeterminateDatatype means `$1 + $2` with no cast, which PgBouncer turns
    into an instant 500."""
    failures, _, _ = live
    assert not failures, "\n\n".join(
        f"[{path}] {err}\n{sql}" for path, sql, err in failures)


def test_every_statement_binds_as_many_arguments_as_it_declares(live):
    """Postgres counts the placeholders; the code counts the arguments. An
    INSERT whose placeholders were renumbered by hand is exactly where the two
    part company, and no offline check can see it."""
    _, params, _ = live
    wrong = [(p, sql, declared, bound)
             for p, sql, declared, bound in params if declared != bound]
    assert not wrong, "\n\n".join(
        f"[{p}] declares ${declared} but binds {bound} arguments\n{sql}"
        for p, sql, declared, bound in wrong)


def test_every_column_named_exists_and_every_required_one_is_supplied(live):
    """The half `prepare()` cannot do.

    A statement that omits a NOT NULL column plans perfectly — the violation is
    a runtime constraint, not a parse error — so Parse and Describe would NOT
    have caught the missing `invoice_number`. Read from the catalogue rather
    than from the migration ledger: migrations are applied by hand here and the
    ledger has been wrong before.
    """
    _, params, catalogue = live
    known = {c["column_name"] for c in catalogue}
    required = {c["column_name"] for c in catalogue
                if c["is_nullable"] == "NO" and c["column_default"] is None}
    assert "invoice_number" in required, (
        "the premise of this test changed: invoice_number is no longer NOT "
        "NULL-without-default on staging.ganit_invoices"
    )

    seen = 0
    for path, sql, _, _ in params:
        if INVOICE_INSERT not in sql:
            continue
        seen += 1
        cols = set(_column_list(sql))
        assert not (cols - known), (
            f"[{path}] names columns staging.ganit_invoices does not have: "
            f"{sorted(cols - known)}")
        assert not (required - cols), (
            f"[{path}] omits NOT NULL columns with no default: "
            f"{sorted(required - cols)}")
    assert seen == 2, f"expected both invoice INSERTs, described {seen}"


def test_the_router_file_is_the_one_under_test(live):
    """A guard on the guard: the live half must be describing THIS router's
    statements and not an empty list."""
    _, params, _ = live
    assert len(params) >= 8, (
        f"only {len(params)} statements described — the capture stopped "
        f"reaching the write paths")
    assert pathlib.Path(client_billing.__file__).name == "client_billing.py"


# ══════════════════════════════════════════════════════════════════════════
#  The tax split REFUSES rather than guessing
#
#  `is_igst` used to be `gst_treatment in ('overseas','sez')` and nothing more,
#  so it never compared the supplier's state with the place of supply — and
#  every INTER-STATE DOMESTIC supply was taxed CGST+SGST when it legally
#  attracts IGST. A Gujarat firm invoicing a Maharashtra client reported the
#  wrong tax heads and paid the wrong governments. It was invisible while both
#  routes 500'd; they work now.
#
#  The honest split needs both ends and either can be missing —
#  `organisations.state_code` was set on 2 of 5 live orgs the day this landed.
#  Defaulting the missing end to "intra-state" IS the original bug. So the
#  answer is a refusal, and these hold it there.
# ══════════════════════════════════════════════════════════════════════════

def test_an_interstate_supply_is_igst():
    is_igst, refusal = client_billing._tax_split("registered", "24", "27")
    assert refusal is None
    assert is_igst is True


def test_an_intrastate_supply_is_not_igst():
    is_igst, refusal = client_billing._tax_split("registered", "27", "27")
    assert refusal is None
    assert is_igst is False


@pytest.mark.parametrize("treatment", ["overseas", "sez"])
def test_an_export_never_blocks_on_a_missing_state(treatment):
    """The treatment settles it, so neither end is consulted. An exporter whose
    organisation has no state_code must still be able to invoice."""
    is_igst, refusal = client_billing._tax_split(treatment, "", "")
    assert refusal is None
    assert is_igst is True


def test_no_supplier_state_refuses_and_says_which_field():
    is_igst, refusal = client_billing._tax_split("registered", "", "27")
    assert is_igst is None
    assert refusal and "state_code" in refusal, refusal


def test_no_place_of_supply_refuses_and_says_why():
    is_igst, refusal = client_billing._tax_split("registered", "24", "")
    assert is_igst is None
    assert refusal and "place of supply" in refusal, refusal


def test_a_refusal_is_never_a_silent_intrastate_default():
    """The whole point. Neither refusal may come back as `False`, which is what
    the old code returned for exactly these inputs — and False is 'tax it as
    CGST+SGST', on a document somebody files."""
    for supplier, pos in (("", "27"), ("24", ""), ("", "")):
        is_igst, refusal = client_billing._tax_split("registered", supplier, pos)
        assert refusal is not None
        assert is_igst is not False, (
            f"supplier={supplier!r} pos={pos!r} silently defaulted to "
            f"intra-state instead of refusing")


@pytest.mark.asyncio
async def test_the_sweep_skips_a_line_it_cannot_tax_and_spends_no_serial(pooled):
    """Unattended, so it skips rather than raising — but it must not draw an
    invoice number for a document it does not write. A serial spent on a
    refused invoice is a permanent gap in the book."""
    pool = pooled([
        ("SELECT state_code FROM staging.organisations", {"state_code": None}),
        ("FROM staging.client_service_lines sl", [SERVICE_LINE]),
        ("FROM staging.client_invoice_lines", None),
    ])
    out = await client_billing.sweep_client_auto_invoices(today=TODAY)
    assert out["created"] == 0
    assert out["skipped"] == 1
    assert not pool.any("INSERT INTO staging.ganit_invoices")
    assert not pool.any("SELECT invoice_number FROM staging.ganit_invoices"), (
        "a serial was drawn for an invoice that was never written")


@pytest.mark.asyncio
async def test_the_usage_route_400s_rather_than_mis_taxing(pooled):
    """A user pressed a button, so this one answers. And it must refuse BEFORE
    marking any usage row invoiced — `invoiced = TRUE` is never reset anywhere,
    so a row consumed by a failed call could never be billed again."""
    pool = pooled([
        ("SELECT state_code FROM staging.organisations", {"state_code": None}),
        ("FROM staging.client_billing_profiles p", BILLING_PROFILE),
        ("FROM staging.client_metered_usage ", [USAGE_ROW]),
    ])
    with pytest.raises(HTTPException) as exc:
        await client_billing.generate_usage_invoice(
            body=client_billing.GenerateUsageInvoice(profile_id=PROFILE),
            user={"user_id": "user_admin001"}, org_id=ORG)
    assert exc.value.status_code == 400
    assert "state_code" in str(exc.value.detail)
    assert not pool.any("INSERT INTO staging.ganit_invoices")
    assert not pool.any("SET invoiced = TRUE"), (
        "usage rows were consumed by a call that raised")
