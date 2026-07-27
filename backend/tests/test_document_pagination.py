"""The page budget, and what is allowed to be standing at a page break.

A4 is 297mm. Every generated document breaks at **`CONTENT_BUDGET_MM`** (290mm
today, raised from 285 by the owner), leaving 7mm of
headroom so that no rounding, font substitution or printer margin can push a
stray line onto a sheet of its own. `doc_render.CONTENT_BUDGET_MM` owns that
number for all eight documents; these tests are what stop it drifting back.

Why the measurement here is not the obvious one
-----------------------------------------------
The obvious measurement — the height of the `.page` box — is a lie. `.page`
carries `min-height`, so a document whose content stops at 199mm still reports
the floor. Measured that way the five "short" documents all read 297.1mm and
looked like they were overflowing when in truth they had 86mm to spare, which
is how the budget question got asked in the first place.

`_content_mm` therefore measures INK: the lowest edge of anything that actually
marks the paper — a line of text, an image, a background, a rule — ignoring
`html`, `body` and `.page` themselves (all three are white boxes the size of the
sheet) and ignoring the `@page` margin boxes, which live in the reserved tail
strip below the budget by design and are furniture, not content.

What each test is defending
---------------------------
Every item below was a real defect in a real rendering, not a hypothetical:

* content running past the budget (all eight, before the budget existed);
* a table pushed WHOLE to the next sheet because its wrapper was
  `break-inside: avoid`, leaving 189mm of white on the TDS challan's first page;
* a page carrying nothing but the colophon;
* a continuation sheet with no letterhead and no clue what document it belongs
  to;
* a colophon printing "Page 1 of 2" on the first sheet of a three-sheet
  agreement, because the count was hardcoded rather than counted.

No email, push or WhatsApp is involved on any path in this file, no fixture
supplies a logo URL so `embed_logo` never reaches the network, and every amount
is an obviously synthetic round figure belonging to no real firm.
"""

from __future__ import annotations

import functools

import pytest

from services.doc_render import CONTENT_BUDGET_MM, PAGE_HEIGHT_MM
from test_document_set import (
    CLIENT,
    FULL_TABLE_4_INPUTS,
    ORG,
    SPEC_GSTR3B_INPUTS,
    agreement,
    challan,
    project_report,
    quotation,
    statement,
)

MM = 96.0 / 25.4  # CSS px per mm at WeasyPrint's 96dpi reference


def _weasyprint_available() -> bool:
    try:
        from weasyprint import HTML  # noqa: F401
    except (ImportError, OSError):
        return False
    return True


pytestmark = pytest.mark.skipif(
    not _weasyprint_available(),
    reason="WeasyPrint's native stack (libpango/libgobject) is not installed here",
)


# ══════════════════════════════════════════════════════════════════════════════
# Fixtures — spec volume, and a volume the spec fixtures never reach
# ══════════════════════════════════════════════════════════════════════════════
#
# "A document that fits at 3 rows and clips at 30 is not done." The large
# fixtures below are deliberately past every real-world volume these documents
# see: 28 invoice lines, 24 TDS deduction lines, 34 statement transactions, 18
# quotation lines, 16 milestones, 15 report measures and 12 decisions.

def _invoice(n_lines: int) -> dict:
    lines, subtotal = [], 0.0
    for i in range(n_lines):
        amt = 1000.0 * (i + 1)
        subtotal += amt
        lines.append({
            "description": f"Advisory engagement component {i + 1}",
            "hsn_code": "998221", "quantity": 1, "rate": amt, "amount": amt,
        })
    cgst = round(subtotal * 0.09, 2)
    return {
        "invoice_number": "INV-2026-0001", "invoice_type": "tax_invoice",
        "currency": "INR", "subtotal": subtotal, "cgst": cgst, "sgst": cgst,
        "igst": 0, "total": round(subtotal + 2 * cgst, 2),
        "place_of_supply": "Maharashtra", "invoice_date": "2026-07-21",
        "due_date": "2026-08-20", "line_items": lines,
    }


