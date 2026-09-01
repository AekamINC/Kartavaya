"""The customer's own reference, and the org's own fields, ON THE DOCUMENT.

Both halves of this file are about the same failure: a field that is captured,
validated, stored and listed, and then left off the only artefact the customer
ever sees.

`customer_ref` was that for a year. Migration 192 added the column and its
CHECK, `InvoiceForm.jsx` asked for it, `list_invoices` returned it, and
`grep -c customer_ref services/invoice_pdf.py` returned ZERO — so 45 of 97 live
invoices carried a purchase-order number that appeared on no invoice.

Every assertion here is written to fail if that regresses, which means the
NEGATIVE cases matter as much as the positive ones: a renderer that prints the
label unconditionally passes "the label is on the page" and is wrong on the 52
invoices that have no reference. Each such test therefore also asserts that the
document rendered AT ALL, because "the label is absent" is trivially true of
the empty string.
"""
import re
import uuid

import pytest

from services.invoice_pdf import _build_html, _custom_details_html


ORG = {"name": "Aekam Inc", "gstin": "27AAAAA0000A1Z5", "pan": "AAAAA0000A"}
CONTACT = {"name": "Ramesh Kumar", "company": "Sharma Traders"}


def _invoice(**over):
    """A minimal renderable tax invoice. Deliberately NOT carrying the fields
    under test — every one of them is added by the case that needs it, so a
    test cannot pass on a fixture that was already shaped like the answer."""
    inv = {
        "invoice_number": "INV-2026-0042",
        "invoice_type": "tax_invoice",
        "invoice_date": "2026-07-08",
        "due_date": "2026-08-07",
        "place_of_supply": "Maharashtra",
        "currency": "INR",
        "line_items": [{
            "description": "Statutory audit", "hsn_code": "998221",
            "quantity": 1, "unit": "NOS", "rate": 50000,
            "gst_rate": 18, "line_total": 50000,
        }],
        "subtotal": 50000, "cgst": 4500, "sgst": 4500, "igst": 0,
        "total": 59000, "amount_paid": 0, "balance_due": 59000,
    }
    inv.update(over)
    return inv


def _rendered(html):
    """Anti-vacuity: the document actually rendered.

    Every negative assertion below ("the label is not on the page") is true of
    the empty string, so each one is paired with this. It checks a fact that
    has nothing to do with the feature — the invoice number in the letterhead —
    so a `_build_html` that returned "" or threw its content away could not
    make a single negative case pass."""
    assert "INV-2026-0042" in html, "the fixture invoice did not render at all"
    assert "Invoice date" in html, "the meta strip did not render at all"


# ══════════════════════════════════════════════════════════════════════════════
# Part 1 · the customer's reference
# ══════════════════════════════════════════════════════════════════════════════

def test_the_customer_reference_is_printed_on_the_invoice():
    """The whole point. `PO-88213` is the customer's, and it reaches the page."""
    html = _build_html(_invoice(customer_ref="PO-88213"), ORG, CONTACT)
    _rendered(html)
    assert "Customer reference" in html
    assert "PO-88213" in html


def test_the_label_is_the_ONE_the_form_asks_for():
    """`InvoiceForm.jsx` labels the box "Customer reference". A second name for
    one field — "Your reference", "PO no." — leaves the person who typed it
    unable to tell whether the thing on the page is the thing they filled in.

    Asserted as an absence of the alternatives rather than only as the presence
    of the right one, because "Customer reference" being present does not stop
    somebody adding a second cell beside it."""
    html = _build_html(_invoice(customer_ref="PO-88213"), ORG, CONTACT)
    _rendered(html)
    assert "Customer reference" in html
    for wrong in ("Your reference", "PO no", "PO number", "Customer ref<"):
        assert wrong not in html, f"the strip invented a second name: {wrong}"


def test_no_reference_prints_NOTHING_not_an_empty_cell():
    """52 of 97 live invoices have no reference. A labelled empty cell would
    announce a missing field on more than half the documents in the product,
    where nothing is missing at all — most customers simply give no PO."""
    html = _build_html(_invoice(), ORG, CONTACT)
    _rendered(html)
    assert "Customer reference" not in html


def test_a_whitespace_reference_is_not_a_reference():
    """`ganit_invoices_customer_ref_ck` refuses '' and '   ' — but it post-dates
    45 rows and the router is not the only thing that can write the column. A
    cell reading "Customer reference: " with three spaces under it is the empty
    labelled cell this feature exists to avoid."""
    html = _build_html(_invoice(customer_ref="   "), ORG, CONTACT)
    _rendered(html)
    assert "Customer reference" not in html


def test_the_reference_is_escaped_like_every_other_customer_string():
    """It is user-controlled text on a rendered document. `<` must not survive
    as markup — the same rule `email_service._safe_subject` applies at its own
    choke point."""
    html = _build_html(_invoice(customer_ref="PO<script>&x"), ORG, CONTACT)
    _rendered(html)
    assert "PO<script>" not in html
    assert "PO&lt;script&gt;&amp;x" in html


