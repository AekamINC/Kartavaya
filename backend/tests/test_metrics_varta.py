"""The Varta (WhatsApp) metrics, held to the guards their docstring promises.

The metric-specific pins: suppressed rows out of every count and denominator
(a dry-run month must not read as a delivery collapse), direction='outbound'
everywhere (inbound rows are born 'delivered' and would poison every rate),
read ⊂ delivered on Meta's ladder, replies as a later inbound in the same
conversation, and the two declared absences — template rejections have no
writer, conversation cost has no column, both by design.

Every assertion scans the SQL string the builder actually returns — never a
comment, never a docstring — so a change to the query is what changes a test.
"""
import re
from datetime import date

import analytics.metrics.varta  # noqa: F401 — registers on import; not yet in load_all()
from analytics.registry import REGISTRY, MetricRequest
from analytics.windowing import BUCKETS
from services.analytics_window import Window

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"

SQL_KEYS = ["varta.sends", "varta.delivery_rate",
            "varta.read_rate", "varta.reply_rate"]
ABSENT_KEYS = ["varta.template_rejections", "varta.cost_per_conversation"]


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
        "varta.sends": ("flow", "count"),
        "varta.delivery_rate": ("flow", "pct"),
        "varta.read_rate": ("flow", "pct"),
        "varta.reply_rate": ("flow", "pct"),
    }
    for key, (grain, unit) in expect.items():
        m = REGISTRY[key]
        assert (m.grain, m.unit) == (grain, unit), key
        assert m.module == "varta"
        assert m.sql is not None
    assert REGISTRY["varta.sends"].dimensions == ("template",)


def test_the_batch_passes_the_universal_rules_before_wiring():
    """A local copy of the registry walk's core assertions — these metrics are
    not in load_all() yet, so the universal test cannot see them until the
    integrator wires the import. This keeps the gap from being a blind spot."""
    for key in SQL_KEYS:
        m = REGISTRY[key]
        sql, params = m.sql(MetricRequest(org_id=ORG, window=WIN, bucket="month"))
        assert re.search(r"\bpublic\.", sql), f"{key}: unqualified table"
        assert "$1::uuid" in sql, f"{key}: org parameter not cast"
        assert params[0] == ORG
        placeholders = {int(n) for n in re.findall(r"\$(\d+)", sql)}
        assert placeholders == set(range(1, len(params) + 1)), key
        assert params[1] == WIN.start and params[2] == WIN.end, key


def test_flows_honour_every_bucket():
    for key in SQL_KEYS:
        for b in sorted(BUCKETS):
            sql, _ = build(key, bucket=b)
            assert f"date_trunc('{b}'" in sql and "::date" in sql, (key, b)


def test_every_metric_is_outbound_only_and_never_counts_suppressed():
    """Inbound rows are born 'delivered' by the webhook — inside any rate they
    would count the customer's own messages. And 'suppressed' (migration 147)
    means OUTBOUND_MODE stopped the message before Meta saw it: not a send,
    not a denominator member — 1,562 reminders once said 'sent' while every
    outbound row said 'suppressed', and a metric must not retell that lie."""
    for key in SQL_KEYS:
        sql, _ = build(key)
        assert "direction = 'outbound'" in sql, key
        assert "status <> 'suppressed'" in sql, key
        assert "FROM public.varta_messages" in sql, key


# ── sends ────────────────────────────────────────────────────────────────────

def test_sends_default_is_per_bucket_and_grouped_is_per_template():
    plain, params = build("varta.sends")
    assert "date_trunc('month', created_at)::date" in plain
    assert "template_name" not in plain
    assert params == [ORG, WIN.start, WIN.end]
    grouped, gparams = build("varta.sends", group_by="template")
    assert "GROUP BY 1 ORDER BY value DESC" in grouped
    assert gparams == [ORG, WIN.start, WIN.end]


def test_sends_grouped_labels_free_form_honestly():
    # template_name is NULL on session messages — they are still sends, and
    # the label must be words, never a NULL or an empty string.
    grouped, _ = build("varta.sends", group_by="template")
    assert ("COALESCE(NULLIF(template_name, ''), 'Free-form message') "
            "AS template") in grouped


def test_sends_grouped_still_excludes_suppressed_and_inbound():
    grouped, _ = build("varta.sends", group_by="template")
    assert "direction = 'outbound'" in grouped
    assert "status <> 'suppressed'" in grouped


# ── delivery_rate ────────────────────────────────────────────────────────────

def test_delivery_rate_is_counts_over_counts_with_the_counts_shown():
    sql, _ = build("varta.delivery_rate")
    assert ("COUNT(*) FILTER (WHERE status IN ('delivered', 'read'))::float "
            "/ NULLIF(COUNT(*), 0)::float * 100") in sql
    assert "AS delivered" in sql and "AS sends" in sql
    assert "AVG(" not in sql, "a rate is counts over counts, never an averaged rate"


def test_delivery_rate_counts_read_as_delivered():
    # Meta's ladder overwrites the status in place: a 'read' message WAS
    # delivered, and counting only 'delivered' would undercount delivery by
    # exactly the engagement rate.
    sql, _ = build("varta.delivery_rate")
    assert "status IN ('delivered', 'read')" in sql


# ── read_rate ────────────────────────────────────────────────────────────────

def test_read_rate_is_strictly_read_not_delivered():
    sql, _ = build("varta.read_rate")
    assert "COUNT(*) FILTER (WHERE status = 'read')" in sql
    assert "IN ('delivered', 'read')" not in sql
    assert "AS reads" in sql and "AS sends" in sql
    assert "AVG(" not in sql


# ── reply_rate ───────────────────────────────────────────────────────────────

def test_reply_rate_is_a_later_inbound_in_the_same_conversation():
    sql, _ = build("varta.reply_rate")
    assert "r.conversation_id = m.conversation_id" in sql
    assert "r.direction = 'inbound'" in sql
    assert "r.created_at > m.created_at" in sql, \
        "an inbound BEFORE the send is the prompt, not the reply"


def test_reply_rate_filters_both_sides_to_the_org():
    sql, params = build("varta.reply_rate")
    assert sql.count("$1::uuid") == 2, "outbound base AND reply probe must both be org-filtered"
    assert params == [ORG, WIN.start, WIN.end]


def test_reply_rate_is_counts_over_counts_with_the_counts_shown():
    sql, _ = build("varta.reply_rate")
    assert ("COUNT(*) FILTER (WHERE replied)::float "
            "/ NULLIF(COUNT(*), 0)::float * 100") in sql
    assert "AS replied" in sql and "AS sends" in sql
    assert "AVG(" not in sql


# ── the declared absences ────────────────────────────────────────────────────

def test_template_rejections_is_absent_because_nothing_writes_a_rejection():
    m = REGISTRY["varta.template_rejections"]
    assert m.sql is None
    assert len(m.absent) > 60
    # The reason must name the unbuilt writer, not just wave at the column.
    assert "draft" in m.absent
    assert "message_template_status_update" in m.absent


def test_cost_per_conversation_is_absent_because_no_cost_column_exists():
    m = REGISTRY["varta.cost_per_conversation"]
    assert m.sql is None
    assert m.sensitivity == "financial"
    assert len(m.absent) > 60
    # The reason must state that this is a decision — Meta bills the org —
    # so nobody "fixes" it by inventing a per-message debit.
    assert "cost" in m.absent.lower()
    assert "Meta bills the org" in m.absent
