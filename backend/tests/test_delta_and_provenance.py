"""The three rejected entries, and the confident wrong numbers they could print.

Catalogue #58, #59 and #61 were killed for CLAIMING things, not for querying
the wrong rows. So these tests are not about arithmetic. Each one names a
sentence the handler must never be able to produce, and holds it shut.

The load-bearing tests, in the order the risk ranks:

  · `test_an_edited_document_never_enters_the_net` — #58's one chance to be
    confidently wrong. There is no prior value anywhere in this product, so an
    edited document's total is a CEILING on the exposure. Adding it into the
    net would turn "somebody fixed a typo" into "Rs69 lakh moved after you
    filed", with a statute citation beside it.
  · `test_nothing_predicts_a_notice` — the exact sentence #58 was rejected for.
    Asserted as an absent WORD across the whole output, and as a hard False on
    a first-class key so a summariser cannot infer it back.
  · `test_the_output_is_never_called_a_reconciliation` — the exact sentence #59
    was rejected for. Three places may hold the word and each is enumerated with
    its reason: `what_this_is_not` and `limitations` are the denial itself, and
    `cannot_fill` quotes the FORM's own table headings. Everywhere else — every
    key, every label, the statute citation — is asserted clean.
  · `test_a_withdrawn_document_has_the_opposite_sign` — the first cut summed a
    cancelled invoice's own supply value, so withdrawing Rs70,000 of turnover
    after the return went read as Rs70,000 appearing. One minus sign, and the
    net points the wrong way.
  · `test_the_bulk_touch_flag_fires_on_one_stamped_date` — the seeded org has
    twenty-nine July documents carrying one `updated_at`. That is a backfill.
    Without the flag this skill reports it as twenty-nine amendments every
    month for ever, and the reader stops opening it.
  · `test_a_missing_calendar_row_classifies_nothing` — the whole reason
    services/statute.py exists. No due date means no cutoff, so NOTHING is
    classified and the output says so — rather than defaulting to a plausible
    11th and printing a list.
  · `test_cost_is_never_attributed_to_an_item` — hub_ai_logs.content_item_id is
    written by nothing, so a per-item cost cannot exist. The temptation is to
    divide a month's dollars by a month's items; the test pins the disclosure.
  · `test_no_uuid_is_rendered_as_a_name` — ids are row handles, never labels.

Live figures behind the fixtures, read-only 2026-08-20, all three orgs:

  #58  Unicode Group 2026-06: 7 of 7 documents created after the GSTR-1 due
       date, Rs4,15,360 added net. Seeded org 2026-07: 29 edited, all on
       2026-08-18, ceiling Rs68,77,455.36, bulk-touch flagged.
  #59  FY 2025-26 taxable value Rs7,04,38,000 (seeded org, 9C required),
       Rs9,28,700 (Unicode Group, not required), no documents at all (Aekam).
       The rate split rebuilt from line_items agreed with the ledger column to
       the paisa on both orgs that have documents.
  #61  Unicode Group: 102 items, 102 with a model, 40 with an image, $1.9425
       spend of which 88.8% is images at $0.036714 each. Seeded org: 100 items
       with NO model recorded on any of them.
"""
import json
from datetime import date, datetime, timezone

import pytest

from services.skills.data import delta_and_provenance as dp
from services.skills.data.delta_and_provenance import (
    BULK_TOUCH_FLOOR, BULK_TOUCH_SHARE, CANNOT_FILL, IMAGE_MODEL_MARKERS,
    brief_content_provenance, brief_gstr9c_books_side,
    check_books_moved_since_due, _is_image_model, _month_window_start,
)

ORG = "00000000-0000-4000-8000-000000000058"


def _text(out, drop=()) -> str:
    """The whole output as one lowercase string, minus the keys named.

    An absent-phrase assertion has to exclude the caveat that explains the
    absence first — the sentence "this is not a reconciliation" contains the
    word "reconciliation" and would fail its own test.
    """
    slim = {k: v for k, v in out.items() if k not in drop}
    return json.dumps(slim, default=str).lower()


class _Pool:
    """Canned result sets matched on a FRAGMENT OF THE SQL, never on call order.

    THE STATUTE ARM FILTERS BY KEY. `services/statute.py` narrows by
    `obligation_key` in SQL and resolves the version in Python, so a mock that
    hands every seeded row to every lookup lets `_resolve` choose between facts
    about different obligations — and `brief_gstr9c_books_side` asks for TWO
    keys in one run. Without this filter the GSTR-9 row could answer the 9C
    question and the applicability test would pass for the wrong reason.
    """

    def __init__(self, fetch_by=None, row_by=None, val_by=None):
        self.fetch_by, self.row_by, self.val_by = fetch_by or {}, row_by or {}, val_by or {}
        self.sql_seen: list[str] = []
        self.args_seen: list[tuple] = []

    def _pick(self, table, sql, default):
        self.sql_seen.append(sql)
        for frag, payload in table.items():
            if frag in sql:
                return payload
        return default

    async def fetch(self, sql, *a):
        self.args_seen.append(a)
        rows = self._pick(self.fetch_by, sql, [])
        if "statute_calendar" in sql and a and isinstance(a[0], str):
            return [r for r in rows if r.get("obligation_key") == a[0]]
        return rows

    async def fetchrow(self, sql, *a):
        self.args_seen.append(a)
        return self._pick(self.row_by, sql, None)

    async def fetchval(self, sql, *a):
        self.args_seen.append(a)
        return self._pick(self.val_by, sql, None)


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


