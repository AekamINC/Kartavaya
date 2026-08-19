"""Receivables ageing by party — the first row-level report section.

The two promises this file exists to hold, both of which have a named way of
going wrong:

  · THE BUCKETING IS ON THE DUE DATE. An ageing that anchors on the invoice
    date turns every current account overdue — an invoice on 30-day terms
    issued 40 days ago is 10 days late, not 40. Measured on the live seeded
    org 2026-08-19, the invoice_date reading moves ₹6,04,214.04 of balance
    into 90+ that is not three months late. `services/statement_pdf`'s
    `age_receivables` already decided this for the per-client statement, and
    the section IMPORTS it rather than copying it, so the two documents
    cannot disagree by a bucket. `test_shares_the_statement_ager` pins the
    import; the rest pin the behaviour, because an import that is later
    quietly replaced by a local CASE ladder should fail loudly here.

  · THE TOTALS RECONCILE. Every party row's Total is the sum of its bucket
    cells, the All parties row is the column-wise sum of the party rows, and
    its Total is the whole open book — the one figure a reader cross-checks
    against `ganit.outstanding`. Rounding is done per CELL for exactly this
    reason: summing raw floats and rounding at the end is how a statement
    ends up a paisa off its own columns.

The SQL assertions are ratchets, not decoration. Each one names a guard that
changes the number if it is dropped, and each was measured against the live
catalogue rather than assumed.
"""
from __future__ import annotations

import asyncio
import re
from datetime import date, timedelta

import pytest

from services import module_report as mr
from services.report_defs import REPORT_DEFS, ReportDef, load_all
from services.report_defs import receivables_ageing as ra
from services.statement_pdf import AGEING_BUCKETS

ORG = "22222222-2222-2222-2222-222222222222"
KEY = "ganit.receivables_ageing_by_party"
TODAY = date(2026, 8, 19)

#: The bucket column headers, in the order the table prints them.
COLS = [label for _key, label, _lo, _hi in AGEING_BUCKETS]


def run(coro):
    return asyncio.run(coro)


def item(party, days_overdue, amount):
    """One open invoice, `days_overdue` past its due date as at TODAY."""
    return {"party": party,
            "due_date": TODAY - timedelta(days=days_overdue),
            "balance_due": amount}


