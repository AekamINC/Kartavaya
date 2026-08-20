"""
firm_flow — catalogue #29, #30 and #32. Three things that fall through the
firm's own floor: its own filing dates, its own approvals, and the lead that
just landed.

    brief_firm_filing_calendar   #29  the FIRM'S own monthly obligations, dated
    check_approvals_that_sit     #30  pending approvals, on a ladder
    pack_lead_first_touch        #32  a marketplace lead and a ready wa.me link

Nothing here writes. Nothing here sends. Two of the three DRAFT something a
person then chooses to act on, and that separation is the point: a chase
recorded but never sent is worse than no chase at all.

═══════════════════════════════════════════════════════════════════════════
 #29 · brief_firm_filing_calendar — THE FIRM'S OWN, AND ONLY THE FIRM'S OWN
═══════════════════════════════════════════════════════════════════════════

A CA firm is itself a taxpayer and an employer. It files its own GSTR-1 and
GSTR-3B, deposits its own TDS, and remits its own PF and ESI — and it does all
of that in the same week it is doing sixty clients' work, which is exactly why
it is the filing everybody misses.

ORG GRAIN ONLY. Per-client generation is catalogue #45/#46 and is BLOCKED, for
a reason that is structural rather than a matter of effort: there is no
per-client registration record in this product — nothing says who is monthly,
who is QRMP, who has TDS, who is under audit — so a per-client calendar would
have to invent each client's obligations. This handler therefore reads
`staging.organisations` for one org and stops there. It is not a half of #46.

── EVERY DATE, FORM AND SECTION COMES FROM services/statute.py ─────────────

Not one form number or due day below is a literal. `obligations(pool, as_of=…)`
resolves the version of each rule in force on the date the OBLIGATION AROSE —
which for a monthly return is the last day of the period it covers, never the
day you are running this. That anchoring is not decoration: Form 24Q became 138
and Form 16 became 130 on 1 April 2026, so a calendar anchored on "today" would
print the wrong form on a return covering March.

The only literals here are OBLIGATION KEYS — `gst.return.gstr1` and the like.
A key is a lookup handle, not a statutory fact, and naming the ones a monthly
calendar must contain is the only way to detect that a row is MISSING and say
so instead of quietly shipping a short list.

── THE SHIFT MOVES THE WORK EARLIER. IT NEVER MOVES THE DEADLINE LATER. ────

This is the single decision in this handler that could do damage, so it is made
explicitly and printed on every row.

A statutory due date does not move because it fell on a Sunday. The GST portal
does not care, and a firm that filed on Monday because a calendar told them to
has filed late. So the deadline is reported UNCHANGED as `statutory_due_on`,
and what moves is `work_by` — the last working day ON OR BEFORE it. The shift
is always BACKWARD, never forward, and `shifted_by_days` and `shift_reason` say
why on each row.

`is_optional` on `staging.manav_holidays` matters and is honoured the way the
column means it: an OPTIONAL holiday is a working day. It does not shift
anything. It is reported alongside the date instead, because a partner deciding
whether Friday is safe wants to know half the team may be on Gudi Padwa leave.

── #30 AND #32 ARE BELOW, AT THEIR OWN HANDLERS ───────────────────────────

Each of the three carries its own long note where it is defined, because the
things that make each one wrong are different and a reader arriving at one of
them should not have to read the other two first.

── MEASURED ON THE LIVE DATABASE, READ-ONLY, 2026-08-20 ────────────────────

Run against all three live orgs. Every output survives `json.dumps(default=str)`.

  #29, August 2026, org state codes 24 / 27 / none:
    · 4 dated monthly obligations resolve in force — GSTR-1 (11th), EPF ECR and
      ESI (15th), GSTR-3B (20th) — all covering period 2026-07.
    · A FIFTH IS MISSING AND IS REPORTED AS MISSING. `tds.deposit.monthly`
      carries `effective_to = 2026-04-01` and NO successor row, so as of a
      July-2026 period end the statute calendar records no monthly TDS deposit
      obligation at all. The 7th-of-the-month deposit is the most commonly
      missed date in an Indian practice; this prints the gap rather than the
      date it remembers. Same for all four `incometax.advance_tax.*` keys.
    · E2E Test & Associates: 25 holiday rows, 4 optional. 15 August 2026 is a
      Saturday, so the EPF/ESI work date shifts back to Friday 14 August; the
      Independence Day row sits on the Saturday and changes nothing further.
      GSTR-3B on the 20th is a Thursday and does not move.
    · Unicode Group: 13 holiday rows, 6 optional. Same August shift.
    · Aekam Inc: ZERO holiday rows. The shift is then weekends only, which is
      NOT the same as "this firm has no holidays" and is said so on the output.
  #30, pending approvals:
    · E2E Test & Associates 9 pending of 25 all-time, Unicode Group 7 of 28,
      Aekam Inc 0 of 5.
    · Every one of the 16 is 15 to 20 days old — so all sixteen have aged past
      the seven-day escalation threshold, AND ALL SIXTEEN COME BACK ON RUNG
      ONE. That is not a bug and it is the finding: the ladder never skips a
      rung, no approval chase can be recorded (see the structural note at the
      handler), so rung one is where every approval stays for ever. Each row
      also carries `rung_the_age_alone_would_reach` so the reader can see the
      13 that have aged past escalation without the output pretending an
      escalation is due.
    · 3 of Unicode Group's 7 sit on a team deleted on 2026-06-05 ("Keval To
      Do"). They are returned in their own section, not on the ladder: nobody
      can act on them, so pinging an approver about them is noise. Both the
      Approvals screen and `my_desk` filter deleted teams out, so those three
      are invisible everywhere else in the product.
    · Rung three resolves to 6 named org admins in Unicode Group and 4 each in
      E2E and Aekam Inc — a ROLE, never a manager, and it says so on every row.
  #32, marketplace leads:
    · ZERO. No contact in any of the three orgs carries an `indiamart` or
      `justdial` source, and `custom_data->>'source'` is NULL on all 292 contact
      rows in the database. The marketplace feed in `services/lead_ingest.py`
      has never produced a row here. That is reported as an empty feed, not as
      "no new leads".
    · Untouched non-marketplace leads in the last 14 days, which the same
      wa.me mechanism serves: E2E 34, Unicode Group 6, Aekam Inc 1.
    · `staging.varta_contacts` holds consent for ONE org only — 45 opted in, 15
      opted out, all 60 in E2E Test & Associates, none in the other two. Not
      one of the untouched leads matched a consent row, so all five came back
      'consent not recorded' with a link and the caveat.
    · The links built are real: a Unicode Group lead resolves to
      `https://wa.me/447405382925?text=Hello%20S%20K%20Joshi%2C%20this%20is%20Unicode%20Group.…`
      — a `+44` number accepted because the contact recorded it in full, which
      is the case the country-code rule exists for.
"""
import logging
import re
from datetime import date, timedelta
from urllib.parse import quote

from services.statute import obligations, obligation
from services.skills.timeutil import as_date, days_between, utc_now

log = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════
# shared
# ══════════════════════════════════════════════════════════════════════════

def _f(value, default=0.0) -> float:
    """Decimal | None -> float. asyncpg returns Decimal for numeric, which is
    not JSON-serialisable, and every dict below is handed to a reader through
    `json.dumps`."""
    return default if value is None else float(value)


