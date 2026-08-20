"""The year-end five, and the ways a calendar skill quietly lies.

Catalogue #18-#22. None of these reads a ledger for a defect; they all read a
CALENDAR and compare it to what the books happen to say. That makes their
failure mode different from every other skill in the shelf: they do not return
the wrong rows, they return a plausible wrong DATE or a reassuring wrong
FIGURE, and both are believed.

The load-bearing tests:

  · `test_an_absolute_due_month_is_not_read_as_an_offset` — this is a bug that
    HAPPENED, caught by running against the live database rather than by any
    fixture. `_due_date_from` read `due_month_offset` and never looked at
    `due_month`, so GSTR-9 for FY 2025-26 came out as 31 March 2026 — nine
    months early, in front of a preparer, with a statute citation next to it.
  · `test_no_recorded_rule_prints_no_date` — the whole reason services/statute.py
    exists. The advance-tax rows deliberately have no Income-tax Act 2025
    successor, so a lookup after 1 April 2026 must return NOTHING and the skill
    must SAY so. Measured live: on 2026-08-20 all four instalments resolve to
    nothing and the handler reports the gap.
  · `test_turnover_is_always_called_a_floor` — GST aggregate turnover is
    PAN-level; this product sees one org. Every comparison is wrong in the same
    direction, and a bar that looks 70% full reads as reassurance.
  · `test_the_advance_tax_brief_leads_with_what_it_is_not` — "a number this
    rough will be read as tax advice". `what_this_is_not` is the FIRST key.
  · `test_the_filing_inference_is_always_disclosed` — nothing records that a
    period was filed, so #18's cutoff is an inference and must print as one.

Live figures, read-only 2026-08-20, across all three orgs:

  #18  29 documents edited after the GSTR-1 due date in the seeded org
  #20  books figure Rs8,31,16,840 — GSTR-9 AND GSTR-9C both required
  #21  the seeded org is over all five thresholds; Aekam Inc is clear on all five
  #22  no schedule at all, because the calendar carries no rule in force
"""
import inspect
import json
from datetime import date, datetime, timedelta, timezone

import pytest

from services.skills.data import gst_year as gy
from services.skills.data.gst_year import (
    APPROACH_RATIO, brief_advance_tax_reserve, brief_annual_return_books,
    brief_lut_expiry, check_amendments_before_filing, check_thresholds_approaching,
    _due_date_from, _fy_of, _period_bounds, _return_period,
)
from services.statute import fy_bounds

ORG = "00000000-0000-4000-8000-000000000018"
TODAY = date(2026, 8, 20)


def _text(out) -> str:
    return json.dumps(out, default=str).lower()


class _Pool:
    """Canned result sets matched on a fragment of the SQL, never on call order.

    THE STATUTE ARM FILTERS BY KEY. `services/statute.py` narrows by
    `obligation_key` in SQL and resolves the VERSION in Python, so a mock that
    returns every seeded row for every lookup makes `_resolve` choose between
    facts about different obligations. `check_thresholds_approaching` asks for
    FIVE different keys in one run, and without this filter one fixture row
    answered all five — which made the "no rule recorded" test pass for the
    wrong reason and the threshold tests compare against a row that was not
    theirs. Found while writing the payroll suite, fixed in both.
    """

    def __init__(self, fetch_by=None, row_by=None, val_by=None):
        self.fetch_by, self.row_by, self.val_by = fetch_by or {}, row_by or {}, val_by or {}
        self.sql_seen: list[str] = []

    def _pick(self, table, sql, default):
        self.sql_seen.append(sql)
        for frag, payload in table.items():
            if frag in sql:
                return payload
        return default

    async def fetch(self, sql, *a):
        rows = self._pick(self.fetch_by, sql, [])
        if "statute_calendar" in sql and a and isinstance(a[0], str):
            return [r for r in rows if r.get("obligation_key") == a[0]]
        return rows

    async def fetchrow(self, sql, *a):
        return self._pick(self.row_by, sql, None)

    async def fetchval(self, sql, *a):
        return self._pick(self.val_by, sql, 0)


