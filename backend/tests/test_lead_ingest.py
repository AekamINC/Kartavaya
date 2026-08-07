"""JustDial and IndiaMART enquiries becoming Graha contacts.

These are the two places an Indian SMB's leads actually arrive, and until this
they arrived in somebody's inbox. Nothing here has been run against a live
marketplace account — there are no real keys — so what is pinned is the part
that does not need one: the payload shapes, the dedupe, the rate-limit floor,
and the two rules that make an unauthenticated write route safe.

── THE PAYLOADS ARE THEIRS, VERBATIM ───────────────────────────────────────────

The fixtures below are the field names IndiaMART's CRM API v2 and JustDial's
lead push actually use — SHOUTED and abbreviated in the first case, and spelled
two or three different ways across account vintages in the second. They are
written out literally rather than generated, because the entire risk in this
module is a key spelled differently from what arrives, and a fixture built from
our own normaliser would agree with it by construction and prove nothing.
"""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from services import lead_ingest as li

ORG = "00000000-0000-0000-0000-0000000000aa"

INDIAMART_BODY = {
    "CODE": 200,
    "STATUS": "SUCCESS",
    "RESPONSE": [{
        "UNIQUE_QUERY_ID": "2093843749",
        "QUERY_TYPE": "W",
        "QUERY_TIME": "2026-08-07 11:32:00",
        "SENDER_NAME": "Rakesh Sharma",
        "SENDER_MOBILE": "+91-9876543210",
        "SENDER_EMAIL": "Rakesh.Sharma@Example.CO.IN",
        "SENDER_COMPANY": "Sharma Traders",
        "SUBJECT": "Requirement for 200 units",
        "QUERY_MESSAGE": "Please share your best rate and delivery time.",
        "QUERY_PRODUCT_NAME": "Industrial Fasteners",
    }],
}

JUSTDIAL_BODY = {
    "leadid": "JD-55512",
    "prefix_name": "Mr",
    "name": "Anita Desai",
    "mobile": "09876543210",
    "email": "anita@example.in",
    "category": "Chartered Accountants",
    "area": "Navrangpura",
    "date": "07-08-2026 11:40",
}


# ── 1 · the shapes ──────────────────────────────────────────────────────────

def test_indiamarts_shouted_fields_become_ours():
    leads, error = li.parse_indiamart_body(INDIAMART_BODY)
    assert error == ""
    lead, = leads
    assert lead.source == "indiamart"
    assert lead.external_id == "2093843749"
    assert lead.name == "Rakesh Sharma"
    assert lead.phone == "+91-9876543210"
    assert lead.company == "Sharma Traders"
    # SUBJECT and QUERY_MESSAGE are both enquiry text and either may be the only
    # one populated, so both are kept rather than one being chosen.
    assert "200 units" in lead.message and "best rate" in lead.message
    # The whole record survives, for the operator reconciling a missing lead.
    assert lead.raw["QUERY_TYPE"] == "W"


def test_a_refusal_from_indiamart_arrives_as_an_HTTP_200():
    """Their rate-limit and bad-key responses are 200 with a different CODE.
    An integration reading the status would report "0 new leads" every fifteen
    minutes for a week with an expired key."""
    leads, error = li.parse_indiamart_body(
        {"CODE": 429, "MESSAGE": "Rate limit exceeded", "RESPONSE": None})
    assert leads == []
    assert "Rate limit" in error


def test_a_single_indiamart_lead_arrives_unwrapped():
    body = {"CODE": 200, "RESPONSE": INDIAMART_BODY["RESPONSE"][0]}
    leads, error = li.parse_indiamart_body(body)
    assert error == "" and len(leads) == 1


def test_garbage_from_indiamart_is_an_error_not_an_exception():
    for body in ("<html>502</html>", None, [], {"RESPONSE": "nope"}):
        leads, error = li.parse_indiamart_body(body)
        assert leads == [] and error


def test_justdials_field_names_vary_and_all_of_them_are_accepted():
    """Spelled differently across account vintages, and this route is fed by a
    party we cannot ask to change. A lead dropped because a key was spelled
    another way is a lead nobody knows was lost."""
    a = li.normalise_justdial(JUSTDIAL_BODY)
    assert a.external_id == "JD-55512" and a.name == "Anita Desai"
    assert a.phone == "09876543210"

    b = li.normalise_justdial({"lead_id": "X1", "customer_name": "R Patel",
                               "mobile_number": "9812345678", "email_id": "r@e.in"})
    assert b.external_id == "X1" and b.name == "R Patel"
    assert b.phone == "9812345678" and b.email == "r@e.in"


