"""test_statute.py — the dated statute table, and the test that is the point.

THE DELIVERABLE is `test_the_tds_forms_are_renumbered_on_1_april_2026`: the same
obligation, asked for on 31 March 2026 and on 1 April 2026, must come back with
DIFFERENT form numbers. Everything else here supports it.

── THESE TESTS RUN AGAINST THE REAL SEED ────────────────────────────────────
The rows are PARSED OUT OF `migrations/158_statute_calendar.sql`, not written
here. That is deliberate and it is the only way this file proves anything: a
fixture hand-written to agree with services/statute.py would pass green while
the migration seeded 24Q with the wrong end date, and the whole product would
ship a return that TRACES rejects. Coupling the test to the migration means the
seed and the resolver are asserted together or not at all.

The pool is a fake because the suite has no database (tests/conftest.py swaps in
a MagicMock). The fake does only what the SQL does — narrow by key, authority,
prefix, periodicity and state — and NOTHING the service does: every date
decision under test runs in the real resolver in services/statute.py, which is
why that resolver lives in Python (its docstring says so at length). The SQL
itself is asserted separately, by shape, in `TestTheSqlShape`.
"""
import re
from datetime import date, datetime
from pathlib import Path

import pytest

from services import statute
from services.statute import StatuteError

MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations" / "158_statute_calendar.sql"
)

_DATE_COLS = {"effective_from", "effective_to", "verified_on"}
_INT_COLS = {"due_day", "due_month", "due_month_offset", "window_days"}


# ── parsing the seed out of the migration ────────────────────────────────────

def _strip_comment(text: str, i: int) -> int:
    """Skip a `--` comment to end of line. Only ever called outside a quote."""
    nl = text.find("\n", i)
    return len(text) if nl == -1 else nl


def _scan(text: str, stop_at_top_level_comma: bool = False) -> list[str]:
    """Split `text` into top-level parenthesised groups, or into top-level
    comma-separated fields when `stop_at_top_level_comma` is set.

    Single-quote aware (with `''` as the escaped quote) and `--`-comment aware,
    because the seed carries a comment line between each block of rows and note
    text full of commas, parentheses and apostrophes. A naive `text.split('),')`
    would have cut a row in half at the first note that mentioned "s.16(4)".
    """
    out: list[str] = []
    buf: list[str] = []
    depth = 0
    in_quote = False
    i = 0
    n = len(text)

    while i < n:
        ch = text[i]

        if in_quote:
            if ch == "'":
                if text[i + 1:i + 2] == "'":
                    buf.append("''")
                    i += 2
                    continue
                in_quote = False
            buf.append(ch)
            i += 1
            continue

        if ch == "'":
            in_quote = True
            buf.append(ch)
            i += 1
            continue

        if ch == "-" and text[i + 1:i + 2] == "-":
            i = _strip_comment(text, i)
            continue

        if stop_at_top_level_comma:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            elif ch == "," and depth == 0:
                out.append("".join(buf))
                buf = []
                i += 1
                continue
            buf.append(ch)
            i += 1
            continue

        if ch == "(":
            depth += 1
            if depth == 1:
                buf = []
                i += 1
                continue
        elif ch == ")":
            depth -= 1
            if depth == 0:
                out.append("".join(buf))
                i += 1
                continue

        if depth >= 1:
            buf.append(ch)
        i += 1

    if stop_at_top_level_comma:
        out.append("".join(buf))
    return out


def _literal(token: str, column: str):
    tok = token.strip()
    if tok.upper() == "NULL":
        return None
    if tok.upper() == "TRUE":
        return True
    if tok.upper() == "FALSE":
        return False
    if tok.startswith("'") and tok.endswith("'"):
        value = tok[1:-1].replace("''", "'")
        if column in _DATE_COLS:
            # Asserted, not tolerated: the seed must use plain ISO dates so that
            # what Postgres will cast and what this parser reads are the same
            # string. A `DATE '2026-04-01'` or a `to_date(...)` here would parse
            # as text and every date comparison below would raise instead of
            # failing with a useful message.
            assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", value), (
                f"{column} must be a plain ISO date literal, got {value!r}"
            )
            return date.fromisoformat(value)
        return value
    if column in _INT_COLS:
        return int(tok)
    return float(tok) if "." in tok else int(tok)


