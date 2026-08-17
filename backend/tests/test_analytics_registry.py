"""Every declared metric, walked. Proposal 62's own requirement: "the registry
is testable — one test walks every declared metric … a metric that no longer
compiles fails the suite instead of failing a client's screen."

A fake request proves SHAPE, not SQL validity — a mock pool accepts any
string. The three seed metrics' SQL was probed against the live database
read-only on 2026-08-17 (railway run, bound to an org id that cannot exist);
the wiring tests here are what keeps their DECLARATIONS honest between probes.
"""
import re
from datetime import date

import pytest

from analytics.registry import REGISTRY, MetricRequest, load_all
from analytics.windowing import BUCKETS
from services.analytics_window import Window

load_all()

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
#: A syntactically valid uuid no org can hold (all-zero version nibble aside,
#: the value never exists in staging.organisations — the same trick the D1
#: live probes used).
ORG = "00000000-0000-0000-0000-000000000000"

SQL_METRICS = sorted(k for k, m in REGISTRY.items() if m.sql is not None)
ABSENT_METRICS = sorted(k for k, m in REGISTRY.items() if m.absent)


def test_the_registry_is_not_empty():
    """pytest SKIPS an empty parameter set rather than failing — this is the
    guard that turns "no metrics registered" from a silently green suite into
    a red one."""
    assert len(REGISTRY) >= 10, sorted(REGISTRY)
    assert SQL_METRICS, "no runnable metrics registered"
    assert ABSENT_METRICS, "the declared-absent set vanished"


@pytest.mark.parametrize("key", SQL_METRICS)
def test_every_runnable_metric_builds_sound_sql(key):
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    sql, params = m.sql(MetricRequest(org_id=ORG, window=win, bucket="month"))

    assert isinstance(sql, str) and isinstance(params, list)

    # Schema-qualified, always: the live search_path does not include staging,
    # and core PM lives in public — an unqualified name is whichever table the
    # session finds first (the shadow-table incident, migration 142).
    assert re.search(r"\b(staging|public)\.", sql), f"{key}: unqualified table\n{sql}"

    # $1 is the org and it is CAST — PgBouncer turns an untyped parse error
    # into an instant 500 (the credits incident).
    assert "$1::uuid" in sql, f"{key}: org parameter not cast\n{sql}"
    assert params[0] == ORG

    # Every placeholder the SQL names is bound, and nothing extra is.
    placeholders = {int(n) for n in re.findall(r"\$(\d+)", sql)}
    assert placeholders == set(range(1, len(params) + 1)), (
        f"{key}: SQL names {sorted(placeholders)} but {len(params)} params bound"
    )

    if m.grain == "flow":
        assert len(params) >= 3, f"{key}: a flow metric must bind its window"
        assert params[1] == win.start and params[2] == win.end


@pytest.mark.parametrize("key", SQL_METRICS)
def test_flow_metrics_honour_every_bucket(key):
    """The bucket name is interpolated into SQL, so every legal bucket must
    produce a build — a metric that hardcodes month would break the day the
    UI offers quarters."""
    m = REGISTRY[key]
    if m.grain != "flow":
        pytest.skip("stocks take no bucket")
    for b in sorted(BUCKETS):
        sql, _ = m.sql(MetricRequest(org_id=ORG, window=WIN, bucket=b))
        assert f"date_trunc('{b}'" in sql, f"{key} ignored bucket={b}"
        # ::date, not bare date_trunc — the planner types the bare call
        # timestamptz and a timezone appears in a column that never had one.
        assert f"date_trunc('{b}'" in sql and "::date" in sql


@pytest.mark.parametrize("key", ABSENT_METRICS)
def test_declared_absent_metrics_carry_their_reason(key):
    m = REGISTRY[key]
    assert m.sql is None
    # A reason is a sentence someone can act on, not a stub.
    assert len(m.absent) > 60, f"{key}: absence reason too thin to act on"


def test_every_key_is_module_prefixed():
    for key, m in REGISTRY.items():
        assert key.split(".", 1)[0] == m.module


def test_dimensions_are_reachable():
    """A declared dimension the SQL never honours is a lie in the catalogue."""
    for key in SQL_METRICS:
        m = REGISTRY[key]
        for dim in m.dimensions:
            win = WIN if m.grain == "flow" else None
            sql, _ = m.sql(MetricRequest(org_id=ORG, window=win,
                                         bucket="month", group_by=dim))
            assert dim in sql, f"{key}: group_by={dim} accepted but absent from SQL"
