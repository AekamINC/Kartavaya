"""
The wiring between the console and `services/billing_lines.py` — proved by
calling the handlers, not by importing the module.

WHY THIS FILE EXISTS, IN ONE SENTENCE: `services/billing_lines.py` was missing
from the tree while `python -c "import server"` and all 2533 tests passed, and
every org creation on the deploy 500'd.

`routers/admin_orgs.py:_billing_lines()` does `from services import billing_lines`
INSIDE the function. That is a deliberate and correct choice — a deployment
without the billing service still serves members, modules, R2 and the cost
console — but it moves the import from collection time to request time, which is
the one place no import check and no green suite can see it. The module can be
absent, or renamed, or raise on import, and the only thing that ever finds out
is a client creating an organisation.

WHAT THAT COST, so the shape of these tests is not mistaken for paranoia. In
`create_org` the `organisations` INSERT, the R2 bucket and the `subscriptions`
row are all committed BEFORE the block that calls `_billing_lines()`. An
ImportError there leaves an ORPHAN ORG — no owner role, no wallet, no allowance,
a live R2 bucket — and returns a 500 that reads like a transient fault, so the
operator retries and makes a second one.

WHAT IS PINNED HERE

1. THE SCAN. Every module named in a call-time import anywhere in `routers/`
   resolves. Written as a WALK OF THE AST, not as a list of the three call sites
   that broke — a list would have to be edited by the same person who forgot the
   module, and the next lazy import to go missing will be one nobody thought to
   add. This is the whole lesson of the round.

2. THE THREE CALL SITES, THROUGH THE REAL HANDLERS. `POST /v1/admin/orgs`,
   `PATCH /v1/admin/orgs/{id}/settings` carrying `monthly_price`, and
   `POST /v1/admin/orgs/{id}/credits/topup` with the tick on. A call-time import
   cannot be proved by an import check; it is proved by making the call.

3. AMEND, NEVER STACK. The settings PATCH runs the REAL `sync_platform_line`
   against `_Table` below, so the property under test is the service's, not a
   stub's. Two open platform lines in one month is a double charge of the
   platform fee that `uq_obl_open_platform` cannot refuse once the first is
   closed — see the docstring on `sync_platform_line`.

4. THE NO-DOUBLE-CHARGE RULE. The real `record_billed` against the real
   `uq_ibl_line_period`, as `_Table` models it.

STYLE. Hand-written fakes over SQL substrings, per the house convention that
`tests/test_billing_lines.py` and `tests/test_credit_model.py` already set.
`_Table` enforces what Postgres enforces — both unique indexes and the org
foreign key — because a fake that lets a duplicate through would pass a test the
database would fail, which is the failure mode this whole round is about.

MIGRATION 096 IS NOT APPLIED. Nothing here touches a database; `_Table` is the
schema as 096 declares it, and `tests/test_billing_lines.py` separately pins
that declaration against the SQL file.
"""
import ast
import importlib.util
import json
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

import routers.admin_orgs as admin_orgs
from services.credits import CREDIT_PRICE_INR, current_period


def _BL():
    """`services/billing_lines.py`, imported when a test needs it.

    NOT at module scope, and the reason is this file's own subject. Section 5
    calls `record_billed` directly, so an `import services.billing_lines` at the
    top would make THIS FILE fail to collect when the module is missing — the
    scan in section 1 and the three handler tests would never run, and the
    output would be a collection error naming a traceback instead of the
    sentence that says an org creation is about to 500.

    A test that diagnoses a missing module must not require that module in order
    to speak. Verified by running this file under a meta-path finder that hides
    `services.billing_lines`: sections 1–4 still run and still name the defect.
    """
    import services.billing_lines as BL
    return BL

ORG = "11111111-1111-1111-1111-111111111111"
OWNER = "user_owner"
TEAM = "team-1"
PLAN = "plan-1"
IDEM = "7f0d4a26-0b1e-4f3a-9c55-2b6d9e0a1c34"

ROUTERS_DIR = Path(__file__).resolve().parents[1] / "routers"


# ════════════════════════════════════════════════════════════════════════════
# 1. THE SCAN
#
# The defect that started this round, expressed as the check that would have
# caught it — and would catch the next one, which will not be this module.
# ════════════════════════════════════════════════════════════════════════════

def _guarded(tree) -> set[int]:
    """Imports written inside `try: … except ImportError:`.

    THE DISTINCTION THIS SCAN TURNS ON. `routers/scheduler.py` lazily imports
    seven `services.skills.*` modules that genuinely do not exist, and that is
    not a bug — each sits in a `try` whose handler answers
    `{"error": "invoice_skills not available yet"}`. The author wrote down that
    the module is optional and said what happens when it is absent.

    `admin_orgs._billing_lines()` has no such handler. The import runs bare
    inside a request that has already committed the organisation, so a missing
    module is a 500 and an orphan org. Flagging both kinds identically would
    make this test 17 failures loud on day one and it would be silenced, which
    is the same as not having written it.

    So: guarded is a DECLARED optional dependency; unguarded is a promise the
    module is there.
    """
    out: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Try):
            continue
        catches = any(
            h.type is not None
            and any(
                getattr(n, "id", None) in ("ImportError", "ModuleNotFoundError")
                for n in ast.walk(h.type)
            )
            for h in node.handlers
        )
        if not catches:
            continue
        for stmt in node.body:
            for inner in ast.walk(stmt):
                if isinstance(inner, (ast.Import, ast.ImportFrom)):
                    out.add(id(inner))
    return out


