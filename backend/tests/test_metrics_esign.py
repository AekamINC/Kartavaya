"""The eSign metrics, held to the guards their docstring promises.

test_analytics_registry.py walks every declaration for the universal contract
once these modules are wired into load_all(); until then — and after, for the
metric-SPECIFIC guarantees — this file is the pin. What lives here is what a
refactor could drop while every universal check stays green: the send moment
read from the audit log (there is no sent_at column), signed % as counts over
counts, the median via percentile_cont rather than AVG, completion from
completed_at rather than a status equality, the lazy-expiry arm, and the rule
that a cancelled DRAFT is never an abandoned request.

Every assertion scans the SQL string the builder actually returns — never a
comment, never a docstring — so a change to the query is what changes a test.
"""
import re
from datetime import date

import analytics.metrics.esign  # noqa: F401 — registers on import; not yet in load_all()
from analytics.registry import REGISTRY, MetricRequest
from analytics.windowing import BUCKETS
from services.analytics_window import Window

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"

KEYS = ["esign.requests_sent", "esign.signed_rate",
        "esign.time_to_sign", "esign.abandoned"]


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
        "esign.requests_sent": ("flow", "count"),
        "esign.signed_rate": ("flow", "pct"),
        "esign.time_to_sign": ("flow", "days"),
        "esign.abandoned": ("stock", "count"),
    }
    for key, (grain, unit) in expect.items():
        m = REGISTRY[key]
        assert (m.grain, m.unit) == (grain, unit), key
        assert m.module == "esign"
        assert m.dimensions == ()
        assert m.sql is not None


def test_the_batch_passes_the_universal_rules_before_wiring():
    """A local copy of the registry walk's core assertions — these metrics are
    not in load_all() yet, so the universal test cannot see them until the
    integrator wires the import. This keeps the gap from being a blind spot."""
    for key in KEYS:
        m = REGISTRY[key]
        win = WIN if m.grain == "flow" else None
        sql, params = m.sql(MetricRequest(org_id=ORG, window=win, bucket="month"))
        assert re.search(r"\bstaging\.", sql), f"{key}: unqualified table"
        assert "$1::uuid" in sql, f"{key}: org parameter not cast"
        assert params[0] == ORG
        placeholders = {int(n) for n in re.findall(r"\$(\d+)", sql)}
        assert placeholders == set(range(1, len(params) + 1)), key
        if m.grain == "flow":
            assert params[1] == WIN.start and params[2] == WIN.end, key


def test_flows_honour_every_bucket():
    for key in KEYS:
        if REGISTRY[key].grain != "flow":
            continue
        for b in sorted(BUCKETS):
            sql, _ = build(key, bucket=b)
            assert f"date_trunc('{b}'" in sql and "::date" in sql, (key, b)


# ── requests_sent ────────────────────────────────────────────────────────────

def test_requests_sent_counts_the_audit_event_because_no_sent_at_exists():
    """The send moment lives ONLY in sign_audit_log ('document_sent', written
    once per document — resends write 'reminder_sent'). updated_at is
    overwritten by every later touch and must never be read as a send time."""
    sql, params = build("esign.requests_sent")
    assert "FROM staging.sign_audit_log a" in sql
    assert "a.action = 'document_sent'" in sql
    assert "a.created_at::date BETWEEN $2::date AND $3::date" in sql
    assert "updated_at" not in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_requests_sent_scopes_the_org_through_the_document():
    # sign_audit_log carries no org_id of its own — the join IS the scoping.
    sql, _ = build("esign.requests_sent")
    assert "JOIN staging.sign_documents d ON d.id = a.document_id" in sql
    assert "d.org_id = $1::uuid" in sql


# ── signed_rate ──────────────────────────────────────────────────────────────

def test_signed_rate_is_counts_over_counts_with_the_counts_shown():
    sql, _ = build("esign.signed_rate")
    assert ("COUNT(*) FILTER (WHERE d.completed_at IS NOT NULL)::float "
            "/ NULLIF(COUNT(*), 0)::float * 100") in sql
    assert "AS signed" in sql and "AS sent" in sql
    assert "AVG(" not in sql, "signed % is a ratio of counts, never an averaged rate"


def test_signed_rate_denominator_is_the_same_sent_event_base():
    sql, _ = build("esign.signed_rate")
    assert "a.action = 'document_sent'" in sql
    assert "d.org_id = $1::uuid" in sql


def test_signed_rate_reads_completion_from_completed_at_not_a_status():
    """The doc_status='final' trap, one module over: a status equality would
    silently drop documents if the ladder ever grows a value. completed_at is
    set once, when the last signer signs, and is the fact itself."""
    sql, _ = build("esign.signed_rate")
    assert "d.completed_at IS NOT NULL" in sql
    assert "status = 'completed'" not in sql


# ── time_to_sign ─────────────────────────────────────────────────────────────

def test_time_to_sign_is_a_median_in_fractional_days():
    sql, params = build("esign.time_to_sign")
    assert "percentile_cont(0.5) WITHIN GROUP" in sql
    assert "EXTRACT(EPOCH FROM (d.completed_at - s.sent_at)) / 86400.0" in sql
    assert "AVG(" not in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_time_to_sign_windows_on_completion_and_dedupes_the_send_event():
    sql, _ = build("esign.time_to_sign")
    assert "d.completed_at::date BETWEEN $2::date AND $3::date" in sql
    # MIN() so a duplicated audit row could never double-weight a document.
    assert "MIN(created_at) AS sent_at" in sql
    assert "action = 'document_sent'" in sql
    assert "d.org_id = $1::uuid" in sql


# ── abandoned ────────────────────────────────────────────────────────────────

def test_abandoned_is_a_stock_binding_only_the_org():
    _, params = build("esign.abandoned")
    assert params == [ORG]


def test_abandoned_names_the_three_deaths():
    sql, _ = build("esign.abandoned")
    for label in ("'declined'", "'cancelled'", "'expired'"):
        assert label in sql, label


def test_abandoned_reads_declines_from_signers_scoped_by_document():
    """The document row never records a decline — decline_signing touches only
    the signer. And sign_signers.org_id is NULLABLE on live (migration 114),
    so the signer probe must scope by document_id, never by signer org_id."""
    sql, _ = build("esign.abandoned")
    assert "sg.document_id = d.id AND sg.status = 'declined'" in sql
    assert "sg.org_id" not in sql and "sg2.org_id" not in sql


def test_abandoned_catches_lazily_unexpired_documents():
    """status='expired' is only written when someone opens a dead link; a
    document nobody re-opens sits at 'sent' with expires_at in the past.
    Dropping the clock arm would undercount expiry to near zero."""
    sql, _ = build("esign.abandoned")
    assert "d.expires_at < NOW()" in sql


def test_abandoned_never_counts_a_cancelled_draft():
    """A draft can be cancelled — that is a discarded form, not an abandoned
    request. Cancelled rows must show the 'document_sent' audit event; the
    other statuses imply sent-ness on their own."""
    sql, _ = build("esign.abandoned")
    assert "d.status <> 'draft'" in sql
    assert "d.status <> 'cancelled' OR EXISTS" in sql
    assert "a.action = 'document_sent'" in sql


def test_abandoned_excludes_completed_and_in_flight_documents():
    sql, _ = build("esign.abandoned")
    assert "d.completed_at IS NULL" in sql
    # In-flight = not cancelled/expired-by-status, clock still running, no
    # decline — reachable only through the three-way OR, so all three arms
    # must be present for "pending is not abandoned" to hold.
    assert "d.status IN ('cancelled', 'expired')" in sql
