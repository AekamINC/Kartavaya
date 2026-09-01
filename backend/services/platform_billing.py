"""platform_billing.py — turning an armed billing line into an invoice Aekam issues.

── WHAT THIS IS ────────────────────────────────────────────────────────────

`org_billing_lines` says what an organisation is charged for the Kartavaya
platform. `subscription_invoices` is the document Aekam issues for it. Until
now nothing joined the two automatically: every upstream invoice was raised by
a person pressing Create in the billing console, and a monthly platform fee is
the most mechanical document in the product.

`sweep_platform_invoices` is the cron half. It is the UPSTREAM twin of
`routers/client_billing.py::sweep_client_auto_invoices` — Aekam → org, where
that one is org → the org's own client — and it is deliberately built out of
the same four decisions, because both of them are unattended writers of money
documents and the ways they can go wrong are identical.

── THE FOUR DECISIONS, INHERITED ON PURPOSE ────────────────────────────────

 1. THE PERIOD ADVANCES FROM THE LAST INVOICED PERIOD, never recomputed from
    the line's origin. The downstream sweep shipped with that bug and it
    invoiced a monthly retainer EXACTLY ONCE, FOR EVER — the first run billed
    it, the join table then held that period permanently, and every run
    afterwards reported "skipped", which is also what it says about a line that
    is simply not due yet. Nothing in the product looked wrong.

 2. ONE PERIOD PER LINE PER RUN. A line dormant for a year does not mint twelve
    documents on the morning somebody arms the cron. It bills the oldest
    unbilled period and catches up one period per daily tick.

 3. DRAFT, WRITTEN EXPLICITLY. Nobody watches a cron. See `_DRAFT` below.

 4. THE OWNER IS NEVER BILLED, and the sweep does not merely avoid it — it
    cannot reach it. See `_ARMED_LINES`.

── ⚠ THIS MODULE DOES NOT OWN THE NO-DOUBLE-CHARGE RULE, AND MUST NOT ──────

The brief for this file said there was no platform-side equivalent of
`client_invoice_lines` and that one had to be built. THERE IS ONE.
`invoice_billing_lines` has existed since migration 096 with
`uq_ibl_line_period` UNIQUE on `(line_id, period_start)` — 096's own comment
calls that index "THE NO-DOUBLE-CHARGE RULE, AS AN INDEX RATHER THAN AS A CODE
PATH" — and `services/billing_lines.py::record_billed` is its single writer.

So this module CALLS `record_billed` rather than inserting into the join table.
That is not deference for its own sake. `record_billed` already refuses, rather
than skips, three things this sweep would otherwise have to re-derive: a line
already billed for the period, a line that was never DUE in the period, and a
credit recorded with a sign that contradicts its kind. Re-implementing any of
them here would put two definitions of "already billed" in the product, and the
first month they disagreed, one of them would be the one that let a client be
charged twice.

The same argument covers "due": `lines_due_in_period` is asked which lines this
sweep may bill, instead of this file deciding for itself. `_covering_line` —
the rule that stops a stopped-and-restarted plan being billed twice in the
month it restarts — is subtle enough that a second copy of it would be wrong.

── WHERE PRO-RATA ACTUALLY APPLIES, WHICH IS NARROWER THAN IT SOUNDS ───────

`services/platform_proration.py` can apportion any period. This table can
hardly ever produce one, and saying so is more useful than pretending
otherwise. Read live from `pg_constraint` on 2026-09-01:

    org_billing_lines_cadence_check       cadence IN ('monthly','one_off')
    org_billing_lines_period_start_check  period_start = date_trunc('month', …)
    org_billing_lines_period_end_check    period_end IS NULL OR = date_trunc(…)

Every span this table can hold therefore starts on the 1st and ends on a month
boundary. A line cannot begin on the 15th; a line cannot stop on the 20th. So
`split_period` has no case here at all — a price change in this model ENDS one
month-aligned line and OPENS another — and `prorate` has exactly one:

    `invoice_from` carries NO month-start CHECK.

It is the floor on how far back automation may reach (migration 252), and an
org onboarded mid-month gets `invoice_from = 2026-09-15`. That is a real
half-month and it is apportioned by days. Everything else bills whole periods,
and `prorate` returns the stated amount untouched for those rather than
`amount * days/days`, so a whole month is never off by a rounding step.

── MONEY IS DECIMAL THE WHOLE WAY ──────────────────────────────────────────

`subtotal`, `gst` and `total` are NUMERIC(12,2) and asyncpg round-trips
`Decimal` into them exactly. Floats appear only inside `line_items`, which is
JSON and has no decimal type — and every value put there has already been
quantised by `money()`, so the float is a faithful copy rather than a rounding.
"""
from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional
from uuid import uuid4

