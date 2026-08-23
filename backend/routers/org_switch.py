"""org_switch.py — the organisations this user may act as.

── Why this exists ──────────────────────────────────────────────────────────
The product had no org switcher. `middleware/org_resolver.get_org_id` reads an
`X-Org-Id` header first and validates membership, but the only caller that ever
sent it was the admin console (`frontend/src/pages/admin/orgScope.js`). For
everybody else the resolver fell through to:

    SELECT org_id FROM staging.user_roles
    WHERE user_id=$1 AND org_id IS NOT NULL AND role_code IN (...)
    ORDER BY granted_at LIMIT 1

— the OLDEST grant, always. So a user who belongs to two organisations could
only ever see the first one they were added to, and a grant added later was
unreachable no matter what. Measured on staging: an account with grants to three
orgs (16 Jul, 28 Jul, 3 Aug) could reach only the July one.

That is not a demo inconvenience. A firm with two entities — the practice and
the consultancy arm, which is the ordinary shape of the customers this is built
for — cannot see the second one at all.

── What this endpoint is, and is not ────────────────────────────────────────
It is the LIST. The switching itself needs no new endpoint: the server already
accepts `X-Org-Id` and already refuses one the caller does not belong to (403),
or an inactive org (404). This supplies the only thing the client was missing —
which organisations it may legitimately offer.

Deliberately NOT included: any org the user is not a member of. Platform staff
can resolve to any org through the header (that is the admin console's job, and
it is audited), but this list is memberships only. A switcher that offered every
tenant on the platform would be a different feature with a different risk.

── Seats, and why they are counted HERE and not computed ────────────────────
`organisations.max_users` is enforced, and it is typed in by hand per org at
creation, so an org can sit at its ceiling with nothing on screen saying so
until somebody fails to add an employee. The switcher row is the cheapest place
to make that visible before it is hit.

The count comes from `org_invites.count_seats` — the SAME function the refusal
uses — rather than a bespoke `COUNT(*)` written here. That is not tidiness: a
pending invite holds a seat, and a second counter that forgot it would show
"6 of 15" on a row the API refuses at 13. `admin_orgs.py` records what happened
the last time this rule was broken.

A NULL limit is UNLIMITED, not zero. Six of the seven rows in `staging.plans`
have `max_users` NULL and two of the three live orgs have no cap at all, so
`seats_limit: null` is the ordinary case, not an edge one. The client renders
the role alone for it — never a fabricated denominator.

── Support sessions, and the table that does not exist yet ──────────────────
Measured 2026-08-06: `SELECT to_regclass('staging.platform_support_sessions')`
returns NULL on the live database. The query is therefore guarded by
`to_regclass` and answers `[]` when the table is absent. That is not defensive
padding — "no approved sessions" is the permanent and correct answer for every
user today, and it is the state this code will be in for weeks. It must be
indistinguishable from a table that exists and is empty, because to the reader
it IS the same fact.

The column names are `migrations/111_platform_support_sessions.sql`'s, whose
shape is pinned by `tests/test_migrations_111_115.py::PSS_COLUMNS`: `ref`,
`requested_by`, `approved_by`/`approved_at`, `revoked_at`, and a NULLABLE
`expires_at` — a `granted_ttl_hours` of 0 means "until revoked", so a null
expiry is a LIVE session and must not be filtered out as an expired one.
"""
import logging

from fastapi import APIRouter, Depends

from auth_router import require_user
from db import get_pool
from middleware.role_tiers import ORG_ROLE_PRECEDENCE, ORG_TENANT_ROLES
from services.audit_actors import display_name

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/org", tags=["org-switch"])

#: The org-scoped roles that constitute membership. IMPORTED rather than
#: retyped, because the comment this replaces promised something a literal could
#: not keep: "mirrors the set `org_resolver` accepts". Wave 3 added three Tier-2
#: codes and the literal did not move, so an `hr_admin` or an `org_client` who
#: belongs to TWO organisations could resolve only the earliest of them —
#: `get_org_id`'s fallback picks one by `granted_at` and the switcher offered no
#: way to pick the other. The gate accepted them; the menu did not list them.
MEMBER_ROLES = ORG_TENANT_ROLES

#: Strongest first. A user can hold several grants in one org and the row must
#: name the one that decides what they can do, not whichever `granted_at`
#: happened to be earliest — "Member" printed under an owner is worse than no
#: role at all, because it is read as a demotion.
#:
#: Derived from `ORG_ROLE_PRECEDENCE` so a role cannot be added to the model and
#: rank nowhere here — an unranked code sorted by `.get(code, 99)` and every one
#: of them tied at 99, which is row order wearing a rank.
ROLE_RANK = {code: i for i, code in enumerate(ORG_ROLE_PRECEDENCE)}


