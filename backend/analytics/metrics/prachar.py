"""Prachar (marketing) metrics — proposal 62 §4.

Verified against the MIGRATION TEXT and the code that writes each column
(migrations 021/026/044/107/147, the send loop in `routers/prachar.py`,
`services/engagement_metrics.py`, `services/ad_insights.py`) — not against a
live probe; this module was written offline by design. Column names have bitten
this module before (marketing never sent until 2026-08-04 because of wrong
column names), so every column named here was read from the CREATE TABLE that
owns it.

THE FACT THIS FILE IS SHAPED AROUND: **engagement is not measured.**
`services/engagement_metrics.py` and migration 107 are the authorities —
nothing in the product writes `prachar_campaigns.total_opened / total_clicked /
total_bounced / total_unsubscribed`, and nothing writes
`prachar_campaign_contacts.opened_at / clicked_at` or the statuses 'delivered',
'opened', 'clicked', 'bounced', 'unsubscribed'. There is no Resend webhook, no
tracking pixel and no click redirect (`ENGAGEMENT_RECEIVER = None`); the only
rows holding those values are demo seed, and migration 107 zeroes them. So the
open/click/bounce rates the catalogue asks for are declared ABSENT below — a
rate over a column nothing writes is a lie with a denominator.

What the send path DOES write, and the guards that follow from it:

· `prachar_campaign_contacts.status` only ever becomes 'sent' (with
  `sent_at = NOW()`), 'failed', or 'suppressed' (migration 147 — the
  OUTBOUND_MODE=dry gate; on staging nothing outbound has ever actually left).
  Sends are therefore counted as `status = 'sent'` rows windowed on `sent_at`.
· The migration text gives `prachar_campaign_contacts` NO org_id, and the
  product's INSERT writes `(campaign_id, contact_id, email)` only — the org_id
  column that exists live arrived with seed data and is NULL on every row the
  product writes. Org scope therefore ALWAYS goes through
  `prachar_campaigns.org_id`; `r.org_id` is never referenced here.
· `prachar_campaigns.total_sent` is written only by the skills path
  (`services/skills/action/campaign_sender.py`); the router's own send loop
  finishes by writing `total_recipients` and never `total_sent`. The campaign
  counters are NOT a send count — the per-recipient rows are.
· There is no list/subscriber table anywhere in the schema (searched:
  prachar_lists, prachar_subscribers — neither exists). The audience of every
  send is `graha_contacts` rows holding an email, minus
  `staging.prachar_unsubscribes` — the suppression list is real and enforced
  at send time. "List" metrics are computed over exactly that audience and say
  so, rather than pretending a list entity exists.
· `graha_contacts.source` is free text with DEFAULT '' — the empty string is
  labelled 'No source', never rendered bare. Merged duplicates keep their rows
  (`is_active = FALSE` + `merged_into_id` set, migration 024) and are excluded
  by `merged_into_id IS NULL` — a folded duplicate was never a distinct lead.
· Event attendance is real: `prachar_event_registrations.status` has a genuine
  writer (`PATCH /events/{id}/registrations/{reg_id}` sets registered /
  attended / no_show / cancelled), and the rate is attended over
  not-cancelled, from SUMS per bucket — never an average of per-event rates.
· Every parameter is cast (`$1::uuid`, `$2::date`) — PgBouncer turns an
  untyped parse error into an instant 500 (the credits incident).

Ad spend / CPL / ROAS wait on proposal 60's ingest spine: see the absent
declarations at the bottom for exactly what exists today and what is missing.
"""
from analytics.registry import MetricRequest, absent_metric, metric
from analytics.windowing import bucket_expr

#: Recipient rows org-scoped through the campaign that owns them — the ONLY
#: honest path: the product's INSERT never writes the (seed-added) org_id
#: column on prachar_campaign_contacts, so r.org_id is NULL on real rows.
_ORG_SENDS = (
    "FROM staging.prachar_campaign_contacts r "
    "JOIN staging.prachar_campaigns c ON c.id = r.campaign_id "
    "WHERE c.org_id = $1::uuid "
)


