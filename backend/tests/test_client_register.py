"""The client obligations register, the per-client calendar, and the send guard.

Catalogue #45, #46, #53. All three read columns that migration 175 created on
2026-08-20 and that NOTHING WRITES. That is what these tests are mostly about:
the arithmetic is easy and the lies are not.

The load-bearing tests, and the failure each one exists to catch:

  · `test_an_empty_register_is_never_a_clean_result` — the whole reason the
    file was written. `staging.client_obligations` holds zero rows in all three
    live orgs. A handler that returned "0 findings" would be a FALSE ALL-CLEAR
    on a statutory matter, so `could_not_check` is true, `no_findings` is
    explicitly False, and the denominator ("0 of 61 active clients") is on the
    output.

  · `test_an_unknown_state_is_sent_to_never_suppressed` — #53's cardinal rule.
    Deriving a state from a GSTIN prefix is easy and the temptation is to hold
    anybody you cannot place. GSTIN BLOCKS NOTHING IN THIS PRODUCT. A recipient
    with no GSTIN is sendable, is counted, and is named.

  · `test_a_key_with_no_rule_in_force_is_reported_not_omitted` — a REGRESSION,
    found by running the first version against the live calendar.
    `tds.deposit.monthly` ends 1 April 2026 with no Income-tax Act 2025
    successor, so every lookup after that date returns nothing and the first
    version emitted NOTHING AT ALL for it. A client marked `incometax.tds` saw
    the quarterly statement and no monthly deposit, which reads as "there is
    nothing to deposit".

  · `test_an_instalment_is_dated_inside_its_own_year` — the other regression
    from the same live run. Anchoring advance tax at a year END dated the
    15 September 2026 instalment to FY 2025-26 (wrong year on a printed date)
    AND resurrected a rule that died on 1 April 2026, because 31 March 2026 is
    still inside its window.

  · `test_the_shift_is_backwards_and_the_statutory_date_never_moves` — a
    deadline does not move because an office is shut. Shifting forward would be
    a legal position printed next to a statute citation.

  · `test_an_optional_holiday_is_a_working_day` — an optional holiday is a day
    the office is open. Shifting for one moves real work for nothing.

  · `test_a_holiday_with_no_state_holds_everyone` and
    `test_a_state_holiday_holds_only_that_state` — migration 175's stated
    reading, in both directions.

  · `test_a_client_from_another_practice_is_counted_but_not_named` — the FK on
    `client_obligations` points at `graha_clients(id)` ALONE. The join carries
    the org predicate, so such a row does not resolve; it is COUNTED rather
    than silently dropped, and the other practice's client name is withheld.

Live figures behind these, read-only 2026-08-20: 0 obligation rows in all three
orgs; 61 / 30 / 0 clients; 38 holidays of which 0 carry a state; 74 of the E2E
org's 171 recipients resolve to a state and all 97 that do not are sendable.
"""
import inspect
import json
from datetime import date, datetime, timezone

import pytest

from services.skills.data import client_register as cr
from services.skills.data.client_register import (
    MAX_SHIFT_DAYS, OBLIGATION_KEYS, RETIRED_STATE_CODES,
    brief_client_obligations_register, check_regional_send_guard,
    pack_client_filing_calendar,
    _due_date_from, _filings_in_window, _norm_state, _quarter_end_on_or_before,
    _state_from_gstin, _work_by,
)

ORG = "00000000-0000-4000-8000-000000000045"
TODAY = date(2026, 8, 20)          # a Thursday, and the day 175 landed


def _text(out) -> str:
    """Everything the reader sees, lowercased, for absence assertions."""
    return json.dumps(out, default=str).lower()


def _body(out) -> str:
    """The same, MINUS `limitations`.

    A caveat explaining why a figure is not shown necessarily contains the words
    of the thing it is not showing, so an absence assertion made against the
    whole document passes or fails for the wrong reason.
    """
    trimmed = {k: v for k, v in out.items() if k != "limitations"}
    return json.dumps(trimmed, default=str).lower()