GSTR1 = [_statute()]
GSTR9C = _statute(
    obligation_key="gst.return.gstr9c", title="Self-certified statement",
    form_number="GSTR-9C", section_ref="s.44", periodicity="annual",
    due_day=31, due_month=12, due_month_offset=None,
    threshold_amount=50000000, effective_from=date(2021, 8, 1))
GSTR9 = _statute(
    obligation_key="gst.return.gstr9", title="Annual return",
    form_number="GSTR-9", section_ref="s.44", periodicity="annual",
    due_day=31, due_month=12, due_month_offset=None,
    threshold_amount=20000000, effective_from=date(2017, 7, 1))


def _doc(**kw):
    """One ganit_invoices row, dated inside the period the fixtures use."""
    row = {
        "id": "aaaaaaaa-0000-4000-8000-000000000001",
        "invoice_number": "INV-1", "invoice_type": "tax_invoice",
        "invoice_date": date(2026, 7, 4), "total": 100000,
        "doc_status": "final", "is_active": True,
        "created_at": datetime(2026, 7, 4, 9, tzinfo=timezone.utc),
        "updated_at": datetime(2026, 7, 4, 9, tzinfo=timezone.utc),
        "cancelled_at": None, "customer": "Bluvian Group",
    }
    row.update(kw)
    return row


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(dp, "utc_now",
                        lambda: datetime(2026, 8, 20, 6, 0, tzinfo=timezone.utc))


# ══════════════════════════════════════════════════════════════════════════
# 58 — the delta, and the one figure that is not one
# ══════════════════════════════════════════════════════════════════════════

def _moved_pool(docs):
    return _Pool(fetch_by={"statute_calendar": GSTR1, "ganit_invoices": docs})


@pytest.mark.asyncio
async def test_an_edited_document_never_enters_the_net(frozen):
    """THE central test. An edit's rupee change is not knowable — nothing in
    this product keeps a prior value — so the edited total is a ceiling and the
    net must not contain it. If this ever fails, the skill has started
    reporting a typo correction as lakhs of rupees moving after a filing."""
    edited = _doc(invoice_number="INV-EDIT", total=6900000,
                  created_at=datetime(2026, 7, 4, 9, tzinfo=timezone.utc),
                  updated_at=datetime(2026, 8, 18, 21, tzinfo=timezone.utc))
    out = await check_books_moved_since_due(_moved_pool([edited]), ORG, period="2026-07")

    assert out["counts"]["edited"] == 1
    assert out["value_delta"]["edited_value_ceiling"] == 6900000.0
    assert out["value_delta"]["net_known_delta"] == 0
    assert out["value_delta"]["added_net"] == 0
    assert out["value_delta"]["edited_value_is_a_ceiling_not_a_delta"] is True
    assert out["edited_after_the_due_date"][0]["delta_unknown"] is True
    assert any("ceiling" in l.lower() for l in out["limitations"])


@pytest.mark.asyncio
async def test_nothing_predicts_a_notice(frozen):
    """The exact claim #58 was rejected for. Two guards, because one is not
    enough: the WORD must be absent from everything except the limitation that
    denies it, and the denial must also be a machine-readable False that a
    summarising model cannot talk its way past."""
    out = await check_books_moved_since_due(
        _moved_pool([_doc(created_at=datetime(2026, 8, 15, tzinfo=timezone.utc))]),
        ORG, period="2026-07")

    assert out["predicts_a_departmental_notice"] is False
    # The denial key and the caveat that explains it are dropped first — both
    # necessarily contain the word they exist to disclaim.
    body = _text(out, drop=("limitations", "predicts_a_departmental_notice"))
    for word in ("notice", "intimation", "asmt", "drc-01", "scrutiny",
                 "department", "penalty", "interest u/s"):
        assert word not in body, f"{word!r} leaked into the output body"
    assert any("no departmental notice" in l.lower() for l in out["limitations"])


@pytest.mark.asyncio
async def test_a_credit_note_created_late_reduces_the_delta(frozen):
    """Sign, not size. A credit note raised after the return went REVERSES
    supply. Summed as a positive it would report a firm's own reversal as fresh
    turnover appearing after the filing — the wrong sign on the only number a
    reader acts on."""
    late = datetime(2026, 8, 15, tzinfo=timezone.utc)
    out = await check_books_moved_since_due(_moved_pool([
        _doc(invoice_number="INV-9", total=100000, created_at=late),
        _doc(id="bbbbbbbb-0000-4000-8000-000000000002", invoice_number="CN-1",
             invoice_type="credit_note", total=30000, created_at=late),
    ]), ORG, period="2026-07")

    assert out["counts"]["added"] == 2
    assert out["value_delta"]["added_net"] == 70000.0
    assert out["value_delta"]["net_known_delta"] == 70000.0


