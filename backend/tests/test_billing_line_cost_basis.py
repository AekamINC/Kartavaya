"""Client-billing invoice lines say, on the line, that they have no cost basis.

── WHAT WAS WRONG ───────────────────────────────────────────────────────────

Phase 1.3 made `line_items[].cost_price` the one place a document remembers
what its lines cost (migration 184; `routers/vikray.apply_line_costs`), and
guarded it with two AST ratchets in `test_line_cost_snapshot.py`. Both parse
`routers/ganit` and `routers/vikray` and nothing else, so neither can see
`routers/client_billing.py` — which Phase 2.3 repaired into a THIRD pair of
`INSERT INTO staging.ganit_invoices` statements, each building its lines
inline with no cost of any kind and nothing saying why.

Harmless today and not tomorrow. Measured live, SELECT-only, 2026-08-26:

    ganit_invoices WHERE billing_profile_id IS NOT NULL       0 rows
    client_invoice_lines                                      0 rows
    client_service_lines, the two in-scope orgs                4 rows
      · of those, auto_invoice = TRUE, every org               2 rows
    client_metered_usage, the two in-scope orgs                5 rows

Zero because both statements 500'd until Phase 2.3; the seven source rows are
what starts flowing the moment Phase 3.4 arms `/cron/billing`.

── WHY A MARKER AND NOT `apply_line_costs` ──────────────────────────────────

Because there is no product to cost. `apply_line_costs` resolves
`line_items[].product_id` against `staging.ganit_products`, and neither table
these two paths read from has a product column at all — read off the live
catalogue on 2026-08-26:

    client_service_lines   id, org_id, profile_id, kind, description, amount,
                           cadence, period_start, period_end,
                           billing_direction, auto_invoice, created_by,
                           created_at, updated_at
    client_metered_usage   id, org_id, profile_id, metric, quantity, unit,
                           rate, recorded_date, source_ref, invoiced,
                           created_by, created_at

So calling the helper here would pop a key nobody set, build an empty id list,
skip its query and return the lines byte-identical — a call that satisfies a
ratchet and changes no data. Worse than useless: the next reader would take it
as evidence that a cost lookup happens on these lines, and read the absent key
as "the product had no cost recorded" rather than "there is no product". That
misreading is one short step from someone joining `ganit_products` at read
time, which is the exact join `cost_price` exists to avoid.

`cost_price: 0` is not the answer either — 1.3's ABSENT, NEVER ZERO rule, and
false besides: what a retainer or a metered GB costs this firm is staff time,
which this product records nowhere. Zero would report every auto-invoiced
rupee as pure profit.

What is left is 1.3's own ratchet docstring, which calls out "a document
nothing can compute a margin from, and nothing says so". The margin genuinely
cannot be computed. So the line SAYS SO — `cost_basis` beside the absent
`cost_price` — and these tests hold the saying.

The key is additive and invisible to every existing reader:
`commission_reports.py` and `vetana.py` both filter on
`li ? 'cost_price' AND jsonb_typeof(li->'cost_price') = 'number'`, which an
omitted key fails and a sibling key does not change, and `pay.py:_line`
rebuilds the customer's line from a closed allow-list — pinned below, because
a new key on a line is exactly when that allow-list matters.
"""
import ast
import inspect
import json
import re
from datetime import date

import pytest

import routers.client_billing as client_billing


#: The wire format, pinned here rather than imported, so that renaming the
#: constant in the router cannot quietly rename what lands in jsonb. A reader
#: written against a stored document sees this string and nothing else.
MARKER_KEY = "cost_basis"
MARKER_VALUE = "none_service_revenue"

ORG = "11111111-1111-1111-1111-111111111111"
CLIENT = "33333333-3333-3333-3333-333333333333"
PROFILE = "44444444-4444-4444-4444-444444444444"
LINE = "55555555-5555-5555-5555-555555555555"
USAGE = "66666666-6666-6666-6666-666666666666"