class _Pool:
    """Canned result sets matched on a FRAGMENT OF THE SQL, never on call order.

    THE STATUTE ARM FILTERS BY KEY. `services/statute.py` narrows by
    `obligation_key` in SQL and resolves the version in Python, so a mock that
    returned every seeded row for every lookup would let `_resolve` choose
    between facts about DIFFERENT obligations — and this module asks for up to
    nine keys in one run. Without the filter, one fixture row answers all nine
    and the "no rule recorded" tests pass for the wrong reason.
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


def _obl(**kw):
    """One live row of `staging.client_obligations`, already joined."""
    row = {
        "id": "11111111-1111-4111-8111-111111111111",
        "client_id": "22222222-2222-4222-8222-222222222222",
        "obligation_key": "gst.regular",
        "state_code": None,
        "owner_user_id": "user_aaaaaaaaaaaa",
        "registration_no": "27AAECE1234F1Z2",
        "effective_from": date(2025, 4, 1),
        "effective_to": None,
        "notes": None,
        "matched_client_id": "22222222-2222-4222-8222-222222222222",
        "client_name": "Agarwal Steel Works & Co",
        "client_gstin": "27AAECE1234F1Z2",
        "client_is_active": True,
        "client_address_state": None,
    }
    row.update(kw)
    return row


def _holiday(day, name, *, state=None, optional=False):
    return {"date": day, "name": name, "state_code": state,
            "is_optional": optional}


def _recipient(handle, name, *, gstin=None, kind="client", address_state=None):
    return {"row_handle": handle, "kind": kind, "recipient": name,
            "gstin": gstin, "address_state": address_state}


#: The statute rows these tests lean on, in the shapes the live calendar holds.
GSTR1 = _statute()
GSTR3B = _statute(obligation_key="gst.return.gstr3b", form_number="GSTR-3B",
                  title="GSTR-3B — summary return and payment", section_ref="s.39",
                  due_day=20)
GSTR9C = _statute(obligation_key="gst.return.gstr9c", form_number="GSTR-9C",
                  title="Self-certified reconciliation statement",
                  periodicity="annual", due_day=31, due_month=12,
                  due_month_offset=None, effective_from=date(2021, 8, 1))
ADVANCE_Q2 = _statute(obligation_key="incometax.advance_tax.q2", form_number=None,
                      title="Advance tax — second instalment", section_ref="s.211",
                      periodicity="annual", due_day=15, due_month=9,
                      due_month_offset=None, effective_from=date(1962, 4, 1),
                      effective_to=date(2026, 4, 1))
TDS_MONTHLY = _statute(obligation_key="tds.deposit.monthly", form_number=None,
                       title="Deposit of tax deducted at source", due_day=7,
                       due_month_offset=1, effective_from=date(1962, 4, 1),
                       effective_to=date(2026, 4, 1))
TDS_26Q = _statute(obligation_key="tds.statement.nonsalary", form_number="26Q",
                   title="TDS statement — resident payees other than salary",
                   periodicity="quarterly", due_day=None, due_month=None,
                   due_month_offset=None, effective_to=date(2026, 4, 1))

ALL_STATUTE = [GSTR1, GSTR3B, GSTR9C, ADVANCE_Q2, TDS_MONTHLY, TDS_26Q]


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(cr, "utc_now",
                        lambda: datetime(2026, 8, 20, 6, 0, tzinfo=timezone.utc))


def _register_pool(obligations=(), holidays=(), clients=61, active=61,
                   unplaced=(), owners=()):
    live = len(obligations)
    orphans = sum(1 for o in obligations if o["matched_client_id"] is None)
    named = len({o["client_id"] for o in obligations})
    return _Pool(
        fetch_by={
            # ORDER MATTERS: the "nothing recorded" query also names
            # client_obligations, in a NOT EXISTS subquery.
            "NOT EXISTS": list(unplaced),
            "co.obligation_key, co.state_code": list(obligations),
            "manav_holidays": list(holidays),
            "user_roles": list(owners),
            "statute_calendar": ALL_STATUTE,
        },
        row_by={
            "count(*) AS live_rows": {
                "live_rows": live,
                "rows_with_no_client_in_this_firm": orphans,
                "clients_named": named,
                "rows_with_no_owner": sum(
                    1 for o in obligations if not o["owner_user_id"]),
            },
            "count(*) AS clients": {"clients": clients, "active": active},
        },
    )


# ══════════════════════════════════════════════════════════════════════════
# the empty table, which is the live state and the whole point
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_an_empty_register_is_never_a_clean_result(frozen):
    """MEASURED LIVE: 0 obligation rows in all three orgs, 61 clients in one.

    An empty statutory register read as "no obligations" is the worst output
    this shelf can produce. `could_not_check` must be true, `no_findings` must
    be FALSE — not None, not absent — and the denominator must be printed.
    """
    out = await brief_client_obligations_register(_register_pool(), ORG)

    state = out["data_state"]
    assert state["could_not_check"] is True
    assert state["no_findings"] is False
    assert state["obligation_rows_live"] == 0
    assert state["active_clients_on_the_books"] == 61
    assert "0 of 61" in state["coverage"]
    assert "client_obligations" in state["why_empty"]
    assert "nothing in the product writes it" in state["why_empty"].lower()
    # It must name the column AND the screen, per the migration's own demand.
    assert state["column_that_needs_writing"]
    assert state["screen_that_would_write_it"]
    assert out["limitations"], "an empty register must still explain itself"


@pytest.mark.asyncio
async def test_the_empty_calendar_says_could_not_check_too(frozen):
    """#46 leans on the same empty table and must not read as a quiet month."""
    out = await pack_client_filing_calendar(_register_pool(), ORG)

    assert out["data_state"]["could_not_check"] is True
    assert out["data_state"]["no_findings"] is False
    assert out["counts"]["filings_in_the_month"] == 0
    assert any("no rows" in lim.lower() or "holds no rows" in lim.lower()
               for lim in out["limitations"])


