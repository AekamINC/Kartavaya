"""Aekam must not be able to see client personal data.

The owner's instruction, 2026-08-07, in full: "Aekam must not be able to see
client personal data, and orgs must not see each other's."

── WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────────────

`GET /api/users` returned, for a caller holding ANY of the eight platform roles,
every registered user on the platform with their email address — across every
tenant, in one unpaginated response, and with no audit row. A support account
could read the entire customer base's address book and nothing recorded that it
had happened. `GET /api/v1/admin/orgs` did the same thing one row per customer:
`u.email as owner_email`, drawn on Aekam's org table and billing page.

Neither was a bug in the sense of a mistake in logic. Both were deliberate and
both were wrong, so what pins them is a test rather than a comment.

── WHY THESE ASSERTIONS ARE ON THE SQL ──────────────────────────────────────

The pool is a MagicMock and answers any query, so driving the endpoint proves
the shape of a fixture and not the shape of a SELECT. The leak here IS the
SELECT — a column that should not be in it — so the source of the query is what
is asserted. The same technique `test_audit_reader.py` uses, for the same
reason.

── WHAT IS DELIBERATELY STILL ALLOWED ───────────────────────────────────────

An org's own owner or admin listing their OWN org's members still gets email.
That is the member picker: they invite by address, they already hold every one
of them, and no tenant boundary is crossed. The rule is about Aekam reading
customers and about one customer reading another — not about an organisation
reading itself.
"""
import ast
import inspect
import textwrap

import server
from routers import admin_orgs


def _code(fn) -> str:
    """The raw source, whitespace-collapsed. For assertions about STRUCTURE —
    which branch, which severity, which field."""
    return " ".join(inspect.getsource(fn).split())


def _literals(node) -> str:
    """Every string literal under an AST node, joined — which is its SQL.

    Not the raw source. Every one of these endpoints carries a long comment
    explaining what it must NOT return, and those comments contain the words
    "email" and "owner_email" for the obvious reason. A naive substring test
    passes forever on a leak that was reintroduced, and fails on a file that
    merely documents the rule. A `#` comment is not a literal.
    """
    parts = [n.value for n in ast.walk(node)
             if isinstance(n, ast.Constant) and isinstance(n.value, str)]
    return " ".join(" ".join(parts).split())


def _branches(fn, marker: str) -> tuple[str, str]:
    """(SQL inside the `if <marker>` branch, SQL outside it).

    `list_users` is one function with two tenancy branches and only one of them
    crosses an org boundary. Asserting on the whole function cannot tell them
    apart — and the branch that MAY return an email is the one that must, so a
    test that could not separate them would have to be weakened to pass.
    """
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    body = tree.body[0]
    doc = ast.get_docstring(body)
    inside, outside = [], []
    for node in ast.walk(body):
        if isinstance(node, ast.If) and marker in ast.dump(node.test):
            inside.append(_literals(node))
    hit = {id(n) for node in ast.walk(body)
           if isinstance(node, ast.If) and marker in ast.dump(node.test)
           for n in ast.walk(node)}
    for node in ast.walk(body):
        if id(node) in hit:
            continue
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if doc is not None and node.value == doc:
                continue
            outside.append(node.value)
    return " ".join(" ".join(inside).split()), " ".join(" ".join(outside).split())


# ── 1 · the platform-wide user directory ────────────────────────────────────

def test_the_platform_directory_does_not_select_an_email():
    platform, _ = _branches(server.list_users, "is_platform_staff")
    assert platform, "the platform branch was not found"
    assert "email" not in platform, (
        "the platform branch of GET /api/users returned every tenant's email"
    )


def test_the_display_name_does_not_fall_back_to_an_email():
    """`COALESCE(full_name, name, email)` is the same leak wearing a different
    column name — every user with an incomplete profile is listed by address."""
    platform, _ = _branches(server.list_users, "is_platform_staff")
    assert "'Name not on file'" in platform
    assert "COALESCE(full_name,name,email)" not in platform.replace(" ", "")


def test_support_can_still_tell_two_people_apart():
    """Dropping the email must not make the directory useless. The org each
    name belongs to is what replaces it — resolved through `user_roles`, the
    sole tenant path — so two people called Sharma are distinguishable."""
    platform, _ = _branches(server.list_users, "is_platform_staff")
    assert "staging.user_roles" in platform and "staging.organisations" in platform
    assert "AS orgs" in platform


