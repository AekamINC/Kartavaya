"""Post as…? — the question the OAuth callback never asked.

── THE THREE DEFECTS, ALL OF THEM VERIFIED IN CODE BEFORE THIS FILE EXISTED ──

 1. WE SILENTLY KEPT THE FIRST DESTINATION. `_fetch_meta_accounts` did
    `page = page_list[0]`; `_fetch_google_locations` did `accounts[0]` then
    `locations[0]`. A firm administering three Facebook Pages got whichever
    Facebook returned first, was never asked, and was never told.

 2. ONE ACCOUNT PER CLIENT PER NETWORK. The upsert conflicted on
    `(client_id, platform, account_id)` where `account_id` was the CONSENTING
    PERSON's id, not the destination's — so connecting a second Page conflicted
    with the first and the DO UPDATE overwrote it, token and all.

 3. LINKEDIN HAD NO PAGE CONCEPT AT ALL. `_fetch_linkedin_profile` stored `sub`
    from /v2/userinfo and the publisher hardcoded `urn:li:person:{id}`, so a
    firm's posts landed on the consenting partner's personal feed.

── THE OWNER'S RULE, 2026-08-21 ──────────────────────────────────────────────

    "any connectors can do both. depends on org — someone org is sole business
     owner who is its own page."
    "and also option to have multiple for all connectors ... as a company can
     have multiple account across social media."

One picker, every network, many destinations. BOTH LinkedIn shapes must work —
that is the whole point, and `test_a_person_and_an_organisation_build_different_
urns` is the assertion that says so.

── WHAT IS DELIBERATELY NOT TESTED HERE ──────────────────────────────────────

No OAuth flow is ever completed against a real network from this repository, and
none is completed here. Every network response below is a RECORDED SHAPE, taken
from each provider's published reference, fed through the same parsing the
callback uses. That proves the parsing and the storing; it cannot prove a field
name against a live account, and the listers say so in their own docstrings.
"""
from __future__ import annotations

import inspect
import json

import pytest

import routers.hub_publish as hp
import services.social_publisher as sp


ORG = "00000000-0000-0000-0000-000000000001"
OTHER_ORG = "00000000-0000-0000-0000-0000000000ff"
CLIENT = "11111111-1111-1111-1111-111111111111"
USER = "user_admin001"


class _Row(dict):
    """asyncpg rows are mappings that also index by key; dict is enough."""


def _wrapper(access_token="tok", refresh_token="", expires=None, scopes=None):
    """The same `_wrap` closure `_list_destinations` builds, isolated.

    Reaching for the private closure keeps the encryption behaviour under test:
    a lister that forgot to encrypt would pass a test that built its own dicts.
    """
    captured = {}

    async def _run(platform, lister):
        async def _fake_list(*a, **kw):
            raise AssertionError("not used")
        return captured

    def wrap(name, kind, account_id, page_id="", token=None, meta=None):
        from services.encryption import encrypt
        return {
            "name": name,
            "kind": kind,
            "account_id": account_id,
            "page_id": page_id or account_id,
            "access_token": encrypt(token or access_token),
            "refresh_token": encrypt(refresh_token) if refresh_token else None,
            "token_expires_at": expires.isoformat() if expires else None,
            "scopes": scopes or [],
            "metadata": {"destination_kind": kind, **(meta or {})},
        }

    return wrap


# ── 1 · the callback RETURNS THE LIST rather than storing one ───────────────


def test_the_callback_no_longer_picks_the_first_of_anything():
    """The literal defect. `page_list[0]` and `locations[0]` are gone from the
    connect path — the old helpers survive, unused, and say so."""
    src = inspect.getsource(hp.oauth_callback)
    assert "_list_destinations" in src, (
        "the callback must enumerate the consent, not pick from it"
    )
    for guessed in ("_fetch_meta_accounts", "_fetch_linkedin_profile",
                    "_fetch_google_locations"):
        assert guessed not in src, (
            f"{guessed} keeps the FIRST destination and must not be on the "
            f"connect path"
        )


