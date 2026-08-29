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


def _body(fn) -> str:
    """A function's source with its docstring removed.

    These handlers explain in prose what they deliberately do NOT do, so a
    substring test over the raw source fails on the explanation rather than on
    the code. Learned twice in one day; written down here the second time.
    """
    import ast, inspect, textwrap
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    node = tree.body[0]
    body = node.body[1:] if ast.get_docstring(node) else node.body
    return " ".join(" ".join(ast.unparse(n) for n in body).split())

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
    """A pool that can also hand out a connection.

    `ingest` writes the contact and its `contact.created` event in ONE
    transaction — `async with pool.acquire() as conn: async with
    conn.transaction():` — so the INSERT moved off the pool and onto a
    connection. Without `acquire`, `async with` got a bare coroutine and every
    lead was counted as `skipped` with the reason swallowed into the batch's
    own "could not be stored" handler, which reads exactly like a product bug
    and is not one. `tests/conftest.py::make_pool` carries the same shape and
    the same story.

    `conn.fetchrow` is SEPARATE from `pool.fetchrow` here, unlike conftest: the
    pool's answer models a pre-existing contact lookup, while the connection's
    models the INSERT ... RETURNING *. One mock cannot be both.
    """
    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value=existing)
    pool.fetchval = AsyncMock(return_value="new-id")
    pool.execute = AsyncMock(return_value=None)

    conn = MagicMock()
    conn.__aenter__ = AsyncMock(return_value=conn)
    conn.__aexit__ = AsyncMock(return_value=False)
    conn.fetchrow = AsyncMock(return_value={
        "id": "new-id", "name": "JustDial enquiry", "contact_type": "lead",
        "source": "integration:justdial", "company": None, "client_id": None,
        "assigned_to": None, "email": None, "phone": "+919876500011",
    })
    conn.execute = AsyncMock(return_value=None)
    conn.fetchval = AsyncMock(return_value=None)
    txn = MagicMock()
    txn.__aenter__ = AsyncMock(return_value=txn)
    txn.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=txn)
    pool.acquire = MagicMock(return_value=conn)
    return pool


@pytest.mark.asyncio
async def test_a_new_lead_is_written_as_a_lead_in_the_callers_org(monkeypatch):
    async def _dupes(pool, org_id, **kw):
        return []
    monkeypatch.setattr("services.contact_dedupe.find_duplicates", _dupes)

    pool = _pool(None)
    lead = li.normalise_justdial(JUSTDIAL_BODY)
    out = await li.ingest(pool, ORG, [lead])

    assert out == {"created": 1, "updated": 0, "skipped": 0, "received": 1}
    # The INSERT runs on the CONNECTION now: the contact and its
    # `contact.created` event share one transaction, so the event exists if and
    # only if the contact does.
    conn = pool.acquire.return_value
    sql = " ".join(conn.fetchrow.call_args[0][0].split())
    args = conn.fetchrow.call_args[0][1:]
    assert "INSERT INTO public.graha_contacts" in sql
    assert "'lead'" in sql, "contact_type"
    # org_id comes from the credentials row the URL resolved to — never from the
    # payload. A marketplace cannot name the org its leads land in.
    assert args[0] == ORG
    custom = json.loads(args[-1])
    assert custom["source"] == "justdial" and custom["external_id"] == "JD-55512"
    assert custom["raw"]["category"] == "Chartered Accountants"


@pytest.mark.asyncio
async def test_the_same_person_twice_updates_rather_than_duplicating(monkeypatch):
    """A second contact row is worse than a missed lead — the salesperson calls
    someone who was called yesterday and neither row shows the other's
    history."""
    async def _dupes(pool, org_id, **kw):
        return [{"id": "existing-1", "match_type": "phone", "confidence": 1.0}]
    monkeypatch.setattr("services.contact_dedupe.find_duplicates", _dupes)

    pool = _pool(None)
    out = await li.ingest(pool, ORG, [li.normalise_justdial(JUSTDIAL_BODY)])

    assert out["created"] == 0 and out["updated"] == 1
    pool.acquire.return_value.fetchrow.assert_not_called()

    statements = [" ".join(c[0][0].split()) for c in pool.execute.call_args_list]
    # The enquiry lands in the CRM TIMELINE, the same way `POST /inbound-leads`
    # records it — so an enquiry arriving by API and one arriving by
    # notification email are indistinguishable to the salesperson.
    assert any("INSERT INTO public.graha_activities" in s for s in statements)
    # THEY contacted US. Resetting last_contacted_at would hide the lead from
    # the overdue-follow-up report that exists to surface exactly these.
    assert not any("last_contacted_at" in s for s in statements)


@pytest.mark.asyncio
async def test_dedupe_delegates_to_the_products_one_dedupe(monkeypatch):
    """`contact_dedupe` mirrors migration 024's generated columns and is called
    by every inbound path. A private copy of that normalisation in here is the
    drift its docstring exists to prevent — this asserts there isn't one."""
    seen = {}

    async def _dupes(pool, org_id, **kw):
        seen.update(kw)
        return []
    monkeypatch.setattr("services.contact_dedupe.find_duplicates", _dupes)

    pool = _pool(None)
    await li.ingest(pool, ORG, [li.normalise_indiamart(INDIAMART_BODY["RESPONSE"][0])])

    assert seen == {"email": "Rakesh.Sharma@Example.CO.IN", "phone": "+91-9876543210"}
    # Normalisation is that function's job, not ours — it is handed the raw
    # values and mirrors migration 024 itself.
    import inspect
    src = inspect.getsource(li)
    assert "digits[-10:]" not in src, "a third copy of the phone rule"
    assert ".strip().lower()" not in src, "a third copy of the email rule"


