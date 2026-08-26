"""A vendor records the six MSME / TDS facts that drive Kray's two headline claims.

── What was broken ──────────────────────────────────────────────────────────
Migration 175 added `is_msme`, `enterprise_class`, `vendor_kind`,
`udyam_number`, `tds_section` and `payment_terms_days` to `ganit_vendors`, and
NOTHING has ever written any of them: measured read-only against the live
database on 2026-08-25, all six are NULL on **80 of 80** vendors. The columns,
the 43B(h) skill (`services/skills/data/vendor_compliance.py`), the payables
ageing report and their tests were all built. `VendorCreate` carried
name/gstin/email/phone/address and the form offered four inputs, so there was
no way to enter the facts — which is why the MSME 45-day clock and TDS 194Q
attribution both report an empty set.

── What these tests hold ────────────────────────────────────────────────────
1. All six columns are NAMED in the INSERT — asserted by column name and never
   by position, because `test_ganit_client_link.py:188-191` records a test that
   broke when a column was appended.
2. Blank becomes NULL, never '' and never 0. Two independent reasons and both
   bite: '' fails the live CHECK constraints, and NULL is the value the skill
   reads as "nobody has said" — a state it counts SEPARATELY from a recorded
   answer so a reader can tell which findings rest on an assumption.
3. A value outside the live CHECK comes back as a readable 400 rather than as a
   constraint violation the caller cannot act on.
4. On update, sent-and-blank CLEARS to NULL while not-sent-at-all leaves the
   column untouched. Without that distinction a compliance fact entered by
   mistake could never be taken back.
5. A vendor with nothing but a name still saves. Every one of these is
   optional; the house rule that GSTIN/PAN/TAN block nothing covers them too.

The allowlists under test mirror the constraints as they exist LIVE, read from
`pg_constraint` and not from migration 175 — an inline CHECK on an `ADD COLUMN
IF NOT EXISTS` is skipped in its entirety when the column already exists, so
the migration text is not evidence that the constraint is there.
"""
import pytest
from fastapi import HTTPException

import routers.ganit as ganit


_VENDOR_ROW = {"id": "v-1", "name": "Acme Steel"}

#: The six columns this file exists to defend. Every assertion below looks them
#: up by NAME; none of them depends on where they sit in the tuple.
_COMPLIANCE = ("is_msme", "enterprise_class", "vendor_kind",
               "udyam_number", "tds_section", "payment_terms_days")


class _Pool:
    """Records every query and its arguments; answers fetchrow with a row."""

    def __init__(self):
        self.calls = []

    async def fetchrow(self, q, *a):
        self.calls.append((q, a))
        return _VENDOR_ROW

    async def fetch(self, q, *a):
        self.calls.append((q, a))
        return []


@pytest.fixture
def pool(monkeypatch):
    p = _Pool()

    async def _get_pool():
        return p

    monkeypatch.setattr(ganit, "get_pool", _get_pool)
    return p


def _written(p, verb):
    """The one INSERT into / UPDATE of ganit_vendors, or None if nothing ran."""
    for q, a in p.calls:
        if q.lstrip().startswith(verb) and "staging.ganit_vendors" in q:
            return q, a
    return None


def _columns(q):
    """The INSERT's column names, stripped."""
    return [c.strip() for c in q[q.index("(") + 1:q.index(")")].split(",")]


async def _create(**kw):
    # `_g=None` explicitly: Depends resolves for ROUTES only, so a direct call
    # would otherwise receive the sentinel object rather than a gate result.
    return await ganit.create_vendor(
        ganit.VendorCreate(**kw), user={"user_id": "u1"}, org_id="org1", _g=None)


async def _update(**kw):
    return await ganit.update_vendor(
        "00000000-0000-0000-0000-000000000001", ganit.VendorUpdate(**kw),
        user={"user_id": "u1"}, org_id="org1", _g=None)


# ── the columns reach the INSERT at all ──────────────────────

@pytest.mark.asyncio
async def test_all_six_columns_are_named_in_the_insert(pool):
    await _create(name="Acme Steel", enterprise_class="small",
                  vendor_kind="manufacturer", is_msme=True,
                  udyam_number="UDYAM-GJ-01-0001234", tds_section="194C",
                  payment_terms_days=45)
    q, args = _written(pool, "INSERT")
    cols = _columns(q)
    for name in _COMPLIANCE:
        assert name in cols, f"{name} is not in the INSERT at all"
    assert "small" in args and "manufacturer" in args
    assert 45 in args and True in args


@pytest.mark.asyncio
async def test_the_class_is_stored_because_the_flag_is_not_the_test(pool):
    # A MEDIUM enterprise is Udyam-registered — `is_msme` is true of it — and is
    # still OUTSIDE the 45-day disallowance. `vendor_compliance.py` therefore
    # gates on the CLASS, so the class is the field that turns the clock on and
    # it has to survive the write intact.
    await _create(name="Big Co", is_msme=True, enterprise_class="medium")
    _q, args = _written(pool, "INSERT")
    assert "medium" in args


