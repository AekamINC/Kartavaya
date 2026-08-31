"""A metric export must be a readable file, and must not execute in Excel.

── FINDING 1: SEVEN BYTES, SUITE 12.10 ON 2026-08-31 ──────────────────────

    Error: metric-0-csv downloaded as an EMPTY file
           — §1's "a 200 with an empty body" is exactly this
    Expected: > 20      Received: 7

`GET /v1/analytics/run?format=csv` built its header from the first row and
fell back to `["value"]` when there were none, so a metric with no data
downloaded as the single line `value\\r\\n`. Seven bytes.

The fix is not a bigger floor in the test. A person who clicks "Download
<metric> as CSV" and opens the file has to be able to tell **"this metric has
no data in this window"** from **"the export is broken"** — and the file
carried neither the metric's name nor the window, even when it DID have rows.
So it now opens with what it is, the way the client report two hundred lines
below already did:

    Metric,Pipeline value by stage
    Key,graha.pipeline_by_stage
    Period,as at 2026-08-31
    Rows,0

    value

── FINDING 2: THE INJECTION HOLE SOMEBODY WROTE DOWN AND LEFT OPEN ────────

The same branch used bare `csv_cell` where every other export in the product
uses the formula guard. `routers/pulse.py` says so, in a comment, beside its
own guarded copy:

    "_fcell (the formula guard) on every cell, WHERE THE TENANT /run USES
     BARE csv_cell: org NAMES are tenant-typed text, and a customer named
     `=HYPERLINK(...)` must open in Excel as text on Aekam's desks too."

Aekam's desks were protected and the customer's were not. It is reachable with
ordinary data, not a contrived payload: metric labels are per-org text.
`graha.pipeline_by_stage` GROUPs BY `d.stage`, which a customer renames;
`graha.client_concentration` groups by client name, which arrives off a lead
form. `openpyxl` writes an `=`-leading string as a live formula cell too, so
xlsx needed the same guard and did not have it either.

── WHAT THESE TESTS DRIVE ──────────────────────────────────────────────────

The real route, through `ax.run`, with the registry's real metrics — the
bytes a browser would receive. A test that called a helper would not have
caught either defect, because both live in the branch between the helper and
the Response.

MUTATION-PROVED 2026-08-31: restoring `headers = … else ["value"]` with no
preamble turns 4 red; putting `csv_cell` back in either branch turns the
injection tests red.
"""
import asyncio
import csv
import io

import pytest

from routers import analytics as ax
from analytics.registry import REGISTRY, load_all

import analytics.metrics.graha  # noqa: F401  (registers the graha batch)

load_all()

ORG = "00000000-0000-0000-0000-0000000000aa"
USER = {"user_id": "user_admin001"}

#: A stock metric, so no window is required and the route needs no date range.
STOCK = "graha.pipeline_by_stage"


class Rows:
    """A pool that answers the metric query with exactly `rows`."""

    def __init__(self, rows):
        self.rows = rows

    async def fetch(self, sql, *a):
        return self.rows

    async def fetchrow(self, sql, *a):
        return None

    async def fetchval(self, sql, *a):
        return 0

    async def execute(self, sql, *a):
        return "SELECT 0"


class FakeRequest:
    class _State:
        _auth_user = {"user_id": "u-1"}
    state = _State()
    method = "GET"


def export(rows, fmt="csv", metric=STOCK, monkeypatch=None):
    """The bytes the route returns, with both gates satisfied."""
    pool = Rows(rows)

    async def _get_pool():
        return pool

    def _require_module(code):
        async def _check(request, org_id):
            return None
        return _check

    orig_pool, orig_req = ax.get_pool, ax.require_module
    ax.get_pool, ax.require_module = _get_pool, _require_module
    try:
        resp = asyncio.run(ax.run(
            request=FakeRequest(), metric=metric, date_from="", date_to="",
            bucket="month", group_by="", compare="", format=fmt,
            user=USER, org_id=ORG))
    finally:
        ax.get_pool, ax.require_module = orig_pool, orig_req
    body = resp.body
    return body if isinstance(body, bytes) else bytes(body)


def as_csv(raw):
    return list(csv.reader(io.StringIO(raw.decode("utf-8"))))


# ── the seven-byte file ─────────────────────────────────────────────────────