def test_the_reference_does_not_displace_the_statutory_particulars():
    """The strip is a four-column grid and the reference takes the empty fourth.
    A change that dropped place of supply to make room would misfile the supply
    in GSTR-1 for the reader who checks the document against their return."""
    html = _build_html(_invoice(customer_ref="PO-88213"), ORG, CONTACT)
    for cell in ("Invoice date", "Due date", "Place of supply", "Customer reference"):
        assert cell in html, f"{cell} left the meta strip"


def test_an_export_invoice_carries_it_too():
    """An export has Currency where a domestic invoice has place of supply, and
    a foreign customer's order number is no less theirs."""
    html = _build_html(
        _invoice(customer_ref="WO/2026/114", is_export=True, currency="USD"),
        ORG, CONTACT)
    assert "WO/2026/114" in html
    assert "Customer reference" in html
    assert "Currency" in html


# ══════════════════════════════════════════════════════════════════════════════
# Part 2 · the org's own fields
# ══════════════════════════════════════════════════════════════════════════════

def test_a_custom_field_reaches_the_document_under_its_own_name():
    html = _build_html(
        _invoice(custom_fields=[{"label": "Site", "value": "Andheri East", "type": "text"}]),
        ORG, CONTACT)
    _rendered(html)
    assert "Additional details" in html
    assert "Site" in html
    assert "Andheri East" in html


def test_no_custom_fields_means_no_block_at_all():
    """Every org today. An empty "Additional details" panel on every invoice in
    the product would be the customer-reference mistake made twice."""
    html = _build_html(_invoice(), ORG, CONTACT)
    _rendered(html)
    assert "Additional details" not in html


def test_definitions_with_no_values_do_not_print_empty_rows():
    """An org with six invoice fields that filled two on this invoice gets two
    rows, not six with four blanks."""
    html = _build_html(_invoice(custom_fields=[
        {"label": "Site", "value": "Andheri East", "type": "text"},
        {"label": "Delivery note", "value": "", "type": "text"},
        {"label": "Vehicle no.", "value": None, "type": "text"},
    ]), ORG, CONTACT)
    assert "Andheri East" in html
    assert "Delivery note" not in html
    assert "Vehicle no." not in html


def test_an_unticked_checkbox_says_nothing_and_a_ticked_one_says_yes():
    """A checkbox starts unticked, so `false` is indistinguishable from "nobody
    was asked" — and printing "No" against it would put the firm's internal
    defaults on the face of a customer's invoice."""
    off = _custom_details_html([{"label": "Rush job", "value": False, "type": "checkbox"}])
    assert off == "", "an unticked box was printed"

    on = _custom_details_html([{"label": "Rush job", "value": True, "type": "checkbox"}])
    assert "Rush job" in on
    assert "Yes" in on
    # `isinstance(True, int)` is true in Python. A ticked box tested as a number
    # would print "1", which is the bug this line exists to catch.
    assert ">1<" not in on


def test_zero_is_a_value_and_prints():
    """`0` was typed. It is not the same case as an unticked box, and a reader
    may be relying on it."""
    html = _custom_details_html([{"label": "Advance", "value": 0, "type": "number"}])
    assert "Advance" in html
    assert ">0<" in html


def test_a_date_field_prints_in_the_documents_own_format():
    """This module was once the only document in the set printing the database's
    `2026-07-08` where the quotation, statement, agreement and project report
    all print `08 Jul 2026`. A custom date field must not reintroduce that."""
    html = _custom_details_html([{"label": "PO date", "value": "2026-07-08", "type": "date"}])
    assert "08 Jul 2026" in html
    assert "2026-07-08" not in html


def test_a_value_that_is_not_a_date_is_passed_through_unchanged():
    html = _custom_details_html([{"label": "PO date", "value": "on receipt", "type": "date"}])
    assert "on receipt" in html


def test_a_custom_value_is_escaped():
    html = _custom_details_html(
        [{"label": "Site <b>", "value": "A & B <i>", "type": "text"}])
    assert "<b>" not in html
    assert "<i>" not in html
    assert "&amp;" in html


def test_a_field_with_no_label_prints_nothing():
    """There is nothing to print it under, and a value floating in a labelled
    block is worse than an absent one."""
    assert _custom_details_html([{"label": "", "value": "x", "type": "text"}]) == ""
    assert _custom_details_html([{"value": "x"}]) == ""


def test_junk_in_the_list_does_not_take_the_invoice_down():
    """The list is built from a jsonb column joined to a definitions table. A
    PDF that 500s is strictly worse than a PDF without the firm's extra fields."""
    html = _custom_details_html(["nonsense", None, 42,
                                 {"label": "Site", "value": "Andheri East"}])
    assert "Andheri East" in html


