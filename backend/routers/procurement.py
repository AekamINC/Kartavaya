"""
procurement.py — Purchase orders (proposal 77), whole.

Ordered, received, billed — the three quantities, the gaps between them, and
the workflow that ERP modules leave to spreadsheets and email. The arithmetic
and the rules live in `services/purchase_orders.py`; this file is the tenancy,
the transitions and the SQL.

────────────────────────────────────────────────────────────────────────────────
WHERE THIS SITS, AND WHY IT IS NOT A NEW MODULE CODE
────────────────────────────────────────────────────────────────────────────────

Gated `require_module("ganit")`. Procurement is Finance: it counterparts
`ganit_vendors`, it pours into `ganit_vendor_bills`, its tables are named
`ganit_*`, and proposal 77 puts the screen at **Finance → Purchase orders**.

Minting a new module code would have meant a new entry in
`role_tiers.ALL_MODULES`, a new `module_subscriptions` row for every org that
wants it, a plan-feature key, and an entitlement nobody has been sold — and the
file that records the last module rename records that it took THREE DEPLOYS in
a non-negotiable order because staging and production share one database. None
of that buys anything: a firm that holds the books holds its purchase orders.

────────────────────────────────────────────────────────────────────────────────
WHY ORDINARY WRITES ARE NOT RAISED TO `editor`
────────────────────────────────────────────────────────────────────────────────

`routers/ganit.py` records the reason and it applies here unchanged: every
existing `ganit` grant predates the level column or defaults to `viewer`, so
enforcing `editor` today would revoke ordinary bookkeeping from real users with
no migration to restore it. Procurement shares that module code and therefore
shares those grants — a stricter gate here would refuse exactly the people who
already do the buying. That tightening needs the grant-level backfill first.

APPROVAL IS NOT GATED ON `require_level("ganit", APPROVER)` EITHER, and that is
a deliberate departure from how `pay_vendor_bill` is guarded. The separated-duty
gate answers "does this person hold the approver authority for the module". A
purchase-order approval is answered by the org's own rule, which NAMES the
people who approve, by name, in settings this org wrote. Stacking the module
gate on top would refuse the very people the firm nominated — and an approval
step that cannot be satisfied is worse than no approval step. `may_approve`
enforces the rule; `_settings` decides what the rule is; the org decides what
`_settings` says.

Settings WRITES are `ORG_SETTINGS_ROLES` (org_admin / org_owner), because who
approves spending is an organisational decision, not a bookkeeping one.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.role_tiers import ORG_SETTINGS_ROLES
from middleware.roles import require_org_role
from middleware.subscription import require_module
# WHO raised the order and WHO last moved it, resolved to NAMES in SQL. Both
# columns hold `public.users.user_id`, which is a member id and must never reach
# a screen; `services/audit_actors` owns the one join+coalesce that turns them
# into names and stops at names, never falling through to an email address the
# way `graha.py:1466` still does. Neither helper adds a `$n`, so every parameter
# number below is exactly what it was.
from services.audit_actors import actor_joins, actor_select
from services.purchase_orders import (
    DEFAULT_PO_PREFIX,
    DEFAULT_SETTINGS,
    EDITABLE_STATUSES,
    OPEN_STATUSES,
    PO_PREFIX_KEY,
    RECEIVABLE_STATUSES,
    SORT_KEYS,
    TDS_194Q_THRESHOLD,
    TDS_194Q_WARN_AT,
    approval_satisfied,
    bill_qty_by_line,
    budget_state,
    build_diff,
    clean_prefix,
    compute_po_totals,
    derive_is_igst,
    match_rule,
    may_approve,
    needs_reapproval,
    next_po_number,
    po_prefix,
    po_status_after_receipts,
    receipt_allowed,
    resolve_194q,
    sanitise_settings,
    tds_194q_row,
    three_way_match,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/procurement", tags=["procurement-purchase-orders"])

_gate = require_module("kray")

# Shared, never re-implemented. Two copies of a response contract is how one of
# them ends up reporting a total the other does not, and the whole point of the
# `_total` / `truncated` keys is that a client can trust them.
from routers.graha import _listed  # noqa: E402

#: Every list in this module caps here. Same number the rest of the product
#: uses, so a client that already handles `truncated` handles this too.
LIMIT = 200


# ══════════════════════════════════════════════════════════════════════════════
# Models
# ══════════════════════════════════════════════════════════════════════════════

class POLine(BaseModel):
    product_id: str = ""
    description: str = ""
    hsn_code: str = ""
    sac_code: str = ""
    qty_ordered: float = 0
    unit: str = "NOS"
    rate: float = 0
    gst_rate: float = 0
    discount_pct: float = 0


class POCreate(BaseModel):
    vendor_id: str
    po_date: str = ""
    expected_date: str = ""
    department: str = ""
    category: str = ""
    currency: str = "INR"
    place_of_supply: str = ""
    #: The caller's answer, used only when the vendor's state cannot be
    #: derived. GSTIN is not mandatory and its absence must block nothing.
    is_igst: bool = False
    terms: str = ""
    notes: str = ""
    delivery_address: dict = {}
    line_items: list[POLine] = []


class POUpdate(BaseModel):
    vendor_id: Optional[str] = None
    po_date: Optional[str] = None
    expected_date: Optional[str] = None
    department: Optional[str] = None
    category: Optional[str] = None
    currency: Optional[str] = None
    place_of_supply: Optional[str] = None
    is_igst: Optional[bool] = None
    terms: Optional[str] = None
    notes: Optional[str] = None
    delivery_address: Optional[dict] = None
    line_items: Optional[list[POLine]] = None
    #: Why the order changed. Recorded on the revision, and worth asking for:
    #: a change order without a reason is a change nobody can explain later.
    reason: str = ""


class Decision(BaseModel):
    note: str = ""


class ReceiptCreate(BaseModel):
    po_line_id: str
    qty: float
    received_on: str = ""
    note: str = ""


class CloseRequest(BaseModel):
    reason: str


class BillLink(BaseModel):
    #: Empty string or null UNLINKS. A bill without a PO stays legal.
    po_id: Optional[str] = None


class SettingsUpdate(BaseModel):
    prefix: Optional[str] = None
    approval_required: Optional[bool] = None
    rules: Optional[list[dict]] = None
    self_approval: Optional[bool] = None
    reapproval_pct: Optional[float] = None
    reapproval_amount: Optional[float] = None
    over_receipt: Optional[str] = None
    over_receipt_tolerance_pct: Optional[float] = None
    close_reasons: Optional[list[str]] = None
    budgets_enabled: Optional[bool] = None
    budgets: Optional[list[dict]] = None


# ══════════════════════════════════════════════════════════════════════════════
# Settings
# ══════════════════════════════════════════════════════════════════════════════

async def _settings(pool, org_id: str) -> dict[str, Any]:
    """This org's PO settings, always usable.

    `sanitise_settings` never raises, so a settings blob that is malformed,
    hand-edited or simply absent yields the built-in defaults — which are
    "approval off, no rules, refuse over-receipt". An org that has configured
    nothing gets a module that numbers documents and never asks anyone for
    permission, which is the owner's decision written down.
    """
    try:
        raw = await pool.fetchval(
            "SELECT settings->'purchase_orders' FROM staging.organisations "
            "WHERE id = $1::uuid", org_id)
    except Exception:
        logger.warning("procurement: settings read failed for org %s", org_id)
        raw = None
    return sanitise_settings(raw)


@router.get("/settings")
async def get_settings(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    settings = await _settings(pool, org_id)
    settings["prefix"] = await po_prefix(pool, org_id)
    return {
        "data": settings,
        "defaults": DEFAULT_SETTINGS,
        "notes": {
            "approval": (
                "Rules are evaluated in order and the FIRST match decides. No "
                "match means no approval is needed."),
            "prefix": (
                "Changing the prefix starts a new number series at 0001. "
                "Orders already issued keep the number they were issued with."),
            "budgets": (
                "Departments are free text on the employee record and are not "
                "governed anywhere, so a budget keyed on one will stop "
                "matching the day the spelling changes. Budgets are off by "
                "default for that reason."),
        },
    }


@router.put("/settings")
async def put_settings(
    body: SettingsUpdate,
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Save this org's PO settings.

    Validated with a 400 rather than sanitised silently. `sanitise_settings` is
    forgiving because it runs on the READ path of every write in the module and
    must never stop a firm ordering; here there is a person to tell, and a rule
    that quietly dropped its approvers would leave orders stuck at
    `awaiting_approval` with nobody able to move them.
    """
    pool = await get_pool()
    current = await _settings(pool, org_id)
    incoming = body.model_dump(exclude_unset=True)

    if "over_receipt" in incoming and incoming["over_receipt"] not in ("refuse", "allow"):
        raise HTTPException(
            400, "Receiving must be 'refuse' or 'allow'. Nothing was saved.")

    if "rules" in incoming and incoming["rules"] is not None:
        member_ids = await _member_ids(pool, org_id)
        for i, rule in enumerate(incoming["rules"], start=1):
            if not isinstance(rule, dict):
                raise HTTPException(400, f"Rule {i} is not a rule. Nothing was saved.")
            approvers = [str(a).strip() for a in (rule.get("approver_ids") or []) if str(a).strip()]
            if not approvers:
                raise HTTPException(
                    400,
                    f"Rule {i} names nobody to approve. An order matching it "
                    f"could never be approved. Nothing was saved.")
            outside = [a for a in approvers if a not in member_ids]
            if outside:
                # Named without the id: the id is a key, never something a
                # person reads. The count is what the person needs.
                raise HTTPException(
                    400,
                    f"Rule {i} names {len(outside)} person(s) who are not "
                    f"members of this organisation. Nothing was saved.")
            required = int(rule.get("approvers_required") or 1)
            if required < 1 or required > len(approvers):
                raise HTTPException(
                    400,
                    f"Rule {i} needs {required} approver(s) but names "
                    f"{len(approvers)}. Nothing was saved.")

    for key, value in incoming.items():
        if key == "prefix":
            continue
        if value is not None:
            current[key] = value

    cleaned = sanitise_settings(current)

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE staging.organisations "
                "SET settings = COALESCE(settings, '{}'::jsonb) "
                "              || jsonb_build_object('purchase_orders', $2::jsonb), "
                # WHO decided that these people approve spending above this
                # figure. 202 put `updated_by` on `organisations` for exactly
                # this class of change, and an approval matrix nobody can be
                # asked about is the one settings blob where that matters most.
                # Bound as $3, never interpolated; `updated_at` moves with it
                # because a name beside a stale timestamp reads as a change that
                # happened at the wrong moment.
                "    updated_at = now(), updated_by = $3 "
                "WHERE id = $1::uuid",
                org_id, json.dumps(cleaned), user["user_id"])

            if body.prefix is not None:
                # The prefix rides in `doc_prefixes` beside the invoice
                # prefixes rather than in this module's own key: it is the same
                # kind of fact and a firm looking for "what do we number things
                # with" should find them together. Read-modify-write inside the
                # transaction so a concurrent invoice-prefix change is not lost.
                raw = (body.prefix or "").strip().upper()
                if raw and (not raw.isalpha() or not 2 <= len(raw) <= 8):
                    raise HTTPException(
                        400,
                        f"'{body.prefix}' cannot be used as a prefix: 2 to 8 "
                        f"letters, no digits and no hyphens. The number series "
                        f"is read back as PREFIX-YYYY-NNNN. Nothing was saved.")
                stored = await conn.fetchval(
                    "SELECT COALESCE(settings->'doc_prefixes', '{}'::jsonb) "
                    "FROM staging.organisations WHERE id = $1::uuid", org_id)
                merged: dict[str, Any] = {}
                if stored:
                    try:
                        merged = json.loads(stored) if isinstance(stored, str) else dict(stored)
                    except Exception:
                        merged = {}
                if raw:
                    merged[PO_PREFIX_KEY] = raw
                else:
                    merged.pop(PO_PREFIX_KEY, None)
                await conn.execute(
                    "UPDATE staging.organisations "
                    "SET settings = COALESCE(settings, '{}'::jsonb) "
                    "              || jsonb_build_object('doc_prefixes', $2::jsonb), "
                    # Same actor, second statement, same transaction: the two
                    # writes are one decision by one person, and stamping only
                    # the first would leave the prefix change unattributable
                    # whenever it is the only thing that moved.
                    "    updated_at = now(), updated_by = $3 "
                    "WHERE id = $1::uuid",
                    org_id, json.dumps(merged), user["user_id"])

    cleaned["prefix"] = await po_prefix(pool, org_id)
    return {"status": "saved", "data": cleaned}


