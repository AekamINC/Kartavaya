"""A1: the spine's contract — adapters yield facts, the spine owns SQL.

What these pin: the cursor never advances past a failure, today is never
pulled, an unknown entity's fact is dropped loudly rather than misattributed,
backoff stops a dead token being ground nightly, and the registry ships
EMPTY — nothing claims to sync until a reviewed adapter registers (A2).
"""
from __future__ import annotations

import datetime

import pytest

from analytics import spine
from analytics.spine import (AccountRef, EntityRef, Fact, sync_account,
                             sync_all, upsert_facts)

TODAY = datetime.date(2026, 8, 18)
ORG = "22222222-2222-2222-2222-222222222222"
ACC = "33333333-3333-3333-3333-333333333333"


def _account(**over):
    row = {"id": ACC, "org_id": ORG, "source": "test_src",
           "cursor_date": datetime.date(2026, 8, 10),
           "consecutive_failures": 0, "is_active": True}
    row.update(over)
    return row


class _Conn:
    def __init__(self, parent):
        self.p = parent

    async def execute(self, sql, *args):
        self.p.executed.append((" ".join(sql.split()), args))

    async def fetchrow(self, sql, *args):
        self.p.executed.append((" ".join(sql.split()), args))
        if "INSERT INTO public.analytics_entities" in sql:
            return {"id": f"ent-{args[2]}"}
        return None

    async def fetch(self, sql, *args):
        if "FROM public.analytics_accounts" in sql:
            return self.p.accounts
        return []


class _Pool:
    def __init__(self, accounts=()):
        self.accounts = list(accounts)
        self.executed = []

    def acquire(self):
        pool = self

        class _A:
            async def __aenter__(_s):
                return _Conn(pool)

            async def __aexit__(_s, *a):
                return False
        return _A()


class _Adapter:
    source = "test_src"
    label = "Test source"
    metrics = ("spend", "impressions")
    metric_labels = {"spend": "Spend", "impressions": "Impressions"}
    money_metrics = frozenset({"spend"})
    lookback_days = 7
    entity_type = "campaign"

    def __init__(self, facts=(), explode=False):
        self._facts = list(facts)
        self._explode = explode

    async def list_entities(self, creds, account_row):
        if self._explode:
            raise RuntimeError("token expired")
        return [EntityRef("campaign", "c1", "Campaign One")]

    async def fetch_daily(self, creds, account_row, since, until):
        for f in self._facts:
            yield f


@pytest.fixture
def adapter(monkeypatch):
    a = _Adapter(facts=[
        Fact("c1", datetime.date(2026, 8, 15), "spend", 120.5, "INR"),
        Fact(None, datetime.date(2026, 8, 15), "impressions", 900),
    ])
    monkeypatch.setitem(spine.ADAPTERS, "test_src", a)
    yield a
    # monkeypatch.setitem restores on teardown


def test_the_registry_ships_empty():
    """Nothing claims to sync until a reviewed adapter registers. An entry
    here without its A2 review is exactly the half-built estate rule."""
    assert spine.ADAPTERS == {}


async def test_a_sync_pulls_to_yesterday_and_advances_the_cursor(adapter):
    pool = _Pool()
    out = await sync_account(pool, _account(), creds=None, today=TODAY)
    assert out["facts"] == 2
    assert out["window"]["until"] == "2026-08-17", "today is never pulled"
    assert out["window"]["since"] == "2026-08-03", "cursor - lookback"
    cursor_writes = [a for sql, a in pool.executed
                     if "SET cursor_date" in sql]
    assert cursor_writes and cursor_writes[0][0] == datetime.date(2026, 8, 17)


async def test_an_account_level_fact_lands_with_a_null_entity(adapter):
    pool = _Pool()
    await sync_account(pool, _account(), creds=None, today=TODAY)
    fact_rows = [a for sql, a in pool.executed
                 if "analytics_metrics_daily" in sql]
    assert any(a[2] is None for a in fact_rows), \
        "the impressions fact carries no entity and must not be misattributed"


async def test_an_unknown_entitys_fact_is_dropped_loudly_not_misfiled():
    pool = _Pool()
    conn = _Conn(pool)
    n = await upsert_facts(
        conn, _account(),
        [Fact("ghost-entity", datetime.date(2026, 8, 15), "spend", 5, "INR")],
        entity_ids={"c1": "ent-c1"})
    assert n == 0
    assert not any("analytics_metrics_daily" in sql for sql, _ in pool.executed)


async def test_a_failure_records_itself_and_never_advances_the_cursor(monkeypatch):
    monkeypatch.setitem(spine.ADAPTERS, "test_src", _Adapter(explode=True))
    pool = _Pool()
    out = await sync_account(pool, _account(), creds=None, today=TODAY)
    assert "error" in out
    assert not any("SET cursor_date" in sql for sql, _ in pool.executed), \
        "a failed pull must be re-pulled, not skipped past"
    fail_writes = [sql for sql, _ in pool.executed
                   if "consecutive_failures + 1" in sql]
    assert len(fail_writes) == 1


async def test_backoff_leaves_a_dead_token_alone(adapter):
    pool = _Pool()
    out = await sync_account(pool, _account(consecutive_failures=5),
                             creds=None, today=TODAY)
    assert "backed off" in out["skipped"]
    assert pool.executed == [], "no query is spent on a backed-off account"


async def test_an_unadapted_source_is_a_stated_skip():
    pool = _Pool()
    out = await sync_account(pool, _account(source="carrier_pigeon"),
                             creds=None, today=TODAY)
    assert "no adapter" in out["skipped"]


async def test_sync_all_runs_every_account_independently(adapter, monkeypatch):
    pool = _Pool(accounts=[_account(), _account(id="44444444-4444-4444-4444-444444444444",
                                                source="carrier_pigeon")])
    out = await sync_all(pool, today=TODAY)
    assert out["count"] == 2
    results = list(out["accounts"].values())
    assert any("facts" in r for r in results)
    assert any("skipped" in r for r in results), \
        "the unadapted account is reported, not hidden"


async def test_the_catalogue_is_written_from_the_adapter(adapter):
    pool = _Pool()
    await sync_account(pool, _account(), creds=None, today=TODAY)
    cat = [a for sql, a in pool.executed if "analytics_source_metrics" in sql]
    assert {a[1] for a in cat} == {"spend", "impressions"}
    spend = next(a for a in cat if a[1] == "spend")
    assert spend[3] is True, "spend is a money metric"