@pytest.mark.asyncio
async def test_a_withdrawn_document_has_the_opposite_sign(frozen):
    """Cancellation has NEVER happened live — cancelled_at is null on all 787
    documents and doc_status is never 'cancelled' — so this arm has run against
    zero rows in the wild. It is tested here precisely because production
    cannot test it, and the denominator is on the output so a reader sees
    '0 of N checked' rather than 'no cancellations'."""
    out = await check_books_moved_since_due(_moved_pool([
        _doc(invoice_number="INV-GONE", total=50000,
             cancelled_at=datetime(2026, 8, 14, tzinfo=timezone.utc)),
        _doc(id="cccccccc-0000-4000-8000-000000000003", invoice_number="INV-DEAD",
             total=20000, is_active=False,
             updated_at=datetime(2026, 8, 14, tzinfo=timezone.utc)),
    ]), ORG, period="2026-07")

    assert out["counts"]["withdrawn"] == 2
    assert out["value_delta"]["withdrawn_net"] == -70000.0
    assert out["value_delta"]["net_known_delta"] == -70000.0
    assert out["counts"]["documents_checked_for_withdrawal"] == 2
    # Sign, spelled out on the row as well as in the total: a withdrawn
    # POSITIVE invoice has a NEGATIVE effect on the return. Summing the
    # document's own supply value here reported the opposite.
    for row in out["withdrawn_after_the_due_date"]:
        assert row["supply_value"] > 0 > row["effect_on_the_return"]


@pytest.mark.asyncio
async def test_the_bulk_touch_flag_fires_on_one_stamped_date(frozen):
    """The seeded org's twenty-nine July documents all carry 2026-08-18. That
    is ONE update, not twenty-nine amendments, and a skill that cannot tell the
    difference reports a migration as a compliance event every month until
    somebody stops reading it."""
    stamp = datetime(2026, 8, 18, 21, tzinfo=timezone.utc)
    docs = [
        _doc(id=f"dddddddd-0000-4000-8000-00000000000{i}",
             invoice_number=f"INV-{i}", total=1000,
             created_at=datetime(2026, 7, 2, tzinfo=timezone.utc),
             updated_at=stamp)
        for i in range(1, 6)
    ]
    out = await check_books_moved_since_due(_moved_pool(docs), ORG, period="2026-07")

    assert out["bulk_touch"] is not None
    assert out["bulk_touch"]["documents"] == 5
    assert out["bulk_touch"]["share_of_edited"] == 1.0
    # And it is promoted to the FRONT of limitations, because a reader who only
    # reads the first caveat must read this one.
    assert "same last-edited date" in out["limitations"][0]


@pytest.mark.asyncio
async def test_two_edits_on_one_day_are_not_called_a_bulk_touch(frozen):
    """The other side of the flag. Two documents edited in the same minute is a
    person working, and crying backfill over it would teach a reader to ignore
    the flag on the day it matters."""
    stamp = datetime(2026, 8, 18, 21, tzinfo=timezone.utc)
    docs = [
        _doc(id=f"eeeeeeee-0000-4000-8000-00000000000{i}",
             invoice_number=f"INV-{i}", total=1000,
             created_at=datetime(2026, 7, 2, tzinfo=timezone.utc),
             updated_at=stamp)
        for i in range(1, BULK_TOUCH_FLOOR)
    ]
    out = await check_books_moved_since_due(_moved_pool(docs), ORG, period="2026-07")
    assert out["bulk_touch"] is None


@pytest.mark.asyncio
async def test_a_missing_calendar_row_classifies_nothing(frozen):
    """No due day means no cutoff. The failure to avoid is defaulting to a
    plausible 11th and printing a confident list off it — which is the exact
    class of bug services/statute.py exists to prevent."""
    pool = _Pool(fetch_by={"statute_calendar": [], "ganit_invoices": [_doc()]})
    out = await check_books_moved_since_due(pool, ORG, period="2026-07")

    assert out["gstr1_due_on"] is None
    assert out["counts"]["classified"] is False
    assert out["counts"]["documents_in_period"] == 1
    assert out["counts"]["added"] == out["counts"]["edited"] == 0
    assert "records no due day" in out["limitations"][0]
    # "nothing moved" and "nothing was checked" must never look alike.
    assert "NOTHING was classified" in out["limitations"][0]


@pytest.mark.asyncio
async def test_the_period_defaults_to_the_one_being_filed(frozen):
    """August's GSTR-1 is filed in September, so somebody opening this on
    20 August wants July. A handler with a required period cannot be scheduled
    at all — tests/test_a_skill_can_run_unattended.py is the general guard and
    this is the specific one."""
    out = await check_books_moved_since_due(_moved_pool([]), ORG)
    assert out["period"] == "2026-07"
    assert out["period_from"] == date(2026, 7, 1)
    assert out["period_to"] == date(2026, 7, 31)
    assert out["gstr1_due_on"] == date(2026, 8, 11)


