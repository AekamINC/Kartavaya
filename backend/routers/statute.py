"""Dated Indian statute, served to the browser.

── Why this file did not exist ─────────────────────────────────────────────

`staging.statute_calendar` holds 45 rows of dated law — form numbers, sections,
due days, thresholds, rates — each with `effective_from`/`effective_to`, each
carrying a `verified_on`. It is read by `services/statute.py` and by nine skill
handlers through it, and **by no router at all**. Grepped: `statute` appeared
in `backend/routers/` exactly once, in a code comment.

So a 45-row table of the law this whole product exists to help firms obey was
reachable only as a side effect of running a skill. The corner dock's "Due"
tab, the firm's own filing calendar, and any statutory circular a firm might
print all wanted it, and none of them could ask.

── The one rule this surface must not break ────────────────────────────────

`services/statute.py` is the ONLY way to read a statutory fact, and `as_of` is
keyword-only with NO DEFAULT — deliberately, because the alternative is a
caller who forgets it and silently gets whichever version happens to sort
first. The Income-tax Act 2025 transition makes that concrete: 24Q becomes
138, 26Q becomes 140, 16 becomes 130, all on 2026-04-01. A form number without
a date attached is not an answer, it is a coin flip.

So this router NEVER computes a date of its own and never hardcodes a form
number. It takes `as_of` from the caller, defaults it to today when absent —
which is the honest reading of "what applies now" — and ECHOES IT BACK in the
response so that whatever renders the answer can print the date the answer was
true on. A statutory table with no date on the page is the thing this codebase
already has a test against.

── What it does not do ─────────────────────────────────────────────────────

No writes. No arming. No per-client obligations — `staging.client_obligations`
holds zero rows and has no writer anywhere in the product, so a per-client
calendar here would be a confident empty page. The firm-level answer is real
and is what ships.

── `/due` — the same rows, projected onto a calendar ───────────────────────

`/obligations` answers "what is the law". `/due` answers "when does it next
fall", which is the question the corner dock's Due tab asks, and it is answered
HERE rather than in the browser for one reason: a due date is arithmetic over
`due_day` / `due_month` / `due_month_offset`, and those three columns are
themselves dated law. A JavaScript constant cannot honour a validity window it
has never seen, so the projection lives beside the resolver that reads the
window.

The projection NEVER invents a date. `due_day IS NULL` is defined by migration
158 as "THE SCHEDULE IS NOT A DAY-OF-MONTH RULE. Read `notes`; do not guess",
and this router does not guess: the obligation is still listed, and it is
listed with `due_on: null` and the reason. Six of the income-tax rows in force
today are exactly that shape.
"""
from __future__ import annotations

import logging
from calendar import monthrange
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from db import get_pool
from auth_router import require_user
from services import statute

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/statute", tags=["statute"])

#: The authorities the table actually carries, live: income_tax 22, gst 18,
#: esic 4, epfo 1. Validated against a fixed set rather than passed through,
#: because `authority` reaches a SQL predicate and an allowlist is how every
#: other dynamic identifier in this codebase is handled.
_AUTHORITIES = ("gst", "income_tax", "epfo", "esic")

#: Likewise. `standing` is the interesting one — 18 of the 45 rows are rules
#: with no date at all (rates, ceilings, thresholds), and a "due dates" screen
#: that silently included them would print a deadline for the ESI wage ceiling.
_PERIODICITIES = ("monthly", "quarterly", "annual", "event", "standing")


def _parse_as_of(raw: str | None) -> date:
    """`as_of`, or today. Never a silent wrong date.

    Defaulting to today is the honest reading of an absent parameter — the
    caller is asking what applies now. Guessing at a malformed one is not: a
    caller who sends `31-03-2026` and gets today's answer has been told
    something false about the law, so it is refused.
    """
    if not raw:
        return datetime.now(timezone.utc).date()
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(
            422, f"as_of must be an ISO date (YYYY-MM-DD); got {raw!r}"
        )