# ── blank is NULL, never '' and never 0 ──────────────────────

@pytest.mark.asyncio
async def test_blank_compliance_fields_are_written_as_null(pool):
    await _create(name="Nobody Has Said Ltd")
    _q, args = _written(pool, "INSERT")
    tail = args[6:]
    assert "" not in tail, "a blank compliance field was written as an empty string, not NULL"
    assert tail == (None, None, None, None, None, None)


@pytest.mark.asyncio
async def test_zero_payment_terms_is_kept_not_treated_as_blank(pool):
    # 0 days is a real answer (paid on delivery). Only an ABSENT value is the
    # 15-day leg of the clock, so a falsy-but-present number must not be folded
    # into NULL.
    await _create(name="Cash On Delivery Co", payment_terms_days=0)
    _q, args = _written(pool, "INSERT")
    assert 0 in args


# ── the live CHECKs, surfaced as readable errors ─────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["tiny", "MICRO ENTERPRISE", "sml"])
async def test_an_unlisted_enterprise_class_is_a_readable_400(pool, bad):
    with pytest.raises(HTTPException) as exc:
        await _create(name="Acme", enterprise_class=bad)
    assert exc.value.status_code == 400
    assert "micro" in str(exc.value.detail)
    assert _written(pool, "INSERT") is None, "a refused create still wrote a row"


@pytest.mark.asyncio
async def test_an_unlisted_vendor_kind_is_a_readable_400(pool):
    with pytest.raises(HTTPException) as exc:
        await _create(name="Acme", vendor_kind="wholesaler")
    assert exc.value.status_code == 400
    assert "trader" in str(exc.value.detail)


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", [-1, 366, 10000])
async def test_payment_terms_outside_the_live_check_is_a_400(pool, bad):
    with pytest.raises(HTTPException) as exc:
        await _create(name="Acme", payment_terms_days=bad)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_case_and_padding_do_not_make_a_valid_class_invalid(pool):
    await _create(name="Acme", enterprise_class="  Small  ", vendor_kind="TRADER")
    _q, args = _written(pool, "INSERT")
    assert "small" in args and "trader" in args


# ── udyam and tds_section are normalised, never refused ──────

@pytest.mark.asyncio
async def test_a_malformed_udyam_number_is_stored_not_refused(pool):
    # Refusing it would make the supplier unrecordable, which is the exact
    # failure mode the GSTIN/PAN/TAN rule exists to prevent. The skill reports
    # what it found rather than trusting the shape.
    await _create(name="Acme", udyam_number=" udyam-gj-1-99 ")
    _q, args = _written(pool, "INSERT")
    assert "UDYAM-GJ-1-99" in args


@pytest.mark.asyncio
async def test_tds_section_is_free_text(pool):
    # Free text BY DESIGN: the Income-tax Act 2025 renumbered the sections, so
    # the numbers live in `statute_calendar` and not in a CHECK on this table.
    # The read side normalises '194C' / 's.194C' / 'Section 194C' to one key.
    await _create(name="Acme", tds_section="Section 194C")
    _q, args = _written(pool, "INSERT")
    assert "Section 194C" in args


# ── update: sent-and-blank clears, absent leaves alone ───────

@pytest.mark.asyncio
async def test_update_touches_only_the_compliance_fields_that_were_sent(pool):
    await _update(name="Acme Renamed")
    q, _args = _written(pool, "UPDATE")
    for name in _COMPLIANCE:
        assert f"{name}=" not in q, (
            f"{name} was overwritten by an update that never mentioned it")


@pytest.mark.asyncio
async def test_a_sent_blank_clears_the_column_to_null(pool):
    # The whole point of reading `model_fields_set`: a value entered by mistake
    # has to be removable, and "" is how the form says "not recorded".
    await _update(enterprise_class="", tds_section="", payment_terms_days=None)
    q, args = _written(pool, "UPDATE")
    assert "enterprise_class=" in q and "tds_section=" in q
    assert "payment_terms_days=" in q
    assert None in args


@pytest.mark.asyncio
async def test_is_msme_false_is_written_and_not_mistaken_for_absent(pool):
    # `is_msme = FALSE` only ever EXCLUDES a vendor; it is a real answer and
    # must not be collapsed into "nobody has said".
    await _update(is_msme=False)
    q, args = _written(pool, "UPDATE")
    assert "is_msme=" in q
    assert False in args


@pytest.mark.asyncio
async def test_an_update_naming_nothing_is_still_refused(pool):
    with pytest.raises(HTTPException) as exc:
        await _update()
    assert exc.value.status_code == 400


# ── nothing here may block a save ────────────────────────────

@pytest.mark.asyncio
async def test_a_vendor_with_only_a_name_still_saves(pool):
    row = await _create(name="Just A Name")
    assert row["id"] == "v-1"
    assert _written(pool, "INSERT") is not None
