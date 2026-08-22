"""Per-org document prefixes, and the customer's reference on an invoice.

The prefix was hardcoded, so every firm on the platform numbered its invoices
INV-YYYY-NNNN whether that matched its books or not.

THE VALUE REACHES A GST DOCUMENT SERIAL. `utils.next_doc_number` builds
`PREFIX-YYYY-NNNN` by concatenation and reads the last one back to increment
it, so a prefix carrying a digit or a hyphen makes the series unparseable by
its own reader — and the next document restarts at 0001 for ever. That is why
the validation here is strict rather than permissive, and why these tests exist
at all.
"""
import pytest

from routers.ganit import DEFAULT_DOC_PREFIXES, _doc_prefix
from routers.org_profile import BUILTIN_PREFIXES, DOC_TYPES


class _Pool:
    """A pool that answers one settings lookup."""

    def __init__(self, value=None, raises=False):
        self._value = value
        self._raises = raises
        self.asked = None

    async def fetchval(self, q, *args):
        if self._raises:
            raise RuntimeError("settings is not an object")
        self.asked = (q, args)
        return self._value


ORG = "00000000-0000-0000-0000-000000000001"


def test_the_two_prefix_maps_agree():
    """`ganit` mints the number and `org_profile` shows the default beside the
    override. If they drift, the settings screen advertises a default the
    allocator does not use — and nobody would find out until an invoice came
    out numbered differently from what the screen promised."""
    assert DEFAULT_DOC_PREFIXES == BUILTIN_PREFIXES
    assert set(DOC_TYPES) == set(DEFAULT_DOC_PREFIXES)


@pytest.mark.asyncio
async def test_an_org_that_has_said_nothing_gets_the_builtin():
    for doc_type, expected in DEFAULT_DOC_PREFIXES.items():
        assert await _doc_prefix(_Pool(None), ORG, doc_type) == expected


@pytest.mark.asyncio
async def test_an_org_override_is_used():
    assert await _doc_prefix(_Pool("AEK"), ORG, "tax_invoice") == "AEK"


@pytest.mark.asyncio
async def test_the_override_is_sanitised_not_trusted():
    """Whatever is in settings, what reaches the serial is letters only.

    A row could predate the validating endpoint, or be written by hand. The
    allocator must not be the place that discovers a bad value.
    """
    # Digits and hyphens are the two that break `PREFIX-YYYY-NNNN` when it is
    # parsed back.
    assert await _doc_prefix(_Pool("AEK-2026"), ORG, "tax_invoice") == "AEK"
    assert await _doc_prefix(_Pool("INV2026"), ORG, "tax_invoice") == "INV"
    assert await _doc_prefix(_Pool("  aek  "), ORG, "tax_invoice") == "AEK"


@pytest.mark.asyncio
async def test_an_unusable_override_falls_back_rather_than_blocking_invoicing():
    """A prefix with no letters in it leaves nothing to use. Falling back is
    right: refusing would mean a firm cannot raise an invoice because of a
    settings value, which is a worse failure than an unexpected prefix."""
    assert await _doc_prefix(_Pool("2026"), ORG, "tax_invoice") == "INV"
    assert await _doc_prefix(_Pool("---"), ORG, "credit_note") == "CN"
    assert await _doc_prefix(_Pool(""), ORG, "debit_note") == "DN"


@pytest.mark.asyncio
async def test_a_read_failure_never_stops_an_invoice():
    """`settings` holding something that is not an object, or the read failing
    at all, must not take the invoice-create path down with it."""
    assert await _doc_prefix(_Pool(raises=True), ORG, "tax_invoice") == "INV"


@pytest.mark.asyncio
async def test_an_unknown_document_type_still_yields_a_prefix():
    """Defensive: a type the map does not know falls back to INV rather than
    returning None, which would concatenate as 'None-2026-0001'."""
    assert await _doc_prefix(_Pool(None), ORG, "something_new") == "INV"


@pytest.mark.asyncio
async def test_a_prefix_is_capped_so_a_serial_stays_readable():
    long = "ABCDEFGHIJKLMNOP"
    got = await _doc_prefix(_Pool(long), ORG, "tax_invoice")
    assert got == long[:8]
    assert len(got) <= 8


def test_the_customer_reference_is_declared_on_the_request():
    """The field has to be declared or Pydantic drops it silently — the exact
    failure the salary-structure switches hit, where the API accepted the
    request and stored nothing."""
    from routers.ganit import InvoiceCreate
    assert "customer_ref" in InvoiceCreate.model_fields


def test_the_invoice_list_returns_the_reference_and_a_creator_NAME():
    """Read the source: `created_by` is a user id and must be resolved to a
    name before it leaves the API, and the ladder must NOT fall back to email
    the way `graha.py:1466` does."""
    import inspect
    from routers import ganit

    src = inspect.getsource(ganit.list_invoices)
    assert "i.customer_ref" in src
    assert "created_by_name" in src
    assert "LEFT JOIN public.users u ON u.user_id = i.created_by" in src

    # The privacy rule, stated as a test: no email anywhere in the SQL.
    #
    # COMMENTS ARE STRIPPED FIRST. The prose above this query explains WHY the
    # ladder must not fall back to `u.email` — and the first version of this
    # test matched that explanation and failed on it, which would have taught
    # the next reader to delete the comment rather than keep the property.
    code = " ".join(
        line for line in src.splitlines()
        if not line.lstrip().startswith("#"))
    assert "u.email" not in code, (
        "the creator-name ladder falls back to an email address, which prints "
        "a person's address into a table column")