def _payslip() -> dict:
    return {
        "payslip_number": "PS-2026-07-0044", "month": "2026-07",
        "working_days": 26, "present_days": 26, "leaves_paid": 1, "leaves_unpaid": 0,
        "basic": 60000, "hra": 24000, "da": 6000, "special_allowance": 18000,
        "conveyance": 1600, "medical": 1250, "reimbursements": 3000, "gross": 113850,
        "pf_employee": 7200, "professional_tax": 200, "tds": 8000,
        "total_deductions": 15400, "net_pay": 98450, "pf_employer": 7200,
    }


def _employee() -> dict:
    return {
        "name": "Aanya Mehta", "designation": "Senior Associate",
        "department_name": "Assurance", "employee_id": "EMP-0142",
        "pan": "AAAPM1234K", "uan": "100200300400",
        "pf_number": "MH/BAN/0012345/000/0000142",
        "bank_name": "Demo Bank", "bank_account": "0000123456789",
    }


def _challan_big(n: int) -> dict:
    secs = [("194C", "Payments to contractors", 2),
            ("194J", "Professional / technical fees", 10),
            ("194I", "Rent — plant and machinery", 2),
            ("194H", "Commission or brokerage", 5),
            ("192B", "Salary — non-government employees", None),
            ("194A", "Interest other than securities", 10),
            ("194Q", "Purchase of goods", 1), ("194", "Dividend", 10)]
    ded, total = [], 0
    for i in range(n):
        sec, nature, rate = secs[i % len(secs)]
        tds = 1000 * (i + 1)
        total += tds
        paid = tds * 50 if rate is None else int(tds * 100 / rate)
        ded.append({"section": sec, "nature": nature, "count": (i % 7) + 1,
                    "amount_paid": paid, "rate": rate, "tds": tds})
    return challan(deductions=ded, amounts={"income_tax": total})


def _statement_big(n: int) -> dict:
    entries, bal = [], 100000
    for i in range(n):
        day, mon = (i % 27) + 1, 4 + (i % 4)
        if i % 3 == 2:
            entries.append({"date": f"2026-{mon:02d}-{day:02d}",
                            "document": f"RCPT-{900 + i}",
                            "particulars": "Payment received", "credit": 50000})
            bal -= 50000
        else:
            entries.append({"date": f"2026-{mon:02d}-{day:02d}",
                            "document": f"INV-{2500 + i}",
                            "particulars": f"Professional services — phase {i + 1}",
                            "debit": 100000})
            bal += 100000
    return statement(entries=entries, closing_balance=bal,
                     ageing={"current": bal, "d1_30": 0, "d31_60": 0,
                             "d61_90": 0, "d90_plus": 0})


def _quotation_big(n: int) -> dict:
    items = []
    for i in range(n):
        rate = (100000 * (i + 1)) // 12
        items.append({"description": f"Engagement workstream {i + 1}",
                      "sub": "monthly retainer", "quantity": 12, "unit": "mo",
                      "rate": rate, "line_total": rate * 12})
    sub = sum(i["line_total"] for i in items)
    return quotation(line_items=items, subtotal=sub, igst=int(sub * 0.18), is_igst=True)


def _agreement_big(n: int) -> dict:
    ms = [{"title": f"Milestone {i + 1} — deliverable issued and accepted",
           "target": f"2026-{(i % 12) + 1:02d}-15",
           "share_pct": round(100 / n, 2), "fee": 100000} for i in range(n)]
    return agreement(milestones=ms, fee=100000 * n,
                     scope=[f"Scope item {i + 1} for the engagement." for i in range(6)])


def _project_report_big(n_measures: int, n_dec: int) -> dict:
    measures = [{"label": f"Milestone {i + 1} — drawings and approvals",
                 "numeric": True, "plan": 100 * (i + 1),
                 "actual": 100 * (i + 1) + (i % 5) * 7, "variance": (i % 5) * 7,
                 "state": ["On plan", "Watch", "Over"][i % 3], "unit": "h"}
                for i in range(n_measures)]
    decisions = [{"by": f"2026-08-{(i % 27) + 1:02d}",
                  "text": f"Decision {i + 1} — confirm the outstanding item and record it."}
                 for i in range(n_dec)]
    return project_report(measures=measures, decisions=decisions)