TODAY = date(2026, 8, 25)

SERVICE_LINE = {
    "id": LINE, "org_id": ORG, "profile_id": PROFILE, "client_id": CLIENT,
    "kind": "retainer", "description": "Monthly retainer", "amount": 25000,
    "cadence": "monthly", "period_start": date(2026, 8, 1), "period_end": None,
    # `invoice_from` — migration 223, and the fixture has to carry it because
    # the sweep's SELECT names it. It went in during Phase 3.3 and this row did
    # not follow, so three tests here died on `KeyError: 'invoice_from'` while
    # the production query was correct: a fixture that models a query it has
    # stopped matching tests nothing, which is `mock-pool-hides-bad-sql` in
    # reverse.
    #
    # None means "no floor stated", the value every existing row carries: the
    # column is nullable and nothing backfilled it. `period_start` is when the
    # SERVICE began and `invoice_from` is when the CLOCK starts, which is why
    # 3.3 added a column instead of rewriting the one that was there.
    "invoice_from": None,
    "billing_direction": "advance", "auto_invoice": True,
    "billing_cycle": "monthly", "anchor_day": 1, "payment_terms_days": 30,
    "currency": "INR", "gst_treatment": "registered",
    "client_name": "A Client Pvt Ltd",
    "client_gstin": "27AABCU9603R1ZM",
    "client_address": {"state": "Maharashtra"},
}

BILLING_PROFILE = {
    "id": PROFILE, "org_id": ORG, "client_id": CLIENT,
    "billing_cycle": "monthly", "anchor_day": 1, "payment_terms_days": 30,
    "currency": "INR", "gst_treatment": "registered",
    "client_name": "A Client Pvt Ltd",
    "client_gstin": "27AABCU9603R1ZM",
    "client_address": {"state": "Maharashtra"},
}

#: Two rows, not one. A per-line marker appended once outside the loop passes
#: with a single row and ships a second, unmarked line the day a client
#: reports two metrics.
USAGE_ROWS = [
    {"id": USAGE, "org_id": ORG, "profile_id": PROFILE, "metric": "storage",
     "quantity": 120, "unit": "GB", "rate": 12,
     "recorded_date": date(2026, 8, 12), "invoiced": False},
    {"id": LINE, "org_id": ORG, "profile_id": PROFILE, "metric": "api_calls",
     "quantity": 4000, "unit": "calls", "rate": 0.5,
     "recorded_date": date(2026, 8, 13), "invoiced": False},
]


# ── the capture pool ─────────────────────────────────────────

