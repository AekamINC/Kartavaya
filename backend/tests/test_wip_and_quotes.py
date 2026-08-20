"""Catalogue #48, #52, #54 — and the one lie all three are built to avoid.

Migration 175 added `is_billable`, `rate_per_hour`, `entry_point` and `referral`
and BACKFILLED NOTHING. `crm_quotations` has never held a row. So the realistic
defect in this module is not an arithmetic slip: it is a REASSURING ZERO — "no
WIP over 90 days", "no quotations expiring", "no free windows open" — computed
from a column nobody writes and read by a partner as an all-clear.

Every test below is about that. The arithmetic is barely tested at all; the
sentences and the denominators are.

The load-bearing ones:

  · `test_an_empty_billable_column_never_reads_as_no_wip` — 150 unbilled entries
    with `is_billable` NULL must NOT come back as zero WIP. The floor is 0 and
    the ceiling is the lot, and both are on the output.
  · `test_no_rate_reports_unavailable_and_never_zero` — "a WIP report without
    rupees is not the thing anyone asked for". A rupee zero on unbilled work is
    the worst single number this module could print.
  · `test_an_org_with_no_time_is_not_an_org_with_no_wip` — the "could not check"
    branch. An empty timesheet and a cleared WIP ledger look identical to a
    naive query and must never look identical here.
  · `test_the_empty_quotation_table_says_why_it_is_empty` — nothing in the
    product creates a quotation; an empty result must say so rather than pass
    as a clean sheet.
  · `test_the_free_window_is_not_hardcoded` — the 72 hours is Meta policy, it
    moves, and it must be a parameter that actually changes the answer.
  · `test_due_date_is_never_read` — parses the SQL. `ganit_invoices.due_date` is
    a PAYMENT term; chasing quote validity on it chases on the wrong day.
  · `test_the_handlers_still_work_the_day_the_data_arrives` — the same code,
    given populated columns, must produce a real split, a real rupee figure and
    a real open window. A handler honest about emptiness that breaks on data is
    no better.

Live figures these fixtures mirror, read-only 2026-08-20:
  E2E Test & Associates  200 entries / 150 unbilled / 317.5 h / 0 classified
  Unicode Group           81 entries /  42 unbilled /  81.8 h / 0 classified
  Aekam Inc                0 entries
  all three orgs           0 quotations; crm_quotations in no backend .py file
  varta                  250 inbound messages, 0 with a referral
"""
import ast
import inspect
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from services.skills.data import wip_and_quotes as wq
from services.skills.data.wip_and_quotes import (
    CTWA_FREE_WINDOW_HOURS, CTWA_POLICY_AS_OF, QUOTE_OPEN_STATES,
    WIP_ESCALATE_AFTER_DAYS, brief_free_entry_point_harvest,
    check_quotation_expiry, check_wip_ageing,
)

ORG = "00000000-0000-4000-8000-000000000048"
OTHER_ORG = "00000000-0000-4000-8000-0000000000ff"
TODAY = date(2026, 8, 20)
NOW = datetime(2026, 8, 20, 6, 0, tzinfo=timezone.utc)

MODULE_PATH = Path(wq.__file__)


# ══════════════════════════════════════════════════════════════════════════
# the fake pool — matched on a FRAGMENT OF THE SQL, never on call order
# ══════════════════════════════════════════════════════════════════════════

class _Pool:
    """Canned result sets keyed on a fragment of the SQL.

    Call order is not a contract: these handlers issue three, four or five
    queries and reordering them for clarity must not silently repoint every
    fixture. Every SQL string is recorded so the tests that PARSE the SQL — the
    tenant-boundary one and the due_date one — have something to read.
    """

    def __init__(self, fetch_by=None, row_by=None):
        self.fetch_by = fetch_by or {}
        self.row_by = row_by or {}
        self.sql_seen: list[str] = []
        self.args_seen: list[tuple] = []

    def _pick(self, table, sql, default):
        self.sql_seen.append(sql)
        best = None
        for frag, payload in table.items():
            if frag in sql and (best is None or len(frag) > len(best[0])):
                best = (frag, payload)
        return default if best is None else best[1]

    async def fetch(self, sql, *a):
        self.args_seen.append(a)
        return self._pick(self.fetch_by, sql, [])

    async def fetchrow(self, sql, *a):
        self.args_seen.append(a)
        return self._pick(self.row_by, sql, None)

    async def fetchval(self, sql, *a):
        self.args_seen.append(a)
        return 0


