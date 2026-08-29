"""The place of supply on an invoice converted from a sales order.

── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────

`vikray.generate_invoice_from_order` hardcoded `''` for `place_of_supply` in
its INSERT's VALUES list, on documents whose `invoice_type` is `tax_invoice`.
Measured on the live database 2026-08-29, SELECT-only::

    ganit_invoices                                        65 rows
      place_of_supply blank                               31
      notes LIKE 'Generated from order %'                 10
      …of those, blank place_of_supply                    10   ← every one
      …of those, is_igst = true                            6

Place of supply is the field that decides whether a supply is reported under
IGST or under CGST+SGST, and `services/gstr1_json.py` reads THIS EXACT COLUMN
via `parse_state_code(row["place_of_supply"])`. An empty one is not an error
there, which is what makes it expensive:

  · INTRA-state — the builder falls back to the supplier's own state, correctly,
    "because that is what `is_igst = false` MEANS". The return is right; only
    the document is short of a Rule 46(n) particular.
  · INTER-state — there is nothing to fall back on, so the row is HELD BACK
    with "no place of supply recorded, and it cannot be inferred for an
    inter-state supply". **The invoice does not appear in the return at all**,
    silently, with the money still on the books. Six live invoices are in that
    state today.

── WHAT IS ASSERTED, AND IN WHICH HALF ──────────────────────────────────────

Three halves, and the separation is the safety story. Staging and production
share one Supabase database (CLAUDE.md), so NOTHING here writes a row.

  1. THE DERIVATION, as pure functions. Every branch of
     `_order_place_of_supply`, including the ones live data actually produces —
     a client whose GSTIN says Gujarat and whose address says Maharashtra, on
     an order flagged inter-state.
  2. CAPTURE, offline. The route is driven with a pool that records every
     statement and answers from a script, so the SQL is built exactly as it
     would be at run time and the bound arguments can be read back.
  3. CHECK, live. `asyncpg.Connection.prepare()` sends Parse and Describe and
     STOPS: the server plans the statement, resolves every relation, column and
     parameter type, and returns the shapes — it does not execute, does not
     read a row and does not write one. It is also the only honest witness to
     the parameter TYPE the server infers for the new `$16`, and to the
     argument count of an INSERT whose placeholder list was extended by hand.

     `tests/test_client_billing_invoices.py` is the reference implementation
     this copies, as `tests/test_every_writer_has_a_live_sql_test.py` instructs.
     `vikray` comes off that file's `UNCOVERED` baseline with this one.

     ⚠ It covers the statements `generate_invoice_from_order` issues. That is
     the whole of the conversion path — the order read, the counterparty read,
     the serial allocation, the invoice INSERT and the order UPDATE — and it is
     not the whole of `routers/vikray.py`. The ratchet credits coverage per
     ROUTER, so this is recorded rather than left to be inferred.

When there is no database the live half skips, loudly, with the command in the
message.
"""
import asyncio
import inspect
import os
import pathlib
import re

import pytest

import routers.vikray as vikray
from services.gst_states import GST_STATES
from services.gstr1_json import parse_state_code


# ── identities ───────────────────────────────────────────────
# Values, never sources. No statement built with them is ever executed.

ORG = "11111111-1111-1111-1111-111111111111"
CLIENT = "33333333-3333-3333-3333-333333333333"
CONTACT = "44444444-4444-4444-4444-444444444444"
ORDER = "55555555-5555-5555-5555-555555555555"
INVOICE = "66666666-6666-6666-6666-666666666666"

#: Unicode Group is 24 Gujarat and UK AekamINC is 27 Maharashtra, and the
#: pairing is deliberate (proposal 93 §9): invoices between them exercise IGST
#: while invoices within each exercise CGST/SGST. The fixtures use the same two.
GUJARAT, MAHARASHTRA = "24", "27"
GJ_GSTIN = "24AABCU9603R1ZT"
MH_GSTIN = "27AABCU9603R1ZN"


