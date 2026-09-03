"""The statute citation, and the financial year, have ONE implementation each.

── WHAT THIS IS PROTECTING ──────────────────────────────────────────────────
`statute_note` renders the parenthetical that follows every statutory date this
product prints — "Monthly TDS deposit (r.218)". Five modules carried their own
copy of it and NOBODY TESTED ANY OF THEM: `grep -rl _statute_note tests/`
returned nothing on 2026-09-03. Four of the five were byte-identical and the
fifth, `firm_flow`, had appended `or row.get("authority")` to the fallback
chain.

That fifth copy is why this file exists rather than a comment. `authority` is a
ROUTING SLUG — `income_tax`, `gst`, `epfo`, `esic`, the only four values in the
table — so the drifted copy would print "Monthly TDS deposit (income_tax)"
where a section reference belongs. It was unobservable, because `statute` is
non-null on all 70 rows, and that is exactly how it survived: nothing could
distinguish the two implementations until the first row was seeded without an
Act name, at which point one screen prints a slug and four print nothing.

`fy_of` is the same shape with a different consequence. Three copies, all
agreeing today; an off-by-one in any one of them does not raise, it reports one
year's turnover against another year's threshold and both numbers look right.
It is the documented inverse of `fy_bounds`, so it is tested in both directions
rather than against restated expectations.

── THE OFFLINE/LIVE SPLIT ───────────────────────────────────────────────────
The rendering is pure and is tested offline against rows written here. The LIVE
half then asserts the production rows are the shape those tests assume — that
every row really does carry a citation — because the removed `authority`
fallback costing nothing is a claim about the DATA, not about this function.
"""
from __future__ import annotations

import asyncio
import os
import pathlib
import re
from datetime import date

import pytest

from services.statute import fy_bounds, fy_of, statute_note


#: A row as `_COLS` delivers it: the deposit rule, cited by rule reference.
DEPOSIT = {
    "obligation_key": "tds.deposit.monthly",
    "title": "Monthly TDS deposit",
    "authority": "income_tax",
    "statute": "Income-tax Act 2025",
    "form_number": None,
    "section_ref": "r.218",
}


# ══════════════════════════════════════════════════════════════════════════════
#  The citation
# ══════════════════════════════════════════════════════════════════════════════

def test_a_form_and_a_section_are_joined():
    row = {**DEPOSIT, "title": "Quarterly TDS statement",
           "form_number": "Form 140", "section_ref": "s.397(3)(b)"}
    assert statute_note(row, "x") == "Quarterly TDS statement (Form 140 · s.397(3)(b))"


def test_a_section_alone_is_the_citation():
    assert statute_note(DEPOSIT, "x") == "Monthly TDS deposit (r.218)"


def test_the_act_is_the_fallback_when_neither_form_nor_section_is_recorded():
    row = {**DEPOSIT, "form_number": None, "section_ref": None}
    assert statute_note(row, "x") == "Monthly TDS deposit (Income-tax Act 2025)"


def test_the_routing_slug_is_never_printed_as_a_citation():
    """THE ASSERTION THE FIFTH COPY WOULD FAIL.

    A row with no form, no section and no Act has nothing to cite, and this must
    say so by printing nothing — not by falling through to `authority`, which
    holds `income_tax`, not a section of anything. Restore the
    `or row.get("authority")` that `firm_flow` carried and this test goes red;
    that is the whole reason it is written against a row with `authority` SET.
    """
    row = {**DEPOSIT, "form_number": None, "section_ref": None, "statute": None}
    assert row["authority"] == "income_tax", "the row under test must carry one"
    assert statute_note(row, "x") == "Monthly TDS deposit"
    assert "income_tax" not in statute_note(row, "x")


def test_a_missing_row_names_its_own_absence():
    note = statute_note(None, "a GSTR-1 due date")
    assert note == "The statute calendar records no a GSTR-1 due date, so none is shown."


def test_an_untitled_row_falls_back_to_what_was_asked_for():
    row = {**DEPOSIT, "title": None}
    assert statute_note(row, "the deposit rule") == "the deposit rule (r.218)"


@pytest.mark.parametrize("blank", ["", None])
def test_a_blank_form_number_does_not_become_a_trailing_separator(blank):
    row = {**DEPOSIT, "form_number": blank, "section_ref": "r.218"}
    assert statute_note(row, "x") == "Monthly TDS deposit (r.218)"
    assert "·" not in statute_note(row, "x")


# ══════════════════════════════════════════════════════════════════════════════
#  The financial year — tested against its inverse, not against restatements
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("day,fy", [
    (date(2026, 4, 1), "2026-27"),      # first day of the year
    (date(2027, 3, 31), "2026-27"),     # last day of the year
    (date(2026, 3, 31), "2025-26"),     # the day before — a different year
    (date(2026, 12, 31), "2026-27"),    # the calendar year rolls, the FY does not
    (date(2027, 1, 1), "2026-27"),
])
def test_the_year_turns_on_the_first_of_april(day, fy):
    assert fy_of(day) == fy


@pytest.mark.parametrize("day", [
    date(2025, 4, 1), date(2025, 9, 30), date(2026, 3, 31),
    date(2026, 4, 1), date(2099, 6, 15), date(2100, 1, 1),
])
def test_fy_of_and_fy_bounds_are_inverses(day):
    """Every day lands inside the year `fy_of` names for it. This is the
    assertion an off-by-one cannot survive, and it needs no expected values."""
    start, end = fy_bounds(fy_of(day))
    assert start <= day <= end, f"{day} is not inside {fy_of(day)} = {start}..{end}"