from db import get_pool
from services import billing_lines
from services.credits import next_period
from services.platform_proration import money, period_bounds, prorate

log = logging.getLogger(__name__)

#: What the sweep writes into `subscription_invoices.doc_status` (migration
#: 256). NEVER 'final', and the column DEFAULTS to 'final' — so this constant
#: existing is the whole of the protection, and it is named rather than inlined
#: so a reader grepping for what the cron issues finds one answer.
#:
#: The downstream twin's comment is worth repeating here because the harm is
#: worse upstream: `ganit_invoices.doc_status` also defaults to 'final', the
#: client sweep omitted it, and `/cron/billing` minted two FINISHED tax invoices
#: against a real customer with serials drawn from that firm's live series
#: (PROGRESS.md, 2026-08-27). An upstream invoice is Aekam billing its own
#: paying customers; there is no register a person reviews it on unless it
#: arrives as something that visibly needs reviewing.
_DRAFT = "draft"

#: `subscription_invoices` has no `is_igst`, no `place_of_supply` and no
#: `gst_rate`; it carries one `gst` column. 18% flat is what
#: `routers/subscription.py::create_invoice` has always applied to it, and the
#: sweep must not invent a second GST rule for the same table — a document a
#: person raises and a document the cron raises have to be the same document.
_GST_RATE = Decimal("0.18")

#: The advisory-lock namespace `routers/subscription.py` serialises invoice
#: numbering on — 0x4B535542 is 'KSUB'.
#:
#: ⚠ SHARED DELIBERATELY, AND IT MUST STAY SHARED. `invoice_number` is UNIQUE on
#: this table and both writers allocate by MAX-plus-one over the same series. A
#: private lock here would serialise this sweep against itself and against
#: nothing else, so an operator pressing Create in the console while the cron
#: ticked would read the same MAX and one of the two would die on a 23505. The
#: value is duplicated rather than imported because importing
#: `routers.subscription` from a service pulls a router — and its auth
#: dependencies — into a cron path that needs none of it; the constant is four
#: bytes of ASCII and is pinned by `test_platform_billing_sweep.py`, which reads
#: the number out of `routers/subscription.py` and asserts the two agree.
_INVOICE_SEQ_LOCK_NS = 0x4B535542

#: How many months of backlog one org may be considered for in a single run.
#:
#: NOT a limit on invoices — the sweep raises at most ONE per org per run
#: whatever this is. It bounds the SEARCH: a line with `invoice_from` set years
#: back proposes every month from then until today as a candidate period, and
#: each candidate costs one `lines_due_in_period` round trip. Three years is far
#: more history than this product has (the oldest billing line is 2026-09-01)
#: and keeps the worst case at a few dozen reads.
_MAX_BACKLOG_MONTHS = 36


# ── the armed population ────────────────────────────────────────────────────