# ══════════════════════════════════════════════════════════════════════════════
#  1 · The derivation
# ══════════════════════════════════════════════════════════════════════════════

SUPPLIER_GJ = {"gstin": GJ_GSTIN, "state_code": GUJARAT, "billing_address": {}}


def test_an_intrastate_supply_is_supplied_in_our_own_state():
    """Not a new classifier — it is what `is_igst = False` MEANS.

    `gstr1_json` already performs exactly this inference when the column is
    blank and says so in as many words. Writing it down makes the row STATE
    what its reader was inferring, which is the difference between a document
    that is complete on its face and one that is not.
    """
    assert vikray._order_place_of_supply(
        SUPPLIER_GJ, False, [GJ_GSTIN[:2]]) == "Gujarat"


def test_an_interstate_supply_takes_the_recipients_state():
    assert vikray._order_place_of_supply(
        SUPPLIER_GJ, True, [MH_GSTIN[:2]]) == "Maharashtra"


def test_the_person_outranks_the_company_the_way_the_form_does():
    """`InvoiceForm.jsx` derives from `customer?.gstin || company?.gstin` — the
    named person's own registration first. The two paths must not disagree
    about one sale."""
    assert vikray._order_place_of_supply(
        SUPPLIER_GJ, True, [MH_GSTIN[:2], "29"]) == "Maharashtra"


def test_an_unregistered_customer_still_has_a_place_of_supply():
    """⚠ GSTIN BLOCKS NOTHING, and it does not start blocking here. A B2C buyer
    with no registration at all is invoiced from their address."""
    assert vikray._order_place_of_supply(
        SUPPLIER_GJ, True, ["", "", "Tamil Nadu"]) == "Tamil Nadu"


def test_a_candidate_that_contradicts_the_tax_heads_is_skipped():
    """THE CASE LIVE DATA ACTUALLY PRODUCES.

    INV-2026-0059, -0060 and -0065 each name a client whose GSTIN begins `24`
    — the supplier's own state — while the client's address is Maharashtra,
    Karnataka and Maharashtra, and the order is flagged inter-state. Writing
    the GSTIN's `24` there would produce an invoice marked IGST whose place of
    supply is the supplier's own state: a document that contradicts the tax it
    carries, which `doc_validation` treats as a BLOCKING "Tax split" gap. So
    the contradicting candidate is passed over and the next one answers.
    """
    assert vikray._order_place_of_supply(
        SUPPLIER_GJ, True, [GJ_GSTIN[:2], "Maharashtra"]) == "Maharashtra"


def test_nothing_is_invented_when_nothing_can_be_read():
    """'' is exactly what was written before, so this can only IMPROVE the
    column and never blank one that was populated. A wrong place of supply
    moves tax between states; a missing one is already visible as an advisory
    Rule 46(n) gap and in `gst_period`'s `place_of_supply_missing`."""
    assert vikray._order_place_of_supply(SUPPLIER_GJ, True, ["", "", None]) == ""
    assert vikray._order_place_of_supply(
        {"gstin": "", "state_code": "", "billing_address": {}},
        False, ["", None]) == ""


def test_a_supplier_with_no_state_still_names_an_intrastate_supply():
    """Both ends of an intra-state supply are in one state, so the counterparty
    names it just as well as we do. `organisations.state_code` was unsettable
    by anybody until 2026-08-29, so orgs with none are the ordinary case, not
    the edge."""
    assert vikray._order_place_of_supply(
        {"gstin": "", "state_code": "", "billing_address": {}},
        False, [MH_GSTIN[:2]]) == "Maharashtra"


def test_the_supplier_gstin_outranks_a_stale_state_code():
    """`gstr1_json.supplier_state_code` reads the GSTIN first because its first
    two characters ARE the state of registration. Reusing it rather than
    re-reading `state_code` is what keeps one answer for the supplier's state
    across the invoice writer and the return builder."""
    assert vikray._order_place_of_supply(
        {"gstin": MH_GSTIN, "state_code": GUJARAT, "billing_address": {}},
        False, []) == "Maharashtra"


