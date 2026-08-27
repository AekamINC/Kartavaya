"""One address order, held by a test rather than by a paragraph.

OPEN FINDING 7. Two renderers disagreed about where the state goes:

    services/invoice_pdf.py::_fmt_addr  ->  city, state, pincode, country
    services/doc_render.py::fmt_addr    ->  city, pincode, state, country

Both are reached from the same document run. `_fmt_addr` writes the party block
of a tax invoice; `fmt_addr` writes the letterhead of the agreement, the GSTR-3B
summary, the quotation and the TDS challan. So one client's address read two
ways across one folder of documents, and nothing anywhere failed — which is
precisely why it survived: a wrong order is not an exception, it is a string.

The order now lives in `doc_render.ADDRESS_ORDER` and both renderers read it.
That makes the *current* divergence structurally impossible; it does not stop a
third renderer, or a well-meant "inline it for clarity" edit, from doing it
again. That is what this file is for, and it holds three separate things:

  1. the tuple itself, so flipping it is a deliberate act that fails a test
     naming the decision rather than a quiet change to every future invoice;
  2. the ORDER EACH RENDERER ACTUALLY EMITS, recovered from its output with
     sentinel values — a renderer that stops importing the tuple and inlines a
     literal passes (1) and fails this;
  3. a scan for any *new* copy of the vocabulary in `services/`, because the
     defect was never one bad literal. It was two.

Prose does not stop a divergence. `git blame` on the old code shows both
literals sitting there, correct-looking, for the whole of their lives.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from services import doc_render as R
from services.doc_render import ADDRESS_BOTTOM, ADDRESS_ORDER, ADDRESS_TOP, fmt_addr
from services.invoice_pdf import _fmt_addr

#: A distinct, escape-proof marker per field. Recovering the order from OUTPUT
#: rather than from a constant is the whole point: it is the only check that
#: survives a renderer deciding to spell the order out for itself again.
SENTINELS = {
    "line1": "Zline1Z",
    "line2": "Zline2Z",
    "city": "ZcityZ",
    "state": "ZstateZ",
    "pincode": "ZpincodeZ",
    "country": "ZcountryZ",
}

#: Every renderer that turns a stored address into a printed one. Adding a
#: renderer means adding it here; that is the intended cost.
RENDERERS = {
    "invoice_pdf._fmt_addr": _fmt_addr,
    "doc_render.fmt_addr": fmt_addr,
}


def emitted_order(render) -> list[str]:
    """The field order this renderer actually puts on the page."""
    out = render(dict(SENTINELS))
    found = [(out.index(mark), field) for field, mark in SENTINELS.items() if mark in out]
    missing = [f for f, m in SENTINELS.items() if m not in out]
    assert not missing, f"{render} dropped fields entirely: {missing}"
    return [field for _, field in sorted(found)]


def test_the_canonical_order_is_the_one_that_was_shipped():
    """`city, state, pincode, country`, and flipping it is not a tidy-up.

    It is what every tax invoice, credit note and debit note already raised
    carries, and what `components/ui/AddressBlock.jsx` shows on screen beside
    them. It is also not redundant: a PIN does not imply its state. Measured
    live on `staging.pin_directory` 2026-08-27 — of 18,839 distinct PINs, 51
    span more than one STATE and 1,229 more than one district.
    """
    assert ADDRESS_ORDER == ("line1", "line2", "city", "state", "pincode", "country")
    assert ADDRESS_TOP + ADDRESS_BOTTOM == ADDRESS_ORDER
    # `state_code` is the seventh key on live rows and is never printed — it is
    # the numeric GST code, and "Ahmedabad, 24" reads as a house number.
    assert "state_code" not in ADDRESS_ORDER


@pytest.mark.parametrize("name", sorted(RENDERERS))
def test_each_renderer_emits_the_canonical_order(name):
    assert emitted_order(RENDERERS[name]) == list(ADDRESS_ORDER)


def test_the_renderers_agree_with_each_other():
    """The finding, stated as an assertion. Red against either old literal."""
    orders = {name: emitted_order(fn) for name, fn in RENDERERS.items()}
    distinct = {tuple(v) for v in orders.values()}
    assert len(distinct) == 1, f"the address renderers have diverged again: {orders}"


def test_the_disagreement_would_be_caught_on_a_real_address():
    """The sentinels prove order; this proves the order is the one on the page.

    The shape is a live one: all six populated `ganit_vendors.address` rows in
    Unicode Group carry exactly these keys (read-only, 2026-08-27).
    """
    addr = {
        "line1": "Seeded demo address",
        "city": "Ahmedabad",
        "state": "Gujarat",
        "pincode": "380009",
        "country": "India",
        "state_code": "24",
    }
    assert _fmt_addr(addr) == "Seeded demo address, Ahmedabad, Gujarat, 380009, India"
    # `fmt_addr` splits after line2 — a letterhead has the vertical room and an
    # invoice `<td>` does not. That difference is legitimate; the order is not.
    assert fmt_addr(addr) == "Seeded demo address<br>Ahmedabad, Gujarat, 380009, India"
    # The unprinted seventh key appears on neither.
    assert "24" not in _fmt_addr(addr)
    assert "24" not in fmt_addr(addr)


@pytest.mark.parametrize("name", sorted(RENDERERS))
def test_a_numeric_pincode_does_not_500_the_document(name):
    """`address` is `jsonb`, so a pincode may arrive as a number.

    `_fmt_addr` used to `", ".join` the raw values, and `join` on an `int`
    raises `TypeError` — on a document renderer that is a 500 on the invoice,
    not a missing line. Both now normalise in `addr_parts`.
    """
    out = RENDERERS[name]({"city": "Surat", "pincode": 395002})
    assert "395002" in out


@pytest.mark.parametrize("name", sorted(RENDERERS))
def test_the_exploded_jsonb_fossil_prints_nothing_extra(name):
    """Unicode Group's `Navrang Polymers`: 43 keys, "0".."41" spelling a
    serialised object one character per key, plus a genuine `city` that
    contradicts the exploded copy. A renderer that walked the keys it found
    would print a line of punctuation on a tax invoice; both read by NAME.
    """
    navrang = {str(i): ch for i, ch in enumerate('{"city": "Mumbai", "state": "Maharashtra"}')}
    navrang["city"] = "Navi Mumbai"
    out = RENDERERS[name](navrang)
    assert out == "Navi Mumbai"


@pytest.mark.parametrize("name", sorted(RENDERERS))
def test_a_non_dict_address_renders_empty_and_never_raises(name):
    for bad in (None, "", "12, Ashram Road", [], ["a"], 42, {"nothing": "known"}, {}):
        assert RENDERERS[name](bad) == ""


# ── the third-copy scan ─────────────────────────────────────────────────────
#
# The vocabulary written out as a sequence literal, on one line. Deliberately
# blunt: it flags any file that spells the field names out again, and the fix
# is either to import `ADDRESS_ORDER` or to add a line here saying why this one
# is not a renderer.
_KEY_RE = re.compile(r"""['"](line1|line2|city|state|pincode|country)['"]""")

