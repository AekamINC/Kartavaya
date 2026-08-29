"""
`aggregate_kpis` — and the difference between zero and "we could not read it".

This handler is wired as the `kpis` context source, so it is the one a general
brief leans on hardest. It had never produced a figure in its life: the tasks arm
joined `staging.tasks` to `staging.projects` on `t.project_id`, and
`staging.tasks` does not exist — tasks are `public.tasks`, which has no
`project_id` either, so no version of that join could have worked. Every call
raised UndefinedTable, and every template naming `"context": ["kpis"]` rendered
"unavailable".

The second fault is the one worth keeping tests around: a single failing arm took
the whole set down, and the reflex fix — swallow and return 0 — is worse than the
crash. A zero for revenue and a zero for "revenue could not be read" are the same
number on the page, and a model handed the first writes a confident paragraph
about a business that earned nothing.

The SQL is proven separately against the live catalog: all seven arms execute and
return real figures for Aekam Inc, tasks_closed among them.
"""
import pytest

from services.skills.data.kpi_aggregator import aggregate_kpis, _TASK_ORG_SCOPE

ORG = "045b76ad-654b-42dd-b4b1-731700efc6c3"


class _Pool:
    """Answers each arm by matching on a fragment of its SQL."""

    def __init__(self, fail_on=None):
        self.fail_on = fail_on or ()
        self.queries = []

    async def fetchrow(self, sql, *args):
        self.queries.append(sql)
        for needle in self.fail_on:
            if needle in sql:
                raise RuntimeError(f"relation for {needle} is unavailable")
        if "ganit_payments" in sql:
            return {"total": 88500}
        if "graha_deals" in sql:
            return {"won": 2, "lost": 1}
        if "public.tasks" in sql:
            return {"cnt": 150}
        if "ganit_invoices" in sql:
            return {"cnt": 0}
        if "graha_contacts" in sql:
            return {"cnt": 2}
        if "ganit_expenses" in sql:
            return {"total": 17700}
        if "manav_employees" in sql:
            return {"cnt": 2}
        raise AssertionError(f"unexpected query: {sql[:80]}")


@pytest.mark.asyncio
async def test_every_figure_comes_back_when_everything_reads():
    out = await aggregate_kpis(_Pool(), ORG)

    assert out["revenue"] == 88500.0
    assert out["deals_won"] == 2 and out["deals_lost"] == 1
    assert out["tasks_closed"] == 150
    assert out["invoices_sent"] == 0
    assert out["new_leads"] == 2
    assert out["expenses_total"] == 17700.0
    assert out["employees_active"] == 2
    # No failures, so no noise for the model to reason about.
    assert "unavailable" not in out and "note" not in out


@pytest.mark.asyncio
async def test_the_tasks_arm_no_longer_reads_a_table_that_does_not_exist():
    """The fatal bug. `staging.tasks` has never existed."""
    pool = _Pool()

    await aggregate_kpis(pool, ORG)

    joined = " ".join(pool.queries)
    # `staging.tasks` is a name that NEVER existed — not one the consolidation
    # moved — so this ban stays spelled `staging.` and is not rewritten to
    # `public.`, which is the real table asserted two lines below.
    assert "staging.tasks" not in joined
    assert "project_id" not in joined
    assert "public.tasks" in joined


@pytest.mark.asyncio
async def test_tasks_are_scoped_through_their_team():
    """`public.tasks` carries no org_id. Any other scoping is a cross-tenant
    read rather than a wrong count."""
    pool = _Pool()

    await aggregate_kpis(pool, ORG)

    tasks_sql = next(q for q in pool.queries if "public.tasks" in q)
    assert _TASK_ORG_SCOPE in tasks_sql
    assert "org_id = $1::uuid" in tasks_sql


@pytest.mark.asyncio
async def test_a_failed_arm_is_none_and_named_never_zero():
    """
    The whole point. `revenue: 0` and "we could not read revenue" must not be
    the same value, because the model cannot tell them apart and will write a
    confident sentence about a business that earned nothing.
    """
    out = await aggregate_kpis(_Pool(fail_on=("ganit_payments",)), ORG)

    assert out["revenue"] is None, "a failed arm was zeroed"
    assert out["unavailable"] == ["revenue"]
    assert "not as zero" in out["note"]


@pytest.mark.asyncio
async def test_one_failed_arm_does_not_take_the_others_with_it():
    out = await aggregate_kpis(_Pool(fail_on=("manav_employees",)), ORG)

    assert out["employees_active"] is None
    assert out["revenue"] == 88500.0
    assert out["tasks_closed"] == 150
    assert out["unavailable"] == ["employees_active"]


@pytest.mark.asyncio
async def test_several_failures_are_all_named():
    out = await aggregate_kpis(
        _Pool(fail_on=("ganit_payments", "ganit_expenses", "public.tasks")), ORG
    )

    assert set(out["unavailable"]) == {"revenue", "expenses", "tasks_closed"}
    assert out["revenue"] is None and out["expenses_total"] is None
    assert out["deals_won"] == 2, "an unrelated arm was lost"


@pytest.mark.asyncio
async def test_a_genuine_zero_is_still_a_zero():
    """The counterpart. `invoices_sent` really is 0 for Aekam Inc over 30 days,
    and that must read as a figure, not as a gap."""
    out = await aggregate_kpis(_Pool(), ORG)

    assert out["invoices_sent"] == 0
    assert out["invoices_sent"] is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("period", ["7d", "30d", "90d", "365d", "nonsense"])
async def test_the_period_is_echoed_so_a_reader_knows_what_they_are_looking_at(period):
    """An unknown period falls back to 30 days rather than raising — but the
    figure must not be labelled with a window it was not computed over."""
    out = await aggregate_kpis(_Pool(), ORG, period=period)

    assert out["period"] == period