@router.get("/obligations")
async def list_obligations(
    as_of: str | None = Query(None, description="ISO date. Defaults to today."),
    authority: str | None = Query(None),
    periodicity: str | None = Query(None),
    state_code: str | None = Query(None),
    key_prefix: str | None = Query(None),
    user=Depends(require_user),
):
    """Every obligation in force on `as_of`, one row per obligation key.

    NOT ORG-SCOPED, and that is correct rather than an oversight: the law is
    the same for every tenant. There is no org predicate to add because there
    is no org column — `statute_calendar` carries `state_code`, not `org_id`.
    `require_user` is here because this is a product surface and not a public
    one, not because the rows are anybody's data.

    One row per key, resolved through `services.statute` so that a caller
    cannot render both the 24Q row and its 138 successor in one table and leave
    a reader to work out which applies.
    """
    stamp = _parse_as_of(as_of)

    if authority and authority not in _AUTHORITIES:
        raise HTTPException(422, f"authority must be one of {list(_AUTHORITIES)}")
    if periodicity and periodicity not in _PERIODICITIES:
        raise HTTPException(422, f"periodicity must be one of {list(_PERIODICITIES)}")

    pool = await get_pool()
    rows = await statute.obligations(
        pool,
        as_of=stamp,
        authority=authority,
        periodicity=periodicity,
        state_code=state_code,
        key_prefix=key_prefix,
    )

    return {
        # Echoed back so the renderer can print the date the answer was true
        # on. A statutory table with no date on the page is exactly what the
        # form renumbering made dangerous.
        "as_of": stamp.isoformat(),
        "filters": {
            "authority": authority, "periodicity": periodicity,
            "state_code": state_code, "key_prefix": key_prefix,
        },
        "data": rows,
        "count": len(rows),
        # Said out loud rather than left for a reader to infer from an empty
        # `due_day`. 18 of the 45 live rows are standing rules — rates,
        # ceilings, thresholds — which have no date and must not be rendered
        # as though they were deadlines.
        "note": (
            "Rows with periodicity 'standing' are rules in force, not "
            "deadlines: they carry a rate, a threshold or a ceiling and no due "
            "date. Filter on periodicity to separate them."
        ),
    }


# ══════════════════════════════════════════════════════════════════════════════
#  The calendar projection
#
#  Everything below turns "this obligation is in force" into "and it next falls
#  on this day". It reads three columns and adds no fact of its own.
# ══════════════════════════════════════════════════════════════════════════════

#: `standing` rows carry a rate, a ceiling or a threshold and NO deadline.
#: Excluded from `/due` by construction rather than by a filter a caller could
#: forget to pass: a due-dates screen that printed a deadline for the ESI wage
#: ceiling would be inventing one.
_DATED_PERIODICITIES = tuple(p for p in _PERIODICITIES if p != "standing")

#: For the basis sentence. Written out rather than taken from `strftime('%B')`,
#: which answers in whatever locale the container happens to carry.
_MONTHS = ("January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December")

#: How far forward the monthly scan looks. Twelve months plus two, so a day
#: that does not exist in the next month or two (a 30th, a 31st) still finds
#: the month that has one instead of falling off the end.
_SCAN_MONTHS = 14

#: The one sentence for every obligation whose schedule is not a day-of-month
#: rule. Migration 158 on `due_day`: "NULL means THE SCHEDULE IS NOT A
#: DAY-OF-MONTH RULE. Read `notes`; do not guess."
_NO_DUE_DAY = "the calendar records no due day for this obligation"

#: The other way a projection comes back empty: the row DOES name a day, and
#: the month it names has no such day (a 30th of February). Reported as the
#: data defect it is rather than slid quietly onto the 28th.
_NO_SUCH_DAY = "the day this obligation names does not exist in that month"