def test_a_mistyped_supplier_gstin_falls_back_and_does_not_stop_the_invoice():
    """⚠ WORTH KNOWING, AND IT IS NOT OBVIOUS FROM THE CALL SITE.

    `supplier_state_code` uses the GSTIN only if it passes its own CHECK DIGIT
    (`services/gstin.is_valid`); a mistyped one is ignored and `state_code`
    answers instead. That is the right order — a registration that fails its
    check digit is not a registration — and it is why a firm with a typo in its
    GSTIN keeps invoicing correctly rather than losing its place of supply.

    Found while writing this file: the first fixtures here used made-up GSTINs
    that failed the check digit, so the supplier branch was silently taking the
    `state_code` path in every test that claimed to exercise the GSTIN one.
    """
    assert vikray._order_place_of_supply(
        {"gstin": "27AABCU9603R1ZM",   # 27… but the check digit is wrong
         "state_code": GUJARAT, "billing_address": {}},
        False, []) == "Gujarat"


def test_the_recipients_prefix_is_read_without_validating_their_gstin():
    """The counterparty side is deliberately NOT gated on the check digit, and
    that matches `frontend/src/lib/validators.js` exactly: "the prefix is
    readable from the first two characters and is correct long before the check
    digit is". A half-entered customer GSTIN still says which state, and a
    document is not held hostage to somebody else's typo."""
    assert vikray._order_place_of_supply(
        SUPPLIER_GJ, True, ["27AABCU9603R1ZM"[:2]]) == "Maharashtra"


def test_the_retired_andhra_code_is_never_written_onto_a_new_document():
    """28 is pre-bifurcation Andhra Pradesh.

    `frontend/src/lib/validators.js` states the rule both sides follow: it is
    "deliberately absent … the backend accepts it on input, but nothing issued
    today should be given that name." A candidate resolving to 28 is therefore
    skipped and the next one is tried, rather than being written.
    """
    assert "28" in vikray._NOT_ISSUABLE_TODAY
    assert vikray._order_place_of_supply(
        SUPPLIER_GJ, True, ["28", "Kerala"]) == "Kerala"
    assert vikray._order_place_of_supply(SUPPLIER_GJ, True, ["28"]) == ""


def test_everything_this_writes_is_readable_by_the_reader_of_this_column():
    """THE ROUND TRIP, over the whole codelist rather than a sample.

    The value goes into `ganit_invoices.place_of_supply`, and the one thing
    that reads that column for classification is
    `gstr1_json.parse_state_code`. A name this writer emits that the builder
    cannot resolve would hold the invoice back from GSTR-1 — the very defect
    being fixed — so every code that can be emitted is round-tripped.

    28 is excluded because it is never emitted; that is asserted above rather
    than assumed here.
    """
    unreadable = []
    for code in GST_STATES:
        if code in vikray._NOT_ISSUABLE_TODAY:
            continue
        name = vikray._state_name(code)
        assert name, f"{code} has no name to write"
        if parse_state_code(name) != code:
            unreadable.append((code, name, parse_state_code(name)))
    assert not unreadable, (
        "these are written as names that gstr1_json.parse_state_code cannot "
        f"resolve back, so the invoice would be held out of the return: "
        f"{unreadable}"
    )


def test_the_codelist_is_not_copied_here():
    """`services/gst_states.py` exists because four modules had imported a
    private codelist out of a fifth. A second table in this router would be
    the same mistake with a fresh name."""
    src = inspect.getsource(vikray)
    assert "gst_states" in src, "the shared codelist is no longer consulted"
    for name in ("Maharashtra", "Karnataka", "Tamil Nadu"):
        # Fixtures and prose may name a state; a mapping would name many of
        # them beside a code.
        assert f'"{name}": ' not in src and f"'{name}': " not in src, (
            f"a state table is being rebuilt in vikray.py ({name})")


# ══════════════════════════════════════════════════════════════════════════════
#  2 · The capture half — runs everywhere, including with no database
# ══════════════════════════════════════════════════════════════════════════════