def _statute(**kw):
    """One statute_calendar row in the shape services/statute.py returns."""
    row = {
        "obligation_key": "gst.return.gstr1", "title": "GSTR-1 — outward supplies",
        "authority": "gst", "statute": "CGST Act 2017", "form_number": "GSTR-1",
        "section_ref": "s.37", "periodicity": "monthly", "due_day": 11,
        "due_month": None, "due_month_offset": 1, "window_days": None,
        "rate_percent": None, "threshold_amount": None, "state_code": None,
        "effective_from": date(2021, 1, 1), "effective_to": None,
        "effective_from_exact": False, "source_ref": "x", "notes": "x",
        "verified_on": date(2026, 8, 19),
    }
    row.update(kw)
    return row


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(gy, "utc_now",
                        lambda: datetime(2026, 8, 20, 6, 0, tzinfo=timezone.utc))


# ══════════════════════════════════════════════════════════════════════════
# the date arithmetic, which is where the plausible wrong answers live
# ══════════════════════════════════════════════════════════════════════════

def test_an_absolute_due_month_is_not_read_as_an_offset():
    """THE regression. GSTR-9 for FY 2025-26 is due 31 December 2026.

    `_due_date_from` used to read `due_month_offset` only. With offset NULL it
    fell to 0, so the month became the period-end month and the answer was 31
    March 2026 — nine months early, with a statute citation beside it. Found by
    running against the live database; no fixture would have caught it, because
    a fixture would have carried whichever field the code read.
    """
    fy_end = date(2026, 3, 31)                       # FY 2025-26
    gstr9 = _statute(obligation_key="gst.return.gstr9", form_number="GSTR-9",
                     periodicity="annual", due_day=31, due_month=12,
                     due_month_offset=None)

    assert _due_date_from(gstr9, fy_end) == date(2026, 12, 31)

    # s.16(4): 30 November following the year. Same shape, different month.
    itc = _statute(obligation_key="gst.itc.time_limit", due_day=30,
                   due_month=11, due_month_offset=None)
    assert _due_date_from(itc, fy_end) == date(2026, 11, 30)


def test_a_relative_offset_still_works():
    """GSTR-1 for August is due 11 September — offset 1, day 11."""
    assert _due_date_from(_statute(), date(2026, 8, 31)) == date(2026, 9, 11)
    # and it rolls the year
    assert _due_date_from(_statute(), date(2026, 12, 31)) == date(2027, 1, 11)


def test_no_due_day_yields_no_date_rather_than_a_guess():
    """Every quarterly TDS statement in the calendar has due_day NULL."""
    assert _due_date_from(_statute(due_day=None), date(2026, 3, 31)) is None
    assert _due_date_from(None, date(2026, 3, 31)) is None


def test_a_due_day_of_31_in_a_short_month_clamps_to_the_last_day():
    """The catalogue writing 31 means 'the last day', not a data error."""
    row = _statute(due_day=31, due_month=11, due_month_offset=None)
    assert _due_date_from(row, date(2026, 3, 31)) == date(2026, 11, 30)


def test_the_financial_year_helpers_are_each_other_s_inverse():
    """An off-by-one here reports last year's turnover against this year's
    threshold, and nothing on the output would look wrong."""
    for day, fy in ((date(2026, 4, 1), "2026-27"), (date(2026, 3, 31), "2025-26"),
                    (date(2026, 12, 31), "2026-27"), (date(2027, 1, 1), "2026-27")):
        assert _fy_of(day) == fy, day
        start, end = fy_bounds(fy)
        assert start <= day <= end


def test_the_period_default_is_the_month_being_filed():
    """August's GSTR-1 is filed in September, so September wants August."""
    assert _return_period(date(2026, 9, 15)) == "2026-08"
    assert _return_period(date(2026, 1, 3)) == "2025-12"
    assert _period_bounds("2026-02") == (date(2026, 2, 1), date(2026, 2, 28))


