"""
The onboarding gate, from the server's side.

`frontend/src/components/layout/Protected.jsx` has implemented
12-auth-onboarding.md §5's redirect since the wizard was routed:

    user?.org?.onboarding_complete === false  ->  <Navigate to="/onboarding" />

and until this change `onboarding_complete` existed nowhere in the backend and
`_safe_user` returned no `org` object of any kind, so the gate could not fire in
principle. Verified against the LIVE Supabase catalogue rather than the migration
ledger on 2026-08-06: `information_schema.columns WHERE column_name ILIKE
'%onboard%'` returned nothing, in `staging` and in `public`.

WHAT IS PINNED HERE, and why each one is a way the feature becomes a trap:

  1. `/auth/me` carries `org.onboarding_complete` at all. Without it the gate is
     dead code, which is what it was.
  2. A MISSING COLUMN READS AS COMPLETE. `migrations/116_onboarding_complete.sql`
     is a FILE — there is one `staging` schema and production writes to it too,
     so the owner applies it by hand and this code runs against a database
     without the column until they do. That state must redirect nobody.
  3. A FAILED LOOKUP IS "NO OPINION", never `false`. A DB hiccup that answered
     `false` would throw every user of the product into a wizard.
  4. The completion endpoint refuses an ordinary member. It has to: `Protected`
     only traps callers who hold org_owner or org_admin, and the two tests must
     agree or somebody is held on a screen whose every button 403s.
"""
import pytest

import auth_router
from helpers import make_token


@pytest.fixture(autouse=True)
def reset_onboarding_probe():
    """`_onboarding_column_present` is a module global cached across requests.

    It caches only the YES answer (the migration may be applied under a
    long-running process), which means one test that sees the column would make
    every later test in the session believe it exists. Reset around each one so a
    test's outcome depends on that test alone.
    """
    auth_router._onboarding_column_present = False
    yield
    auth_router._onboarding_column_present = False


ORG_ID = "11111111-1111-1111-1111-111111111111"


def _org_member_rows(org_id=ORG_ID, role="org_owner"):
    """What `/auth/me`'s `or_rows` query returns for a member of one org."""
    return [{"org_id": org_id, "role_code": role, "org_name": "Aekam Inc"}]


def _wire_me(mock_pool, user, org_rows, org_row, column_exists=True):
    """Route `/auth/me`'s three reads: platform roles, org roles, the org."""
    async def fetch(query, *args):
        if "org_id IS NULL" in query:
            return []
        if "staging.user_roles" in query:
            return org_rows
        return []

    async def fetchrow(query, *args):
        if "information_schema.columns" in query:
            return {"ok": 1} if column_exists else None
        if "staging.organisations" in query:
            return org_row
        return user

    mock_pool.fetch.side_effect = fetch
    mock_pool.fetchrow.side_effect = fetchrow


# ── 1 · the field the gate reads ─────────────────────────────────────────────

async def test_me_carries_the_org_and_its_onboarding_flag(api_client, mock_pool, admin_user):
    _wire_me(
        mock_pool, admin_user, _org_member_rows(),
        {"id": ORG_ID, "name": "Aekam Inc", "onboarding_complete": False},
    )
    resp = await api_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {make_token(admin_user['user_id'])}"}
    )
    assert resp.status_code == 200
    org = resp.json()["org"]
    assert org["id"] == ORG_ID
    assert org["name"] == "Aekam Inc"
    # `Protected.jsx` tests `=== false`, so the JSON has to be a real boolean.
    assert org["onboarding_complete"] is False


async def test_me_reports_a_finished_org_as_complete(api_client, mock_pool, admin_user):
    _wire_me(
        mock_pool, admin_user, _org_member_rows(),
        {"id": ORG_ID, "name": "Aekam Inc", "onboarding_complete": True},
    )
    resp = await api_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {make_token(admin_user['user_id'])}"}
    )
    assert resp.json()["org"]["onboarding_complete"] is True


# ── 2 · the state the product is in until migration 116 is applied ───────────