def _text(out, drop_limitations=True) -> str:
    """The output as lowercase JSON, with the caveats removed by default.

    A limitation explaining why a figure is NOT shown necessarily contains the
    words of the figure. Asserting a phrase is ABSENT without dropping them
    passes or fails for the wrong reason.
    """
    payload = dict(out)
    if drop_limitations:
        payload.pop("limitations", None)
        payload.pop("could_not_check", None)
        payload.pop("policy_note", None)
    return json.dumps(payload, default=str).lower()


# ── #48 fixtures ──────────────────────────────────────────────────────────

def _wip_totals(**kw) -> dict:
    """The aggregate row, shaped as the live E2E org returns it."""
    row = {
        "entries": 200, "no_duration": 0, "billed": 50, "billed_not_recorded": 0,
        "unbilled": 150, "unbilled_minutes": 19050,
        "unbilled_billable": 0, "unbilled_billable_minutes": 0,
        "unbilled_write_off": 0, "unbilled_write_off_minutes": 0,
        "unbilled_unknown": 150, "unbilled_unknown_minutes": 19050,
        "unbilled_with_rate": 0, "unbilled_without_rate": 150,
        "value_billable": 0, "value_billable_or_unknown": 0,
    }
    row.update(kw)
    return row


def _wip_bands(**kw) -> dict:
    row = {
        "n_future": 0,
        "n_0_30": 19, "m_0_30": 2178,
        "n_31_60": 49, "m_31_60": 6288,
        "n_61_90": 48, "m_61_90": 5772,
        "n_over_90": 34, "m_over_90": 4812,
        "n_escalated": 34, "m_escalated": 4812,
        "n_escalated_billable": 0, "n_escalated_unknown": 34,
    }
    row.update(kw)
    return row


def _wip_entry(**kw) -> dict:
    row = {
        "entry_id": "te_4fc3974c1541", "task_id": "task_3c582b766134",
        "minutes": 198, "description": "Client call",
        "started_at": datetime(2026, 5, 2, 3, 0, tzinfo=timezone.utc),
        "is_billable": None, "rate_per_hour": None, "age_days": 110,
        "task_title": "File GSTR-1 for Sharma Textiles", "task_status": "todo",
        "engagement": "Internal Ops", "person": "E2E Owner",
    }
    row.update(kw)
    return row


def _wip_pool(totals=None, bands=None, escalated=None,
              engagements=None, people=None) -> _Pool:
    return _Pool(
        row_by={
            "AS unbilled_minutes": totals if totals is not None else _wip_totals(),
            "WITH scoped AS": bands if bands is not None else _wip_bands(),
        },
        # The fragments are chosen to be UNIQUE to one query each. `AS
        # engagement,` is not — it appears in both the group-by and the row
        # listing — and keying on it silently fed the engagement fixture to the
        # escalated-rows loop, which is exactly the kind of wrong-fixture pass
        # this file's own docstring warns about.
        fetch_by={
            "AS without_rate": engagements if engagements is not None else [
                {"engagement": "Audits", "entries": 28, "minutes": 3873,
                 "billability_unknown": 28, "without_rate": 28, "oldest_age_days": 110},
            ],
            "AS person,": people if people is not None else [
                {"person": "E2E Owner", "entries": 120, "minutes": 15000,
                 "billability_unknown": 120, "oldest_age_days": 110},
            ],
            "te.entry_id": escalated if escalated is not None else [_wip_entry()],
        },
    )


# ── #52 fixtures ──────────────────────────────────────────────────────────

def _quote_totals(**kw) -> dict:
    row = {"quotations": 0, "open_and_sent": 0, "never_sent": 0, "closed": 0,
           "without_validity": 0, "open_without_validity": 0}
    row.update(kw)
    return row


def _quote(**kw) -> dict:
    row = {
        "id": "9f1d7c2e-0000-4000-8000-000000000052",
        "quotation_number": "QT-2026-014", "status": "sent",
        "valid_until": date(2026, 8, 25), "total": 118000,
        "created_at": datetime(2026, 8, 1, tzinfo=timezone.utc),
        "updated_at": datetime(2026, 8, 1, tzinfo=timezone.utc),
        "customer": "Sharma Textiles Pvt Ltd", "deal": "Annual retainer",
    }
    row.update(kw)
    return row


def _quote_pool(totals=None, rows=None) -> _Pool:
    return _Pool(
        row_by={"AS open_and_sent": totals if totals is not None else _quote_totals()},
        fetch_by={"crm_quotations q": rows if rows is not None else []},
    )


# ── #54 fixtures ──────────────────────────────────────────────────────────

def _ctwa_totals(**kw) -> dict:
    row = {"messages": 500, "inbound": 250, "inbound_in_window": 250,
           "with_referral": 0, "with_entry_point": 0, "inbound_ctwa": 0}
    row.update(kw)
    return row


