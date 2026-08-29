"""The Social accounts page: one card per network, telling the whole story.

── THE OWNER'S COMPLAINT ─────────────────────────────────────────────────────

"rather than seating two different place connectors on organisation and connect
on sahayak we move connectors to same page as well?" — the app id and secret
live in Settings → Connectors, the accounts they exist to connect live in
Sahayak → Publish, and NEITHER screen can say whether a network actually works.
`GET /v1/hub/connectors` has never heard of an account; `GET /v1/hub/clients/
{id}/social-accounts` has never heard of an app.

`/v1/hub/connectors/social-status` is the missing answer: both halves, one
request, per platform.

── AND THE LIE THE OLD CARD TOLD ─────────────────────────────────────────────

The Connectors card said `NOT SET` / `ON`, and `ON` meant a saved row with
`is_active` — an app id and a pasted secret, nothing more. MEASURED LIVE
2026-08-21 on this database: `hub_connector_credentials` holds two rows,
Instagram and LinkedIn, both org-scope, both active. `hub_social_accounts` holds
**zero rows in the entire product**. So two cards read `ON` while nothing in the
firm could post anywhere.

That is what `card_state` is for and it is the single most important thing in
this file: GREEN COUNTS CONNECTED ACCOUNTS. An app with no accounts is `ready`,
which is a real and useful state — it means Connect is the next click — and it
is not green.

── AND THE MATRIX, WHICH THE SCREEN MUST NOT CONTRADICT ──────────────────────

`test_social_access_matrix.py` settles who may connect (admin on sahayak or
prachar) and who may send (editor). A page that renders a Connect button for an
editor is a page that walks somebody into a 403. So this endpoint answers the
authority question too — with the SAME resolver the connect route enforces,
imported rather than reimplemented, which is asserted below.
"""
from __future__ import annotations

import inspect

import pytest

import routers.hub_connectors as hc
import routers.hub_publish as hp
from services import connector_credentials as cc


# ── 1 · the four states ─────────────────────────────────────────────────────

@pytest.mark.parametrize("configured,connected,expired,expect", [
    (False, 0, 0, "not_set"),      # no app at all
    (True,  0, 0, "ready"),        # app saved, nobody connected — Connect next
    (True,  1, 0, "live"),
    (True,  9, 0, "live"),
    (True,  3, 1, "attention"),    # one dead token among three good ones
    (True,  1, 1, "attention"),
])
def test_the_four_states(configured, connected, expired, expect):
    assert hc.card_state(configured, connected, expired) == expect


def test_green_counts_accounts_and_never_a_saved_secret():
    """THE BUG THIS REPLACES, in the exact shape the live database has it.

    Instagram and LinkedIn: app saved, app active, zero accounts connected. The
    old card said `ON`. Nothing could post."""
    assert hc.card_state(True, 0, 0) == "ready"
    assert hc.card_state(True, 0, 0) != "live"


def test_an_account_connected_by_pasted_token_is_live_with_no_app_row():
    """X and WhatsApp are connected by hand. A card that demanded an app row
    before it would go green would call a working account not-set."""
    assert hc.card_state(False, 2, 0) == "live"


def test_attention_outranks_live_rather_than_averaging_into_it():
    """Three good accounts and one dead one is a problem, not 75% of a success.
    The one thing worth acting on must not be the one thing hidden."""
    assert hc.card_state(True, 4, 1) == "attention"


def test_every_state_the_function_can_return_is_declared():
    """`CARD_STATES` is what the stylesheet and the screen are written against.
    A fifth state returned here and declared nowhere renders as an unstyled
    card with a word nobody wrote a rule for."""
    seen = {
        hc.card_state(a, c, e)
        for a in (True, False) for c in (0, 3) for e in (0, 1)
    }
    assert seen <= set(hc.CARD_STATES)


# ── 2 · who the endpoint is for ─────────────────────────────────────────────