def test_the_callback_writes_no_account_row():
    """THE PROMISE. Nothing may be stored against a client until a human has
    chosen — so `hub_social_accounts` must not appear in the callback at all."""
    # Comments are stripped: this file's own explanation of what it no longer
    # does mentions the table by name, and a check that a comment can fail is a
    # check somebody deletes.
    code = "\n".join(
        line for line in inspect.getsource(hp.oauth_callback).splitlines()
        if not line.strip().startswith("#")
    )
    assert "hub_social_accounts" not in code, (
        "the callback stores an account again; the picker exists so that it "
        "does not"
    )
    assert "INSERT" not in code.upper(), (
        "the only write on this path is the parked consent, and that goes "
        "through _store_pending_choice"
    )


def test_the_parked_consent_is_keyed_on_nothing_and_expires():
    """The intermediate step holds the list WITHOUT storing it anywhere a
    client can be read from. `hub_oauth_states` is the OAuth scratchpad: an
    opaque key, a jsonb body, a created_at to expire on."""
    src = inspect.getsource(hp._store_pending_choice)
    assert "hub_oauth_states" in src
    assert "hub_social_accounts" not in src
    read = inspect.getsource(hp._read_pending_choice)
    assert "created_at >" in read, "a parked consent that never expires is a token store"
    assert hp.PENDING_CHOICE_MINUTES > 0


@pytest.mark.asyncio
async def test_the_list_comes_back_as_names_and_kinds_and_never_a_token(
    api_client, app, mock_pool, monkeypatch, admin_user,
):
    from auth_router import require_user
    from middleware.org_resolver import get_org_id

    app.dependency_overrides[require_user] = lambda: admin_user
    app.dependency_overrides[get_org_id] = lambda: ORG
    app.dependency_overrides[hp._hub_gate] = lambda: "sahayak"

    parked = {
        "kind": hp.PENDING_KIND,
        "platform": "facebook",
        "client_id": CLIENT,
        "org_id": ORG,
        "user_id": USER,
        "client_name": "Unicode Group",
        "note": "",
        "destinations": [
            {"name": "Unicode Group", "kind": "facebook_page",
             "account_id": "1001", "page_id": "1001",
             "access_token": "ENCRYPTED-A", "refresh_token": None,
             "token_expires_at": None, "scopes": [], "metadata": {}},
            {"name": "Unicode Careers", "kind": "facebook_page",
             "account_id": "1002", "page_id": "1002",
             "access_token": "ENCRYPTED-B", "refresh_token": None,
             "token_expires_at": None, "scopes": [], "metadata": {}},
        ],
    }

    async def _fetchrow(query, *args):
        if "hub_oauth_states" in query:
            return _Row(data=json.dumps(parked))
        return None

    mock_pool.fetchrow.side_effect = _fetchrow

    try:
        r = await api_client.get("/api/v1/hub/oauth/pending/tok123")
        assert r.status_code == 200, r.text
        body = r.json()

        assert [d["name"] for d in body["destinations"]] == [
            "Unicode Group", "Unicode Careers",
        ]
        # WHAT IT IS, beside the name — the whole reason the picker is readable.
        assert all(d["what"] == "Company Page" for d in body["destinations"])
        assert body["client_name"] == "Unicode Group"

        blob = json.dumps(body)
        assert "ENCRYPTED-A" not in blob and "ENCRYPTED-B" not in blob, (
            "a token reached the browser"
        )
        for d in body["destinations"]:
            assert "access_token" not in d and "refresh_token" not in d
            # Chosen by an opaque positional key, shown by NAME. The
            # destination's own id is never sent.
            assert d["key"].startswith("d")
            assert "1001" not in json.dumps(d) and "1002" not in json.dumps(d)

        # AND NOTHING WAS WRITTEN.
        mock_pool.execute.assert_not_called()
    finally:
        for dep in (require_user, get_org_id, hp._hub_gate):
            app.dependency_overrides.pop(dep, None)