ORDER_ROW = {
    "id": ORDER,
    "org_id": ORG,
    "order_number": "SO-2026-0001",
    "status": "confirmed",
    "invoice_id": None,
    "client_id": CLIENT,
    "contact_id": CONTACT,
    "salesperson_id": "user_rep0001",
    "is_igst": True,
    "line_items": [{
        "description": "Consulting", "quantity": 1, "unit": "NOS",
        "rate": 10000, "gst_rate": 18, "hsn_code": "998311",
        "line_total": 10000, "gst_amount": 1800,
    }],
    "subtotal": 10000, "cgst": 0, "sgst": 0, "igst": 1800,
    "discount": 0, "total": 11800,
}

#: Gujarat supplier, Maharashtra customer — the inter-state case, which is the
#: one GSTR-1 holds back today.
PARTIES_ROW = {
    "org_gstin": GJ_GSTIN,
    "org_state_code": GUJARAT,
    "org_billing_address": {"state": "Gujarat"},
    "client_gstin": MH_GSTIN,
    "client_address": {"state": "Maharashtra"},
    "contact_gstin": "",
    "contact_address": {},
}


class CapturePool:
    """Records every statement and its arguments; answers from a script.

    It holds no connection, so nothing reached through it can touch the shared
    database. `acquire()` and `transaction()` exist because
    `utils.next_doc_number` takes a connection of its own to hold its advisory
    lock.
    """

    def __init__(self, script=None):
        self.script = script or []
        self.calls: list[tuple[str, tuple]] = []

    def _answer(self, sql, default):
        for needle, value in self.script:
            if needle in sql:
                return value
        return default

    def _record(self, sql, args):
        self.calls.append((sql, args))

    def statements(self):
        return [sql for sql, _ in self.calls]

    def one(self, needle: str):
        hits = [c for c in self.calls if needle in c[0]]
        assert len(hits) == 1, (
            f"expected exactly one statement containing {needle!r}, "
            f"found {len(hits)}")
        return hits[0]

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
        return "UPDATE 1"

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


def _script(parties=None, order=None):
    return [
        ("FROM staging.vikray_orders", order or ORDER_ROW),
        # The counterparty read this change adds. Matched before the two
        # single-table reads below, which is why the needle names the join.
        ("LEFT JOIN staging.graha_clients cl", parties if parties is not None
         else PARTIES_ROW),
        # `_refuse_final_if_incomplete`'s own reads.
        ("SELECT name, gstin, pan, billing_address FROM staging.organisations",
         {"name": "A Firm LLP", "gstin": GJ_GSTIN, "pan": "AABCU9603R",
          "billing_address": {"line1": "1 Road", "city": "Surat",
                              "state": "Gujarat", "pincode": "395001"}}),
        ("FROM staging.graha_contacts",
         {"name": "A Person", "company": "A Client Pvt Ltd",
          "gstin": MH_GSTIN}),
        ("FROM staging.module_compliance_settings", []),
        # `next_doc_number` reads the newest serial; none yet, so it mints 0001.
        ("SELECT invoice_number FROM staging.ganit_invoices", None),
        ("INSERT INTO staging.ganit_invoices", {"id": INVOICE}),
    ]


async def _convert(script=None) -> CapturePool:
    import db
    pool = CapturePool(script or _script())
    original, db._pool = db._pool, pool
    try:
        out = await vikray.generate_invoice_from_order(
            order_id=ORDER, user={"user_id": "user_admin001"}, org_id=ORG)
    finally:
        db._pool = original
    assert out["ok"] is True, f"the conversion did not produce an invoice: {out}"
    return pool


INVOICE_INSERT = "INSERT INTO staging.ganit_invoices"


def _column_list(sql: str) -> list[str]:
    m = re.search(
        r"INSERT INTO staging\.ganit_invoices\s*\((.*?)\)\s*VALUES", sql, re.S)
    assert m, f"could not read the column list out of:\n{sql}"
    return [c.strip() for c in m.group(1).split(",")]