@metric(
    key="prachar.sends",
    module="prachar",
    label="Emails sent",
    unit="count",
    grain="flow",
    dimensions=("campaign",),
    drill="prachar.campaigns",
    description="Recipients actually sent to during the period, by send date. "
                "Only rows the send loop marked 'sent' count — 'suppressed' "
                "(OUTBOUND_MODE gate: nothing left the building) and 'failed' "
                "are not sends. group_by=campaign answers 'which campaign' "
                "for the whole window, labelled by campaign name.",
)
def sends(req: MetricRequest):
    # No c.is_active filter, deliberately: a send that happened before the
    # campaign was soft-deleted still happened — same rule as core.throughput
    # counting tasks archived after completion.
    if req.group_by == "campaign":
        return (
            "SELECT c.name AS label, COUNT(*) AS value "
            + _ORG_SENDS +
            "AND r.status = 'sent' "
            "AND r.sent_at::date BETWEEN $2::date AND $3::date "
            # GROUP BY c.id so two campaigns sharing a name stay two rows;
            # the id itself never reaches the select list (names-not-ids).
            "GROUP BY c.id, c.name ORDER BY value DESC, label",
            [req.org_id, req.window.start, req.window.end],
        )
    period = bucket_expr(req.bucket, "r.sent_at")
    return (
        f"SELECT {period} AS period, COUNT(*) AS value "
        + _ORG_SENDS +
        "AND r.status = 'sent' "
        "AND r.sent_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="prachar.list_growth",
    module="prachar",
    label="Marketable audience growth",
    unit="count",
    grain="flow",
    drill="graha.contacts",
    description="Net growth of the marketable audience per bucket: contacts "
                "added with an email address, minus unsubscribes. There is no "
                "list entity in the schema — the audience of every send IS "
                "graha_contacts-with-an-email minus the suppression list, and "
                "this reports exactly that, with added and unsubscribed "
                "riding along so the net is auditable.",
)
def list_growth(req: MetricRequest):
    added = bucket_expr(req.bucket, "g.created_at")
    removed = bucket_expr(req.bucket, "u.unsubscribed_at")
    # Merged duplicates are excluded — a folded duplicate was never a distinct
    # audience member. is_active is NOT filtered beyond that: a contact added
    # in March and deleted in June was still an addition in March, and
    # retro-filtering would rewrite history every time someone tidies the CRM.
    # The two legs are UNION ALL'd and summed per bucket rather than joined —
    # a bucket with only unsubscribes (or only additions) must still appear.
    return (
        "SELECT period, SUM(added) - SUM(removed) AS value, "
        "SUM(added) AS added, SUM(removed) AS unsubscribed FROM ("
        f"  SELECT {added} AS period, 1 AS added, 0 AS removed "
        "  FROM staging.graha_contacts g "
        "  WHERE g.org_id = $1::uuid AND g.merged_into_id IS NULL "
        "  AND COALESCE(g.email, '') <> '' "
        "  AND g.created_at::date BETWEEN $2::date AND $3::date "
        "  UNION ALL "
        f"  SELECT {removed} AS period, 0 AS added, 1 AS removed "
        "  FROM staging.prachar_unsubscribes u "
        "  WHERE u.org_id = $1::uuid "
        "  AND u.unsubscribed_at::date BETWEEN $2::date AND $3::date"
        ") x GROUP BY period ORDER BY period",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="prachar.unsubscribe_rate",
    module="prachar",
    label="Unsubscribe rate",
    unit="pct",
    grain="flow",
    drill="prachar.unsubscribes",
    description="Unsubscribes per bucket over emails sent in the same bucket, "
                "from sums — never an average of per-campaign rates. Nothing "
                "attributes an unsubscribe to a campaign (the per-campaign "
                "counter is unwritten — migration 107), so same-window sends "
                "are the honest denominator; both counts ride along. A bucket "
                "with unsubscribes and no sends reports a null rate with the "
                "counts visible, not a convincing number.",
)
def unsubscribe_rate(req: MetricRequest):
    unsub = bucket_expr(req.bucket, "u.unsubscribed_at")
    send = bucket_expr(req.bucket, "r.sent_at")
    return (
        "SELECT period, "
        "SUM(unsub)::float / NULLIF(SUM(send), 0)::float * 100 AS value, "
        "SUM(unsub) AS unsubscribes, SUM(send) AS sends FROM ("
        f"  SELECT {unsub} AS period, 1 AS unsub, 0 AS send "
        "  FROM staging.prachar_unsubscribes u "
        "  WHERE u.org_id = $1::uuid "
        "  AND u.unsubscribed_at::date BETWEEN $2::date AND $3::date "
        "  UNION ALL "
        f"  SELECT {send} AS period, 0 AS unsub, 1 AS send "
        + _ORG_SENDS +
        "  AND r.status = 'sent' "
        "  AND r.sent_at::date BETWEEN $2::date AND $3::date"
        ") x GROUP BY period ORDER BY period",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="prachar.event_attendance",
    module="prachar",
    label="Event attendance",
    unit="pct",
    grain="flow",
    dimensions=("event",),
    drill="prachar.events",
    description="Of the people registered for events held in the period, the "
                "share who attended — attended over not-cancelled "
                "registrations, from sums per bucket by event start date. "
                "Cancelled events are excluded (they did not happen); an "
                "event with no registrations still appears, with a null rate "
                "and zero counts. group_by=event answers it per event for "
                "the whole window, labelled by event title.",
)
def event_attendance(req: MetricRequest):
    # COUNT(r.id), never COUNT(*): the LEFT JOIN keeps a registration-less
    # event as one row of NULLs, and COUNT(*) would book that row as a
    # phantom registration. r.org_id lives in the ON clause so the outer
    # join survives it (registrations carry a real NOT NULL org_id —
    # migration 044 — unlike campaign contacts).
    agg = (
        "COUNT(r.id) FILTER (WHERE r.status = 'attended')::float "
        "/ NULLIF(COUNT(r.id) FILTER (WHERE r.status <> 'cancelled'), 0)::float "
        "* 100 AS value, "
        "COUNT(r.id) FILTER (WHERE r.status <> 'cancelled') AS registered, "
        "COUNT(r.id) FILTER (WHERE r.status = 'attended') AS attended "
    )
    base = (
        "FROM staging.prachar_events e "
        "LEFT JOIN staging.prachar_event_registrations r "
        "ON r.event_id = e.id AND r.org_id = $1::uuid "
        "WHERE e.org_id = $1::uuid AND e.is_active = TRUE "
        "AND e.status <> 'cancelled' "
        "AND e.starts_at::date BETWEEN $2::date AND $3::date "
    )
    if req.group_by == "event":
        return (
            "SELECT e.title AS label, " + agg + base +
            # GROUP BY e.id: two events sharing a title stay two rows, and
            # the id never reaches the select list (names-not-ids).
            "GROUP BY e.id, e.title ORDER BY value DESC NULLS LAST, label",
            [req.org_id, req.window.start, req.window.end],
        )
    period = bucket_expr(req.bucket, "e.starts_at")
    return (
        f"SELECT {period} AS period, " + agg + base +
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="prachar.leads_by_source",
    module="prachar",
    label="Leads by source",
    unit="count",
    grain="flow",
    dimensions=("source",),
    drill="graha.contacts",
    description="Contacts acquired during the period, by creation date; "
                "group_by=source answers 'which channel' for the whole "
                "window. Counts leads AND customers — a converted lead "
                "changes contact_type to 'customer', and dropping it would "
                "bias attribution against exactly the channels that convert. "
                "source is free text; the empty default is labelled "
                "'No source'.",
)
def leads_by_source(req: MetricRequest):
    # Merged duplicates excluded — the survivor carries the acquisition.
    # Vendors and partners are not acquisitions and stay out.
    base = (
        "FROM staging.graha_contacts g "
        "WHERE g.org_id = $1::uuid AND g.merged_into_id IS NULL "
        "AND g.contact_type IN ('lead', 'customer') "
        "AND g.created_at::date BETWEEN $2::date AND $3::date "
    )
    if req.group_by == "source":
        return (
            "SELECT COALESCE(NULLIF(g.source, ''), 'No source') AS label, "
            "COUNT(*) AS value "
            + base +
            "GROUP BY 1 ORDER BY value DESC, label",
            [req.org_id, req.window.start, req.window.end],
        )
    period = bucket_expr(req.bucket, "g.created_at")
    return (
        f"SELECT {period} AS period, COUNT(*) AS value "
        + base +
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


# ── Declared absent — the schema cannot answer these honestly ────────────────
# Proposal 62 §10: a stated absence, never a convincing zero. The engagement
# three are the catalogue's own "rates from sums" — and the sums do not exist:
# services/engagement_metrics.py and migration 107 are the standing authorities
# that nothing in the product measures recipient behaviour.

absent_metric(
    key="prachar.open_rate",
    module="prachar",
    label="Open rate",
    unit="pct",
    grain="flow",
    absent="Opens are not measured: nothing in the product writes "
           "prachar_campaigns.total_opened or prachar_campaign_contacts."
           "opened_at / status='opened' — there is no Resend webhook, no "
           "tracking pixel and no click redirect (services/"
           "engagement_metrics.py, ENGAGEMENT_RECEIVER=None), and migration "
           "107 zeroes the only non-zero values as demo seed. A rate over a "
           "column nothing writes is a lie with a denominator.",
)

absent_metric(
    key="prachar.click_rate",
    module="prachar",
    label="Click rate",
    unit="pct",
    grain="flow",
    absent="Clicks are not measured: nothing writes prachar_campaigns."
           "total_clicked or prachar_campaign_contacts.clicked_at / "
           "status='clicked' — no click redirect exists and no delivery-event "
           "receiver ingests provider events (services/engagement_metrics.py, "
           "ENGAGEMENT_RECEIVER=None). The columns exist in the schema; only "
           "seed data has ever populated them, and migration 107 zeroes it.",
)

absent_metric(
    key="prachar.bounce_rate",
    module="prachar",
    label="Bounce rate",
    unit="pct",
    grain="flow",
    absent="Bounces are not measured: nothing writes prachar_campaigns."
           "total_bounced or prachar_campaign_contacts.status='bounced' — "
           "there is no delivery-event receiver (services/"
           "engagement_metrics.py, ENGAGEMENT_RECEIVER=None), which is also "
           "why a hard-bouncing address is re-mailed on every campaign "
           "(migration 107's column comment). Until events are ingested, any "
           "bounce figure would be an invention.",
)

absent_metric(
    key="prachar.ad_spend",
    module="prachar",
    label="Ad spend",
    unit="inr",
    grain="flow",
    sensitivity="financial",
    absent="Needs proposal 60's ingest spine: staging.analytics_metrics_daily "
           "does not exist. staging.prachar_ad_insights (migration 026) does "
           "hold a per-day spend column written by the Meta sync "
           "(services/ad_insights.py), but it is per-connected-ad-account "
           "vendor-reported data, not the normalised daily spine this "
           "catalogue's spend metric is specified over — declaring it here "
           "would freeze the vendor table's shape into the API a spine "
           "migration is about to replace.",
)

absent_metric(
    key="prachar.cpl",
    module="prachar",
    label="Cost per lead",
    unit="inr",
    grain="flow",
    sensitivity="financial",
    absent="Blocked twice over. The cost side needs proposal 60's ingest "
           "spine — staging.analytics_metrics_daily does not exist. And the "
           "lead side has no attribution: graha_contacts.source is free text "
           "with no foreign key to staging.prachar_ad_campaigns, so no lead "
           "can be tied to the campaign whose spend acquired it. Dividing "
           "all spend by all leads would charge every ad rupee to every "
           "walk-in.",
)

absent_metric(
    key="prachar.roas",
    module="prachar",
    label="ROAS",
    unit="pct",
    grain="flow",
    sensitivity="financial",
    absent="Needs proposal 60's ingest spine (staging.analytics_metrics_daily "
           "does not exist) AND a revenue join that has no path: no order or "
           "invoice ties to an ad campaign anywhere in the schema. The roas "
           "column on staging.prachar_ad_insights is Meta's self-reported "
           "purchase_roas, measured against Meta's own conversion pixel — "
           "not Kartavya revenue — and serving it as ROAS would present the "
           "vendor's marketing claim as this product's measurement.",
)