def _ctwa_msg(**kw) -> dict:
    row = {
        "id": "1a2b3c4d-0000-4000-8000-000000000054",
        "created_at": datetime(2026, 8, 20, 2, 0, tzinfo=timezone.utc),
        "entry_point": "ad", "type": "text",
        "referral": {"headline": "Save on your GST filing",
                     "source_type": "ad", "source_url": "https://fb.me/x"},
        "content": "Hi, I saw your ad",
        "contact": "Sanjay Patel", "phone_number": "+91 5000009931",
        "opted_in": True, "opted_out_at": None, "consent_source": None,
    }
    row.update(kw)
    return row


def _ctwa_pool(totals=None, rows=None) -> _Pool:
    return _Pool(
        row_by={"AS inbound_ctwa": totals if totals is not None else _ctwa_totals()},
        fetch_by={"varta_conversations cv": rows if rows is not None else []},
    )


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(wq, "utc_now", lambda: NOW)


# ══════════════════════════════════════════════════════════════════════════
# 1 · THE CONTRACT — a handler that cannot be scheduled ships nothing
# ══════════════════════════════════════════════════════════════════════════

HANDLERS = (check_wip_ageing, check_quotation_expiry, brief_free_entry_point_harvest)


@pytest.mark.parametrize("fn", HANDLERS, ids=lambda f: f.__name__)
def test_every_parameter_after_org_id_has_a_default(fn):
    """A required parameter cannot be answered at 6am, so it cannot be
    scheduled, so the skill never runs unattended and the whole point is lost."""
    params = list(inspect.signature(fn).parameters.values())
    assert [p.name for p in params[:2]] == ["pool", "org_id"]
    missing = [p.name for p in params[2:] if p.default is inspect.Parameter.empty]
    assert not missing, f"{fn.__name__} has required parameters: {missing}"


@pytest.mark.parametrize("fn", HANDLERS, ids=lambda f: f.__name__)
@pytest.mark.asyncio
async def test_output_survives_json_dumps_and_carries_the_two_required_keys(fn, frozen):
    pool = {check_wip_ageing: _wip_pool,
            check_quotation_expiry: _quote_pool,
            brief_free_entry_point_harvest: _ctwa_pool}[fn]()
    out = await fn(pool, ORG)
    json.dumps(out, default=str)
    assert isinstance(out["counts"], dict)
    assert isinstance(out["limitations"], list) and out["limitations"]
    assert all(isinstance(x, str) and x.strip() for x in out["limitations"])


@pytest.mark.parametrize("fn", HANDLERS, ids=lambda f: f.__name__)
@pytest.mark.asyncio
async def test_every_query_is_bound_to_the_caller_org(fn, frozen):
    """The tenant boundary. `public.time_entries` has no org_id at all, so #48
    reaches the org through task -> team -> organisations; if that filter is
    ever dropped the handler silently reports every practice's WIP."""
    pool = {check_wip_ageing: _wip_pool,
            check_quotation_expiry: _quote_pool,
            brief_free_entry_point_harvest: _ctwa_pool}[fn]()
    await fn(pool, ORG)
    assert pool.sql_seen
    for sql in pool.sql_seen:
        assert "$1::uuid" in sql, f"query is not org-bound:\n{sql}"
    for args in pool.args_seen:
        assert args[0] == ORG


def test_the_id_only_join_hazard_is_closed_everywhere():
    """`crm_quotations.account_id` FKs `crm_accounts(id)` ALONE and the varta
    tables are the same shape. An id-only join prints ANOTHER PRACTICE'S
    CUSTOMER NAME — proved live once already for graha_clients."""
    source = MODULE_PATH.read_text(encoding="utf-8")
    for alias, parent in (("staging.crm_accounts a", "a.org_id"),
                          ("staging.crm_deals    d", "d.org_id"),
                          ("staging.varta_conversations", "cv.org_id"),
                          ("staging.varta_contacts", "ct.org_id")):
        assert alias in source
        assert parent in source, f"{alias} is joined without carrying {parent}"


# ══════════════════════════════════════════════════════════════════════════
# 2 · #48 — THE REASSURING ZERO, which is the whole reason this exists
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_an_empty_billable_column_never_reads_as_no_wip(frozen):
    """150 unbilled entries, `is_billable` NULL on every one — the live shape.

    Assuming billable inflates WIP; assuming not-billable HIDES it. So neither
    is assumed: the floor counts only confirmed-billable time and the ceiling
    adds everything nobody classified, and the gap between them is the finding.
    """
    out = await check_wip_ageing(_wip_pool(), ORG)

    assert out["hours"]["wip_at_least"] == 0.0
    assert out["hours"]["wip_at_most"] == 317.5
    assert out["hours"]["unbilled_total"] == 317.5
    assert out["counts"]["unbilled_billability_not_recorded"] == 150

    cover = next(c for c in out["coverage"] if "is_billable" in c["column"])
    assert cover["status"] == "absent"
    assert cover["recorded_on"] == 0 and cover["of_rows"] == 150
    assert "0 of 150" in cover["reading"]

    joined = " ".join(out["could_not_check"]).lower()
    assert "billability was never decided" in joined