class FakePool:
    """Answers the section's one query with fixed rows; records the SQL."""

    def __init__(self, rows):
        self.rows, self.calls = rows, []

    async def fetch(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return self.rows


# ── the ager is SHARED, not reimplemented ───────────────────────────────────

def test_shares_the_statement_ager():
    """The section calls statement_pdf's ager and prints its bucket labels.

    Two documents that age the same book must age it the same way; the
    cheapest guarantee is one function. If this fails because someone
    inlined a CASE ladder, the failure is the point.
    """
    from services import statement_pdf

    assert ra.age_receivables is statement_pdf.age_receivables
    assert ra.AGEING_BUCKETS is statement_pdf.AGEING_BUCKETS
    assert COLS == ["Current", "1–30 days", "31–60", "61–90", "90+"]


# ── the bucketing is on the DUE date ────────────────────────────────────────

def test_buckets_on_due_date_not_invoice_date():
    """A 30-day-terms invoice issued 40 days ago is 10 days overdue.

    The section is handed the DUE date (the SQL COALESCEs it), so an
    invoice_date reading would land this row in 31–60. It must land in
    1–30 — the whole point of ageing from terms.
    """
    rows = ra.build_rows([item("Sharma Textiles Pvt Ltd", 10, 100000.0)], TODAY)
    party = rows[0]
    assert party["1–30 days"] == 100000.0
    assert party["31–60"] == 0.0, "aged from the invoice date, not the due date"
    assert party["90+"] == 0.0


def test_not_yet_due_is_current_not_overdue():
    """An invoice due next week owes nothing overdue.

    On the live seeded org 21 open invoices / ₹4,79,362.02 are not yet due.
    A four-bucket 0-30 scheme folds them in with genuinely late money and a
    collections clerk chases a client who is not late.
    """
    rows = ra.build_rows([item("Menon Traders LLP", -7, 50000.0)], TODAY)
    assert rows[0]["Current"] == 50000.0
    assert rows[0]["1–30 days"] == 0.0


def test_due_today_is_current():
    """Day zero is not day one. `age_receivables` treats days_overdue <= 0 as
    current, and a boundary that slips by one prints a client as late on the
    morning the payment is due."""
    rows = ra.build_rows([item("Iyer Consulting Industries", 0, 1234.0)], TODAY)
    assert rows[0]["Current"] == 1234.0


@pytest.mark.parametrize("days,column", [
    (1, "1–30 days"), (30, "1–30 days"),
    (31, "31–60"), (60, "31–60"),
    (61, "61–90"), (90, "61–90"),
    (91, "90+"), (400, "90+"),
])
def test_bucket_boundaries(days, column):
    """Every edge of every bucket, so an off-by-one in a future rewrite is a
    failing test rather than a client moved a bucket late."""
    rows = ra.build_rows([item("Pillai Marine Pvt Ltd", days, 900.0)], TODAY)
    assert rows[0][column] == 900.0
    assert rows[0]["Total"] == 900.0


# ── the totals reconcile ────────────────────────────────────────────────────

def build_book():
    """A book with every bucket populated across three parties, plus a
    not-yet-due item, so both reconciliations have something to fail on.

    The parties are listed SMALLEST FIRST, and that order is load-bearing:
    it is also alphabetical (Bansal < Menon < Sharma), so the insertion order
    and the alphabetical order both differ from the order the table must
    print. An earlier version of this fixture listed them largest-first,
    which made `test_biggest_debtor_first_and_footer_last` pass with the sort
    deleted outright — measured, not suspected.
    """
    return [
        item("Bansal Foods & Co", 91, 1000.01),                  # ₹1,000.01
        item("Menon Traders LLP", 45, 12345.67),                 # ₹20,000.00
        item("Menon Traders LLP", 75, 7654.33),
        item("Sharma Textiles Pvt Ltd", -3, 10000.0),            # ₹3,35,001.00
        item("Sharma Textiles Pvt Ltd", 15, 25000.55),
        item("Sharma Textiles Pvt Ltd", 200, 300000.45),
    ]


def test_party_total_is_the_sum_of_its_buckets():
    for row in ra.build_rows(build_book(), TODAY):
        assert row["Total"] == pytest.approx(sum(row[c] for c in COLS)), row


def test_footer_reconciles_column_by_column():
    """The All parties row is the column-wise sum of the rows above it —
    the addition a reader does on paper."""
    rows = ra.build_rows(build_book(), TODAY)
    footer, parties = rows[-1], rows[:-1]
    assert footer[ra.PARTY_COLUMN] == ra.TOTAL_ROW
    for col in COLS + ["Total"]:
        assert footer[col] == pytest.approx(sum(p[col] for p in parties)), col


def test_footer_total_is_the_whole_open_book():
    """The figure that must equal `ganit.outstanding` — the sum every other
    view of the receivables ledger reports. On the live seeded org both read
    ₹2,66,19,706.62 (probed 2026-08-19)."""
    book = build_book()
    rows = ra.build_rows(book, TODAY)
    assert rows[-1]["Total"] == pytest.approx(
        round(sum(i["balance_due"] for i in book), 2))


def test_cells_are_rounded_so_the_printed_row_ties():
    """Thirds of a rupee: the printed cells must still add to the printed
    total. Rounding only the total is the paisa-off statement bug."""
    book = [item("Kulkarni Motors Industries", 10, 1 / 3),
            item("Kulkarni Motors Industries", 40, 1 / 3),
            item("Kulkarni Motors Industries", 100, 1 / 3)]
    row = ra.build_rows(book, TODAY)[0]
    assert row["Total"] == pytest.approx(sum(row[c] for c in COLS))
    for c in COLS:
        assert row[c] == round(row[c], 2)


def test_biggest_debtor_first_and_footer_last():
    """The page exists to be worked down, so the ₹3.35 lakh account cannot sit
    under the ₹1,000 one.

    Asserted as a LITERAL order rather than "is sorted", because a
    self-referential assertion (sort the rows by their own Total and compare)
    holds for any list at all — the previous version of this test passed with
    `rows.sort(...)` deleted from build_rows entirely. The fixture is now
    inserted smallest-first and alphabetically, so no-sort and ascending-sort
    both fail here.
    """
    rows = ra.build_rows(build_book(), TODAY)
    assert [r[ra.PARTY_COLUMN] for r in rows] == [
        "Sharma Textiles Pvt Ltd",
        "Menon Traders LLP",
        "Bansal Foods & Co",
        ra.TOTAL_ROW,
    ]


def test_empty_book_prints_no_footer():
    """No rows is the honest empty page (`render_report_html` says so in
    words). A lone row of zeros reads as "nothing is owed" when the truth
    may be "nothing was found"."""
    assert ra.build_rows([], TODAY) == []


def test_credit_balance_is_not_a_receivable():
    """`age_receivables` skips outstanding <= 0. The SQL already excludes
    those invoices, but a party whose only item is an overpayment must not
    appear as a row of zeros in a chase list — a clerk who rings the one
    client who is square stops trusting the page. It must not appear at all,
    and with nothing left to total there is no footer either."""
    rows = ra.build_rows([{"party": "Singh Agro & Sons",
                           "due_date": TODAY - timedelta(days=40),
                           "balance_due": -500.0}], TODAY)
    assert rows == [], "a party that owes nothing printed as a row of zeros"


def test_a_zero_party_does_not_suppress_the_ones_that_owe():
    """Dropping the square party must not take the footer or the real debtors
    with it — the credit balance is skipped, everything else still prints and
    still reconciles."""
    book = build_book() + [{"party": "Singh Agro & Sons",
                            "due_date": TODAY - timedelta(days=40),
                            "balance_due": -500.0}]
    rows = ra.build_rows(book, TODAY)
    names = [r[ra.PARTY_COLUMN] for r in rows]
    assert "Singh Agro & Sons" not in names
    assert names[-1] == ra.TOTAL_ROW
    assert len(names) == 4
    assert rows[-1]["Total"] == pytest.approx(
        round(sum(i["balance_due"] for i in build_book()), 2))


# ── names, never ids ────────────────────────────────────────────────────────

UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def test_rows_carry_names_never_ids():
    """These rows are printed on a page the firm hands to someone. A client
    or org UUID must never reach one (decision_names_not_ids)."""
    rows = ra.build_rows(
        [{"party": "Sharma Textiles Pvt Ltd", "due_date": TODAY,
          "balance_due": 10.0}], TODAY)
    for row in rows:
        for value in row.values():
            assert not UUID_RE.search(str(value)), row


def test_unlinked_client_is_named_not_dropped():
    """234 of 781 live invoices have no client_id and they are real money.
    The SQL binds the label as $2 and the builder falls back to the same
    string, so a NULL name never prints as 'None' and never vanishes."""
    rows = ra.build_rows(
        [{"party": None, "due_date": TODAY, "balance_due": 99.0}], TODAY)
    assert rows[0][ra.PARTY_COLUMN] == ra.UNLINKED
    assert ra.UNLINKED == "Unlinked client"


# ── the query's guards, each one a measured difference ──────────────────────

def test_sql_ages_from_due_date_coalesced_to_invoice_date():
    """due_date is NULL on 94 of the 265 open invoices on the seeded org
    (35%). Ageing on due_date alone would drop a third of the book off a
    page that still looks complete."""
    sql = " ".join(ra.OPEN_ITEMS_SQL.split())
    assert "COALESCE(i.due_date, i.invoice_date) AS due_date" in sql


def test_sql_computes_outstanding_and_never_reads_balance_due():
    """`balance_due` exists and is NOT NULL, which is why it is tempting; it
    has drifted from total - amount_paid on 2 of the 684 live non-draft rows
    (re-measured 2026-08-19). It is the output alias here, never a source."""
    sql = " ".join(ra.OPEN_ITEMS_SQL.split())
    assert "(i.total - COALESCE(i.amount_paid, 0))::float AS balance_due" in sql
    assert "i.balance_due" not in sql


def test_sql_carries_the_ganit_house_guards():
    sql = " ".join(ra.OPEN_ITEMS_SQL.split())
    # Soft delete, and drafts are not a receivable.
    assert "i.is_active = TRUE" in sql
    assert "i.doc_status <> 'draft'" in sql
    # NEVER `= 'final'`: live doc_status is final/viewed/draft/sent, so an
    # equality test silently drops 155 real invoices — and doc_status
    # defaults to 'final', so it never meant "locked" in the first place.
    assert "doc_status = 'final'" not in sql
    # Credit notes are stored with POSITIVE totals; summing them would ADD
    # reversals to what a client owes.
    assert "i.invoice_type <> 'credit_note'" in sql
    # Only open items.
    assert "i.total - COALESCE(i.amount_paid, 0) > 0" in sql


def test_sql_is_schema_qualified_org_scoped_and_cast():
    """Schema-qualified (a shadow table has bitten this repo), org-scoped by
    a bind, and every parameter cast — PgBouncer turns an untyped parse
    error into an instant 500 (the credits incident)."""
    sql = " ".join(ra.OPEN_ITEMS_SQL.split())
    assert "staging.ganit_invoices" in sql
    assert "staging.graha_clients" in sql
    assert "i.org_id = $1::uuid" in sql
    assert "$2::text" in sql
    # Both lookaheads are load-bearing. `\$\d(?!::)` — the first version of
    # this line — matches the '$1' inside '$10::int' and reports a cast bind
    # as uncast: a false failure lying in wait for the eleventh parameter.
    # `\$\d+(?!::)` does not fix it either, because `+` BACKTRACKS: '$10'
    # fails the lookahead, the engine retries '$1', and the '0' is not '::'.
    # `(?!\d)` is what stops the backtrack — the number must end before the
    # cast is looked for. Both counter-cases are asserted below so the next
    # person to "simplify" this regex finds out here.
    UNCAST = r"\$\d+(?!\d)(?!::)"
    assert re.search(UNCAST, sql) is None, "an uncast bind parameter"
    assert re.search(UNCAST, "SELECT $10::int + $11::int") is None
    assert re.search(UNCAST, "SELECT $1, $2::text") is not None
    assert re.search(UNCAST, "SELECT $1::int + $2") is not None


def test_sql_left_joins_the_client():
    """INNER would drop ₹42,34,873.20 of the seeded org's open book —
    the 234 invoices with no linked client — without a trace."""
    sql = " ".join(ra.OPEN_ITEMS_SQL.split())
    assert "LEFT JOIN staging.graha_clients" in sql


def test_run_binds_the_org_and_the_unlinked_label():
    pool = FakePool([{"party": "Menon Traders LLP",
                      "due_date": TODAY - timedelta(days=5),
                      "balance_due": 42.0}])
    rows = run(ra.receivables_ageing_by_party(pool, ORG, None))
    assert pool.calls[0][1] == [ORG, ra.UNLINKED]
    assert rows[0][ra.PARTY_COLUMN] == "Menon Traders LLP"


# ── the definition, and the spine it plugs into ─────────────────────────────

def test_registered_as_a_stock_section_of_ganit():
    load_all()
    d = REPORT_DEFS[KEY]
    assert d.module == "ganit"
    assert d.grain == "stock", "a balance is what is unpaid NOW, not at a period end"
    assert d.reads == frozenset({"ganit"})
    assert d.sensitivity == "financial"


def test_reads_always_contains_the_owning_module():
    """Declaring `reads` without the owner would gate a section on a foreign
    grant while leaving its own unchecked."""
    d = ReportDef(key="ganit.x", module="ganit", label="x", grain="stock",
                  reads=frozenset({"graha"}), run=lambda *a: None)
    assert d.reads == frozenset({"ganit", "graha"})


@pytest.mark.parametrize("kwargs,fragment", [
    # A third grain would be handed straight to `report_section`'s
    # `win if d.grain == "flow" else None` and silently become a stock.
    (dict(key="ganit.x", module="ganit", grain="quarterly"), "grain"),
    # No builder is not an empty section, it is a section that raises at
    # render time — inside the document loop, where the whole report dies.
    (dict(key="ganit.x", module="ganit", grain="stock", run=None), "run"),
    # A key whose prefix is not the module makes `reads` and the key disagree
    # about who owns the section, and the gate follows `reads`.
    (dict(key="graha.x", module="ganit", grain="stock"), "key must be"),
    (dict(key="noprefix", module="ganit", grain="stock"), "key must be"),
])
def test_declaration_faults_are_refused_at_import(kwargs, fragment):
    """Every ReportDef guard fires. These raise where a def is DECLARED —
    import time — rather than where it is rendered, because the alternative
    is a scheduled report that dies mid-document."""
    kwargs = {"label": "x", "run": (lambda *a: None), **kwargs}
    with pytest.raises(ValueError, match=fragment):
        ReportDef(**kwargs)


def test_duplicate_keys_are_refused():
    """Two defs on one key means the second silently replaces the first, and
    a saved view keeps naming a section that no longer produces its rows."""
    from services.report_defs import register

    d = ReportDef(key="ganit.dupe_probe", module="ganit", label="x",
                  grain="stock", run=lambda *a: None)
    register(d)
    try:
        with pytest.raises(ValueError, match="duplicate report key"):
            register(d)
    finally:
        REPORT_DEFS.pop("ganit.dupe_probe", None)


def test_sections_for_omits_what_the_caller_cannot_read():
    """Unreachable sections are ABSENT from the catalogue, not listed and
    disabled — `analytics.registry.catalogue_for`'s rule. A section is
    offered only when EVERY module it reads is reachable: a partial export of
    the books is still an export of the books."""
    from services.report_defs import sections_for

    assert KEY in [s["key"] for s in sections_for({"ganit", "graha"})]
    assert KEY in [s["key"] for s in sections_for({"ganit"})]
    assert KEY not in [s["key"] for s in sections_for({"graha"})]
    assert sections_for(set()) == []
    entry = next(s for s in sections_for({"ganit"}) if s["key"] == KEY)
    # The catalogue is a list a UI prints. No id belongs in it, and neither
    # does `run` — a callable would not survive JSON anyway.
    assert set(entry) == {"key", "module", "label", "grain", "sensitivity",
                          "description"}


def test_section_returns_the_widget_shape():
    """`render_report_html` discriminates on `label` + `data`/`absent` and
    nothing else, which is why a row-level report needed no new renderer."""
    pool = FakePool([{"party": "Bansal Foods & Co", "due_date": TODAY,
                      "balance_due": 10.0}])
    out = run(mr.report_section(pool, ORG, "ganit", None,
                                {"report": KEY}, None, {}))
    assert set(out) == {"report", "label", "grain", "data"}
    assert out["label"] == "Receivables ageing by party"
    assert out["data"][0][ra.PARTY_COLUMN] == "Bansal Foods & Co"


def test_section_renders_through_the_existing_letterhead():
    """End to end through the SHARED renderer — no new PDF engine, no new
    export code. The party name and the footer must appear in the bytes."""
    pool = FakePool([{"party": "Sharma Textiles Pvt Ltd", "due_date": TODAY,
                      "balance_due": 61354.38}])
    out = run(mr.report_section(pool, ORG, "ganit", None,
                                {"report": KEY}, None, {}))
    html = mr.render_report_html({"name": "Aekam Inc"}, "Finance",
                                 "19 Aug 2026", [out])
    assert "Receivables ageing by party" in html
    assert "Sharma Textiles Pvt Ltd" in html
    assert ra.TOTAL_ROW in html
    assert "61354.38" in html


def test_retired_key_is_a_stated_absence_never_a_zero():
    """Proposal 62 §10, the widget rule inherited: a section that cannot
    answer says so in words and is never dropped silently."""
    out = run(mr.report_section(FakePool([]), ORG, "ganit", None,
                                {"report": "ganit.gone"}, None, {}))
    assert "absent" in out and "retired" in out["absent"]
    assert "data" not in out


def test_foreign_module_is_withheld_when_no_gate_is_available():
    """The engine's scheduled send has no request and passes gate=None. Every
    foreign module a section reads is then refused — a robot must not hand
    out rows nobody's entitlement was checked for."""
    load_all()
    d = REPORT_DEFS[KEY]
    out = run(mr.report_section(FakePool([]), ORG, "graha", None,
                                {"report": KEY}, None, {}))
    assert out["absent"] == "Withheld — this report needs the ganit module."
    assert "data" not in out
    assert d.module == "ganit"


def test_foreign_module_runs_when_the_gate_allows_it():
    asked = []

    async def gate(code):
        asked.append(code)
        return True

    pool = FakePool([{"party": "Singh Agro & Sons", "due_date": TODAY,
                      "balance_due": 5.0}])
    out = run(mr.report_section(pool, ORG, "graha", None,
                                {"report": KEY}, gate, {}))
    assert asked == ["ganit"]
    assert out["data"][0][ra.PARTY_COLUMN] == "Singh Agro & Sons"


def test_own_module_is_never_re_gated():
    """/module-report already ran THE gate on the page's module before
    resolving the arrangement; asking again would double-count the
    sensitive-module audit row."""
    asked = []

    async def gate(code):
        asked.append(code)
        return True

    run(mr.report_section(FakePool([]), ORG, "ganit", None,
                          {"report": KEY}, gate, {}))
    assert asked == []


def test_stock_section_is_handed_no_window():
    """The MetricRequest contract, kept: a stock section cannot silently read
    a window it does not honour."""
    seen = {}

    async def fake_run(pool, org_id, window):
        seen["window"] = window
        return []

    d = REPORT_DEFS[KEY]
    object.__setattr__(d, "run", fake_run)
    try:
        run(mr.report_section(FakePool([]), ORG, "ganit", ("W",),
                              {"report": KEY}, None, {}))
    finally:
        object.__setattr__(d, "run", ra.receivables_ageing_by_party)
    assert seen["window"] is None
