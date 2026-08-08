"""
Varta — the 24-hour window is a SERVER rule, and a credential never comes back.

Two claims, and both were false before this file existed.

THE WINDOW
    `frontend/.../varta/waWindow.js` models Meta's 24-hour customer service
    window and `WAChat.jsx` swaps the composer for a template picker when it
    closes. Nothing on the server knew about it. `POST
    /conversations/{id}/messages` wrote whatever `{content, type}` it was handed
    into `varta_messages` and reported 201, so a stale tab, a replayed request
    or plain curl could send free-form text into a closed conversation. Meta
    rejects those at its edge — which means our record of what we sent stops
    matching what the customer got, and a WABA that keeps attempting it gets
    throttled and eventually flagged.

    A rule enforced only by the control that offers it is not enforced.

THE CREDENTIAL
    `access_token_enc` and `webhook_verify_token` are secrets. The INSERT's
    RETURNING clause and the list query both omit them today, which is correct
    and is exactly the kind of correctness that a later `SELECT *` deletes by
    accident. These assertions read the SQL the router actually issues, so the
    regression is caught at the query rather than at the response shape of one
    fixture.
"""
from datetime import datetime, timedelta, timezone

import pytest
from unittest.mock import AsyncMock

from conftest import TEST_ORG_ID

CONV_ID = "11111111-2222-3333-4444-555555555555"
ACCOUNT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
TEMPLATE_ID = "99999999-8888-7777-6666-555555555555"


@pytest.fixture(autouse=True)
def _bypass_module_gate(app):
    from routers.whatsapp import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


def _now():
    return datetime.now(timezone.utc)


CONV_ROW = {"id": CONV_ID, "org_id": TEST_ORG_ID, "phone_number": "+919999900011"}
ACTIVE_ACCOUNT = {
    "id": ACCOUNT_ID,
    "status": "active",
    "phone_number_id": "109444555666",
    # `enc::` + a body that will not open under the test key is the FAILED case;
    # a bare string is legacy plaintext, which `decrypt` passes through and
    # `is_encrypted` then reports as readable. That is the healthy row here.
    "access_token_enc": "EAAG_plaintext_legacy",
}


def _msg_row(**over):
    row = {
        "id": "msg-1",
        "org_id": TEST_ORG_ID,
        "conversation_id": CONV_ID,
        "direction": "outbound",
        "content": "hello",
        "type": "text",
        "status": "pending",
        "created_at": _now(),
    }
    row.update(over)
    return row


def _approved_template(**over):
    row = {
        "id": TEMPLATE_ID,
        "name": "order_update_v1",
        "language": "en",
        "body": "Hello {{1}}, your order {{2}} has shipped.",
        "status": "approved",
    }
    row.update(over)
    return row


def _send_plan(last_inbound, template=None, account=ACTIVE_ACCOUNT):
    """The fetchrow sequence one send makes: conversation, account, window, …

    Ordered rather than keyed, because `mock_pool.fetchrow` is one AsyncMock for
    every query the handler issues. If the handler stops asking for one of these
    the sequence slides and the test fails loudly — which is the point.
    """
    plan = [CONV_ROW, account, {"last_inbound": last_inbound}]
    if template is not None:
        plan.append(template)
    plan.append(_msg_row())
    return plan


# ── The window refuses free-form text once it has closed ─────────────


@pytest.mark.anyio
async def test_closed_window_refuses_free_form_text(
    api_client, as_admin, with_org_id, mock_pool
):
    """25 hours since the customer wrote. Meta would reject this; so must we."""
    mock_pool.fetchrow = AsyncMock(
        side_effect=_send_plan(_now() - timedelta(hours=25))
    )

    r = await api_client.post(
        f"/api/v1/whatsapp/conversations/{CONV_ID}/messages",
        json={"content": "Just checking in!", "type": "text"},
    )

    assert r.status_code == 409, (
        "free-form text outside the 24-hour window must be refused by the "
        "server, not only hidden by the composer"
    )
    assert "24-hour" in r.json()["detail"]


