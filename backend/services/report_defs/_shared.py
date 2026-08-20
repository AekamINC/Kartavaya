"""The four lines every REGISTER repeats, written once.

A register — sales, purchase, receipts, expenses — is the same document with
different columns: one row per source document in date order, money rounded
per cell, a footer that ties, and a hard ceiling so one runaway period cannot
build a PDF nobody can open. Five copies of that would drift; one copy is the
ratchet.

`receivables_ageing.py` predates this module and keeps its own `_money`
DELIBERATELY — `tests/test_receivables_ageing.py` pins its per-cell rounding
and its "no footer on an empty book" rule byte for byte, and rewiring a green,
pinned file to import a helper buys nothing and risks a bucket. If that file
is ever touched for another reason, `money()` here is character-identical and
the swap is safe then.

NOTHING in here writes, and nothing in here decides a statutory fact. A form
number, a section reference and a due date come from `services/statute.py`
and from nowhere else (`obligation(pool, key, *, as_of=...)`) — these are
COMMERCIAL registers, the firm's own books, and they name no form on purpose.
"""
from __future__ import annotations

#: The most rows any one register prints. Not a page size and never a silent
#: truncation: when it bites, `capped` says so IN THE TABLE (see
#: `overflow_row`), because a register that quietly stops at row N reconciles
#: against nothing while still looking complete — the same fault
#: `receivables_ageing`'s "an ageing report that omits rows is worse than
#: none" names. Measured 2026-08-20 against the live database: the largest
#: register any org can produce today is 595 rows (issued documents, seeded
#: org, all time), so this ceiling is a runaway guard, not a working limit.
ROW_CAP = 5000

#: What an empty text column prints. An empty string, not a dash and not the
#: word "None": these tables go into CSV and XLSX as well as onto paper, and a
#: placeholder glyph in a spreadsheet column is a value somebody will filter
#: on by accident.
BLANK = ""


def money(v) -> float:
    """Two decimals, once — at the CELL.

    Every printed figure is rounded here and every total is summed from the
    rounded cells, so the column a reader adds up on paper is the column that
    ties. Summing raw floats and rounding the total is how a register ends up
    a paisa off its own footer.
    """
    return round(float(v or 0.0), 2)


def capped(rows: list) -> tuple[list, int]:
    """(the rows to print, how many were dropped).

    Callers fetch `ROW_CAP + 1` rows so the overflow is known without a second
    COUNT query — but the dropped count is then only ever 0 or 1, which is why
    this returns the count rather than a bool: a caller that fetches
    differently gets a truthful number out of the same helper.
    """
    if len(rows) <= ROW_CAP:
        return rows, 0
    return rows[:ROW_CAP], len(rows) - ROW_CAP


def total_row(rows: list, label_column: str, label: str,
              money_columns: tuple) -> dict:
    """The footer: every money column summed from the ROUNDED cells above it.

    The label goes in `label_column` and every other non-money column is
    blank, so the footer cannot be mistaken for a document — a date column
    holding the word "Total" is not a date any spreadsheet will parse, and
    that is exactly what a footer written into column one produces.
    """
    out: dict = {}
    for key in (rows[0].keys() if rows else ()):
        if key in money_columns:
            out[key] = money(sum(r.get(key) or 0.0 for r in rows))
        else:
            out[key] = label if key == label_column else BLANK
    return out


def overflow_row(rows: list, label_column: str, dropped: int) -> dict:
    """The row that ADMITS the ceiling bit, in words, inside the table.

    It says the footer above it covers the listed rows only — otherwise a
    reader cross-checks a capped Total against the org's real turnover, finds
    it short, and distrusts the document rather than the period they asked
    for.
    """
    printed = len(rows) - 1 if rows else ROW_CAP      # minus the footer row
    return {key: (f"Only the first {printed:,} rows are listed "
                  f"({dropped:,}+ more) — the Total above covers the listed "
                  f"rows only. Narrow the period."
                  if key == label_column else BLANK)
            for key in (rows[0].keys() if rows else ())}


def finish(rows: list, label_column: str, label: str, money_columns: tuple,
           dropped: int = 0) -> list:
    """rows → rows + footer (+ the overflow notice, when there is one).

    An EMPTY register gets no footer. `render_report_html` prints "No rows for
    this period" for an empty list, which is the honest page; a lone row of
    zeros reads as a register that ran and found nothing happened, when it may
    equally have found nothing at all — `receivables_ageing`'s rule, kept.
    """
    if not rows:
        return []
    out = [*rows, total_row(rows, label_column, label, money_columns)]
    if dropped:
        out.append(overflow_row(out, label_column, dropped))
    return out


def window_or_raise(window, key: str):
    """A flow section's window, or a loud failure.

    `ReportDef.grain` is the contract: `module_report.report_section` hands a
    flow section the window and a stock section None. A flow builder reached
    with None has been called by something that ignored that contract, and the
    only two answers worse than raising are inventing a period (a register
    covering dates nobody asked for) and returning no rows (a register that
    says nothing happened). Neither is visible to the reader; this is.
    """
    if window is None:
        raise ValueError(
            f"{key}: this register measures a period and was handed no "
            f"window — grain='flow' means report_section supplies one.")
    return window
