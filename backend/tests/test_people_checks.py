"""
The four payroll and HR skills, and the four sentences they are not allowed to
get wrong.

Most of what follows is not arithmetic. Three of these handlers are read by
somebody about to remit money to a statutory authority or upload a file to a
government portal, and the failure that matters is not a wrong total — it is a
right total that reads as more certain, more complete or more legally settled
than it is. So the load-bearing tests here are:

  · `test_the_gate_reports_and_never_blocks` — UAN, ESI number and PAN are
    NON-MANDATORY in this product and always will be. A gate skill that started
    describing itself as a blocker would be the first step to somebody wiring it
    into the run.
  · `test_the_pan_section_comes_from_the_catalogue` — the section was s.206AA
    until 31 March 2026 and is s.397(2) from 1 April 2026 under the Income-tax
    Act 2025. A handler that printed either from memory is wrong for half of
    every year the renumbering straddles, and this is the test that stops the
    obvious "simplification".
  · `test_a_deadline_does_not_move_because_the_office_is_shut` — the statutory
    date is printed unshifted, and the only date that ever moves is the TASK,
    and only ever EARLIER.
  · `test_nothing_invents_a_due_date_the_catalogue_does_not_hold` — there is no
    catalogued monthly TDS deposit and no professional-tax row at all. Both must
    come back with an amount and NO date. Printing the 7th from memory is
    exactly the defect `services/statute.py` exists to remove.

The rest pins the shape that live data caught. `test_two_employees_sharing_a_name
_are_not_merged` is the one that was a genuine bug: the missing-day query was
first written GROUP BY name, and the seeded org has two people called "Aadhya
Nair", so a fourteen-working-day window reported twenty-eight missing days for
one person — a count that cannot exist, printed two lines under the window that
disproves it.

Live figures at the time of writing, read-only against the seeded org on
2026-08-20: 60 of 60 PF-enabled employees have no UAN across 8 departments; 0
ESI findings out of 0 in scope; 0 PAN findings out of 59 who had tax deducted;
the 2026-06 run owes 982,199.41 (PF 215,282.64 / ESI 0 / PT 12,000 / TDS
754,916.77) against 2026-05's 612,479.00; the 2026-07 run is 'processed' and
never approved while carrying a stale approval timestamp; and 5 approved claims
totalling 12,000.00 have been unpaid 17 days.
"""
import inspect
import json
from datetime import date, datetime, timezone

import pytest

from services.skills.data import people_checks as pc
from services.skills.data.people_checks import (
    brief_statutory_dues,
    brief_unpaid_reimbursements,
    check_attendance_exceptions,
    check_statutory_records_gate,
)

# A fixture value, and deliberately NOT the seeded org's id even in part. The
# pool below is a fake, so this is only ever an argument to assert on — but an
# id that LOOKS like the real one gets copied into a live probe, and the probe
# then returns nothing and reads as a regression.
ORG = "00000000-0000-4000-8000-000000000009"

HANDLERS = (
    check_statutory_records_gate,
    brief_statutory_dues,
    check_attendance_exceptions,
    brief_unpaid_reimbursements,
)


def _text(out) -> str:
    """Every string the caller could possibly show a reader, flattened.

    The output of these handlers is fed to a language model, and the only
    wording guaranteed to survive into what a person sees is wording that is in
    the data. So the wording assertions run over the whole serialised payload,
    not over one field somebody might later rename.
    """
    return json.dumps(out, default=str).lower()


def _freeze(monkeypatch, day: date):
    """Pin `utc_now` inside the handler module. Aware, always.

    Patched on `people_checks`, not on `timeutil`: the module imported the name,
    so patching the source has no effect on the already-bound reference — a
    monkeypatch that silently does nothing is worse than none, because the test
    then passes for the wrong reason on whatever day it is run.
    """
    monkeypatch.setattr(
        pc, "utc_now",
        lambda: datetime(day.year, day.month, day.day, 9, 0, tzinfo=timezone.utc))


class _Row(dict):
    """A dict that answers `r["col"]`, which is all these handlers ask of a row."""


