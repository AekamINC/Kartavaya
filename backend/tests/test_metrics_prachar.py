"""The prachar metrics, held to the guards their docstring promises.

test_analytics_registry.py walks every declaration for the universal contract
(schema-qualified tables, $1::uuid, placeholder parity, window binding, bucket
honouring, dimension reachability). What lives HERE is the metric-SPECIFIC
guarantees — the ones a refactor could drop while every universal check stays
green: org scope through the campaigns join and never the unwritten r.org_id,
sends counted only from rows the send loop marked 'sent', rates built from
SUMS rather than averaged per-campaign rates, LEFT-JOIN attendance that cannot
book a registration-less event as a phantom registration, the empty-string
source never rendered bare, and the six declared absences each naming the
exact column or table whose non-existence makes them uncomputable.

Every assertion scans the SQL string the builder actually returns — never a
comment, never a docstring — so a change to the query is what changes a test.
"""
from datetime import date

from analytics.registry import REGISTRY, MetricRequest, load_all
from services.analytics_window import Window

load_all()
import analytics.metrics.prachar  # noqa: E402,F401  (not yet in load_all)

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"


def build(key: str, *, group_by=None, bucket: str = "month"):
    """The (whitespace-normalised SQL, params) a metric builds."""
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    sql, params = m.sql(
        MetricRequest(org_id=ORG, window=win, bucket=bucket, group_by=group_by)
    )
    return " ".join(sql.split()), params


def test_the_batch_is_declared_as_specified():
    expect = {
        "prachar.sends": ("flow", "count", "operational"),
        "prachar.list_growth": ("flow", "count", "operational"),
        "prachar.unsubscribe_rate": ("flow", "pct", "operational"),
        "prachar.event_attendance": ("flow", "pct", "operational"),
        "prachar.leads_by_source": ("flow", "count", "operational"),
        "prachar.open_rate": ("flow", "pct", "operational"),
        "prachar.click_rate": ("flow", "pct", "operational"),
        "prachar.bounce_rate": ("flow", "pct", "operational"),
        "prachar.ad_spend": ("flow", "inr", "financial"),
        "prachar.cpl": ("flow", "inr", "financial"),
        "prachar.roas": ("flow", "pct", "financial"),
    }
    for key, (grain, unit, sensitivity) in expect.items():
        m = REGISTRY[key]
        assert (m.grain, m.unit, m.sensitivity) == (grain, unit, sensitivity), key
        assert m.module == "prachar", key
    assert REGISTRY["prachar.sends"].dimensions == ("campaign",)
    assert REGISTRY["prachar.event_attendance"].dimensions == ("event",)
    assert REGISTRY["prachar.leads_by_source"].dimensions == ("source",)


# ── sends ────────────────────────────────────────────────────────────────────

def test_sends_scope_through_the_campaign_never_the_unwritten_org_id():
    """The migration text gives prachar_campaign_contacts no org_id and the
    product's INSERT writes (campaign_id, contact_id, email) only — the live
    column arrived with seed data and is NULL on every product-written row.
    Scoping on it would return zero sends for every real org."""
    sql, params = build("prachar.sends")
    assert "JOIN public.prachar_campaigns c ON c.id = r.campaign_id" in sql
    assert "c.org_id = $1::uuid" in sql
    assert "r.org_id" not in sql, "r.org_id is NULL on every product-written row"
    assert params == [ORG, WIN.start, WIN.end]


def test_sends_count_only_rows_the_send_loop_marked_sent():
    """'suppressed' (OUTBOUND_MODE gate — nothing left the building) and
    'failed' are not sends; on staging every outbound row is 'suppressed',
    so counting anything broader reports mail nobody received."""
    sql, _ = build("prachar.sends")
    assert "r.status = 'sent'" in sql
    assert "'suppressed'" not in sql and "'failed'" not in sql
    assert "r.sent_at::date BETWEEN $2::date AND $3::date" in sql