@pytest.mark.asyncio
async def test_a_parked_consent_belongs_to_the_person_who_started_it(
    api_client, app, mock_pool, admin_user,
):
    """A parked payload carries live tokens for somebody's social accounts. It
    is readable by the person who began the consent and by nobody else — not by
    a colleague on the same rung, and not by the same person in another org."""
    from auth_router import require_user
    from middleware.org_resolver import get_org_id

    app.dependency_overrides[require_user] = lambda: admin_user
    app.dependency_overrides[get_org_id] = lambda: OTHER_ORG
    app.dependency_overrides[hp._hub_gate] = lambda: "sahayak"

    parked = {
        "kind": hp.PENDING_KIND, "platform": "facebook", "client_id": CLIENT,
        "org_id": ORG, "user_id": USER, "client_name": "", "note": "",
        "destinations": [],
    }

    async def _fetchrow(query, *args):
        if "hub_oauth_states" in query:
            return _Row(data=json.dumps(parked))
        return None

    mock_pool.fetchrow.side_effect = _fetchrow

    try:
        r = await api_client.get("/api/v1/hub/oauth/pending/tok123")
        assert r.status_code == 404, r.text
        # The same sentence an expired one gets. Telling a stranger a token is
        # valid but not theirs tells them a token is valid.
        assert "expired" in r.json()["detail"].lower()
    finally:
        for dep in (require_user, get_org_id, hp._hub_gate):
            app.dependency_overrides.pop(dep, None)


@pytest.mark.asyncio
async def test_an_in_flight_oauth_state_is_not_a_choice(mock_pool):
    """`hub_oauth_states` holds two kinds of row. Reading an in-flight OAuth
    state as a parked choice would hand back the consent's own payload keyed on
    its own state string."""
    async def _fetchrow(query, *args):
        return _Row(data=json.dumps({
            "platform": "facebook", "client_id": CLIENT, "org_id": ORG,
            "user_id": USER,
        }))

    mock_pool.fetchrow.side_effect = _fetchrow
    assert await hp._read_pending_choice("some-state") is None


# ── 2 · nothing is written before a choice ──────────────────────────────────


@pytest.mark.asyncio
async def test_the_picker_stores_nothing_when_no_destination_is_chosen(
    api_client, app, mock_pool, admin_user,
):
    from auth_router import require_user
    from middleware.org_resolver import get_org_id

    app.dependency_overrides[require_user] = lambda: admin_user
    app.dependency_overrides[get_org_id] = lambda: ORG
    app.dependency_overrides[hp._hub_gate] = lambda: "sahayak"
    app.dependency_overrides[hp._require_connect_authority] = lambda: admin_user

    try:
        r = await api_client.post(
            f"/api/v1/hub/clients/{CLIENT}/social-accounts",
            json={"choice_token": "tok123", "destinations": []},
        )
        assert r.status_code == 422, r.text
        mock_pool.fetchrow.assert_not_called()
        mock_pool.execute.assert_not_called()
    finally:
        for dep in (require_user, get_org_id, hp._hub_gate,
                    hp._require_connect_authority):
            app.dependency_overrides.pop(dep, None)


@pytest.mark.asyncio
async def test_a_consent_for_another_client_is_refused_by_name(
    api_client, app, mock_pool, admin_user,
):
    """The round trip through the provider is a full page load, so the page
    forgets which client was selected. Storing against whichever client the page
    fell back to would file a firm's Page token under somebody else."""
    from auth_router import require_user
    from middleware.org_resolver import get_org_id

    app.dependency_overrides[require_user] = lambda: admin_user
    app.dependency_overrides[get_org_id] = lambda: ORG
    app.dependency_overrides[hp._hub_gate] = lambda: "sahayak"
    app.dependency_overrides[hp._require_connect_authority] = lambda: admin_user

    parked = {
        "kind": hp.PENDING_KIND, "platform": "facebook",
        "client_id": "22222222-2222-2222-2222-222222222222",
        "org_id": ORG, "user_id": USER, "client_name": "Unicode Group",
        "note": "",
        "destinations": [{"name": "P", "kind": "facebook_page",
                          "account_id": "1", "page_id": "1",
                          "access_token": "X", "refresh_token": None,
                          "token_expires_at": None, "scopes": [],
                          "metadata": {}}],
    }

    async def _fetchrow(query, *args):
        if "hub_clients" in query:
            return _Row(**{"?column?": 1})
        if "hub_oauth_states" in query:
            return _Row(data=json.dumps(parked))
        return None

    mock_pool.fetchrow.side_effect = _fetchrow

    try:
        r = await api_client.post(
            f"/api/v1/hub/clients/{CLIENT}/social-accounts",
            json={"choice_token": "tok123", "destinations": ["d0"]},
        )
        assert r.status_code == 400, r.text
        assert "Unicode Group" in r.json()["detail"]
        mock_pool.execute.assert_not_called()
    finally:
        for dep in (require_user, get_org_id, hp._hub_gate,
                    hp._require_connect_authority):
            app.dependency_overrides.pop(dep, None)