class _Pool:
    """A fake pool that routes on the SQL it is handed.

    A single canned answer would make every query in a handler return the same
    rows, and the handler would then pass a test while asking the database for
    something else entirely. Routing on a distinctive fragment of each statement
    is the closest a mock gets to honest — and it fails loudly on an unrouted
    query rather than returning [], which is how a renamed table would otherwise
    slip through as "no findings".
    """

    def __init__(self, **answers):
        self.answers = answers
        self.seen: list[str] = []

    def _route(self, sql: str, default, args=()):
        self.seen.append(sql)
        for marker, key in (
            ("statute_calendar", "statute"),
            ("pf_enabled_no_uan", "gate_findings"),
            ("AS active_employees", "gate_coverage"),
            ("$3::text[]", "subject_run"),
            ("r.month = $2::text", "prior_run"),
            ("r.status = 'processed'", "stranded_runs"),
            ("manav_holidays h\n        WHERE", "holidays"),
            ("a.check_out IS NULL", "open_punches"),
            ("a.status = 'absent'", "absences"),
            ("AS rows_with_a_punch", "punch_stats"),
            ("generate_series", "missing_days"),
            ("manav_leave_balances b\n          ON", "over_leave"),
            ("SELECT count(*) FROM taken t", "no_balance"),
            ("manav_expense_claims c", "claims"),
        ):
            if marker in sql:
                rows = self.answers.get(key, default)
                # The statute read is the one query whose PREDICATE this fake has
                # to honour. `services/statute.py` narrows by obligation_key in
                # SQL and resolves the version in Python, so a pool that returned
                # every seeded row for every key would hand the PF lookup the TDS
                # row — the resolver takes the latest effective_from and cannot
                # tell it was given the wrong key. That is not hypothetical: it
                # is what this fake did on its first run, and the PF due date
                # came back None because the TDS row carries no due_day.
                if key == "statute" and args:
                    rows = [r for r in rows if r["obligation_key"] == args[0]]
                return rows
        raise AssertionError(f"unrouted query in test pool:\n{sql[:400]}")

    async def fetch(self, sql, *args):
        return self._route(sql, [], args)

    async def fetchrow(self, sql, *args):
        return self._route(sql, None, args)

    async def fetchval(self, sql, *args):
        return self._route(sql, 0, args)


def _statute(key, *, section=None, form=None, due_day=None, offset=None,
             rate=None, authority="income_tax", title="an obligation",
             effective_from=date(1962, 4, 1), effective_to=None, state=None):
    """One `staging.statute_calendar` row, in the shape `services/statute.py` reads.

    Every column that module lists in `_COLS` must be present, because it builds
    the returned dict straight off the record; a fixture missing one passes here
    and raises KeyError in production.
    """
    return _Row(
        obligation_key=key, title=title, authority=authority, statute=None,
        form_number=form, section_ref=section, periodicity="monthly",
        due_day=due_day, due_month=None, due_month_offset=offset,
        window_days=None, rate_percent=rate, threshold_amount=None,
        state_code=state, effective_from=effective_from,
        effective_to=effective_to, effective_from_exact=True,
        source_ref=None, notes=None, verified_on=None,
    )


#: The two versions of the higher-rate row that actually sit in the live
#: catalogue. Both are handed to the resolver every time, exactly as the real
#: query does, so the test exercises the RESOLUTION and not a pre-picked row.
NO_PAN_ROWS = [
    _statute("tds.higher_rate_no_pan", section="s.206AA",
             title="Higher rate of deduction where the payee has no operative PAN",
             effective_from=date(2010, 4, 1), effective_to=date(2026, 4, 1)),
    _statute("tds.higher_rate_no_pan", section="s.397(2)",
             title="Higher rate of deduction where the payee has no operative PAN",
             effective_from=date(2026, 4, 1)),
]

COVERAGE = _Row(active_employees=71, pf_enabled=60, esi_enabled=0,
                tds_deducted=59, no_structure=11)


def _gate_row(check="pf_enabled_no_uan", name="Arnav Kulkarni",
              code="EMP-050", dept="Accounts", month=None,
              employee_id="22222222-2222-2222-2222-222222222222",
              email="arnav@example.com", phone="+91 90000 00001"):
    return _Row(check_code=check, employee_name=name, employee_code=code,
                department=dept, detail="…", payslip_month=month,
                employee_id=employee_id, employee_email=email,
                employee_phone=phone)


# ── every one of them must be able to run on a schedule ─────────────────────

@pytest.mark.parametrize("handler", HANDLERS, ids=lambda h: h.__name__)
def test_a_handler_runs_from_the_org_and_the_calendar_alone(handler):
    """No parameter without a default beyond pool/org_id.

    `services/skill_dispatcher.py` refuses to call a handler that declares a
    parameter nobody supplied, so a required `month` here does not degrade the
    skill — it makes every scheduled run fail outright, silently, forever. That
    is enforced across the whole registry by
    `tests/test_a_skill_can_run_unattended.py`; it is asserted again here so the
    failure lands on the file that caused it rather than on a suite-wide test
    the author of a new handler has never read.
    """
    required = [
        n for n, p in inspect.signature(handler).parameters.items()
        if n not in ("pool", "org_id", "user_id")
        and p.default is inspect.Parameter.empty
        and p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)
    ]
    assert not required, (
        f"{handler.__name__} requires {required}, which a schedule cannot "
        f"supply — the dispatcher will refuse every unattended run."
    )