class CapturePool:
    """Records every statement and its arguments; answers from a script.

    Holds no connection, so nothing reached through it can touch the shared
    database — staging and production are one Supabase instance (CLAUDE.md)
    and this file is about what gets WRITTEN onto a line. `acquire()` and
    `transaction()` exist because both write paths run inside an explicit
    transaction and `utils.next_doc_number` takes a connection of its own.
    """

    def __init__(self, script=None):
        self.script = script or []
        self.calls: list[tuple[str, tuple]] = []

    def _answer(self, sql, default):
        for needle, value in self.script:
            if needle in sql:
                return value
        return default

    async def fetch(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return self._answer(sql, [])

    async def fetchrow(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return self._answer(sql, None)

    async def fetchval(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return self._answer(sql, None)

    async def execute(self, sql, *args, **kw):
        self.calls.append((sql, args))
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


#: '24' (Gujarat) against a Maharashtra customer. `_tax_split` REFUSES rather
#: than defaulting when either end of the supply is unknown, so a run with no
#: supplier state writes no invoice at all and would prove nothing here.
SUPPLIER_STATE = ("SELECT state_code FROM staging.organisations",
                  {"state_code": "24"})

SWEEP_SCRIPT = [
    SUPPLIER_STATE,
    ("FROM staging.client_service_lines sl", [SERVICE_LINE]),
    ("FROM staging.client_invoice_lines", None),
    ("SELECT invoice_number FROM staging.ganit_invoices", None),
]

USAGE_SCRIPT = [
    SUPPLIER_STATE,
    ("FROM staging.client_billing_profiles p", BILLING_PROFILE),
    ("FROM staging.client_metered_usage ", USAGE_ROWS),
    ("SELECT invoice_number FROM staging.ganit_invoices", None),
]

INVOICE_INSERT = "INSERT INTO staging.ganit_invoices"


def _stored_lines(pool) -> list[dict]:
    """The lines as they reached the database — found by SHAPE, not position.

    An assertion pinned to an argument index breaks the day a column is
    appended to the INSERT. Round-tripped through json so what is asserted is
    what jsonb will actually hold: `jsonb_typeof(li->'cost_price') = 'number'`
    is a statement about the STORED value, and a Python object that never left
    the process cannot answer it.
    """
    for sql, args in pool.calls:
        if INVOICE_INSERT not in sql:
            continue
        for a in args:
            parsed = a
            if isinstance(a, str):
                try:
                    parsed = json.loads(a)
                except (TypeError, ValueError):
                    continue
            if (isinstance(parsed, list) and parsed
                    and isinstance(parsed[0], dict)
                    and "description" in parsed[0]):
                return json.loads(json.dumps(parsed))
    raise AssertionError("no line_items JSON reached the invoice INSERT")


async def _run_sweep(pooled) -> list[dict]:
    pool = pooled(SWEEP_SCRIPT)
    out = await client_billing.sweep_client_auto_invoices(today=TODAY)
    assert out["created"] == 1, f"the sweep did not create an invoice: {out}"
    return _stored_lines(pool)


async def _run_usage_invoice(pooled) -> list[dict]:
    pool = pooled(USAGE_SCRIPT)
    out = await client_billing.generate_usage_invoice(
        body=client_billing.GenerateUsageInvoice(profile_id=PROFILE),
        user={"user_id": "user_admin001"},
        org_id=ORG,
    )
    assert out["entries"] == 2, f"no usage rolled into the invoice: {out}"
    return _stored_lines(pool)


def _assert_marked(lines, where):
    assert lines, f"{where} wrote no lines at all"
    for i, li in enumerate(lines):
        assert li.get(MARKER_KEY) == MARKER_VALUE, (
            f"{where} line {i} does not say why it has no cost: "
            f"expected {MARKER_KEY}={MARKER_VALUE!r}, got {li!r}"
        )
        # A string, not a number. The margin readers sum whatever numeric key
        # they are pointed at; a marker that arrives as a number is one
        # careless `->>` away from being added to a cost total.
        assert isinstance(li[MARKER_KEY], str), \
            f"{where} line {i} stored the marker as {type(li[MARKER_KEY])}"


def _assert_no_cost_price(lines, where):
    for i, li in enumerate(lines):
        # ABSENT, NEVER ZERO. `commission_reports.py` guards on
        # `li ? 'cost_price'`, which an omitted key fails and a 0 or a null
        # passes — and 0 reports the whole line as pure profit.
        assert "cost_price" not in li, (
            f"{where} line {i} claims a cost it cannot know: "
            f"cost_price={li['cost_price']!r}"
        )


# ══════════════════════════════════════════════════════════════════════════
#  What the two paths write
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_the_sweeps_lines_say_they_have_no_cost_basis(pooled):
    """The auto-invoice sweep — the path Phase 3.4 arms."""
    _assert_marked(await _run_sweep(pooled), "sweep_client_auto_invoices")


@pytest.mark.asyncio
async def test_the_sweeps_lines_claim_no_cost(pooled):
    _assert_no_cost_price(await _run_sweep(pooled),
                          "sweep_client_auto_invoices")


@pytest.mark.asyncio
async def test_every_metered_line_says_it_has_no_cost_basis(pooled):
    """EVERY line, not the first: the marker belongs inside the loop."""
    lines = await _run_usage_invoice(pooled)
    assert len(lines) == 2, f"one usage row per line, got {len(lines)}"
    _assert_marked(lines, "generate_usage_invoice")


@pytest.mark.asyncio
async def test_the_metered_lines_claim_no_cost(pooled):
    _assert_no_cost_price(await _run_usage_invoice(pooled),
                          "generate_usage_invoice")


@pytest.mark.asyncio
async def test_both_paths_write_one_spelling(pooled):
    """Two spellings of one idea is a reader that has to know both.

    The router's own comment says it: the two INSERTs write the same column
    and "a reader cannot be asked to handle two spellings of one line".
    """
    sweep = await _run_sweep(pooled)
    usage = await _run_usage_invoice(pooled)
    assert {li[MARKER_KEY] for li in sweep} == {li[MARKER_KEY] for li in usage}


def test_the_router_exports_the_marker_it_writes():
    """One constant, so a reader has one thing to grep and the two INSERTs
    cannot drift apart by a typo."""
    assert getattr(client_billing, "NO_COST_BASIS", None) == MARKER_VALUE


# ══════════════════════════════════════════════════════════════════════════
#  Source-level backstop — the ratchet 1.3 could not reach
# ══════════════════════════════════════════════════════════════════════════

def _async_defs(module):
    return [n for n in ast.walk(ast.parse(inspect.getsource(module)))
            if isinstance(n, ast.AsyncFunctionDef)]


def _writes(node, fragment):
    return any(fragment in c.value for c in ast.walk(node)
               if isinstance(c, ast.Constant) and isinstance(c.value, str))


def _names(node):
    return {c.id for c in ast.walk(node) if isinstance(c, ast.Name)}


def test_every_billing_invoice_insert_states_its_cost_basis():
    """A third billing write path added next month fails here.

    The counterpart of `test_line_cost_snapshot.py`'s two ratchets, for the
    module they cannot see: those parse `routers/ganit` and `routers/vikray`
    by name, which is why this file's two INSERTs shipped uncosted and
    unremarked through both of them.
    """
    offenders = [n.name for n in _async_defs(client_billing)
                 if _writes(n, INVOICE_INSERT)
                 and "NO_COST_BASIS" not in _names(n)]
    assert not offenders, (
        "these billing invoice write paths write lines that neither carry a "
        f"cost nor say why: {offenders} — put NO_COST_BASIS on the line"
    )


def test_no_billing_line_is_born_with_a_zero_cost():
    """The tempting wrong fix, refused in source as well as in behaviour.

    A future edit that "completes" the line with `"cost_price": 0` passes
    every reader's guard and reports the firm's service revenue at a 100%
    gross margin. Held at text level because it must fail on the diff, not on
    the invoice raised three months later.
    """
    src = inspect.getsource(client_billing)
    assert not re.findall(r"[\"']cost_price[\"']\s*:", src), (
        "a line in client_billing.py sets cost_price; these lines have no "
        "product behind them and cannot know a cost — see NO_COST_BASIS"
    )


def test_the_marker_never_reaches_the_customers_pay_page():
    """A new key on a line is exactly when `pay.py`'s allow-list matters.

    Asserted on the function's OUTPUT, so a comment mentioning the key cannot
    fail it and a real leak cannot pass it. `cost_basis` is not a secret the
    way `cost_price` is, but the rule that the public page rebuilds the line
    from a closed list rather than passing it through is the thing worth
    holding, and it is only ever exercised when someone adds a key.
    """
    import routers.pay as pay
    out = pay._line({"description": "Monthly retainer", "quantity": 1,
                     "rate": 25000, "gst_rate": 18, "amount": 25000,
                     MARKER_KEY: MARKER_VALUE})
    assert MARKER_KEY not in out