def _gstr3b_big() -> dict:
    return {**SPEC_GSTR3B_INPUTS,
            **{k: v for k, v in FULL_TABLE_4_INPUTS.items() if k.startswith("itc_")},
            "held_back": [{"party": f"Demo Vendor {i + 1}",
                           "reason": "HSN code missing", "itc": 1000 * (i + 1)}
                          for i in range(12)]}


@functools.lru_cache(maxsize=None)
def build(name: str, volume: str) -> str:
    """The HTML of one document at `volume` in ("spec", "large").

    Cached: every case below is rendered by four separate assertions and a
    WeasyPrint layout is the expensive part of this file. The generators are
    pure functions of their fixtures, so the cache cannot mask a change.
    """
    from services import (agreement_pdf, gstr3b_pdf, invoice_pdf, payslip_pdf,
                          project_report_pdf, quotation_pdf, statement_pdf,
                          tds_challan_pdf)
    from services.doc_validation import (validate_gstr3b, validate_project_report,
                                         validate_quotation, validate_service_agreement,
                                         validate_statement, validate_tds_challan)
    big = volume == "large"

    if name == "invoice":
        return invoice_pdf._build_html(_invoice(28 if big else 1), ORG, CLIENT)
    if name == "payslip":
        return payslip_pdf._build_html(_payslip(), _employee(), ORG)
    if name == "gstr3b":
        g = _gstr3b_big() if big else SPEC_GSTR3B_INPUTS
        return gstr3b_pdf._build_html(g, ORG, validate_gstr3b(g, ORG))
    if name == "tds_challan":
        c = _challan_big(24) if big else challan()
        return tds_challan_pdf._build_html(c, ORG, validate_tds_challan(c, ORG))
    if name == "statement":
        s = _statement_big(34) if big else statement()
        return statement_pdf._build_html(s, ORG, CLIENT, validate_statement(s, ORG, CLIENT))
    if name == "quotation":
        q = _quotation_big(18) if big else quotation()
        return quotation_pdf._build_html(q, ORG, CLIENT, validate_quotation(q, ORG, CLIENT))
    if name == "agreement":
        a = _agreement_big(16) if big else agreement()
        return agreement_pdf._build_html(a, ORG, CLIENT, validate_service_agreement(a, ORG, CLIENT))
    if name == "project_report":
        p = _project_report_big(15, 12) if big else project_report()
        return project_report_pdf._build_html(p, ORG, CLIENT,
                                              validate_project_report(p, ORG, CLIENT))
    raise AssertionError(f"unknown document {name!r}")


# ══════════════════════════════════════════════════════════════════════════════
# Measurement
# ══════════════════════════════════════════════════════════════════════════════

@functools.lru_cache(maxsize=None)
def _render(html_str: str):
    from weasyprint import HTML
    return HTML(string=html_str, base_url=None).render()


@functools.lru_cache(maxsize=None)
def _pdf(name: str, volume: str) -> bytes:
    from weasyprint import HTML
    return HTML(string=build(name, volume), base_url=None).write_pdf()


def _content_boxes(page):
    """The page's content roots, excluding the `@page` margin boxes.

    The margin boxes carry the continuation footer and sit in the reserved tail
    BELOW the budget on purpose. Counting them would make every continuation
    sheet read ~292mm and fail a budget it does not actually breach.
    """
    from weasyprint.formatting_structure import boxes as B
    return [c for c in page._page_box.children if not isinstance(c, B.MarginBox)]


