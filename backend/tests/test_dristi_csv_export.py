"""
CSV shape for the Dristi report exports.

The defect these guard against was found live on staging: `revenue_export.csv`
contained a single cell holding `[{'month': datetime.datetime(2026, 7, 1, 0, 0,
tzinfo=...), 'total': Decimal('311671.60'), 'count': 6}]` — Python's repr of a
list of rows, written by `csv.writer.writerow([k, v])` falling back to `str()`.
`pipeline` and `sales` had the same shape. It opened as one unusable cell.

These test the serialisation helpers directly rather than the route, so they
stay true regardless of what the report queries return.
"""
from datetime import datetime, timezone
from decimal import Decimal

from routers.dristi import _csv_cell, _is_row_list


# ── _is_row_list — what deserves its own table ────────────────────────────────

def test_list_of_dicts_is_a_row_list():
    assert _is_row_list([{"a": 1}, {"a": 2}])


def test_scalars_and_empties_are_not_row_lists():
    for v in (1, "x", None, [], [1, 2, 3], {"a": 1}, [{"a": 1}, "not a dict"]):
        assert not _is_row_list(v), f"{v!r} must not be treated as a table"


# ── _csv_cell — no Python source in a spreadsheet ─────────────────────────────

def test_decimal_becomes_a_number():
    """`Decimal('311671.60')` must not reach the cell as `Decimal(...)`."""
    out = _csv_cell(Decimal("311671.60"))
    assert out == 311671.60
    assert "Decimal" not in str(out)


def test_datetime_becomes_iso8601():
    """Excel cannot parse `datetime.datetime(2026, 7, 1, 0, 0, tzinfo=...)`."""
    out = _csv_cell(datetime(2026, 7, 1, tzinfo=timezone.utc))
    assert out == "2026-07-01T00:00:00+00:00"
    assert "datetime" not in out


def test_none_becomes_empty_not_the_word_none():
    assert _csv_cell(None) == ""


def test_nested_structure_becomes_json_not_repr():
    """The unreachable path still must not emit Python source."""
    out = _csv_cell([{"month": datetime(2026, 7, 1, tzinfo=timezone.utc),
                      "total": Decimal("311671.60")}])
    assert "Decimal(" not in out
    assert "datetime.datetime(" not in out
    assert out.startswith("[")


def test_plain_values_pass_through_unchanged():
    for v in (0, 6, -1, "confirmed", 3.5, True):
        assert _csv_cell(v) == v