def _seed_rows() -> list[dict]:
    sql = MIGRATION.read_text(encoding="utf-8")
    head = re.search(
        r"INSERT INTO staging\.statute_calendar\s*\(([^)]*)\)\s*VALUES", sql
    )
    assert head, "the seed INSERT is not where the tests expect it"
    columns = [c.strip() for c in head.group(1).replace("\n", " ").split(",") if c.strip()]

    tail = sql.index("ON CONFLICT ON CONSTRAINT", head.end())
    groups = _scan(sql[head.end():tail])
    assert groups, "no seed rows were parsed out of the migration"

    rows = []
    for group in groups:
        fields = _scan(group, stop_at_top_level_comma=True)
        assert len(fields) == len(columns), (
            f"seed row has {len(fields)} values for {len(columns)} columns: "
            f"{group[:120]!r}"
        )
        rows.append({c: _literal(f, c) for c, f in zip(columns, fields)})
    return rows


SEED = _seed_rows()


# ── a pool that does only what the SQL does ──────────────────────────────────

class FakePool:
    """Applies the WHERE clauses of services/statute.py and nothing else."""

    def __init__(self, rows=None):
        self.rows = list(SEED if rows is None else rows)
        self.calls: list[tuple] = []

    async def fetch(self, sql, *args):
        self.calls.append((sql, args))

        if "obligation_key = $1::text" in sql:
            key, state = args
            return [
                r for r in self.rows
                if r["obligation_key"] == key
                and (r["state_code"] is None or r["state_code"] == state)
            ]

        authority, prefix, periodicity, state = args
        return [
            r for r in self.rows
            if (authority is None or r["authority"] == authority)
            and (prefix is None or r["obligation_key"].startswith(prefix))
            and (periodicity is None or r["periodicity"] == periodicity)
            and (r["state_code"] is None or r["state_code"] == state)
        ]


@pytest.fixture
def pool():
    return FakePool()


# ── THE DELIVERABLE ──────────────────────────────────────────────────────────

#: obligation_key -> (form before 1 April 2026, form on and after it).
#: Income-tax Act 2025, in force 1 April 2026.
RENUMBERED = {
    "tds.certificate.salary":    ("16",   "130"),
    "tds.certificate.nonsalary": ("16A",  "131"),
    "tds.statement.salary":      ("24Q",  "138"),
    "tds.statement.nonsalary":   ("26Q",  "140"),
    "tds.statement.nonresident": ("27Q",  "144"),
    "tcs.statement":             ("27EQ", "143"),
}

LAST_DAY_OF_THE_OLD_ACT = date(2026, 3, 31)
FIRST_DAY_OF_THE_NEW_ACT = date(2026, 4, 1)


