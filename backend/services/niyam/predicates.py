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
    APPROVAL_PENDING, CONTACT_STALE, INVOICE_OVERDUE, TASK_OVERDUE, temporal,
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
    return ("NOT EXISTS (SELECT 1 FROM staging.niyam_events e "
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
              FROM staging.ganit_invoices i
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
              FROM staging.graha_contacts c
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
