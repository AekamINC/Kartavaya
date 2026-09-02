"""
client_register — catalogue #45, #46, #53.

The three that migration 175 unblocked, and the one thing they have in common:
THE COLUMNS THEY READ ARE EMPTY.

    brief_client_obligations_register   who is monthly, who is QRMP, who deducts
                                        TDS, who is under audit — and the
                                        filing-week board built from it
    pack_client_filing_calendar         each client's obligations resolved to
                                        DATES, shifted off weekends and the
                                        firm's holidays, with a named owner
    check_regional_send_guard           which recipients a chase would land on
                                        during their own non-working day

── THE MOST IMPORTANT FACT IN THIS FILE ─────────────────────────────────────

`staging.client_obligations` was created by migration 175 on 2026-08-20 and
holds ZERO ROWS. Nothing in the product writes it — there is no obligations
screen, no import, no seed. `staging.manav_holidays.state_code` was added by the
same migration and is NULL on all 38 rows.

So the honest answer from all three of these today is NOT "no problems found".
It is "the register is empty, and here is the denominator". Every handler below
leads with a `data_state` block naming the row count, the column and the screen
that would have to write it, and every one of them refuses to describe an empty
register as a clean one. A skill that returns "0 findings" because the table is
empty is a FALSE ALL-CLEAR on a statutory matter, which is the single worst
thing this shelf can do to a firm.

They all work unchanged the day somebody starts entering obligations. That is
tested: the fixtures carry rows, and the live runs carry none.

── EVERY DATE COMES FROM services/statute.py, OR IT IS NOT PRINTED ──────────

Not one due day, form number or section below is a literal. Each client
obligation is mapped to the statute-calendar key(s) it implies, and the date is
read AS OF THE DATE THE OBLIGATION AROSE — the period end — never as of today.
That is the distinction `services/statute.py` exists for: a Q4 FY 2025-26 TDS
statement prepared in May 2026 is a 24Q, not a 138.

Eight of the sixteen obligation keys map to NOTHING the calendar carries
(`gst.qrmp`, `gst.composition`, `gst.tds`, `gst.tcs`, `professional_tax`,
`audit.statutory`, `audit.tax`, `roc.annual`), and for those the output says the
calendar records no rule instead of printing a date from memory. The QRMP gap is
the sharpest one: the calendar holds the MONTHLY GSTR-1 and GSTR-3B rows only, so
a QRMP client — the register's whole reason for existing — cannot be dated yet.
Those keys are listed on the output as `statute_gaps` so a firm can see exactly
what is missing rather than wondering why a client has no dates.

── A STATUTORY DEADLINE DOES NOT MOVE BECAUSE YOUR OFFICE IS SHUT ───────────

Both dated handlers return TWO dates and never conflate them:

    statutory_due_on   what the law says. Never shifted, for anything.
    work_by            the last WORKING day on or before it, for the firm.

The shift is BACKWARDS, always. Moving a deadline forward onto the next working
day is a legal position (the General Clauses Act extends some, not all,
deadlines) and this product carries no rule that says which — so it would be a
guess printed next to a statute citation. Pulling the work earlier is a
scheduling fact about the firm and is safe in every case.

OPTIONAL HOLIDAYS ARE WORKING DAYS and are not shifted for. An optional holiday
is a day the office is open and an individual may take off; treating it as a
closure would move real work for no reason. Same rule as
`people_checks._closed_days`, restated because this file must not import another
handler's private helper.

── THE STATE CODES DO NOT AGREE WITH EACH OTHER, AND THAT IS LIVE ───────────

`staging.organisations.state_code` holds '27'. `staging.pay_professional_tax`
holds '27' and 'Maharashtra'. But migration 175's new columns —
`manav_holidays.state_code` and `client_obligations.state_code` — carry
CHECK (state_code ~ '^[A-Z]{2,3}$'), which REFUSES '27'. The two conventions
cannot be compared without a codelist, and there is no state table anywhere in
this database. `_norm_state` below is that codelist: it normalises '27', 'MH'
and 'Maharashtra' to one canonical numeric code so a comparison is possible
whichever convention a row was written in. The mismatch is reported, not hidden
— a firm that types 'MH' into a holiday and '27' into an obligation must not
silently get no match.

── Measured live, read-only, 2026-08-20, all three orgs ─────────────────────

  · `staging.client_obligations`: 0 rows, in every org. Nothing writes it. So
    all three handlers report `could_not_check` rather than a clean result, and
    `brief_client_obligations_register` returns an empty board with 61 and 30
    active clients sitting under "nothing recorded".
  · `staging.manav_holidays`: 38 rows — 25 in the E2E org, 13 in Unicode Group,
    NONE in Aekam Inc. Ten are optional. ZERO carry a state_code, so no
    regional distinction has ever been made and every holiday currently applies
    to every recipient.
  · `staging.graha_clients`: 61 in the E2E org (61 with a GSTIN), 30 in Unicode
    Group (26 with a GSTIN), 0 in Aekam Inc. The register's denominator is 91
    clients and its numerator is zero.
  · `staging.statute_calendar`: 45 rows. TWO keys this file needs are DEAD
    with no Income-tax Act 2025 successor — `tds.deposit.monthly` and all four
    `incometax.advance_tax.*` rows end 2026-04-01. So a client marked
    `incometax.tds` cannot be given a monthly deposit date after that, and an
    `incometax.advance` client cannot be given an instalment date at all. Both
    are REPORTED as gaps on the output; neither is silently omitted and neither
    is dated from memory.
  · The date engine, run read-only against the live calendar for a September
    2026 window: GSTR-1 for August 2026 due 2026-09-11, GSTR-3B due 2026-09-20,
    EPF ECR due 2026-09-15, ESI due 2026-09-15. For December 2026: GSTR-9C for
    FY 2025-26 due 2026-12-31. For December 2025: advance tax FY 2025-26 due
    2025-12-15. Eight obligation keys return no rule and say which.
  · The working-day shift, against the E2E org's real holidays: 11 September
    2026 (a Friday) stays put; 14 September moves to 11 September past Ganesh
    Chaturthi and the weekend; 20 September (a Sunday) moves to 18 September;
    2 October moves to 1 October past Gandhi Jayanti.
  · The send guard on the E2E org's 171 recipients: 74 resolve to a state and
    97 do not — and all 97 are SENDABLE. On Thursday 20 August all 171 are
    clear; on Saturday the 22nd, Sunday the 23rd, Ganesh Chaturthi (14
    September) and the org's own Founders Day (17 September) all 171 are held,
    each with a next sendable date. With `saturday_is_closed=False` the
    Saturday hold drops to zero.
  · Aekam Inc has no clients and no holidays, so #45 and #46 there return
    "could not check", never "clean". Its four CONTACTS are its only
    recipients: two resolve to a state, two do not, and all four are sendable.
"""
import logging
from datetime import date, timedelta

from services.statute import obligation, due_date_from
from services.skills.timeutil import as_date, days_between, utc_now

log = logging.getLogger(__name__)

#: The sixteen values `client_obligations_key_ck` allows, in the migration's own
#: order. Held here so a register can report the keys NOT used as well as the
#: ones that are — "no client is marked QRMP" and "QRMP is not a thing this
#: register knows about" are different sentences.
OBLIGATION_KEYS: tuple[str, ...] = (
    "gst.regular", "gst.qrmp", "gst.composition", "gst.tds", "gst.tcs",
    "incometax.tds", "incometax.tcs", "incometax.advance",
    "epf", "esi", "professional_tax",
    "audit.statutory", "audit.tax", "audit.gst", "roc.annual", "other",
)