# ══════════════════════════════════════════════════════════════════════════
# 18 · amendments
# ══════════════════════════════════════════════════════════════════════════

def _inv(**kw):
    row = {
        "id": "22222222-2222-4222-8222-222222222222",
        "invoice_number": "INV-2026-0042", "invoice_type": "tax_invoice",
        "invoice_date": date(2026, 7, 5), "total": 59000.00, "doc_status": "final",
        "created_at": datetime(2026, 7, 6, tzinfo=timezone.utc),
        "updated_at": datetime(2026, 7, 6, tzinfo=timezone.utc),
        "customer": "Sharma Textiles Pvt Ltd",
    }
    row.update(kw)
    return row


@pytest.mark.asyncio
async def test_a_document_created_after_the_due_date_goes_through_gstr1a(frozen):
    late = _inv(created_at=datetime(2026, 8, 20, tzinfo=timezone.utc),
                updated_at=datetime(2026, 8, 20, tzinfo=timezone.utc))
    pool = _Pool(fetch_by={"statute_calendar": [_statute()],
                           "ganit_invoices i": [late]})

    out = await check_amendments_before_filing(pool, ORG)

    assert out["period"] == "2026-07"
    assert out["gstr1_due_on"] == date(2026, 8, 11)
    assert out["amendment_route"] == "GSTR-1A"
    assert out["counts"]["created_after_the_due_date"] == 1
    assert out["counts"]["edited_after_the_due_date"] == 0


@pytest.mark.asyncio
async def test_an_edit_after_the_due_date_is_a_different_finding(frozen):
    """Created-late and edited-late are different corrections, so they are
    different lists rather than one blended count."""
    edited = _inv(created_at=datetime(2026, 7, 6, tzinfo=timezone.utc),
                  updated_at=datetime(2026, 8, 18, tzinfo=timezone.utc))
    pool = _Pool(fetch_by={"statute_calendar": [_statute()],
                           "ganit_invoices i": [edited]})

    out = await check_amendments_before_filing(pool, ORG)

    assert out["counts"]["edited_after_the_due_date"] == 1
    assert out["counts"]["created_after_the_due_date"] == 0


@pytest.mark.asyncio
async def test_a_document_that_made_the_return_is_not_listed(frozen):
    pool = _Pool(fetch_by={"statute_calendar": [_statute()],
                           "ganit_invoices i": [_inv()]})

    out = await check_amendments_before_filing(pool, ORG)

    assert out["counts"]["created_after_the_due_date"] == 0
    assert out["counts"]["edited_after_the_due_date"] == 0
    assert out["counts"]["documents_in_period"] == 1


@pytest.mark.asyncio
async def test_the_filing_inference_is_always_disclosed(frozen):
    """Nothing records that a period was filed. The cutoff is inferred from the
    statutory due date, and a firm that filed early sees documents it included."""
    pool = _Pool(fetch_by={"statute_calendar": [_statute()],
                           "ganit_invoices i": [_inv()]})

    out = await check_amendments_before_filing(pool, ORG)

    assert out["due_date_is_inferred_cutoff"] is True
    assert any("nothing records that a period was filed" in l.lower()
               for l in out["limitations"])


@pytest.mark.asyncio
async def test_with_no_recorded_gstr1_rule_nothing_is_classified(frozen):
    """A missing calendar row must not silently classify every document as
    on-time — it is a gap, not a clean period."""
    pool = _Pool(fetch_by={"statute_calendar": [], "ganit_invoices i": [_inv()]})

    out = await check_amendments_before_filing(pool, ORG)

    assert out["gstr1_due_on"] is None
    assert out["counts"]["created_after_the_due_date"] == 0
    assert "not a clean period" in _text(out)