def test_sends_per_campaign_labels_by_name_and_never_selects_an_id():
    sql, params = build("prachar.sends", group_by="campaign")
    assert "SELECT c.name AS label" in sql
    # GROUP BY c.id so same-named campaigns stay distinct rows — but the id
    # itself never reaches the select list (names-not-ids).
    assert "GROUP BY c.id, c.name" in sql
    select_list = sql.split(" FROM ")[0]
    assert "c.id" not in select_list
    # The whole-window split still binds the window.
    assert params == [ORG, WIN.start, WIN.end]


def test_sends_never_read_the_campaign_counters():
    """total_sent is written only by the skills path and the router's own
    send loop finishes without writing it — the campaign counters are not a
    send count, the per-recipient rows are."""
    for kw in ({}, {"group_by": "campaign"}):
        sql, _ = build("prachar.sends", **kw)
        assert "total_sent" not in sql and "total_recipients" not in sql


# ── list_growth ──────────────────────────────────────────────────────────────

def test_list_growth_is_additions_minus_unsubscribes_with_both_shown():
    sql, params = build("prachar.list_growth")
    assert "SUM(added) - SUM(removed) AS value" in sql
    assert "SUM(added) AS added" in sql and "SUM(removed) AS unsubscribed" in sql
    assert "UNION ALL" in sql, "a bucket with only one leg must still appear"
    assert params == [ORG, WIN.start, WIN.end]


def test_list_growth_counts_only_marketable_undupped_contacts():
    sql, _ = build("prachar.list_growth")
    # No email — not on any send's audience — not an addition to the list.
    assert "COALESCE(g.email, '') <> ''" in sql
    # A folded duplicate was never a distinct audience member.
    assert "g.merged_into_id IS NULL" in sql
    assert "FROM public.prachar_unsubscribes" in sql
    assert "u.unsubscribed_at::date BETWEEN $2::date AND $3::date" in sql


def test_list_growth_buckets_both_legs():
    for b in ("day", "week", "month", "quarter", "year"):
        sql, _ = build("prachar.list_growth", bucket=b)
        assert sql.count(f"date_trunc('{b}'") == 2, b


# ── unsubscribe_rate ─────────────────────────────────────────────────────────

def test_unsubscribe_rate_is_sums_over_sums_with_the_counts_shown():
    sql, _ = build("prachar.unsubscribe_rate")
    assert "SUM(unsub)::float / NULLIF(SUM(send), 0)::float * 100" in sql
    assert "AVG(" not in sql, "the mean of per-campaign rates is not the period's rate"
    assert "SUM(unsub) AS unsubscribes" in sql and "SUM(send) AS sends" in sql


def test_unsubscribe_rate_denominator_is_real_sends_in_the_same_bucket():
    """Nothing attributes an unsubscribe to a campaign (the per-campaign
    counter is unwritten — migration 107), so same-bucket sends are the
    denominator, and only rows marked 'sent' qualify."""
    sql, _ = build("prachar.unsubscribe_rate")
    assert "r.status = 'sent'" in sql
    assert "JOIN public.prachar_campaigns c ON c.id = r.campaign_id" in sql
    assert "r.org_id" not in sql
    assert sql.count("$1::uuid") == 2, "both legs must be org-filtered"


def test_unsubscribe_rate_buckets_both_legs():
    for b in ("day", "week", "month", "quarter", "year"):
        sql, _ = build("prachar.unsubscribe_rate", bucket=b)
        assert sql.count(f"date_trunc('{b}'") == 2, b


# ── event_attendance ─────────────────────────────────────────────────────────

def test_event_attendance_is_attended_over_not_cancelled_from_sums():
    sql, params = build("prachar.event_attendance")
    assert ("COUNT(r.id) FILTER (WHERE r.status = 'attended')::float "
            "/ NULLIF(COUNT(r.id) FILTER (WHERE r.status <> 'cancelled'), 0)::float "
            "* 100") in sql
    assert "AS registered" in sql and "AS attended" in sql
    assert "AVG(" not in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_event_attendance_keeps_empty_events_without_inventing_registrations():
    """LEFT JOIN keeps a registration-less event; COUNT(r.id) — never
    COUNT(*) — keeps its row of NULLs from booking a phantom registration.
    r.org_id sits in the ON clause so the outer join survives it."""
    sql, _ = build("prachar.event_attendance")
    assert "LEFT JOIN public.prachar_event_registrations r" in sql
    assert "ON r.event_id = e.id AND r.org_id = $1::uuid" in sql
    assert "COUNT(*)" not in sql