@pytest.mark.parametrize("handler", HANDLERS, ids=lambda h: h.__name__)
async def test_nothing_returns_a_uuid(handler, monkeypatch):
    """Never render a user, member or org id. Not once, in any field.

    Two of these handlers group on an employee id internally — the alternative
    is merging two people who share a name — so the id is genuinely in scope
    inside the function and must not escape it.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _Pool(
        statute=list(NO_PAN_ROWS),
        gate_findings=[_gate_row()],
        gate_coverage=COVERAGE,
        subject_run=_Row(month="2026-06", status="approved", employee_count=60,
                         total_pf=1.0, total_esi=0.0, total_pt=2.0,
                         total_tds=3.0, total_gross=9.0),
        prior_run=None, stranded_runs=[], holidays=[],
        open_punches=[], absences=[],
        punch_stats=_Row(rows_in_window=0, rows_with_a_punch=0),
        missing_days=[], over_leave=[], no_balance=0,
        claims=[_Row(employee_id="11111111-1111-1111-1111-111111111111",
                     employee_name="Tara Mehta", employee_code="EMP-023",
                     department="Audit", category="travel", amount=2400,
                     expense_date=date(2026, 8, 3), approved_on=date(2026, 8, 3),
                     age_days=17, aged_from_expense_date=False)],
    )
    out = await handler(pool, ORG)

    # `link` is the one field allowed to carry an id, because a href is followed
    # rather than read. Everything else is still forbidden it. Strip the link
    # values, then apply the original ban to what is left -- so an id that
    # escapes into a label or a detail still fails, exactly as before.
    def _strip_links(node):
        if isinstance(node, dict):
            return {k: _strip_links(v) for k, v in node.items() if k != "link"}
        if isinstance(node, list):
            return [_strip_links(v) for v in node]
        return node

    body = _text(_strip_links(out))
    assert "11111111-1111" not in body
    assert ORG not in body
    # A bare uuid shape anywhere at all, not just the two we planted.
    assert not any(
        len(chunk) == 36 and chunk.count("-") == 4
        for chunk in body.replace('"', " ").replace(",", " ").split()
    ), "a uuid reached the output"

    # And a link, where one is offered, must point at a record rather than
    # carrying the id loose.
    for chunk in _text(out).replace('"', " ").replace(",", " ").split():
        if len(chunk) == 36 and chunk.count("-") == 4:
            raise AssertionError("a bare uuid sits outside a link: %s" % chunk)


@pytest.mark.parametrize("handler", HANDLERS, ids=lambda h: h.__name__)
async def test_no_handler_asks_for_an_image(handler, monkeypatch):
    """A statutory brief must never carry a generated picture.

    Images are $0.036–0.040 a call and 79% of all AI spend to date, and a
    picture on a compliance page adds nothing anybody can file. None of these
    outputs may carry a field that a template would read as "draw something".
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _Pool(
        statute=list(NO_PAN_ROWS), gate_findings=[], gate_coverage=COVERAGE,
        subject_run=None, prior_run=None, stranded_runs=[], holidays=[],
        open_punches=[], absences=[],
        punch_stats=_Row(rows_in_window=0, rows_with_a_punch=0),
        missing_days=[], over_leave=[], no_balance=0, claims=[],
    )
    out = await handler(pool, ORG)
    for banned in ("image", "image_url", "generate_image", "image_prompt"):
        assert banned not in out


# ── 1 · check_statutory_records_gate ────────────────────────────────────────

async def test_the_gate_reports_and_never_blocks(monkeypatch):
    """GSTIN/PAN/TAN-shaped identifiers are NON-MANDATORY and block nothing.

    This has drifted back more than once elsewhere in the product. The output
    must say so in words, and must not describe itself in the vocabulary of a
    gate that stops a run — the payroll blockers live in
    `check_payroll_readiness` and have a different, deliberate meaning.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _Pool(statute=list(NO_PAN_ROWS), gate_coverage=COVERAGE,
                 gate_findings=[_gate_row()])
    out = await check_statutory_records_gate(pool, ORG)
    body = _text(out)

    assert "does not block" in body or "never blocks" in body
    assert "non-mandatory" in body
    for stopword in ("blocker", "cannot run", "refuse", "must be fixed before"):
        assert stopword not in body, f"the gate described itself as a blocker: {stopword!r}"
    assert "blockers" not in out, "findings must not be shaped like payroll blockers"


async def test_the_pan_section_comes_from_the_catalogue(monkeypatch):
    """s.206AA before 1 April 2026, s.397(2) on and after. Read, never written.

    Same two rows both times — only the date the handler resolves them AS OF
    changes — so this fails the moment somebody replaces the lookup with a
    literal, whichever literal they choose.
    """
    for day, expected, gone in (
        (date(2026, 3, 31), "s.206aa", "s.397(2)"),
        (date(2026, 4, 1), "s.397(2)", "s.206aa"),
    ):
        monkeypatch.setattr(
            pc, "utc_now",
            lambda d=day: datetime(d.year, d.month, d.day, 9, 0, tzinfo=timezone.utc))
        pool = _Pool(statute=list(NO_PAN_ROWS), gate_coverage=COVERAGE,
                     gate_findings=[])
        body = _text(await check_statutory_records_gate(pool, ORG))
        assert expected in body, f"{day} should cite {expected}"
        assert gone not in body, f"{day} must not cite {gone}"


async def test_no_rate_is_printed_when_the_catalogue_holds_none(monkeypatch):
    """`rate_percent` is NULL on both live versions of the higher-rate row.

    The higher rate under this section is not one number — it is the higher of
    several — so a skill that prints "20%" is asserting law the catalogue
    deliberately does not. If a rate is ever seeded, the second half of this
    test proves it is then used rather than ignored.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _Pool(statute=list(NO_PAN_ROWS), gate_coverage=COVERAGE, gate_findings=[])
    body = _text(await check_statutory_records_gate(pool, ORG))
    assert "20%" not in body and "20 per cent" not in body
    assert "records no rate" in body

    seeded = _statute("tds.higher_rate_no_pan", section="s.397(2)", rate=20,
                      effective_from=date(2026, 4, 1))
    pool = _Pool(statute=[seeded], gate_coverage=COVERAGE, gate_findings=[])
    assert "20%" in _text(await check_statutory_records_gate(pool, ORG))


