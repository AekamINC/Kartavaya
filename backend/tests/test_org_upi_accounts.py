"""The org's receiving UPI addresses — one per platform.

`staging.organisations.upi_vpa` holds ONE address. A firm holds separate
accounts with Paytm, PhonePe and Google Pay, each settling and reporting
separately, and picks which one receives; migration 129 gives it a row per
platform. UPI's interoperability does not remove the need for that — it means
anyone can PAY you from any app, not that you hold one account.

── What is actually being defended here ────────────────────────────────────

There is no payment gateway in this product and there never will be. A wrong
character in a VPA does not fail: it pays whoever does hold that handle, and
nothing bounces it back. So these tests are less about CRUD than about the
three ways this screen could quietly move money to the wrong place —

  · two defaults, so "Other UPI app" pays whichever row was read first
  · a stale `organisations.upi_vpa`, so the settings screen shows one address
    while the invoice link pays another
  · a 200 over a save that did not happen, against a table that does not exist

── The pool is a MagicMock and resolves any table name ─────────────────────

Which is why the `to_regclass` probe is stubbed explicitly in every test. A mock
answers a SELECT against a missing table happily, so the "not applied" path
would look tested while never running.
"""
import pytest

from routers import org_profile


@pytest.fixture(autouse=True)
def _fresh_probe():
    """`_upi_table` is module state and is CACHED ONCE TRUE — without this
    reset the first test to run decides the answer for every later one."""
    org_profile._upi_table = False
    yield
    org_profile._upi_table = False


def _probe(mock_pool, exists: bool, row=None):
    async def _fetchrow(query, *args):
        if "to_regclass" in query:
            return {"ok": exists}
        if "FROM staging.organisations" in query:
            return {"name": "Unicode Group"}
        return row
    mock_pool.fetchrow.side_effect = _fetchrow


PLATFORMS = ("phonepe", "gpay", "paytm", "bhim", "amazonpay", "other")


# ── Before migration 129 ─────────────────────────────────────────────────────

async def test_get_renders_every_platform_and_says_it_cannot_save(
        api_client, mock_pool, as_admin, with_org_id):
    _probe(mock_pool, False)
    body = (await api_client.get("/api/v1/org/profile/upi-accounts")).json()

    assert body["available"] is False
    # The shape does not change with the migration, so no field appears or
    # disappears between deploys.
    assert tuple(a["platform"] for a in body["accounts"]) == PLATFORMS
    assert all(a["vpa"] is None for a in body["accounts"])
    assert mock_pool.fetch.call_count == 0


async def test_put_refuses_naming_the_migration_rather_than_reporting_success(
        api_client, mock_pool, as_admin, with_org_id):
    """A 200 over a dropped write is the specific lie this screen must not tell
    — and what it would be lying about is where a customer's money goes."""
    _probe(mock_pool, False)
    resp = await api_client.put("/api/v1/org/profile/upi-accounts", json={
        "accounts": [{"platform": "paytm", "vpa": "unicode@paytm"}],
    })
    assert resp.status_code == 503
    assert "129_org_upi_accounts.sql" in resp.json()["detail"]
    assert "Nothing was saved" in resp.json()["detail"]


# ── Validation ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [
    "notavpa", "two@at@signs", "has space@ybl", "@ybl", "x@",
])
async def test_a_malformed_upi_id_is_refused(
        api_client, mock_pool, as_admin, with_org_id, bad):
    _probe(mock_pool, True)
    resp = await api_client.put("/api/v1/org/profile/upi-accounts", json={
        "accounts": [{"platform": "paytm", "vpa": bad}],
    })
    assert resp.status_code == 422


@pytest.mark.parametrize("good", [
    "unicode@ybl", "9428251061@paytm", "some.name@okhdfcbank", "a_b-c@axl",
])
async def test_a_handle_is_never_checked_against_the_platform(
        api_client, mock_pool, as_admin, with_org_id, good):
    """A PhonePe user may hold `@ybl`, `@ibl`, `@axl` or a bank handle they
    registered years ago. Refusing a working address because the suffix was not
    the one we expected leaves the user with nothing to argue with — and the
    thing they cannot then do is get paid."""
    _probe(mock_pool, True)
    resp = await api_client.put("/api/v1/org/profile/upi-accounts", json={
        "accounts": [{"platform": "phonepe", "vpa": good}],
    })
    assert resp.status_code == 200


async def test_the_id_is_stored_lower_cased(
        api_client, mock_pool, as_admin, with_org_id):
    """UPI handles are case-insensitive and get pasted with a capital from an
    app's share sheet. Storing both spellings would let one org hold what is
    really the same address twice, past a unique constraint that cannot see it."""
    _probe(mock_pool, True)
    await api_client.put("/api/v1/org/profile/upi-accounts", json={
        "accounts": [{"platform": "paytm", "vpa": "  Unicode@Paytm  "}],
    })
    written = [c for c in _conn(mock_pool).execute.await_args_list
               if "INSERT INTO staging.org_upi_accounts" in c.args[0]]
    assert written and written[0].args[3] == "unicode@paytm"


async def test_an_unknown_platform_is_refused(
        api_client, mock_pool, as_admin, with_org_id):
    _probe(mock_pool, True)
    resp = await api_client.put("/api/v1/org/profile/upi-accounts", json={
        "accounts": [{"platform": "venmo", "vpa": "xy@ybl"}],
    })
    assert resp.status_code == 422


# ── The default, which is the one that moves money ───────────────────────────

def _conn(mock_pool):
    return mock_pool.acquire.return_value.__aenter__.return_value


