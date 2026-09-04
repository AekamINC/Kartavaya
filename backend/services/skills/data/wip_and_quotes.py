"""
wip_and_quotes — the three that migration 175 unblocked: catalogue #48, #52, #54.

Three questions a firm asks that this product could not answer until 175 landed,
and — this is the whole point of the module — still cannot answer *from data*,
because 175 added columns and nothing writes them yet.

    check_wip_ageing                    unbilled BILLABLE time, aged (#48)
    check_quotation_expiry              a three-beat chase before validity (#52)
    brief_free_entry_point_harvest      the free CTWA window Meta opens (#54)

── THE ONE FACT THAT SHAPES ALL THREE ───────────────────────────────────────

MIGRATION 175 BACKFILLED NOTHING. `time_entries.is_billable`,
`time_entries.rate_per_hour`, `varta_messages.entry_point` and
`varta_messages.referral` are NULL on every row that exists, and no write path
puts a value in any of them. `staging.crm_quotations` has held zero rows since
it was created because nothing in the product creates a quotation.

So the failure mode these three have to avoid is not a wrong number. It is a
REASSURING ZERO — "no WIP over 90 days", "no quotations expiring", "no free
windows open" — printed from an empty column and read as an all-clear on work
that was done, money that is owed and a customer waiting for a quote.

Every one of them therefore reports the DENOMINATOR before the finding, keeps
`could_not_check` separate from `findings`, names the column and the screen that
would have to write it, and is written so that the day a value arrives the same
code answers properly. That last property is tested.

── #48 IS STILL MISSING ITS THIRD BLOCKER, AND IT IS NOT A COLUMN ───────────

The folio named three blockers for WIP ageing: "a billable flag distinct from
invoiced, a rate reachable from an entry, and a client link on invoices". 175
closed the first two. THE THIRD IS NOT CLOSED AND IS NOT CLOSEABLE BY A COLUMN
ON `time_entries`:

  · `public.tasks` has NO project and NO client column. It carries `team_id`
    and `board_id` and nothing else that points at a customer.
  · `staging.projects` carries `contact_id` — a person — not `client_id`, and
    no task references a project at all.
  · The only client-bearing path off a time entry is `invoice_id ->
    ganit_invoices.client_id`, and WIP is UNBILLED time, which by definition
    has no invoice. `invoice_id` is NULL on all 289 rows anyway.

So this handler ages WIP by ENGAGEMENT — the board the task sits on, which is
the nearest thing to an engagement this schema holds — and by PERSON, and it
says on the output that the client grain does not exist. It does not guess a
client from a task title.

── "A WIP REPORT WITHOUT RUPEES IS NOT THE THING ANYONE ASKED FOR" ──────────

The folio's words, and the reason the rupee column is reported as UNAVAILABLE
with the count of entries lacking a rate rather than as a zero. There is a
second rate in this database — `staging.manav_employees.hourly_rate`, which
`routers/ganit.py` already joins to build an invoice from a timesheet — and it
is deliberately NOT used here for two reasons:

  1. It is a COST rate for an employee, not a BILLING rate for a client. Valuing
     WIP at cost and calling it WIP is a different number with the same name.
  2. It is unreachable anyway: `manav_employees.user_id` is NULL on all 98 rows,
     so that join matches nothing. See the BROKEN note at the foot of this file.

── Measured on the live database, read-only, 2026-08-20 ─────────────────────

  #48  Aekam Inc                  0 time entries at all — reported as
                                  "no time recorded", never as "no WIP".
       E2E Test & Associates      200 entries, 50 invoiced, 150 unbilled,
                                  317.5 unbilled hours. is_billable recorded on
                                  0 of 150; rate recorded on 0 of 150. Bands
                                  19 / 49 / 48 / 34 entries across
                                  0-30 / 31-60 / 61-90 / over-90 days; the
                                  oldest was worked on 2026-05-02, 110 days
                                  back, and 34 entries (80.2 h) are past the
                                  90-day threshold. WIP hours therefore report
                                  as a RANGE, 0.0 to 317.5, and the rupee value
                                  as UNAVAILABLE — never as 0.
       Unicode Group              81 entries, 39 invoiced, 42 unbilled,
                                  81.8 unbilled hours; is_billable recorded on
                                  0 of 42; nothing past 90 days (oldest 47).

  #52  All three orgs             0 quotations. `valid_until` EXISTS (the folio
                                  is stale on that), `crm_accounts` is also
                                  empty, and `crm_quotations` appears in NO
                                  backend Python file — nothing creates one.

  #54  E2E Test & Associates      500 messages, 250 inbound, 0 carrying a
                                  referral and 0 carrying an entry_point.
       Aekam Inc, Unicode Group   0 messages of any kind.
       varta_contacts             60 rows, 45 opted in, 0 opted out.

── STATUTE ──────────────────────────────────────────────────────────────────

None of these three prints a statutory fact, so none calls `services/statute.py`
and none may:

  · 90 days for WIP escalation is a PRACTICE-MANAGEMENT convention, not a
    statutory period. It is a defaulted parameter, and the output says so.
  · Quotation validity is a commercial term the firm writes on the quote. There
    is no statute here either. `ganit_invoices.due_date` is a PAYMENT term and
    is deliberately never read — chasing on it would chase on the wrong day.
  · Meta's free-window length is PLATFORM POLICY, not Indian law, so
    `statute_calendar` is the wrong home for it. It is a defaulted parameter
    carrying the date the figure was believed true, and the output says it must
    be re-checked against Meta's current policy.

── BROKEN, FOUND WHILE PROBING, NOT FIXED HERE ──────────────────────────────

`routers/ganit.py` (~line 3067) builds an invoice from unbilled time with
`JOIN staging.manav_employees e ON e.user_id::text = te.user_id`. Live,
`manav_employees.user_id` is NULL on ALL 98 rows across all three orgs, so that
INNER JOIN returns ZERO rows for every org — the bill-from-timesheet feature is
structurally empty and reports nothing rather than failing. Reported, not fixed.
"""
import json
import logging
from datetime import date, datetime, timedelta, timezone

from services.skills.timeutil import as_date, as_utc, days_between, hours_between, today_ist, utc_now

log = logging.getLogger(__name__)

#: Ageing bands every WIP report shows, whatever the escalation threshold is.
#: 30/60/90 is the shape a practice already reads a debtors ledger in, so the
#: WIP ledger uses the same one rather than inventing a second vocabulary.
WIP_BAND_EDGES: tuple[int, ...] = (30, 60, 90)

#: When unbilled time stops being work in progress and starts being a
#: conversation. A CONVENTION, not a statutory period — hence a parameter with
#: this as its default, and a line on the output saying which it is.
WIP_ESCALATE_AFTER_DAYS = 90