def test_the_roll_up_is_not_behind_the_org_admin_gate():
    """The app FORM is org-admin work and stays that way. The card is not:
    a Marketing admin connects accounts and posts, and very often holds no org
    role at all. Putting the counts behind `_admin` would have handed that
    person an empty page."""
    deps = [
        p.default.dependency
        for p in inspect.signature(hc.social_status).parameters.values()
        if getattr(p.default, "dependency", None) is not None
    ]
    assert hc._admin not in deps, (
        "social-status is gated org-admin again — the marketing half of the "
        "page's audience cannot read it"
    )


def test_the_roll_up_is_gated_by_the_same_object_the_publish_routes_use():
    """Not an equivalent gate — the SAME one. The endpoint exists so the screen
    can promise it never offers a control that 403s, and it can only promise
    that if it is describing the door it is standing at."""
    assert hc._publishing_gate is hp._hub_gate


def test_the_authority_is_the_publish_router_s_own_resolver():
    """`_level_across` asks BOTH sahayak and prachar and takes the strongest.
    A second copy here would be one edit away from telling a Prachar admin they
    may not connect while the route lets them."""
    assert hc._level_across is hp._level_across


@pytest.mark.parametrize("level,connect,send", [
    (None,       False, False),
    ("viewer",   False, False),
    ("editor",   False, True),
    ("approver", False, True),
    ("admin",    True,  True),
])
def test_the_matrix_the_screen_renders_from(level, connect, send):
    """The table in `test_social_access_matrix.py`, answered as booleans a
    screen can consult instead of guessing."""
    assert hc._satisfies(level, "admin") is connect
    assert hc._satisfies(level, "editor") is send


def test_a_level_the_ladder_does_not_know_hides_the_control():
    """Fails in the direction the API fails in. A grant row holding a word
    nobody recognises must not light up Connect."""
    assert hc._satisfies("superuser", "editor") is False
    assert hc._satisfies("", "admin") is False


# ── 3 · what it must never return ───────────────────────────────────────────

_FORBIDDEN = (
    "access_token", "refresh_token", "secret", "secrets_encrypted",
    "secret_hint", "app_secret", "client_secret", "verify_token",
    "public_fields", "values", "account_id", "page_id", "id",
)


