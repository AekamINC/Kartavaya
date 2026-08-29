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
_SEARCH_PATH = "SET search_path TO public"

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
        if "INSERT INTO public.vetana_payroll_runs" in sql:
            return {"id": RUN_ID}
        return None

    async def fetch(self, sql, *args):
        self._record(sql, args)
        if "public.vetana_salary_structures s" in sql:
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
    sql, args = capture().find("public.vetana_salary_structures s")
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
    assert "public.manav_offboarding x" in sql
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
    for piece in ("public.manav_offboarding x",
                  "x.org_id = e.org_id AND x.employee_id = e.id",
                  "x.status <> 'cancelled'",
                  "x.last_working_day"):
        assert piece in hr_sql, (
            "the HR path this guard was mirrored from has changed shape (%r is "
            "gone). Re-derive the payroll guard from it rather than leaving the "
            "two to drift." % piece)

    payroll_sql, _args = capture().find("public.vetana_salary_structures s")
    payroll_sql = norm(payroll_sql)
    for piece in ("public.manav_offboarding x",
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
    assert src.count("INSERT INTO public.vetana_payslips") == 1, (
        "payroll writes payslips from more than one place; excluding a leaver "
        "from the structures query no longer excludes them from the run")

    loop = "for s in unique_structures:"
    assert src.count(loop) == 1
    assert src.index("INSERT INTO public.vetana_payslips") > src.index(loop), (
        "the payslip INSERT is no longer inside the loop over the structures")

    # …and `unique_structures` is built from the guarded query and nothing else.
    between = src[src.index("structures = await pool.fetch"):src.index(loop)]
    assert "unique_structures.append(s)" in between
    assert "for s in structures:" in between


def test_the_guard_is_not_an_inner_join_that_would_drop_everyone_else():
    """A `JOIN manav_offboarding` would pay only the leavers — the inversion of
    the bug, and a payroll run that pays nobody. NOT EXISTS keeps the 98
    employees who have no exit row at all."""
    sql, _args = capture().find("public.vetana_salary_structures s")
    sql = norm(sql)
    assert "JOIN public.manav_offboarding" not in sql, sql
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


def test_no_esi_constant_moved_with_it():
    """2.2 changes professional tax and nothing else.

    ESI at 0.75%/3.25% under ₹21,000 and the ₹50,000 standard deduction are law
    and are untouched.

    **TWO GROUPS LEFT THIS LIST ON 2026-08-27 AND THEIR ABSENCE IS THE POINT.**
    PF's `0.12`/`1800` went to `statute_calendar` (5.1) and the income-tax
    ladders' `300000`/`700000`/`250000`/`112500`/`140000` went to
    `staging.pay_income_tax_slabs` (5.2b). Each has its own test below saying so;
    a constant that is still here is one nothing has moved yet.
    """
    src = inspect.getsource(vetana._compute_statutory)
    for law in ("21000", "50000"):
        assert law in src, f"the statutory constant {law} has gone"
    # And the ESI rates left too, on 2026-08-27 — migration 232 gave them a
    # dated home (G.S.R. 423(E) of 2019, which cut them from 1.75% and 4.75%).
    # The fallbacks are the same figures expressed as percentages.
    assert "0.75" in src and "3.25" in src


def test_the_income_tax_ladders_are_data_and_never_a_literal():
    """PHASE 5.2b — and this is the assertion the phase exists for.

    Two ladders lived in this function as `if/elif` chains, and the new-regime
    one was **A YEAR OUT OF DATE**: 0/3L/7L/10L/12L/15L is AY 2025-26, while
    FY 2026-27 runs on 0/4L/8L/12L/16L/20L/24L. The product was deducting under
    last year's narrower bands — over-deducting — with no deploy-free way to
    correct it.

    The plan's guardrail is stricter than the ESI one and deliberately so: an
    absent ladder deducts ₹0 and MUST NEVER fall back to a compiled-in one. A
    missing PF rate would under-remit a contribution the employer owes, so the
    literal is the safe answer there. A missing tax ladder means the law is not
    recorded — and quietly applying the wrong year's ladder while looking
    correct on the payslip is the exact failure the table exists to end. ₹0 is
    visible; a stale ladder is not.
    """
    src = inspect.getsource(vetana._compute_statutory)
    for gone in ("300000", "700000", "250000", "112500", "140000"):
        assert gone not in src, (
            f"{gone} is back in the statutory function — an income-tax band "
            f"belongs in public.pay_income_tax_slabs, read at the run's period "
            f"end. A literal here silently applies one year's law for ever.")
    assert "income_tax.ladder_for" in src and "income_tax.annual_tax" in src, (
        "the ladder is no longer read from the table")


def test_pf_is_dated_law_now_and_still_computes_the_same_figure():
    """PHASE 5.1 — `0.12` and `1800` are GONE, deliberately.

    They were two statutory facts fused into one expression:
    `min(pf_base * 0.12, 1800)` hardcodes the 12% rate AND the ₹15,000 ceiling
    that makes 1,800 the cap. Neither could change without a deploy, and neither
    said when it started. Migration 228 seeds all three as dated rows
    (`epf.rate.employee`, `epf.rate.employer`, `epf.wage_ceiling`), read at the
    run's period end.

    THE ARITHMETIC IS UNCHANGED, which is what makes the change safe to ship:
    12% of a ₹15,000 ceiling is ₹1,800. This asserts that identity rather than
    the old literals, so a future edit that moves the number still fails here.
    """
    src = inspect.getsource(vetana._compute_statutory)
    assert "0.12" not in src, (
        "the PF rate is a literal again — it belongs in statute_calendar, "
        "read through `_epf_terms` at the run's period end")

    # The fallbacks, which are the same law expressed as a rate and a ceiling.
    assert "12.0" in src and "15000.0" in src

    # And the identity the old literal encoded, asserted rather than assumed.
    assert round(15000.0 * 12.0 / 100, 2) == 1800.0

    # The fallback is the statutory literal, NOT zero: an absent PF row means
    # the store cannot answer, not that no provident fund is due. Answering 0%
    # would quietly under-remit somebody's contribution.
    # Whitespace-normalised: the sentence wraps across lines in the source, and
    # a substring check against raw source silently depends on where the line
    # breaks fall.
    terms = " ".join(inspect.getsource(vetana._epf_terms).split())
    assert "never shrink a statutory contribution" in terms


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
                return "salary; DROP TABLE public.manav_employees"
        return await vetana._employee_state_column(_P())

    assert asyncio.run(_hostile()) is None


def test_the_slab_read_is_scoped_to_the_org_that_seeded_it():
    """An unscoped read would charge one firm another firm's rates. Every one
    of the nine live rows carries an `org_id`, so the org predicate is what
    keeps them apart."""
    sql = norm(inspect.getsource(vetana._pt_slabs))
    assert "FROM public.pay_professional_tax" in sql
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
    # ── WHY THIS IS THREE STEPS AND NOT ONE ────────────────────────────────
    #
    # It used to build the statement INSIDE `work(conn)`, and `capture().find()`
    # drives the handler through `asyncio.run(vetana.process_payroll(...))`.
    # Once migration 220 made the column exist, that branch became reachable
    # for the first time — and a nested `asyncio.run` inside a running loop is
    # a RuntimeError, not a slow path. So this failed on every live run from
    # the day the column landed, which is the wrong day for a test about that
    # column to start failing.
    #
    # Ask the catalogue, build the SQL on its own loop, then plan it.
    async def find_column(conn):
        return await conn.fetchval(
            "SELECT column_name FROM information_schema.columns "
            " WHERE table_schema = ANY(current_schemas(false)) AND table_name='manav_employees' "
            "   AND column_name = ANY($1::text[]) LIMIT 1",
            list(vetana._PT_STATE_COLUMNS))

    column = live(find_column)
    if column is None:
        sql, _args = capture().find("public.vetana_salary_structures s")
        assert "employee_state" not in sql, (
            "payroll is selecting a state column that does not exist live")
        pytest.skip("manav_employees carries no state column, so the slab read "
                    "is inert and only the no-state shape can be planned")

    # OUTSIDE any loop: `capture().find()` runs the handler under its own
    # `asyncio.run`, and nothing is running here.
    sql, _args = capture(state_col=column).find("public.vetana_salary_structures s")
    assert "employee_state" in sql

    async def plan(conn):
        await conn.prepare(sql)
        return True

    assert live(plan) is True


def test_live_the_slab_table_has_the_columns_this_code_names():
    """Named from the catalogue rather than from a migration: no migration in
    `backend/migrations/` creates this table at all — it predates the numbered
    series — so the live catalogue is the only authority for its shape."""
    async def work(conn):
        return {r["column_name"]: (r["data_type"], r["is_nullable"])
                for r in await conn.fetch(
                    "SELECT column_name, data_type, is_nullable "
                    "  FROM information_schema.columns "
                    " WHERE table_schema = ANY(current_schemas(false)) "
                    "   AND table_name='pay_professional_tax'")}

    cols = live(work)
    assert cols, "public.pay_professional_tax does not exist"
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
            "       effective_from FROM public.pay_professional_tax "
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
    guarded_sql, _args = capture().find("public.vetana_salary_structures s")
    unguarded_sql = re.sub(
        r"AND NOT EXISTS \(.*?x\.last_working_day < \$3::date\) ",
        "", norm(guarded_sql))
    assert "NOT EXISTS" not in unguarded_sql, (
        "could not reconstruct the pre-fix query; the guard's shape changed")

    async def work(conn):
        orgs = [r["org_id"] for r in await conn.fetch(
            "SELECT DISTINCT org_id FROM public.vetana_salary_structures "
            " WHERE is_active = TRUE")]
        month_end, month_start = date(2026, 8, 31), date(2026, 8, 1)
        out = []
        for org in orgs:
            kept = {r["employee_id"] for r in await conn.fetch(
                guarded_sql, org, month_end, month_start)}
            all_rows = {r["employee_id"] for r in await conn.fetch(
                unguarded_sql, org, month_end)}
            left = {r["employee_id"] for r in await conn.fetch(
                "SELECT DISTINCT employee_id FROM public.manav_offboarding "
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


# ══════════════════════════════════════════════════════════════════════════════
# Pro-rating a part-month — the promise :1240 made and the arithmetic never kept
# ══════════════════════════════════════════════════════════════════════════════
#
# `routers/vetana.py` says, where it decides who is in the run: "Somebody who
# leaves DURING the month is still paid, and pro-rated by the attendance
# arithmetic below." That was not true.
#
# `present_days` fell back to the WHOLE month whenever nobody had been marked
# present or absent — and live, in both in-scope organisations, ZERO August rows
# carried a status in (present, late, half_day, absent). So the fallback fired
# for every single person, and a man whose last working day was the 3rd was paid
# for all twenty-six.
#
# The fallback itself is right and stays: "nobody has said" must never silently
# dock somebody's pay. What was missing is that the employment window is a fact
# the system ALREADY HOLDS — a joining date and a recorded last working day —
# and it does not depend on anyone remembering to mark a register.

class TestWorkingDaysBetween:
    """The divisor and the dividend must be counted the same way.

    `working_days` for the month is "every calendar day that is not a Sunday".
    If a part-month were measured any other way — business days, a holiday
    calendar, anything — the ratio would move for people whose pay should not.
    """

    def test_a_full_week_is_six_working_days(self):
        # Mon 2026-08-03 .. Sun 2026-08-09
        assert vetana._working_days_between(date(2026, 8, 3), date(2026, 8, 9)) == 6

    def test_a_single_sunday_is_no_working_days(self):
        assert vetana._working_days_between(date(2026, 8, 9), date(2026, 8, 9)) == 0

    def test_a_single_weekday_is_one(self):
        assert vetana._working_days_between(date(2026, 8, 3), date(2026, 8, 3)) == 1

    def test_it_agrees_with_the_months_own_divisor(self):
        """The whole month through this helper must equal the number the run
        divides by, or every ratio in the system shifts."""
        for year, mon, days in ((2026, 8, 31), (2026, 2, 28), (2024, 2, 29), (2026, 9, 30)):
            sundays = sum(
                1 for d in range(1, days + 1) if date(year, mon, d).weekday() == 6
            )
            assert vetana._working_days_between(
                date(year, mon, 1), date(year, mon, days)
            ) == days - sundays

    def test_an_inverted_window_is_zero_and_never_negative(self):
        """A negative day count would become a NEGATIVE PAYSLIP through the
        ratio. Cheap to guard, catastrophic to miss."""
        assert vetana._working_days_between(date(2026, 8, 31), date(2026, 8, 1)) == 0


class TestAPartMonthIsPaidForThePart:
    """The arithmetic, exercised directly on the values the run computes.

    These assert the RULE rather than driving the endpoint, for the reason this
    file's header already gives: a mocked pool proves the handler asked, never
    that the database could answer.
    """

    MONTH_START, MONTH_END = date(2026, 8, 1), date(2026, 8, 31)
    FULL = 26  # August 2026: 31 days less 5 Sundays (2,9,16,23,30)

    def _ratio(self, doj, last_day, has_attendance=False, marked_days=0.0):
        """Calls the PRODUCTION function for the window, then applies the run's
        cap. `_employed_working_days` is the thing routers/vetana.py itself
        calls, so reverting the fix turns these red — which a test that
        re-implemented the window arithmetic could never do."""
        employed = vetana._employed_working_days(
            self.MONTH_START, self.MONTH_END, doj, last_day,
        )
        present = marked_days if has_attendance else employed
        present = min(present, employed)
        payable = min(present, employed)
        return payable / self.FULL

    def test_the_months_divisor_is_what_the_run_uses(self):
        assert vetana._working_days_between(self.MONTH_START, self.MONTH_END) == self.FULL

    def test_somebody_employed_all_month_is_untouched(self):
        """THE REGRESSION GUARD. 50 of 51 payable employees in the live E2E org
        are in this case, and not a paisa of their pay may move."""
        assert self._ratio(doj=date(2020, 1, 1), last_day=None) == 1.0

    def test_a_joining_date_inside_the_month_does_not_shorten_a_full_month(self):
        """A joining date at or before the 1st is a full month, not a boundary
        case to get wrong."""
        assert self._ratio(doj=date(2026, 8, 1), last_day=None) == 1.0

    def test_the_leaver_who_went_on_the_third_is_not_paid_for_the_month(self):
        """The live case. E2E's leaver, last working day 2026-08-03, sits in the
        run correctly — the guard keeps mid-month leavers in — and was being
        paid a FULL month because no attendance existed to pro-rate him by.

        1st Sat, 2nd Sun, 3rd Mon -> two working days of twenty-seven.
        """
        r = self._ratio(doj=date(2020, 1, 1), last_day=date(2026, 8, 3))
        assert r == 2 / self.FULL
        assert r < 0.1, "a three-day month must not pay like a whole one"

    def test_a_mid_month_joiner_is_paid_from_when_they_joined(self):
        r = self._ratio(doj=date(2026, 8, 17), last_day=None)
        assert r == vetana._working_days_between(date(2026, 8, 17), self.MONTH_END) / self.FULL
        assert r < 1.0

    def test_a_marked_register_cannot_overstate_the_window_either(self):
        """`attendance_auto_mark` has been writing weekend rows for leavers
        three weeks past their exit, so the register itself can claim more days
        than somebody was employed for. The cap is not only a fallback."""
        r = self._ratio(
            doj=date(2020, 1, 1), last_day=date(2026, 8, 3),
            has_attendance=True, marked_days=20.0,
        )
        assert r == 2 / self.FULL

    def test_the_old_behaviour_would_have_failed_these(self):
        """States the defect as arithmetic, so the fix cannot be reverted
        without a red test: the pre-fix fallback was the whole month for
        everybody, whatever their employment window said."""
        old_ratio = self.FULL / self.FULL          # present_days = working_days
        new_ratio = self._ratio(doj=date(2020, 1, 1), last_day=date(2026, 8, 3))
        assert old_ratio == 1.0
        assert new_ratio != old_ratio


def test_the_run_actually_uses_the_window_and_not_the_whole_month():
    """The source-level pin.

    Every assertion above calls `_employed_working_days` directly, which proves
    the arithmetic and NOT that the payroll run consults it. Deleting the call
    and restoring `present_days = ... else working_days` would leave all of them
    green while every leaver was paid a full month again — the precise shape of
    the bug this file now guards.

    So: read the run's own source and require that the fallback and the cap are
    both expressed in terms of the employment window.
    """
    src = inspect.getsource(vetana.process_payroll) if hasattr(vetana, "process_payroll") else None
    if src is None:
        # Find the coroutine that owns the per-employee loop by its marker.
        cands = [
            obj for name, obj in vars(vetana).items()
            if callable(obj) and "employed_days" in (inspect.getsource(obj) if _safe(obj) else "")
        ]
        assert cands, "no function in routers.vetana mentions employed_days"
        src = inspect.getsource(cands[0])

    assert "_employed_working_days(" in src, (
        "the payroll run no longer calls _employed_working_days — a part-month "
        "is being paid as a whole one again"
    )
    assert "else employed_days" in src, (
        "the no-attendance fallback is no longer bounded by the employment "
        "window; it has gone back to paying the whole month for everybody"
    )
    assert "if payable_days > employed_days" in src, (
        "payable days are no longer capped by the employment window"
    )


def _safe(obj):
    try:
        inspect.getsource(obj)
        return True
    except Exception:
        return False


# ══════════════════════════════════════════════════════════════════════════════
# A month-specific band — optional, never required, never blocking
# ══════════════════════════════════════════════════════════════════════════════
#
# Migration 221. Professional tax is not a flat monthly figure everywhere:
# Maharashtra charges a different amount in February. The column is nullable and
# NULL means EVERY month, so the nine seeded rows keep behaving exactly as they
# did — the owner's rule is that this, like GSTIN/PAN/TAN, is optional and must
# block nothing.

class TestTheMonthBandIsOptionalAndMoreSpecific:
    """`_pt_slabs` admits only rows for the month being run, so anything with a
    month set IS this month and `_pt_from_slabs` ranks on that alone."""

    EVERY_MONTH = {
        "state_code": "27", "state_name": "Maharashtra",
        "slab_from": 10001, "slab_to": None, "monthly_tax": 200,
        "effective_from": None, "month": None, "is_own": False,
    }
    FEBRUARY = {**EVERY_MONTH, "monthly_tax": 300, "month": 2}

    def test_the_every_month_row_alone_is_unchanged(self):
        """THE REGRESSION GUARD. Every live row is this shape; not a paisa of
        anybody's deduction may move because a nullable column was added."""
        pt, row = vetana._pt_from_slabs([self.EVERY_MONTH], "27", 44700)
        assert pt == 200
        assert row is not None

    def test_a_month_row_outranks_the_every_month_row(self):
        pt, _ = vetana._pt_from_slabs([self.EVERY_MONTH, self.FEBRUARY], "27", 44700)
        assert pt == 300

    def test_order_does_not_decide_it(self):
        """Ranked, not first-wins — the rows arrive in whatever order the ORDER
        BY leaves them, and `slab_from` is equal on both."""
        pt, _ = vetana._pt_from_slabs([self.FEBRUARY, self.EVERY_MONTH], "27", 44700)
        assert pt == 300

    def test_an_orgs_own_every_month_row_still_beats_a_shared_month_row(self):
        """The order the owner asked for: org + month, then org + every month,
        THEN shared + month. A firm that has entered its own ladder has said
        something more specific than national reference data, whatever month it
        is."""
        own_every_month = {**self.EVERY_MONTH, "monthly_tax": 250, "is_own": True}
        pt, _ = vetana._pt_from_slabs([own_every_month, self.FEBRUARY], "27", 44700)
        assert pt == 250

    def test_an_orgs_own_month_row_wins_outright(self):
        own_feb = {**self.FEBRUARY, "monthly_tax": 350, "is_own": True}
        own_every_month = {**self.EVERY_MONTH, "monthly_tax": 250, "is_own": True}
        pt, _ = vetana._pt_from_slabs(
            [self.EVERY_MONTH, self.FEBRUARY, own_every_month, own_feb], "27", 44700)
        assert pt == 350

    def test_a_month_row_for_a_band_the_gross_misses_does_not_apply(self):
        """Specificity never overrides the band. A February row for a band this
        salary is not in must not be reached for."""
        feb_low_band = {**self.FEBRUARY, "slab_from": 0, "slab_to": 7500}
        pt, _ = vetana._pt_from_slabs([self.EVERY_MONTH, feb_low_band], "27", 44700)
        assert pt == 200

    def test_no_slab_at_all_is_still_zero_and_still_does_not_raise(self):
        """The last step of the fallback, unchanged. Nothing anybody fails to
        configure may stop a payroll run."""
        pt, row = vetana._pt_from_slabs([], "27", 44700)
        assert pt == 0.0 and row is None


def test_the_slab_query_admits_every_month_rows_and_this_months_rows():
    """The other half of the contract, read off the statement itself.

    The ranking above can only prefer a month row if the QUERY lets one through
    — and it must let the NULL-month rows through too, or an org with no month
    rows would suddenly have no ladder at all and every payslip would deduct
    nothing. That is the exact shape of the bug commit 9463d21f fixed for
    `org_id`, so it is pinned here rather than trusted.
    """
    src = inspect.getsource(vetana._pt_slabs)
    assert "month IS NULL OR month =" in src, (
        "the slab query no longer admits every-month rows alongside this "
        "month's; an org that has set no month rows would lose its ladder:\n" + src
    )
    assert "EXTRACT(MONTH FROM $2::date)" in src, (
        "the month is no longer taken from the date the run is for"
    )