async def _member_ids(pool, org_id: str) -> set[str]:
    rows = await pool.fetch(
        "SELECT user_id FROM staging.user_roles WHERE org_id = $1::uuid", org_id)
    return {r["user_id"] for r in rows}


@router.get("/approver-candidates")
async def approver_candidates(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Who this org could name as an approver.

    Returns the id — it is the key the rule is written with — and the NAME,
    which is the only thing any screen may draw. No email address: Aekam must
    not see a customer's member emails, and a picker does not need one.
    """
    pool = await get_pool()
    rows = await pool.fetch("""
        SELECT ur.user_id,
               COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''),
                        'Unnamed member') AS full_name,
               ur.role_code
        FROM staging.user_roles ur
        JOIN public.users u ON u.user_id = ur.user_id
        WHERE ur.org_id = $1::uuid
        ORDER BY 2
    """, org_id)
    return {"data": [dict(r) for r in rows], "total": len(rows)}


# ══════════════════════════════════════════════════════════════════════════════
# Reading an order
# ══════════════════════════════════════════════════════════════════════════════

async def _load_po(pool, org_id: str, po_id: str) -> dict[str, Any]:
    """The order, or a 404 that does not distinguish "not yours" from "not there".

    org_id is in the WHERE clause, not checked afterwards: an order belonging
    to another organisation must be indistinguishable from an order that does
    not exist, or the 403 itself confirms the id is real.
    """
    row = await pool.fetchrow(
        "SELECT po.*, "
        # Comma-TERMINATED, so it drops in ahead of the vendor columns and the
        # statement needs no dummy trailing column to absorb the comma.
        + actor_select("po", updated=True)
        + "       v.name AS vendor_name, v.gstin AS vendor_gstin, "
        "       v.email AS vendor_email, v.phone AS vendor_phone "
        "FROM staging.ganit_purchase_orders po "
        "JOIN staging.ganit_vendors v ON v.id = po.vendor_id "
        + actor_joins("po", updated=True)
        + "WHERE po.id = $1::uuid AND po.org_id = $2::uuid AND po.is_active",
        po_id, org_id)
    if not row:
        raise HTTPException(404, "Purchase order not found")
    return dict(row)


async def _lines_with_quantities(pool, org_id: str, po_id: str) -> list[dict[str, Any]]:
    """Lines, each carrying ordered / received / billed.

    `qty_received` is a SUM over receipts computed here, never a stored
    counter — see the module docstring in `services/purchase_orders.py` for
    why. `qty_billed` is filled in by the caller from the linked bills, because
    it needs those bills' jsonb and not every caller has fetched them.
    """
    rows = await pool.fetch("""
        SELECT l.*,
               COALESCE((SELECT SUM(r.qty) FROM staging.ganit_po_receipts r
                          WHERE r.po_line_id = l.id AND r.org_id = l.org_id), 0)
                   AS qty_received
        FROM staging.ganit_po_lines l
        WHERE l.po_id = $1::uuid AND l.org_id = $2::uuid AND l.is_active
        ORDER BY l.line_no
    """, po_id, org_id)
    out = []
    for r in rows:
        d = dict(r)
        d["qty_ordered"] = float(d.get("qty_ordered") or 0)
        d["qty_received"] = float(d.get("qty_received") or 0)
        d["qty_billed"] = 0.0
        d["outstanding"] = round(d["qty_ordered"] - d["qty_received"], 3)
        out.append(d)
    return out


async def _linked_bills(pool, org_id: str, po_id: str) -> list[dict[str, Any]]:
    rows = await pool.fetch("""
        SELECT b.id, b.bill_number, b.internal_ref, b.bill_date, b.acceptance_date,
               b.total, b.amount_paid, b.status, b.line_items
        FROM staging.ganit_vendor_bills b
        WHERE b.po_id = $1::uuid AND b.org_id = $2::uuid AND b.is_active
        ORDER BY b.bill_date
    """, po_id, org_id)
    out = []
    for r in rows:
        d = dict(r)
        items = d.get("line_items")
        if isinstance(items, str):
            try:
                items = json.loads(items)
            except Exception:
                items = []
        d["line_items"] = items if isinstance(items, list) else []
        out.append(d)
    return out


def _apply_billed(lines: list[dict[str, Any]], bills: list[dict[str, Any]]) -> None:
    """Fold every linked bill's quantities onto the lines, in place."""
    for bill in bills:
        for no, qty in bill_qty_by_line(lines, bill["line_items"]).items():
            for line in lines:
                if int(line.get("line_no") or 0) == no:
                    line["qty_billed"] = round(float(line.get("qty_billed") or 0) + qty, 3)


