"""A draft invoice is not a receivable, and it is not revenue.

── WHAT WAS WRONG ───────────────────────────────────────────────────────────

A draft is a document that has NOT been issued to anybody. Two surfaces
counted them anyway, and both are surfaces a human acts on:

  · `routers/documents.download_statement_pdf` — the statement of account, the
    one document in the product that goes TO the customer and asks them for
    money. Measured live 2026-08-25: **79 draft rows, Rs 1,16,41,312.46**,
    every one of them a `tax_invoice`, printable on a statement. A customer
    was being dunned for money they were never billed.

  · `routers/dristi.revenue_trends` — the revenue tile. **102 drafts** in the
    table, 87 of them inside the tile's default one-year window, worth
    **Rs 85,16,666.56**. The EXPENSE query four lines below it in the same
    function already filtered on `is_active`; the revenue query filtered on
    nothing at all, and `profit` is the two subtracted from each other.

The fix already existed. `services/gst_period.py` carries it twice, at `:209`
and `:425`, and its own comment block explains the shape:

    AND COALESCE(doc_status, '') <> 'draft'

`COALESCE` and not a bare `doc_status <> 'draft'`, because the column is
nullable and `NULL <> 'draft'` is NULL — which drops every invoice predating
the column, the same bug pointed the other way. Live today there are ZERO NULL
rows, so the two forms agree on every row that exists and the COALESCE is the
guard for the rows that do not exist yet.

── WHY THIS FILE IS SHAPED LIKE `test_skill_sql_is_valid.py` ────────────────

`tests/conftest.py` hands every module a MagicMock pool, and a MagicMock
answers `[]` to any statement it is given — valid SQL, invalid SQL, a shopping
list. A test that calls these routes with that pool and gets a dict back has
proved that the mock returned what the test told it to return.

So, two halves, exactly as that file established:

  1. CAPTURE, offline. Both route functions are called with a pool that records
     the statement and answers emptily. Their own Python builds the SQL — the
     window branch in `revenue_trends`, the five separate reads in the
     statement — exactly as it would at run time. Runs everywhere.

  2. PARSE AND EXECUTE, live. `prepare()` plans every captured statement
     against the real catalogue. Then the draft-sensitive ones are RUN, twice:
     as written, and with the guard textually removed. The difference between
     the two answers is the drafts, and that is the only honest proof that the
     filter does what the docstring says.

Everything against the live database here is a `SELECT`. Staging and production
share one Supabase project (CLAUDE.md), so that is not a nicety.

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_drafts_are_not_dunned.py -q
"""
from __future__ import annotations

import asyncio
import os
import re
import uuid

import pytest

from routers import documents as docs
from routers import dristi as dr
from services import analytics_window as aw

#: The canonical filter, read from the module that owns it rather than spelled
#: out here — a copy in a test is a second source of truth, and this whole
#: defect was two surfaces disagreeing with a third.
CANONICAL = "AND COALESCE(doc_status, '') <> 'draft'"

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognised BY VALUE because conftest uses `setdefault`,
#: so `DATABASE_URL` is never absent.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` does on every connection. Matched so a statement is planned the
#: way it will actually be planned.
_SEARCH_PATH = "SET search_path TO public"

USER = {"user_id": "user_admin001"}
ORG = "00000000-0000-0000-0000-0000000000aa"
CONTACT = uuid.UUID("00000000-0000-0000-0000-0000000000bb")


def _norm(sql: str) -> str:
    return " ".join(sql.split())


# ══════════════════════════════════════════════════════════════════════════════
#  Capture — no database, no writes
# ══════════════════════════════════════════════════════════════════════════════