def _value_list(sql: str) -> list[str]:
    m = re.search(r"\)\s*VALUES\s*\((.*)\)\s*RETURNING", sql.strip(), re.S)
    assert m, f"could not read the VALUES list out of:\n{sql}"
    return [v.strip() for v in m.group(1).split(",")]


def _bound(sql, args, column):
    """The argument actually bound to `column` in this INSERT."""
    cols, vals = _column_list(sql), _value_list(sql)
    assert column in cols, f"{column} is not named by this INSERT"
    placeholder = vals[cols.index(column)]
    m = re.search(r"\$(\d+)", placeholder)
    assert m, f"{column} is not bound to a placeholder — it is {placeholder!r}"
    return args[int(m.group(1)) - 1]


async def test_the_conversion_is_reached_at_all():
    """Guard on the harness. If capture stopped working every check below would
    pass by checking nothing."""
    pool = await _convert()
    pool.one(INVOICE_INSERT)
    pool.one("UPDATE staging.vikray_orders")


async def test_the_place_of_supply_is_bound_and_not_a_hardcoded_blank():
    pool = await _convert()
    sql, args = pool.one(INVOICE_INSERT)
    cols, vals = _column_list(sql), _value_list(sql)
    assert vals[cols.index("place_of_supply")] != "''", (
        "place_of_supply is still the hardcoded '' this route shipped with — "
        "every invoice converted from an order stores a blank one, and "
        "gstr1_json holds every inter-state one out of the return"
    )
    assert _bound(sql, args, "place_of_supply") == "Maharashtra"


async def test_the_stored_value_agrees_with_the_tax_the_invoice_carries():
    """The document may not state one treatment and carry another.

    An IGST invoice whose place of supply is the supplier's own state is the
    BLOCKING "Tax split" gap in `doc_validation`, and it is what a naive
    GSTIN-first derivation would have written for three of the ten live rows.
    """
    pool = await _convert()
    sql, args = pool.one(INVOICE_INSERT)
    is_igst = _bound(sql, args, "is_igst")
    pos = parse_state_code(_bound(sql, args, "place_of_supply"))
    assert is_igst is True
    assert pos and pos != GUJARAT, (
        f"the invoice is marked inter-state but its place of supply is "
        f"{pos!r}, the supplier's own state")


async def test_an_intrastate_order_records_the_home_state():
    intra = {**ORDER_ROW, "is_igst": False, "cgst": 900, "sgst": 900, "igst": 0}
    parties = {**PARTIES_ROW, "client_gstin": GJ_GSTIN,
               "client_address": {"state": "Gujarat"},
               "contact_gstin": GJ_GSTIN}
    pool = await _convert(_script(parties=parties, order=intra))
    sql, args = pool.one(INVOICE_INSERT)
    assert _bound(sql, args, "place_of_supply") == "Gujarat"
    assert _bound(sql, args, "is_igst") is False


async def test_an_order_with_no_readable_state_still_invoices():
    """⚠ GSTIN / PAN / TAN MUST BLOCK NOTHING. That rule has regressed more
    than once, and a derivation that raised or refused here would be the next
    regression. A blank stays a blank and the invoice is still raised."""
    parties = {**PARTIES_ROW, "org_gstin": "", "org_state_code": "",
               "org_billing_address": {}, "client_gstin": "",
               "client_address": {}, "contact_gstin": "", "contact_address": {}}
    pool = await _convert(_script(parties=parties))
    sql, args = pool.one(INVOICE_INSERT)
    assert _bound(sql, args, "place_of_supply") == ""
    assert _bound(sql, args, "invoice_number").startswith("INV-")


async def test_the_counterparty_read_is_org_scoped_on_both_joins():
    """`ganit_invoices.client_id`'s foreign key is not composite with `org_id`,
    and neither is `contact_id`'s. Without the predicate a counterparty uuid
    belonging to another tenant would answer and put ANOTHER FIRM'S STATE on
    this org's tax invoice."""
    pool = await _convert()
    sql, _ = pool.one("LEFT JOIN staging.graha_clients cl")
    joins = [ln.strip() for ln in sql.split("LEFT JOIN")[1:]]
    assert len(joins) == 2, f"expected two counterparty joins, read {len(joins)}"
    for join in joins:
        assert "org_id = $1::uuid" in join, (
            f"a counterparty join is not scoped to the caller's org:\n{join}")