#: THE ORGANISATIONS AND LINES THIS SWEEP MAY BILL.
#:
#: `NOT o.is_platform_org` IS THE OWNER'S EXEMPTION AND IT IS FIRST. Migration
#: 252's trigger refuses a billing LINE for the platform org and 256's refuses
#: an INVOICE for it, so the database would stop this twice over — but the brief
#: is that the sweep must not even try, and a rule that is only ever met as a
#: caught exception is a rule nobody can read. `is_platform_org` is NOT NULL
#: DEFAULT false (checked live 2026-09-01), so this predicate is total and
#: cannot silently drop an org to a NULL.
#:
#: `is_active IS NOT FALSE`, matching `scheduler._for_each_org`: a deactivated
#: organisation is not invoiced. `IS NOT FALSE` rather than `= TRUE` so a NULL —
#: a row predating the column — is included rather than vanishing from billing.
#:
#: `auto_invoice = TRUE` is the arming switch. It is FALSE on all four live
#: lines (counted 2026-09-01), so this query returns nothing until somebody
#: turns one on deliberately, which is the intended state of this feature on the
#: day it deploys.
#:
#: `last_billed` is the correlated MAX over the join table — WHERE THIS LINE HAS
#: GOT TO. It is read here, in the same statement as the line, because it is the
#: input to decision 1 above and a second query per line would invite somebody
#: to compute it from the line's own dates instead. `$1::uuid` is cast because
#: PgBouncer turns an untyped parameter into an instant 500.
_ARMED_LINES = """
SELECT l.id, l.org_id, l.kind, l.description, l.amount, l.currency,
       l.cadence, l.period_start, l.period_end, l.invoice_from,
       l.billing_direction,
       o.name AS org_name,
       (SELECT MAX(b.period_start)
          FROM public.invoice_billing_lines b
         WHERE b.line_id = l.id) AS last_billed
  FROM public.org_billing_lines l
  JOIN public.organisations o ON o.id = l.org_id
 WHERE l.auto_invoice = TRUE
   AND NOT o.is_platform_org
   AND o.is_active IS NOT FALSE
   AND ($1::uuid IS NULL OR l.org_id = $1::uuid)
 ORDER BY o.name, l.created_at
"""


def _month(value: date) -> date:
    """The first of `value`'s month. The grain every period in this table has."""
    return date(value.year, value.month, 1)


def _first_period(line) -> date:
    """The earliest period this line may ever be invoiced for.

    `period_start` is when the arrangement BEGAN and is what the billing screen
    shows. `invoice_from` is how far back automation may reach, and it is a
    FLOOR rather than a start date — migration 252 keeps the two apart for the
    same reason 223 did downstream: an arrangement that ran for months before
    anybody armed a cron needs both facts, and rewriting `period_start` to start
    the clock would leave the true one recorded nowhere.

    Taken as a MONTH here. `invoice_from` may be any day (it is the one column
    in this stack with no month-start CHECK, which is what makes pro-rata
    reachable at all) but a PERIOD is always a month, so a floor of 15 September
    means September is the first billable period — billed for part of itself.
    `_charge_for` is where the part-month is worked out.
    """
    first = line["period_start"]
    if line["invoice_from"]:
        first = max(first, _month(line["invoice_from"]))
    return first


def _next_unbilled(line) -> Optional[date]:
    """The oldest period this line has not been invoiced for, or None.

    ⚠ THE ONE PLACE DECISION 1 LIVES. From the LAST INVOICED period, never from
    the line's origin. `last_billed` is `MAX(invoice_billing_lines.period_start)`
    — the join table that exists to prevent double billing is the same record
    that answers "how far along is this line?", so the two cannot come to
    disagree the way a `next_billing_date` column on the line would the first
    time an invoice was voided.

    `next_period` rather than `add_months(…, 1)`: it is the function
    `services/credits.py` advances a credit period with, and 096 ties a billing
    period to a credit period by construction ("Always the 1st of a month,
    matching hub_org_credits.period_start, so a billing period and a credit
    period are the same object and never drift"). They agree exactly on
    month-start dates; using the billing stack's own one keeps that guarantee
    where a reader can see it.

    Returns None for a one-off that has been billed. A one-off is due in its own
    period and no other — `_due_in_period` says so and `org_billing_lines_span_ck`
    forces `period_end = period_start` — so once it is billed it is finished, and
    proposing the following month would stall the org forever on a period the
    line can never be due in.
    """
    last = line["last_billed"]
    if last is None:
        return _first_period(line)
    if line["cadence"] == "one_off":
        return None
    return next_period(last)


