"""The lift out of routers/dristi.py changed no bytes.

`_is_row_list` / `_csv_cell` / the `_table_html` closure moved to
services/report_render.py so /api/v1/analytics/run can share them. Dristi's
export output is an existing contract; the byte-identity assertions here are
what makes the lift a lift and not a quiet rewrite.
"""
from datetime import date, datetime, timezone
from decimal import Decimal

from routers import dristi
from services.report_render import analytics_letterhead, csv_cell, is_row_list, table_html


def test_dristi_aliases_are_the_service_functions():
    assert dristi._csv_cell is csv_cell
    assert dristi._is_row_list is is_row_list


def test_csv_cell_contract_unchanged():
    assert csv_cell(None) == ""
    assert csv_cell(Decimal("311671.60")) == 311671.60
    assert isinstance(csv_cell(Decimal("1")), float)
    assert csv_cell(date(2026, 7, 1)) == "2026-07-01"
    assert csv_cell(datetime(2026, 7, 1, tzinfo=timezone.utc)) == "2026-07-01T00:00:00+00:00"
    assert csv_cell({"a": 1}) == '{"a": 1}'
    assert csv_cell("plain") == "plain"
    assert csv_cell(7) == 7


def test_is_row_list_contract_unchanged():
    assert is_row_list([{"a": 1}])
    assert not is_row_list([])
    assert not is_row_list([{"a": 1}, "x"])
    assert not is_row_list({"a": 1})


def test_table_html_bytes_match_the_old_closure():
    """The expected string below is the OLD closure's literal output for these
    rows, captured before the lift. If this fails, dristi's PDF changed."""
    rows = [
        {"month": "2026-04", "value": Decimal("12.50"), "n": None},
        {"month": "<b>", "value": 3, "n": "a&b"},
    ]
    expected = (
        "<h2>Revenue</h2>"
        "<table><thead><tr><th>month</th><th>value</th><th>n</th></tr></thead>"
        "<tbody>"
        "<tr><td>2026-04</td><td>12.5</td><td></td></tr>"
        "<tr><td>&lt;b&gt;</td><td>3</td><td>a&amp;b</td></tr>"
        "</tbody></table>"
    )
    assert table_html("Revenue", rows) == expected


def test_analytics_letterhead_is_the_narrow_variant():
    """Owner's ruling 17 Aug 2026: name+logo+title+window, NO GSTIN, NO
    address, NO phone — and no red 'not set' markers standing in for the
    blocks that are deliberately absent."""
    org = {"name": "Suryodaya Textiles"}  # no address, no GSTIN on purpose
    html = analytics_letterhead(org, "Receivables ageing", "", "01 Apr – 30 Jun 2026")
    assert "Suryodaya Textiles" in html
    assert "Receivables ageing" in html
    assert "01 Apr – 30 Jun 2026" in html
    assert "lh__legal" not in html      # no address block at all
    assert "lh__ids" not in html        # no GSTIN/PAN line at all
    assert "&mdash;" not in html        # and no em-dash gap standing in


def test_default_letterhead_is_untouched():
    """All nine statutory callers keep their exact behaviour — missing values
    still MARK, never vanish."""
    from services.doc_render import letterhead

    html = letterhead({"name": "Suryodaya Textiles"}, "Tax Invoice", "कर बीजक")
    assert "lh__legal" in html
    assert "GSTIN" in html and "PAN" in html
    # The gap rule, unchanged since the owner's 2026-08-03 ruling: an absent
    # value renders a quiet em-dash (`unset()` returns "&mdash;"), never
    # vanishes — so the ids line still SHOWS a gap where the GSTIN would be.
    assert "GSTIN <b>&mdash;</b>" in html
