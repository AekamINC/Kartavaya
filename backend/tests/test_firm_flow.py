"""
firm_flow — the ways these three could be confidently wrong.

Not the arithmetic. The arithmetic is four additions and a weekday check, and
none of it is what would put a wrong answer in front of a chartered accountant.
These are the lies:

  #29 · a filing calendar
    · `test_the_statutory_date_is_never_moved_forward` — THE ONE THAT MATTERS.
      A due date does not move because it fell on a Sunday. If `work_by` were
      ever later than `statutory_due_on`, this product would be telling a firm
      it may file late, and the firm would.
    · `test_an_optional_holiday_does_not_shift_anything` — `is_optional` means
      the office is open. Shifting for it moves every filing date a week early,
      every year, and nobody would ever notice it was wrong.
    · `test_a_missing_statute_row_is_reported_not_invented` — the live case.
      `tds.deposit.monthly` expired 2026-04-01 with no successor, so the 7th of
      the month is ABSENT from the calendar. A calendar quietly one date short
      looks exactly like a complete one.
    · `test_no_form_number_is_printed_from_memory` — every printed form number
      came from the fake calendar row, so a handler that hardcoded 'GSTR-1'
      would fail here even though the live output would look right.
    · `test_the_as_of_date_is_the_period_end_not_today` — the whole reason
      `services.statute` refuses to default `as_of`.

  #30 · approvals that sit
    · `test_the_ladder_never_skips_a_rung` — a twenty-day-old approval nobody
      has pinged owes the FIRST ping, not an escalation to a partner.
    · `test_an_approval_on_a_deleted_project_is_not_chased` — nobody can open
      it, so asking an approver to decide it asks for an impossible thing.
    · `test_the_escalation_never_invents_a_person` — with no org admin, rung
      three names nobody and says so.
    · `test_no_uuid_and_no_user_id_is_rendered_as_a_name`.

  #32 · lead first touch
    · `test_an_opted_out_lead_gets_no_link` — the single unrecoverable mistake
      here. A refusal next to a one-tap link is a refusal that gets tapped
      through.
    · `test_a_number_with_no_country_code_is_refused_not_assumed` — a wa.me
      link to a guessed number is a message to a stranger.
    · `test_an_empty_marketplace_feed_says_so` — 0 leads because the
      integration has never run is not 0 leads because everyone was contacted.
    · `test_the_message_is_deterministic` — no model wrote this sentence, and
      the same lead produces the same text twice.

Live figures, read-only 2026-08-20, all three orgs, every output through
`json.dumps(default=str)`:

  #29  4 dated monthly obligations in August 2026 for all three orgs (GSTR-1
       11th, EPF ECR and ESI 15th, GSTR-3B 20th), 2 shifted — 15 August is a
       Saturday so the EPF/ESI work date is Friday 14 August. 1 calendar gap
       (`tds.deposit.monthly`) in every org. Holiday rows in the window: Aekam
       0, E2E 1, Unicode 2 (one of which is optional and shifts nothing).
  #30  9 pending in E2E, 7 in Unicode Group (3 of them on a deleted project),
       0 in Aekam Inc. All 16 aged past seven days; all 16 on rung one.
  #32  0 marketplace leads anywhere — no contact in the database carries an
       indiamart or justdial source. 4 untouched leads in E2E in 14 days, 1 in
       Unicode Group, 0 in Aekam Inc.
"""
import inspect
import json
from datetime import date, datetime, timezone

import pytest

from services.skills.data import firm_flow as ff
from services.skills.data.firm_flow import (
    EXPECTED_MONTHLY_KEYS, LADDER, MARKETPLACE_SOURCES,
    brief_firm_filing_calendar, check_approvals_that_sit, pack_lead_first_touch,
    _first_message, _rung_for, _shift_back, _wa_number,
)

ORG = "00000000-0000-4000-8000-000000000029"
TODAY = date(2026, 8, 20)
NOW = datetime(2026, 8, 20, 6, 0, tzinfo=timezone.utc)


# ══════════════════════════════════════════════════════════════════════════
# the fake pool
# ══════════════════════════════════════════════════════════════════════════

def _statute(key, **kw):
    """One `staging.statute_calendar` row, with every column `services.statute`
    reads. Defaults are a monthly return due on the 11th of the following
    month — GSTR-1's shape — because that is the shape the handler leans on."""
    row = {
        "obligation_key": key, "title": f"title for {key}", "authority": "gst",
        "statute": "CGST Act 2017", "form_number": "FORM-FROM-THE-CALENDAR",
        "section_ref": "s.37", "periodicity": "monthly", "due_day": 11,
        "due_month": None, "due_month_offset": 1, "window_days": None,
        "rate_percent": None, "threshold_amount": None, "state_code": None,
        "effective_from": date(2021, 1, 1), "effective_to": None,
        "effective_from_exact": True, "source_ref": None, "notes": None,
        "verified_on": date(2026, 8, 19),
    }
    row.update(kw)
    return row


