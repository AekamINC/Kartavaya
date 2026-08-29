"""POST /v1/hub/skills/{template_id}/request — the way out of a terminal card.

`assign_skill_to_org` is `require_platform_role(*OPERATIONS_CONSOLE_ROLES)` and
every one of those roles is platform tier, so no org-tier account can turn a
skill on for itself. That is deliberate. What was not deliberate is that the
product's answer to the customer was the sentence "Assigning a template is an
Aekam function. Ask your account contact." with no way to do it — the skill card
was terminal.

Four things this file pins, each of which was a decision that could have gone
the wrong way:

  · A DOUBLE SUBMIT MUST NOT MINT TWO LEADS. The guarantee is a PARTIAL UNIQUE
    INDEX (`idx_hub_skill_requests_one_open`, `WHERE status='open'`) and not an
    if-statement, because a read-then-insert loses the race between two clicks a
    millisecond apart — both find nothing, both insert, the account contact gets
    two emails about one skill. The endpoint writes `ON CONFLICT DO NOTHING`,
    re-reads the open row, and answers 200 with the SAME request_id. The tests
    below drive that through a pool that behaves like the index.

  · THE TABLE IS NOT APPLIED. Migration 112 is a file. There is one `staging`
    schema and production writes to it too, so no application code applies it.
    Until an operator runs it, this endpoint has nowhere to write, and it must
    say the request was NOT recorded rather than 500 or — far worse — 200 over a
    write it did not make.

  · THE MAIL IS NOT THE RECORD. The row is committed first and the fan-out is
    wrapped. A request that is on file with an empty `notified_to` is
    recoverable by hand; a 500 raised after the INSERT tells the customer it
    failed while the row says it succeeded.

  · THE SCOPE COMES FROM THE SESSION, NEVER THE BODY. `SkillRequest` has one
    field. An org_id or a user_id in the body would let a member file against an
    org they are not in, or in somebody else's name.

── THE POOL IS A MagicMock AND RESOLVES ANY TABLE NAME ─────────────────────

So the `to_regclass` probe is stubbed EXPLICITLY in every test. Left to the
mock's default the "table is absent" path would be untested while looking
tested, and that path is the one every live database is on today.
"""
import asyncpg
import pytest

from routers import hub

ORG = "00000000-0000-0000-0000-00000000000a"
TEMPLATE = "11111111-1111-1111-1111-111111111111"
REQUEST = "22222222-2222-2222-2222-222222222222"


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


@pytest.fixture(autouse=True)
def no_real_mail(monkeypatch):
    """Nothing in this file may reach a mail provider.

    `send_email` hands off to a background thread and returns True instantly,
    so a test that let it through would pass while queueing real traffic. The
    stub records what it was asked to send, which is most of what the fan-out
    tests assert on.
    """
    sent = []

    def _fake_send(to_email, subject, html_content, reply_to=None, *,
                   purpose=None, ref=None):
        sent.append({"to": to_email, "subject": subject, "html": html_content,
                     "purpose": purpose, "ref": ref})
        return True

    import email_service
    monkeypatch.setattr(email_service, "send_email", _fake_send)

    async def _fake_notify(pool, user_id, notif_type, title, message, **kw):
        return None

    import utils
    monkeypatch.setattr(utils, "create_notification", _fake_notify)
    return sent