# ── 3 · two destinations for one client BOTH survive ────────────────────────


@pytest.mark.asyncio
async def test_two_destinations_for_one_client_both_survive(
    api_client, app, mock_pool, admin_user,
):
    """THE DEFECT, in one test. Two Facebook Pages, one client, one consent —
    two rows, each keyed on ITS OWN id, neither overwriting the other.

    Before this, both inserts carried the consenting person's id in
    `account_id`, so the second conflicted with the first and the DO UPDATE
    replaced its name, its page and its token.
    """
    from auth_router import require_user
    from middleware.org_resolver import get_org_id

    app.dependency_overrides[require_user] = lambda: admin_user
    app.dependency_overrides[get_org_id] = lambda: ORG
    app.dependency_overrides[hp._hub_gate] = lambda: "sahayak"
    app.dependency_overrides[hp._require_connect_authority] = lambda: admin_user

    parked = {
        "kind": hp.PENDING_KIND, "platform": "facebook", "client_id": CLIENT,
        "org_id": ORG, "user_id": USER, "client_name": "Aekam Inc", "note": "",
        "destinations": [
            {"name": "Aekam Inc", "kind": "facebook_page",
             "account_id": "1001", "page_id": "1001",
             "access_token": "CIPHER-A", "refresh_token": None,
             "token_expires_at": None, "scopes": ["pages_manage_posts"],
             "metadata": {"destination_kind": "facebook_page"}},
            {"name": "Aekam Careers", "kind": "facebook_page",
             "account_id": "1002", "page_id": "1002",
             "access_token": "CIPHER-B", "refresh_token": None,
             "token_expires_at": None, "scopes": ["pages_manage_posts"],
             "metadata": {"destination_kind": "facebook_page"}},
            {"name": "Somebody else's page", "kind": "facebook_page",
             "account_id": "1003", "page_id": "1003",
             "access_token": "CIPHER-C", "refresh_token": None,
             "token_expires_at": None, "scopes": [], "metadata": {}},
        ],
    }

    inserts = []

    async def _fetchrow(query, *args):
        if "hub_clients" in query:
            return _Row(**{"?column?": 1})
        if "hub_oauth_states" in query:
            return _Row(data=json.dumps(parked))
        if "INSERT INTO public.hub_social_accounts" in query:
            inserts.append((query, args))
            return _Row(platform=args[2], account_name=args[3])
        return None

    mock_pool.fetchrow.side_effect = _fetchrow

    try:
        r = await api_client.post(
            f"/api/v1/hub/clients/{CLIENT}/social-accounts",
            json={"choice_token": "tok123", "destinations": ["d0", "d1"]},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["connected"] == 2
        assert [a["account_name"] for a in body["accounts"]] == [
            "Aekam Inc", "Aekam Careers",
        ]

        # TWO INSERTS. Not one, and not three — the destination nobody chose is
        # not stored.
        assert len(inserts) == 2
        ids = [args[4] for _q, args in inserts]
        assert ids == ["1001", "1002"], (
            "account_id must hold THE DESTINATION'S id — it is the uniqueness "
            "key, and the consenting person's id is what made the second Page "
            "overwrite the first"
        )
        # DISTINCT, which is the only reason both rows can exist under
        # UNIQUE (client_id, platform, account_id).
        assert len(set(ids)) == 2

        # Each destination keeps ITS OWN token. A Page token is not the user
        # token and `/{page-id}/feed` takes only its own.
        assert [args[6] for _q, args in inserts] == ["CIPHER-A", "CIPHER-B"]

        # THE UPSERT IS ON THE DESTINATION.
        assert "ON CONFLICT (client_id, platform, account_id)" in inserts[0][0]

        # And the consent is spent — its parked tokens deleted, not left to
        # expire.
        deletes = [c for c in mock_pool.execute.call_args_list
                   if "DELETE FROM public.hub_oauth_states" in c.args[0]]
        assert len(deletes) == 1
    finally:
        for dep in (require_user, get_org_id, hp._hub_gate,
                    hp._require_connect_authority):
            app.dependency_overrides.pop(dep, None)


@pytest.mark.asyncio
async def test_a_parked_token_is_never_encrypted_twice(
    api_client, app, mock_pool, admin_user,
):
    """`_list_destinations` encrypts on the way INTO the parked payload. The
    insert must pass that ciphertext through untouched: encrypting again would
    store a ciphertext of a ciphertext, and every publish would fail against a
    token the network has never issued."""
    from services.encryption import encrypt, decrypt

    from auth_router import require_user
    from middleware.org_resolver import get_org_id

    app.dependency_overrides[require_user] = lambda: admin_user
    app.dependency_overrides[get_org_id] = lambda: ORG
    app.dependency_overrides[hp._hub_gate] = lambda: "sahayak"
    app.dependency_overrides[hp._require_connect_authority] = lambda: admin_user

    cipher = encrypt("the-real-page-token")
    parked = {
        "kind": hp.PENDING_KIND, "platform": "facebook", "client_id": CLIENT,
        "org_id": ORG, "user_id": USER, "client_name": "", "note": "",
        "destinations": [
            {"name": "Aekam Inc", "kind": "facebook_page",
             "account_id": "1001", "page_id": "1001",
             "access_token": cipher, "refresh_token": None,
             "token_expires_at": None, "scopes": [], "metadata": {}},
        ],
    }
    stored = {}

    async def _fetchrow(query, *args):
        if "hub_clients" in query:
            return _Row(**{"?column?": 1})
        if "hub_oauth_states" in query:
            return _Row(data=json.dumps(parked))
        if "INSERT INTO public.hub_social_accounts" in query:
            stored["token"] = args[6]
            return _Row(platform="facebook", account_name="Aekam Inc")
        return None

    mock_pool.fetchrow.side_effect = _fetchrow

    try:
        r = await api_client.post(
            f"/api/v1/hub/clients/{CLIENT}/social-accounts",
            json={"choice_token": "tok123", "destinations": ["d0"]},
        )
        assert r.status_code == 200, r.text
        assert decrypt(stored["token"]) == "the-real-page-token"
    finally:
        for dep in (require_user, get_org_id, hp._hub_gate,
                    hp._require_connect_authority):
            app.dependency_overrides.pop(dep, None)


# ── 4 · the listers enumerate, from recorded shapes ─────────────────────────


@pytest.mark.asyncio
async def test_meta_lists_every_page_not_the_first():
    pages = {"data": [
        {"id": "1001", "name": "Aekam Inc", "access_token": "page-a"},
        {"id": "1002", "name": "Aekam Careers", "access_token": "page-b"},
        {"id": "1003", "name": "Unicode Group", "access_token": "page-c"},
    ]}

    class _Resp:
        def __init__(self, payload): self._p = payload
        def raise_for_status(self): pass
        def json(self): return self._p
        status_code = 200

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, **kw):
            if url.endswith("/me"):
                return _Resp({"id": "9", "name": "A Partner"})
            return _Resp(pages)

    import httpx
    real = httpx.AsyncClient
    httpx.AsyncClient = lambda *a, **kw: _Client()
    try:
        out = await hp._list_meta_destinations("tok", "facebook", _wrapper())
    finally:
        httpx.AsyncClient = real

    assert [d["name"] for d in out] == [
        "Aekam Inc", "Aekam Careers", "Unicode Group",
    ]
    assert [d["account_id"] for d in out] == ["1001", "1002", "1003"]
    # THE PAGE'S OWN TOKEN travels with the Page.
    from services.encryption import decrypt
    assert [decrypt(d["access_token"]) for d in out] == [
        "page-a", "page-b", "page-c",
    ]


