"""report_render.py — the format-negotiation helpers, out of the router.

Three of these lived inside `routers/dristi.py` (`_is_row_list` and `_csv_cell`
at module level, `_table_html` as a closure inside `export_report`), which made
them unreachable from anywhere else — and phase D2 of proposal 62 puts a second
caller beside them: `GET /api/v1/analytics/run` serves json/csv/xlsx/pdf off
one URL, exactly the negotiation `GET /dristi/exports/{report_type}` already
does. Lifting is the whole change: every function here must produce the SAME
BYTES the router's originals produced, because dristi's export output is an
existing contract ("a retrofit that quietly changes what an existing caller
receives is not a retrofit" — test_dristi_window_wiring.py's own rule, held by
test_report_render.py).
"""


def is_row_list(v) -> bool:
    """True for a list of dicts — the one shape that needs its own table."""
    return isinstance(v, list) and bool(v) and all(isinstance(r, dict) for r in v)


def csv_cell(v):
    """A spreadsheet-safe scalar.

    asyncpg hands back `Decimal` and timezone-aware `datetime`, and csv falls
    back to `str()` for both. `str(Decimal('311671.60'))` is harmless, but the
    same fallback on a nested structure produced Python source in a cell, and
    `datetime.datetime(2026, 7, 1, 0, 0, tzinfo=...)` is not a date any
    spreadsheet will parse. Numbers go out as numbers and instants as ISO-8601,
    which Excel and Google Sheets both read.
    """
    from datetime import date, datetime
    from decimal import Decimal

    if v is None:
        return ""
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (dict, list, tuple, set)):
        # Should be unreachable for a row value now that tables are split out,
        # but a nested blob must never silently become Python source again.
        import json
        return json.dumps(v, default=str)
    return v


def table_html(name, rows) -> str:
    """One titled `<table>` for the anonymous-PDF path.

    Byte-identical to the closure `export_report` used to define inline —
    the closure closed over nothing but `escape` and `_csv_cell`, so lifting
    it changed no behaviour, and the byte-equality test pins that.
    """
    from html import escape

    headers = list(rows[0].keys())
    head = "".join(f"<th>{escape(str(h))}</th>" for h in headers)
    body = "".join(
        "<tr>" + "".join(f"<td>{escape(str(csv_cell(r.get(h))))}</td>"
                         for h in headers) + "</tr>"
        for r in rows
    )
    return (f"<h2>{escape(str(name))}</h2>"
            f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>")


def analytics_letterhead(org: dict, title_en: str, title_hi: str, period_line: str = "") -> str:
    """The branded header for an analytics document — the NARROW letterhead.

    Owner's ruling, 17 August 2026: an analytics export carries the org's name
    and logo, the report title, the exact window and the generation timestamp —
    and NO GSTIN, NO address, NO phone. It is a working document the firm may
    hand to its client, not a tax document, and a GSTIN on it invites the
    reader to treat it as one. Hence `show_address=False, show_ids=False`
    rather than a doctored org dict, which would print red "not set" markers
    on a document that intentionally omits those blocks.
    """
    from services import doc_render as R

    return R.letterhead(
        org, kind_en=title_en, kind_hi=title_hi,
        doc_no=period_line,
        show_address=False, show_ids=False, show_contacts=False,
    )


def org_slug(name) -> str:
    """The org's identity as a filename component (D3b).

    A CSV export must not carry a banner row — the comment in dristi's CSV
    branch is right, a comment line above the header breaks the first parser
    it meets — so the ONLY place a CSV's org identity can ride is the
    filename. Lowercased, every run of non-alphanumerics collapsed to one
    hyphen, and 'org' when nothing survives: a file named `_revenue_…` with a
    leading underscore would look like an identity was there and fell off.
    """
    import re

    slug = re.sub(r"[^a-z0-9]+", "-", str(name or "").lower()).strip("-")
    return slug or "org"


def _is_num(v) -> bool:
    """Numeric for alignment purposes — bools are labels, not figures."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def summary_table(scalars) -> str:
    """The scalar block of a report as one branded two-column `.lines` table.

    The anonymous PDF drew these as a bare `.kv` table; the branded page (D3b)
    uses the same `doc_render.table` every statutory document uses, with the
    numeric values right-aligned the way analytics.py's pdf branch aligns its
    columns.
    """
    from services import doc_render as R

    rows = [
        "<tr>"
        f"<td>{R.esc(str(k))}</td>"
        f'<td class="{"num" if _is_num(csv_cell(v)) else ""}">'
        f"{R.esc(str(csv_cell(v)))}</td>"
        "</tr>"
        for k, v in scalars
    ]
    return R.table([("Metric", "", "38%"), ("Value", "num", "")], rows)


def pdf_table(name, rows) -> str:
    """One titled `.lines` table for the BRANDED report page (D3b).

    `table_html` above is the ANONYMOUS document's bare `<table>` and is
    byte-pinned by tests/test_report_render.py — it stays exactly as it is.
    This is its branded sibling: the per-column numeric detection and
    `doc_render.table` shape that `routers/analytics.py`'s pdf branch
    established, plus a `.block` label so several named tables stay readable
    in one document. `rows` must be non-empty (the callers split shapes with
    `is_row_list`, which rejects `[]`).
    """
    from services import doc_render as R

    headers = list(rows[0].keys())
    body = [
        "<tr>" + "".join(
            f'<td class="{"num" if _is_num(csv_cell(r.get(h))) else ""}">'
            f"{R.esc(str(csv_cell(r.get(h))))}</td>"
            for h in headers
        ) + "</tr>"
        for r in rows
    ]
    tbl = R.table(
        [(h, "num" if _is_num(csv_cell(rows[0].get(h))) else "", "")
         for h in headers],
        body,
    )
    return R.block(str(name), tbl)
