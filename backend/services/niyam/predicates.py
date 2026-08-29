"""Time triggers: the facts that become true because a boundary passed.

Nobody DOES "overdue". No user action makes a task late — a moment arrives and
the fact is suddenly true, and there is no write to hang an event on. So the
sweep asks a fixed set of questions on a timer and emits synthetic events with
`source='sweep'` and no actor.

── A NAMED-QUERY ALLOWLIST, NOT A QUERY BUILDER ────────────────────────────

Every predicate is written here, reviewed here, and referenced by NAME. A rule
author picks "a task went overdue" from a list; they never write SQL and no SQL
arrives from a request. That is the same server-side-allowlist rule CLAUDE.md
mandates for every dynamic identifier in this codebase, applied to whole
queries — and it is what keeps the sweep running only indexed statements
somebody has read.

── THE WINDOW IS THE WHOLE PROBLEM ─────────────────────────────────────────

A temporal fact is true CONTINUOUSLY. An invoice is overdue every second of
every day. Without a window the sweep would emit an event per tick and a dunning
rule would mail the customer every tick — which is not a hypothetical: this is
precisely how `reminder_service` came to be able to re-create its entire backlog
in one tick, because its de-duplication was a `NOT EXISTS … created_at > NOW() -
INTERVAL` clause whose windows had long since lapsed.

So each predicate declares a WINDOW, which becomes the `dedupe_key`, which is
enforced by the partial unique index on `niyam_events` — an index, not a code
path anyone has to remember.

    once    fires one event per entity. "This became overdue" is a fact that
            happens once; nagging is a different rule.
    daily   one per entity per calendar day.
    weekly  one per entity per ISO week — the honest cadence for a nag.

HONEST CAVEAT about `once`: the dedupe index lives on `niyam_events`, so once a
row ages out under retention the same key can be written again. `once` therefore
means "once per retention window", not "once ever". Stated here because the
alternative — a permanent side table of emitted keys — is a second source of
truth, and the retention window is long enough that the distinction is
theoretical for now. It stops being theoretical if retention is ever shortened.

── AND THE LOOKBACK, WHICH IS THE OTHER HALF ───────────────────────────────

Measured against the live database before this file was written: 160 tasks are
overdue right now, and 66 of those crossed the line in the last 14 days. Without
a lookback the FIRST tick would emit 160 events for deadlines that were missed
months ago, most of them on work everybody has already moved past.

`max_age_days` bounds that permanently, and it also fixes the semantics: the
event means "recently became overdue", which is what a rule author means when
they pick it. An item older than the lookback is not news.

Both bounds are per predicate and both are visible in the table below, because
the failure they prevent is invisible until somebody is emailed about it.
"""
from __future__ import annotations

import logging
from typing import Any, NamedTuple

from .subjects import (
    APPROVAL_PENDING, ATTENDANCE_SUMMARY, CONTACT_STALE, DOCUMENT_EXPIRING,
    INVOICE_OVERDUE, REPORT_DUE, STOCK_LOW, TASK_OVERDUE, temporal,
)

log = logging.getLogger(__name__)

#: Rows one predicate may emit in a single tick. Oldest first, and whatever is
#: left is picked up next tick — the `/cron/marketing` shape, not the reminder
#: dispatcher's claim-everything-with-no-LIMIT shape.
PER_TICK = 50


class Predicate(NamedTuple):
    name: str
    event_type: str
    entity_type: str
    label: str                 # what a rule author reads
    window: str                # once | daily | weekly
    max_age_days: int
    sql: str