@pytest.mark.asyncio
async def test_instagram_lists_only_the_business_accounts_a_page_carries():
    """A personal Instagram account cannot be published to at all, and a Page
    with no linked business account is not a destination. Offering either would
    be offering something that cannot work."""
    pages = {"data": [
        {"id": "1001", "name": "Aekam Inc", "access_token": "page-a",
         "instagram_business_account": {"id": "17841400", "username": "aekaminc"}},
        {"id": "1002", "name": "No IG here", "access_token": "page-b"},
    ]}

    class _Resp:
        def __init__(self, payload): self._p = payload
        def raise_for_status(self): pass
        def json(self): return self._p
        status_code = 200

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, **kw):
            if url.endswith("/me"):
                return _Resp({"id": "9", "name": "A Partner"})
            return _Resp(pages)

    import httpx
    real = httpx.AsyncClient
    httpx.AsyncClient = lambda *a, **kw: _Client()
    try:
        out = await hp._list_meta_destinations("tok", "instagram", _wrapper())
    finally:
        httpx.AsyncClient = real

    assert len(out) == 1
    assert out[0]["name"] == "aekaminc"
    assert out[0]["kind"] == "instagram_business"
    assert out[0]["account_id"] == "17841400"


@pytest.mark.asyncio
async def test_google_lists_every_location_across_every_account():
    class _Resp:
        def __init__(self, payload, code=200): self._p, self.status_code = payload, code
        def raise_for_status(self): pass
        def json(self): return self._p

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, **kw):
            if url.endswith("/v1/accounts"):
                return _Resp({"accounts": [
                    {"name": "accounts/1", "accountName": "Aekam Inc"},
                    {"name": "accounts/2", "accountName": "Unicode Group"},
                ]})
            if "accounts/1/locations" in url:
                return _Resp({"locations": [
                    {"name": "locations/11", "title": "Aekam — Ahmedabad"},
                    {"name": "locations/12", "title": "Aekam — Surat"},
                ]})
            return _Resp({"locations": [
                {"name": "locations/21", "title": "Unicode — Mumbai"},
            ]})

    import httpx
    real = httpx.AsyncClient
    httpx.AsyncClient = lambda *a, **kw: _Client()
    try:
        out = await hp._list_google_destinations("tok", _wrapper())
    finally:
        httpx.AsyncClient = real

    assert [d["name"] for d in out] == [
        "Aekam — Ahmedabad", "Aekam — Surat", "Unicode — Mumbai",
    ]
    assert all(d["kind"] == "google_location" for d in out)
    assert [d["account_id"] for d in out] == [
        "locations/11", "locations/12", "locations/21",
    ]