class _Pool:
    """Canned rows matched on a FRAGMENT OF THE SQL, never on call order.

    The statute arm FILTERS ON THE BIND PARAMETER, which is not optional
    politeness: `services.statute._resolve` picks the newest covering row out of
    whatever it is handed, so a fake pool that ignored `args[0]` would let a
    test about GSTR-1 be answered with a fact about EPF and still pass.
    """

    def __init__(self, statute=None, holidays=None, org=None, approvals=None,
                 tallies=None, approvers=None, escalation=None, leads=None,
                 consent=None):
        self.statute = statute if statute is not None else []
        self.holidays = holidays or []
        self.org = org
        self.approvals = approvals or []
        self.tallies = tallies or []
        self.approvers = approvers or []
        self.escalation = escalation or []
        self.leads = leads or []
        self.consent = consent or []
        self.seen: list[tuple[str, tuple]] = []

    async def fetch(self, sql, *a):
        self.seen.append((sql, a))
        if "staging.statute_calendar" in sql:
            if "obligation_key = $1" in sql:
                return [r for r in self.statute if r["obligation_key"] == a[0]]
            # the listing form: authority / key_prefix / periodicity / state
            rows = self.statute
            if a[0] is not None:
                rows = [r for r in rows if r["authority"] == a[0]]
            if a[1] is not None:
                rows = [r for r in rows if r["obligation_key"].startswith(a[1])]
            if a[2] is not None:
                rows = [r for r in rows if r["periodicity"] == a[2]]
            return rows
        if "staging.manav_holidays" in sql:
            return self.holidays
        if "public.approvals" in sql and "count(*)" in sql:
            return self.tallies
        if "public.approvals" in sql:
            return self.approvals
        if "project_assignments" in sql:
            return self.approvers
        if "staging.user_roles" in sql:
            return self.escalation
        if "staging.graha_contacts" in sql:
            return self.leads
        if "staging.varta_contacts" in sql:
            return self.consent
        return []

    async def fetchrow(self, sql, *a):
        self.seen.append((sql, a))
        if "staging.organisations" in sql:
            return self.org
        return None

    async def fetchval(self, sql, *a):
        return None


def _org(**kw):
    row = {"name": "Shah & Associates", "state_code": "27",
           "gst_filing_scheme": "monthly", "has_tan": True}
    row.update(kw)
    return row


def _holiday(day, name, optional=False):
    return {"date": day, "name": name, "is_optional": optional}


def _approval(**kw):
    row = {
        "approval_id": "appr_958c2c5256e5",
        "task_id": "task_17f0b8763c95",
        "team_id": "team_1682e055fd21",
        "request_type": "create",
        "created_at": datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc),
        "team_name": "Statutory Compliance FY 2026-27",
        "is_deleted": False,
        "what": "Kalpataru — reply to section 61 notice",
        "requested_by": "Priya Desai",
    }
    row.update(kw)
    return row


def _lead(**kw):
    row = {
        "id": "3f2a1b4c-5d6e-4f70-8901-abcdefabcdef",
        "name": "Rakesh Bhatia",
        "company": "Bhatia Steels",
        "phone": "+91 98120 45678",
        "phone_norm": "9812045678",
        "email": "rakesh@bhatiasteels.in",
        "source": "indiamart",
        "contact_type": "lead",
        "created_at": datetime(2026, 8, 18, 9, 30, tzinfo=timezone.utc),
        "notes": "[indiamart 2026-08-18] Enquiry about GST registration for a "
                 "new branch",
        "feed_source": "indiamart",
        "feed_ref": "IM-55512",
        "feed_time": None,
        "company_name": "Bhatia Steels",
    }
    row.update(kw)
    return row


def _consent(contact_id, opted_in, phone="+91 98120 45678"):
    return {"contact_id": contact_id, "phone_number": phone,
            "opted_in": opted_in,
            "opted_in_at": datetime(2026, 6, 4, tzinfo=timezone.utc)
            if opted_in else None}


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(ff, "utc_now", lambda: NOW)


def _no_limitations(out: dict) -> str:
    """Everything the reader sees EXCEPT the caveats.

    A caveat explaining why a thing is not claimed necessarily contains the
    words of the claim — "no marketplace lead was found" contains "marketplace"
    — so an absence assertion that included `limitations` would be asserting
    against its own honesty text.
    """
    return json.dumps({k: v for k, v in out.items() if k != "limitations"},
                      default=str)


# ══════════════════════════════════════════════════════════════════════════
# the contract every handler in this file owes
# ══════════════════════════════════════════════════════════════════════════

HANDLERS = (brief_firm_filing_calendar, check_approvals_that_sit,
            pack_lead_first_touch)


@pytest.mark.parametrize("fn", HANDLERS, ids=lambda f: f.__name__)
def test_every_parameter_after_org_id_has_a_default(fn):
    """A handler with a required parameter cannot be scheduled, and
    `tests/test_a_skill_can_run_unattended.py` fails the build over it. A month,
    a window and a cap all have an answer a machine can work out at 6am."""
    params = list(inspect.signature(fn).parameters.items())
    assert [p[0] for p in params[:2]] == ["pool", "org_id"]
    missing = [n for n, s in params[2:] if s.default is inspect.Parameter.empty]
    assert not missing, f"{fn.__name__} cannot be scheduled: {missing}"