class TestTheFormNumberChangesWithTheDate:

    @pytest.mark.parametrize("key,forms", list(RENUMBERED.items()))
    async def test_the_tds_forms_are_renumbered_on_1_april_2026(self, pool, key, forms):
        """THE test. One obligation, two dates one day apart, two form numbers.

        This is the failure the whole table exists to prevent: a skill that
        hardcodes '24Q' keeps answering confidently and the return is rejected
        at TRACES for a payment made on or after 1 April 2026.
        """
        old, new = forms

        before = await statute.obligation(pool, key, as_of=LAST_DAY_OF_THE_OLD_ACT)
        after = await statute.obligation(pool, key, as_of=FIRST_DAY_OF_THE_NEW_ACT)

        assert before is not None and after is not None, f"{key} is not seeded"
        assert before["form_number"] == old
        assert after["form_number"] == new
        assert before["form_number"] != after["form_number"]

    async def test_the_boundary_is_half_open_not_inclusive(self, pool):
        """31 March is the last 24Q day; 1 April is the first 138 day.

        Written as its own test because an inclusive `effective_to` would still
        pass the parametrised test above if the seed ALSO shifted the start of
        the 138 row — and would then leave 1 April 2026 answering both, or
        neither, depending on row order.
        """
        rows = [r for r in SEED if r["obligation_key"] == "tds.statement.salary"]
        old = next(r for r in rows if r["form_number"] == "24Q")
        new = next(r for r in rows if r["form_number"] == "138")

        assert old["effective_to"] == new["effective_from"] == FIRST_DAY_OF_THE_NEW_ACT
        assert new["effective_to"] is None

        on_the_day = await statute.obligation(
            pool, "tds.statement.salary", as_of=FIRST_DAY_OF_THE_NEW_ACT
        )
        assert on_the_day["form_number"] == "138"

    async def test_the_sections_were_renumbered_with_the_forms(self, pool):
        """206AA -> s.397(2) and 43B(h) -> s.37(2)(g), same boundary.

        services/statutory_ids.py and services/doc_validation.py both name
        s.206AA in prose, and services/statement_pdf.py prints "section 43B(h)"
        onto a statement of account. None of the three carries a date.
        """
        for key, old, new in (
            ("tds.higher_rate_no_pan", "s.206AA", "s.397(2)"),
            ("msme.payment_disallowance", "s.43B(h)", "s.37(2)(g)"),
        ):
            before = await statute.obligation(pool, key, as_of=LAST_DAY_OF_THE_OLD_ACT)
            after = await statute.obligation(pool, key, as_of=FIRST_DAY_OF_THE_NEW_ACT)
            assert before["section_ref"] == old
            assert after["section_ref"] == new

    async def test_fy_2025_26_is_the_old_forms_and_fy_2026_27_the_new(self, pool):
        """The same flip asked in the language a preparer actually uses.

        Note what this proves about TIMING: the Q4 FY 2025-26 statement is
        PREPARED in May 2026, after the new Act is in force, and it is still a
        24Q — because the anchor is the date of the payment, not the date of
        filing. A caller that defaulted as_of to "today" would get 138 and file
        a return TRACES rejects.
        """
        old = await statute.obligation_for_fy(pool, "tds.statement.salary", "2025-26")
        new = await statute.obligation_for_fy(pool, "tds.statement.salary", "2026-27")

        assert old["form_number"] == "24Q"
        assert new["form_number"] == "138"
        assert old["stable_across_year"] is True, (
            "the 2025 Act came in on an FY boundary, so no TDS fact may move "
            "mid-year — if this fails, a seeded date is wrong"
        )
        assert new["stable_across_year"] is True


class TestTheDateIsNotOptional:
    """The signature has to enforce it. A docstring would not."""

    async def test_asking_without_a_date_is_a_type_error(self, pool):
        with pytest.raises(TypeError):
            await statute.obligation(pool, "tds.statement.salary")

    async def test_a_positional_date_is_refused(self, pool):
        # as_of is keyword-only so that `obligation(pool, key, some_org_id)`
        # cannot ever be read as a date by accident.
        with pytest.raises(TypeError):
            await statute.obligation(pool, "tds.statement.salary", date(2026, 4, 1))

    async def test_none_is_not_a_date_and_does_not_mean_today(self, pool):
        with pytest.raises(StatuteError):
            await statute.obligation(pool, "tds.statement.salary", as_of=None)

    async def test_a_date_string_is_refused_rather_than_parsed(self, pool):
        # Accepting '2026-04-01' would invite '01/04/2026', which is 1 April to
        # every user of this product and 4 January to strptime's %m/%d/%Y.
        with pytest.raises(StatuteError):
            await statute.obligation(pool, "tds.statement.salary", as_of="2026-04-01")

    async def test_a_datetime_is_accepted_and_narrowed(self, pool):
        row = await statute.obligation(
            pool, "tds.statement.salary", as_of=datetime(2026, 3, 31, 23, 59)
        )
        assert row["form_number"] == "24Q"