# ══════════════════════════════════════════════════════════════════════════════
# List / create
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/purchase-orders")
async def list_purchase_orders(
    status: str = "",
    vendor_id: str = "",
    department: str = "",
    category: str = "",
    open_only: bool = False,
    sort: str = "created_at",
    direction: str = "desc",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT po.id, po.po_number, po.revision, po.status, po.po_date, "
        "       po.expected_date, po.department, po.category, po.currency, "
        "       po.total, po.approval_required, po.approvers_required, "
        "       po.closed_reason, po.created_at, po.updated_at, po.issued_at, "
        "       v.name AS vendor_name, "
        # `updated_at` joins the projection with them, because "last touched"
        # without a time is half an answer and the column has been on this table
        # since before 201 — it was simply never selected.
        + actor_select("po", updated=True)
        + "       COUNT(*) OVER() AS _total "
        "FROM staging.ganit_purchase_orders po "
        "JOIN staging.ganit_vendors v ON v.id = po.vendor_id "
        + actor_joins("po", updated=True)
        + "WHERE po.org_id = $1::uuid AND po.is_active"
    )
    params: list[Any] = [org_id]
    if status:
        params.append(status)
        q += f" AND po.status = ${len(params)}"
    if open_only:
        params.append(list(OPEN_STATUSES))
        q += f" AND po.status = ANY(${len(params)}::text[])"
    if vendor_id:
        params.append(vendor_id)
        q += f" AND po.vendor_id = ${len(params)}::uuid"
    if department:
        params.append(department)
        q += f" AND po.department = ${len(params)}"
    if category:
        params.append(category)
        q += f" AND po.category = ${len(params)}"

    # SERVER-SIDE ALLOWLIST. `sort` and `direction` are concatenated into the
    # statement because a bind parameter cannot carry an identifier, so neither
    # value ever reaches the string without passing through a dict lookup and a
    # two-element membership test first.
    column = SORT_KEYS.get(sort, SORT_KEYS["created_at"])
    order = "ASC" if str(direction).lower() == "asc" else "DESC"
    # NULLS LAST on both directions: a draft has no number and no expected
    # date, and a list that opens with a wall of blanks looks broken.
    q += f" ORDER BY {column} {order} NULLS LAST LIMIT {LIMIT}"

    rows = await pool.fetch(q, *params)
    return _listed(rows, limit=LIMIT)