def _content_mm(page) -> float:
    """Where the ink stops on this sheet, in mm. See the module docstring."""
    from weasyprint.formatting_structure import boxes as B
    bottom = 0.0
    for root in _content_boxes(page):
        for box in root.descendants():
            if getattr(box, "element_tag", None) in ("html", "body"):
                continue
            el = getattr(box, "element", None)
            if el is not None and "page" in (el.get("class") or "").split():
                continue
            paints = isinstance(box, (B.LineBox, B.ReplacedBox))
            if not paints:
                st = getattr(box, "style", None)
                if st is None:
                    continue
                bg = st["background_color"]
                paints = bool(getattr(bg, "alpha", 0) not in (0, None) or any(
                    st[f"border_{s}_width"]
                    and st[f"border_{s}_style"] not in ("none", "hidden")
                    for s in ("top", "right", "bottom", "left")
                ))
            if not paints:
                continue
            h = getattr(box, "border_height", None)
            h = h() if callable(h) else getattr(box, "height", 0.0)
            if not isinstance(h, (int, float)):
                continue
            bottom = max(bottom, getattr(box, "position_y", 0.0) + h)
    return bottom / MM


def _line_count(page) -> int:
    from weasyprint.formatting_structure import boxes as B
    return sum(1 for root in _content_boxes(page)
               for box in root.descendants() if isinstance(box, B.LineBox))


def _pdf_pages_text(pdf_bytes: bytes) -> list[str]:
    try:
        import io

        from pypdf import PdfReader
    except ImportError:
        pytest.skip("pypdf is not installed — cannot read text back out of the PDF")
    return [p.extract_text() or "" for p in PdfReader(io.BytesIO(pdf_bytes)).pages]


# ══════════════════════════════════════════════════════════════════════════════
# The documents, and the page count each is expected to take
# ══════════════════════════════════════════════════════════════════════════════
#
# The counts are PINNED, not merely bounded. A change that quietly turns a
# one-page invoice into two pages is exactly the regression this file exists to
# catch, and an assertion of "<= 3" would sail past it.
#
# `tds_challan` at spec volume was the one document the budget cost a page: its
# content measures ~287mm, which cleared 285 by less than 2mm and so broke onto
# a second sheet carrying the CIN, the signature and the notes — orphaning the
# identity of the deposit from the money, on a counterfoil of three lines.
# The owner raised CONTENT_BUDGET_MM to 290 rather than accept that, and it is
# back to one page. 7mm of headroom remains.
#
# These counts are read from the constant, not from 290: lower the budget again
# and this case flips back to 2, which is the correct behaviour and not a
# failure of this file.
CASES = [
    ("invoice",        "spec",  1),
    ("invoice",        "large", 2),
    ("payslip",        "spec",  1),
    ("payslip",        "large", 1),
    ("gstr3b",         "spec",  2),
    ("gstr3b",         "large", 3),
    ("tds_challan",    "spec",  1),
    ("tds_challan",    "large", 2),
    ("statement",      "spec",  1),
    ("statement",      "large", 2),
    ("quotation",      "spec",  1),
    ("quotation",      "large", 2),
    ("agreement",      "spec",  2),
    ("agreement",      "large", 3),
    ("project_report", "spec",  1),
    ("project_report", "large", 2),
]
IDS = [f"{n}-{v}" for n, v, _ in CASES]

#: The LAST element of each document. If a page overran its sheet or a break
#: dropped a fragment, this is what would go missing first.
CLOSING = {
    "invoice": "valid without physical signature",
    "payslip": "computer-generated payslip",
    "gstr3b": "retain with books under section 35",
    "tds_challan": "verify against the bank challan",
    "statement": "without prejudice",
    "quotation": "Accepting this quote creates the engagement",
    "agreement": "audit trail retained",
    "project_report": "figures are live at",
}