def _anti_join(pred: Predicate) -> str:
    """SQL that excludes rows whose dedupe key has already been written.

    ── WHY, AND WHY IT IS NOT THE GUARANTEE ────────────────────────────────

    Without this, every tick re-fetched the same rows and attempted an INSERT
    for each, which the partial unique index then rejected. Measured at the
    */15 cadence that is roughly 4,800 no-op write transactions a day against a
    database production shares — for a result that was already known.

    The worse half was STARVATION. Each query ends `ORDER BY <age> LIMIT 50`, so
    the fifty oldest rows were fetched and discarded every tick for ever, and
    row fifty-one was never reached. The backlog drained on the calendar — as
    entries aged past `max_age_days` — rather than on the tick rate. Filtering
    INSIDE the limit means the fifty rows a tick fetches are fifty rows that
    have something to say.

    THE INDEX REMAINS THE GUARANTEE. This clause reads the clock in SQL
    (`to_char(NOW(), …)`) while `_dedupe` reads it in Python, and at a date or
    ISO-week boundary the two can disagree by one tick. That is harmless
    precisely because it is only a pre-filter: a row this clause lets through
    still meets the unique index, still returns None, and is still counted as
    `deduped`. Correctness never moved out of the index.
    """
    key = {
        "once":   "$3::text || ':' || q_entity_id",
        "weekly": "$3::text || ':' || q_entity_id || ':' || to_char(NOW(), 'IYYY\"W\"IW')",
    }.get(pred.window,
          "$3::text || ':' || q_entity_id || ':' || to_char(NOW(), 'YYYY-MM-DD')")
    return ("NOT EXISTS (SELECT 1 FROM public.niyam_events e "
            f"WHERE e.dedupe_key = {key})")


def resolved_sql(pred: Predicate) -> str:
    """`pred.sql` with its `{anti_join:<expr>}` placeholder expanded.

    The placeholder carries the entity expression because it differs per query
    (`t.task_id`, `i.id::text`, …) and the dedupe key is built from it. Done by
    replacement rather than `str.format` so a stray brace in a future query
    cannot turn into a formatting error at runtime — this SQL is a constant in
    this module, never anything from a request, which is the same
    server-side-allowlist rule the module header states.
    """
    start = pred.sql.find("{anti_join:")
    if start == -1:
        return pred.sql
    end = pred.sql.index("}", start)
    entity_expr = pred.sql[start + len("{anti_join:"):end]
    return (pred.sql[:start]
            + _anti_join(pred).replace("q_entity_id", entity_expr)
            + pred.sql[end + 1:])


def _dedupe(pred: Predicate, entity_id: str, now) -> str:
    if pred.window == "once":
        return f"{pred.name}:{entity_id}"
    if pred.window == "weekly":
        iso = now.isocalendar()
        return f"{pred.name}:{entity_id}:{iso[0]}W{iso[1]:02d}"
    return f"{pred.name}:{entity_id}:{now.date().isoformat()}"


