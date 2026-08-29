"""The Sahayak content list: it must be sortable, pageable, and refuse the rest.

The list was `ORDER BY created_at DESC LIMIT 100` with no offset. Two consequences
the owner reported as one complaint ("very messy... it becoming every scrooling"):
an org with more than a hundred generated items could not reach the rest at all,
and the hundred it could reach arrived as one unbroken column of full post bodies.

These tests fail on that version. `test_the_list_is_not_a_fixed_hundred` is the
one that pins the actual bug; the rest guard the ways a sortable list goes wrong
after someone adds sorting — an unbound ORDER BY, nulls sorting to the front, and
a non-total order that shows one row on two pages and another on none.
"""
import inspect
import re

import pytest
from fastapi import HTTPException

from routers.hub import CONTENT_SORTS, _content_order, list_org_content


def _body(fn) -> str:
    """Source with the docstring removed.

    This file's own docstrings quote the bug — `ORDER BY created_at DESC LIMIT
    100` appears in `list_org_content`'s docstring to explain what changed. A
    test that parsed it would assert against its own prose and pass on the code
    it is meant to reject. Same helper, same reason, as test_prachar_audience.
    """
    src = inspect.getsource(fn)
    doc = inspect.getdoc(fn)
    if doc:
        for quote in ('"""', "'''"):
            start = src.find(quote)
            if start != -1:
                end = src.find(quote, start + 3)
                if end != -1:
                    return src[:start] + src[end + 3:]
    return src


# ── The bug itself ───────────────────────────────────────────────────────────

def test_the_list_is_not_a_fixed_hundred():
    """No literal LIMIT in the SQL, and a real offset parameter."""
    body = _body(list_org_content)
    assert not re.search(r"LIMIT\s+\d", body, re.I), (
        "the page size is written into the query as a literal again — it has to "
        "be a bound parameter or the list cannot be paged"
    )
    assert "OFFSET" in body.upper(), "no OFFSET, so there is no page two"

    params = inspect.signature(list_org_content).parameters
    for name in ("limit", "offset", "sort", "order"):
        assert name in params, f"/org/content takes no `{name}`"


def _bounds(query_default) -> tuple[float | None, float | None]:
    """(ge, le) off a fastapi.Query, whichever way this version stores them.

    Pydantic v1 hung `ge`/`le` on the Query object; v2 keeps them in
    `metadata` as annotated_types.Ge/Le. Reading only one shape makes the test
    pass vacuously on the other — `getattr(q, 'le', None)` is None on v2, which
    would have asserted nothing while looking thorough.
    """
    ge = getattr(query_default, "ge", None)
    le = getattr(query_default, "le", None)
    for m in getattr(query_default, "metadata", None) or []:
        ge = getattr(m, "ge", None) if getattr(m, "ge", None) is not None else ge
        le = getattr(m, "le", None) if getattr(m, "le", None) is not None else le
    return ge, le


def test_the_page_size_is_bounded():
    """`limit` is capped, so one caller cannot ask for the whole library."""
    ge, le = _bounds(inspect.signature(list_org_content).parameters["limit"].default)
    assert le is not None, "limit has no upper bound"
    assert le <= 100, f"limit may be as large as {le}"
    assert ge is not None and ge >= 1, "limit may be zero or negative"

    off_ge, _ = _bounds(inspect.signature(list_org_content).parameters["offset"].default)
    assert off_ge is not None and off_ge >= 0, "offset may be negative"


# ── ORDER BY, which is the part that is interpolated ─────────────────────────

def test_an_unknown_sort_is_refused_not_interpolated():
    with pytest.raises(HTTPException) as exc:
        _content_order("created_at; DROP TABLE public.hub_content_items", "desc")
    assert exc.value.status_code == 400
    # The refusal names the valid keys, so the caller can fix it without reading
    # the source.
    assert "created_at" in exc.value.detail


@pytest.mark.parametrize("key", sorted(CONTENT_SORTS))
def test_every_offered_sort_produces_sql(key):
    clause = _content_order(key, "asc")
    assert clause.strip().startswith("ORDER BY")
    assert CONTENT_SORTS[key] in clause


def test_the_sort_whitelist_holds_no_user_string():
    """The value the caller sends must never reach the SQL.

    `_content_order` looks its argument up in a dict and uses the VALUE. If a
    later edit ever formats the caller's string into the clause instead, this
    catches it: a key that is not in the map cannot appear in the output.
    """
    for hostile in ("title--", "1; SELECT 1", "created_at DESC, password"):
        with pytest.raises(HTTPException):
            _content_order(hostile, "desc")


def test_nulls_sort_last_in_both_directions():
    """`platform` and `credits_used` are null on many rows.

    Postgres puts nulls FIRST on DESC. Without NULLS LAST, "highest credits
    first" opens on a page of blanks — which reads as the sort being broken.
    """
    for order in ("asc", "desc"):
        assert "NULLS LAST" in _content_order("credits_used", order)
        assert "NULLS LAST" in _content_order("platform", order)


def test_the_order_is_total_so_pages_cannot_repeat_a_row():
    """Every sort ends in a unique column.

    Two rows equal on `status` can swap between page 1 and page 2 of the same
    result set if the order is not total — one row appears twice, another never
    appears. `id` last makes that impossible.
    """
    for key in CONTENT_SORTS:
        clause = _content_order(key, "desc")
        assert clause.rstrip().endswith("id"), (
            f"sorting by {key} has no unique tiebreak, so paging can repeat or "
            f"skip rows: {clause}"
        )


def test_direction_defaults_to_newest_first():
    assert "DESC" in _content_order(None, None)
    assert " ASC" in _content_order("title", "asc")
    # Anything that is not "asc" means descending — a stray value must not
    # silently flip the list.
    assert "DESC" in _content_order("title", "sideways")


# ── The counts behind the filter chips ───────────────────────────────────────

def test_facets_are_counted_over_the_org_not_the_page():
    """The chip counts must not be computed from the rows on screen.

    They were `all.filter(...).length` in the component. Once the list pages,
    that is the size of the current page, so every chip reads the same number on
    every page. The endpoint counts the whole library instead.
    """
    from routers.hub import org_content_facets

    body = _body(org_content_facets)
    assert "GROUP BY" in body.upper()
    assert "LIMIT" not in body.upper(), "the facet counts are themselves paged"
    for facet in ("agent_type", "status", "platform"):
        assert facet in body
