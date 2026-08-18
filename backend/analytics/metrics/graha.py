"""Graha (CRM) metrics — proposal 62 §4, derived from the migration ledger
(018/019/023/024/030/031/048/081/092/133/141) and routers/graha.py — NOT
probed live this session; every column named here is present in a repo
migration, and the provenance of each judgement call is cited.

The schema facts this file stands on:

· **Won/lost are timestamps, not stage strings.** `graha_deals.won_at` /
  `lost_at` (migration 018) are what the product writes: the deal PATCH
  handler stamps them when the stage literal becomes 'Won'/'Lost'
  (routers/graha.py, update_deal). Stage VALUES are per-org text
  (`graha_pipelines.stages` jsonb) — no query here names a stage literal,
  ever. A deal that carries both timestamps was reopened and re-closed; the
  LATER timestamp is its outcome. A deal reopened after winning keeps its
  `won_at` (the API cannot clear it), so it stays counted as won and stays
  off the open board — a schema limitation, stated rather than papered over.
· **The rep is `assigned_to` (TEXT), never `owner_id` (uuid).** Migration 030
  made assigned_to TEXT because `users.user_id` is text; migration 092
  recorded owner_id as unwritten (measured zero), and joining it once 500'd
  the kanban board. Rep labels resolve through public.users with the house
  display chain — a raw id never reaches an output column.
· **Deals have no source column.** Source lives on the contact
  (`graha_contacts.source`, free text defaulting to ''); a deal's source is
  its contact's, through contact_id.
· **`archived_at` (migration 133) is NOT a delete.** Its own comment: archived
  deals still count in every revenue figure. So flows here (win rate, sales
  cycle, deal size, concentration) never filter it; the two board stocks
  (pipeline by stage, deal aging) exclude it — an archived deal is off the
  board. `is_active = FALSE` IS the delete (the delete handler), so every
  query filters it, exactly as ganit does.
· **No stage-transition history exists** — only the current stage, plus
  `deal.stage_changed` events flowing into staging.niyam_events since
  2026-08-16 (migration 141). Stage-to-stage conversion is therefore a
  declared absence, not a number computed over days of partial capture.
· **The helpdesk does not exist.** Migration 048 dropped it; catchup 081
  recreated `staging.graha_tickets` only as an empty stub so a Dristi report
  source stops 500ing. No router writes a ticket row, so both ticket metrics
  are declared absences — an empty table behind a real-looking metric is the
  definition of a convincing zero.
· Ratios come from SUMS/COUNTS within each bucket, never an average of
  per-row rates; medians come from `percentile_cont(0.5)`, never AVG; money
  is COALESCEd before arithmetic (`value` is nullable-by-default DECIMAL).
"""
from analytics.registry import MetricRequest, absent_metric, metric
from analytics.windowing import bucket_expr

#: The outcome test. Both timestamps can be set (won, reopened, lost — or the
#: reverse); the later one is the deal's outcome, ties going to won.
_WON = "(d.won_at IS NOT NULL AND (d.lost_at IS NULL OR d.won_at >= d.lost_at))"

#: interval -> fractional days for medians — a float in JSON, not a Postgres
#: interval the renderer would have to interpret (core.py's pattern).
_DAYS = "EXTRACT(EPOCH FROM ({0})) / 86400.0"

#: Size bands for win-rate splits. No band configuration exists anywhere in
#: the schema, so the edges are declared here and named in the labels:
#: under ₹50k / ₹50k–5L / ₹5L–50L / ₹50L+.
_SIZE_BAND = (
    "CASE WHEN COALESCE(d.value, 0) < 50000 THEN '<50k' "
    "WHEN COALESCE(d.value, 0) < 500000 THEN '50k-5L' "
    "WHEN COALESCE(d.value, 0) < 5000000 THEN '5L-50L' "
    "ELSE '50L+' END"
)

