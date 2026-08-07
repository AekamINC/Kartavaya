"""The connectors page: one card per network, each with its own form.

── WHAT WAS WRONG ──────────────────────────────────────────────────────────────

Every OAuth connector read its app id and secret from a hard-coded environment
variable. Measured on staging 2026-08-07: not one of them is set, so no OAuth
flow in the product could complete, and there was no screen to set them —
`hub_social_accounts` holds connected accounts, not app credentials. It also
fixed the platform to ONE app per network, which an agency whose client has
their own cannot express.

`twitter` was in `ALL_PLATFORMS` with no entry in `OAUTH_CONFIGS`, so it answered
`400 Unsupported platform`: a network the product offered and could not deliver.

── WHAT IS PINNED HERE ─────────────────────────────────────────────────────────

  · A SECRET NEVER REACHES A BROWSER. Asserted on the shape `public_view`
    produces rather than on one endpoint, because the redaction is structural —
    a secret field added tomorrow must be redacted without anyone editing a
    serialiser.
  · THE FORMS ARE PLATFORM-SPECIFIC. The owner rejected a generic
    "client id / secret" pair explicitly. So: no two platforms share a field
    set by accident, every field names the console page it is copied from, and
    the labels are the NETWORK's own words.
  · THE LOOKUP ORDER IS per-client → org → env. The last step is what makes
    this deployable without breaking anything that works today.
  · THE RETIRED PLATFORMS STAY RETIRED. TikTok is banned in India; Telegram and
    Snapchat were unconnectable and the owner ruled them out.
  · JUSTDIAL AND INDIAMART ARE NOT PUBLISH TARGETS. They are inbound lead
    sources. Offering them on a Publish screen would offer something that
    cannot work.
"""
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from services import connector_credentials as cc


# ── 1 · the forms ───────────────────────────────────────────────────────────

def test_every_platform_declares_its_own_fields_with_a_console_path():
    """The owner rejected a generic client id / secret pair. The reason is the
    operator has the network's console open in another tab, and the console does
    not say "client id" — Meta says App ID, WhatsApp says Phone number ID."""
    for s in cc.SPECS:
        assert s.fields, f"{s.key} has no form"
        for f in s.fields:
            assert f.label, f"{s.key}.{f.key} has no label"
            assert len(f.where) > 20, (
                f"{s.key}.{f.key} does not say where in the console to find it"
            )


def test_no_two_platforms_share_a_field_set_by_accident():
    """Two networks with identical forms means one of them was filled in from
    the other's docs.

    Two FAMILIES genuinely share one — Meta's three products run off one app,
    and Google Business Profile and YouTube run off one Cloud OAuth client. Both
    are exempted by name rather than by a rule, so a third coincidence has to be
    justified in writing before it passes."""
    meta = {"facebook", "instagram", "threads", "google_business", "youtube"}
    seen: dict[tuple, str] = {}
    for s in cc.SPECS:
        if s.key in meta:
            continue
        shape = tuple(sorted((f.key, f.label) for f in s.fields))
        assert shape not in seen, f"{s.key} has the same form as {seen[shape]}"
        seen[shape] = s.key


def test_whatsapp_is_one_card_on_this_page_and_not_an_oauth_connector():
    """The owner: WhatsApp Business is one card here, NOT a separate page and
    not a special case. It is `token` rather than `oauth` because Meta's Cloud
    API has no consent round-trip — four values, copied by hand."""
    s = cc.spec("whatsapp_business")
    assert s.kind == "token"
    keys = {f.key for f in s.fields}
    assert keys == {"phone_number_id", "waba_id", "access_token", "verify_token"}
    # The one the operator invents. If the form does not say so, they go looking
    # for it in Meta's console and cannot find it.
    verify = next(f for f in s.fields if f.key == "verify_token")
    assert "invent" in verify.where.lower()


def test_every_connectable_platform_shows_a_redirect_url_to_paste(monkeypatch):
    """Consent fails before it starts if the URL is not in the network's console
    first — and it must be the SAME string the flow sends, not a second one
    built independently."""
    monkeypatch.setenv("BACKEND_URL", "https://api.example.com/")
    for s in cc.SPECS:
        url = cc.redirect_url(s.key)
        if s.kind == "lead":
            assert url == "", f"{s.key} is inbound and has no redirect"
        else:
            assert url.startswith("https://api.example.com/api/"), s.key


