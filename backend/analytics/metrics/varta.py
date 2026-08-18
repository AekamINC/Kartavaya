"""Varta (WhatsApp Cloud API) metrics — proposal 62 §4: sends by template,
delivery and read rate, reply rate, template rejections, cost per
conversation. The last two are declared ABSENT — the schema cannot answer
them honestly, and the reasons are specific.

Facts read from routers/whatsapp.py and migrations 058/123/147, 2026-08-18:

· **The status ladder is real and has a writer.** An outbound message is born
  'pending' once Meta accepts it; the statuses webhook moves it through
  sent → delivered → read (or failed) by wa_message_id. 'suppressed'
  (migration 147) means OUTBOUND_MODE stopped it before Meta ever saw it —
  it is not a send and is excluded from every count and every denominator
  here, or a dry-run staging month reads as a delivery collapse.

· **Status is overwritten in place with no per-transition timestamp** —
  varta_messages has only created_at. Delivery and read rates are therefore
  "as at now, for the period's sends", and say so; there is no
  delivered-within-24h to compute without inventing a column.

· **Inbound rows are born 'delivered'** (the webhook writes them that way),
  so every metric filters direction='outbound' — without it the read rate
  would count the customer's own messages as undelivered.

· **Free-form sends have template_name NULL** (and Meta only allows them
  inside the 24-hour service window). The template dimension labels them
  'Free-form message' rather than dropping them or leaking a NULL.

· **template_rejections is absent**: varta_templates.status admits
  'rejected', but the only writers in the product are the INSERT (which
  leaves the 'draft' default) and DELETE. Nothing submits a template to
  Meta's review and nothing ingests the message_template_status_update
  webhook, so a rejection can never reach this database. Counting the column
  would be a convincing zero — plus one seeded demo row.

· **cost_per_conversation is absent**: no cost column exists on any varta
  table, and that is a decision, not a gap — Meta bills the org's own WABA
  directly and routers/whatsapp.py records no per-message charge ("we sell
  the automation, never the messages").
"""
from analytics.registry import MetricRequest, absent_metric, metric
from analytics.windowing import bucket_expr

#: Everything the org actually handed to Meta in the window. 'suppressed'
#: rows were never sent (migration 147) and belong in no denominator;
#: 'failed' rows stay — Meta rejected a real attempt, and delivery rate must
#: feel it.
_OUTBOUND = (
    "FROM staging.varta_messages "
    "WHERE org_id = $1::uuid AND direction = 'outbound' "
    "AND status <> 'suppressed' "
    "AND created_at::date BETWEEN $2::date AND $3::date "
)