@pytest.mark.asyncio
async def test_a_fuzzy_match_is_never_attached_to(monkeypatch):
    """`find_duplicates` also returns name+company trigram matches for HUMAN
    review. Attaching a marketplace lead to the wrong person on a name
    similarity is not recoverable by the salesperson who then calls them."""
    async def _dupes(pool, org_id, **kw):
        return [{"id": "maybe-1", "match_type": "fuzzy", "confidence": 0.78}]
    monkeypatch.setattr("services.contact_dedupe.find_duplicates", _dupes)

    pool = _pool(None)
    out = await li.ingest(pool, ORG, [li.normalise_justdial(JUSTDIAL_BODY)])
    assert out["created"] == 1, "a fuzzy hit must create, not merge"


@pytest.mark.asyncio
async def test_the_source_id_is_matched_before_anything_else(monkeypatch):
    """The same enquiry arriving twice — a re-read window, a retried push. And
    scoped to the SOURCE: JustDial's "55512" and IndiaMART's are not one
    enquiry."""
    async def _dupes(pool, org_id, **kw):
        raise AssertionError("the external id should have answered first")
    monkeypatch.setattr("services.contact_dedupe.find_duplicates", _dupes)

    pool = _pool({"id": "existing-1"})
    out = await li.ingest(pool, ORG, [li.normalise_justdial(JUSTDIAL_BODY)])
    assert out["updated"] == 1

    sql = " ".join(pool.fetchrow.call_args[0][0].split())
    assert "custom_data->>'external_id'" in sql
    assert "custom_data->>'source'" in sql
    assert "org_id=$1::uuid" in sql, "the lookup must be org-scoped"
    assert "merged_into_id IS NULL" in sql, "a merged-away contact is not a match"


@pytest.mark.asyncio
async def test_one_bad_lead_does_not_abandon_the_batch(monkeypatch):
    """A pull that raised halfway would also not advance its watermark, so the
    next run would re-read the same window and fail in the same place."""
    async def _dupes(pool, org_id, **kw):
        return []
    monkeypatch.setattr("services.contact_dedupe.find_duplicates", _dupes)

    pool = _pool(None)
    # The failure has to be injected where the INSERT actually runs. It used to
    # be `pool.fetchval`; the contact and its event now share a transaction, so
    # the statement is `conn.fetchrow` and a stub on the old name would let both
    # leads succeed while the test still claimed one was skipped.
    pool.acquire.return_value.fetchrow = AsyncMock(
        side_effect=[RuntimeError("boom"), {"id": "id-2", "name": "B",
                                            "contact_type": "lead"}])
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

    # Asserted on the SHARED implementation, which the button and the cron both
    # call — a limit enforced in only one of two copies is not enforced.
    src = " ".join(inspect.getsource(lead_sources.pull_indiamart_for_org).split())
    assert "429" in src
    assert "INDIAMART_MIN_INTERVAL" in src
    assert li.INDIAMART_MIN_INTERVAL == timedelta(minutes=15)


def test_the_watermark_advances_only_on_a_clean_pull():
    """Advancing it after a partial failure is how a window gets skipped and the
    leads inside it are lost with nothing to show they existed."""
    import inspect
    from routers import lead_sources

    src = " ".join(inspect.getsource(lead_sources.pull_indiamart_for_org).split())
    assert "advance_watermark=False" in src, "the failure path must not advance"
    assert "advance_watermark=True" in src


def test_the_schedule_only_touches_orgs_that_opted_in():
    """`_for_each_org` would walk every organisation on the platform to discover
    that almost none have an IndiaMART key. The credentials table is the list."""
    import inspect
    from routers import scheduler

    # The BODY, not the source — this handler's docstring explains why
    # `_for_each_org` is not used, and a substring test would fail on the
    # explanation. The same lesson as test_platform_privacy.py.
    src = _body(scheduler.run_leads)
    assert "hub_connector_credentials" in src and "platform='indiamart'" in src
    assert "is_active=TRUE" in src
    assert "_for_each_org" not in src


def test_one_expired_key_does_not_stop_every_other_org():
    """And a 429 is the ORDINARY case on a 15-minute schedule — an org pulled by
    hand a moment ago is simply not due, not broken."""
    import inspect
    from routers import scheduler

    src = " ".join(inspect.getsource(scheduler.run_leads).split())
    assert "except PullResult" in src
    assert "stop.status == 429" in src
    assert "not_due" in src


def test_justdial_is_not_polled():
    """It PUSHES. Polling for something already being pushed would be two paths
    to the same rows, and the slower one wins the race half the time."""
    import inspect
    from routers import scheduler

    assert "justdial" not in _body(scheduler.run_leads).lower()