@pytest.mark.anyio
async def test_never_messaged_us_refuses_free_form_text(
    api_client, as_admin, with_org_id, mock_pool
):
    """No inbound message at all is CLOSED, not open-by-default.

    A business cannot open a WhatsApp conversation with free-form text. This is
    the case a naive `last_inbound or now` would get backwards.
    """
    mock_pool.fetchrow = AsyncMock(side_effect=_send_plan(None))

    r = await api_client.post(
        f"/api/v1/whatsapp/conversations/{CONV_ID}/messages",
        json={"content": "Hi there", "type": "text"},
    )
    assert r.status_code == 409


@pytest.fixture(autouse=True)
def _never_reach_meta(monkeypatch):
    """Stub the Graph call for every test in this file.

    P7 wired `send_wa_message` to Meta, and two tests here went red the moment
    it did — correctly. They were passing because NOTHING WAS SENT: the row
    went in `pending`, the endpoint answered 201, and the customer received
    nothing. That was the bug, and these tests could not see it.

    Stubbed rather than allowed through, because the numbers in this file are
    real-looking and a test that posted to Graph would send an actual WhatsApp
    message to whoever holds them. `services/whatsapp` never reaches the network
    from a test suite, on purpose.
    """
    import routers.whatsapp as wa

    async def _fake(**kwargs):
        _fake.calls.append(kwargs)
        return "wamid.TEST"

    _fake.calls = []
    monkeypatch.setattr(wa, "_send_via_meta", _fake)
    return _fake


@pytest.mark.anyio
async def test_open_window_allows_free_form_text(
    api_client, as_admin, with_org_id, mock_pool, _never_reach_meta
):
    """One hour ago. The whole point of the window is that this works."""
    mock_pool.fetchrow = AsyncMock(
        side_effect=_send_plan(_now() - timedelta(hours=1))
    )

    r = await api_client.post(
        f"/api/v1/whatsapp/conversations/{CONV_ID}/messages",
        json={"content": "On its way today.", "type": "text"},
    )
    assert r.status_code == 201
    # 201 used to be reachable with nothing sent. Assert the message actually
    # went to Meta, with the text the caller asked for.
    assert len(_never_reach_meta.calls) == 1
    assert _never_reach_meta.calls[0]["text"] == "On its way today."


@pytest.mark.anyio
async def test_an_outbound_message_does_not_reopen_the_window(
    api_client, as_admin, with_org_id, mock_pool
):
    """The clock is the newest INBOUND message.

    The most common way to get this rule wrong is `ORDER BY created_at DESC
    LIMIT 1` over every message, which lets our own replies hold the window
    open forever. The query must filter on direction, so a conversation whose
    newest inbound is 30 hours old stays shut however recently we answered.
    """
    mock_pool.fetchrow = AsyncMock(
        side_effect=_send_plan(_now() - timedelta(hours=30))
    )

    r = await api_client.post(
        f"/api/v1/whatsapp/conversations/{CONV_ID}/messages",
        json={"content": "Any update?", "type": "text"},
    )
    assert r.status_code == 409

    # And the query that decided it looked only at inbound rows.
    window_sql = [
        c.args[0] for c in mock_pool.fetchrow.call_args_list
        if "varta_messages" in c.args[0] and "direction" in c.args[0]
    ]
    assert window_sql, "no query filtered varta_messages by direction"
    assert "'inbound'" in window_sql[0]


# ── Outside the window, an APPROVED template goes through ────────────


@pytest.mark.anyio
async def test_closed_window_allows_an_approved_template(
    api_client, as_admin, with_org_id, mock_pool
):
    mock_pool.fetchrow = AsyncMock(
        side_effect=_send_plan(_now() - timedelta(hours=40), template=_approved_template())
    )

    r = await api_client.post(
        f"/api/v1/whatsapp/conversations/{CONV_ID}/messages",
        json={"type": "template", "template_id": TEMPLATE_ID,
              "template_params": {"1": "Anita", "2": "UG-2291"}},
    )
    assert r.status_code == 201