def _last_billable(line, today: date) -> Optional[date]:
    """The most recent period this line may be invoiced for TODAY, or None.

    Two independent limits, and both are load-bearing:

    THE LINE'S OWN SPAN. `period_end` is the LAST PERIOD BILLED and NULL means
    the line is still open — it is not a missing value, and reading it as one is
    a mistake this codebase has made before. A line ended in September is billed
    for September and not after.

    THE DIRECTION. `billing_direction` is 'advance' or 'arrears' (migration
    217's CHECK, confirmed live). Advance charges BEFORE the service period, so
    the period may be invoiced from its first day. Arrears charges AFTER it, so
    the period may not be invoiced until it has finished — billing an arrears
    line on the 1st charges for a month that has not happened.

    ⚠ NOTHING IN THE BACKEND HAS EVER READ THIS COLUMN on `org_billing_lines`.
    `git grep billing_direction` over `backend/` finds `routers/client_billing.py`
    writing the DOWNSTREAM table's copy of it and two tests, and no reader
    anywhere. All four live lines are 'advance', so this sweep's behaviour today
    is the same either way — but it is the first code to honour the column, and
    an arrears line was previously a term the product recorded and ignored.

    Returns None when the line has no billable period yet at all.
    """
    if line["billing_direction"] == "arrears":
        # The latest period whose LAST DAY is already past. `period_bounds`
        # gives that day; walking back one month from today's period and taking
        # its end is the same answer without a loop.
        candidate = _month(today)
        if period_bounds(candidate, "monthly")[1] >= today:
            # This month has not finished, so the newest complete period is the
            # previous one. `timedelta(days=1)` off the 1st lands in it.
            candidate = _month(candidate - timedelta(days=1))
    else:
        candidate = _month(today)

    end = line["period_end"]
    if end is not None and end < candidate:
        candidate = end
    return candidate


def _charge_for(line, period_start: date, period_end: date) -> Decimal:
    """What this line is owed for this period, apportioned and signed.

    THE ONLY PRO-RATA CASE THIS SCHEMA CAN PRODUCE, and the module docstring
    explains why it is the only one: `invoice_from` is the single date in the
    stack without a month-start CHECK. When it lands strictly inside the period
    being billed, the org is present for part of it and pays for that part by
    actual days. Every other period is whole, and `prorate` returns the stated
    amount for those rather than `amount * days/days`, so a full month cannot
    drift by a rounding step.

    `active_from` is passed ONLY when the floor is genuinely inside the period.
    Passing it unconditionally would be harmless — `prorate` clamps a value
    before the period to the period's start — but it would read as though a
    part-month were the ordinary case, and the ordinary case is a whole one.

    ⚠ SIGNED, AND THE SIGN IS `billing_lines`' RULE. `amount` is a magnitude
    (`CHECK (amount >= 0)`, 096's deliberate choice) and `kind` says which way it
    points: a credit subtracts, everything else adds. That rule is
    `billing_lines._signed_amount` and `_SIGNED_AMOUNT_SQL`; this is the one
    place this module needs it, it uses that module's exported `CREDIT_KIND`
    rather than the literal, and `record_billed` VALIDATES the result against
    the line's kind and refuses a mismatch — so the arithmetic here is checked
    by the module that owns the rule rather than trusted.
    """
    floor = line["invoice_from"]
    active_from = floor if (floor and period_start < floor <= period_end) else None
    amount = prorate(line["amount"], period_start, period_end, active_from=active_from)
    return -amount if line["kind"] == billing_lines.CREDIT_KIND else amount


def _candidate_periods(line, today: date) -> list[date]:
    """Every period this line could be invoiced for on this run, oldest first.

    Normally ONE — the month it has just become due for. More only when a line
    is behind: armed late, or dormant while nobody had created the cron.

    ⚠ WHY A RANGE AND NOT JUST THE OLDEST. The oldest unbilled period is not
    always a period the line is DUE in, and treating it as the only candidate
    stalls the line permanently. `_covering_line` suppresses a line for the
    months an EARLIER line of the same kind already covers — a support plan
    stopped and restarted has two rows, and the predecessor carries the month
    they overlap in. The successor's oldest unbilled period is therefore a month
    it will never be billed for; nothing will ever record it; and if that were
    the only period offered, the successor would be re-proposed for the same
    dead month on every run from now on and never invoiced at all.

    Offering the range lets the run fall through to the first month the line is
    genuinely due in. Nothing here decides due-ness — `lines_due_in_period` does,
    in `sweep_platform_invoices` — this only decides what is worth ASKING about.

    Truncated to the OLDEST `_MAX_BACKLOG_MONTHS`, because catching up starts at
    the beginning; a truncated tail is reached on later runs.
    """
    start = _next_unbilled(line)
    end = _last_billable(line, today)
    if start is None or end is None or start > end:
        return []

    periods: list[date] = []
    period = start
    while period <= end and len(periods) < _MAX_BACKLOG_MONTHS:
        periods.append(period)
        period = next_period(period)
    return periods


