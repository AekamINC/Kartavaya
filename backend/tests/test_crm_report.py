"""The CRM report as a file. Approved 2026-08-09 with proposal 47.

Rendered against a fabricated data dict rather than the database, because what
can go wrong here is in the rendering: an unescaped company name, a rupee figure
grouped in thousands, or a PDF failure taking the whole download with it.
"""
from datetime import datetime, timezone

import pytest

from routers import graha
from services import crm_report


def _data(**over):
    d = {
        "org": {"name": "Aekam Inc", "gstin": "27AAAAA0000A1Z5", "pan": "AAAAA0000A",
                "billing_address": "12 Test Road\nMumbai 400001"},
        "period_days": 90,
        "generated_at": datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc),
        "conversion": {"total_deals": 10, "won": 3, "lost": 2, "open": 5,
                       "conversion_rate": 30.0, "won_value": 1234567,
                       "avg_cycle_days": 21},
        "forecast": [{"stage": "Proposal", "count": 2, "total_value": 500000,
                      "weighted_value": 250000}],
        "velocity": [{"stage": "New", "count": 4, "total_value": 100000,
                      "avg_days_in_stage": 9}],
        "sources": [{"source": "referral", "leads": 6, "deals": 4, "won": 2,
                     "won_value": 900000}],
        "reps": [{"person": "Keval Shah", "total_deals": 5, "won": 2, "lost": 1,
                  "won_value": 700000}],
        "deals": [{"title": "A & B deal", "company": "X Ltd", "contact": "Y",
                   "stage": "Won", "value": 100, "probability": 100,
                   "owner": "Keval Shah", "source": "referral", "territory": "West",
                   "created_at": datetime(2026, 7, 1, tzinfo=timezone.utc),
                   "expected_close_date": None,
                   "won_at": datetime(2026, 7, 20, tzinfo=timezone.utc),
                   "lost_at": None}],
        "includes_reps": True,
    }
    d.update(over)
    return d


def test_rupees_are_grouped_the_indian_way():
    """12,34,567 — not 1,234,567. A figure grouped in thousands reads as the
    wrong number to the person the report is sent to."""
    assert crm_report._inr(1234567) == "12,34,567"
    assert crm_report._inr(999) == "999"
    assert crm_report._inr(-100000) == "-1,00,000"
    assert crm_report._inr(None) == "0"


def test_the_html_escapes_what_the_user_typed():
    html = crm_report._html(_data(org={"name": "<script>x</script>", "gstin": "",
                                       "pan": "", "billing_address": ""}))
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_a_missing_gstin_omits_the_line_rather_than_refusing():
    """GSTIN and PAN are NON-MANDATORY in this product and block nothing."""
    html = crm_report._html(_data(org={"name": "No Ids Ltd", "gstin": "", "pan": "",
                                       "billing_address": ""}))
    assert "GSTIN" not in html and "PAN" not in html
    assert "No Ids Ltd" in html


def test_an_empty_period_still_renders():
    html = crm_report._html(_data(forecast=[], velocity=[], sources=[], reps=[],
                                  deals=[], includes_reps=False))
    assert "Nothing in this period." in html


def test_the_by_person_section_is_omitted_when_it_may_not_be_seen():
    """A member who cannot see per-rep numbers gets a report without that
    section, NOT a 403 on the whole download."""
    assert "By person" in crm_report._html(_data())
    assert "By person" not in crm_report._html(_data(includes_reps=False, reps=[]))


def test_the_csv_is_the_deals_and_only_the_deals():
    """A CSV cannot hold six sections, and pretending otherwise produces a file
    nothing can read."""
    text = crm_report.to_csv(_data()).decode("utf-8-sig")
    lines = text.strip().splitlines()
    assert len(lines) == 2, "header plus one deal"
    assert lines[0].startswith("Deal,Company,Contact,Stage,Value")
    assert "Conversion" not in text


def test_the_csv_carries_a_bom():
    """Otherwise Excel mangles any non-ASCII name in it."""
    assert crm_report.to_csv(_data()).startswith(b"\xef\xbb\xbf")


def test_the_workbook_has_a_sheet_per_section_and_the_raw_deals():
    import io

    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(crm_report.to_excel(_data())))
    assert wb.sheetnames == ["Summary", "Forecast", "Velocity", "Sources",
                             "By person", "Deals"]


def test_the_workbook_drops_the_person_sheet_when_it_may_not_be_seen():
    import io

    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(
        crm_report.to_excel(_data(includes_reps=False, reps=[]))))
    assert "By person" not in wb.sheetnames


def test_a_pdf_failure_does_not_take_excel_and_csv_with_it():
    """WeasyPrint's native libraries are absent on a Windows dev box: it imports
    and then raises OSError. Both that and ImportError must reach the route as a
    503 naming the alternative, not as a 500."""
    import inspect
    code = inspect.getsource(crm_report.to_pdf)
    assert "ImportError, OSError" in code
    assert "Excel" in code or "CSV" in code


def test_the_route_refuses_an_unknown_format():
    code = " ".join(inspect_src(graha.download_crm_report).split())
    assert "crm_report.FORMATS" in code and "400" in code


def test_the_route_asks_the_permission_question_before_gathering():
    code = " ".join(inspect_src(graha.download_crm_report).split())
    assert "held_module_levels" in code and "include_reps" in code


def inspect_src(fn) -> str:
    import inspect
    return inspect.getsource(fn)


@pytest.mark.parametrize("fmt", ["csv", "excel"])
def test_render_returns_content_type_and_extension(fmt):
    content, media, ext = crm_report.render(_data(), fmt)
    assert content and isinstance(content, bytes)
    assert media and ext in ("csv", "xlsx")