@pytest.fixture
def org_a(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG
    yield ORG
    app.dependency_overrides.pop(get_org_id, None)


# ── A pool that behaves like the partial unique index ────────────────────────

class FakeRequests:
    """The open-request half of `staging.hub_skill_requests`, with its index.

    Small enough to read and specific enough to be worth having: the property
    under test is that a SECOND INSERT for the same (org, template) writes
    nothing while a row is open, and that a DECIDED row stops blocking. Both are
    index behaviour, so a stub that just counted calls would prove nothing.
    """

    def __init__(self, exists=True):
        self.exists = exists
        self.rows = []
        self.inserts = 0
        self.notified = []

    # -- the index --
    def _open(self, org_id, template_id):
        for r in self.rows:
            if (r["org_id"] == org_id and str(r["template_id"]) == str(template_id)
                    and r["status"] == "open"):
                return r
        return None

    def _insert(self, query, org_id, template_id, requested_by, note):
        self.inserts += 1
        if self._open(org_id, template_id) is not None:
            # THE INDEX REFUSES. What Postgres does about that depends entirely
            # on the statement: `ON CONFLICT DO NOTHING` returns no row, and
            # anything else raises 23505. Modelled rather than assumed, because
            # a stub that always returned None would let the endpoint drop the
            # conflict clause and still pass — and the live failure would be a
            # 500 on the second click.
            if "ON CONFLICT DO NOTHING" not in query:
                raise asyncpg.exceptions.UniqueViolationError(
                    'duplicate key value violates unique constraint '
                    '"idx_hub_skill_requests_one_open"'
                )
            return None
        row = {
            "id": REQUEST if not self.rows else f"req-{len(self.rows)}",
            "org_id": org_id, "template_id": template_id,
            "requested_by": requested_by, "note": note, "status": "open",
            "requested_at": "2026-08-06T10:00:00+00:00",
            "decided_at": None, "decided_by": None, "notified_to": [],
        }
        self.rows.append(row)
        return row

    # -- wiring --
    def install(self, mock_pool, contacts=None, template_name="Chase overdue invoices"):
        contacts = contacts if contacts is not None else [
            {"user_id": "user_am", "email": "am@aekaminc.com", "name": "Account Manager"},
        ]

        async def _fetchrow(query, *args):
            if "to_regclass" in query:
                return {"ok": self.exists}
            if "FROM public.hub_skill_templates" in query:
                return {"id": TEMPLATE, "name": template_name}
            if "SELECT name FROM public.organisations" in query:
                return {"name": "Bharat Textiles"}
            if "INSERT INTO public.hub_skill_requests" in query:
                return self._insert(query, args[0], args[1], args[2], args[3])
            if "SELECT * FROM public.hub_skill_requests" in query:
                return self._open(args[0], args[1])
            return None

        async def _fetch(query, *args):
            if "FROM public.user_roles" in query and "JOIN users" in query:
                return contacts
            if "FROM public.hub_skill_requests" in query:
                return [r for r in self.rows if r["status"] == "open"]
            return []

        async def _execute(query, *args):
            if "SET notified_to" in query:
                self.notified.append(list(args[0]))
            return "UPDATE 1"

        mock_pool.fetchrow.side_effect = _fetchrow
        mock_pool.fetch.side_effect = _fetch
        mock_pool.execute.side_effect = _execute
        return self


def _post(api_client, note="We are chasing 40 invoices by hand every month."):
    return api_client.post(
        f"/api/v1/hub/skills/{TEMPLATE}/request", json={"note": note},
    )


# ── The happy path ───────────────────────────────────────────────────────────

async def test_a_member_may_ask_and_gets_201_with_the_request_id(
        api_client, mock_pool, as_member, org_a):
    """ANY member, not just the roles that could grant it.

    Gating the ASK to the roles that can ANSWER it rebuilds the dead end one
    rung down: ask someone to ask someone. The request writes a row and sends a
    mail; the assignment is still a separate deliberate act by a platform
    account, which is the constraint that has not moved.
    """
    fake = FakeRequests().install(mock_pool)

    r = await _post(api_client)

    assert r.status_code == 201, r.text
    body = r.json()
    assert body["request_id"] == REQUEST
    assert body["status"] == "open"
    assert body["already_open"] is False
    assert fake.inserts == 1


async def test_the_requester_and_the_org_come_from_the_session_not_the_body(
        api_client, mock_pool, as_member, member_user, org_a):
    """One field on the model, and this is why.

    A body that could name an org or a user would let a member file a request
    against an organisation they are not in, or in a colleague's name. Extra
    keys are simply not read: Pydantic drops them and the INSERT binds the
    session's values.
    """
    fake = FakeRequests().install(mock_pool)

    r = await api_client.post(
        f"/api/v1/hub/skills/{TEMPLATE}/request",
        json={"note": "hi", "org_id": "99999999-9999-9999-9999-999999999999",
              "requested_by": "user_somebody_else", "status": "granted"},
    )

    assert r.status_code == 201, r.text
    row = fake.rows[0]
    assert row["org_id"] == ORG
    assert row["requested_by"] == member_user["user_id"]
    # And nothing in the body could set the status.
    assert row["status"] == "open"


async def test_a_note_longer_than_the_database_check_is_refused_before_the_insert(
        api_client, mock_pool, as_member, org_a):
    """`Field(max_length=2000)` matches the CHECK in migration 112.

    Refusing here rather than letting Postgres raise means the caller gets a
    422 naming the field instead of a 500, and — more to the point — the two
    limits cannot drift into a Pydantic rule the database does not hold.
    """
    fake = FakeRequests().install(mock_pool)

    r = await api_client.post(
        f"/api/v1/hub/skills/{TEMPLATE}/request", json={"note": "x" * 2001},
    )

    assert r.status_code == 422
    assert fake.inserts == 0


async def test_no_note_is_allowed(api_client, mock_pool, as_member, org_a):
    """The note is the point of the feature and it is still optional.

    Requiring it would make the fastest possible action — "I want this" — into
    a writing task, and the column is `NOT NULL DEFAULT ''` so an absent note
    has exactly one representation.
    """
    FakeRequests().install(mock_pool)
    r = await api_client.post(f"/api/v1/hub/skills/{TEMPLATE}/request", json={})
    assert r.status_code == 201, r.text
    assert r.json()["note"] == ""


# ── Idempotency, which is the index and not an if-statement ──────────────────

async def test_a_double_submit_does_not_create_two_rows(
        api_client, mock_pool, as_member, org_a, no_real_mail):
    """THE ASSERTION THIS FILE EXISTS FOR.

    Two presses, one row, one request_id, one email. The second POST answers
    200 rather than 201 and carries `already_open`, so the screen can tell "we
    just filed this" from "you already had one open" without a second endpoint.
    """
    fake = FakeRequests().install(mock_pool)

    first = await _post(api_client)
    second = await _post(api_client, note="a completely different note")

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["request_id"] == second.json()["request_id"]
    assert second.json()["already_open"] is True

    assert len(fake.rows) == 1, "a second press minted a second lead"
    assert fake.inserts == 2, "the second press must still ATTEMPT the insert — " \
                              "checking first in Python is the race this avoids"
    # The first note stands. A repeat must not overwrite what was already sent
    # to the account contact.
    assert fake.rows[0]["note"].startswith("We are chasing")
    assert len(no_real_mail) == 1, "a repeat pressed twice must not mail twice"


async def test_a_decided_request_stops_blocking_a_new_one(
        api_client, mock_pool, as_member, org_a):
    """The index is partial `WHERE status='open'` precisely for this.

    A declined skill can be asked for again later — three months on, when the
    reason it was declined has changed. A total unique index would make one
    refusal permanent.
    """
    fake = FakeRequests().install(mock_pool)

    await _post(api_client)
    fake.rows[0]["status"] = "declined"
    fake.rows[0]["decided_at"] = "2026-08-07T10:00:00+00:00"
    fake.rows[0]["decided_by"] = "user_am"

    again = await _post(api_client, note="Circumstances changed.")

    assert again.status_code == 201, again.text
    assert len(fake.rows) == 2
    assert again.json()["already_open"] is False


# ── Dormancy: migration 112 is a file, not a table ───────────────────────────

async def test_with_no_table_it_says_the_request_was_not_recorded(
        api_client, mock_pool, as_member, org_a, no_real_mail):
    """503 naming the migration, NOT 500 and NOT a cheerful 200.

    A 500 reads as "try again", and somebody who tries again still has no
    request on file. This is `me.py:_pending_migration`'s shape for the same
    reason, and the screen degrades to a plain "not available yet" against it.
    """
    fake = FakeRequests(exists=False).install(mock_pool)

    r = await _post(api_client)

    assert r.status_code == 503
    detail = r.json()["detail"]
    assert "NOT recorded" in detail
    assert "112" in detail, "the operator has to be told what to run"
    assert fake.inserts == 0
    assert no_real_mail == [], "nothing may be mailed about a request nobody has"


async def test_the_probe_is_not_cached_negative(api_client, mock_pool, as_member, org_a):
    """A cached "no" would keep the button dead until the next redeploy.

    The migration can be applied under a long-running process. `org_profile`
    makes the same choice for the same reason: cache only once the answer is
    YES.
    """
    absent = FakeRequests(exists=False).install(mock_pool)
    assert (await _post(api_client)).status_code == 503

    FakeRequests(exists=True).install(mock_pool)
    assert (await _post(api_client)).status_code == 201
    assert absent.inserts == 0


async def test_a_missing_template_is_404_before_anything_is_written(
        api_client, mock_pool, as_member, org_a):
    """An inactive or unknown template is refused, and the order matters.

    The template lookup runs BEFORE the table probe, so a bad id answers 404
    rather than 503 — the caller's problem is named rather than the
    environment's.
    """
    fake = FakeRequests().install(mock_pool)

    async def _fetchrow(query, *args):
        if "to_regclass" in query:
            return {"ok": True}
        if "FROM public.hub_skill_templates" in query:
            return None
        return None
    mock_pool.fetchrow.side_effect = _fetchrow

    r = await _post(api_client)

    assert r.status_code == 404
    assert fake.inserts == 0


# ── The fan-out, which is not the record ─────────────────────────────────────

async def test_the_account_contact_is_mailed_with_the_note_verbatim(
        api_client, mock_pool, as_member, org_a, no_real_mail):
    """The note is what the account contact would otherwise have to ask for.

    Everything else in the mail can be looked up — the org, the skill, the
    person. The sentence saying what they want it FOR is the only thing that
    exists nowhere else, so it goes through whole.
    """
    FakeRequests().install(mock_pool)
    note = "We are chasing 40 invoices by hand every month."

    await _post(api_client, note=note)

    assert len(no_real_mail) == 1
    mail = no_real_mail[0]
    assert mail["to"] == "am@aekaminc.com"
    assert note in mail["html"]
    assert "Bharat Textiles" in mail["html"]
    assert "Chase overdue invoices" in mail["subject"]
    # And it says plainly that nothing was switched on.
    assert "Nothing has been switched on" in mail["html"]


async def test_the_note_is_escaped_into_the_mail(
        api_client, mock_pool, as_member, org_a, no_real_mail):
    """The note is free text from a customer and the mail is HTML.

    Interpolating it raw would put whatever they typed into an Aekam inbox as
    live markup. There is exactly one customer-authored string in this message
    and it is escaped at the point it is written.
    """
    FakeRequests().install(mock_pool)

    await _post(api_client, note='<script>alert(1)</script> & "quotes"')

    html = no_real_mail[0]["html"]
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


async def test_the_mail_carries_the_purpose_that_picks_its_sender(
        api_client, mock_pool, as_member, org_a, no_real_mail):
    """`purpose='skill_request'` is not decoration.

    It decides which address the mail leaves from (`email_senders.plan`) and
    which bucket the outbound row is filed under. `tests/test_email_senders.py`
    walks the AST of every backend source file and fails on a literal
    `purpose="…"` that `_BUCKET` does not map, so this and that map are pinned
    to each other.
    """
    FakeRequests().install(mock_pool)
    await _post(api_client)

    mail = no_real_mail[0]
    assert mail["purpose"] == "skill_request"
    assert mail["ref"] == f"skill_request:{REQUEST}"

    from services.email_senders import _BUCKET
    assert _BUCKET["skill_request"] == "notifications"


async def test_the_addresses_that_were_mailed_are_written_back(
        api_client, mock_pool, as_member, org_a):
    """`notified_to` is what makes the missing account-contact column survivable.

    There is no per-org account contact in the schema, so the recipients are
    resolved at send time from the platform-tier commercial roles. Recording
    what each request actually reached means the day a real contact lands,
    history does not have to be reconstructed.
    """
    fake = FakeRequests().install(mock_pool, contacts=[
        {"user_id": "user_am", "email": "am@aekaminc.com", "name": "AM"},
        {"user_id": "user_pa", "email": "admin@aekaminc.com", "name": "PA"},
    ])

    await _post(api_client)

    assert fake.notified == [["am@aekaminc.com", "admin@aekaminc.com"]]


async def test_with_no_platform_contact_it_falls_back_rather_than_telling_nobody(
        api_client, mock_pool, as_member, org_a, no_real_mail):
    """An empty recipient list is the failure this path exists to remove.

    A request recorded and nobody told is worse than the dead end it replaced,
    because the customer now believes somebody has it.
    """
    FakeRequests().install(mock_pool, contacts=[])

    r = await _post(api_client)

    assert r.status_code == 201
    assert len(no_real_mail) == 1
    assert "@" in no_real_mail[0]["to"]


async def test_one_bad_address_does_not_stop_the_others_being_told(
        api_client, mock_pool, as_member, org_a, monkeypatch, no_real_mail):
    """The loop is guarded per contact, not once around all of them.

    Two account contacts and a provider that refuses the first: the second must
    still hear about it, and `notified_to` must record only the one that
    actually went — a list that claims a delivery it did not make is worse than
    an empty one.
    """
    fake = FakeRequests().install(mock_pool, contacts=[
        {"user_id": "user_am", "email": "bad@aekaminc.com", "name": "AM"},
        {"user_id": "user_pa", "email": "admin@aekaminc.com", "name": "PA"},
    ])

    import email_service
    real = email_service.send_email

    def _one_bad(to_email, *a, **kw):
        if to_email == "bad@aekaminc.com":
            raise RuntimeError("the provider refused this address")
        return real(to_email, *a, **kw)
    monkeypatch.setattr(email_service, "send_email", _one_bad)

    r = await _post(api_client)

    assert r.status_code == 201, r.text
    assert [m["to"] for m in no_real_mail] == ["admin@aekaminc.com"]
    assert fake.notified == [["admin@aekaminc.com"]]


async def test_the_row_survives_a_fan_out_that_fails_outright(
        api_client, mock_pool, as_member, org_a):
    """The mail is not the record.

    A request on file with an empty `notified_to` is the truthful record of
    "written, nobody told" and is recoverable by hand. A 500 raised after the
    INSERT tells the customer it failed while the row says it succeeded, and
    they press again — which the index then answers 200 to, so they are told
    twice about something that went wrong once and did land.

    The failure is injected at the RECIPIENT LOOKUP rather than at the send, so
    it is outside the per-contact guard and can only be caught by the wrapper
    around the whole fan-out. That wrapper is the thing under test.
    """
    fake = FakeRequests().install(mock_pool)

    async def _fetch_boom(query, *args):
        if "FROM public.user_roles" in query:
            raise RuntimeError("the roles table is unreachable")
        return []
    mock_pool.fetch.side_effect = _fetch_boom

    r = await _post(api_client)

    assert r.status_code == 201, r.text
    assert len(fake.rows) == 1, "the request is on file"
    assert fake.notified == [], "nothing was mailed, so nothing is claimed"


# ── Reading the state back through the one fetch that already exists ─────────

async def test_org_skills_carries_open_requests_as_a_sibling_key(
        api_client, mock_pool, as_member, org_a):
    """`data` is the ACTIVE grant set and it is NOT widened.

    A requested-but-not-granted template has no `hub_org_skills` row, so it
    cannot appear in `data` — and putting it there would make "assigned" and
    "asked for" the same value on the one list the surface reads to decide what
    may be RUN. `useList` unwraps only `.data`, so both existing consumers are
    byte-identical and the new key is read explicitly.
    """
    fake = FakeRequests().install(mock_pool)
    await _post(api_client)

    r = await api_client.get("/api/v1/hub/org/skills")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["data"] == [], "no skill is assigned to this org"
    assert len(body["skill_requests"]) == 1
    assert body["skill_requests"][0]["template_id"] == TEMPLATE
    assert body["skill_requests"][0]["status"] == "open"
    assert fake.rows[0]["note"] in body["skill_requests"][0]["note"]


async def test_org_skills_still_answers_with_the_key_when_the_table_is_absent(
        api_client, mock_pool, as_member, org_a):
    """The SHAPE does not change between deploys.

    `skill_requests` is always present and is `[]` while migration 112 is
    unapplied, so no consumer has to test for the key's existence and the
    catalogue renders either way. An unguarded read here would raise
    `UndefinedTableError` and 500 the whole assigned list for a feature nobody
    has switched on — which is exactly what happened to the sender screen.
    """
    FakeRequests(exists=False).install(mock_pool)

    r = await api_client.get("/api/v1/hub/org/skills")

    assert r.status_code == 200, r.text
    assert r.json()["skill_requests"] == []