def test_x_says_plainly_that_posting_is_a_paid_tier():
    """A correctly filled card that still cannot publish is the worst failure
    this page can produce, so it is stated on the card rather than discovered."""
    s = cc.spec("twitter")
    assert "PAID" in s.caution.upper()


# ── 2 · what the browser gets ───────────────────────────────────────────────

def test_a_saved_secret_is_never_returned():
    secrets = {"app_secret": "abcdef0123456789"}
    blob, hint = cc.seal(secrets)
    view = cc.public_view("facebook", {
        "id": "1", "public_fields": {"app_id": "123"},
        "secrets_encrypted": blob, "secret_hint": hint, "is_active": True,
    })
    flat = json.dumps(view)
    assert "abcdef0123456789" not in flat
    assert blob not in flat, "the ciphertext is not a safe thing to hand out either"
    assert view["has_secret"] is True
    assert view["secret_hint"] == "6789"
    # A public field IS echoed — the operator has to see what is saved without
    # retyping it.
    assert [f for f in view["fields"] if f["key"] == "app_id"][0]["value"] == "123"
    assert [f for f in view["fields"] if f["key"] == "app_secret"][0]["value"] == ""


def test_redaction_is_structural_rather_than_remembered():
    """Every secret field of every platform, blank in the response. Asserted
    across the whole spec table so a field added later is covered without this
    test being edited."""
    for s in cc.SPECS:
        secrets = {f.key: "S3CR3T-VALUE" for f in s.fields if f.secret}
        blob, hint = cc.seal(secrets)
        view = cc.public_view(s.key, {
            "id": "1", "public_fields": {}, "secrets_encrypted": blob,
            "secret_hint": hint,
        })
        assert "S3CR3T-VALUE" not in json.dumps(view), s.key


def test_a_field_the_platform_does_not_declare_is_dropped():
    public, secrets = cc.split_values("facebook", {
        "app_id": "1", "app_secret": "2", "smuggled": "3",
    })
    assert public == {"app_id": "1"}
    assert secrets == {"app_secret": "2"}


def test_a_secret_cannot_be_stored_in_clear_by_the_caller():
    """Whether a value is a secret is a property of the FIELD, declared once
    next to the label. A caller cannot flip it."""
    public, secrets = cc.split_values("whatsapp_business", {
        "access_token": "EAA…", "phone_number_id": "109",
    })
    assert "access_token" not in public
    assert secrets["access_token"] == "EAA…"


def test_a_credential_that_cannot_be_decrypted_degrades_to_nothing():
    """The key rotated, or the row came from another environment. That must read
    as "no credentials" — one bad row must not 500 a page listing twelve."""
    assert cc.unseal("not-a-fernet-token") == {}
    assert cc.unseal(None) == {}


# ── 3 · whose app answers ───────────────────────────────────────────────────

def _pool(rows):
    pool = MagicMock()
    pool.fetch = AsyncMock(return_value=rows)
    return pool


ORG = "00000000-0000-0000-0000-0000000000aa"
CLIENT = "00000000-0000-0000-0000-0000000000bb"


@pytest.mark.asyncio
async def test_a_clients_own_app_outranks_the_org_default():
    blob_c, _ = cc.seal({"app_secret": "client-secret"})
    blob_o, _ = cc.seal({"app_secret": "org-secret"})
    pool = _pool([
        {"id": "1", "client_id": None, "public_fields": {"app_id": "ORG"},
         "secrets_encrypted": blob_o},
        {"id": "2", "client_id": CLIENT, "public_fields": {"app_id": "CLIENT"},
         "secrets_encrypted": blob_c},
    ])
    got = await cc.resolve(pool, ORG, "facebook", CLIENT)
    assert got.source == "client"
    assert got.values["app_id"] == "CLIENT"
    assert got.values["app_secret"] == "client-secret"


@pytest.mark.asyncio
async def test_the_org_default_answers_when_the_client_has_no_override():
    blob_o, _ = cc.seal({"app_secret": "org-secret"})
    pool = _pool([{"id": "1", "client_id": None,
                   "public_fields": {"app_id": "ORG"}, "secrets_encrypted": blob_o}])
    got = await cc.resolve(pool, ORG, "facebook", CLIENT)
    assert got.source == "org"
    assert got.values["app_id"] == "ORG"


