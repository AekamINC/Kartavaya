"""
compliance_settings.py — `GET /api/v1/org/compliance`, `GET/PATCH /{module}`.

The settings surface for `staging.module_compliance_settings` (migration
210, workstream H / proposal 80). One generic endpoint for every module in
the registry (`services/compliance_settings.py::RULES`) rather than one
router per module — the table, the resolver and the validation are already
generic; a bespoke endpoint per module would just be repeating the same
four lines with a different string literal.

── THREE THINGS THIS ROUTER DOES THAT THE RESOLVER DOES NOT ────────────────

1. `GET ""` — the whole screen in one call. `pages/org/TabCompliance.jsx`
   renders every module at once, so fetching per module would be N requests
   for one panel. `svc.resolve_all` does it in a single query.

2. `set_by` NEVER LEAVES AS AN ID. The table stores `public.users.user_id`
   (TEXT, `user_f1a0a472b98f`) and the product's rule is that a user, member
   or org id is never rendered — `frontend/scripts/check-rendered-ids.mjs` is
   the ratchet. `_named` swaps it for the display name from
   `services/audit_actors`, which is the one ladder in this codebase that
   resolves a person and stops before their email address. The raw id is
   dropped from the payload entirely rather than shipped alongside the name:
   a field that is present is a field a screen can render.

   `has_setter` travels beside it for the same reason `actor_select` emits
   one — "nobody has touched this rule" and "somebody set it and their
   account is gone" are different facts, and one NULL name cannot say which.

3. THE AUDIT ROW SAYS WHAT IT CHANGED FROM. `emit` was already called; it
   recorded only the new state, so the trail read "hsn_required is now
   not_applicable" with no way to tell a first decision from a reversal.
   The previous state is resolved before the write and travels in `detail`.
   For a compliance setting that distinction is most of the value of having
   an audit trail at all: proposal 80's rule 1 is that "not applicable" must
   be legible six months later as a decision rather than as a warning that
   somebody made go away.
"""
from fastapi import APIRouter, Depends, HTTPException, Request

from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from middleware.role_tiers import ORG_SETTINGS_ROLES
from pydantic import BaseModel
from services import compliance_settings as svc
from services.audit import emit as audit
from services.audit_actors import display_name

router = APIRouter(prefix="/api/v1/org/compliance", tags=["compliance-settings"])


async def _setter_names(pool, rule_maps: list[dict]) -> dict[str, str]:
    """`{user_id: display name}` for every `set_by` across the given rule maps.

    One query for the whole screen, not one per rule. LEFT-join semantics by
    hand: an id with no `public.users` row simply does not appear in the dict,
    and `_named` renders that as "no longer with the firm" rather than as
    nobody having set the rule.
    """
    ids = sorted({
        rule["set_by"]
        for rules in rule_maps for rule in rules.values()
        if rule.get("set_by")
    })
    if not ids:
        return {}
    rows = await pool.fetch(
        f"SELECT u.user_id, {display_name('u')} AS setter_name "
        "FROM public.users u WHERE u.user_id = ANY($1::text[])",
        ids,
    )
    return {r["user_id"]: r["setter_name"] for r in rows}


def _named(rules: dict, names: dict[str, str]) -> dict:
    """Swap every `set_by` id for a name. The id is REMOVED, not hidden."""
    out = {}
    for key, rule in rules.items():
        setter = rule.pop("set_by", None)
        out[key] = {
            **rule,
            "has_setter": bool(setter),
            # None when nobody set it; the label when the account is gone.
            "set_by_name": names.get(setter) if setter else None,
        }
    return out


@router.get("")
async def get_all_settings(
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """Every module that has compliance settings, resolved for this org.

    `active` is whether the org subscribes to the module. It ANNOTATES and
    never filters: a firm that recorded "composition scheme applies to us"
    and later switched Ganit off must still be able to see and correct that
    record — hiding it would leave a stored position nobody can reach, which
    is worse than an extra heading.
    """
    pool = await get_pool()
    modules = await svc.resolve_all(pool, org_id)
    names = await _setter_names(pool, [m["rules"] for m in modules])
    active = {
        r["module_code"] for r in await pool.fetch(
            "SELECT module_code FROM public.module_subscriptions "
            "WHERE org_id=$1::uuid AND is_active=TRUE",
            org_id,
        )
    }
    return {
        "modules": [
            {
                "module": m["module"],
                "active": m["module"] in active,
                "rules": _named(m["rules"], names),
            }
            for m in modules
        ],
        # Stated by the server so the screen does not hardcode the product's
        # own default in a second place and drift from it.
        "default_state": svc.DEFAULT_STATE,
    }


@router.get("/{module}")
async def get_module_settings(
    module: str,
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    if not svc.rules_for(module):
        raise HTTPException(404, f"'{module}' has no compliance settings.")
    pool = await get_pool()
    rules = await svc.resolve(pool, org_id, module)
    names = await _setter_names(pool, [rules])
    return {"module": module, "rules": _named(rules, names)}


class RulePatch(BaseModel):
    rule_key: str
    state: str
    reason: str | None = None


@router.patch("/{module}")
async def patch_module_setting(
    module: str,
    body: RulePatch,
    request: Request,
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()
    # Read BEFORE the write, so the audit row can say what it changed from.
    # A miss resolves to the default, which is the honest answer: an absent
    # row IS `applicable` (services/compliance_settings.py).
    previous = (await svc.resolve_states(pool, org_id, module)).get(
        body.rule_key, svc.DEFAULT_STATE)

    try:
        row = await svc.set_rule(
            pool, org_id, module, body.rule_key, body.state,
            set_by=user["user_id"], reason=body.reason,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    audit(
        "compliance.setting_updated", request, org_id=org_id, user_id=user["user_id"],
        resource_type="module_compliance_settings",
        resource_id=f"{module}.{body.rule_key}",
        detail={
            "module": module, "rule_key": body.rule_key,
            "previous_state": previous, "state": body.state,
            # Recorded on the event as well as on the row: the row is
            # overwritten by the next change, the event is not.
            "reason": body.reason,
        },
        severity="warn",
    )
    names = await _setter_names(pool, [{body.rule_key: dict(row)}])
    return {
        "status": "updated",
        "module": module,
        "previous_state": previous,
        **_named({body.rule_key: dict(row)}, names)[body.rule_key],
        "rule_key": row["rule_key"],
    }
