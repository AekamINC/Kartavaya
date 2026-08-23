"""Sahayak (AI portal) metrics — proposal 62 §4: credits spent by skill and
by user, cost per run, failure and refund rate, scraper spend against the
actor price list.

THE LEDGER THIS FILE READS: staging.hub_org_credit_transactions — created by
migration 052, grown up by migration 095, written ONLY by services/credits.py
(tests/test_credits_isolation.py holds that boundary; this file only ever
SELECTs, so it does not breach it). The facts every query stands on:

· A spend is `tx_type = 'debit'` with a NEGATIVE amount — value comes from
  SUM(-amount), never ABS over mixed rows.
· A reversal is `tx_type IN ('refund', 'credit')` with a positive amount.
  BOTH spellings, permanently: 'credit' is what scrapers.py called a refund
  before 095, and services/credits._REVERSAL_TX_TYPES counts both for exactly
  this reason. Counting only 'refund' would understate every pre-095 reversal.
· `kind` and `ref_id` are NULL on rows written before 095 — the migration's
  own COMMENT says readers must not guess a classification for them, so the
  by-skill split labels them 'Pre-095 spend' rather than parsing description.
· `metered_only = TRUE` rows are a platform-org spend: recorded, wallet
  untouched. Migration 095's comment is explicit — reports MUST exclude them
  from balance reconciliation and INCLUDE them in usage. These are usage
  metrics, so they are included, undistinguished.
· 'grant', 'topup' and 'expire' rows move the wallet but are not spend; every
  query names the tx_types it wants rather than taking the table.
· One credit is SOLD at Rs 4 (services/credits.CREDIT_PRICE_INR). Values here
  stay in credits — the rupee translation is the frontend's caption, not a
  second unit in the data.

"BY USER" is allowed here — operational spend attribution, per the D5 brief —
but names-not-ids still applies: the dimension is `member`, resolved through
public.users (user_id TEXT, the join key the whole product uses) with the
house display chain COALESCE(full_name, name, email). A ledger row whose
user_id matches no users row is 'Departed member'; a NULL user_id is
'System' (period rolls, cron spends). The raw id never reaches an output
column.

RUNS, for the failure rate, live in two tables with two vocabularies:
· staging.hub_skill_runs (migration 012): status running/completed/failed/
  cancelled, NO org_id — scoped through hub_clients.org_id, one hop.
· staging.hub_scraper_runs (migration 032): org_id direct, status
  pending/running/succeeded/failed.
The rate counts terminal outcomes only — failed ÷ (completed|succeeded +
failed), from summed counts per bucket, never an average of per-day rates.
Cancelled, pending and running runs are neither success nor failure and are
excluded from both sides.

SCRAPER SPEND reads staging.hub_scraper_runs against the actor price list
(staging.hub_scraper_catalog): `billed_inr` is what the run was billed at run
time; `price_inr` is TODAY'S list price (migration 140's daily price watch
moves it — one actor repriced 21.5x unnoticed, which is why the comparison
exists); `cost_usd` is the vendor's actual charge IN USD and is reported in
USD — no usd_inr rate is stored per run, and applying today's forex to last
quarter's runs would fabricate a margin (see the declared absence below).
"""
from analytics.registry import MetricRequest, absent_metric, metric
from analytics.windowing import bucket_expr

#: The ledger, org-scoped, debits only — the spend rows every credit metric
#: starts from. metered_only is INCLUDED (usage, per migration 095's comment).
_ORG_DEBITS = (
    "FROM staging.hub_org_credit_transactions t "
    "WHERE t.org_id = $1::uuid AND t.tx_type = 'debit' "
    "AND t.created_at::date BETWEEN $2::date AND $3::date "
)

#: The house display chain for a person, with both honest fallbacks: a spend
#: with no user is the system's, a user the join cannot resolve has left.
#: `t.user_id` appears only inside IS NULL — the id itself is never output.
_MEMBER_LABEL = (
    "COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''), "
    "CASE WHEN t.user_id IS NULL THEN 'System' ELSE 'Departed member' END)"
)