@pytest.mark.parametrize("fn", HANDLERS, ids=lambda f: f.__name__)
@pytest.mark.asyncio
async def test_an_empty_org_still_answers_the_contract(fn, frozen):
    """Counts, honest limitations, and JSON that survives the wire — on an org
    with nothing in it, which is the run most likely to be shipped untested."""
    out = await fn(_Pool(), ORG)
    json.dumps(out, default=str)
    assert isinstance(out["counts"], dict) and out["counts"]
    assert out["limitations"] and all(isinstance(x, str) for x in out["limitations"])


# ══════════════════════════════════════════════════════════════════════════
# 29 · the filing calendar
# ══════════════════════════════════════════════════════════════════════════

def test_the_shift_walks_backward_off_a_weekend():
    """15 August 2026 is a Saturday. The work date is Friday the 14th."""
    day, why = _shift_back(date(2026, 8, 15), {})
    assert day == date(2026, 8, 14)
    assert "Saturday" in why


def test_the_shift_walks_past_a_holiday_and_then_the_weekend():
    day, why = _shift_back(
        date(2026, 8, 17),                      # a Monday
        {date(2026, 8, 17): "Independence Day (observed)"},
    )
    assert day == date(2026, 8, 14)             # Fri, over Sun 16 and Sat 15
    assert "Independence Day (observed)" in why


def test_a_working_day_is_left_alone():
    day, why = _shift_back(date(2026, 8, 20), {})
    assert (day, why) == (date(2026, 8, 20), None)


def test_an_impossible_holiday_list_reports_the_statutory_date_unshifted():
    """Fourteen consecutive blocked days is a data fault, not a calendar.
    Walking into the previous month silently would be worse than saying so."""
    blocked = {date(2026, 8, 20) - __import__("datetime").timedelta(days=n):
               "seeded wrong" for n in range(0, 40)}
    day, why = _shift_back(date(2026, 8, 20), blocked)
    assert day == date(2026, 8, 20)
    assert "holiday list looks wrong" in why


@pytest.mark.asyncio
async def test_the_statutory_date_is_never_moved_forward(frozen):
    """THE TEST THIS FILE EXISTS FOR.

    A GST due date does not move because it fell on a Sunday, and a firm that
    filed on the Monday because a calendar said so has filed late. `work_by`
    must be on or before `statutory_due_on`, on every row, for ever.
    """
    pool = _Pool(
        statute=[_statute("gst.return.gstr1", due_day=11),
                 _statute("gst.return.gstr3b", due_day=20),
                 _statute("epf.remittance", due_day=15, authority="epfo")],
        org=_org(),
        # Nine straight blocked days after the 11th would tempt any
        # forward-shifting implementation into August 20th.
        holidays=[_holiday(date(2026, 8, d), "seeded") for d in range(12, 21)],
    )
    out = await brief_firm_filing_calendar(pool, ORG, month="2026-08")
    assert out["dates"]
    for row in out["dates"]:
        assert row["work_by"] <= row["statutory_due_on"], row
        assert row["shifted_by_days"] >= 0


@pytest.mark.asyncio
async def test_an_optional_holiday_does_not_shift_anything(frozen):
    """`is_optional` means the office is open and some people are away.

    Treating it as a closure moves every filing date earlier than it needs to
    be, every year, and produces a calendar nobody can prove wrong.
    """
    pool = _Pool(
        statute=[_statute("gst.return.gstr1", due_day=11)],
        org=_org(),
        holidays=[_holiday(date(2026, 8, 11), "Optional festival", optional=True)],
    )
    out = await brief_firm_filing_calendar(pool, ORG, month="2026-08")
    row = out["dates"][0]
    assert row["statutory_due_on"] == date(2026, 8, 11)
    assert row["work_by"] == date(2026, 8, 11)
    assert row["shifted_by_days"] == 0
    # Surfaced rather than swallowed — a partner deciding whether Tuesday is
    # safe wants to know half the team may be away.
    assert row["optional_holidays_near_the_date"] == ["Optional festival"]
    assert out["counts"]["optional_holidays_recorded"] == 1


@pytest.mark.asyncio
async def test_a_missing_statute_row_is_reported_not_invented(frozen):
    """The live case, and the reason `EXPECTED_MONTHLY_KEYS` exists.

    `tds.deposit.monthly` ends 2026-04-01 with no successor, so from April 2026
    the calendar records no monthly TDS deposit at all. An obligation that
    simply vanishes from `obligations()` leaves a calendar that is one date
    short and looks complete.
    """
    pool = _Pool(statute=[_statute("gst.return.gstr1")], org=_org())
    out = await brief_firm_filing_calendar(pool, ORG, month="2026-08")

    gaps = {g["obligation_key"] for g in out["calendar_gaps"]}
    assert "tds.deposit.monthly" in gaps
    assert gaps == set(EXPECTED_MONTHLY_KEYS) - {"gst.return.gstr1"}
    assert out["counts"]["calendar_gaps"] == len(gaps)
    assert all(g["resolved"] is False for g in out["calendar_gaps"])
    # And no date is printed for any of them.
    body = _no_limitations(out)
    assert "tds.deposit" in body          # named
    for row in out["dates"]:
        assert row["obligation_key"] != "tds.deposit.monthly"