def _as_date(value: str, field: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(400, f"{field} is not a date (expected YYYY-MM-DD).")


async def _vendor(pool, org_id: str, vendor_id: str) -> dict[str, Any]:
    row = await pool.fetchrow(
        "SELECT id, name, gstin FROM staging.ganit_vendors "
        "WHERE id = $1::uuid AND org_id = $2::uuid AND is_active",
        vendor_id, org_id)
    if not row:
        raise HTTPException(404, "Vendor not found in this organisation")
    return dict(row)


async def _org_state(pool, org_id: str) -> str | None:
    return await pool.fetchval(
        "SELECT state_code FROM staging.organisations WHERE id = $1::uuid", org_id)


async def _validate_products(pool, org_id: str, lines: list[dict[str, Any]]) -> None:
    """Every named product must be this org's own.

    ONE CATALOGUE. `staging.ganit_products` is where products live for the
    whole product — billed by Ganit, sold by Vikray, and now ordered here.
    This module creates no second catalogue and no procurement-only item type.

    A product id from a request body is user input, and a foreign key alone
    would let one organisation put another's catalogue row on its order.
    """
    ids = {str(l.get("product_id") or "").strip() for l in lines}
    ids.discard("")
    if not ids:
        return
    try:
        found = await pool.fetch(
            "SELECT id::text AS id FROM staging.ganit_products "
            "WHERE org_id = $1::uuid AND id = ANY($2::uuid[])",
            org_id, list(ids))
    except Exception:
        # A malformed uuid in the body reaches asyncpg as a cast error. That is
        # a 400 about the request, not a 500 about the server.
        raise HTTPException(400, "One of the products named is not a valid id.")
    missing = ids - {r["id"] for r in found}
    if missing:
        raise HTTPException(
            400,
            f"{len(missing)} line(s) name a product that is not in this "
            f"organisation's catalogue.")


@router.post("/purchase-orders")
async def create_purchase_order(
    body: POCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Raise a purchase order. It starts as a DRAFT and carries no number.

    A serial spent on a draft is a gap in the series, and a gap in a numbered
    series is the thing an auditor asks about. The number is minted at issue.
    """
    pool = await get_pool()
    vendor = await _vendor(pool, org_id, body.vendor_id)
    lines_in = [l.model_dump() for l in body.line_items]
    await _validate_products(pool, org_id, lines_in)

    org_state = await _org_state(pool, org_id)
    is_igst, place = derive_is_igst(org_state, vendor.get("gstin"), body.is_igst)
    place_of_supply = body.place_of_supply or place

    computed = compute_po_totals(lines_in, is_igst)
    po_date = _as_date(body.po_date, "po_date") or date.today()
    expected = _as_date(body.expected_date, "expected_date")

    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("""
                INSERT INTO staging.ganit_purchase_orders
                    (org_id, vendor_id, status, po_date, expected_date,
                     department, category, currency, place_of_supply, is_igst,
                     subtotal, cgst, sgst, igst, total, terms, notes,
                     delivery_address, created_by)
                VALUES ($1::uuid, $2::uuid, 'draft', $3::date, $4::date,
                        NULLIF($5,''), NULLIF($6,''), $7, NULLIF($8,''), $9,
                        $10::numeric, $11::numeric, $12::numeric, $13::numeric,
                        $14::numeric, NULLIF($15,''), NULLIF($16,''),
                        $17::jsonb, $18)
                RETURNING *
            """, org_id, body.vendor_id, po_date, expected,
                body.department, body.category, body.currency or "INR",
                place_of_supply or "", is_igst,
                computed["subtotal"], computed["cgst"], computed["sgst"],
                computed["igst"], computed["total"],
                body.terms, body.notes,
                json.dumps(body.delivery_address or {}), user["user_id"])
            await _write_lines(conn, org_id, str(row["id"]), computed["lines"])

    return {"data": dict(row)}


async def _write_lines(conn, org_id: str, po_id: str,
                       lines: list[dict[str, Any]]) -> None:
    """Replace the order's lines with these.

    SOFT-DELETE, never DELETE. A receipt points at a line id, and a hard delete
    would either fail on the reference or orphan the arrival history — and the
    arrival history is the one thing in this module that cannot be
    reconstructed. A revised-away line stays on the row with `is_active` false,
    so "what arrived against the line we removed" still has an answer.
    """
    await conn.execute(
        "UPDATE staging.ganit_po_lines SET is_active = FALSE "
        "WHERE po_id = $1::uuid AND org_id = $2::uuid", po_id, org_id)
    for line in lines:
        await conn.execute("""
            INSERT INTO staging.ganit_po_lines
                (org_id, po_id, line_no, product_id, description, hsn_code,
                 sac_code, qty_ordered, unit, rate, gst_rate, discount_pct,
                 line_total, gst_amount)
            VALUES ($1::uuid, $2::uuid, $3::int, NULLIF($4,'')::uuid, $5,
                    NULLIF($6,''), NULLIF($7,''), $8::numeric, $9, $10::numeric,
                    $11::numeric, $12::numeric, $13::numeric, $14::numeric)
        """, org_id, po_id, line["line_no"], line["product_id"],
            line["description"], line["hsn_code"], line["sac_code"],
            line["qty_ordered"], line["unit"], line["rate"], line["gst_rate"],
            line["discount_pct"], line["line_total"], line["gst_amount"])


@router.get("/purchase-orders/{po_id}")
async def get_purchase_order(
    po_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    po = await _load_po(pool, org_id, str(po_id))
    lines = await _lines_with_quantities(pool, org_id, str(po_id))
    bills = await _linked_bills(pool, org_id, str(po_id))
    _apply_billed(lines, bills)

    receipts = await pool.fetch("""
        SELECT r.id, r.po_line_id, r.qty, r.received_on, r.note, r.created_at,
               COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''),
                        'A member') AS received_by_name
        FROM staging.ganit_po_receipts r
        LEFT JOIN public.users u ON u.user_id = r.received_by
        WHERE r.po_id = $1::uuid AND r.org_id = $2::uuid
        ORDER BY r.received_on, r.created_at
    """, str(po_id), org_id)

    revisions = await pool.fetch("""
        SELECT rv.revision, rv.changed_at, rv.diff, rv.reason, rv.re_approved,
               COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''),
                        'A member') AS changed_by_name
        FROM staging.ganit_po_revisions rv
        LEFT JOIN public.users u ON u.user_id = rv.changed_by
        WHERE rv.po_id = $1::uuid AND rv.org_id = $2::uuid
        ORDER BY rv.revision DESC
    """, str(po_id), org_id)

    approvals = await pool.fetch("""
        SELECT a.revision, a.decision, a.decided_at, a.note, a.approver_id,
               COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''),
                        'A member') AS approver_name
        FROM staging.ganit_po_approvals a
        LEFT JOIN public.users u ON u.user_id = a.approver_id
        WHERE a.po_id = $1::uuid AND a.org_id = $2::uuid
        ORDER BY a.decided_at
    """, str(po_id), org_id)

    rule = _stored_rule(po)
    settings = await _settings(pool, org_id)
    this_rev = [dict(a) for a in approvals if a["revision"] == po["revision"]]
    can_i, why_not = may_approve(
        settings, rule, user["user_id"], po.get("created_by"),
        [a["approver_id"] for a in this_rev])

    return {
        "data": dict(po),
        "lines": lines,
        "receipts": [dict(r) for r in receipts],
        "revisions": [dict(r) for r in revisions],
        "approvals": [
            # The id is dropped on the way out of the detail view. It is a key
            # for `may_approve` above and has no business in a response a
            # screen renders a list from.
            {k: v for k, v in dict(a).items() if k != "approver_id"}
            for a in approvals
        ],
        "bills": [{k: v for k, v in b.items() if k != "line_items"} for b in bills],
        "approval": {
            "required": bool(po.get("approval_required")),
            "approvers_required": po.get("approvers_required") or 0,
            "rule_name": (rule or {}).get("name"),
            "decisions_this_revision": len(this_rev),
            "caller_may_approve": can_i,
            "caller_may_not_because": why_not,
        },
        "editable": po["status"] in EDITABLE_STATUSES,
    }


def _stored_rule(po: dict[str, Any]) -> dict[str, Any] | None:
    """The rule snapshotted onto the order when its current revision was
    submitted — NOT the rule that settings would produce today.

    Settings change. Who was required to approve THIS order must not change
    retroactively because somebody edited the rules while it sat in the queue,
    or an order can become unapprovable by everyone who was asked to approve it.
    """
    raw = po.get("approval_rule")
    if not raw:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return None
    return raw if isinstance(raw, dict) else None


# ══════════════════════════════════════════════════════════════════════════════
# Editing — and the revision that an issued order's edit becomes
# ══════════════════════════════════════════════════════════════════════════════

@router.patch("/purchase-orders/{po_id}")
async def update_purchase_order(
    po_id: UUID,
    body: POUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Edit an order.

    ── "CAN I EDIT A PO AFTER IT HAS BEEN APPROVED?" ───────────────────────

    The most-asked question at every vendor in this market, and the answer has
    to be yes — as A REVISION, NOT AN OVERWRITE. A draft is edited in place
    because nobody has seen it. An issued order mints a new revision: the
    previous state is snapshotted whole, the change is recorded field by field,
    and the original is never destroyed.

    ── "DOES EDITING IT SEND IT BACK FOR APPROVAL?" ────────────────────────

    Depends on the change, and the rule is well established: a small edit
    within the existing authorisation flows through; a change that materially
    raises the value goes back down the same path it would have taken
    originally. `needs_reapproval` decides, against thresholds this org set.
    """
    pool = await get_pool()
    po = await _load_po(pool, org_id, str(po_id))

    if po["status"] in ("closed", "cancelled"):
        raise HTTPException(
            409, f"This purchase order is {po['status']} and cannot be changed.")

    incoming = body.model_dump(exclude_unset=True)
    reason = (incoming.pop("reason", "") or "").strip()
    lines_in = incoming.pop("line_items", None)

    if "vendor_id" in incoming and incoming["vendor_id"]:
        await _vendor(pool, org_id, incoming["vendor_id"])

    before_lines = await _lines_with_quantities(pool, org_id, str(po_id))

    # The order as it WILL be, assembled before anything is written so the diff
    # and the re-approval test both see the same picture.
    after = dict(po)
    for key, value in incoming.items():
        if value is not None:
            after[key] = value
    if "po_date" in incoming and incoming["po_date"] is not None:
        after["po_date"] = _as_date(incoming["po_date"], "po_date") or po["po_date"]
    if "expected_date" in incoming and incoming["expected_date"] is not None:
        after["expected_date"] = _as_date(incoming["expected_date"], "expected_date")

    if lines_in is not None:
        raw_lines = [l if isinstance(l, dict) else l.model_dump() for l in lines_in]
        await _validate_products(pool, org_id, raw_lines)
        _reject_receipt_orphans(before_lines, raw_lines)
    else:
        raw_lines = [
            {**l, "qty_ordered": l["qty_ordered"]} for l in before_lines
        ]

    computed = compute_po_totals(raw_lines, bool(after.get("is_igst")))
    after.update({
        "subtotal": computed["subtotal"], "cgst": computed["cgst"],
        "sgst": computed["sgst"], "igst": computed["igst"],
        "total": computed["total"],
    })

    diff = build_diff(po, after, before_lines, computed["lines"])
    if not diff:
        # A PATCH that changes nothing must not mint a revision, or every
        # accidental save inflates the revision number and the history stops
        # meaning anything.
        return {"data": po, "changed": False,
                "note": "Nothing changed, so no revision was recorded."}

    editable = po["status"] in EDITABLE_STATUSES
    settings = await _settings(pool, org_id)
    re_approve, why = (False, "")
    if not editable:
        re_approve, why = needs_reapproval(
            settings, float(po["total"] or 0), computed["total"])

    new_revision = po["revision"] if editable else po["revision"] + 1
    new_status = po["status"]
    rule_json = po.get("approval_rule")
    approvers_required = po.get("approvers_required") or 0
    approval_required = bool(po.get("approval_required"))

    if not editable and re_approve:
        rule = match_rule(settings, computed["total"],
                          after.get("department") or "", after.get("category") or "")
        if rule is not None:
            new_status = "awaiting_approval"
            approval_required = True
            approvers_required = rule["approvers_required"]
            rule_json = json.dumps(rule)
        else:
            # Material, but the org's rules no longer ask anyone about an order
            # this size. The order stays issued; the revision still records
            # that it was material, so the history does not claim it was minor.
            approval_required = False
            approvers_required = 0
            rule_json = None

    async with pool.acquire() as conn:
        async with conn.transaction():
            if not editable:
                await conn.execute("""
                    INSERT INTO staging.ganit_po_revisions
                        (org_id, po_id, revision, changed_by, diff, snapshot,
                         reason, re_approved)
                    VALUES ($1::uuid, $2::uuid, $3::int, $4, $5::jsonb,
                            $6::jsonb, NULLIF($7,''), $8)
                """, org_id, str(po_id), new_revision, user["user_id"],
                    json.dumps(diff, default=str),
                    json.dumps({"header": _snapshot(po), "lines": before_lines},
                               default=str),
                    reason, re_approve)

            await conn.execute("""
                UPDATE staging.ganit_purchase_orders
                   SET vendor_id = COALESCE(NULLIF($3,'')::uuid, vendor_id),
                       po_date = $4::date,
                       expected_date = $5::date,
                       department = NULLIF($6,''),
                       category = NULLIF($7,''),
                       currency = $8,
                       place_of_supply = NULLIF($9,''),
                       is_igst = $10,
                       terms = NULLIF($11,''),
                       notes = NULLIF($12,''),
                       delivery_address = $13::jsonb,
                       subtotal = $14::numeric, cgst = $15::numeric,
                       sgst = $16::numeric, igst = $17::numeric,
                       total = $18::numeric,
                       revision = $19::int, status = $20,
                       approval_required = $21, approvers_required = $22::int,
                       approval_rule = $23::jsonb,
                       updated_at = now(),
                       -- WHO amended it, in the statement that amends it. A
                       -- draft is edited in place and mints no revision row, so
                       -- for an unissued order this column is the ONLY record
                       -- of who touched it. $24 is the last parameter and is
                       -- appended last below; a wrong number here would bind a
                       -- jsonb rule into an actor column, and a wrong name in an
                       -- audit column is worse than a NULL because a NULL is
                       -- visibly unknown.
                       updated_by = $24
                 WHERE id = $1::uuid AND org_id = $2::uuid
            """, str(po_id), org_id,
                str(after.get("vendor_id") or ""),
                after.get("po_date"), after.get("expected_date"),
                after.get("department") or "", after.get("category") or "",
                after.get("currency") or "INR",
                after.get("place_of_supply") or "", bool(after.get("is_igst")),
                after.get("terms") or "", after.get("notes") or "",
                json.dumps(after.get("delivery_address") or {}, default=str),
                computed["subtotal"], computed["cgst"], computed["sgst"],
                computed["igst"], computed["total"],
                new_revision, new_status, approval_required,
                approvers_required, rule_json, user["user_id"])

            await _write_lines(conn, org_id, str(po_id), computed["lines"])

    fresh = await _load_po(pool, org_id, str(po_id))
    return {
        "data": fresh,
        "changed": True,
        "revision": new_revision if not editable else None,
        "diff": diff,
        "re_approval_required": re_approve,
        "re_approval_reason": why,
        "note": (
            why if re_approve else
            "Edited in place — this order has not been issued." if editable else
            "Recorded as a revision. The change was within the existing "
            "authorisation, so it did not go back for approval."),
    }


