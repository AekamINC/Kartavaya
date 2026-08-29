"""
tab_prefs.py — the tab order a person chose per module, and the tab that
module opens on. Proposal 67, demo 2 ("Tabs you choose"), the server half.

WHAT IS STORED, AND WHAT DELIBERATELY IS NOT
────────────────────────────────────────────
A preference is (order, default_tab) per module: `order` is the caller's
arrangement of tab ids, `default_tab` the starred one the module opens on.
The ids belong to the FRONTEND — each module page declares its strip in its
own TABS constant — so this API pins the GRAMMAR (id shape, count,
uniqueness, the star pointing inside the list) and not a per-module
catalogue. That is the proposal's compatibility promise: a tab we ship later
lands in More and never invalidates an arrangement saved before it existed;
an id that stops existing renders as nothing client-side, not an error.
Symmetrically, deep links beat `default_tab` in the client — the server only
stores the star.

`MODULE_TABS` is the nine pages that render <ModuleTabs> as a customer
module's strip (frontend/src/pages/*Page.jsx). The three Hub* pages are the
internal agency console — `hub` is not a customer module and its strips are
not on this contract — and OrgSahayakPage's tab ids carry spaces
('data catalog'), so its strip joins this set when its ids meet the grammar.

RESOLUTION
──────────
personal (user_id = caller)  >  org default (user_id IS NULL, current org)
>  the page's built-in order, which is frontend code and never a row — the
same ladder analytics saved views resolve (routers/analytics.py), applied
server-side in GET so every surface agrees on it. The personal row is
org-LESS: the arrangement follows its owner across orgs and devices, which
is what migration 154's partial-index pair encodes.

SELF-SCOPING — THE me.py RULE
─────────────────────────────
The personal handlers key every statement on `user["user_id"]` from the
verified token; no handler takes a user id from a path, query or body. The
org PUT writes what every member falls back to, which is org administration
— the same bar as saving an org-wide analytics view: `admin_org_id`, 403
otherwise.

An unknown module is 422 here, not analytics' 404: these routes are called
only by our own pages about themselves, so a module outside MODULE_TABS is a
malformed request, refused in the same voice as the rest of the grammar.
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
# The ladder fold and the DELETE command-tag parse are shared with
# routers/column_prefs.py (migration 198), which resolves the same
# personal > org > code ladder for a TABLE's columns. Two copies of a
# resolution rule is how the two come to disagree about it; the SQL stays
# here, next to the ON CONFLICT target that names this table's partial index.
from routers._pref_ladder import fold_ladder, removed

# One router for both surfaces: /me/tab-prefs is the caller's own row,
# /org/tab-prefs the default underneath it. One prefix, one registration.
router = APIRouter(prefix="/api/v1", tags=["tab-prefs"])

#: The TEN module pages that render <ModuleTabs> as their strip — the keys a
#: preference may be saved under. Derived from frontend/src/pages, not from
#: role_tiers.ALL_MODULES: sanvaad/sahayak/varta are modules without a strip
#: on this contract, and a key here without a strip would store arrangements
#: nothing ever reads.
#:
#: `kray` was MISSING until 2026-08-27 and it was a live defect, not a tidiness
#: one. `KrayPage.jsx` renders a strip and saves under `kray` like every other
#: module page, and this router refused the key — so a Kray user could
#: rearrange their tabs, see it work, and find the arrangement gone on the next
#: load, with nothing said. Added by `7770045b` (23 Aug, "kray module phase 1:
#: procurement as its own module with 7 tabs"); this allowlist did not follow,
#: and `test_tab_prefs.py` had been naming it for four days.
MODULE_TABS: frozenset[str] = frozenset({
    "dristi", "esign", "ganit", "graha", "kray", "manav",
    "pahchan", "prachar", "vetana", "vikray",
})

#: The widest strip today is Graha's 18 tabs; 30 leaves room without letting
#: a client persist an unbounded array.
MAX_TABS = 30

#: The id grammar every module page's TABS constant already satisfies
#: (including 'e-sign', 'follow-ups', 'client-report').
TAB_ID = re.compile(r"^[a-z0-9_-]{1,40}$")


class TabPrefPut(BaseModel):
    #: The full arrangement, first-to-last. Deliberately `list[str]` with the
    #: refusals in `_checked`, so every branch speaks in the house voice
    #: instead of pydantic's.
    order: list[str]
    default_tab: str | None = None


def _known_module_or_422(module: str) -> None:
    if module not in MODULE_TABS:
        raise HTTPException(
            422,
            f"{module!r} is not a module with a tab strip. Modules: "
            f"{', '.join(sorted(MODULE_TABS))}.",
        )


def _checked(module: str, body: TabPrefPut) -> None:
    """Refuse before touching the pool — 422s name the offence, the
    `_clean_layout` discipline. Grammar only, never a catalogue: see the
    module header for why the ids themselves are the frontend's to know."""
    _known_module_or_422(module)
    if not body.order:
        raise HTTPException(422, "order must name at least one tab")
    if len(body.order) > MAX_TABS:
        raise HTTPException(422, f"order holds at most {MAX_TABS} tabs")
    seen: set[str] = set()
    for tab in body.order:
        if not TAB_ID.match(tab):
            raise HTTPException(
                422,
                f"tab id {tab!r}: lowercase letters, digits, '-' and '_' "
                "only, 1–40 characters",
            )
        if tab in seen:
            raise HTTPException(422, f"tab id {tab!r} appears twice in order")
        seen.add(tab)
    if body.default_tab is not None and body.default_tab not in seen:
        raise HTTPException(
            422,
            f"default_tab {body.default_tab!r} is not in order — the opening "
            "tab must be one of the arranged tabs",
        )


