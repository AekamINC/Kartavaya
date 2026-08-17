"""D3b — dristi's export artefacts carry their identity (proposal 62 §6).

PDF: the anonymous "<h1>" document became the branded page — the narrow
analytics letterhead (name + logo + title + period, NO GSTIN, NO address),
the data tables, and the colophon, assembled via doc_render.document exactly
the way routers/analytics.py's pdf branch assembles its page.

XLSX: an identity header above the summary — org name (A1, bold), report
title (A2), period line (A3), a real generated-at instant WITH a timezone
(A4), then a blank row, then the content that was already there.

CSV: NO banner row — the in-code comment is right, a comment line above the
header breaks the first parser it meets — so the identity rides in the
FILENAME alone: <org-slug>_<report_type>_<from>_<to>.csv, or _as-at-<date>
for the two stock reports (pipeline and hr, which take no window).

The PDF branch is asserted on the BUILT HTML, not rendered bytes: WeasyPrint's
native stack is absent on the Windows dev machine (doc_render.render_pdf
raises), so the renderer is doubled and its input captured.
"""
import asyncio
import io
from datetime import date, datetime

import pytest

from routers import dristi
from services import doc_render, gst_period
from services.report_render import org_slug


USER = {"user_id": "11111111-1111-1111-1111-111111111111"}
ORG_ID = "22222222-2222-2222-2222-222222222222"
FROM, TO = "2026-04-01", "2026-06-30"

DEFAULT_ORG = {"name": "Suryodaya Textiles Pvt. Ltd."}

# One canned payload per shape the renderers must handle: a dict with only a
# table (revenue), a dict with only scalars (hr), and the mixed overview.
from decimal import Decimal

CANNED = {
    "revenue": {"monthly": [
        {"month": "2026-04-01T00:00:00+00:00", "total": Decimal("311671.60"), "count": 6},
        {"month": "2026-05-01T00:00:00+00:00", "total": Decimal("12000.00"), "count": 2},
    ]},
    "pipeline": {"stages": [{"stage": "Won", "count": 3, "value": Decimal("50000")}]},
    "hr": {"active_employees": 42},
    "overview": {"tasks": 165, "contacts": 4, "revenue": 88500.0},
}


def run(coro):
    # asyncio.run, not get_event_loop: Python 3.12+ raises rather than
    # creating an implicit loop on the main thread.
    return asyncio.run(coro)


class Doubles:
    """What the fixture wires up, exposed to the tests."""

    def __init__(self):
        self.org = dict(DEFAULT_ORG)
        self.html = None            # what reached render_pdf
        self.load_org_calls = 0


@pytest.fixture
def doubles(monkeypatch):
    """export_report with its collaborators doubled: the pool (never queried
    once _fetch_report_data is doubled), entitlement, report data, the org
    loader, and the PDF renderer — captured, not run."""
    d = Doubles()

    async def _get_pool():
        return object()

    monkeypatch.setattr(dristi, "get_pool", _get_pool)

    async def _reachable(_pool, _user, _org, mods):
        return set(mods)            # entitlement is tested elsewhere

    monkeypatch.setattr(dristi, "reachable_modules", _reachable)

    async def _fetch(_pool, _org_id, report_type, win=None):
        return CANNED[report_type]

    monkeypatch.setattr(dristi, "_fetch_report_data", _fetch)

    # export_report imports load_org from services.gst_period at call time,
    # so patching the source module's attribute intercepts it.
    async def _load_org(_pool, _org_id):
        d.load_org_calls += 1
        return dict(d.org)

    monkeypatch.setattr(gst_period, "load_org", _load_org)

    def _render(html):
        d.html = html
        return b"%PDF-doubled"

    monkeypatch.setattr(doc_render, "render_pdf", _render)
    return d


def export(report_type, **kw):
    return run(dristi.export_report(report_type=report_type,
                                    user=USER, org_id=ORG_ID, **kw))


def export_csv_text(report_type, **kw):
    """The CSV branch returns a StreamingResponse; drain it on the loop."""
    async def _go():
        resp = await dristi.export_report(report_type=report_type,
                                          user=USER, org_id=ORG_ID, **kw)
        chunks = [c async for c in resp.body_iterator]
        return resp, "".join(c.decode() if isinstance(c, bytes) else c
                             for c in chunks)
    return run(_go())