def test_the_raw_custom_data_column_is_NOT_rendered_by_the_generator():
    """`SELECT i.*` puts `custom_data` on the invoice dict too, keyed by the
    definition's UUID. The renderer must ignore it and read only the resolved
    `custom_fields`, because a uuid must never reach a page — the PDF's own
    version of `check-rendered-ids.mjs`."""
    field_id = str(uuid.uuid4())
    html = _build_html(
        _invoice(custom_data={field_id: "Andheri East"}), ORG, CONTACT)
    _rendered(html)
    assert field_id not in html
    assert "Andheri East" not in html
    assert "Additional details" not in html


def test_no_uuid_reaches_the_page_even_when_the_fields_ARE_resolved():
    """The resolver hands over labels and values and nothing else. Asserted as a
    pattern rather than as one known id, so a future change that started
    carrying the definition id along for the ride is caught."""
    html = _build_html(_invoice(custom_fields=[
        {"label": "Site", "value": "Andheri East", "type": "text"},
    ]), ORG, CONTACT)
    found = re.findall(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        html)
    assert not found, f"a uuid reached the document: {found}"


# ══════════════════════════════════════════════════════════════════════════════
# Part 3 · the resolver in `routers/ganit.py`
# ══════════════════════════════════════════════════════════════════════════════

class _Defs:
    """A pool that answers one definitions query and records that it was asked."""

    def __init__(self, rows):
        self._rows = rows
        self.queries = []

    async def fetch(self, q, *args):
        self.queries.append((q, args))
        return self._rows


class _NoQuery:
    """A pool that fails the test if anything queries it."""

    async def fetch(self, q, *args):
        raise AssertionError(
            "the definitions query ran for an invoice with no custom data")


ORG_ID = "00000000-0000-0000-0000-000000000001"


@pytest.mark.asyncio
@pytest.mark.parametrize("stored", [None, {}, "", "not json", [1, 2], "{}"])
async def test_an_invoice_with_nothing_stored_costs_nothing_and_returns_nothing(stored):
    """⚠ `custom_data` IS NULL ON EVERY INVOICE WRITTEN BEFORE MIGRATION 257,
    and `dict(row)` has no such key at all in the window between the deploy and
    the migration. All of those must render a document, not raise.

    `_NoQuery` is the anti-vacuity half: it is not enough that the result is
    empty, it must be empty WITHOUT a round trip — otherwise every PDF download
    in the product pays for a table nobody in it uses yet."""
    from routers.ganit import _invoice_custom_fields
    assert await _invoice_custom_fields(_NoQuery(), ORG_ID, stored) == []


@pytest.mark.asyncio
async def test_stored_values_are_resolved_to_LABELS_in_the_defined_order():
    """The uuid keys become field names. Two fields, returned in the order the
    query asked for (`sort_order, field_name`) — the same order the settings
    tab arranged and the form asked in."""
    from routers.ganit import _invoice_custom_fields
    a, b = uuid.uuid4(), uuid.uuid4()
    pool = _Defs([
        {"id": a, "field_name": "Site", "field_type": "text"},
        {"id": b, "field_name": "PO date", "field_type": "date"},
    ])
    got = await _invoice_custom_fields(
        pool, ORG_ID, {str(b): "2026-07-08", str(a): "Andheri East"})

    assert got == [
        {"label": "Site", "value": "Andheri East", "type": "text"},
        {"label": "PO date", "value": "2026-07-08", "type": "date"},
    ]
    # The stored map was written b-then-a and the answer is a-then-b, so this
    # is the QUERY's order and not the jsonb's insertion order.
    assert [g["label"] for g in got] == ["Site", "PO date"]


@pytest.mark.asyncio
async def test_the_uuid_key_is_matched_as_a_STRING():
    """jsonb keys are text; `graha_custom_fields.id` comes back as a
    `uuid.UUID`. Without the `str()` coercion the lookup misses every time and
    the block renders empty — silently, on a document nobody re-checks. This
    fixture uses a real UUID object for exactly that reason."""
    from routers.ganit import _invoice_custom_fields
    fid = uuid.uuid4()
    assert not isinstance(fid, str)
    pool = _Defs([{"id": fid, "field_name": "Site", "field_type": "text"}])
    got = await _invoice_custom_fields(pool, ORG_ID, {str(fid): "Andheri East"})
    assert got == [{"label": "Site", "value": "Andheri East", "type": "text"}]


@pytest.mark.asyncio
async def test_a_value_whose_definition_was_deleted_is_dropped_not_guessed():
    """`delete_custom_field` flips `is_active`, and the query only joins active
    definitions — so there is no label left to print the value under. Printing
    it under its uuid would put an id on a customer's invoice."""
    from routers.ganit import _invoice_custom_fields
    live, gone = uuid.uuid4(), uuid.uuid4()
    pool = _Defs([{"id": live, "field_name": "Site", "field_type": "text"}])
    got = await _invoice_custom_fields(
        pool, ORG_ID, {str(live): "Andheri East", str(gone): "orphan"})
    assert got == [{"label": "Site", "value": "Andheri East", "type": "text"}]
    assert "orphan" not in str(got)


