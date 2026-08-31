"""The part of "Invoiced" that no client report can contain must be visible.

── THE FINDING, SUITE 12.09 ON 2026-08-31 ─────────────────────────────────

    Error: 1 of 4 figures do NOT reconcile to their module.
         Σ invoiced over every client report = the org's invoiced total
             Σ over 28 client reports                     = 3,988,101.24
             GET /v1/dristi/overview revenue.total_invoiced = 4,047,691.24

⚠ NEITHER NUMBER IS WRONG, AND NEITHER WAS CHANGED.

Measured live on the reference org, read-only, before anything was touched:
**6 invoices worth 71,508 carry `client_id IS NULL`.** Every attached invoice
was checked too — 0 pointing at a missing client row, 0 on an inactive client —
so the entire gap is that one bucket. An invoice may legitimately have no
client: one can be raised before the CRM record exists, which is the same
principle `GSTIN/PAN/TAN block nothing` states about a different field.

So the assertion "every rupee is on some client" is not a property this product
has, and making it true would mean refusing invoices the product is right to
accept.

── WHAT WAS ACTUALLY WRONG ────────────────────────────────────────────────

The difference was INVISIBLE. A partner reads "Invoiced 40,87,339", adds up the
Clients tab, gets 40,15,831, and there is nothing on any screen naming the
71,508 or pointing at the six invoices behind it. A number that can be neither
reconciled nor investigated is how somebody stops trusting the whole page.

The overview now reports the bucket beside the headline it explains —
`unattached_invoiced` and `unattached_count` — computed IN THE SAME STATEMENT
over the SAME guards, so it cannot drift from the total the way a second query
would. The tile is drawn only when the count is non-zero: a permanent "0
unattached" is noise on every well-kept org's dashboard for ever.

MUTATION-PROVED 2026-08-31: dropping either FILTER, or moving them to a second
statement with different guards, turns the tests below red.
"""
import asyncio

import pytest

from routers import dristi as dr


ORG = "00000000-0000-0000-0000-0000000000aa"
USER = {"user_id": "user_admin001"}


def _norm(sql):
    return " ".join(str(sql).split())


class CapturePool:
    def __init__(self):
        self.statements = []

    def _rec(self, sql):
        if isinstance(sql, str) and sql.strip():
            self.statements.append(sql)

    async def fetch(self, sql, *a, **k):
        self._rec(sql)
        return []

    async def fetchrow(self, sql, *a, **k):
        self._rec(sql)
        return None

    async def fetchval(self, sql, *a, **k):
        self._rec(sql)
        return 0

    async def execute(self, sql, *a, **k):
        self._rec(sql)
        return "SELECT 0"


@pytest.fixture(scope="module")
def revenue_sql():
    """The invoice statement `/overview` actually issues."""
    pool = CapturePool()
    op, orch = dr.get_pool, dr.reachable_modules

    async def _get_pool():
        return pool

    async def _reach(pool_, user_id, org_id, codes):
        return set(codes)

    dr.get_pool, dr.reachable_modules = _get_pool, _reach
    try:
        try:
            asyncio.run(dr.overview(date_from="", date_to="",
                                    user=USER, org_id=ORG, _g=None))
        except Exception:                                     # noqa: BLE001
            pass
    finally:
        dr.get_pool, dr.reachable_modules = op, orch

    reads = [_norm(s) for s in pool.statements
             if "ganit_invoices" in s and "total_invoiced" in s]
    assert len(reads) == 1, (
        "the harness saw %d invoice reads, not 1" % len(reads))
    return reads[0]


def test_the_overview_reports_the_unattached_bucket(revenue_sql):
    """THE DEFECT. RED before this: neither figure existed, so the gap between
    the headline and the Clients tab had no name anywhere in the product."""
    assert "unattached_invoiced" in revenue_sql, (
        "the overview reports no unattached total — the difference between "
        "'Invoiced' and the sum of the client reports is unexplained on screen")
    assert "unattached_count" in revenue_sql, (
        "a rupee figure with no count cannot be investigated: 71,508 across "
        "how many invoices?")


def test_it_is_the_SAME_statement_as_the_total_it_explains(revenue_sql):
    """The whole point. A second query would carry its own guards and could
    drift from `total_invoiced` — which is the class of defect this figure
    exists to expose, reintroduced by the fix for it."""
    assert "total_invoiced" in revenue_sql and "unattached_invoiced" in revenue_sql
    assert revenue_sql.count("FROM public.ganit_invoices") == 1


def test_the_bucket_carries_the_same_guards_as_the_total(revenue_sql):
    """Drafts and soft-deletes are excluded from both, because they are
    excluded from the headline. An unattached figure computed over a wider set
    would not close the arithmetic it was added to close."""
    assert "is_active=TRUE" in revenue_sql
    assert "COALESCE(doc_status, '') <> 'draft'" in revenue_sql


def test_the_predicate_is_client_id_IS_NULL(revenue_sql):
    """Named explicitly, because the near-miss is `client_id = ''` — a uuid
    column has no empty string, and a guard written that way would silently
    report zero on every org for ever."""
    assert "FILTER (WHERE client_id IS NULL)" in revenue_sql


def test_the_headline_still_counts_the_unattached_money(revenue_sql):
    """⚠ THE OTHER DIRECTION, AND THE ONE A CARELESS FIX BREAKS.

    "Make the numbers agree" invites excluding these invoices from
    `total_invoiced`. That would be wrong: they ARE invoiced, the customer owes
    the money, and hiding them would turn a visible discrepancy into an
    understated revenue figure — a worse defect, and a silent one.
    """
    total = revenue_sql.split("AS total_invoiced", 1)[0]
    assert "client_id" not in total, (
        "`total_invoiced` has been narrowed to attached invoices — the "
        "unattached money has stopped being revenue instead of starting to be "
        "explained")