def filename(resp) -> str:
    return resp.headers["content-disposition"]


# ── the slug ─────────────────────────────────────────────────────────────────

def test_org_slug_lowercases_collapses_and_strips():
    assert org_slug("Suryodaya Textiles Pvt. Ltd.") == "suryodaya-textiles-pvt-ltd"
    assert org_slug("A&B — C") == "a-b-c"


def test_org_slug_falls_back_to_org_when_nothing_survives():
    assert org_slug("") == "org"
    assert org_slug(None) == "org"
    assert org_slug("   ") == "org"
    # A Devanagari-only name yields no ASCII alphanumerics; the fallback must
    # hold rather than emitting an empty leading component.
    assert org_slug("कर्तव्य") == "org"


# ── pdf: the branded page ────────────────────────────────────────────────────

def test_pdf_is_the_branded_page_not_the_anonymous_h1(doubles):
    resp = export("revenue", format="pdf", date_from=FROM, date_to=TO)

    assert resp.body == b"%PDF-doubled"
    assert resp.media_type == "application/pdf"
    html = doubles.html

    # The letterhead is present and carries the identity…
    assert 'class="lh"' in html
    assert "Suryodaya Textiles Pvt. Ltd." in html
    assert "Revenue report" in html
    # …and the window, worded as the period line.
    assert "01 Apr 2026 – 30 Jun 2026" in html

    # The narrow variant: NO GSTIN/PAN line, NO address block (owner's ruling
    # 17 Aug 2026 — a working document, not a tax document). The captured HTML
    # is the whole document, whose STYLESHEET always defines .lh__ids/.lh__legal
    # rules — so the assertion targets the markup, not the class name.
    assert '<div class="lh__ids">' not in html
    assert '<div class="lh__legal">' not in html
    assert "GSTIN" not in html.split("</style>")[1]

    # The colophon.
    assert "Prepared in Kartavya" in html
    assert "Generated " in html

    # The anonymous shape is gone: no bare <h1>, and the data goes through the
    # branded .lines table, not the unstyled one.
    assert "<h1>" not in html
    assert 'class="lines"' in html

    # The data itself made it: csv_cell turns Decimal('311671.60') into a float.
    assert "311671.6" in html

    # Continuation pages carry the running identity: kind · org · period.
    assert "Revenue report  ·  Suryodaya Textiles Pvt. Ltd.  ·  01 Apr 2026 – 30 Jun 2026" in html


@pytest.mark.parametrize("report_type", ["pipeline", "hr"])
def test_pdf_stock_reports_say_as_at_even_when_dates_were_sent(doubles, report_type):
    """pipeline and hr take no window in _fetch_report_data — the letterhead
    must not imply a period was applied where none was."""
    resp = export(report_type, format="pdf", date_from=FROM, date_to=TO)
    html = doubles.html

    assert f"As at {date.today().strftime('%d %b %Y')}" in html
    # The supplied-but-unapplied window must appear nowhere on the document.
    assert "01 Apr 2026" not in html
    assert "30 Jun 2026" not in html

    # And the filename says as-at, never the ignored range.
    assert filename(resp) == (
        f'attachment; filename="suryodaya-textiles-pvt-ltd_{report_type}'
        f'_as-at-{date.today().isoformat()}.pdf"'
    )


def test_pdf_stock_scalars_render_in_the_summary_table(doubles):
    export("hr", format="pdf")
    assert "active_employees" in doubles.html
    assert "42" in doubles.html


def test_pdf_windowed_report_without_a_window_says_all_time(doubles):
    resp = export("revenue", format="pdf")
    assert "All time" in doubles.html
    assert filename(resp) == (
        'attachment; filename="suryodaya-textiles-pvt-ltd_revenue_all-time.pdf"'
    )


def test_pdf_windowed_filename_carries_slug_type_and_range(doubles):
    resp = export("revenue", format="pdf", date_from=FROM, date_to=TO)
    assert filename(resp) == (
        'attachment; filename="suryodaya-textiles-pvt-ltd_revenue'
        '_2026-04-01_2026-06-30.pdf"'
    )