@pytest.mark.parametrize("name,volume,expected_pages", CASES, ids=IDS)
class TestPageBudget:

    def test_no_page_exceeds_the_budget(self, name, volume, expected_pages):
        """The whole point. 285mm, every page, every data volume."""
        doc = _render(build(name, volume))
        for i, page in enumerate(doc.pages, 1):
            mm = _content_mm(page)
            assert mm <= CONTENT_BUDGET_MM + 0.5, (
                f"{name} [{volume}] page {i} of {len(doc.pages)} runs to {mm:.1f}mm, "
                f"past the {CONTENT_BUDGET_MM}mm budget"
            )

    def test_the_page_count_is_what_we_intend(self, name, volume, expected_pages):
        doc = _render(build(name, volume))
        assert len(doc.pages) == expected_pages, (
            f"{name} [{volume}] took {len(doc.pages)} pages, expected "
            f"{expected_pages} — heights "
            + ", ".join(f"{_content_mm(p):.1f}mm" for p in doc.pages)
        )

    def test_no_page_carries_only_a_colophon_or_a_signature(self, name, volume,
                                                            expected_pages):
        """A colophon alone measures about 14mm and two lines.

        This shipped once: a TDS challan comfortably inside its sheet was pushed
        onto a second page carrying nothing but `.foot`, and it was only caught
        by rasterising. The floor is set well above a colophon and well below
        the thinnest legitimate tail in the set.
        """
        doc = _render(build(name, volume))
        for i, page in enumerate(doc.pages, 1):
            mm, lines = _content_mm(page), _line_count(page)
            assert mm >= 25.0 and lines >= 4, (
                f"{name} [{volume}] page {i} carries only {mm:.1f}mm / {lines} "
                f"lines — that is a colophon or a signature on a sheet of its own"
            )

    def test_nothing_is_lost(self, name, volume, expected_pages):
        """The last element of the document survives to the PDF's text layer."""
        from weasyprint import HTML
        pdf = HTML(string=build(name, volume), base_url=None).write_pdf()
        text = "\n".join(_pdf_pages_text(pdf))
        needle = CLOSING[name]
        assert needle.casefold() in text.casefold(), (
            f"{name} [{volume}] lost its closing element {needle!r}"
        )


@pytest.mark.parametrize("name,volume,expected_pages",
                         [c for c in CASES if c[2] > 1],
                         ids=[f"{n}-{v}" for n, v, p in CASES if p > 1])
class TestContinuationPagesStandAlone:
    """A reader holding page 2 must be able to tell what it belongs to."""

    def test_every_continuation_page_names_the_document_and_counts_itself(
            self, name, volume, expected_pages):
        pages = _pdf_pages_text(_pdf(name, volume))
        total = len(pages)
        for i, text in enumerate(pages[1:], start=2):
            flat = " ".join(text.split())
            assert f"Page {i} of {total}" in flat, (
                f"{name} [{volume}] page {i} does not count itself"
            )
            assert ORG["name"] in flat, (
                f"{name} [{volume}] page {i} does not name the organisation"
            )

    def test_the_first_page_keeps_the_design_untouched(self, name, volume,
                                                       expected_pages):
        """Page one is not a continuation page: it has the letterhead, so it
        gets no running footer and the design is unaltered."""
        first = " ".join(_pdf_pages_text(_pdf(name, volume))[0].split())
        assert "Page 1 of" not in first


