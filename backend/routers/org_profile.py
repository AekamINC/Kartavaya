"""
org_profile.py — Company profile (self-service).
Powers the invoice PDF letterhead: name, GSTIN/PAN, address, logo, contact
details, bank/UPI details for payment, and a custom invoice footer note.
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.roles import require_org_role
from middleware.org_resolver import get_org_id

router = APIRouter(prefix="/api/v1/org/profile", tags=["org-profile"])


class ProfileUpdate(BaseModel):
    name: str | None = None
    gstin: str | None = None
    pan: str | None = None
    billing_address: dict | None = None
    logo_url: str | None = None
    email: str | None = None
    phone: str | None = None
    website: str | None = None
    bank_details: dict | None = None
    invoice_note: str | None = None


@router.get("")
async def get_profile(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT name, gstin, pan, billing_address, logo_url, email, phone, "
        "website, bank_details, invoice_note FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )
    if not row:
        raise HTTPException(404, "Organisation not found")
    return dict(row)


@router.patch("")
async def update_profile(
    body: ProfileUpdate,
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()
    fields = body.dict(exclude_unset=True)
    if not fields:
        raise HTTPException(400, "Nothing to update")

    sets, params, idx = [], [], 1
    for key, val in fields.items():
        if key in ("billing_address", "bank_details"):
            sets.append(f"{key}=${idx}::jsonb")
            params.append(json.dumps(val or {}))
        else:
            sets.append(f"{key}=${idx}")
            params.append(val)
        idx += 1

    params.append(org_id)
    row = await pool.fetchrow(
        f"UPDATE staging.organisations SET {', '.join(sets)} WHERE id=${idx}::uuid "
        "RETURNING name, gstin, pan, billing_address, logo_url, email, phone, "
        "website, bank_details, invoice_note",
        *params,
    )
    return dict(row)
