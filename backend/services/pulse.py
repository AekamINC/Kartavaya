"""Pulse — Aekam-only analytics about the PRODUCT itself (proposal 68).

Who uses Kartavaya, how much, and where the energy is — never a tenant's
business content. Every metric here returns counts, org NAMES and dates
only: no member's name, no email, no per-person row, no uuid in any output
column. The router (routers/pulse.py) gates the whole surface on the
platform console roles and writes an audit row per catalog fetch and per
export — the same discipline the DPDP attendance surface follows.

── A SEPARATE REGISTRY, DELIBERATELY ────────────────────────────────────────
The declaration idiom is the tenant registry's (analytics/registry.py: the
same Metric dataclass, the same meta shape, module='pulse' on every key) so
the existing board frontend renders Pulse metas unchanged. But these metrics
are held in PULSE_REGISTRY, never register()ed into the shared REGISTRY:
`middleware.module_levels.held_level` answers "admin" for ANY module code
when the caller is an org owner/admin, so a 'pulse' entry in the shared dict
would surface platform-wide metrics in every org admin's tenant catalogue
and let them arm tenant alerts on numbers about other people's orgs. The
split IS the tenancy boundary.

── WHAT "ACTIVITY" HONESTLY MEANS HERE ──────────────────────────────────────
There is no per-request usage event (proposal 68 lists "per-screen usage" as
NEEDS COLLECTION). The activity sources that exist today, measured live
2026-08-18:

  · staging.audit_log — auth.login plus every audited action (user_id, ts;
    1,167 rows since June). Logins ARE audited, so this is the floor under
    "was this person here today".
  · public.activity_events — task-level actions (actor_id, created_at;
    1,291 rows). Org attribution hops team_id -> public.teams.org_id, the
    same text-keyed join analytics/metrics/core.py stands on.
  · staging.pahchan_punches — attendance punches (org activity, but
    employee_id is not a users row, so punches never count toward USER
    activity).

A user who keeps a signed-in tab open and only READS leaves no trace in any
of these, so the user-activity metrics UNDER-COUNT quiet readers — each
description says so rather than overclaiming. staging.niyam_events is
deliberately NOT an activity source: most of its rows are emitted by the
sweep (invoice.overdue, task.overdue), which is the product talking to
itself, not a person using the product.

Org metrics exclude the platform org (Aekam Inc, is_platform_org): Pulse
measures customers, and Aekam's own daily use of its own product would
otherwise top every leaderboard.

Every table is schema-qualified (the shadow-tables lesson, migration 142)
and every ambiguous bind is cast — PgBouncer turns an untyped parse error
into an instant 500. All sources are small today (thousands of rows); the
UNION ALL spines are measured, not guessed.
"""
from __future__ import annotations

import logging
import re

from analytics.registry import Metric, MetricRequest
from analytics.windowing import bucket_expr

log = logging.getLogger(__name__)

#: key -> Metric. The Pulse catalogue, and nothing else's. See the module
#: docstring for why this is not the shared REGISTRY.
PULSE_REGISTRY: dict[str, Metric] = {}


def _register(m: Metric) -> Metric:
    if m.key in PULSE_REGISTRY:
        raise ValueError(f"duplicate pulse metric key: {m.key}")
    PULSE_REGISTRY[m.key] = m
    return m


def pulse_metric(**kwargs):
    """The tenant registry's @metric idiom, writing to PULSE_REGISTRY."""
    def deco(fn):
        _register(Metric(sql=fn, module="pulse", **kwargs))
        return fn
    return deco


def pulse_absent(**kwargs) -> Metric:
    """A stated absence (proposal 62 §10) — the house pattern, Pulse's copy."""
    if not kwargs.get("absent"):
        raise ValueError("pulse_absent requires absent=<reason>")
    return _register(Metric(module="pulse", **kwargs))


# ── the activity spines ──────────────────────────────────────────────────────
# CTE bodies, not full queries: each metric owns its outer SELECT. `uid` rows
# join public.users so system accounts (is_system — the Niyam actor and
# friends) never count as people.

#: (uid, happened_at) — every trace a PERSON left. Alias is happened_at, not
#: `at`: AT is a keyword and not worth arguing with the parser about.
_USER_ACTS = (
    "SELECT a.user_id AS uid, a.ts AS happened_at "
    "  FROM public.audit_log a WHERE a.user_id IS NOT NULL "
    "UNION ALL "
    "SELECT e.actor_id AS uid, e.created_at AS happened_at "
    "  FROM public.activity_events e WHERE e.actor_id IS NOT NULL "
)