def test_reading_the_whole_customer_base_leaves_a_row():
    """Reading a customer's data is the event this product's audit log exists
    to record, and this read had none. `warn`, not `info`: it is a platform
    account crossing into every tenant at once."""
    src = _code(server.list_users)
    assert "platform.user_directory_read" in src
    assert 'severity="warn"' in src


def test_an_org_admin_still_gets_their_own_members_in_full():
    """The rule is about crossing a tenant boundary. Inside one, the member
    picker needs the address it invites by."""
    _, own_org = _branches(server.list_users, "is_platform_staff")
    assert "u.email" in own_org


# ── 2 · the org list Aekam reads ────────────────────────────────────────────

def test_the_customer_org_list_does_not_carry_an_owners_email():
    src = ""
    for name in dir(admin_orgs):
        fn = getattr(admin_orgs, name)
        if not callable(fn) or getattr(fn, "__module__", "") != admin_orgs.__name__:
            continue
        try:
            candidate = _literals(ast.parse(textwrap.dedent(inspect.getsource(fn))))
        except (TypeError, OSError, SyntaxError):
            continue
        if "FROM staging.organisations o " in candidate and "plan_code" in candidate:
            src = candidate
            break
    assert src, "could not find the org list endpoint"
    assert "owner_email" not in src, (
        "Aekam's org table returned every customer owner's address"
    )
    assert "owner_name" in src, "support still has to be able to name the owner"


def test_creating_an_org_still_takes_an_owner_email():
    """Not a contradiction. That address is one Aekam was GIVEN in order to
    create the account — it is an input, not a directory read."""
    assert "owner_email" in _code(admin_orgs.OrgCreate)


# ── 3 · the billing surfaces ────────────────────────────────────────────────
#
# The owner's rule for these specifically: "Billing surfaces get seat counts
# only." Checked 2026-08-07 rather than assumed, and the finding was that they
# already comply — `routers/subscription.py` contains the word "email" nowhere
# at all, `staging.subscription_invoices` has no contact column (verified
# read-only against the live catalogue), and Aekam's console renders `Seats
# used` and `Attendance seats` from `org/seatFigures.js`.
#
# So there is nothing to fix and everything to hold. The one leak on that page
# was `owner_email` arriving from `/v1/admin/orgs`, which the section above
# pins. These are the ratchet for the rest.

def test_no_billing_endpoint_returns_a_contact_detail():
    """A count says how many people; a roster says who they are and how to
    reach them. Aekam needs the first to bill and has no business with the
    second — which is the whole shape of the rule."""
    import inspect
    from routers import subscription

    src = inspect.getsource(subscription)
    # Not a substring test on the module: `email` appears in prose. Only the
    # SQL is examined, the same way the section above does it.
    tree = ast.parse(textwrap.dedent(src))
    sql = " ".join(
        n.value for n in ast.walk(tree)
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
        and ("SELECT" in n.value.upper() or "INSERT" in n.value.upper())
    ).lower()
    for leak in ("u.email", "users.email", "owner_email", "as email",
                 " email,", " email ", "full_name", "phone"):
        assert leak not in sql, f"a billing query selects {leak.strip()!r}"


def test_the_overdue_list_names_the_ORG_and_not_a_person():
    """`i.*, o.name as org_name`. Chasing an unpaid invoice is a conversation
    with an organisation; the person to have it with comes from the approved
    support-session flow, which leaves a row."""
    import inspect
    from routers import subscription

    src = " ".join(inspect.getsource(subscription.list_overdue).split())
    assert "o.name as org_name" in src
    assert "email" not in src


def test_the_two_seat_figures_are_never_summed():
    """The owner's decision of 2026-08-04, and the one arithmetic error on this
    surface that would misstate a bill: a firm with 8 office staff and 200 site
    workers pays 8 org seats and 200 attendance seats, not 208 of either."""
    from pathlib import Path

    figures = Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "org" / "seatFigures.js"
    assert figures.exists(), figures
    body = figures.read_text(encoding="utf-8")
    assert "pahchanSeats" in body and "orgSeats" in body
    # No function in that file adds one population to the other.
    assert "orgSeats(" not in body.split("export function pahchanSeats")[-1]
