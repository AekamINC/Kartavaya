"""Payroll stopped paying leavers, and professional tax stopped being one rate.

Phase 2.1 and 2.2 — the two payroll faults in
`docs/plans/PHASE-2-correctness-fixes.md` where the product does not merely
lack a value but produces a WRONG one, on money, on a document a person keeps.

── 2.1 · TEN PEOPLE WHO HAD LEFT WERE ON EVERY PAYROLL RUN ──────────────────

The monthly structures query joined `manav_employees` on `e.is_active = TRUE`
and nothing else. `is_active` is a flag somebody has to remember to clear; the
last working day is a fact somebody already recorded. Measured read-only on the
live database 2026-08-25:

    active employees with a non-cancelled exit dated in the past   10
    ...of those, carrying an ACTIVE salary structure               10

so all ten were written a payslip every month. The fix mirrors the HR path —
`analytics/metrics/manav.py:_headcount_asat` (:65-84), which reconstructs who
was on the rolls at a date — rather than inventing a second shape for the same
question.

── 2.2 · ₹200 OF PROFESSIONAL TAX IN EVERY STATE ────────────────────────────

`pt = 200 if pt_on and gross > 15000 else 0`, for a levy that is charged by
STATES, at rates that differ, and not at all in several. Measured read-only
2026-08-25 on `staging.vetana_payslips`:

    professional_tax = 200.00    1,105 payslips
    professional_tax =   0.00        7 payslips

which is that one line and nothing else. Meanwhile `staging.pay_professional_tax`
holds a real nine-row ladder that nothing read. Its live contents — the fixture
below is a transcript of them, not an invention:

    Gujarat     '24'        0–5,999 → 0     6,000–8,999 → 80
                        9,000–11,999 → 150     12,000+ → 200
    Maharashtra '27'        0–7,500 → 0     7,501–10,000 → 175   10,001+ → 200
    Karnataka   '29'       0–14,999 → 0        15,000+ → 200

Read those three ladders at a gross of ₹10,000 and they pay ₹150, ₹175 and ₹0.
That is the whole point of the change, and the test that says so is
`test_the_same_gross_pays_a_different_rate_in_each_state`.

── WHY NO ROW IS SEEDED, AND WHAT IS DONE INSTEAD ───────────────────────────

The acceptance criterion in the plan says "a test seeds one leaver". IT CANNOT.
Staging and production share one Supabase database (CLAUDE.md, "The one
dangerous fact"), so seeding a leaver would write a `manav_offboarding` row into
production. Nothing in this file writes anything anywhere.

What replaces it is stronger than a seeded row in one respect and weaker in
another, and both are stated rather than glossed:

  · STRONGER — the live half runs the fixed query and the OLD unguarded query
    against the real database, read-only, and asserts that the rows the fix
    removes are exactly the people with a past exit date, in the real data,
    at whatever scale it is at today. A seeded row would have proved it for one
    fabricated person.
  · WEAKER — no payslip is written, so "was not paid" is proved at the query
    that decides who is paid, not at the row that would have been inserted.
    `process_payroll` writes one payslip per row this query returns and nothing
    else creates one, which is what makes the substitution sound; it is still a
    substitution.

The live half SKIPS with no database, which is how the whole suite behaves
(`test_skill_sql_is_valid.py` set the pattern and the reasoning). Run it with:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_payroll_leavers_and_pt_slabs.py -q

── AND WHY A MOCK POOL IS NOT ALLOWED TO BE THE WHOLE STORY ─────────────────

"A mock pool hides bad SQL" is a rule in this repo because a MagicMock answers
`[]` to valid SQL, invalid SQL and a shopping list alike. So the statements this
file captures are also PARSED against the real catalogue — `conn.prepare()`
sends Parse and Describe and stops, reading no row and writing none.
"""
import asyncio
import inspect
import os
import re
from datetime import date

import pytest

import routers.vetana as vetana
from middleware.role_tiers import ADMIN

ORG = "045b76ad-654b-42dd-b4b1-731700efc6c3"
RUN_ID = "11111111-1111-4111-8111-111111111111"
USER = {"user_id": "user_admin001", "email": "admin@example.com"}

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing, and it is recognised BY VALUE because `setdefault` means
#: the variable is never absent — a bare presence check would try to connect to
#: a host that does not exist and report the timeout as a failure.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What the app's own pool does on every connection (`db.py`), so a statement is
#: planned the way it will actually be planned.
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. These checks parse payroll's SQL against the real "
    "catalogue and compare the leaver guard against real rows; neither can be "
    "done offline. Run them with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_payroll_leavers_and_pt_slabs.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