class CapturePool:
    """Records every statement and answers with just enough to keep going.

    The statement route 404s unless the contact lookup returns a row, and it
    would then stop before issuing any of the five reads this file is about.
    So `graha_contacts` gets a row and nothing else does — the emptier the
    answers, the fewer assumptions the capture makes.
    """

    def __init__(self):
        self.statements: list[str] = []
        #: (sql, args) as the route actually bound them. The ARGUMENTS are half
        #: the check: `download_statement_pdf` used to bind ISO strings into
        #: `$3::date` and asyncpg refused every one, so the route raised before
        #: a single row was read. SQL text alone cannot see that.
        self.calls: list[tuple[str, tuple]] = []

    def _record(self, sql, args=()):
        if isinstance(sql, str) and sql.strip():
            self.statements.append(sql)
            self.calls.append((sql, tuple(args)))

    async def fetch(self, sql, *args, **kwargs):
        self._record(sql, args)
        return []

    async def fetchrow(self, sql, *args, **kwargs):
        self._record(sql, args)
        if "public.graha_contacts" in sql:
            return {"name": "Khanna Electronics", "company": "Khanna Electronics",
                    "email": "ap@example.invalid", "gstin": None,
                    "designation": "Accounts Payable",
                    "billing_address": "{}"}
        # ⚠ `public.teams`, NOT `public.boards`. The project report used to
        # resolve a board from `public.boards` and its team from
        # `organisations.team_id`; both were an abandoned model — `boards` holds
        # zero rows and can never gain one, and one-team-per-org 404'd for 8 of
        # Unicode's 9 projects. The route was fixed to look the project up in
        # `public.teams`, where it lives, and this fixture was not.
        #
        # The cost was exactly what the anti-vacuity guard in
        # `test_the_project_report_never_dunns_a_draft` says: the route 404'd on
        # this lookup, issued no `ganit_invoices` read at all, and the draft
        # assertion below certified a query it never saw. It went red rather
        # than quietly green ONLY because that guard exists.
        if "public.teams" in sql:
            return {"team_id": "board-x", "name": "Statutory Audit FY26"}
        return None

    async def fetchval(self, sql, *args, **kwargs):
        self._record(sql, args)
        # Everything stays 0 — the emptier the answers, the fewer assumptions
        # the capture makes. The team lookup that used to need a truthy answer
        # here (`SELECT team_id FROM public.organisations`) is gone from the
        # route; see `fetchrow` above.
        return 0

    async def execute(self, sql, *args, **kwargs):
        self._record(sql, args)
        return "SELECT 0"


def _capture(module, coro_factory) -> CapturePool:
    """Every statement one route would issue, with `get_pool` swapped out.

    An exception on the way is NOT a failure of this file. Both routes carry on
    past their reads into work this harness cannot supply — the statement route
    ends in `generate_statement_pdf`, which refuses an org with no company
    profile. The statements it managed to issue are what is under test, and
    they have all been issued by then.
    """
    pool = CapturePool()
    original = module.get_pool

    async def _get_pool():
        return pool

    module.get_pool = _get_pool
    try:
        try:
            asyncio.run(coro_factory())
        except Exception:                                     # noqa: BLE001
            pass
    finally:
        module.get_pool = original
    return pool


#: The period the routes are called with, as STRINGS — which is what FastAPI
#: hands them off the query string, and therefore what they must be able to
#: bind. See `test_live_every_query_binds_the_way_its_route_binds_it`.
PERIOD = ("2026-01-01", "2026-08-25")


@pytest.fixture(scope="module")
def statement_pool() -> CapturePool:
    """The statement of account's reads, with the arguments it bound."""
    return _capture(docs, lambda: docs.download_statement_pdf(
        contact_id=CONTACT, period_start=PERIOD[0], period_end=PERIOD[1],
        user=USER, org_id=ORG, _g=None,
    ))


@pytest.fixture(scope="module")
def revenue_pool() -> CapturePool:
    """The Dristi revenue tile's reads, on the default (no-window) branch —
    one bind parameter, which is what the live half re-runs."""
    original = dr.reachable_modules

    async def _reachable(pool, user_id, org_id, codes):
        return set(codes)

    dr.reachable_modules = _reachable
    try:
        return _capture(dr, lambda: dr.revenue_trends(
            months=12, date_from="", date_to="",
            user=USER, org_id=ORG, _g=None,
        ))
    finally:
        dr.reachable_modules = original


@pytest.fixture(scope="module")
def export_pool() -> CapturePool:
    """`report_data("revenue")` — the CSV/PDF twin of the tile above.

    Captured on the WINDOWED branch, because that is the one a scheduled
    report takes, and `report_data` is a plain function with no gate to fake.
    """
    pool = CapturePool()
    try:
        asyncio.run(dr._fetch_report_data(
            pool, ORG, "revenue", aw.parse(PERIOD[0], PERIOD[1])))
    except Exception:                                         # noqa: BLE001
        pass
    return pool


@pytest.fixture(scope="module")
def project_pool() -> CapturePool:
    """The project report's reads. `client_contact_id` is supplied so the
    `fee_invoiced` branch is reached at all — without it the measure is
    skipped and the capture certifies a query it never saw."""
    body = docs.ProjectReportBody(client_contact_id=str(CONTACT))
    return _capture(docs, lambda: docs.download_project_report_pdf(
        board_id="board-x", period_start=PERIOD[0], period_end=PERIOD[1],
        body=body, user=USER, org_id=ORG,
    ))