async def test_a_check_that_found_nothing_says_what_it_looked_at(monkeypatch):
    """"0 of 59" is a result. A bare zero reads as a check that never ran.

    The seeded org returns nothing for the PAN check out of 59 employees who had
    tax deducted, and nothing for ESI out of nobody at all. Those two nils mean
    completely different things and the output has to distinguish them.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _Pool(statute=list(NO_PAN_ROWS), gate_coverage=COVERAGE, gate_findings=[])
    out = await check_statutory_records_gate(pool, ORG)

    assert out["coverage"]["tds_deducted_checked"] == 59
    joined = " ".join(out["caveats"])
    assert "out of 59 employee(s)" in joined
    assert "not a check that was skipped" in joined
    # ESI: nobody in scope at all, which is a different sentence.
    assert "Nobody is in scope for it at all." in joined


async def test_the_gate_says_when_it_truncated(monkeypatch):
    """A covered fraction must never read as the whole.

    This is the single most damaging thing a compliance report can do: a firm
    works the list, reaches the end and believes it is done.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _Pool(statute=list(NO_PAN_ROWS), gate_coverage=COVERAGE,
                 gate_findings=[_gate_row(code=f"EMP-{i:03d}") for i in range(5)])
    out = await check_statutory_records_gate(pool, ORG, limit=5)
    joined = " ".join(out["caveats"])
    assert "TRUNCATED" in joined and "floor, not the total" in joined


# ── 2 · brief_statutory_dues ────────────────────────────────────────────────

def _dues_pool(*, subject_status="approved", stranded=(), holidays=(),
               month="2026-06", prior=True):
    return _Pool(
        subject_run=_Row(month=month, status=subject_status, employee_count=60,
                         total_pf=215282.64, total_esi=0.0, total_pt=12000.0,
                         total_tds=754916.77, total_gross=6210330.0),
        prior_run=(_Row(month="2026-05", status="approved", total_pf=107641.0,
                        total_esi=0.0, total_pt=12000.0, total_tds=492838.0)
                   if prior else None),
        stranded_runs=list(stranded),
        holidays=[_Row(date=d) for d in holidays],
        statute=[
            _statute("epf.remittance", form="ECR", due_day=15, offset=1,
                     authority="epfo", title="Provident fund contribution and ECR",
                     effective_from=date(2017, 6, 1)),
            _statute("esi.remittance", due_day=15, offset=1, authority="esic",
                     title="Employees State Insurance contribution",
                     effective_from=date(2017, 6, 1)),
            # The live shape of the TDS row: a quarterly statement with NO
            # due_day at all. This is what makes the "invents no date" test real.
            _statute("tds.statement.salary", form="138", due_day=None,
                     authority="income_tax", title="TDS statement — salary",
                     effective_from=date(2026, 4, 1)),
        ],
    )


