"""GET /v1/hub/skills/requests — the other end of the request the customer files.

`POST /v1/hub/skills/{template_id}/request` has been complete for a while: it
writes the row, it is idempotent on a partial unique index, and it mails the
account contact. What it did NOT have was a reader. Nothing anywhere in this
product selected from `staging.hub_skill_requests` except the customer's own
catalogue, which reads back only its OWN org's open rows to draw a "Requested"
pill. Aekam's side of it was an email and nothing else.

That matters because of a decision the write path makes deliberately and
correctly: `_announce_skill_request` is wrapped, so a failing fan-out cannot
500 the customer's request. The row commits and `notified_to` stays `'{}'`,
which the migration describes as the truthful record of "written, nobody told".
Truthful — and, until this endpoint, unreadable. A customer could ask for a
skill, be told "Aekam has it", and have the ask exist nowhere a human would
ever look.

Migration 112 created `idx_hub_skill_requests_queue (status, requested_at DESC)`
and commented it "Aekam's queue, newest first". It was the only index in that
file with no caller.

── WHAT THIS FILE PINS ─────────────────────────────────────────────────────

  · THE QUEUE IS PLATFORM-ONLY. It reads across organisations by design, so the
    gate is the thing standing between a tenant and other tenants' names.

  · DORMANT IS NOT EMPTY. Migration 112 is unapplied on every live database.
    The queue must open and say requests cannot be recorded yet — not 503 (which
    cannot be opened at all) and not a bare `[]` (which says "nobody asked",
    a claim about customers that is not known to be true).

  · `already_active` IS READ LIVE FROM THE GRANT TABLE. Migration 112 is explicit
    that `status='granted'` is "a RECORD of the grant, not the grant itself, and
    nothing may read this column to decide whether the org has the skill". A
    queue that decided from `r.status` would drift the moment a skill was granted
    or revoked through any of the four routes that touch `hub_org_skills`.

  · `notified_to` SURVIVES TO THE SCREEN. It is the only evidence that an ask
    never reached a person, and dropping it from the payload — as an internal
    column, say — would delete the one signal the queue exists to carry.

── THE POOL IS A MagicMock AND RESOLVES ANY TABLE NAME ─────────────────────

So the `to_regclass` probe is stubbed EXPLICITLY in every test, exactly as
`test_skill_requests.py` does. Left to the mock's default, the dormant path
would be untested while looking tested — and that is the path every live
database is on today.
"""
import pytest

from routers import hub

ORG_A = "00000000-0000-0000-0000-00000000000a"
ORG_B = "00000000-0000-0000-0000-00000000000b"
TEMPLATE = "11111111-1111-1111-1111-111111111111"
REQUEST = "22222222-2222-2222-2222-222222222222"

QUEUE = "/api/v1/hub/skills/requests"


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """Module entitlement is tested elsewhere; this is about what happens after."""
    from routers.hub import _hub_gate
    app.dependency_overrides[_hub_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_hub_gate, None)


@pytest.fixture(autouse=True)
def fresh_probe():
    """`_skill_requests_table` is module state and it is CACHED ONCE TRUE.

    Without this reset the first test in the session decides the answer for
    every test after it, in this file and in every other one.
    """
    hub._skill_requests_table = False
    yield
    hub._skill_requests_table = False


def _row(**over):
    """One queue row as the SQL returns it, before the endpoint reshapes it."""
    base = {
        "id": REQUEST,
        "org_id": ORG_A,
        "template_id": TEMPLATE,
        "requested_by": "user_asha",
        "note": "We chase forty invoices by hand every month.",
        "status": "open",
        "requested_at": "2026-08-06T10:00:00+00:00",
        "decided_at": None,
        "decided_by": None,
        "notified_to": ["success+accountmgr@simulator.amazonses.com"],
        "org_name": "Bharat Textiles",
        "template_name": "Chase overdue invoices",
        "category": "festival",
        "requester_name": "Asha Rao",
        # A FIXTURE THE SERVER CAN ACTUALLY PRODUCE. `list_skill_requests`
        # selected `decided_by` raw and returned it, and
        # `hub/skills/RequestsTab.jsx` printed it — "granted 3 Aug by
        # user_f1a0a472b98f". The router now LEFT JOINs `users` for the
        # decider and returns the resolved name instead, so every row it
        # yields carries this key. A fixture missing it would be testing a
        # shape the query cannot return, which is how a mock ends up proving
        # nothing.
        #
        # None here because the base fixture is an OPEN request: nobody has
        # decided it. The decided cases override it below.
        "decided_by_name": None,
        "requester_email": "success+asha@simulator.amazonses.com",
        "already_active": False,
    }
    base.update(over)
    return base