#: THE THIRD WAY, and the subtle one. A row can be in force on `as_of` and
#: STOP being in force before its own next occurrence. Ask on 26 August 2025
#: what the salary TDS certificate is due on and the row in force is the
#: 1961-Act one — Form 16, 15 June — whose next 15 June is 2026, by which date
#: it has been replaced by the 2025-Act row that carries NO due day at all.
#: Migration 158 says so on the successor in as many words: "Do not assume 15
#: June carried across."
#:
#: Projecting the date anyway would print a deadline computed from a rule that
#: is not the rule on the day it lands, which is the whole failure this table
#: exists to prevent — arrived at the long way round, through arithmetic
#: rather than through a hardcoded constant.
_WINDOW_CLOSES_FIRST = (
    "this version stops applying before its own next occurrence, so the date "
    "would be computed from a rule that is not the rule on the day it falls"
)


def _shift(year: int, month: int, delta: int) -> tuple[int, int]:
    """(year, month) `delta` months away. Negative walks backwards."""
    m = month - 1 + delta
    return year + m // 12, m % 12 + 1


def _on(year: int, month: int, day: int) -> date | None:
    """That calendar day, or None where the month has no such day.

    NEVER CLAMPED. Day 31 of a 30-day month is a month with no such date, and
    sliding it to the 30th would be this router inventing a deadline — the one
    thing it must not do. `services/skills/data/payroll_statutory.py` makes the
    same choice on the same column, and for the same reason.
    """
    if day < 1 or day > monthrange(year, month)[1]:
        return None
    return date(year, month, day)


def _project(row: dict, as_of: date) -> tuple[date | None, str]:
    """The next occurrence on or after `as_of`, and where that date came from.

    Three answers, and the third is the one that matters:

      annual   the row names a MONTH and a DAY (`due_month`, `due_day`). The
               next anniversary on or after `as_of`.
      monthly  the row names a DAY and how many months after the period it
               falls (`due_day`, `due_month_offset`). The period is a month,
               so the answer is a day and the month it belongs to, both stated.
      none     no date. Returned for every row this router cannot project
               WITHOUT GUESSING, which is not a failure and is not hidden: the
               quarterly TDS statements fall on 31 July, 31 October, 31 January
               and 31 MAY for Q4, so "day 31, one month after the period end"
               would be confidently wrong four times a year — which is exactly
               why migration 158 seeded their `due_day` as NULL. Every
               2025-Act row is NULL for the same reason: only the form number
               was verified, not that the old dates carried across.

    The obligation is still listed in all three cases. An obligation shown
    without a date is a firm being told something true; an obligation given a
    plausible date is a firm being told something false, and the second is the
    failure this whole table exists to prevent.
    """
    raw_day = row.get("due_day")
    if raw_day is None:
        return None, _NO_DUE_DAY
    day = int(raw_day)

    def _still_in_force(hit: date) -> bool:
        """Does the row that supplied this due day still apply on the day?

        `effective_to` is EXCLUSIVE — the first day the fact is NOT true — so
        `>=` is the correct comparison and not `>`. A projection that lands on
        or after it was computed from a rule that has been superseded by the
        time it falls.
        """
        end = row.get("effective_to")
        return end is None or hit < end

    # ── an anniversary ──────────────────────────────────────────────────────
    if row.get("due_month") is not None:
        month = int(row["due_month"])
        for year in range(as_of.year, as_of.year + 3):
            hit = _on(year, month, day)
            if hit is None or hit < as_of:
                continue
            if not _still_in_force(hit):
                return None, _WINDOW_CLOSES_FIRST
            return hit, f"every year on {day} {_MONTHS[month - 1]}"
        return None, _NO_SUCH_DAY

    offset = row.get("due_month_offset")

    # ── a day of the month, `offset` months after each period ───────────────
    #
    # Restricted to `monthly` deliberately. An offset on a QUARTERLY row would
    # be counted from the quarter end, and this scan walks months — projecting
    # it as though the period were a month would attribute the answer to the
    # wrong period. No live row has that shape; if one is ever seeded, it
    # arrives here undated and says so rather than arriving wrong.
    if offset is not None and row.get("periodicity") == "monthly":
        offset = int(offset)
        for k in range(_SCAN_MONTHS):
            year, month = _shift(as_of.year, as_of.month, k)
            hit = _on(year, month, day)
            if hit is None or hit < as_of:
                continue
            if not _still_in_force(hit):
                return None, _WINDOW_CLOSES_FIRST
            p_year, p_month = _shift(year, month, -offset)
            period = f"{_MONTHS[p_month - 1]} {p_year}"
            if offset == 0:
                where = f"day {day} of that month"
            elif offset == 1:
                where = f"day {day} of the following month"
            else:
                where = f"day {day}, {offset} months later"
            return hit, f"for {period} — {where}"

    return None, _NO_DUE_DAY