#: lead_score is 0–100 (migration 019, CHECKed) defaulting to 0 — quartile
#: bands, lexicographically ordered so ORDER BY 1 is band order.
_SCORE_BAND = (
    "CASE WHEN COALESCE(c.lead_score, 0) >= 75 THEN '75-100' "
    "WHEN COALESCE(c.lead_score, 0) >= 50 THEN '50-74' "
    "WHEN COALESCE(c.lead_score, 0) >= 25 THEN '25-49' "
    "ELSE '0-24' END"
)


@metric(
    key="graha.pipeline_by_stage",
    module="graha",
    label="Pipeline value by stage",
    unit="inr",
    grain="stock",
    sensitivity="financial",
    drill="graha.deals",
    description="Open pipeline value and deal count per stage, as at today. "
                "Open = not won, not lost, not archived, not deleted — the "
                "close is the won_at/lost_at timestamp, never a stage string, "
                "because stage values are per-org text.",
)
def pipeline_by_stage(req: MetricRequest):
    # GROUP BY the stage column itself: stages come from the org's own
    # graha_pipelines.stages, so the rows ARE the org's vocabulary. Ordering
    # by value puts the money where the eye lands; the board defines the
    # canonical stage order and this metric does not pretend to know it.
    return (
        "SELECT d.stage AS label, "
        "SUM(COALESCE(d.value, 0))::float AS value, "
        "COUNT(*) AS deals "
        "FROM staging.graha_deals d "
        "WHERE d.org_id = $1::uuid AND d.is_active = TRUE "
        "AND d.won_at IS NULL AND d.lost_at IS NULL "
        "AND d.archived_at IS NULL "
        "GROUP BY d.stage "
        "HAVING COUNT(*) > 0 "
        "ORDER BY value DESC",
        [req.org_id],
    )


@metric(
    key="graha.win_rate",
    module="graha",
    label="Win rate",
    unit="pct",
    grain="flow",
    dimensions=("rep", "source", "size_band"),
    drill="graha.deals",
    description="Of deals CLOSED in the period (won or lost, by the later "
                "timestamp), the share won — won ÷ (won + lost) from counts "
                "per bucket, never an average of per-deal rates. group_by "
                "rep/source/size_band answers over the whole window. Bands: "
                "under ₹50k / ₹50k–5L / ₹5L–50L / ₹50L+. Archived closed "
                "deals count — the record of revenue stays countable "
                "(migration 133).",
)
def win_rate(req: MetricRequest):
    rate = (
        f"COUNT(*) FILTER (WHERE {_WON})::float "
        "/ NULLIF(COUNT(*), 0)::float * 100 AS value, "
        f"COUNT(*) FILTER (WHERE {_WON}) AS won, "
        "COUNT(*) AS closed "
    )
    # Closed-in-window: GREATEST ignores a NULL side, and BETWEEN filters the
    # never-closed (both NULL) out on its own.
    scope = (
        "WHERE d.org_id = $1::uuid AND d.is_active = TRUE "
        "AND GREATEST(d.won_at, d.lost_at)::date BETWEEN $2::date AND $3::date "
    )
    params = [req.org_id, req.window.start, req.window.end]
    if req.group_by == "rep":
        # assigned_to is TEXT and is what the product writes; owner_id is an
        # unwritten uuid whose join once 500'd the kanban (migration 092).
        return (
            "SELECT COALESCE(u.full_name, u.name, u.email, 'Unassigned') AS rep, "
            + rate +
            "FROM staging.graha_deals d "
            "LEFT JOIN public.users u ON u.user_id = d.assigned_to "
            + scope +
            "GROUP BY 1 ORDER BY value DESC, 1",
            params,
        )
    if req.group_by == "source":
        return (
            "SELECT COALESCE(NULLIF(c.source, ''), 'No source') AS source, "
            + rate +
            "FROM staging.graha_deals d "
            "LEFT JOIN staging.graha_contacts c ON c.id = d.contact_id "
            + scope +
            "GROUP BY 1 ORDER BY value DESC, 1",
            params,
        )
    if req.group_by == "size_band":
        # MIN(value) orders the bands ascending without repeating the CASE —
        # an output alias cannot sit inside an ORDER BY expression.
        return (
            f"SELECT {_SIZE_BAND} AS size_band, "
            + rate +
            "FROM staging.graha_deals d "
            + scope +
            "GROUP BY 1 ORDER BY MIN(COALESCE(d.value, 0))",
            params,
        )
    period = bucket_expr(req.bucket, "GREATEST(d.won_at, d.lost_at)")
    return (
        f"SELECT {period} AS period, "
        + rate +
        "FROM staging.graha_deals d "
        + scope +
        "GROUP BY 1 ORDER BY 1",
        params,
    )