def test_event_attendance_windows_on_the_event_not_the_registration():
    sql, _ = build("prachar.event_attendance")
    assert "e.starts_at::date BETWEEN $2::date AND $3::date" in sql
    assert "registered_at" not in sql
    # A cancelled event did not happen; its zero attendance must not drag
    # the period's rate.
    assert "e.status <> 'cancelled'" in sql
    assert "e.is_active = TRUE" in sql


def test_event_attendance_per_event_labels_by_title_and_never_selects_an_id():
    sql, _ = build("prachar.event_attendance", group_by="event")
    assert "SELECT e.title AS label" in sql
    assert "GROUP BY e.id, e.title" in sql
    select_list = sql.split(" FROM ")[0]
    assert "e.id" not in select_list
    assert "NULLS LAST" in sql, "null-rate (zero-reg) events must sink, not lead"


# ── leads_by_source ──────────────────────────────────────────────────────────

def test_leads_by_source_never_renders_the_empty_default_bare():
    sql, _ = build("prachar.leads_by_source", group_by="source")
    assert "COALESCE(NULLIF(g.source, ''), 'No source') AS label" in sql
    assert "ORDER BY value DESC, label" in sql


def test_leads_by_source_counts_converted_leads_and_excludes_duplicates():
    """A converted lead becomes contact_type='customer' — dropping it would
    bias attribution against exactly the channels that convert. Vendors and
    partners are not acquisitions. Merged duplicates fold into the survivor."""
    for kw in ({}, {"group_by": "source"}):
        sql, _ = build("prachar.leads_by_source", **kw)
        assert "g.contact_type IN ('lead', 'customer')" in sql
        assert "g.merged_into_id IS NULL" in sql
        assert "g.created_at::date BETWEEN $2::date AND $3::date" in sql


def test_leads_by_source_default_is_per_bucket_and_grouped_is_per_source():
    plain, _ = build("prachar.leads_by_source")
    assert "date_trunc('month', g.created_at)::date" in plain
    assert "NULLIF" not in plain
    grouped, _ = build("prachar.leads_by_source", group_by="source")
    assert "date_trunc" not in grouped


# ── the declared absences ────────────────────────────────────────────────────

def test_engagement_rates_are_absent_naming_the_unwritten_columns():
    """The catalogue's 'rates from sums' — and the sums do not exist. Nothing
    in the product writes opens, clicks or bounces (no webhook, no pixel, no
    redirect — services/engagement_metrics.py, migration 107), so each rate
    is a stated absence naming the exact columns nothing writes."""
    for key, column in (
        ("prachar.open_rate", "opened_at"),
        ("prachar.click_rate", "clicked_at"),
        ("prachar.bounce_rate", "total_bounced"),
    ):
        m = REGISTRY[key]
        assert m.sql is None and m.absent, key
        assert column in m.absent, f"{key} must name the unwritten column"
        assert "engagement_metrics" in m.absent, (
            f"{key} must cite the standing authority for the missing receiver"
        )


def test_ad_metrics_are_absent_naming_the_missing_spine_table():
    """Proposal 60's ingest spine is the prerequisite; until it exists these
    ship as absences that say so, not as numbers derived from Meta's
    self-reported per-account rows."""
    for key in ("prachar.ad_spend", "prachar.cpl", "prachar.roas"):
        m = REGISTRY[key]
        assert m.sql is None and m.absent, key
        assert "analytics_metrics_daily" in m.absent, (
            f"{key} must name the missing spine table"
        )
        assert m.sensitivity == "financial", key


def test_roas_absence_refuses_the_vendors_self_reported_number():
    assert "purchase_roas" in REGISTRY["prachar.roas"].absent


def test_cpl_absence_states_the_missing_attribution_too():
    assert "graha_contacts.source" in REGISTRY["prachar.cpl"].absent