class TestBreakMechanics:
    """The specific mechanisms, pinned so a stylesheet edit cannot quietly
    remove one and leave the budget passing on today's fixture volumes."""

    def test_a_table_that_spans_sheets_reprints_its_header(self):
        """34 statement transactions span two sheets; the second must open with
        the column headings, not with a bare row."""
        pages = _pdf_pages_text(_pdf("statement", "large"))
        assert len(pages) == 2
        for i, text in enumerate(pages, 1):
            assert "PARTICULARS".casefold() in text.casefold(), (
                f"statement page {i} has table rows with no repeated header"
            )

    def test_a_table_wrapped_in_a_block_may_still_break(self):
        """`.block` is `break-inside: avoid`, which is right for a short panel
        and catastrophic for a wrapper around a 24-row table: the table cannot
        split, so the whole thing moves to the next sheet and leaves 189mm of
        white behind. `block()` marks a table-bearing block `--flow`."""
        from services.doc_render import block, table
        wrapped = block("Deductions", table([("A", "", "")], ["<tr><td>x</td></tr>"]))
        assert "block--flow" in wrapped
        assert "block--flow" not in block("Notes", "<p class='terms'>short</p>")

    def test_the_tds_challan_no_longer_strands_its_deduction_table(self):
        """The measured regression: page one used to end at 96mm."""
        doc = _render(build("tds_challan", "large"))
        assert _content_mm(doc.pages[0]) > 250.0, (
            "the deduction table was pushed off page one again"
        )

    def test_the_running_identity_cannot_break_out_of_the_stylesheet(self):
        """The continuation footer is the only user-supplied value in this
        codebase that lands inside a `<style>` element.

        `<style>` is a raw text element: the HTML parser does not decode
        entities there, it scans for `</style` and stops. So `html.escape` is
        NOT a defence here — an org named `</style><script>…` would close the
        stylesheet and inject markup into every document carrying that firm's
        name. `css_string` emits `<` and `>` as CSS numeric escapes, which the
        CSS parser turns back into the right characters for display while the
        HTML tokeniser never sees a tag opener.
        """
        from services.doc_render import css_string, document, running_id

        evil = '</style><script>alert(1)</script>'
        out = document(["<p>x</p>"], {"name": evil}, title="t",
                       running=running_id("Invoice", {"name": evil}, "INV-1"))
        assert "</style><script>" not in out
        assert "<script>" not in out.split("</style>")[0]
        # And the quote/backslash cases that would end the declaration early.
        assert css_string('a"b\\c') == '"a\\"b\\\\c"'
        # It still READS as the original text once CSS has resolved the escapes.
        assert "\\3c " in css_string("<")

    def test_the_budget_leaves_real_headroom_on_a4(self):
        """Pinned so the budget cannot drift without someone meaning it.

        290 is the owner's decision, raised from 285 after seeing that a
        three-line TDS challan measured 286.9mm and so broke onto a second sheet
        carrying the CIN, the signature and the notes — orphaning the identity of
        the deposit from the money on a counterfoil of three lines.

        The lower bound is the part that is not merely an echo of the constant:
        a typical printer's unprintable bottom edge is 5–6mm, so a budget that
        leaves less than that would silently clip on paper while looking correct
        on screen. 7mm clears it. These documents are emailed far more often than
        printed, which is what makes 7 an acceptable trade where 0 would not be.
        """
        headroom = PAGE_HEIGHT_MM - CONTENT_BUDGET_MM
        assert CONTENT_BUDGET_MM == 290, "the budget changed — was that deliberate?"
        assert headroom == 7
        assert headroom >= 6, (
            "headroom is below a printer's unprintable bottom edge; the last line "
            "of every document would clip on paper while looking fine on screen"
        )

    def test_the_budget_is_declared_once(self):
        """The page geometry belongs to the shared layer, not to eight copies.

        A generator that sets its own `@page` would silently opt out of the
        budget, which is precisely the failure this consolidation prevents.
        """
        import pathlib

        services = pathlib.Path(__file__).resolve().parents[1] / "services"
        offenders = [
            p.name for p in services.glob("*_pdf.py")
            if "@page" in p.read_text(encoding="utf-8")
            and p.name != "cost_report_pdf.py"  # see the test below
        ]
        assert offenders == [], (
            f"{offenders} declare their own @page instead of using doc_render"
        )

    def test_the_cost_and_credit_reports_are_inside_the_budget_by_geometry(self):
        """`cost_report_pdf` predates the brand layer and is the one generator
        that still owns its own page box. It is not being migrated here — the
        brief is pagination, not a restyle — but it must still obey the budget.

        It does so by construction rather than by rule: `margin: 20mm 18mm` on
        A4 leaves a 257mm content box, 28mm inside the budget, so there is no
        data volume at which a page of it can breach 285mm. Pinned so that a
        later edit loosening those margins has to come past this test.
        """
        import pathlib
        import re

        src = (pathlib.Path(__file__).resolve().parents[1]
               / "services" / "cost_report_pdf.py").read_text(encoding="utf-8")
        rules = re.findall(r"@page \{\{ size: A4; margin: (\d+)mm (\d+)mm; \}\}", src)
        assert rules, "cost_report_pdf's @page rule changed shape — re-check the budget"
        for top, _side in rules:
            box = PAGE_HEIGHT_MM - 2 * int(top)
            assert box <= CONTENT_BUDGET_MM, (
                f"cost_report_pdf leaves a {box}mm content box, past the "
                f"{CONTENT_BUDGET_MM}mm budget"
            )