#: Every query returns the same envelope — `org_id`, `entity_id`, and whatever
#: scalars the payload carries. `$1::int` is the lookback in days and `$2::int`
#: the row ceiling; both CAST, because an untyped parameter expression is an
#: instant PgBouncer 500 and this product has already lost every credit spend to
#: exactly that.
PREDICATES: tuple = (
    Predicate(
        name="tasks_overdue",
        event_type=TASK_OVERDUE,
        entity_type="task",
        label="A task went past its due date",
        # `once`: becoming overdue happens once. A daily nag about the same task
        # is a different rule somebody should choose deliberately.
        #
        # THE FLOOR BELOW IS LOAD-BEARING, NOT TASTE. With `window="once"` a task
        # emits exactly ONE event, ever. The first draft floored at `due_at <
        # NOW()`, so that event carried `days_overdue = 0` — and BOTH shipped
        # templates compare it (`overdue-nudge` wants >= 3, `urgent-overdue-
        # escalate` wants >= 1). Neither could ever match, and neither would
        # have looked broken: the predicate emitted, the rule ran, the condition
        # honestly recorded `0 >= 3 is False`, for ever.
        #
        # Flooring at three days makes `overdue-nudge` fire exactly as written.
        # `urgent-overdue-escalate` fires too, but on day three rather than the
        # day one its author intended — a day-one escalation AND a day-three
        # nudge from one `once` event is not expressible, because a single event
        # carries a single number. Emitting per THRESHOLD would fix it and is
        # deliberately not done here: every rule would then fire at every
        # threshold above its own, turning one notification into three.
        window="once",
        max_age_days=14,
        sql="""
            -- EVERY field the registry promises for this event type, and
            -- `test_niyam_predicates.py` enforces that. A predicate returning
            -- fewer columns than the registry advertises produces conditions
            -- that are offerable and permanently unevaluable — the same defect
            -- as reading a column that does not exist, arrived at from the
            -- other direction and just as invisible.
            SELECT tm.org_id                       AS org_id,
                   t.task_id                       AS entity_id,
                   t.status, t.priority, t.title,
                   t.team_id                       AS project_id,
                   t.column_id,
                   t.category_id,
                   t.due_at,
                   t.assignee_user_ids,
                   COALESCE(array_length(t.assignee_user_ids, 1), 0) AS assignee_count,
                   t.approval_status,
                   t.created_by_user_id            AS created_by,
                   EXTRACT(DAY FROM NOW() - t.due_at)::int AS days_overdue
              FROM public.tasks t
              JOIN public.teams tm ON tm.team_id = t.team_id
             WHERE {anti_join:t.task_id}
               AND t.due_at < NOW() - INTERVAL '3 days'
               AND t.due_at > NOW() - ($1::int * INTERVAL '1 day')
               AND t.status <> 'done'
               AND t.archived_at IS NULL
               AND tm.org_id IS NOT NULL
             ORDER BY t.due_at
             LIMIT $2::int
        """,
    ),
    Predicate(
        name="approvals_pending",
        event_type=APPROVAL_PENDING,
        entity_type="approval",
        label="An approval has been waiting",
        # `weekly`: this one IS a nag — the whole point is that somebody has not
        # looked. Daily would be badgering, once would be forgettable.
        window="weekly",
        max_age_days=30,
        sql="""
            SELECT tm.org_id                       AS org_id,
                   a.approval_id                   AS entity_id,
                   a.request_type,
                   a.team_id                       AS project_id,
                   a.requested_by                  AS created_by,
                   a.task_id,
                   EXTRACT(DAY FROM NOW() - a.created_at)::int AS days_waiting
              FROM public.approvals a
              JOIN public.teams tm ON tm.team_id = a.team_id
             WHERE {anti_join:a.approval_id}
               AND a.status = 'pending'
               AND a.created_at < NOW() - INTERVAL '2 days'
               AND a.created_at > NOW() - ($1::int * INTERVAL '1 day')
               AND tm.org_id IS NOT NULL
             ORDER BY a.created_at
             LIMIT $2::int
        """,
    ),
    Predicate(
        name="invoices_overdue",
        event_type=INVOICE_OVERDUE,
        entity_type="invoice",
        label="An invoice passed its due date unpaid",
        # `weekly`, and note what this event does NOT do: it reaches nobody
        # outside the firm. The customer-facing dunning ladder is N8 and is
        # owner-gated, because the failure mode is mailing a client in dunning
        # language about an invoice somebody has already paid by bank transfer —
        # and "paid" only ever arrives here by reconciliation.
        window="weekly",
        max_age_days=90,
        sql="""
            SELECT i.org_id                        AS org_id,
                   i.id::text                      AS entity_id,
                   i.invoice_number,
                   i.balance_due::float            AS balance_due,
                   i.total::float                  AS total,
                   i.payment_status,
                   i.client_id::text               AS client_id,
                   i.created_by                    AS created_by,
                   (NOW()::date - i.due_date)::int AS days_overdue
              FROM public.ganit_invoices i
             WHERE {anti_join:i.id::text}
               AND i.due_date < NOW()::date
               AND i.due_date > (NOW() - ($1::int * INTERVAL '1 day'))::date
               AND COALESCE(i.balance_due, 0) > 0
               AND i.is_active
               -- `'invoice'` is not a value this product can write. The
               -- creator's allowlist is
               -- (tax_invoice, proforma, credit_note, debit_note, quotation)
               -- and `doc_validation.TAX_DOCUMENT_TYPES` narrows the money
               -- documents to three of those. Measured on the live database:
               -- 758 tax_invoice, 22 credit_note, and 212 invoices unpaid and
               -- past due — of which this predicate matched ZERO.
               --
               -- proforma and quotation are excluded on purpose: neither is a
               -- demand for payment, so neither can be overdue. A credit_note
               -- is money owed the OTHER way.
               AND i.invoice_type IN ('tax_invoice', 'debit_note')
               AND i.cancelled_at IS NULL
             ORDER BY i.due_date
             LIMIT $2::int
        """,
    ),
    Predicate(
        name="contacts_stale",
        event_type=CONTACT_STALE,
        entity_type="contact",
        label="A lead has gone quiet",
        window="once",
        max_age_days=90,
        sql="""
            SELECT c.org_id                        AS org_id,
                   c.id::text                      AS entity_id,
                   c.contact_type,
                   c.source,
                   c.company,
                   c.assigned_to,
                   c.client_id::text               AS client_id,
                   c.lead_score,
                   EXTRACT(DAY FROM NOW() - c.last_contacted_at)::int AS days_quiet
              FROM public.graha_contacts c
             WHERE {anti_join:c.id::text}
               AND c.is_active
               AND c.contact_type IS DISTINCT FROM 'client'
               AND c.last_contacted_at IS NOT NULL
               AND c.last_contacted_at < NOW() - INTERVAL '30 days'
               AND c.last_contacted_at > NOW() - ($1::int * INTERVAL '1 day')
               AND c.merged_into_id IS NULL
             ORDER BY c.last_contacted_at
             LIMIT $2::int
        """,
    ),
    Predicate(
        name="stock_low",
        event_type=STOCK_LOW,
        entity_type="product",
        label="A product is at or below its stock threshold",
        # `weekly`: stock stays low until somebody buys more, and a one-off
        # alert about a fact that stays true is missed once and never again.
        # The threshold itself is the ORG'S opt-in — rows with threshold 0
        # (the column default) can never fire, so a firm that ignores the
        # stock screen is never nagged about it.
        window="weekly",
        max_age_days=30,
        sql="""
            SELECT s.org_id                           AS org_id,
                   s.product_id::text                 AS entity_id,
                   p.name                             AS product_name,
                   s.quantity_on_hand::float          AS quantity_on_hand,
                   s.low_stock_threshold::float       AS low_stock_threshold,
                   (s.low_stock_threshold - s.quantity_on_hand)::float AS shortfall
              FROM public.vikray_stock s
              JOIN public.ganit_products p
                ON p.id = s.product_id AND p.org_id = s.org_id
             WHERE {anti_join:s.product_id::text}
               AND s.low_stock_threshold > 0
               AND s.quantity_on_hand <= s.low_stock_threshold
               AND COALESCE(p.is_active, TRUE)
               -- a service has no shelf: `is_service` rows carry stock rows
               -- only by accident of the products screen, and nagging about
               -- "low stock" of consulting hours erodes trust in every alert.
               AND p.is_service IS NOT TRUE
               -- the lookback is on MOVEMENT: a level that changed recently
               -- is being managed; one untouched for a month is a decision
               -- already made, not news.
               AND s.updated_at > NOW() - ($1::int * INTERVAL '1 day')
             ORDER BY s.updated_at
             LIMIT $2::int
        """,
    ),
    Predicate(
        name="attendance_summary",
        event_type=ATTENDANCE_SUMMARY,
        entity_type="attendance_day",
        label="Yesterday's attendance, as counts",
        # `once` — but the entity id CONTAINS the date, so "once per entity"
        # means once per org per day, and a day the sweep slept through is
        # caught up on the next tick (any complete day inside the lookback
        # that has not fired yet, not just yesterday).
        #
        # COUNTS ONLY, enforced by the SELECT list: no employee id, name or
        # per-person status leaves this query. DPDP is the reason — see the
        # event constant in subjects.py. The org id inside the entity id is
        # hashed for the same family of reason (an org UUID must never be
        # renderable), and the hash costs nothing: dedupe needs distinctness,
        # not reversibility.
        window="once",
        max_age_days=3,
        sql="""
            SELECT a.org_id                                           AS org_id,
                   'att:' || substr(md5(a.org_id::text), 1, 12)
                          || ':' || a.date::text                      AS entity_id,
                   a.date::text                                       AS report_date,
                   COUNT(*)::int                                      AS marked_count,
                   COUNT(*) FILTER (WHERE a.status = 'present')::int  AS present_count,
                   COUNT(*) FILTER (WHERE a.status = 'absent')::int   AS absent_count,
                   COUNT(*) FILTER (WHERE a.status = 'late')::int     AS late_count,
                   COUNT(*) FILTER (WHERE a.status = 'half_day')::int AS half_day_count,
                   COUNT(*) FILTER (WHERE a.status = 'on_leave')::int AS on_leave_count
              FROM public.manav_attendance a
             WHERE {anti_join:('att:' || substr(md5(a.org_id::text), 1, 12) || ':' || a.date::text)}
               -- complete days only: today's numbers move until midnight,
               -- and a summary that changes after it is sent is a wrong one.
               AND a.date < NOW()::date
               AND a.date >= (NOW() - ($1::int * INTERVAL '1 day'))::date
             GROUP BY a.org_id, a.date
             ORDER BY a.date
             LIMIT $2::int
        """,
    ),
    Predicate(
        name="documents_expiring",
        event_type=DOCUMENT_EXPIRING,
        entity_type="document",
        label="A signature request nears its expiry",
        # `once`: a document approaches its expiry exactly one time, and the
        # useful alert is the first one — a daily repeat over the last three
        # days would be three notifications about one fact. If the sender
        # extends `expires_at` past the horizon and it approaches AGAIN, the
        # `once` window suppresses the second approach; accepted, because the
        # person who extended it is the person the alert would have told.
        window="once",
        # $1 is a FORWARD horizon here, not a lookback: how many days before
        # `expires_at` the fact becomes worth an event. The Predicate field is
        # named for the six queries above, where age runs backwards; this one
        # runs forwards, and 3 days is chosen to leave time to chase a signer
        # before the token dies (the default lifetime is only 7).
        max_age_days=3,
        sql="""
            SELECT d.org_id                          AS org_id,
                   d.id::text                        AS entity_id,
                   d.title                           AS document_title,
                   (d.expires_at::date - NOW()::date)::int AS days_left,
                   COUNT(s.id) FILTER (
                       WHERE s.status NOT IN ('signed', 'declined')
                   )::int                            AS pending_signers
              FROM public.sign_documents d
              LEFT JOIN public.sign_signers s ON s.document_id = d.id
             WHERE {anti_join:d.id::text}
               -- in flight only: draft has no clock running anybody cares
               -- about, completed/cancelled/expired are already over.
               AND d.status IN ('sent', 'partially_signed')
               AND d.expires_at IS NOT NULL
               AND d.expires_at > NOW()
               AND d.expires_at < NOW() + ($1::int * INTERVAL '1 day')
             GROUP BY d.org_id, d.id, d.title, d.expires_at
             ORDER BY d.expires_at
             LIMIT $2::int
        """,
    ),
    Predicate(
        name="reports_due",
        event_type=REPORT_DUE,
        entity_type="report",
        label="A scheduled report reaches its send time",
        # `daily` — the dedupe key carries the date, so a schedule fires at
        # most once per calendar day however many ticks pass its send time.
        # `last_sent_at < slot` (below) is the second, independent guard —
        # and the retry: a day whose report.send FAILED leaves last_sent_at
        # unstamped, so tomorrow's fresh dedupe key re-offers the slot while
        # it is still inside the grace window.
        window="daily",
        # $1 is the GRACE: how many days after its appointed moment a slot is
        # still worth serving. The first draft required the appointed DAY
        # itself, which meant any day the sweep slept through — a deploy, an
        # outage, staging's cost-sleep — lost a weekly report for seven days
        # and a monthly for a month, silently. Two days keeps a missed send
        # recoverable without ever mailing week-old numbers as fresh.
        max_age_days=2,
        # ── the slot ─────────────────────────────────────────────────────────
        # `slot` is the most recent appointed moment at or before NOW(),
        # computed per frequency in the LATERAL below (all clock arithmetic
        # in UTC — time_utc is a bare TIME and says so in its name):
        #   daily    today at time_utc, or yesterday's if today's is ahead;
        #   weekly   the most recent matching day-of-week ('dow', not
        #            'isodow': the form indexes ['Sunday'..'Saturday'] from
        #            0, exactly Postgres dow — isodow would send every weekly
        #            report a day late and Sunday's never), stepped back a
        #            week when today matches but the hour is still ahead;
        #   monthly  day_of_month CLAMPED to each month's real length
        #            (LEAST against the month's last day, the same rule
        #            services/report_schedule_window._clamp_day states: "the
        #            31st" means month-end to the person who set it — exact
        #            equality silently never fired day 29/30/31 in short
        #            months), falling back to the PREVIOUS month's clamped
        #            day while this month's is still ahead.
        # A row is due when its slot has arrived, is younger than the grace,
        # and nothing has been sent AT or SINCE it — with created_at as the
        # floor so a schedule created mid-cycle does not fire for a slot
        # that predates its own existence.
        # (`date_part`, not EXTRACT: the schema-qualification ratchet reads
        # `EXTRACT(x FROM y)` in a WHERE clause as a table named NOW.)
        sql="""
            SELECT r.org_id                          AS org_id,
                   r.id::text                        AS entity_id,
                   r.name                            AS name,
                   r.report_type,
                   r.frequency,
                   COALESCE(array_length(r.recipients, 1), 0) AS recipient_count
              -- comma-LATERAL, not CROSS JOIN LATERAL: same semantics,
              -- but the schema-qualification ratchet reads `JOIN LATERAL`
              -- as a table reference named LATERAL.
              FROM public.dristi_scheduled_reports r,
              LATERAL (
                  SELECT COALESCE(r.time_utc, '08:00'::time) AS t
              ) tt,
              LATERAL (
                  SELECT (CASE
                      WHEN r.frequency = 'daily' THEN
                          CASE WHEN (NOW() AT TIME ZONE 'UTC')::time >= tt.t
                               THEN (NOW() AT TIME ZONE 'UTC')::date
                               ELSE (NOW() AT TIME ZONE 'UTC')::date - 1
                          END
                      WHEN r.frequency = 'weekly' THEN
                          (NOW() AT TIME ZONE 'UTC')::date
                          - ((date_part('dow', NOW() AT TIME ZONE 'UTC')::int
                              - COALESCE(r.day_of_week, 1) + 7) % 7)
                          - CASE WHEN ((date_part('dow', NOW() AT TIME ZONE 'UTC')::int
                                        - COALESCE(r.day_of_week, 1) + 7) % 7) = 0
                                      AND (NOW() AT TIME ZONE 'UTC')::time < tt.t
                                 THEN 7 ELSE 0 END
                      ELSE
                          CASE WHEN date_trunc('month', NOW() AT TIME ZONE 'UTC')::date
                                    + (LEAST(COALESCE(r.day_of_month, 1),
                                             date_part('day',
                                                 date_trunc('month', NOW() AT TIME ZONE 'UTC')
                                                 + INTERVAL '1 month - 1 day')::int) - 1)
                                    + tt.t <= (NOW() AT TIME ZONE 'UTC')
                               THEN date_trunc('month', NOW() AT TIME ZONE 'UTC')::date
                                    + (LEAST(COALESCE(r.day_of_month, 1),
                                             date_part('day',
                                                 date_trunc('month', NOW() AT TIME ZONE 'UTC')
                                                 + INTERVAL '1 month - 1 day')::int) - 1)
                               ELSE date_trunc('month', (NOW() AT TIME ZONE 'UTC') - INTERVAL '1 month')::date
                                    + (LEAST(COALESCE(r.day_of_month, 1),
                                             date_part('day',
                                                 date_trunc('month', NOW() AT TIME ZONE 'UTC')
                                                 - INTERVAL '1 day')::int) - 1)
                          END
                  END + tt.t) AT TIME ZONE 'UTC' AS slot
              ) s
             WHERE {anti_join:r.id::text}
               AND r.is_active
               AND s.slot <= NOW()
               AND NOW() - s.slot < ($1::int * INTERVAL '1 day')
               AND COALESCE(r.last_sent_at, r.created_at) < s.slot
             ORDER BY r.created_at
             LIMIT $2::int
        """,
    ),
)