@pytest.mark.asyncio
async def test_no_rate_reports_unavailable_and_never_zero(frozen):
    """"A WIP report without rupees is not the thing anyone asked for."

    The honest answer to "what is this worth" with no rate anywhere is
    UNAVAILABLE with a denominator, not 0.00 — a rupee zero next to 317 unbilled
    hours is a confident wrong number in front of a partner.
    """
    out = await check_wip_ageing(_wip_pool(), ORG)

    assert out["rupees"]["status"] == "UNAVAILABLE"
    assert out["rupees"]["at_least"] is None
    assert out["rupees"]["at_most"] is None
    assert out["rupees"]["entries_lacking_a_rate"] == 150
    assert out["rupees"]["of_unbilled_entries"] == 150
    assert "not zero" in out["rupees"]["note"].lower()


@pytest.mark.asyncio
async def test_an_org_with_no_time_is_not_an_org_with_no_wip(frozen):
    """Aekam Inc, live: zero time entries. A naive query answers "no WIP over 90
    days" and a reader takes that as a cleared ledger. It is an empty timesheet
    and the two must not look alike."""
    empty = _wip_pool(
        totals=_wip_totals(entries=0, billed=0, unbilled=0, unbilled_minutes=0,
                           unbilled_unknown=0, unbilled_unknown_minutes=0,
                           unbilled_without_rate=0),
        bands=_wip_bands(n_0_30=0, m_0_30=0, n_31_60=0, m_31_60=0,
                         n_61_90=0, m_61_90=0, n_over_90=0, m_over_90=0,
                         n_escalated=0, m_escalated=0, n_escalated_unknown=0),
        escalated=[], engagements=[], people=[],
    )
    out = await check_wip_ageing(empty, ORG)

    assert out["counts"]["time_entries_in_scope"] == 0
    joined = " ".join(out["could_not_check"]).lower()
    assert "no time is recorded" in joined
    assert "not an absence of work in progress" in joined
    # And the money block must not claim a clean valuation of nothing.
    assert out["rupees"]["status"] == "NOT_APPLICABLE"
    assert out["rupees"]["at_least"] is None


@pytest.mark.asyncio
async def test_the_client_grain_is_declared_absent_not_faked(frozen):
    """The catalogue asks for ageing "by client". There is NO client link from a
    task in this schema — tasks carry team_id and board_id, staging.projects
    carries a contact_id — so the handler must say the grain is missing rather
    than infer a client from a task title."""
    out = await check_wip_ageing(_wip_pool(), ORG)

    assert out["client_grain_available"] is False
    assert out["engagement_grain"] == "board"
    assert any("no client grain" in x.lower() for x in out["limitations"])

    # The board is offered as the engagement, and it is called that.
    assert out["by_engagement"][0]["engagement"] == "Audits"


@pytest.mark.asyncio
async def test_the_ninety_days_is_labelled_a_convention_not_a_statute(frozen):
    """This module prints no statutory fact and calls services.statute nowhere.
    A CA reading "past 90 days" beside a compliance-shaped skill will assume a
    section sits behind it unless told otherwise."""
    out = await check_wip_ageing(_wip_pool(), ORG)
    assert out["escalate_after_days"] == WIP_ESCALATE_AFTER_DAYS
    assert "not statute" in out["escalation_basis"]
    assert any("not a statutory period" in x.lower() for x in out["limitations"])


@pytest.mark.asyncio
async def test_the_escalation_threshold_actually_moves_the_query(frozen):
    """A parameter that is accepted and ignored is worse than no parameter."""
    pool = _wip_pool()
    await check_wip_ageing(pool, ORG, escalate_after_days=45)
    assert any(45 in args for args in pool.args_seen), \
        "escalate_after_days never reached a query"


@pytest.mark.asyncio
async def test_an_unclassified_entry_is_never_printed_as_billable(frozen):
    """The row-level version of the same lie. `is_billable` NULL renders as
    "not recorded" — never as "billable", and never quietly omitted."""
    out = await check_wip_ageing(_wip_pool(), ORG)
    row = out["escalated"]["rows"][0]
    assert row["billable"] is None
    assert row["billability"] == "not recorded"
    assert row["rate_per_hour"] is None