class TestGstRates:

    @pytest.mark.parametrize("key", ["gst.rate.12", "gst.rate.28"])
    async def test_12_and_28_died_on_22_september_2025(self, pool, key):
        assert await statute.obligation(pool, key, as_of=date(2025, 9, 21)) is not None
        assert await statute.obligation(pool, key, as_of=date(2025, 9, 22)) is None

    async def test_40_was_born_the_same_day(self, pool):
        assert await statute.obligation(pool, "gst.rate.40", as_of=date(2025, 9, 21)) is None
        row = await statute.obligation(pool, "gst.rate.40", as_of=date(2025, 9, 22))
        assert row is not None and float(row["rate_percent"]) == 40

    async def test_the_live_slabs_today_are_0_5_18_and_40(self, pool):
        rows = await statute.obligations(
            pool, as_of=date(2026, 8, 19), key_prefix="gst.rate."
        )
        assert sorted(float(r["rate_percent"]) for r in rows) == [0, 5, 18, 40]

    async def test_a_slab_born_mid_year_is_flagged_unstable(self, pool):
        """THE negative case for stable_across_year, and the one that was missing.

        FY 2025-26 contains 22 September 2025. The 40% slab did not exist on
        1 April 2025, so 'the 40% slab in FY 2025-26' is not a fact that held all
        year and the caller must be told so — otherwise a year-shaped question
        gets a year-shaped answer that is false for the first five and a half
        months of it.

        This is the assertion that was absent: before it, hardcoding
        `stable_across_year = True` in services/statute.py passed the entire
        file. The flag was reported by three tests and proved by none, because
        every fact they asked about happened to change on 1 April — an FY
        boundary — where counting versions and checking the start date agree.
        """
        rate40 = await statute.obligation_for_fy(pool, "gst.rate.40", "2025-26")
        assert rate40 is not None and float(rate40["rate_percent"]) == 40
        assert rate40["stable_across_year"] is False, (
            "gst.rate.40 begins 22 September 2025 — a single version is not the "
            "same thing as a version that held all year"
        )

        # ...and the next year, which it does cover from 1 April, is stable.
        assert (await statute.obligation_for_fy(
            pool, "gst.rate.40", "2026-27"))["stable_across_year"] is True

    async def test_a_slab_that_survived_the_whole_year_is_stable(self, pool):
        row = await statute.obligation_for_fy(pool, "gst.rate.18", "2025-26")
        assert row["stable_across_year"] is True

    async def test_a_slab_that_died_mid_year_resolves_to_none(self, pool):
        """Documented asymmetry, asserted so it cannot drift into a surprise:
        obligation_for_fy resolves at the year END, so a fact that died inside
        the year with no successor is None rather than an unstable row. 12% was
        live for half of FY 2025-26 and this function will not say so — a caller
        enumerating every slab that applied during a year must walk dates."""
        assert await statute.obligation_for_fy(pool, "gst.rate.12", "2025-26") is None
        assert await statute.obligation_for_fy(pool, "gst.rate.12", "2024-25") is not None

    async def test_a_replacement_mid_year_is_also_flagged_unstable(self, pool):
        """SYNTHETIC — the seed has no mid-year REPLACEMENT (the 2025 Act landed
        on 1 April and the GST rationalisation replaced nothing within one key).
        Both halves of the flag need coverage, so this builds the case the seed
        cannot supply: one key, two versions, the cut on 22 September 2025."""
        base = dict(SEED[0])
        old = dict(base, obligation_key="synthetic.key", form_number="OLD",
                   effective_from=date(2020, 1, 1), effective_to=date(2025, 9, 22))
        new = dict(base, obligation_key="synthetic.key", form_number="NEW",
                   effective_from=date(2025, 9, 22), effective_to=None)
        p = FakePool([old, new])

        row = await statute.obligation_for_fy(p, "synthetic.key", "2025-26")
        assert row["form_number"] == "NEW"
        assert row["stable_across_year"] is False

        # The year on either side of the cut carries one version for its whole
        # length, so both are stable — this is what stops the fix above from
        # being "always False", which would pass the assertion but say nothing.
        assert (await statute.obligation_for_fy(
            p, "synthetic.key", "2024-25"))["stable_across_year"] is True
        assert (await statute.obligation_for_fy(
            p, "synthetic.key", "2026-27"))["stable_across_year"] is True

    async def test_two_overlapping_versions_are_flagged_unstable(self, pool):
        """The other half of the flag, which nothing else reaches.

        Checking only that the resolved version started before 1 April is enough
        for every well-formed row, so the version COUNT looks redundant — until
        the data is defective. Two overlapping CLOSED versions are forbidden by
        no constraint at all: statute_calendar_one_open_version_idx catches only
        the two-open-ended case, and an EXCLUDE over a daterange would need
        btree_gist, which 158 declines to install. So the count is the only thing
        standing between a caller and a confident single answer drawn from two
        rows that disagree, and it is asserted here so it is not deleted as dead.
        """
        base = dict(SEED[0], obligation_key="synthetic.overlap", state_code=None)
        a = dict(base, form_number="A",
                 effective_from=date(2020, 1, 1), effective_to=date(2030, 1, 1))
        b = dict(base, form_number="B",
                 effective_from=date(2021, 1, 1), effective_to=date(2031, 1, 1))
        p = FakePool([a, b])

        row = await statute.obligation_for_fy(p, "synthetic.overlap", "2025-26")
        assert row["form_number"] == "B", "the later start wins, deterministically"
        assert row["stable_across_year"] is False, (
            "both versions cover the whole year and they disagree — the answer "
            "must not be presented as the year's single fact"
        )