def test_a_lead_with_no_way_to_reach_anybody_is_not_a_lead():
    """A row with a name and no phone or email cannot be actioned, and it
    dilutes every count on the CRM screens with rows nobody can work."""
    assert not li.normalise_justdial({"name": "Someone"}).usable
    assert li.normalise_justdial({"name": "Someone", "mobile": "9876543210"}).usable


def test_every_field_is_capped():
    """Both bodies arrive from a third party and one route is unauthenticated.
    A marketplace that starts sending a 40kB message must not grow a row without
    bound."""
    lead = li.normalise_justdial({"name": "A" * 9000, "mobile": "9" * 9000,
                                  "category": "B" * 9000})
    assert len(lead.name) <= li.MAX_SHORT
    assert len(lead.message) <= li.MAX_TEXT


# ── 2 · the window ──────────────────────────────────────────────────────────

NOW = datetime(2026, 8, 7, 12, 0, tzinfo=timezone.utc)


def test_the_window_resumes_from_the_last_pull_rather_than_a_fixed_lookback():
    """A scheduler that missed six hours must catch up, not lose them."""
    start, end = li.indiamart_window(NOW - timedelta(hours=6), NOW)
    assert start.startswith("07-Aug-2026")
    assert "05:59" in start, "one minute of overlap, deliberately"
    assert end == "07-Aug-202612:00:00"


def test_the_window_is_clamped_to_their_seven_day_ceiling():
    """A first run against an account collecting for a year would otherwise ask
    for a year and be refused."""
    start, _ = li.indiamart_window(NOW - timedelta(days=400), NOW)
    assert start.startswith("31-Jul-2026")


def test_a_first_ever_pull_asks_for_one_day():
    start, _ = li.indiamart_window(None, NOW)
    assert start.startswith("06-Aug-2026")


# ── 3 · what counts as the same person ──────────────────────────────────────

def _pool(existing=None):
    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value=existing)
    pool.fetchval = AsyncMock(return_value="new-id")
    pool.execute = AsyncMock(return_value=None)
    return pool


@pytest.mark.asyncio
async def test_a_new_lead_is_written_as_a_lead_in_the_callers_org():
    pool = _pool(None)
    lead = li.normalise_justdial(JUSTDIAL_BODY)
    out = await li.ingest(pool, ORG, [lead])

    assert out == {"created": 1, "updated": 0, "skipped": 0, "received": 1}
    sql = " ".join(pool.fetchval.call_args[0][0].split())
    args = pool.fetchval.call_args[0][1:]
    assert "INSERT INTO staging.graha_contacts" in sql
    assert "'lead'" in sql, "contact_type"
    # org_id comes from the credentials row the URL resolved to — never from the
    # payload. A marketplace cannot name the org its leads land in.
    assert args[0] == ORG
    custom = json.loads(args[-1])
    assert custom["source"] == "justdial" and custom["external_id"] == "JD-55512"
    assert custom["raw"]["category"] == "Chartered Accountants"


@pytest.mark.asyncio
async def test_the_same_person_twice_updates_rather_than_duplicating():
    """A second contact row is worse than a missed lead — the salesperson calls
    someone who was called yesterday and neither row shows the other's
    history."""
    pool = _pool({"id": "existing-1", "notes": "earlier note"})
    out = await li.ingest(pool, ORG, [li.normalise_justdial(JUSTDIAL_BODY)])

    assert out["created"] == 0 and out["updated"] == 1
    pool.fetchval.assert_not_called()
    sql = " ".join(pool.execute.call_args[0][0].split())
    assert sql.startswith("UPDATE staging.graha_contacts")
    # The enquiry is APPENDED. Overwriting the first throws away the evidence
    # that this lead is warm.
    assert "|| $2" in sql
    # THEY contacted US. Resetting last_contacted_at would hide the lead from
    # the overdue-follow-up report that exists to surface exactly these.
    assert "last_contacted_at" not in sql