@pytest.mark.asyncio
async def test_the_environment_variable_still_answers_last(monkeypatch):
    """The whole reason this is deployable. Every platform nobody has filled a
    form in for keeps reading exactly the variable hub_publish read before."""
    monkeypatch.setenv("META_APP_ID", "from-env")
    monkeypatch.setenv("META_APP_SECRET", "secret-from-env")
    got = await cc.resolve(_pool([]), ORG, "facebook", CLIENT)
    assert got.source == "env"
    assert got.values["app_id"] == "from-env"
    assert got.values["app_secret"] == "secret-from-env"


@pytest.mark.asyncio
async def test_nothing_saved_and_nothing_in_the_environment_is_not_an_error(monkeypatch):
    monkeypatch.delenv("META_APP_ID", raising=False)
    monkeypatch.delenv("META_APP_SECRET", raising=False)
    got = await cc.resolve(_pool([]), ORG, "facebook", CLIENT)
    assert not got and got.source == "none"


@pytest.mark.asyncio
async def test_only_an_active_row_can_answer():
    """A half-filled form left mid-edit must not outrank a working default —
    which is what `is_active` defaulting to FALSE buys, enforced in the WHERE
    clause rather than in Python."""
    pool = _pool([])
    await cc.resolve(pool, ORG, "facebook", CLIENT)
    sql = " ".join(pool.fetch.call_args[0][0].split())
    assert "is_active=TRUE" in sql
    assert "org_id=$1::uuid" in sql, "the read must be org-scoped"


def test_a_card_cannot_be_switched_on_half_filled():
    assert cc.missing_fields("facebook", {"app_id": "1"}) == ["App Secret"]
    assert cc.missing_fields("facebook", {"app_id": "1", "app_secret": "2"}) == []


# ── 4 · the platform list ───────────────────────────────────────────────────

def test_the_retired_platforms_are_gone_from_everywhere():
    """TikTok is banned in India. Telegram and Snapchat were unconnectable and
    the owner ruled them out rather than leave them erroring."""
    from routers.hub_publish import ALL_PLATFORMS, OAUTH_CONFIGS
    for dead in ("tiktok", "telegram", "snapchat"):
        assert dead not in [s.key for s in cc.SPECS]
        assert dead not in ALL_PLATFORMS
        assert dead not in OAUTH_CONFIGS
        assert dead in cc.RETIRED_PLATFORMS, "named, so nobody 'restores' it"


def test_x_is_kept_and_is_now_actually_connectable():
    """It was in ALL_PLATFORMS with no OAUTH_CONFIGS entry, so it answered
    `400 Unsupported platform` — a platform the product offered and could not
    deliver."""
    from routers.hub_publish import ALL_PLATFORMS, OAUTH_CONFIGS
    assert "twitter" in ALL_PLATFORMS
    assert "twitter" in OAUTH_CONFIGS
    assert OAUTH_CONFIGS["twitter"]["token_url"].startswith("https://")
    # Without offline.access every account has to be reconnected in two hours.
    assert "offline.access" in OAUTH_CONFIGS["twitter"]["scopes"]


def test_the_lead_sources_are_not_publish_targets():
    """JustDial and IndiaMART are inbound. A Publish screen offering them would
    be offering something that cannot work.

    Ingestion IS built as of 2026-08-07 (`services/lead_ingest.py`), so the
    cautions no longer say it is not — but `publishes` stays False, because
    receiving enquiries and posting content are still opposite directions."""
    from routers.hub_publish import ALL_PLATFORMS
    for lead in ("justdial", "indiamart"):
        s = cc.spec(lead)
        assert s is not None and s.publishes is False
        assert lead not in ALL_PLATFORMS
        assert "not built" not in s.caution, "ingestion ships now; the card must not say otherwise"

    # The two work in opposite directions and the cards have to say which,
    # because it decides what the operator does next: send a URL, or wait.
    assert "PUSHES" in cc.spec("justdial").caution
    assert "PULLED" in cc.spec("indiamart").caution


def test_the_publish_list_is_derived_and_cannot_drift():
    """One list, one place. A platform with a credentials card you cannot
    publish to, or a publish target with no card, is the drift this prevents."""
    from routers.hub_publish import ALL_PLATFORMS
    assert ALL_PLATFORMS == list(cc.PUBLISH_PLATFORMS)
    assert set(ALL_PLATFORMS) == {s.key for s in cc.SPECS if s.publishes}