#: (org_id, happened_at) — every trace an ORG left, punches included: an org
#: whose people punch attendance every morning is an org using the product.
_ORG_ACTS = (
    "SELECT a.org_id, a.ts AS happened_at "
    "  FROM public.audit_log a WHERE a.org_id IS NOT NULL "
    "UNION ALL "
    "SELECT tm.org_id, e.created_at AS happened_at "
    "  FROM public.activity_events e "
    "  JOIN public.teams tm ON tm.team_id = e.team_id "
    " WHERE tm.org_id IS NOT NULL "
    "UNION ALL "
    "SELECT p.org_id, p.captured_at AS happened_at "
    "  FROM public.pahchan_punches p WHERE p.org_id IS NOT NULL "
)

#: The customer-org filter, applied wherever orgs are listed or counted.
_CUSTOMER_ORG = (
    "COALESCE(o.is_active, TRUE) AND NOT COALESCE(o.is_platform_org, FALSE) "
)

#: Real people only — the same is_system flag auth writes.
_PERSON = "NOT COALESCE(u.is_system, FALSE) "

#: The honesty sentence the three active-user metrics share.
_PROXY_NOTE = (
    "Counted from audited actions (logins included) and task activity — "
    "there is no per-request usage event yet, so a signed-in user who only "
    "reads is under-counted."
)


@pulse_metric(
    key="pulse.active_users",
    label="Daily active users",
    unit="count",
    grain="flow",
    description="Distinct people with any recorded action per day — the "
                "platform's heartbeat. " + _PROXY_NOTE,
)
def active_users(req: MetricRequest):
    period = bucket_expr(req.bucket, "s.happened_at")
    return (
        f"WITH acts AS ({_USER_ACTS}) "
        f"SELECT {period} AS period, COUNT(DISTINCT s.uid)::int AS value "
        "  FROM acts s "
        "  JOIN public.users u ON u.user_id = s.uid "
        f" WHERE {_PERSON}"
        "   AND s.happened_at::date BETWEEN $1::date AND $2::date "
        " GROUP BY 1 ORDER BY 1",
        [req.window.start, req.window.end],
    )


@pulse_metric(
    key="pulse.active_users_week",
    label="Active this week",
    unit="count",
    grain="stock",
    description="Distinct people with any recorded action in the last 7 "
                "days, as at now. " + _PROXY_NOTE,
)
def active_users_week(req: MetricRequest):
    return (
        f"WITH acts AS ({_USER_ACTS}) "
        "SELECT COUNT(DISTINCT s.uid)::int AS value "
        "  FROM acts s JOIN public.users u ON u.user_id = s.uid "
        f" WHERE {_PERSON}"
        "   AND s.happened_at >= now() - interval '7 days'",
        [],
    )


@pulse_metric(
    key="pulse.active_users_month",
    label="Active this month",
    unit="count",
    grain="stock",
    description="Distinct people with any recorded action in the last 30 "
                "days, as at now. " + _PROXY_NOTE,
)
def active_users_month(req: MetricRequest):
    return (
        f"WITH acts AS ({_USER_ACTS}) "
        "SELECT COUNT(DISTINCT s.uid)::int AS value "
        "  FROM acts s JOIN public.users u ON u.user_id = s.uid "
        f" WHERE {_PERSON}"
        "   AND s.happened_at >= now() - interval '30 days'",
        [],
    )


@pulse_metric(
    key="pulse.active_orgs",
    label="Orgs active today",
    unit="count",
    grain="stock",
    description="Customer orgs with any activity today (logins, task "
                "actions or attendance punches), beside the total. The "
                "platform org is excluded — Pulse measures customers.",
)
def active_orgs(req: MetricRequest):
    return (
        f"WITH acts AS ({_ORG_ACTS}) "
        "SELECT (SELECT COUNT(DISTINCT s.org_id) "
        "          FROM acts s JOIN public.organisations o ON o.id = s.org_id "
        f"        WHERE {_CUSTOMER_ORG}"
        "           AND s.happened_at::date = CURRENT_DATE)::int AS value, "
        "       (SELECT COUNT(*) FROM public.organisations o "
        f"        WHERE {_CUSTOMER_ORG})::int AS total",
        [],
    )


@pulse_metric(
    key="pulse.quiet_orgs",
    label="Quiet orgs (7+ days)",
    unit="count",
    grain="stock",
    description="Customer orgs silent for 7 or more days — the churn "
                "early-warning. Org names and dates only; 'never' means no "
                "activity has ever been recorded for the org.",
)
def quiet_orgs(req: MetricRequest):
    return (
        f"WITH acts AS ({_ORG_ACTS}), "
        "last AS (SELECT s.org_id, MAX(s.happened_at) AS last_at "
        "           FROM acts s GROUP BY 1) "
        "SELECT o.name AS label, "
        "       COALESCE(l.last_at::date::text, 'never') AS last_active, "
        "       COALESCE(CURRENT_DATE - l.last_at::date, "
        "                CURRENT_DATE - o.created_at::date)::int AS days_quiet "
        "  FROM public.organisations o "
        "  LEFT JOIN last l ON l.org_id = o.id "
        f" WHERE {_CUSTOMER_ORG}"
        "   AND (l.last_at IS NULL OR l.last_at < now() - interval '7 days') "
        " ORDER BY 3 DESC, 1",
        [],
    )