@pytest.mark.asyncio
async def test_a_firm_with_no_recipients_could_not_check(frozen):
    """Aekam Inc, live: no clients and no contacts. Not a clean send list."""
    out = await check_regional_send_guard(_Pool(), ORG)

    assert out["could_not_check"] is True
    assert out["no_findings"] is False
    assert out["counts"]["recipients_checked"] == 0
    assert any("could not run" in lim.lower() for lim in out["limitations"])


@pytest.mark.asyncio
async def test_the_denominator_is_reported_when_rows_do_arrive(frozen):
    """The day somebody enters obligations, the same handler must work."""
    rows = [_obl(), _obl(id="x2", obligation_key="epf", client_id="c2",
                 matched_client_id="c2", client_name="Desai Pharma LLP",
                 client_gstin="06AAHCE1007X1ZV")]
    pool = _register_pool(rows, clients=61, active=61,
                          owners=[{"user_id": "user_aaaaaaaaaaaa",
                                   "owner_name": "Nisha Trivedi"}])
    out = await brief_client_obligations_register(pool, ORG)

    assert out["data_state"]["could_not_check"] is False
    assert out["counts"]["obligation_rows_live"] == 2
    assert out["counts"]["clients_with_an_obligation"] == 2
    assert "2 of 61" in out["data_state"]["coverage"]
    assert {e["obligation"] for e in out["by_obligation"]} == {"gst.regular", "epf"}
    assert out["register"][0]["owner"] == "Nisha Trivedi"


# ══════════════════════════════════════════════════════════════════════════
# the tenant boundary — the FK is on the client id alone
# ══════════════════════════════════════════════════════════════════════════

def test_every_client_join_carries_the_org_predicate():
    """Migration 175 says it in its own comment and it has been proved live.

    Parsed out of the module source rather than asserted through a mock,
    because a mock pool cannot tell a leaking join from a safe one.
    """
    source = cr._REGISTER_SQL + cr._REGISTER_TOTALS_SQL
    joins = source.lower().count("join public.graha_clients")
    guards = source.lower().count("c.org_id = co.org_id")
    assert joins == 2 and guards == 2, (
        "every join to graha_clients must carry AND c.org_id = co.org_id — the "
        "FK is on the id alone and an id-only join prints another practice's "
        "client name")


@pytest.mark.asyncio
async def test_a_client_from_another_practice_is_counted_but_not_named(frozen):
    """The org predicate makes such a row fail to resolve. It must then be
    COUNTED, not silently dropped — and the other firm's name withheld."""
    orphan = _obl(matched_client_id=None, client_name="(client not recorded)",
                  client_gstin=None)
    out = await brief_client_obligations_register(_register_pool([orphan]), ORG)

    assert out["counts"]["rows_naming_a_client_outside_this_firm"] == 1
    entry = out["register"][0]
    assert entry["client_is_on_the_books"] is False
    assert "not on this firm's books" in entry["client"]
    assert any("another practice" in lim for lim in out["limitations"])


@pytest.mark.asyncio
async def test_no_uuid_is_ever_rendered_as_a_name(frozen):
    """Ids may be row handles the UI acts on. They may never be a NAME."""
    rows = [_obl()]
    out = await brief_client_obligations_register(_register_pool(rows), ORG)

    for entry in out["register"]:
        assert "-4" not in entry["client"], "a uuid is being shown as a name"
        assert not entry["owner"].startswith("user_"), (
            "a user_id is being shown where a name belongs")
        assert entry["client_row_handle"]           # the handle is still there


@pytest.mark.asyncio
async def test_an_owner_who_is_not_a_member_is_named_as_such(frozen):
    """A filing owned by somebody who has left is a filing with no owner, and
    the row must say that rather than printing the raw user_id."""
    out = await brief_client_obligations_register(
        _register_pool([_obl(owner_user_id="user_departed01")]), ORG)

    entry = out["register"][0]
    assert entry["owner"] == "(the named owner is not a member of this firm)"
    assert "user_departed01" not in _body(out)
    assert out["counts"]["rows_whose_owner_is_not_a_member"] == 1


# ══════════════════════════════════════════════════════════════════════════
# statutory dates — never a literal, never a guess
# ══════════════════════════════════════════════════════════════════════════

def test_an_absolute_due_month_is_not_read_as_an_offset():
    """The regression this arithmetic inherited: reading `due_month_offset` and
    never `due_month` made GSTR-9 come out nine months early, live."""
    assert _due_date_from(GSTR9C, date(2026, 3, 31)) == date(2026, 12, 31)
    assert _due_date_from(GSTR1, date(2026, 8, 31)) == date(2026, 9, 11)


