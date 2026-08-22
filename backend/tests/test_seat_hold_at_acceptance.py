"""A pending invite HOLDS a seat — including at the moment it is redeemed.

Settled by the owner 2026-08-04: a pending invite holds a seat. `org_invites`
implemented that at ISSUE time and has since 2026-07. What nobody implemented is
the other half: **`POST /auth/accept-invite` checked nothing at all.** It read
the token, created the account, and wrote the `staging.user_roles` row. No seat
count, no ceiling, no refusal — the endpoint did not consult `max_users` in any
form.

A reservation that is never re-read is not a hold. The sequence, every step of
which was permitted by the code that ran it:

    org has max_users = 5
    4 people joined, 1 invitation outstanding      → 5 seats spoken for
    Aekam's console adds a fifth member            → its counter never saw the
                                                     pending invite, so 5 joined
    the invitee clicks their link                  → 6 MEMBERS IN A 5-SEAT ORG

No god mode anywhere in that, and nothing to undo it: the seat limit is a
commercial term Aekam types in by hand, and the customer had simply exceeded it.

Two properties are pinned here.

  1. Acceptance re-checks, and answers **409** with the same sentence the issuing
     paths use. Not 403: the caller is permitted to do this, the organisation is
     full, which is a conflict with current state.

  2. The refusal lands BEFORE the account is created. Refusing afterwards would
     leave an orphan login belonging to no organisation and a spent invitation —
     a worse state than the refusal, and one the invitee cannot get out of. The
     invitation stays live and works the moment a seat is freed.

The invitee's OWN pending row is excluded from the count, because it is the seat
they are taking rather than a competing claim on it. Property 3 pins that: an
org at 4 joined + 1 pending (theirs) with a cap of 5 must let them in, or the
last invitation an org sends could never be redeemed.

Nothing here touches a database; the pool is conftest's MagicMock.
"""

from datetime import datetime, timedelta, timezone

import pytest

ORG = "00000000-0000-0000-0000-0000000000bb"
TOKEN = "invite-token-seatcheck"
EMAIL = "joiner@test.com"


def _invite(**over):
    """An org-scoped invite row, as `routers/org_invites.issue_invite` writes one."""
    row = {
        "token": TOKEN,
        "email": EMAIL,
        "role": "member",
        "full_name": "New Joiner",
        "member_role": "org_member",
        "receives_approval_emails": True,
        "accepted_at": None,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "invited_by": "user_admin001",
        "org_id": ORG,
        "module_grants": "[]",
    }
    row.update(over)
    return row


@pytest.fixture
def wired(mock_pool):
    """Answer every query accept_invite issues, and record what it executed."""
    state = {
        "invite": _invite(),
        "limit": None,
        "joined": 0,
        "pending": 0,
        "executed": [],
    }

    async def fetchrow(query, *args):
        if "invites WHERE token" in query:
            return state["invite"]
        if "users WHERE email" in query:
            return None                       # the address has no account yet
        if "users WHERE user_id" in query:
            return {
                "user_id": "user_newjoiner",
                "email": EMAIL,
                "name": "New Joiner",
                "full_name": "New Joiner",
                "role": "member",
                "avatar": None,
            }
        return None

    async def fetchval(query, *args):
        if "COALESCE(o.max_users, p.max_users)" in query:
            return state["limit"]
        if "COUNT(DISTINCT user_id)" in query:
            return state["joined"]
        if "COUNT(*) FROM public.invites" in query:
            return state["pending"]
        return None

    async def execute(query, *args):
        state["executed"].append(query)
        return "INSERT 0 1"

    mock_pool.fetchrow.side_effect = fetchrow
    mock_pool.fetchval.side_effect = fetchval
    mock_pool.fetch.side_effect = None
    mock_pool.fetch.return_value = []
    mock_pool.execute.side_effect = execute
    return state


async def _accept(api_client):
    return await api_client.post("/api/auth/accept-invite", json={
        "token": TOKEN, "name": "New Joiner", "password": "NewPass123!",
    })


# ── Property 1: acceptance is refused once the org is full ───────────────────

async def test_acceptance_is_refused_when_the_org_is_at_its_allowance(api_client, wired):
    wired["limit"] = 5
    wired["joined"] = 5

    resp = await _accept(api_client)

    assert resp.status_code == 409, (
        "accept-invite let somebody into a full organisation — the seat "
        "reserved at issue time was never re-read, so it was not a hold"
    )
    assert "seats" in resp.json()["detail"]


async def test_the_refusal_is_the_same_sentence_the_issuer_uses(api_client, wired):
    """One condition, one wording. Three sites used to phrase it three ways —
    "Raise max_users on the org", "ask your account manager to add seats", "ask
    Aekam to raise the allowance" — for the identical state."""
    from routers.org_invites import SeatCount, seat_limit_detail

    wired["limit"] = 5
    wired["joined"] = 4
    wired["pending"] = 1

    resp = await _accept(api_client)
    assert resp.status_code == 409
    assert resp.json()["detail"] == seat_limit_detail(
        SeatCount(limit=5, joined=4, pending=1)
    )


# ── Property 2: nothing is written before the refusal ────────────────────────

async def test_no_account_is_created_when_the_seat_check_refuses(api_client, wired):
    """An orphan login belonging to no organisation, with its invitation spent,
    is a worse outcome than the refusal — and the invitee cannot undo it."""
    wired["limit"] = 5
    wired["joined"] = 5

    resp = await _accept(api_client)
    assert resp.status_code == 409

    written = " | ".join(wired["executed"])
    assert "INSERT INTO users" not in written.replace("\n", " "), \
        "the account was created and only then was the seat refused"
    assert "UPDATE public.invites SET accepted_at" not in written, \
        "the invitation was consumed by an acceptance that did not happen"
    assert "staging.user_roles" not in written, \
        "the membership row was written past the seat limit"


# ── Property 3: the invitee's own reservation is not counted against them ────

async def test_the_invitees_own_pending_invite_does_not_block_them(api_client, wired):
    """4 joined + 1 pending against a cap of 5 is exactly full — and the one
    pending invite is THIS person's. Counting it would make the last invitation
    an organisation can send permanently unredeemable."""
    wired["limit"] = 5
    wired["joined"] = 4
    wired["pending"] = 0      # count_seats excludes this address's own row

    resp = await _accept(api_client)
    assert resp.status_code == 200, resp.text


async def test_a_null_allowance_still_means_unlimited(api_client, wired):
    """COALESCE(org, plan) is NULL for the tiers not sold per user. It must not
    collapse to zero and refuse every acceptance in every such org."""
    wired["limit"] = None
    wired["joined"] = 900

    resp = await _accept(api_client)
    assert resp.status_code == 200, resp.text


# ── A platform-console invite is unaffected ──────────────────────────────────

async def test_a_platform_invite_with_no_org_takes_no_seat(api_client, wired):
    """`invites.org_id` is NULL for the Aekam console's own invitations. There is
    no organisation to count against, and the check must not invent one."""
    wired["invite"] = _invite(org_id=None)
    wired["limit"] = 1
    wired["joined"] = 99

    resp = await _accept(api_client)
    assert resp.status_code == 200, resp.text