async def test_the_serial_is_still_drawn_after_the_gate():
    """A refusal that has already drawn a serial leaves a permanent gap in the
    invoice sequence, which is the thing a tax auditor asks about. The new
    counterparty read must not have moved the allocator above the gate."""
    pool = await _convert()
    stmts = pool.statements()
    gate = next(i for i, s in enumerate(stmts)
                if "SELECT name, gstin, pan, billing_address" in s)
    serial = next(i for i, s in enumerate(stmts)
                  if "SELECT invoice_number FROM staging.ganit_invoices" in s)
    assert gate < serial, "the serial is drawn before the Rule 46 gate runs"


async def test_the_gate_is_told_the_place_of_supply_being_written():
    """Otherwise its advisory Rule 46(n) gap describes a document that is not
    the one about to be stored."""
    src = inspect.getsource(vikray.generate_invoice_from_order)
    gate = src.index("_refuse_final_if_incomplete")
    insert = src.index(INVOICE_INSERT)
    assert '"place_of_supply": place_of_supply' in src[gate:insert]


async def test_total_and_balance_due_still_share_one_placeholder():
    """The new parameter is APPENDED, not slotted in.

    `$11` is deliberately bound twice — `total` and `balance_due` — and
    renumbering the list to put the place of supply in its column's position
    would be a chance to break the one placeholder that is not 1:1. That
    omission is what made every order-generated invoice read as fully paid.
    """
    pool = await _convert()
    sql, args = pool.one(INVOICE_INSERT)
    cols, vals = _column_list(sql), _value_list(sql)
    assert vals[cols.index("balance_due")] == vals[cols.index("total")]
    assert _bound(sql, args, "balance_due") == _bound(sql, args, "total")


# ══════════════════════════════════════════════════════════════════════════════
#  3 · The live half — the only thing a mock pool cannot prove
# ══════════════════════════════════════════════════════════════════════════════

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognising it BY VALUE is the only way to tell "no
#: database" from "a database": conftest uses `setdefault`.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` sets on every connection. Matched so a statement is planned the
#: way it will actually be planned.
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. This half parses the router's SQL against the real "
    "catalogue and cannot be done offline — a MagicMock pool answers happily "
    "to an INSERT naming a column that does not exist. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_order_invoice_place_of_supply.py -q"
)


def live_dsn():
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def _captured_calls():
    """(sql, args) for every statement the conversion issues."""
    async def run():
        pool = await _convert()
        return list(pool.calls)

    return asyncio.run(run())