@metric(
    key="graha.sales_cycle",
    module="graha",
    label="Sales cycle",
    unit="days",
    grain="flow",
    drill="graha.deals",
    description="Median days from deal creation to won_at, for deals won in "
                "the period. Median (percentile_cont), not mean — one deal "
                "that sat a year must not move the headline. Archived wins "
                "count.",
)
def sales_cycle(req: MetricRequest):
    period = bucket_expr(req.bucket, "d.won_at")
    days = _DAYS.format("d.won_at - d.created_at")
    return (
        f"SELECT {period} AS period, "
        f"percentile_cont(0.5) WITHIN GROUP (ORDER BY {days})::float AS value, "
        "COUNT(*) AS deals "
        "FROM staging.graha_deals d "
        "WHERE d.org_id = $1::uuid AND d.is_active = TRUE "
        "AND d.won_at IS NOT NULL "
        "AND d.won_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="graha.deal_aging",
    module="graha",
    label="Deal aging",
    unit="count",
    grain="stock",
    drill="graha.deals",
    description="Open deals untouched for 31-60 / 61-90 / 90+ days, as at "
                "today, with the pipeline value sitting in each bucket. A "
                "touch is a logged CRM activity or any edit to the deal "
                "itself (updated_at); a due-but-unworked follow-up is not "
                "activity.",
)
def deal_aging(req: MetricRequest):
    # Last touch = the later of the deal's own updated_at (NOT NULL — any
    # edit counts) and its newest logged activity; GREATEST ignores the NULL
    # when a deal has no activities at all, so those age from their last
    # edit instead of vanishing. Deals idle 30 days or less are not aging
    # and get no row.
    idle = "CURRENT_DATE - GREATEST(d.updated_at, la.last_at)::date"
    return (
        "SELECT bucket, COUNT(*) AS value, "
        "SUM(deal_value)::float AS pipeline_value FROM ("
        "  SELECT COALESCE(d.value, 0) AS deal_value, "
        f"    CASE WHEN {idle} <= 60 THEN '31-60' "
        f"    WHEN {idle} <= 90 THEN '61-90' "
        "    ELSE '90+' END AS bucket "
        "  FROM staging.graha_deals d "
        "  LEFT JOIN LATERAL ("
        "    SELECT MAX(a.created_at) AS last_at "
        "    FROM staging.graha_activities a "
        "    WHERE a.deal_id = d.id AND a.org_id = $1::uuid"
        "  ) la ON TRUE "
        "  WHERE d.org_id = $1::uuid AND d.is_active = TRUE "
        "  AND d.won_at IS NULL AND d.lost_at IS NULL "
        "  AND d.archived_at IS NULL "
        f"  AND {idle} > 30"
        ") idle GROUP BY bucket "
        "ORDER BY CASE bucket WHEN '31-60' THEN 1 WHEN '61-90' THEN 2 "
        "ELSE 3 END",
        [req.org_id],
    )