@pytest.mark.asyncio
async def test_the_cap_is_disclosed(frozen):
    """'12 documents moved' and '12 documents moved, and we stopped looking'
    are different statements."""
    docs = [_doc(id=f"ffffffff-0000-4000-8000-00000000000{i}",
                 invoice_number=f"INV-{i}") for i in range(1, 4)]
    out = await check_books_moved_since_due(_moved_pool(docs), ORG,
                                            period="2026-07", limit=3)
    assert out["counts"]["capped_at"] == 3
    assert out["counts"]["was_capped"] is True


# ══════════════════════════════════════════════════════════════════════════
# 59 — one column, and the word it must never use
# ══════════════════════════════════════════════════════════════════════════

def _totals(**kw):
    row = {
        "n_invoices": 360, "n_credit_notes": 0,
        "inv_taxable": 70438000, "cn_taxable": 0,
        "inv_cgst": 3535695.54, "inv_sgst": 3535695.54,
        "inv_igst": 5607448.92, "inv_cess": 0, "cn_tax": 0,
        "discount": 0, "inv_total": 83116840, "cn_total": 0,
        "n_draft": 36, "n_export": 0, "n_without_lines": 0,
    }
    row.update(kw)
    return row


def _c9_pool(totals=None, rates=None, heads=None, statute=None):
    return _Pool(
        fetch_by={
            "statute_calendar": statute if statute is not None else [GSTR9C, GSTR9],
            "WITH lines AS": rates if rates is not None else [
                {"rate": 18, "invoice_type": "tax_invoice", "lines_seen": 720,
                 "lines_valued": 720, "taxable_value": 70438000},
            ],
            "ganit_expenses": heads if heads is not None else [
                {"head": "Professional Fees", "entries": 27,
                 "net_of_tax": 2151690, "tax_on_the_bill": 387304.20},
            ],
        },
        row_by={"FROM public.ganit_invoices": totals or _totals()},
    )


@pytest.mark.asyncio
async def test_the_output_is_never_called_a_reconciliation(frozen):
    """The exact claim #59 was rejected for: "a skill that calls itself a
    reconciliation and compares a number to itself will be caught by the first
    CA who runs it."

    Three places may legitimately contain the word and they are enumerated
    rather than waved through:

      `what_this_is_not`   the denial. It contains the word by definition.
      `limitations`        the caveats that repeat the denial.
      `cannot_fill`        the FORM's own table headings, quoted. Table 6 is
                           literally "Reasons for the un-reconciled difference
                           in annual gross turnover" and paraphrasing it to
                           dodge a test would make the list useless to the
                           preparer it exists for.

    Everywhere else — every key, every figure, every label this handler chose
    for itself, and the statute citation — must be clean. That last one is why
    the citation is built from form_number and section_ref instead of from the
    calendar's title, which is the statute's own name for the form."""
    out = await brief_gstr9c_books_side(_c9_pool(), ORG, financial_year="2025-26")

    body = _text(out, drop=("what_this_is_not", "limitations", "cannot_fill"))
    assert "reconcil" not in body

    # And inside cannot_fill it may appear only in the quoted heading, never in
    # this module's own explanation of why the table is empty.
    for entry in out["cannot_fill"]:
        assert "reconcil" not in entry["why_not_here"].lower()
        assert "reconcil" not in entry["table"].lower()

    # No KEY anywhere is named after the thing this does not do.
    def _keys(node):
        if isinstance(node, dict):
            for k, v in node.items():
                yield k
                yield from _keys(v)
        elif isinstance(node, list):
            for v in node:
                yield from _keys(v)

    assert not [k for k in _keys(out) if "reconcil" in k.lower()]

    # And the denial is the FIRST key, not a footnote at the bottom.
    assert list(out)[0] == "what_this_is_not"
    assert "not a reconciliation" in out["what_this_is_not"].lower()


@pytest.mark.asyncio
async def test_every_unfillable_table_carries_a_reason(frozen):
    """A list of gaps with no reasons is a list of excuses. Each entry has to
    name the artefact that does not exist, because that is what tells a reader
    whether it will ever arrive."""
    out = await brief_gstr9c_books_side(_c9_pool(), ORG, financial_year="2025-26")

    assert len(out["cannot_fill"]) == len(CANNOT_FILL) >= 9
    for entry in out["cannot_fill"]:
        assert entry["table"]
        assert entry["the_form_asks_for"]
        assert len(entry["why_not_here"]) > 30
    tables = " ".join(e["table"] for e in out["cannot_fill"])
    for expected in ("5A", "12", "14", "Part B"):
        assert expected in tables
    assert out["counts"]["tables_that_cannot_be_filled"] == len(CANNOT_FILL)