def test_no_recorded_rule_prints_no_date():
    """The reason services/statute.py exists."""
    assert _due_date_from(None, date(2026, 8, 31)) is None
    assert _due_date_from(TDS_26Q, date(2026, 6, 30)) is None    # no due_day


@pytest.mark.asyncio
async def test_a_key_with_no_rule_in_force_is_reported_not_omitted():
    """THE REGRESSION, found against the live calendar.

    `tds.deposit.monthly` ends 1 April 2026 with no successor. The first version
    of `_filings_in_window` emitted nothing for it, so a client marked
    `incometax.tds` saw only the quarterly statement — which reads as "there is
    nothing to deposit". A silent omission is the worst failure a compliance
    calendar can have.
    """
    pool = _Pool(fetch_by={"statute_calendar": ALL_STATUTE})
    out = await _filings_in_window(pool, {}, "incometax.tds",
                                   date(2026, 12, 1), date(2026, 12, 31))

    monthly = [f for f in out if f["statute_key"] == "tds.deposit.monthly"]
    assert monthly, "the monthly TDS deposit vanished instead of being reported"
    assert monthly[0]["statutory_due_on"] is None
    assert "no version" in monthly[0]["date_unavailable_because"].lower()
    assert "gap in the calendar" in monthly[0]["date_unavailable_because"].lower()


@pytest.mark.asyncio
async def test_the_same_key_is_dated_while_its_rule_is_still_alive():
    """The other half: the March 2026 deposit IS datable, because the rule was
    in force on 31 March 2026. The as-of date is the period, not today."""
    pool = _Pool(fetch_by={"statute_calendar": ALL_STATUTE})
    out = await _filings_in_window(pool, {}, "incometax.tds",
                                   date(2026, 4, 1), date(2026, 4, 30))

    monthly = [f for f in out if f["statute_key"] == "tds.deposit.monthly"]
    assert monthly[0]["statutory_due_on"] == date(2026, 4, 7)
    assert monthly[0]["resolved_as_of"] == date(2026, 3, 31)


@pytest.mark.asyncio
async def test_an_instalment_is_dated_inside_its_own_year():
    """THE OTHER REGRESSION from the same live run.

    Advance tax falls due INSIDE the year it belongs to. Anchoring it at a year
    END did two wrong things at once: it labelled the 15 September 2026
    instalment 'FY 2025-26', and it resurrected a rule that died on 1 April 2026
    by asking as of 31 March.
    """
    pool = _Pool(fetch_by={"statute_calendar": ALL_STATUTE})

    # Inside FY 2025-26, the rule is alive and the label is that year.
    alive = await _filings_in_window(pool, {}, "incometax.advance",
                                     date(2025, 9, 1), date(2025, 9, 30))
    q2 = [f for f in alive if f["statute_key"] == "incometax.advance_tax.q2"]
    assert q2[0]["statutory_due_on"] == date(2025, 9, 15)
    assert q2[0]["period"] == "FY 2025-26"
    assert q2[0]["resolved_as_of"] == date(2025, 4, 1), (
        "an instalment must be resolved as of a date INSIDE its own year")

    # A year later the rule is dead, and the answer is the gap — never a date.
    dead = await _filings_in_window(pool, {}, "incometax.advance",
                                    date(2026, 9, 1), date(2026, 9, 30))
    q2_dead = [f for f in dead if f["statute_key"] == "incometax.advance_tax.q2"]
    assert q2_dead, "a dead rule must still be reported"
    assert q2_dead[0]["statutory_due_on"] is None
    assert q2_dead[0]["period"] == "FY 2026-27"
    assert "2026-09-15" not in json.dumps(dead, default=str)


@pytest.mark.asyncio
async def test_an_annual_filing_is_dated_after_the_year_it_reports_on():
    """The opposite shape, so the two cannot be conflated: GSTR-9C for
    FY 2025-26 is due 31 December 2026."""
    pool = _Pool(fetch_by={"statute_calendar": ALL_STATUTE})
    out = await _filings_in_window(pool, {}, "audit.gst",
                                   date(2026, 12, 1), date(2026, 12, 31))

    assert out[0]["statutory_due_on"] == date(2026, 12, 31)
    assert out[0]["period"] == "FY 2025-26"
    assert out[0]["mapping_is_a_judgement"] is True, (
        "audit.gst -> GSTR-9C is a judgement and must be flagged as one")


@pytest.mark.asyncio
async def test_qrmp_is_named_and_never_dated(frozen):
    """The register's whole reason for existing is the client the calendar
    cannot date. It must appear WITH the reason, not silently."""
    pool = _register_pool([_obl(obligation_key="gst.qrmp")])
    out = await brief_client_obligations_register(pool, ORG)

    gaps = {g["obligation_key"] for g in out["statute_gaps"]}
    assert "gst.qrmp" in gaps
    assert out["counts"]["obligation_keys_that_cannot_be_dated"] == 1
    assert out["filing_board"] == [], "a QRMP date was invented"
    assert out["register"][0]["can_be_dated"] is False
    reason = out["statute_gaps"][0]["why_no_date"].lower()
    assert "pmt-06" in reason and "not one of them is seeded" in reason