async def _allocate_invoice_number(conn, today: date) -> str:
    """The next `KSUB-YYYYMM-NNNN`, under the lock the console also takes.

    A COPY OF `routers/subscription.py::create_invoice`'s allocator, on purpose
    and not by neglect. That endpoint holds an advisory lock until COMMIT and
    reads `MAX(...) + 1` over the same UNIQUE series; anything numbering
    differently, or locking elsewhere, collides with it on a 23505 the first
    time an operator raises an invoice while the cron ticks. The lock is taken
    on the caller's connection INSIDE the caller's transaction, which is what
    makes "until COMMIT" true.

    KEYED ON THE MONTH THE DOCUMENT IS RAISED, not the month it bills. That is
    the existing series' rule — `create_invoice` uses the wall clock — and a
    sweep catching up on April would otherwise reach back into April's numbering
    block and interleave new documents among issued ones. `today` rather than
    `datetime.now()` so a test can pin it; they are the same value in service.
    """
    month_str = f"{today:%Y%m}"
    await conn.execute(
        "SELECT pg_advisory_xact_lock($1::int, $2::int)",
        _INVOICE_SEQ_LOCK_NS, int(month_str),
    )
    seq = await conn.fetchval(
        "SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM "
        "'KSUB-\\d{6}-(\\d+)') AS INT)), 0) + 1 "
        "FROM public.subscription_invoices "
        "WHERE invoice_number LIKE 'KSUB-' || $1 || '-%'",
        month_str,
    )
    return f"KSUB-{month_str}-{seq:04d}"


async def _raise_invoice(conn, *, org_id, period_start, period_end, billable,
                         today) -> dict:
    """Write ONE draft invoice for one org and one period, and record its lines.

    Everything here is inside the caller's transaction: the invoice, the join
    rows and the audit event stand or fall together. `record_billed` REFUSES a
    line already billed or not due, and that refusal must take the invoice with
    it — an invoice whose lines were not recorded is a charge the system thinks
    it has not made, and the next run makes it again.
    """
    subtotal = money(sum((c["charge"] for c in billable), Decimal("0")))
    gst = money(subtotal * _GST_RATE)
    total = money(subtotal + gst)

    # `line_id` RIDES EACH ITEM, matching what `InvoiceBuilder.jsx` puts on the
    # rows it loads. `create_invoice` builds its `amounts` mapping out of that
    # one list precisely because `line_items` and `line_ids` arriving as two
    # parallel lists cannot be paired without guessing — and guessing here
    # mis-states what a client was charged. Same shape, so the two writers of
    # this column produce documents a single reader can handle.
    line_items = [
        {
            "line_id": str(c["line"]["id"]),
            "description": c["description"],
            "quantity": 1,
            "rate": float(c["charge"]),
            "amount": float(c["charge"]),
            "kind": c["line"]["kind"],
        }
        for c in billable
    ]

    invoice_number = await _allocate_invoice_number(conn, today)
    invoice_id = str(uuid4())

    await conn.execute(
        "INSERT INTO public.subscription_invoices "
        "(id, org_id, invoice_number, period_start, period_end, line_items, "
        " subtotal, gst, total, payment_status, due_date, generated_from, "
        " created_by, doc_status) "
        "VALUES ($1::uuid, $2::uuid, $3, $4::date, $5::date, $6::jsonb, "
        #  `payment_status` 'pending' is the column's own default and is stated
        #  anyway: it means UNPAID, which is true of a draft, and it is a
        #  different question from whether the document has been issued. 256
        #  gives that second question its own column rather than overloading
        #  this one, which `billing_lines` reasons about ('refunded') in two
        #  places.
        #
        #  ⚠ `due_date` IS NULL AND THAT IS THE WHOLE DUNNING GUARD.
        #  `GET /v1/admin/invoices/overdue` selects
        #  `payment_status='pending' AND due_date < CURRENT_DATE`; `NULL <
        #  CURRENT_DATE` is NULL, so a draft cannot appear on the chase list. It
        #  is also simply true: a draft has no due date because it has not been
        #  issued, and the payment clock starts when a person finalises it. The
        #  alternative — writing a real due date and filtering on doc_status —
        #  needs an edit to `routers/subscription.py`, which this change does
        #  not own; this is correct on its own terms and needs nobody else's
        #  file.
        "        $7, $8, $9, 'pending', NULL, 'lines', 'system', $10)",
        invoice_id, str(org_id), invoice_number, period_start, period_end,
        json.dumps(line_items), subtotal, gst, total, _DRAFT,
    )

    # THE OTHER HALF OF THE NO-DOUBLE-CHARGE RULE, written by the module that
    # owns it. `amounts` carries what THIS document charged rather than what the
    # line says today — the two differ the moment a period is pro-rated, which
    # is exactly the case this sweep introduces, and the join row exists to
    # prove what was billed.
    recorded = await billing_lines.record_billed(
        conn,
        invoice_id=invoice_id,
        org_id=str(org_id),
        line_ids=[str(c["line"]["id"]) for c in billable],
        period=period_start,
        amounts={str(c["line"]["id"]): c["charge"] for c in billable},
    )

    await conn.execute(
        "INSERT INTO public.subscription_events (org_id, event_type, metadata) "
        "VALUES ($1::uuid, $2, $3::jsonb)",
        str(org_id), "invoice_created",
        json.dumps({
            "invoice_number": invoice_number,
            "total": float(total),
            "created_by": "system",
            "generated_from": "lines",
            "doc_status": _DRAFT,
            "billed_period": f"{period_start:%Y-%m}",
            "line_ids": [str(r["line_id"]) for r in recorded],
            "source": "sweep_platform_invoices",
        }),
    )

    return {
        "invoice_id": invoice_id,
        "invoice_number": invoice_number,
        "org_id": str(org_id),
        "period": period_start.isoformat(),
        "subtotal": float(subtotal),
        "total": float(total),
        "doc_status": _DRAFT,
        "lines": len(billable),
    }