def _call_time_imports() -> list[tuple[str, int, str]]:
    """Every module imported INSIDE a function body anywhere in `routers/`,
    except the ones declared optional — see `_guarded`.

    A module-level import is already proved by `import server`: the app will not
    boot without it, so a missing one is caught by the first test that runs. A
    call-time import is proved by NOTHING until the request is served, which is
    why this walk exists and why it is a walk.

    Returns `(file, lineno, module)`, absolute dotted names only. A relative
    import (`from . import x`) is skipped rather than guessed at — `routers/` has
    none today, and resolving one properly means reproducing importlib's parent
    logic, which is worth doing when it earns its keep and not before.
    """
    found: list[tuple[str, int, str]] = []
    for path in sorted(ROUTERS_DIR.glob("*.py")):
        # `utf-8-sig`, not `utf-8`: routers/reports.py is saved with a BOM.
        # Python's own loader strips it, so the module imports fine — but
        # `read_text("utf-8")` hands the U+FEFF to `ast.parse`, which rejects it
        # as a non-printable character. Reading it the way the interpreter does
        # is the fix; "the scan cannot parse a file the app imports happily" is
        # a bug in the scan.
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        optional = _guarded(tree)
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            # `ast.walk` from the function reaches imports at any depth inside
            # it — inside an `if`, inside a nested helper. All of them are
            # call-time.
            for inner in ast.walk(node):
                if id(inner) in optional:
                    continue
                if isinstance(inner, ast.Import):
                    for alias in inner.names:
                        found.append((path.name, inner.lineno, alias.name))
                elif isinstance(inner, ast.ImportFrom):
                    if inner.level:                      # relative — see above
                        continue
                    if inner.module:
                        # `from services import billing_lines` names the PACKAGE
                        # in `.module` and the thing that was actually missing in
                        # `.names`. Both are checked: the package existing is not
                        # evidence the submodule does, and that exact distinction
                        # is what shipped the 500.
                        found.append((path.name, inner.lineno, inner.module))
                        for alias in inner.names:
                            found.append(
                                (path.name, inner.lineno,
                                 f"{inner.module}.{alias.name}")
                            )
    return found


CALL_TIME_IMPORTS = _call_time_imports()


def test_the_scan_finds_the_lazy_import_this_round_was_about():
    """The scan is only worth anything if it looks where the defect was.

    Without this, a walk that silently found nothing — a bad glob, an ast API
    change, a `routers/` that moved — would pass every parametrised case below
    by having no cases at all, and this file would go green while checking
    nothing. That is the same class of bug as the one it is here to catch.
    """
    assert CALL_TIME_IMPORTS, "the scan found no call-time imports at all"
    assert any(
        f == "admin_orgs.py" and m == "services.billing_lines"
        for f, _, m in CALL_TIME_IMPORTS
    ), (
        "the scan no longer sees `from services import billing_lines` in "
        "admin_orgs.py — either the lazy import moved and this walk needs to "
        "follow it, or the walk is broken and is proving nothing"
    )


def test_an_import_declared_optional_is_not_reported_as_missing():
    """The other half of the scan's judgement, pinned.

    `routers/scheduler.py` lazily imports `services.skills.invoice_skills`,
    which does not exist, inside a `try` that answers "not available yet". That
    is a declared optional dependency and must not be a failure — a scan that
    cried wolf seventeen times on the day it was written would be deleted before
    it ever caught the one that matters.
    """
    reported = {(f, m) for f, _, m in CALL_TIME_IMPORTS}
    assert ("scheduler.py", "services.skills.invoice_skills") not in reported, (
        "the guarded-import exemption stopped working; this scan is about to "
        "fail for every optional feature in the product"
    )


@pytest.mark.parametrize(
    "file,lineno,module",
    CALL_TIME_IMPORTS,
    ids=[f"{f}:{n}:{m}" for f, n, m in CALL_TIME_IMPORTS],
)
def test_every_module_imported_at_call_time_inside_routers_exists(file, lineno, module):
    """`find_spec`, not `import_module`.

    Importing would execute the module, and a router that lazily imports
    something with a side effect at import time would get that side effect run
    once per parametrised case. `find_spec` answers the only question that
    matters here — can the interpreter FIND this when the request arrives — and
    that is precisely what was false.

    A submodule is checked by locating its parent and looking for the name on
    it: `find_spec("services.billing_lines")` is the real check, and for
    `from services import current_period` — a NAME, not a module — the parent
    resolving is all that can be asked, so a plain attribute is not a failure.
    """
    head, _, tail = module.rpartition(".")
    try:
        spec = importlib.util.find_spec(module)
    except ModuleNotFoundError:
        spec = None
    except ImportError:
        # The parent package exists but importing it to search failed. That is
        # its own bug and not this one; the parent's own case will report it.
        return
    if spec is not None:
        return

    if head:
        # Not a module. It is legal only if it is an attribute of a package that
        # DOES resolve — `from services import current_period`.
        try:
            parent = importlib.import_module(head)
        except ImportError:
            parent = None
        if parent is not None and hasattr(parent, tail):
            return

    pytest.fail(
        f"routers/{file}:{lineno} imports '{module}' at call time and it does "
        f"not exist. Nothing catches this before a request does: the import "
        f"runs inside the handler, so `import server`, `npm run check` and the "
        f"whole pytest suite all pass while the endpoint 500s. This is the "
        f"defect that shipped `services/billing_lines.py` missing."
    )


# ════════════════════════════════════════════════════════════════════════════
# THE TABLE
#
# `staging.org_billing_lines` and `staging.invoice_billing_lines` as migration
# 096 declares them, in memory, with both unique indexes enforced.
# ════════════════════════════════════════════════════════════════════════════

class _Unique(Exception):
    """A 23505. `billing_lines._is_unique_violation` matches on `sqlstate`
    rather than on the class precisely so a double like this behaves the way
    asyncpg does — see its docstring."""

    def __init__(self, constraint: str):
        super().__init__(f"duplicate key value violates unique constraint "
                         f"\"{constraint}\"")
        self.sqlstate = "23505"
        self.constraint_name = constraint