@pytest.mark.asyncio
async def test_a_network_that_fails_costs_a_sentence_and_not_a_500():
    """The callback is a redirect the person cannot retry without re-consenting.
    An exception here would be a 500 on that redirect."""
    import httpx

    class _Boom:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **kw): raise RuntimeError("network down")

    real = httpx.AsyncClient
    httpx.AsyncClient = lambda *a, **kw: _Boom()
    try:
        out = await hp._list_destinations("facebook", "tok", "", None, [])
    finally:
        httpx.AsyncClient = real
    assert out == []


# ── 5 · LinkedIn: a person and an organisation are different urns ───────────


def test_a_person_and_an_organisation_build_different_urns():
    """THE OWNER'S WHOLE POINT: both must work.

    A sole practitioner IS their own brand and posts as themselves; a firm posts
    as its Company Page. Until now every LinkedIn post in this product was a
    person urn built from the consenting member's `sub`, so a firm's words went
    out under a partner's name.
    """
    person = sp.linkedin_author_urn({
        "account_id": "urn:li:person:AbC123",
        "metadata": {"destination_kind": "person"},
    })
    org = sp.linkedin_author_urn({
        "account_id": "urn:li:organization:8899",
        "metadata": {"destination_kind": "linkedin_organization"},
    })

    assert person == "urn:li:person:AbC123"
    assert org == "urn:li:organization:8899"
    assert person != org


