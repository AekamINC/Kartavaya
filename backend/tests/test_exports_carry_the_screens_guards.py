"""An export must carry the guards of the screen it was taken from.

The rule is not invented here. `_fetch_report_data`'s own revenue branch states
it, and has since 2.4:

    "an export that disagrees with the screen it was taken from is worse than
     either being wrong alone, because the reader has no way to tell which one
     to believe."

Two branches of the same function did not carry it. Both were named in suite
12.10's header as expected-red and both stayed open until 2026-08-31.

── 1. THE OVERVIEW EXPORT COUNTED ARCHIVED TASKS ──────────────────────────

    tasks = SELECT COUNT(*) FROM tasks t JOIN teams tm …
            WHERE tm.org_id = $1 AND tm.deleted_at IS NULL

with no `archived_at IS NULL`, while `/overview`'s `total_tasks` — the tile
this file exports — has it. Measured live 2026-08-31 on the reference org:

    export 109        screen 105        (105 after the fix)

── 2. THE SALES EXPORT COUNTED ORDERS THE SALES TAB EXCLUDES ──────────────

    SELECT status, COUNT(*), SUM(total) FROM public.vikray_orders
     WHERE org_id = $1

with no `is_active = TRUE`, while `/v1/dristi/sales`'s `status_split` has it.
So the CSV carried a whole STATUS the screen does not draw. Measured live:

    statuses   export 6           screen 5
    value      export 7,607,387.01   screen 7,364,662.01

The extra was a `cancelled` row of six orders worth 242,725 — present in a file
a partner mails to a client, and findable nowhere in the product.

── WHAT THESE TESTS ASSERT ────────────────────────────────────────────────

Not the numbers, which are data. The statements are captured from BOTH sides —
the export and the screen — and required to apply the same predicates. That is
the property the rule states, and it survives the data changing underneath it.

MUTATION-PROVED 2026-08-31: removing either guard turns its pair red.
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
            self.statements.append(_norm(sql))

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


def _capture(factory):
    pool = CapturePool()
    op, orch = dr.get_pool, dr.reachable_modules

    async def _get_pool():
        return pool

    async def _reach(pool_, user_id, org_id, codes):
        return set(codes)

    dr.get_pool, dr.reachable_modules = _get_pool, _reach
    try:
        try:
            asyncio.run(factory(pool))
        except Exception:                                     # noqa: BLE001
            pass
    finally:
        dr.get_pool, dr.reachable_modules = op, orch
    return pool


@pytest.fixture(scope="module")
def screen():
    """`/overview` and `/sales` — the two screens the exports are taken from."""
    a = _capture(lambda p: dr.overview(date_from="", date_to="",
                                       user=USER, org_id=ORG, _g=None))
    # ⚠ `sales_analytics`, not `sales`. The route is `/sales`; the handler is
    # not. A wrong name here raises inside `_capture`'s swallow and the fixture
    # returns an empty list — which reads as "the screen issues no query" and
    # would let every comparison below pass by comparing against nothing. The
    # harness guard above is what catches it.
    b = _capture(lambda p: dr.sales_analytics(date_from="", date_to="",
                                              user=USER, org_id=ORG, _g=None))
    return a.statements + b.statements


@pytest.fixture(scope="module")
def export():
    """`_fetch_report_data` for both report types — a plain function, so it
    takes the capture pool directly, exactly as a scheduled report calls it."""
    out = []
    for report_type in ("overview", "sales"):
        pool = CapturePool()
        try:
            asyncio.run(dr._fetch_report_data(pool, ORG, report_type, None))
        except Exception:                                     # noqa: BLE001
            pass
        out += pool.statements
    return out


def one(statements, needle, also=None):
    hits = [s for s in statements if needle in s and (also is None or also in s)]
    assert len(hits) == 1, (
        f"expected exactly one statement matching {needle!r}"
        f"{' + ' + repr(also) if also else ''}, saw {len(hits)}")
    return hits[0]


def test_the_harness_sees_both_sides(screen, export):
    """Guard on the harness. If capture stopped working every assertion below
    would pass by inspecting nothing — the failure mode this whole file is
    about, reproduced inside it."""
    assert any("FROM tasks" in s for s in screen)
    assert any("FROM tasks" in s for s in export)
    assert any("vikray_orders" in s for s in screen)
    assert any("vikray_orders" in s for s in export)


# ── 1. tasks ────────────────────────────────────────────────────────────────

def test_the_overview_export_drops_archived_tasks(export):
    """THE DEFECT. RED without the guard: the CSV counted 109 where the screen
    showed 105."""
    sql = one(export, "FROM tasks")
    assert "archived_at IS NULL" in sql, (
        "the overview export counts archived tasks; the tile it exports does "
        f"not. SQL: {sql}")


def test_the_task_export_and_the_task_tile_exclude_the_same_things(screen, export):
    """The property, not the instance. Both statements must apply the same two
    predicates — a live team, and an unarchived task."""
    e = one(export, "FROM tasks")
    s = one(screen, "AS total_tasks")
    for guard in ("deleted_at IS NULL", "archived_at IS NULL"):
        assert guard in e, f"the export is missing {guard}"
        assert guard in s, f"the screen is missing {guard}"


# ── 2. orders ───────────────────────────────────────────────────────────────

def test_the_sales_export_drops_inactive_orders(export):
    """THE DEFECT. RED without the guard: a whole `cancelled` status — six
    orders, 242,725 — appeared in the file and on no screen."""
    sql = one(export, "vikray_orders")
    assert "is_active=TRUE" in sql or "is_active = TRUE" in sql, (
        f"the sales export counts soft-deleted orders. SQL: {sql}")


def test_the_order_export_and_the_sales_tab_exclude_the_same_things(screen, export):
    e = one(export, "vikray_orders")
    s = one(screen, "vikray_orders", also="GROUP BY status")
    for sql, who in ((e, "export"), (s, "screen")):
        assert "is_active=TRUE" in sql or "is_active = TRUE" in sql, (
            f"the {who} does not exclude soft-deleted orders")


# ── the shape, so a third branch cannot repeat it ──────────────────────────

def test_every_export_branch_over_a_soft_deleted_table_carries_the_guard(export):
    """`_fetch_report_data` reads five tables that all carry `is_active` or
    `archived_at`. Two of them had lost their guard and nothing said so, which
    is why this is asserted over the whole function rather than per branch.
    """
    UNGUARDED = []
    for sql in export:
        for table, guard in (("public.ganit_invoices", "is_active"),
                             ("public.graha_contacts", "is_active"),
                             ("public.graha_deals", "is_active"),
                             ("public.vikray_orders", "is_active"),
                             ("FROM tasks", "archived_at")):
            if table in sql and guard not in sql:
                UNGUARDED.append((table, sql))
    assert not UNGUARDED, (
        "export statements reading a soft-deleted table with no guard:\n" +
        "\n".join(f"  {t}: {s}" for t, s in UNGUARDED))