class _Txn:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _Table:
    """The two billing tables, and the organisations rows the writers check.

    Every constraint modelled here is one migration 096 actually creates. The
    two that carry the money rules:

      uq_obl_open_platform  at most ONE open `platform` line per org
      uq_obl_source_ref     at most one line per `source_ref`
      uq_ibl_line_period    at most one (line, period) in invoice_billing_lines
                            — the index 096 itself calls THE NO-DOUBLE-CHARGE
                            RULE

    Enforced here rather than assumed because a fake that lets a duplicate
    through passes a test Postgres would fail, and this file exists to stop
    exactly that kind of false green.
    """

    def __init__(self, orgs=(ORG,)):
        self.orgs = set(orgs)
        self.lines: list[dict] = []
        self.billed: list[dict] = []
        self.invoices: dict[str, str] = {}
        self.closed = False

    # ── the connection interface the service uses ───────────────────────────

    def transaction(self):
        return _Txn()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def fetchval(self, sql, *args):
        if "FROM staging.organisations" in sql:
            return args[0] if str(args[0]) in self.orgs else None
        if "staging.user_roles" in sql:
            return 1
        if "RETURNING id" in sql and "UPDATE staging.organisations" in sql:
            return args[-1] if str(args[-1]) in self.orgs else None
        return None

    async def fetchrow(self, sql, *args):
        if "INSERT INTO staging.org_billing_lines" in sql:
            return self._insert(*args)
        if "UPDATE staging.org_billing_lines" in sql and "SET amount=" in sql:
            return self._amend(args[0], args[1])
        if "UPDATE staging.org_billing_lines" in sql and "SET period_end=" in sql:
            return self._end(args[2], args[0], args[1])
        # Checked BEFORE the open-line arm: `create_line` looks a top-up up by
        # `source_ref` alone, with ONE argument, and routing that to the
        # two-argument open-line read is an IndexError rather than a wrong
        # answer — which is how this fake told on itself.
        if "WHERE source_ref=$1" in sql:
            return next((r for r in self.lines if r["source_ref"] == args[0]), None)
        if "FROM staging.org_billing_lines" in sql:
            return self._open_line(args[0], args[1])
        return None

    async def fetch(self, sql, *args):
        if "FROM staging.invoice_billing_lines" in sql:
            return self._clash(args[0], args[1])
        if "INSERT INTO staging.invoice_billing_lines" in sql:
            # `$5` is the per-line amounts array and is the LAST parameter; it is
            # passed positionally so the fake breaks loudly if the statement ever
            # stops sending it, rather than silently falling back to the line.
            return self._record(args[0], args[1], args[2], args[3],
                                args[4] if len(args) > 4 else None)
        return []

    async def execute(self, sql, *args):
        # THE ORG BECOMES REAL ON THIS CONNECTION, not on the pool.
        #
        # `create_org` now does every write inside ONE `pool.acquire()` /
        # `conn.transaction()` block, so the organisations INSERT arrives here
        # and not at `mock_pool.execute`. In Postgres the `_assert_org` SELECT
        # that `sync_platform_line` runs a few statements later sees that row —
        # it is the same transaction — and a fake that did not register it
        # answered 404 `unknown_org` for an org the handler had just written.
        # That is the double reporting a bug the product does not have, which
        # is the one failure mode a double must not have: it sends whoever
        # reads it to fix code that is already right.
        if "INSERT INTO staging.organisations" in sql:
            self.orgs.add(str(args[0]))
        return "UPDATE 1"

    # ── the rows ────────────────────────────────────────────────────────────

    def _insert(self, org_id, kind, description, amount, currency, cadence,
                period_start, period_end, source_ref, created_by):
        if source_ref is not None:
            if any(r["source_ref"] == source_ref for r in self.lines):
                raise _Unique("uq_obl_source_ref")
        if kind == "platform" and cadence == "monthly" and period_end is None:
            if any(r["org_id"] == org_id and r["kind"] == "platform"
                   and r["cadence"] == "monthly" and r["period_end"] is None
                   for r in self.lines):
                raise _Unique("uq_obl_open_platform")
        now = datetime.now(timezone.utc)
        row = {
            "id": str(uuid.uuid4()), "org_id": org_id, "kind": kind,
            "description": description, "amount": amount,
            "currency": currency, "cadence": cadence,
            "period_start": period_start, "period_end": period_end,
            "source_ref": source_ref, "created_by": created_by,
            "ended_by": None, "created_at": now, "updated_at": now,
        }
        self.lines.append(row)
        return row

    def _open_line(self, org_id, kind):
        rows = [r for r in self.lines
                if r["org_id"] == org_id and r["kind"] == kind
                and r["cadence"] == "monthly" and r["period_end"] is None]
        rows.sort(key=lambda r: (r["period_start"], r["created_at"]))
        return rows[0] if rows else None

    def _amend(self, amount, line_id):
        for r in self.lines:
            if r["id"] == str(line_id):
                r["amount"] = amount
                r["updated_at"] = datetime.now(timezone.utc)
                return r
        return None

    def _end(self, line_id, ends_on, actor):
        for r in self.lines:
            # `AND period_end IS NULL` in the real UPDATE: ending an already
            # ended line matches nothing rather than moving the date.
            if r["id"] == str(line_id) and r["period_end"] is None:
                r["period_end"] = ends_on
                r["ended_by"] = actor
                return r
        return None

    def _clash(self, ids, period):
        out = []
        for b in self.billed:
            if b["line_id"] in {str(i) for i in ids} and b["period_start"] == period:
                line = next(r for r in self.lines if r["id"] == b["line_id"])
                out.append({
                    "line_id": b["line_id"],
                    "description": line["description"],
                    "invoice_number": self.invoices.get(b["invoice_id"], "INV-?"),
                })
        return out

    def _record(self, invoice_id, ids, period, org_id, charged=None):
        # `COALESCE(v.amount, l.amount)` in the real statement, where `v` is
        # `unnest($2::uuid[], $5::numeric[])` — the ids and what THIS INVOICE
        # charged for each, as positional halves of one list. Modelled rather
        # than ignored because ignoring it would have this fake record the
        # line's standing amount for an edited row and report green while the
        # document and the row that proves what was charged disagreed.
        charged = list(charged or [])
        charged += [None] * (len(ids) - len(charged))
        out = []
        for i, override in zip(ids, charged):
            line = next((r for r in self.lines
                         if r["id"] == str(i) and r["org_id"] == str(org_id)), None)
            if line is None:
                # The real statement is an INSERT … SELECT: an id that is not
                # this org's line simply matches nothing, and `record_billed`
                # notices by counting.
                continue
            if any(b["line_id"] == line["id"] and b["period_start"] == period
                   for b in self.billed):
                raise _Unique("uq_ibl_line_period")
            rec = {"invoice_id": str(invoice_id), "line_id": line["id"],
                   "period_start": period,
                   "amount": line["amount"] if override is None else override}
            self.billed.append(rec)
            out.append(rec)
        return out

    # ── what the tests ask it ───────────────────────────────────────────────

    def open_platform_lines(self, org_id=ORG):
        return [r for r in self.lines
                if r["org_id"] == org_id and r["kind"] == "platform"
                and r["period_end"] is None]

    def of_kind(self, kind, org_id=ORG):
        return [r for r in self.lines
                if r["org_id"] == org_id and r["kind"] == kind]


@pytest.fixture
def table():
    return _Table()


