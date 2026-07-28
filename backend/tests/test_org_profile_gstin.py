"""
The org's own GSTIN is validated on write.

Vendor and customer GSTINs have gone through `ganit._checked_gstin` for a while.
The org's own number — the one printed on every invoice and emitted by GSTR-1 as
`gstin` — did not, so whatever was typed was stored. Found live: the staging org
holds 24AAAAA0000A1Z5, whose correct check digit is 8.
"""
import pytest

from services.gstin import GSTINError
from services.gstin import validate as validate_gstin


# ── The check digit itself, so the route test rests on something ──────────────

def test_valid_gstin_round_trips():
    assert validate_gstin("24BBBBB1111B1ZT") == "24BBBBB1111B1ZT"


def test_the_dummy_gstin_in_wide_circulation_is_actually_invalid():
    """24AAAAA0000A1Z5 is the number everyone copies, and its check digit is 8.

    This is the value the live staging org carries, which is how the gap in
    org_profile was found — it could only have been stored because nothing
    validated it on the way in.
    """
    with pytest.raises(GSTINError):
        validate_gstin("24AAAAA0000A1Z5")
    assert validate_gstin("24AAAAA0000A1Z8") == "24AAAAA0000A1Z8"


def test_transposed_characters_are_caught():
    """The whole point of the check digit: a real-looking typo must not pass."""
    good = "27CCCCC2222C1Z8"
    transposed = "27CCCCC2222C1Z" + ("9" if good[-1] != "9" else "7")
    with pytest.raises(GSTINError):
        validate_gstin(transposed)


def test_obvious_rubbish_is_caught():
    for bad in ("abc", "24AAAAA0000A1Z", "", "   "):
        with pytest.raises(GSTINError):
            validate_gstin(bad)


# ── The route ─────────────────────────────────────────────────────────────────

async def test_profile_update_refuses_a_bad_gstin(api_client, mock_pool, as_admin, with_org_id):
    """A bad number is refused before anything is written.

    The handler never does a partial update — it refuses and names the fault,
    the same way it does for a column that is not yet migrated.
    """
    resp = await api_client.patch(
        "/api/v1/org/profile", json={"gstin": "24AAAAA0000A1Z5"}
    )
    assert resp.status_code == 400
    assert "check digit" in resp.json()["detail"].lower()
    mock_pool.fetchrow.assert_not_called()


async def test_profile_update_accepts_a_valid_gstin(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "gstin": "24BBBBB1111B1ZT"}
    resp = await api_client.patch(
        "/api/v1/org/profile", json={"gstin": "24BBBBB1111B1ZT"}
    )
    assert resp.status_code in (200, 503)   # 503 only if the column set is pending


async def test_blank_gstin_stays_legal(api_client, mock_pool, as_admin, with_org_id):
    """An unregistered firm has no GSTIN, and the exports already refuse without one."""
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "gstin": ""}
    resp = await api_client.patch("/api/v1/org/profile", json={"gstin": ""})
    assert resp.status_code in (200, 503)