async def _support_sessions(pool, user_id: str) -> list[dict]:
    """Orgs reachable through an ACTIVE, APPROVED, time-boxed support session.

    Empty list when the table has not been created — see the module header.
    `approved_at IS NOT NULL` is the approval: a requested-but-unapproved
    session must never appear, because appearing in this list is what makes an
    org look reachable. `denied_at IS NULL` is not redundant with it — 111
    keeps both timestamps on the row, so a session that was approved and later
    denied would otherwise still read as live.

    `expires_at IS NULL OR expires_at > NOW()`: a `granted_ttl_hours` of 0 is
    "until revoked" and is the only value that leaves an approved row with a
    null expiry. A bare `> NOW()` drops exactly the open-ended sessions, which
    are the ones most worth showing.
    """
    exists = await pool.fetchval(
        "SELECT to_regclass('staging.platform_support_sessions')"
    )
    if not exists:
        return []

    try:
        rows = await pool.fetch(
            "SELECT s.id, s.org_id, o.name AS org_name, s.ref, "
            "       s.expires_at, "
            # TWO RUNGS CAME OFF THIS LADDER, AND THE SECOND WAS THE WORSE BUG.
            # It read `COALESCE(u.full_name, u.name, u.email, s.approved_by)`.
            #
            # `u.email` — the owner's ruling (2026-08-23) is that a
            # display-name ladder must never end at an email address: a contact
            # detail rendered as a label on a screen that only wanted to say
            # who approved the session. Measured before removing it, because
            # the objection is "then it shows nothing": 0 of 35 live accounts
            # have neither `full_name` nor `name`, so that rung has never fired
            # on real data.
            #
            # `s.approved_by` — this holds a `user_id` from `public.users`,
            # TEXT like `user_f1a0a472b98f`. (Spelled that way round on
            # purpose: `test_the_column_names_are_the_ones_migration_111_
            # declares` greps this function's source for column names it must
            # not use, and the dotted form of that phrase trips it in prose.)
            # Falling through to it puts a MEMBER ID on
            # the org switcher, which is the names-not-ids rule broken outright
            # (`frontend/scripts/check-rendered-ids.mjs` is the ratchet). And
            # it is strictly worse than the email rung: it fires whenever the
            # `users` row is missing entirely — a deleted approver — which is a
            # case that CAN happen, unlike the nameless account.
            #
            # Both are replaced by one stated label. Not blank: a blank
            # approver on a support session reads as "nobody approved this",
            # and an unapproved support session is a different and alarming
            # claim. Ladder owned by `services/audit_actors.display_name()`;
            # it emits no `$n`, so `$1` below is untouched.
            + display_name("u")
            + " AS approved_by_name "
            "FROM staging.platform_support_sessions s "
            "JOIN staging.organisations o ON o.id = s.org_id "
            "LEFT JOIN users u ON u.user_id = s.approved_by "
            "WHERE s.requested_by = $1 "
            "  AND s.approved_at IS NOT NULL "
            "  AND s.denied_at IS NULL "
            "  AND s.revoked_at IS NULL "
            "  AND (s.expires_at IS NULL OR s.expires_at > NOW()) "
            "  AND o.is_active = TRUE "
            "ORDER BY s.expires_at NULLS LAST",
            user_id,
        )
    except Exception:  # pragma: no cover - the table exists but the shape drifted
        # The switcher is a convenience on every page of the app. A section that
        # cannot be built is absent; it is never an error banner over the whole
        # product.
        log.warning("support sessions unavailable", exc_info=True)
        return []

    return [{
        "id": str(r["id"]),
        "org_id": str(r["org_id"]),
        "name": r["org_name"],
        # The short human reference. A UUID cannot be read down a phone line,
        # and the switcher row, the approval mail and the org's audit log all
        # have to name the session with the SAME token.
        "ref": r["ref"],
        "approved_by": r["approved_by_name"],
        # Null means "until revoked", which is a live session with no clock —
        # the client renders it as such rather than dropping it.
        "expires_at": r["expires_at"].isoformat() if r["expires_at"] else None,
    } for r in rows]


@router.get("/memberships")
async def list_memberships(user=Depends(require_user)):
    """Every active organisation this user may act as, oldest grant first.

    Ordered by `granted_at` so the first entry is what `org_resolver` resolves
    to when no header is sent. The client can then show the current selection
    without a second round trip, and a user who has never switched sees the
    same org the server would have picked anyway.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT o.id, o.name, o.logo_url, ur.role_code, ur.granted_at "
        "FROM staging.user_roles ur "
        "JOIN staging.organisations o ON o.id = ur.org_id "
        "WHERE ur.user_id = $1 AND ur.org_id IS NOT NULL "
        "  AND ur.role_code = ANY($2::text[]) "
        "  AND o.is_active = TRUE "
        "ORDER BY ur.granted_at",
        user["user_id"], list(MEMBER_ROLES),
    )

    by_id: dict[str, dict] = {}
    order: list[str] = []
    for r in rows:
        # A user can hold more than one role in the same org. The org appears
        # once, under the strongest role, so the switcher lists organisations
        # rather than grants.
        oid = str(r["id"])
        role = r["role_code"]
        if oid in by_id:
            if ROLE_RANK.get(role, 99) < ROLE_RANK.get(by_id[oid]["role"], 99):
                by_id[oid]["role"] = role
            continue
        order.append(oid)
        by_id[oid] = {
            "id": oid,
            "name": r["name"],
            "logo_url": r["logo_url"],
            "role": role,
        }

    orgs = [by_id[oid] for oid in order]

    # Imported at the call site, not at module scope — `subscription.py` and
    # `auth_router.py` both reach for `org_invites` this way, and org_invites
    # imports back into the auth chain.
    from routers.org_invites import count_seats

    for o in orgs:
        try:
            seats = await count_seats(pool, o["id"])
        except Exception:  # pragma: no cover - a seat count must never 500 the list
            log.warning("seat count failed for org %s", o["id"], exc_info=True)
            o["seats_used"] = None
            o["seats_limit"] = None
            o["seats_full"] = False
            continue
        o["seats_used"] = seats.used
        # NULL is UNLIMITED. Collapsing it to 0 would render "9 of 0 seats" on
        # every org on an uncapped plan, which is most of them.
        o["seats_limit"] = seats.limit
        o["seats_full"] = seats.is_full

    return {
        "data": orgs,
        "support": await _support_sessions(pool, user["user_id"]),
        "default_id": orgs[0]["id"] if orgs else None,
    }