@metric(
    key="sahayak.credits_spent",
    module="sahayak",
    label="Credits spent",
    unit="count",
    grain="flow",
    dimensions=("skill", "member"),
    sensitivity="financial",
    drill="sahayak.usage",
    description="Credits debited during the period (sold at Rs 4 each), "
                "GROSS — reversals are the refund-rate metric, not a "
                "netting here. group_by=skill splits the window by what was "
                "produced (the ledger's ref_id: blog, chatbot_message, a "
                "scraper id); group_by=member attributes it to the person "
                "who spent it, by name.",
)
def credits_spent(req: MetricRequest):
    if req.group_by == "skill":
        # ref_id first (the specific thing produced), kind as the fallback a
        # 095-era row always has, and the pre-095 rows labelled as what they
        # are — never a guess parsed out of free-text description.
        return (
            "SELECT COALESCE(t.ref_id, t.kind, 'Pre-095 spend') AS skill, "
            "SUM(-t.amount)::float AS value, COUNT(*) AS spends "
            + _ORG_DEBITS +
            "GROUP BY 1 ORDER BY value DESC, skill",
            [req.org_id, req.window.start, req.window.end],
        )
    if req.group_by == "member":
        # GROUP BY t.user_id keeps two departed members as two rows (same
        # label, different people) — the ganit top_debtors rule: group on the
        # key, label with the name, never emit the id.
        return (
            f"SELECT {_MEMBER_LABEL} AS member, "
            "SUM(-t.amount)::float AS value, COUNT(*) AS spends "
            "FROM staging.hub_org_credit_transactions t "
            "LEFT JOIN public.users u ON u.user_id = t.user_id "
            "WHERE t.org_id = $1::uuid AND t.tx_type = 'debit' "
            "AND t.created_at::date BETWEEN $2::date AND $3::date "
            # `u.email` is GONE from the GROUP BY as well as from the label.
            # A GROUP BY key that no expression in the SELECT depends on does
            # not just sit there harmlessly: it SPLITS rows. Two accounts
            # sharing a display name would already be separated by
            # `t.user_id` here, so grouping on the address bought nothing and
            # kept a column of client email addresses flowing through a query
            # whose whole output is supposed to be names.
            "GROUP BY t.user_id, u.full_name, u.name "
            "ORDER BY value DESC, member",
            [req.org_id, req.window.start, req.window.end],
        )
    period = bucket_expr(req.bucket, "t.created_at")
    return (
        f"SELECT {period} AS period, SUM(-t.amount)::float AS value "
        + _ORG_DEBITS +
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="sahayak.cost_per_run",
    module="sahayak",
    label="Cost per run",
    unit="count",
    grain="flow",
    sensitivity="financial",
    drill="sahayak.usage",
    description="Median credits per charged unit of work in each bucket — "
                "one ledger debit is one generation, one skill step, one "
                "scraper run. Median (percentile_cont), never mean: one "
                "10-credit campaign must not make every chat message look "
                "expensive. A trued-up scraper run is two debits and counts "
                "as two, which understates it slightly — stated, not hidden.",
)
def cost_per_run(req: MetricRequest):
    period = bucket_expr(req.bucket, "t.created_at")
    return (
        f"SELECT {period} AS period, "
        "percentile_cont(0.5) WITHIN GROUP (ORDER BY -t.amount)::float AS value, "
        "COUNT(*) AS runs "
        + _ORG_DEBITS +
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="sahayak.failure_rate",
    module="sahayak",
    label="Run failure rate",
    unit="pct",
    grain="flow",
    drill="sahayak.runs",
    description="Failed runs as a share of finished runs (skill runs and "
                "scraper runs together), per bucket by start date — failed "
                "and total counts ride along so the % is auditable. "
                "Running, pending and cancelled runs are neither outcome "
                "and sit outside both sides of the ratio.",
)
def failure_rate(req: MetricRequest):
    # Two tables, two status vocabularies, ONE rule: terminal outcomes only,
    # rate from summed counts. hub_skill_runs carries no org_id — the honest
    # scope is one hop through hub_clients (the same table its own router
    # scopes by); hub_scraper_runs is scoped directly.
    period = bucket_expr(req.bucket, "d.run_at")
    return (
        f"SELECT {period} AS period, "
        "COUNT(*) FILTER (WHERE d.failed)::float / NULLIF(COUNT(*), 0)::float * 100 AS value, "
        "COUNT(*) FILTER (WHERE d.failed) AS failed, "
        "COUNT(*) AS runs "
        "FROM ("
        "  SELECT r.started_at AS run_at, r.status = 'failed' AS failed "
        "  FROM staging.hub_skill_runs r "
        "  JOIN staging.hub_clients hc ON hc.id = r.client_id "
        "  WHERE hc.org_id = $1::uuid AND r.status IN ('completed', 'failed') "
        "  UNION ALL "
        "  SELECT s.started_at AS run_at, s.status = 'failed' AS failed "
        "  FROM staging.hub_scraper_runs s "
        "  WHERE s.org_id = $1::uuid AND s.status IN ('succeeded', 'failed')"
        ") d "
        "WHERE d.run_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="sahayak.refund_rate",
    module="sahayak",
    label="Refund rate",
    unit="pct",
    grain="flow",
    sensitivity="financial",
    drill="sahayak.usage",
    description="Credits returned as a share of credits debited in each "
                "bucket — SUM over SUM, both sides shown. Reversals count "
                "under both ledger spellings ('refund' and the pre-095 "
                "'credit'). A refund lands in the bucket it was ISSUED in, "
                "so a bucket refunding last month's spend can honestly "
                "exceed 100%.",
)
def refund_rate(req: MetricRequest):
    period = bucket_expr(req.bucket, "t.created_at")
    return (
        f"SELECT {period} AS period, "
        "SUM(t.amount) FILTER (WHERE t.tx_type IN ('refund', 'credit'))::float "
        "/ NULLIF(SUM(-t.amount) FILTER (WHERE t.tx_type = 'debit'), 0)::float * 100 AS value, "
        "COALESCE(SUM(t.amount) FILTER (WHERE t.tx_type IN ('refund', 'credit')), 0)::float AS refunded, "
        "COALESCE(SUM(-t.amount) FILTER (WHERE t.tx_type = 'debit'), 0)::float AS spent "
        "FROM staging.hub_org_credit_transactions t "
        "WHERE t.org_id = $1::uuid "
        "AND t.tx_type IN ('debit', 'refund', 'credit') "
        "AND t.created_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="sahayak.scraper_spend",
    module="sahayak",
    label="Scraper spend",
    unit="inr",
    grain="flow",
    dimensions=("scraper",),
    sensitivity="financial",
    drill="sahayak.scrapers",
    description="What scraper runs were billed (INR, at run time), against "
                "the actor price list: list_inr is what TODAY'S catalogue "
                "price would bill the same runs (the daily price watch moves "
                "it), cost_usd is the vendor's actual charge, left in USD — "
                "no per-run forex rate exists to convert it honestly. "
                "group_by=scraper names each actor from the catalogue.",
)
def scraper_spend(req: MetricRequest):
    if req.group_by == "scraper":
        # Label from the catalogue's display name; GROUP BY c.id so two
        # actors that share a name stay two rows. scraper_id is a NOT NULL FK,
        # so the inner join drops nothing. Billing is GROSS — a failed run's
        # billing stands here and its reversal is the refund-rate metric.
        return (
            "SELECT c.name AS scraper, "
            "SUM(COALESCE(r.billed_inr, 0))::float AS value, "
            "COUNT(*) AS runs, "
            "SUM(c.price_inr)::float AS list_inr, "
            "SUM(COALESCE(r.cost_usd, 0))::float AS cost_usd "
            "FROM staging.hub_scraper_runs r "
            "JOIN staging.hub_scraper_catalog c ON c.id = r.scraper_id "
            "WHERE r.org_id = $1::uuid "
            "AND r.started_at::date BETWEEN $2::date AND $3::date "
            "GROUP BY c.id, c.name ORDER BY value DESC, scraper",
            [req.org_id, req.window.start, req.window.end],
        )
    period = bucket_expr(req.bucket, "r.started_at")
    return (
        f"SELECT {period} AS period, "
        "SUM(COALESCE(r.billed_inr, 0))::float AS value, "
        "COUNT(*) AS runs, "
        "SUM(c.price_inr)::float AS list_inr, "
        "SUM(COALESCE(r.cost_usd, 0))::float AS cost_usd "
        "FROM staging.hub_scraper_runs r "
        "JOIN staging.hub_scraper_catalog c ON c.id = r.scraper_id "
        "WHERE r.org_id = $1::uuid "
        "AND r.started_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


# ── Declared absent — the schema cannot answer this honestly ─────────────────

absent_metric(
    key="sahayak.scraper_margin",
    module="sahayak",
    label="Scraper margin",
    unit="pct",
    grain="flow",
    sensitivity="financial",
    absent="staging.hub_scraper_runs records cost_usd (USD) and billed_inr "
           "(INR) with NO usd_inr rate stored at run time; services/forex "
           "knows only today's rate, so a margin computed now would apply "
           "today's forex to last quarter's runs and drift retroactively as "
           "the rupee moves. Store the rate (or the INR cost) on the run to "
           "close this — a column, not a query.",
)