@metric(
    key="graha.lead_conversion",
    module="graha",
    label="Lead → deal conversion",
    unit="pct",
    grain="flow",
    dimensions=("source", "lead_score"),
    drill="graha.contacts",
    description="Of contacts created in the period, the share that have at "
                "least one deal — counts over counts per bucket, never an "
                "average of rates. Vendors and partners are excluded: they "
                "were never leads. group_by source/lead_score answers over "
                "the whole window; score bands are quartiles of the 0-100 "
                "scale. Original contact_type is not stored, so a contact "
                "created directly as a customer sits in the cohort — stated, "
                "not hidden.",
)
def lead_conversion(req: MetricRequest):
    # The EXISTS carries its own org filter: a deal row must match the org
    # even though contact_id is already org-scoped — fail-closed beats
    # trusting a foreign key two tables away.
    has_deal = (
        "EXISTS (SELECT 1 FROM staging.graha_deals d "
        "WHERE d.contact_id = c.id AND d.org_id = $1::uuid)"
    )
    rate = (
        f"COUNT(*) FILTER (WHERE {has_deal})::float "
        "/ NULLIF(COUNT(*), 0)::float * 100 AS value, "
        f"COUNT(*) FILTER (WHERE {has_deal}) AS with_deal, "
        "COUNT(*) AS contacts "
    )
    scope = (
        "FROM staging.graha_contacts c "
        "WHERE c.org_id = $1::uuid AND c.is_active = TRUE "
        "AND c.contact_type NOT IN ('vendor', 'partner') "
        "AND c.created_at::date BETWEEN $2::date AND $3::date "
    )
    params = [req.org_id, req.window.start, req.window.end]
    if req.group_by == "source":
        return (
            "SELECT COALESCE(NULLIF(c.source, ''), 'No source') AS source, "
            + rate + scope +
            "GROUP BY 1 ORDER BY value DESC, 1",
            params,
        )
    if req.group_by == "lead_score":
        # Band labels sort lexicographically in band order — ORDER BY 1 is
        # honest here.
        return (
            f"SELECT {_SCORE_BAND} AS lead_score, "
            + rate + scope +
            "GROUP BY 1 ORDER BY 1",
            params,
        )
    period = bucket_expr(req.bucket, "c.created_at")
    return (
        f"SELECT {period} AS period, "
        + rate + scope +
        "GROUP BY 1 ORDER BY 1",
        params,
    )


