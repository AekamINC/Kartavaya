"""A firm that has never used this product can now be onboarded.

── WHAT WAS WRONG ───────────────────────────────────────────────────────────
`POST /api/v1/admin/orgs` refused a genuinely new customer twice over, and the
advice in both refusals described a product that does not exist:

  404  "No user found with email '…'. They must register first before an org
       can be created for them."
       THERE IS NO PUBLIC REGISTRATION. The only account-minting path in this
       backend is `POST /auth/accept-invite`. The identical sentence had
       already been removed from `org_members.add_member` for exactly this
       reason — "the user must sign up first" was advice nobody could take —
       and the platform console kept its copy.

  400  "User has no active team. They must create a team first."
       `POST /teams` needs `require_user`, so this told Aekam to wait while the
       customer signed in and made a project. A fourth step in a journey
       nothing on any screen described.

Together: the console could only create an organisation for somebody who was
already a working user of the product, which is not what a new customer is.

A third defect sat underneath both. `create_org` seated the founder as
`org_admin`, hardcoded — and `org_owner` had NO OTHER WRITER anywhere:
`CONSOLE_ASSIGNABLE_ORG_ROLES` excludes it, `org_members.add_member` refuses
it, and `org_invites._assert_may_grant_role` lets only an existing owner mint
another, a bootstrap that could never start. So no organisation could ever have
an owner, and everything gated on `ORG_OWNER_ONLY` was permanently unreachable
for every customer — including `PATCH /v1/org/modules`, which means an
organisation could not switch its own modules on or off. Measured live on
2026-08-22: Unicode Group holds five `org_admin` rows and zero owners.

── WHAT IS PINNED HERE ──────────────────────────────────────────────────────
These are source assertions rather than request tests, and deliberately. The
behaviour past the refusals needs a real database — an org row, a founding
team, an invitation, a seat check across three tables — and this suite drives a
MagicMock pool that binds anything to anything. What a mock CAN prove is that
the refusals are gone, that the writes that replaced them are the right ones,
and that the bootstrap cannot be turned into a takeover. `tests/test_auth.py`
covers the acceptance half's one real hazard (the varchar/text cast).
"""
import inspect
import re

import pytest

from routers import admin_orgs


def _code(fn) -> str:
    """Source with comment lines stripped.

    The blocks that removed these refusals explain them at length, so a
    substring search over the raw source would match the explanation and pass
    or fail for the wrong reason.
    """
    return "\n".join(
        line for line in inspect.getsource(fn).splitlines()
        if not line.lstrip().startswith("#")
    )


# ── The two refusals ────────────────────────────────────────────────────────

@pytest.mark.parametrize("sentence", [
    "must register first",
    "must create a team first",
    "No user found with email",
])
def test_the_refusals_that_blocked_a_new_firm_are_gone(sentence):
    assert sentence not in _code(admin_orgs.create_org)


def test_an_owner_without_an_account_is_invited_rather_than_refused():
    """The org is created, and the person it belongs to is invited to own it."""
    code = _code(admin_orgs.create_org)
    assert "issue_invite" in code
    assert '"org_owner"' in code, "the invitation does not name the owner role"
    # And the response says which of the two happened, because "created" and
    # "created, and somebody still has to accept" are different states.
    assert '"owner_invite"' in code
    assert '"owner_invite_error"' in code


def test_the_invitation_cannot_fail_the_creation():
    """The org is already committed by then. A mail failure must not report a
    created org as uncreated — that misreading is what sent operators into the
    409 on retry."""
    code = _code(admin_orgs.create_org)
    block = code[code.index("owner_invite = None"):code.index("bucket_name = None")]
    assert "except Exception as exc" in block
    handler = block.split("except Exception as exc")[1]
    # A `raise` STATEMENT, not the word — `# noqa: BLE001 — reported, not
    # raised` sits on one of these lines and is not code.
    assert not [ln for ln in handler.splitlines() if ln.strip().startswith("raise")],         "the owner invitation can now fail a creation that already committed"
    assert "owner_invite_error" in handler,         "a failed invitation is swallowed without telling anyone"


# ── The founding project ────────────────────────────────────────────────────

def test_a_founding_project_is_created_when_the_owner_has_none():
    code = _code(admin_orgs.create_org)
    assert "INSERT INTO teams" in code
    assert "founding_team" in code


def test_the_founding_project_carries_the_org_id():
    """`teams.org_id` is load-bearing, not metadata.

    `get_visible_team_ids` resolves an org_owner/org_admin's projects as "every
    team in my org" — `SELECT team_id FROM teams WHERE org_id=$1`. A founding
    team left at NULL is invisible to the person who owns it, which is the same
    defect `POST /teams` was fixed for, arriving by a different door.
    """
    code = _code(admin_orgs.create_org)
    insert = re.search(r"INSERT INTO teams \(([^)]*)\)", code)
    assert insert, "the founding-project insert is no longer recognisable"
    assert "org_id" in insert.group(1)
    # And an ADOPTED team gets the org stamped on it too — fill-only, so an
    # existing org is never taken off a team by this handler.
    assert "UPDATE teams SET org_id" in code
    assert "org_id IS NULL" in code


def test_the_owner_is_seated_on_the_founding_project():
    code = _code(admin_orgs.create_org)
    assert "INSERT INTO team_members" in code
    assert "INSERT INTO project_assignments" in code


# ── The owner role ──────────────────────────────────────────────────────────

def test_the_founder_is_seated_as_org_owner():
    """It was `'org_admin'`, hardcoded, and that string was the whole reason no
    organisation could ever administer itself."""
    code = _code(admin_orgs.create_org)
    role_insert = re.search(
        r"INSERT INTO public\.user_roles.{0,200}", code, re.S,
    )
    assert role_insert, "the owner-role insert is no longer recognisable"
    assert "'org_owner'" in role_insert.group(0)
    assert "'org_admin'" not in role_insert.group(0)


def test_no_role_row_is_written_for_an_owner_who_has_not_accepted():
    """There is no account to write one for. The invitation carries the role and
    `accept_invite` writes it."""
    code = _code(admin_orgs.create_org)
    assert "if owner:" in code


# ── The bootstrap for organisations that already exist ──────────────────────

def test_the_bootstrap_is_god_mode_only():
    assert "SUPERUSER_ONLY_ROLES" in _code(admin_orgs.nominate_org_owner)


def test_the_bootstrap_refuses_an_org_that_already_has_an_owner():
    """This is what keeps it a bootstrap rather than a takeover: Aekam must not
    be able to change who runs a customer's organisation."""
    code = _code(admin_orgs.nominate_org_owner)
    assert "already has an owner" in code
    assert "409" in code


def test_the_bootstrap_only_raises_an_existing_administrator():
    """The console cannot introduce a new person as owner. It can only raise
    somebody the customer already trusts with administration."""
    code = _code(admin_orgs.nominate_org_owner)
    assert "role_code='org_admin'" in code


def test_the_bootstrap_never_rewrites_a_grant():
    code = _code(admin_orgs.nominate_org_owner)
    assert "UPDATE public.user_roles" not in code
    assert "DELETE FROM public.user_roles" not in code
    # The org row's owner column is FILLED, never overwritten.
    assert "owner_user_id IS NULL" in code


def test_the_bootstrap_is_audited_at_warn():
    """Every cross-tenant console write is. This one appoints the authority that
    appoints payroll approvers."""
    code = _code(admin_orgs.nominate_org_owner)
    assert "_audit_emit" in code
    assert 'severity="warn"' in code
