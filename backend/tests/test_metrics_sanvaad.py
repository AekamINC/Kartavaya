"""The Sanvaad metrics, held to the constraint their docstring promises.

The governing rule (proposal 62 §4, D5): AGGREGATE ONLY — no analytic may
expose message content or read state to anyone but its owner. No message
body, no per-person read state, no DM contents in any SELECT; channel-level
counts only. The privacy pin below scans EVERY query variant this module can
build for the columns and tables that rule forbids — a refactor that touches
content or read receipts turns the suite red before it reaches a screen.

analytics/metrics/sanvaad.py is not yet in registry.load_all() (the wiring is
the integration owner's file, not this batch's), so the universal walk from
test_analytics_registry.py is REPLICATED here — these declarations must
already satisfy it on the day they are wired in.

Every assertion scans the SQL string the builder actually returns — never a
comment, never a docstring.
"""
import re
from datetime import date

import pytest

import analytics.metrics.sanvaad  # noqa: F401 — registering is the import's effect
from analytics.registry import REGISTRY, MetricRequest
from analytics.windowing import BUCKETS
from services.analytics_window import Window

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"

SANVAAD_SQL = sorted(
    k for k, m in REGISTRY.items() if m.module == "sanvaad" and m.sql is not None
)
SANVAAD_ABSENT = sorted(
    k for k, m in REGISTRY.items() if m.module == "sanvaad" and m.absent
)


def build(key: str, *, group_by=None, bucket: str = "month"):
    """The (whitespace-normalised SQL, params) a metric builds."""
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    sql, params = m.sql(
        MetricRequest(org_id=ORG, window=win, bucket=bucket, group_by=group_by)
    )
    return " ".join(sql.split()), params


def every_variant(key: str):
    """Every SQL shape a metric can produce: ungrouped plus each dimension."""
    m = REGISTRY[key]
    yield None, build(key)[0]
    for dim in m.dimensions:
        yield dim, build(key, group_by=dim)[0]


def test_the_batch_is_declared_as_specified():
    expect = {
        "sanvaad.message_volume": ("flow", "count", "operational"),
        "sanvaad.active_participants": ("flow", "count", "operational"),
        "sanvaad.response_time": ("flow", "hours", "operational"),
    }
    for key, (grain, unit, sensitivity) in expect.items():
        m = REGISTRY[key]
        assert (m.grain, m.unit, m.sensitivity) == (grain, unit, sensitivity), key
    assert REGISTRY["sanvaad.message_volume"].dimensions == ("channel",)
    assert REGISTRY["sanvaad.active_participants"].dimensions == ("channel",)
    assert REGISTRY["sanvaad.response_time"].dimensions == ()
    assert SANVAAD_ABSENT == ["sanvaad.read_rate"]


# ── THE PRIVACY PIN ──────────────────────────────────────────────────────────

#: Column names and tables the governing rule forbids in ANY select this
#: module builds. `content` covers the message body; `metadata` is jsonb that
#: can carry it; `read_at`/`last_read`/read-receipts are per-person read
#: state; attachments and reactions are per-message payloads no aggregate
#: needs.
_FORBIDDEN = (
    "content",
    "metadata",
    "read_at",            # also matches last_read_at and read receipts' column
    "read_receipt",
    "samvada_channel_members",
    "attachment",
    "reaction",
    "emoji",
    "parent_message_id",  # thread topology is message-level detail, not a count
)


@pytest.mark.parametrize("key", SANVAAD_SQL)
def test_no_variant_touches_content_or_read_state(key):
    for variant, sql in every_variant(key):
        low = sql.lower()
        for word in _FORBIDDEN:
            assert word not in low, (
                f"{key} (group_by={variant}) touches forbidden '{word}':\n{sql}"
            )


@pytest.mark.parametrize("key", SANVAAD_SQL)
def test_no_variant_outputs_a_sender(key):
    """sender_id may be counted (COUNT(DISTINCT …)) or compared (the
    different-author test) — it may never be an output column. The outermost
    select list is everything before the first ' FROM '."""
    for variant, sql in every_variant(key):
        select_list = sql.split(" FROM ")[0]
        for hit in re.finditer(r"sender_id", select_list):
            ctx = select_list[max(hit.start() - 30, 0):hit.start()]
            assert "COUNT(DISTINCT" in ctx, (
                f"{key} (group_by={variant}) puts a sender in the select list:\n{sql}"
            )
        assert "AS sender" not in sql, key


def test_dm_channels_never_appear_as_their_own_row():
    """A DM's only identity is who is in it — the channel split must fold
    every DM into one literal row, grouped on the LABEL, never the id."""
    for key in ("sanvaad.message_volume", "sanvaad.active_participants"):
        sql, _ = build(key, group_by="channel")
        assert "CASE WHEN c.type = 'dm' THEN 'Direct messages'" in sql, key
        assert "GROUP BY 1" in sql, key
        assert "GROUP BY c.id" not in sql, key


# ── message_volume ───────────────────────────────────────────────────────────