@pytest.mark.asyncio
async def test_the_match_is_tried_by_source_id_then_phone_then_email():
    pool = _pool(None)
    await li.ingest(pool, ORG, [li.normalise_indiamart(INDIAMART_BODY["RESPONSE"][0])])
    sql = " ".join(pool.fetchrow.call_args[0][0].split())
    args = pool.fetchrow.call_args[0][1:]
    assert "custom_data->>'external_id'" in sql
    assert "phone_norm" in sql and "email_norm" in sql
    assert "org_id=$1::uuid" in sql, "the lookup must be org-scoped"
    assert "merged_into_id IS NULL" in sql, "a merged-away contact is not a match"
    # The keys must be computed exactly as migration 024's generated columns do,
    # or every lead inserts a duplicate: last ten digits, lowercased email.
    assert args[3] == "9876543210", "+91-9876543210 → last ten digits"
    assert args[4] == "rakesh.sharma@example.co.in"


def test_a_short_number_produces_no_phone_key():
    """`right('123', 10)` returns '123', which would make garbage numbers match
    each other. Migration 024 guards on length and so does this."""
    assert li._phone_key("123") is None
    assert li._phone_key("+91 98765 43210") == "9876543210"


@pytest.mark.asyncio
async def test_one_bad_lead_does_not_abandon_the_batch():
    """A pull that raised halfway would also not advance its watermark, so the
    next run would re-read the same window and fail in the same place."""
    pool = _pool(None)
    pool.fetchval = AsyncMock(side_effect=[RuntimeError("boom"), "id-2"])
    good = li.normalise_justdial({"mobile": "9876543210", "name": "A"})
    also = li.normalise_justdial({"mobile": "9876500000", "name": "B"})
    out = await li.ingest(pool, ORG, [good, also])
    assert out == {"created": 1, "updated": 0, "skipped": 1, "received": 2}


# ── 4 · the unauthenticated door ────────────────────────────────────────────

def test_the_webhook_key_is_long_enough_to_be_the_credential():
    """The JustDial route cannot be authenticated — they send no signature and
    no shared secret. The URL IS the credential, so a short or sequential key
    would let anyone write leads into any org."""
    key = li.new_webhook_key()
    assert len(key) >= 32
    assert key != li.new_webhook_key()


def test_the_webhook_looks_the_org_up_by_a_PUBLIC_field():
    """`public_fields->>'webhook_key'`, not the encrypted half. A lookup that
    had to decrypt candidate rows to find a match would be an oracle over every
    org's secrets."""
    import inspect
    from routers import lead_sources

    src = " ".join(inspect.getsource(lead_sources.justdial_webhook).split())
    assert "public_fields->>'webhook_key'" in src
    assert "is_active=TRUE" in src
    # The CALL, not the word — the comment above that query explains why it
    # decrypts nothing, and a substring test would fail on the explanation.
    assert "unseal(" not in src and "encryption." not in src


def test_an_unknown_key_is_a_404_and_a_bad_body_is_not():
    """A push integration that receives a 4xx retries, then disables the
    endpoint. A body we could not parse is not something a retry fixes — but an
    unknown key is somebody else entirely and must not look like a working
    endpoint."""
    import inspect
    from routers import lead_sources

    src = " ".join(inspect.getsource(lead_sources.justdial_webhook).split())
    assert 'HTTPException(404, "Not found")' in src
    assert 'return {"ok": True, "stored": 0, "note": "body was not JSON"}' in src


def test_the_pull_refuses_inside_indiamarts_own_rate_limit():
    import inspect
    from routers import lead_sources

    src = " ".join(inspect.getsource(lead_sources.pull_indiamart).split())
    assert "429" in src
    assert "INDIAMART_MIN_INTERVAL" in src
    assert li.INDIAMART_MIN_INTERVAL == timedelta(minutes=15)


def test_the_watermark_advances_only_on_a_clean_pull():
    """Advancing it after a partial failure is how a window gets skipped and the
    leads inside it are lost with nothing to show they existed."""
    import inspect
    from routers import lead_sources

    src = " ".join(inspect.getsource(lead_sources.pull_indiamart).split())
    assert "advance_watermark=False" in src, "the failure path must not advance"
    assert "advance_watermark=True" in src