@pytest.mark.anyio
async def test_closed_window_refuses_a_draft_template(
    api_client, as_admin, with_org_id, mock_pool
):
    """Meta approves templates; we do not get to. A draft cannot be delivered."""
    mock_pool.fetchrow = AsyncMock(
        side_effect=_send_plan(
            _now() - timedelta(hours=40), template=_approved_template(status="draft")
        )
    )

    r = await api_client.post(
        f"/api/v1/whatsapp/conversations/{CONV_ID}/messages",
        json={"type": "template", "template_id": TEMPLATE_ID},
    )
    assert r.status_code == 409
    assert "approved" in r.json()["detail"].lower()


@pytest.mark.anyio
async def test_a_template_from_another_org_is_not_found(
    api_client, as_admin, with_org_id, mock_pool
):
    """The template lookup is org-scoped, so a guessed id resolves to nothing."""
    mock_pool.fetchrow = AsyncMock(
        side_effect=_send_plan(_now() - timedelta(hours=40), template=None)
    )
    # `template=None` above omits the row from the plan; put an explicit None in
    # its place so the sequence still lines up with the handler's queries.
    mock_pool.fetchrow = AsyncMock(
        side_effect=[CONV_ROW, ACTIVE_ACCOUNT,
                     {"last_inbound": _now() - timedelta(hours=40)}, None]
    )

    r = await api_client.post(
        f"/api/v1/whatsapp/conversations/{CONV_ID}/messages",
        json={"type": "template", "template_id": TEMPLATE_ID},
    )
    assert r.status_code == 404

    tpl_sql = [
        c.args[0] for c in mock_pool.fetchrow.call_args_list
        if "varta_templates" in c.args[0]
    ]
    assert tpl_sql, "the template was never looked up"
    assert "org_id" in tpl_sql[0], "template lookup is not org-scoped"


@pytest.mark.anyio
async def test_a_template_declared_without_an_id_is_refused(
    api_client, as_admin, with_org_id, mock_pool
):
    """`type: 'template'` with no `template_id` used to store free text under a
    template label — the exact hole the window rule is meant to close."""
    mock_pool.fetchrow = AsyncMock(
        side_effect=[CONV_ROW, ACTIVE_ACCOUNT,
                     {"last_inbound": _now() - timedelta(hours=40)}]
    )

    r = await api_client.post(
        f"/api/v1/whatsapp/conversations/{CONV_ID}/messages",
        json={"content": "anything at all", "type": "template"},
    )
    assert r.status_code == 409


# ── GET /conversations/{id}/window ───────────────────────────────────


@pytest.mark.anyio
async def test_window_endpoint_reports_the_state(
    api_client, as_admin, with_org_id, mock_pool
):
    """`waWindow.js` asks for this endpoint by name and it did not exist.

    Without it the client derives the window from the newest page of 50
    messages, so a thread with 50 outbound messages since the last inbound one
    reads as 'never opened'.
    """
    mock_pool.fetchrow = AsyncMock(
        side_effect=[CONV_ROW, {"last_inbound": _now() - timedelta(hours=2)}]
    )

    r = await api_client.get(f"/api/v1/whatsapp/conversations/{CONV_ID}/window")
    assert r.status_code == 200
    body = r.json()
    assert body["open"] is True
    assert body["ever_inbound"] is True
    assert body["expires_at"]
    # 22 hours left, give or take the time this test took to run.
    assert 21 * 3600 < body["remaining_seconds"] <= 22 * 3600


@pytest.mark.anyio
async def test_window_endpoint_404s_on_another_orgs_conversation(
    api_client, as_admin, with_org_id, mock_pool
):
    mock_pool.fetchrow = AsyncMock(return_value=None)
    r = await api_client.get(f"/api/v1/whatsapp/conversations/{CONV_ID}/window")
    assert r.status_code == 404