@pytest.mark.asyncio
async def test_the_query_is_scoped_to_the_org_and_to_invoice_definitions():
    """`graha_custom_fields` is one table for every org and every entity. An
    unscoped read here would print another firm's field names — or a contact
    field's — on this firm's invoice."""
    from routers.ganit import _invoice_custom_fields
    fid = uuid.uuid4()
    pool = _Defs([{"id": fid, "field_name": "Site", "field_type": "text"}])
    await _invoice_custom_fields(pool, ORG_ID, {str(fid): "x"})

    assert len(pool.queries) == 1
    sql, args = pool.queries[0]
    assert "org_id=$1::uuid" in sql
    assert "entity_type=$2" in sql
    assert "is_active=TRUE" in sql
    assert "ORDER BY sort_order, field_name" in sql
    # Bound, not interpolated — and the org is the one asked for.
    assert args == (ORG_ID, "invoice")


@pytest.mark.asyncio
async def test_false_and_zero_survive_the_resolver():
    """The resolver drops `None` and `""` and nothing else: what an unticked box
    means is the RENDERER's decision and must live in exactly one place."""
    from routers.ganit import _invoice_custom_fields
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    pool = _Defs([
        {"id": a, "field_name": "Rush", "field_type": "checkbox"},
        {"id": b, "field_name": "Advance", "field_type": "number"},
        {"id": c, "field_name": "Blank", "field_type": "text"},
    ])
    got = await _invoice_custom_fields(
        pool, ORG_ID, {str(a): False, str(b): 0, str(c): ""})
    assert [g["label"] for g in got] == ["Rush", "Advance"]
    assert got[0]["value"] is False
    assert got[1]["value"] == 0


# ══════════════════════════════════════════════════════════════════════════════
# Part 4 · the write paths, and the second generator
# ══════════════════════════════════════════════════════════════════════════════

def test_custom_data_is_declared_on_the_request():
    """Undeclared, pydantic drops it silently and the API returns 200 having
    stored nothing — the same failure `test_the_customer_reference_is_declared_
    on_the_request` covers for the field beside it."""
    from routers.ganit import InvoiceCreate
    assert "custom_data" in InvoiceCreate.model_fields


def test_create_writes_both_fields():
    import inspect

    from routers import ganit
    src = inspect.getsource(ganit.create_invoice)
    assert "customer_ref" in src
    assert "custom_data" in src
    # The column list and the VALUES list must both name it — an INSERT naming
    # the column with no placeholder is a syntax error, but a placeholder with
    # no column is a value bound to the wrong column, which is not.
    assert "$27::jsonb" in src


# ── The PATCH, driven rather than read ──────────────────────────────────────
#
# ⚠ THIS WAS A SOURCE-TEXT TEST AND IT WAS SATISFIED BY ITS OWN SHAPE.
#
# It asserted `'"customer_ref" in _named' in src`. Mutating the router to
# `if False and "customer_ref" in _named:` — which disables the clause
# completely, restoring the exact bug this change fixes — left that substring in
# the source and the test GREEN. That is the dominant defect class in this
# codebase and it had reproduced itself inside the test written to catch it.
#
# So the route is EXECUTED against a fake pool and the composed statement is
# read off the wire. The parameter INDEX is checked too, not only the clause:
# `update_invoice` now builds four optional SET fragments whose placeholder
# numbers are derived from each other, so an off-by-one binds a user id into a
# jsonb column — silently, with a 200 — which is precisely what the router's own
# `_by_idx` comment records having nearly shipped once.

class _UpdatePool:
    """Answers the pre-flight SELECT, then captures the UPDATE."""

    def __init__(self):
        self.update = None

    async def fetchrow(self, q, *args):
        if q.lstrip().upper().startswith("UPDATE"):
            self.update = (q, args)
            return {"id": "row", "invoice_number": "INV-2026-0042",
                    "total": 0, "doc_status": "final"}
        # The invoice being corrected: unpaid (total == balance_due), active.
        return {"invoice_number": "INV-2026-0042", "doc_status": "final",
                "total": 0, "balance_due": 0, "is_active": True,
                "sent_at": None, "viewed_at": None, "line_items": []}


async def _patch(monkeypatch, **fields):
    """Drive `update_invoice` with `fields` NAMED on the request, and hand back
    the (sql, args) it actually sent."""
    import json as _json

    from routers import ganit
    from routers.ganit import InvoiceCreate, LineItem

    pool = _UpdatePool()

    async def _pool():
        return pool

    async def _computed(*a, **k):
        return {"line_items": _json.dumps([]), "subtotal": 0, "cgst": 0,
                "sgst": 0, "igst": 0, "discount": 0, "total": 0}

    async def _company(*a, **k):
        return "11111111-1111-1111-1111-111111111111"

    monkeypatch.setattr(ganit, "get_pool", _pool)
    monkeypatch.setattr(ganit, "_compute_invoice_costed", _computed)
    monkeypatch.setattr(ganit, "resolve_order_company", _company)

    body = InvoiceCreate(line_items=[LineItem(description="Statutory audit")], **fields)
    await ganit.update_invoice(
        invoice_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
        body=body, user={"user_id": "user_abc"}, org_id=ORG_ID, _g=None,
    )
    assert pool.update is not None, "the route never issued an UPDATE"
    return pool.update


