"""eSign metrics — proposal 62 §4: requests sent, signed %, median time to
sign, abandoned by type.

THE SCHEMA FACT THIS FILE STANDS ON: there are no esign_* tables. The module
lives in **staging.sign_documents / sign_signers / sign_audit_log** (the
ganit_contract_signers path is the dead parallel plumbing — 0 rows ever,
migration 102 retired it as a source of truth). Every fact below was read from
routers/esign.py and migrations 090/102/114/121/122, 2026-08-18.

· **There is no sent_at column.** Sending flips `sign_documents.status` from
  'draft' to 'sent' and touches `updated_at` — which every later event
  overwrites. The send MOMENT exists only as the 'document_sent' row in
  `sign_audit_log`, written exactly once per document (`send_for_signing`
  requires status='draft'; per-signer resends write 'reminder_sent', never a
  second 'document_sent'). Every windowed metric here therefore reads the
  audit log, joined to the document for org scope — the audit table itself
  carries no org_id.

· **The audit log is on 365-day retention** (migration 122's
  cleanup_old_data). A window reaching further back than the retention horizon
  under-counts sends and drops old documents from the median — stated here
  and in each description rather than discovered in a review meeting. The
  analytics window cap is 1827 days, so the mismatch is reachable.

· **sign_signers.org_id is NULLABLE on the live database** (migration 114's
  own note). Signer facts are always scoped through the document join, never
  through s.org_id — filtering on it would silently drop pre-backfill rows.

· **A decline never touches the document row.** `decline_signing` updates only
  the signer and the audit trail; the document keeps reading 'sent' or
  'partially_signed' forever. Abandonment therefore reads declines from
  sign_signers, not from any document status.

· **Expiry is persisted lazily.** status='expired' is written only when
  someone opens a dead link (`get_signing_page`); a document nobody re-opens
  sits at 'sent' with `expires_at` in the past. 'Expired' must test
  `expires_at < NOW()` as well as the status, or it under-counts.

· Completion is `completed_at IS NOT NULL` — set once, when the last signer
  signs, and a completed document cannot be cancelled. Never inferred from a
  status equality (the doc_status='final' trap, relearned once already).

· Documents raised by other modules (source_module, e.g. Ganit contracts) are
  counted, deliberately: these are aggregates, and a count leaks none of the
  title/PDF content the per-document visibility filter protects.
"""
from analytics.registry import MetricRequest, metric
from analytics.windowing import bucket_expr

#: One row per request actually sent, org-scoped through the document —
#: sign_audit_log carries no org_id of its own. 'document_sent' is written
#: exactly once per document, so COUNT(*) is a count of requests.
_SENT_EVENTS = (
    "FROM staging.sign_audit_log a "
    "JOIN staging.sign_documents d ON d.id = a.document_id "
    "WHERE d.org_id = $1::uuid AND a.action = 'document_sent' "
    "AND a.created_at::date BETWEEN $2::date AND $3::date "
)