async def sweep_platform_invoices(
    today: date | None = None,
    org_id: str | None = None,
) -> dict:
    """Raise DRAFT `subscription_invoices` for armed `org_billing_lines`.

    Called from `/cron/platform-billing`. One invoice per organisation per run,
    for the oldest period that organisation has lines genuinely due in.

    `org_id` SCOPES THE RUN TO ONE ORGANISATION and the cron does not pass it —
    a nightly sweep is for everybody, which is the point of it. It exists
    because this function WRITES INVOICE DOCUMENTS with numbers drawn from
    Aekam's live `KSUB-` series, and staging shares its database with production
    (CLAUDE.md: "there is nowhere to be wrong"), so proving the sweep works has
    to be possible without raising a document against three other orgs.

    ⚠ ONE ORGANISATION'S FAILURE MUST NOT STOP THE OTHERS. Each org is committed
    on its own transaction and its own exception is caught, counted and named.
    The brief calls out the specific case — migration 256's trigger raising
    inside a batch — but the rule is general: an org with a malformed line, a
    numeric overflow, or a line `record_billed` refuses as not-due must not
    silently cost every org after it in the loop its invoice. The failures are
    RETURNED, not swallowed; `/cron/platform-billing` turns a non-empty
    `failed` into a 500, because this file's neighbour spent months answering
    200 over exactly this shape of error and nobody found out.
    """
    today = today or date.today()
    pool = await get_pool()

    lines = await pool.fetch(_ARMED_LINES, str(org_id) if org_id else None)

    by_org: dict[str, list] = {}
    for line in lines:
        by_org.setdefault(str(line["org_id"]), []).append(line)

    created: list[dict] = []
    skipped = 0
    failed: dict[str, str] = {}

    for oid, org_lines in by_org.items():
        org_name = org_lines[0]["org_name"]
        try:
            raised = await _sweep_one_org(pool, oid, org_name, org_lines, today)
            if raised is None:
                skipped += 1
            else:
                created.append(raised)
        except Exception as exc:                                     # noqa: BLE001
            # Logged with the traceback here and summarised for the caller. The
            # loop continues: the orgs after this one have invoices to raise and
            # this org's problem is not theirs.
            log.exception("Platform sweep failed for organisation %s (%s)",
                          org_name, oid)
            failed[oid] = f"{type(exc).__name__}: {exc}"

    return {
        "date": today.isoformat(),
        "organisations": len(by_org),
        "created": len(created),
        "skipped": skipped,
        "failed": failed,
        "invoices": created,
    }