def _bound(sql, args, pattern):
    """The value actually bound to the placeholder `pattern` names."""
    m = re.search(pattern, sql)
    assert m, f"no SET clause matched {pattern} in:\n{sql}"
    idx = int(m.group(1))
    assert idx <= len(args), f"${idx} is bound by nothing — only {len(args)} args"
    return args[idx - 1]


def _split_top_level(text):
    """Split on commas at bracket depth 0. `NULLIF($2,'')` is ONE value."""
    out, depth, cur = [], 0, ""
    for ch in text:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def test_the_INSERT_has_as_many_values_as_columns():
    """⚠ `$18` IS DELIBERATELY BOUND TWICE on this statement (total and
    balance_due), which is why the router's own comment forbids renumbering the
    placeholders to keep the column list tidy. That makes "count the $n" the
    wrong check and "count the values" the right one: a column added to the
    list without a matching value shifts every value after it by one, and
    Postgres accepts the statement whenever the shifted types happen to line up.

    Reconstructed from the source because the SQL is split across adjacent
    string literals with comments between them — so this reads the statement
    the database actually receives, not one line of it."""
    import inspect

    from routers import ganit

    src = inspect.getsource(ganit.create_invoice)
    lines = src.splitlines()
    start = next(i for i, ln in enumerate(lines) if "INSERT INTO public.ganit_invoices" in ln)
    end = next(i for i, ln in enumerate(lines) if i > start and "RETURNING *" in ln)
    sql = "".join(
        "".join(re.findall(r'"([^"]*)"', ln))
        for ln in lines[start:end + 1] if not ln.strip().startswith("#")
    )
    assert "custom_data" in sql, "the reconstruction lost the statement"

    cols = _split_top_level(sql[sql.index("(") + 1:sql.index(") VALUES")])
    vals_open = sql.index("VALUES") + len("VALUES")
    vals = _split_top_level(sql[sql.index("(", vals_open) + 1:sql.rindex(")")])

    assert len(cols) == len(vals), (
        f"{len(cols)} columns and {len(vals)} values:\n"
        f"  columns: {cols}\n  values:  {vals}"
    )
    # Anti-vacuity: the reconstruction found a real statement, not two empty
    # lists that trivially have equal length.
    assert len(cols) > 25, f"only parsed {len(cols)} columns — the parse is wrong"
    assert cols[-1] == "custom_data"
    assert vals[-1] == "$27::jsonb"
    assert "customer_ref" in cols


@pytest.mark.asyncio
async def test_the_PATCH_writes_the_customer_reference(monkeypatch):
    """⚠ THIS IS THE HALF THAT WAS MISSING. `customer_ref` was on the create
    INSERT and on nothing else, so an unpaid invoice — which this product
    deliberately lets a firm correct and re-send — accepted a new PO number
    with a 200 and kept the old one."""
    sql, args = await _patch(monkeypatch, customer_ref="PO-99")
    assert _bound(sql, args, r"customer_ref=NULLIF\(btrim\(\$(\d+)\)") == "PO-99"


@pytest.mark.asyncio
async def test_the_PATCH_writes_the_custom_fields(monkeypatch):
    import json as _json
    sql, args = await _patch(monkeypatch, custom_data={"f1": "Andheri East"})
    raw = _bound(sql, args, r"custom_data=\$(\d+)::jsonb")
    assert _json.loads(raw) == {"f1": "Andheri East"}


@pytest.mark.asyncio
async def test_a_PATCH_that_says_nothing_about_them_ERASES_NEITHER(monkeypatch):
    """Both model fields have a falsy DEFAULT ("" and {}), so an unconditional
    bind would let a PATCH that never mentions them wipe the customer's
    reference — or every custom value on the invoice — as a side effect of
    correcting a typo in a line description. That is the failure the company
    block above this one in the router spells out at length, and it applies
    identically here.

    The anti-vacuity half is the second assertion: `notes=` MUST still be in
    the statement, so a route that stopped issuing an UPDATE at all, or emitted
    an empty SET, could not pass by omission."""
    sql, args = await _patch(monkeypatch, notes="unrelated edit")
    assert "customer_ref" not in sql
    assert "custom_data" not in sql
    assert "notes=$15" in sql, "the UPDATE stopped writing the ordinary fields"