# ── Connect / disconnect, and the credential that must not travel ────


@pytest.mark.anyio
async def test_a_new_account_is_pending_not_active(
    api_client, as_admin, with_org_id, mock_pool
):
    """Nothing has verified these six values at the moment they are pasted.

    Writing `status='active'` at the INSERT told every reader the number was
    live before Meta had ever spoken to us, so the Accounts tab showed a green
    'Active' chip for a typo'd phone_number_id. The account becomes active when
    Meta completes the webhook handshake — a fact, rather than an assumption.
    """
    mock_pool.fetchrow = AsyncMock(side_effect=[
        None,  # no existing account with this phone_number_id
        {"id": ACCOUNT_ID, "org_id": TEST_ORG_ID, "phone_number": "+919999900012",
         "display_name": "Unicode Group", "waba_id": "104", "phone_number_id": "109",
         "status": "pending"},
    ])

    r = await api_client.post("/api/v1/whatsapp/accounts", json={
        "phone_number": "+919999900012", "display_name": "Unicode Group",
        "waba_id": "104", "phone_number_id": "109",
        "access_token": "EAAG_secret", "webhook_verify_token": "a-phrase",
    })
    assert r.status_code == 201

    insert_sql = mock_pool.fetchrow.call_args_list[-1].args[0]
    assert "'active'" not in insert_sql, (
        "a freshly pasted credential must not be recorded as active"
    )


@pytest.mark.anyio
async def test_the_token_never_comes_back_from_create(
    api_client, as_admin, with_org_id, mock_pool
):
    """Not in the body, and not in the RETURNING clause that builds the body.

    Checking only the response would pass against a fixture that happens not to
    carry the column. The SQL is what decides it.
    """
    mock_pool.fetchrow = AsyncMock(side_effect=[
        None,
        {"id": ACCOUNT_ID, "org_id": TEST_ORG_ID, "status": "pending"},
    ])

    r = await api_client.post("/api/v1/whatsapp/accounts", json={
        "phone_number": "+919999900012", "display_name": "Unicode Group",
        "waba_id": "104", "phone_number_id": "109",
        "access_token": "EAAG_secret_do_not_echo",
        "webhook_verify_token": "a-phrase-do-not-echo",
    })
    assert r.status_code == 201
    assert "EAAG_secret_do_not_echo" not in r.text
    assert "a-phrase-do-not-echo" not in r.text

    sql = mock_pool.fetchrow.call_args_list[-1].args[0]
    returning = sql.split("RETURNING", 1)[1]
    assert "access_token" not in returning
    assert "webhook_verify_token" not in returning


@pytest.mark.anyio
async def test_the_token_never_comes_back_from_the_list(
    api_client, as_admin, with_org_id, mock_pool
):
    mock_pool.fetch = AsyncMock(return_value=[])
    r = await api_client.get("/api/v1/whatsapp/accounts")
    assert r.status_code == 200

    sql = mock_pool.fetch.call_args.args[0]
    assert "access_token" not in sql, "the list query selects the credential column"
    assert "webhook_verify_token" not in sql
    assert "*" not in sql, (
        "SELECT * over varta_business_accounts hands the client both secrets the "
        "moment anyone adds a column"
    )


@pytest.mark.anyio
async def test_connecting_the_same_number_twice_is_refused(
    api_client, as_admin, with_org_id, mock_pool
):
    """Two rows for one phone_number_id makes the webhook's account lookup
    non-deterministic — inbound messages land against whichever row the planner
    returns first, and only one of them holds a working token."""
    mock_pool.fetchrow = AsyncMock(return_value={"id": ACCOUNT_ID, "status": "active"})

    r = await api_client.post("/api/v1/whatsapp/accounts", json={
        "phone_number": "+919999900012", "display_name": "Unicode Group",
        "waba_id": "104", "phone_number_id": "109",
        "access_token": "EAAG_secret", "webhook_verify_token": "",
    })
    assert r.status_code == 409