@pytest.mark.asyncio
async def test_no_form_number_is_printed_from_memory(frozen):
    """Every form number, section and title comes off the calendar row.

    A handler that hardcoded 'GSTR-1' would look right against live data and
    would print last year's form the day the law renumbers it — which is
    exactly what happened to 24Q and Form 16 on 1 April 2026.
    """
    pool = _Pool(
        statute=[_statute("gst.return.gstr1", form_number="FORM-138-NOT-24Q",
                          section_ref="s.397(2)", title="A renamed return")],
        org=_org(),
    )
    out = await brief_firm_filing_calendar(pool, ORG, month="2026-08")
    row = out["dates"][0]
    assert row["form_number"] == "FORM-138-NOT-24Q"
    assert row["section_ref"] == "s.397(2)"
    assert row["what"] == "A renamed return"
    assert "GSTR-1" not in _no_limitations(out)


@pytest.mark.asyncio
async def test_the_as_of_date_is_the_period_end_and_not_today(frozen):
    """August's calendar lists July's returns, so the law is resolved as of
    31 July — never as of the day the report is run. This is the whole reason
    `services.statute.obligation` refuses to default `as_of`."""
    pool = _Pool(statute=[_statute("gst.return.gstr1")], org=_org())
    out = await brief_firm_filing_calendar(pool, ORG, month="2026-08")
    assert out["resolved_as_of"] == date(2026, 7, 31)
    assert out["period_covered_by_monthly_returns"] == "2026-07"
    assert out["dates"][0]["covers_period"] == "2026-07"
    assert out["as_at"] == TODAY               # and today is reported separately


@pytest.mark.asyncio
async def test_the_month_defaults_to_the_one_we_are_standing_in(frozen):
    pool = _Pool(statute=[_statute("gst.return.gstr1")], org=_org())
    out = await brief_firm_filing_calendar(pool, ORG)
    assert out["month"] == "2026-08"


@pytest.mark.asyncio
async def test_january_rolls_the_period_back_a_year(frozen):
    """January's returns cover the previous December. An off-by-one here
    resolves the law a year early and is invisible eleven months of twelve."""
    pool = _Pool(statute=[_statute("gst.return.gstr1")], org=_org())
    out = await brief_firm_filing_calendar(pool, ORG, month="2027-01")
    assert out["period_covered_by_monthly_returns"] == "2026-12"
    assert out["resolved_as_of"] == date(2026, 12, 31)
    assert out["dates"][0]["statutory_due_on"] == date(2027, 1, 11)


@pytest.mark.asyncio
async def test_an_obligation_with_no_due_day_is_named_but_never_dated(frozen):
    """Every quarterly TDS and TCS statement in the live calendar has a NULL
    `due_day`. Naming them without a date is honest; inventing the 31st is
    the kind of plausible wrong number that ends the reader's trust."""
    pool = _Pool(
        statute=[_statute("tds.statement.salary", due_day=None,
                          due_month_offset=None, form_number="138")],
        org=_org(),
    )
    out = await brief_firm_filing_calendar(pool, ORG, month="2026-08")
    assert out["dates"] == []
    assert len(out["named_but_undated"]) == 1
    assert out["named_but_undated"][0]["form_number"] == "138"
    assert "no due day" in out["named_but_undated"][0]["why_no_date"]


@pytest.mark.asyncio
async def test_an_empty_holiday_list_is_not_a_firm_without_holidays(frozen):
    """Aekam Inc has zero holiday rows. An org that never filled the list in
    and one that genuinely works every public holiday look identical, and only
    one of those is safe to act on."""
    pool = _Pool(statute=[_statute("gst.return.gstr1")], org=_org(), holidays=[])
    out = await brief_firm_filing_calendar(pool, ORG, month="2026-08")
    assert out["counts"]["holidays_recorded"] == 0
    assert any("NO HOLIDAY IS RECORDED" in x for x in out["limitations"])


@pytest.mark.asyncio
async def test_a_malformed_month_answers_with_nothing_rather_than_a_wrong_month(frozen):
    out = await brief_firm_filing_calendar(_Pool(), ORG, month="August")
    assert out["dates"] == []
    assert out["counts"]["could_not_run"] == 1
    assert any("not a month" in x for x in out["limitations"])


@pytest.mark.asyncio
async def test_the_calendar_says_it_is_the_firms_own_and_not_per_client(frozen):
    """ORG GRAIN ONLY. A reader must not be able to mistake this for the
    per-client filing board, which is catalogue #45/#46 and is blocked."""
    pool = _Pool(statute=[_statute("gst.return.gstr1")], org=_org())
    out = await brief_firm_filing_calendar(pool, ORG, month="2026-08")
    assert any("no client" in x.lower() for x in out["limitations"])
    assert any("APPLICABILITY IS NOT CHECKED" in x for x in out["limitations"])


@pytest.mark.asyncio
async def test_the_org_state_code_is_passed_to_the_statute_lookup(frozen):
    """A state row outranks the all-India row. None is seeded today; a handler
    that never passed the state would silently keep it that way."""
    pool = _Pool(statute=[_statute("gst.return.gstr1")], org=_org(state_code="27"))
    await brief_firm_filing_calendar(pool, ORG, month="2026-08")
    listing = [a for sql, a in pool.seen
               if "staging.statute_calendar" in sql and "obligation_key = $1" not in sql]
    assert listing and listing[0][3] == "27"