@pytest.mark.asyncio
async def test_every_undatable_key_has_a_stated_reason(frozen):
    """Eight of sixteen. None of them may be quietly absent."""
    for key in OBLIGATION_KEYS:
        pool = _register_pool([_obl(obligation_key=key)])
        out = await pack_client_filing_calendar(pool, ORG, month="2026-09")
        if key in cr._FILINGS:
            continue
        assert out["cannot_be_dated"], f"{key} vanished from the calendar"
        assert out["cannot_be_dated"][0]["why_no_date"], f"{key} has no reason"
        assert out["counts"]["obligations_that_cannot_be_dated"] == 1


@pytest.mark.asyncio
async def test_the_board_dates_a_regular_gst_client(frozen):
    """And the ordinary case still works: August's GSTR-1 on 11 September."""
    pool = _register_pool([_obl()])
    out = await brief_client_obligations_register(pool, ORG, as_at="2026-09-08",
                                                  horizon_days=7)

    forms = {b["form"]: b["statutory_due_on"] for b in out["filing_board"]}
    assert forms == {"GSTR-1": date(2026, 9, 11)}
    assert out["filing_board"][0]["clients"] == 1
    assert out["filing_board"][0]["date_is_statutory_and_unshifted"] is True
    assert out["as_at"] == date(2026, 9, 8), (
        "as_at arrives from a scheduled step as a STRING and must be honoured")


# ══════════════════════════════════════════════════════════════════════════
# the working-day shift
# ══════════════════════════════════════════════════════════════════════════

def _hols(*rows):
    """The shape `_holidays` returns, built without a database."""
    closures: dict = {}
    for r in rows:
        if r["is_optional"]:
            continue
        closures.setdefault(r["date"], []).append(
            {"name": r["name"], "state_code": _norm_state(r["state_code"]),
             "state_as_written": r["state_code"]})
    return {"closures": closures, "rows_in_window": len(rows),
            "optional_ignored": sum(1 for r in rows if r["is_optional"]),
            "carrying_a_state": sum(1 for r in rows if r["state_code"]),
            "state_unreadable": 0}


def test_the_shift_is_backwards_and_the_statutory_date_never_moves():
    """A deadline is not extended because an office is shut. Whether the
    General Clauses Act moves a given one forward is a legal question this
    product holds no rule for, so guessing forward would print a wrong date
    next to a statute citation."""
    hols = _hols(_holiday(date(2026, 9, 14), "Ganesh Chaturthi"))

    work_by, skipped, exhausted = _work_by(date(2026, 9, 14), hols, "27")
    assert work_by == date(2026, 9, 11), "the shift went the wrong way"
    assert work_by < date(2026, 9, 14)
    assert exhausted is False
    assert [s.split(" — ")[1] for s in skipped] == [
        "Ganesh Chaturthi", "Sunday", "Saturday"]


def test_an_optional_holiday_is_a_working_day():
    """The office is open; an individual may take it. Shifting for one moves
    real work for no reason. Same rule as people_checks._closed_days."""
    optional = _hols(_holiday(date(2026, 9, 17), "Dussehra", optional=True))
    assert _work_by(date(2026, 9, 17), optional, "27")[0] == date(2026, 9, 17)

    compulsory = _hols(_holiday(date(2026, 9, 17), "Dussehra"))
    assert _work_by(date(2026, 9, 17), compulsory, "27")[0] == date(2026, 9, 16)


def test_a_run_of_closures_longer_than_the_walk_is_reported_not_looped():
    """Fourteen consecutive closures is a broken holiday table, not a real
    shutdown. The date stays put and the caller is told."""
    hols = _hols(*[_holiday(date(2026, 9, d), f"day {d}")
                   for d in range(1, 21)])
    work_by, _skipped, exhausted = _work_by(date(2026, 9, 18), hols, "27")
    assert exhausted is True
    assert work_by == date(2026, 9, 18)


@pytest.mark.asyncio
async def test_the_calendar_shows_both_dates_and_never_conflates_them(frozen):
    """`statutory_due_on` is what the law says; `work_by` is what the office
    can manage. Two keys, always."""
    pool = _register_pool([_obl()],
                          holidays=[_holiday(date(2026, 9, 11), "Firm closure")])
    out = await pack_client_filing_calendar(pool, ORG, month="2026-09")

    gstr1 = [e for e in out["calendar"] if e["form"] == "GSTR-1"][0]
    assert gstr1["statutory_due_on"] == date(2026, 9, 11)     # unmoved
    assert gstr1["work_by"] == date(2026, 9, 10)              # pulled earlier
    assert gstr1["work_by_is_earlier_than_due"] is True
    assert out["counts"]["filings_pulled_earlier_by_a_closure"] >= 1


