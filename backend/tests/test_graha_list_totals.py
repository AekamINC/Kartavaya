"""
A capped list says how much it is not showing (F4 (b)).

Measured on staging: the Graha pipeline screen reported "199 deals have no next
step" against a true 510. The list endpoint capped at 200 and returned only the
rows, so the client computed its total from a truncated set and presented the
result as fact. Every hardcoded LIMIT in the codebase has that shape.

`_listed` is tested directly rather than through the route: it is the contract —
what the response carries and what it hides — and that is what callers depend on.
"""
from routers.graha import _listed


def _rows(n, total):
    """Mimic asyncpg rows carrying the COUNT(*) OVER() column."""
    return [{"id": f"d{i}", "title": f"Deal {i}", "_total": total} for i in range(n)]


def test_reports_the_true_total_not_the_page_size():
    out = _listed(_rows(200, 510), limit=200)
    assert out["total"] == 510
    assert len(out["data"]) == 200
    assert out["truncated"] is True


def test_not_truncated_when_everything_fits():
    out = _listed(_rows(12, 12), limit=200)
    assert out["total"] == 12
    assert out["truncated"] is False


def test_empty_list_is_zero_and_not_truncated():
    out = _listed([], limit=200)
    assert out == {"data": [], "total": 0, "limit": 200, "truncated": False}


def test_total_is_stripped_from_every_row():
    """`_total` is metadata about the response, not a field of a deal.

    Leaking it would put an underscore-prefixed key into every record the
    frontend maps over, and the first component to render `Object.entries(deal)`
    would show it to a user.
    """
    out = _listed(_rows(5, 99), limit=200)
    assert all("_total" not in r for r in out["data"]), "no row may carry _total"


def test_data_key_is_preserved_so_existing_callers_keep_working():
    """Graha lists already returned {"data": [...]}; total is additive.

    A caller reading `.data` must be unaffected — that is what makes this safe to
    ship ahead of the frontend work.
    """
    out = _listed(_rows(3, 3), limit=200)
    assert list(out["data"][0].keys()) == ["id", "title"]
    assert out["data"][0]["id"] == "d0"


def test_limit_is_reported_rather_than_assumed():
    """The UI should not have to hardcode 200 to know it is looking at a page."""
    assert _listed(_rows(1, 1), limit=500)["limit"] == 500