# ══════════════════════════════════════════════════════════════════════════
# 30 · approvals that sit
# ══════════════════════════════════════════════════════════════════════════

def test_nothing_is_due_before_the_first_rung():
    assert _rung_for(1, 0)["action"] == "nothing yet"
    assert _rung_for(1, 0)["rung"] == 0


def test_each_threshold_moves_the_rung():
    assert _rung_for(2, 0)["action"] == "ping the approver"
    assert _rung_for(4, 1)["action"] == "copy the requester"
    assert _rung_for(7, 2)["action"] == "escalate inside the firm"


def test_the_ladder_never_skips_a_rung():
    """An approval that surfaces at twenty days with nothing sent owes the
    FIRST ping. Jumping to rung three sends a partner an escalation about a
    request the approver has never once been told about."""
    assert _rung_for(20, 0)["action"] == "ping the approver"
    assert _rung_for(20, 0)["rung"] == 1


def test_a_rung_already_covered_is_not_repeated():
    assert _rung_for(3, 1)["action"] == "already done"


@pytest.mark.asyncio
async def test_an_aged_approval_reports_the_rung_its_age_reached(frozen):
    """The gap between what is OWED and how old it is, printed.

    With the chase count structurally pinned at zero, a twenty-day-old approval
    comes back on rung one for ever. A reader seeing only "ping the approver"
    would reasonably conclude nothing has aged, so the age-entitled rung sits
    beside it.
    """
    pool = _Pool(approvals=[_approval()], org=_org())
    out = await check_approvals_that_sit(pool, ORG)
    row = out["ping_the_approver"][0]
    assert row["days_waiting"] == 20
    assert row["rung"] == 1
    assert row["rung_the_age_alone_would_reach"] == 3
    assert row["aged_past_escalation"] is True
    assert out["counts"]["aged_past_escalation"] == 1
    assert out["counts"]["escalations_due"] == 0


@pytest.mark.asyncio
async def test_the_chase_count_is_reported_as_unavailable_not_as_zero_chases(frozen):
    """`staging.reminders.entity_id` is a uuid and `approval_id` is text, so no
    approval chase can EVER have been recorded. Reporting 0 without saying that
    reads as 'nobody has chased this', which is a claim this cannot make."""
    pool = _Pool(approvals=[_approval()], org=_org())
    out = await check_approvals_that_sit(pool, ORG)
    row = out["ping_the_approver"][0]
    assert row["chases_delivered"] == 0
    assert row["chase_history_available"] is False
    assert any("CANNOT SUBTRACT" in x for x in out["limitations"])


@pytest.mark.asyncio
async def test_an_approval_on_a_deleted_project_is_not_chased(frozen):
    """Nobody can open it, so asking an approver to decide it asks for an
    impossible thing — the same reasoning that takes an expired signature off
    the chase ladder. Counted AND rendered, in its own list."""
    pool = _Pool(
        approvals=[_approval(approval_id="ap_dfdecedc8a9d", is_deleted=True,
                             team_name="Keval To Do")],
        org=_org(),
    )
    out = await check_approvals_that_sit(pool, ORG)
    assert out["ping_the_approver"] == []
    assert out["counts"]["on_a_deleted_project"] == 1
    assert len(out["on_a_deleted_project"]) == 1
    row = out["on_a_deleted_project"][0]
    assert row["action"] == "cannot be chased — the project was deleted"
    assert row["rung"] == 0
    assert any("DELETED project" in x for x in out["limitations"])


@pytest.mark.asyncio
async def test_a_decided_approval_leaves_the_ladder(frozen):
    """'Exits on any decision.' Only pending rows are read, and the denominator
    is reported so a clean queue never looks like an unused mechanism."""
    pool = _Pool(approvals=[], org=_org(),
                 tallies=[{"status": "approved", "n": 19},
                          {"status": "rejected", "n": 2}])
    out = await check_approvals_that_sit(pool, ORG)
    assert out["counts"]["pending"] == 0
    assert out["counts"]["decided"] == 21
    assert out["by_status"] == {"approved": 19, "rejected": 2}
    sql = " ".join(s for s, _ in pool.seen)
    assert "a.status = 'pending'" in sql


@pytest.mark.asyncio
async def test_the_escalation_never_invents_a_person(frozen):
    """`manav_employees.reporting_to` is empty on every live row, so there is
    no manager to name. With no org admin either, rung three has no
    destination — and saying so beats routing an escalation to whoever is
    nearest."""
    pool = _Pool(approvals=[_approval()], org=_org(), escalation=[])
    out = await check_approvals_that_sit(pool, ORG)
    assert out["escalates_to"] is None
    assert out["ping_the_approver"][0]["escalate_to"] is None
    assert any("no destination" in x for x in out["limitations"])


@pytest.mark.asyncio
async def test_the_escalation_says_it_is_a_role_and_not_a_manager(frozen):
    pool = _Pool(
        approvals=[_approval()], org=_org(),
        escalation=[{"role_code": "org_admin", "person": "Nisha Trivedi"}],
    )
    out = await check_approvals_that_sit(pool, ORG)
    assert out["escalates_to"] == ["Nisha Trivedi"]
    assert out["ping_the_approver"][0]["escalation_is_a_role_not_a_manager"] is True
    assert any("ROLE, NOT A REPORTING LINE" in x for x in out["limitations"])