class FakeQueue:
    """The read half of `staging.hub_skill_requests`, plus the probe.

    Records the query and its arguments, because two of the properties under
    test are about the SQL itself: that `status=all` drops the filter rather
    than passing the literal string 'all' as a status, and that the limit is
    bound rather than interpolated.
    """

    def __init__(self, rows=None, exists=True):
        self.rows = rows if rows is not None else [_row()]
        self.exists = exists
        self.queries = []

    def install(self, mock_pool):
        async def _fetchrow(query, *args):
            if "to_regclass" in query:
                return {"ok": self.exists}
            return None

        async def _fetch(query, *args):
            if "FROM public.hub_skill_requests" in query:
                self.queries.append((query, args))
                return list(self.rows)
            return []

        mock_pool.fetchrow.side_effect = _fetchrow
        mock_pool.fetch.side_effect = _fetch
        return self


# ── Who may open it ─────────────────────────────────────────────────────────

async def test_a_platform_account_sees_the_queue(api_client, mock_pool, as_admin):
    """Aekam can finally read what was asked for.

    Every field asserted here is a field `_announce_skill_request` already puts
    in the email to these same accounts. That is the argument for the cross-org
    read: the screen makes an existing disclosure durable, it does not create a
    new one.
    """
    FakeQueue().install(mock_pool)

    r = await api_client.get(QUEUE)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is True
    assert len(body["data"]) == 1

    row = body["data"][0]
    assert row["org_name"] == "Bharat Textiles"
    assert row["template_name"] == "Chase overdue invoices"
    assert row["requester_name"] == "Asha Rao"
    # THE NOTE IS THE POINT OF THE FEATURE. Everything else can be looked up;
    # the sentence saying what they want it for is the thing the account contact
    # would otherwise have to ask for by a second email.
    assert row["note"] == "We chase forty invoices by hand every month."


async def test_an_ordinary_member_is_refused(api_client, mock_pool, as_member):
    """The gate is the whole thing standing between a tenant and other tenants.

    This endpoint deliberately joins `organisations` for a name and reads rows
    belonging to every org. An org-tier account reaching it would be a
    cross-org read of exactly the kind `activity.py` deleted its `sees_every_org`
    branch to prevent.
    """
    FakeQueue().install(mock_pool)

    r = await api_client.get(QUEUE)

    assert r.status_code == 403, r.text


async def test_a_portal_client_is_refused(api_client, mock_pool, as_client_user):
    FakeQueue().install(mock_pool)

    r = await api_client.get(QUEUE)

    assert r.status_code == 403, r.text


# ── Dormant is not empty ────────────────────────────────────────────────────

async def test_the_unapplied_migration_answers_available_false_and_not_503(
        api_client, mock_pool, as_admin):
    """Every live database is on this path today.

    503 would mean the screen cannot be opened at all, and an operator who
    cannot open the queue cannot learn that the queue is the reason. So: 200,
    an empty list, and a flag that lets the screen say the third thing —
    requests cannot be RECORDED here yet, which is neither "none" nor "broken".
    """
    FakeQueue(exists=False).install(mock_pool)

    r = await api_client.get(QUEUE)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is False
    assert body["data"] == []


async def test_an_empty_applied_queue_is_distinguishable_from_a_dormant_one(
        api_client, mock_pool, as_admin):
    """The two states must not share a response.

    `available: true, data: []` means nobody has asked. `available: false,
    data: []` means nobody CAN have asked. A screen that cannot tell them apart
    will print "no requests" over a feature that was never switched on.
    """
    FakeQueue(rows=[]).install(mock_pool)

    r = await api_client.get(QUEUE)

    body = r.json()
    assert body["available"] is True
    assert body["data"] == []


# ── The two fields that carry the whole point ───────────────────────────────

async def test_an_ask_that_reached_nobody_says_so(api_client, mock_pool, as_admin):
    """`notified_to == []` is the fan-out having failed, and it must survive.

    This is the case the queue exists for. The write path is deliberately built
    so a mail failure does not 500 the customer — which means the empty array is
    the ONLY surviving trace of an ask that never reached a person.
    """
    FakeQueue(rows=[_row(notified_to=[])]).install(mock_pool)

    r = await api_client.get(QUEUE)

    assert r.json()["data"][0]["notified_to"] == []