@pytest.mark.asyncio
async def test_a_short_rate_split_says_so_rather_than_printing_a_low_figure(frozen):
    """The rate split is rebuilt from a jsonb blob with three different amount
    key shapes. When lines carry no usable amount the split comes out SHORT —
    and a short split next to a correct-looking label is worse than no split at
    all, because 9C table 9 is footed on it."""
    out = await brief_gstr9c_books_side(_c9_pool(rates=[
        {"rate": 18, "invoice_type": "tax_invoice", "lines_seen": 720,
         "lines_valued": 400, "taxable_value": 40000000},
    ]), ORG, financial_year="2025-26")

    split = out["rate_split"]
    assert split["agrees_with_the_ledger_column"] is False
    assert split["lines_valued"] == 400 and split["lines_seen"] == 720
    assert split["difference"] == 30438000.0
    assert "RATE SPLIT IS SHORT" in out["limitations"][0]
    assert "Use the ledger figure" in out["limitations"][0]


@pytest.mark.asyncio
async def test_the_split_agrees_when_every_line_is_valued(frozen):
    """The other half of the pair — measured live it agrees to the paisa on
    both orgs that have documents, and a test that only ever sees the failure
    case cannot tell you the success case still works."""
    out = await brief_gstr9c_books_side(_c9_pool(), ORG, financial_year="2025-26")
    assert out["rate_split"]["agrees_with_the_ledger_column"] is True
    assert out["rate_split"]["difference"] == 0.0
    assert out["rate_split"]["rows"][0]["rate_percent"] == 18.0


@pytest.mark.asyncio
async def test_the_applicability_verdict_is_never_stated_as_certain(frozen):
    """Aggregate turnover is PAN-level; this product sees one org. Both
    verdicts must be qualified — 'required ON THIS FIGURE' — and the floor must
    be a limitation rather than a footnote in a docstring nobody reads."""
    over = await brief_gstr9c_books_side(_c9_pool(), ORG, financial_year="2025-26")
    assert over["applicability"]["verdict"] == "required on this figure"

    under = await brief_gstr9c_books_side(
        _c9_pool(totals=_totals(inv_taxable=928700, n_invoices=23, n_draft=0),
                 rates=[{"rate": 18, "invoice_type": "tax_invoice",
                         "lines_seen": 26, "lines_valued": 26,
                         "taxable_value": 928700}]),
        ORG, financial_year="2025-26")
    assert "not required on this figure" in under["applicability"]["verdict"]
    assert "PAN-level caveat" in under["applicability"]["verdict"]
    assert any("FLOOR" in l for l in under["limitations"])
    assert any("PAN-LEVEL" in l for l in under["limitations"])


@pytest.mark.asyncio
async def test_no_calendar_row_gives_no_verdict_and_no_due_date(frozen):
    """A form number or a threshold printed from memory is the defect the whole
    statute module exists to remove."""
    out = await brief_gstr9c_books_side(_c9_pool(statute=[]), ORG,
                                        financial_year="2025-26")
    assert out["applicability"]["form"] is None
    assert out["applicability"]["threshold"] is None
    assert out["applicability"]["due_on"] is None
    assert "no verdict is given" in out["applicability"]["verdict"]
    assert "records no GSTR-9C obligation" in out["limitations"][0]


@pytest.mark.asyncio
async def test_a_year_with_no_documents_says_nothing_was_read(frozen):
    """Aekam Inc has no FY 2025-26 documents at all. A wall of zeros with no
    caption reads as a year of nil supply, which is a different and much
    stronger claim than 'we found nothing'."""
    empty = _totals(n_invoices=0, n_credit_notes=0, inv_taxable=0, cn_taxable=0,
                    inv_cgst=0, inv_sgst=0, inv_igst=0, n_draft=0,
                    inv_total=0)
    out = await brief_gstr9c_books_side(
        _c9_pool(totals=empty, rates=[], heads=[]), ORG, financial_year="2025-26")

    assert out["counts"]["documents_read"] == 0
    assert "NO DOCUMENTS AT ALL" in out["limitations"][0]
    assert "not the same as" in out["limitations"][0]