def _clean(value, cap: int = 300) -> str:
    """Free text reduced to one printable line, capped.

    `graha_contacts.notes` carries whatever a marketplace put in a query body,
    newlines and all, and it is going into a URL query parameter. Collapsing the
    whitespace here means the cap counts characters a reader will see rather
    than counting the blank lines between them.
    """
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:cap]


# ══════════════════════════════════════════════════════════════════════════
# 29 · brief_firm_filing_calendar
# ══════════════════════════════════════════════════════════════════════════

#: The obligation KEYS a monthly calendar for an Indian firm must account for.
#:
#: These are lookup handles, not statutory facts — every date, form number and
#: section attached to them is read from `staging.statute_calendar` as of the
#: period end. The list exists for one purpose: so that a key which resolves to
#: NOTHING is reported as a gap instead of silently vanishing from the calendar.
#:
#: `tds.deposit.monthly` is the live case and the reason this constant is not
#: optional. Its only row ends 2026-04-01 with no Income-tax Act 2025 successor
#: seeded, so from April 2026 the calendar has no monthly TDS deposit rule —
#: and a firm's compliance calendar quietly losing the 7th of the month is the
#: most expensive silent failure this whole handler could have.
EXPECTED_MONTHLY_KEYS: tuple[str, ...] = (
    "gst.return.gstr1",
    "gst.return.gstr3b",
    "tds.deposit.monthly",
    "epf.remittance",
    "esi.remittance",
)

#: Saturday and Sunday, as `date.weekday()` numbers them.
#:
#: STATED BECAUSE IT IS AN ASSUMPTION. Plenty of Indian practices work
#: Saturdays, and there is no working-week setting anywhere on
#: `staging.organisations` to read — `settings` is an empty object on all three
#: live orgs. So this is the product's guess about the firm's week, it is on
#: `limitations`, and it is the one thing here a firm might reasonably want to
#: change.
WEEKEND = frozenset({5, 6})

#: How far back the work date may walk before the handler gives up and reports
#: the statutory date unshifted. A run of fourteen consecutive non-working days
#: is not a calendar, it is a data fault, and silently walking into the previous
#: month would be worse than saying so.
MAX_SHIFT_DAYS = 14


def _month_bounds(month: str) -> tuple[date, date]:
    """'2026-08' -> (2026-08-01, 2026-08-31)."""
    year, mon = (int(x) for x in month.split("-"))
    start = date(year, mon, 1)
    nxt = date(year + 1, 1, 1) if mon == 12 else date(year, mon + 1, 1)
    return start, nxt - timedelta(days=1)


def _previous_month(month: str) -> str:
    """'2026-08' -> '2026-07'. The period a month's monthly returns cover."""
    year, mon = (int(x) for x in month.split("-"))
    return f"{year - 1}-12" if mon == 1 else f"{year}-{mon - 1:02d}"


def _due_date_from(row: dict | None, period_end: date) -> date | None:
    """The statutory due date for a period, from a calendar row, or None.

    THE CALENDAR EXPRESSES A DUE DATE TWO WAYS and reading only one of them
    produces a plausible wrong date. The same trap is documented at
    `gst_year._due_date_from`, where it once put GSTR-9 nine months early; the
    logic is restated here rather than imported because a private helper in
    another handler's module is not an interface, and a calendar that silently
    changed shape when that file was refactored is exactly the failure this
    product keeps having.

      `due_month_offset`  months AFTER the period end — how the MONTHLY returns
                          are held. GSTR-1 is due_day 11, offset 1, so the July
                          return is due 11 August.
      `due_month`         an absolute month, for an obligation whose date is
                          fixed in the calendar rather than relative to a
                          period. GSTR-9 is due_day 31, due_month 12.

    Returns None — never a guess — when the row carries no `due_day` at all.
    Every quarterly TDS and TCS statement in the live calendar is in exactly
    that state, which is why they appear in `named_but_undated` below and not
    on a date somebody could act on.
    """
    if not row or not row.get("due_day"):
        return None
    day = int(row["due_day"])
    offset = row.get("due_month_offset")
    due_month = row.get("due_month")

    if offset is not None:
        month = period_end.month + int(offset)
        year = period_end.year + (month - 1) // 12
        month = (month - 1) % 12 + 1
    elif due_month is not None:
        month = int(due_month)
        year = period_end.year if month >= period_end.month else period_end.year + 1
    else:
        month, year = period_end.month, period_end.year

    # Clamp rather than raise: a due_day of 31 in a 30-day month is the
    # catalogue saying "the last day of that month", not a data error.
    for candidate in range(day, 27, -1):
        try:
            return date(year, month, candidate)
        except ValueError:
            continue
    return date(year, month, day)


def _shift_back(due: date, blocking: dict[date, str]) -> tuple[date, str | None]:
    """The last working day ON OR BEFORE *due*, and why it moved.

    BACKWARD, ALWAYS. Moving a filing date forward off a Sunday would be this
    handler telling a firm it may file on Monday, and the portal does not agree.
    The statutory date is reported separately and unchanged; this is only the
    date the firm has to have the work finished by.

    *blocking* maps a date to the reason it is not a working day — a
    NON-OPTIONAL holiday's name. Optional holidays are absent from it on
    purpose: `is_optional` means the office is open and only some people are
    away, so it is surfaced as a warning next to the date rather than moving it.
    """
    day, reasons = due, []
    for _ in range(MAX_SHIFT_DAYS):
        if day.weekday() in WEEKEND:
            reasons.append(f"{day.isoformat()} is a "
                           f"{'Saturday' if day.weekday() == 5 else 'Sunday'}")
        elif day in blocking:
            reasons.append(f"{day.isoformat()} is {blocking[day]}")
        else:
            return day, (" · ".join(reasons) if reasons else None)
        day = day - timedelta(days=1)

    # Fourteen consecutive non-working days is a data fault, not a calendar.
    # Reported unshifted and loudly, rather than walking into the month before.
    return due, (f"could not find a working day within {MAX_SHIFT_DAYS} days "
                 f"before {due.isoformat()} — the holiday list looks wrong, so "
                 f"the statutory date is shown unshifted")


def _statute_note(row: dict | None, what: str) -> str:
    """One sentence naming the authority for a printed date.

    Every figure these handlers print is attributable or it is not printed. An
    unattributed date in front of a CA is a date they have to go and verify,
    which costs more than not showing it.
    """
    if not row:
        return f"The statute calendar records no {what}, so none is shown."
    bits = [b for b in (row.get("form_number"), row.get("section_ref")) if b]
    cite = " · ".join(bits) if bits else (row.get("statute") or row.get("authority") or "")
    return f"{row.get('title') or what}{f' ({cite})' if cite else ''}"