@pytest.mark.asyncio
async def test_a_firm_with_no_holidays_says_so_rather_than_implying_none(frozen):
    """Aekam Inc records no holidays at all. Weekends were applied; that is not
    a claim that the office was open on Diwali."""
    out = await pack_client_filing_calendar(_register_pool([_obl()]), ORG,
                                            month="2026-09")

    assert out["counts"]["holiday_rows_near_this_month"] == 0
    assert any("recorded no holidays" in lim.lower() for lim in out["limitations"])
    assert any("cannot be seen" in lim.lower() for lim in out["limitations"])


@pytest.mark.asyncio
async def test_the_untagged_holiday_denominator_is_reported(frozen):
    """0 of 38 live rows carry a state_code. A firm must be told that an
    untagged regional holiday will shift EVERY client's date."""
    pool = _register_pool([_obl()],
                          holidays=[_holiday(date(2026, 9, 15), "Some closure")])
    out = await pack_client_filing_calendar(pool, ORG, month="2026-09")

    assert out["counts"]["holiday_rows_carrying_a_state"] == 0
    assert any("0 of 1 holiday row" in lim for lim in out["limitations"])


# ══════════════════════════════════════════════════════════════════════════
# 53 · the send guard
# ══════════════════════════════════════════════════════════════════════════

def _guard_pool(recipients, holidays=()):
    return _Pool(
        fetch_by={"UNION ALL": list(recipients),
                  "manav_holidays": list(holidays)},
        val_by={"count(*)": len(recipients)},
    )


@pytest.mark.asyncio
async def test_an_unknown_state_is_sent_to_never_suppressed(frozen):
    """#53's cardinal rule, and the one thing this skill would be most tempting
    to get wrong. GSTIN BLOCKS NOTHING IN THIS PRODUCT.

    Live: 97 of the E2E org's 171 recipients cannot be placed, and all 97 are
    sendable.
    """
    people = [_recipient("r1", "Rahul Sharma Enterprises"),           # no GSTIN
              _recipient("r2", "TechCorp India", gstin=""),           # blank
              _recipient("r3", "Odd Ltd", gstin="ZZ"),                # unparseable
              _recipient("r4", "Iyer Consulting", gstin="27AAECE1004C1ZM")]
    out = await check_regional_send_guard(_guard_pool(people), ORG,
                                          send_on="2026-08-20")

    assert out["counts"]["state_unknown_treated_as_sendable"] == 3
    assert out["counts"]["would_land_on_a_non_working_day"] == 0
    assert out["counts"]["clear_to_send"] == 4
    assert {u["treated_as"] for u in out["state_could_not_be_resolved"]} == {"sendable"}
    named = {u["recipient"] for u in out["state_could_not_be_resolved"]}
    assert named == {"Rahul Sharma Enterprises", "TechCorp India", "Odd Ltd"}
    assert any("never suppressed" in lim.lower() for lim in out["limitations"])


@pytest.mark.asyncio
async def test_no_recipient_is_held_for_a_missing_gstin_on_a_closure_day(frozen):
    """Even on a closure day, an unknown-state recipient is held because the DAY
    is shut — never because they could not be identified. The reason on the row
    must be the closure, never the identity."""
    people = [_recipient("r1", "Unknown Co"),
              _recipient("r2", "Known Co", gstin="27AAECE1004C1ZM")]
    out = await check_regional_send_guard(
        _guard_pool(people, [_holiday(date(2026, 8, 20), "Founders Day")]),
        ORG, send_on="2026-08-20")

    assert out["counts"]["would_land_on_a_non_working_day"] == 2
    for held in out["hold"]:
        assert held["reason"] == "Founders Day"
        assert held["reason_applies_everywhere"] is True
        assert held["next_sendable_on"] == date(2026, 8, 21)
        assert held["days_held"] == 1


@pytest.mark.asyncio
async def test_a_holiday_with_no_state_holds_everyone(frozen):
    """Migration 175: NULL means the holiday applies everywhere. Reading it as
    'nowhere' would make the guard stop guarding the day the column shipped."""
    people = [_recipient("r1", "MH Co", gstin="27AAECE1004C1ZM"),
              _recipient("r2", "GJ Co", gstin="24AAECE1004C1ZM"),
              _recipient("r3", "Unplaceable Co")]
    out = await check_regional_send_guard(
        _guard_pool(people, [_holiday(date(2026, 8, 20), "Independence Day")]),
        ORG, send_on="2026-08-20")

    assert out["counts"]["would_land_on_a_non_working_day"] == 3