def test_the_boundary_days_of_every_year_round_trip():
    for year in range(2020, 2035):
        for day in (date(year, 4, 1), date(year + 1, 3, 31)):
            start, end = fy_bounds(fy_of(day))
            assert start <= day <= end, f"{day} escaped {fy_of(day)}"


# ══════════════════════════════════════════════════════════════════════════════
#  One implementation — the search, not an enumeration
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("helper,why", [
    ("statute_note",
     "The citation printed beside every statutory date. Five copies existed and "
     "one had already drifted to printing the routing slug `income_tax` where a "
     "section reference belongs."),
    ("fy_of",
     "The Indian financial year. Three copies existed; an off-by-one raises "
     "nothing and reports one year's turnover against another year's threshold."),
])
def test_no_module_defines_its_own_copy(helper, why):
    """Walks `services/` and reads the SOURCE, the way the due-date resolver's
    ratchet does. A module may import it or alias it; a module may not define
    its own. A sixth copy fails here without anybody remembering it exists."""
    root = pathlib.Path(__file__).resolve().parent.parent / "services"
    assert root.is_dir(), f"{root} is not a directory — the search would be vacuous"

    canonical = root / "statute.py"
    assert canonical.is_file(), "services/statute.py is gone — check this test"
    assert re.search(
        rf"^def\s+{helper}\s*\(",
        canonical.read_text(encoding="utf-8", errors="replace"), re.M), (
        f"services/statute.py does not define {helper} — this test would "
        f"otherwise pass by finding no copies of a function nobody has"
    )

    scanned, offenders = 0, []
    for path in root.rglob("*.py"):
        if path == canonical:
            continue
        scanned += 1
        text = path.read_text(encoding="utf-8", errors="replace")
        if re.search(rf"^def\s+_?{helper}\s*\(", text, re.M):
            offenders.append(str(path.relative_to(root.parent)))

    assert scanned > 50, f"only {scanned} python files under {root} — walk is broken"
    assert not offenders, (
        f"these modules define their own `{helper}` instead of importing "
        f"`services.statute.{helper}`:\n  " + "\n  ".join(offenders) +
        "\n\n" + why
    )


def test_every_caller_shares_the_one_citation():
    """The other half: importing it is not enough if the name is then rebound."""
    from services.skills.data import (
        client_register, firm_flow, gst_year, payroll_statutory, vendor_compliance,
    )
    for mod in (client_register, firm_flow, gst_year, payroll_statutory,
                vendor_compliance):
        assert mod._statute_note is statute_note, (
            f"{mod.__name__}._statute_note is not services.statute.statute_note"
        )


def test_every_caller_shares_the_one_financial_year():
    from services.skills.data import (
        delta_and_provenance, gst_year, payroll_statutory, vendor_compliance,
    )
    for mod in (gst_year, payroll_statutory, vendor_compliance):
        assert mod._fy_of is fy_of, (
            f"{mod.__name__}._fy_of is not services.statute.fy_of"
        )
    assert delta_and_provenance.fy_of is fy_of, (
        "delta_and_provenance reached into gst_year for the financial year; it "
        "must import it from the module that owns the calendar"
    )


# ══════════════════════════════════════════════════════════════════════════════
#  LIVE — the removed fallback costing nothing is a claim about the DATA
# ══════════════════════════════════════════════════════════════════════════════

#: `conftest.py` sets DATABASE_URL to this so the offline suite has something to
#: import against. Read inside the test, because conftest sets it after import.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"


def _live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    return dsn if dsn and dsn != _PLACEHOLDER_DSN else None


def test_every_row_in_the_production_calendar_cites_something():
    """Dropping the `authority` fallback loses nothing ONLY while every row
    carries a form, a section or an Act. That is a fact about the table, it was
    measured once (70 of 70 on 2026-09-03), and a fact measured once is a fact
    that expires. This is what notices when a row is seeded without one — at
    which point the answer is to give that row its citation, never to widen the
    fallback to the slug."""
    dsn = _live_dsn()
    if not dsn:
        pytest.skip(
            "no live database. This half reads the real statute calendar. Run it "
            "with:" + chr(10) +
            "    railway run -s Kartavya -- env REDIS_URL= python -m pytest "
            "tests/test_the_citation_has_one_implementation.py -q"
        )

    import asyncpg

    async def run():
        conn = await asyncpg.connect(dsn, statement_cache_size=0)
        try:
            return await conn.fetch(
                "SELECT obligation_key, title, authority, statute, form_number, "
                "       section_ref "
                "FROM public.statute_calendar"
            )
        finally:
            await conn.close()

    rows = [dict(r) for r in asyncio.run(run())]
    assert len(rows) > 20, f"only {len(rows)} calendar rows — the read is broken"

    uncited = [r for r in rows if statute_note(r, "x") == (r.get("title") or "x")]
    assert not uncited, (
        "these calendar rows would print a bare title with no citation:\n  " +
        "\n  ".join(f"{r['obligation_key']} (authority={r['authority']!r})"
                    for r in uncited)
    )