@pytest.mark.asyncio
async def test_drafts_are_included_and_declared(frozen):
    """Whether a draft belongs in an annual figure is a decision, not a fact.
    Dropping thirty-six of them silently changes the applicability verdict."""
    out = await brief_gstr9c_books_side(_c9_pool(), ORG, financial_year="2025-26")
    assert out["counts"]["drafts_included"] == 36
    assert any("still in draft and ARE included" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_expense_heads_never_claim_to_be_credit(frozen):
    """9C table 14 wants ITC by expense head. This product holds the tax on a
    bill, which is NOT the credit availed on it, and the heads are the org's own
    free text rather than the form's prescribed ones. The column is present and
    explicitly null so the shape of the gap is visible."""
    out = await brief_gstr9c_books_side(_c9_pool(), ORG, financial_year="2025-26")
    head = out["expense_heads"][0]
    assert head["credit_availed"] is None
    assert head["tax_on_the_bill"] == 387304.20
    assert any(e["table"] == "14" for e in out["cannot_fill"])


@pytest.mark.asyncio
async def test_the_financial_year_defaults_to_the_one_that_closed(frozen):
    """On 20 August 2026 the live deadline is FY 2025-26, not the year in
    progress. Defaulting to the current year would report five months of
    turnover against an annual threshold."""
    out = await brief_gstr9c_books_side(_c9_pool(), ORG)
    assert out["financial_year"] == "2025-26"
    assert out["year_from"] == date(2025, 4, 1)
    assert out["year_to"] == date(2026, 3, 31)


# ══════════════════════════════════════════════════════════════════════════
# 61 — provenance, and the cost that cannot be attributed
# ══════════════════════════════════════════════════════════════════════════

def _item(**kw):
    row = {
        "id": "99999999-0000-4000-8000-000000000001",
        "title": "Weekly Social Media Pack — Step 1",
        "agent_type": "social_media",
        "created_at": datetime(2026, 7, 17, 10, tzinfo=timezone.utc),
        "credits_used": 2, "has_image": True,
        "model": "qwen/qwen3.6-flash", "provider": "qwen_flash",
        "content_skill": None, "template_name": "Weekly Social Media Pack",
        "template_module": "srijan", "template_category": "growth",
    }
    row.update(kw)
    return row


def _spend(**kw):
    row = {"month": "2026-07", "provider": "openrouter",
           "model": "google/gemini-3.1-flash-lite-image", "status": "success",
           "calls": 37, "cost_usd": 1.3255665}
    row.update(kw)
    return row


def _skill(**kw):
    row = {"name": "Receivables chase pack", "category": "money",
           "module": "ganit", "skill_type": "pack", "is_active": True,
           "steps": 2, "steps_asking_for_an_image": 0}
    row.update(kw)
    return row


def _prov_pool(items=None, spend=None, skills=None, image_credits=3):
    return _Pool(
        fetch_by={
            "hub_content_items": items if items is not None else [_item()],
            "hub_ai_logs": spend if spend is not None else [
                _spend(),
                _spend(provider="qwen_flash", model="qwen/qwen3.6-flash",
                       calls=33, cost_usd=0.0866300625),
                _spend(provider="glm", model="thudm/glm-4.5-air:free",
                       status="error", calls=23, cost_usd=0.0),
            ],
            "hub_org_skills s": skills if skills is not None else [_skill()],
        },
        val_by={"credit_prices": image_credits},
    )


@pytest.mark.asyncio
async def test_cost_is_never_attributed_to_an_item(frozen):
    """hub_ai_logs.content_item_id is written on 0 of 306 rows product-wide, so
    a per-item cost DOES NOT EXIST. The obvious wrong move is to divide a
    month's dollars by a month's items and present the quotient as a unit cost;
    the disclosure is what stops a reader — or a summariser — doing it."""
    out = await brief_content_provenance(_prov_pool(), ORG)

    assert out["cost_attribution"]["content_items_with_a_cost_record"] == 0
    assert "written by nothing" in out["cost_attribution"]["why"]
    assert any("CANNOT BE ATTRIBUTED TO A SINGLE ITEM" in l
               for l in out["limitations"])
    # No key anywhere offers a per-item figure to be misread as one.
    assert "cost_per_item" not in _text(out)


@pytest.mark.asyncio
async def test_image_spend_is_separated_and_priced_from_measurement(frozen):
    """Images were 78.2% of all spend when this was written, at $0.0358 and
    $0.0400 a call. The unit price is averaged over the calls that were
    CHARGED — a free failed rung would otherwise drag it down and make the next
    picture look cheaper than it is."""
    out = await brief_content_provenance(_prov_pool(), ORG)

    assert out["spend"]["image_calls"] == 37
    assert out["spend"]["image_usd"] == pytest.approx(1.325567, abs=1e-5)
    assert out["spend"]["image_share"] > 0.9
    assert out["spend"]["image_classified_by_model_name"] is True
    assert out["spend"]["is_a_floor"] is True
    each = out["image_cost_exposure"]["measured_cost_per_image_usd"]
    assert each == pytest.approx(0.035826, abs=1e-5)


@pytest.mark.asyncio
async def test_a_failed_call_never_becomes_a_unit_price(frozen):
    """The free GLM rung fails constantly — 85 rows of it live, all $0. If it
    were counted as a billed call the model's unit price would be zero and a
    reader would conclude that provider is free rather than broken."""
    out = await brief_content_provenance(_prov_pool(), ORG)
    glm = [m for m in out["by_model"] if "glm" in m["model"]][0]
    assert glm["calls"] == 23 and glm["failed_calls"] == 23
    assert glm["cost_each_usd"] is None
    assert out["spend"]["failed_calls"] == 23


@pytest.mark.asyncio
async def test_an_operational_skill_with_art_direction_is_the_reported_risk(frozen):
    """Every one of the 46 templates has bespoke art direction, so 'has its own
    direction' does not discriminate. The finding is a CHECK, a BRIEF or a PACK
    with one — internal reading nobody posts, where a four-cent cover buys
    nothing. Live, Receivables chase pack is exactly that and is assigned and
    active on Aekam Inc."""
    out = await brief_content_provenance(_prov_pool(), ORG)
    risk = out["image_cost_exposure"]

    assert risk["steps_asking_for_an_image_today"] == 0
    assert "Receivables chase pack" in risk["operational_skills_at_risk"]
    assert risk["a_run_can_force_an_image"] is True
    assert "generate_images" in risk["how"]
    assert risk["credits_charged_per_image"] == 3
    assert any("TEMPLATE state ONLY" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_a_content_skill_is_not_flagged_as_a_risk(frozen):
    """The other side. A picture on a social pack is the point of the skill;
    flagging it would make the whole signal noise."""
    out = await brief_content_provenance(
        _prov_pool(skills=[_skill(name="Weekly Social Media Pack",
                                  skill_type="content", category="growth",
                                  module="srijan")]), ORG)
    assert out["image_cost_exposure"]["operational_skills_at_risk"] == []
    assert "Weekly Social Media Pack" in \
        out["image_cost_exposure"]["skills_with_their_own_art_direction"]


@pytest.mark.asyncio
async def test_an_item_with_no_recorded_model_is_never_attributed(frozen):
    """100 of the seeded org's items carry no metadata at all. Filling the gap
    with the agent_type would invent a template that does not exist, and the
    denominator is what tells a reader the report is thin rather than the org
    being idle."""
    out = await brief_content_provenance(_prov_pool(items=[
        _item(), _item(id="99999999-0000-4000-8000-000000000002",
                       title="GST tips carousel #1", model=None, provider=None,
                       template_name=None, template_module=None,
                       template_category=None, has_image=False),
    ]), ORG)

    assert out["provenance"]["items_seen"] == 2
    assert out["provenance"]["items_with_a_recorded_model"] == 1
    assert out["provenance"]["items_with_a_named_template"] == 1
    names = [b["template"] for b in out["by_template"]]
    assert "(no template recorded)" in names
    assert any("Provenance is recorded on 1 of 2" in l for l in out["limitations"])
    orphan = [b for b in out["by_template"] if b["template"] == "(no template recorded)"][0]
    assert orphan["items_with_no_model"] == 1


@pytest.mark.asyncio
async def test_credits_and_dollars_are_never_added(frozen):
    """Credits are what the org was charged; dollars are what Aekam paid a
    provider. One number holding both would be meaningless in either currency,
    and somebody would put it in a margin calculation."""
    out = await brief_content_provenance(_prov_pool(), ORG)
    month = out["by_month"][0]
    assert set(("credits", "spend_usd")) <= set(month)
    assert month["credits"] == 2
    assert month["spend_usd"] != month["credits"]
    assert any("never added" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_the_window_is_month_aligned(frozen):
    """Twelve months back from 20 August is 1 September, not 20 September. An
    unaligned window makes the oldest bucket a partial month, and a partial
    month beside eleven whole ones reads as a fall in spend that never was."""
    assert _month_window_start(date(2026, 8, 20), 12) == date(2025, 9, 1)
    assert _month_window_start(date(2026, 1, 5), 3) == date(2025, 11, 1)
    assert _month_window_start(date(2026, 8, 20), 1) == date(2026, 8, 1)

    out = await brief_content_provenance(_prov_pool(), ORG, months=12)
    assert out["window_from"] == date(2025, 9, 1)
    assert out["months"] == 12


def test_image_models_are_recognised_and_text_models_are_not():
    """The log has no modality column, so this classification is all there is.
    Both directions matter: a text model counted as an image would invent the
    trap, and an image model counted as text would hide it."""
    for model in ("google/gemini-3.1-flash-lite-image",
                  "bytedance-seed/seedream-4.5", "recraft/recraft-v4",
                  "black-forest-labs/flux.2-pro"):
        assert _is_image_model(model), model
    for model in ("qwen/qwen3.6-flash", "google/gemini-2.5-flash",
                  "google/gemini-2.5-pro", "thudm/glm-4.5-air:free", None, ""):
        assert not _is_image_model(model), model
    assert "image" in IMAGE_MODEL_MARKERS


# ══════════════════════════════════════════════════════════════════════════
# the contract every handler in the shelf is held to
# ══════════════════════════════════════════════════════════════════════════

ALL_HANDLERS = (
    check_books_moved_since_due,
    brief_gstr9c_books_side,
    brief_content_provenance,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("handler,pool_factory", [
    (check_books_moved_since_due, lambda: _moved_pool([_doc()])),
    (brief_gstr9c_books_side, _c9_pool),
    (brief_content_provenance, _prov_pool),
], ids=lambda x: getattr(x, "__name__", "pool"))
async def test_every_output_survives_json_dumps(handler, pool_factory, frozen):
    """The dispatcher serialises this before anything else touches it.

    `default=str` is the contract — dates go out as ISO strings and that is
    intended. What it must NOT be papering over is a Decimal: asyncpg returns
    one for every numeric column, `default=str` would quietly turn it into the
    JSON string "70438000.00", and a consumer doing arithmetic on that gets a
    TypeError three services away. So the blob is checked AND the tree is
    walked for Decimals that `_f` should have converted."""
    from decimal import Decimal

    out = await handler(pool_factory(), ORG)
    blob = json.dumps(out, default=str)
    assert len(blob) > 200

    def _walk(node, path="out"):
        if isinstance(node, dict):
            for k, v in node.items():
                _walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                _walk(v, f"{path}[{i}]")
        else:
            assert not isinstance(node, Decimal), f"Decimal survived at {path}"

    _walk(out)


@pytest.mark.asyncio
@pytest.mark.parametrize("handler,pool_factory", [
    (check_books_moved_since_due, lambda: _moved_pool([_doc()])),
    (brief_gstr9c_books_side, _c9_pool),
    (brief_content_provenance, _prov_pool),
], ids=lambda x: getattr(x, "__name__", "pool"))
async def test_every_output_carries_counts_and_honest_limitations(
        handler, pool_factory, frozen):
    """The two keys the shelf contract requires. `limitations` being non-empty
    is the whole posture: a handler with nothing to caveat has not looked hard
    enough at what it cannot see."""
    out = await handler(pool_factory(), ORG)
    assert isinstance(out["counts"], dict) and out["counts"]
    assert isinstance(out["limitations"], list) and out["limitations"]
    for line in out["limitations"]:
        assert isinstance(line, str) and len(line) > 20


@pytest.mark.asyncio
@pytest.mark.parametrize("handler,pool_factory", [
    (check_books_moved_since_due, lambda: _moved_pool([_doc()])),
    (brief_gstr9c_books_side, _c9_pool),
    (brief_content_provenance, _prov_pool),
], ids=lambda x: getattr(x, "__name__", "pool"))
async def test_no_uuid_is_rendered_as_a_name(handler, pool_factory, frozen):
    """Ids are row handles the UI acts on, never labels a person reads. The
    fixtures deliberately put a real name next to every id, so a handler that
    reached for the wrong column would be caught rather than passing on an
    output that happened to contain no names at all."""
    out = await handler(pool_factory(), ORG)

    def _walk(node, key=None):
        if isinstance(node, dict):
            for k, v in node.items():
                _walk(v, k)
        elif isinstance(node, list):
            for v in node:
                _walk(v, key)
        elif isinstance(node, str) and len(node) == 36 and node.count("-") == 4:
            # A uuid may appear only under a key that reads as a handle.
            assert key in ("invoice_id", "content_id"), \
                f"uuid rendered under {key!r}: {node}"

    _walk(out)


@pytest.mark.asyncio
@pytest.mark.parametrize("handler,pool_factory", [
    (check_books_moved_since_due, lambda: _moved_pool([_doc()])),
    (brief_gstr9c_books_side, _c9_pool),
    (brief_content_provenance, _prov_pool),
], ids=lambda x: getattr(x, "__name__", "pool"))
async def test_every_query_carries_the_tenant_boundary(handler, pool_factory,
                                                       frozen):
    """org_id = $1::uuid on every statement that touches org data, and the org
    id bound FIRST. The one exception is services/statute.py, which reads a
    reference table by obligation key, and staging.credit_prices, which is the
    product's own price list — neither holds tenant data.

    The graha rule is the specific one: the FK to graha_clients is on the id
    alone, so an id-only join prints ANOTHER PRACTICE'S CLIENT NAME. It has been
    proved live. Any statement that mentions those tables must also carry the
    org_id pair."""
    pool = pool_factory()
    await handler(pool, ORG)

    reference = ("statute_calendar", "credit_prices")
    for sql in pool.sql_seen:
        if any(t in sql for t in reference):
            continue
        assert "org_id = $1::uuid" in sql, sql[:200]
        for table, alias in (("graha_clients", "cl"), ("graha_contacts", "ct")):
            if table in sql:
                assert f"{alias}.org_id = i.org_id" in sql, sql[:400]

    for args in pool.args_seen:
        if args and isinstance(args[0], str) and args[0].startswith("gst."):
            continue          # a statute lookup binds the obligation key first
        if args:
            assert args[0] == ORG, f"first bind parameter is not the org: {args}"


def test_the_handlers_can_all_be_scheduled():
    """A handler with a required parameter beyond (pool, org_id) cannot be run
    unattended — the dispatcher refuses it and the skill is a button for ever.
    A period, a financial year and a window all have an answer a machine can
    work out at 6am."""
    import inspect
    for handler in ALL_HANDLERS:
        params = list(inspect.signature(handler).parameters.values())
        assert [p.name for p in params[:2]] == ["pool", "org_id"], handler.__name__
        for p in params[2:]:
            assert p.default is not inspect.Parameter.empty, \
                f"{handler.__name__}.{p.name} has no default"


def test_the_bulk_touch_constants_are_a_deliberate_pair():
    """A share with no floor would flag two documents edited together; a floor
    with no share would flag thirty documents of which three happened to share
    a day. Both are needed and both are read in one place."""
    assert 0.5 < BULK_TOUCH_SHARE <= 1.0
    assert BULK_TOUCH_FLOOR >= 3