def _saved(module: str, body: TabPrefPut, source: str, row) -> dict:
    return {
        "module": module,
        "order": body.order,
        "default_tab": body.default_tab,
        "source": source,
        "updated_at": (
            row["updated_at"].isoformat() if row and row["updated_at"] else None
        ),
    }


@router.get("/me/tab-prefs")
async def get_tab_prefs(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """Every module's resolved preference for this caller in this org —
    `{module: {order, default_tab, source}}`, an empty object when nothing is
    saved anywhere (the frontend's built-in order is the floor, and it is
    code, not a row)."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT module, tab_order, default_tab, user_id "
        "  FROM public.user_tab_prefs "
        " WHERE user_id = $1::text "
        "    OR (user_id IS NULL AND org_id = $2::uuid)",
        user["user_id"], org_id,
    )
    # Org rows first, personal rows second: the later write IS the
    # resolution, so a personal row wins whatever order the rows arrived in.
    # That loop is `_pref_ladder.fold_ladder` — the entry shape stays here.
    return fold_ladder(rows, "module", lambda r, personal: {
        "order": list(r["tab_order"] or []),
        "default_tab": r["default_tab"],
        "source": "personal" if personal else "org",
    })


@router.put("/me/tab-prefs/{module}")
async def put_my_tab_prefs(
    module: str,
    body: TabPrefPut,
    user=Depends(require_user),
):
    """Upsert the caller's own row. The conflict target names the partial
    index's predicate — without the WHERE clause Postgres cannot match
    `user_tab_prefs_personal_key` and the statement is an
    InvalidColumnReferenceError at run time, not at review time."""
    _checked(module, body)
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO public.user_tab_prefs (user_id, module, tab_order, default_tab) "
        "VALUES ($1::text, $2::text, $3::text[], $4::text) "
        "ON CONFLICT (user_id, module) WHERE user_id IS NOT NULL "
        "DO UPDATE SET tab_order = EXCLUDED.tab_order, "
        "              default_tab = EXCLUDED.default_tab, "
        "              updated_at = NOW() "
        "RETURNING updated_at",
        user["user_id"], module, body.order, body.default_tab,
    )
    return _saved(module, body, "personal", row)


@router.delete("/me/tab-prefs/{module}")
async def delete_my_tab_prefs(
    module: str,
    user=Depends(require_user),
):
    """Back to the resolution below: org default if one exists, else the
    page's built-in order. Scoped by the caller's own id in the DELETE
    itself, so there is no row anyone else's request could drop here."""
    _known_module_or_422(module)
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM public.user_tab_prefs "
        " WHERE user_id = $1::text AND module = $2::text",
        user["user_id"], module,
    )
    # Same command-tag parse me.py's deregister uses: "DELETE 0" → nothing.
    return {"removed": removed(result), "module": module}


@router.put("/org/tab-prefs/{module}")
async def put_org_tab_prefs(
    module: str,
    body: TabPrefPut,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """The org-default row every member without a personal row falls back to."""
    _checked(module, body)
    # Writing what the whole org opens is org administration — the bar an
    # org-wide analytics view holds. Imported at call time the way
    # analytics.py does, so a test that patches middleware.roles sees it.
    from middleware.roles import admin_org_id
    if not await admin_org_id(user["user_id"], org_id):
        raise HTTPException(403, "Only an org admin can set the organisation's tab order")
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO public.user_tab_prefs (org_id, module, tab_order, default_tab) "
        "VALUES ($1::uuid, $2::text, $3::text[], $4::text) "
        "ON CONFLICT (org_id, module) WHERE user_id IS NULL "
        "DO UPDATE SET tab_order = EXCLUDED.tab_order, "
        "              default_tab = EXCLUDED.default_tab, "
        "              updated_at = NOW() "
        "RETURNING updated_at",
        org_id, module, body.order, body.default_tab,
    )
    return _saved(module, body, "org", row)