@pytest.fixture(scope="module")
def statement_sql(statement_pool) -> list[str]:
    return statement_pool.statements


@pytest.fixture(scope="module")
def revenue_sql(revenue_pool) -> list[str]:
    return revenue_pool.statements


def _invoice_reads(statements: list[str]) -> list[str]:
    return [_norm(s) for s in statements if "ganit_invoices" in s]


# ══════════════════════════════════════════════════════════════════════════════
#  The capture half — runs everywhere, including with no database
# ══════════════════════════════════════════════════════════════════════════════

def test_the_capture_sees_both_surfaces(statement_sql, revenue_sql):
    """Guard on the harness itself.

    If capture silently stopped working every assertion below would pass by
    inspecting nothing — the exact failure mode this file exists to end,
    reproduced inside it.
    """
    assert len(_invoice_reads(statement_sql)) == 5, (
        f"the statement path issued {len(_invoice_reads(statement_sql))} reads "
        f"against ganit_invoices, expected 5 (opening invoiced, opening "
        f"credited, opening paid, the entry list, the payment list). The "
        f"capture is no longer seeing the route."
    )
    assert len(_invoice_reads(revenue_sql)) == 1, (
        f"the revenue tile issued {len(_invoice_reads(revenue_sql))} reads "
        f"against ganit_invoices, expected 1."
    )


def test_the_canonical_filter_still_lives_in_gst_period():
    """The expression is quoted from `services/gst_period.py`. If that module
    ever changes its mind, this file must be told rather than silently
    certifying a form nothing else uses any more."""
    import inspect

    from services import gst_period

    src = inspect.getsource(gst_period)
    assert CANONICAL in src, (
        f"{CANONICAL!r} is no longer in services/gst_period.py, which is where "
        f"this filter was settled (:209 and :425) and where its reasoning is "
        f"written down. Two surfaces copy it; reconcile them deliberately."
    )


def test_the_statement_never_dunns_a_draft(statement_sql):
    """All five reads, not only the entry list.

    A statement has to tie. Excluding a draft from the debits while its payment
    stayed a credit would show the client a credit balance they do not hold —
    live there are 2 such payments on the statement path, Rs 2,07,090.
    Removing the document removes its whole ledger footprint or it removes
    nothing.
    """
    reads = _invoice_reads(statement_sql)
    missing = [s for s in reads
               if CANONICAL not in s
               and CANONICAL.replace("doc_status", "i.doc_status") not in s]
    assert not missing, (
        "a read in the statement-of-account path does not exclude drafts:\n  "
        + "\n  ".join(m[:160] for m in missing)
        + "\n\nThis document goes TO the customer and asks them for money. "
          "Live 2026-08-25: 79 draft rows, Rs 1,16,41,312.46."
    )


def test_the_statement_uses_the_nullable_safe_form(statement_sql):
    """`doc_status <> 'draft'` alone drops every NULL row. The column is
    nullable; the bare form is the same bug in the opposite direction."""
    for sql in _invoice_reads(statement_sql):
        bare = re.search(r"(?<!COALESCE\()\b(?:i\.)?doc_status\s*<>\s*'draft'", sql)
        assert bare is None, (
            f"bare `doc_status <> 'draft'` in the statement path — NULL <> "
            f"'draft' is NULL, so this silently drops every invoice that "
            f"predates the column:\n  {sql[:160]}"
        )


def test_the_revenue_tile_excludes_drafts(revenue_sql):
    """102 drafts counted as revenue, live, until this landed."""
    [sql] = _invoice_reads(revenue_sql)
    assert CANONICAL in sql, (
        f"the Dristi revenue tile counts drafts as revenue again:\n  {sql}"
    )


def test_revenue_and_expenses_are_filtered_the_same_way(revenue_sql):
    """Two figures on one chart, subtracted from each other to make `profit`.
    The expense query has always carried `is_active`; the revenue query had no
    guard at all, which is how the disagreement went unnoticed."""
    [inv] = _invoice_reads(revenue_sql)
    [exp] = [_norm(s) for s in revenue_sql if "ganit_expenses" in s]
    for label, sql in (("revenue", inv), ("expenses", exp)):
        assert re.search(r"is_active\s*=\s*TRUE", sql), (
            f"the {label} half of the profit chart no longer filters on "
            f"is_active:\n  {sql}"
        )