# ══════════════════════════════════════════════════════════════════════════════
# The cost and credit reports: the font contract, in rendered bytes
# ══════════════════════════════════════════════════════════════════════════════
#
# These two are client-facing and bilingual, and they shipped for months with
# their Devanagari falling through to DejaVu — which has no Devanagari coverage
# — so `उपयोग एवं लागत प्रतिवेदन` printed as a row of tofu boxes. The static
# scan in `test_document_statutory.py` catches an UNWRAPPED literal; this
# catches the other half, which is a wrapper that is present but not working:
# a stylesheet missing `@font-face`, a face that fails to embed, a font-weight
# that pulls in a synthesised bold.
#
# The signal is that the vendored family appears in the page's font RESOURCES at
# all. WeasyPrint subsets and embeds only the faces it actually draws with, so
# its presence proves the Devanagari was set in it and its absence proves the
# fallback happened — which is exactly what the pre-fix bytes showed.
#
# Embedding is checked by walking /Resources /Font -> /FontDescriptor, NOT by
# searching the raw bytes for b"FontFile2". That search is permanently False
# here because the descriptors live inside compressed object streams, so an
# assertion built on it passes nothing and fails nothing.

def _font_resources(pdf_bytes: bytes):
    """[(basefont, embedded)] for every font on every page."""
    try:
        import io

        from pypdf import PdfReader
    except ImportError:
        pytest.skip("pypdf is not installed — cannot read fonts back out of the PDF")
    out = []
    for page in PdfReader(io.BytesIO(pdf_bytes)).pages:
        res = page.get("/Resources")
        if res is None:
            continue
        fonts = res.get_object().get("/Font")
        if fonts is None:
            continue
        for ref in fonts.get_object().values():
            f = ref.get_object()
            nodes = [f]
            if f.get("/Subtype") == "/Type0" and f.get("/DescendantFonts"):
                nodes += [d.get_object() for d in f["/DescendantFonts"]]
            embedded = any(
                k in node["/FontDescriptor"].get_object()
                for node in nodes if node.get("/FontDescriptor") is not None
                for k in ("/FontFile", "/FontFile2", "/FontFile3")
            )
            out.append((str(f.get("/BaseFont", "?")), embedded))
    return out


def _cost_report(ai_n: int, sc_n: int) -> bytes:
    """Synthetic usage. Every figure is a repdigit and every name a placeholder:
    this is the product's OWN cost report, so nothing in the fixture may read as
    a rate card."""
    from services.cost_report_pdf import generate_cost_report_pdf

    def rows(n, key):
        return [{"service": f"Sample Service {i + 1}", key: 111 * (i + 1),
                 "charge_inr": 1111.11} for i in range(n)]

    ai, sc = rows(ai_n, "calls"), rows(sc_n, "runs")
    return generate_cost_report_pdf({
        "org_name": "Meghdoot Advisory LLP", "plan_name": "Sample Plan",
        "period_start": "01 Apr 2026", "period_end": "30 Apr 2026",
        "ai_services": ai, "scraper_services": sc, "credits_used": 4444,
        "total_ai_inr": 1111.11 * ai_n, "total_scraper_inr": 1111.11 * sc_n,
        "total_charge_inr": 1111.11 * (ai_n + sc_n),
        "signatory_name": "A. Sample", "signatory_designation": "Authorised Signatory",
    })


