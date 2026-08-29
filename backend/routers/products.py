"""
products.py — the ONE product catalogue.

── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
There were two product tables and one of them was a ghost. `staging.crm_products`
carried 0 rows, no foreign key pointed at it, no view read it, and no line of
this repository — backend, frontend, mobile, migrations — named it. Every real
product lived in `staging.ganit_products`: 106 rows across all three orgs. So
the duplication was in the SCHEMA and not yet in the data, which is the cheapest
moment there will ever be to remove it. Migration 194 drops the ghost.

The duplication that WAS real is this one: a product is billed by Ganit, sold by
Vikray, and counted by the stock ledger — three modules over one object — and the
catalogue's routes lived inside Ganit behind `require_module("ganit")`. A firm
that bought Sales and not Finance could place orders against products it was not
allowed to list, and could not create a single one. The order form worked around
it by PROBING the Ganit catalogue to decide whether Ganit was reachable at all.

This is the same shape as `graha_clients`, and it takes the same answer that
`require_any_module` was written for: the gate names every module that owns the
object, and any one of them is enough.

── THE LEGACY PATH IS THE SAME FUNCTION ─────────────────────────────────────
`/api/v1/ganit/products` still answers, because it is these exact handlers
registered a second time (see the foot of this file's import in `ganit.py`) —
not a copy, and not a redirect. One implementation, two URLs, no drift.
"""
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_any_module
from services.audit_actors import actor_joins, actor_select

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/products", tags=["products"])

#: Finance first, because Ganit is where the catalogue has always lived and the
#: order decides only which module an admitted platform crossing is recorded
#: against. `subject` names the DATA rather than a module, so a caller holding
#: neither grant is told what they cannot reach instead of being read a price
#: list for two products they may already be paying for.
_gate = require_any_module("ganit", "vikray", subject="the product catalogue")


class ProductCreate(BaseModel):
    name: str
    hsn_code: str = ""
    sac_code: str = ""
    unit: str = "NOS"
    price: float = 0
    #: What it costs US. Optional and defaulting to None, NEVER to 0 — zero
    #: cost claims the item is free and renders every margin as 100%. See
    #: migration 137: `margin` and `margin_pct` are GENERATED from this and
    #: `price`, so nothing can store a margin that disagrees with them.
    cost_price: float | None = None
    gst_rate: float = 18.0
    description: str = ""
    is_service: bool = False


class ProductUpdate(BaseModel):
    name: str | None = None
    hsn_code: str | None = None
    sac_code: str | None = None
    unit: str | None = None
    price: float | None = None
    cost_price: float | None = None
    gst_rate: float | None = None
    description: str | None = None
    is_service: bool | None = None


#: Server-side allowlist. `update_product` builds its SET clause from the keys of
#: a Pydantic model, so no user string ever reaches it — but the identifier is
#: still interpolated, and the rule in CLAUDE.md is that dynamic identifiers come
#: from an allowlist rather than from trust in the layer above.
_UPDATABLE = frozenset(ProductUpdate.model_fields)


@router.get("")
async def list_products(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        # WHO added the product and WHO last repriced it, as NAMES. A price is
        # the one field in this catalogue an argument later gets had about, and
        # until migration 202 the table carried no author column at all — so
        # "who changed this to 4,500?" had no answer anywhere in the product.
        # `created_by`/`updated_by` hold `users.user_id`, which must never reach
        # a screen, so `services/audit_actors` resolves them here and the raw
        # ids are NOT in this select list.
        #
        # 106 rows predate 202 and are deliberately not backfilled: `has_creator`
        # is FALSE on every one of them, and the UI shows an em dash rather than
        # inventing an author who cannot be checked.
        #
        # IT GOES FIRST, not last. `actor_select` is comma-TERMINATED so it can
        # be dropped into the middle of a column list; appending it leaves a
        # dangling comma in front of `FROM`, which is a syntax error on every
        # request to this endpoint. The first version of this line did exactly
        # that and a mock pool would never have noticed — a live probe did.
        "SELECT " + actor_select("p", updated=True)
        + "p.id, p.name, p.hsn_code, p.sac_code, p.unit, p.price, "
        "p.cost_price, p.margin, p.margin_pct, p.gst_rate, "
        "p.description, p.is_service, p.created_at, p.updated_at "
        "FROM public.ganit_products p "
        + actor_joins("p", updated=True)
        + "WHERE p.org_id=$1::uuid AND p.is_active=TRUE "
        "ORDER BY p.name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("")
async def create_product(
    body: ProductCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO public.ganit_products "
        "(org_id, name, hsn_code, sac_code, unit, price, cost_price, gst_rate, "
        " description, is_service, created_by) "
        # `created_by` is stamped on the INSERT and nowhere else. The alternative
        # — leaving it null and letting the audit log carry the answer — is what
        # the 106 pre-202 rows already are, and reading an author back out of the
        # audit trail means a join per row against a table that is trimmed on a
        # schedule. Bound as $11, never interpolated.
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) "
        "RETURNING id, name, margin, margin_pct",
        org_id, body.name, body.hsn_code, body.sac_code, body.unit,
        body.price, body.cost_price, body.gst_rate, body.description, body.is_service,
        user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.patch("/{product_id}")
async def update_product(
    product_id: UUID,
    body: ProductUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    sent = body.dict(exclude_unset=True)
    # `cost_price` may be set back to NULL, and every other field may not. "I no
    # longer know what this costs" is a real thing to say, and the general
    # `v is not None` filter would silently discard it — leaving a stale cost and
    # a margin computed from it. Clearing any other field to NULL is a mistake,
    # not a statement, so those keep the filter.
    updates = {k: v for k, v in sent.items()
               if (v is not None or k == "cost_price") and k in _UPDATABLE}
    if not updates:
        raise HTTPException(400, "No fields to update")

    sets = []
    params = [str(product_id), org_id]
    idx = 3
    for k, v in updates.items():
        sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")
    # WHO repriced it, in the SAME statement that reprices it. A trigger cannot
    # do this — it does not know who is holding the connection — so a write path
    # that stamps `updated_at` and not `updated_by` leaves a table that can say
    # a price moved and not who moved it, which on a catalogue with a generated
    # `margin` is the one question anybody asks. `idx` is whatever the loop left
    # it at, so this is bound at the right position however many fields were
    # sent; getting that number wrong is an instant 500, not a wrong answer.
    sets.append(f"updated_by=${idx}")
    params.append(user["user_id"])
    idx += 1

    await pool.execute(
        f"UPDATE public.ganit_products SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


@router.delete("/{product_id}")
async def delete_product(
    product_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE public.ganit_products SET is_active=FALSE WHERE id=$1::uuid AND org_id=$2::uuid",
        str(product_id), org_id,
    )
    return {"status": "deleted"}