def _snapshot(po: dict[str, Any]) -> dict[str, Any]:
    """The header worth keeping, without the join columns.

    `vendor_name` and the vendor's contact details come from a JOIN and are
    the vendor record's, not the order's — snapshotting them would make the
    revision history claim a vendor was called something it may since have been
    renamed from, which is a different fact from the order changing.

    The four actor columns go the same way and for the same reason. They are
    resolved by a LEFT JOIN onto `public.users` at read time, so a snapshot
    carrying them would freeze a person's name as it was spelled the day the
    revision was taken — and worse, would put a resolved identity inside a jsonb
    blob that no `check-rendered-ids` ratchet ever looks at. `created_by` and
    `updated_by` themselves are real columns on the order and stay.
    """
    drop = {"vendor_name", "vendor_gstin", "vendor_email", "vendor_phone",
            "created_by_name", "has_creator", "updated_by_name", "has_updater"}
    return {k: v for k, v in po.items() if k not in drop}


def _reject_receipt_orphans(before: list[dict[str, Any]],
                            after: list[dict[str, Any]]) -> None:
    """Refuse a revision that removes a line something has already arrived against.

    The alternative is a receipt hanging off a line the order no longer has,
    and every quantity derived from it — goods received not invoiced, the
    three-way match, the MSME clock's acceptance date — quietly wrong. Closing
    the order short is the operation for "we are not going to receive the
    rest"; deleting the line is not.
    """
    kept = {int(l.get("line_no") or i + 1) for i, l in enumerate(after)}
    for line in before:
        if float(line.get("qty_received") or 0) != 0 and int(line["line_no"]) not in kept:
            raise HTTPException(
                409,
                f"Line {line['line_no']} has already had "
                f"{line['qty_received']:g} received against it and cannot be "
                f"removed. Close the order short instead, or reduce the "
                f"quantity ordered.")