@pytest.mark.anyio
async def test_disconnect_removes_the_account_and_is_org_scoped(
    api_client, as_admin, with_org_id, mock_pool
):
    """Disconnecting must destroy the stored credential, not park it.

    The four states the Accounts tab shows are 'not connected / pending /
    connected / failed'; there is no 'disconnected but we kept your token'.
    """
    mock_pool.fetchrow = AsyncMock(return_value={"id": ACCOUNT_ID})
    mock_pool.execute = AsyncMock(return_value="DELETE 1")

    r = await api_client.delete(f"/api/v1/whatsapp/accounts/{ACCOUNT_ID}")
    assert r.status_code == 200

    sql = mock_pool.execute.call_args.args[0]
    assert "DELETE" in sql.upper()
    assert "org_id" in sql, "disconnect is not org-scoped"


@pytest.mark.anyio
async def test_disconnecting_an_account_of_another_org_404s(
    api_client, as_admin, with_org_id, mock_pool
):
    mock_pool.fetchrow = AsyncMock(return_value=None)
    r = await api_client.delete(f"/api/v1/whatsapp/accounts/{ACCOUNT_ID}")
    assert r.status_code == 404


@pytest.mark.anyio
async def test_the_webhook_handshake_activates_a_pending_account(
    api_client, mock_pool
):
    """The chicken and egg, made explicit.

    The verify route matched `status='active'` only. An account that is created
    `pending` and becomes active BY completing this handshake could therefore
    never complete it — Meta's verification call would 403 and the number would
    sit pending forever. The route matches any account holding the token, and
    the successful handshake is what promotes it.
    """
    mock_pool.fetchrow = AsyncMock(
        return_value={"id": ACCOUNT_ID, "status": "pending"}
    )
    mock_pool.execute = AsyncMock(return_value="UPDATE 1")

    r = await api_client.get("/api/v1/whatsapp/webhook", params={
        "hub.mode": "subscribe",
        "hub.verify_token": "a-phrase",
        "hub.challenge": "challenge_abc",
    })
    assert r.status_code == 200
    assert r.text == "challenge_abc"

    assert mock_pool.execute.await_count == 1
    sql = mock_pool.execute.call_args.args[0]
    assert "status" in sql and "active" in sql


@pytest.mark.anyio
async def test_sending_without_a_connected_account_says_so(
    api_client, as_admin, with_org_id, mock_pool
):
    """The old query JOINed the account into the conversation lookup, so an org
    with no connected number was told 'Conversation not found' — about a
    conversation that exists and is on screen."""
    mock_pool.fetchrow = AsyncMock(side_effect=[CONV_ROW, None])

    r = await api_client.post(
        f"/api/v1/whatsapp/conversations/{CONV_ID}/messages",
        json={"content": "hello", "type": "text"},
    )
    assert r.status_code == 409
    assert "connect" in r.json()["detail"].lower()


# ── The pure window arithmetic ───────────────────────────────────────


def test_state_from_boundaries():
    from services.wa_window import state_from, WINDOW_SECONDS

    now = datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc)

    assert state_from(None, now)["open"] is False
    assert state_from(None, now)["ever_inbound"] is False

    just_open = state_from(now - timedelta(seconds=WINDOW_SECONDS - 60), now)
    assert just_open["open"] is True
    assert just_open["remaining_seconds"] == 60

    # Exactly 24 hours is CLOSED. Meta's window is 24 hours from the message,
    # so the instant it elapses there is nothing left to send into.
    assert state_from(now - timedelta(seconds=WINDOW_SECONDS), now)["open"] is False
    assert state_from(now - timedelta(days=3), now)["remaining_seconds"] == 0


def test_state_from_reads_a_naive_timestamp_as_utc():
    """A naive value must not raise inside a send path."""
    from services.wa_window import state_from

    now = datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc)
    naive = datetime(2026, 8, 6, 11, 0)  # no tzinfo
    assert state_from(naive, now)["open"] is True