@pytest.mark.asyncio
async def test_a_state_holiday_holds_only_that_state(frozen):
    """The folio's actual complaint: a Maharashtra date shifted for a
    Maharashtra holiday. And an unplaceable recipient is NOT held by it."""
    people = [_recipient("r1", "MH Co", gstin="27AAECE1004C1ZM"),
              _recipient("r2", "GJ Co", gstin="24AAECE1004C1ZM"),
              _recipient("r3", "Unplaceable Co")]
    out = await check_regional_send_guard(
        _guard_pool(people, [_holiday(date(2026, 8, 20), "Maharashtra Day",
                                      state="MH")]),
        ORG, send_on="2026-08-20")

    assert out["counts"]["would_land_on_a_non_working_day"] == 1
    held = out["hold"][0]
    assert held["recipient"] == "MH Co"
    assert held["state_name"] == "Maharashtra"
    assert held["reason_applies_everywhere"] is False
    assert {s["recipient"] for s in out["clear_to_send"]} == {"GJ Co",
                                                              "Unplaceable Co"}


@pytest.mark.asyncio
async def test_a_numeric_state_on_a_holiday_still_matches(frozen):
    """The two conventions in this database are incompatible:
    organisations.state_code is '27' and manav_holidays.state_code refuses a
    numeric code. A firm that writes one and reads the other must still match,
    or the guard silently never guards."""
    people = [_recipient("r1", "MH Co", gstin="27AAECE1004C1ZM")]
    out = await check_regional_send_guard(
        _guard_pool(people, [_holiday(date(2026, 8, 20), "PT day", state="27")]),
        ORG, send_on="2026-08-20")

    assert out["counts"]["would_land_on_a_non_working_day"] == 1


@pytest.mark.asyncio
async def test_the_weekend_holds_and_saturday_is_a_parameter(frozen):
    """Sunday is not negotiable. Saturday is a product assumption and says so."""
    people = [_recipient("r1", "Any Co", gstin="27AAECE1004C1ZM")]

    sunday = await check_regional_send_guard(_guard_pool(people), ORG,
                                             send_on="2026-08-23")
    assert sunday["hold"][0]["reason"] == "Sunday"
    assert sunday["hold"][0]["next_sendable_on"] == date(2026, 8, 24)

    saturday = await check_regional_send_guard(_guard_pool(people), ORG,
                                               send_on="2026-08-22")
    assert saturday["hold"][0]["reason"] == "Saturday"

    open_saturday = await check_regional_send_guard(
        _guard_pool(people), ORG, send_on="2026-08-22", saturday_is_closed=False)
    assert open_saturday["counts"]["would_land_on_a_non_working_day"] == 0
    assert any("product assumption" in lim for lim in open_saturday["limitations"])


@pytest.mark.asyncio
async def test_the_guard_never_writes_and_never_sends(frozen):
    """It returns a verdict. Delivery is a separate armed decision, and
    recording a chase nobody sent is worse than sending none."""
    pool = _guard_pool([_recipient("r1", "Any Co", gstin="27AAECE1004C1ZM")])
    await check_regional_send_guard(pool, ORG, send_on="2026-08-23")

    for sql in pool.sql_seen:
        upper = sql.upper()
        assert " INSERT " not in f" {upper} "
        assert " UPDATE " not in f" {upper} "
        assert " DELETE " not in f" {upper} "


@pytest.mark.asyncio
async def test_a_retired_state_code_is_resolved_and_flagged(frozen):
    """An old GSTIN must stay readable rather than falling into 'unknown', and
    the staleness must be visible."""
    people = [_recipient("r1", "Old Registration Co", gstin="28AAECE1004C1ZM")]
    out = await check_regional_send_guard(_guard_pool(people), ORG,
                                          send_on="2026-08-20")

    assert out["counts"]["recipients_with_a_retired_state_code"] == 1
    assert out["clear_to_send"][0]["state_is_retired"] is True
    assert any("no longer issued" in lim for lim in out["limitations"])


# ══════════════════════════════════════════════════════════════════════════
# the small pieces
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("given,expected", [
    ("27", "27"), (27, "27"), ("7", "07"), ("MH", "27"), ("mh", "27"),
    ("Maharashtra", "27"), ("maharashtra", "27"), ("24", "24"), ("GJ", "24"),
    ("", None), (None, None), ("ZZ", None), ("99999", None), ("Atlantis", None),
])
def test_the_two_state_conventions_normalise_to_one(given, expected):
    assert _norm_state(given) == expected


@pytest.mark.parametrize("gstin,expected", [
    ("27AAECE1234F1Z2", "27"), ("06AAHCE1007X1ZV", "06"),
    ("  24AAACU5678U1Z9 ", "24"), (None, None), ("", None), ("X", None),
    ("ZZAAECE1234F1Z2", None),
])
def test_a_state_comes_off_the_front_of_a_gstin(gstin, expected):
    assert _state_from_gstin(gstin) == expected


def test_the_retired_codes_still_resolve_to_a_name():
    for code in RETIRED_STATE_CODES:
        assert cr._GST_STATES[code][1]