@metric(
    key="esign.requests_sent",
    module="esign",
    label="Requests sent",
    unit="count",
    grain="flow",
    drill="esign.documents",
    description="Signature requests sent during the period, by the moment the "
                "signing emails went out — the 'document_sent' audit event, "
                "which is the only place the send moment is recorded. The "
                "audit log is retained 365 days, so a window reaching further "
                "back under-counts.",
)
def requests_sent(req: MetricRequest):
    period = bucket_expr(req.bucket, "a.created_at")
    return (
        f"SELECT {period} AS period, COUNT(*) AS value "
        + _SENT_EVENTS +
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="esign.signed_rate",
    module="esign",
    label="Signed %",
    unit="pct",
    grain="flow",
    drill="esign.documents",
    description="Of the requests sent in each bucket, the share fully signed "
                "since — signed ÷ sent from summed counts per bucket, never "
                "an average of per-document outcomes. Completion is "
                "completed_at, set when the last signer signs; both counts "
                "ride along so the % is auditable.",
)
def signed_rate(req: MetricRequest):
    period = bucket_expr(req.bucket, "a.created_at")
    return (
        f"SELECT {period} AS period, "
        "COUNT(*) FILTER (WHERE d.completed_at IS NOT NULL)::float "
        "/ NULLIF(COUNT(*), 0)::float * 100 AS value, "
        "COUNT(*) FILTER (WHERE d.completed_at IS NOT NULL) AS signed, "
        "COUNT(*) AS sent "
        + _SENT_EVENTS +
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="esign.time_to_sign",
    module="esign",
    label="Time to sign",
    unit="days",
    grain="flow",
    drill="esign.documents",
    description="Median days from send to the last signature, for documents "
                "completed in each bucket. Median (percentile_cont), not mean "
                "— one contract that sat for a quarter must not move the "
                "headline. Send time is the 'document_sent' audit event; a "
                "document whose event has aged past the 365-day audit "
                "retention drops out rather than guessing.",
)
def time_to_sign(req: MetricRequest):
    period = bucket_expr(req.bucket, "d.completed_at")
    return (
        f"SELECT {period} AS period, "
        "percentile_cont(0.5) WITHIN GROUP "
        "(ORDER BY EXTRACT(EPOCH FROM (d.completed_at - s.sent_at)) / 86400.0)"
        "::float AS value, "
        "COUNT(*) AS documents "
        "FROM staging.sign_documents d "
        # MIN() is defensive dedupe: 'document_sent' is written once today,
        # and if that invariant ever breaks the median must not double-weight
        # a document rather than fail loudly somewhere unrelated.
        "JOIN (SELECT document_id, MIN(created_at) AS sent_at "
        "FROM staging.sign_audit_log WHERE action = 'document_sent' "
        "GROUP BY document_id) s ON s.document_id = d.id "
        "WHERE d.org_id = $1::uuid AND d.completed_at IS NOT NULL "
        "AND d.completed_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="esign.abandoned",
    module="esign",
    label="Abandoned requests",
    unit="count",
    grain="stock",
    drill="esign.documents",
    description="Sent-then-dead requests as at today, by how they died: "
                "declined (a signer refused — the document row itself never "
                "records this), cancelled (the sender withdrew it), or "
                "expired (including documents past expires_at whose status "
                "was never lazily flipped). In-flight requests are pending, "
                "not abandoned, and are absent here.",
)
def abandoned(req: MetricRequest):
    # Sent-ness: 'sent', 'partially_signed' and 'expired' imply the document
    # went out. 'cancelled' does NOT — a draft can be cancelled — so cancelled
    # rows must show a 'document_sent' audit event to count. Only that one
    # class leans on the audit log, so the 365-day retention can hide old
    # cancellations but nothing else.
    #
    # Declines come from sign_signers (document-scoped — sg.org_id is NULLABLE
    # on live and is never filtered on). A declined document can never
    # complete (signers_completed can never reach signers_total), so the
    # completed_at IS NULL guard cannot hide one.
    #
    # CASE order is the cause of death: a signer's refusal outranks the
    # sender's later cleanup-cancellation, which outranks the clock.
    return (
        "SELECT CASE "
        "WHEN EXISTS (SELECT 1 FROM staging.sign_signers sg "
        "WHERE sg.document_id = d.id AND sg.status = 'declined') "
        "THEN 'declined' "
        "WHEN d.status = 'cancelled' THEN 'cancelled' "
        "ELSE 'expired' END AS label, "
        "COUNT(*) AS value "
        "FROM staging.sign_documents d "
        "WHERE d.org_id = $1::uuid "
        "AND d.completed_at IS NULL "
        "AND d.status <> 'draft' "
        "AND (d.status <> 'cancelled' OR EXISTS "
        "(SELECT 1 FROM staging.sign_audit_log a "
        "WHERE a.document_id = d.id AND a.action = 'document_sent')) "
        "AND (d.status IN ('cancelled', 'expired') "
        "OR d.expires_at < NOW() "
        "OR EXISTS (SELECT 1 FROM staging.sign_signers sg2 "
        "WHERE sg2.document_id = d.id AND sg2.status = 'declined')) "
        "GROUP BY 1 ORDER BY value DESC",
        [req.org_id],
    )