# ══════════════════════════════════════════════════════════════════════════
#  Capture — the statements payroll actually issues. No database.
# ══════════════════════════════════════════════════════════════════════════

class _Stop(Exception):
    """Everything under test has been seen; stop the run here.

    Deliberate rather than letting `process_payroll` run to completion against
    a fake pool: past this point it renders PDFs, sends payslip notifications
    and emits Niyam subjects, none of which this file is about. A bounded stop
    keeps a payroll test from becoming a test of the mailer.
    """


class _CapturePool:
    """Records every statement and answers with just enough to keep going.

    It holds no connection. Nothing it is handed reaches a database — including
    the `INSERT INTO staging.vetana_payroll_runs` that `process_payroll` issues
    before it reads the structures, which is recorded and discarded like every
    other string.
    """

    def __init__(self, state_col: str | None = None):
        self.statements: list[tuple[str, tuple]] = []
        self.state_col = state_col

    def _record(self, sql, args):
        self.statements.append((sql, args))

    def find(self, needle: str) -> tuple[str, tuple]:
        for sql, args in self.statements:
            if needle in sql:
                return sql, args
        raise AssertionError(
            f"payroll issued no statement containing {needle!r}. It issued:\n"
            + "\n".join(re.sub(r"\s+", " ", s)[:110] for s, _ in self.statements))

    async def fetchval(self, sql, *args):
        self._record(sql, args)
        if "information_schema.columns" in sql and "manav_employees" in sql:
            return self.state_col
        if "information_schema.columns" in sql:
            return None
        return 0

    async def fetchrow(self, sql, *args):
        self._record(sql, args)
        if "INSERT INTO staging.vetana_payroll_runs" in sql:
            return {"id": RUN_ID}
        return None

    async def fetch(self, sql, *args):
        self._record(sql, args)
        if "staging.vetana_salary_structures s" in sql:
            raise _Stop()
        return []

    async def execute(self, sql, *args):
        self._record(sql, args)
        return "DELETE 0"


def capture(month: str = "2026-08", state_col: str | None = None) -> _CapturePool:
    """Drive `process_payroll` far enough to see the structures query.

    `Depends` resolves for ROUTES only — a direct call gets the sentinel object
    — so every dependency is passed explicitly, which is also what makes the
    ADMIN grant visible in the test rather than implied.
    """
    pool = _CapturePool(state_col=state_col)

    async def _get_pool():
        return pool

    original = vetana.get_pool
    vetana.get_pool = _get_pool
    try:
        asyncio.run(vetana.process_payroll(
            body=vetana.PayrollProcessRequest(month=month),
            user=USER, org_id=ORG, levels=frozenset({ADMIN}),
        ))
    except _Stop:
        pass
    finally:
        vetana.get_pool = original
    return pool


