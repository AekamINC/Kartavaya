"""
compliance_settings.py — `GET/PATCH /api/v1/org/compliance/{module}`.

The settings surface for `staging.module_compliance_settings` (migration
210, workstream H / proposal 80). One generic endpoint for every module in
the registry (`services/compliance_settings.py::RULES`) rather than one
router per module — the table, the resolver and the validation are already
generic; a bespoke endpoint per module would just be repeating the same
four lines with a different string literal.
"""
from fastapi import APIRouter, Depends, HTTPException, Request

from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from middleware.role_tiers import ORG_SETTINGS_ROLES
from pydantic import BaseModel
from services import compliance_settings as svc
from services.audit import emit as audit

router = APIRouter(prefix="/api/v1/org/compliance", tags=["compliance-settings"])


@router.get("/{module}")
async def get_module_settings(
    module: str,
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    if not svc.rules_for(module):
        raise HTTPException(404, f"'{module}' has no compliance settings.")
    pool = await get_pool()
    return {"module": module, "rules": await svc.resolve(pool, org_id, module)}


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
        detail={"module": module, "rule_key": body.rule_key, "state": body.state},
        severity="warn",
    )
    return {"status": "updated", **row}