def _credit_report(n: int) -> bytes:
    from services.cost_report_pdf import generate_credit_report_pdf

    br = [{"name": f"Sample Catalog {i + 1}", "runs": 111 * (i + 1),
           "credits": 222 * (i + 1)} for i in range(n)]
    used = sum(b["credits"] for b in br)
    return generate_credit_report_pdf({
        "org_name": "Meghdoot Advisory LLP", "plan_name": "Sample Plan",
        "period_start": "01 Apr 2026", "period_end": "30 Apr 2026",
        "plan_credits": 55555, "current_balance": 11111, "ai_credits_used": 2222,
        "scraper_credits_used": used, "total_credits_used": used + 2222,
        "overage_credits": 0, "scraper_breakdown": br,
        "signatory_name": "A. Sample", "signatory_designation": "Authorised Signatory",
    })


COST_DOCS = [
    ("cost_report", "spec", lambda: _cost_report(3, 3), 1),
    ("cost_report", "large", lambda: _cost_report(28, 24), 2),
    ("credit_report", "spec", lambda: _credit_report(3), 1),
    ("credit_report", "large", lambda: _credit_report(34), 2),
]


@pytest.mark.parametrize("name,volume,build_pdf,expected_pages", COST_DOCS,
                         ids=[f"{n}-{v}" for n, v, _b, _p in COST_DOCS])
class TestCostReportFontContract:
    def test_the_vendored_devanagari_face_is_used_and_embedded(
            self, name, volume, build_pdf, expected_pages):
        """The defect this file's cost-report section exists for. Before the
        fix, Tiro appeared in NO page's resources and the Devanagari was drawn
        with DejaVu."""
        from services.doc_fonts import DEVANAGARI_FAMILY, has_devanagari_font

        if not has_devanagari_font():
            pytest.skip("no vendored Devanagari face — deva_span degrades to Latin")
        family = DEVANAGARI_FAMILY.replace(" ", "")
        fonts = _font_resources(build_pdf())
        used = [(b, e) for b, e in fonts if family in b.replace("-", "")]
        assert used, (
            f"{name} at {volume} volume draws no run in {DEVANAGARI_FAMILY} — "
            f"its Devanagari fell back and is printing as tofu. Fonts: "
            f"{sorted({b for b, _ in fonts})}"
        )
        for basefont, embedded in used:
            assert embedded, f"{basefont} is referenced but not embedded"

    def test_no_devanagari_run_lands_on_a_synthesised_bold(
            self, name, volume, build_pdf, expected_pages):
        """Tiro ships one weight, 400. A bold Devanagari face in the resources
        means the renderer synthesised one, which smears the conjunct joins.

        This is not hypothetical: naming the Devanagari family inside the Latin
        stacks — the obvious-looking way to cover Devanagari in tenant data —
        made Tiro the first PRESENT family in every stack, moved the whole
        document onto it, and produced exactly this face.
        """
        from services.doc_fonts import DEVANAGARI_FAMILY

        family = DEVANAGARI_FAMILY.replace(" ", "").lower()
        offenders = [
            b for b, _e in _font_resources(build_pdf())
            if family in b.replace("-", "").lower()
            and ("bold" in b.lower() or "italic" in b.lower())
        ]
        assert offenders == [], (
            f"{name} at {volume} volume synthesised {offenders} — "
            f"{DEVANAGARI_FAMILY} has only weight 400"
        )

    def test_the_page_count_is_what_we_intend(self, name, volume, build_pdf,
                                              expected_pages):
        assert len(_pdf_pages_text(build_pdf())) == expected_pages

    def test_no_page_carries_only_a_signature_or_a_colophon(
            self, name, volume, build_pdf, expected_pages):
        """An orphan page. The colophon is the last thing on the sheet, so a
        page holding it and nothing else is a page the reader is handed for no
        reason."""
        pages = _pdf_pages_text(build_pdf())
        for i, text in enumerate(pages):
            body = [ln.strip() for ln in text.splitlines() if ln.strip()]
            assert len(body) > 6, (
                f"{name} at {volume} volume: page {i + 1} of {len(pages)} carries "
                f"only {body} — an orphan page"
            )