# ════════════════════════════════════════════════════════════════════════════
# 2. ORG CREATION — call site admin_orgs.py:356
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def create_org(monkeypatch, mock_pool, table):
    """`POST /v1/admin/orgs` with the credit writers stubbed and the billing
    line REAL.

    `grant` and `balance_of` are stubbed because `services/credits.py` is the
    only file allowed to name the credit tables and is proved by
    tests/test_credit_model.py; what is under test here is that the handler
    reaches `sync_platform_line` at all and that it writes one line.
    """
    granted: list[dict] = []

    async def _grant(conn, **kw):
        granted.append(kw)
        return None

    async def _balance_of(conn, org_id, **kw):
        return None

    monkeypatch.setattr(admin_orgs, "grant", _grant)
    monkeypatch.setattr(admin_orgs, "balance_of", _balance_of)

    async def _fetchrow(sql, *args):
        if "FROM users WHERE LOWER(email)" in sql:
            return {"user_id": OWNER, "email": "owner@example.com"}
        if "FROM team_members" in sql:
            return {"team_id": TEAM}
        if "FROM staging.organisations WHERE team_id" in sql:
            return None                                   # no org for this team
        if "FROM staging.plans" in sql:
            return {"id": PLAN, "code": "professional", "default_credits": 0}
        return None

    async def _fetchval(sql, *args):
        # `as_admin` routes this for the platform-role check; this fixture is
        # ordered after it, so the role must be answered here too or every
        # commercial field on the body 403s.
        if "staging.user_roles" in sql:
            return 1
        return 0

    mock_pool.fetchrow.side_effect = _fetchrow
    mock_pool.fetchval.side_effect = _fetchval

    async def _execute(sql, *args):
        # NOTHING `create_org` writes comes through the pool any more — the org
        # row, the subscription, the owner role and the audit event are all on
        # the acquired connection, inside one transaction, which is the whole
        # point of the rewrite. `_Table.execute` is where the org INSERT is
        # registered; this stays so that a stray pool write is a visible
        # "INSERT 1" rather than an AsyncMock returning a coroutine nobody
        # awaited.
        return "INSERT 1"

    mock_pool.execute.side_effect = _execute
    mock_pool.acquire.return_value = table
    return table, granted


ORGS_URL = "/api/v1/admin/orgs"


def _org_body(**over):
    body = {
        "name": "Sharma & Associates",
        "owner_email": "owner@example.com",
        "plan_code": "professional",
        "monthly_price": 25000,
    }
    body.update(over)
    return body


async def test_creating_an_org_succeeds_rather_than_500ing(
    api_client, mock_pool, as_admin, create_org,
):
    """The headline regression.

    When `services/billing_lines.py` was missing this returned 500 — AFTER the
    organisations INSERT, the R2 bucket and the subscriptions row had committed.
    The org existed with no owner role, no wallet and no allowance, and the
    operator retried into a second one.
    """
    resp = await api_client.post(ORGS_URL, json=_org_body())
    assert resp.status_code in (200, 201), resp.text


async def test_creating_an_org_creates_exactly_one_platform_line(
    api_client, mock_pool, as_admin, create_org,
):
    table, _ = create_org
    resp = await api_client.post(ORGS_URL, json=_org_body(monthly_price=25000))
    assert resp.status_code in (200, 201), resp.text

    lines = table.of_kind("platform", org_id=list(table.orgs - {ORG})[0])
    assert len(lines) == 1, f"expected one platform line, got {len(lines)}"
    line = lines[0]
    assert float(line["amount"]) == 25000
    assert line["cadence"] == "monthly"
    assert line["period_end"] is None, "a new org's platform line is open"
    # Starts THIS month and is never backdated: backdating would make every past
    # month billable by the due query, and an operator loading lines for June
    # would raise an invoice for a fee collected some other way.
    assert line["period_start"] == current_period()
    assert line["created_by"] is not None, (
        "every money row names the operator who caused it"
    )


async def test_a_free_org_gets_no_zero_rupee_platform_line(
    api_client, mock_pool, as_admin, create_org,
):
    """An org on a free plan is not billed a ₹0 platform fee every month, and a
    ₹0 row on an invoice is a line the client has to read and then ignore."""
    table, _ = create_org
    resp = await api_client.post(ORGS_URL, json=_org_body(monthly_price=0))
    assert resp.status_code in (200, 201), resp.text
    assert table.lines == [], "a zero fee wrote a billing line"


# ── 2b. THE TWO WAYS THE ORPHAN CAME BACK ───────────────────────────────────
#
# Both of these were live defects and NEITHER is visible to `pytest -q` as it
# was, to `import server`, or to any check the frontend runs — which is exactly
# how both of them shipped. They are driven through the REAL handler because the
# thing under test is the ORDER of its writes, and an order is not something a
# unit test of any one of them can see.


class _NoSuchTable(Exception):
    """A 42P01 — `staging.org_billing_lines` does not exist.

    THE STATE THE DATABASE IS IN RIGHT NOW. `096_billing_lines.sql` is written,
    reviewed and NOT APPLIED, so every deploy of the billing-lines code before
    that migration lands answers every read of the table this way. Shaped by
    `sqlstate` rather than by class for the reason `_Unique` is: both
    `billing_lines._is_unique_violation` and `admin_orgs._billing_schema_missing`
    match on the code, so a double that carries it behaves as asyncpg does.
    """

    def __init__(self):
        super().__init__('relation "staging.org_billing_lines" does not exist')
        self.sqlstate = "42P01"


class _PreO96Table(_Table):
    """`_Table` with the billing table taken away and the org rows left.

    Only the billing reads and writes raise; `staging.organisations` answers
    normally, because that table exists. That distinction is the whole test:
    `sync_platform_line` runs `_assert_org` and `_money` BEFORE it ever looks at
    a billing line, so a fake that failed everything would pass this test for
    the wrong reason.
    """

    def _boom(self, sql):
        return "staging.org_billing_lines" in sql

    async def fetchval(self, sql, *args):
        if self._boom(sql):
            raise _NoSuchTable()
        return await super().fetchval(sql, *args)

    async def fetchrow(self, sql, *args):
        if self._boom(sql):
            raise _NoSuchTable()
        return await super().fetchrow(sql, *args)

    async def fetch(self, sql, *args):
        if self._boom(sql):
            raise _NoSuchTable()
        return await super().fetch(sql, *args)


@pytest.fixture
def create_org_pre_096(create_org, mock_pool):
    """The same handler, against a database that is one migration behind."""
    table, granted = create_org
    pre = _PreO96Table(orgs=table.orgs)
    mock_pool.acquire.return_value = pre
    return pre, granted