#: The three-beat quotation chase, in days remaining before `valid_until`.
#: Two weeks to remind, one week to press, two days to close or let go.
QUOTE_BEAT_FIRST_DAYS = 14
QUOTE_BEAT_SECOND_DAYS = 7
QUOTE_BEAT_FINAL_DAYS = 2

#: Quotation states that are still live and worth a chase. `draft` is excluded
#: deliberately and counted separately: a draft was never sent to the customer,
#: so chasing it is chasing yourself.
QUOTE_OPEN_STATES: tuple[str, ...] = ("sent", "viewed")
QUOTE_NOT_YET_SENT_STATES: tuple[str, ...] = ("draft",)
#: The exits. `accepted` is the conversion; the other two end the chase.
QUOTE_EXIT_STATES: tuple[str, ...] = ("accepted", "rejected", "expired")

#: Meta's free-delivery window opened by a Click-to-WhatsApp referral, in hours.
#: NOT A CONSTANT AND NOT LAW. It is platform policy, it has moved before, and
#: it is a defaulted parameter everywhere below so a change is a call-site edit
#: rather than a code change.
CTWA_FREE_WINDOW_HOURS = 72

#: The date the 72 above was believed true. Printed on every output next to the
#: figure, because a policy number with no date on it is a number nobody can
#: check.
CTWA_POLICY_AS_OF = "2026-08-20"

#: What the folio records about why this matters. Recorded as a claim WITH its
#: source, never as a fact this database verified.
CTWA_POLICY_NOTE = (
    "The catalogue folio records that from 1 October 2026 the Click-to-WhatsApp "
    "entry point is the only free window Meta leaves standing. Nothing in this "
    "database verifies that and nothing here can: it is Meta's pricing policy, "
    "not Indian law, so it is not in statute_calendar and must not be. Confirm "
    "both the date and the window length against Meta's current published "
    "policy before acting on any figure below."
)


def _f(value, default=0.0) -> float:
    """Decimal | None -> float. asyncpg returns Decimal for numeric, which is
    not JSON-serialisable, and every one of these outputs is serialised."""
    return default if value is None else float(value)


def _i(value, default=0) -> int:
    """None-safe int, for a SUM over an empty set."""
    return default if value is None else int(value)


def _hours(minutes) -> float:
    """Minutes -> hours, to one decimal. Hours is the unit a firm thinks in."""
    return round(_i(minutes) / 60.0, 1)


def _moment(value=None) -> datetime:
    """An aware UTC datetime from a string, a date, a datetime, or now.

    #54 needs HOURS, not days — a 72-hour window that reports in whole days
    erases most of the signal it exists to carry — so it needs a moment rather
    than a calendar date, and it needs one that is injectable for testing.

    A naive datetime is read as UTC rather than rejected. asyncpg hands back
    aware values, so a naive one here came from a caller or a fixture, and
    killing a whole skill run over it is worse than assuming the obvious.
    """
    if value is None:
        return utc_now()
    if isinstance(value, datetime):
        return as_utc(value)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    if isinstance(value, str):
        text = value.strip().replace("Z", "+00:00")
        try:
            return as_utc(datetime.fromisoformat(text))
        except ValueError:
            parsed = as_date(text)
            if parsed:
                return datetime(parsed.year, parsed.month, parsed.day, tzinfo=timezone.utc)
    return utc_now()


def _as_of_date(value=None) -> date:
    """The calendar date a report is 'as at'. Defaults to today, and must —
    a handler with a required date cannot be scheduled."""
    if value is None:
        return today_ist(utc_now())
    parsed = as_date(value)
    if parsed:
        return parsed
    if isinstance(value, str):
        try:
            # `as_date`, not `.date()` — the calendar date of an instant is its
            # IST date, and this branch was the last place in the handlers still
            # taking the UTC one. A caller passing an ISO timestamp would have
            # got a report dated a day earlier than the same caller passing the
            # date alone, for every instant between 00:00 and 05:30 IST.
            return as_date(datetime.fromisoformat(value.strip().replace("Z", "+00:00")))
        except ValueError:
            pass
    return today_ist(utc_now())


def _jsonb(value):
    """A jsonb column as a Python object, whatever the driver handed over.

    asyncpg returns jsonb as `str` unless a codec is registered, and whether one
    is registered depends on how the pool was built — which is not this
    handler's business to know. Anything unparseable comes back as None rather
    than raising, because one malformed referral blob must not take the run down.
    """
    if value is None or isinstance(value, (dict, list)):
        return value
    if isinstance(value, (str, bytes, bytearray)):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return None
    return None


def _coverage(recorded: int, total: int, what: str, column: str, writer: str) -> dict:
    """The denominator, stated the same way in all three handlers.

    "0 of 150" and "no findings" are different sentences and this is the object
    that keeps them apart. `status` is the machine-readable half:

      not_applicable  there was nothing to record the fact ON
      absent          there were rows and NOT ONE carries the fact
      partial         some do
      complete        all do
    """
    if total <= 0:
        status = "not_applicable"
    elif recorded == 0:
        status = "absent"
    elif recorded < total:
        status = "partial"
    else:
        status = "complete"
    return {
        "what": what,
        "column": column,
        "recorded_on": recorded,
        "of_rows": total,
        "status": status,
        "would_be_written_by": writer,
        "reading": (
            f"{recorded} of {total} {what}."
            if total
            else f"No rows to carry {what}."
        ),
    }


# ══════════════════════════════════════════════════════════════════════════
# 48 · check_wip_ageing
# ══════════════════════════════════════════════════════════════════════════