@pytest.mark.asyncio
async def test_no_uuid_is_rendered_where_a_name_belongs(frozen):
    """Names, not IDs. `entry_id`/`task_id` are row handles the UI acts on and
    are allowed; a person, an engagement or a customer must never be one."""
    out = await check_wip_ageing(_wip_pool(), ORG)
    row = out["escalated"]["rows"][0]
    for field in ("person", "engagement", "task"):
        assert "-" not in row[field] or not _looks_like_uuid(row[field])
    assert row["person"] == "E2E Owner"
    assert out["by_person"][0]["person"] == "E2E Owner"


def _looks_like_uuid(value: str) -> bool:
    parts = str(value).split("-")
    return len(parts) == 5 and len(parts[0]) == 8


@pytest.mark.asyncio
async def test_a_missing_is_billed_value_is_disclosed_as_overstating_wip(frozen):
    """`is_billed` is nullable. NULL is counted as unbilled — the safe direction
    — but counting it silently would overstate WIP with no way for a reader to
    know by how much."""
    pool = _wip_pool(totals=_wip_totals(billed_not_recorded=7))
    out = await check_wip_ageing(pool, ORG)
    assert any("overstates wip" in x.lower() for x in out["limitations"])


# ══════════════════════════════════════════════════════════════════════════
# 3 · #52 — an empty table that must not read as a clean sheet
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_the_empty_quotation_table_says_why_it_is_empty(frozen):
    """Live, all three orgs: zero quotations, because `crm_quotations` appears in
    no backend Python file — nothing creates one. "0 expiring" from an empty
    table is the same sentence as "0 expiring" from a healthy pipeline, and the
    two must not be confusable."""
    out = await check_quotation_expiry(_quote_pool(), ORG)

    assert out["counts"]["quotations_recorded"] == 0
    assert out["counts"]["chase_due_now"] == 0
    joined = " ".join(out["could_not_check"]).lower()
    assert "no quotations at all" in joined
    assert "nothing in this product creates a quotation" in joined
    assert any("no route and no writer" in x.lower() for x in out["limitations"])


@pytest.mark.asyncio
async def test_the_stale_folio_claim_is_corrected_on_the_output(frozen):
    """The catalogue entry is titled "No validity date". `valid_until` EXISTS.
    Shipping a skill whose own caveat repeats a blocker that was already closed
    teaches the reader to distrust the caveats."""
    out = await check_quotation_expiry(_quote_pool(), ORG)
    joined = " ".join(out["limitations"]).lower()
    assert "stale" in joined
    assert "valid_until exists" in joined


def test_due_date_is_never_read():
    """`ganit_invoices.due_date` is a PAYMENT term, not quote validity. Reading
    it would chase on the wrong day, sometimes by weeks. Parsed out of the SQL
    rather than trusted, and `limitations` is excluded from the scan because the
    caveat explaining the choice necessarily contains the words."""
    tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.AsyncFunctionDef) and n.name == "check_quotation_expiry")
    sql_literals = [n.value for n in ast.walk(fn)
                    if isinstance(n, ast.Constant) and isinstance(n.value, str)
                    and "SELECT" in n.value]
    assert sql_literals, "no SQL found in check_quotation_expiry"
    for sql in sql_literals:
        assert "due_date" not in sql, f"quote chase reads due_date:\n{sql}"
        assert "valid_until" in sql or "crm_accounts" in sql


@pytest.mark.asyncio
async def test_a_draft_is_never_chased(frozen):
    """A quotation in `draft` was never sent to the customer, so chasing it is
    chasing yourself. It is counted separately, which is a better finding."""
    assert "draft" not in QUOTE_OPEN_STATES
    pool = _quote_pool(totals=_quote_totals(quotations=4, never_sent=4))
    out = await check_quotation_expiry(pool, ORG)
    assert out["counts"]["drafts_never_sent"] == 4
    assert out["counts"]["chase_due_now"] == 0
    assert "never sent" in out["drafts_never_sent_note"].lower()


@pytest.mark.asyncio
async def test_the_three_beats_land_on_the_right_days(frozen):
    """The chase itself, once quotations exist. 20 days out is too early, 10 is
    the reminder, 5 is the press, 1 is the last call, and yesterday is gone."""
    rows = [
        _quote(quotation_number="QT-A", valid_until=TODAY + timedelta(days=20)),
        _quote(quotation_number="QT-B", valid_until=TODAY + timedelta(days=10)),
        _quote(quotation_number="QT-C", valid_until=TODAY + timedelta(days=5)),
        _quote(quotation_number="QT-D", valid_until=TODAY + timedelta(days=1)),
        _quote(quotation_number="QT-E", valid_until=TODAY - timedelta(days=3)),
        _quote(quotation_number="QT-F", valid_until=None),
    ]
    pool = _quote_pool(totals=_quote_totals(quotations=6, open_and_sent=6,
                                            without_validity=1,
                                            open_without_validity=1),
                       rows=rows)
    out = await check_quotation_expiry(pool, ORG)

    beats = {q["quotation_number"]: q["beat"] for q in out["chase_due_now"]}
    assert beats == {"QT-B": 1, "QT-C": 2, "QT-D": 3}
    assert [q["quotation_number"] for q in out["chase_not_yet_due"]] == ["QT-A"]
    assert [q["quotation_number"] for q in out["already_lapsed"]] == ["QT-E"]
    assert out["already_lapsed"][0]["days_since_expiry"] == 3
    assert [q["quotation_number"] for q in out["open_without_validity"]] == ["QT-F"]


