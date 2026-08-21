"""
Who may connect a social account, and who may send a post.

THE QUESTION THIS ANSWERS, in the owner's words: "who can be do this apart from
org admin". Until today the answer was *nobody* — `_require_publish_authority`
fell back to the org role, so connecting an account and publishing a post were
org-owner-and-admin work and a marketing person could do neither.

The reason given in the code was that `org_member_modules` had no `role`
column. MEASURED LIVE ON 2026-08-21, that is false: the column exists and is
populated — 52 grants, admin 21, viewer 23, approver 5, editor 3. A stale
comment had narrowed the product for months.

── THE MATRIX ────────────────────────────────────────────────────────────────

Held on EITHER `sahayak` or `prachar` — publishing is not AI, and a firm that
bought Marketing and not the assistant may still post to its own accounts.

    level      see the accounts   schedule / publish   connect / disconnect
    ───────────────────────────────────────────────────────────────────────
    (none)            no                 no                    no
    viewer            yes                no                    no
    editor            yes                YES                   no
    approver          yes                YES                   no
    admin             yes                YES                   YES

The split is by what a person can undo, not by how dangerous the verb sounds:

  · EDITOR SENDS. A scheduled post and a published one both put words in front
    of the client's audience under the client's name, and neither can be
    recalled — but neither changes any configuration. `subscription.py` already
    defines editor on prachar/varta/sanvaad as exactly "does not change a
    record, it SENDS". A marketing editor doing marketing.

  · ADMIN CONNECTS. Connecting writes a live credential that can post until it
    expires; disconnecting silently stops a firm's publishing; setting a
    client's platforms decides what is possible at all. These outlive any
    single post, which is why they sit a rung higher.

`approver` sits beside editor rather than above it. It is the separated-duty
level — the person who signs off what somebody else did — and signing off is
not connecting. Giving it the credential rung would make "approve" mean "may
also create the thing being approved".

── AEKAM ─────────────────────────────────────────────────────────────────────

`held_level` grants `admin` to platform staff on any module they can reach.
That rule is right for reading a customer's screen and was wrong for this: ten
Aekam accounts could connect a customer's Instagram, disconnect it, or publish
to that customer's followers under that customer's name, with nothing granted
and nothing recorded.

The owner was asked and answered: it requires a support session. So this router
narrows the rule for its own two rungs — platform staff who hold no org role in
the org being acted in must be inside an approved, unexpired session that names
them and covers the module. `held_level` itself is untouched.
"""
from __future__ import annotations

import inspect

import pytest

from middleware.module_levels import LEVELS
import routers.hub_publish as hp


# ── the ladder the matrix is written against ────────────────────────────────

def test_the_ladder_is_the_order_the_matrix_assumes():
    """Everything below reads `LEVELS.index`. If the ladder is reordered, the
    two rungs swap meaning in silence rather than failing."""
    for weak, strong in (("viewer", "editor"), ("editor", "admin")):
        assert LEVELS.index(weak) < LEVELS.index(strong), (
            f"{weak} must rank below {strong}"
        )


# ── the two rungs, named ────────────────────────────────────────────────────

def test_sending_is_gated_at_editor():
    assert hp._require_send_authority is not None
    src = inspect.getsource(hp._authority)
    assert '_authority("editor"' in inspect.getsource(hp)


def test_connecting_is_gated_at_admin():
    assert hp._require_connect_authority is not None
    assert '_authority("admin"' in inspect.getsource(hp)


def test_the_two_rungs_are_not_the_same_object():
    """A refactor that collapses them would silently promote sending to admin
    (locking marketing out again) or demote connecting to editor (handing a
    live credential to anyone who can write a caption)."""
    assert hp._require_send_authority is not hp._require_connect_authority


# ── every route is on the rung the matrix says ──────────────────────────────

#: Route function name -> the rung it must carry. Derived from what the caller
#: can undo. A route that appears in neither set and carries an authority
#: dependency fails the sweep below, so this table cannot fall behind the file.
SENDS = {"publish_now", "schedule_post", "bulk_schedule"}
CONNECTS = {
    "oauth_authorize", "connect_social_account", "disconnect_social_account",
    "set_client_platforms",
}


def _authority_of(fn_name: str) -> str | None:
    """Which authority dependency a route's signature actually carries."""
    fn = getattr(hp, fn_name, None)
    if fn is None:
        return "MISSING"
    for p in inspect.signature(fn).parameters.values():
        dep = getattr(p.default, "dependency", None)
        if dep is hp._require_send_authority:
            return "send"
        if dep is hp._require_connect_authority:
            return "connect"
    return None


@pytest.mark.parametrize("route", sorted(SENDS))
def test_every_sending_route_carries_the_editor_rung(route):
    assert _authority_of(route) == "send", (
        f"{route} puts a post in front of the client's audience and must carry "
        f"_require_send_authority"
    )


@pytest.mark.parametrize("route", sorted(CONNECTS))
def test_every_connecting_route_carries_the_admin_rung(route):
    assert _authority_of(route) == "connect", (
        f"{route} writes or destroys a live credential and must carry "
        f"_require_connect_authority"
    )