#: What each obligation means in filing terms: the statute-calendar key and the
#: shape of its period. EVERY DATE COMES OUT OF THE CALENDAR — this map carries
#: no day, no month and no form number, only which key to ask.
#:
#: `audit.gst` -> `gst.return.gstr9c` is the one JUDGEMENT here and it is
#: printed on every row that uses it (`mapping_is_a_judgement`). A client marked
#: as being under GST audit is a client for whom the self-certified
#: reconciliation is the filing; if a firm means something else by the flag, the
#: output says so rather than being quietly wrong.
_FILINGS: dict[str, tuple[tuple[str, str], ...]] = {
    "gst.regular": (("gst.return.gstr1", "monthly"),
                    ("gst.return.gstr3b", "monthly")),
    "incometax.tds": (("tds.deposit.monthly", "monthly"),
                      ("tds.statement.nonsalary", "quarterly")),
    "incometax.tcs": (("tcs.statement", "quarterly"),),
    # "instalment", NOT "annual", and the difference is a wrong year on a
    # printed date. An annual filing falls due AFTER the year it reports on —
    # GSTR-9C for FY 2025-26 is 31 December 2026. An advance-tax instalment
    # falls due INSIDE the year it belongs to: 15 September 2026 is the second
    # instalment of FY 2026-27, not of FY 2025-26.
    #
    # It is also the difference between honouring the calendar and resurrecting
    # a dead rule. Anchoring these at a year END would ask the calendar as of
    # 31 March 2026, when the four advance-tax rows were still alive; they die
    # on 1 April 2026 with no Income-tax Act 2025 successor. Anchoring inside
    # the year asks as of 1 April 2026, gets nothing, and SAYS so — which is
    # what `gst_year.brief_advance_tax_reserve` already does and is the answer
    # this calendar must give too.
    "incometax.advance": (("incometax.advance_tax.q1", "instalment"),
                          ("incometax.advance_tax.q2", "instalment"),
                          ("incometax.advance_tax.q3", "instalment"),
                          ("incometax.advance_tax.q4", "instalment")),
    "epf": (("epf.remittance", "monthly"),),
    "esi": (("esi.remittance", "monthly"),),
    "audit.gst": (("gst.return.gstr9c", "annual"),),
}

#: The obligations the statute calendar cannot date, and WHY, in the words a CA
#: needs. Printed verbatim on the output. Never replaced by a guessed date.
_NO_CALENDAR_RULE: dict[str, str] = {
    "gst.qrmp":
        "The statute calendar holds only the MONTHLY GSTR-1 and GSTR-3B rows. A "
        "QRMP filer's quarterly GSTR-1, quarterly GSTR-3B and monthly PMT-06 "
        "each fall on a different day and not one of them is seeded, so no date "
        "is shown. This is the gap that matters most: dating a QRMP client is "
        "the reason the register exists.",
    "gst.composition":
        "The statute calendar holds no CMP-08 and no GSTR-4 row, so a "
        "composition dealer cannot be dated.",
    "gst.tds":
        "The statute calendar holds no GSTR-7 row (GST TDS, s.51).",
    "gst.tcs":
        "The statute calendar holds no GSTR-8 row (GST TCS, s.52).",
    "professional_tax":
        "Professional tax is a state levy and the statute calendar holds no row "
        "for any state. `public.pay_professional_tax` carries slabs for three "
        "states but no due date and no penalty, so nothing here can date it.",
    "audit.statutory":
        "The statute calendar holds no Companies Act audit row.",
    "audit.tax":
        "The statute calendar holds no tax-audit row, so the report date is not "
        "shown. The section was renumbered by the Income-tax Act 2025 and "
        "printing the old one would be worse than printing nothing.",
    "roc.annual":
        "The statute calendar holds no AOC-4 or MGT-7 row.",
    "other":
        "'other' is the register's escape hatch. It names an obligation the "
        "register does not model, so no filing can be derived from it — read "
        "the note on the row.",
}

#: What a person calls each obligation, for a picker. Held beside the keys and
#: the reasons rather than in the router, for the reason the note below this one
#: records at length: a second copy of a codelist in another module is a copy
#: that drifts, and the drift is silent.
#:
#: Deliberately plain. These are read by whoever ticks the box for a client, not
#: by a compliance specialist, and a label that repeats the key ("gst.regular")
#: teaches nothing.
OBLIGATION_LABELS: dict[str, str] = {
    "gst.regular":       "GST — regular filer",
    "gst.qrmp":          "GST — QRMP (quarterly)",
    "gst.composition":   "GST — composition",
    "gst.tds":           "GST TDS (GSTR-7)",
    "gst.tcs":           "GST TCS (GSTR-8)",
    "incometax.tds":     "Income-tax TDS",
    "incometax.tcs":     "Income-tax TCS",
    "incometax.advance": "Advance tax",
    "epf":               "EPF",
    "esi":               "ESI",
    "professional_tax":  "Professional tax",
    "audit.statutory":   "Statutory audit",
    "audit.tax":         "Tax audit",
    "audit.gst":         "GST audit (GSTR-9C)",
    "roc.annual":        "ROC annual filing",
    "other":             "Other",
}


def obligation_catalogue() -> list[dict]:
    """The sixteen obligations a client can be marked with, for a picker.

    Public because the obligations SCREEN needs exactly this list and must not
    carry its own copy. Three separate things would otherwise be duplicated into
    the frontend and drift apart from the database that enforces them: the keys
    (which `client_obligations_key_ck` refuses if wrong), the labels, and — the
    one that actually matters to a person filling the form — WHETHER A DATE CAN
    BE PRODUCED FROM THE OBLIGATION AT ALL.

    That last field is why this is a function and not a constant. Eight of the
    sixteen map to nothing the statute calendar carries, and QRMP is the
    sharpest: a firm can tick it, save it, and get a filing calendar with no
    dates on it. Saying so ON THE FORM turns that from a bug report into a
    known gap — and the day the calendar gains a CMP-08 row, this answer
    changes by itself because it is derived from `_NO_CALENDAR_RULE` rather
    than from a hand-kept list of what works.

    `sort_order` is the migration's own order, which groups GST, then income
    tax, then payroll, then audits. Alphabetical would interleave them.
    """
    return [
        {
            "key": key,
            "label": OBLIGATION_LABELS.get(key, key),
            "can_be_dated": key not in _NO_CALENDAR_RULE,
            "why_no_date": _NO_CALENDAR_RULE.get(key),
            "sort_order": i,
        }
        for i, key in enumerate(OBLIGATION_KEYS)
    ]


#: The GST codelist now lives in `services/gst_states.py`, public and owned.
#: It moved out of here on 2026-08-26 because FOUR production modules outside
#: this package had come to import `_GST_STATES`/`_norm_state` — routers/vetana,
#: routers/manav, routers/client_billing and attendance_auto_mark — and an
#: underscore is a promise the author can change a name freely. Rename it and
#: the tests in this package stay green while professional tax silently computes
#: zero for every employee, because the state stops matching a slab and the
#: fallback for "no slab" is 0.
#:
#: Re-exported under the old private names so nothing inside this file changed.
from services.gst_states import (  # noqa: E402
    GST_STATES as _GST_STATES,
    RETIRED_STATE_CODES,
    ALPHA_TO_NUM as _ALPHA_TO_NUM,
    NAME_TO_NUM as _NAME_TO_NUM,
    norm_state as _norm_state,
    state_view as _state_view,
)

#: How far a working-day shift will walk before giving up. Fourteen days is
#: longer than any run of closures this product can express, so hitting it means
#: the holiday table is wrong — and the handler says that rather than looping.
MAX_SHIFT_DAYS = 14


def _f(value, default=0.0) -> float:
    """Decimal | None -> float; asyncpg returns Decimal and it is not JSON."""
    return default if value is None else float(value)