async def test_null_notified_to_becomes_an_empty_list_not_null(
        api_client, mock_pool, as_admin):
    """The column is `NOT NULL DEFAULT '{}'`, but a driver may still hand back
    None for a row written before the default existed. One representation of
    "nobody", so the screen has one branch and not two."""
    FakeQueue(rows=[_row(notified_to=None)]).install(mock_pool)

    r = await api_client.get(QUEUE)

    assert r.json()["data"][0]["notified_to"] == []


async def test_already_active_comes_from_the_grant_table_not_from_the_status(
        api_client, mock_pool, as_admin):
    """A row still `open` whose org already HOLDS the skill reports it.

    Migration 112: "`granted` is a RECORD of the grant, not the grant itself,
    and nothing may read this column to decide whether the org has the skill."
    An operator granting the skill through `assign_skill_to_org` writes
    `hub_org_skills` and touches no request row, so the queue would otherwise
    keep showing a live ask for something already delivered.
    """
    FakeQueue(rows=[_row(status="open", already_active=True)]).install(mock_pool)

    r = await api_client.get(QUEUE)

    row = r.json()["data"][0]
    assert row["status"] == "open"
    assert row["already_active"] is True


async def test_the_grant_lookup_is_in_the_query_rather_than_derived_after_it(
        api_client, mock_pool, as_admin):
    """Pinned as SQL, because deriving it in Python is the tempting shortcut and
    it is wrong: `hub_org_skills` is the authority and a second round trip per
    row would either be N+1 or, more likely, become a guess from `r.status`."""
    fake = FakeQueue().install(mock_pool)

    await api_client.get(QUEUE)

    query = fake.queries[0][0]
    assert "hub_org_skills" in query
    assert "is_active = TRUE" in query


# ── The filter ──────────────────────────────────────────────────────────────

async def test_open_is_the_default_and_is_bound_not_interpolated(
        api_client, mock_pool, as_admin):
    fake = FakeQueue().install(mock_pool)

    await api_client.get(QUEUE)

    query, args = fake.queries[0]
    assert "r.status = $1" in query
    assert args[0] == "open"


async def test_all_drops_the_filter_rather_than_asking_for_status_all(
        api_client, mock_pool, as_admin):
    """The bug this forecloses: passing the literal 'all' through as a status,
    which matches the CHECK constraint's four values not at all and returns an
    empty queue that looks like a quiet week."""
    fake = FakeQueue().install(mock_pool)

    r = await api_client.get(QUEUE, params={"status": "all"})

    assert r.status_code == 200, r.text
    query, args = fake.queries[0]
    assert "r.status" not in query.split("ORDER BY")[0].split("FROM")[-1] or "WHERE" not in query
    assert "all" not in args


async def test_a_decided_request_is_reachable_so_the_record_outlives_the_decision(
        api_client, mock_pool, as_admin):
    fake = FakeQueue(rows=[_row(
        status="declined",
        decided_at="2026-08-07T09:00:00+00:00",
        decided_by="user_aekam",
        decided_by_name="Aekam Admin",
    )]).install(mock_pool)

    r = await api_client.get(QUEUE, params={"status": "declined"})

    assert r.status_code == 200, r.text
    assert fake.queries[0][1][0] == "declined"
    # THE NAME, AND THE ASSERTION USED TO BE THE BUG. It read
    # `data[0]["decided_by"] == "user_aekam"` — so the test REQUIRED the
    # endpoint to hand a `users.user_id` to the browser, and
    # `hub/skills/RequestsTab.jsx` duly printed it. Found by
    # `check-rendered-ids.mjs` on 2026-08-23 once that ratchet learned to see
    # a `_by` value reaching a rendered position.
    #
    # The point the test was making — a decided request stays reachable, the
    # record outlives the decision — is unchanged and is what it now checks:
    # the decision is still attributed, by name.
    row = r.json()["data"][0]
    assert row["decided_by_name"] == "Aekam Admin"
    assert "decided_by" not in row, (
        "the queue hands the browser a raw users.user_id")


async def test_an_unknown_status_is_refused_rather_than_silently_returning_nothing(
        api_client, mock_pool, as_admin):
    """A typo in a query string must not read as an empty queue."""
    FakeQueue().install(mock_pool)

    r = await api_client.get(QUEUE, params={"status": "pending"})

    assert r.status_code == 400, r.text


async def test_the_limit_is_capped(api_client, mock_pool, as_admin):
    FakeQueue().install(mock_pool)

    r = await api_client.get(QUEUE, params={"limit": 5000})

    assert r.status_code == 422, r.text