async def test_me_reports_complete_when_the_column_is_absent(api_client, mock_pool, admin_user):
    """THE LIVE CASE. 116 is written and unapplied; nobody may be trapped by that.

    The org row here deliberately does NOT carry the key at all — that is what
    the fallback SELECT returns — so a handler that read it off the row would
    KeyError rather than quietly answering False.
    """
    _wire_me(
        mock_pool, admin_user, _org_member_rows(),
        {"id": ORG_ID, "name": "Aekam Inc"},
        column_exists=False,
    )
    resp = await api_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {make_token(admin_user['user_id'])}"}
    )
    assert resp.status_code == 200
    assert resp.json()["org"]["onboarding_complete"] is True


# ── 3 · no opinion beats a wrong opinion ─────────────────────────────────────

async def test_a_failed_org_lookup_omits_the_key_rather_than_saying_false(
    api_client, mock_pool, admin_user
):
    """A database hiccup must not be able to redirect the whole product.

    ABSENT means "no opinion" — the same three-state contract `module_grants`
    and `module_levels` carry — and `Protected.jsx` tests `=== false`, so an
    absent key changes nothing.
    """
    async def fetch(query, *args):
        if "org_id IS NULL" in query:
            return []
        if "staging.user_roles" in query:
            return _org_member_rows()
        return []

    async def fetchrow(query, *args):
        if "information_schema.columns" in query:
            return {"ok": 1}
        if "staging.organisations" in query:
            raise RuntimeError("connection reset by peer")
        return admin_user

    mock_pool.fetch.side_effect = fetch
    mock_pool.fetchrow.side_effect = fetchrow

    resp = await api_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {make_token(admin_user['user_id'])}"}
    )
    assert resp.status_code == 200
    assert "org" not in resp.json()


async def test_a_user_with_no_org_gets_no_org_key(api_client, mock_pool, admin_user):
    """Platform-only accounts and freshly invited users are not gated."""
    _wire_me(mock_pool, admin_user, [], None)
    resp = await api_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {make_token(admin_user['user_id'])}"}
    )
    assert resp.status_code == 200
    assert "org" not in resp.json()


# ── 4 · X-Org-Id is honoured only for an org the caller belongs to ───────────

async def test_the_org_header_is_ignored_when_the_caller_is_not_a_member(
    api_client, mock_pool, admin_user
):
    """`lib/api.js` attaches X-Org-Id to EVERY request, including this one.

    The cross-org header bypass is a measured, live leak
    (`middleware/org_resolver.CROSS_ORG_HEADER_PREFIXES` documents three chains
    that worked). The membership check here needs no query — the rows are
    already in hand — so there is no excuse for trusting the header.
    """
    asked = []

    async def fetch(query, *args):
        if "org_id IS NULL" in query:
            return []
        if "staging.user_roles" in query:
            return _org_member_rows()
        return []

    async def fetchrow(query, *args):
        if "information_schema.columns" in query:
            return {"ok": 1}
        if "staging.organisations" in query:
            asked.append(args[0])
            return {"id": args[0], "name": "Aekam Inc", "onboarding_complete": True}
        return admin_user

    mock_pool.fetch.side_effect = fetch
    mock_pool.fetchrow.side_effect = fetchrow

    other = "22222222-2222-2222-2222-222222222222"
    resp = await api_client.get(
        "/api/auth/me",
        headers={
            "Authorization": f"Bearer {make_token(admin_user['user_id'])}",
            "X-Org-Id": other,
        },
    )
    assert resp.status_code == 200
    assert asked == [ORG_ID], "the header named an org the caller does not belong to"
    assert resp.json()["org"]["id"] == ORG_ID


async def test_the_org_header_is_honoured_for_an_org_the_caller_does_belong_to(
    api_client, mock_pool, admin_user
):
    """A member of two orgs switches, and the gate follows the switch.

    `or_rows` is ordered by `granted_at`, so `[0]` is the org
    `middleware/org_resolver.py` falls back to. When the tab has explicitly
    selected the second one, the gate must read the second one — otherwise the
    nav is gated against one org while every request it fires is scoped to
    another.
    """
    second = "22222222-2222-2222-2222-222222222222"
    asked = []

    async def fetch(query, *args):
        if "org_id IS NULL" in query:
            return []
        if "staging.user_roles" in query:
            return _org_member_rows() + [
                {"org_id": second, "role_code": "org_owner", "org_name": "Second Ltd"}
            ]
        return []

    async def fetchrow(query, *args):
        if "information_schema.columns" in query:
            return {"ok": 1}
        if "staging.organisations" in query:
            asked.append(args[0])
            return {"id": args[0], "name": "Second Ltd", "onboarding_complete": False}
        return admin_user

    mock_pool.fetch.side_effect = fetch
    mock_pool.fetchrow.side_effect = fetchrow

    resp = await api_client.get(
        "/api/auth/me",
        headers={
            "Authorization": f"Bearer {make_token(admin_user['user_id'])}",
            "X-Org-Id": second,
        },
    )
    assert asked == [second]
    assert resp.json()["org"]["id"] == second


