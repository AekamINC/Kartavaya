"""statute.py — the read API over `staging.statute_calendar` (migration 158).

A statutory fact is never a constant. Form 24Q became Form 138 on 1 April 2026,
section 206AA became section 397(2) on the same day, and the 12% and 28% GST
slabs stopped existing on 22 September 2025. Anything in this product that
prints a form number, a section reference, a due day or a rate must therefore
ask for it AS OF A DATE, and this module is the only way to do that.

── THE SIGNATURE IS THE POINT ───────────────────────────────────────────────
`as_of` is keyword-only, has NO DEFAULT, and there is deliberately no
`as_of=None -> today` fallback. A default of "today" looks harmless and
reintroduces the exact bug this table exists to remove: the Q4 FY 2025-26 TDS
statement is PREPARED in May 2026, so a caller that forgot the date would be
handed Form 138 for payments made in January–March 2026 and TRACES would reject
the return. THE ANCHOR IS THE DATE OF THE PAYMENT OR THE PERIOD THE DOCUMENT
COVERS, NEVER THE DATE YOU ARE FILING ON. If you catch yourself wanting a
default here, what you actually want is `obligation_for_fy`.

── THE VALIDITY WINDOW IS HALF-OPEN: [effective_from, effective_to) ─────────
effective_to is the first day the fact is NOT true. 158 seeds the 24Q row ending
2026-04-01 and the 138 row starting 2026-04-01 — one date, written once — so
31 March 2026 answers 24Q and 1 April 2026 answers 138 with no off-by-one to
argue about. `_covers` below is the single implementation of that rule.

── WHY THE AS-OF PREDICATE IS IN PYTHON AND NOT IN THE SQL ──────────────────
`staging.statute_calendar` is a REFERENCE table: 28 rows today, a few hundred at
most ever, one row per version of one obligation. So the SQL narrows by key (or
by authority/prefix) and Python resolves which version applies. Two reasons, and
the second is the one that decided it:

  * There is then exactly ONE implementation of "which version is in force",
    rather than a WHERE clause and a Python helper that can drift apart. A
    disagreement between those two would be invisible — both would return a row.
  * It makes the resolution testable without a database. The suite runs against
    a MagicMock pool (tests/conftest.py), and a mock pool hides bad SQL: a date
    predicate pushed into SQL would be asserted by nothing at all, while the test
    that matters — 24Q on 31 March, 138 on 1 April — would still pass green
    against invented fixture rows.

If this table ever grows past a few thousand rows, push the predicate down AND
add a test that the two agree; do not push it down quietly.

── PRECEDENCE ───────────────────────────────────────────────────────────────
A state-specific row (state_code = 'MH') outranks the all-India row (state_code
IS NULL) for the same key on the same date. Within a tier, the latest
effective_from wins. Overlapping versions in the same tier are a data defect —
158's `statute_calendar_one_open_version_idx` refuses the realistic case (two
rows both open-ended) — but the resolution stays deterministic rather than
raising, because a skill that dies mid-report is worse than one that answers
with the newer of two overlapping facts.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any, Iterable, Sequence

#: Every column a caller may read. Listed rather than SELECT *, so that adding a
#: column to 158's successor cannot silently change what callers receive.
_COLS: tuple[str, ...] = (
    "obligation_key", "title", "authority", "statute", "form_number",
    "section_ref", "periodicity", "due_day", "due_month", "due_month_offset",
    "window_days", "rate_percent", "threshold_amount", "state_code",
    "effective_from", "effective_to", "effective_from_exact",
    "source_ref", "notes", "verified_on", "due_overrides",
)

#: Schema-qualified, always. `search_path` on this database is
#: `"$user", public, extensions` — measured 2026-08-19 — so `statute_calendar`
#: unqualified resolves to nothing at all, and a shadow table in `public` has
#: bitten this repo before (migration 142).
_FROM = "FROM public.statute_calendar"

_SELECT_BY_KEY = (
    f"SELECT {', '.join(_COLS)} {_FROM} "
    " WHERE obligation_key = $1::text "
    #  $2 is the caller's state. NULL-state rows are always candidates; a state
    #  row is a candidate only for that state. When the caller passes no state,
    #  `state_code = NULL` is never true, so only the all-India rows come back —
    #  which is the correct reading of "I did not tell you a state".
    "   AND (state_code IS NULL OR state_code = $2::text)"
)

_SELECT_LISTING = (
    f"SELECT {', '.join(_COLS)} {_FROM} "
    " WHERE ($1::text IS NULL OR authority = $1::text) "
    #  starts_with(), NOT LIKE $2 || '%'. `_` is a LIKE wildcard and obligation
    #  keys contain underscores — `tds.higher_rate_no_pan` is one — so a prefix
    #  of 'tds.higher_rate' passed to LIKE would also match keys nobody asked
    #  for, silently and only sometimes.
    "   AND ($2::text IS NULL OR starts_with(obligation_key, $2::text)) "
    "   AND ($3::text IS NULL OR periodicity = $3::text) "
    "   AND (state_code IS NULL OR state_code = $4::text) "
    " ORDER BY obligation_key, effective_from"
)

#: 'YYYY-YY' or 'YYYY-YYYY'. The Indian financial year runs 1 April to 31 March.
_FY_RE = re.compile(r"^(\d{4})[-/](\d{2}|\d{4})$")


class StatuteError(ValueError):
    """A malformed request to this module — never a missing fact.

    A missing fact is `None`, because "the catalogue records nothing for this
    key on this date" is a real and expectable answer for a table that is
    deliberately incomplete (158 seeds no state-specific row at all). A
    malformed request — no date, an unparseable financial year — is a caller
    bug and must be loud.
    """


# ── date handling ────────────────────────────────────────────────────────────

def _coerce_as_of(as_of: Any) -> date:
    """The one place `as_of` is validated. Raises rather than defaulting.

    `datetime` is checked FIRST because it is a subclass of `date`, so the
    obvious `isinstance(as_of, date)` would accept a datetime and then compare a
    tz-aware datetime against a plain date column value — which raises
    TypeError somewhere far away from the caller who passed it.
    """
    if isinstance(as_of, datetime):
        return as_of.date()
    if isinstance(as_of, date):
        return as_of
    raise StatuteError(
        "as_of must be a date. There is no default: a form number without the "
        "date it applies to is the defect this module exists to prevent "
        f"(got {type(as_of).__name__!r})."
    )


def _covers(row: dict, as_of: date) -> bool:
    """Half-open: effective_from <= as_of < effective_to."""
    if row["effective_from"] > as_of:
        return False
    to = row["effective_to"]
    return to is None or to > as_of


def _rank(row: dict) -> tuple[int, date]:
    """State-specific beats all-India; within a tier, the later start wins."""
    return (1 if row["state_code"] is not None else 0, row["effective_from"])


def _resolve(rows: Iterable[dict], as_of: date) -> dict | None:
    live = [r for r in rows if _covers(r, as_of)]
    if not live:
        return None
    return max(live, key=_rank)


def _rows(records: Sequence[Any]) -> list[dict]:
    return [dict(r) for r in records]


# ── the due date ─────────────────────────────────────────────────────────────
#
# THE ONE IMPLEMENTATION. It lived in two places until 2026-09-02 —
# `gst_year._due_date_from` and a byte-identical restatement in
# `client_register` — and `delta_and_provenance` imports the first with a note
# saying a third copy would be a third chance to make a bug that already
# happened live. Both are now three-line delegates to this, so the note is true
# by construction rather than by discipline.


def _apply_override(row: dict, period_end: date) -> dict:
    """The row as it applies to a period ending in `period_end`'s month.

    A statutory due date is not always one rule. The quarterly TDS statement is
    a month after the quarter for Q1–Q3 and TWO months after it for Q4, and the
    monthly TDS deposit is the 7th of the next month for eleven months and the
    30th of April for March. One `due_month_offset` and one `due_day` cannot say
    either of those things, which is why migration 266 refused to give the
    statements a date at all and left the deposit a month early for March.

    `due_overrides` says what differs, keyed by the PERIOD-END MONTH:

        {"3": {"month_offset": 2}}   a quarter ending in March is due +2 months
        {"3": {"day": 30}}           March's deduction is deposited by 30 April

    Keyed on the period end because that is what this function already holds,
    and because the same column then serves a monthly rule and a quarterly one
    without either knowing the other exists.

    A malformed override is IGNORED, not raised on. This runs inside an
    unattended cron sweep behind the `statute_note` below, which prints the
    citation beside whatever this resolves; a
    skill that dies mid-report is worse than one that falls back to the row's
    own rule, and the values here are seeded by migration rather than by users.
    """
    raw = row.get("due_overrides")
    if not raw:
        return row
    if isinstance(raw, (str, bytes)):
        # `db.py` registers a jsonb codec, so this is normally a dict already —
        # but that registration is allowed to fail under PgBouncer and logs a
        # warning when it does, and a date is not worth losing to that.
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            return row
    if not isinstance(raw, dict):
        return row
    rule = raw.get(str(period_end.month))
    if not isinstance(rule, dict):
        return row

    merged = dict(row)
    for src, dst in (("day", "due_day"),
                     ("month", "due_month"),
                     ("month_offset", "due_month_offset")):
        if src in rule:
            merged[dst] = rule[src]
    # An override naming an absolute month means THAT MONTH, not that month and
    # whatever offset the row already carried — so it clears the offset. This is
    # not symmetric and deliberately so: the offset branch below is tried first
    # and wins, so an override naming a month would otherwise be read, merged,
    # and then never reached.
    #
    # There is no mirror-image line clearing `due_month` when the override names
    # an offset, because the offset already wins and clearing it would change no
    # date anyone can observe. One was written, and mutation testing found the
    # test covering it green with the line deleted — an assertion satisfied by
    # its own shape. Unobservable code with a test that cannot fail is worse
    # than neither.
    if "month" in rule and "month_offset" not in rule:
        merged["due_month_offset"] = None
    return merged


def due_date_from(row: dict | None, period_end: date) -> date | None:
    """The statutory due date for a period, from a calendar row, or None.

    THE CALENDAR EXPRESSES A DUE DATE THREE DIFFERENT WAYS and reading only one
    of them silently produces a plausible wrong date — which it did, live:
    GSTR-9 for FY 2025-26 came out as 31 March 2026, nine months early, because
    the offset branch ran and `due_month` was never looked at.

      `due_month_offset`  months AFTER the period end. This is how the monthly
                          returns are held: GSTR-1 is due_day 11, offset 1, so
                          August's is 11 September.
      `due_month`         an absolute month, for an obligation whose date is
                          fixed in the calendar rather than relative to a
                          period: GSTR-9 is due_day 31, due_month 12.
      `due_overrides`     what differs for one period — see `_apply_override`.
                          The quarterly TDS statements and the monthly deposit
                          are the rules that need it.

    When `due_month` is absolute, the YEAR is the one in which that month next
    falls on or after the period end. For a financial year ending 31 March 2026
    a due_month of 12 resolves to December 2026 and of 11 to November 2026 —
    both correct, and both "following the year", which is what s.44 and s.16(4)
    actually say.

    Returns None — never a guess — when the catalogue carries no day at all.
    Callers have a "the catalogue records no due date" branch for exactly that,
    and it is the honest answer for an obligation nobody has dated yet.
    """
    if not row or not row.get("due_day"):
        return None
    row = _apply_override(row, period_end)
    if not row.get("due_day"):
        # An override may only refine a dated rule, never erase one. Reaching
        # here means it set the day to null, and the row's own day is the
        # sourced value; fall back rather than print nothing.
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
    # calendar saying "the last day", not a data error.
    for candidate in range(day, 27, -1):
        try:
            return date(year, month, candidate)
        except ValueError:
            continue
    return date(year, month, day)


def statute_note(row: dict | None, what: str) -> str:
    """One sentence naming the authority for a printed date or figure.

    Every date and every figure these skills print is attributable, or it is
    not printed. An unattributed date in front of a CA is a date they have to
    go and verify, which costs more than not showing it.

    THE CITATION IS `form_number · section_ref`, FALLING BACK TO `statute`, AND
    NOTHING ELSE. `authority` is deliberately not in that chain: it is a routing
    slug — the four values in the table today are `income_tax`, `gst`, `epfo`
    and `esic` — so a row that fell through to it would print
    "Monthly TDS deposit (income_tax)" beside a statutory date. A lowercase slug
    where a section reference belongs reads as a rendering fault, and it is
    worse than the honest empty string this returns instead.

    That fallback existed. `firm_flow` carried a fifth copy of this function
    with `or row.get("authority")` on the end while the other four did not, so
    two screens could cite the same row differently. It was unobservable —
    `statute` is non-null on all 70 rows, measured 2026-09-03 — which is exactly
    why it survived: the day a row is seeded without one, one screen prints a
    slug and four print nothing, and neither is the row's own citation.
    """
    if not row:
        return f"The statute calendar records no {what}, so none is shown."
    bits = [b for b in (row.get("form_number"), row.get("section_ref")) if b]
    cite = " · ".join(bits) if bits else (row.get("statute") or "")
    return f"{row.get('title') or what}{f' ({cite})' if cite else ''}"


# ── the read API ─────────────────────────────────────────────────────────────

async def obligation(
    pool,
    key: str,
    *,
    as_of,
    state_code: str | None = None,
) -> dict | None:
    """The version of `key` in force on `as_of`, or None.

    `pool` may be an asyncpg pool or a connection taken out of one — only
    `.fetch` is used, and both answer it.

    `as_of` is the date the OBLIGATION arises: the date of the payment for a TDS
    form, the last day of the tax period for a GST return. It is not the date
    you are running this on, and it is not optional.
    """
    stamp = _coerce_as_of(as_of)
    records = await pool.fetch(_SELECT_BY_KEY, key, state_code)
    return _resolve(_rows(records), stamp)


async def obligations(
    pool,
    *,
    as_of,
    authority: str | None = None,
    key_prefix: str | None = None,
    periodicity: str | None = None,
    state_code: str | None = None,
) -> list[dict]:
    """Every obligation in force on `as_of`, one row per key, key order.

    One row per obligation_key: the listing resolves versions the same way
    `obligation` does, so a caller cannot accidentally render both the 24Q row
    and the 138 row in the same table and leave a reader to guess.
    """
    stamp = _coerce_as_of(as_of)
    records = await pool.fetch(
        _SELECT_LISTING, authority, key_prefix, periodicity, state_code
    )

    by_key: dict[str, list[dict]] = {}
    for row in _rows(records):
        by_key.setdefault(row["obligation_key"], []).append(row)

    out = [r for rows in by_key.values() if (r := _resolve(rows, stamp))]
    out.sort(key=lambda r: r["obligation_key"])
    return out


# ── financial years ──────────────────────────────────────────────────────────

def fy_bounds(fy: str) -> tuple[date, date]:
    """'2025-26' -> (2025-04-01, 2026-03-31). Inclusive of both ends.

    Inclusive here, unlike `effective_to`, because these are the real first and
    last days of the year a preparer names — not a validity window. The two
    conventions sit next to each other on purpose and are both stated: silently
    mixing them is how a 1 April answer gets attributed to the previous year.
    """
    m = _FY_RE.match((fy or "").strip())
    if not m:
        raise StatuteError(
            f"Unparseable financial year {fy!r} — expected '2025-26' or '2025-2026'."
        )
    start_year = int(m.group(1))
    tail = m.group(2)
    end_year = int(tail) if len(tail) == 4 else start_year - start_year % 100 + int(tail)
    # '2099-00' means 2100, not 2000. Without this the century rolls backwards
    # and fy_bounds returns a window that ends 99 years before it starts.
    if end_year < start_year:
        end_year += 100
    if end_year != start_year + 1:
        raise StatuteError(
            f"Financial year {fy!r} does not span one year "
            f"({start_year} to {end_year}); an Indian FY runs 1 April to 31 March."
        )
    return date(start_year, 4, 1), date(end_year, 3, 31)


def fy_of(day: date) -> str:
    """The Indian financial year containing *day*, as '2025-26'. April to March.

    `fy_bounds` is the inverse, sits directly above, and the two are tested
    against each other in both directions — because an off-by-one here does not
    raise, it silently reports one year's turnover against another year's
    threshold, and both numbers look plausible.
    """
    start_year = day.year if day.month >= 4 else day.year - 1
    return f"{start_year}-{str(start_year + 1)[-2:]}"


async def obligation_for_fy(
    pool,
    key: str,
    fy: str,
    *,
    state_code: str | None = None,
) -> dict | None:
    """The version of `key` in force at the END of financial year `fy`.

    Adds two keys the plain lookup cannot carry:

      * `financial_year` — the year the answer was resolved for.
      * `stable_across_year` — FALSE when this single answer is wrong for part of
        the year, which happens two ways and BOTH must be checked. The obvious
        one is that a later version REPLACED an earlier one inside the year. The
        one that was missed here, and that no test caught until it was written,
        is that the resolved version simply BEGAN inside the year: gst.rate.40
        starts 22 September 2025 and is the only version of its key, so counting
        versions alone found one, called it stable, and told a caller the 40%
        slab held for the whole of FY 2025-26 when it did not exist for the first
        five and a half months of it. Whether the answer holds all year is a
        question about the resolved window's START, not about how many rows there
        are. The Income-tax Act 2025 came in on 1 April, an FY boundary, so every
        seeded TDS fact is genuinely stable across both FY 2025-26 and FY
        2026-27 — which is why counting alone looked right against the TDS rows.

        It is reported rather than raised: refusing to answer a whole class of
        question because one fact moved mid-year is worse than answering with the
        flag.

    NOTE the asymmetry with a fact that DIED inside the year and had no
    successor: this resolves at the year END, so gst.rate.12 for FY 2025-26 is
    None, not an unstable row — the 12% slab was live for half that year and this
    function will not say so. A caller enumerating "every slab that applied
    during FY 2025-26" must walk dates, not years.
    """
    start, end = fy_bounds(fy)
    records = await pool.fetch(_SELECT_BY_KEY, key, state_code)
    rows = _rows(records)

    resolved = _resolve(rows, end)
    if resolved is None:
        return None

    # A version touches the year if its window overlaps [start, end] at all.
    # effective_to is exclusive, so `to > start` (not >=) is the correct test:
    # a version that ended on 1 April does not touch the year beginning that day.
    touching = [
        r for r in rows
        if r["effective_from"] <= end
        and (r["effective_to"] is None or r["effective_to"] > start)
        and _rank(r)[0] == _rank(resolved)[0]      # compare like with like
    ]

    # Two independent ways this answer can fail to hold for the whole year, and
    # the second was the bug: `len(touching) <= 1` alone passes a version that is
    # the ONLY version of its key but started after 1 April. gst.rate.40 is the
    # live case — one row, effective_from 2025-09-22 — and it was being reported
    # stable across FY 2025-26. `covered_from_day_one` is the check that catches
    # it, and it is about the resolved window's start, not the row count.
    covered_from_day_one = resolved["effective_from"] <= start
    out = dict(resolved)
    out["financial_year"] = fy
    out["stable_across_year"] = len(touching) <= 1 and covered_from_day_one
    return out