async def brief_firm_filing_calendar(
    pool, org_id: str, month: str | None = None, limit: int = 200,
) -> dict:
    """The firm's OWN statutory dates for one month, shifted off non-working days.

    *month* is 'YYYY-MM' and defaults to the calendar month you are standing in,
    because that is the month whose dates you are working towards. It has to
    default at all or no schedule can ever run this — a handler with a required
    parameter is refused by `tests/test_a_skill_can_run_unattended.py`.

    Note the deliberate difference from the GST handlers: `check_gstr1_readiness`
    defaults to the PERIOD being filed (the previous month) because it is about
    a return's contents, while this defaults to the MONTH THE DATES FALL IN
    because it is about a diary. The period each monthly obligation covers is
    reported on every row so the two never get confused.

    Three lists, and the split is the answer:

      A  `dates`             dated items, each with the day the work must be
                             finished by after weekends and holidays
      B  `named_but_undated` obligations in force whose calendar row carries no
                             due day — named so the reader knows they exist,
                             never given an invented date
      C  `calendar_gaps`     obligation keys a monthly calendar must contain
                             where the statute calendar records NOTHING in
                             force. The most important of the three.

    ORG GRAIN ONLY, and never per client. Reads. Never writes — it does not
    create the tasks it describes, because a calendar that quietly creates
    sixty rows the first time somebody opens it is not a calendar.
    """
    today = utc_now().date()
    target = (month or f"{today.year:04d}-{today.month:02d}").strip()
    try:
        month_start, month_end = _month_bounds(target)
    except (ValueError, AttributeError):
        # A malformed month is the caller's bug and must be loud in the output
        # rather than silently answering about a different month.
        return {
            "as_at": today,
            "month": target,
            "counts": {"dated": 0, "undated": 0, "calendar_gaps": 0,
                       "could_not_run": 1},
            "dates": [], "named_but_undated": [], "calendar_gaps": [],
            "limitations": [
                f"'{target}' is not a month in the form 'YYYY-MM', so nothing "
                f"was looked up. No calendar is shown — a wrong month's dates "
                f"would be worse than none.",
            ],
        }

    cap = max(1, int(limit))
    period = _previous_month(target)
    _, period_end = _month_bounds(period)

    org = await pool.fetchrow(
        """
        SELECT o.name, o.state_code, o.gst_filing_scheme,
               (o.tan IS NOT NULL AND btrim(o.tan) <> '') AS has_tan
        FROM staging.organisations o
        WHERE o.id = $1::uuid
        """,
        org_id,
    )
    state_code = (org["state_code"] if org else None) or None
    firm_name = (org["name"] if org else None) or "your firm"

    # ── the law ────────────────────────────────────────────────────────────
    #
    # `as_of` is the PERIOD END, not today. A calendar for August 2026 lists
    # the July 2026 returns, and the form number that applies to a July period
    # is the one in force on 31 July — which is why this cannot use today's
    # date and why `services.statute.obligation` refuses to default it.
    #
    # `state_code` is passed through so that a state-specific row would outrank
    # the all-India one. None is seeded today; passing it costs nothing and
    # means a professional-tax row added later is picked up without a code
    # change here.
    monthly = await obligations(
        pool, as_of=period_end, periodicity="monthly", state_code=state_code
    )

    holidays = await pool.fetch(
        """
        SELECT h.date, h.name, COALESCE(h.is_optional, FALSE) AS is_optional
        FROM staging.manav_holidays h
        WHERE h.org_id = $1::uuid
          AND h.date BETWEEN $2::date AND $3::date
        ORDER BY h.date
        """,
        org_id, month_start - timedelta(days=MAX_SHIFT_DAYS + 1), month_end,
    )

    # AN OPTIONAL HOLIDAY IS A WORKING DAY. Only the non-optional rows go into
    # the blocking map; the optional ones are carried separately and reported
    # against whichever date they touch. Reading `is_optional` as "a holiday,
    # possibly" and shifting for it would move filing dates a week earlier than
    # they need to be, every year, on Gudi Padwa and Bhai Dooj.
    blocking: dict[date, str] = {}
    optional_by_day: dict[date, list[str]] = {}
    for h in holidays:
        day = as_date(h["date"])
        if day is None:
            continue
        if h["is_optional"]:
            optional_by_day.setdefault(day, []).append(h["name"])
        else:
            # Several rows can share a date — the live seed has five "E2E
            # Founders Day" rows on 2026-09-17. First name wins; the date is
            # blocked either way.
            blocking.setdefault(day, h["name"])

    dated: list[dict] = []
    undated: list[dict] = []
    seen_keys: set[str] = set()

    for row in monthly:
        seen_keys.add(row["obligation_key"])
        due = _due_date_from(row, period_end)
        entry = {
            "obligation_key": row["obligation_key"],
            "what": row["title"],
            "authority": row["authority"],
            "form_number": row.get("form_number"),
            "section_ref": row.get("section_ref"),
            "periodicity": row["periodicity"],
            "covers_period": period,
            "authority_note": _statute_note(row, "rule"),
            "verified_on": row.get("verified_on"),
        }
        if due is None:
            undated.append({
                **entry,
                "why_no_date": "the statute calendar carries no due day for "
                               "this obligation, so no date is shown",
            })
            continue

        # Only the dates falling INSIDE the month asked for. A monthly
        # obligation with a two-month offset would land outside and belongs on
        # that month's page, not this one.
        if not (month_start <= due <= month_end):
            continue

        work_by, reason = _shift_back(due, blocking)
        dated.append({
            **entry,
            # UNCHANGED. The deadline does not move because it fell on a
            # Sunday; only the firm's work date does.
            "statutory_due_on": due,
            "work_by": work_by,
            "shifted_by_days": days_between(due, work_by),
            "shift_reason": reason,
            "optional_holidays_near_the_date": sorted(
                {n for d, names in optional_by_day.items()
                 if work_by <= d <= due for n in names}
            ) or None,
            "days_from_today": days_between(work_by, today),
            "already_past": work_by < today,
        })

    dated.sort(key=lambda e: (e["statutory_due_on"], e["obligation_key"]))

    # ── C · what the calendar does NOT have ────────────────────────────────
    #
    # The half that makes this trustworthy. An obligation whose row has expired
    # with no successor simply disappears from `obligations()`, and a compliance
    # calendar that is silently short one date looks exactly like a compliance
    # calendar that is complete.
    gaps: list[dict] = []
    for key in EXPECTED_MONTHLY_KEYS:
        if key in seen_keys:
            continue
        # Asked again for the single key, so the gap can be described precisely:
        # a key with no row at all is a different problem from a key whose row
        # expired, and the fix is different too.
        one = await obligation(pool, key, as_of=period_end, state_code=state_code)
        gaps.append({
            "obligation_key": key,
            "what": "the statute calendar records no version of this "
                    "obligation in force on the period end",
            "as_of": period_end,
            "resolved": one is not None,
            "action": "your CTO seeds the missing row; nothing is printed from "
                      "memory in the meantime",
        })

    limitations = [
        "THE STATUTORY DATE NEVER MOVES. `statutory_due_on` is the deadline "
        "exactly as the calendar records it; `work_by` is the last working day "
        "on or before it, which is the date the firm has to be finished by. "
        "The shift is always backward — filing after the statutory date because "
        "it fell on a Sunday is filing late.",
        "This is the FIRM'S OWN calendar and no client's. There is no "
        "per-client registration record in this product — nothing records who "
        "is monthly, who is QRMP, who has TDS — so a per-client calendar would "
        "have to invent each client's obligations and this deliberately does "
        "not attempt one.",
        "APPLICABILITY IS NOT CHECKED. Every obligation in force is listed. "
        "Whether this firm is registered under GST, has employees covered by "
        "PF or ESI, or holds a TAN is the firm's to confirm — GSTIN, PAN and "
        "TAN block nothing in this product and are not treated as evidence of "
        "registration in either direction.",
        f"A working week here means Monday to Friday. Many Indian practices "
        f"work Saturdays and there is no working-week setting on the "
        f"organisation to read, so that is this product's assumption about "
        f"{firm_name}'s week and not a fact about it.",
        "Holidays are read from this organisation's own holiday list. That "
        "list has no STATE column, so a date cannot be shifted for a "
        "state-specific holiday that the firm has not itself recorded — a "
        "Maharashtra professional-tax date and an all-India GST date are "
        "shifted against exactly the same set of days.",
        "It never creates the tasks it describes. Nothing here writes.",
    ]
    if not holidays:
        limitations.append(
            "NO HOLIDAY IS RECORDED for this organisation in the window, so "
            "only weekends were shifted off. That is not the same as 'this "
            "firm has no holidays' — an empty holiday list and a firm that "
            "genuinely works every public holiday look identical from here.")
    if gaps:
        limitations.append(
            f"{len(gaps)} of the {len(EXPECTED_MONTHLY_KEYS)} obligations a "
            f"monthly calendar should carry resolve to NOTHING in the statute "
            f"calendar as of {period_end.isoformat()} "
            f"({', '.join(g['obligation_key'] for g in gaps)}). Those dates are "
            f"ABSENT from this calendar. They are not absent from the law — "
            f"this refuses to print a date it cannot attribute.")
    if undated:
        limitations.append(
            f"{len(undated)} obligation(s) in force carry no due day in the "
            f"statute calendar and are named without a date rather than given "
            f"an invented one.")
    if org is None:
        limitations.append(
            "No organisation row was found for this id, so the firm's state "
            "code could not be read and only all-India rules were resolved.")

    return {
        "as_at": today,
        "firm": firm_name,
        "month": target,
        "period_covered_by_monthly_returns": period,
        "resolved_as_of": period_end,
        "state_code": state_code,
        "gst_filing_scheme": (org["gst_filing_scheme"] if org else None),
        "counts": {
            "obligations_in_force": len(monthly),
            "dated": len(dated),
            "dates_shifted": sum(1 for d in dated if d["shifted_by_days"] > 0),
            "already_past": sum(1 for d in dated if d["already_past"]),
            "named_but_undated": len(undated),
            "calendar_gaps": len(gaps),
            "holidays_recorded": len(holidays),
            "optional_holidays_recorded": sum(1 for h in holidays if h["is_optional"]),
            "capped_at": cap,
            "was_capped": len(dated) > cap,
        },
        "dates": dated[:cap],
        "named_but_undated": undated[:cap],
        "calendar_gaps": gaps,
        "holidays_used": [
            {"date": as_date(h["date"]), "name": h["name"],
             "is_optional": bool(h["is_optional"]),
             "blocks_work": not h["is_optional"]}
            for h in holidays
        ],
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 30 · check_approvals_that_sit
# ══════════════════════════════════════════════════════════════════════════

#: The ladder, in days waiting. Catalogue #30: "Two days pings the approver,
#: four copies the requester, seven escalates. Exits on any decision."
#:
#: Read as "the highest rung whose threshold this approval has passed". The
#: third rung is not a third ping — it changes WHO is told, which is the only
#: reason a third rung is ever worth having.
LADDER = (
    (2, "ping the approver", "approver"),
    (4, "copy the requester", "requester"),
    (7, "escalate inside the firm", "internal"),
)

#: Roles that may act on a `public.approvals` row. Taken from what the product
#: actually enforces — `services/skills/data/my_desk.py` and
#: `server.py`'s pending-approvals endpoint both gate on
#: `project_assignments.role IN ('owner','admin')`, with `team_members` as the
#: second path for the task-level mechanism. Both are read here so the answer
#: to "who is this waiting on" matches who can actually press the button.
APPROVER_ROLES = ("owner", "admin")

#: The org-level roles a stuck approval escalates to. NOT a reporting line —
#: see the note in the handler. `staging.user_roles` is the sole tenant path.
ESCALATION_ROLES = ("org_owner", "org_admin")


def _rung_for(days_waiting: int, already_sent: int) -> dict:
    """Where an item stands, from its age AND from what has already gone out.

    Lifted deliberately from `chase_ladder._rung_for`, whose shape this follows
    on instruction, including the part that matters most: the NEXT rung owed is
    not always the highest rung reached. An approval that surfaces at twelve
    days with nothing sent owes the first ping, not the escalation — skipping
    straight to the top sends a partner an escalation about a request the
    approver has never once been told about.

    `already_sent` is a parameter rather than something derived from the age,
    which is the whole point of a ladder. For approvals it is ALWAYS 0, and
    that is a structural fact rather than a measurement — see
    `check_approvals_that_sit`.
    """
    reached = [r for r in LADDER if days_waiting >= r[0]]
    if not reached:
        return {
            "action": "nothing yet",
            "rung": 0,
            "direction": None,
            "why": f"waiting {days_waiting} day(s); the first ping is at "
                   f"{LADDER[0][0]} days",
        }

    entitled = len(reached)
    if already_sent >= entitled:
        return {
            "action": "already done",
            "rung": entitled,
            "direction": reached[-1][2],
            "why": f"{already_sent} chase(s) already sent and this is on rung "
                   f"{entitled}; nothing new is due",
        }

    owed = LADDER[already_sent]
    return {
        "action": owed[1],
        "rung": already_sent + 1,
        "direction": owed[2],
        "why": f"waiting {days_waiting} day(s) with {already_sent} chase(s) "
               f"sent; rung {already_sent + 1} is owed",
    }


#: The org's teams. `public.approvals` has NO org_id — the tenant path is
#: `public.teams.org_id`, and the second arm of the UNION covers the org's own
#: `organisations.team_id` in case no `teams` row claims it.
#:
#: DELETED TEAMS ARE INCLUDED HERE ON PURPOSE, and that is a departure from
#: `my_desk`, which filters `deleted_at IS NULL`. Three live pending approvals
#: sit on a team deleted on 2026-06-05, and excluding them would mean this
#: skill reports a clean queue while a partner's request sits somewhere nobody
#: can see it. They are separated out below rather than put on the ladder,
#: because they need a different action from a nudge.
_ORG_TEAMS = """
    SELECT t.team_id, t.name, (t.deleted_at IS NOT NULL) AS is_deleted
      FROM public.teams t
     WHERE t.org_id = $1::uuid
    UNION
    SELECT o.team_id, o.name, FALSE
      FROM staging.organisations o
     WHERE o.id = $1::uuid
       AND NOT EXISTS (SELECT 1 FROM public.teams t2 WHERE t2.team_id = o.team_id)
"""


async def check_approvals_that_sit(
    pool, org_id: str, limit: int = 200,
) -> dict:
    """Pending approvals, each on the rung its age has earned.

    Two days pings the approver, four copies the requester, seven escalates.
    Exits on any decision — only `status = 'pending'` rows are considered, so an
    approval that was approved or rejected leaves the ladder the moment it is
    decided, with no separate exit to maintain.

    ── THE CHASE HISTORY DOES NOT EXIST, AND THAT IS NOT A MEASUREMENT ──────

    `chase_ladder` can subtract the chases already delivered because
    `staging.reminders` records one row per reminder with an `entity_id` and a
    delivery status. THAT IS UNAVAILABLE HERE, structurally:

        staging.reminders.entity_id   is  uuid
        public.approvals.approval_id  is  text  ('appr_958c2c5256e5')

    An approval's key cannot be stored in that column at all. `outbound_log`
    does not help either — it records a channel, a purpose and a recipient, and
    carries no entity reference of any kind. So NOT ONE approval has ever been
    chased in this product, no approval chase can currently be recorded, and
    every row below comes back with `chases_delivered: 0` and
    `chase_history_available: False`.

    Two consequences, both stated rather than hidden.

      * Run daily, this names the same approvals every day until somebody
        decides them.
      * EVERY APPROVAL PINS AT RUNG ONE. The ladder never skips a rung, so with
        the chase count stuck at zero the first ping is the only rung ever
        owed, however old the request gets. Rungs two and three are reachable
        only once a delivered chase can be recorded. Each row therefore also
        carries `rung_the_age_alone_would_reach` and `aged_past_escalation`, so
        a reader can see which requests have drifted past seven days without
        the output claiming an escalation is due.

    Making it a real ladder needs one column — a text entity key on
    `staging.reminders`, or the acknowledgement table catalogue #61 asks for —
    and that is your CTO's migration, not this handler's to fake.

    ── THE THIRD RUNG, HONESTLY ─────────────────────────────────────────────

    Rung three has nowhere good to go. `manav_employees.reporting_to` is the
    only reporting-line column in the database and it is EMPTY on all 98 live
    employee rows; `manav_employees.user_id` is empty on all 98 as well, so an
    approval's requester — a `users.user_id` — cannot be joined to an employee
    record even if the column were filled. There is no manager to name.

    So this escalates to the org's admins and owner from `staging.user_roles`,
    and says plainly on every escalation that it is doing so: a ROLE, not a
    reporting line, and not this person's manager. When the org has no admin at
    all it names nobody and says the escalation has no destination, rather than
    picking the nearest available human.

    Never writes, never sends. It says what is due and to whom; delivering it
    is a Niyam rule and arming one is the owner's decision.
    """
    today = utc_now().date()
    cap = max(1, int(limit))

    rows = await pool.fetch(
        f"""
        WITH org_teams AS ({_ORG_TEAMS})
        SELECT a.approval_id, a.task_id, a.team_id, a.request_type, a.created_at,
               ot.name AS team_name, ot.is_deleted,
               COALESCE(NULLIF(btrim(a.request_data->>'title'), ''),
                        NULLIF(btrim(a.request_data->>'note'), ''),
                        '(the request carries no title)') AS what,
               COALESCE(NULLIF(btrim(u.full_name), ''),
                        NULLIF(btrim(u.name), ''),
                        '(the requester is no longer named in this product)')
                   AS requested_by
        FROM public.approvals a
        JOIN org_teams ot ON ot.team_id = a.team_id
        LEFT JOIN public.users u ON u.user_id = a.requested_by
        WHERE a.status = 'pending'
        ORDER BY a.created_at
        LIMIT $2::int
        """,
        org_id, cap,
    )

    # The denominator. "0 pending" and "this org has no approvals mechanism in
    # use" are different answers and must not look alike.
    tallies = await pool.fetch(
        f"""
        WITH org_teams AS ({_ORG_TEAMS})
        SELECT a.status, count(*) AS n
        FROM public.approvals a
        JOIN org_teams ot ON ot.team_id = a.team_id
        GROUP BY a.status
        """,
        org_id,
    )
    by_status = {r["status"]: int(r["n"]) for r in tallies}

    # ── who can actually press the button ──────────────────────────────────
    #
    # NAMES, never ids. Both membership paths are read because the product
    # enforces both, and a "waiting on" that names somebody with no button is
    # worse than naming nobody.
    team_ids = sorted({r["team_id"] for r in rows})
    approvers: dict[str, list[str]] = {}
    if team_ids:
        people = await pool.fetch(
            """
            SELECT pa.team_id::text AS team_id, pa.role::text AS role,
                   COALESCE(NULLIF(btrim(u.full_name), ''),
                            NULLIF(btrim(u.name), ''),
                            NULLIF(btrim(pa.full_name), '')) AS person
            FROM public.project_assignments pa
            LEFT JOIN public.users u ON u.user_id = pa.user_id
            WHERE pa.team_id::text = ANY($1::text[])
              AND pa.role::text = ANY($2::text[])
            UNION
            SELECT tm.team_id::text, tm.role::text,
                   COALESCE(NULLIF(btrim(u2.full_name), ''),
                            NULLIF(btrim(u2.name), ''),
                            NULLIF(btrim(tm.full_name), ''))
            FROM public.team_members tm
            LEFT JOIN public.users u2 ON u2.user_id = tm.user_id
            WHERE tm.team_id::text = ANY($1::text[])
              AND tm.role::text = ANY($2::text[])
              AND tm.status = 'active'
            """,
            team_ids, list(APPROVER_ROLES),
        )
        for p in people:
            if p["person"]:
                bucket = approvers.setdefault(p["team_id"], [])
                if p["person"] not in bucket:
                    bucket.append(p["person"])

    # ── rung three's destination ───────────────────────────────────────────
    escalation = await pool.fetch(
        """
        SELECT ur.role_code,
               COALESCE(NULLIF(btrim(u.full_name), ''),
                        NULLIF(btrim(u.name), '')) AS person
        FROM staging.user_roles ur
        LEFT JOIN public.users u ON u.user_id = ur.user_id
        WHERE ur.org_id = $1::uuid
          AND ur.role_code = ANY($2::text[])
        ORDER BY ur.role_code
        """,
        org_id, list(ESCALATION_ROLES),
    )
    escalate_to = []
    for e in escalation:
        if e["person"] and e["person"] not in escalate_to:
            escalate_to.append(e["person"])

    items: list[dict] = []
    for r in rows:
        raised = as_date(r["created_at"])
        # `days_between`, never a hand subtraction — `created_at` is a
        # timestamptz and asyncpg returns it AWARE, so a naive `datetime.now()`
        # minus this raises. That bug reached production twice.
        waiting = days_between(today, raised)
        # ALWAYS 0, and the sibling flag says why. Passing a real count would
        # need a chase record that cannot exist for a text approval key.
        rung = _rung_for(waiting, 0)
        # THE RUNG THE AGE ALONE WOULD REACH, reported beside the rung actually
        # owed — because with `already_sent` pinned at 0 they diverge on every
        # row, permanently, and a reader who sees only "ping the approver" on a
        # twenty-day-old request would reasonably conclude nothing has aged.
        # This is the honest way to answer "which of these has gone past
        # seven days" without claiming an escalation is due when the approver
        # has never once been told.
        aged_to = len([step for step in LADDER if waiting >= step[0]])
        who = approvers.get(r["team_id"], [])
        items.append({
            "kind": "approval",
            # A row handle for the UI to act on, not a value to render as a
            # name. `approval_id` is a text key, not a uuid.
            "approval_id": r["approval_id"],
            "task_ref": r["task_id"],
            "project": r["team_name"],
            "project_deleted": bool(r["is_deleted"]),
            "what": r["what"],
            "request_type": r["request_type"],
            "requested_by": r["requested_by"],
            "raised_on": raised,
            "days_waiting": waiting,
            "chases_delivered": 0,
            "chase_history_available": False,
            "rung_the_age_alone_would_reach": aged_to,
            "aged_past_escalation": waiting >= LADDER[-1][0],
            "waiting_on": who or None,
            "escalate_to": escalate_to or None,
            "escalation_is_a_role_not_a_manager": True,
            **rung,
        })

    # ── an approval on a deleted project is its own state ──────────────────
    #
    # Nobody can open it, so nobody can decide it. Pinging an approver about it
    # asks them to do an impossible thing — the same reasoning that takes an
    # expired signature off `chase_ladder`'s ladder. It is counted AND rendered
    # here, in its own list, because a count with no list is how a row goes
    # missing while the totals still add up.
    orphaned = [i for i in items if i["project_deleted"]]
    live = [i for i in items if not i["project_deleted"]]
    for i in orphaned:
        i["action"] = "cannot be chased — the project was deleted"
        i["rung"] = 0
        i["direction"] = None
        i["why"] = ("the project this approval belongs to has been deleted, so "
                    "no one can open or decide it; it must be re-raised on a "
                    "live project or written off")

    due_now = [i for i in live if i["action"] in
               ("ping the approver", "copy the requester",
                "escalate inside the firm")]
    ping = [i for i in due_now if i["action"] == "ping the approver"]
    copy_requester = [i for i in due_now if i["action"] == "copy the requester"]
    escalations = [i for i in due_now if i["action"] == "escalate inside the firm"]
    no_approver = [i for i in live if not i["waiting_on"]]

    limitations = [
        "IT NEVER SENDS AND NEVER WRITES. It says what is due and to whom; "
        "delivering it is a Niyam rule and arming one is the owner's decision. "
        "It does not record a chase either — recording one nobody sent is worse "
        "than sending none.",
        "THIS LADDER CANNOT SUBTRACT WHAT WAS ALREADY SENT. "
        "`staging.reminders.entity_id` is a uuid and `public.approvals."
        "approval_id` is text, so an approval chase cannot be recorded there at "
        "all, and `outbound_log` carries no entity reference. Every row shows "
        "`chases_delivered: 0` because no chase can ever have been recorded — "
        "not because none was sent. Run daily, this names the same approvals "
        "every day until they are decided.",
        "BECAUSE OF THAT, EVERY APPROVAL PINS AT RUNG ONE. The ladder never "
        "skips a rung — escalating to a partner about a request the approver "
        "was never once told about is the wrong message — and with the chase "
        "count stuck at zero, rung one is where an approval stays however old "
        "it gets. `rung_the_age_alone_would_reach` on each row, and "
        "`counts.aged_past_escalation`, say how far past the thresholds these "
        "have actually drifted. Those rows are in `ping_the_approver`, not in a "
        "list of their own.",
        "THE ESCALATION IS A ROLE, NOT A REPORTING LINE. "
        "`manav_employees.reporting_to` is empty on every live employee row and "
        "`manav_employees.user_id` is empty too, so an approval's requester "
        "cannot be resolved to a manager at all. Rung three names the "
        "organisation's admins and owner instead, and says so.",
        "Only `public.approvals` is read. There is a SECOND approval mechanism "
        "in this product — `tasks.approval_status`, written by "
        "`approvals_router.py` — and it is not on this ladder, so the pending "
        "count here is a FLOOR for what the firm is actually waiting on.",
        "'Waiting' is measured from when the request was raised. Nothing "
        "records when an approver first saw it, so an approval raised at 23:55 "
        "and one raised at 00:05 the next day are a day apart on this ladder "
        "and ten minutes apart in reality.",
    ]
    if not rows:
        limitations.append(
            f"No approval is pending. Across every status this organisation has "
            f"{sum(by_status.values())} approval row(s) "
            f"({', '.join(f'{k}: {v}' for k, v in sorted(by_status.items())) or 'none at all'}) "
            f"— so this is a clear queue rather than a mechanism nobody uses, "
            f"unless that total is also zero.")
    if orphaned:
        limitations.append(
            f"{len(orphaned)} pending approval(s) sit on a DELETED project. "
            f"They are excluded from the ladder because nobody can open them, "
            f"and they are invisible to the Approvals screen and to `my_desk`, "
            f"both of which filter deleted teams out.")
    if no_approver:
        limitations.append(
            f"{len(no_approver)} pending approval(s) have NO owner or admin on "
            f"the project, so there is nobody to ping at rung one. This names "
            f"them rather than choosing somebody who cannot act.")
    if not escalate_to:
        limitations.append(
            "This organisation has no org owner or admin recorded in "
            "`user_roles`, so rung three has no destination at all. Nobody is "
            "named for it — inventing an escalation target is how an "
            "escalation reaches somebody who cannot act on it.")

    return {
        "as_at": today,
        "ladder": [
            {"days_waiting": d, "action": a, "direction": k} for d, a, k in LADDER
        ],
        "escalates_to": escalate_to or None,
        "counts": {
            "pending": len(items),
            "on_a_live_project": len(live),
            "on_a_deleted_project": len(orphaned),
            "action_due_now": len(due_now),
            "ping_the_approver": len(ping),
            "copy_the_requester": len(copy_requester),
            "escalations_due": len(escalations),
            # Not the same number as `escalations_due`, and the gap between them
            # IS the missing chase record.
            "aged_past_escalation": sum(1 for i in live if i["aged_past_escalation"]),
            "with_no_approver_to_ping": len(no_approver),
            "nothing_due_yet": sum(1 for i in live if i["action"] == "nothing yet"),
            "approvals_all_statuses": sum(by_status.values()),
            "decided": sum(v for k, v in by_status.items() if k != "pending"),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "by_status": by_status,
        "ping_the_approver": ping,
        "copy_the_requester": copy_requester,
        "escalations_due": escalations,
        "waiting_but_nothing_due": [i for i in live if i["action"] == "nothing yet"],
        "on_a_deleted_project": orphaned,
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 32 · pack_lead_first_touch
# ══════════════════════════════════════════════════════════════════════════

#: The two lead marketplaces `services/lead_ingest.py` writes contacts from.
#: Matched against `graha_contacts.source` and against
#: `custom_data->>'source'`, because the pull path writes both and the
#: notification-email fallback in `services/lead_parser.py` writes only one.
MARKETPLACE_SOURCES = ("indiamart", "justdial")

#: WhatsApp's own prefill limit is generous, but a link is going into a
#: salesperson's phone and a message they have to scroll to read is a message
#: they will delete and retype. Kept short deliberately.
MESSAGE_CAP = 700

#: The country code assumed for a bare ten-digit Indian mobile. Applied ONLY to
#: ten digits beginning 6-9, which is the entire Indian mobile range; anything
#: else is refused rather than guessed, because a wa.me link to a wrong number
#: is a message to a stranger.
INDIA_CC = "91"


def _wa_number(raw: str | None, normalised: str | None) -> tuple[str | None, str]:
    """(digits for wa.me, why not) — never a guess.

    `wa.me/<digits>` needs the full international number with no plus and no
    separators. The live data holds three shapes in one column — `+919812345678`,
    `+91 9100003571` and a bare `9812345678` — and `phone_norm` (migration 024's
    generated column) strips to the last ten digits, losing the country code
    entirely. So both are considered and the RAW value wins, because it is the
    only one that can still carry a country code.

    Refusal is a real answer. A number this cannot place is returned with the
    reason rather than dialled into +91 and hoped for.
    """
    digits = re.sub(r"\D", "", raw or "")
    if not digits:
        digits = re.sub(r"\D", "", normalised or "")
    if not digits:
        return None, "no phone number is recorded for this contact"

    # 00 and 0 are trunk/international prefixes, not part of the number.
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]

    if len(digits) == 10:
        if digits[0] in "6789":
            return INDIA_CC + digits, ""
        return None, (f"'{raw}' is ten digits but does not begin 6-9, so it is "
                      f"not an Indian mobile and no country code can be assumed")
    if len(digits) == 12 and digits.startswith(INDIA_CC):
        return digits, ""
    # An international number the contact recorded in full. Accepted only when
    # the raw value announced itself as international, so a mistyped local
    # number never becomes a link to another country.
    if 11 <= len(digits) <= 15 and (raw or "").strip().startswith(("+", "00")):
        return digits, ""
    return None, (f"'{raw}' is {len(digits)} digits and carries no country "
                  f"code this can place, so no link is offered")


def _first_message(lead_name: str, firm: str, source: str,
                   about: str, when: date | None) -> str:
    """The message the rep sends, written here and not by a model.

    Deterministic on purpose. This is the first thing a stranger reads from the
    firm, it goes out under a partner's name, and a model writing it once per
    lead is both a recurring cost and a sentence nobody approved. Catalogue #38
    is where a drafted reply belongs — pulled by a human, on demand.

    It names the enquiry rather than opening cold, because that is the whole
    advantage of a marketplace lead: they asked first.
    """
    greeting = f"Hello {lead_name}" if lead_name else "Hello"
    where = f" via {source}" if source else ""
    day = f" on {when.isoformat()}" if when else ""
    lines = [
        f"{greeting}, this is {firm}.",
        f"Thank you for your enquiry{where}{day}.",
    ]
    if about:
        lines.append(f"You asked about: {about}")
    lines.append("Is now a good time for a quick call so I can understand what "
                 "you need?")
    return " ".join(lines)[:MESSAGE_CAP]


async def pack_lead_first_touch(
    pool, org_id: str, days_back: int = 14, limit: int = 200,
) -> dict:
    """New inbound leads nobody has touched, each with a ready wa.me link.

    A marketplace lead lands; the rep should be one tap from a first message
    that names the enquiry. That is all this does, and the reason it is not
    blocked when every other WhatsApp item in the catalogue is: **`wa.me` is a
    URL, not an API.** It opens the rep's own WhatsApp with the text
    pre-filled. There is no WABA, no template approval, no Meta charge, and no
    send — a human still presses the button.

    *days_back* windows on `created_at` and defaults, because a handler with a
    required parameter cannot be scheduled.

    ── IT DOES NOT SEND, AND IT DOES NOT CREATE THE CONTACT ─────────────────

    Catalogue #32 says "find or create the contact". This handler only FINDS.
    Creating a contact from a marketplace payload is `services/lead_ingest.py`'s
    job and it already does it, on the inbound path where the payload actually
    is; a skill run on a schedule has no payload to create anything from, and a
    second write path into `graha_contacts` is how duplicate leads happen.

    ── CONSENT, AND WHAT THIS PRODUCT CAN ACTUALLY SEE ──────────────────────

    `staging.varta_contacts.opted_in` is the only WhatsApp consent record in the
    database, and it is read here through both paths — the `graha_contact_id`
    link and, for a row that was never linked, the phone number. Three states,
    and they are not the same state:

      opted out          `opted_in` is FALSE. NO LINK IS BUILT. A refusal is a
                         refusal, and offering a one-tap link next to it is how
                         a refusal gets tapped through.
      consent on record  `opted_in` is TRUE, with the date.
      not recorded       there is no row at all. THE LINK IS STILL BUILT, and
                         it says so on the row. A wa.me link is a person
                         replying to an enquiry that person sent — not a
                         broadcast — so a missing opt-in row is not a reason to
                         refuse it. It IS a reason to refuse a template send
                         from a WABA later, which is catalogue #33's job.

    Marketing-email unsubscribes (`prachar_unsubscribes`,
    `mkt_unsubscribes`) are deliberately NOT consulted. An unsubscribe from a
    marketing mailing list is not a WhatsApp opt-out, and reading those tables
    would gate this CRM skill behind the marketing module for a signal that
    does not answer the question asked.
    """
    now = utc_now()
    today = now.date()
    window_start = now - timedelta(days=max(1, int(days_back)))
    cap = max(1, int(limit))

    org = await pool.fetchrow(
        "SELECT o.name FROM staging.organisations o WHERE o.id = $1::uuid",
        org_id,
    )
    firm = (org["name"] if org else None) or "our firm"

    # BOTH graha joins carry org_id. The FK on `graha_clients` is on the id
    # ALONE, so an id-only join can print another practice's client name against
    # this practice's lead. That has been proved live.
    leads = await pool.fetch(
        """
        SELECT c.id, c.name, c.company, c.phone, c.phone_norm, c.email,
               c.source, c.contact_type, c.created_at, c.notes,
               c.custom_data->>'source'      AS feed_source,
               c.custom_data->>'external_id' AS feed_ref,
               c.custom_data->>'occurred_at' AS feed_time,
               COALESCE(NULLIF(btrim(cl.name), ''),
                        NULLIF(btrim(c.company), '')) AS company_name
        FROM staging.graha_contacts c
        LEFT JOIN staging.graha_clients cl
               ON cl.id = c.client_id AND cl.org_id = c.org_id
        WHERE c.org_id = $1::uuid
          AND c.is_active
          AND c.merged_into_id IS NULL
          AND c.created_at >= $2::timestamptz
          AND c.last_contacted_at IS NULL
        ORDER BY c.created_at DESC
        LIMIT $3::int
        """,
        org_id, window_start, cap,
    )

    # Fetched whole and indexed in Python rather than joined twice. The second
    # lookup is on a NORMALISED phone number, which no index on either table
    # serves, and the set is small — 60 rows across the whole database.
    consent_rows = await pool.fetch(
        """
        SELECT v.graha_contact_id::text AS contact_id, v.phone_number,
               COALESCE(v.opted_in, FALSE) AS opted_in, v.opted_in_at
        FROM staging.varta_contacts v
        WHERE v.org_id = $1::uuid
        """,
        org_id,
    )
    by_contact = {r["contact_id"]: r for r in consent_rows if r["contact_id"]}
    # TWO INDEXES, TRIED IN THAT ORDER. The full international number first,
    # because it is an identity; the last ten digits only as a fallback, because
    # it is not. `graha_contacts.phone_norm` — migration 024's generated column
    # — keeps only the last ten digits, so a UK number stored there reads as
    # 7405382925 and would collide with an Indian mobile ending the same way.
    # That is not hypothetical: `+447405382925` is a live contact in two of the
    # three orgs. Matching on the full number first means the tail is used only
    # when neither side could be placed in a country at all.
    by_full: dict[str, dict] = {}
    by_tail: dict[str, dict] = {}
    for r in consent_rows:
        full, _ = _wa_number(r["phone_number"], None)
        if full:
            by_full.setdefault(full, r)
        tail = re.sub(r"\D", "", r["phone_number"] or "")[-10:]
        if len(tail) == 10:
            by_tail.setdefault(tail, r)

    ready: list[dict] = []
    refused: list[dict] = []
    unreachable: list[dict] = []

    for r in leads:
        contact_id = str(r["id"])
        source = (r["feed_source"] or r["source"] or "").strip()
        is_marketplace = source.lower() in MARKETPLACE_SOURCES

        # Resolved BEFORE the consent lookup, because the international form is
        # the strongest key the consent record can be matched on.
        number, why_not = _wa_number(r["phone"], r["phone_norm"])

        # `varta_contacts.graha_contact_id` is nullable, so the link is tried
        # first and the number second. A consent check that only works when a
        # foreign key happens to be filled is not a consent check.
        consent = by_contact.get(contact_id)
        consent_path = "linked to a WhatsApp contact record"
        if consent is None and number:
            consent = by_full.get(number)
            consent_path = "matched on the full phone number"
        if consent is None:
            # A WEAK MATCH MAY REFUSE. IT MAY NEVER PERMIT.
            #
            # The last ten digits are not an identity — a UK number and an
            # Indian mobile ending the same way collide, and `+447405382925` is
            # a live contact in two of the three orgs. So a tail match is
            # honoured when it says OPTED OUT, because holding a message back
            # on weak evidence costs a phone call, and it is DISCARDED when it
            # says opted in, because acting on weak evidence of permission is
            # how a refusal gets messaged anyway.
            tail = re.sub(r"\D", "", r["phone"] or r["phone_norm"] or "")[-10:]
            weak = by_tail.get(tail) if len(tail) == 10 else None
            if weak is not None and not weak["opted_in"]:
                consent = weak
                consent_path = ("matched on the last ten digits of the phone "
                                "number, which is a weak match honoured only "
                                "because it is a refusal")
            else:
                consent_path = "none"

        # NAMES, never ids. `company_name` prefers the CRM client — the client
        # is the COMPANY and the contact is a person who may move on.
        lead_name = _clean(r["name"], 80)
        entry = {
            # A row handle for the UI, not a value to render as a name.
            "contact_id": contact_id,
            "lead": lead_name or "(the lead gave no name)",
            "company": _clean(r["company_name"], 120) or None,
            "source": source or "(no source recorded)",
            "from_a_marketplace": is_marketplace,
            "marketplace_reference": r["feed_ref"] or None,
            "enquired_on": as_date(r["feed_time"]) or as_date(r["created_at"]),
            "days_since_it_landed": days_between(today, as_date(r["created_at"])),
            "about": _clean(r["notes"], 200) or None,
            "has_email": bool((r["email"] or "").strip()),
        }

        if consent is not None and not consent["opted_in"]:
            # A REFUSAL IS A REFUSAL. No link is built, not even a disabled one.
            refused.append({
                **entry,
                "consent": "opted out",
                "consent_recorded_on": as_date(consent["opted_in_at"]),
                "why": "this number is recorded as opted out of WhatsApp, so "
                       "no link is offered — reach them by phone or email "
                       "instead",
            })
            continue

        if not number:
            unreachable.append({**entry, "why": why_not})
            continue

        if consent is None:
            consent_state = "not recorded"
            consent_note = (
                "nothing in this product records a WhatsApp opt-in for this "
                "number. A wa.me link is still offered because it is a reply "
                "to an enquiry they sent, but a template send from a business "
                "account would need consent first.")
            consent_on = None
        else:
            consent_state = "on record"
            consent_note = f"opt-in recorded, {consent_path}"
            consent_on = as_date(consent["opted_in_at"])

        message = _first_message(
            lead_name, firm, source,
            _clean(r["notes"], 160),
            as_date(r["feed_time"]) or as_date(r["created_at"]),
        )
        ready.append({
            **entry,
            "consent": consent_state,
            "consent_recorded_on": consent_on,
            "consent_note": consent_note,
            "whatsapp_number": number,
            "message": message,
            # The whole deliverable. No API, no token, no send.
            "wa_link": f"https://wa.me/{number}?text={quote(message, safe='')}",
        })

    marketplace_ready = [e for e in ready if e["from_a_marketplace"]]
    other_ready = [e for e in ready if not e["from_a_marketplace"]]
    marketplace_seen = sum(
        1 for r in leads
        if ((r["feed_source"] or r["source"] or "").strip().lower()
            in MARKETPLACE_SOURCES)
    )

    limitations = [
        "IT NEVER SENDS. A `wa.me` link opens the rep's own WhatsApp with the "
        "text already typed; a person still presses send. Nothing here touches "
        "a WhatsApp Business account, and no message is logged as sent.",
        "It finds contacts; it does not create them. A marketplace payload is "
        "turned into a contact by the inbound path in "
        "`services/lead_ingest.py` — a scheduled run has no payload, and a "
        "second write path into the CRM is how one enquiry becomes two leads.",
        "'Untouched' means `last_contacted_at` is empty. That column is set by "
        "the CRM screens and by nothing else, so a lead somebody rang from "
        "their own phone and never logged still appears here as untouched.",
        "The first message is written by this handler, not by a model. It is "
        "the same four sentences every time, with the lead's name and enquiry "
        "filled in — a rep should edit it before sending rather than treating "
        "it as finished copy.",
        "Consent is read from `varta_contacts.opted_in`, which is the only "
        "WhatsApp consent record in this product. Marketing-email "
        "unsubscribes are NOT consulted: an unsubscribe from a mailing list is "
        "not a WhatsApp opt-out, and treating it as one would hold back a "
        "reply to somebody who just asked a question.",
        "A number this cannot place in a country is refused rather than "
        "assumed Indian. Ten digits beginning 6-9 are treated as an Indian "
        "mobile; anything else needs a country code on the contact record.",
        "A consent record with no contact link is matched on the full "
        "international number first. A match on the last ten digits alone is "
        "treated as weak — two numbers in different countries can end the same "
        "way — so it is honoured when it records a REFUSAL and discarded when "
        "it records an opt-in. Every row says which way its consent record was "
        "found.",
    ]
    if marketplace_seen == 0:
        limitations.append(
            "NO MARKETPLACE LEAD WAS FOUND, AND THAT IS ABOUT THE FEED, NOT "
            "THE WINDOW. Not one contact in this organisation carries an "
            "`indiamart` or `justdial` source at all — the marketplace "
            "integration has never written a row here. Until it is connected, "
            "the leads below arrived through other doors and are shown because "
            "the same one-tap link serves them.")
    if not leads:
        limitations.append(
            f"No untouched lead was created in the last {int(days_back)} day(s). "
            f"That is an empty window, not a checked-and-clean CRM — widen "
            f"`days_back` to see further back.")
    if refused:
        limitations.append(
            f"{len(refused)} lead(s) are recorded as opted out of WhatsApp and "
            f"carry NO link, deliberately.")
    if not consent_rows:
        limitations.append(
            "This organisation has no WhatsApp contact records at all, so "
            "every lead below reads as 'consent not recorded'. That is an "
            "absence of data, not evidence that nobody consented.")

    return {
        "as_at": today,
        "firm": firm,
        "window_days": int(days_back),
        "window_from": window_start.date(),
        "counts": {
            "untouched_leads_examined": len(leads),
            "from_a_marketplace": marketplace_seen,
            "marketplace_links_ready": len(marketplace_ready),
            "other_links_ready": len(other_ready),
            "links_ready": len(ready),
            "consent_on_record": sum(1 for e in ready if e["consent"] == "on record"),
            "consent_not_recorded": sum(1 for e in ready if e["consent"] == "not recorded"),
            "opted_out_no_link": len(refused),
            "no_usable_number": len(unreachable),
            "whatsapp_contact_records": len(consent_rows),
            "capped_at": cap,
            "was_capped": len(leads) >= cap,
        },
        "marketplace_first_touch": marketplace_ready,
        "other_new_leads": other_ready,
        "opted_out_no_link": refused,
        "no_usable_number": unreachable,
        "limitations": limitations,
    }