@pytest.mark.asyncio
async def test_naming_them_BLANK_clears_them(monkeypatch):
    """A reference entered in error has to be removable, and `NULLIF(btrim())`
    is what turns the blank into the NULL the CHECK requires."""
    import json as _json
    sql, args = await _patch(monkeypatch, customer_ref="", custom_data={})
    assert _bound(sql, args, r"customer_ref=NULLIF\(btrim\(\$(\d+)\)") == ""
    assert "NULLIF(btrim(" in sql
    assert _json.loads(_bound(sql, args, r"custom_data=\$(\d+)::jsonb")) == {}


@pytest.mark.asyncio
async def test_the_placeholder_numbers_hold_with_ALL_FOUR_optional_clauses(monkeypatch):
    """The index chain is the real hazard: `_client_set`, `_by_set`, `_sp_set`,
    `_ref_set` and `_cd_set` each take the slot after the last, so there are
    sixteen possible parameter counts on one statement. Every value is checked
    against the placeholder that names it, so a shifted index cannot pass by
    landing on a neighbour that happens to be a string.

    The last assertion is the sharp one: the audit column must hold the USER,
    and the bug the router's `_by_idx` comment records is a client id landing
    in `updated_by` — a wrong name in an audit column, which is worse than an
    empty one because a NULL is visibly unknown and a wrong name is not."""
    import json as _json
    sql, args = await _patch(
        monkeypatch,
        client_id="11111111-1111-1111-1111-111111111111",
        salesperson_id="user_seller",
        customer_ref="PO-99",
        custom_data={"f1": "Andheri East"},
    )
    assert _bound(sql, args, r"client_id=NULLIF\(\$(\d+)") == \
        "11111111-1111-1111-1111-111111111111"
    assert _bound(sql, args, r"salesperson_id=NULLIF\(\$(\d+)") == "user_seller"
    assert _bound(sql, args, r"customer_ref=NULLIF\(btrim\(\$(\d+)\)") == "PO-99"
    assert _json.loads(_bound(sql, args, r"custom_data=\$(\d+)::jsonb")) == \
        {"f1": "Andheri East"}
    assert _bound(sql, args, r"updated_by=\$(\d+)") == "user_abc"
    # And nothing is bound that no placeholder reads.
    assert len(args) == max(int(n) for n in re.findall(r"\$(\d+)", sql))


# ══════════════════════════════════════════════════════════════════════════════
# Part 5 · the DOWNLOAD ROUTES, driven rather than read
# ══════════════════════════════════════════════════════════════════════════════
#
# ⚠ TWO MORE SOURCE-TEXT TESTS STOOD HERE AND BOTH WERE SATISFIED BY THEIR OWN
# SHAPE — the defect the PATCH block above records, reproduced twice more
# inside the very file written to catch it.
#
#   · `test_the_pdf_route_resolves_the_fields_before_rendering` asserted
#     `"_invoice_custom_fields" in inspect.getsource(download_invoice_pdf)`.
#     Commenting `ganit.py:1335` out — or wrapping it in `if False:` — leaves
#     that substring in the source and the test GREEN, with every custom field
#     gone from every invoice in the product. Nothing else under tests/ asserted
#     the key, so that mutant survived the entire suite.
#   · `test_the_quotation_prints_the_customer_reference_and_not_the_notes` read
#     the `"reference"` line and substring-checked it. Renaming the column to
#     `customer_refX` — which makes `.get()` miss and silently restores the exact
#     "the cell prints prose" bug the test is NAMED for — still contains the
#     substring `customer_ref`, so it stayed GREEN too.
#
# So both routes are EXECUTED here and every assertion is made on the DOCUMENT
# that comes back. The only thing replaced downstream of the route is
# WeasyPrint: each generator stub calls the very `_build_html` its real
# counterpart calls, on the arguments the route passed it, so everything between
# the SQL row and the markup is the product's own code — the resolver, the key
# it is stored under, the escaping and the meta strip included.

INVOICE_ID = "33333333-3333-3333-3333-333333333333"

ORG_ROW = {
    "name": "Aekam Inc", "gstin": "27AAAAA0000A1Z5", "pan": "AAAAA0000A",
    "tan": None, "billing_address": {"line1": "4 Turner Road", "city": "Mumbai"},
    # No `logo_key`: a key would send the route to `services.storage.sign_key`
    # and R2, which is not what any of these cases is about.
    "logo_url": "", "logo_key": None,
    "email": "billing@aekam.example", "phone": "+91 22 4000 0000",
    "website": "https://kartavaya.com", "bank_details": {}, "invoice_note": "",
    "settings": {},
    "authorized_signatory_name": "K. Shah",
    "authorized_signatory_designation": "Director",
}