def norm(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


@pytest.fixture(scope="module")
def structures():
    """The structures statement and its bound parameters, no state column —
    which is the shape that runs in production today."""
    sql, args = capture().find("staging.vetana_salary_structures s")
    return norm(sql), args


# ══════════════════════════════════════════════════════════════════════════
#  2.1 · the leaver guard
# ══════════════════════════════════════════════════════════════════════════

def test_the_structures_query_excludes_anyone_whose_exit_predates_the_month(structures):
    """THE BLOCKER. Ten live employees hold a past last working day and are
    still `is_active`, and all ten carry an active salary structure."""
    sql, args = structures
    assert "NOT EXISTS" in sql, (
        "the leaver guard is gone; payroll is back to trusting `is_active` "
        "alone, which ten live employees do not clear: %s" % sql)
    assert "staging.manav_offboarding x" in sql
    assert "x.last_working_day < $3::date" in sql, (
        "the guard no longer compares the exit date against the start of the "
        "month being paid: %s" % sql)
    # `<`, never `<=`: somebody whose last day IS the first of the month worked
    # that day and is owed it.
    assert "x.last_working_day <= " not in sql


def test_the_month_start_is_what_the_exit_date_is_compared_against(structures):
    """Bound, not interpolated, and it is the FIRST of the month being paid —
    the parameter is checked by value so a reordering cannot pass this."""
    _sql, args = structures
    assert args[0] == ORG
    assert args[1] == date(2026, 8, 31), "the effective_from bound moved"
    assert args[2] == date(2026, 8, 1), (
        "the third parameter is not the first of the month being paid, so the "
        "guard is comparing the exit date against something else: %r" % (args,))


def test_a_cancelled_exit_does_not_stop_somebody_being_paid(structures):
    """Migration 083's own vocabulary, and the same predicate its
    `manav_offboarding_one_live_per_employee` unique index uses so that a
    mistaken exit can be cancelled and redone. Live status counts, read-only
    2026-08-25: completed 3, in_clearance 3, initiated 2, settled 3."""
    sql, _args = structures
    assert "x.status <> 'cancelled'" in sql, (
        "a cancelled exit now stops payroll paying somebody who never left: "
        "%s" % sql)


def test_the_exit_row_is_scoped_to_the_org_as_well_as_the_employee(structures):
    """There is no composite foreign key from `manav_offboarding` to
    `manav_employees` — migration 083 says so in its header — so this predicate
    is the only thing stopping another org's exit row stopping this org's pay."""
    sql, _args = structures
    assert "x.org_id = e.org_id" in sql and "x.employee_id = e.id" in sql, sql


def test_the_guard_is_the_hr_paths_shape_and_not_a_second_one():
    """`analytics/metrics/manav.py:_headcount_asat` already answers "was this
    person on the rolls at date d". Payroll asks the same question at the start
    of the month it is paying, so it must ask it the same way — two shapes for
    one question is how the two come to disagree."""
    from analytics.metrics import manav as hr

    hr_sql = norm(inspect.getsource(hr._headcount_asat))
    for piece in ("staging.manav_offboarding x",
                  "x.org_id = e.org_id AND x.employee_id = e.id",
                  "x.status <> 'cancelled'",
                  "x.last_working_day"):
        assert piece in hr_sql, (
            "the HR path this guard was mirrored from has changed shape (%r is "
            "gone). Re-derive the payroll guard from it rather than leaving the "
            "two to drift." % piece)

    payroll_sql, _args = capture().find("staging.vetana_salary_structures s")
    payroll_sql = norm(payroll_sql)
    for piece in ("staging.manav_offboarding x",
                  "x.org_id = e.org_id AND x.employee_id = e.id",
                  "x.status <> 'cancelled'"):
        assert piece in payroll_sql, piece


def test_the_active_flag_is_still_required_as_well(structures):
    """The exit date is added TO `is_active`, not swapped for it. Somebody
    deactivated with no offboarding row at all is still off the payroll."""
    sql, _args = structures
    assert "e.is_active=TRUE" in sql or "e.is_active = TRUE" in sql, sql


def test_this_query_is_the_only_thing_that_decides_who_gets_a_payslip():
    """The step between "not in the query" and "not paid", written down.

    No row is seeded, so "the leaver is not paid" is proved at the query that
    decides who is paid rather than at the INSERT that would have paid them
    (the file docstring says why). That substitution is only sound while the
    query is the SOLE source of who gets a payslip — so this pins exactly that:
    one payslip INSERT in the whole handler, and it sits inside the loop over
    the rows this query returned.

    If a second INSERT ever appears, or the loop is ever fed from somewhere
    else, the leaver guard stops being sufficient and this fails rather than
    letting the gap reopen quietly.
    """
    src = inspect.getsource(vetana.process_payroll)
    assert src.count("INSERT INTO staging.vetana_payslips") == 1, (
        "payroll writes payslips from more than one place; excluding a leaver "
        "from the structures query no longer excludes them from the run")

    loop = "for s in unique_structures:"
    assert src.count(loop) == 1
    assert src.index("INSERT INTO staging.vetana_payslips") > src.index(loop), (
        "the payslip INSERT is no longer inside the loop over the structures")

    # …and `unique_structures` is built from the guarded query and nothing else.
    between = src[src.index("structures = await pool.fetch"):src.index(loop)]
    assert "unique_structures.append(s)" in between
    assert "for s in structures:" in between


def test_the_guard_is_not_an_inner_join_that_would_drop_everyone_else():
    """A `JOIN manav_offboarding` would pay only the leavers — the inversion of
    the bug, and a payroll run that pays nobody. NOT EXISTS keeps the 98
    employees who have no exit row at all."""
    sql, _args = capture().find("staging.vetana_salary_structures s")
    sql = norm(sql)
    assert "JOIN staging.manav_offboarding" not in sql, sql
    assert "NOT EXISTS" in sql


# ══════════════════════════════════════════════════════════════════════════
#  2.2 · professional tax, from the state's slab
# ══════════════════════════════════════════════════════════════════════════

def slab(state_code, state_name, low, high, tax, eff=date(2024, 4, 1)):
    return {"state_code": state_code, "state_name": state_name,
            "slab_from": low, "slab_to": high, "monthly_tax": tax,
            "effective_from": eff}


#: A TRANSCRIPT of `staging.pay_professional_tax`, read read-only 2026-08-25.
#: Nine rows, three states, every one carrying the same org_id — it is per-org
#: seed data, not a shared reference set.
LIVE_SLABS = [
    slab("24", "Gujarat", 0, 5999, 0),
    slab("24", "Gujarat", 6000, 8999, 80),
    slab("24", "Gujarat", 9000, 11999, 150),
    slab("24", "Gujarat", 12000, None, 200),
    slab("29", "Karnataka", 0, 14999, 0),
    slab("29", "Karnataka", 15000, None, 200),
    slab("27", "Maharashtra", 0, 7500, 0),
    slab("27", "Maharashtra", 7501, 10000, 175),
    slab("27", "Maharashtra", 10001, None, 200),
]


def pt(state, gross, slabs=LIVE_SLABS, **flags):
    structure = {"pf_enabled": False, "esi_enabled": False,
                 "pt_applicable": True, "tds_applicable": False,
                 "tds_regime": "new"}
    structure.update(flags)
    return vetana._compute_statutory(
        gross / 2, gross, structure,
        pt_slabs=slabs, employee_state=state)["professional_tax"]


def test_the_same_gross_pays_a_different_rate_in_each_state():
    """THE ACCEPTANCE CRITERION, in one assertion. ₹10,000 gross is in
    Gujarat's 9,000–11,999 band (₹150), Maharashtra's 7,501–10,000 band (₹175)
    and Karnataka's 0–14,999 band (₹0). The old line paid ₹0 to all three,
    because ₹10,000 is not over ₹15,000."""
    assert pt("Gujarat", 10000) == 150.0
    assert pt("Maharashtra", 10000) == 175.0
    assert pt("Karnataka", 10000) == 0.0
    assert len({pt(s, 10000) for s in ("Gujarat", "Maharashtra", "Karnataka")}) == 3


def test_a_state_with_no_slab_pays_nothing_and_does_not_raise():
    """Roughly twenty PT states have no row here and the owner owes the data
    (Phase 0.24). A missing slab must never stop a payroll run."""
    assert pt("Delhi", 50000) == 0.0
    assert pt("07", 50000) == 0.0
    assert pt("West Bengal", 9000) == 0.0


def test_no_state_on_the_employee_pays_nothing_and_does_not_raise():
    for absent in (None, "", "   "):
        assert pt(absent, 50000) == 0.0


def test_an_org_that_has_seeded_no_slabs_pays_nothing():
    """`pay_professional_tax` is per-org, so an empty ladder is a real and
    common state rather than a fault. It is NOT the same as never having
    looked — see the next test."""
    assert pt("Maharashtra", 50000, slabs=[]) == 0.0


def test_never_consulting_the_slab_table_keeps_the_old_flat_rule():
    """THE INERTNESS GUARANTEE. `manav_employees` has no state column until
    Phase 1.5 lands (confirmed read-only 2026-08-25: only an `address` jsonb),
    so payroll passes `pt_slabs=None` and every payslip carries exactly what it
    carried before. Deploying 2.2 ahead of 1.5 changes not one figure.

    None and [] are different answers and this pair is why."""
    assert pt("Maharashtra", 50000, slabs=None) == 200
    assert pt(None, 50000, slabs=None) == 200
    assert pt(None, 15000, slabs=None) == 0
    assert pt("Maharashtra", 50000, slabs=[]) == 0.0


def test_switching_professional_tax_off_still_wins_over_any_slab():
    """`pt_applicable` is a firm's answer about itself and the slab table does
    not overrule it. The owner: "we dont know how company operates so we dont
    block"."""
    assert pt("Maharashtra", 50000, pt_applicable=False) == 0.0
    assert pt("Maharashtra", 50000, slabs=None, pt_applicable=False) == 0.0


def test_every_spelling_of_one_state_lands_on_the_same_ladder():
    """This database holds two state conventions and migration 180's header
    records the decision to accept both rather than pick.
    `pay_professional_tax.state_code` is the NUMERIC GST code, while
    `manav_employees_state_ck` (migration 220) still admits 'MH' so an importer
    cannot be refused. Comparing the raw strings would silently never match,
    and a PT lookup that never matches charges everybody nothing — which is the
    exact failure migration 220's own header warns about."""
    for spelling in ("27", 27, "  27 ", "Maharashtra", "maharashtra",
                     " MAHARASHTRA ", "MH", "mh"):
        assert pt(spelling, 10000) == 175.0, spelling
    assert pt("GJ", 10000) == 150.0
    assert pt("KA", 10000) == 0.0


def test_the_state_codelist_is_imported_and_never_a_second_copy():
    """One codelist, three importers. `routers/manav.py:51` and
    `services/skills/action/attendance_auto_mark.py` already import this exact
    helper and both say why in as many words: a second copy is a second thing
    to drift. `manav.py:_clean_state` IS `_norm_state`, so the value stored in
    `manav_employees.state` and the value matched here are normalised by the
    same function."""
    from services.skills.data.client_register import _norm_state
    assert vetana._norm_state is _norm_state
    src = inspect.getsource(vetana._state_keys)
    assert "_norm_state(value)" in src
    assert "_GST_STATES" not in inspect.getsource(vetana), (
        "the GST codelist has been copied into vetana.py; import it instead")


def test_a_state_outside_the_gst_codelist_still_matches_an_identical_slab():
    """`_norm_state` returns None for anything it has not heard of. The raw
    text is kept alongside the canonical code so such a state matches a slab
    spelled the same way rather than matching nothing."""
    made_up = [slab("99", "Freedonia", 0, None, 42)]
    assert pt("Freedonia", 10000, slabs=made_up) == 42.0
    assert pt("99", 10000, slabs=made_up) == 42.0


def test_an_open_ended_top_band_catches_every_gross_above_it():
    """`slab_to` is nullable and the top row of all three live ladders uses it."""
    assert pt("Gujarat", 12000) == 200.0
    assert pt("Gujarat", 1200000) == 200.0
    assert pt("Karnataka", 15000) == 200.0


def test_the_band_bounds_are_inclusive_at_both_ends():
    assert pt("Maharashtra", 7500) == 0.0        # top of the nil band
    assert pt("Maharashtra", 7501) == 175.0      # first rupee of the next
    assert pt("Maharashtra", 10000) == 175.0     # top of that band
    assert pt("Maharashtra", 10001) == 200.0


def test_a_gross_that_falls_in_a_gap_between_bands_pays_nothing():
    """Gujarat's live rows run 0–5,999.00 then 6,000.00–8,999.00, so ₹5,999.50
    is in no band at all. That is a data artefact and it must resolve to zero
    rather than to an exception inside a payroll run."""
    assert pt("Gujarat", 5999.50) == 0.0


def test_an_unreadable_slab_row_is_skipped_rather_than_fatal():
    """Nothing in professional tax blocks a run. A row whose figures will not
    read as numbers is passed over and the rest of the ladder still applies."""
    broken = [slab("27", "Maharashtra", "not a number", None, 200),
              slab("27", "Maharashtra", 10001, None, 200)]
    assert pt("Maharashtra", 50000, slabs=broken) == 200.0
    assert pt("Maharashtra", 50000,
              slabs=[slab("27", "Maharashtra", 0, None, "not a number")]) == 0.0


def test_the_most_recently_effective_band_wins_when_two_match():
    """Two generations of a ladder can both be dated in the past. The later one
    is the rate in force."""
    two = [slab("27", "Maharashtra", 0, None, 200, date(2024, 4, 1)),
           slab("27", "Maharashtra", 0, None, 300, date(2026, 4, 1))]
    assert pt("Maharashtra", 50000, slabs=two) == 300.0


def test_the_payslip_records_which_rule_produced_the_professional_tax():
    """A PT figure is disputed by an employee and audited by a state authority,
    and "why ₹150?" must be answerable from the payslip years later rather than
    from whatever the slab table says by then."""
    def treatment(state, gross, slabs):
        return vetana._compute_statutory(
            gross / 2, gross, {"pt_applicable": True, "tds_applicable": False},
            pt_slabs=slabs, employee_state=state)["treatment"]

    t = treatment("Gujarat", 10000, LIVE_SLABS)
    assert t["pt_basis"] == "slab"
    assert t["pt_state"] == "Gujarat"
    assert t["pt_slab"]["state_name"] == "Gujarat"
    assert t["pt_slab"]["slab_from"] == 9000.0
    assert t["pt_slab"]["slab_to"] == 11999.0

    flat = treatment(None, 50000, None)
    assert flat["pt_basis"] == "flat" and flat["pt_slab"] is None

    nothing = treatment("Delhi", 50000, LIVE_SLABS)
    assert nothing["pt_basis"] == "slab" and nothing["pt_slab"] is None


def test_no_income_tax_or_pf_or_esi_constant_moved_with_it():
    """2.2 changes professional tax and nothing else. PF at 12% capped at
    ₹1,800, ESI at 0.75%/3.25% under ₹21,000 and both income-tax ladders are
    law and are untouched."""
    src = inspect.getsource(vetana._compute_statutory)
    for law in ("0.12", "1800", "0.0075", "0.0325", "21000", "50000",
                "300000", "700000", "250000", "112500", "140000"):
        assert law in src, f"the statutory constant {law} has gone"


# ══════════════════════════════════════════════════════════════════════════
#  2.2 · the two statements the slab read adds
# ══════════════════════════════════════════════════════════════════════════

def test_the_state_column_is_probed_rather_than_assumed():
    """Code deploys here before migrations are applied, and a payroll run that
    500s on an unknown column would be exactly the blocking the owner ruled
    out. The same reasoning, and the same shape, as the `statutory_treatment`
    probe that already sits in this handler."""
    sql, args = capture().find("information_schema.columns")
    assert "manav_employees" in sql
    assert list(args[0]) == list(vetana._PT_STATE_COLUMNS)


def test_the_column_name_can_only_ever_come_from_the_allowlist():
    """It is interpolated into SQL. `_PT_STATE_COLUMNS` is the allowlist and the
    server's own catalogue is the second gate; no runtime value reaches it."""
    assert vetana._PT_STATE_COLUMNS == ("state", "state_code")
    src = inspect.getsource(vetana._employee_state_column)
    assert "return name if name in _PT_STATE_COLUMNS else None" in src

    async def _hostile():
        class _P:
            async def fetchval(self, sql, *args):
                return "salary; DROP TABLE staging.manav_employees"
        return await vetana._employee_state_column(_P())

    assert asyncio.run(_hostile()) is None


def test_the_slab_read_is_scoped_to_the_org_that_seeded_it():
    """An unscoped read would charge one firm another firm's rates. Every one
    of the nine live rows carries an `org_id`, so the org predicate is what
    keeps them apart."""
    sql = norm(inspect.getsource(vetana._pt_slabs))
    assert "FROM staging.pay_professional_tax" in sql
    assert "org_id = $1::uuid" in sql, sql
    # Exactly ONE organisation is ever named. Asserted as "there is no
    # second org bind" rather than by counting occurrences of
    # `org_id = $`, because `inspect.getsource` hands back the comments
    # too and one of them quotes the predicate in prose — a count would
    # be measuring the explanation, not the code.
    assert "org_id = $2" not in sql, sql


def test_a_shared_ladder_with_no_org_id_is_read_and_not_silently_ignored():
    """`pay_professional_tax.org_id` is NULLABLE, and a professional-tax ladder
    is national reference data — so seeding one row-set for everybody, with no
    org_id, is the obvious reading and the one a careful person takes.

    Scoped strictly to `org_id = $1` those rows matched nothing, `_pt_from_slabs`
    returned 0.0, and every payslip in the product deducted NO professional tax
    with no error, no log line and nothing to tell it apart from a state that
    levies none. The trap is live: the ~20-state seed is still owed and the
    flat-₹200 fallback that used to mask it has been removed."""
    sql = norm(inspect.getsource(vetana._pt_slabs))
    assert "org_id IS NULL" in sql, (
        "a shared ladder seeded with no org_id would be invisible, and every "
        "payslip would silently deduct zero professional tax")


def test_an_orgs_own_slab_beats_a_shared_one_for_the_same_band():
    """A firm that has entered its own ladder has said something more specific
    than the national default, and a later-dated shared row must not overrule
    it. Ranked on `is_own` FIRST, ahead of the date."""
    shared = {"state_code": "27", "state_name": "Maharashtra",
              "slab_from": 0, "slab_to": None, "monthly_tax": 200,
              # Dated LATER than the org's own row, deliberately: if the rank
              # looked at the date first, the shared row would win.
              "effective_from": date(2026, 1, 1), "is_own": False}
    own = {"state_code": "27", "state_name": "Maharashtra",
           "slab_from": 0, "slab_to": None, "monthly_tax": 175,
           "effective_from": date(2024, 4, 1), "is_own": True}
    got, slab = vetana._pt_from_slabs([shared, own], "27", 10000)
    assert got == 175.0, "the shared ladder overruled the org's own rates"
    assert slab["is_own"] is True


def test_a_shared_slab_is_used_when_the_org_has_none_of_its_own():
    """The whole point of admitting the NULL-org rows: an org that has seeded
    nothing still gets a real rate instead of a silent zero."""
    shared = {"state_code": "27", "state_name": "Maharashtra",
              "slab_from": 0, "slab_to": None, "monthly_tax": 200,
              "effective_from": date(2024, 4, 1), "is_own": False}
    got, _slab = vetana._pt_from_slabs([shared], "27", 10000)
    assert got == 200.0


def test_a_row_without_is_own_at_all_still_ranks():
    """`_pt_from_slabs` is called with asyncpg Records in production and plain
    dicts in tests, and an older caller may hand over neither. A missing key
    must rank as "not the org's own" rather than raise inside the loop that
    decides somebody's tax."""
    row = {"state_code": "27", "state_name": "Maharashtra",
           "slab_from": 0, "slab_to": None, "monthly_tax": 175,
           "effective_from": date(2024, 4, 1)}
    got, _slab = vetana._pt_from_slabs([row], "27", 10000)
    assert got == 175.0


def test_a_slab_dated_in_the_future_is_not_applied_to_an_older_month():
    """Re-running an old month must use the rates that applied to it."""
    sql = norm(inspect.getsource(vetana._pt_slabs))
    assert "effective_from IS NULL OR effective_from <= $2::date" in sql, sql


def test_the_slab_table_is_read_once_per_run_not_once_per_employee():
    """The same rule the structures and the attendance reads follow, and it is
    in the handler's own words: one round trip per run, not one per person."""
    src = inspect.getsource(vetana.process_payroll)
    assert src.count("_pt_slabs(") == 1
    body = src[src.index("for s in unique_structures"):]
    assert "_pt_slabs(" not in body, (
        "the slab table is being read inside the per-employee loop")


# ══════════════════════════════════════════════════════════════════════════
#  Live — parse against the real catalogue, and count real rows. READ ONLY.
# ══════════════════════════════════════════════════════════════════════════

def live(work):
    """Open a connection, run `work(conn)`, close it — all in ONE event loop.

    asyncpg binds a connection to the loop that created it, so a module-scoped
    connection handed to a second `asyncio.run()` dies with "another operation
    is in progress". One loop per test is the cheap and correct shape.

    A connection failure SKIPS; anything `work` raises propagates, so a real
    assertion can never be mistaken for a missing database.
    """
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    import asyncpg

    async def run():
        try:
            conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        except Exception as exc:                              # noqa: BLE001
            return False, exc
        try:
            await conn.execute(_SEARCH_PATH)
            return True, await work(conn)
        finally:
            await conn.close()

    reached, value = asyncio.run(run())
    if not reached:
        pytest.skip(f"could not reach the database: {value}\n\n{SKIP_REASON}")
    return value


def test_live_every_statement_payroll_now_issues_parses():
    """THE ONE THING A MOCK POOL CANNOT PROVE. A MagicMock answers `[]` to a
    column that has never existed, which is how `sd.min_staff` shipped.

    `prepare()` sends Parse and Describe and STOPS: the server plans the
    statement and resolves every relation, column and parameter type. No row is
    read and none is written — which matters, because this is production's
    database as well as staging's.
    """
    pool = capture()
    # The slab read is issued only once a state column exists, so today it
    # would never be captured — and an unparsed statement is exactly how a
    # router ships a column that has never been there. It is captured directly
    # instead, so it is planned against the real catalogue from the first day
    # rather than from the day Phase 1.5 lands.
    slabs = _CapturePool()
    asyncio.run(vetana._pt_slabs(slabs, ORG, date(2026, 8, 31)))
    statements = [s for s, _a in pool.statements + slabs.statements]

    async def work(conn):
        for sql in statements:
            await conn.prepare(sql)
        return len(statements)

    assert live(work) >= 4
    assert any("pay_professional_tax" in s for s in statements)


def test_live_the_state_column_shape_parses_once_the_column_exists():
    """Self-adjusting on purpose. Today `manav_employees` has no state column,
    so the only shape that can be planned is the one that actually runs; once
    Phase 1.5 lands, the state shape is planned too and this stops being a
    half-check. Which half ran is asserted, so it cannot silently check
    nothing."""
    async def work(conn):
        column = await conn.fetchval(
            "SELECT column_name FROM information_schema.columns "
            " WHERE table_schema='staging' AND table_name='manav_employees' "
            "   AND column_name = ANY($1::text[]) LIMIT 1",
            list(vetana._PT_STATE_COLUMNS))
        if column is None:
            return None
        sql, _args = capture(state_col=column).find(
            "staging.vetana_salary_structures s")
        assert "employee_state" in sql
        await conn.prepare(sql)
        return column

    if live(work) is None:
        sql, _args = capture().find("staging.vetana_salary_structures s")
        assert "employee_state" not in sql, (
            "payroll is selecting a state column that does not exist live")
        pytest.skip("Phase 1.5 has not landed: manav_employees carries no "
                    "state column, so the slab read is inert and only the "
                    "no-state shape can be planned")


def test_live_the_slab_table_has_the_columns_this_code_names():
    """Named from the catalogue rather than from a migration: no migration in
    `backend/migrations/` creates this table at all — it predates the numbered
    series — so the live catalogue is the only authority for its shape."""
    async def work(conn):
        return {r["column_name"]: (r["data_type"], r["is_nullable"])
                for r in await conn.fetch(
                    "SELECT column_name, data_type, is_nullable "
                    "  FROM information_schema.columns "
                    " WHERE table_schema='staging' "
                    "   AND table_name='pay_professional_tax'")}

    cols = live(work)
    assert cols, "staging.pay_professional_tax does not exist"
    for name in ("org_id", "state_code", "state_name", "slab_from", "slab_to",
                 "monthly_tax", "effective_from"):
        assert name in cols, f"pay_professional_tax has no {name}: {sorted(cols)}"
    # The open-ended top band depends on this one being nullable.
    assert cols["slab_to"][1] == "YES"


def test_live_the_seeded_ladders_still_pay_what_the_fixture_says():
    """The fixture above is a transcript of live rows. If the owner edits the
    ladder — Phase 0.24 is exactly that job — this says so rather than letting
    the unit tests keep asserting yesterday's rates.

    It asserts the ANSWER, not the row count, so seeding the twenty missing
    states does not fail it."""
    async def work(conn):
        return [dict(r) for r in await conn.fetch(
            "SELECT state_code, state_name, slab_from, slab_to, monthly_tax, "
            "       effective_from FROM staging.pay_professional_tax "
            " WHERE org_id = $1::uuid", ORG)]

    rows = live(work)
    if not rows:
        pytest.skip(f"org {ORG} has seeded no professional-tax slabs")
    for state, gross, expected in (("Gujarat", 10000, 150.0),
                                   ("Maharashtra", 10000, 175.0),
                                   ("Karnataka", 10000, 0.0)):
        got, _slab = vetana._pt_from_slabs(rows, state, gross)
        assert got == expected, (
            f"{state} at {gross} now pays {got}, not {expected}. If the owner "
            f"has re-seeded the ladder, update LIVE_SLABS in this file to "
            f"match — do not loosen the assertion.")


def test_live_the_fix_removes_exactly_the_people_who_had_already_left():
    """2.1, PROVED ON REAL ROWS AND WITHOUT WRITING ONE.

    Runs the guarded query and the OLD unguarded one side by side, read-only,
    over every org, and asserts three things about the difference:

      · everyone the fix drops has a non-cancelled exit dated before the month;
      · nobody the fix keeps does;
      · the fix drops somebody — otherwise this test proves nothing and would
        keep passing after the guard was deleted.

    Measured when written: 10 employees, all 10 holding an active salary
    structure. The assertion is on the PROPERTY, not on 10, so the number
    moving as leavers are properly deactivated does not turn this red.
    """
    guarded_sql, _args = capture().find("staging.vetana_salary_structures s")
    unguarded_sql = re.sub(
        r"AND NOT EXISTS \(.*?x\.last_working_day < \$3::date\) ",
        "", norm(guarded_sql))
    assert "NOT EXISTS" not in unguarded_sql, (
        "could not reconstruct the pre-fix query; the guard's shape changed")

    async def work(conn):
        orgs = [r["org_id"] for r in await conn.fetch(
            "SELECT DISTINCT org_id FROM staging.vetana_salary_structures "
            " WHERE is_active = TRUE")]
        month_end, month_start = date(2026, 8, 31), date(2026, 8, 1)
        out = []
        for org in orgs:
            kept = {r["employee_id"] for r in await conn.fetch(
                guarded_sql, org, month_end, month_start)}
            all_rows = {r["employee_id"] for r in await conn.fetch(
                unguarded_sql, org, month_end)}
            left = {r["employee_id"] for r in await conn.fetch(
                "SELECT DISTINCT employee_id FROM staging.manav_offboarding "
                " WHERE org_id = $1::uuid AND status <> 'cancelled' "
                "   AND last_working_day < $2::date", org, month_start)}
            out.append((org, kept, all_rows, left))
        return out

    results = live(work)
    assert results, "no org has an active salary structure"

    dropped_total = 0
    for org, kept, all_rows, left in results:
        dropped = all_rows - kept
        dropped_total += len(dropped)
        assert dropped <= left, (
            f"org {org}: the guard dropped {len(dropped - left)} people who "
            f"have no past exit date — it is removing the wrong rows")
        assert not (kept & left), (
            f"org {org}: {len(kept & left)} people with a past last working "
            f"day are still in the run")
    assert dropped_total > 0, (
        "the guard removed nobody anywhere, so this test would pass with the "
        "guard deleted. Ten employees held a past exit date on 2026-08-25; if "
        "they have since been deactivated, pick a month that still has one "
        "rather than deleting this assertion.")