def test_a_metric_with_no_rows_is_not_a_seven_byte_file():
    """THE DEFECT. RED before the preamble: exactly 7 bytes, `value\\r\\n`."""
    raw = export([])
    assert len(raw) > 20, (
        f"an empty metric exports as {len(raw)} bytes — indistinguishable from "
        "a broken download")


def test_an_empty_export_says_WHICH_metric_and_WHEN():
    """"0 rows" alone is not legible. The metric and the period are what make
    an empty answer a fact about the question rather than a failure."""
    rows = as_csv(export([]))
    flat = {r[0]: r[1] for r in rows if len(r) == 2}
    assert flat.get("Key") == STOCK
    assert flat.get("Metric") == REGISTRY[STOCK].label
    assert "as at" in flat.get("Period", ""), flat
    assert flat.get("Rows") == "0"


def test_a_metric_WITH_rows_identifies_itself_too():
    """The file was anonymous whether or not it had data — a folder of these
    is a folder of unlabelled numbers. The preamble is not an empty-case
    special case."""
    rows = as_csv(export([{"label": "New", "value": 100.0, "deals": 2}]))
    flat = {r[0]: r[1] for r in rows if len(r) == 2 and r[0] in
            ("Metric", "Key", "Period", "Rows")}
    assert flat["Key"] == STOCK
    assert flat["Rows"] == "1"


def test_the_data_is_still_there_and_still_first_after_the_blank_line():
    """The preamble must not have eaten the table. A spreadsheet reads the row
    after the blank line as the header, which is why there is a blank line."""
    rows = as_csv(export([{"label": "New", "value": 100.0, "deals": 2},
                          {"label": "Won", "value": 50.0, "deals": 1}]))
    blank = next(i for i, r in enumerate(rows) if not r)
    header = rows[blank + 1]
    assert header == ["label", "value", "deals"]
    assert rows[blank + 2] == ["New", "100.0", "2"]
    assert rows[blank + 3] == ["Won", "50.0", "1"]


# ── the injection hole ──────────────────────────────────────────────────────

@pytest.mark.parametrize("payload", [
    '=HYPERLINK("http://evil.example","click")',
    '+1+1',
    '-2+3',
    '@SUM(A1:A9)',
])
def test_a_formula_in_a_LABEL_is_neutralised(payload):
    """Reachable with ordinary data: `graha.pipeline_by_stage` groups by
    `d.stage`, which the customer types, and `client_concentration` by a client
    name off a lead form. RED with `csv_cell`: the cell goes out live."""
    rows = as_csv(export([{"label": payload, "value": 1.0, "deals": 1}]))
    cells = [c for r in rows for c in r]
    assert payload not in cells, (
        f"{payload!r} reaches the file unguarded and executes in Excel")
    assert "'" + payload in cells, (
        "the guard must PREFIX the value, not drop or mangle it — the label is "
        "still what the customer named their stage")


def test_numbers_are_still_numbers():
    """The guard applies to strings only. Quoting a number would turn every
    figure in every export into text a spreadsheet cannot sum — a fix worse
    than the defect."""
    rows = as_csv(export([{"label": "New", "value": 1234.5, "deals": 7}]))
    blank = next(i for i, r in enumerate(rows) if not r)
    assert rows[blank + 2] == ["New", "1234.5", "7"]


def test_the_preamble_is_guarded_too():
    """`Metric` is the registry's own label so it is safe today — but the
    guard belongs on every cell written, not on the ones currently thought
    dangerous. That reasoning is what left this branch unguarded."""
    src = ax.run.__doc__ or ""
    import inspect
    body = inspect.getsource(ax.run)
    csv_branch = body.split('if format == "csv":', 1)[1].split("if format ==", 1)[0]
    assert "csv_cell(" not in csv_branch, (
        "the csv branch still writes a cell through bare csv_cell")
    assert "_fcell(" in csv_branch


def test_the_xlsx_branch_is_guarded_as_well():
    """openpyxl writes an `=`-leading string as a live FORMULA cell, so xlsx is
    exactly as injectable as csv and was exactly as unguarded."""
    import inspect
    body = inspect.getsource(ax.run)
    xlsx = body.split('if format == "xlsx":', 1)[1].split("# pdf", 1)[0]
    assert "csv_cell(" not in xlsx, "the xlsx branch still uses bare csv_cell"
    assert "_fcell(" in xlsx