class TestDueDates:

    @pytest.mark.parametrize("key,day", [
        ("gst.return.gstr1", 11),
        ("gst.return.gstr3b", 20),
        ("epf.remittance", 15),
        ("esi.remittance", 15),
    ])
    async def test_the_monthly_due_days(self, pool, key, day):
        row = await statute.obligation(pool, key, as_of=date(2026, 8, 19))
        assert row["due_day"] == day
        assert row["periodicity"] == "monthly"

    async def test_the_tds_statements_carry_no_due_day(self, pool):
        """Q1-Q3 fall on the 31st of the following month and Q4 on 31 May, so
        there is no day-of-month rule to encode. NULL and a note beats a number
        that is confidently wrong four times a year."""
        for as_of in (LAST_DAY_OF_THE_OLD_ACT, date(2026, 8, 19)):
            row = await statute.obligation(pool, "tds.statement.salary", as_of=as_of)
            assert row["due_day"] is None

        # The schedule itself is recorded in prose on the 1961-Act row. The
        # 2025-Act row deliberately carries NO due date at all: the form
        # renumbering was verified, the dates were not, and inventing them is
        # the same failure as hardcoding them.
        old = await statute.obligation(
            pool, "tds.statement.salary", as_of=LAST_DAY_OF_THE_OLD_ACT
        )
        assert "31 May" in old["notes"]

    async def test_the_itc_bar_is_the_outer_limit_only(self, pool):
        row = await statute.obligation(pool, "gst.itc.time_limit", as_of=date(2026, 8, 19))
        assert (row["due_day"], row["due_month"]) == (30, 11)
        assert row["section_ref"] == "s.16(4)"
        assert "annual return" in row["notes"], (
            "s.16(4) bars ITC at the EARLIER of 30 November or the annual "
            "return date — a caller reading only due_day/due_month would tell a "
            "firm it still has time when it does not"
        )

    async def test_rule_37_reverses_at_180_days(self, pool):
        row = await statute.obligation(
            pool, "gst.itc.reversal.unpaid_supplier", as_of=date(2026, 8, 19)
        )
        assert row["window_days"] == 180
        assert row["periodicity"] == "event"
        assert "4B(2)" in row["notes"] and "4A(5)" in row["notes"]