async def check_wip_ageing(
    pool,
    org_id: str,
    as_at: str | None = None,
    escalate_after_days: int = WIP_ESCALATE_AFTER_DAYS,
    limit: int = 200,
) -> dict:
    """Unbilled time, aged, split three ways on whether it can be charged.

    *as_at* is the report date and defaults to today. *escalate_after_days*
    defaults to 90 and is a PRACTICE CONVENTION, not a statutory period — the
    output labels it so, because a CA reading "past 90 days" next to a
    statutory-looking skill will assume a section exists behind it.

    ── BILLABLE IS NOT BILLED, AND THAT IS THE WHOLE SKILL ───────────────────

        is_billed     an invoice went out.        Already existed.
        is_billable   the client CAN be charged.  Added by migration 175.

    Unbilled BILLABLE time is WIP. Unbilled UNBILLABLE time is write-off. They
    are opposite facts about the firm's year and a report that adds them
    together is not a WIP report.

    `is_billable` is NULL on all 289 live rows, which means NOBODY HAS SAID.
    Assuming billable inflates WIP; assuming not-billable hides it. So this
    handler assumes NEITHER and reports WIP as a RANGE:

        wip_hours_at_least   only entries explicitly marked billable
        wip_hours_at_most    those plus every entry nobody has classified

    Live, both orgs with time recorded return 0.0 as the floor and the whole
    unbilled figure as the ceiling. That interval IS the finding: it says the
    firm does not know what its WIP is, which is true and useful, where a single
    number would have been false.

    ── NO CLIENT GRAIN EXISTS ────────────────────────────────────────────────

    The catalogue asks for ageing "by client and engagement". There is no client
    link from a task in this schema at all — see the module docstring — so the
    grain here is the BOARD and the PERSON, `client_grain_available` is False on
    the output, and no client is inferred from anything.

    ── WHAT IT NEVER DOES ────────────────────────────────────────────────────

    It never prints a rupee zero. With no rate on any entry the money block
    reports status UNAVAILABLE and the count of entries lacking a rate. The day
    rates arrive it reports a value and labels it a FLOOR while any entry is
    still unrated. Nothing is written; nobody is chased.
    """
    today = _as_of_date(as_at)
    threshold = max(1, int(escalate_after_days))
    cap = max(1, int(limit))

    # THE TENANT BOUNDARY IS THE ORG, REACHED THROUGH THE TEAM.
    # `public.time_entries` has NO org_id. The only honest path is
    # entry -> task -> team_id -> organisations, and the filter is on
    # `o.id = $1::uuid` — the org, never a team passed in by a caller, because a
    # caller who can name a team can name another practice's team.
    scope_sql = """
        FROM public.time_entries te
        JOIN public.tasks t          ON t.task_id = te.task_id
        JOIN public.organisations o ON o.team_id = t.team_id
        WHERE o.id = $1::uuid
    """

    totals = await pool.fetchrow(
        f"""
        SELECT
          count(*)                                                        AS entries,
          count(*) FILTER (WHERE te.minutes IS NULL)                      AS no_duration,
          count(*) FILTER (WHERE te.is_billed IS TRUE)                    AS billed,
          count(*) FILTER (WHERE te.is_billed IS NULL)                    AS billed_not_recorded,
          count(*) FILTER (WHERE te.is_billed IS NOT TRUE)                AS unbilled,
          COALESCE(sum(te.minutes) FILTER (WHERE te.is_billed IS NOT TRUE), 0)
                                                                          AS unbilled_minutes,
          count(*) FILTER (WHERE te.is_billed IS NOT TRUE
                             AND te.is_billable IS TRUE)                  AS unbilled_billable,
          COALESCE(sum(te.minutes) FILTER (WHERE te.is_billed IS NOT TRUE
                             AND te.is_billable IS TRUE), 0)              AS unbilled_billable_minutes,
          count(*) FILTER (WHERE te.is_billed IS NOT TRUE
                             AND te.is_billable IS FALSE)                 AS unbilled_write_off,
          COALESCE(sum(te.minutes) FILTER (WHERE te.is_billed IS NOT TRUE
                             AND te.is_billable IS FALSE), 0)             AS unbilled_write_off_minutes,
          count(*) FILTER (WHERE te.is_billed IS NOT TRUE
                             AND te.is_billable IS NULL)                  AS unbilled_unknown,
          COALESCE(sum(te.minutes) FILTER (WHERE te.is_billed IS NOT TRUE
                             AND te.is_billable IS NULL), 0)              AS unbilled_unknown_minutes,
          count(*) FILTER (WHERE te.is_billed IS NOT TRUE
                             AND te.rate_per_hour IS NOT NULL)            AS unbilled_with_rate,
          count(*) FILTER (WHERE te.is_billed IS NOT TRUE
                             AND te.rate_per_hour IS NULL)                AS unbilled_without_rate,
          COALESCE(sum(te.minutes::numeric * te.rate_per_hour / 60)
                     FILTER (WHERE te.is_billed IS NOT TRUE
                             AND te.is_billable IS TRUE
                             AND te.rate_per_hour IS NOT NULL), 0)        AS value_billable,
          COALESCE(sum(te.minutes::numeric * te.rate_per_hour / 60)
                     FILTER (WHERE te.is_billed IS NOT TRUE
                             AND te.is_billable IS NOT FALSE
                             AND te.rate_per_hour IS NOT NULL), 0)        AS value_billable_or_unknown
        {scope_sql}
        """,
        org_id,
    )
    totals = dict(totals) if totals else {}

    bands = await pool.fetchrow(
        f"""
        WITH scoped AS (
          SELECT te.minutes, te.is_billable,
                 ($2::date - te.started_at::date) AS age_days
          {scope_sql}
            AND te.is_billed IS NOT TRUE
        )
        SELECT
          count(*) FILTER (WHERE age_days < 0)                       AS n_future,
          count(*) FILTER (WHERE age_days >= 0 AND age_days <= 30)   AS n_0_30,
          COALESCE(sum(minutes) FILTER (WHERE age_days >= 0 AND age_days <= 30), 0)  AS m_0_30,
          count(*) FILTER (WHERE age_days > 30 AND age_days <= 60)   AS n_31_60,
          COALESCE(sum(minutes) FILTER (WHERE age_days > 30 AND age_days <= 60), 0)  AS m_31_60,
          count(*) FILTER (WHERE age_days > 60 AND age_days <= 90)   AS n_61_90,
          COALESCE(sum(minutes) FILTER (WHERE age_days > 60 AND age_days <= 90), 0)  AS m_61_90,
          count(*) FILTER (WHERE age_days > 90)                      AS n_over_90,
          COALESCE(sum(minutes) FILTER (WHERE age_days > 90), 0)     AS m_over_90,
          count(*) FILTER (WHERE age_days > $3::int)                 AS n_escalated,
          COALESCE(sum(minutes) FILTER (WHERE age_days > $3::int), 0) AS m_escalated,
          count(*) FILTER (WHERE age_days > $3::int AND is_billable IS TRUE)
                                                                     AS n_escalated_billable,
          count(*) FILTER (WHERE age_days > $3::int AND is_billable IS NULL)
                                                                     AS n_escalated_unknown
        FROM scoped
        """,
        org_id, today, threshold,
    )
    bands = dict(bands) if bands else {}

    # THE ENGAGEMENT GRAIN IS THE BOARD, and it is named that way on the output.
    # `b.team_id = t.team_id` is on the join for the same reason every
    # graha_clients join carries org_id: board ids are opaque text and an
    # id-only join can reach another team's board.
    by_engagement = await pool.fetch(
        """
        SELECT COALESCE(NULLIF(btrim(b.name), ''), '(no board recorded)') AS engagement,
               count(*)                                    AS entries,
               COALESCE(sum(te.minutes), 0)                AS minutes,
               count(*) FILTER (WHERE te.is_billable IS NULL)  AS billability_unknown,
               count(*) FILTER (WHERE te.rate_per_hour IS NULL) AS without_rate,
               max($2::date - te.started_at::date)         AS oldest_age_days
        FROM public.time_entries te
        JOIN public.tasks t          ON t.task_id = te.task_id
        JOIN public.organisations o ON o.team_id = t.team_id
        LEFT JOIN public.boards b    ON b.board_id = t.board_id AND b.team_id = t.team_id
        WHERE o.id = $1::uuid
          AND te.is_billed IS NOT TRUE
        GROUP BY 1
        ORDER BY 3 DESC, 1
        LIMIT $3::int
        """,
        org_id, today, cap,
    )

    by_person = await pool.fetch(
        f"""
        SELECT COALESCE(NULLIF(btrim(u.name), ''),
                        NULLIF(btrim(u.full_name), ''),
                        '(person not recorded)')           AS person,
               count(*)                                    AS entries,
               COALESCE(sum(te.minutes), 0)                AS minutes,
               count(*) FILTER (WHERE te.is_billable IS NULL) AS billability_unknown,
               max($2::date - te.started_at::date)         AS oldest_age_days
        FROM public.time_entries te
        JOIN public.tasks t          ON t.task_id = te.task_id
        JOIN public.organisations o ON o.team_id = t.team_id
        LEFT JOIN public.users u     ON u.user_id = te.user_id
        WHERE o.id = $1::uuid
          AND te.is_billed IS NOT TRUE
        GROUP BY 1
        ORDER BY 3 DESC, 1
        LIMIT $3::int
        """,
        org_id, today, cap,
    )

    escalated_rows = await pool.fetch(
        f"""
        SELECT te.entry_id, te.task_id, te.minutes, te.description,
               te.started_at, te.is_billable, te.rate_per_hour,
               ($2::date - te.started_at::date)            AS age_days,
               COALESCE(NULLIF(btrim(t.title), ''), '(task has no title)') AS task_title,
               t.status                                    AS task_status,
               COALESCE(NULLIF(btrim(b.name), ''), '(no board recorded)')  AS engagement,
               COALESCE(NULLIF(btrim(u.name), ''),
                        NULLIF(btrim(u.full_name), ''),
                        '(person not recorded)')           AS person
        FROM public.time_entries te
        JOIN public.tasks t          ON t.task_id = te.task_id
        JOIN public.organisations o ON o.team_id = t.team_id
        LEFT JOIN public.boards b    ON b.board_id = t.board_id AND b.team_id = t.team_id
        LEFT JOIN public.users u     ON u.user_id = te.user_id
        WHERE o.id = $1::uuid
          AND te.is_billed IS NOT TRUE
          AND ($2::date - te.started_at::date) > $3::int
        ORDER BY te.started_at
        LIMIT $4::int
        """,
        org_id, today, threshold, cap,
    )

    entries = _i(totals.get("entries"))
    unbilled = _i(totals.get("unbilled"))
    with_rate = _i(totals.get("unbilled_with_rate"))
    without_rate = _i(totals.get("unbilled_without_rate"))
    billable_known = _i(totals.get("unbilled_billable")) + _i(totals.get("unbilled_write_off"))

    billability = _coverage(
        billable_known, unbilled,
        "unbilled entries have a billable/not-billable decision recorded",
        "public.time_entries.is_billable",
        "the timer and manual-entry routes in backend/routers/time_entries.py "
        "(POST /start, /stop, /manual) and the time-entry UI behind them — "
        "none of which sets it today",
    )
    rate_cover = _coverage(
        with_rate, unbilled,
        "unbilled entries have a charge-out rate recorded",
        "public.time_entries.rate_per_hour",
        "the same time-entry routes, or a rate card the product does not have; "
        "manav_employees.hourly_rate is a COST rate and is not a substitute",
    )

    # THE MONEY, AND THE RULE THAT IT IS NEVER PRINTED AS A ZERO.
    if unbilled == 0:
        money_status = "NOT_APPLICABLE"
        value_low = value_high = None
    elif with_rate == 0:
        money_status = "UNAVAILABLE"
        value_low = value_high = None
    else:
        money_status = "FLOOR" if without_rate else "COMPLETE"
        value_low = round(_f(totals.get("value_billable")), 2)
        value_high = round(_f(totals.get("value_billable_or_unknown")), 2)

    wip_low = _hours(totals.get("unbilled_billable_minutes"))
    wip_high = _hours(
        _i(totals.get("unbilled_billable_minutes")) + _i(totals.get("unbilled_unknown_minutes"))
    )

    could_not_check: list[str] = []
    if entries == 0:
        could_not_check.append(
            "NO TIME IS RECORDED FOR THIS ORG AT ALL — 0 entries reach it through "
            "task -> team -> organisation. That is an empty timesheet, NOT an "
            "absence of work in progress, and it must not be read as one.")
    if billability["status"] in ("absent", "not_applicable") and unbilled:
        could_not_check.append(
            f"BILLABILITY WAS NEVER DECIDED: {billability['reading']} Nothing "
            "writes is_billable, so the split between WIP and write-off cannot "
            "be made and the WIP figure below is a RANGE, not a number.")
    if money_status == "UNAVAILABLE":
        could_not_check.append(
            f"THE RUPEE VALUE OF THIS WIP CANNOT BE COMPUTED: {rate_cover['reading']} "
            "The value is reported as unavailable rather than as zero.")

    limitations = [
        "MIGRATION 175 BACKFILLED NOTHING. is_billable and rate_per_hour are "
        "NULL on every row that existed before it and no write path sets "
        "either, so an empty column here means 'nobody has said', never 'no'.",
        "THERE IS NO CLIENT GRAIN. public.tasks carries no project and no "
        "client; public.projects carries a contact_id, not a client_id, and no "
        "task references a project. The only client-bearing path off a time "
        "entry runs through an invoice, which unbilled time does not have. This "
        "report is therefore aged by BOARD and by PERSON, and no client is "
        "inferred from a task title.",
        f"{threshold} days is a PRACTICE CONVENTION for when unbilled time stops "
        "being work in progress. It is not a statutory period, no section "
        "supports it, and it is a parameter you should set to your own policy.",
        "Age is measured from when the work was DONE (started_at), not from when "
        "it was entered. Time logged late is aged from the day it was worked, "
        "which is the honest reading and makes a backdated entry appear "
        "immediately in an old band.",
        "Only time recorded IN THIS PRODUCT is visible. Work billed from a "
        "spreadsheet, or done and never logged, is not WIP this can see.",
        "Nothing is written and nobody is chased. This is a read.",
    ]
    if _i(totals.get("billed_not_recorded")):
        limitations.append(
            f"{_i(totals.get('billed_not_recorded'))} entries have no is_billed "
            "value at all and are counted as unbilled, which OVERSTATES WIP by "
            "that many rows.")
    if _i(bands.get("n_future")):
        limitations.append(
            f"{_i(bands.get('n_future'))} unbilled entries are dated after "
            f"{today} and are excluded from every ageing band.")
    if len(escalated_rows) >= cap:
        limitations.append(
            f"The escalated list is capped at {cap} entries; "
            f"{_i(bands.get('n_escalated'))} are past {threshold} days in total.")

    return {
        "as_at": today,
        "escalate_after_days": threshold,
        "escalation_basis": "practice convention, not statute",
        "engagement_grain": "board",
        "client_grain_available": False,
        "counts": {
            "time_entries_in_scope": entries,
            "entries_with_no_duration": _i(totals.get("no_duration")),
            "invoiced_entries": _i(totals.get("billed")),
            "unbilled_entries": unbilled,
            "unbilled_marked_billable": _i(totals.get("unbilled_billable")),
            "unbilled_marked_not_billable": _i(totals.get("unbilled_write_off")),
            "unbilled_billability_not_recorded": _i(totals.get("unbilled_unknown")),
            "unbilled_without_a_rate": without_rate,
            "past_escalation_threshold": _i(bands.get("n_escalated")),
            "past_threshold_and_confirmed_billable": _i(bands.get("n_escalated_billable")),
            "past_threshold_and_unclassified": _i(bands.get("n_escalated_unknown")),
            "engagements_listed": len(by_engagement),
            "people_listed": len(by_person),
            "escalated_rows_listed": len(escalated_rows),
            "capped_at": cap,
            "was_capped": len(escalated_rows) >= cap,
        },
        "coverage": [billability, rate_cover],
        "hours": {
            "unbilled_total": _hours(totals.get("unbilled_minutes")),
            "confirmed_billable": _hours(totals.get("unbilled_billable_minutes")),
            "confirmed_write_off": _hours(totals.get("unbilled_write_off_minutes")),
            "billability_not_recorded": _hours(totals.get("unbilled_unknown_minutes")),
            "wip_at_least": wip_low,
            "wip_at_most": wip_high,
            "wip_is_a_range_because": (
                "there is no unbilled time to classify"
                if unbilled == 0 else
                "nobody has marked these entries billable or not; the floor "
                "counts only confirmed billable time and the ceiling adds every "
                "unclassified entry"
                if wip_low != wip_high else
                "every unbilled entry has a billability decision recorded"
            ),
        },
        "rupees": {
            "status": money_status,
            "at_least": value_low,
            "at_most": value_high,
            "currency": "INR",
            "entries_lacking_a_rate": without_rate,
            "of_unbilled_entries": unbilled,
            "note": (
                "No charge-out rate is recorded on any unbilled entry, so the "
                "value of this WIP is UNAVAILABLE. It is not zero."
                if money_status == "UNAVAILABLE" else
                "There is no unbilled time to value."
                if money_status == "NOT_APPLICABLE" else
                f"A FLOOR: {without_rate} of {unbilled} unbilled entries carry no "
                "rate and contribute nothing to this figure."
                if money_status == "FLOOR" else
                "Every unbilled entry carries a rate."
            ),
        },
        "ageing_bands": [
            {"band": "0-30 days", "entries": _i(bands.get("n_0_30")),
             "hours": _hours(bands.get("m_0_30"))},
            {"band": "31-60 days", "entries": _i(bands.get("n_31_60")),
             "hours": _hours(bands.get("m_31_60"))},
            {"band": "61-90 days", "entries": _i(bands.get("n_61_90")),
             "hours": _hours(bands.get("m_61_90"))},
            {"band": "over 90 days", "entries": _i(bands.get("n_over_90")),
             "hours": _hours(bands.get("m_over_90"))},
        ],
        "escalated": {
            "threshold_days": threshold,
            "entries": _i(bands.get("n_escalated")),
            "hours": _hours(bands.get("m_escalated")),
            "rows": [
                {
                    "entry_id": r["entry_id"],
                    "task_id": r["task_id"],
                    "task": r["task_title"],
                    "task_status": r["task_status"],
                    "engagement": r["engagement"],
                    "person": r["person"],
                    "worked_on": as_date(r["started_at"]),
                    "age_days": _i(r["age_days"]),
                    "hours": _hours(r["minutes"]),
                    "billable": r["is_billable"],
                    "billability": (
                        "not recorded" if r["is_billable"] is None
                        else "billable" if r["is_billable"] else "write-off"
                    ),
                    "rate_per_hour": (
                        None if r["rate_per_hour"] is None else _f(r["rate_per_hour"])
                    ),
                    "note": r["description"],
                }
                for r in escalated_rows
            ],
        },
        "by_engagement": [
            {
                "engagement": r["engagement"],
                "entries": _i(r["entries"]),
                "hours": _hours(r["minutes"]),
                "billability_not_recorded": _i(r["billability_unknown"]),
                "without_a_rate": _i(r["without_rate"]),
                "oldest_age_days": _i(r["oldest_age_days"]),
            }
            for r in by_engagement
        ],
        "by_person": [
            {
                "person": r["person"],
                "entries": _i(r["entries"]),
                "hours": _hours(r["minutes"]),
                "billability_not_recorded": _i(r["billability_unknown"]),
                "oldest_age_days": _i(r["oldest_age_days"]),
            }
            for r in by_person
        ],
        "could_not_check": could_not_check,
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 52 · check_quotation_expiry
# ══════════════════════════════════════════════════════════════════════════

async def check_quotation_expiry(
    pool,
    org_id: str,
    as_at: str | None = None,
    first_beat_days: int = QUOTE_BEAT_FIRST_DAYS,
    second_beat_days: int = QUOTE_BEAT_SECOND_DAYS,
    final_beat_days: int = QUOTE_BEAT_FINAL_DAYS,
    limit: int = 200,
) -> dict:
    """Open quotations approaching `valid_until`, with a drafted three-beat chase.

    ── THE FOLIO IS STALE AND THIS SAYS SO ───────────────────────────────────

    Catalogue #52 is titled "No validity date". THAT IS NO LONGER TRUE:
    `staging.crm_quotations.valid_until` EXISTS, is a DATE, and has existed since
    the table was created — migration 175 confirmed it and added nothing here.

    The real blocker is one the folio also names and which is much harder:
    THE TABLE HOLDS ZERO ROWS BECAUSE NOTHING IN THE PRODUCT CREATES A
    QUOTATION. `crm_quotations` appears in no backend Python file at all. There
    is no route, no service and no writer. So this handler is CORRECT and
    returns an HONEST EMPTY RESULT, and will keep returning one until somebody
    builds a quotation screen.

    ── due_date IS NEVER READ ────────────────────────────────────────────────

    `ganit_invoices.due_date` is a PAYMENT term — when money is owed — not quote
    validity. Chasing on it would chase on the wrong day, sometimes by weeks,
    and it is deliberately not touched by any query here. (`ganit_invoices` also
    holds no quotation rows: all 787 are tax invoices and credit notes, despite
    `quotation` being a valid invoice_type in the UI's label map.)

    ── DRAFTS ARE NOT CHASED ─────────────────────────────────────────────────

    A quotation in `draft` was never sent to the customer, so chasing it is
    chasing yourself. Drafts are counted separately as "never sent" — which is
    its own finding, and a more actionable one.

    ── IT DRAFTS. IT DOES NOT SEND. ──────────────────────────────────────────

    Each beat comes back as a drafted line for a human. Nothing is sent, no
    reminder row is written, and no state changes — recording a chase nobody
    sent is worse than sending none.
    """
    today = _as_of_date(as_at)
    cap = max(1, int(limit))
    # Sorted so a caller who puts them in the wrong order still gets three
    # descending beats rather than a ladder that never fires its later rungs.
    beats = sorted({max(0, int(first_beat_days)),
                    max(0, int(second_beat_days)),
                    max(0, int(final_beat_days))}, reverse=True)
    while len(beats) < 3:
        beats.append(beats[-1])
    beat_first, beat_second, beat_final = beats[0], beats[1], beats[2]

    totals = await pool.fetchrow(
        """
        SELECT count(*)                                                   AS quotations,
               count(*) FILTER (WHERE q.status = ANY($2::text[]))         AS open_and_sent,
               count(*) FILTER (WHERE q.status = ANY($3::text[]))         AS never_sent,
               count(*) FILTER (WHERE q.status = ANY($4::text[]))         AS closed,
               count(*) FILTER (WHERE q.valid_until IS NULL)              AS without_validity,
               count(*) FILTER (WHERE q.status = ANY($2::text[])
                                  AND q.valid_until IS NULL)              AS open_without_validity
        FROM public.crm_quotations q
        WHERE q.org_id = $1::uuid
        """,
        org_id, list(QUOTE_OPEN_STATES), list(QUOTE_NOT_YET_SENT_STATES),
        list(QUOTE_EXIT_STATES),
    )
    totals = dict(totals) if totals else {}

    # THE ACCOUNT JOIN CARRIES org_id. `crm_quotations.account_id` has an FK to
    # `crm_accounts(id)` ALONE — exactly the shape that printed another
    # practice's client name once already — so the org is on the join, not
    # trusted from the FK.
    # `crm_quotations` carries no currency column, so INR is stated in Python
    # rather than invented in SQL — the amount is a plain numeric and every
    # figure in this product is rupees.
    rows = await pool.fetch(
        """
        SELECT q.id, q.quotation_number, q.status, q.valid_until, q.total,
               q.created_at, q.updated_at,
               COALESCE(NULLIF(btrim(a.name), ''), '(customer not recorded)') AS customer,
               NULLIF(btrim(d.title), '')                                     AS deal
        FROM public.crm_quotations q
        LEFT JOIN public.crm_accounts a ON a.id = q.account_id AND a.org_id = q.org_id
        LEFT JOIN public.crm_deals    d ON d.id = q.deal_id    AND d.org_id = q.org_id
        WHERE q.org_id = $1::uuid
          AND q.status = ANY($2::text[])
        ORDER BY q.valid_until NULLS LAST, q.quotation_number
        LIMIT $3::int
        """,
        org_id, list(QUOTE_OPEN_STATES), cap,
    )

    due_now: list[dict] = []
    not_yet: list[dict] = []
    lapsed: list[dict] = []
    no_validity: list[dict] = []

    for r in rows:
        valid_until = as_date(r["valid_until"])
        base = {
            "quotation_id": str(r["id"]),
            "quotation_number": r["quotation_number"],
            "customer": r["customer"],
            "deal": r["deal"],
            "status": r["status"],
            "amount": _f(r["total"]),
            "currency": "INR",
            "valid_until": valid_until,
        }
        if valid_until is None:
            no_validity.append({
                **base,
                "why": "no valid_until is recorded, so no chase day can be computed",
            })
            continue

        days_left = days_between(valid_until, today)
        base["days_until_expiry"] = days_left

        if days_left < 0:
            lapsed.append({
                **base,
                "days_since_expiry": -days_left,
                "why": "validity has already passed; the chase window is gone",
                "suggested_action": "re-quote or close it — do not chase a lapsed price",
            })
        elif days_left <= beat_final:
            due_now.append({**base, "beat": 3, "beat_name": "final",
                            "draft": _quote_draft(base, 3, days_left)})
        elif days_left <= beat_second:
            due_now.append({**base, "beat": 2, "beat_name": "press",
                            "draft": _quote_draft(base, 2, days_left)})
        elif days_left <= beat_first:
            due_now.append({**base, "beat": 1, "beat_name": "remind",
                            "draft": _quote_draft(base, 1, days_left)})
        else:
            not_yet.append({**base,
                            "first_beat_on": valid_until - timedelta(days=beat_first)})

    quotations = _i(totals.get("quotations"))
    open_sent = _i(totals.get("open_and_sent"))

    validity_cover = _coverage(
        open_sent - _i(totals.get("open_without_validity")), open_sent,
        "open quotations carry a validity date",
        "public.crm_quotations.valid_until",
        "a quotation screen — the column exists and is ready; nothing fills it "
        "because nothing creates a quotation",
    )

    could_not_check: list[str] = []
    if quotations == 0:
        could_not_check.append(
            "THIS ORG HAS NO QUOTATIONS AT ALL — public.crm_quotations holds 0 "
            "rows. That is NOT 'nothing is expiring'. Nothing in this product "
            "creates a quotation: the table is referenced by no backend route "
            "and no service, so this skill returns an empty result by "
            "construction and will do so until a quotation-creation path is "
            "built.")
    elif open_sent == 0:
        could_not_check.append(
            f"{quotations} quotations exist but none is in a state that can be "
            f"chased ({', '.join(QUOTE_OPEN_STATES)}). Nothing was assessed.")
    if no_validity:
        could_not_check.append(
            f"{len(no_validity)} open quotations carry no valid_until, so no "
            "chase day exists for them. They are listed, not silently dropped.")

    limitations = [
        "NOTHING IN THE PRODUCT CREATES A QUOTATION. public.crm_quotations "
        "appears in no backend Python file; there is no route and no writer. "
        "Until a quotation screen exists this skill is correct and empty, and "
        "an empty result here means 'no quotations recorded', never 'no "
        "quotations outstanding'.",
        "THE CATALOGUE ENTRY FOR THIS SKILL IS STALE: it says there is no "
        "validity date. public.crm_quotations.valid_until EXISTS and is used "
        "here. The blocker is the empty table, not the missing column.",
        "ganit_invoices.due_date is a PAYMENT term, not quote validity, and is "
        "deliberately never read — chasing on it would chase on the wrong day.",
        "Validity is a commercial term the firm writes on the quote. No statute "
        "sets it and none of these beat days comes from statute_calendar; they "
        "are parameters you should set to your own practice.",
        "IT DRAFTS, IT DOES NOT SEND. No message goes out, no reminder row is "
        "written and no quotation status changes. Delivery is a separate armed "
        "decision.",
        "Conversion and cancellation are read from `status` only. A quote "
        "accepted verbally and never marked accepted will still be chased.",
        "public.crm_accounts is also empty, so even once quotations exist the "
        "customer name will be blank until accounts are recorded.",
    ]
    if len(rows) >= cap:
        limitations.append(
            f"The quotation list is capped at {cap}; {open_sent} are open in total.")

    return {
        "as_at": today,
        "beats": {
            "first_reminder_days_before_expiry": beat_first,
            "second_press_days_before_expiry": beat_second,
            "final_days_before_expiry": beat_final,
            "basis": "practice convention, not statute",
        },
        "exits": {
            "on_conversion": "accepted",
            "on_cancellation": ["rejected", "expired"],
            "not_chased": list(QUOTE_NOT_YET_SENT_STATES),
        },
        "counts": {
            "quotations_recorded": quotations,
            "open_and_sent_to_customer": open_sent,
            "drafts_never_sent": _i(totals.get("never_sent")),
            "already_closed": _i(totals.get("closed")),
            "open_without_a_validity_date": _i(totals.get("open_without_validity")),
            "chase_due_now": len(due_now),
            "chase_not_yet_due": len(not_yet),
            "already_lapsed": len(lapsed),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "coverage": [validity_cover],
        "chase_due_now": due_now,
        "chase_not_yet_due": not_yet,
        "already_lapsed": lapsed,
        "open_without_validity": no_validity,
        "drafts_never_sent_note": (
            f"{_i(totals.get('never_sent'))} quotations sit in draft and were "
            "never sent to the customer. They are not chased — a draft is a "
            "conversation with yourself — but an old draft is worth a look."
        ),
        "nothing_was_sent": True,
        "could_not_check": could_not_check,
        "limitations": limitations,
    }


def _quote_draft(base: dict, beat: int, days_left: int) -> str:
    """One drafted chase line for a human to send, edit or bin.

    Deliberately plain and deliberately short: it names the quotation, the
    customer and the date, and it asks a question. Nothing here is generated by
    a model and nothing here is sent.
    """
    when = "today" if days_left == 0 else f"in {days_left} day{'s' if days_left != 1 else ''}"
    number = base.get("quotation_number") or "your quotation"
    customer = base.get("customer") or "there"
    if beat == 1:
        return (f"Hello {customer} — a reminder that quotation {number} is valid "
                f"until {base.get('valid_until')} ({when}). Shall we proceed, or "
                f"would you like anything changed?")
    if beat == 2:
        return (f"Hello {customer} — quotation {number} lapses {when}, on "
                f"{base.get('valid_until')}. If the scope or the price needs "
                f"revisiting, tell us and we will reissue it.")
    return (f"Hello {customer} — quotation {number} expires {when}. After "
            f"{base.get('valid_until')} we would need to re-quote at current "
            f"rates. Would you like us to hold it?")


# ══════════════════════════════════════════════════════════════════════════
# 54 · brief_free_entry_point_harvest
# ══════════════════════════════════════════════════════════════════════════

async def brief_free_entry_point_harvest(
    pool,
    org_id: str,
    as_at: str | None = None,
    free_window_hours: int = CTWA_FREE_WINDOW_HOURS,
    lookback_days: int = 30,
    limit: int = 200,
) -> dict:
    """Click-to-WhatsApp arrivals, and the free delivery window each one opens.

    A person who taps an ad lands in the inbox with a `referral` block attached.
    Meta opens a free window from that moment — no conversation charge, no
    template fee — and it is the one WhatsApp cost play with a future.

    ── THE 72 HOURS IS NOT HARDCODED, ON PURPOSE ─────────────────────────────

    `free_window_hours` is a PARAMETER with a default, and the default carries
    the date it was believed true (`CTWA_POLICY_AS_OF`) on every output. It is
    Meta's pricing policy, not Indian law, so it is deliberately NOT in
    `statute_calendar` — that table holds dated statute and putting a platform's
    commercial terms in it would corrupt what a citation from it means. The
    output says in as many words that the figure must be checked against Meta's
    current policy before anyone relies on it.

    ── NOTHING CARRIES A REFERRAL YET ────────────────────────────────────────

    `varta_messages.referral` and `.entry_point` arrived with migration 175 and
    are NULL on all 500 live rows, because `routers/whatsapp.py` — the inbound
    webhook, around line 778 — inserts `(org_id, conversation_id, direction,
    wa_message_id, content, type, status)` and drops the `referral` object Meta
    sends alongside. That is the one change that turns this skill on, and it is
    named on the output.

    So the count of open windows is 0 of 250 inbound messages, and this says so
    with the denominator rather than reporting "no free windows" and looking
    like an answer.

    ── AN OPEN WINDOW IS NOT PERMISSION ──────────────────────────────────────

    A free window says Meta will not charge. It does not say the person consented
    to marketing. Any contact with `opted_out_at` set is flagged as
    DO-NOT-CONTACT on its row however wide its window is, and the brief never
    treats a free window as a licence to send.
    """
    now = _moment(as_at)
    today = now.date()
    window_hours = max(1, int(free_window_hours))
    lookback = max(1, int(lookback_days))
    cap = max(1, int(limit))
    since = now - timedelta(days=lookback)

    totals = await pool.fetchrow(
        """
        SELECT count(*)                                                    AS messages,
               count(*) FILTER (WHERE m.direction = 'inbound')             AS inbound,
               count(*) FILTER (WHERE m.direction = 'inbound'
                                  AND m.created_at >= $2::timestamptz)     AS inbound_in_window,
               count(*) FILTER (WHERE m.referral IS NOT NULL)              AS with_referral,
               count(*) FILTER (WHERE m.entry_point IS NOT NULL)           AS with_entry_point,
               count(*) FILTER (WHERE m.direction = 'inbound'
                                  AND (m.referral IS NOT NULL
                                       OR m.entry_point IS NOT NULL))      AS inbound_ctwa
        FROM public.varta_messages m
        WHERE m.org_id = $1::uuid
        """,
        org_id, since,
    )
    totals = dict(totals) if totals else {}

    # THE CONVERSATION AND CONTACT JOINS BOTH CARRY org_id. varta_conversations
    # and varta_contacts are FK'd on the id alone, the same shape that printed
    # another practice's client name once; the org goes on the join.
    rows = await pool.fetch(
        """
        SELECT m.id, m.created_at, m.entry_point, m.referral, m.content, m.type,
               COALESCE(NULLIF(btrim(ct.name), ''), '(contact not recorded)') AS contact,
               ct.phone_number, ct.opted_in, ct.opted_out_at, ct.consent_source
        FROM public.varta_messages m
        JOIN public.varta_conversations cv
             ON cv.id = m.conversation_id AND cv.org_id = m.org_id
        LEFT JOIN public.varta_contacts ct
             ON ct.id = cv.varta_contact_id AND ct.org_id = cv.org_id
        WHERE m.org_id = $1::uuid
          AND m.direction = 'inbound'
          AND (m.referral IS NOT NULL OR m.entry_point IS NOT NULL)
          AND m.created_at >= $2::timestamptz
        ORDER BY m.created_at DESC
        LIMIT $3::int
        """,
        org_id, since, cap,
    )

    open_windows: list[dict] = []
    closed_windows: list[dict] = []

    for r in rows:
        arrived = r["created_at"]
        closes_at = as_utc(arrived) + timedelta(hours=window_hours) if arrived else None
        hours_left = round(hours_between(closes_at, now), 1) if closes_at else 0.0
        referral = _jsonb(r["referral"]) or {}
        opted_out = r["opted_out_at"] is not None

        entry = {
            "message_id": str(r["id"]),
            "contact": r["contact"],
            "phone_number": r["phone_number"],
            "arrived_at": arrived,
            "entry_point": r["entry_point"],
            "free_until": closes_at,
            "hours_left": hours_left,
            "first_message": r["content"],
            "ad_headline": referral.get("headline") if isinstance(referral, dict) else None,
            "ad_source_type": referral.get("source_type") if isinstance(referral, dict) else None,
            "ad_source_url": referral.get("source_url") if isinstance(referral, dict) else None,
            "opted_in": r["opted_in"],
            "consent_source": r["consent_source"],
            "do_not_contact": opted_out,
            "consent_note": (
                "OPTED OUT — do not send, however wide the window is."
                if opted_out else
                "A free window is not consent. It means Meta will not charge, "
                "not that this person agreed to marketing."
            ),
        }
        (open_windows if hours_left > 0 else closed_windows).append(entry)

    inbound = _i(totals.get("inbound"))
    ctwa = _i(totals.get("inbound_ctwa"))

    referral_cover = _coverage(
        _i(totals.get("with_referral")), inbound,
        "inbound messages carry a Click-to-WhatsApp referral block",
        "public.varta_messages.referral",
        "the inbound webhook in backend/routers/whatsapp.py (~line 778), which "
        "today inserts org_id, conversation_id, direction, wa_message_id, "
        "content, type and status and DROPS the referral object Meta sends",
    )
    entry_point_cover = _coverage(
        _i(totals.get("with_entry_point")), inbound,
        "inbound messages carry an entry_point",
        "public.varta_messages.entry_point",
        "the same inbound webhook",
    )

    could_not_check: list[str] = []
    if inbound == 0:
        could_not_check.append(
            "THIS ORG HAS NO INBOUND WHATSAPP MESSAGES AT ALL, so there is "
            "nothing a referral could have been attached to. That is an unused "
            "channel, not an absence of Click-to-WhatsApp traffic.")
    elif ctwa == 0:
        could_not_check.append(
            f"NO INBOUND MESSAGE CARRIES A REFERRAL: {referral_cover['reading']} "
            "The webhook does not persist the referral block Meta sends, so a "
            "Click-to-WhatsApp arrival is INDISTINGUISHABLE from an ordinary "
            "one in this database. Zero free windows here means the product "
            "cannot see them — NOT that none were opened.")

    limitations = [
        f"{window_hours} HOURS IS META'S POLICY, NOT LAW, AND IT MOVES. The "
        f"default was believed true on {CTWA_POLICY_AS_OF} and nothing in this "
        "database verifies it. It is a parameter; check it against Meta's "
        "current published policy before relying on any window below.",
        CTWA_POLICY_NOTE,
        "MIGRATION 175 ADDED referral AND entry_point AND BACKFILLED NEITHER. "
        "No write path fills them: backend/routers/whatsapp.py inserts an "
        "inbound message without the referral object. Until that one INSERT "
        "changes, this skill is structurally empty.",
        "A FREE WINDOW IS NOT CONSENT. It means Meta will not charge for the "
        "conversation. Marketing to someone who tapped an ad still needs the "
        "opt-in the consent ledger records, and an opted-out contact is marked "
        "do-not-contact here whatever its window says.",
        "The window is measured from the message this product RECORDED, which "
        "is when the webhook was processed, not when Meta timestamped it. Under "
        "a delivery delay the real window is shorter than shown.",
        "Meta bills the organisation directly. No rupee figure is computed here "
        "and none should be inferred: this reports which windows are open, not "
        "what was saved.",
        "Nothing is sent. This is a read that hands a human a list.",
    ]
    if len(rows) >= cap:
        limitations.append(
            f"The list is capped at {cap} arrivals; {ctwa} carry a referral in total.")

    return {
        "as_at": today,
        "as_at_utc": now,
        "free_window_hours": window_hours,
        "free_window_policy_as_of": CTWA_POLICY_AS_OF,
        "free_window_source": "Meta platform policy — not statute, not verified here",
        "must_recheck_against_meta_policy": True,
        "lookback_days": lookback,
        "counts": {
            "messages_recorded": _i(totals.get("messages")),
            "inbound_messages": inbound,
            "inbound_in_lookback": _i(totals.get("inbound_in_window")),
            "inbound_with_a_referral": _i(totals.get("with_referral")),
            "inbound_with_an_entry_point": _i(totals.get("with_entry_point")),
            "click_to_whatsapp_arrivals": ctwa,
            "windows_open_now": len(open_windows),
            "windows_already_closed": len(closed_windows),
            "opted_out_among_listed": sum(
                1 for e in open_windows + closed_windows if e["do_not_contact"]),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "coverage": [referral_cover, entry_point_cover],
        "windows_open": open_windows,
        "windows_closed": closed_windows,
        "policy_note": CTWA_POLICY_NOTE,
        "nothing_was_sent": True,
        "could_not_check": could_not_check,
        "limitations": limitations,
    }