async def test_two_defaults_are_refused_and_named(
        api_client, mock_pool, as_admin, with_org_id):
    """Not a preference — a bug that moves money. With two defaults, "Other UPI
    app" pays whichever row came back first, which would never reproduce on
    demand."""
    _probe(mock_pool, True)
    resp = await api_client.put("/api/v1/org/profile/upi-accounts", json={
        "accounts": [
            {"platform": "paytm", "vpa": "acme@paytm", "is_default": True},
            {"platform": "gpay", "vpa": "acme@okicici", "is_default": True},
        ],
    })
    assert resp.status_code == 400
    assert "paytm" in resp.json()["detail"] and "gpay" in resp.json()["detail"]


async def test_the_first_id_becomes_the_default_when_none_was_chosen(
        api_client, mock_pool, as_admin, with_org_id):
    """An org with addresses and no default would leave the desktop QR and
    "Other UPI app" with nothing to encode — a dead button on a payment page."""
    _probe(mock_pool, True)
    await api_client.put("/api/v1/org/profile/upi-accounts", json={
        "accounts": [{"platform": "paytm", "vpa": "acme@paytm", "is_default": False}],
    })
    inserts = [c for c in _conn(mock_pool).execute.await_args_list
               if "INSERT INTO staging.org_upi_accounts" in c.args[0]]
    assert inserts[0].args[6] is True        # is_default


async def test_the_organisations_mirror_is_written_in_the_same_transaction(
        api_client, mock_pool, as_admin, with_org_id):
    """`routers/pay.py`, `admin_orgs.py` and `subscription.py` all still read
    `organisations.upi_vpa`. A stale mirror means the settings screen showing
    one address while the invoice link pays another."""
    _probe(mock_pool, True)
    await api_client.put("/api/v1/org/profile/upi-accounts", json={
        "accounts": [{"platform": "gpay", "vpa": "unicode@okhdfcbank",
                      "payee_name": "Unicode Group", "is_default": True}],
    })
    mirrors = [c for c in _conn(mock_pool).execute.await_args_list
               if "UPDATE staging.organisations" in c.args[0]]
    assert mirrors and mirrors[-1].args[2] == "unicode@okhdfcbank"


async def test_clearing_every_id_clears_the_mirror_too(
        api_client, mock_pool, as_admin, with_org_id):
    """Otherwise an org that removes its UPI details keeps taking payments to
    the address it just deleted, which is the worst possible reading of a blank
    form."""
    _probe(mock_pool, True)
    await api_client.put("/api/v1/org/profile/upi-accounts", json={
        "accounts": [{"platform": "gpay", "vpa": None}],
    })
    mirrors = [c for c in _conn(mock_pool).execute.await_args_list
               if "UPDATE staging.organisations" in c.args[0]]
    assert mirrors and mirrors[-1].args[2] is None
    deletes = [c for c in _conn(mock_pool).execute.await_args_list
               if "DELETE FROM staging.org_upi_accounts" in c.args[0]]
    assert deletes, "a blank field must clear the row, as it does for senders"


async def test_a_platform_twice_is_refused_before_anything_is_written(
        api_client, mock_pool, as_admin, with_org_id):
    _probe(mock_pool, True)
    resp = await api_client.put("/api/v1/org/profile/upi-accounts", json={
        "accounts": [
            {"platform": "paytm", "vpa": "acme@paytm"},
            {"platform": "paytm", "vpa": "acme2@paytm"},
        ],
    })
    assert resp.status_code == 400
    assert _conn(mock_pool).execute.await_count == 0


# ── The QR preview ───────────────────────────────────────────────────────────

async def test_the_preview_qr_takes_a_platform_never_a_string_to_encode(
        api_client, mock_pool, as_admin, with_org_id):
    """`?data=` would be an open redirect in QR form: a kartavaya.com URL
    rendering a code that pays somebody else's account, with our domain lending
    it credibility."""
    _probe(mock_pool, True, row={"vpa": "unicode@ybl", "payee_name": None,
                                 "org_name": "Unicode Group"})
    resp = await api_client.get("/api/v1/org/profile/upi-accounts/qr.svg?platform=phonepe")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/svg+xml")
    # Never cached: this is scanned immediately after a save, and a cached code
    # for the OLD address is the one thing the preview must not show.
    assert resp.headers["cache-control"] == "no-store"


async def test_the_preview_qr_carries_no_amount(
        api_client, mock_pool, as_admin, with_org_id):
    """The org is scanning this to read back the account name their own bank
    reports. A code with a real figure in it is one accidental confirm away from
    the firm paying itself, and a token figure trains people to ignore the
    number on a payment screen."""
    from services import upi
    uri = upi.pay_uri("unicode@ybl", "Unicode Group", None, "check")
    assert "am=" not in uri
    assert uri.startswith("upi://pay?pa=unicode%40ybl")


async def test_an_unknown_platform_has_no_preview(
        api_client, mock_pool, as_admin, with_org_id):
    _probe(mock_pool, True)
    resp = await api_client.get("/api/v1/org/profile/upi-accounts/qr.svg?platform=venmo")
    assert resp.status_code == 404


async def test_every_qr_is_a_standard_upi_code_whatever_the_platform(
        api_client, mock_pool, as_admin, with_org_id):
    """A `phonepe://` or `paytmmp://` code is an app deep link, NOT a UPI QR:
    other apps and every bank scanner reject it. The platform selects which
    ADDRESS is encoded and nothing else."""
    from services import upi
    for platform in upi.PLATFORMS:
        uri = upi.pay_uri("xy@ybl", "X", 100, platform)
        assert uri.startswith("upi://pay?")