@metric(
    key="varta.sends",
    module="varta",
    label="Messages sent",
    unit="count",
    grain="flow",
    dimensions=("template",),
    drill="varta.messages",
    description="Outbound messages handed to Meta during the period, per "
                "bucket; group_by=template answers 'which template carried "
                "the traffic' for the whole window instead. Free-form "
                "session messages count under 'Free-form message'. "
                "Suppressed (dry-run) rows are not sends and never appear.",
)
def sends(req: MetricRequest):
    if req.group_by == "template":
        return (
            "SELECT COALESCE(NULLIF(template_name, ''), 'Free-form message') "
            "AS template, "
            "COUNT(*) AS value "
            + _OUTBOUND +
            "GROUP BY 1 ORDER BY value DESC",
            [req.org_id, req.window.start, req.window.end],
        )
    period = bucket_expr(req.bucket, "created_at")
    return (
        f"SELECT {period} AS period, COUNT(*) AS value "
        + _OUTBOUND +
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="varta.delivery_rate",
    module="varta",
    label="Delivery rate",
    unit="pct",
    grain="flow",
    drill="varta.messages",
    description="Of the messages sent in each bucket, the share Meta has "
                "reported delivered — status delivered or read, since read "
                "implies delivered on Meta's ladder and the status is "
                "overwritten in place. Counts ride along; the rate is counts "
                "over counts per bucket, as at now — there is no "
                "per-transition timestamp to age it against.",
)
def delivery_rate(req: MetricRequest):
    period = bucket_expr(req.bucket, "created_at")
    return (
        f"SELECT {period} AS period, "
        "COUNT(*) FILTER (WHERE status IN ('delivered', 'read'))::float "
        "/ NULLIF(COUNT(*), 0)::float * 100 AS value, "
        "COUNT(*) FILTER (WHERE status IN ('delivered', 'read')) AS delivered, "
        "COUNT(*) AS sends "
        + _OUTBOUND +
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="varta.read_rate",
    module="varta",
    label="Read rate",
    unit="pct",
    grain="flow",
    drill="varta.messages",
    description="Of the messages sent in each bucket, the share the "
                "recipient has read — status 'read' only, strictly narrower "
                "than delivered. Blind to recipients who disable read "
                "receipts, which is a floor, not a fault, and worth knowing "
                "when reading the number.",
)
def read_rate(req: MetricRequest):
    period = bucket_expr(req.bucket, "created_at")
    return (
        f"SELECT {period} AS period, "
        "COUNT(*) FILTER (WHERE status = 'read')::float "
        "/ NULLIF(COUNT(*), 0)::float * 100 AS value, "
        "COUNT(*) FILTER (WHERE status = 'read') AS reads, "
        "COUNT(*) AS sends "
        + _OUTBOUND +
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="varta.reply_rate",
    module="varta",
    label="Reply rate",
    unit="pct",
    grain="flow",
    drill="varta.messages",
    description="Of the messages sent in each bucket, the share whose "
                "conversation received an inbound message afterwards — a "
                "reply to the conversation, which is the closest honest "
                "reading (Meta does not say which message prompted it). "
                "Counts ride along; counts over counts per bucket.",
)
def reply_rate(req: MetricRequest):
    # The EXISTS is computed per outbound row in a subquery, then aggregated
    # — a reply is any LATER inbound message in the same conversation. Both
    # sides are org-filtered: conversation ids are org-bound already, but the
    # inner filter keeps the scan inside the org's partition of the table.
    period = bucket_expr(req.bucket, "created_at")
    return (
        f"SELECT {period} AS period, "
        "COUNT(*) FILTER (WHERE replied)::float "
        "/ NULLIF(COUNT(*), 0)::float * 100 AS value, "
        "COUNT(*) FILTER (WHERE replied) AS replied, "
        "COUNT(*) AS sends "
        "FROM ("
        "SELECT m.created_at, "
        "EXISTS (SELECT 1 FROM staging.varta_messages r "
        "WHERE r.org_id = $1::uuid "
        "AND r.conversation_id = m.conversation_id "
        "AND r.direction = 'inbound' "
        "AND r.created_at > m.created_at) AS replied "
        "FROM staging.varta_messages m "
        "WHERE m.org_id = $1::uuid AND m.direction = 'outbound' "
        "AND m.status <> 'suppressed' "
        "AND m.created_at::date BETWEEN $2::date AND $3::date"
        ") s "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


# ── Declared absent — the schema cannot answer these honestly ────────────────
# Proposal 62 §10: a stated absence, never a convincing zero. Each reason was
# verified against the code and migrations on 2026-08-18.

absent_metric(
    key="varta.template_rejections",
    module="varta",
    label="Template rejections",
    unit="count",
    grain="flow",
    absent="varta_templates.status admits 'rejected' but nothing in the "
           "product ever writes it: the only writers are the INSERT in "
           "routers/whatsapp.py (which leaves the 'draft' default) and "
           "DELETE. No code submits a template to Meta's review and no "
           "webhook handler ingests message_template_status_update, so a "
           "rejection cannot reach this database — and there is no "
           "rejected_at column to window a flow on. The one live 'rejected' "
           "row is demo seed data.",
)

absent_metric(
    key="varta.cost_per_conversation",
    module="varta",
    label="Cost per conversation",
    unit="inr",
    grain="flow",
    sensitivity="financial",
    absent="No cost or pricing column exists on varta_messages, "
           "varta_conversations or varta_business_accounts (migrations "
           "058/123/147), and that is a decision, not an oversight: Meta "
           "bills the org's own WABA directly, and routers/whatsapp.py "
           "deliberately records no per-message charge — 'we sell the "
           "automation, never the messages'. Computing this needs ingestion "
           "of Meta's conversation-pricing webhooks or billing API, which is "
           "not built.",
)