async def test_creating_an_org_before_096_succeeds_with_no_line(
    api_client, mock_pool, as_admin, create_org_pre_096,
):
    """PRE-096, A ₹25,000 ORG IS STILL CREATED — it just has no line yet.

    `sync_platform_line` reaches `_open_line_of_kind` before its `if fee == 0`
    return, so pre-096 EVERY call raises 42P01 — including a free org at ₹0.
    Uncaught, that 500'd every org creation on the deploy, after the org row and
    the subscription had already committed and the bucket had been created.

    The degrade is safe only because the gap repairs itself: 096 §4 backfills a
    platform line for every org with `monthly_price > 0` that has none, and
    saving the fee again through PATCH /settings creates what is absent. Neither
    is true of a top-up nobody billed, which is why THAT call site refuses.
    """
    table, _ = create_org_pre_096
    resp = await api_client.post(ORGS_URL, json=_org_body(monthly_price=25000))

    assert resp.status_code in (200, 201), resp.text
    assert table.lines == [], "the table does not exist; nothing can be in it"


async def test_the_pre_096_org_is_whole_and_says_its_line_is_missing(
    api_client, mock_pool, as_admin, create_org_pre_096,
):
    """AND IT IS NOT AN ORPHAN. The 42P01 is caught at a SAVEPOINT, so the
    statement that failed is rolled back to just before the call and the outer
    transaction lives — the org, the subscription, the wallet, the allowance and
    the OWNER ROLE all commit. Without the savepoint the caught error would poison
    the transaction (25P02 on every later statement, COMMIT rolling back) and the
    catch meant to prevent the orphan would create it.

    The audit row carries `billing_schema_pending`, which is what tells a ₹0 free
    org — correctly lineless — apart from a ₹25,000 client about to be
    under-invoiced. The two are the same absent line and only one is a problem.
    """
    table, granted = create_org_pre_096
    events: list[dict] = []
    seen: list[str] = []

    async def _execute(sql, *args):
        seen.append(sql)
        if "INSERT INTO staging.subscription_events" in sql:
            events.append(json.loads(args[2]))
        return await _PreO96Table.execute(table, sql, *args)

    table.execute = _execute

    # `monthly_credits` explicitly, because the fixture's plan defaults to 0 and
    # a grant that never had a reason to run proves nothing about surviving the
    # 42P01 that runs after it.
    resp = await api_client.post(ORGS_URL, json=_org_body(
        monthly_price=25000, monthly_credits=500,
    ))
    assert resp.status_code in (200, 201), resp.text

    assert any("INSERT INTO staging.organisations" in s for s in seen)
    assert any("INSERT INTO staging.subscriptions" in s for s in seen)
    assert any("INSERT INTO staging.user_roles" in s for s in seen), (
        "the owner role was the write most often lost to this 500; an org whose "
        "owner cannot open it is the orphan in its purest form"
    )
    assert [g["credits"] for g in granted] == [500], (
        "the monthly allowance is granted in the same transaction, and the "
        "42P01 that follows it must not roll it back"
    )

    assert events and events[0]["billing_schema_pending"] is True, (
        "a fee that reached no billing line has to be written down where it is "
        "searchable, not only in the logs"
    )
    assert events[0]["platform_line"] is False


async def test_a_negative_monthly_price_is_refused_before_anything_is_written(
    api_client, mock_pool, as_admin, create_org, monkeypatch,
):
    """P1-A: THE SAME ORPHAN, REACHABLE AFTER 096.

    `OrgCreate.monthly_price` carries no bound. PATCH /settings refuses `< 0` at
    its own bounds check; POST /orgs used to refuse nothing, so a -1 committed
    the org, created the bucket, committed the subscription, and only THEN
    reached `_money` — which refuses a negative amount — and answered 400 over an
    org nobody owned and nobody could recreate.

    So the assertion is not that it is a 400. It is that the 400 arrives with
    NOTHING WRITTEN and NO BUCKET CREATED, which is the only version of the
    refusal that leaves the operator able to try again.
    """
    table, _ = create_org

    buckets: list[str] = []

    async def _bucket(org_id):
        buckets.append(org_id)
        return "kartavya-storage"

    monkeypatch.setattr(admin_orgs, "create_org_bucket", _bucket)

    written: list[str] = []

    async def _execute(sql, *args):
        written.append(sql)
        return await _Table.execute(table, sql, *args)

    table.execute = _execute

    resp = await api_client.post(ORGS_URL, json=_org_body(
        monthly_price=-1,
        r2={"account_id": "a", "access_key_id": "k",
            "secret_access_key": "s", "bucket_name": "b"},
    ))

    assert resp.status_code == 400, resp.text
    assert "monthly_price" in resp.text

    assert written == [], f"the refusal wrote {len(written)} row(s): {written}"
    assert table.lines == []
    assert buckets == [], (
        "the R2 bucket is the one write no rollback can reach; a refusal that "
        "creates one leaves a live bucket for an org that does not exist"
    )


# ════════════════════════════════════════════════════════════════════════════
# 3. THE SETTINGS PATCH — call site admin_orgs.py:930
#
# AMEND, NEVER STACK. Running the REAL `sync_platform_line`, so this is the
# service's property and not a stub's.
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def settings(mock_pool, table):
    async def _fetchval(sql, *args):
        if "staging.user_roles" in sql:
            return 1
        if "UPDATE staging.organisations" in sql and "RETURNING id" in sql:
            return ORG
        return 0

    async def _fetchrow(sql, *args):
        if "SELECT markup_pct" in sql:
            return {"markup_pct": 0.30, "monthly_credits": 0,
                    "monthly_price": 0, "max_users": None,
                    "is_platform_org": False}
        return None

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetchrow.side_effect = _fetchrow
    mock_pool.acquire.return_value = table
    return table


SETTINGS_URL = f"/api/v1/admin/orgs/{ORG}/settings"


async def test_a_settings_patch_carrying_monthly_price_does_not_500(
    api_client, mock_pool, as_admin, settings,
):
    resp = await api_client.patch(SETTINGS_URL, json={"monthly_price": 25000})
    assert resp.status_code == 200, resp.text