def _walk(node, path="$"):
    if isinstance(node, dict):
        for k, v in node.items():
            yield path, k
            yield from _walk(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _walk(v, f"{path}[{i}]")


def test_the_card_payload_carries_no_secret_and_no_account_id():
    """Asserted on the SHAPE the endpoint builds, not on one response, because
    the redaction here is by construction: this handler assembles its own dict
    rather than passing a row through, so the only way a secret gets out is if
    somebody adds a key. This is the test that notices.

    `account_id` is on the list beside the tokens for its own reason — the
    product's standing rule is that no user, member, org or record id is ever
    drawn, and a payload that carries one invites a screen that renders it.
    """
    src = inspect.getsource(hc.social_status)
    # The keys the handler actually writes into its response.
    written = set()
    for line in src.splitlines():
        line = line.strip()
        if line.startswith('"') and '":' in line:
            written.add(line.split('"')[1])
    leaked = written & set(_FORBIDDEN)
    assert not leaked, f"social-status would return {sorted(leaked)}"


def test_the_account_query_names_only_the_columns_it_can_show():
    """`hub_social_accounts` holds `access_token` and `refresh_token`. A
    `SELECT *` here would put both in memory one serialiser mistake away from a
    browser."""
    src = inspect.getsource(hc.social_status)
    assert "SELECT *" not in src
    assert "sa.access_token" not in src and "sa.refresh_token" not in src
    assert "sa.account_name" in src, "the card names who to reconnect"


# ── 4 · tenancy ─────────────────────────────────────────────────────────────

def test_the_account_count_is_joined_on_the_org_and_not_on_the_client_alone():
    """A join on `client_id` alone is exactly how `graha_clients` came to be
    able to surface another organisation's rows. `_verify_client` has already
    proved the client belongs to the caller; this is the second lock, and
    counts are cheap to leak and impossible to unsee."""
    src = inspect.getsource(hc.social_status)
    assert "JOIN public.hub_clients c ON c.id = sa.client_id" in src
    assert "c.org_id=$2::uuid" in src


def test_a_client_id_from_another_org_is_verified_before_anything_is_read():
    src = inspect.getsource(hc.social_status)
    verify_at = src.index("_verify_client")
    accounts_at = src.index("hub_social_accounts")
    assert verify_at < accounts_at, (
        "the client is verified AFTER its accounts are read — the 404 arrives "
        "too late to matter"
    )


def test_the_credentials_read_is_scoped_to_the_org():
    src = inspect.getsource(hc.social_status)
    assert "hub_connector_credentials" in src
    assert "org_id=$1::uuid" in src


def test_the_status_screen_never_creates_the_org_s_own_client():
    """`GET /v1/hub/org-client` INSERTs when the row is missing. A status page
    that writes a client row, a brand profile and a credit wallet as a side
    effect of being looked at is a write path nobody asked for — and on this
    database, staging and production are the same database."""
    src = inspect.getsource(hc.social_status)
    for verb in ("INSERT", "UPDATE", "DELETE"):
        assert verb not in src, f"social-status issues a {verb}"


# ── 5 · which platforms are on the page ─────────────────────────────────────

def test_lead_sources_are_not_offered_as_destinations():
    """JustDial and IndiaMART are inbound. A Social accounts card for either
    would offer a Connect that cannot work."""
    src = inspect.getsource(hc.social_status)
    assert "if not s.publishes" in src
    lead = [s.key for s in cc.SPECS if not s.publishes]
    assert set(lead) == {"justdial", "indiamart"}, (
        "the set of lead sources changed — check the page still excludes them"
    )


def test_every_platform_the_page_draws_is_one_publishing_accepts():
    """The card offers Connect. `hub_publish.connect_social_account` refuses a
    platform outside `ALL_PLATFORMS` with a 400, so a card for one would be a
    button that cannot work."""
    drawn = {s.key for s in cc.SPECS if s.publishes}
    assert drawn <= set(hp.ALL_PLATFORMS)


# ── 6 · the app half of the card ────────────────────────────────────────────

def test_saved_but_switched_off_does_not_read_as_ready():
    """`cc.resolve` only ever returns an ACTIVE row — that is what `is_active`
    defaulting to FALSE is for. A card that said Ready on a half-filled draft
    would invite a Connect that fails."""
    src = inspect.getsource(hc.social_status)
    assert 'saved_but_off' in src
    assert 'scope != "none"' in src


def test_the_environment_variable_is_reported_without_being_named():
    """`cc.resolve` falls back to an environment variable, so a card whose org
    saved nothing can still be connectable. WHICH variable is not the browser's
    business."""
    assert hc._env_app_configured("facebook") in (True, False)
    src = inspect.getsource(hc._env_app_configured)
    assert "OAUTH_CONFIGS" in src, (
        "the env lookup has a second copy of the platform->variable map"
    )
    assert "META_APP_ID" not in src


def test_the_env_probe_reads_the_same_map_the_resolver_does(monkeypatch):
    monkeypatch.delenv("META_APP_ID", raising=False)
    assert hc._env_app_configured("facebook") is False
    monkeypatch.setenv("META_APP_ID", "something")
    assert hc._env_app_configured("facebook") is True


# ── 7 · end to end, through the router ──────────────────────────────────────

ORG = "00000000-0000-0000-0000-000000000001"
CLIENT = "11111111-1111-1111-1111-111111111111"


class _Row(dict):
    """asyncpg rows are mappings that also index by key; dict is enough."""


@pytest.fixture
def wired(app, mock_pool, monkeypatch, admin_user):
    """A caller who holds admin on a publishing module, in an org with one
    internal client, one saved app and two connected accounts."""
    from auth_router import require_user
    from middleware.org_resolver import get_org_id

    app.dependency_overrides[require_user] = lambda: admin_user
    app.dependency_overrides[get_org_id] = lambda: ORG
    app.dependency_overrides[hc._publishing_gate] = lambda: "sahayak"

    async def _level(*a, **kw):
        return "admin"

    async def _org_admin(*a, **kw):
        return True

    monkeypatch.setattr(hc, "_level_across", _level)
    monkeypatch.setattr(hc, "is_org_admin", _org_admin)

    state = {"expired": False}

    async def _fetch(query, *args):
        if "hub_clients" in query and "hub_social_accounts" not in query:
            return [_Row(id=CLIENT, name="Aekam Inc", is_internal=True)]
        if "hub_connector_credentials" in query:
            return [_Row(client_id=None, platform="instagram", is_active=True),
                    _Row(client_id=None, platform="linkedin", is_active=True)]
        if "hub_social_accounts" in query:
            return [
                _Row(platform="instagram", account_name="Aekam Inc",
                     expired=state["expired"]),
                _Row(platform="instagram", account_name="Unicode Group",
                     expired=False),
            ]
        return []

    mock_pool.fetch.side_effect = _fetch
    mock_pool.fetchval.return_value = 1          # _verify_client, when asked
    yield state
    for dep in (require_user, get_org_id, hc._publishing_gate):
        app.dependency_overrides.pop(dep, None)


@pytest.mark.asyncio
async def test_the_page_gets_the_app_and_the_accounts_in_one_answer(
    api_client, wired,
):
    r = await api_client.get("/api/v1/hub/connectors/social-status")
    assert r.status_code == 200, r.text
    body = r.json()

    cards = {c["platform"]: c for c in body["data"]}

    # Two accounts connected — green, and it says how many.
    assert cards["instagram"]["state"] == "live"
    assert cards["instagram"]["accounts"]["connected"] == 2
    assert cards["instagram"]["accounts"]["names"] == ["Aekam Inc", "Unicode Group"]

    # THE LIVE CASE THAT USED TO SAY `ON`: an app saved and active, and nobody
    # connected. Ready, not green.
    assert cards["linkedin"]["app"]["configured"] is True
    assert cards["linkedin"]["accounts"]["connected"] == 0
    assert cards["linkedin"]["state"] == "ready"

    # Nothing saved and nobody connected.
    assert cards["facebook"]["state"] == "not_set"


@pytest.mark.asyncio
async def test_an_expired_token_names_who_to_reconnect(api_client, wired):
    wired["expired"] = True
    r = await api_client.get("/api/v1/hub/connectors/social-status")
    card = next(c for c in r.json()["data"] if c["platform"] == "instagram")
    assert card["state"] == "attention"
    assert card["accounts"]["expired_names"] == ["Aekam Inc"]


@pytest.mark.asyncio
async def test_the_response_carries_what_this_caller_may_do(api_client, wired):
    body = (await api_client.get("/api/v1/hub/connectors/social-status")).json()
    assert body["can"] == {"connect": True, "send": True, "edit_app": True}
    assert body["denials"] == {"connect": None, "send": None, "edit_app": None}
    assert body["level"] == "admin"


@pytest.mark.asyncio
async def test_no_card_in_a_real_response_carries_a_secret_or_an_id(
    api_client, wired,
):
    body = (await api_client.get("/api/v1/hub/connectors/social-status")).json()
    for path, key in _walk(body):
        # `client_id` is the page's own selector value and is never drawn;
        # `id` on a client row is the same. Everything else on the list is a
        # secret or an account identifier and has no business here.
        if path.startswith("$.clients") or key in ("client_id", "clients"):
            continue
        assert key not in _FORBIDDEN, f"{path}.{key} leaked"


@pytest.mark.asyncio
async def test_the_lead_sources_have_no_card(api_client, wired):
    body = (await api_client.get("/api/v1/hub/connectors/social-status")).json()
    drawn = {c["platform"] for c in body["data"]}
    assert "justdial" not in drawn and "indiamart" not in drawn


@pytest.mark.asyncio
async def test_an_org_with_no_internal_client_gets_a_null_rather_than_a_write(
    api_client, wired, mock_pool,
):
    """A firm that has never opened Sahayak has no `hub_clients` row. The page
    says so; it does not create one on the way past."""
    async def _fetch(query, *args):
        return []

    mock_pool.fetch.side_effect = _fetch
    body = (await api_client.get("/api/v1/hub/connectors/social-status")).json()
    assert body["client_id"] is None
    assert body["clients"] == []
    assert all(c["accounts"]["connected"] == 0 for c in body["data"])
    mock_pool.execute.assert_not_called()