@pytest.mark.asyncio
async def test_an_approval_with_no_approver_names_nobody(frozen):
    """A "waiting on" that names somebody with no button is worse than naming
    nobody: it sends the ping to a person who cannot act on it."""
    pool = _Pool(approvals=[_approval()], org=_org(), approvers=[])
    out = await check_approvals_that_sit(pool, ORG)
    assert out["ping_the_approver"][0]["waiting_on"] is None
    assert out["counts"]["with_no_approver_to_ping"] == 1
    assert any("NO owner or admin" in x for x in out["limitations"])


@pytest.mark.asyncio
async def test_no_uuid_and_no_user_id_is_rendered_as_a_name(frozen):
    """Ids may be row handles the UI acts on. They may never be a person or a
    project. `approval_id` and `task_id` are the handles; nothing else in the
    payload may look like an identifier."""
    pool = _Pool(
        approvals=[_approval()], org=_org(),
        approvers=[{"team_id": "team_1682e055fd21", "role": "owner",
                    "person": "KEVAL SHAH"}],
        escalation=[{"role_code": "org_admin", "person": "Nisha Trivedi"}],
    )
    out = await check_approvals_that_sit(pool, ORG)
    row = out["ping_the_approver"][0]
    assert row["requested_by"] == "Priya Desai"
    assert row["waiting_on"] == ["KEVAL SHAH"]
    for field in ("requested_by", "project", "what"):
        assert not str(row[field]).startswith("user_")
        assert ORG not in str(row[field])
    payload = _no_limitations(out)
    assert "user_" not in payload
    assert ORG not in payload


@pytest.mark.asyncio
async def test_it_says_it_reads_only_one_of_two_approval_mechanisms(frozen):
    """`tasks.approval_status` is a second, live mechanism this does not read,
    so the pending count is a FLOOR. A floor presented as a total is the kind
    of quiet undercount a partner acts on."""
    out = await check_approvals_that_sit(_Pool(org=_org()), ORG)
    assert any("approval_status" in x and "FLOOR" in x for x in out["limitations"])


@pytest.mark.asyncio
async def test_it_never_writes(frozen):
    """No INSERT, UPDATE or DELETE reaches the pool from any of the three —
    not even a reminder row, because recording a chase nobody sent is worse
    than sending none."""
    pool = _Pool(approvals=[_approval()], org=_org(),
                 statute=[_statute("gst.return.gstr1")], leads=[_lead()])
    for fn in HANDLERS:
        await fn(pool, ORG)
    for sql, _ in pool.seen:
        flat = " ".join(sql.split()).upper()
        assert "INSERT INTO" not in flat
        assert "UPDATE " not in flat
        assert "DELETE FROM" not in flat


# ══════════════════════════════════════════════════════════════════════════
# 32 · lead first touch
# ══════════════════════════════════════════════════════════════════════════

def test_an_indian_mobile_gets_its_country_code():
    assert _wa_number("9812045678", None)[0] == "919812045678"
    assert _wa_number("+91 98120 45678", "9812045678")[0] == "919812045678"
    assert _wa_number("+919812045678", None)[0] == "919812045678"
    assert _wa_number("09812045678", None)[0] == "919812045678"


def test_a_number_with_no_country_code_is_refused_not_assumed():
    """A wa.me link to a guessed number is a message to a stranger under the
    firm's name. Ten digits that are not an Indian mobile, and anything the
    contact did not record internationally, are refused with the reason."""
    number, why = _wa_number("5551234567", None)      # not 6-9: not a mobile
    assert number is None and "does not begin 6-9" in why

    number, why = _wa_number("1234", None)
    assert number is None and "carries no country code" in why

    number, why = _wa_number("", None)
    assert number is None and "no phone number" in why


def test_an_international_number_is_only_taken_when_it_says_it_is_one():
    """A twelve-digit local number typed without a plus must not become a link
    to another country."""
    assert _wa_number("+44 7700 900123", None)[0] == "447700900123"
    assert _wa_number("447700900123", None)[0] is None


@pytest.mark.asyncio
async def test_an_opted_out_lead_gets_no_link(frozen):
    """The single unrecoverable mistake this handler could make.

    A refusal displayed next to a one-tap link is a refusal that gets tapped
    through, and there is no undo on a WhatsApp message.
    """
    pool = _Pool(org=_org(), leads=[_lead()],
                 consent=[_consent("3f2a1b4c-5d6e-4f70-8901-abcdefabcdef", False)])
    out = await pack_lead_first_touch(pool, ORG)
    assert out["marketplace_first_touch"] == []
    assert out["counts"]["opted_out_no_link"] == 1
    row = out["opted_out_no_link"][0]
    assert row["consent"] == "opted out"
    assert "wa_link" not in row
    assert "wa.me" not in _no_limitations(out)


@pytest.mark.asyncio
async def test_consent_is_matched_on_the_phone_when_the_link_is_missing(frozen):
    """`varta_contacts.graha_contact_id` is nullable. An opt-OUT recorded
    against a number but never linked to the contact must still refuse the
    link — a consent check that only works when a foreign key happens to be
    filled is not a consent check."""
    pool = _Pool(org=_org(), leads=[_lead()],
                 consent=[_consent(None, False, phone="+91 9812045678")])
    out = await pack_lead_first_touch(pool, ORG)
    assert out["counts"]["opted_out_no_link"] == 1