@pulse_metric(
    key="pulse.new_signups",
    label="New signups",
    unit="count",
    grain="flow",
    description="New users (value) and new customer orgs per period, by "
                "account creation date. System accounts and the platform "
                "org are excluded.",
)
def new_signups(req: MetricRequest):
    u_period = bucket_expr(req.bucket, "u.created_at")
    o_period = bucket_expr(req.bucket, "o.created_at")
    return (
        "SELECT period, SUM(users)::int AS value, SUM(orgs)::int AS orgs FROM ("
        f"SELECT {u_period} AS period, COUNT(*) AS users, 0 AS orgs "
        "  FROM public.users u "
        f" WHERE {_PERSON}"
        "   AND u.created_at::date BETWEEN $1::date AND $2::date "
        " GROUP BY 1 "
        "UNION ALL "
        f"SELECT {o_period} AS period, 0 AS users, COUNT(*) AS orgs "
        "  FROM public.organisations o "
        " WHERE NOT COALESCE(o.is_platform_org, FALSE) "
        "   AND o.created_at::date BETWEEN $1::date AND $2::date "
        " GROUP BY 1"
        ") x GROUP BY 1 ORDER BY 1",
        [req.window.start, req.window.end],
    )


@pulse_metric(
    key="pulse.activation",
    label="Activation within 7 days",
    unit="pct",
    grain="flow",
    description="Of users created in the period, the share with a recorded "
                "action within 7 days of signup. " + _PROXY_NOTE,
)
def activation(req: MetricRequest):
    period = bucket_expr(req.bucket, "u.created_at")
    return (
        f"WITH acts AS ({_USER_ACTS}), "
        "f AS (SELECT s.uid, MIN(s.happened_at) AS first_act "
        "        FROM acts s GROUP BY 1) "
        f"SELECT {period} AS period, "
        "       ROUND(100.0 * COUNT(*) FILTER "
        "             (WHERE f.first_act <= u.created_at + interval '7 days') "
        "             / COUNT(*), 1)::float AS value, "
        "       COUNT(*)::int AS signups, "
        "       (COUNT(*) FILTER (WHERE f.first_act <= "
        "                         u.created_at + interval '7 days'))::int AS activated "
        "  FROM public.users u "
        "  LEFT JOIN f ON f.uid = u.user_id "
        f" WHERE {_PERSON}"
        "   AND u.created_at::date BETWEEN $1::date AND $2::date "
        " GROUP BY 1 ORDER BY 1",
        [req.window.start, req.window.end],
    )


@pulse_metric(
    key="pulse.stickiness",
    label="Stickiness (DAU/MAU)",
    unit="pct",
    grain="stock",
    description="Average daily actives over the last 30 days, as a share of "
                "distinct actives in those 30 days — how habitual the "
                "product is. " + _PROXY_NOTE,
)
def stickiness(req: MetricRequest):
    return (
        f"WITH acts AS ({_USER_ACTS}), "
        "d AS (SELECT s.happened_at::date AS day, s.uid "
        "        FROM acts s JOIN public.users u ON u.user_id = s.uid "
        f"      WHERE {_PERSON}"
        "         AND s.happened_at >= now() - interval '30 days'), "
        "dau AS (SELECT day, COUNT(DISTINCT uid) AS n FROM d GROUP BY 1) "
        "SELECT ROUND(100.0 * COALESCE(AVG(dau.n), 0) "
        "             / GREATEST((SELECT COUNT(DISTINCT uid) FROM d), 1), "
        "             1)::float AS value "
        "  FROM dau",
        [],
    )