async def test_a_deadline_does_not_move_because_the_office_is_shut(monkeypatch):
    """The statutory date is printed unshifted. Only the TASK moves, only earlier.

    PF for a wage month is due on the 15th whether or not the 15th is a holiday,
    and the interest and damages run from the 16th regardless. The `work_by_date`
    exists so somebody acts in time; it must never be mistaken for the deadline,
    which is why the unshifted date is on the same line and labelled.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    # Make the statutory date itself a non-optional org holiday.
    pool = _dues_pool(holidays=[date(2026, 7, 15)])
    out = await brief_statutory_dues(pool, ORG)
    pf = next(d for d in out["dues"] if d["code"] == "total_pf")

    assert pf["statutory_due_date"] == "2026-07-15", "the statutory date moved"
    work_by = date.fromisoformat(pf["work_by_date"])
    assert work_by < date(2026, 7, 15), "the task was not pulled earlier"
    assert work_by.weekday() < 5
    assert "THE DEADLINE HAS NOT MOVED" in pf["work_by_note"]
    assert "never a reason to file later" in out["deadlines_do_not_move"]


async def test_nothing_invents_a_due_date_the_catalogue_does_not_hold(monkeypatch):
    """No monthly TDS deposit row exists, and no professional-tax row at all.

    Both liabilities are real and both amounts are reported. Neither may carry a
    date. Printing the 7th (TDS) or a state PT date from memory is precisely the
    defect `services/statute.py` was built to remove, and it would be invisible
    — a plausible date on a compliance page is not something a reader can catch.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    out = await brief_statutory_dues(_dues_pool(), ORG)

    for code, amount in (("total_pt", 12000.0), ("total_tds", 754916.77)):
        piece = next(d for d in out["dues"] if d["code"] == code)
        assert piece["amount"] == amount, "the amount must still be reported"
        assert piece["statutory_due_date"] is None
        assert "records no due day" in piece["statutory_due_date_note"]

    body = _text(out)
    assert "-07-07" not in body and "-08-07" not in body, "a deposit date was invented"
    assert "not_in_the_statute_catalogue" in out
    # And the form number for the wage month IS resolved — 138, not 24Q, because
    # the Income-tax Act 2025 was in force by 30 June 2026.
    tds = next(d for d in out["dues"] if d["code"] == "total_tds")
    assert tds["form"] == "138"


async def test_a_run_processed_and_never_approved_is_flagged(monkeypatch):
    """The error this flag exists to catch, and it is live in the seeded org.

    A month whose payslips exist and whose figures look settled on every
    dashboard that sums payslips, and whose approval nobody ever pressed.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _dues_pool(stranded=[
        _Row(month="2026-07", employee_count=60, statutory_total=982199.41,
             carries_stale_approval=True)])
    out = await brief_statutory_dues(pool, ORG)

    assert out["unapproved_runs"][0]["month"] == "2026-07"
    assert out["unapproved_runs"][0]["statutory_total"] == 982199.41
    joined = " ".join(out["caveats"])
    assert "never approved" in joined
    assert "STATUS is authoritative" in joined and "timestamp is stale" in joined


async def test_status_beats_approved_at(monkeypatch):
    """`approved_at` is not evidence of approval and must not be read as such.

    The seeded org's 2026-07 run carries an `approved_at` of 20:24 and a
    `processed_at` of 21:15 — approved, reopened, reprocessed, with the approval
    timestamp left behind. A predicate on the timestamp would report an
    unapproved month's PF as a settled liability.
    """
    assert pc.APPROVED_STATUSES == ("approved", "disbursed")
    _freeze(monkeypatch, date(2026, 8, 20))
    out = await brief_statutory_dues(_dues_pool(subject_status="processed",
                                                month="2026-07"), ORG)
    joined = " ".join(out["caveats"])
    assert "is NOT approved" in joined
    assert "not yet a settled liability" in joined


async def test_pf_and_esi_are_labelled_employee_plus_employer(monkeypatch):
    """`total_pf` is pf_employee + pf_employer, and a reader will not guess that.

    It is the figure REMITTED, which is the right number for this brief — but
    anybody reconciling it against the deduction column on a payslip will be out
    by the employer share, so the output has to say which one it is.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    out = await brief_statutory_dues(_dues_pool(), ORG)
    for code in ("total_pf", "total_esi"):
        piece = next(d for d in out["dues"] if d["code"] == code)
        assert "EMPLOYEE AND EMPLOYER COMBINED" in piece["note"]


async def test_last_months_figure_sits_beside_this_months(monkeypatch):
    """The whole point of the brief: a number nobody can compare is not a signal."""
    _freeze(monkeypatch, date(2026, 8, 20))
    out = await brief_statutory_dues(_dues_pool(), ORG)
    pf = next(d for d in out["dues"] if d["code"] == "total_pf")
    assert pf["last_month"]["month"] == "2026-05"
    assert pf["last_month"]["amount"] == 107641.0
    assert pf["last_month"]["change"] == round(215282.64 - 107641.0, 2)
    assert out["statutory_total"] == round(215282.64 + 0.0 + 12000.0 + 754916.77, 2)


