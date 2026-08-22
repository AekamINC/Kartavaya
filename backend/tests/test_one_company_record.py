"""One company record, referenced by two modules.

Owner's decision, 2026-08-09: "keep them separate modules, but make the shared
thing one record… entering a customer in Sales creates the company, and it's
immediately the CRM client if they later buy CRM."

Sales had no company reference at all — `GET /vikray/customers` grouped orders
by CONTACT, so a customer was a person, and two people at one firm produced two
customers with the firm's orders split between them.
"""
import inspect
import pathlib

from routers import ganit, products, vikray

BACKEND = pathlib.Path(__file__).resolve().parent.parent


def _code(fn) -> str:
    src = inspect.getsource(fn)
    return " ".join("\n".join(
        line for line in src.splitlines()
        if not line.strip().startswith("#")).split())


def _sql(name: str) -> str:
    body = (BACKEND / "migrations" / name).read_text(encoding="utf-8")
    return "\n".join(line for line in body.splitlines()
                     if not line.strip().startswith("--"))


def test_a_customer_is_grouped_by_company_not_by_person():
    """A contact leaves; the customer stays."""
    code = _code(vikray.list_customers)
    assert "o.client_id" in code
    assert "GROUP BY COALESCE(o.client_id" in code


def test_an_order_with_no_company_still_appears():
    """Orders predating migration 136 whose contact had no client must not
    vanish from the list — that would be data disappearing to enforce a rule
    introduced afterwards."""
    code = _code(vikray.list_customers)
    assert "'contact:' || o.contact_id" in code
    assert "COALESCE(cl.name, c.company, c.name)" in code


def test_the_company_is_validated_against_the_caller_s_org():
    """A `client_id` from a request body is user input. A foreign key alone
    would let one organisation attach its order to another's company row."""
    code = _code(vikray.resolve_order_company)
    assert "org_id=$2::uuid" in code and "400" in code


def test_an_order_inherits_its_company_from_the_contact():
    code = _code(vikray.resolve_order_company)
    assert "graha_contacts" in code and "client_id::text" in code


def test_the_tick_is_set_where_it_is_earned():
    """`is_sales_customer` is a flag on the ONE record, set when an order names
    the company — not a sync job, and not a second copy of the company."""
    for fn in (vikray.create_order, vikray.create_order_from_deal):
        code = _code(fn)
        assert "is_sales_customer=TRUE" in code
        assert "is_sales_customer=FALSE" in code, "it would rewrite updated_at every order"


def test_nothing_ever_clears_the_tick():
    """A firm that ordered once is a customer for ever. Un-ticking them would
    drop them out of a sales report on an anniversary nobody chose."""
    source = inspect.getsource(vikray)
    assert "is_sales_customer=FALSE, updated_at" not in source
    assert "SET is_sales_customer=FALSE" not in source


def test_only_a_won_deal_becomes_an_order():
    """An open deal is a forecast. Converting one books revenue against work
    that has not been agreed."""
    code = _code(vikray.create_order_from_deal)
    assert '"Won"' in code and "400" in code


def test_converting_a_deal_twice_returns_the_first_order():
    """A double-click must not double the books."""
    code = _code(vikray.create_order_from_deal)
    assert "deal_id=$1::uuid" in code and '"exists"' in code


def test_the_deal_becomes_one_line_not_an_invented_basket():
    """A deal has a value, not a basket. Inventing line items from a figure puts
    quantities and HSN codes on the order that nobody entered."""
    code = _code(vikray.create_order_from_deal)
    assert 'deal["value"]' in code
    assert "_compute_order_totals(items, 0, False)" in code


def test_the_migration_does_not_orphan_or_invent_an_order():
    body = _sql("136_one_company_record.sql")
    assert "ADD COLUMN IF NOT EXISTS client_id" in body
    # The backfill only touches orders whose contact HAS a client.
    assert "c.client_id IS NOT NULL" in body
    assert "DELETE" not in body.upper()


# ── Products: cost, and a margin that cannot drift ──────────────────────────


def test_margin_is_generated_not_stored():
    """A stored margin is a third number that can disagree with the two it comes
    from — and it would, the first time somebody edits a price."""
    body = _sql("137_product_cost_price.sql")
    assert "GENERATED ALWAYS AS (price - cost_price) STORED" in body
    assert "NULLIF(price, 0)" in body, "a free item would be a division error"


def test_cost_defaults_to_null_and_not_to_zero():
    """Zero cost claims the item is free and renders every margin as 100%."""
    body = _sql("137_product_cost_price.sql")
    add = body[body.index("ADD COLUMN IF NOT EXISTS cost_price"):][:120]
    assert "DEFAULT" not in add.upper()
    assert "NOT NULL" not in add.upper()


def test_the_api_carries_cost_and_margin():
    # The catalogue moved out of Ganit and into `routers/products.py` — one
    # catalogue, gated on Finance OR Sales, because a product is billed by one
    # and sold by the other. Ganit still serves the old URLs, with these exact
    # functions. See `test_products_one_catalogue.py`.
    code = _code(products.list_products)
    assert "cost_price" in code and "margin" in code and "margin_pct" in code


def test_a_cost_can_be_cleared_but_other_fields_cannot():
    """"I no longer know what this costs" is a real thing to say. The general
    `v is not None` filter discarded it, leaving a stale cost and a margin
    computed from it."""
    code = _code(products.update_product)
    assert 'k == "cost_price"' in code


def test_nothing_computes_a_margin_in_python():
    """Four places for one number to disagree with itself."""
    source = inspect.getsource(ganit)
    assert "price - cost_price" not in source.replace("(price - cost_price)", "")