@pulse_metric(
    key="pulse.module_share",
    label="Actions by module",
    unit="count",
    grain="flow",
    description="What people actually use: rows created per module during "
                "the period, each module counted from its own tables "
                "(task actions, punches, invoices and payments, chat "
                "messages, CRM contacts and deals, eSign documents, "
                "campaigns, sales orders, WhatsApp messages). Modules with "
                "nothing in the period are omitted, not shown as zero.",
)
def module_share(req: MetricRequest):
    # One arm per SOURCE table, folded by module label — mkt_campaigns is
    # empty on the live DB (measured 2026-08-18); prachar_campaigns is the
    # live marketing table.
    w = "::date BETWEEN $1::date AND $2::date "
    return (
        "SELECT label, SUM(n)::int AS value FROM ("
        "SELECT 'Tasks & projects' AS label, COUNT(*) AS n "
        f"  FROM public.activity_events e WHERE e.created_at{w}"
        "UNION ALL SELECT 'Attendance (Pahchan)', COUNT(*) "
        f"  FROM public.pahchan_punches p WHERE p.captured_at{w}"
        "UNION ALL SELECT 'Finance (Ganit)', COUNT(*) "
        f"  FROM public.ganit_invoices i WHERE i.created_at{w}"
        "UNION ALL SELECT 'Finance (Ganit)', COUNT(*) "
        f"  FROM public.ganit_payments pay WHERE pay.created_at{w}"
        "UNION ALL SELECT 'Chat (Sanvaad)', COUNT(*) "
        f"  FROM public.samvada_messages sm WHERE sm.created_at{w}"
        "UNION ALL SELECT 'CRM (Graha)', COUNT(*) "
        f"  FROM public.graha_contacts gc WHERE gc.created_at{w}"
        "UNION ALL SELECT 'CRM (Graha)', COUNT(*) "
        f"  FROM public.graha_deals gd WHERE gd.created_at{w}"
        "UNION ALL SELECT 'eSign', COUNT(*) "
        f"  FROM public.sign_documents sd WHERE sd.created_at{w}"
        "UNION ALL SELECT 'Marketing (Prachar)', COUNT(*) "
        f"  FROM public.prachar_campaigns pc WHERE pc.created_at{w}"
        "UNION ALL SELECT 'Sales (Vikray)', COUNT(*) "
        f"  FROM public.vikray_orders vo WHERE vo.created_at{w}"
        "UNION ALL SELECT 'WhatsApp (Varta)', COUNT(*) "
        f"  FROM public.varta_messages vm WHERE vm.created_at{w}"
        ") x GROUP BY 1 HAVING SUM(n) > 0 ORDER BY 2 DESC, 1",
        [req.window.start, req.window.end],
    )


@pulse_metric(
    key="pulse.top_orgs",
    label="Most active orgs",
    unit="count",
    grain="flow",
    description="Actions per customer org during the period — logins, task "
                "actions and attendance punches. Org names, never people.",
)
def top_orgs(req: MetricRequest):
    return (
        f"WITH acts AS ({_ORG_ACTS}) "
        "SELECT o.name AS label, COUNT(*)::int AS value "
        "  FROM acts s "
        "  JOIN public.organisations o ON o.id = s.org_id "
        f" WHERE {_CUSTOMER_ORG}"
        "   AND s.happened_at::date BETWEEN $1::date AND $2::date "
        " GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 25",
        [req.window.start, req.window.end],
    )


@pulse_metric(
    key="pulse.clockins",
    label="Clock-ins",
    unit="count",
    grain="flow",
    description="Attendance punches per period (value) and distinct people "
                "punching — Pahchan's real reach. Counts only; who punched "
                "stays inside the tenant's own attendance surface.",
)
def clockins(req: MetricRequest):
    period = bucket_expr(req.bucket, "p.captured_at")
    return (
        f"SELECT {period} AS period, COUNT(*)::int AS value, "
        "       COUNT(DISTINCT p.employee_id)::int AS punchers "
        "  FROM public.pahchan_punches p "
        " WHERE p.captured_at::date BETWEEN $1::date AND $2::date "
        " GROUP BY 1 ORDER BY 1",
        [req.window.start, req.window.end],
    )


@pulse_metric(
    key="pulse.retention_cohorts",
    label="Org retention cohorts",
    unit="count",
    grain="stock",
    description="Customer orgs by signup month, and how many were still "
                "active N weeks after signup — 'active' meaning their "
                "latest recorded activity is at least N weeks past their "
                "signup date.",
)
def retention_cohorts(req: MetricRequest):
    week = "(COUNT(*) FILTER (WHERE l.last_at >= o.created_at + interval '{0}'))::int"
    return (
        f"WITH acts AS ({_ORG_ACTS}), "
        "last AS (SELECT s.org_id, MAX(s.happened_at) AS last_at "
        "           FROM acts s GROUP BY 1) "
        "SELECT to_char(date_trunc('month', o.created_at), 'YYYY-MM') AS cohort, "
        "       COUNT(*)::int AS orgs, "
        f"       {week.format('7 days')} AS week_1, "
        f"       {week.format('28 days')} AS week_4, "
        f"       {week.format('56 days')} AS week_8, "
        f"       {week.format('84 days')} AS week_12 "
        "  FROM public.organisations o "
        "  LEFT JOIN last l ON l.org_id = o.id "
        " WHERE NOT COALESCE(o.is_platform_org, FALSE) "
        " GROUP BY 1 ORDER BY 1",
        [],
    )


