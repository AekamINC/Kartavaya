"""
org_modules.py — `GET/PATCH /v1/org/modules`, the org's own module switches.

`TabModules.jsx` renders its grid read-only and says exactly why:

    "`10-org-settings.md` §4 specifies `GET/PATCH /v1/org/modules` as new work,
    and it has not been built. […] A switch that accepts a click and stores
    nothing is worse than one that is absent."

VERIFIED HELD at 2a2a27b: no route matched `/v1/org/modules`, and the only
writers of `staging.module_subscriptions` were `POST /v1/subscription/modules/
activate|deactivate` (BILLING_CONSOLE_ROLES) and `admin_orgs.py`'s
`/{org_id}/modules/{module_code}` pair (CONSOLE_ROLES). Both are Aekam staff.

═══════════════════════════════════════════════════════════════════════════════
1 · THE SOFT-FLAG RULE, AND WHY THIS FILE NEVER NAMES org_member_modules
═══════════════════════════════════════════════════════════════════════════════

The frontend agent recorded the constraint as:

    "Turning a module off must REVOKE grants without deleting data, and turning
    it back on must restore the previous grants — a soft flag on the module row,
    never a cascade delete on `org_member_modules`."

That is satisfied by doing LESS, not more. `staging.module_subscriptions`
already has the soft flag: `is_active`, with `activated_at` / `deactivated_at`
around it. Flipping `is_active` to FALSE revokes access for everyone
immediately, because `middleware/subscription.require_module` refuses on it
(the `module_subscriptions ... AND is_active=TRUE` lookup near the end of
`_check`) regardless of what grants a member holds. The grants themselves are
untouched, so flipping it back restores every one of them exactly as it was —
including the Tier-4 level on each, which a delete-and-recreate would reset to
the column default and silently demote every approver in the org to viewer.

**`org_member_modules` is not named anywhere in this file except to COUNT rows
for the response.** There is no DELETE and no UPDATE against it here. That is
the enforcement: not a flag that is checked, but a statement that is not
written. Any future edit that adds one has broken the rule.

The one remaining hole is not in this file and is reported: `PUT /v1/org/members/
{id}/modules` (`org_members.py`) replaces a member's grants with whatever list
it is sent. A member editor that hides disabled modules would send a list
without them and delete those grants as a side effect of an unrelated save. The
fix belongs in the client (send the full set) or in that endpoint (merge rather
than replace); it is called out in the report because that file is owned
elsewhere.

═══════════════════════════════════════════════════════════════════════════════
2 · WHO MAY TOGGLE — org_owner, NOT org_admin
═══════════════════════════════════════════════════════════════════════════════

Deliberately narrower than the rest of org settings, which is org_admin +
org_owner. The reason is a live gap, not a preference:

    middleware/subscription.py:120-126 — the org-role short-circuit reads
    `role_code IN ('org_owner','org_admin')` and, on a hit, skips the per-user
    grant check entirely.

So an org_admin reaches every ACTIVE module with no grant row. If org_admin
could also flip a module to active, an org_admin could hand themselves Vetana —
payroll — in one request, with no grant, no owner involved and no second step.
Enabling is therefore org_owner only. Disabling is org_owner only for the
matching reason: it revokes payroll access for the whole organisation at once.

Reading stays at org_admin + org_owner, which is who opens organisation
settings.

`require_org_role` additionally admits `platform_admin` unconditionally — god
mode, three accounts, existing behaviour across every org-scoped route.

═══════════════════════════════════════════════════════════════════════════════
3 · WHAT AN ORG MAY TURN *ON*
═══════════════════════════════════════════════════════════════════════════════

Only a module Aekam has already provisioned — i.e. one that already has a
`module_subscriptions` row for this org. Modules are a term of the subscription;
`TabModules.jsx` says so on screen. An org that could INSERT its own row would
be self-serving a module nobody sold it, which is why this file only ever
UPDATEs. A code with no row gets 403 and a message naming the account manager.

The switch this endpoint gives the customer is therefore "off, and back on
again" within what they already have — the tidy-up case the frontend describes —
and never "on for the first time".

═══════════════════════════════════════════════════════════════════════════════
4 · THE SPELLING — RESOLVED, NO TRANSLATION LEFT IN THIS FILE
═══════════════════════════════════════════════════════════════════════════════

This file used to carry an `_ENTITLEMENT_SPELLING` map because the entitlement
path spelled messaging `sanvaad` and the grant path spelled it `samvada`, so a
string comparison between them silently found nothing.

That is fixed at the source. `role_tiers.py` now says `sanvaad` in all four
sets, `messaging.py` gates on `require_module("sanvaad")`, and the frontend
catalogue's grant code is `sanvaad`. One spelling, so nothing to translate —
the map, both helpers and the `entitlement_code` response field are gone rather
than left as identity functions that imply a split still exists.

What did NOT change: `staging.samvada_*`, the six messaging TABLES. Those are
applied, and the design reference names them. A table name is not a module code.

The CHECK `org_member_modules_level_is_meaningful` still lists `samvada` in the
live database. That is `PROPOSED_070_sanvaad_spelling.sql`, unapplied. It is a
PROHIBITION ("no approver level on these modules"), not a whitelist — verified
by evaluating the live constraint expression against candidate rows — so the
code-first order is safe: a `sanvaad` grant passes the old CHECK, it simply is
not caught by it. Until 070 runs, the "no approver on Sanvaad" rule is enforced
by `valid_levels_for` in the application layer alone, with no database backstop.

STALE CLAIM CORRECTED, measured 2026-08-06: this paragraph used to end
"`staging.org_member_modules` is empty, so nothing is mis-stored today". It is
NOT empty. It holds twelve rows on the sensitive modules alone — five
`vetana`/`approver` across three orgs, plus ganit, manav and pahchan at
admin/viewer — and those five approver rows are the only representation in the
product of "may release payroll" (`routers/vetana.py` has no
`org_module_approvers` fallback; PROPOSED_074 is unapplied).

That sentence is why the emptiness claim is worth correcting rather than
deleting: it was the stated justification for several "safe to delete and
recreate" decisions about this table, and it stopped being true. Two writers
were still acting on it — `admin_orgs`' console PUT deleted every grant row for
a member and re-inserted at the `viewer` default, which would have wiped those
five rows with a 200. See `middleware/role_tiers.refuse_grant`.
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from middleware.role_tiers import (
    ALL_MODULES, SENSITIVE_MODULES, ORG_SETTINGS_ROLES, ORG_OWNER_ONLY,
)
from middleware.subscription import BUNDLED_MODULES, clear_module_cache
from services.audit import emit as audit

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/org/modules", tags=["org-modules"])


# ── Bodies ────────────────────────────────────────────────────────────────────

class ModuleToggle(BaseModel):
    code: str
    active: bool


class ModulesPatch(BaseModel):
    #: `{code, active}[]` — the shape 10-org-settings.md §4 specifies.
    modules: list[ModuleToggle]


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _log_event(pool, org_id: str, event_type: str, metadata: dict) -> None:
    """
    Mirror of `subscription.py::_log_event`, writing the same table.

    `staging.subscription_events` is written ALONGSIDE `services.audit.emit`,
    and both are kept.

    STALE CLAIM CORRECTED, measured 2026-08-06: this docstring used to say
    "`staging.audit_log` does not exist in the live database — migrations/060 is
    unapplied, so every `audit.emit(...)` call in this codebase is currently
    swallowed by its own `except Exception`". `SELECT to_regclass('staging.
    audit_log')` now answers `staging.audit_log`: the table is there, with all
    eleven columns `services/audit._write` names and no CHECK on `severity`.
    Audit rows from this route land.

    The correction matters beyond this file. `audit.emit` swallows its own
    failures by design, so "the table is missing" and "the write succeeded" look
    identical from the caller — a reader who trusts the old sentence would
    conclude that a missing audit row proves nothing, and stop looking.
    """
    try:
        await pool.execute(
            "INSERT INTO public.subscription_events (org_id, event_type, metadata) "
            "VALUES ($1::uuid, $2, $3::jsonb)",
            org_id, event_type, json.dumps(metadata),
        )
    except Exception:
        # A missing audit row must not fail the toggle the customer asked for,
        # but it must be loud in the logs.
        log.warning("subscription_events write failed for %s", event_type, exc_info=True)


async def _subscription_ok(pool, org_id: str) -> bool:
    """Same test `require_module` applies: a subscription that is not cancelled
    or paused. An org whose subscription has lapsed does not get to switch its
    modules back on from inside the product."""
    status = await pool.fetchval(
        "SELECT status FROM public.subscriptions WHERE org_id=$1::uuid", org_id,
    )
    return bool(status) and status not in ("cancelled", "paused")


async def _dependants(pool, org_id: str, ent_code: str) -> list[str]:
    """Active modules in this org that declare `ent_code` in `requires_module`.

    Same guard `POST /v1/subscription/modules/deactivate` applies. Without it an
    org can switch off the module another one is built on and get a half-working
    product with no error anywhere.
    """
    rows = await pool.fetch(
        "SELECT m.code FROM public.add_on_modules m "
        "JOIN public.module_subscriptions s "
        "  ON s.module_code = m.code AND s.org_id=$1::uuid AND s.is_active=TRUE "
        "WHERE $2 = ANY(m.requires_module)",
        org_id, ent_code,
    )
    return [r["code"] for r in rows]


# ── Read ──────────────────────────────────────────────────────────────────────

@router.get("")
async def get_modules(
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """
    Every module this org could have, with what is switched on and what is
    merely provisioned.

    `active` and `code` are the two keys §4 specifies. The rest exist so the
    grid can be honest rather than guessing:

      · `entitled`   — Aekam has provisioned it; this org may switch it on.
      · `toggleable` — it may be switched HERE. False for bundled modules,
                       which are a plan feature and are not rows in this table.
      · `grants_preserved` — how many member grants are held against it right
                       now. This is the number that makes the soft flag legible:
                       switching a module off leaves it unchanged, and a UI can
                       say "6 grants kept" instead of asking the admin to trust
                       that nothing was destroyed.
    """
    pool = await get_pool()

    subs = {
        r["module_code"]: r
        for r in await pool.fetch(
            "SELECT module_code, is_active, activated_at, deactivated_at "
            "FROM public.module_subscriptions WHERE org_id=$1::uuid",
            org_id,
        )
    }

    # Grants and entitlements now use the same spelling for all twelve modules,
    # so this is a straight read with nothing to normalise.
    grants: dict[str, int] = {
        r["module_code"]: r["n"]
        for r in await pool.fetch(
            "SELECT module_code, COUNT(*) AS n FROM public.org_member_modules "
            "WHERE org_id=$1::uuid GROUP BY module_code",
            org_id,
        )
    }

    out = []
    for code in sorted(ALL_MODULES):
        row = subs.get(code)
        bundled = code in BUNDLED_MODULES
        out.append({
            "code": code,
            # Bundled modules have no row here; they are gated on the plan's
            # `features` map by `require_module`, so reporting them as inactive
            # because this table is empty would be a lie on the card.
            "active": bool(row and row["is_active"]) or bundled,
            "entitled": bundled or row is not None,
            "toggleable": (not bundled) and row is not None,
            "bundled": bundled,
            "sensitive": code in SENSITIVE_MODULES,
            "activated_at": row["activated_at"] if row else None,
            "deactivated_at": row["deactivated_at"] if row else None,
            "grants_preserved": grants.get(code, 0),
        })

    # Anything the org is paying for that role_tiers does not list. A module a
    # customer has that renders as nothing is the worst way to be incomplete —
    # the same reasoning TabModules.jsx applies to its own catalogue.
    for ent, row in subs.items():
        if ent in ALL_MODULES:
            continue
        out.append({
            "code": ent,
            "active": bool(row["is_active"]),
            "entitled": True,
            # Not toggleable: `role_tiers` does not know this code, so nothing
            # can say what turning it off would revoke. Fail closed.
            "toggleable": False,
            "bundled": False,
            "sensitive": False,
            "activated_at": row["activated_at"],
            "deactivated_at": row["deactivated_at"],
            "grants_preserved": grants.get(ent, 0),
            "unrecognised": True,
        })

    return {
        "modules": out,
        # Stated in the payload so a client never has to infer it from a 403.
        "note": (
            "Modules are a term of the subscription. This organisation can "
            "switch a provisioned module off and back on; only Aekam can "
            "provision one. Switching a module off revokes access and keeps "
            "every member grant behind it."
        ),
    }


# ── Write ─────────────────────────────────────────────────────────────────────

@router.patch("")
async def patch_modules(
    body: ModulesPatch,
    request: Request,
    user=Depends(require_org_role(*ORG_OWNER_ONLY)),
    org_id: str = Depends(get_org_id),
):
    """
    Switch provisioned modules on or off. Soft flag only; grants are never
    touched.

    THE WHOLE BATCH IS VALIDATED BEFORE ANYTHING IS WRITTEN, and the writes run
    in one transaction. `org_members.py` carries the scar tissue from getting
    this wrong — it "used to validate in one loop and write in another, with the
    DELETE between them", so a bad last entry wiped a member's grants and only
    then raised. Same failure mode applies here: a partially-applied batch
    leaves the org with some modules off and no error explaining which.
    """
    if not body.modules:
        raise HTTPException(400, "No modules given")

    pool = await get_pool()

    # ── Validate ─────────────────────────────────────────────────────────────
    seen: dict[str, bool] = {}
    for item in body.modules:
        raw = (item.code or "").strip().lower()
        if not raw:
            raise HTTPException(400, "A module entry has no code")
        code = raw
        if code not in ALL_MODULES:
            raise HTTPException(
                400,
                f"Unknown module: {item.code}. Valid: "
                f"{', '.join(sorted(ALL_MODULES))}.",
            )
        if code in seen and seen[code] != item.active:
            raise HTTPException(
                400,
                f"'{code}' appears twice in this request with different values.",
            )
        seen[code] = item.active

    for code in seen:
        if code in BUNDLED_MODULES:
            raise HTTPException(
                400,
                f"'{code}' is bundled with the plan, not a per-org module "
                "subscription. It is switched on by the plan and cannot be "
                "toggled here.",
            )

    rows = {
        r["module_code"]: r
        for r in await pool.fetch(
            "SELECT module_code, is_active FROM public.module_subscriptions "
            "WHERE org_id=$1::uuid",
            org_id,
        )
    }

    enabling = {c for c, on in seen.items() if on}
    disabling = {c for c, on in seen.items() if not on}

    # Provisioning is Aekam's. This endpoint only ever UPDATEs.
    for code in sorted(seen):
        if code not in rows:
            raise HTTPException(
                403,
                f"'{code}' is not part of this organisation's subscription. "
                "Ask your account manager at Aekam to add it.",
            )

    if enabling and not await _subscription_ok(pool, org_id):
        raise HTTPException(
            403,
            "This organisation's subscription is not active, so a module "
            "cannot be switched back on. Contact your account manager.",
        )

    # Dependency guard, computed against the state AFTER this batch: a request
    # that switches off both a module and everything depending on it is legal,
    # and refusing it would force the admin to make two saves in a precise order
    # they have no way to know.
    for code in sorted(disabling):
        blockers = [
            d for d in await _dependants(pool, org_id, code)
            if d not in disabling
        ]
        if blockers:
            raise HTTPException(
                400,
                f"Cannot switch off '{code}': "
                f"{', '.join(sorted(blockers))} depend"
                f"{'s' if len(blockers) == 1 else ''} on it. Switch "
                f"{'it' if len(blockers) == 1 else 'those'} off in the same "
                "save, or first.",
            )

    # ── Write ────────────────────────────────────────────────────────────────
    changed: list[dict] = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            for code in sorted(seen):
                want = seen[code]
                if bool(rows[code]["is_active"]) == want:
                    continue  # already there; not an error, not an event
                if want:
                    await conn.execute(
                        "UPDATE public.module_subscriptions "
                        "SET is_active=TRUE, activated_at=NOW(), deactivated_at=NULL "
                        "WHERE org_id=$1::uuid AND module_code=$2",
                        org_id, code,
                    )
                else:
                    await conn.execute(
                        "UPDATE public.module_subscriptions "
                        "SET is_active=FALSE, deactivated_at=NOW() "
                        "WHERE org_id=$1::uuid AND module_code=$2",
                        org_id, code,
                    )
                changed.append({"code": code, "active": want})

    # Only after the transaction commits. Clearing earlier would let a request
    # in flight repopulate the cache from the pre-commit state and hold a
    # switched-off module open for the full TTL.
    if changed:
        clear_module_cache(org_id)

    for c in changed:
        await _log_event(
            pool, org_id,
            "module_enabled_by_org" if c["active"] else "module_disabled_by_org",
            {
                "module": c["code"],
                "by": user["user_id"],
                "via": "org_settings",
                "grants_preserved": True,
            },
        )
        audit(
            "org.module_toggled",
            request,
            org_id=org_id,
            user_id=user["user_id"],
            resource_type="module",
            resource_id=c["code"],
            detail={"active": c["active"], "via": "org_settings"},
            severity="warn" if c["code"] in SENSITIVE_MODULES else "info",
        )

    return {
        "status": "updated",
        "changed": changed,
        "unchanged": [c for c in sorted(seen) if c not in {x["code"] for x in changed}],
        # Said explicitly in the response because it is the property the whole
        # design hangs on, and a client should be able to show it verbatim.
        "grants_preserved": True,
    }