def test_the_revenue_tile_agrees_with_the_client_report(revenue_sql):
    """`routers/analytics.py`'s client report is the same money narrowed to one
    client, and it has always got this right. A dashboard that disagrees with
    the client page about the same rows discredits both — metric drift, the
    analytics programme's named failure mode.

    Compared as GUARD SETS rather than as text: the two queries legitimately
    differ in shape (one groups by month, one is scoped to a client), so the
    thing to pin is which predicates they apply to the table.
    """
    import inspect

    from routers import analytics as ax

    src = inspect.getsource(ax.client_report)
    ref = re.search(
        r"\"SELECT COALESCE\(SUM\(CASE WHEN invoice_type = 'credit_note' \""
        r".*?client_id, org_id, win\.start, win\.end\)",
        src, re.S)
    assert ref, "could not find the client report's invoiced query — read it"
    reference = " ".join(re.findall(r'"([^"]*)"', ref.group(0)))

    def guards(sql: str) -> set[str]:
        found = set()
        if re.search(r"is_active\s*=?\s*TRUE", sql):
            found.add("is_active")
        if "doc_status" in sql and "draft" in sql:
            found.add("not_draft")
        return found

    [inv] = _invoice_reads(revenue_sql)
    assert guards(inv) == guards(reference) == {"is_active", "not_draft"}, (
        f"the revenue tile and the client report filter the same table "
        f"differently:\n  dristi/revenue  : {sorted(guards(inv))}\n"
        f"  analytics client: {sorted(guards(reference))}"
    )


def test_the_export_agrees_with_the_tile(export_pool, revenue_sql):
    """`_fetch_report_data("revenue")` renders the SAME number as
    `revenue_trends` — one to the screen, one to CSV and PDF.

    Fixing only the tile CREATED this disagreement, which is the failure mode
    2.4 exists to end: two surfaces over one table, filtered differently, with
    no way for the reader to tell which to believe. Live 2026-08-25 the export
    was carrying 102 drafts, Rs 1,17,97,072.46.
    """
    [tile] = _invoice_reads(revenue_sql)
    [export] = _invoice_reads(export_pool.statements)

    def guards(sql: str) -> set[str]:
        found = set()
        if re.search(r"is_active\s*=?\s*TRUE", sql):
            found.add("is_active")
        if "doc_status" in sql and "draft" in sql:
            found.add("not_draft")
        return found

    assert guards(export) == guards(tile) == {"is_active", "not_draft"}, (
        f"the exported revenue report and the on-screen tile filter the same "
        f"table differently:\n  tile   : {sorted(guards(tile))}\n"
        f"  export : {sorted(guards(export))}"
    )
    assert CANONICAL in export, export


def test_the_project_report_never_dunns_a_draft(project_pool):
    """"Fee invoiced to date", printed on a report that goes to the client
    beside the fee they agreed. The same 79 rows / Rs 1,16,41,312.46 matched
    this predicate live before the guard went on."""
    reads = _invoice_reads(project_pool.statements)
    assert reads, (
        "the project report issued no ganit_invoices read — the capture never "
        "reached the fee_invoiced branch, so this test certifies nothing"
    )
    for sql in reads:
        assert CANONICAL in sql, (
            f"the project report's fee measure counts unissued documents:\n  {sql}"
        )


# ══════════════════════════════════════════════════════════════════════════════
#  The live half — parse, then execute read-only
# ══════════════════════════════════════════════════════════════════════════════