@pulse_metric(
    key="pulse.churn_risk",
    label="Churn risk",
    unit="count",
    grain="stock",
    description="Customer orgs whose last-30-day activity fell against the "
                "prior 30 days, ranked by the drop. An org absent here is "
                "flat or growing.",
)
def churn_risk(req: MetricRequest):
    return (
        f"WITH acts AS ({_ORG_ACTS}), "
        "w AS (SELECT s.org_id, "
        "             COUNT(*) FILTER (WHERE s.happened_at >= "
        "                              now() - interval '30 days') AS recent, "
        "             COUNT(*) FILTER (WHERE s.happened_at >= "
        "                                    now() - interval '60 days' "
        "                              AND s.happened_at < "
        "                                    now() - interval '30 days') AS prior "
        "        FROM acts s GROUP BY 1) "
        "SELECT o.name AS label, w.recent::int AS last_30d, "
        "       w.prior::int AS prior_30d, "
        "       ROUND(100.0 * (w.prior - w.recent) / w.prior, 1)::float AS drop_pct "
        "  FROM w "
        "  JOIN public.organisations o ON o.id = w.org_id "
        f" WHERE {_CUSTOMER_ORG}"
        "   AND w.prior > 0 AND w.recent < w.prior "
        " ORDER BY 4 DESC, 1",
        [],
    )


@pulse_metric(
    key="pulse.outbound_health",
    label="Outbound health",
    unit="count",
    grain="flow",
    description="Outbound sends by purpose and status per period, from the "
                "one outbound ledger (public.outbound_log) — delivered "
                "beside suppressed beside failed, live now that sending is "
                "real.",
)
def outbound_health(req: MetricRequest):
    period = bucket_expr(req.bucket, "l.ts")
    return (
        f"SELECT {period} AS period, l.purpose AS purpose, "
        "       l.status AS status, COUNT(*)::int AS value "
        "  FROM public.outbound_log l "
        " WHERE l.ts::date BETWEEN $1::date AND $2::date "
        " GROUP BY 1, 2, 3 ORDER BY 1, 2, 3",
        [req.window.start, req.window.end],
    )


@pulse_metric(
    key="pulse.credit_burn",
    label="Credit burn",
    unit="count",
    grain="stock",
    description="Credits spent per customer org in the last 30 days "
                "(debits from the one ledger), beside the balance now. "
                "near_zero flags a balance of 10 credits or fewer — the "
                "top-up conversation to have this week.",
)
def credit_burn(req: MetricRequest):
    # amount is negative on debit rows (measured live: every tx_type='debit'
    # row is < 0), so spend is -SUM.
    return (
        "WITH spend AS (SELECT t.org_id, -SUM(t.amount) AS spent "
        "                 FROM public.hub_org_credit_transactions t "
        "                WHERE t.tx_type = 'debit' "
        "                  AND t.created_at >= now() - interval '30 days' "
        "                GROUP BY 1) "
        "SELECT o.name AS label, COALESCE(s.spent, 0)::int AS spent_30d, "
        "       COALESCE(c.balance, 0)::int AS balance, "
        "       (COALESCE(c.balance, 0) <= 10) AS near_zero "
        "  FROM public.organisations o "
        "  LEFT JOIN public.hub_org_credits c ON c.org_id = o.id "
        "  LEFT JOIN spend s ON s.org_id = o.id "
        f" WHERE {_CUSTOMER_ORG}"
        " ORDER BY 2 DESC, 1",
        [],
    )


@pulse_metric(
    key="pulse.storage",
    label="Storage per org",
    unit="count",
    grain="stock",
    description="Upload volume against R2 per customer org, in MB, from the "
                "counter the upload path maintains "
                "(organisations.storage_used_bytes) — cost attribution per "
                "tenant. pct_of_limit is empty for orgs with no plan limit "
                "set, not zero.",
)
def storage(req: MetricRequest):
    return (
        "SELECT o.name AS label, "
        "       ROUND(COALESCE(o.storage_used_bytes, 0) / 1048576.0, 2)::float AS used_mb, "
        "       CASE WHEN COALESCE(o.storage_limit_bytes, 0) > 0 "
        "            THEN ROUND(100.0 * COALESCE(o.storage_used_bytes, 0) "
        "                       / o.storage_limit_bytes, 1)::float "
        "       END AS pct_of_limit "
        "  FROM public.organisations o "
        f" WHERE {_CUSTOMER_ORG}"
        " ORDER BY COALESCE(o.storage_used_bytes, 0) DESC, o.name",
        [],
    )


# ── the two owner-approved collectors' metrics (proposal 68) ─────────────────
# Both read tables migration 156 creates — NOT YET APPLIED, so both metrics
# legitimately answer zero rows until it is and logins accrue. The SQL is
# deliberately plain enough to review by eye: neither table can be live-probed
# before the migration, so review is the only check these two queries get.