def _row(**over):
    """The row `SELECT i.*, c.* …` hands back.

    Built from `_invoice()` so the document is renderable, plus the joined
    contact columns the route pops. `customer_ref` and `custom_data` are
    DELIBERATELY ABSENT — each case adds the one it is about, so no test here
    can pass on a fixture that was already shaped like its answer."""
    row = dict(_invoice())
    row.update({
        "id": INVOICE_ID, "org_id": ORG_ID, "is_active": True,
        "notes": None, "terms": None, "discount": 0, "is_igst": False,
        "contact_name": CONTACT["name"],
        "contact_email": "ramesh@sharmatraders.example",
        "contact_company": CONTACT["company"],
        "contact_gstin": "27BBBBB1111B1Z5",
        "contact_designation": "Proprietor",
        "contact_billing_address": {"line1": "12 MG Road", "city": "Mumbai"},
    })
    row.update(over)
    return row


class _PdfPool:
    """Answers the reads the PDF routes make, and RECORDS the definitions query.

    `fetchrow` is dispatched on the statement rather than on call order, because
    both routes read the invoice and the org and the order between them is the
    route's business, not this fixture's. `fetch` is only ever the custom-field
    definitions join — `self.fetches` is what proves whether it happened."""

    def __init__(self, row, defs=()):
        self._row = row
        self._defs = list(defs)
        self.fetches = []

    async def fetchrow(self, q, *args):
        if "public.organisations" in q:
            return dict(ORG_ROW)
        return dict(self._row)

    async def fetch(self, q, *args):
        self.fetches.append((q, args))
        return self._defs


async def _download(monkeypatch, row, defs=()):
    """Drive the REAL `ganit.download_invoice_pdf` and hand back the document
    it produced, plus the pool so a caller can see what it asked the database."""
    from routers import ganit
    from services import compliance_settings, invoice_pdf

    pool = _PdfPool(row, defs)

    async def _pool():
        return pool

    async def _states(*a, **k):
        return {}

    def _render(invoice, org, contact, compliance_states=None):
        # The seam is WeasyPrint and nothing else: this is the call
        # `generate_invoice_pdf` itself makes on its last line.
        return invoice_pdf._build_html(invoice, org, contact).encode()

    monkeypatch.setattr(ganit, "get_pool", _pool)
    monkeypatch.setattr(compliance_settings, "resolve_states", _states)
    monkeypatch.setattr(invoice_pdf, "generate_invoice_pdf", _render)

    resp = await ganit.download_invoice_pdf(
        invoice_id=uuid.UUID(INVOICE_ID), user={"user_id": "user_abc"},
        org_id=ORG_ID, _g=None,
    )
    return resp.body.decode(), pool


@pytest.mark.asyncio
async def test_the_ROUTE_puts_the_customers_reference_on_the_document(monkeypatch):
    """End to end from the column to the markup: the value stored on
    `ganit_invoices.customer_ref` is on the page the customer receives, under
    the label the form asked for it under."""
    html, _ = await _download(monkeypatch, _row(customer_ref="PO-88213"))
    _rendered(html)
    assert "Customer reference" in html
    assert "PO-88213" in html


@pytest.mark.asyncio
async def test_the_ROUTE_prints_NEITHER_label_nor_empty_cell_without_one(monkeypatch):
    """52 of 97 live invoices. `_rendered` is the anti-vacuity half — the
    absence below is true of the empty string, and this proves a whole document
    came back."""
    html, _ = await _download(monkeypatch, _row(customer_ref=None))
    _rendered(html)
    assert "Customer reference" not in html
    assert "PO-88213" not in html


@pytest.mark.asyncio
async def test_the_ROUTE_resolves_the_custom_fields_ONTO_the_document(monkeypatch):
    """⚠ THE REPLACEMENT FOR THE SOURCE-TEXT TEST.

    The renderer has no database and must not grow one — it runs in a worker
    thread via `asyncio.to_thread` — so the ROUTE does the join, and the only
    proof that it did is the label and the value arriving on the page. Deleting
    the resolver call, or storing its answer under any other key, takes both off
    the document; this fails in that case where reading the source could not."""
    field_id = str(uuid.uuid4())
    html, pool = await _download(
        monkeypatch,
        _row(custom_data={field_id: "Andheri East"}),
        defs=[{"id": uuid.UUID(field_id), "field_name": "Site",
               "field_type": "text"}],
    )
    _rendered(html)
    assert "Additional details" in html
    assert "Site" in html
    assert "Andheri East" in html
    # And the route paid for it exactly once, against the definitions table.
    assert len(pool.fetches) == 1
    assert "graha_custom_fields" in pool.fetches[0][0]


@pytest.mark.asyncio
async def test_the_ROUTE_sends_the_LABEL_and_never_the_uuid_key(monkeypatch):
    """`custom_data` reaches the renderer too, through `SELECT i.*`, keyed by
    the definition's uuid. The PDF's own `check-rendered-ids.mjs`: a route that
    handed the raw column over would print an id on a customer's invoice."""
    field_id = str(uuid.uuid4())
    html, _ = await _download(
        monkeypatch,
        _row(custom_data={field_id: "Andheri East"}),
        defs=[{"id": uuid.UUID(field_id), "field_name": "Site",
               "field_type": "text"}],
    )
    # Presence first, so this cannot pass over a block that rendered nothing.
    assert "Andheri East" in html
    assert field_id not in html
    found = re.findall(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        html)
    assert not found, f"a uuid reached the document: {found}"