@pytest.mark.asyncio
async def test_a_quotation_with_no_validity_is_listed_not_dropped(frozen):
    """The silent-drop failure. A quote with no `valid_until` has no chase day,
    and the wrong response is to leave it out of both the findings and the
    counts, where nobody ever sees it again."""
    pool = _quote_pool(
        totals=_quote_totals(quotations=1, open_and_sent=1,
                             without_validity=1, open_without_validity=1),
        rows=[_quote(valid_until=None)])
    out = await check_quotation_expiry(pool, ORG)
    assert len(out["open_without_validity"]) == 1
    assert out["counts"]["open_without_a_validity_date"] == 1
    joined = " ".join(out["could_not_check"]).lower()
    assert "no chase day exists" in joined


@pytest.mark.asyncio
async def test_the_chase_is_drafted_and_never_sent(frozen):
    """It DRAFTS and returns. Delivery is a separate armed decision, and even a
    reminder row is a write — recording a chase nobody sent is worse than
    sending none."""
    pool = _quote_pool(totals=_quote_totals(quotations=1, open_and_sent=1),
                       rows=[_quote(valid_until=TODAY + timedelta(days=5))])
    out = await check_quotation_expiry(pool, ORG)
    assert out["nothing_was_sent"] is True
    draft = out["chase_due_now"][0]["draft"]
    assert "QT-2026-014" in draft and "Sharma Textiles" in draft
    assert any("does not send" in x.lower() for x in out["limitations"])


def test_the_module_writes_nothing_at_all():
    """No INSERT, no UPDATE, no DELETE anywhere. These handlers read."""
    source = MODULE_PATH.read_text(encoding="utf-8").upper()
    for verb in ("INSERT INTO", "UPDATE STAGING.", "UPDATE PUBLIC.", "DELETE FROM"):
        assert verb not in source, f"the module contains {verb}"


# ══════════════════════════════════════════════════════════════════════════
# 4 · #54 — a policy number that moves, and a window that is not consent
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_no_referral_anywhere_is_reported_with_its_denominator(frozen):
    """Live: 250 inbound messages, 0 carrying a referral, because the webhook
    drops the block Meta sends. "0 free windows" here means the product cannot
    SEE them, not that none were opened."""
    out = await brief_free_entry_point_harvest(_ctwa_pool(), ORG)

    assert out["counts"]["inbound_messages"] == 250
    assert out["counts"]["click_to_whatsapp_arrivals"] == 0
    cover = next(c for c in out["coverage"] if c["column"].endswith("referral"))
    assert cover["status"] == "absent"
    assert "0 of 250" in cover["reading"]
    assert "whatsapp.py" in cover["would_be_written_by"]

    joined = " ".join(out["could_not_check"]).lower()
    assert "cannot see them" in joined


@pytest.mark.asyncio
async def test_an_org_with_no_whatsapp_at_all_says_so_separately(frozen):
    """Two different emptinesses. No inbound messages is an unused channel; 250
    inbound with no referral is a missing write path. Same zero, different
    sentence, different fix."""
    silent = _ctwa_pool(totals=_ctwa_totals(messages=0, inbound=0,
                                            inbound_in_window=0))
    out = await brief_free_entry_point_harvest(silent, ORG)
    joined = " ".join(out["could_not_check"]).lower()
    assert "no inbound whatsapp messages at all" in joined
    assert "unused channel" in joined


def test_the_free_window_is_not_hardcoded():
    """72 hours is Meta's PRICING POLICY. It has moved and it will move. The
    figure must be a parameter, must carry the date it was true, and must not be
    in statute_calendar — that table means "dated Indian law" and putting a
    platform's commercial terms in it corrupts every citation from it."""
    sig = inspect.signature(brief_free_entry_point_harvest)
    assert sig.parameters["free_window_hours"].default == CTWA_FREE_WINDOW_HOURS

    source = MODULE_PATH.read_text(encoding="utf-8")
    assert "from services.statute import" not in source
    assert "statute_calendar" in source  # said out loud, as a deliberate exclusion


