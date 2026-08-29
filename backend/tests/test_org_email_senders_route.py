"""The sender settings endpoints, against a database that does not have the table.

`migrations/110_org_email_senders.sql` is a FILE and is not applied. Staging and
production share one database, so nothing here applies it — which means THE PATH
THIS FILE TESTS IS THE PATH THAT IS LIVE, for every org, right now.

Naming a missing relation in a SELECT raises `UndefinedTableError`. An unguarded
GET would therefore 500 the whole Senders tab, and an unguarded PUT would 500 on
save. `org_profile.py` already had the answer 300 lines further up — the
`_available_columns` probe for `PROPOSED_068` — and this is the same shape:

  · GET answers with all nine buckets and `available: false`, so the screen
    renders and can say why it is disabled.
  · PUT answers 503 NAMING THE MIGRATION. It does not answer 200 over a write it
    did not make; that is exactly the behaviour `TabProfile.jsx` refused to build
    a control against.

── THE POOL IS A MagicMock AND RESOLVES ANY TABLE NAME ─────────────────────

Which is why the probe result is stubbed EXPLICITLY in each test rather than
left to the mock's default. A mock that happily answers a SELECT against a table
that does not exist would let the "table is absent" path be untested while
looking tested, and the "table is present" path is the one no live database can
demonstrate yet.
"""
import pytest

from routers import org_profile
from services import email_senders as es


@pytest.fixture(autouse=True)
def _fresh_probe():
    """`_senders_table` is module state and it is CACHED ONCE TRUE.

    Without this reset, whichever test runs first decides the answer for the
    rest of the file — and, worse, for every other test module in the session.
    """
    org_profile._senders_table = False
    es._reset_for_tests()
    yield
    org_profile._senders_table = False
    es._reset_for_tests()


def _probe(mock_pool, exists: bool):
    """Answer only the `to_regclass` probe; everything else keeps its default."""
    async def _fetchrow(query, *args):
        if "to_regclass" in query:
            return {"ok": exists}
        return None
    mock_pool.fetchrow.side_effect = _fetchrow


NINE = ("invoice", "sales", "payroll", "crm", "notifications",
        "attendance", "hr", "marketing", "no-reply")


# ── The table is not there, which is today ───────────────────────────────────

async def test_get_returns_all_nine_buckets_and_says_it_cannot_save(
        api_client, mock_pool, as_admin, with_org_id):
    _probe(mock_pool, False)
    resp = await api_client.get("/api/v1/org/profile/senders")
    assert resp.status_code == 200

    body = resp.json()
    assert body["available"] is False
    # The shape does not change with the migration. The screen renders nine rows
    # either way, so a field cannot appear and disappear between deploys.
    assert tuple(s["purpose"] for s in body["senders"]) == NINE
    assert all(s["from_email"] is None for s in body["senders"])
    assert all(s["is_verified"] is False for s in body["senders"])
    # And it names what every message is currently sent as, because "not
    # configured" is not an answer to "where is my mail coming from".
    import email_service
    assert body["fallback"] == email_service.FROM_EMAIL


async def test_get_does_not_query_a_table_that_does_not_exist(
        api_client, mock_pool, as_admin, with_org_id):
    _probe(mock_pool, False)
    await api_client.get("/api/v1/org/profile/senders")
    # `pool.fetch` is where the SELECT against org_email_senders would go, and
    # against a real database it would raise UndefinedTableError and 500 the
    # tab. The mock would have answered it happily, which is why this asserts on
    # the call and not on the status code.
    assert mock_pool.fetch.call_count == 0


async def test_put_refuses_and_names_the_migration(
        api_client, mock_pool, as_admin, with_org_id):
    _probe(mock_pool, False)
    resp = await api_client.put(
        "/api/v1/org/profile/senders",
        json={"senders": [{"purpose": "payroll",
                           "from_email": "payroll@unicodegroup.com"}]},
    )
    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert "110_org_email_senders.sql" in detail
    assert "Nothing was saved" in detail
    assert mock_pool.acquire.call_count == 0


# ── Validation, which runs before anything reaches the database ──────────────