BY_NAME = {p.name: p for p in PREDICATES}


def _payload(row) -> dict:
    """Everything the query returned except the envelope.

    Datetimes are rendered here rather than handed to `_clean`, which DROPS a
    value it cannot serialise — silently, with no log line. Three emitters
    already hand-render for the same reason; that convention is load-bearing.
    """
    out = {}
    for k, v in dict(row).items():
        if k in ("org_id", "entity_id"):
            continue
        out[k] = v.isoformat() if hasattr(v, "isoformat") else v
    return out


async def run_one(pool, pred: Predicate, *, now, limit: int = PER_TICK) -> dict:
    """Emit for one predicate. Returns {found, emitted, deduped}.

    `emitted` and `deduped` are reported separately and both matter: a tick that
    finds 50 rows and emits 0 is CORRECT once the window has already fired, and
    is indistinguishable from a broken emitter unless the two are counted apart.
    """
    async with pool.acquire() as conn:
        # `pred.name` as $3: it is the first component of every dedupe key, and
        # binding it keeps the key's shape in ONE place rather than repeated as
        # a literal in four queries that would then drift from `_dedupe`.
        rows = await conn.fetch(resolved_sql(pred), pred.max_age_days, limit,
                                pred.name)

    emitted = deduped = 0
    for row in rows:
        org_id, entity_id = row["org_id"], row["entity_id"]
        if not org_id or not entity_id:
            continue
        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    event_id = await temporal(
                        conn,
                        org_id=str(org_id),
                        event_type=pred.event_type,
                        entity_type=pred.entity_type,
                        entity_id=entity_id,
                        dedupe_key=_dedupe(pred, str(entity_id), now),
                        after=_payload(row),
                    )
            if event_id is None:
                deduped += 1        # the window has already fired — normal
            else:
                emitted += 1
        except Exception:
            # One row must never end the predicate, and no predicate may end the
            # tick. The emitter already contains database faults in a savepoint;
            # this catches the rest.
            log.exception("niyam: %s could not emit for %s", pred.name, entity_id)

    return {"found": len(rows), "emitted": emitted, "deduped": deduped}


async def run_all(pool, *, now, only=None) -> dict:
    """Every predicate, or a named subset. One failing predicate does not stop
    the others — they are independent questions about unrelated tables."""
    out, errors = {}, 0
    for pred in PREDICATES:
        if only and pred.name not in only:
            continue
        try:
            out[pred.name] = await run_one(pool, pred, now=now)
        except Exception:
            log.exception("niyam: predicate %s failed entirely", pred.name)
            out[pred.name] = {"error": True}
            errors += 1
    return {"predicates": out, "errors": errors}