@pytest.mark.asyncio
async def test_changing_the_policy_hours_changes_the_answer(frozen):
    """The parameter has to be load-bearing, not decorative. A message that
    arrived four hours ago is inside a 72-hour window and outside a 2-hour one.
    """
    rows = [_ctwa_msg(created_at=NOW - timedelta(hours=4))]
    totals = _ctwa_totals(with_referral=1, with_entry_point=1, inbound_ctwa=1)

    wide = await brief_free_entry_point_harvest(
        _ctwa_pool(totals=totals, rows=rows), ORG, free_window_hours=72)
    narrow = await brief_free_entry_point_harvest(
        _ctwa_pool(totals=totals, rows=rows), ORG, free_window_hours=2)

    assert wide["counts"]["windows_open_now"] == 1
    assert narrow["counts"]["windows_open_now"] == 0
    assert narrow["counts"]["windows_already_closed"] == 1
    assert wide["free_window_hours"] == 72 and narrow["free_window_hours"] == 2


@pytest.mark.asyncio
async def test_the_policy_figure_always_carries_its_date_and_a_recheck(frozen):
    """A policy number with no date on it is a number nobody can check."""
    out = await brief_free_entry_point_harvest(_ctwa_pool(), ORG)
    assert out["free_window_policy_as_of"] == CTWA_POLICY_AS_OF
    assert out["must_recheck_against_meta_policy"] is True
    joined = " ".join(out["limitations"]).lower()
    assert "meta's policy, not law" in joined or "policy, not law" in joined
    assert "1 october 2026" in out["policy_note"].lower()
    assert "not indian law" in out["policy_note"].lower()


@pytest.mark.asyncio
async def test_a_free_window_is_never_treated_as_consent(frozen):
    """The dangerous read. Free means Meta will not CHARGE. It does not mean the
    person agreed to marketing, and an opted-out contact must be flagged
    do-not-contact however wide the window is."""
    rows = [_ctwa_msg(created_at=NOW - timedelta(hours=1),
                      opted_in=False,
                      opted_out_at=datetime(2026, 8, 10, tzinfo=timezone.utc))]
    pool = _ctwa_pool(
        totals=_ctwa_totals(with_referral=1, with_entry_point=1, inbound_ctwa=1),
        rows=rows)
    out = await brief_free_entry_point_harvest(pool, ORG)

    window = out["windows_open"][0]
    assert window["do_not_contact"] is True
    assert "opted out" in window["consent_note"].lower()
    assert out["counts"]["opted_out_among_listed"] == 1
    assert out["nothing_was_sent"] is True
    assert any("not consent" in x.lower() for x in out["limitations"])


@pytest.mark.asyncio
async def test_a_referral_arriving_as_a_json_string_is_still_read(frozen):
    """asyncpg returns jsonb as `str` unless a codec is registered, and whether
    one is depends on how the pool was built — which is not this handler's
    business to know. A malformed blob must degrade, never raise."""
    good = _ctwa_msg(referral=json.dumps({"headline": "Save on your GST filing",
                                          "source_type": "ad"}),
                     created_at=NOW - timedelta(hours=1))
    bad = _ctwa_msg(id="1a2b3c4d-0000-4000-8000-0000000000ff",
                    referral="{not json at all",
                    created_at=NOW - timedelta(hours=1))
    pool = _ctwa_pool(
        totals=_ctwa_totals(with_referral=2, with_entry_point=2, inbound_ctwa=2),
        rows=[good, bad])
    out = await brief_free_entry_point_harvest(pool, ORG)

    assert out["counts"]["windows_open_now"] == 2
    assert out["windows_open"][0]["ad_headline"] == "Save on your GST filing"
    assert out["windows_open"][1]["ad_headline"] is None
    json.dumps(out, default=str)


# ══════════════════════════════════════════════════════════════════════════
# 5 · THE DAY THE DATA ARRIVES — honest about emptiness is not enough
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_the_handlers_still_work_the_day_the_data_arrives(frozen):
    """A handler that is honest about an empty column and then breaks or lies
    when the column fills is a handler that gets rewritten instead of used.

    Same code, populated fixtures: a real billable/write-off split, a real rupee
    figure, a real open window.
    """
    populated = _wip_pool(totals=_wip_totals(
        unbilled=150, unbilled_minutes=19050,
        unbilled_billable=100, unbilled_billable_minutes=12000,
        unbilled_write_off=50, unbilled_write_off_minutes=7050,
        unbilled_unknown=0, unbilled_unknown_minutes=0,
        unbilled_with_rate=150, unbilled_without_rate=0,
        value_billable=240000, value_billable_or_unknown=240000,
    ))
    out = await check_wip_ageing(populated, ORG)

    assert out["hours"]["wip_at_least"] == 200.0
    assert out["hours"]["wip_at_most"] == 200.0      # no unknowns left, so no range
    assert out["hours"]["confirmed_write_off"] == 117.5
    assert out["rupees"]["status"] == "COMPLETE"
    assert out["rupees"]["at_least"] == 240000.0
    cover = next(c for c in out["coverage"] if "is_billable" in c["column"])
    assert cover["status"] == "complete"
    # And the "could not check" list must EMPTY OUT — a caveat that never
    # clears is a caveat that gets skipped.
    assert out["could_not_check"] == []