@pytest.mark.asyncio
async def test_a_weak_phone_match_may_refuse_but_may_never_permit(frozen):
    """The last ten digits are not an identity.

    `phone_norm` keeps ten digits and drops the country code, so a UK number
    and an Indian mobile ending the same way collide — `+447405382925` is a
    live contact in two of the three orgs. A tail match is therefore honoured
    when it records a REFUSAL, because holding a message back on weak evidence
    costs a phone call, and discarded when it records an opt-in, because acting
    on weak evidence of permission is how a refusal gets messaged anyway.
    """
    uk = _lead(phone="+447405382925", phone_norm="7405382925")

    # A REFUSAL on a number sharing only the tail: the link is withheld.
    out = await pack_lead_first_touch(
        _Pool(org=_org(), leads=[uk],
              consent=[_consent(None, False, phone="+91 7405382925")]), ORG)
    assert out["counts"]["opted_out_no_link"] == 1
    assert "wa.me" not in _no_limitations(out)

    # An OPT-IN on the same weak match is NOT treated as consent on record.
    out = await pack_lead_first_touch(
        _Pool(org=_org(), leads=[uk],
              consent=[_consent(None, True, phone="+91 7405382925")]), ORG)
    row = out["marketplace_first_touch"][0]
    assert row["consent"] == "not recorded"
    assert out["counts"]["consent_on_record"] == 0


@pytest.mark.asyncio
async def test_the_full_international_number_is_the_strong_match(frozen):
    """A consent row that agrees on the whole number, country code included, is
    an identity and is used as one."""
    pool = _Pool(org=_org(), leads=[_lead()],
                 consent=[_consent(None, True, phone="+919812045678")])
    out = await pack_lead_first_touch(pool, ORG)
    row = out["marketplace_first_touch"][0]
    assert row["consent"] == "on record"
    assert "full phone number" in row["consent_note"]


@pytest.mark.asyncio
async def test_a_missing_opt_in_row_still_gets_a_link_and_says_so(frozen):
    """A wa.me link is a person replying to an enquiry that person sent, not a
    broadcast — so a missing opt-in row is not a reason to refuse it. It IS a
    reason to refuse a template send later, and the row says which it is."""
    pool = _Pool(org=_org(), leads=[_lead()], consent=[])
    out = await pack_lead_first_touch(pool, ORG)
    row = out["marketplace_first_touch"][0]
    assert row["consent"] == "not recorded"
    assert row["wa_link"].startswith("https://wa.me/919812045678?text=")
    assert "template send" in row["consent_note"]
    assert out["counts"]["consent_not_recorded"] == 1
    assert out["counts"]["consent_on_record"] == 0


@pytest.mark.asyncio
async def test_a_recorded_opt_in_is_reported_with_its_date(frozen):
    pool = _Pool(org=_org(), leads=[_lead()],
                 consent=[_consent("3f2a1b4c-5d6e-4f70-8901-abcdefabcdef", True)])
    out = await pack_lead_first_touch(pool, ORG)
    row = out["marketplace_first_touch"][0]
    assert row["consent"] == "on record"
    assert row["consent_recorded_on"] == date(2026, 6, 4)


@pytest.mark.asyncio
async def test_a_marketplace_lead_is_separated_from_every_other_lead(frozen):
    """#32 is about the marketplace feed. A website lead served by the same
    link must not inflate the marketplace count, or a dark integration looks
    like a working one."""
    pool = _Pool(org=_org(), leads=[
        _lead(),
        _lead(id="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", source="website",
              feed_source=None, feed_ref=None, name="Website Enquiry",
              phone="+91 9876500001", phone_norm="9876500001"),
    ])
    out = await pack_lead_first_touch(pool, ORG)
    assert out["counts"]["from_a_marketplace"] == 1
    assert len(out["marketplace_first_touch"]) == 1
    assert len(out["other_new_leads"]) == 1
    assert out["other_new_leads"][0]["from_a_marketplace"] is False


@pytest.mark.asyncio
async def test_an_empty_marketplace_feed_says_so(frozen):
    """Zero because the integration has never written a row is not zero
    because everybody was already contacted. Live, this is every org: not one
    contact in the database carries an indiamart or justdial source."""
    pool = _Pool(org=_org(), leads=[
        _lead(source="website", feed_source=None, feed_ref=None),
    ])
    out = await pack_lead_first_touch(pool, ORG)
    assert out["counts"]["from_a_marketplace"] == 0
    assert out["counts"]["untouched_leads_examined"] == 1
    assert any("NEVER WRITTEN A ROW" in x.upper() for x in out["limitations"])


@pytest.mark.asyncio
async def test_an_empty_window_is_not_a_clean_crm(frozen):
    out = await pack_lead_first_touch(_Pool(org=_org()), ORG)
    assert out["counts"]["untouched_leads_examined"] == 0
    assert any("empty window" in x for x in out["limitations"])