#: file -> why it is allowed to name the keys itself.
_ALLOWED = {
    # The definition. Everything else imports it.
    "doc_render.py": "declares ADDRESS_ORDER",
}


def test_no_third_copy_of_the_address_vocabulary():
    services = Path(__file__).resolve().parents[1] / "services"
    offenders = []
    for path in sorted(services.glob("*.py")):
        if path.name in _ALLOWED:
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            keys = {m.group(1) for m in _KEY_RE.finditer(line)}
            # Three or more, including the two the divergence was about.
            if len(keys) >= 3 and {"city", "pincode"} <= keys:
                offenders.append(f"{path.name}:{n}: {line.strip()}")
    assert not offenders, (
        "a third copy of the address field order — import doc_render.ADDRESS_ORDER, "
        "or add the file to _ALLOWED with a reason:\n  " + "\n  ".join(offenders)
    )


def test_addr_parts_is_the_shared_normaliser():
    """Both renderers go through it, so a fix to one is a fix to both."""
    assert R.addr_parts({"pincode": "  380009  ", "city": "Ahmedabad"}) == ["Ahmedabad", "380009"]
    assert R.addr_parts({"city": None, "state": "  "}) == []
    assert R.addr_parts("not a dict") == []


def test_the_emptiness_test_covers_country_too():
    """`doc_validation._addr_blank` must read the SAME keys the renderers print.

    It was exempted from the scanner above as an "order-free emptiness test",
    which was true and beside the point: order was not what it got wrong,
    MEMBERSHIP was. It listed `line1, line2, city, state, pincode` and omitted
    `country`, so an address carrying nothing but a country was reported blank
    while both renderers would have printed it — and six live
    `ganit_vendors.address` rows carry a `country`.

    An exemption that names the wrong axis is worse than none: it invites the
    reader to stop looking. The exemption is gone and this asserts the
    behaviour instead of the source.
    """
    from services.doc_validation import _addr_blank
    from services.doc_render import ADDRESS_ORDER

    # Every printable key on its own must count as NOT blank. A key the
    # renderers would put on the page cannot be invisible to the validator.
    for key in ADDRESS_ORDER:
        assert _addr_blank({key: "something"}) is False, (
            f"_addr_blank ignores {key!r}, which the renderers print — that is "
            "the country bug in a different key"
        )

    assert _addr_blank({}) is True
    assert _addr_blank(None) is True
    # `state_code` is the numeric GST code, never printed raw, so it alone does
    # not make an address usable — it is deliberately outside ADDRESS_ORDER.
    assert _addr_blank({"state_code": "24"}) is True