class TestPrecedenceAndListing:

    async def test_a_state_row_outranks_the_all_india_row(self):
        """SYNTHETIC rows — 158 seeds no state-specific fact, deliberately, and
        this is the behaviour that must already work when the first verified one
        arrives (the GSTR-3B QRMP 22nd/24th State groups being the obvious
        candidate)."""
        all_india = dict(SEED[0])
        all_india.update(
            obligation_key="ptax.return", state_code=None, form_number="ALL",
            effective_from=date(2020, 1, 1), effective_to=None,
        )
        maharashtra = dict(all_india, state_code="MH", form_number="MH-ONLY")
        pool = FakePool([all_india, maharashtra])

        plain = await statute.obligation(pool, "ptax.return", as_of=date(2026, 8, 19))
        scoped = await statute.obligation(
            pool, "ptax.return", as_of=date(2026, 8, 19), state_code="MH"
        )
        assert plain["form_number"] == "ALL"
        assert scoped["form_number"] == "MH-ONLY"

    async def test_a_listing_returns_one_row_per_obligation(self, pool):
        rows = await statute.obligations(pool, as_of=FIRST_DAY_OF_THE_NEW_ACT)
        keys = [r["obligation_key"] for r in rows]
        assert len(keys) == len(set(keys)), (
            "a listing that returned both the 24Q row and the 138 row would "
            "leave the reader to guess which one applies"
        )
        assert keys == sorted(keys)

        forms = {r["obligation_key"]: r["form_number"] for r in rows}
        assert forms["tds.statement.salary"] == "138"

    async def test_the_same_listing_a_day_earlier_is_the_old_law(self, pool):
        rows = await statute.obligations(pool, as_of=LAST_DAY_OF_THE_OLD_ACT)
        forms = {r["obligation_key"]: r["form_number"] for r in rows}
        assert forms["tds.statement.salary"] == "24Q"

    async def test_filters_narrow_without_changing_resolution(self, pool):
        gst = await statute.obligations(pool, as_of=date(2026, 8, 19), authority="gst")
        assert gst and all(r["authority"] == "gst" for r in gst)

        monthly = await statute.obligations(
            pool, as_of=date(2026, 8, 19), periodicity="monthly"
        )
        assert {r["obligation_key"] for r in monthly} == {
            "gst.return.gstr1", "gst.return.gstr3b",
            "epf.remittance", "esi.remittance",
        }

    async def test_an_unknown_key_is_none_not_an_error(self, pool):
        # A deliberately incomplete catalogue must answer "I don't know" without
        # taking a skill down with it.
        assert await statute.obligation(pool, "no.such.key", as_of=date(2026, 8, 19)) is None


class TestFinancialYears:

    @pytest.mark.parametrize("fy,expected", [
        ("2025-26", (date(2025, 4, 1), date(2026, 3, 31))),
        ("2026-2027", (date(2026, 4, 1), date(2027, 3, 31))),
        ("2099-00", (date(2099, 4, 1), date(2100, 3, 31))),
    ])
    def test_bounds(self, fy, expected):
        assert statute.fy_bounds(fy) == expected

    @pytest.mark.parametrize("fy", ["2025", "2025-27", "", None, "twenty-five"])
    def test_junk_is_refused(self, fy):
        with pytest.raises(StatuteError):
            statute.fy_bounds(fy)


class TestTheSqlShape:
    """The pool is a mock, so nothing else in this file would notice bad SQL."""

    def test_every_query_is_schema_qualified(self):
        for sql in (statute._SELECT_BY_KEY, statute._SELECT_LISTING):
            assert "public.statute_calendar" in sql
            assert re.search(r"FROM\s+statute_calendar", sql) is None

    def test_every_parameter_is_cast(self):
        """PgBouncer turns an untyped parse error into an instant 500 — the
        credits incident. Every $n in these two statements is compared against a
        text column, so every $n must carry ::text."""
        for sql in (statute._SELECT_BY_KEY, statute._SELECT_LISTING):
            for placeholder in set(re.findall(r"\$\d+", sql)):
                assert f"{placeholder}::" in sql, f"{placeholder} is uncast in {sql}"

    def test_nothing_is_interpolated_except_the_column_list(self):
        """The only dynamic text in either statement is `_COLS`, which is a
        module constant — the server-side allowlist, not caller input."""
        for sql in (statute._SELECT_BY_KEY, statute._SELECT_LISTING):
            assert "{" not in sql and "%s" not in sql

    def test_the_prefix_filter_does_not_use_like(self):
        # `_` is a LIKE wildcard and `tds.higher_rate_no_pan` contains three.
        assert "starts_with(" in statute._SELECT_LISTING
        assert "LIKE" not in statute._SELECT_LISTING.upper()