def test_pdf_letterhead_falls_back_honestly_on_an_unnamed_org(doubles):
    doubles.org = {"name": ""}
    resp = export("revenue", format="pdf", date_from=FROM, date_to=TO)
    # Filename: the 'org' fallback, never a leading underscore.
    assert filename(resp).startswith('attachment; filename="org_revenue_')
    # Letterhead: doc_render's quiet em-dash (unset), never an invented name.
    assert '<div class="lh__name">&mdash;</div>' in doubles.html


# ── xlsx: the identity header ────────────────────────────────────────────────

def _workbook(resp):
    openpyxl = pytest.importorskip("openpyxl")
    return openpyxl.load_workbook(io.BytesIO(resp.body))


def test_xlsx_carries_the_identity_header(doubles):
    resp = export("revenue", format="xlsx", date_from=FROM, date_to=TO)
    wb = _workbook(resp)
    ws = wb["Summary"]

    assert ws["A1"].value == "Suryodaya Textiles Pvt. Ltd."
    assert ws["A1"].font.bold
    assert ws["A2"].value == "Revenue report"
    assert ws["A3"].value == "01 Apr 2026 – 30 Jun 2026"

    # A real instant with a timezone, not date.today().
    a4 = ws["A4"].value
    assert a4.startswith("Generated ")
    stamp = datetime.fromisoformat(a4.removeprefix("Generated "))
    assert stamp.tzinfo is not None

    # The blank separator row, then the content exactly as before.
    assert ws["A5"].value is None
    assert ws["A6"].value == "No summary values for this report."
    assert wb.sheetnames == ["Summary", "monthly"]
    assert [c.value for c in wb["monthly"][1]] == ["month", "total", "count"]
    assert wb["monthly"][2][1].value == 311671.6

    assert filename(resp) == (
        'attachment; filename="suryodaya-textiles-pvt-ltd_revenue'
        '_2026-04-01_2026-06-30.xlsx"'
    )


def test_xlsx_stock_period_is_as_at_and_scalars_follow_the_blank_row(doubles):
    resp = export("hr", format="xlsx", date_from=FROM, date_to=TO)
    ws = _workbook(resp)["Summary"]

    assert ws["A3"].value == f"As at {date.today().strftime('%d %b %Y')}"
    assert ws["A5"].value is None
    assert ws["A6"].value == "active_employees"
    assert ws["B6"].value == 42
    assert "_hr_as-at-" in filename(resp)


# ── csv: no banner row, identity in the filename only ────────────────────────

def test_csv_has_no_banner_row(doubles):
    resp, text = export_csv_text("revenue", format="csv", date_from=FROM, date_to=TO)

    # First line is the section title, second the header — exactly the shape
    # the CSV branch has always written. No org name anywhere in the body.
    lines = text.splitlines()
    assert lines[0] == "monthly"
    assert lines[1] == "month,total,count"
    assert "Suryodaya" not in text

    # The identity rides in the filename instead.
    assert filename(resp) == (
        "attachment; filename=suryodaya-textiles-pvt-ltd_revenue"
        "_2026-04-01_2026-06-30.csv"
    )


def test_csv_stock_filename_says_as_at(doubles):
    resp, text = export_csv_text("hr", format="csv", date_from=FROM, date_to=TO)
    assert "Suryodaya" not in text
    assert filename(resp) == (
        f"attachment; filename=suryodaya-textiles-pvt-ltd_hr"
        f"_as-at-{date.today().isoformat()}.csv"
    )


# ── json: the fall-through is untouched ──────────────────────────────────────

def test_json_fall_through_neither_loads_the_org_nor_changes_shape(doubles):
    out = export("revenue", format="json", date_from=FROM, date_to=TO)
    assert out["format"] == "json"
    assert out["data"] == CANNED["revenue"]
    assert out["window"]["from"] == FROM and out["window"]["to"] == TO
    # No file, no filename, no reason to have fetched the org at all.
    assert doubles.load_org_calls == 0