@router.delete("/purchase-orders/{po_id}")
async def delete_purchase_order(
    po_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Discard a draft. Soft, and drafts only.

    An ISSUED order has been sent to a supplier and is not a mistake that can
    be un-made by deleting the record — `cancel` is what that is, and it keeps
    the number so the series has no hole in it.
    """
    pool = await get_pool()
    po = await _load_po(pool, org_id, str(po_id))
    if po["status"] not in EDITABLE_STATUSES:
        raise HTTPException(
            409,
            f"This purchase order is {po['status']}. Only a draft can be "
            f"discarded; an issued order is cancelled or closed short.")
    await pool.execute(
        # A soft delete is a state transition a PERSON asked for, and it is the
        # transition after which nothing else in this module will ever touch the
        # row — so if this write does not say who discarded the order, nothing
        # ever will.
        "UPDATE staging.ganit_purchase_orders SET is_active = FALSE, "
        "updated_at = now(), updated_by = $3 "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        str(po_id), org_id, user["user_id"])
    return {"status": "discarded"}


# ══════════════════════════════════════════════════════════════════════════════
# The workflow
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/purchase-orders/{po_id}/submit")
async def submit_purchase_order(
    po_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Send a draft on its way.

    If a rule matches, the order goes to `awaiting_approval` and the rule is
    snapshotted onto it. IF NO RULE MATCHES THE ORDER IS ISSUED IMMEDIATELY —
    the approval step is skipped entirely rather than auto-approved, because an
    approval record naming nobody is a lie about who agreed to the spend.
    """
    pool = await get_pool()
    po = await _load_po(pool, org_id, str(po_id))
    if po["status"] not in EDITABLE_STATUSES:
        raise HTTPException(
            409, f"This purchase order is already {po['status']}.")

    lines = await _lines_with_quantities(pool, org_id, str(po_id))
    if not lines:
        raise HTTPException(400, "A purchase order needs at least one line.")

    settings = await _settings(pool, org_id)
    rule = match_rule(settings, float(po["total"] or 0),
                      po.get("department") or "", po.get("category") or "")
    if rule is None:
        return await _issue(pool, org_id, str(po_id), user, po)

    await pool.execute("""
        UPDATE staging.ganit_purchase_orders
           SET status = 'awaiting_approval', approval_required = TRUE,
               approvers_required = $3::int, approval_rule = $4::jsonb,
               updated_at = now(),
               -- Submitting is a person putting their order in front of an
               -- approver. `created_by` says who drafted it; this says who sent
               -- it, and on an order drafted by one person and submitted by
               -- another those are different people and the approver is
               -- entitled to know which is which.
               updated_by = $5
         WHERE id = $1::uuid AND org_id = $2::uuid
    """, str(po_id), org_id, rule["approvers_required"], json.dumps(rule),
        user["user_id"])
    fresh = await _load_po(pool, org_id, str(po_id))
    return {
        "data": fresh,
        "status": "awaiting_approval",
        "rule": rule["name"],
        "approvers_required": rule["approvers_required"],
    }


async def _issue(pool, org_id: str, po_id: str, user, po: dict[str, Any]) -> dict[str, Any]:
    """Mint the number and issue.

    The number is allocated INSIDE `next_po_number`'s advisory lock and written
    immediately after, in the same request. The partial unique index on
    `(org_id, po_number)` is the backstop: if two requests somehow raced past
    the lock the second one fails loudly rather than issuing a duplicate serial.

    An order that already carries a number keeps it. A rejected order that is
    fixed and re-issued must not consume a second serial and leave a hole where
    the first one was.
    """
    number = po.get("po_number") or await next_po_number(
        pool, org_id, await po_prefix(pool, org_id))
    try:
        await pool.execute("""
            UPDATE staging.ganit_purchase_orders
               SET status = 'issued', po_number = $3, issued_at = now(),
                   updated_at = now(),
                   -- Every caller of `_issue` is a person: `submit` with no rule
                   -- matched, `issue` pressed directly, or the approver whose
                   -- decision satisfied the rule. Issuing is the act that sends
                   -- a document to a supplier and commits the firm's money, so
                   -- `issued_at` without an issuer is the one gap in this
                   -- module's history that an auditor would ask about first.
                   updated_by = $4
             WHERE id = $1::uuid AND org_id = $2::uuid
        """, po_id, org_id, number, user["user_id"])
    except Exception as exc:                                   # pragma: no cover
        if "ganit_purchase_orders_org_number_uq" in str(exc):
            raise HTTPException(
                409,
                "Another purchase order took that number first. Try again — "
                "nothing has been issued.")
        raise
    fresh = await _load_po(pool, org_id, po_id)
    return {"data": fresh, "status": "issued", "po_number": number,
            "note": "No approval rule matched, so this order was issued directly."
                    if not po.get("approval_required") else None}


@router.post("/purchase-orders/{po_id}/issue")
async def issue_purchase_order(
    po_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Issue an order that has cleared approval, or one that never needed it."""
    pool = await get_pool()
    po = await _load_po(pool, org_id, str(po_id))
    if po["status"] == "issued":
        return {"data": po, "status": "issued", "po_number": po["po_number"]}
    if po["status"] not in EDITABLE_STATUSES | {"awaiting_approval"}:
        raise HTTPException(
            409, f"A {po['status']} purchase order cannot be issued.")

    rule = _stored_rule(po)
    if po["status"] == "awaiting_approval":
        approvals = await pool.fetch(
            "SELECT approver_id, decision FROM staging.ganit_po_approvals "
            "WHERE po_id = $1::uuid AND org_id = $2::uuid AND revision = $3::int",
            str(po_id), org_id, po["revision"])
        if not approval_satisfied(rule, [dict(a) for a in approvals]):
            need = (rule or {}).get("approvers_required", 1)
            have = len({a["approver_id"] for a in approvals
                        if a["decision"] == "approved"})
            raise HTTPException(
                409,
                f"This purchase order still needs approval — {have} of {need} "
                f"approvals recorded.")
    return await _issue(pool, org_id, str(po_id), user, po)


@router.get("/approvals")
async def approval_queue(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Everything waiting on the caller.

    Filtered in Python rather than SQL: the approver list lives inside the
    snapshotted `approval_rule` jsonb, and a jsonb containment predicate over
    it would be both slower and unindexable at this volume. The candidate set
    is every order in this org sitting at `awaiting_approval`, which is small
    by construction — an org with hundreds of orders stuck awaiting approval
    has a process problem the query cannot fix.
    """
    pool = await get_pool()
    settings = await _settings(pool, org_id)
    rows = await pool.fetch("""
        SELECT po.id, po.po_number, po.revision, po.total, po.currency,
               po.department, po.category, po.po_date, po.expected_date,
               po.created_by, po.approval_rule, po.approvers_required,
               v.name AS vendor_name
        FROM staging.ganit_purchase_orders po
        JOIN staging.ganit_vendors v ON v.id = po.vendor_id
        WHERE po.org_id = $1::uuid AND po.is_active
          AND po.status = 'awaiting_approval'
        ORDER BY po.updated_at
        LIMIT $2::int
    """, org_id, LIMIT)

    out = []
    for r in rows:
        po = dict(r)
        rule = _stored_rule(po)
        decided = await pool.fetch(
            "SELECT approver_id FROM staging.ganit_po_approvals "
            "WHERE po_id = $1::uuid AND org_id = $2::uuid AND revision = $3::int",
            str(po["id"]), org_id, po["revision"])
        ok, why = may_approve(settings, rule, user["user_id"], po.get("created_by"),
                              [d["approver_id"] for d in decided])
        if not ok:
            continue
        out.append({
            "id": po["id"], "po_number": po["po_number"],
            "revision": po["revision"], "vendor_name": po["vendor_name"],
            "total": po["total"], "currency": po["currency"],
            "department": po["department"], "category": po["category"],
            "po_date": po["po_date"], "expected_date": po["expected_date"],
            "rule": (rule or {}).get("name"),
            "approvals_recorded": len(decided),
            "approvers_required": po["approvers_required"],
            "reason_pending": why,
        })
    return {"data": out, "total": len(out), "limit": LIMIT,
            "truncated": len(rows) >= LIMIT}


async def _decide(pool, org_id: str, po_id: str, user, decision: str,
                  note: str) -> dict[str, Any]:
    po = await _load_po(pool, org_id, po_id)
    if po["status"] != "awaiting_approval":
        raise HTTPException(
            409,
            f"This purchase order is {po['status']} and is not awaiting a "
            f"decision.")
    rule = _stored_rule(po)
    settings = await _settings(pool, org_id)
    decided = await pool.fetch(
        "SELECT approver_id, decision FROM staging.ganit_po_approvals "
        "WHERE po_id = $1::uuid AND org_id = $2::uuid AND revision = $3::int",
        po_id, org_id, po["revision"])
    ok, why = may_approve(settings, rule, user["user_id"], po.get("created_by"),
                          [d["approver_id"] for d in decided])
    if not ok:
        raise HTTPException(403, why)

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("""
                INSERT INTO staging.ganit_po_approvals
                    (org_id, po_id, revision, approver_id, decision, note)
                VALUES ($1::uuid, $2::uuid, $3::int, $4, $5, NULLIF($6,''))
                ON CONFLICT (po_id, revision, approver_id) DO NOTHING
            """, org_id, po_id, po["revision"], user["user_id"], decision, note)

            if decision == "rejected":
                # One rejection is decisive. The order goes back to the author
                # editable, keeping any number it already had — a rejected
                # order that is fixed and re-issued must not burn a second
                # serial and leave a hole where the first one was.
                await conn.execute(
                    # The rejection row in `ganit_po_approvals` already names the
                    # decider, and this column is stamped anyway: the two answer
                    # different questions. That table says "X rejected revision
                    # 3"; this says "the last hand on this record was X's", which
                    # is what the list screen reads and what stays true after the
                    # approvals are archived.
                    "UPDATE staging.ganit_purchase_orders SET status = 'rejected', "
                    "updated_at = now(), updated_by = $3 "
                    "WHERE id = $1::uuid AND org_id = $2::uuid",
                    po_id, org_id, user["user_id"])

    if decision == "rejected":
        return {"data": await _load_po(pool, org_id, po_id), "status": "rejected"}

    approvals = await pool.fetch(
        "SELECT approver_id, decision FROM staging.ganit_po_approvals "
        "WHERE po_id = $1::uuid AND org_id = $2::uuid AND revision = $3::int",
        po_id, org_id, po["revision"])
    if approval_satisfied(rule, [dict(a) for a in approvals]):
        issued = await _issue(pool, org_id, po_id, user, po)
        issued["note"] = "Approved and issued."
        return issued
    have = len({a["approver_id"] for a in approvals if a["decision"] == "approved"})
    return {
        "data": await _load_po(pool, org_id, po_id),
        "status": "awaiting_approval",
        "note": f"Recorded. {have} of {(rule or {}).get('approvers_required', 1)} "
                f"approvals so far.",
    }


@router.post("/purchase-orders/{po_id}/approve")
async def approve_purchase_order(
    po_id: UUID,
    body: Decision = Decision(),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    return await _decide(pool, org_id, str(po_id), user, "approved", body.note)


@router.post("/purchase-orders/{po_id}/reject")
async def reject_purchase_order(
    po_id: UUID,
    body: Decision = Decision(),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    return await _decide(pool, org_id, str(po_id), user, "rejected", body.note)


# ══════════════════════════════════════════════════════════════════════════════
# Receiving
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/purchase-orders/{po_id}/receipts")
async def record_receipt(
    po_id: UUID,
    body: ReceiptCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Record what turned up.

    ── THIS IS WHERE THE MSME CLOCK STARTS ─────────────────────────────────

    `ganit_vendor_bills.acceptance_date` feeds a STATUTORY payment deadline.
    This module does not keep a second idea of "received on" beside it: the
    earliest receipt against the order WRITES that column on every bill linked
    to the order that does not already carry one.

    Only where it is empty. A bill whose acceptance date was entered by hand
    is somebody's considered answer about when goods were accepted, and a
    delivery note is not entitled to overwrite it.
    """
    pool = await get_pool()
    po = await _load_po(pool, org_id, str(po_id))
    if po["status"] not in RECEIVABLE_STATUSES:
        raise HTTPException(
            409,
            f"Nothing can be received against a {po['status']} purchase "
            f"order. It has to be issued first.")

    lines = await _lines_with_quantities(pool, org_id, str(po_id))
    line = next((l for l in lines if str(l["id"]) == str(body.po_line_id)), None)
    if line is None:
        raise HTTPException(404, "That line is not on this purchase order.")

    settings = await _settings(pool, org_id)
    ok, why = receipt_allowed(settings, line["qty_ordered"],
                              line["qty_received"], body.qty)
    if not ok:
        raise HTTPException(400, why)

    received_on = _as_date(body.received_on, "received_on") or date.today()

    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("""
                INSERT INTO staging.ganit_po_receipts
                    (org_id, po_id, po_line_id, qty, received_on, received_by, note)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::date,
                        $6, NULLIF($7,''))
                RETURNING *
            """, org_id, str(po_id), body.po_line_id, body.qty, received_on,
                user["user_id"], body.note)

            for l in lines:
                if str(l["id"]) == str(body.po_line_id):
                    l["qty_received"] = l["qty_received"] + float(body.qty)
            new_status = po_status_after_receipts(po["status"], lines)
            await conn.execute(
                # STAMPED, and it is worth saying why this one is not the
                # cascade case. The status here is derived from quantities, but
                # the quantity that moved is the one THIS caller just recorded
                # against THIS order in this same transaction — they are the
                # author of the change, not a bystander to somebody else's. The
                # bill sweep twelve lines below is the opposite case and is
                # deliberately left unstamped; see the comment there.
                "UPDATE staging.ganit_purchase_orders SET status = $3, "
                "updated_at = now(), updated_by = $4 "
                "WHERE id = $1::uuid AND org_id = $2::uuid",
                str(po_id), org_id, new_status, user["user_id"])

            # The earliest arrival against this order, which is what the
            # statutory clock runs from — not this receipt, which may be a
            # later delivery being entered first.
            earliest = await conn.fetchval(
                "SELECT MIN(received_on) FROM staging.ganit_po_receipts "
                "WHERE po_id = $1::uuid AND org_id = $2::uuid AND qty > 0",
                str(po_id), org_id)
            stamped = 0
            if earliest:
                # ── `updated_by` IS DELIBERATELY NOT SET HERE ────────────────
                #
                # 201 gave `ganit_vendor_bills` both `updated_at` and
                # `updated_by`, and this is the one write in this file that
                # takes neither. The person on this request recorded a DELIVERY;
                # they did not decide anything about these bills — they may not
                # have known they existed, they are stamped in bulk, and the
                # date written is `MIN(received_on)` over EVERY receipt on the
                # order, which is very often somebody else's earlier delivery.
                # Naming this caller as the author would put a person's name
                # against a statutory MSME acceptance date they never chose, and
                # that is worse than the NULL it replaces, because a NULL is
                # visibly unknown while a name is believed.
                #
                # `updated_at` is not the router's business either way:
                # `trg_touch_ganit_vendor_bills` (201, BEFORE UPDATE) owns that
                # column and is true no matter who writes the row.
                stamped = await conn.fetchval("""
                    WITH touched AS (
                        UPDATE staging.ganit_vendor_bills
                           SET acceptance_date = $3::date
                         WHERE po_id = $1::uuid AND org_id = $2::uuid
                           AND is_active AND acceptance_date IS NULL
                        RETURNING 1)
                    SELECT count(*) FROM touched
                """, str(po_id), org_id, earliest)

    return {
        "data": dict(row),
        "status": new_status,
        "acceptance_dates_written": int(stamped or 0),
        "note": (
            f"{stamped} linked bill(s) had their acceptance date set from the "
            f"first delivery, which is what the MSME payment clock runs from."
            if stamped else None),
    }


@router.post("/purchase-orders/{po_id}/close")
async def close_purchase_order(
    po_id: UUID,
    body: CloseRequest,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Close an order that will never be fully delivered — WITH A REASON.

    Without this, every partially-fulfilled order sits open for ever and the
    committed-spend figure is permanently wrong. The reason comes from the
    firm's own list so it is a value something can report on rather than free
    text nobody reads; a reason outside the list is refused, which is what
    makes the list mean anything.
    """
    pool = await get_pool()
    po = await _load_po(pool, org_id, str(po_id))
    if po["status"] in ("closed", "cancelled"):
        raise HTTPException(409, f"This purchase order is already {po['status']}.")
    if po["status"] in EDITABLE_STATUSES:
        raise HTTPException(
            409,
            "A draft has not been ordered, so there is nothing to close. "
            "Discard it instead.")

    settings = await _settings(pool, org_id)
    reasons = settings.get("close_reasons") or []
    reason = (body.reason or "").strip()
    if reason not in reasons:
        raise HTTPException(
            400,
            "Choose a reason from this organisation's list, so the reason is "
            "something a report can group by. Nothing was closed.")

    await pool.execute("""
        UPDATE staging.ganit_purchase_orders
           SET status = 'closed', closed_at = now(), closed_by = $3,
               closed_reason = $4, updated_at = now(),
               -- Same person as `closed_by` on this path, and written anyway
               -- rather than left for a reader to infer. `closed_by` is only
               -- ever populated on a close; `updated_by` is the column every
               -- list and every generic audit read looks at, and leaving it
               -- holding whoever last edited the order would make the row say
               -- the wrong person moved it last.
               updated_by = $5
         WHERE id = $1::uuid AND org_id = $2::uuid
    """, str(po_id), org_id, user["user_id"], reason, user["user_id"])
    return {"data": await _load_po(pool, org_id, str(po_id)), "status": "closed"}


@router.get("/purchase-orders/{po_id}/match")
async def match_purchase_order(
    po_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """PO against receipt against bill, with discrepancies flagged.

    NOTHING IS APPROVED HERE. Automatically approving a bill because it matches
    is a decision to make after somebody has watched the match be right for a
    few months; the exceptions are surfaced from day one and the automation is
    deliberately not built.
    """
    pool = await get_pool()
    po = await _load_po(pool, org_id, str(po_id))
    lines = await _lines_with_quantities(pool, org_id, str(po_id))
    bills = await _linked_bills(pool, org_id, str(po_id))
    _apply_billed(lines, bills)
    return three_way_match(po, lines, bills)


@router.post("/vendor-bills/{bill_id}/link")
async def link_bill(
    bill_id: UUID,
    body: BillLink,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Point a vendor bill at a purchase order, or unpoint it.

    A BILL WITHOUT A PO STAYS LEGAL and always will. Most firms raise purchase
    orders for some spend and not all, and refusing an un-ordered bill would
    stop them recording real invoices. Unlinking is therefore a first-class
    operation, not an undo.

    The bill's vendor and the order's vendor must be the same. They are not
    checked because a foreign key would have caught it — a foreign key cannot
    express "and in the same org" either — but because a bill linked to another
    supplier's order makes every three-way match on both of them wrong.
    """
    pool = await get_pool()
    bill = await pool.fetchrow(
        "SELECT id, vendor_id, po_id FROM staging.ganit_vendor_bills "
        "WHERE id = $1::uuid AND org_id = $2::uuid AND is_active",
        str(bill_id), org_id)
    if not bill:
        raise HTTPException(404, "Vendor bill not found")

    target = (body.po_id or "").strip()
    if not target:
        await pool.execute(
            # HALF the pair, and that is correct here. 201 added `updated_by`
            # AND a BEFORE UPDATE trigger, `trg_touch_ganit_vendor_bills`, which
            # owns `updated_at` on this table — setting the timestamp by hand
            # would be a second writer of a value the database already maintains
            # for every writer, including the ones that are not this router.
            # WHO is the half no trigger can answer: a trigger does not know who
            # is holding the connection.
            #
            # Unlinking changes what every three-way match on both documents
            # says, which makes "who unlinked it" the first question asked when
            # the match stops agreeing with the file.
            "UPDATE staging.ganit_vendor_bills SET po_id = NULL, updated_by = $3 "
            "WHERE id = $1::uuid AND org_id = $2::uuid",
            str(bill_id), org_id, user["user_id"])
        return {"status": "unlinked"}

    po = await _load_po(pool, org_id, target)
    if str(po["vendor_id"]) != str(bill["vendor_id"]):
        raise HTTPException(
            400,
            "That purchase order is for a different supplier. Linking it "
            "would make the three-way match wrong on both documents.")
    if po["status"] in EDITABLE_STATUSES:
        raise HTTPException(
            400,
            "That purchase order has not been issued yet, so nothing was "
            "ordered against it.")

    await pool.execute(
        # `updated_by` only — the trigger owns `updated_at`. See the unlink
        # branch above for the whole argument.
        "UPDATE staging.ganit_vendor_bills SET po_id = $3::uuid, updated_by = $4 "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        str(bill_id), org_id, target, user["user_id"])
    return {"status": "linked", "po_number": po["po_number"]}


# ══════════════════════════════════════════════════════════════════════════════
# What the module answers
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/reports/committed-spend")
async def committed_spend(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Issued, not yet discharged. Does not exist today in any form.

    Grouped by department AND returned as a total, because the total is the
    number a partner asks for and the split is the number a budget needs.
    Closed orders are excluded: closed short or fully billed, the commitment is
    discharged, and leaving them in is exactly how the figure becomes
    permanently wrong.
    """
    pool = await get_pool()
    rows = await pool.fetch("""
        SELECT COALESCE(NULLIF(btrim(po.department), ''), '(no department)')
                   AS department,
               count(*) AS orders,
               COALESCE(SUM(po.total), 0) AS committed
        FROM staging.ganit_purchase_orders po
        WHERE po.org_id = $1::uuid AND po.is_active
          AND po.status = ANY($2::text[])
        GROUP BY 1 ORDER BY 3 DESC
    """, org_id, list(OPEN_STATUSES))
    by_dept = [dict(r) for r in rows]
    total = sum(float(r["committed"] or 0) for r in by_dept)

    settings = await _settings(pool, org_id)
    budgets = budget_state(
        settings,
        {r["department"]: float(r["committed"] or 0) for r in by_dept})

    return {
        "data": by_dept,
        "total": round(total, 2),
        "orders": sum(int(r["orders"] or 0) for r in by_dept),
        "budgets": budgets,
        "note": (
            "Committed spend is what has been ORDERED and not yet discharged. "
            "It is not a payable and enters no ledger."),
    }


@router.get("/reports/received-not-invoiced")
async def received_not_invoiced(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """The period-end accrual — goods received, no bill yet.

    Currently assembled by hand or not at all. Valued at the ORDERED RATE,
    which is the only rate anyone has: the bill that would carry the real one
    is precisely what has not arrived. Stated in the response rather than left
    for the reader to assume.
    """
    pool = await get_pool()
    orders = await pool.fetch("""
        SELECT po.id, po.po_number, po.po_date, po.total, po.currency,
               v.name AS vendor_name
        FROM staging.ganit_purchase_orders po
        JOIN staging.ganit_vendors v ON v.id = po.vendor_id
        WHERE po.org_id = $1::uuid AND po.is_active
          AND po.status = ANY($2::text[])
        ORDER BY po.po_date
        LIMIT $3::int
    """, org_id, list(OPEN_STATUSES), LIMIT)

    out, grand = [], 0.0
    for o in orders:
        lines = await _lines_with_quantities(pool, org_id, str(o["id"]))
        bills = await _linked_bills(pool, org_id, str(o["id"]))
        _apply_billed(lines, bills)
        accrual = 0.0
        for l in lines:
            gap = float(l["qty_received"]) - float(l["qty_billed"])
            if gap > 0:
                accrual += gap * float(l.get("rate") or 0)
        if accrual <= 0:
            continue
        grand += accrual
        out.append({
            "po_number": o["po_number"], "vendor_name": o["vendor_name"],
            "po_date": o["po_date"], "currency": o["currency"],
            "accrual": round(accrual, 2),
        })
    out.sort(key=lambda r: r["accrual"], reverse=True)
    return {
        "data": out, "total": round(grand, 2),
        "basis": "Valued at the ORDERED rate — the bill carrying the real one "
                 "is what has not arrived.",
    }


@router.get("/reports/late-suppliers")
async def late_suppliers(
    as_of: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Expected date passed with quantity still outstanding.

    Carries the vendor's phone number and email, because the whole point of
    knowing a supplier is nine days late is being able to ring them. An order
    with NO expected date is not late — it is undated, which is a different
    thing, and reporting it as late would train the firm to ignore the list.
    """
    pool = await get_pool()
    today = _as_date(as_of, "as_of") or date.today()
    orders = await pool.fetch("""
        SELECT po.id, po.po_number, po.expected_date, po.currency, po.total,
               v.name AS vendor_name,
               NULLIF(btrim(v.phone), '') AS vendor_phone,
               NULLIF(btrim(v.email), '') AS vendor_email
        FROM staging.ganit_purchase_orders po
        JOIN staging.ganit_vendors v ON v.id = po.vendor_id
        WHERE po.org_id = $1::uuid AND po.is_active
          AND po.status = ANY($2::text[])
          AND po.expected_date IS NOT NULL
          AND po.expected_date < $3::date
        ORDER BY po.expected_date
        LIMIT $4::int
    """, org_id, list(OPEN_STATUSES), today, LIMIT)

    out = []
    for o in orders:
        lines = await _lines_with_quantities(pool, org_id, str(o["id"]))
        outstanding = sum(
            max(0.0, float(l["qty_ordered"]) - float(l["qty_received"]))
            for l in lines)
        if outstanding <= 0:
            continue
        out.append({
            "po_number": o["po_number"], "vendor_name": o["vendor_name"],
            "vendor_phone": o["vendor_phone"], "vendor_email": o["vendor_email"],
            "expected_date": o["expected_date"],
            "days_late": (today - o["expected_date"]).days,
            "qty_outstanding": round(outstanding, 3),
            "order_value": o["total"], "currency": o["currency"],
        })
    return {"data": out, "total": len(out), "as_of": today.isoformat()}


@router.get("/reports/tds-194q")
async def tds_194q(
    fy_start: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Vendors nearing the ₹50 lakh Section 194Q threshold — WARNED AT PO TIME.

    194Q bites at payment or credit, whichever is earlier, and advances count.
    A purchase order is where a firm first sees it coming, which is the whole
    reason this lives here rather than on the bills screen: by the time the
    bill arrives the decision has already been made.

    NOTHING IS DEDUCTED, and nothing here asserts that the deduction applies.
    Whether a firm deducts at all turns on ITS OWN turnover exceeding ₹10 crore
    in the preceding year EXCLUDING GST — a figure this product does not hold.
    The TDS itself is computed on the purchase value INCLUDING GST. Two
    different bases, and getting them the wrong way round is a filing error.
    """
    pool = await get_pool()
    start = _as_date(fy_start, "fy_start")
    if start is None:
        today = date.today()
        # The Indian financial year: 1 April to 31 March.
        start = date(today.year if today.month >= 4 else today.year - 1, 4, 1)

    rows = await pool.fetch("""
        SELECT v.id, v.name,
               COALESCE((SELECT SUM(b.total) FROM staging.ganit_vendor_bills b
                          WHERE b.vendor_id = v.id AND b.org_id = v.org_id
                            AND b.is_active AND b.bill_date >= $2::date), 0)
                   AS purchased_ytd,
               COALESCE((SELECT SUM(po.total)
                           FROM staging.ganit_purchase_orders po
                          WHERE po.vendor_id = v.id AND po.org_id = v.org_id
                            AND po.is_active
                            AND po.status = ANY($3::text[])), 0)
                   AS on_order
        FROM staging.ganit_vendors v
        WHERE v.org_id = $1::uuid AND v.is_active
    """, org_id, start, list(OPEN_STATUSES))

    # The threshold and the rate, read from `staging.statute_calendar` AS OF THE
    # FIRST DAY OF THE FINANCIAL YEAR these totals accumulate in. 194Q restarts
    # every 1 April, so the law that governs a year's accumulation is the law at
    # the start of that year — not the law on the day somebody opens the report.
    # An absent row degrades to the built-in figure and says so in `statute`;
    # this report never refuses and never scores against a zero threshold.
    law = await resolve_194q(pool, start)
    warn_at = law["threshold"] * TDS_194Q_WARN_AT
    out = []
    for r in rows:
        entry = tds_194q_row(r["name"], float(r["purchased_ytd"] or 0),
                             float(r["on_order"] or 0),
                             threshold=law["threshold"], rate=law["rate"])
        if entry["projected"] >= warn_at:
            out.append(entry)
    out.sort(key=lambda e: e["projected"], reverse=True)
    return {
        "data": out, "total": len(out),
        "fy_start": start.isoformat(),
        "threshold": law["threshold"],
        "rate": law["rate"],
        "statute": law["source"],
        "statute_as_of": law["as_of"],
        "buyer_turnover_test": law["buyer_turnover_test"],
        "warn_from": round(warn_at, 2),
        "note": (
            "Whether your firm deducts under 194Q at all depends on your own "
            "turnover exceeding ₹10 crore in the preceding year, EXCLUDING "
            "GST — a figure this product does not hold. Nothing has been "
            "deducted."),
    }


@router.get("/reports/budget")
async def budget_report(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Budget against committed, per department, where limits are set."""
    pool = await get_pool()
    settings = await _settings(pool, org_id)
    rows = await pool.fetch("""
        SELECT COALESCE(NULLIF(btrim(po.department), ''), '(no department)')
                   AS department,
               COALESCE(SUM(po.total), 0) AS committed
        FROM staging.ganit_purchase_orders po
        WHERE po.org_id = $1::uuid AND po.is_active
          AND po.status = ANY($2::text[])
        GROUP BY 1
    """, org_id, list(OPEN_STATUSES))
    state = budget_state(
        settings, {r["department"]: float(r["committed"] or 0) for r in rows})
    return {
        "data": state,
        "enabled": bool(settings.get("budgets_enabled")),
        "caveat": (
            "Departments are free text on the employee record and are not "
            "governed anywhere. A budget keyed on one stops matching the day "
            "the spelling changes. Making this dependable needs departments "
            "to become real records first."),
    }