class TestTheMigrationItself:

    def test_it_is_additive_only(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        body = "\n".join(
            line for line in sql.splitlines() if not line.lstrip().startswith("--")
        ).upper()
        for forbidden in ("DROP ", "DELETE ", "TRUNCATE ", "UPDATE ", "ALTER TABLE"):
            assert forbidden not in body, (
                f"158 must touch nothing that already exists; found {forbidden!r}"
            )

    def test_it_is_idempotent(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        assert "CREATE TABLE IF NOT EXISTS staging.statute_calendar" in sql
        assert sql.count("CREATE INDEX IF NOT EXISTS") + sql.count(
            "CREATE UNIQUE INDEX IF NOT EXISTS"
        ) == 3
        assert "ON CONFLICT ON CONSTRAINT statute_calendar_version_uniq DO NOTHING" in sql

    def test_the_uniqueness_arbiter_treats_null_states_as_equal(self):
        """Under default NULL semantics the ON CONFLICT above is a no-op and a
        second apply duplicates every all-India row — silently, because DO
        NOTHING never complains."""
        sql = MIGRATION.read_text(encoding="utf-8")
        assert "UNIQUE NULLS NOT DISTINCT (obligation_key, state_code, effective_from)" in sql

    def test_at_most_one_open_version_per_key_and_state(self):
        """The seed must already satisfy statute_calendar_one_open_version_idx,
        or applying 158 fails halfway through its own INSERT."""
        open_ended = [r for r in SEED if r["effective_to"] is None]
        pairs = [(r["obligation_key"], r["state_code"]) for r in open_ended]
        assert len(pairs) == len(set(pairs)), f"two current versions: {pairs}"

    def test_no_two_versions_of_one_obligation_overlap(self):
        """Not enforced by any constraint — an EXCLUDE constraint would need
        btree_gist, and installing an extension is not an additive migration.
        So it is enforced here instead, over the seed."""
        by_key: dict[tuple, list] = {}
        for row in SEED:
            by_key.setdefault((row["obligation_key"], row["state_code"]), []).append(row)

        for key, rows in by_key.items():
            rows.sort(key=lambda r: r["effective_from"])
            for earlier, later in zip(rows, rows[1:]):
                assert earlier["effective_to"] is not None, (
                    f"{key}: an open-ended version is followed by another"
                )
                assert earlier["effective_to"] <= later["effective_from"], (
                    f"{key}: {earlier['form_number']} and {later['form_number']} "
                    "are both in force at once"
                )

    def test_every_row_declares_when_it_was_verified(self):
        assert all(r["verified_on"] is not None for r in SEED)

    def test_a_floor_start_date_is_marked_as_one(self):
        """1962-04-01 is a placeholder, not a commencement. Nothing may print
        'in force since 1 April 1962' off the back of it."""
        for row in SEED:
            if row["effective_from"] == date(1962, 4, 1):
                assert row["effective_from_exact"] is False

    def test_no_section_is_asserted_for_the_2025_act_beyond_the_two_verified(self):
        """Only 206AA -> 397(2) and 43B(h) -> 37(2)(g) were verified. Every other
        row that begins on 1 April 2026 must leave section_ref NULL rather than
        guess — guessing a section number is the failure this table prevents."""
        verified = {"s.397(2)", "s.37(2)(g)"}
        for row in SEED:
            if row["effective_from"] == FIRST_DAY_OF_THE_NEW_ACT:
                assert row["section_ref"] is None or row["section_ref"] in verified