def test_scheduling_is_not_weaker_than_publishing():
    """THE GAP THIS CLOSED. `publish_now` carried an authority check and
    `schedule_post` carried none — only the module gate — while the two end in
    the same place: the cron does not ask who queued the row. Any Sahayak
    holder, at viewer level, could put a post in front of a client's audience by
    scheduling it for a minute's time."""
    assert _authority_of("schedule_post") == _authority_of("publish_now")
    assert _authority_of("bulk_schedule") == _authority_of("publish_now")


def test_no_route_carries_an_authority_this_matrix_has_not_classified():
    """The sweep that stops this table going stale. A new route that guards
    itself must be added to SENDS or CONNECTS, which forces somebody to decide
    which rung it belongs on."""
    classified = SENDS | CONNECTS
    for name, fn in vars(hp).items():
        if not callable(fn) or not hasattr(fn, "__module__"):
            continue
        if getattr(fn, "__module__", "") != hp.__name__:
            continue
        try:
            params = inspect.signature(fn).parameters.values()
        except (TypeError, ValueError):
            continue
        carries = any(
            getattr(p.default, "dependency", None)
            in (hp._require_send_authority, hp._require_connect_authority)
            for p in params
        )
        if carries:
            assert name in classified, (
                f"{name} guards itself but is in neither SENDS nor CONNECTS. "
                f"Decide which rung it belongs on and add it."
            )


# ── the module gate: publishing is not AI ───────────────────────────────────

def test_publishing_admits_marketing_as_well_as_the_assistant():
    """Nothing in connect, schedule or publish runs a model. Gating it on
    `sahayak` alone made a firm buy an AI assistant to post to its own
    Instagram."""
    src = inspect.getsource(hp)
    assert 'require_any_module(' in src
    assert '"sahayak"' in src and '"prachar"' in src


def test_the_authority_asks_both_modules():
    """`_hub_gate` admits a holder of either, so the authority question has to
    be asked of both — otherwise a Prachar admin with no Sahayak grant is let
    through the door and refused at the desk."""
    src = inspect.getsource(hp._level_across)
    assert '"sahayak"' in src and '"prachar"' in src
    assert "max(" in src, "must take the STRONGEST level held, not the first found"


# ── the Aekam question, ANSWERED ────────────────────────────────────────────

def test_platform_staff_need_a_support_session_to_reach_a_customers_publishing():
    """The owner's answer, asked and given: "requires support".

    `held_level` still returns `admin` for platform staff on any module they can
    reach — that product-wide rule is right for reading a customer's screen and
    is deliberately unchanged. What changed is that this router no longer treats
    it as sufficient for CONNECTING or POSTING.

    Ten Aekam accounts held standing power to connect a customer's Instagram,
    disconnect it, or publish to that customer's followers under that
    customer's name, unrecallably, with nothing granted and nothing recorded.
    Now it needs an approved, unexpired support session naming that operator and
    covering the module.
    """
    src = inspect.getsource(hp._authority)
    assert "_aekam_has_a_live_session" in src, (
        "the authority gate no longer asks for a support session — if that was "
        "deliberate, ten platform accounts just regained standing power to post "
        "as any customer"
    )
    assert "_platform_role" in src and "_org_role" in src, (
        "the narrowing must apply to platform staff ONLY; an org owner or admin "
        "of the org being acted in is not on a support session and must not be "
        "asked for one"
    )


def test_the_session_check_reads_the_view_rather_than_rebuilding_it():
    """`v_active_support_sessions`'s own COMMENT: "Read this; never rebuild the
    four clauses at a call site. Drift in a re-derived predicate is always
    permissive, because the clause a reader forgets is one that excludes rows."
    """
    src = inspect.getsource(hp._aekam_has_a_live_session)
    assert "v_active_support_sessions" in src
    for rebuilt in ("approved_at IS NOT NULL", "revoked_at", "denied_at",
                    "expires_at >"):
        assert rebuilt not in src, (
            f"the guard rebuilt `{rebuilt}` instead of reading the view — that "
            f"is the drift the view's comment warns about"
        )


def test_the_session_must_name_this_operator_and_cover_this_module():
    """A session is granted to a PERSON, by name, in an email the customer read
    — so a second operator must not ride somebody else's approval. And a
    customer who approved access to Ganit did not approve posting to their
    Instagram."""
    src = inspect.getsource(hp._aekam_has_a_live_session)
    assert "requested_by" in src, "any operator could use another's session"
    assert '"sahayak"' in src and '"prachar"' in src, (
        "the session's module scope is not checked, so approval for any module "
        "would unlock publishing"
    )


def test_the_session_check_fails_closed():
    """Everywhere else in this file a failure costs a customer their own
    feature, so the safe direction is open. Here a failure costs Aekam a power
    the customer never granted, so the safe direction is shut."""
    src = inspect.getsource(hp._aekam_has_a_live_session)
    assert "return False" in src.split("except Exception:")[1].split("if not row")[0], (
        "an unreadable support-session view must refuse Aekam, not admit them"
    )