def test_every_alpha_code_fits_the_migrations_check_constraint():
    """`manav_holidays_state_ck` is `^[A-Z]{2,3}$`. A codelist entry that could
    never be stored in the column it is compared against is a trap."""
    import re
    for _num, (alpha, _name) in cr._GST_STATES.items():
        assert re.fullmatch(r"[A-Z]{2,3}", alpha), alpha


@pytest.mark.parametrize("day,expected", [
    (date(2026, 8, 20), date(2026, 6, 30)),
    (date(2026, 6, 30), date(2026, 6, 30)),
    (date(2026, 4, 1), date(2026, 3, 31)),
    (date(2026, 1, 15), date(2025, 12, 31)),
])
def test_the_tax_quarter_is_april_to_june_not_january_to_march(day, expected):
    """A TDS statement filed against a calendar quarter is one TRACES rejects."""
    assert _quarter_end_on_or_before(day) == expected


# ══════════════════════════════════════════════════════════════════════════
# the contract every handler in the shelf owes
# ══════════════════════════════════════════════════════════════════════════

HANDLERS = (brief_client_obligations_register, pack_client_filing_calendar,
            check_regional_send_guard)


@pytest.mark.parametrize("fn", HANDLERS, ids=lambda f: f.__name__)
def test_a_handler_can_run_unattended(fn):
    """A handler with a required parameter cannot be scheduled at 6am. A month,
    a date and a horizon all have an answer a machine can work out."""
    params = list(inspect.signature(fn).parameters.values())
    assert [p.name for p in params[:2]] == ["pool", "org_id"]
    for p in params[2:]:
        assert p.default is not inspect.Parameter.empty, (
            f"{fn.__name__}({p.name}) has no default and can never be scheduled")


@pytest.mark.asyncio
@pytest.mark.parametrize("fn", HANDLERS, ids=lambda f: f.__name__)
async def test_the_output_survives_json_and_carries_the_contract(fn, frozen):
    """`counts` and a NON-EMPTY `limitations`, and it must serialise — the
    output is handed to a reader as JSON with `default=str`."""
    pool = _register_pool([_obl()],
                          holidays=[_holiday(date(2026, 9, 14), "Ganesh Chaturthi")])
    pool.fetch_by["UNION ALL"] = [_recipient("r1", "Any Co",
                                             gstin="27AAECE1004C1ZM")]
    pool.val_by["count(*)"] = 1

    out = await fn(pool, ORG)
    json.dumps(out, default=str)

    assert isinstance(out["counts"], dict) and out["counts"]
    assert isinstance(out["limitations"], list) and out["limitations"]
    assert all(isinstance(lim, str) and lim.strip() for lim in out["limitations"])


@pytest.mark.asyncio
@pytest.mark.parametrize("fn", HANDLERS, ids=lambda f: f.__name__)
async def test_a_cap_is_always_disclosed(fn, frozen):
    """A truncated list that does not say it was truncated is a wrong answer."""
    rows = [_obl(id=f"o{i}", client_id=f"c{i}", matched_client_id=f"c{i}")
            for i in range(3)]
    pool = _register_pool(rows)
    pool.fetch_by["UNION ALL"] = [_recipient(f"r{i}", f"Co {i}") for i in range(3)]
    pool.val_by["count(*)"] = 9

    out = await fn(pool, ORG, limit=3)
    assert out["counts"]["was_capped"] is True
    assert out["counts"]["capped_at"] == 3
    assert any("cap" in lim.lower() for lim in out["limitations"])


@pytest.mark.asyncio
@pytest.mark.parametrize("fn", HANDLERS, ids=lambda f: f.__name__)
async def test_a_limit_of_zero_does_not_become_an_unbounded_query(fn, frozen):
    """LIMIT 0 returns nothing and would read as a clean result."""
    out = await fn(_register_pool(), ORG, limit=0)
    assert out["counts"]["capped_at"] >= 1


@pytest.mark.asyncio
async def test_a_junk_month_falls_back_rather_than_killing_the_run(frozen):
    """A scheduled step can carry a malformed param. Dying takes the whole run
    down; falling back to the current month and saying which is better."""
    out = await pack_client_filing_calendar(_register_pool(), ORG, month="banana")
    assert out["month"] == "2026-08"


@pytest.mark.asyncio
async def test_nothing_claims_a_gstin_is_required(frozen):
    """GSTIN / PAN / TAN are non-mandatory and block nothing. This has drifted
    back more than once."""
    pool = _register_pool([_obl(registration_no=None, client_gstin=None)])
    out = await brief_client_obligations_register(pool, ORG)

    assert out["register"][0]["registration_is_optional"] is True
    body = _body(out)
    for phrase in ("gstin is required", "missing gstin", "gstin missing",
                   "invalid gstin"):
        assert phrase not in body
