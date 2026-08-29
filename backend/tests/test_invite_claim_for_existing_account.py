"""An invitation reaches somebody who already has an account.

── THE DEAD END ─────────────────────────────────────────────────────────────
`POST /auth/accept-invite` mints an account, so it answers 409 when one already
exists for the invited address. The invite screen answered that 409 with, in as
many words:

    "Sign in with it and this invitation is applied to the account you already
     have."

Nothing applied it. `POST /auth/login` does not read `invites` at all, so the
person signed in, held no `user_roles` row for the organisation that invited
them, and had no way to discover why — a dead end presented as a resolution.

It is reachable by anybody who acquires an account inside the seven-day window,
and by every colleague who is already in one organisation and is invited to a
second, which is the ordinary case for an accountant working across two firms.

`POST /auth/invite/{token}/claim` is the second door. The membership it produces
must be IDENTICAL to the one `accept-invite` produces — same role ceiling, same
grant re-validation against the org's live subscriptions, same employee link,
same audit row — because two copies of a grant rule is two places for it to
drift, and the direction it drifts in is somebody holding access their
organisation is not paying for. So the block was lifted out of the handler into
`_apply_org_invite` and both doors call it.

── THE HAZARD, AND WHAT ANSWERS IT ──────────────────────────────────────────
A token is a bearer credential. The only thing between a forwarded link and a
membership is who may spend it, and the answer has to be "the person it was
addressed to and nobody else". That is the assertion this file exists for.
"""
import inspect

import pytest

import auth_router


def _code(fn) -> str:
    return "\n".join(
        line for line in inspect.getsource(fn).splitlines()
        if not line.lstrip().startswith("#")
    )


# ── One implementation, two doors ───────────────────────────────────────────

def test_both_doors_call_the_same_membership_code():
    assert "_apply_org_invite" in _code(auth_router.accept_invite)
    assert "_apply_org_invite" in _code(auth_router.claim_invite)


def test_the_membership_rules_exist_in_exactly_one_place():
    """If these reappear in a handler, a second copy has been started."""
    shared = _code(auth_router._apply_org_invite)
    assert "INSERT INTO public.user_roles" in shared
    assert "org_member_modules" in shared
    assert "manav_employees" in shared

    for handler in (auth_router.accept_invite, auth_router.claim_invite):
        code = _code(handler)
        assert "INSERT INTO public.user_roles" not in code, \
            f"{handler.__name__} writes its own role row again"
        assert "org_member_modules" not in code, \
            f"{handler.__name__} writes its own grants again"


# ── Who may spend a token ───────────────────────────────────────────────────

def test_the_claim_requires_a_signed_in_caller():
    sig = inspect.signature(auth_router.claim_invite)
    assert "user" in sig.parameters
    assert "require_user" in inspect.getsource(auth_router.claim_invite)


def test_the_claim_refuses_a_caller_whose_address_is_not_the_invited_one():
    """Without this, anybody holding a forwarded link attaches THEMSELVES to the
    organisation it was meant for — a worse hole than the dead end it fixes."""
    code = _code(auth_router.claim_invite)
    assert 'user.get("email")' in code
    assert '.lower()' in code
    assert "403" in code
    # And the refusal is audited, because an attempt to spend somebody else's
    # invitation is worth seeing.
    assert "invite_claim_refused" in code


def test_the_claim_refuses_a_token_that_is_not_live():
    """Accepted, expired, or unknown — one answer for all three, so this cannot
    be used to tell a real token from a fake one."""
    code = _code(auth_router.claim_invite)
    assert 'accepted_at"] is not None' in code
    assert "expires_at" in code
    assert code.count("_INVITE_DEAD") >= 2


def test_the_claim_rechecks_the_seat_before_writing_anything():
    """A reservation taken at issue time is not a hold unless somebody reads it
    back. Six people once landed in a five-seat org because nothing did."""
    code = _code(auth_router.claim_invite)
    assert "assert_seat_available" in code
    # `rindex` on both: the docstring names `_apply_org_invite` while explaining
    # idempotency, so its FIRST occurrence is prose rather than the call. The
    # last occurrence of each is the code.
    assert code.rindex("assert_seat_available") < code.rindex("_apply_org_invite"), \
        "the seat is checked after the membership is written"


def test_the_claim_marks_the_invitation_spent():
    """Otherwise the same link keeps working for seven days after it was used."""
    code = _code(auth_router.claim_invite)
    assert "SET accepted_at=NOW()" in code


def test_a_platform_invite_is_refused_with_a_reason():
    """A console invite carries no organisation, so there is no membership to
    apply. Saying so beats writing nothing and returning ok."""
    code = _code(auth_router.claim_invite)
    assert "does not join an organisation" in code


def test_the_claim_is_rate_limited():
    """Anything auth-shaped is. This one takes a bearer token in the URL."""
    assert 'limiter.limit("10/minute")' in inspect.getsource(auth_router.claim_invite) \
        or "10/minute" in inspect.getsource(auth_router)


def test_the_claim_never_touches_the_password_or_mints_a_session():
    """The caller already has both. This endpoint's whole subject is membership."""
    code = _code(auth_router.claim_invite)
    assert "_hash_password" not in code
    assert "_create_token" not in code
    assert "INSERT INTO users" not in code


# ── The table is schema-qualified ───────────────────────────────────────────

@pytest.mark.parametrize("fn", [
    auth_router.claim_invite,
    auth_router.accept_invite,
    auth_router.decline_invite,
])
def test_every_invite_statement_names_its_schema(fn):
    """`public.invites` predates `backend/migrations/` and every statement
    naming it used to rely on `search_path` while every sibling table in the
    same handler was `staging.`-qualified. Migration 142 is what this project
    learned that from: a shadow table with the same name in another schema, and
    statements that silently started reading the wrong one.
    """
    code = _code(fn)
    for keyword in ("FROM", "INTO", "UPDATE"):
        assert f"{keyword} invites" not in code, \
            f"an unqualified `{keyword} invites` is back in {fn.__name__}"