async def test_a_missing_prior_month_is_absent_not_zero(monkeypatch):
    """A null comparison must not render as a change of zero.

    "PF unchanged" and "there was no run to compare against" are opposite
    statements, and only one of them is a reason to relax.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    out = await brief_statutory_dues(_dues_pool(prior=False), ORG)
    pf = next(d for d in out["dues"] if d["code"] == "total_pf")
    assert pf["last_month"]["amount"] is None
    assert pf["last_month"]["change"] is None
    assert any("absent, not zero" in c for c in out["caveats"])


async def test_no_approved_run_at_all_is_a_finding(monkeypatch):
    """An empty answer must say WHICH empty it is, or it reads as a broken skill."""
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _Pool(subject_run=None)
    out = await brief_statutory_dues(pool, ORG)
    assert out["dues"] == []
    assert any("finding, not a skipped check" in c for c in out["caveats"])


# ── 3 · check_attendance_exceptions ─────────────────────────────────────────

def _att_pool(**kw):
    base = dict(
        open_punches=[], absences=[],
        punch_stats=_Row(rows_in_window=284, rows_with_a_punch=12),
        missing_days=[], over_leave=[], no_balance=0,
    )
    base.update(kw)
    return _Pool(**base)


async def test_an_open_punch_today_is_somebody_still_at_their_desk(monkeypatch):
    """The `a.date < today` predicate, and why it is not an off-by-one.

    Without it this skill flags every person who has checked in this morning and
    not yet left, every single morning, and a check that cries wolf daily is a
    check nobody reads by the second week.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _att_pool()
    await check_attendance_exceptions(pool, ORG)
    punch_sql = next(s for s in pool.seen if "a.check_out IS NULL" in s)
    assert "a.date < $4::date" in punch_sql, "today's open punches are being flagged"


async def test_the_window_never_runs_past_today(monkeypatch):
    """A working day that has not happened yet is not an exception.

    Counting the rest of the month would put every employee at the top of the
    list for days nobody could have recorded.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    out = await check_attendance_exceptions(_att_pool(), ORG, month="2026-08")
    assert out["window"] == {"from": "2026-08-01", "to": "2026-08-20"}
    assert any("Days that have not happened" in c for c in out["caveats"])

    # A month that has not started at all comes back empty and says so, rather
    # than returning a window whose end precedes its start.
    out = await check_attendance_exceptions(_att_pool(), ORG, month="2026-12")
    assert out["findings"] == []
    assert any("has not started yet" in c for c in out["caveats"])


async def test_no_punch_data_at_all_is_disclosed_not_reported_as_absence(monkeypatch):
    """284 rows, not one check-in. The firm does not use the punch feature.

    Reporting seventy-one people as attendance exceptions because a feature is
    unused would be the most alarming and least true page this catalogue could
    produce. The counts are still given — the rows really are missing — but the
    reading is named.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _att_pool(
        punch_stats=_Row(rows_in_window=284, rows_with_a_punch=0),
        missing_days=[_Row(employee_name="Aadhya Nair", employee_code="EMP-013",
                           department="Advisory", missing_days=14,
                           employee_id="33333333-0000-4000-8000-000000000013",
                           employee_email="a13@example.com",
                           employee_phone="+91 90000 00013",
                           first_missing=date(2026, 8, 3),
                           last_missing=date(2026, 8, 20))])
    out = await check_attendance_exceptions(pool, ORG)
    joined = " ".join(out["caveats"])
    assert "NOT ONE of the 284" in joined
    assert "not as absenteeism" in joined
    assert out["counts"]["no_attendance_on_working_day"] == 1


async def test_two_employees_sharing_a_name_are_not_merged(monkeypatch):
    """The bug the live database caught within a minute of the first run.

    The missing-day query was written GROUP BY name. The seeded org has two
    distinct employees called "Aadhya Nair" (EMP-013 and EMP-053), so a window
    of fourteen working days came back reporting TWENTY-EIGHT missing days for
    one person — an impossible count, printed two lines below the window that
    disproves it. Grouping people by their name invents a person and doubles
    their exceptions.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _att_pool()
    await check_attendance_exceptions(pool, ORG)
    sql = next(s for s in pool.seen if "generate_series" in s)
    assert "GROUP BY e.id" in sql, "missing days are grouped by name again"
    assert "GROUP BY e.name" not in sql

    pool = _att_pool(missing_days=[
        _Row(employee_name="Aadhya Nair", employee_code="EMP-013",
             department="Advisory", missing_days=14,
             employee_id="33333333-0000-4000-8000-000000000013",
             employee_email="a13@example.com", employee_phone="+91 90000 00013",
             first_missing=date(2026, 8, 3), last_missing=date(2026, 8, 20)),
        _Row(employee_name="Aadhya Nair", employee_code="EMP-053",
             department="Advisory", missing_days=14,
             employee_id="33333333-0000-4000-8000-000000000053",
             employee_email="a53@example.com", employee_phone="+91 90000 00053",
             first_missing=date(2026, 8, 3), last_missing=date(2026, 8, 20)),
    ])
    out = await check_attendance_exceptions(pool, ORG)
    assert out["counts"]["no_attendance_on_working_day"] == 2
    codes = {f["employee_code"] for f in out["findings"]}
    assert codes == {"EMP-013", "EMP-053"}, "the two are indistinguishable on the page"
    assert all(f["missing_days"] == 14 for f in out["findings"])


async def test_leave_the_check_could_not_ask_about_is_disclosed(monkeypatch):
    """27 of 34 pairs in the seeded org have no balance row at all.

    Nothing can be said about whether those people are over their entitlement,
    and silence would read as "everyone is within balance" — which is the one
    conclusion the data does not support.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    out = await check_attendance_exceptions(_att_pool(no_balance=27), ORG)
    joined = " ".join(out["caveats"])
    assert "27 (employee, leave type) pair(s)" in joined
    assert "were NOT checked" in joined


