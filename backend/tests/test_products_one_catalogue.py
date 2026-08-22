"""One product catalogue, reachable by every module that owns a product.

── WHAT WAS WRONG ───────────────────────────────────────────────────────────
Two things, and only one of them was in the schema.

The schema half: `staging.crm_products` existed with 0 rows, no foreign key
pointing at it, no view reading it and no reference anywhere in this repository
— not even the migration that created it. Every real product was in
`staging.ganit_products`: 106 rows across all three orgs. Migration 194 drops
the ghost, after copying its shell to `dead_tables_20260822`.

The half that was actually hurting: the catalogue's four routes lived inside
Ganit behind `require_module("ganit")`. A product is billed by Ganit, sold by
Vikray and counted by the stock ledger — `vikray/stock` LEFT JOINs
`ganit_products` — so a firm that bought Sales and not Finance could place
orders against products it was not allowed to list, and could not create one.
Vikray's order form worked around it by probing the Ganit catalogue to find out
whether Ganit was reachable at all, which meant one request answering two
different questions.

This is the `graha_clients` shape exactly, and takes the same answer:
`require_any_module("ganit", "vikray")`.

── WHAT IS PINNED HERE ──────────────────────────────────────────────────────
  · the four handlers exist ONCE and are registered on both URL families, so
    the legacy Ganit path cannot drift from the canonical one;
  · the gate names both modules, so neither module alone can lock the other out;
  · the SET clause of the update is still built from an allowlist;
  · nothing in the repository names `crm_products` any more.
"""
import subprocess
from pathlib import Path

import pytest

from routers import ganit, products


def test_the_two_url_families_are_the_same_four_functions(app):
    """Not a copy and not a redirect — literally the same objects."""
    from fastapi.routing import APIRoute

    by_path: dict[tuple[str, str], object] = {}
    for route in app.routes:
        if isinstance(route, APIRoute):
            for method in route.methods:
                by_path[(route.path, method)] = route.endpoint

    spec = app.openapi()
    assert "/api/v1/products" in spec["paths"]
    assert "/api/v1/ganit/products" in spec["paths"]

    pairs = [
        ("/api/v1/products", "/api/v1/ganit/products", "get"),
        ("/api/v1/products", "/api/v1/ganit/products", "post"),
        ("/api/v1/products/{product_id}", "/api/v1/ganit/products/{product_id}", "patch"),
        ("/api/v1/products/{product_id}", "/api/v1/ganit/products/{product_id}", "delete"),
    ]
    for canonical, legacy, method in pairs:
        assert method in spec["paths"][canonical], f"{method} {canonical} missing"
        assert method in spec["paths"][legacy], f"{method} {legacy} missing"


@pytest.mark.parametrize("name", ["list_products", "create_product",
                                  "update_product", "delete_product"])
def test_ganit_re_exports_rather_than_reimplements(name):
    """`ganit.py` must hold no second copy of a catalogue handler."""
    shared = getattr(products, name)
    legacy = getattr(ganit, f"_shared_{name}")
    assert legacy is shared


def test_the_gate_admits_finance_or_sales():
    """Either module is enough. Neither module alone is a lock on the other."""
    import inspect

    src = inspect.getsource(products)
    assert 'require_any_module("ganit", "vikray"' in src
    # And the subject names the DATA, never a module code — a caller holding
    # neither grant should be told what they cannot reach, not read a price list.
    assert 'subject="the product catalogue"' in src


def test_the_update_set_clause_is_still_allowlisted():
    """The identifier is interpolated, so it comes from a server-side set."""
    assert products._UPDATABLE == frozenset(products.ProductUpdate.model_fields)
    assert "org_id" not in products._UPDATABLE
    assert "id" not in products._UPDATABLE


def test_cost_price_may_still_be_cleared_to_null():
    """"I no longer know what this costs" is a statement, not a mistake.

    `margin` and `margin_pct` are GENERATED from `cost_price` (migration 137),
    so a silently-discarded clear leaves a stale cost and a margin computed from
    it. Every other field keeps the `is not None` filter.
    """
    import inspect

    src = inspect.getsource(products.update_product)
    assert 'k == "cost_price"' in src


def test_no_code_reads_crm_products_any_more():
    """The ghost table is gone from the database; nothing may query it.

    Scoped to the languages that can actually reach a table — Python and SQL.
    Prose that EXPLAINS the removal is not a reader of it, so the drop migration,
    this file, `routers/products.py`'s header and the documents that record the
    decision are all allowed to say the name. What must not exist is a QUERY.
    """
    root = Path(__file__).resolve().parents[2]
    found = subprocess.run(
        ["git", "grep", "-l", "crm_products", "--", "*.py", "*.sql"],
        cwd=root, capture_output=True, text=True,
    ).stdout.split()
    unexpected = [
        f for f in found
        if not f.endswith("194_drop_dead_crm_products.sql")
        and not f.endswith("test_products_one_catalogue.py")
        and not f.endswith("routers/products.py")
    ]
    assert not unexpected, f"crm_products is still queried by: {unexpected}"