def _due_row(row: dict, as_of: date) -> dict:
    """One obligation in the shape the Due tab renders.

    `as_of` rides on every row on purpose: a countdown whose reference date is
    invisible is a countdown nobody can check, and this response is read one
    row at a time in a 360px panel where an envelope field is off screen.
    """
    due_on, basis = _project(row, as_of)
    return {
        "key": row["obligation_key"],
        "title": row["title"],
        "authority": row["authority"],
        "cadence": row["periodicity"],
        "due_on": due_on.isoformat() if due_on else None,
        "days_away": (due_on - as_of).days if due_on else None,
        "as_of": as_of.isoformat(),
        "basis": basis,
        # Read from the row, never written here — the renumbering is the whole
        # reason this table exists and a literal in this file would be a fact
        # with no date attached to it.
        "form_number": row.get("form_number"),
        "notes": row.get("notes") or "",
        "state_code": row.get("state_code"),
    }


@router.get("/due")
async def list_due(
    as_of: str | None = Query(None, description="ISO date. Defaults to today."),
    authority: list[str] | None = Query(None),
    state_code: str | None = Query(None),
    user=Depends(require_user),
):
    """What falls due, in force on `as_of`, dated first and undated after.

    NOT ORG-SCOPED, for the same reason `/obligations` is not: the law is the
    same for every tenant and `statute_calendar` carries no `org_id`. The
    caller narrows by `authority`, which is repeatable — the Finance page wants
    `gst` AND `income_tax` in one answer, and two round trips to build one list
    is two chances for the two halves to be resolved as of different dates.

    `standing` rows never appear. They are rules in force with no deadline, and
    the filter is not exposed: a caller cannot ask for the ESI wage ceiling to
    be rendered as though it had a due date.
    """
    stamp = _parse_as_of(as_of)

    wanted = [a for a in (authority or []) if a]
    for a in wanted:
        if a not in _AUTHORITIES:
            raise HTTPException(
                422, f"authority must be one of {list(_AUTHORITIES)}")

    pool = await get_pool()

    # One read per authority, versions resolved by `services.statute`, and the
    # `standing` rows dropped here rather than in the WHERE clause. Same choice
    # that module makes about the as-of predicate and for the same stated
    # reason: one implementation of a rule beats a WHERE clause and a Python
    # helper that can drift apart without either of them erroring.
    collected: list[dict] = []
    for auth in (wanted or [None]):
        collected.extend(await statute.obligations(
            pool, as_of=stamp, authority=auth, state_code=state_code,
        ))

    rows = [_due_row(r, stamp) for r in collected
            if r["periodicity"] in _DATED_PERIODICITIES]

    # Dated first, soonest first; then the undated, by name. A row with no date
    # sorted in among the dated ones by its key would read as though it were
    # due around then.
    rows.sort(key=lambda r: (r["due_on"] is None,
                             r["due_on"] or "",
                             r["title"]))

    dated = sum(1 for r in rows if r["due_on"])
    return {
        "as_of": stamp.isoformat(),
        "filters": {"authority": wanted or None, "state_code": state_code},
        "data": rows,
        "count": len(rows),
        "dated": dated,
        "undated": len(rows) - dated,
        "note": (
            "Rules in force with no deadline are not listed here at all. A row "
            "with a null due_on is an obligation whose schedule the calendar "
            "does not record as a day of the month — it is shown without a "
            "date rather than given a plausible one."
        ),
    }