@metric(
    key="graha.avg_deal_size",
    module="graha",
    label="Average deal size",
    unit="inr",
    grain="flow",
    sensitivity="financial",
    drill="graha.deals",
    description="Average value of deals WON in each bucket — the trend is "
                "the series. SUM(value)/COUNT per bucket, computed from "
                "sums; the total and count ride along so the average is "
                "auditable. Archived wins count.",
)
def avg_deal_size(req: MetricRequest):
    period = bucket_expr(req.bucket, "d.won_at")
    return (
        f"SELECT {period} AS period, "
        "SUM(COALESCE(d.value, 0))::float / NULLIF(COUNT(*), 0)::float AS value, "
        "SUM(COALESCE(d.value, 0))::float AS won_value, "
        "COUNT(*) AS deals "
        "FROM staging.graha_deals d "
        "WHERE d.org_id = $1::uuid AND d.is_active = TRUE "
        "AND d.won_at IS NOT NULL "
        "AND d.won_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="graha.client_concentration",
    module="graha",
    label="Client concentration",
    unit="pct",
    grain="flow",
    sensitivity="financial",
    drill="graha.deals",
    description="Share of the period's won deal value held by the top 5 "
                "clients — one number for the whole window, whichever bucket "
                "cuts it. Won value on deals with no client link counts in "
                "the denominator (it is revenue) and can never be a top-5 "
                "client, so heavy unlinking understates concentration — "
                "stated, not hidden. Revenue here is won deal value: invoiced "
                "revenue belongs to ganit and its entitlement.",
)
def client_concentration(req: MetricRequest):
    # One row, always. The inner query is bucketed to honour the registry's
    # one-walk contract; the outer ratio sums the per-bucket sums, so the
    # answer is invariant to how the window is cut (ganit.dso's pattern).
    period = bucket_expr(req.bucket, "d.won_at")
    return (
        "WITH bucketed AS ("
        f"  SELECT {period} AS period, d.client_id, "
        "    SUM(COALESCE(d.value, 0)) AS v "
        "  FROM staging.graha_deals d "
        "  WHERE d.org_id = $1::uuid AND d.is_active = TRUE "
        "  AND d.won_at IS NOT NULL "
        "  AND d.won_at::date BETWEEN $2::date AND $3::date "
        "  GROUP BY 1, 2"
        ") "
        "SELECT COALESCE(("
        "  SELECT SUM(cv) FROM ("
        "    SELECT SUM(v) AS cv FROM bucketed "
        "    WHERE client_id IS NOT NULL "
        "    GROUP BY client_id ORDER BY cv DESC LIMIT 5"
        "  ) top5), 0)::float / NULLIF(SUM(v), 0)::float * 100 AS value, "
        "SUM(v)::float AS total_won_value, "
        "COUNT(DISTINCT client_id) AS clients "
        "FROM bucketed "
        # No wins in the window → no rows, never a {value: null} row-shape
        # for an org that is not yours.
        "HAVING COUNT(*) > 0",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="graha.contacts_added",
    module="graha",
    label="Contacts added",
    unit="count",
    grain="flow",
    dimensions=("contact_type",),
    drill="graha.contacts",
    description="Contacts created during the period, per bucket; group_by "
                "contact_type splits lead/customer/vendor/partner. Merged "
                "duplicates and deleted contacts (is_active = FALSE, "
                "migration 024's soft-merge) do not count — the person "
                "existed once, not twice.",
)
def contacts_added(req: MetricRequest):
    period = bucket_expr(req.bucket, "created_at")
    group = ", contact_type" if req.group_by == "contact_type" else ""
    return (
        f"SELECT {period} AS period{group}, COUNT(*) AS value "
        "FROM staging.graha_contacts "
        "WHERE org_id = $1::uuid AND is_active = TRUE "
        "AND created_at::date BETWEEN $2::date AND $3::date "
        f"GROUP BY 1{group and ', 2'} ORDER BY 1{group and ', 2'}",
        [req.org_id, req.window.start, req.window.end],
    )


# ── Declared absent — the schema cannot answer these honestly ────────────────
# Proposal 62 §10: a stated absence, never a convincing zero. Each reason was
# verified against the migration ledger and the routers on 2026-08-18.

absent_metric(
    key="graha.stage_conversion",
    module="graha",
    label="Stage-to-stage conversion",
    unit="pct",
    grain="flow",
    absent="No stage-transition history exists: staging.graha_deals stores "
           "only the CURRENT stage text, and staging.niyam_events began "
           "receiving deal.stage_changed (migration 141, emitted from the one "
           "deal PATCH path since 2026-08-16) far too recently to reconstruct "
           "any window — a conversion rate over days of partial capture would "
           "present itself as the pipeline's truth.",
)

absent_metric(
    key="graha.ticket_volume",
    module="graha",
    label="Ticket volume",
    unit="count",
    grain="flow",
    absent="The helpdesk was removed by migration 048_drop_helpdesk.sql; "
           "staging.graha_tickets exists again only as the empty stub catchup "
           "081 created so the Dristi report source stops 500ing. No router "
           "can write a ticket row, so a volume by priority and category "
           "would render as a convincing zero for every org.",
)

absent_metric(
    key="graha.ticket_resolution_time",
    module="graha",
    label="Ticket resolution time",
    unit="days",
    grain="flow",
    absent="resolved_at and created_at live only on staging.graha_tickets — "
           "the empty stub catchup 081 recreated after migration 048 dropped "
           "the helpdesk feature. With no write path anywhere in the product "
           "there is no ticket to measure, and a median over rows that can "
           "never exist is not a metric.",
)