@pytest.mark.asyncio
async def test_a_partial_rate_is_labelled_a_floor_not_a_total(frozen):
    """The subtler day-after failure: SOME entries get rates. Summing them and
    printing a total understates WIP with no hint that it does."""
    partial = _wip_pool(totals=_wip_totals(
        unbilled=150,
        unbilled_billable=150, unbilled_billable_minutes=19050,
        unbilled_unknown=0, unbilled_unknown_minutes=0,
        unbilled_with_rate=40, unbilled_without_rate=110,
        value_billable=64000, value_billable_or_unknown=64000,
    ))
    out = await check_wip_ageing(partial, ORG)
    assert out["rupees"]["status"] == "FLOOR"
    assert out["rupees"]["at_least"] == 64000.0
    assert out["rupees"]["entries_lacking_a_rate"] == 110
    assert "floor" in out["rupees"]["note"].lower()


@pytest.mark.asyncio
async def test_a_capped_list_says_it_was_capped(frozen):
    """"0 shown" and "200 shown of 4,000" must never look the same."""
    rows = [_wip_entry(entry_id=f"te_{i:012d}") for i in range(3)]
    pool = _wip_pool(bands=_wip_bands(n_escalated=4000, m_escalated=480000),
                     escalated=rows)
    out = await check_wip_ageing(pool, ORG, limit=3)
    assert out["counts"]["was_capped"] is True
    assert out["counts"]["capped_at"] == 3
    assert out["escalated"]["entries"] == 4000
    assert any("capped at 3" in x.lower() for x in out["limitations"])


# ══════════════════════════════════════════════════════════════════════════
# 6 · THE CLOCK — the bug that reached production twice
# ══════════════════════════════════════════════════════════════════════════

def test_no_hand_rolled_clock_in_this_module():
    """`tests/test_skill_handler_clock.py` covers the whole tree; this is the
    same assertion stated where a reader of THIS module will see it, because
    both prior occurrences were written by someone who had not read that file.
    """
    tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
    utcnow = [n.lineno for n in ast.walk(tree)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
              and n.func.attr == "utcnow"]
    assert not utcnow, f"datetime.utcnow() at {utcnow}"

    hand_subtraction = [n.lineno for n in ast.walk(tree)
                        if isinstance(n, ast.Attribute)
                        and n.attr in ("days", "total_seconds")
                        and isinstance(n.value, ast.BinOp)
                        and isinstance(n.value.op, ast.Sub)]
    assert not hand_subtraction, f"hand-rolled delta at {hand_subtraction}"


@pytest.mark.asyncio
async def test_an_aware_timestamp_from_the_driver_does_not_raise(frozen):
    """asyncpg returns AWARE datetimes for timestamptz. Mixing one with a naive
    "now" is the exact TypeError that killed `score_deals` on the first real
    skill run."""
    rows = [_ctwa_msg(created_at=datetime(2026, 8, 20, 3, 0, tzinfo=timezone.utc))]
    pool = _ctwa_pool(
        totals=_ctwa_totals(with_referral=1, with_entry_point=1, inbound_ctwa=1),
        rows=rows)
    out = await brief_free_entry_point_harvest(pool, ORG)
    assert out["windows_open"][0]["hours_left"] == pytest.approx(69.0, abs=0.2)


@pytest.mark.asyncio
async def test_the_as_at_default_is_today_and_the_override_is_honoured(frozen):
    """Defaulted so it can be scheduled; overridable so it can be reproduced."""
    out = await check_wip_ageing(_wip_pool(), ORG)
    assert out["as_at"] == TODAY

    out = await check_wip_ageing(_wip_pool(), ORG, as_at="2026-03-31")
    assert out["as_at"] == date(2026, 3, 31)

    out = await check_quotation_expiry(_quote_pool(), ORG, as_at="2026-03-31")
    assert out["as_at"] == date(2026, 3, 31)


@pytest.mark.asyncio
async def test_a_nonsense_as_at_falls_back_to_today_rather_than_raising(frozen):
    """A scheduler handing over rubbish must not take a whole run down."""
    out = await check_wip_ageing(_wip_pool(), ORG, as_at="not a date")
    assert out["as_at"] == TODAY