@pytest.mark.asyncio
async def test_the_ROUTE_costs_no_query_when_there_is_nothing_stored(monkeypatch):
    """97 of 97 invoices today. The guard that returns before the query is what
    keeps every ordinary PDF download costing what it cost yesterday, and
    `pool.fetches` is the only place that is observable.

    ⚠ THE SECOND HALF IS THE ANTI-VACUITY HALF AND IT IS NOT OPTIONAL. "No
    query ran" and "no block rendered" are both trivially true of a route that
    stopped resolving custom fields at all — which is exactly the mutation the
    source-text test this replaces could not see. So the SAME fixture is driven
    again with a value in it, through the same harness, and must produce both
    the query and the block."""
    field_id = str(uuid.uuid4())
    defs = [{"id": uuid.UUID(field_id), "field_name": "Site", "field_type": "text"}]

    html, pool = await _download(monkeypatch, _row(custom_data=None), defs=defs)
    _rendered(html)
    assert "Additional details" not in html
    assert pool.fetches == [], "the definitions query ran for an invoice with no custom data"

    html, pool = await _download(
        monkeypatch, _row(custom_data={field_id: "Andheri East"}), defs=defs)
    assert "Additional details" in html, "the feature is switched off, not merely empty"
    assert pool.fetches, "the same route made no query even WITH data stored"


# ── The quotation ───────────────────────────────────────────────────────────

def _quote_row(**over):
    """A quotation is a `ganit_invoices` row with `invoice_type='quotation'`,
    filled in by the same form — which is the whole reason the same column has
    to reach it."""
    return _row(invoice_number="QTN-2026-0007", invoice_type="quotation", **over)


NOTES = "Delivery to site by 15 August; please confirm receipt."


def _quote_rendered(html):
    """Anti-vacuity for the quotation, on facts that have nothing to do with
    the reference — so a generator that threw its content away could not make
    any negative assertion below pass."""
    assert "QTN-2026-0007" in html, "the fixture quotation did not render at all"
    assert "Quote date" in html, "the meta strip did not render at all"
    assert "Reference" in html, "the Reference cell left the meta strip"


async def _quotation(monkeypatch, **over):
    """Drive the REAL `documents.download_quotation_pdf`; hand back the document
    and the `quote` dict the route actually composed."""
    from routers import documents
    from services import quotation_pdf

    pool = _PdfPool(_quote_row(**over))
    seen = {}

    async def _pool():
        return pool

    def _render(quote, org, contact=None):
        seen["quote"] = quote
        return quotation_pdf._build_html(quote, org, contact or {}).encode()

    monkeypatch.setattr(documents, "get_pool", _pool)
    monkeypatch.setattr(quotation_pdf, "generate_quotation_pdf", _render)

    resp = await documents.download_quotation_pdf(
        invoice_id=uuid.UUID(INVOICE_ID), user={"user_id": "user_abc"},
        org_id=ORG_ID, _g=None,
    )
    return resp.body.decode(), seen["quote"]


@pytest.mark.asyncio
async def test_the_QUOTATION_prints_the_reference_and_not_the_notes(monkeypatch):
    """⚠ THE REPLACEMENT FOR THE SOURCE-TEXT TEST, which passed over
    `customer_refX`.

    `quotation_pdf.py` already drew a mono `Reference` cell; it was being fed
    `notes`, which is prose — delivery instructions dressed up as a code the
    client should quote back, with the actual code left off the page. Where both
    exist the reference wins, and BOTH halves are asserted on the document: the
    PO is on it and the prose is not."""
    html, quote = await _quotation(
        monkeypatch, customer_ref="PO-88213", notes=NOTES)
    _quote_rendered(html)
    assert quote["reference"] == "PO-88213"
    assert "PO-88213" in html
    assert "please confirm receipt" not in html, \
        "the Reference cell printed the notes over the customer's reference"


@pytest.mark.asyncio
async def test_the_QUOTATION_still_falls_back_to_the_notes(monkeypatch):
    """Every quotation issued before this change printed its notes in that cell.
    Silently blanking it for a quotation with no reference would take
    information off a document a client may already be holding."""
    html, quote = await _quotation(monkeypatch, customer_ref=None, notes=NOTES)
    _quote_rendered(html)
    assert quote["reference"] == NOTES
    assert "please confirm receipt" in html


@pytest.mark.asyncio
async def test_the_QUOTATION_with_neither_renders_anyway(monkeypatch):
    """No reference and no notes is the ordinary case, and it must produce a
    document rather than a `None` in a mono cell or a 500."""
    html, quote = await _quotation(monkeypatch, customer_ref=None, notes=None)
    _quote_rendered(html)
    assert quote["reference"] == ""
    assert "None" not in html