async def test_repricing_amends_the_platform_line_and_never_stacks_a_second(
    api_client, mock_pool, as_admin, settings,
):
    """Three amendments, one row.

    End-and-reopen is the tempting alternative and it is a DOUBLE CHARGE: the
    ended row still has `period_end >= period_start = this month`, so the due
    query returns both, and `uq_obl_open_platform` cannot refuse the second
    because the first is no longer open. An index watching a double charge it
    cannot see is worse than no index.
    """
    table = settings
    for price in (25000, 30000, 27500):
        resp = await api_client.patch(SETTINGS_URL, json={"monthly_price": price})
        assert resp.status_code == 200, resp.text

    assert len(table.lines) == 1, (
        f"three price changes wrote {len(table.lines)} platform lines; every "
        f"one of them is due in the same period, so this month's invoice "
        f"charges the platform fee {len(table.lines)} times"
    )
    assert float(table.lines[0]["amount"]) == 27500
    assert table.lines[0]["period_end"] is None


async def test_saving_the_same_price_twice_writes_nothing_at_all(
    api_client, mock_pool, as_admin, settings,
):
    """Not even `updated_at`, so the column goes on meaning "when this fee last
    changed" rather than "when somebody last pressed Save"."""
    table = settings
    await api_client.patch(SETTINGS_URL, json={"monthly_price": 25000})
    stamp = table.lines[0]["updated_at"]

    await api_client.patch(SETTINGS_URL, json={"monthly_price": 25000})
    assert len(table.lines) == 1
    assert table.lines[0]["updated_at"] == stamp, (
        "an idempotent save moved updated_at"
    )


async def test_dropping_the_fee_to_zero_ends_the_line_and_never_deletes_it(
    api_client, mock_pool, as_admin, settings,
):
    """`period_end` is the LAST period billed, inclusive. Ending today does not
    refund this month; it stops the next one. A DELETE would erase the evidence
    of what the client was charged while their invoice still says it."""
    table = settings
    await api_client.patch(SETTINGS_URL, json={"monthly_price": 25000})
    await api_client.patch(SETTINGS_URL, json={"monthly_price": 0})

    assert len(table.lines) == 1, "the line was deleted rather than ended"
    assert table.lines[0]["period_end"] == current_period()
    assert table.open_platform_lines() == []


async def test_a_fee_that_comes_back_after_zero_opens_one_line_not_two(
    api_client, mock_pool, as_admin, settings,
):
    """The path `uq_obl_open_platform` genuinely guards: the old line is closed,
    so the index permits the insert, and the only thing keeping the client off a
    double charge is that the closed one is not open."""
    table = settings
    for price in (25000, 0, 18000):
        resp = await api_client.patch(SETTINGS_URL, json={"monthly_price": price})
        assert resp.status_code == 200, resp.text

    open_lines = table.open_platform_lines()
    assert len(open_lines) == 1, f"{len(open_lines)} open platform lines"
    assert float(open_lines[0]["amount"]) == 18000


async def test_a_settings_patch_that_does_not_mention_price_leaves_lines_alone(
    api_client, mock_pool, as_admin, settings,
):
    table = settings
    resp = await api_client.patch(SETTINGS_URL, json={"max_users": 25})
    assert resp.status_code == 200, resp.text
    assert table.lines == [], "a seat change wrote a billing line"


# ════════════════════════════════════════════════════════════════════════════
# 4. THE TOP-UP TICK — call site admin_orgs.py:1788
#
# tests/test_billing_lines.py pins this handler against a hand-written double of
# the service. Here it runs the REAL `create_line`, so `uq_obl_source_ref` is
# doing the refusing rather than a fake that agrees to.
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def topup(monkeypatch, mock_pool, table):
    from services import credits as C

    async def _grant(conn, **kw):
        return C.Balance(
            org_id=ORG, allowance=0, purchased=100, total=100,
            period_start=current_period(), is_platform_org=False,
            monthly_credits=0,
        )

    monkeypatch.setattr(admin_orgs, "grant", _grant)

    async def _fetchval(sql, *args):
        if "staging.user_roles" in sql:
            return 1
        return 0

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.acquire.return_value = table
    return table


TOPUP_URL = f"/api/v1/admin/orgs/{ORG}/credits/topup"


async def test_a_ticked_topup_does_not_500_and_creates_exactly_one_one_off_line(
    api_client, mock_pool, as_admin, topup,
):
    table = topup
    resp = await api_client.post(TOPUP_URL, json={
        "amount": 100, "add_to_invoice": True, "idempotency_key": IDEM,
    })
    assert resp.status_code == 200, resp.text

    lines = table.of_kind("topup")
    assert len(lines) == 1, f"expected one top-up line, got {len(lines)}"
    line = lines[0]
    # A top-up is a fact about a payment, not a subscription: due in the month
    # it happened and never again.
    assert line["cadence"] == "one_off"
    assert line["period_start"] == current_period()
    assert line["period_end"] == current_period(), (
        "a one-off must be due in exactly one period"
    )
    # Rupees, not credits, priced from services/credits.py — the console does
    # not hold its own opinion of what a credit sells for.
    assert float(line["amount"]) == 100 * CREDIT_PRICE_INR


async def test_a_retried_topup_is_refused_by_the_index_not_by_the_handler(
    api_client, mock_pool, as_admin, topup,
):
    """The double-click, against the real `create_line` and the real unique
    index. One grant, one line, and the second request returns the line that
    already exists rather than a 500 that rolls the grant back."""
    table = topup
    payload = {"amount": 100, "add_to_invoice": True, "idempotency_key": IDEM}
    first = await api_client.post(TOPUP_URL, json=payload)
    second = await api_client.post(TOPUP_URL, json=payload)

    assert first.status_code == 200 and second.status_code == 200, second.text
    assert len(table.of_kind("topup")) == 1, (
        "a retried top-up billed the client twice for credits granted once"
    )
    assert second.json()["invoice_line"]["id"] == first.json()["invoice_line"]["id"]


# ════════════════════════════════════════════════════════════════════════════
# 5. THE NO-DOUBLE-CHARGE RULE
#
# `uq_ibl_line_period`, which guarded an empty table until `record_billed` had
# a caller: pressing "Load lines" for August twice raised the platform fee twice
# with nothing on the second invoice showing it duplicated the first.
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def one_line(table):
    row = table._insert(
        ORG, "platform", "Platform fee", 25000, "INR", "monthly",
        current_period(), None, None, "admin",
    )
    return table, row


async def test_a_line_is_recorded_as_billed_when_an_invoice_carries_it(one_line):
    table, row = one_line
    inv = str(uuid.uuid4())
    table.invoices[inv] = "INV-0001"

    recorded = await _BL().record_billed(
        table, invoice_id=inv, org_id=ORG,
        line_ids=[row["id"]], period=current_period(),
    )
    assert len(recorded) == 1
    assert recorded[0]["line_id"] == row["id"]
    # Denormalised AT ISSUE TIME: the line may be re-priced tomorrow, what this
    # client was charged may not change.
    assert recorded[0]["amount"] == 25000.0