SKIP_REASON = (
    "no live database. These checks run the two queries against the real "
    "catalogue, once as written and once with the draft guard removed — a "
    "MagicMock pool answers [] to both and proves nothing. Run them with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_drafts_are_not_dunned.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


def _live(fn):
    """Run one read-only coroutine against the live database, or skip."""
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            return await fn(conn)
        finally:
            await conn.close()

    try:
        return asyncio.run(run())
    except (pytest.skip.Exception, AssertionError):
        raise
    except Exception as exc:                                  # noqa: BLE001
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


def _without_guard(sql: str) -> str:
    """The same statement with the draft filter textually removed.

    Comparing the two answers is the measurement. Nothing else about the
    statement changes, so the difference cannot be anything but the drafts.
    """
    out = _norm(sql)
    for form in (CANONICAL + " ", CANONICAL.replace("doc_status", "i.doc_status") + " "):
        out = out.replace(form, "")
    assert out != _norm(sql), f"nothing was removed — the guard is not in:\n{sql}"
    return out


#: `documents.py` once asked for `staging.time_entries` when only
#: `public.time_entries` existed, so the project report 500ed for every caller
#: it ever had. It now names `public.time_entries` — the table that does exist
#: — so there is no statement left to exempt, and the parse check below covers
#: every one of them.
#:
#: What replaces that exemption is a COUNT. `assert not failures` is green
#: against an empty capture, so the number of statements actually described is
#: the only thing that distinguishes "all eighteen plan" from "nothing was
#: captured and nothing was checked".
DESCRIBED_STATEMENTS = 18       # 7 statement + 2 revenue tile + 1 export + 8 project


def test_every_captured_statement_plans_against_the_real_catalogue(
        statement_pool, revenue_pool, export_pool, project_pool):
    """`prepare()` sends Parse and Describe and STOPS. The server plans the
    statement, resolves every relation, column and parameter type, and returns
    the shapes — it does not execute, does not read a row, does not write one.

    This is the check CLAUDE.md requires of any router change: a column that
    does not exist, or an untyped `$1 + $2` that PgBouncer turns into an
    instant 500, is invisible to the offline suite.
    """
    async def go(conn):
        failures, seen = [], 0
        for pool in (statement_pool, revenue_pool, export_pool, project_pool):
            for sql in pool.statements:
                seen += 1
                try:
                    await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append(
                        f"{type(exc).__name__}: {exc}\n    {_norm(sql)[:200]}")
        return failures, seen

    failures, seen = _live(go)
    assert seen >= DESCRIBED_STATEMENTS, (
        f"only {seen} statements were described, not {DESCRIBED_STATEMENTS} — "
        f"the capture rotted and `assert not failures` below proves nothing")
    assert not failures, ("statements the server refuses to plan:\n  "
                          + "\n  ".join(failures))


def test_live_every_query_binds_the_way_its_route_binds_it(
        statement_pool, revenue_pool, export_pool, project_pool):
    """THE HALF THAT `prepare()` CANNOT SEE.

    Parsing proves the SQL is valid. It says nothing about whether the values
    the route passes can be BOUND to it, and that is where these two routers
    were actually broken: `download_statement_pdf` and
    `download_project_report_pdf` bound ISO date strings into `$3::date`,
    Postgres infers such a parameter as `date`, and asyncpg refuses —

        DataError: invalid input for query argument $3: '2026-01-01'
                   ('str' object has no attribute 'toordinal')

    so both routes raised on their first dated read and neither document had
    ever rendered. A MagicMock pool accepts any argument of any type, so the
    offline suite could never have seen it, and `prepare()` alone would have
    passed it too. Measured live 2026-08-25; fixed with the double cast
    `$3::text::date` that `gst_period.py` and `_tally_rows` already use.

    Every statement is executed with the ARGUMENTS ITS ROUTE CAPTURED. The org
    and contact ids are fixtures that match nothing, so each query is a
    read-only SELECT returning zero rows — the bind is the whole point.
    """
    async def go(conn):
        failures, seen = [], 0
        for name, pool in (("statement", statement_pool),
                           ("revenue tile", revenue_pool),
                           ("revenue export", export_pool),
                           ("project report", project_pool)):
            for sql, args in pool.calls:
                seen += 1
                try:
                    await conn.fetch(sql, *args)
                except Exception as exc:                      # noqa: BLE001
                    failures.append(
                        f"{name}: {type(exc).__name__}: {exc}"
                        + f"\n    {_norm(sql)[:180]}"
                        + f"\n    args={args!r}")
        return failures, seen

    failures, seen = _live(go)
    assert seen >= DESCRIBED_STATEMENTS, (
        f"only {seen} queries were bound, not {DESCRIBED_STATEMENTS} — the "
        f"capture rotted and `assert not failures` below proves nothing")
    assert not failures, (
        "queries their own route cannot bind:\n  "
        + ("\n  ").join(failures))


def test_live_the_revenue_tile_drops_real_drafts(revenue_sql):
    """Executed, both ways, against an org that actually holds drafts."""
    [sql] = [s for s in revenue_sql if "ganit_invoices" in s]

    async def go(conn):
        org = await conn.fetchval(
            "SELECT org_id FROM public.ganit_invoices "
            "WHERE COALESCE(doc_status,'') = 'draft' AND is_active = TRUE "
            "  AND invoice_date >= (CURRENT_DATE - INTERVAL '1 year') "
            "GROUP BY org_id ORDER BY COUNT(*) DESC LIMIT 1")
        if org is None:
            pytest.skip("no org holds a draft invoice in the window any more — "
                        "the fixture is the live table, and it has moved")
        drafts = await conn.fetchrow(
            "SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0)::float AS amt "
            "FROM public.ganit_invoices "
            "WHERE org_id = $1 AND COALESCE(doc_status,'') = 'draft' "
            "  AND is_active = TRUE "
            "  AND invoice_date >= (CURRENT_DATE - INTERVAL '1 year')", org)
        fixed = sum(float(r["invoiced"] or 0)
                    for r in await conn.fetch(_norm(sql), org))
        before = sum(float(r["invoiced"] or 0)
                     for r in await conn.fetch(_without_guard(sql), org))
        # What `routers/analytics.py`'s client report would count over the same
        # rows — its guards, verbatim, un-narrowed.
        agreed = await conn.fetchval(
            "SELECT COALESCE(SUM(total),0)::float FROM public.ganit_invoices "
            "WHERE org_id = $1 AND is_active = TRUE AND doc_status <> 'draft' "
            "  AND invoice_date >= (CURRENT_DATE - INTERVAL '1 year')", org)
        return dict(org=org, n=drafts["n"], amt=drafts["amt"],
                    fixed=fixed, before=before, agreed=float(agreed))

    m = _live(go)
    assert m["n"] > 0
    assert m["before"] > m["fixed"], (
        f"removing the guard changed nothing — the tile is not filtering. "
        f"org={m['org']} drafts={m['n']}")
    assert round(m["before"] - m["fixed"], 2) == round(m["amt"], 2), (
        f"the difference between the two answers is not the drafts: "
        f"before={m['before']:.2f} fixed={m['fixed']:.2f} "
        f"drafts={m['amt']:.2f}")
    assert round(m["fixed"], 2) == round(m["agreed"], 2), (
        f"the revenue tile and the client report disagree over the same rows: "
        f"dristi={m['fixed']:.2f} analytics={m['agreed']:.2f}. That "
        f"disagreement is the whole defect — see the module docstring.")


def test_live_the_statement_stops_printing_real_drafts(statement_sql):
    """The entry list, executed against a contact that really has drafts.

    Asserted on the invoice NUMBERS rather than on a total: a statement is a
    list of documents, and the promise is that a particular unissued document
    is not on it.

    The period is bound as ISO STRINGS, which is what the route itself binds
    off the query string. Until the double cast landed that raised `DataError`
    and the statement could not render at all — see
    `test_live_every_query_binds_the_way_its_route_binds_it`.
    """
    [entries] = [s for s in statement_sql
                 if "ganit_invoices" in s and "ORDER BY invoice_date" in s]

    async def go(conn):
        row = await conn.fetchrow(
            "SELECT org_id, contact_id FROM public.ganit_invoices "
            "WHERE contact_id IS NOT NULL AND is_active AND cancelled_at IS NULL "
            "  AND COALESCE(doc_status,'') = 'draft' "
            "GROUP BY org_id, contact_id ORDER BY COUNT(*) DESC LIMIT 1")
        if row is None:
            pytest.skip("no contact holds a draft invoice any more — the "
                        "fixture is the live table, and it has moved")
        org, contact = str(row["org_id"]), str(row["contact_id"])
        draft_numbers = {
            r["invoice_number"] for r in await conn.fetch(
                "SELECT invoice_number FROM public.ganit_invoices "
                "WHERE org_id = $1::uuid AND contact_id = $2::uuid AND is_active "
                "  AND cancelled_at IS NULL AND COALESCE(doc_status,'') = 'draft'",
                org, contact)}
        args = (org, contact, "2000-01-01", "2099-12-31")
        printed = {r["invoice_number"]
                   for r in await conn.fetch(_norm(entries), *args)}
        before = {r["invoice_number"]
                  for r in await conn.fetch(_without_guard(entries), *args)}
        return draft_numbers, printed, before

    drafts, printed, before = _live(go)
    assert drafts, "the probe found no drafts for the contact it chose"
    assert drafts & before, (
        "with the guard removed the drafts still do not appear — the "
        "measurement is not measuring what it claims to")
    leaked = drafts & printed
    assert not leaked, (
        f"{len(leaked)} draft invoice(s) still print on the statement of "
        f"account: {sorted(leaked)[:5]}. A customer is being asked for money "
        f"they were never billed.")