async def test_leave_beyond_balance_counts_the_entitlement_not_the_used_column(monkeypatch):
    """Entitlement is allocated + carried_forward, and `used` is not evidence.

    `manav_leave_balances.used` is a denormalised counter that nothing in the
    approval path is proven to maintain; the approved requests are the fact. Both
    integer columns are cast to numeric before being added to `days`, which is
    numeric — an untyped mixed expression is what PgBouncer turns into an
    instant 500 on a parse error, twice in this repo's history.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _att_pool(over_leave=[
        _Row(employee_name="Tara Mehta", department="Audit",
             employee_id="33333333-0000-4000-8000-000000000023",
             employee_email="tara@example.com",
             employee_phone="+91 90000 00023",
             leave_type="Casual", days_taken=9, entitlement=5)])
    out = await check_attendance_exceptions(pool, ORG)
    finding = out["findings"][0]
    assert finding["days_over"] == 4
    assert finding["days_taken"] == 9 and finding["entitlement"] == 5

    sql = next(s for s in pool.seen if "manav_leave_balances b\n          ON" in s)
    assert "b.allocated::numeric + b.carried_forward::numeric" in sql
    assert "b.used" not in sql, "the denormalised counter is not the entitlement"


async def test_it_says_where_it_overlaps_payroll_readiness(monkeypatch):
    """Three of these look like duplicates of an existing skill. Two are not.

    `check_payroll_readiness` reports an employee with NO attendance row anywhere
    in the month and a leave request still PENDING. This handler is day-level and
    adds an absence with no request at all. Somebody will eventually delete one
    of the two as redundant, and the output is where they will look first.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    out = await check_attendance_exceptions(_att_pool(), ORG)
    note = out["overlap_with_payroll_readiness"]
    assert "check_payroll_readiness" in note
    assert "day-level rather than month-level" in note


async def test_an_absence_with_no_request_is_not_a_pending_request(monkeypatch):
    """The distinction that makes this check new rather than a copy.

    `unapproved_leave` in `check_payroll_readiness` finds a request awaiting a
    decision. This finds a day marked absent with no request of any kind — a
    different fact, a different fix, and detected nowhere else.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _att_pool(absences=[_Row(employee_name="Isha Desai",
                                    employee_id="33333333-0000-4000-8000-000000000031",
                                    employee_email="isha@example.com",
                                    employee_phone="+91 90000 00031",
                                    department="Taxation", date=date(2026, 8, 11))])
    out = await check_attendance_exceptions(pool, ORG)
    assert out["findings"][0]["check"] == "absent_without_approved_leave"

    sql = next(s for s in pool.seen if "a.status = 'absent'" in s)
    assert "lr.status = 'approved'" in sql
    assert "lr.status = 'pending'" not in sql


async def test_an_unparseable_month_is_refused_rather_than_guessed(monkeypatch):
    """'2026-00' is a valid 1 January to `date()` and would silently shift the year."""
    _freeze(monkeypatch, date(2026, 8, 20))
    for bad in ("2026-00", "2026-13", "not-a-month", "202608"):
        out = await check_attendance_exceptions(_att_pool(), ORG, month=bad)
        assert "error" in out, f"{bad!r} was accepted"


# ── 4 · brief_unpaid_reimbursements ─────────────────────────────────────────

def _claim(**kw):
    row = _Row(
        employee_id="aaaaaaaa-0000-4000-8000-000000000001",
        employee_name="E2E Hire d3ygc", employee_code="EMP-101",
        department="Audit", category="travel", amount=2400.0,
        expense_date=date(2026, 8, 3), approved_on=date(2026, 8, 3),
        age_days=17, aged_from_expense_date=False,
    )
    row.update(kw)
    return row


async def test_the_age_buckets_do_not_overlap(monkeypatch):
    """The brief said "0-15 / 16-30 / 30+", and 30 falls in two of those.

    A claim counted twice makes the bucket column add up to more than the
    headline, which is the tie-out failure that destroys trust in a page — the
    reader cannot tell which of the two figures is the wrong one.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    ages = (0, 15, 16, 30, 31, 400)
    pool = _Pool(claims=[_claim(age_days=a, amount=100.0) for a in ages])
    out = await brief_unpaid_reimbursements(pool, ORG)

    assert sum(b["claims"] for b in out["by_age"]) == len(ages)
    assert round(sum(b["amount"] for b in out["by_age"]), 2) == out["totals"]["amount"]
    got = {b["bucket"]: b["claims"] for b in out["by_age"]}
    assert got == {"0-15 days": 2, "16-30 days": 2, "31+ days": 2}
    assert "31 and not 30" in out["how_ageing_works"]