def _as_day(value) -> date | None:
    """A date, a datetime, or 'YYYY-MM-DD', reduced to a calendar date.

    `timeutil.as_date` deliberately returns None for a string, which is right
    for a database column and wrong for a SKILL PARAMETER: the dispatcher hands
    a scheduled step's params through as JSON, so `as_at` arrives as text. A
    handler that quietly ignored it would run on today's date while telling the
    reader it ran on theirs.
    """
    day = as_date(value)
    if day is not None:
        return day
    if isinstance(value, str) and value.strip():
        try:
            parts = [int(p) for p in value.strip()[:10].split("-")]
            return date(parts[0], parts[1], parts[2])
        except (ValueError, IndexError):
            return None
    return None


def _month_end(year: int, month: int) -> date:
    nxt = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return nxt - timedelta(days=1)


def _month_bounds(month: str) -> tuple[date, date]:
    """'2026-08' -> (2026-08-01, 2026-08-31). Raises on anything else."""
    year, mon = (int(x) for x in str(month).split("-")[:2])
    if not 1 <= mon <= 12:
        raise ValueError(f"{month!r} is not a month")
    return date(year, mon, 1), _month_end(year, mon)


def _shift_months(day: date, n: int) -> date:
    """The first of the month *n* months from *day*'s month."""
    total = day.year * 12 + (day.month - 1) + n
    return date(total // 12, total % 12 + 1, 1)


def _quarter_end_on_or_before(day: date) -> date:
    """The end of the last Indian tax quarter to have closed on or before *day*.

    Quarters run April-June, July-September, October-December, January-March —
    NOT calendar quarters, and a TDS statement filed against the wrong one is a
    statement TRACES rejects.
    """
    for months_back in range(0, 15):
        cursor = _shift_months(date(day.year, day.month, 1), -months_back)
        if cursor.month in (3, 6, 9, 12):
            end = _month_end(cursor.year, cursor.month)
            if end <= day:
                return end
    return _month_end(day.year - 1, 3)


#: THE RESOLVER LIVES IN `services.statute` AND IS IMPORTED, NOT RESTATED.
#: This file carried a byte-identical copy of it until 2026-09-02, which meant
#: the GSTR-9-nine-months-early fix had to be made in two places and the
#: quarterly-TDS fix would have had to be made in two more. One implementation,
#: in the module that owns the table it reads.
_due_date_from = due_date_from


def _statute_note(row: dict | None, what: str) -> str:
    """One sentence naming the authority for a printed date, or naming its
    absence. Every date these handlers print is attributable, or it is not
    printed."""
    if not row:
        return f"The statute calendar records no {what}, so none is shown."
    bits = [b for b in (row.get("form_number"), row.get("section_ref")) if b]
    cite = " · ".join(bits) if bits else (row.get("statute") or "")
    return f"{row.get('title') or what}{f' ({cite})' if cite else ''}"


# ── state codes: see `services/gst_states.py`, imported at the top ──


def _state_from_gstin(gstin) -> str | None:
    """The first two digits of a GSTIN are its state code. That is the whole
    derivation, and it is why #53 needs no new column.

    IT IS NEVER MANDATORY. A recipient with no GSTIN, a blank GSTIN or a
    malformed one returns None and is treated as sendable everywhere. GSTIN
    blocks nothing in this product and it does not start blocking here.
    """
    if not gstin:
        return None
    text = str(gstin).strip()
    return _norm_state(text[:2]) if len(text) >= 2 else None


# ── the firm's working calendar ──────────────────────────────────────────────

async def _holidays(pool, org_id: str, start: date, end: date) -> dict:
    """Every holiday row in a window, with the denominators that make it
    readable.

    Returns the rows AND the counts, because the counts are the finding. "No
    holiday moved this date" and "this firm has recorded no holidays" are
    different answers and the caller must be able to tell them apart.
    """
    rows = await pool.fetch(
        """
        SELECT h.date, h.name, h.state_code,
               COALESCE(h.is_optional, FALSE) AS is_optional
        FROM public.manav_holidays h
        WHERE h.org_id = $1::uuid
          AND h.date >= $2::date
          AND h.date <= $3::date
        ORDER BY h.date
        """,
        org_id, start, end,
    )
    closures: dict[date, list[dict]] = {}
    optional = 0
    with_state = 0
    unreadable_state = 0
    for r in rows:
        day = as_date(r["date"])
        if day is None:
            continue
        if r["is_optional"]:
            optional += 1
            continue
        raw = r["state_code"]
        if raw:
            with_state += 1
            norm = _norm_state(raw)
            if norm is None:
                unreadable_state += 1
        else:
            norm = None
        closures.setdefault(day, []).append(
            {"name": r["name"], "state_code": norm, "state_as_written": raw})
    return {
        "closures": closures,
        "rows_in_window": len(rows),
        "optional_ignored": optional,
        "carrying_a_state": with_state,
        "state_unreadable": unreadable_state,
    }


def _closure_on(day: date, holidays: dict, state: str | None) -> dict | None:
    """The holiday that closes *day* for somebody in *state*, or None.

    A holiday with NO state applies everywhere — migration 175 says that is the
    correct reading of the 38 rows that predate the column, and it is also the
    only safe one: treating an untagged holiday as "nowhere" would make the
    guard stop guarding the moment the column shipped.

    A holiday WITH a state applies only there. A recipient whose state is
    unknown therefore matches the everywhere-holidays and no others — it is
    never suppressed FOR being unknown.
    """
    for entry in holidays.get("closures", {}).get(day, ()):
        if entry["state_code"] is None or entry["state_code"] == state:
            return entry
    return None


def _why_closed(day: date, holidays: dict, state: str | None,
                saturday_off: bool = True) -> str | None:
    """Why *day* is not a working day, or None if it is one.

    Saturday is a PRODUCT ASSUMPTION, not a statutory fact, and it is a
    parameter for that reason. Sunday is not negotiable. `people_checks` uses
    the same weekend convention for attendance, so a firm reading two skills
    sees one idea of a weekend.
    """
    if day.weekday() == 6:
        return "Sunday"
    if saturday_off and day.weekday() == 5:
        return "Saturday"
    closure = _closure_on(day, holidays, state)
    return closure["name"] if closure else None


def _work_by(due: date, holidays: dict, state: str | None,
             saturday_off: bool = True) -> tuple[date, list[str], bool]:
    """The last working day on or before *due*.

    BACKWARDS, always. A statutory deadline is not extended because an office is
    shut, and whether the General Clauses Act moves a particular one forward is
    a legal question this product holds no rule for. Pulling the work earlier is
    a scheduling fact and is safe every time.
    """
    day, skipped = due, []
    for _ in range(MAX_SHIFT_DAYS):
        why = _why_closed(day, holidays, state, saturday_off)
        if why is None:
            return day, skipped, False
        skipped.append(f"{day.isoformat()} — {why}")
        day -= timedelta(days=1)
    return due, skipped, True


def _next_open(day: date, holidays: dict, state: str | None,
               saturday_off: bool = True) -> tuple[date | None, list[str]]:
    """The first working day on or after *day*, for a send that must wait."""
    cursor, skipped = day, []
    for _ in range(MAX_SHIFT_DAYS):
        why = _why_closed(cursor, holidays, state, saturday_off)
        if why is None:
            return cursor, skipped
        skipped.append(f"{cursor.isoformat()} — {why}")
        cursor += timedelta(days=1)
    return None, skipped


# ── statute lookups, asked once ──────────────────────────────────────────────

async def _cached_obligation(pool, cache: dict, key: str, as_of: date):
    """`obligation()` memoised on (key, as_of) for ONE handler run.

    A calendar over 91 clients asks for the same GSTR-1 row ninety-one times.
    The cache is per-run and local: nothing here survives the call, so a
    calendar seeded mid-run cannot serve a stale fact to the next request.
    """
    slot = (key, as_of)
    if slot not in cache:
        cache[slot] = await obligation(pool, key, as_of=as_of)
    return cache[slot]


def _filing(statute_key: str, row: dict | None, due: date | None,
            as_of: date, period_label: str, obligation_key: str) -> dict:
    """One filing, with the date the statutory fact was RESOLVED AS OF on it.

    `resolved_as_of` is printed because it is the whole argument of
    `services/statute.py`: a form number is only true relative to a date, and a
    reader who cannot see which date was used cannot check the answer. Form 24Q
    became 138 on 1 April 2026, so the same quarter resolved a day apart gives
    two different forms and both are right.
    """
    if due is not None:
        why_no_date = None
    elif row is None:
        why_no_date = (
            f"The statute calendar carries NO VERSION of {statute_key} in force "
            f"on {as_of}, so no date and no form are shown. This is a gap in "
            f"the calendar, not a filing that does not exist.")
    else:
        why_no_date = (
            f"The statute calendar carries {statute_key} but no due day for it "
            f"as of {as_of}, so no date is shown. The FORM is named so a "
            f"preparer can see the filing exists.")
    return {
        "obligation_key": obligation_key,
        "statute_key": statute_key,
        "form": (row or {}).get("form_number"),
        "filing": (row or {}).get("title") or statute_key,
        "statute": _statute_note(row, f"rule for {statute_key}"),
        "period": period_label,
        "resolved_as_of": as_of,
        "statutory_due_on": due,
        "date_unavailable_because": why_no_date,
        "mapping_is_a_judgement": obligation_key == "audit.gst",
    }


def _fy_label(fy_start_year: int) -> str:
    return f"FY {fy_start_year}-{str(fy_start_year + 1)[-2:]}"


def _fy_starts_touching(win_start: date, win_end: date) -> list[date]:
    """The 1-April dates of every financial year the window overlaps."""
    first = win_start.year if win_start.month >= 4 else win_start.year - 1
    last = win_end.year if win_end.month >= 4 else win_end.year - 1
    return [date(y, 4, 1) for y in range(first, last + 1)]


async def _filings_in_window(pool, cache: dict, obligation_key: str,
                             win_start: date, win_end: date) -> list[dict]:
    """Every statutory filing an obligation implies that falls due in a window.

    The date always comes from the calendar row resolved AS OF THE DATE THE
    OBLIGATION AROSE — the period end for a return, the first day of the year
    for an advance-tax instalment — never as of today.

    ── A FILING THAT CANNOT BE DATED IS STILL REPORTED ───────────────────────

    Found by running this against the live calendar: `tds.deposit.monthly` ends
    1 April 2026 with no Income-tax Act 2025 successor, so every lookup after
    that date returns nothing. The first version of this function simply emitted
    NOTHING for it, and a client marked `incometax.tds` therefore saw the
    quarterly statement and no monthly deposit at all — which reads as "there is
    nothing to deposit". A silent omission is the worst possible failure for a
    compliance calendar, so a key that resolves to no rule now produces ONE row
    saying exactly that.
    """
    out: list[dict] = []
    for statute_key, cadence in _FILINGS.get(obligation_key, ()):

        if cadence == "monthly":
            # Walk candidate PERIODS and keep the ones whose due date lands in
            # the window. Driven from the period rather than from the due month
            # because the OFFSET lives on the calendar row, which cannot be read
            # until a period end has been chosen.
            saw_row = saw_day = False
            last_row, last_as_of = None, _month_end(win_end.year, win_end.month)
            cursor = _shift_months(win_start, -4)
            while cursor <= win_end:
                period_end = _month_end(cursor.year, cursor.month)
                row = await _cached_obligation(pool, cache, statute_key, period_end)
                last_row, last_as_of = row, period_end
                saw_row = saw_row or row is not None
                due = _due_date_from(row, period_end)
                saw_day = saw_day or due is not None
                if due is not None and win_start <= due <= win_end:
                    out.append(_filing(statute_key, row, due, period_end,
                                       f"{period_end:%B %Y}", obligation_key))
                cursor = _shift_months(cursor, 1)
            if not saw_row or not saw_day:
                out.append(_filing(statute_key, last_row, None, last_as_of,
                                   "monthly", obligation_key))

        elif cadence == "instalment":
            # Due INSIDE the year it belongs to. Anchored at 1 April so the
            # calendar is asked as of a date in that year — see the comment on
            # `_FILINGS["incometax.advance"]`.
            for fy_start in _fy_starts_touching(win_start, win_end):
                row = await _cached_obligation(pool, cache, statute_key, fy_start)
                due = _due_date_from(row, fy_start)
                label = _fy_label(fy_start.year)
                if due is not None and win_start <= due <= win_end:
                    out.append(_filing(statute_key, row, due, fy_start,
                                       label, obligation_key))
                elif row is None:
                    out.append(_filing(statute_key, None, None, fy_start,
                                       label, obligation_key))

        elif cadence == "annual":
            # Due AFTER the year it reports on. GSTR-9C for FY 2025-26 is
            # 31 December 2026.
            saw_row = False
            last_row, last_as_of = None, date(win_end.year, 3, 31)
            for year in range(win_start.year - 1, win_end.year + 2):
                period_end = date(year, 3, 31)
                row = await _cached_obligation(pool, cache, statute_key, period_end)
                if row is not None:
                    saw_row, last_row, last_as_of = True, row, period_end
                due = _due_date_from(row, period_end)
                if due is not None and win_start <= due <= win_end:
                    out.append(_filing(statute_key, row, due, period_end,
                                       _fy_label(year - 1), obligation_key))
            if not saw_row:
                out.append(_filing(statute_key, last_row, None, last_as_of,
                                   "annual", obligation_key))

        else:  # quarterly
            period_end = _quarter_end_on_or_before(win_start)
            row = await _cached_obligation(pool, cache, statute_key, period_end)
            due = _due_date_from(row, period_end)
            if due is None:
                # The calendar carries the FORM but no day for any quarterly
                # statement. Naming the form with no date beats omitting the
                # filing: a preparer who cannot see 26Q at all will assume there
                # is nothing to file.
                out.append(_filing(statute_key, row, None, period_end,
                                   f"quarter ended {period_end}", obligation_key))
            elif win_start <= due <= win_end:
                out.append(_filing(statute_key, row, due, period_end,
                                   f"quarter ended {period_end}", obligation_key))
    return out


def _statute_gaps(keys_in_use) -> list[dict]:
    """The obligations present in this firm's register that nothing can date."""
    return [
        {"obligation_key": key, "why_no_date": _NO_CALENDAR_RULE[key]}
        for key in OBLIGATION_KEYS
        if key in keys_in_use and key in _NO_CALENDAR_RULE
    ]


async def _owner_names(pool, org_id: str, user_ids) -> dict[str, str]:
    """user_id -> name, for members OF THIS FIRM only.

    Joined through `staging.user_roles` rather than reading `public.users`
    directly, for two reasons: it keeps the org filter on a query that would
    otherwise have none, and an owner_user_id that is not a member of this firm
    then comes back UNRESOLVED, which is itself a finding — a filing owned by
    somebody who has left is a filing with no owner.

    Names only. `public.users.email` is not read: Aekam must not see a client
    firm's addresses, and this handler has no reason to.
    """
    wanted = sorted({u for u in user_ids if u})
    if not wanted:
        return {}
    rows = await pool.fetch(
        """
        SELECT ur.user_id,
               COALESCE(NULLIF(btrim(u.name), ''),
                        NULLIF(btrim(u.full_name), ''),
                        '(name not recorded)') AS owner_name
        FROM public.user_roles ur
        JOIN public.users u ON u.user_id = ur.user_id
        WHERE ur.org_id = $1::uuid
          AND ur.user_id = ANY($2::text[])
        """,
        org_id, wanted,
    )
    return {r["user_id"]: r["owner_name"] for r in rows}


#: A LEFT JOIN, not an INNER one, on purpose. An INNER join would make a row
#: whose client belongs to another practice VANISH — a silent drop from a
#: statutory register. The LEFT join keeps it and counts it, so the defect is
#: visible instead of tidied away.
_REGISTER_SQL = """
    SELECT co.id, co.client_id, co.obligation_key, co.state_code,
           co.owner_user_id, co.registration_no, co.effective_from,
           co.effective_to, co.notes,
           c.id AS matched_client_id,
           COALESCE(NULLIF(btrim(c.name), ''), '(client not recorded)') AS client_name,
           c.gstin AS client_gstin,
           COALESCE(c.is_active, TRUE) AS client_is_active,
           COALESCE(c.address->>'state_code', c.address->>'state') AS client_address_state
    FROM public.client_obligations co
    -- THE ORG PREDICATE ON THIS JOIN IS LOAD-BEARING. Migration 175 says so in
    -- its own comment: the FK points at graha_clients(id) ALONE, there is no
    -- UNIQUE (id, org_id) for a composite key to point at, and an id-only join
    -- has already been proved live to print another practice's client name.
    LEFT JOIN public.graha_clients c
           ON c.id = co.client_id
          AND c.org_id = co.org_id
    WHERE co.org_id = $1::uuid
      AND co.effective_from <= $2::date
      AND (co.effective_to IS NULL OR co.effective_to > $2::date)
    ORDER BY client_name, co.obligation_key
    LIMIT $3::int
"""

_REGISTER_TOTALS_SQL = """
    SELECT count(*) AS live_rows,
           count(*) FILTER (WHERE c.id IS NULL) AS rows_with_no_client_in_this_firm,
           count(DISTINCT co.client_id) AS clients_named,
           count(*) FILTER (WHERE co.owner_user_id IS NULL) AS rows_with_no_owner
    FROM public.client_obligations co
    LEFT JOIN public.graha_clients c
           ON c.id = co.client_id
          AND c.org_id = co.org_id
    WHERE co.org_id = $1::uuid
      AND co.effective_from <= $2::date
      AND (co.effective_to IS NULL OR co.effective_to > $2::date)
"""

_CLIENT_BOOK_SQL = """
    SELECT count(*) AS clients,
           count(*) FILTER (WHERE COALESCE(is_active, TRUE)) AS active
    FROM public.graha_clients
    WHERE org_id = $1::uuid
"""


def _register_data_state(totals, clients_total: int, clients_active: int,
                         as_at: date) -> dict:
    """The block that stops an empty table reading as a clean one.

    This is the whole point of the file. `staging.client_obligations` is a table
    with no write path: no screen creates a row, no import does, nothing seeds
    one. So `no_findings` is FALSE and `could_not_check` is TRUE while it is
    empty, and those two keys are separate for exactly that reason.
    """
    live = int((totals or {})["live_rows"] or 0) if totals is not None else 0
    named = int((totals or {})["clients_named"] or 0) if totals is not None else 0
    return {
        "obligation_rows_live": live,
        "clients_with_an_obligation_recorded": named,
        "clients_on_the_books": clients_total,
        "active_clients_on_the_books": clients_active,
        "coverage": (
            f"{named} of {clients_active} active clients have any obligation "
            f"recorded as at {as_at}."),
        "could_not_check": live == 0,
        "no_findings": False if live == 0 else None,
        "why_empty": None if live else (
            "public.client_obligations was created by migration 175 and holds "
            "NO ROWS. Nothing in the product writes it — there is no "
            "obligations screen, no import and no seed. Until one exists this "
            "register is empty, and an empty register MUST NOT be read as a "
            "firm with no statutory obligations."),
        "column_that_needs_writing": "public.client_obligations (the whole table)",
        "screen_that_would_write_it": (
            "A per-client Obligations tab on the Graha client record — one row "
            "per obligation with a validity window, an owner and a "
            "registration number. It does not exist."),
    }


# ══════════════════════════════════════════════════════════════════════════
# 45 · brief_client_obligations_register
# ══════════════════════════════════════════════════════════════════════════

async def brief_client_obligations_register(
    pool, org_id: str, as_at: str | None = None, horizon_days: int = 7,
    limit: int = 200,
) -> dict:
    """Who is monthly, who is QRMP, who deducts TDS, who is under audit — and
    the filing board for the coming week built from it.

    *as_at* is the date the register is read AS OF ('YYYY-MM-DD'), because an
    obligation has a validity window and "who was QRMP in October" is a real
    question. It defaults to today. *horizon_days* is how far the board looks
    ahead; a filing week is seven days and that is the default.

    ── WHAT THIS RETURNS TODAY, AND WHY THAT IS THE ANSWER ───────────────────

    The register is EMPTY in every live org. The table exists and nothing writes
    it. So this returns a `data_state` block naming the row count, the missing
    write path and the screen that would supply it, with `could_not_check` true
    and `no_findings` explicitly FALSE. A firm whose register is empty is not a
    firm with no obligations; it is a firm nobody has told.

    ── THE BOARD SHOWS THE STATUTORY DATE, UNSHIFTED ─────────────────────────

    Dates on the board are what the law says, not what the office can manage.
    The working-day shift belongs to `pack_client_filing_calendar`, which reads
    the holiday table and therefore needs the Manav grant; forcing that grant
    onto the register would lock a firm out of its own client list for want of
    an HR module. Every board row says so.

    ── AND IT SHOWS WHAT IT CANNOT DATE ──────────────────────────────────────

    Eight of the sixteen obligation keys map to no statute-calendar row at all,
    QRMP among them. Those clients appear in the register with their obligation
    and NO date, and the reason is printed in `statute_gaps`. A board that
    silently omitted them would tell a firm its QRMP clients have nothing due.
    """
    today = _as_day(as_at) or utc_now().date()
    cap = max(1, int(limit))
    horizon = max(1, int(horizon_days))
    win_end = today + timedelta(days=horizon)

    rows = await pool.fetch(_REGISTER_SQL, org_id, today, cap)
    totals = await pool.fetchrow(_REGISTER_TOTALS_SQL, org_id, today)
    book = await pool.fetchrow(_CLIENT_BOOK_SQL, org_id)
    clients_total = int((book or {})["clients"] or 0) if book else 0
    clients_active = int((book or {})["active"] or 0) if book else 0

    owners = await _owner_names(pool, org_id, [r["owner_user_id"] for r in rows])

    register: list[dict] = []
    by_obligation: dict[str, int] = {}
    keys_in_use: set[str] = set()
    orphans = 0
    unknown_owner = 0
    for r in rows:
        key = r["obligation_key"]
        keys_in_use.add(key)
        by_obligation[key] = by_obligation.get(key, 0) + 1
        matched = r["matched_client_id"] is not None
        if not matched:
            orphans += 1
        owner_id = r["owner_user_id"]
        owner_name = owners.get(owner_id) if owner_id else None
        if owner_id and owner_name is None:
            unknown_owner += 1
        from_gstin = _state_from_gstin(r["client_gstin"]) if matched else None
        state = (_norm_state(r["state_code"]) or from_gstin
                 or (_norm_state(r["client_address_state"]) if matched else None))
        register.append({
            "obligation_id": str(r["id"]),
            "client_row_handle": str(r["client_id"]),
            # The NAME is withheld when the client is not this firm's: printing
            # it would be printing another practice's client.
            "client": (r["client_name"] if matched else
                       "(this row names a client that is not on this firm's books)"),
            "client_is_on_the_books": matched,
            "client_is_active": bool(r["client_is_active"]) if matched else None,
            "obligation": key,
            "registration_no": r["registration_no"],
            "registration_is_optional": True,
            "owner": owner_name or ("(nobody is named)" if not owner_id
                                    else "(the named owner is not a member of this firm)"),
            "effective_from": as_date(r["effective_from"]),
            "effective_to": as_date(r["effective_to"]),
            "is_open_ended": r["effective_to"] is None,
            "notes": r["notes"],
            **_state_view(state),
            "state_was_derived_from": (
                None if r["state_code"] else
                ("the client's GSTIN" if from_gstin
                 else ("the client's address" if state else None))),
            "can_be_dated": key in _FILINGS,
        })

    # The board: every filing the register implies inside the horizon.
    cache: dict = {}
    board: list[dict] = []
    for key in sorted(keys_in_use):
        on_key = [e for e in register if e["obligation"] == key]
        for filing in await _filings_in_window(pool, cache, key, today, win_end):
            board.append({
                **filing,
                "clients": len(on_key),
                "owners": sorted({e["owner"] for e in on_key}),
                "date_is_statutory_and_unshifted": True,
                "working_day_shift": (
                    "Not applied here. Run pack_client_filing_calendar for the "
                    "last working day on or before this date."),
            })
    board.sort(key=lambda b: (b["statutory_due_on"] or date.max, b["filing"]))

    unplaced = await pool.fetch(
        """
        SELECT c.id, COALESCE(NULLIF(btrim(c.name), ''), '(name not recorded)') AS name,
               c.gstin
        FROM public.graha_clients c
        WHERE c.org_id = $1::uuid
          AND COALESCE(c.is_active, TRUE)
          AND NOT EXISTS (
              SELECT 1 FROM public.client_obligations co
               WHERE co.client_id = c.id
                 AND co.org_id = c.org_id
                 AND co.effective_from <= $2::date
                 AND (co.effective_to IS NULL OR co.effective_to > $2::date))
        ORDER BY name
        LIMIT $3::int
        """,
        org_id, today, cap,
    )

    data_state = _register_data_state(totals, clients_total, clients_active, today)
    live_rows = int((totals or {})["live_rows"] or 0) if totals is not None else 0

    limitations = [
        data_state["why_empty"] or (
            f"{live_rows} obligation row(s) are live. Anything not entered is "
            f"invisible to this register — an absence here is an absence of "
            f"DATA, never evidence that a client has no obligation."),
        "Eight of the sixteen obligation keys cannot be dated at all: the "
        "statute calendar carries no rule for QRMP, composition, GST TDS, GST "
        "TCS, professional tax, statutory audit, tax audit or ROC annual "
        "filing. Those clients appear in the register with no date and the "
        "reason beside them — see `statute_gaps`.",
        "Dates on the board are STATUTORY dates and are not shifted for "
        "weekends or holidays. A due date does not move because an office is "
        "shut.",
        "GSTIN, PAN and TAN are not required by this register and block "
        "nothing. `registration_no` is free to be empty and an empty one is "
        "not a finding.",
    ]
    if orphans:
        limitations.append(
            f"{orphans} obligation row(s) name a client that is not on this "
            f"firm's books. The foreign key is on the client id alone, so such "
            f"a row can exist; it is shown rather than dropped, and its client "
            f"NAME is withheld because it would be another practice's.")
    if unknown_owner:
        limitations.append(
            f"{unknown_owner} obligation row(s) name an owner who is not a "
            f"member of this firm — a filing with no reachable owner.")
    if len(rows) >= cap:
        limitations.append(
            f"The register was capped at {cap} rows; {max(0, live_rows - cap)} "
            f"live row(s) were not shown, and the board was built only from "
            f"the rows that were.")
    if not board and keys_in_use:
        limitations.append(
            f"No filing falls due in the next {horizon} day(s) for the "
            f"obligations recorded. That is a statement about this window "
            f"only, not about the year.")

    return {
        "as_at": today,
        "horizon_days": horizon,
        "board_window_to": win_end,
        "data_state": data_state,
        "counts": {
            "obligation_rows_live": live_rows,
            "obligation_rows_shown": len(rows),
            "clients_with_an_obligation": (
                int((totals or {})["clients_named"] or 0) if totals is not None else 0),
            "clients_on_the_books": clients_total,
            "active_clients_on_the_books": clients_active,
            "active_clients_with_nothing_recorded": len(unplaced),
            "rows_naming_a_client_outside_this_firm": orphans,
            "rows_with_no_owner": (
                int((totals or {})["rows_with_no_owner"] or 0) if totals is not None else 0),
            "rows_whose_owner_is_not_a_member": unknown_owner,
            "filings_on_the_board": len(board),
            "obligation_keys_in_use": len(keys_in_use),
            "obligation_keys_that_cannot_be_dated": len(_statute_gaps(keys_in_use)),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "by_obligation": [
            {"obligation": key, "clients": by_obligation[key],
             "can_be_dated": key in _FILINGS}
            for key in OBLIGATION_KEYS if key in by_obligation
        ],
        "register": register,
        "filing_board": board,
        "statute_gaps": _statute_gaps(keys_in_use),
        "active_clients_with_nothing_recorded": [
            {"client_row_handle": str(r["id"]), "client": r["name"],
             "has_a_gstin": bool((r["gstin"] or "").strip())}
            for r in unplaced
        ],
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 46 · pack_client_filing_calendar
# ══════════════════════════════════════════════════════════════════════════

async def pack_client_filing_calendar(
    pool, org_id: str, month: str | None = None,
    saturday_is_closed: bool = True, limit: int = 200,
) -> dict:
    """Each client's filings for a month, dated from their own registration
    facts, with the last working day on or before each one and a named owner.

    *month* is 'YYYY-MM' and defaults to the month you are IN, because a filing
    calendar is a thing you work from. (The GST readiness skills default to the
    previous month for the opposite and equally correct reason: a return is
    filed FOR the month you have left.)

    ── TWO DATES, NEVER ONE ──────────────────────────────────────────────────

        statutory_due_on   what the law says. Never shifted, for anything.
        work_by            the last working day on or before it, for this firm.

    The shift is BACKWARDS. Whether a deadline falling on a holiday is extended
    to the next working day is a legal question — the General Clauses Act
    extends some and not others — and this product carries no rule that says
    which. Guessing forward would put a wrong date next to a statute citation.
    Pulling the work earlier is a scheduling fact about the office and is safe.

    ── WHICH HOLIDAYS COUNT ──────────────────────────────────────────────────

    The firm's own `staging.manav_holidays`, non-optional only. An optional
    holiday is a working day: the office is open and an individual may take it,
    so shifting for one moves real work for no reason.

    A holiday with NO state applies everywhere — migration 175's reading of the
    38 rows that predate the column, and the only safe one. A holiday tagged
    with a state applies to obligations administered in that state, which is
    what makes a Maharashtra professional-tax date shiftable for a Maharashtra
    holiday. MEASURED 2026-08-20: not one of the 38 rows carries a state, so no
    regional distinction has ever been made, and the output says so.

    ── AND IT WILL BE EMPTY ──────────────────────────────────────────────────

    Because `staging.client_obligations` has no write path. `data_state` names
    the row count and the missing screen; `could_not_check` is true while the
    register is empty and `no_findings` is false, deliberately.
    """
    today = utc_now().date()
    wanted = month or f"{today.year:04d}-{today.month:02d}"
    try:
        win_start, win_end = _month_bounds(wanted)
        month = wanted
    except (ValueError, TypeError, IndexError):
        month = f"{today.year:04d}-{today.month:02d}"
        win_start, win_end = _month_bounds(month)
    cap = max(1, int(limit))
    sat_off = bool(saturday_is_closed)

    rows = await pool.fetch(_REGISTER_SQL, org_id, win_start, cap)
    totals = await pool.fetchrow(_REGISTER_TOTALS_SQL, org_id, win_start)
    book = await pool.fetchrow(_CLIENT_BOOK_SQL, org_id)
    owners = await _owner_names(pool, org_id, [r["owner_user_id"] for r in rows])

    # A shift may walk back out of the month, so the holiday window is widened.
    holidays = await _holidays(pool, org_id,
                               win_start - timedelta(days=MAX_SHIFT_DAYS + 1),
                               win_end + timedelta(days=1))

    cache: dict = {}
    entries: list[dict] = []
    undatable: list[dict] = []
    keys_in_use: set[str] = set()
    shifted = 0
    ran_out = 0

    for r in rows:
        key = r["obligation_key"]
        keys_in_use.add(key)
        matched = r["matched_client_id"] is not None
        client = (r["client_name"] if matched
                  else "(this row names a client that is not on this firm's books)")
        owner_id = r["owner_user_id"]
        owner = (owners.get(owner_id) if owner_id else None) or (
            "(nobody is named)" if not owner_id
            else "(the named owner is not a member of this firm)")
        state = (_norm_state(r["state_code"])
                 or (_state_from_gstin(r["client_gstin"]) if matched else None)
                 or (_norm_state(r["client_address_state"]) if matched else None))

        if key not in _FILINGS:
            undatable.append({
                "client_row_handle": str(r["client_id"]),
                "client": client,
                "obligation": key,
                "owner": owner,
                "why_no_date": _NO_CALENDAR_RULE.get(
                    key, "No statute-calendar rule is mapped to this obligation."),
                **_state_view(state),
            })
            continue

        for filing in await _filings_in_window(pool, cache, key, win_start, win_end):
            due = filing["statutory_due_on"]
            common = {
                **filing,
                "client_row_handle": str(r["client_id"]),
                "client": client,
                "owner": owner,
                **_state_view(state),
            }
            if due is None:
                entries.append({**common, "work_by": None,
                                "work_by_is_earlier_than_due": None,
                                "days_from_today": None,
                                "non_working_days_skipped": []})
                continue
            work_by, skipped, exhausted = _work_by(due, holidays, state, sat_off)
            if skipped:
                shifted += 1
            if exhausted:
                ran_out += 1
            entries.append({
                **common,
                "work_by": work_by,
                "work_by_is_earlier_than_due": work_by < due,
                "days_from_today": days_between(due, today),
                "non_working_days_skipped": skipped,
            })

    entries.sort(key=lambda e: (e["statutory_due_on"] or date.max,
                                e["client"], e["filing"]))

    clients_total = int((book or {})["clients"] or 0) if book else 0
    clients_active = int((book or {})["active"] or 0) if book else 0
    data_state = _register_data_state(totals, clients_total, clients_active,
                                      win_start)
    live_rows = int((totals or {})["live_rows"] or 0) if totals is not None else 0

    limitations = [
        data_state["why_empty"] or (
            f"Only the {live_rows} obligation row(s) recorded for this firm "
            f"were dated. A client with no row produces no filing, and that is "
            f"an absence of data, not an absence of obligation."),
        "`statutory_due_on` is never shifted. `work_by` is the last WORKING day "
        "on or before it — the shift is BACKWARDS, because whether a deadline "
        "falling on a closure is extended forward is a legal question this "
        "product holds no rule for.",
        "Optional holidays are treated as WORKING days and are not shifted for.",
    ]
    if holidays["rows_in_window"] == 0:
        limitations.append(
            "This firm has recorded NO holidays anywhere near this month, so "
            "only weekends were shifted for. A public holiday nobody entered "
            "cannot be seen — this is not a claim that the office was open.")
    else:
        limitations.append(
            f"{holidays['carrying_a_state']} of {holidays['rows_in_window']} "
            f"holiday row(s) near this month carry a state_code; the rest are "
            f"treated as applying everywhere, which is migration 175's reading "
            f"of the rows that predate the column. A state-specific holiday "
            f"nobody has tagged will shift EVERY client's date, not just that "
            f"state's.")
        if holidays["optional_ignored"]:
            limitations.append(
                f"{holidays['optional_ignored']} optional holiday row(s) near "
                f"this month were ignored as working days.")
    if holidays["state_unreadable"]:
        limitations.append(
            f"{holidays['state_unreadable']} holiday row(s) carry a state_code "
            f"this codelist does not recognise, so they were treated as "
            f"applying everywhere rather than being dropped.")
    if undatable:
        limitations.append(
            f"{len(undatable)} obligation row(s) could not be dated at all "
            f"because the statute calendar carries no rule for them. They are "
            f"listed in `cannot_be_dated` WITH the reason, not omitted.")
    if ran_out:
        limitations.append(
            f"{ran_out} date(s) hit {MAX_SHIFT_DAYS} consecutive non-working "
            f"days and were left on the statutory date. That is a defect in "
            f"the holiday table, not a real closure.")
    if len(rows) >= cap:
        limitations.append(
            f"Capped at {cap} obligation rows; {max(0, live_rows - cap)} were "
            f"not dated.")

    return {
        "as_at": today,
        "month": month,
        "month_from": win_start,
        "month_to": win_end,
        "saturday_treated_as_closed": sat_off,
        "data_state": data_state,
        "counts": {
            "obligation_rows_live": live_rows,
            "obligation_rows_read": len(rows),
            "filings_in_the_month": len(entries),
            "filings_with_no_statutory_date": sum(
                1 for e in entries if e["statutory_due_on"] is None),
            "filings_pulled_earlier_by_a_closure": shifted,
            "obligations_that_cannot_be_dated": len(undatable),
            "filings_with_no_named_owner": sum(
                1 for e in entries if e["owner"].startswith("(")),
            "holiday_rows_near_this_month": holidays["rows_in_window"],
            "holiday_rows_carrying_a_state": holidays["carrying_a_state"],
            "optional_holidays_ignored": holidays["optional_ignored"],
            "clients_on_the_books": clients_total,
            "active_clients_on_the_books": clients_active,
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "calendar": entries,
        "cannot_be_dated": undatable,
        "statute_gaps": _statute_gaps(keys_in_use),
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 53 · check_regional_send_guard
# ══════════════════════════════════════════════════════════════════════════

_RECIPIENTS_SQL = """
    SELECT c.id AS row_handle, 'client' AS kind,
           COALESCE(NULLIF(btrim(c.name), ''), '(name not recorded)') AS recipient,
           c.gstin,
           COALESCE(c.address->>'state_code', c.address->>'state') AS address_state
    FROM public.graha_clients c
    WHERE c.org_id = $1::uuid
      AND COALESCE(c.is_active, TRUE)
    UNION ALL
    -- Contacts appear ONLY when they are not attached to a client, so nobody is
    -- counted twice: a CRM client is the company, and the company is the
    -- recipient wherever there is one. A firm that works contact-first — Aekam
    -- Inc does, with five invoices and no client rows — is still covered.
    SELECT ct.id, 'contact',
           COALESCE(NULLIF(btrim(ct.company), ''),
                    NULLIF(btrim(ct.name), ''), '(name not recorded)'),
           ct.gstin,
           COALESCE(ct.billing_address->>'state_code',
                    ct.billing_address->>'state')
    FROM public.graha_contacts ct
    WHERE ct.org_id = $1::uuid
      AND COALESCE(ct.is_active, TRUE)
      AND ct.client_id IS NULL
      AND ct.merged_into_id IS NULL
    ORDER BY 2, 3
    LIMIT $2::int
"""

_RECIPIENT_TOTAL_SQL = """
    SELECT (SELECT count(*) FROM public.graha_clients c
             WHERE c.org_id = $1::uuid AND COALESCE(c.is_active, TRUE))
         + (SELECT count(*) FROM public.graha_contacts ct
             WHERE ct.org_id = $1::uuid AND COALESCE(ct.is_active, TRUE)
               AND ct.client_id IS NULL AND ct.merged_into_id IS NULL)
"""


async def check_regional_send_guard(
    pool, org_id: str, send_on: str | None = None,
    saturday_is_closed: bool = True, limit: int = 200,
) -> dict:
    """Which recipients a chase would land on during their own non-working day,
    and the next day each of them could be reached.

    *send_on* is the day the send would go out ('YYYY-MM-DD') and defaults to
    today, which is what a pre-send guard is asked at 6am.

    ── IT NEVER REFUSES TO SEND FOR WANT OF A GSTIN ──────────────────────────

    The state is derived from the first two digits of the recipient's GSTIN,
    which needs no new column. But GSTIN BLOCKS NOTHING IN THIS PRODUCT and it
    does not start blocking here. A recipient whose state cannot be resolved is
    SENDABLE, is counted, and is listed by name in `state_could_not_be_resolved`
    so a firm can see whose region was unknown. Suppression only ever comes from
    a day that is genuinely non-working — never from missing identity. That is
    asserted in the test suite, because it is the one rule this skill would be
    most tempting to get wrong.

    ── AND IT NEVER SENDS ANYTHING ───────────────────────────────────────────

    It returns a verdict per recipient. Delivery is Niyam's and arming a rule is
    the owner's decision. Nothing here writes a row — not even a reminder,
    because a chase recorded but not sent is worse than one not sent at all.

    ── WHAT IT CAN SEE, WHICH IS LESS THAN YOU WOULD LIKE ────────────────────

    The only holiday source in this product is the firm's OWN HR holiday list.
    There is no national calendar, no per-state feed, and nothing writes
    `manav_holidays.state_code` — measured 2026-08-20, 0 of 38 rows carry one.
    So today every recorded holiday holds every recipient, which is migration
    175's stated reading and errs in the safe direction; and a regional holiday
    the firm has not entered CANNOT BE SEEN. Both facts are on `limitations`,
    because a guard that quietly sees nothing reads exactly like a guard that
    found nothing wrong.
    """
    today = utc_now().date()
    day = _as_day(send_on) or today
    cap = max(1, int(limit))
    sat_off = bool(saturday_is_closed)

    holidays = await _holidays(pool, org_id, day - timedelta(days=1),
                               day + timedelta(days=MAX_SHIFT_DAYS + 1))

    rows = await pool.fetch(_RECIPIENTS_SQL, org_id, cap)
    total = await pool.fetchval(_RECIPIENT_TOTAL_SQL, org_id)

    hold: list[dict] = []
    send: list[dict] = []
    unresolved: list[dict] = []
    retired = 0

    for r in rows:
        from_gstin = _state_from_gstin(r["gstin"])
        state = from_gstin or _norm_state(r["address_state"])
        source = ("the first two digits of the GSTIN" if from_gstin
                  else ("the address on the record" if state else None))
        if state in RETIRED_STATE_CODES:
            retired += 1

        why = _why_closed(day, holidays, state, sat_off)
        entry = {
            "recipient_row_handle": str(r["row_handle"]),
            "recipient": r["recipient"],
            "kind": r["kind"],
            "has_a_gstin": bool((r["gstin"] or "").strip()),
            "state_source": source,
            **_state_view(state),
        }
        if why is None:
            send.append({**entry, "verdict": "send", "reason": None})
        else:
            nxt, skipped = _next_open(day, holidays, state, sat_off)
            closure = _closure_on(day, holidays, state)
            hold.append({
                **entry,
                "verdict": "hold",
                "reason": why,
                "reason_applies_everywhere": (
                    why in ("Saturday", "Sunday")
                    or (closure or {}).get("state_code") is None),
                "next_sendable_on": nxt,
                "days_held": days_between(nxt, day) if nxt else None,
                "days_skipped": skipped,
            })
        if state is None:
            unresolved.append({
                "recipient_row_handle": str(r["row_handle"]),
                "recipient": r["recipient"],
                "kind": r["kind"],
                "has_a_gstin": bool((r["gstin"] or "").strip()),
                "treated_as": "sendable",
            })

    considered = len(rows)
    resolved = considered - len(unresolved)
    checked_anything = considered > 0

    limitations = [
        "A RECIPIENT WHOSE STATE IS UNKNOWN IS SENT TO, NEVER SUPPRESSED. GSTIN "
        "blocks nothing in this product. Every hold below is because the DAY is "
        "non-working, never because a recipient could not be identified.",
        "The only holiday source in this product is the firm's own HR holiday "
        "list (public.manav_holidays). There is no national calendar and no "
        "per-state feed, so a regional holiday nobody has entered cannot be "
        "seen and this guard will pass a send straight through it.",
        "Optional holidays are working days here and do not hold a send.",
        f"Saturday was treated as {'a closure' if sat_off else 'a working day'}. "
        f"That is a product assumption, not a statutory fact, and it is a "
        f"parameter.",
        "Nothing was sent, drafted or recorded. This returns a verdict; arming "
        "a send is a separate decision the owner makes.",
    ]
    if not checked_anything:
        limitations.insert(0,
            "THIS FIRM HAS NO ACTIVE CLIENTS OR CONTACTS ON ITS BOOKS, so no "
            "recipient was checked at all. This is a check that COULD NOT RUN, "
            "not a clean send list.")
    if holidays["rows_in_window"] == 0:
        limitations.append(
            "No holiday is recorded anywhere near this date, so only the "
            "weekend was applied.")
    elif holidays["carrying_a_state"] == 0:
        limitations.append(
            f"None of the {holidays['rows_in_window']} holiday row(s) near this "
            f"date carries a state_code, so each one holds EVERY recipient "
            f"rather than only that state's. `manav_holidays.state_code` exists "
            f"(migration 175) and nothing writes it: the holidays endpoint in "
            f"routers/manav.py inserts name, date and is_optional only.")
    if retired:
        limitations.append(
            f"{retired} recipient(s) resolve to a state code no longer issued "
            f"(25 Daman & Diu, merged 2020; 28 undivided Andhra Pradesh, split "
            f"2014). The name is shown so the row stays readable, but the "
            f"registration is stale.")
    if considered >= cap:
        limitations.append(
            f"Capped at {cap} recipients; {max(0, int(total or 0) - cap)} were "
            f"not checked. The unchecked ones are neither cleared nor held.")

    return {
        "as_at": today,
        "send_on": day,
        "send_on_weekday": day.strftime("%A"),
        "saturday_treated_as_closed": sat_off,
        "could_not_check": not checked_anything,
        "no_findings": (len(hold) == 0) if checked_anything else False,
        "counts": {
            "recipients_on_the_books": int(total or 0),
            "recipients_checked": considered,
            "state_resolved": resolved,
            "state_unknown_treated_as_sendable": len(unresolved),
            "would_land_on_a_non_working_day": len(hold),
            "clear_to_send": len(send),
            "holiday_rows_near_this_date": holidays["rows_in_window"],
            "holiday_rows_carrying_a_state": holidays["carrying_a_state"],
            "optional_holidays_ignored": holidays["optional_ignored"],
            "recipients_with_a_retired_state_code": retired,
            "capped_at": cap,
            "was_capped": considered >= cap,
        },
        "hold": hold,
        "clear_to_send": send,
        "state_could_not_be_resolved": unresolved,
        "limitations": limitations,
    }