def test_message_volume_counts_live_human_messages_only():
    sql, params = build("sanvaad.message_volume")
    assert "m.is_deleted = FALSE" in sql
    assert "m.type <> 'system'" in sql
    assert "m.created_at::date BETWEEN $2::date AND $3::date" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_message_volume_channel_split_labels_the_unnamed_honestly():
    sql, params = build("sanvaad.message_volume", group_by="channel")
    # samvada_channels.name is '' by default (and always '' on a DM) — a
    # blank label is not a name.
    assert "COALESCE(NULLIF(c.name, ''), 'Unnamed channel')" in sql
    assert "JOIN public.samvada_channels c ON c.id = m.channel_id" in sql
    assert "ORDER BY value DESC" in sql
    assert params == [ORG, WIN.start, WIN.end]


# ── active_participants ──────────────────────────────────────────────────────

def test_active_participants_is_a_distinct_count_not_a_list():
    for kw in ({}, {"group_by": "channel"}):
        sql, _ = build("sanvaad.active_participants", **kw)
        assert "COUNT(DISTINCT m.sender_id)" in sql
        # Once, inside the aggregate — a second appearance would be a leak
        # path (a filter is fine, an output is not; there is neither).
        assert sql.count("sender_id") == 1, sql


def test_active_participants_filters_match_message_volume():
    """The two headline counts must agree on what a message IS, or 'active'
    people can exceed people-who-sent-a-counted-message."""
    sql, _ = build("sanvaad.active_participants")
    assert "m.is_deleted = FALSE" in sql
    assert "m.type <> 'system'" in sql


# ── response_time ────────────────────────────────────────────────────────────

def test_response_time_is_a_median_gap_to_a_different_author():
    sql, params = build("sanvaad.response_time")
    assert "percentile_cont(0.5) WITHIN GROUP (ORDER BY g.gap_hours)" in sql
    assert "g.prev_sender <> g.sender_id" in sql
    assert "g.prev_sender IS NOT NULL" in sql
    assert "AVG(" not in sql, "one overnight gap must not move the headline"
    assert params == [ORG, WIN.start, WIN.end]


def test_response_time_orders_within_the_channel_deterministically():
    sql, _ = build("sanvaad.response_time")
    assert "PARTITION BY m.channel_id ORDER BY m.created_at, m.id" in sql
    assert "EXTRACT(EPOCH FROM (m.created_at - LAG(m.created_at) OVER w)) / 3600.0" in sql


def test_response_time_excludes_dms():
    """In a two-person org the DM median IS the pair's private cadence — the
    metric claims channels only."""
    sql, _ = build("sanvaad.response_time")
    assert "c.type <> 'dm'" in sql


def test_response_time_windows_on_the_responding_message_outside_the_lag():
    """The filter must sit OUTSIDE the subquery: a reply on the window's
    first day to a message from before it is a real gap. Filtering inside
    would silently drop every first-of-window response."""
    sql, _ = build("sanvaad.response_time")
    inner = sql.split(" FROM (")[1].split(") g ")[0]
    outer = sql.split(") g ")[1]
    assert "BETWEEN $2::date AND $3::date" not in inner
    assert "g.created_at::date BETWEEN $2::date AND $3::date" in outer


def test_response_time_counts_live_human_messages_only():
    sql, _ = build("sanvaad.response_time")
    assert "m.is_deleted = FALSE" in sql
    assert "m.type <> 'system'" in sql


# ── the declared absence ─────────────────────────────────────────────────────

def test_read_rate_is_absent_because_of_the_privacy_rule():
    m = REGISTRY["sanvaad.read_rate"]
    assert m.sql is None
    assert "samvada_read_receipts" in m.absent
    assert "last_read_at" in m.absent
    assert len(m.absent) > 60


# ── the universal walk, replicated until load_all() carries this module ──────

@pytest.mark.parametrize("key", SANVAAD_SQL)
def test_every_runnable_metric_builds_sound_sql(key):
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    sql, params = m.sql(MetricRequest(org_id=ORG, window=win, bucket="month"))
    assert isinstance(sql, str) and isinstance(params, list)
    assert re.search(r"\b(staging|public)\.", sql), f"{key}: unqualified table"
    assert "$1::uuid" in sql, f"{key}: org parameter not cast"
    assert params[0] == ORG
    placeholders = {int(n) for n in re.findall(r"\$(\d+)", sql)}
    assert placeholders == set(range(1, len(params) + 1)), key
    if m.grain == "flow":
        assert params[1] == win.start and params[2] == win.end


@pytest.mark.parametrize("key", SANVAAD_SQL)
def test_flow_metrics_honour_every_bucket(key):
    m = REGISTRY[key]
    if m.grain != "flow":
        pytest.skip("stocks take no bucket")
    for b in sorted(BUCKETS):
        sql, _ = m.sql(MetricRequest(org_id=ORG, window=WIN, bucket=b))
        assert f"date_trunc('{b}'" in sql and "::date" in sql, f"{key} ignored bucket={b}"


@pytest.mark.parametrize("key", SANVAAD_SQL)
def test_dimensions_are_reachable(key):
    m = REGISTRY[key]
    for dim in m.dimensions:
        sql, _ = build(key, group_by=dim)
        assert dim in sql, f"{key}: group_by={dim} accepted but absent from SQL"