# ══════════════════════════════════════════════════════════════════════════
# 19 · LUT
# ══════════════════════════════════════════════════════════════════════════

_LUT = _statute(obligation_key="gst.lut.rfd11", form_number="RFD-11",
                section_ref="rule 96A", periodicity="annual",
                due_day=31, due_month=3, due_month_offset=None,
                title="Letter of Undertaking")


@pytest.mark.asyncio
async def test_the_lut_skill_never_claims_you_are_covered(frozen):
    """Nothing records that an LUT was filed. It may say cover LAPSES; it may
    never say you are covered until a date, and never that you have none."""
    pool = _Pool(fetch_by={"statute_calendar": [_LUT],
                           "ganit_invoices i": [
                               {"id": "1", "invoice_number": "EXP-1",
                                "invoice_date": date(2026, 5, 1),
                                "total": 100000.0, "currency": "USD"}]})

    out = await brief_lut_expiry(pool, ORG)

    assert out["cover_expires_on"] == date(2027, 3, 31)
    assert out["fresh_lut_needed_before"] == date(2027, 4, 1)
    # The ANSWER, without the caveats. The limitations deliberately contain the
    # forbidden phrases — they are the sentences explaining why the skill does
    # not say them — so a check over the whole body matches the explanation and
    # fails on a correct handler. Same trap `test_ganit_ops._sql_only` records.
    answer = _text({k: v for k, v in out.items() if k != "limitations"})
    assert "covered until" not in answer
    assert "you have no lut" not in answer
    assert any("never that you are covered" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_the_lut_skill_admits_it_has_no_done_state(frozen):
    """Filing the RFD-11 does not silence it, so it says so and asks for a
    monthly cadence rather than nagging daily from 1 February."""
    pool = _Pool(fetch_by={"statute_calendar": [_LUT], "ganit_invoices i": []})

    out = await brief_lut_expiry(pool, ORG)

    assert out["no_done_state"] is True
    assert any("monthly, not daily" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_outside_february_to_march_it_says_it_does_not_apply_yet(frozen):
    """August. A renewal notice seven months early is one nobody acts on."""
    pool = _Pool(fetch_by={"statute_calendar": [_LUT], "ganit_invoices i": []})

    out = await brief_lut_expiry(pool, ORG)

    assert out["applies_now"] is False
    assert "arms in february" in out["why_not_yet"].lower()


# ══════════════════════════════════════════════════════════════════════════
# 20 · annual return
# ══════════════════════════════════════════════════════════════════════════

_G9 = _statute(obligation_key="gst.return.gstr9", form_number="GSTR-9",
               section_ref="s.44", periodicity="annual", due_day=31,
               due_month=12, due_month_offset=None, threshold_amount=20000000,
               title="Annual return", effective_from=date(2017, 7, 1))


@pytest.mark.asyncio
async def test_the_annual_return_is_the_books_column_only(frozen):
    """'Books against the twelve GSTR-1s' is tautological — both come from the
    same builder over the same rows — so no reconciliation is offered."""
    totals = {"n_invoices": 360, "invoice_value": 83116840.0,
              "n_credit_notes": 4, "credit_note_value": 116840.0,
              "n_exports": 0, "export_value": 0.0, "n_draft": 36}
    pool = _Pool(fetch_by={"statute_calendar": [_G9]}, row_by={"ganit_invoices": totals})

    out = await brief_annual_return_books(pool, ORG)

    assert out["financial_year"] == "2025-26"
    net = [b for b in out["books"] if b["line"].startswith("Net")][0]
    assert net["value"] == 83000000.0
    assert any("books column only" in l.lower() for l in out["limitations"])
    assert "reconcil" not in " ".join(b["line"].lower() for b in out["books"])


@pytest.mark.asyncio
async def test_the_annual_return_due_date_is_the_december_following(frozen):
    totals = {"n_invoices": 1, "invoice_value": 100.0, "n_credit_notes": 0,
              "credit_note_value": 0.0, "n_exports": 0, "export_value": 0.0,
              "n_draft": 0}
    pool = _Pool(fetch_by={"statute_calendar": [_G9]}, row_by={"ganit_invoices": totals})

    out = await brief_annual_return_books(pool, ORG)

    assert out["applicability"][0]["due_on"] == date(2026, 12, 31)


@pytest.mark.asyncio
async def test_drafts_are_counted_and_declared_rather_than_dropped(frozen):
    """Whether a draft belongs in the annual return is a decision, not a fact."""
    totals = {"n_invoices": 10, "invoice_value": 1000.0, "n_credit_notes": 0,
              "credit_note_value": 0.0, "n_exports": 0, "export_value": 0.0,
              "n_draft": 36}
    pool = _Pool(fetch_by={"statute_calendar": [_G9]}, row_by={"ganit_invoices": totals})

    out = await brief_annual_return_books(pool, ORG)

    assert out["counts"]["drafts_included"] == 36
    assert any("still in draft and ARE included" in l for l in out["limitations"])


# ══════════════════════════════════════════════════════════════════════════
# 21 · thresholds
# ══════════════════════════════════════════════════════════════════════════

def _thr(key, amount):
    return _statute(obligation_key=key, threshold_amount=amount,
                    periodicity="standing", due_day=None, due_month=None,
                    due_month_offset=None, title=key)


@pytest.mark.asyncio
async def test_turnover_is_always_called_a_floor(frozen):
    """The limitation IS the feature. Aggregate turnover is PAN-level; this
    product sees one org, so an org that looks near a line is probably past it."""
    pool = _Pool(
        fetch_by={"statute_calendar": [_thr("gst.qrmp.threshold", 50000000)]},
        row_by={"ganit_invoices": {"gross": 1000000.0, "credits": 0.0,
                                   "n": 5, "first_seen": date(2026, 1, 1)}},
    )

    out = await check_thresholds_approaching(pool, ORG)

    assert out["is_a_floor_not_the_aggregate"] is True
    assert any("floor, not your aggregate" in l.lower() for l in out["limitations"])
    # The seeded key resolved; the four unseeded ones each say so by name rather
    # than borrowing its threshold.
    seeded = [t for t in out["thresholds"] if t["key"] == "gst.qrmp.threshold"][0]
    assert seeded["threshold"] == 50000000.0
    assert out["counts"]["thresholds_compared"] == 1


@pytest.mark.asyncio
async def test_it_reports_a_state_and_never_claims_a_crossing(frozen):
    """A business crosses a threshold once in its life, and nothing records that
    it was told, so 'you have just crossed' is unsayable."""
    pool = _Pool(
        fetch_by={"statute_calendar": [_thr("gst.qrmp.threshold", 50000000)]},
        row_by={"ganit_invoices": {"gross": 89879620.60, "credits": 0.0,
                                   "n": 529, "first_seen": date(2025, 8, 21)}},
    )

    out = await check_thresholds_approaching(pool, ORG)

    # BY KEY, not by index. `thresholds` is in _WATCHED order and the fixture
    # seeds one key, so indexing 0 asserted on a different line than the one the
    # fixture was for — which is how this passed before the mock filtered keys.
    line = [t for t in out["thresholds"] if t["key"] == "gst.qrmp.threshold"][0]
    assert line["state"] == "already over on this figure"
    # The answer only. The limitation that says "this cannot say 'you have just
    # crossed'" necessarily contains the phrase it forbids.
    answer = _text({k: v for k, v in out.items() if k != "limitations"})
    assert "you have crossed" not in answer and "just crossed" not in answer
    # …and every state must be a standing description, never an event.
    for t in out["thresholds"]:
        assert t["state"] in ("clear on this figure", "approaching",
                              "already over on this figure", "no rule recorded")


@pytest.mark.asyncio
async def test_approaching_fires_well_before_the_line(frozen):
    """80%, because a firm needs a quarter to wire up e-invoicing, not a week."""
    pool = _Pool(
        fetch_by={"statute_calendar": [_thr("gst.einvoice.threshold", 50000000)]},
        row_by={"ganit_invoices": {"gross": 50000000 * APPROACH_RATIO, "credits": 0.0,
                                   "n": 100, "first_seen": date(2025, 9, 1)}},
    )

    out = await check_thresholds_approaching(pool, ORG)

    line = [t for t in out["thresholds"] if t["key"] == "gst.einvoice.threshold"][0]
    assert line["state"] == "approaching"


@pytest.mark.asyncio
async def test_a_threshold_with_no_recorded_rule_is_named_not_skipped(frozen):
    pool = _Pool(fetch_by={"statute_calendar": []},
                 row_by={"ganit_invoices": {"gross": 1.0, "credits": 0.0, "n": 1,
                                            "first_seen": date(2026, 1, 1)}})

    out = await check_thresholds_approaching(pool, ORG)

    assert all(l["state"] == "no rule recorded" for l in out["thresholds"])
    assert out["counts"]["thresholds_compared"] == 0


@pytest.mark.asyncio
async def test_credit_notes_reduce_the_turnover_figure(frozen):
    pool = _Pool(
        fetch_by={"statute_calendar": [_thr("gst.qrmp.threshold", 50000000)]},
        row_by={"ganit_invoices": {"gross": 1000000.0, "credits": 250000.0,
                                   "n": 5, "first_seen": date(2026, 1, 1)}},
    )

    out = await check_thresholds_approaching(pool, ORG)

    assert out["rolling_twelve_month_turnover"] == 750000.0


# ══════════════════════════════════════════════════════════════════════════
# 22 · advance tax
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_the_advance_tax_brief_leads_with_what_it_is_not(frozen):
    """'A number this rough will be read as tax advice.' It is the FIRST key."""
    pool = _Pool(fetch_by={"statute_calendar": []},
                 val_by={"ganit_payments": 2000000.0, "ganit_expenses": 500000.0})

    out = await brief_advance_tax_reserve(pool, ORG)

    assert list(out)[0] == "what_this_is_not"
    assert "not tax advice" in out["what_this_is_not"].lower()
    assert out["surplus_to_date"] == 1500000.0


@pytest.mark.asyncio
async def test_no_recorded_rule_prints_no_date(frozen):
    """The advance-tax rows deliberately have NO Income-tax Act 2025 successor:
    the renumbering is real and the new sections were not verified. A lookup
    after 1 April 2026 returns nothing, and the handler must SAY so rather than
    print a section that may not exist. Measured live on 2026-08-20: all four
    instalments resolve to nothing."""
    pool = _Pool(fetch_by={"statute_calendar": []},
                 val_by={"ganit_payments": 100.0, "ganit_expenses": 0.0})

    out = await brief_advance_tax_reserve(pool, ORG)

    assert out["schedule"] == []
    assert out["counts"]["instalments_with_no_recorded_rule"] == 4
    assert "records no advance-tax rule" in out["limitations"][0]
    assert "not verified" in out["limitations"][0]


@pytest.mark.asyncio
async def test_a_reserve_is_a_share_of_surplus_and_never_called_tax(frozen):
    q2 = _statute(obligation_key="incometax.advance_tax.q2", due_day=15,
                  due_month=9, due_month_offset=None, rate_percent=45,
                  periodicity="annual", title="Advance tax — second instalment",
                  section_ref="s.211", form_number=None)
    pool = _Pool(fetch_by={"statute_calendar": [q2]},
                 val_by={"ganit_payments": 1000000.0, "ganit_expenses": 0.0})

    out = await brief_advance_tax_reserve(pool, ORG)

    row = out["schedule"][0]
    assert row["due_on"] == date(2026, 9, 15)
    assert row["cumulative_percent"] == 45.0
    assert row["share_of_surplus_to_date"] == 450000.0
    assert "share_of_surplus_to_date" in row and "tax_due" not in row


@pytest.mark.asyncio
async def test_a_negative_surplus_never_becomes_a_negative_reserve(frozen):
    q2 = _statute(obligation_key="incometax.advance_tax.q2", due_day=15,
                  due_month=9, due_month_offset=None, rate_percent=45,
                  periodicity="annual", section_ref="s.211", form_number=None)
    pool = _Pool(fetch_by={"statute_calendar": [q2]},
                 val_by={"ganit_payments": 100.0, "ganit_expenses": 900.0})

    out = await brief_advance_tax_reserve(pool, ORG)

    assert out["surplus_to_date"] == -800.0
    assert out["schedule"][0]["share_of_surplus_to_date"] == 0.0


# ══════════════════════════════════════════════════════════════════════════
# what the module promises about itself
# ══════════════════════════════════════════════════════════════════════════

SRC = inspect.getsource(gy)


def test_nothing_here_writes():
    for verb in ("insert into", "update ", "delete from"):
        assert verb not in SRC.lower(), verb


def test_no_statutory_fact_is_a_literal():
    """Every date, form, section and threshold comes from statute_calendar.

    Checked against the CODE with docstrings and comments stripped: this module
    names GSTR-9, s.44 and ₹2 crore all over its prose, because the prose is
    what explains where the numbers come from. A bare scan of the file matches
    the explanation and can only be satisfied by deleting it.

    The bug this caught for real: `(gstr9 or {}).get("form_number") or "GSTR-9"`
    — a hardcoded fallback that would survive the day the form is renumbered,
    which is not hypothetical. 24Q became 138 on 1 April 2026.
    """
    import ast

    tree = ast.parse(SRC)
    # Drop every docstring, then read what literals remain in real code.
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                             ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                node.body = body[1:]

    literals = {
        n.value for n in ast.walk(tree)
        if isinstance(n, ast.Constant) and isinstance(n.value, (str, int, float))
    }

    for banned in ("GSTR-9", "GSTR-9C", "GSTR-1", "RFD-11", "s.44", "s.211",
                   "rule 96A", "31 December"):
        assert banned not in literals, f"{banned!r} is a literal in code"

    # No statutory rupee amount, either. The numeric literals that legitimately
    # appear are calendar arithmetic and ratios, all small.
    statutory_amounts = {2000000, 4000000, 15000000, 20000000, 50000000}
    assert not (literals & statutory_amounts), literals & statutory_amounts


@pytest.mark.parametrize("fn", [
    check_amendments_before_filing, brief_lut_expiry, brief_annual_return_books,
    check_thresholds_approaching, brief_advance_tax_reserve,
])
def test_every_handler_runs_from_the_org_and_the_calendar_alone(fn):
    required = [
        n for n, p in inspect.signature(fn).parameters.items()
        if n not in ("pool", "org_id") and p.default is inspect.Parameter.empty
    ]
    assert not required, f"{fn.__name__} requires {required}"


@pytest.mark.parametrize("fn", [
    check_amendments_before_filing, brief_lut_expiry, brief_annual_return_books,
    check_thresholds_approaching, brief_advance_tax_reserve,
])
@pytest.mark.asyncio
async def test_every_handler_always_returns_limitations(fn, frozen):
    """These five compare books to law. Every one of them is wrong in a way the
    reader cannot see, so none may return a bare answer."""
    pool = _Pool(row_by={"ganit_invoices": {
        "n_invoices": 0, "invoice_value": 0.0, "n_credit_notes": 0,
        "credit_note_value": 0.0, "n_exports": 0, "export_value": 0.0,
        "n_draft": 0, "gross": 0.0, "credits": 0.0, "n": 0, "first_seen": None}})

    out = await fn(pool, ORG)

    assert out["limitations"], fn.__name__
    assert all(isinstance(l, str) and l.strip() for l in out["limitations"])
