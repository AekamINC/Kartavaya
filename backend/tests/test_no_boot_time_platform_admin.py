"""`users.role = 'admin'` MUST NOT confer `platform_admin`.

── The defect this pins, found 2026-08-30 ──────────────────────────────────────

`server.py`'s startup migration block ran, on every boot:

    INSERT INTO public.user_roles (user_id, org_id, role_code)
    SELECT user_id, NULL, 'platform_admin'
    FROM users WHERE role = 'admin' AND NOT COALESCE(is_system, FALSE)
    ON CONFLICT DO NOTHING

`users.role` is a PER-ORG fact stored in ONE GLOBAL COLUMN. CLAUDE.md states it,
and states that the rows which look corrupt (org admins carrying role='client')
are real and must never be cleaned. This statement read that per-org value as a
platform-wide one and granted `platform_admin` — god mode, org-less, reaching
every organisation. The only action required was a deploy.

Measured live before removal, six accounts matched and TWO did not yet hold it:

    kevalvshah03+e2e-owner@gmail.com     user_f1a0a472b98f
    kevalvshah03+e2e-approver@gmail.com  user_549c9cac35aa

`+e2e-owner` is the sole `org_owner` of E2E Test & Associates and the account 23
specs use to prove OWNER is not GODMODE. One restart would have made it a
platform admin and turned every one of those assertions vacuous — the same
defect `93-V5-START-HERE.md` already records ("55 owner specs had been running
as admin and proving nothing about privilege separation"), arriving by a
different door.

Two aggravating properties, both worth keeping in the record:

  · it wrote NO `granted_by`, which is why 7 of 11 live platform grants have a
    NULL grantor — nobody granted them, a boot did;
  · it sat inside `except Exception: logger.warning("... non-fatal")`, so a
    failure was invisible too.

── What this file asserts ──────────────────────────────────────────────────────

Static, deliberately. The statement lived in a startup path that needs a live
database, an event loop and a full app boot to execute; a test that tried to
exercise it would be testing its own mock. What actually has to stay true is
that the STATEMENT IS NOT IN THE SOURCE, and that is checkable exactly.

This is the same reasoning `check-e2e-no-bypass` uses on the frontend: when the
thing to prevent is a line of code rather than a behaviour, read the file.
"""
import re
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[1] / "server.py"
SOURCE = SERVER.read_text(encoding="utf-8")

#: Comments are stripped before matching. This defect is DESCRIBED at length in
#: the comment that replaced it, and a naive substring search would match the
#: description and fail forever — a test that cannot pass is as useless as one
#: that cannot fail.
CODE_ONLY = "\n".join(
    line for line in SOURCE.splitlines() if not line.lstrip().startswith("#")
)


def test_no_boot_time_grant_of_platform_admin():
    """No executable statement may INSERT platform_admin from users.role."""
    # The shape, not the exact text: any SELECT that turns role='admin' into a
    # platform_admin row is the same defect however it is spelled.
    offenders = re.findall(
        r"INSERT\s+INTO\s+[\w.]*user_roles[\s\S]{0,400}?platform_admin",
        CODE_ONLY,
        re.IGNORECASE,
    )
    assert not offenders, (
        "server.py contains a statement that writes platform_admin into "
        "user_roles at boot. `users.role` is a PER-ORG column and must never "
        "confer a platform grant. Platform roles are granted at "
        "POST /api/v1/admin/orgs/roles/assign, by a different platform admin, "
        f"with granted_by recorded.\nFound: {offenders!r}"
    )


def test_no_statement_derives_a_platform_role_from_users_role():
    """Belt and braces: catch the same idea written without the literal INSERT.

    Mutation-checked: rewriting the removed statement as a CTE, or selecting
    into a temp table and inserting from it, still trips this because both must
    name `role = 'admin'` and `platform_` in the same statement.
    """
    for stmt in re.split(r";\s*\n", CODE_ONLY):
        if re.search(r"role\s*=\s*'admin'", stmt, re.IGNORECASE) and \
           re.search(r"platform_(admin|owner|manager|staff|support)", stmt):
            pytest.fail(
                "A statement reads users.role='admin' and names a platform "
                f"role in the same breath:\n{stmt.strip()[:600]}"
            )


def test_the_removal_is_explained_where_it_happened():
    """The comment must survive with it.

    Deleting the statement and its explanation leaves the next person free to
    re-add it as an obvious convenience. Proposal 93's whole method is that a
    removal carries its reason.
    """
    assert "REMOVED 2026-08-30" in SOURCE and "per-org" in SOURCE.lower(), (
        "The explanation for removing the boot-time platform_admin backfill is "
        "gone from server.py. Restore it: without the reason, the statement "
        "comes back as a one-line convenience."
    )
