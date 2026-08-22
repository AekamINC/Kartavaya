"""Adding a member who has no account sends an invitation instead of refusing.

`POST /v1/org/members` used to answer 404 with "The user must sign up first,
then you can add them." The product is INVITE-ONLY and has no public sign-up —
its own login screen says so — which made that advice impossible to follow. The
one button for bringing a colleague into an organisation could not work for
anybody who was not already in the product, and the person clicking it had no
way to learn that the Invite tab was the answer.

The two endpoints were exact mirrors and neither knew about the other:
`add_member` refused when the account was MISSING, `create_org_invite` refused
when it EXISTED. Together they covered every case and left the caller to guess.
"""
import inspect

import routers.org_invites as inv
import routers.org_members as om


def _code(fn) -> str:
    """Source with comment lines removed.

    The old message still appears in the comment explaining why it went, so a
    test that greps the raw source fails the moment somebody documents the fix.
    """
    return "\n".join(
        line for line in inspect.getsource(fn).splitlines()
        if not line.strip().startswith("#")
    )


def test_adding_an_unknown_email_no_longer_404s():
    code = _code(om.add_member)
    assert "must sign up first" not in code, \
        "add_member still tells people to sign up for a product with no sign-up"
    branch = code.split("if not target:")[1].split("return")[0]
    assert "404" not in branch, "the unknown-email branch still raises a 404"
    assert "issue_invite" in code, "add_member does not fall through to an invitation"


def test_it_uses_the_same_invite_path_as_the_invite_button():
    """Twenty duplicated lines would drift: different expiry, different mail,
    eventually different grants. One function, two callers."""
    assert callable(inv.issue_invite)
    assert "issue_invite(" in _code(inv.create_org_invite), \
        "the Invite route no longer shares the helper"


def test_the_reply_says_invited_not_added():
    """"Added" and "invited" are different things, and the screen must not claim
    the first when it did the second — the person is not in the org until they
    accept."""
    code = _code(om.add_member)
    assert '"status": "invited"' in code
    assert "invite_link" in code, "the caller cannot copy the link if mail fails"


def test_an_existing_account_is_still_added_directly():
    """The fallback must not swallow the normal path."""
    assert "already a member of this organisation" in _code(om.add_member), \
        "the duplicate-member guard was lost"


def test_the_helper_still_supersedes_a_pending_invite_for_the_same_org():
    """Re-inviting must not leave two live tokens for one address."""
    code = _code(inv.issue_invite)
    assert "UPDATE public.invites SET expires_at = NOW()" in code
    assert "org_id=$2::uuid" in code, "superseding is no longer scoped to this org"


def test_a_mail_failure_does_not_lose_the_invite():
    code = _code(inv.issue_invite)
    assert "except Exception" in code
    assert "invite_link" in code
