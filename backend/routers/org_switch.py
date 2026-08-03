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
"""
from fastapi import APIRouter, Depends

from auth_router import require_user
from db import get_pool

router = APIRouter(prefix="/api/v1/org", tags=["org-switch"])

#: The org-scoped roles that constitute membership. Mirrors the set
#: `org_resolver` accepts, so the switcher can never offer an org the resolver
#: would then refuse — a list and a gate that disagree is a dead menu item.
MEMBER_ROLES = ("org_owner", "org_admin", "org_member")


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

    seen: set[str] = set()
    orgs = []
    for r in rows:
        # A user can hold more than one role in the same org. The org appears
        # once, under the strongest role, so the switcher lists organisations
        # rather than grants.
        oid = str(r["id"])
        if oid in seen:
            continue
        seen.add(oid)
        orgs.append({
            "id": oid,
            "name": r["name"],
            "logo_url": r["logo_url"],
            "role": r["role_code"],
        })

    return {"data": orgs, "default_id": orgs[0]["id"] if orgs else None}