async def test_the_same_line_cannot_be_billed_twice_for_the_same_period(one_line):
    """Two invoices, same line, same month. The second is REFUSED.

    This is "Load lines" for August pressed twice. Before `record_billed` had a
    caller the join table was never written, `already_billed` was forever `[]`,
    and the second invoice charged the platform fee again with nothing on it
    saying so.
    """
    table, row = one_line
    first, second = str(uuid.uuid4()), str(uuid.uuid4())
    table.invoices[first] = "INV-0001"
    table.invoices[second] = "INV-0002"

    await _BL().record_billed(table, invoice_id=first, org_id=ORG,
                           line_ids=[row["id"]], period=current_period())

    with pytest.raises(_BL().LineAlreadyBilled) as caught:
        await _BL().record_billed(table, invoice_id=second, org_id=ORG,
                               line_ids=[row["id"]], period=current_period())

    # A refusal that cannot say what is held is exactly what the money rules
    # forbid: it must name the invoice the line is already on.
    detail = caught.value.detail
    assert "INV-0001" in detail["message"], detail
    assert len(table.billed) == 1, "the refused call still wrote a join row"


async def test_the_refusal_happens_before_any_row_is_written(one_line):
    """Two lines, one already billed. NEITHER is recorded.

    Skipping the clash and writing the other would leave the client charged on
    `line_items` while the system believed the line unbilled — the double charge
    with the evidence removed.
    """
    table, row = one_line
    other = table._insert(ORG, "support", "Support plan", 8000, "INR",
                          "monthly", current_period(), None, None, "admin")
    first, second = str(uuid.uuid4()), str(uuid.uuid4())
    table.invoices[first] = "INV-0001"
    table.invoices[second] = "INV-0002"

    await _BL().record_billed(table, invoice_id=first, org_id=ORG,
                           line_ids=[row["id"]], period=current_period())
    before = len(table.billed)

    with pytest.raises(_BL().LineAlreadyBilled):
        await _BL().record_billed(
            table, invoice_id=second, org_id=ORG,
            line_ids=[row["id"], other["id"]], period=current_period(),
        )
    assert len(table.billed) == before, (
        "the unclashed line was recorded even though the call was refused"
    )


async def test_the_same_line_bills_again_in_the_NEXT_period(one_line):
    """A monthly line is SUPPOSED to bill every month. The rule is one line per
    line-and-period, not one line ever — a guard that blocked September would be
    silent forgiveness of a fee the client agreed to."""
    table, row = one_line
    august, september = date(2026, 8, 1), date(2026, 9, 1)
    for month, number in ((august, "INV-0001"), (september, "INV-0002")):
        inv = str(uuid.uuid4())
        table.invoices[inv] = number
        recorded = await _BL().record_billed(table, invoice_id=inv, org_id=ORG,
                                          line_ids=[row["id"]], period=month)
        assert len(recorded) == 1, f"{month:%B} was refused"
    assert len(table.billed) == 2


async def test_one_id_sent_twice_in_one_request_is_one_line(one_line):
    """A duplicated id in the payload would otherwise raise a unique violation
    against itself, inside the caller's transaction, taking the invoice with
    it."""
    table, row = one_line
    inv = str(uuid.uuid4())
    table.invoices[inv] = "INV-0001"
    recorded = await _BL().record_billed(
        table, invoice_id=inv, org_id=ORG,
        line_ids=[row["id"], row["id"]], period=current_period(),
    )
    assert len(recorded) == 1
    assert len(table.billed) == 1


async def test_a_line_belonging_to_another_org_is_refused_not_skipped(one_line):
    """An INSERT … SELECT that matches nothing writes nothing and returns
    success. The invoice would carry a charge no join row recorded."""
    table, _ = one_line
    stranger = _Table(orgs=("22222222-2222-2222-2222-222222222222",))._insert(
        "22222222-2222-2222-2222-222222222222", "platform", "Platform fee",
        9000, "INR", "monthly", current_period(), None, None, "admin",
    )
    table.lines.append(stranger)
    inv = str(uuid.uuid4())
    table.invoices[inv] = "INV-0001"

    with pytest.raises(_BL().UnknownLine):
        await _BL().record_billed(table, invoice_id=inv, org_id=ORG,
                               line_ids=[stranger["id"]], period=current_period())
    assert table.billed == []


# ── 5b. WHAT THE INVOICE CHARGED, NOT WHAT THE LINE SAYS ────────────────────
#
# `invoice_billing_lines.amount` is the system's only record of what a client
# was actually charged for a line in a month — 096: "the line's amount may
# change afterwards; what the client was charged may not". `record_billed` can
# only deliver that if the caller TELLS it, and for a round nobody did: the
# builder sent `line_items` and `line_ids` as two lists with nothing joining
# them, so `create_invoice` had no way to pair an amount with an id and the
# join row silently copied the line's standing amount.
#
# THROUGH `POST /v1/subscription/admin/invoices`, because the defect is in the
# PAIRING and a pairing is not something a direct call to `record_billed` can
# test — the direct call is handed the mapping that was the missing thing.

INVOICES_URL = "/api/v1/subscription/admin/invoices"


@pytest.fixture
def invoice(monkeypatch, mock_pool, one_line, app):
    """`POST /admin/invoices` over `_Table`, with the billing service REAL."""
    import routers.subscription as subscription
    from middleware.org_resolver import get_org_id

    table, row = one_line
    # The org the LINE belongs to. `get_org_id` resolves from the X-Org-Id
    # header against real membership rows; overridden rather than mocked so the
    # test is about the pairing and not about tenancy, which
    # tests/test_me_security.py owns.
    app.dependency_overrides[get_org_id] = lambda: ORG

    async def _payee(pool):
        # No UPI columns pre-096; the handler's own degrade. Nothing here is
        # about collection, and a payee read would need four more SQL arms.
        return {"upi_vpa": None, "upi_payee_name": None,
                "why_missing": "096_billing_lines.sql has not been applied."}

    monkeypatch.setattr(subscription, "_platform_payee", _payee)

    async def _fetchval(sql, *args):
        if "MAX(CAST(SUBSTRING(invoice_number" in sql:
            return 1
        if "staging.user_roles" in sql:
            return 1
        return None

    async def _fetchrow(sql, *args):
        if "INSERT INTO staging.subscription_invoices" in sql:
            return {"id": uuid.uuid4(), "invoice_number": args[1],
                    "total": args[7], "due_date": args[8],
                    "payment_status": "pending"}
        return None

    table.fetchval = _fetchval
    _real_fetchrow = table.fetchrow

    async def _row(sql, *args):
        if "staging.subscription_invoices" in sql:
            return await _fetchrow(sql, *args)
        return await _real_fetchrow(sql, *args)

    table.fetchrow = _row
    mock_pool.acquire.return_value = table
    mock_pool.fetchval.side_effect = _fetchval
    yield table, row
    app.dependency_overrides.pop(get_org_id, None)