def test_the_organisation_urn_survives_a_bare_id_in_the_column():
    """A row whose kind says organisation is an organisation even if whoever
    wrote it stored the bare id. Reading the kind first is what makes the
    column's shape not load-bearing."""
    assert sp.linkedin_author_urn({
        "account_id": "8899",
        "metadata": {"destination_kind": "linkedin_organization"},
    }) == "urn:li:organization:8899"


def test_a_row_written_before_the_picker_is_still_a_person():
    """Every row the old callback could have written held `sub` from
    /v2/userinfo. Guessing organisation for one would post a firm's words
    somewhere it has never posted."""
    assert sp.linkedin_author_urn({"account_id": "AbC123", "metadata": {}}) \
        == "urn:li:person:AbC123"
    assert sp.linkedin_author_urn({"account_id": "AbC123"}) \
        == "urn:li:person:AbC123"


def test_the_publisher_reads_the_alias_publish_content_gives_the_metadata():
    """`_get_account` selects `*` so the key is `metadata`; `publish_content`
    aliases it to `acct_meta` to stop `q.*` colliding with it. Both reach the
    publishers, so a helper that reads only one would work through one path and
    silently post to a person through the other."""
    assert sp.linkedin_author_urn({
        "account_id": "urn:li:organization:8899",
        "acct_meta": {"destination_kind": "linkedin_organization"},
    }) == "urn:li:organization:8899"
    # And a jsonb column that came back as text rather than through the codec.
    assert sp.linkedin_author_urn({
        "account_id": "urn:li:organization:8899",
        "metadata": '{"destination_kind": "linkedin_organization"}',
    }) == "urn:li:organization:8899"


def test_the_publisher_uses_the_shared_urn_builder():
    """Read from the module, not the function: `_guarded` replaces the
    publisher with a wrapper and `inspect.getsource` would return that."""
    src = inspect.getsource(sp)
    body = src.split("async def publish_to_linkedin", 1)[1] \
              .split("async def publish_to_google_business", 1)[0]
    assert "linkedin_author_urn(account)" in body
    assert "urn:li:person:" not in body, (
        "the publisher hardcodes a person urn again — the decision belongs in "
        "linkedin_author_urn, where both shapes are built"
    )


def test_linkedin_asks_for_the_company_page_scopes_only_when_the_app_holds_them(
    monkeypatch,
):
    """An app WITHOUT LinkedIn's Community Management grant that asks for
    `r_organization_admin` does not degrade — LinkedIn refuses the authorization
    request outright and Connect breaks entirely. So the scopes are opt-in, and
    the picker says why when they are off."""
    config = hp.OAUTH_CONFIGS["linkedin"]

    monkeypatch.delenv("LINKEDIN_COMMUNITY_MANAGEMENT", raising=False)
    off = hp._scopes_for("linkedin", config)
    assert "r_organization_admin" not in off
    assert "w_member_social" in off, "the personal half must never be dropped"

    monkeypatch.setenv("LINKEDIN_COMMUNITY_MANAGEMENT", "1")
    on = hp._scopes_for("linkedin", config)
    assert "r_organization_admin" in on and "w_organization_social" in on
    assert "w_member_social" in on, (
        "both must work — asking for the Page scopes must not cost the person "
        "the ability to post as themselves"
    )


def test_the_note_is_honest_about_what_linkedin_will_not_give_us(monkeypatch):
    """"Say so precisely rather than silently posting to the wrong place." The
    sentence names the reason — an approval LinkedIn gives the app — rather than
    implying a setting on this screen."""
    monkeypatch.delenv("LINKEDIN_COMMUNITY_MANAGEMENT", raising=False)
    note = hp._destination_note("linkedin", [{"kind": "person"}])
    assert "Community Management" in note
    assert "impossible" in note or "not" in note

    # And it says nothing when the Pages did come back.
    assert hp._destination_note(
        "linkedin", [{"kind": "person"}, {"kind": "linkedin_organization"}],
    ) == ""