@pulse_metric(
    key="pulse.surface_os",
    label="Where Kartavaya runs",
    unit="count",
    grain="flow",
    description="Logins by surface and OS per period — 'Web · Windows', "
                "'Android app' — from the one User-Agent parse at login "
                "(proposal 68). Only the parsed enums are ever stored; the "
                "raw User-Agent string is discarded at the door. Empty until "
                "migration 156 is applied and logins accrue.",
)
def surface_os(req: MetricRequest):
    # The CASE spells out the WHOLE enum the parser can emit, Apple values
    # included, so those rows carry their proper names the day that build
    # ships. An unrecognised pair (impossible today — the parser is the only
    # writer) folds into 'Web · other' rather than vanishing.
    return (
        "SELECT CASE l.surface || '/' || l.os "
        "         WHEN 'app/android' THEN 'Android app' "
        "         WHEN 'app/ios' THEN 'iOS app' "
        "         WHEN 'app/ipados' THEN 'iPadOS app' "
        "         WHEN 'web/windows' THEN 'Web · Windows' "
        "         WHEN 'web/macos' THEN 'Web · macOS' "
        "         WHEN 'web/linux' THEN 'Web · Linux' "
        "         ELSE 'Web · other' END AS label, "
        "       COUNT(*)::int AS value "
        "  FROM public.pulse_logins l "
        " WHERE l.occurred_at::date BETWEEN $1::date AND $2::date "
        " GROUP BY 1 ORDER BY 2 DESC, 1",
        [req.window.start, req.window.end],
    )


@pulse_metric(
    key="pulse.app_versions",
    label="App version adoption",
    unit="count",
    grain="stock",
    description="People per phone-app version — one row per person, latest "
                "version wins — from the X-App-Version header the app states "
                "on its calls. Answers 'did the OTA land?' the day after a "
                "release. Empty until migration 156 is applied and the "
                "header-carrying build reaches devices.",
)
def app_versions(req: MetricRequest):
    return (
        "SELECT v.version AS label, COUNT(*)::int AS value "
        "  FROM public.pulse_app_versions v "
        " GROUP BY 1 ORDER BY 2 DESC, 1",
        [],
    )


# ── stated absence — the house pattern, not a convincing zero ────────────────

pulse_absent(
    key="pulse.api_health",
    label="API health",
    unit="count",
    grain="stock",
    absent="measured in Railway and Sentry — linked, not queried",
)


# ── the default board — CODE, not a row (the presets-are-code rule, 149) ─────

#: What a platform account sees before saving anything: the proposal 68
#: dashboard, top to bottom. Every key must exist in PULSE_REGISTRY —
#: tests/test_pulse.py walks it.
DEFAULT_LAYOUT: list[dict] = [
    {"metric": "pulse.active_users_week", "viz": "kpi", "w": 3},
    {"metric": "pulse.active_users_month", "viz": "kpi", "w": 3},
    {"metric": "pulse.active_orgs", "viz": "kpi", "w": 3},
    {"metric": "pulse.stickiness", "viz": "kpi", "w": 3},
    {"metric": "pulse.active_users", "viz": "trend", "w": 6},
    {"metric": "pulse.clockins", "viz": "trend", "w": 6},
    {"metric": "pulse.module_share", "viz": "bars", "w": 6},
    {"metric": "pulse.top_orgs", "viz": "table", "w": 6},
    {"metric": "pulse.surface_os", "viz": "bars", "w": 6},
    {"metric": "pulse.app_versions", "viz": "table", "w": 6},
    {"metric": "pulse.new_signups", "viz": "trend", "w": 6},
    {"metric": "pulse.activation", "viz": "trend", "w": 6},
    {"metric": "pulse.outbound_health", "viz": "bars", "w": 6},
    {"metric": "pulse.quiet_orgs", "viz": "table", "w": 6},
    {"metric": "pulse.churn_risk", "viz": "table", "w": 6},
    {"metric": "pulse.credit_burn", "viz": "table", "w": 6},
    {"metric": "pulse.retention_cohorts", "viz": "table", "w": 6},
    {"metric": "pulse.storage", "viz": "table", "w": 6},
]

#: Default viz per metric — the catalog carries it so the board's picker can
#: offer a sensible first drawing without hardcoding Pulse knowledge.
PULSE_VIZ: dict[str, str] = {w["metric"]: w["viz"] for w in DEFAULT_LAYOUT}