def _invoice_body(row, amount, **over):
    period = current_period()
    body = {
        "period_start": period.isoformat(),
        "period_end": period.isoformat(),
        "due_date": period.isoformat(),
        "line_items": [{
            "description": "Platform fee", "amount": amount,
            "qty": 1, "unit_amount": amount,
            # The field that makes the pairing possible. `InvoiceBuilder.jsx`
            # puts it on every entry that came from a line and on no other.
            "line_id": row["id"],
        }],
        "line_ids": [row["id"]],
    }
    body.update(over)
    return body


async def test_an_edited_row_books_what_the_invoice_charged_not_what_the_line_says(
    api_client, mock_pool, as_admin, invoice,
):
    """The operator edited a loaded row before pressing Create.

    The line stands at ₹25,000; this document charges ₹30,000. The join row must
    say ₹30,000 — it is the record of what the CLIENT WAS CHARGED, and the client
    was charged what the document says. A join row that copied the line would
    leave the only machine-readable account of the month disagreeing with the
    paper the client is holding, and `already_billed` would report the wrong
    figure to the next operator who loaded the month.
    """
    table, row = invoice
    resp = await api_client.post(INVOICES_URL, json=_invoice_body(row, 30000))

    assert resp.status_code in (200, 201), resp.text
    assert len(table.billed) == 1
    assert float(table.billed[0]["amount"]) == 30000.0, (
        "the join row recorded the line's standing amount instead of what this "
        "invoice charged"
    )


async def test_qty_folded_into_the_amount_reaches_the_join_row(
    api_client, mock_pool, as_admin, invoice,
):
    """AND IT HAPPENS WITHOUT ANYBODY TYPING A RUPEE FIGURE.

    `InvoiceBuilder.jsx` folds `qty` into `amount` before sending, because the
    column the server sums is `item.amount`. So a support plan loaded once and
    billed ×2 for a missed month charges double while the line is untouched —
    the disagreement arrives through a quantity box, which is why "only an
    edited amount is affected" was the wrong reading of this gap.
    """
    table, row = invoice
    body = _invoice_body(row, 50000)
    body["line_items"][0].update(qty=2, unit_amount=25000)

    resp = await api_client.post(INVOICES_URL, json=body)
    assert resp.status_code in (200, 201), resp.text
    assert float(table.billed[0]["amount"]) == 50000.0


async def test_an_untouched_row_still_books_the_line_amount(
    api_client, mock_pool, as_admin, invoice,
):
    """The fallback is not a leftover. A row nobody edited charges what the line
    says, and the mapping saying so changes nothing — which is what makes it safe
    to send on every invoice rather than only on the ones that were edited."""
    table, row = invoice
    resp = await api_client.post(INVOICES_URL, json=_invoice_body(row, 25000))
    assert resp.status_code in (200, 201), resp.text
    assert float(table.billed[0]["amount"]) == 25000.0


async def test_a_hand_typed_row_contributes_no_pairing(
    api_client, mock_pool, as_admin, invoice,
):
    """A typed row has no `line_id`: it discharges nothing and must not be able
    to steer what a line was booked at. It still reaches `line_items` and the
    client still pays for it — the totals are summed from the same list."""
    table, row = invoice
    body = _invoice_body(row, 25000)
    body["line_items"].append({
        "description": "One-off consulting", "amount": 7000,
        "qty": 1, "unit_amount": 7000,
    })

    resp = await api_client.post(INVOICES_URL, json=body)
    assert resp.status_code in (200, 201), resp.text
    assert len(table.billed) == 1
    assert float(table.billed[0]["amount"]) == 25000.0


# ════════════════════════════════════════════════════════════════════════════
# 6. THE ROUTES THE FRONTEND ALREADY CALLS
#
# Five of these were called by shipped screens and existed nowhere, so the org
# drawer's billing block rendered a permanent error. A path is a contract the
# moment a screen types it.
# ════════════════════════════════════════════════════════════════════════════

FRONTEND_ROUTES = [
    ("GET",   "/api/v1/billing/orgs/{org_id}/lines",           "BillingLinesBlock.jsx"),
    ("POST",  "/api/v1/billing/orgs/{org_id}/lines",           "BillingLinesBlock.jsx"),
    ("PATCH", "/api/v1/billing/orgs/{org_id}/lines/{line_id}", "BillingLinesBlock.jsx"),
    ("POST",  "/api/v1/billing/orgs/{org_id}/lines/{line_id}/end", "BillingLinesBlock.jsx"),
    ("GET",   "/api/v1/billing/orgs/{org_id}/invoice-preview", "InvoiceBuilder.jsx"),
    ("GET",   "/api/v1/billing/me/lines",                      "BillingUsageSection.jsx"),
]


@pytest.mark.parametrize(
    "method,path,caller", FRONTEND_ROUTES,
    ids=[f"{m} {p}" for m, p, _ in FRONTEND_ROUTES],
)
def test_the_route_a_shipped_screen_calls_is_mounted(app, method, path, caller):
    """Read off the OpenAPI schema, not `app.routes`.

    This FastAPI keeps an `_IncludedRouter` wrapper per `include_router` call
    instead of flattening the routes onto the app — 46 of the 52 entries in
    `app.routes` are wrappers with no `.path` — so a membership test against
    `app.routes` is vacuously false for every router in the product and would
    fail these six whether or not they were mounted. Same idiom as
    tests/test_billing_lines.py and tests/test_me_security.py.
    """
    schema = app.openapi()["paths"]
    assert path in schema, (
        f"{caller} calls {method} {path} and no route serves it. The screen "
        f"renders a permanent error and no backend test notices, because "
        f"nothing on this side names the path."
    )
    assert method.lower() in schema[path], (
        f"{caller} calls {method} {path}, which is mounted but only for "
        f"{sorted(schema[path])}."
    )