def _describe(calls):
    """Parse and Describe every statement. NOTHING IS EXECUTED.

    `prepare()` sends the statement to be planned and described and returns a
    handle. No `fetch`, no `execute` and no `fetchval` is ever called on that
    handle, so no row is read and none is written.

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
                described.append(
                    (sql, args, [p.name for p in stmt.get_parameters()]))
            catalogue = await conn.fetch(
                "SELECT column_name, is_nullable, column_default "
                "FROM information_schema.columns "
                "WHERE table_schema = 'staging' AND table_name = 'ganit_invoices'"
            )
            return failures, described, [dict(r) for r in catalogue]
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    """Captured statements, described once for the whole file. Connects ONCE."""
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    calls = _captured_calls()
    try:
        return _describe(calls)
    except Exception as exc:                                  # noqa: BLE001
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


def test_every_statement_the_conversion_issues_plans_on_the_real_schema(live):
    """UndefinedColumn / UndefinedTable means the statement has never worked.
    IndeterminateDatatype means a `$n` with no cast, which PgBouncer turns into
    an instant 500 — the failure this repo has shipped six times."""
    failures, _, _ = live
    assert not failures, "\n\n".join(f"{err}\n{sql}" for sql, err in failures)


def test_every_statement_binds_as_many_arguments_as_it_declares(live):
    """Postgres counts the placeholders; the code counts the arguments. An
    INSERT whose placeholder list was extended by hand is exactly where the two
    part company, and no offline check can see it."""
    _, described, _ = live
    wrong = [(sql, len(params), len(args))
             for sql, args, params in described if len(params) != len(args)]
    assert not wrong, "\n\n".join(
        f"declares {declared} parameters but binds {bound}\n{sql}"
        for sql, declared, bound in wrong)


def test_the_new_place_of_supply_parameter_is_typed_text_by_the_server(live):
    """THE ONE THE OFFLINE HALF CANNOT ANSWER.

    `$16` sits sixth in the VALUES list and sixteenth in the argument list, so
    the server's own inference is the only proof it lands on
    `place_of_supply` — a `text` column — rather than on a neighbour. An
    argument that reached a `uuid` or a `boolean` here would be a 500 on every
    call, which is how this repo's signature failure presents.
    """
    _, described, _ = live
    inserts = [(sql, args, params) for sql, args, params in described
               if INVOICE_INSERT in sql]
    assert len(inserts) == 1, f"expected one invoice INSERT, described {len(inserts)}"
    sql, args, params = inserts[0]
    cols, vals = _column_list(sql), _value_list(sql)
    idx = int(re.search(r"\$(\d+)", vals[cols.index("place_of_supply")]).group(1))
    assert params[idx - 1] == "text", (
        f"the server infers ${idx} as {params[idx - 1]!r}, not text — it is "
        f"not landing on place_of_supply")
    # BOTH halves are needed, and a swap proves it: pointing the placeholder at
    # a neighbouring column keeps SOME parameter typed text while the value
    # bound to it is no longer the place of supply.
    assert isinstance(args[idx - 1], str), (
        f"${idx} is typed text but the argument bound to it is "
        f"{args[idx - 1]!r} — the placeholder and the argument list have "
        f"parted company")


def test_every_column_named_exists_and_every_required_one_is_supplied(live):
    """The half `prepare()` cannot do.

    A statement that omits a NOT NULL column plans perfectly — the violation is
    a runtime constraint, not a parse error. Read from the catalogue rather
    than from the migration ledger: migrations are applied by hand here and the
    ledger has been wrong before.
    """
    _, described, catalogue = live
    known = {c["column_name"] for c in catalogue}
    required = {c["column_name"] for c in catalogue
                if c["is_nullable"] == "NO" and c["column_default"] is None}
    assert "invoice_number" in required, (
        "the premise changed: invoice_number is no longer NOT NULL-without-"
        "default on staging.ganit_invoices")

    seen = 0
    for sql, _, _ in described:
        if INVOICE_INSERT not in sql:
            continue
        seen += 1
        cols = set(_column_list(sql))
        assert not (cols - known), (
            f"names columns staging.ganit_invoices does not have: "
            f"{sorted(cols - known)}")
        assert not (required - cols), (
            f"omits NOT NULL columns with no default: {sorted(required - cols)}")
    assert seen == 1, f"expected the invoice INSERT, described {seen}"


def test_place_of_supply_still_defaults_to_blank_on_the_live_table(live):
    """The premise of the whole finding, read from the catalogue rather than
    from a migration file. If the column ever gains a NOT NULL or a real
    default, this file's reasoning needs revisiting rather than quietly
    continuing to pass."""
    _, _, catalogue = live
    col = next(c for c in catalogue if c["column_name"] == "place_of_supply")
    assert col["column_default"] == "''::text"
    assert col["is_nullable"] == "YES"


def test_the_router_file_is_the_one_under_test(live):
    """A guard on the guard: the live half must be describing THIS router's
    statements and not an empty list."""
    _, described, _ = live
    assert len(described) >= 5, (
        f"only {len(described)} statements described — the capture stopped "
        f"reaching the conversion path")
    assert pathlib.Path(vikray.__file__).name == "vikray.py"