async def test_a_claim_with_no_approval_date_cannot_look_new(monkeypatch):
    """The COALESCE goes INSIDE the subtraction, and the row says which basis.

    Around it, a NULL `approved_at` makes the whole expression NULL, the row ages
    as zero days and lands in the freshest bucket — the one place an unpaid claim
    must never be able to hide.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _Pool(claims=[_claim(approved_on=None, age_days=200,
                                aged_from_expense_date=True,
                                expense_date=date(2026, 2, 1))])
    out = await brief_unpaid_reimbursements(pool, ORG)

    assert out["by_age"][2]["claims"] == 1, "it must age into 31+, not 0-15"
    assert out["oldest"]["aged_from"] == "expense date"
    assert any("aged from the expense date" in c for c in out["caveats"])

    sql = next(s for s in pool.seen if "manav_expense_claims c" in s)
    assert "$2::date - COALESCE(c.approved_at::date, c.expense_date)" in sql


async def test_unpaid_means_no_payslip_ever_picked_it_up(monkeypatch):
    """`payslip_id IS NULL` and `status = 'approved'` — both halves, exactly.

    A pending claim is a decision somebody still has to make, not money owed;
    `check_payroll_readiness` already warns about those, and folding them in here
    would overstate the debt by everything nobody has agreed to yet.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _Pool(claims=[])
    await brief_unpaid_reimbursements(pool, ORG)
    sql = pool.seen[0]
    assert "c.status = 'approved'" in sql
    assert "c.payslip_id IS NULL" in sql
    # And the tenant guard on the name join: the FK is on id alone, so a join on
    # id can surface another practice's employee name against this org's claim.
    assert "e.id = c.employee_id AND e.org_id = c.org_id" in sql


async def test_two_claimants_sharing_a_name_are_not_merged(monkeypatch):
    """The same defect as the attendance grouping, in the money column.

    Merging two people invents one employee owed the sum of two people's claims
    — a figure nobody can reconcile, and a disclosure of one person's expenses
    to whoever looks up the other.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _Pool(claims=[
        _claim(employee_id="aaaaaaaa-0000-4000-8000-000000000001",
               employee_name="Kabir Malhotra", employee_code="EMP-002"),
        _claim(employee_id="aaaaaaaa-0000-4000-8000-000000000002",
               employee_name="Kabir Malhotra", employee_code="EMP-042"),
    ])
    out = await brief_unpaid_reimbursements(pool, ORG)

    assert out["totals"]["employees"] == 2
    assert len(out["by_employee"]) == 2
    assert {e["employee_code"] for e in out["by_employee"]} == {"EMP-002", "EMP-042"}
    assert all(e["amount"] == 2400.0 for e in out["by_employee"])
    assert out["by_department"][0]["employees"] == 2


async def test_the_totals_tie_out(monkeypatch):
    """Every aggregate on the page is drawn from one population.

    A reader will add up the by-employee column and the by-department column and
    expect both to reach the headline. They must.
    """
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _Pool(claims=[
        _claim(employee_id=f"aaaaaaaa-0000-4000-8000-00000000000{i}",
               employee_code=f"EMP-10{i}", employee_name=f"Hire {i}",
               department="Audit" if i % 2 else "Taxation",
               amount=1000.0 * i, age_days=i * 10)
        for i in range(1, 6)
    ])
    out = await brief_unpaid_reimbursements(pool, ORG)
    headline = out["totals"]["amount"]

    assert round(sum(e["amount"] for e in out["by_employee"]), 2) == headline
    assert round(sum(d["amount"] for d in out["by_department"]), 2) == headline
    assert round(sum(b["amount"] for b in out["by_age"]), 2) == headline
    assert out["oldest"]["age_days"] == 50


async def test_it_says_when_it_truncated(monkeypatch):
    """Oldest first, and the totals are then a FLOOR, said in words."""
    _freeze(monkeypatch, date(2026, 8, 20))
    pool = _Pool(claims=[_claim(employee_id=f"aaaaaaaa-0000-4000-8000-00000000000{i}",
                                employee_code=f"EMP-2{i}") for i in range(3)])
    out = await brief_unpaid_reimbursements(pool, ORG, limit=3)
    joined = " ".join(out["caveats"])
    assert "TRUNCATED at 3 claims" in joined
    assert "floor" in joined


async def test_nothing_owing_is_a_finding(monkeypatch):
    """An empty page must say it checked, or it reads as a skill that failed."""
    _freeze(monkeypatch, date(2026, 8, 20))
    out = await brief_unpaid_reimbursements(_Pool(claims=[]), ORG)
    assert out["totals"]["claims"] == 0
    assert any("finding, not a skipped check" in c for c in out["caveats"])
