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

async def test_a_bad_gstin_is_SAVED_and_warned_about_never_refused(
        api_client, mock_pool, as_admin, with_org_id):
    """Owner's ruling 2026-08-08: "all gst, pan, tan needs to be non mandatory
    so no check on org page".

    This test previously asserted a 400. That was the wrong behaviour and the
    reason is not a preference: a 400 refused the WHOLE profile save, every
    unrelated field with it, on the strength of OUR check-digit implementation.
    If that implementation is wrong about some legitimate number — and there is
    no way to be sure it is not — a real firm cannot save its real GSTIN and
    has nothing to argue with.

    The number is stored as typed and the complaint comes back beside it.
    """
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "gstin": "24AAAAA0000A1Z5"}
    resp = await api_client.patch(
        "/api/v1/org/profile", json={"gstin": "24AAAAA0000A1Z5"}
    )
    assert resp.status_code == 200
    body = resp.json()
    # Warned, so a typo does not surface months later when GSTR-1 is rejected…
    assert "check digit" in body["code_warnings"]["gstin"].lower()
    # …and written, because refusing it helps nobody.
    assert mock_pool.fetchrow.called


async def test_a_bad_tan_is_saved_and_warned_about_too(
        api_client, mock_pool, as_admin, with_org_id):
    """One rule, three names. A TAN has no check digit, so shape is all there is
    — and a shape rule is exactly what turns out to be wrong about some real
    number nobody anticipated."""
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "tan": "NOTATAN"}
    resp = await api_client.patch("/api/v1/org/profile", json={"tan": "NOTATAN"})
    assert resp.status_code == 200
    assert "TAN" in resp.json()["code_warnings"]["tan"]


async def test_a_clean_save_reports_no_warnings_at_all(
        api_client, mock_pool, as_admin, with_org_id):
    """Always present, so the screen can clear a previous complaint without
    having to remember it."""
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "gstin": "24BBBBB1111B1ZT"}
    resp = await api_client.patch(
        "/api/v1/org/profile", json={"gstin": "24BBBBB1111B1ZT"})
    assert resp.json()["code_warnings"] == {}


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