def pulse_catalogue() -> list[dict]:
    """Every Pulse meta, in the tenant catalogue's exact shape plus `viz` —
    module:'pulse' on every entry so the board frontend renders them
    unchanged. Declared-absent metrics ARE listed, with their reason."""
    out = []
    for m in sorted(PULSE_REGISTRY.values(), key=lambda m: m.key):
        entry = {
            "key": m.key, "module": m.module, "label": m.label,
            "unit": m.unit, "grain": m.grain,
            "dimensions": list(m.dimensions),
            "sensitivity": m.sensitivity, "drill": m.drill,
            "description": m.description,
            "viz": PULSE_VIZ.get(m.key, "kpi"),
        }
        if m.absent:
            entry["absent"] = m.absent
        out.append(entry)
    return out


# ── collection: the two owner-approved collectors (proposal 68) ──────────────
# The owner approved exactly TWO collections: surface/OS at login and the
# phone app's version header. No IP and no geolocation of any kind — the
# proposal's states/cities cards were NOT approved, and nothing here may
# creep toward them. The privacy contract, binding: the raw User-Agent
# string is NEVER stored — it is reduced to two enums in parse_user_agent's
# stack frame and goes no further; a login row is (occurred_at, user_id,
# surface, os) and nothing else; the version table holds one row per person.
# Migration 156 owns both tables (NOT applied at the time this was written).

#: UA fragments only the phone app's own HTTP stacks write (okhttp is
#: Android's; Expo and React Native name themselves; CFNetwork/Darwin is the
#: iOS fetch stack). Any of these — or the X-App-Version header itself —
#: makes the login an app login. Lowercase; matching is case-folded.
_APP_UA_MARKERS = ("okhttp", "expo", "react-native", "reactnative",
                   "cfnetwork", "darwin")

#: App OS, first hit wins. iPad before iPhone: an iPad UA may carry both
#: words. The Apple rows exist so the collector already tells those builds
#: apart the day one ships; with no Apple marker the app is the shipped
#: Android build.
_APP_OS_TABLE = (
    ("ipados", "ipados"),
    ("ipad", "ipados"),
    ("iphone", "ios"),
    ("cfnetwork", "ios"),
    ("darwin", "ios"),
)

#: Web OS, first hit wins — ORDER IS THE PARSER. Phone and tablet browser
#: UAs claim desktop ancestry ("like Mac OS X" on an iPhone, "Linux;" on
#: Android Chrome), so the mobile markers sit ABOVE the desktop words they
#: would otherwise be mistaken for. The enum is windows/macos/linux/other.
_WEB_OS_TABLE = (
    ("iphone", "other"),
    ("ipad", "other"),
    ("android", "other"),
    ("cros", "other"),
    ("windows", "windows"),
    ("mac os x", "macos"),
    ("macintosh", "macos"),
    ("x11", "linux"),
    ("linux", "linux"),
    ("ubuntu", "linux"),
)


def parse_user_agent(ua: str | None,
                     app_version_header: str | None = None) -> tuple[str, str]:
    """(surface, os) — the ONLY thing the login collector keeps of a UA.

    Pure and total: any input, including None, bytes or garbage, answers
    ('web', 'other') rather than raising — a parse must never be able to
    break a login, and the outer try/except makes that a property of this
    function rather than a discipline asked of its callers.
    """
    try:
        text = str(ua or "").lower()
        is_app = bool(str(app_version_header or "").strip()) or any(
            marker in text for marker in _APP_UA_MARKERS)
        if is_app:
            for marker, os_name in _APP_OS_TABLE:
                if marker in text:
                    return ("app", os_name)
            return ("app", "android")
        for marker, os_name in _WEB_OS_TABLE:
            if marker in text:
                return ("web", os_name)
        return ("web", "other")
    except Exception:
        return ("web", "other")


#: What an app version is ALLOWED to look like: 1–32 chars of the semver
#: alphabet (digits, letters, ., _, +, -), nothing else. The X-App-Version
#: header is CLIENT INPUT — anyone with curl states any bytes they like, and
#: h11 lets some control characters through — and its value lands in two
#: places that cannot take garbage: the Pulse xlsx export (openpyxl raises
#: IllegalCharacterError on control characters, 500ing the whole export) and
#: the Aekam board, which renders the string verbatim. The constraint lives
#: at the RECORDER seam so no caller can forget it.
_VERSION_RE = re.compile(r"^[0-9A-Za-z._+-]{1,32}$")


def _clean_version(value) -> str | None:
    """The stated version, or None when it must be DISCARDED.

    Discarded means discarded: no write, no exception, no substitute value —
    a junk header is not a fact about app adoption, and a raise here would
    put a client-controlled 500 on the login and sync paths. Total on any
    input (None, bytes, numbers) for the same reason `parse_user_agent` is.
    """
    try:
        text = str(value or "").strip()
    except Exception:
        return None
    if not text or not _VERSION_RE.fullmatch(text):
        return None
    return text