@pytest.mark.asyncio
async def test_a_lead_with_no_usable_number_is_listed_not_dropped(frozen):
    """A count with no list is how a lead goes missing while the totals still
    add up."""
    pool = _Pool(org=_org(), leads=[_lead(phone="12", phone_norm=None)])
    out = await pack_lead_first_touch(pool, ORG)
    assert out["counts"]["no_usable_number"] == 1
    assert len(out["no_usable_number"]) == 1
    assert "no country code" in out["no_usable_number"][0]["why"]


def test_the_message_is_deterministic():
    """No model wrote this sentence. The same lead produces the same text
    twice, which is what makes it free for ever and what makes it a sentence
    the firm can approve once."""
    args = ("Rakesh Bhatia", "Shah & Associates", "indiamart",
            "GST registration for a new branch", date(2026, 8, 18))
    assert _first_message(*args) == _first_message(*args)
    text = _first_message(*args)
    assert "Rakesh Bhatia" in text and "Shah & Associates" in text
    assert "indiamart" in text and "2026-08-18" in text


def test_the_message_survives_a_lead_with_no_name():
    assert _first_message("", "Shah & Associates", "", "", None).startswith("Hello,")


@pytest.mark.asyncio
async def test_the_link_is_url_encoded(frozen):
    """The message goes into a query string and the notes field carries
    whatever a marketplace put in it. An unencoded '&' truncates the message at
    the ampersand and nobody notices until a client receives half a sentence."""
    pool = _Pool(org=_org(), leads=[
        _lead(notes="Bricks & mortar? price/quantity #urgent"),
    ])
    out = await pack_lead_first_touch(pool, ORG)
    link = out["marketplace_first_touch"][0]["wa_link"]
    assert link.count("?") == 1
    assert "&" not in link.split("?text=", 1)[1]
    assert "%26" in link


@pytest.mark.asyncio
async def test_the_firm_name_comes_from_the_org_row(frozen):
    """The message goes out under the firm's name. Hardcoding one would put
    another practice's name in a stranger's WhatsApp."""
    pool = _Pool(org=_org(name="Trivedi & Co"), leads=[_lead()])
    out = await pack_lead_first_touch(pool, ORG)
    assert "Trivedi & Co" in out["marketplace_first_touch"][0]["message"]
    assert out["firm"] == "Trivedi & Co"


@pytest.mark.asyncio
async def test_no_contact_uuid_is_rendered_as_a_name(frozen):
    pool = _Pool(org=_org(), leads=[_lead()])
    out = await pack_lead_first_touch(pool, ORG)
    row = out["marketplace_first_touch"][0]
    assert row["lead"] == "Rakesh Bhatia"
    assert row["company"] == "Bhatia Steels"
    # The id is a row handle and lives in exactly one field.
    assert row["contact_id"] == "3f2a1b4c-5d6e-4f70-8901-abcdefabcdef"
    for field in ("lead", "company", "source", "message", "about"):
        assert "3f2a1b4c" not in str(row[field])


@pytest.mark.asyncio
async def test_every_graha_join_carries_the_org_id(frozen):
    """The FK on `graha_clients` is on the id ALONE, so an id-only join can
    print another practice's client name against this practice's lead. Proved
    live; pinned here."""
    pool = _Pool(org=_org(), leads=[_lead()])
    await pack_lead_first_touch(pool, ORG)
    sql = next(s for s, _ in pool.seen if "staging.graha_clients" in s)
    flat = " ".join(sql.split())
    assert "cl.id = c.client_id AND cl.org_id = c.org_id" in flat


@pytest.mark.asyncio
async def test_the_marketplace_sources_are_the_two_lead_ingest_writes(frozen):
    """Kept in step with `services/lead_ingest.py`, which is the only thing
    that writes them."""
    assert set(MARKETPLACE_SOURCES) == {"indiamart", "justdial"}
    pool = _Pool(org=_org(), leads=[_lead(source="JustDial", feed_source=None)])
    out = await pack_lead_first_touch(pool, ORG)
    assert out["counts"]["from_a_marketplace"] == 1


# ══════════════════════════════════════════════════════════════════════════
# the tenant boundary
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_every_query_is_scoped_to_one_tenant(frozen):
    """Each query either filters `org_id = $1::uuid` or resolves the org's
    teams through `teams.org_id` / `organisations.id`. The statute calendar is
    the one exception and is reference data — the same rows for every tenant.
    """
    pool = _Pool(org=_org(), statute=[_statute("gst.return.gstr1")],
                 approvals=[_approval()], leads=[_lead()])
    for fn in HANDLERS:
        await fn(pool, ORG)

    for sql, args in pool.seen:
        flat = " ".join(sql.split())
        if "staging.statute_calendar" in flat:
            continue
        scoped = (
            "org_id = $1::uuid" in flat
            or "o.id = $1::uuid" in flat
            or "t.org_id = $1::uuid" in flat
            or "= ANY($1::text[])" in flat          # the approver lookup, by team
        )
        assert scoped, f"unscoped query: {flat[:200]}"


@pytest.mark.asyncio
async def test_the_ladder_thresholds_match_the_catalogue():
    """Two days pings the approver, four copies the requester, seven
    escalates."""
    assert [d for d, _, _ in LADDER] == [2, 4, 7]
    assert [k for _, _, k in LADDER] == ["approver", "requester", "internal"]