# ── 5 · the write that lets somebody out ─────────────────────────────────────

async def test_completion_writes_the_flag(api_client, mock_pool, as_admin, with_org_id):
    statements = []

    async def fetchrow(query, *args):
        if "information_schema.columns" in query:
            return {"ok": 1}
        statements.append((query, args))
        return {
            "id": with_org_id, "name": "Aekam Inc", "onboarding_complete": True,
            "onboarding_skipped": False, "onboarding_completed_at": None,
        }

    mock_pool.fetchrow.side_effect = fetchrow

    resp = await api_client.post(
        "/api/v1/org/profile/onboarding-complete", json={"skipped": False}
    )
    assert resp.status_code == 200
    assert resp.json()["onboarding_complete"] is True
    assert resp.json()["recorded"] is True
    assert statements, "no UPDATE was issued"
    sql = statements[0][0]
    assert "onboarding_complete     = TRUE" in sql
    # First call wins. A replay must not rewrite which ending happened.
    assert "COALESCE(onboarding_completed_at" in sql
    assert "CASE WHEN onboarding_complete" in sql


async def test_a_skip_still_completes_or_the_button_is_a_loop(
    api_client, mock_pool, as_admin, with_org_id
):
    """"Skip setup entirely" must clear the gate, or it returns the user here.

    The skip is RECORDED separately — StepDone draws three distinct endings and
    its own docblock argues that claiming setup is complete when it was skipped
    is a lie — but the flag itself has to flip either way.
    """
    seen = {}

    async def fetchrow(query, *args):
        if "information_schema.columns" in query:
            return {"ok": 1}
        seen["skipped_arg"] = args[0]
        return {
            "id": with_org_id, "name": "Aekam Inc", "onboarding_complete": True,
            "onboarding_skipped": True, "onboarding_completed_at": None,
        }

    mock_pool.fetchrow.side_effect = fetchrow

    resp = await api_client.post(
        "/api/v1/org/profile/onboarding-complete", json={"skipped": True}
    )
    assert resp.status_code == 200
    assert seen["skipped_arg"] is True
    assert resp.json()["onboarding_complete"] is True
    assert resp.json()["onboarding_skipped"] is True


async def test_completion_answers_honestly_while_the_migration_is_unapplied(
    api_client, mock_pool, as_admin, with_org_id
):
    """No 503 here, and the reason is specific — nothing is being dropped.

    While the column is absent every org already reports as complete, and 116's
    backfill will write TRUE into this row when it is applied. A 503 would fire
    the wizard's failure toast on every completion for as long as the file sits
    unapplied, alarming the user about a condition with no effect on them.
    """
    async def fetchrow(query, *args):
        if "information_schema.columns" in query:
            return None
        raise AssertionError("no UPDATE may be attempted without the column")

    mock_pool.fetchrow.side_effect = fetchrow

    resp = await api_client.post(
        "/api/v1/org/profile/onboarding-complete", json={"skipped": False}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["onboarding_complete"] is True
    assert body["recorded"] is False
    assert "116_onboarding_complete.sql" in body["note"]


async def test_an_ordinary_member_cannot_complete_onboarding(
    api_client, mock_pool, as_member, with_org_id
):
    """The guard that makes the client-side rule safe.

    `Protected.jsx` only redirects a caller holding org_owner or org_admin,
    precisely because an org_member has no press anywhere in the wizard that can
    clear the flag. If this endpoint ever opened up to members, that client rule
    would be over-tight rather than dangerous — but if the client rule ever
    loosened while this stayed shut, an invited member would be held on a screen
    where every button 403s. This test is one half of that pair.
    """
    resp = await api_client.post(
        "/api/v1/org/profile/onboarding-complete", json={"skipped": False}
    )
    assert resp.status_code == 403