async def _sweep_one_org(pool, oid: str, org_name: str, org_lines, today: date):
    """Raise at most one draft invoice for one organisation. None if nothing is due.

    THE PERIOD IS CHOSEN BY ASKING, NOT BY ASSUMING. Each armed line proposes
    the periods it could be billed for (`_candidate_periods`); the run then walks
    those oldest-first and takes the FIRST one that `lines_due_in_period` agrees
    has something billable in it. That query is `billing_lines`' own definition
    of due — span, cadence, `_covering_line` suppression, and not-yet-billed —
    so a line offered to `record_billed` here has already passed the exact
    predicate `record_billed` will re-check.

    STOPS AT THE FIRST PERIOD RAISED. That is decision 2: a line behind by a
    year catches up a period per daily tick rather than minting twelve documents
    unattended.
    """
    windows = {str(line["id"]): _candidate_periods(line, today)
               for line in org_lines}
    by_id = {str(line["id"]): line for line in org_lines}

    periods = sorted({p for ps in windows.values() for p in ps})
    if not periods:
        return None

    async with pool.acquire() as conn:
        for period in periods:
            wanted = {lid for lid, ps in windows.items() if period in ps}

            # `lines_due_in_period` returns EVERY line due for the org in this
            # period, armed or not. Intersected with `wanted`, never unioned: a
            # line with `auto_invoice = FALSE` is a term Aekam has agreed and
            # has NOT authorised a cron to bill, and sweeping it in because it
            # shares an organisation with an armed line would bill it by
            # accident. `auto_invoice` is per line, so the filter is too.
            due = await billing_lines.lines_due_in_period(conn, oid, period)
            billable_ids = [row["id"] for row in due["lines"]
                            if row["id"] in wanted]
            if not billable_ids:
                continue

            period_start, period_end = period_bounds(period, "monthly")
            billable = []
            for lid in billable_ids:
                line = by_id[lid]
                charge = _charge_for(line, period_start, period_end)
                billable.append({
                    "line": line,
                    "charge": charge,
                    "description": f"{line['description']} "
                                   f"({period_start} – {period_end})",
                })

            subtotal = money(sum((c["charge"] for c in billable), Decimal("0")))
            if subtotal <= 0:
                # ⚠ A CRON DOES NOT ISSUE A CREDIT NOTE, and it does not issue a
                # document for nothing. A `credit` line subtracts, so a period
                # whose lines net to zero or less is either a month that has
                # been fully credited or a standing credit with no charge left
                # to reduce. Both are real situations and neither is a thing to
                # put in front of a customer unattended: a negative invoice is a
                # promise to return money, and it needs a person who can say
                # what it reverses.
                #
                # ⚠ AND THIS DELIBERATELY STALLS THE ORGANISATION, said plainly
                # because it is the one place this sweep stops on purpose.
                # `return`, not `continue`: nothing is recorded for this period,
                # so every later run reaches it again and stops again, and the
                # months AFTER it are not billed either. Falling through to the
                # next period instead would invoice October while September's
                # credit sat unapplied against nothing — the customer would be
                # charged in full for a month they were owed money in, and the
                # credit would have to be reconciled by hand afterwards. A
                # visible halt is the lesser harm, it is logged on every tick,
                # and a person raising the period from the billing console
                # clears it — nothing here has been consumed.
                log.warning(
                    "Platform sweep: %s has nothing billable for %s — the "
                    "lines due net to %s. A credit or zero-value period is not "
                    "issued unattended; raise it from the billing console.",
                    org_name, f"{period:%Y-%m}", subtotal,
                )
                return None

            async with conn.transaction():
                raised = await _raise_invoice(
                    conn, org_id=oid, period_start=period_start,
                    period_end=period_end, billable=billable, today=today,
                )

            log.info(
                # "as a DRAFT" is in the sentence because a Railway log at 03:00
                # is the only place anybody sees this run, and a line reading
                # "Invoiced Unicode Group ₹14,160" for a document that has not
                # been issued reads as money already billed.
                "Platform-invoiced %s for %s – %s: %s, %d line(s), ₹%.2f — as a "
                "DRAFT with no due date, awaiting a person",
                org_name, period_start, period_end, raised["invoice_number"],
                raised["lines"], raised["total"],
            )
            return raised

    return None