async def record_login_pulse(pool, user_id: str,
                             user_agent: str | None = None,
                             app_version: str | None = None) -> None:
    """One successful login → one (user, surface, os) row, plus the version
    upsert when the phone app stated one.

    May raise — the CALLER holds the try/except, because the constraint that
    matters ("collection never breaks or slows a login") belongs at the login
    seam where a test can prove a raising recorder still returns the token.
    Only the parsed enums are bound; the raw User-Agent goes no further than
    parse_user_agent's stack frame.
    """
    surface, os_name = parse_user_agent(user_agent, app_version)
    await pool.execute(
        "INSERT INTO public.pulse_logins (user_id, surface, os) "
        "VALUES ($1::text, $2::text, $3::text)",
        user_id, surface, os_name,
    )
    version = _clean_version(app_version)
    if version:
        await record_app_version(pool, user_id, version)


async def record_app_version(pool, user_id: str, version: str) -> None:
    """One row per person, latest version wins — the adoption table.

    Sanitised HERE, at the seam every path writes through, so no caller can
    put an unvalidated header on the table: a version `_clean_version`
    refuses is discarded without a write (see the constraint at `_VERSION_RE`
    — a control character here later 500s every xlsx export).
    """
    version = _clean_version(version)
    if not version:
        return
    await pool.execute(
        "INSERT INTO public.pulse_app_versions (user_id, version) "
        "VALUES ($1::text, $2::text) "
        "ON CONFLICT (user_id) DO UPDATE "
        "   SET version = EXCLUDED.version, updated_at = now()",
        user_id, version,
    )


#: user_id -> the version THIS PROCESS last wrote for them — the guard that
#: keeps the sync hot path at one write per version CHANGE instead of one
#: per delta poll. A dict of last-written values, NOT a set of seen pairs:
#: the set remembered every pair for ever, so an OTA rollback A→B→A found
#: (user, A) already present and never wrote the rollback — the adoption
#: board kept saying B about a phone running A. PROCESS-LOCAL on purpose:
#: this is write-amplification control, not correctness — the upsert is
#: idempotent, so a restart that forgets it merely re-writes each live
#: user's current version once, which is harmless — and sharing it (Redis,
#: a table) would put a round trip back into the hot path it exists to
#: keep clean.
_last_written_version: dict[str, str] = {}


async def note_app_version(pool, user_id: str, version: str | None) -> None:
    """The sync-path recorder: writes when the stated version DIFFERS from
    the last one this process wrote for the user — so an upgrade AND a
    rollback both land the day they happen. Version freshness BETWEEN logins
    comes from here — the delta-sync route is the one call a phone makes
    every session."""
    version = _clean_version(version)
    if not version:
        # Discarded input never touches the dict either: junk must not
        # displace the last-written record and force a spurious re-upsert.
        return
    if _last_written_version.get(user_id) == version:
        return
    await record_app_version(pool, user_id, version)
    # Recorded AFTER the write: a failed INSERT must not poison the dict and
    # silently drop the version for the life of the process. The cap is a
    # leak guard, not a policy — clearing only costs one re-upsert per live
    # user.
    if len(_last_written_version) > 50_000:
        _last_written_version.clear()
    _last_written_version[user_id] = version


#: Once-per-process latch for the one failure every pre-migration process is
#: guaranteed to hit: migration 156 not applied means EVERY recorder call
#: raises UndefinedTable, and a traceback per login (and per sync poll) is a
#: log nobody can read anything else in. Process-local and never reset —
#: the first traceback says everything, the rest is volume.
_undefined_table_logged = False


def log_recorder_failure(where: str, exc: BaseException) -> None:
    """The one place a failing Pulse recorder is reported. Never raises.

    Collection may never break the path it rides (login, sync), so the
    callers hold the try/except — but the LOGGING policy lives here, once:
    an UndefinedTable failure (migration 156 not yet applied — expected on
    every process until it is) gets its full traceback ONCE per process and
    a quiet one-liner after that; anything else is a real fault and keeps
    its traceback every time.
    """
    global _undefined_table_logged
    try:
        try:
            from asyncpg.exceptions import UndefinedTableError
            missing_table = isinstance(exc, UndefinedTableError)
        except Exception:
            missing_table = False
        if missing_table:
            if _undefined_table_logged:
                log.info("pulse recorder (%s): pulse tables still missing "
                         "(migration 156); already reported in full", where)
            else:
                _undefined_table_logged = True
                log.warning(
                    "pulse recorder (%s) failed: the pulse tables do not "
                    "exist — migration 156 is not applied yet. Reported in "
                    "full ONCE; later occurrences log one line.",
                    where, exc_info=exc,
                )
        else:
            log.warning("pulse recorder (%s) failed; the caller is "
                        "unaffected", where, exc_info=exc)
    except Exception:                       # pragma: no cover — belt only
        pass