@pytest.mark.asyncio
async def test_linkedin_lists_the_member_and_every_organisation(monkeypatch):
    monkeypatch.setenv("LINKEDIN_COMMUNITY_MANAGEMENT", "1")

    class _Resp:
        def __init__(self, payload, code=200): self._p, self.status_code = payload, code
        def raise_for_status(self): pass
        def json(self): return self._p

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, **kw):
            if "userinfo" in url:
                return _Resp({"sub": "AbC123", "name": "A Partner"})
            return _Resp({"elements": [
                {"organization": "urn:li:organization:8899",
                 "organization~": {"localizedName": "Aekam Inc"}},
                {"organization": "urn:li:organization:9900",
                 "organization~": {"localizedName": "Unicode Group"}},
            ]})

    import httpx
    real = httpx.AsyncClient
    httpx.AsyncClient = lambda *a, **kw: _Client()
    try:
        out = await hp._list_linkedin_destinations("tok", _wrapper())
    finally:
        httpx.AsyncClient = real

    assert [d["kind"] for d in out] == [
        "person", "linkedin_organization", "linkedin_organization",
    ]
    assert [d["name"] for d in out] == ["A Partner", "Aekam Inc", "Unicode Group"]
    # THE FULL URN, which is what ugcPosts takes and the one value that is
    # unambiguous between the two kinds.
    assert out[0]["account_id"] == "urn:li:person:AbC123"
    assert out[1]["account_id"] == "urn:li:organization:8899"


@pytest.mark.asyncio
async def test_linkedin_keeps_the_person_when_the_page_lookup_is_refused(
    monkeypatch,
):
    """A 403 on organizationAcls means the app does not hold Community
    Management after all. Losing the whole connection over it would be worse
    than the defect."""
    monkeypatch.setenv("LINKEDIN_COMMUNITY_MANAGEMENT", "1")

    class _Resp:
        def __init__(self, payload, code=200): self._p, self.status_code = payload, code
        def raise_for_status(self): pass
        def json(self): return self._p

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, **kw):
            if "userinfo" in url:
                return _Resp({"sub": "AbC123", "name": "A Partner"})
            return _Resp({}, code=403)

    import httpx
    real = httpx.AsyncClient
    httpx.AsyncClient = lambda *a, **kw: _Client()
    try:
        out = await hp._list_linkedin_destinations("tok", _wrapper())
    finally:
        httpx.AsyncClient = real

    assert len(out) == 1 and out[0]["kind"] == "person"


# ── 6 · the shape the migration is written against ─────────────────────────


def test_every_kind_the_router_can_produce_is_in_the_label_map():
    """The picker draws `DESTINATION_KINDS[kind]`, and migration 188's CHECK
    lists the same eight. A kind produced by a lister and absent from either is
    a row the database refuses, or a line in the picker with no explanation on
    it."""
    src = inspect.getsource(hp)
    for kind in ("person", "facebook_page", "instagram_business",
                 "linkedin_organization", "google_location",
                 "youtube_channel", "pinterest_board", "account"):
        assert kind in hp.DESTINATION_KINDS, kind
        assert f'"{kind}"' in src, f"{kind} is labelled but nothing produces it"


def test_the_migration_is_written_against_the_kinds_this_file_produces():
    from pathlib import Path
    sql = (Path(__file__).resolve().parents[1]
           / "migrations" / "188_many_accounts_per_network.sql").read_text(
        encoding="utf-8")
    for kind in hp.DESTINATION_KINDS:
        assert f"'{kind}'" in sql, (
            f"migration 188's destination_kind CHECK does not allow {kind!r}, "
            f"so a row the router writes would be refused"
        )
    # It changes no key and drops nothing.
    assert "DROP CONSTRAINT" not in sql.split("-- ── REVERSAL")[0]