async def test_a_purpose_outside_the_nine_is_refused_by_name(
        api_client, mock_pool, as_admin, with_org_id):
    _probe(mock_pool, True)
    resp = await api_client.put(
        "/api/v1/org/profile/senders",
        json={"senders": [{"purpose": "billing", "from_email": "b@u.example"}]},
    )
    # 422 from pydantic, and the message has to carry the nine legal values —
    # a bare "invalid" sends the user to support.
    assert resp.status_code == 422
    assert "no-reply" in resp.text


async def test_a_display_name_inside_the_address_field_is_refused(
        api_client, mock_pool, as_admin, with_org_id):
    _probe(mock_pool, True)
    resp = await api_client.put(
        "/api/v1/org/profile/senders",
        json={"senders": [{"purpose": "payroll",
                           "from_email": "Payroll <payroll@unicodegroup.com>"}]},
    )
    assert resp.status_code == 422


async def test_a_newline_in_the_address_is_refused(
        api_client, mock_pool, as_admin, with_org_id):
    """Header injection, at the layer that produces a message the user can act on.

    Three layers guard this and they are not redundant: 110's CHECK stops a
    hand-written row, `email_senders` strips control characters on read (the
    boundary, because a psql session or a restore never passes through here),
    and this one turns the mistake into a 422 instead of a 500.
    """
    _probe(mock_pool, True)
    for bad in ("payroll@unicodegroup.com\nBcc: attacker@evil.example",
                "payroll@unicodegroup.com\r\nBcc: attacker@evil.example"):
        resp = await api_client.put(
            "/api/v1/org/profile/senders",
            json={"senders": [{"purpose": "payroll", "from_email": bad}]},
        )
        assert resp.status_code == 422, bad


async def test_a_newline_in_the_display_name_is_refused(
        api_client, mock_pool, as_admin, with_org_id):
    _probe(mock_pool, True)
    resp = await api_client.put(
        "/api/v1/org/profile/senders",
        json={"senders": [{"purpose": "payroll",
                           "from_email": "payroll@unicodegroup.com",
                           "from_name": "Payroll\r\nBcc: attacker@evil.example"}]},
    )
    assert resp.status_code == 422


async def test_the_same_bucket_twice_is_refused_before_anything_is_written(
        api_client, mock_pool, as_admin, with_org_id):
    _probe(mock_pool, True)
    resp = await api_client.put(
        "/api/v1/org/profile/senders",
        json={"senders": [
            {"purpose": "payroll", "from_email": "a@u.example"},
            {"purpose": "payroll", "from_email": "b@u.example"},
        ]},
    )
    # Whichever landed last would silently win, and the screen would show one
    # address while the product used the other.
    assert resp.status_code == 400
    assert mock_pool.acquire.call_count == 0


# ── is_verified is not a field a client can set ──────────────────────────────

def test_the_request_model_has_no_is_verified_field():
    """THE CONTROL THAT WOULD LIE.

    An unverified From is not a soft failure — Resend answers 403 and SES
    answers MessageRejected, so the message does not go at all. Verification is
    DNS, confirmed in the provider's dashboard, and nothing in this product can
    perform it or learn that it happened.

    Asserted on the MODEL rather than by POSTing the key, because pydantic drops
    unknown keys silently: a request naming `is_verified` returns 200 either
    way, so a route-level test would pass against a model that DID accept it.
    """
    assert "is_verified" not in org_profile.SenderRow.model_fields
    assert set(org_profile.SenderRow.model_fields) == {
        "purpose", "from_email", "from_name",
    }


def test_the_upsert_drops_verification_when_the_domain_changes():
    """Verification survives a display-name edit and dies with a domain change.

    Both providers verify the DOMAIN, so payroll@acme -> payroll2@acme is still
    covered; payroll@acme -> payroll@other is not, and carrying the old TRUE
    across would send the next payslip from an address the provider rejects.

    Asserted on the statement text. The pool is a MagicMock and would report
    success for any SQL whatever, so executing it proves nothing — this is the
    one place where reading the string is the stronger test.
    """
    sql = " ".join(org_profile._UPSERT_SENDER.split())
    assert "ON CONFLICT (org_id, purpose) DO UPDATE" in sql
    assert "split_part(EXCLUDED.from_email, '@', 2)" in sql
    assert "is_verified = ( public.org_email_senders.is_verified AND" in sql
